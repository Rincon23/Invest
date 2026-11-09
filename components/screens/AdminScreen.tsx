'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Activity,
  Ban,
  CheckCircle2,
  CircleMinus,
  CircleX,
  EyeOff,
  FlaskConical,
  KeyRound,
  PauseCircle,
  Search,
  Server,
  Thermometer,
  TriangleAlert,
  Users,
  type LucideIcon,
} from 'lucide-react';
import { countByStatus, selfTestAreaName, worstStatus } from '@/lib/admin/selfTest';
import type {
  AdminModule,
  AdminOverview,
  AdminUser,
  GuardEventKind,
  SelfTestArea,
  SelfTestOverview,
  SelfTestResult,
  SelfTestStatus,
  ServerStatus,
} from '@/lib/admin/types';
import type { ModuleKey } from '@/lib/budget';
import { moduleDefinition, moduleNames } from '@/lib/modules';
import { adminRepository } from '@/lib/storage/admin';
import { toStorageErrorMessage } from '@/lib/storage/errors';
import { AdminCard as Card } from '@/components/admin/AdminCard';
import { FactsCard } from '@/components/admin/FactsCard';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { MODULE_VISUALS } from '@/components/modules/visuals';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { IconTile, type IconTone } from '@/components/ui/IconTile';
import { Switch } from '@/components/ui/Switch';
import { useToast } from '@/components/ui/Toast';

const REFRESH_MS = 5000;
const EVENTS_SHOWN = 8;

const timeFormatter = new Intl.DateTimeFormat('pt-BR', { hour: '2-digit', minute: '2-digit' });
const dateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit', year: 'numeric' });
const shortDateFormatter = new Intl.DateTimeFormat('pt-BR', { day: '2-digit', month: '2-digit' });

function formatNumber(value: number, digits = 0): string {
  return value.toLocaleString('pt-BR', { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

/** "14:32" today, "16/09 14:32" on another day. */
function formatMoment(at: number, now: number): string {
  const date = new Date(at);
  const sameDay = new Date(now).toDateString() === date.toDateString();
  return sameDay
    ? timeFormatter.format(date)
    : `${shortDateFormatter.format(date)} ${timeFormatter.format(date)}`;
}

/** "agora há pouco", "há 5 min", "há 3 h", "há 2 dias", or the date. */
function formatAgo(iso: string, now: number): string {
  const minutes = Math.floor((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 2) return 'agora há pouco';
  if (minutes < 60) return `há ${minutes} min`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `há ${hours} h`;
  const days = Math.floor(hours / 24);
  if (days < 30) return days === 1 ? 'há 1 dia' : `há ${days} dias`;
  return `em ${dateFormatter.format(new Date(iso))}`;
}

type Level = 'ok' | 'alert' | 'paused';

function levelOf(status: ServerStatus): Level {
  if (status.shedding) return 'paused';
  const hot = status.temperatureC !== null && status.temperatureC >= status.config.tempAlertC;
  return hot || status.rps >= status.config.alertRps ? 'alert' : 'ok';
}

const EVENT_VISUALS: Record<GuardEventKind, { icon: LucideIcon; tone: IconTone }> = {
  'rps-alert': { icon: Activity, tone: 'amber' },
  'shed-start': { icon: PauseCircle, tone: 'red' },
  'shed-end': { icon: CheckCircle2, tone: 'green' },
  'ip-blocked': { icon: Ban, tone: 'red' },
  'temp-alert': { icon: Thermometer, tone: 'amber' },
};

const TEST_VISUALS: Record<
  SelfTestStatus,
  { icon: LucideIcon; tone: IconTone; text: string; label: string }
> = {
  ok: { icon: CheckCircle2, tone: 'green', text: 'text-success', label: 'Passou' },
  warn: { icon: TriangleAlert, tone: 'amber', text: 'text-warning', label: 'Aviso' },
  fail: { icon: CircleX, tone: 'red', text: 'text-danger', label: 'Falhou' },
  skip: { icon: CircleMinus, tone: 'neutral', text: 'text-muted', label: 'Não se aplica aqui' },
};

const RUN_DOT: Record<'ok' | 'warn' | 'fail', string> = {
  ok: 'bg-success',
  warn: 'bg-warning',
  fail: 'bg-danger',
};

/** "1 conta sem acesso", "3 contas sem acesso" (to the restricted modules). */
function accountsWithoutVip(count: number): string {
  return count === 1 ? '1 conta sem acesso' : `${count} contas sem acesso`;
}

/**
 * Administração, only for whoever runs the server (OWNER_EMAIL): how the board is doing right now
 * (requests per second, temperature, pauses), the recent warnings, which modules are restricted
 * ("Restrito", one switch per module: hidden from every account without access), every account
 * with the switch that gives it access (in the code and the database the access is still "vip"),
 * and the "Você sabia?" to edit.
 */
export function AdminScreen() {
  const { showToast } = useToast();
  const confirm = useConfirm();
  const router = useRouter();
  const homeHref = useHomeHref();
  const [overview, setOverview] = useState<AdminOverview | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  const [query, setQuery] = useState('');
  const [showAllEvents, setShowAllEvents] = useState(false);
  /** The account whose access switch is being saved: a refresh meanwhile keeps its local value. */
  const saving = useRef<string | null>(null);
  /** The same for the module whose "Restrito" is being saved. */
  const savingModule = useRef<ModuleKey | null>(null);
  const [busyModule, setBusyModule] = useState<ModuleKey | null>(null);
  const [testing, setTesting] = useState(false);

  const load = useCallback(async () => {
    try {
      const next = await adminRepository.overview();
      setOverview((previous) => {
        if (!previous) return next;
        const local = previous.users.find((item) => item.id === saving.current);
        const localModule = previous.modules.find((item) => item.key === savingModule.current);
        return {
          ...next,
          users: next.users.map((item) => (local && item.id === local.id ? local : item)),
          modules: next.modules.map((item) =>
            localModule && item.key === localModule.key ? localModule : item,
          ),
        };
      });
      setError(null);
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível atualizar agora.'));
    }
    setNow(Date.now());
  }, []);

  useEffect(() => {
    void load();
    const timer = window.setInterval(() => {
      if (!document.hidden) void load();
    }, REFRESH_MS);
    return () => window.clearInterval(timer);
  }, [load]);

  async function toggleVip(target: AdminUser, vip: boolean) {
    const apply = (value: boolean) =>
      setOverview(
        (previous) =>
          previous && {
            ...previous,
            users: previous.users.map((item) => (item.id === target.id ? { ...item, vip: value } : item)),
          },
      );
    saving.current = target.id;
    apply(vip);
    try {
      await adminRepository.setVip(target.id, vip);
      showToast(
        vip
          ? `${target.email} agora vê os módulos restritos.`
          : `${target.email} não vê mais os módulos restritos. Nenhum dado foi apagado.`,
        'success',
      );
    } catch (err) {
      apply(!vip);
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
    } finally {
      saving.current = null;
    }
  }

  async function toggleModuleVip(target: AdminModule, vipOnly: boolean) {
    const name = moduleDefinition(target.key).name;
    const using = target.usersWithoutVip;
    if (vipOnly && using > 0) {
      const confirmed = await confirm({
        title: `Restringir ${name}?`,
        message: `Ele some para ${accountsWithoutVip(using)}, sem apagar nenhum dado.`,
        confirmLabel: 'Restringir',
        cancelLabel: 'Agora não',
      });
      if (!confirmed) return;
    }
    const apply = (value: boolean) =>
      setOverview(
        (previous) =>
          previous && {
            ...previous,
            modules: previous.modules.map((item) =>
              item.key === target.key ? { ...item, vipOnly: value } : item,
            ),
          },
      );
    savingModule.current = target.key;
    setBusyModule(target.key);
    apply(vipOnly);
    try {
      const { turnedOff } = await adminRepository.setModuleVip(target.key, vipOnly);
      showToast(
        vipOnly
          ? `${name} agora é restrito.${turnedOff > 0 ? ` Sumiu para ${accountsWithoutVip(turnedOff)}.` : ''}`
          : `${name} liberado para todas as contas.`,
        'success',
      );
      // The owner's own screens read the new choice too.
      router.refresh();
    } catch (err) {
      apply(!vipOnly);
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar. Tente de novo.'), 'error');
    } finally {
      savingModule.current = null;
      setBusyModule(null);
    }
    void load();
  }

  async function runTests() {
    setTesting(true);
    try {
      const run = await adminRepository.runTests();
      const { fail } = countByStatus(run.results);
      showToast(
        fail > 0 ? `${fail} ${fail === 1 ? 'teste falhou' : 'testes falharam'}.` : 'Tudo funcionando.',
        fail > 0 ? 'error' : 'success',
      );
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível rodar os testes agora.'), 'error');
    } finally {
      setTesting(false);
    }
    void load();
  }

  const users = useMemo(() => {
    const list = overview?.users ?? [];
    const term = query.trim().toLowerCase();
    return term ? list.filter((item) => item.email.toLowerCase().includes(term)) : list;
  }, [overview, query]);

  const header = <PageHeader title="Administração" subtitle="Só você vê esta tela" backHref={homeHref} />;

  if (!overview) {
    return (
      <div className="flex flex-1 flex-col gap-4 pb-10">
        {header}
        {error ? (
          <p className="bg-danger-bg text-danger mx-4 rounded-lg px-3 py-2 text-sm">{error}</p>
        ) : (
          <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>
        )}
      </div>
    );
  }

  const { status } = overview;
  const level = levelOf(status);
  const vipCount = overview.users.filter((item) => item.vip).length;
  const vipModules = overview.modules.filter((item) => item.vipOnly).map((item) => item.key);
  const events = showAllEvents ? status.events : status.events.slice(0, EVENTS_SHOWN);

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      {header}

      {error && (
        <p className="bg-warning-bg text-warning mx-4 rounded-lg px-3 py-2 text-sm">
          {error} Mostrando os últimos números recebidos.
        </p>
      )}

      <SelfTestsCard tests={overview.tests} now={now} busy={testing} onRun={() => void runTests()} />

      <Card title="Servidor agora" icon={Server} tone="amber">
        <StatusBanner level={level} status={status} now={now} />

        <div className="grid grid-cols-3 gap-2">
          <Stat
            label="Requisições/s"
            value={formatNumber(status.rps, 1)}
            hint={`aviso ${status.config.alertRps} · pausa ${status.config.shedRps}`}
            warn={status.rps >= status.config.alertRps}
          />
          <Stat
            label="Temperatura"
            value={status.temperatureC === null ? '—' : `${formatNumber(status.temperatureC)} °C`}
            hint={
              status.temperatureC === null
                ? 'sem sensor aqui'
                : `aviso ${status.config.tempAlertC} · pausa ${status.config.tempShedC}`
            }
            warn={status.temperatureC !== null && status.temperatureC >= status.config.tempAlertC}
          />
          <Stat
            label="Pico"
            value={formatNumber(status.peakRps, 1)}
            hint={status.peakAt ? `às ${formatMoment(status.peakAt, now)}` : 'nenhum ainda'}
          />
        </div>

        <p className="text-muted text-xs">
          Desde {formatMoment(status.since, now)}: {formatNumber(status.totals.allowed)} atendidas ·{' '}
          {formatNumber(status.totals.ipBlocked)} barradas por IP · {formatNumber(status.totals.shed)} durante
          pausas. Um IP pode fazer até {formatNumber(status.config.ipPer10s)} requisições em 10 segundos e{' '}
          {formatNumber(status.config.ipPerMinute)} por minuto; os limites ficam no <code>.env.local</code> do
          servidor.
        </p>
      </Card>

      <Card title="Alertas recentes" icon={Activity} tone="red">
        {status.events.length === 0 ? (
          <p className="text-muted text-sm">Nenhum alerta desde que o servidor ligou.</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {events.map((event) => {
              const visual = EVENT_VISUALS[event.kind];
              return (
                <li key={`${event.at}-${event.kind}-${event.message}`} className="flex gap-3">
                  <IconTile icon={visual.icon} tone={visual.tone} size="sm" />
                  <div className="min-w-0 flex-1">
                    <p className="text-foreground text-sm">{event.message}</p>
                    <p className="text-muted text-xs">{formatMoment(event.at, now)}</p>
                  </div>
                </li>
              );
            })}
          </ul>
        )}
        {status.events.length > EVENTS_SHOWN && (
          <button
            type="button"
            onClick={() => setShowAllEvents((value) => !value)}
            className="text-accent min-h-[36px] self-start text-sm font-medium"
          >
            {showAllEvents ? 'Mostrar menos' : `Ver todos (${status.events.length})`}
          </button>
        )}
      </Card>

      <Card title="Módulos restritos" icon={EyeOff} tone="purple">
        <p className="text-muted text-sm">Some para quem não tem acesso, sem apagar dados.</p>
        <ul className="divide-border -mx-1 flex flex-col divide-y">
          {overview.modules.map((item) => (
            <ModuleRow
              key={item.key}
              item={item}
              busy={busyModule === item.key}
              onToggle={(vipOnly) => void toggleModuleVip(item, vipOnly)}
            />
          ))}
        </ul>
      </Card>

      <Card title={`Contas (${overview.users.length})`} icon={Users} tone="blue">
        <p className="text-muted text-sm">
          {vipModules.length > 0
            ? `O acesso libera os módulos restritos: hoje, ${moduleNames(vipModules)}.`
            : 'Nenhum módulo está restrito agora.'}{' '}
          {vipCount} {vipCount === 1 ? 'conta tem acesso' : 'contas têm acesso'}, contando a sua.
        </p>

        {overview.users.length > 5 && (
          <label className="border-border bg-background flex min-h-[44px] items-center gap-2 rounded-lg border px-3">
            <Search aria-hidden className="text-muted h-4 w-4 shrink-0" />
            <input
              type="search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Buscar por e-mail"
              aria-label="Buscar conta por e-mail"
              className="text-foreground min-w-0 flex-1 bg-transparent text-sm outline-none"
            />
          </label>
        )}

        {users.length === 0 ? (
          <p className="text-muted text-sm">Nenhuma conta com esse e-mail.</p>
        ) : (
          <ul className="divide-border -mx-1 flex flex-col divide-y">
            {users.map((account) => (
              <UserRow
                key={account.id}
                account={account}
                now={now}
                onToggle={(vip) => void toggleVip(account, vip)}
              />
            ))}
          </ul>
        )}
      </Card>

      <FactsCard />
    </div>
  );
}

/** "1 aviso", "2 avisos"; "1 teste", "3 testes". */
function plural(count: number, one: string, many: string): string {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * Testes automáticos: every module and the server, tested inside the server a few minutes after it
 * starts and then every hour (lib/server/selfTest). What failed or warned comes first, with what
 * went wrong; the whole list is one tap away.
 */
function SelfTestsCard({
  tests,
  now,
  busy,
  onRun,
}: {
  tests: SelfTestOverview;
  now: number;
  busy: boolean;
  onRun: () => void;
}) {
  const [showAll, setShowAll] = useState(false);
  const { last } = tests;
  const results = last?.results ?? [];
  const counts = countByStatus(results);
  const worst = last ? worstStatus(results) : 'skip';
  const problems = [
    ...results.filter((result) => result.status === 'fail'),
    ...results.filter((result) => result.status === 'warn'),
  ];
  const running = busy || tests.running;
  const seconds = last
    ? (new Date(last.finishedAt).getTime() - new Date(last.startedAt).getTime()) / 1000
    : 0;
  const runs = [
    ...(last ? [{ id: last.id, startedAt: last.startedAt, failed: counts.fail, warned: counts.warn }] : []),
    ...tests.history,
  ].reverse();

  return (
    <Card title="Testes automáticos" icon={FlaskConical} tone={TEST_VISUALS[worst].tone}>
      {!last ? (
        <p className="bg-background text-muted rounded-lg px-3 py-2 text-sm">
          Ainda não rodaram. Rodam sozinhos a cada hora.
        </p>
      ) : counts.fail > 0 ? (
        <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm font-medium">
          {plural(counts.fail, 'teste falhou', 'testes falharam')}.
        </p>
      ) : counts.warn > 0 ? (
        <p className="bg-warning-bg text-warning rounded-lg px-3 py-2 text-sm font-medium">
          Tudo funcionando, com {plural(counts.warn, 'aviso', 'avisos')}.
        </p>
      ) : (
        <p className="bg-success-bg text-success rounded-lg px-3 py-2 text-sm font-medium">
          Tudo funcionando: {plural(counts.ok, 'teste passou', 'testes passaram')}.
        </p>
      )}

      {problems.length > 0 && (
        <ul className="flex flex-col gap-3">
          {problems.map((result) => (
            <TestProblem key={result.id} result={result} />
          ))}
        </ul>
      )}

      {last && (
        <p className="text-muted text-xs">
          Rodou {formatMoment(new Date(last.startedAt).getTime(), now)} em{' '}
          {formatNumber(Math.max(seconds, 0.1), 1)} s
          {tests.nextAt ? ` · próxima às ${timeFormatter.format(new Date(tests.nextAt))}` : ''}
        </p>
      )}

      {runs.length > 1 && (
        <div className="flex items-center gap-2">
          <span className="text-muted text-xs">Rodadas</span>
          <ul className="flex flex-wrap items-center gap-1" aria-label="Rodadas, da mais antiga à mais nova">
            {runs.map((run) => {
              const state = run.failed > 0 ? 'fail' : run.warned > 0 ? 'warn' : 'ok';
              const label = `${formatMoment(new Date(run.startedAt).getTime(), now)}: ${TEST_VISUALS[state].label.toLowerCase()}`;
              return (
                <li
                  key={run.id}
                  title={label}
                  aria-label={label}
                  className={`h-2.5 w-2.5 rounded-full ${RUN_DOT[state]}`}
                />
              );
            })}
          </ul>
        </div>
      )}

      <div className="flex gap-2">
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="bg-primary text-primary-foreground min-h-[44px] flex-1 rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
        >
          {running ? 'Rodando…' : 'Rodar agora'}
        </button>
        {last && (
          <button
            type="button"
            onClick={() => setShowAll((value) => !value)}
            aria-expanded={showAll}
            className="border-border text-foreground min-h-[44px] flex-1 rounded-lg border px-4 text-sm font-medium"
          >
            {showAll ? 'Esconder a lista' : `Ver os ${results.length}`}
          </button>
        )}
      </div>

      {showAll && <TestList results={results} />}
    </Card>
  );
}

function TestProblem({ result }: { result: SelfTestResult }) {
  const visual = TEST_VISUALS[result.status];
  return (
    <li className="flex gap-3">
      <IconTile icon={visual.icon} tone={visual.tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">
          {selfTestAreaName(result.area)} · {result.name}
        </p>
        {result.message && <p className="text-muted text-xs break-words">{result.message}</p>}
      </div>
    </li>
  );
}

/** Every test, under the server or the module it is about, in the order they ran. */
function TestList({ results }: { results: SelfTestResult[] }) {
  const groups: { area: SelfTestArea; results: SelfTestResult[] }[] = [];
  for (const result of results) {
    const group = groups.at(-1);
    if (group?.area === result.area) group.results.push(result);
    else groups.push({ area: result.area, results: [result] });
  }
  return (
    <ul className="divide-border -mx-1 flex flex-col divide-y">
      {groups.map((group) => {
        const visual =
          group.area === 'server' ? { icon: Server, tone: 'amber' as const } : MODULE_VISUALS[group.area];
        const worst = TEST_VISUALS[worstStatus(group.results)];
        const WorstIcon = worst.icon;
        return (
          <li key={group.area} className="flex flex-col gap-2 px-1 py-3">
            <div className="flex items-center gap-3">
              <IconTile icon={visual.icon} tone={visual.tone} size="sm" />
              <p className="text-foreground min-w-0 flex-1 text-sm font-medium">
                {selfTestAreaName(group.area)}
              </p>
              <WorstIcon aria-label={worst.label} className={`h-5 w-5 shrink-0 ${worst.text}`} />
            </div>
            <ul className="flex flex-col gap-1.5 pl-11">
              {group.results.map((result) => {
                const status = TEST_VISUALS[result.status];
                const StatusIcon = status.icon;
                return (
                  <li key={result.id} className="flex gap-2">
                    <StatusIcon
                      aria-label={status.label}
                      className={`mt-0.5 h-3.5 w-3.5 shrink-0 ${status.text}`}
                    />
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground text-xs">{result.name}</p>
                      {result.status !== 'ok' && result.message && (
                        <p className="text-muted text-[11px] leading-snug break-words">{result.message}</p>
                      )}
                    </div>
                  </li>
                );
              })}
            </ul>
          </li>
        );
      })}
    </ul>
  );
}

function StatusBanner({ level, status, now }: { level: Level; status: ServerStatus; now: number }) {
  if (level === 'paused') {
    const why =
      status.shedReason === 'temperature' ? 'a placa esquentou demais' : 'acessos demais de uma vez';
    return (
      <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm font-medium">
        Pausado até {status.shedUntil ? formatMoment(status.shedUntil, now) : 'em instantes'}: {why}. Quem
        acessa agora vê &quot;volte em instantes&quot;.
      </p>
    );
  }
  if (level === 'alert') {
    return (
      <p className="bg-warning-bg text-warning rounded-lg px-3 py-2 text-sm font-medium">
        Em alerta: acima do aviso. Passou do limite, pausa sozinho.
      </p>
    );
  }
  return (
    <p className="bg-success-bg text-success rounded-lg px-3 py-2 text-sm font-medium">
      Tudo normal. Atualiza a cada {REFRESH_MS / 1000} segundos.
    </p>
  );
}

function Stat({
  label,
  value,
  hint,
  warn = false,
}: {
  label: string;
  value: string;
  hint: string;
  warn?: boolean;
}) {
  return (
    <div className="bg-background flex min-w-0 flex-col gap-0.5 rounded-xl px-2.5 py-2">
      <span className="text-muted truncate text-[11px] font-medium">{label}</span>
      <span
        className={`text-lg leading-tight font-semibold tabular-nums ${warn ? 'text-warning' : 'text-foreground'}`}
      >
        {value}
      </span>
      <span className="text-muted text-[11px] leading-tight">{hint}</span>
    </div>
  );
}

function ModuleRow({
  item,
  busy,
  onToggle,
}: {
  item: AdminModule;
  busy: boolean;
  onToggle: (vipOnly: boolean) => void;
}) {
  const info = moduleDefinition(item.key);
  const visual = MODULE_VISUALS[item.key];
  const using = item.usersWithoutVip;
  return (
    <li className="flex items-center gap-3 px-1 py-3">
      <IconTile icon={visual.icon} tone={visual.tone} size="sm" />
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium">{info.name}</p>
        <p className="text-muted text-xs">
          {item.vipOnly
            ? 'Só as contas com acesso'
            : using > 0
              ? `Todas as contas · ${accountsWithoutVip(using)} ${using === 1 ? 'usa' : 'usam'}`
              : 'Todas as contas'}
        </p>
      </div>
      <div className="flex shrink-0 flex-col items-center gap-1">
        <Switch checked={item.vipOnly} onChange={onToggle} label={`Restrito: ${info.name}`} disabled={busy} />
        <span aria-hidden className="text-muted text-[10px] leading-none font-medium">
          Restrito
        </span>
      </div>
    </li>
  );
}

function UserRow({
  account,
  now,
  onToggle,
}: {
  account: AdminUser;
  now: number;
  onToggle: (vip: boolean) => void;
}) {
  return (
    <li className="flex items-center gap-3 px-1 py-3">
      <div className="min-w-0 flex-1">
        <p className="text-foreground text-sm font-medium break-all">{account.email}</p>
        <div className="mt-1 flex flex-wrap items-center gap-1.5">
          {account.owner && (
            <span className="bg-primary/10 text-primary rounded-full px-2 py-0.5 text-[11px] font-semibold">
              Você · dono
            </span>
          )}
          {account.vip && !account.owner && (
            <span className="bg-primary/10 text-primary inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold">
              <KeyRound aria-hidden className="h-3 w-3" />
              Acesso aos restritos
            </span>
          )}
          {!account.emailVerified && (
            <span className="bg-warning-bg text-warning rounded-full px-2 py-0.5 text-[11px] font-semibold">
              E-mail não confirmado
            </span>
          )}
        </div>
        <p className="text-muted mt-1 text-xs">
          Criada em {dateFormatter.format(new Date(account.createdAt))} ·{' '}
          {account.lastSeenAt
            ? `último acesso ${formatAgo(account.lastSeenAt, now)}`
            : 'nenhuma sessão aberta'}
        </p>
      </div>
      <Switch
        checked={account.vip}
        onChange={onToggle}
        label={
          account.owner
            ? 'Sua conta sempre tem acesso aos restritos'
            : `Acesso aos restritos para ${account.email}`
        }
        disabled={account.owner}
      />
    </li>
  );
}
