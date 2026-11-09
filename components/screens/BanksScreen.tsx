'use client';

import { useCallback, useEffect, useState, type ReactNode } from 'react';
import Link from 'next/link';
import {
  BanknoteArrowDown,
  BanknoteArrowUp,
  CirclePlay,
  ExternalLink,
  Landmark,
  LoaderCircle,
  Pencil,
  Plus,
  RefreshCw,
  Target,
} from 'lucide-react';
import { PageHeader } from '@/components/layout/PageHeader';
import { useSettings } from '@/components/providers/SettingsProvider';
import { isModuleOn } from '@/lib/modules';
import { ModuleGate } from '@/components/modules/ModuleGate';
import { ModuleHelpButton, ModuleSettingsButton } from '@/components/modules/ModuleHelpButton';
import { ModuleSettingsSheet } from '@/components/modules/ModuleSettingsSheet';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useModuleIntro } from '@/components/modules/useModuleIntro';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { IconTile } from '@/components/ui/IconTile';
import { InfoTip } from '@/components/ui/InfoTip';
import { useToast } from '@/components/ui/Toast';
import {
  connectionHealth,
  consentDaysLeft,
  formatAgo,
  MEU_PLUGGY_URL,
  PLUGGY_DASHBOARD_URL,
  type BankAccount,
  type BankAccountKind,
  type BankConnection,
} from '@/lib/banks';
import type { BankAlertSettings, BankReviewCounts } from '@/lib/banks';
import { banksRepository, type BanksOverviewResult } from '@/lib/storage';
import { NotificationsSection } from '@/components/settings/NotificationsSection';
import { Switch } from '@/components/ui/Switch';
import { toStorageErrorMessage } from '@/lib/storage/errors';

export function BanksScreen() {
  return (
    <ModuleGate module="banks">
      <Banks />
    </ModuleGate>
  );
}

/** While a bank is on its way, the screen reads again this often (Pluggy takes about 2 minutes). */
const PENDING_POLL_MS = 5000;
/** Where the setup remembers its step, so a trip to Pluggy's sites comes back to the same one. */
const STEP_KEY = 'capital:bancos-passo';

const primaryButton =
  'bg-primary text-primary-foreground flex min-h-[44px] items-center justify-center gap-2 rounded-lg px-4 font-semibold disabled:opacity-50';
const secondaryButton =
  'border-border text-foreground flex min-h-[44px] items-center justify-center gap-2 rounded-lg border px-4 text-sm font-medium disabled:opacity-50';
const inputClass =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full min-w-0 rounded-lg border px-3 text-base outline-none focus:ring-2';

function Card({ children, tour }: { children: ReactNode; tour?: string }) {
  return (
    <section
      data-tour={tour}
      className="border-border bg-card mx-4 flex flex-col gap-3 rounded-2xl border p-4 shadow-sm"
    >
      {children}
    </section>
  );
}

function Banks() {
  const backHref = useHomeHref();
  const confirm = useConfirm();
  const { settings } = useSettings();
  const { showToast } = useToast();
  const [overview, setOverview] = useState<BanksOverviewResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [configuring, setConfiguring] = useState(false);
  const [changingKey, setChangingKey] = useState(false);
  const [renaming, setRenaming] = useState<BankConnection | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [now, setNow] = useState(() => Date.now());
  /** How many lines of this month still ask for a tap, on the "Conferir" buttons. */
  const [counts, setCounts] = useState<BankReviewCounts | null>(null);
  /** Read the counts again (after "Buscar novidades"). */
  const [countsKey, setCountsKey] = useState(0);

  const load = useCallback(async () => {
    try {
      const data = await banksRepository.getOverview();
      setOverview(data);
      setError(null);
      if (data.givenUp > 0) {
        showToast('Um banco não terminou de autorizar. Tente de novo.', 'info');
      }
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível abrir o Open Finance.'));
    }
  }, [showToast]);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    void load();
    const timer = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(timer);
  }, [load]);

  // A bank on its way (just authorized) shows up by itself, without the person reloading.
  const arriving = overview?.connections.some((connection) => connection.status === 'pending') ?? false;
  useEffect(() => {
    if (!arriving) return;
    const timer = window.setInterval(() => {
      if (document.visibilityState === 'visible') void load();
    }, PENDING_POLL_MS);
    return () => window.clearInterval(timer);
  }, [arriving, load]);

  useModuleIntro('banks', { ready: !!overview });

  const expensesOn = isModuleOn(settings, 'expenses');
  const hasBanks = (overview?.connections.length ?? 0) > 0;
  useEffect(() => {
    if (!expensesOn || !hasBanks) return;
    let active = true;
    banksRepository
      .getReviewCounts()
      .then((next) => {
        if (active) setCounts(next);
      })
      // Without the counts the buttons still work: they just don't say how many.
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [expensesOn, hasBanks, countsKey]);

  async function bringBank() {
    setBusy('connect');
    try {
      const { authorizeUrl } = await banksRepository.connect();
      // The same window: Meu Pluggy sends the person back here when they finish.
      window.location.assign(authorizeUrl);
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível trazer o banco.'), 'error');
      setBusy(null);
    }
  }

  /** A bank that never arrived: out with the failed connection, and straight to a new authorization. */
  async function retry(connection: BankConnection) {
    setBusy('connect');
    try {
      await banksRepository.remove(connection.itemId);
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível tentar de novo.'), 'error');
      setBusy(null);
      return;
    }
    await bringBank();
  }

  async function act(key: string, action: () => Promise<void>, done?: string) {
    setBusy(key);
    try {
      await action();
      await load();
      if (done) showToast(done);
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível concluir esta operação.'), 'error');
    } finally {
      setBusy(null);
    }
  }

  const header = (
    <PageHeader
      title="Open Finance"
      backHref={backHref}
      action={
        <>
          <ModuleHelpButton module="banks" />
          <ModuleSettingsButton module="banks" tourAnchor="bancos-config" onClick={() => setConfiguring(true)} />
        </>
      }
    />
  );

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

  const { key, connections, limit } = overview;
  const atLimit = connections.length >= limit;
  // The stocks and ETFs the banks hold are compared with the Diagrama's quantities, in the Diagrama.
  const diagramOn = isModuleOn(settings, 'diagram');

  return (
    <div className="flex flex-1 flex-col gap-4 pb-10">
      {header}

      {!key || changingKey ? (
        <Card tour="bancos-conexoes">
          <Setup
            changing={changingKey && key !== null}
            onCancel={() => setChangingKey(false)}
            onSaved={async () => {
              setChangingKey(false);
              await load();
              showToast('Chave salva! Agora é só trazer os bancos.');
            }}
          />
        </Card>
      ) : connections.length === 0 ? (
        <Card tour="bancos-conexoes">
          <StepHeader step={4} title="Traga seus bancos para o Capital +" />
          <p className="text-muted text-sm">Escolha um banco no Meu Pluggy e volte. Um por vez.</p>
          <button type="button" className={primaryButton} disabled={busy !== null} onClick={() => void bringBank()}>
            {busy === 'connect' ? <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden /> : <Landmark className="h-4 w-4" aria-hidden />}
            Trazer um banco
          </button>
        </Card>
      ) : (
        <section className="flex flex-col gap-3" data-tour="bancos-conexoes">
          <Card>
            {(expensesOn || diagramOn) && (
              <div className="flex flex-col gap-0.5">
                <p className="text-foreground font-semibold">Conferir com o Capital +</p>
                <p className="text-muted text-sm">O que chegou dos bancos, ao lado do que você lançou.</p>
              </div>
            )}
            {expensesOn && (
              <>
                <Link href="/bancos/conferir?tipo=gastos" className={primaryButton}>
                  <BanknoteArrowUp className="h-4 w-4" aria-hidden />
                  Conferir gastos
                  {counts && <MissingBadge count={counts.expenses} strong />}
                </Link>
                <Link href="/bancos/conferir?tipo=recebimentos" className={secondaryButton}>
                  <BanknoteArrowDown className="h-4 w-4" aria-hidden />
                  Conferir recebimentos
                  {counts && <MissingBadge count={counts.incomes} />}
                </Link>
              </>
            )}
            {diagramOn && (
              <Link href="/diagrama?aba=ativos&conferir=1" className={secondaryButton}>
                <Target className="h-4 w-4" aria-hidden />
                Conferir investimentos
              </Link>
            )}
            <button
              type="button"
              className={expensesOn || diagramOn ? 'text-primary flex min-h-[44px] items-center justify-center gap-2 text-sm font-medium disabled:opacity-50' : secondaryButton}
              disabled={busy !== null}
              onClick={() =>
                void act('sync', async () => {
                  const { changed } = await banksRepository.sync();
                  if (changed.length > 0) setCountsKey((key) => key + 1);
                  showToast(
                    changed.length > 0
                      ? 'Chegaram dados novos dos bancos.'
                      : 'Nada novo. Os bancos mandam dados uma vez por dia.',
                    'info',
                  );
                })
              }
            >
              <RefreshCw className={`h-4 w-4 ${busy === 'sync' ? 'animate-spin' : ''}`} aria-hidden />
              Buscar novidades
            </button>
          </Card>
          {connections.map((connection) => (
            <ConnectionCard
              key={connection.itemId}
              connection={connection}
              now={now}
              busy={busy !== null}
              onRename={() => setRenaming(connection)}
              onRetry={() => void retry(connection)}
              onRenew={async () => {
                const ok = await confirm({
                  title: 'Renovar a autorização',
                  message: `• Banco: ${connection.name}. Ele sai e você autoriza de novo no Meu Pluggy.`,
                  confirmLabel: 'Renovar',
                });
                if (ok) void retry(connection);
              }}
            />
          ))}
          <div className="mx-4 flex flex-col gap-2">
            <button
              type="button"
              className={secondaryButton}
              disabled={busy !== null || atLimit}
              onClick={() => void bringBank()}
            >
              {busy === 'connect' ? (
                <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />
              ) : (
                <Plus className="h-4 w-4" aria-hidden />
              )}
              Trazer outro banco
            </button>
            <p className="text-muted text-center text-xs">
              {connections.length} de {limit} conexões grátis ·{' '}
              <a href={MEU_PLUGGY_URL} target="_blank" rel="noopener noreferrer" className="text-primary font-medium">
                banco novo? Conecte antes no Meu Pluggy
              </a>
            </p>
          </div>
        </section>
      )}

      <div className="text-muted mx-4 text-sm" data-tour="bancos-uma-vez-por-dia">
        <InfoTip
          label="Por que uma vez por dia?"
          info="O Meu Pluggy atualiza cada banco uma vez por dia, e o Capital + lê o que chegou. Ninguém consegue pedir antes: nem o Capital +, nem a Pluggy."
        >
          <span>Os bancos mandam os dados uma vez por dia.</span>
        </InfoTip>
      </div>

      {renaming && (
        <RenameSheet
          connection={renaming}
          busy={busy !== null}
          onClose={() => setRenaming(null)}
          onSave={(name) =>
            act('rename', async () => {
              await banksRepository.rename(renaming.itemId, name);
              setRenaming(null);
            })
          }
          onRemove={async () => {
            const ok = await confirm({
              title: 'Tirar este banco',
              message: `• Banco: ${renaming.name}. Ele sai do Capital + e da sua chave da Pluggy, mas continua conectado no Meu Pluggy.`,
              confirmLabel: 'Tirar',
              destructive: true,
            });
            if (!ok) return;
            await act(
              'remove',
              async () => {
                await banksRepository.remove(renaming.itemId);
                setRenaming(null);
              },
              `${renaming.name} saiu do Capital +.`,
            );
          }}
        />
      )}

      {configuring && (
        <ModuleSettingsSheet module="banks" onClose={() => setConfiguring(false)}>
          {key && connections.length > 0 && <AlertsSettings />}
          {key && connections.length > 0 && <NotificationsSection />}
          <KeySettings
            overview={overview}
            busy={busy !== null}
            onChangeKey={() => {
              setConfiguring(false);
              setChangingKey(true);
            }}
            onDisconnect={async () => {
              const ok = await confirm({
                title: 'Desconectar o Open Finance',
                message:
                  connections.length > 0
                    ? `A sua chave e ${connections.length === 1 ? 'o banco' : `os ${connections.length} bancos`} saem do Capital +. No Meu Pluggy, eles continuam.`
                    : 'A sua chave sai do Capital +.',
                confirmLabel: 'Desconectar',
                destructive: true,
              });
              if (!ok) return;
              setConfiguring(false);
              await act('disconnect', () => banksRepository.disconnect(), 'Open Finance desconectado.');
            }}
          />
        </ModuleSettingsSheet>
      )}
    </div>
  );
}

/** How many lines of this month are missing in the Capital ("✓" when none). */
function MissingBadge({ count, strong = false }: { count: number; strong?: boolean }) {
  return (
    <span
      className={`min-w-[1.5rem] rounded-full px-1.5 text-center text-xs font-semibold tabular-nums ${
        strong ? 'bg-primary-foreground/20' : 'bg-primary/10 text-primary'
      }`}
    >
      {count > 0 ? count : '✓'}
      <span className="sr-only">{count === 1 ? ' falta no Capital +' : count > 0 ? ' faltam no Capital +' : ' tudo confere'}</span>
    </span>
  );
}

function StepHeader({ step, title }: { step: SetupStep; title: string }) {
  return (
    <div className="flex items-start gap-2">
      <div className="flex min-w-0 flex-1 flex-col gap-0.5">
        <p className="text-muted text-xs font-semibold tracking-wide uppercase">Passo {step} de 4</p>
        <p className="text-foreground font-semibold">{title}</p>
      </div>
      <HowToButton step={step} />
    </div>
  );
}

type SetupStep = 1 | 2 | 3 | 4;

/**
 * The silent walkthroughs in public/videos/open-finance, one per part of the setup. Step 3 is the
 * second half of the key video: it starts where the Client Secret shows up.
 */
const HOW_TO: Record<SetupStep, { title: string; video: number; start?: number }> = {
  1: { title: 'Conectar os bancos no Meu Pluggy', video: 1 },
  2: { title: 'Criar a sua chave', video: 2 },
  3: { title: 'Colar a sua chave', video: 2, start: 49 },
  4: { title: 'Trazer os bancos', video: 3 },
};

/** "Ver como fazer": the video of this step, in a sheet. */
function HowToButton({ step }: { step: SetupStep }) {
  const [open, setOpen] = useState(false);
  const { title, video, start } = HOW_TO[step];
  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-primary -my-2 -mr-2 flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-lg px-2 text-sm font-medium"
      >
        <CirclePlay className="h-4 w-4" aria-hidden />
        Ver como fazer
      </button>
      {open && (
        <BottomSheet open title={title} confirmDiscard={false} onClose={() => setOpen(false)}>
          <div className="flex flex-col items-center gap-3">
            <video
              className="aspect-[9/16] max-h-[68vh] w-auto max-w-full rounded-xl bg-black"
              src={`/videos/open-finance/parte-${video}.mp4${start ? `#t=${start}` : ''}`}
              poster={start ? undefined : `/videos/open-finance/parte-${video}.jpg`}
              controls
              autoPlay
              muted
              playsInline
              preload="metadata"
            >
              Este navegador não mostra vídeos.
            </video>
            <p className="text-muted text-center text-xs">
              Sem som: as explicações estão escritas no vídeo.
            </p>
          </div>
        </BottomSheet>
      )}
    </>
  );
}

function readStep(): number {
  try {
    const step = Number(localStorage.getItem(STEP_KEY));
    return step >= 1 && step <= 3 ? step : 1;
  } catch {
    return 1;
  }
}

function saveStep(step: number) {
  try {
    localStorage.setItem(STEP_KEY, String(step));
  } catch {
    // no storage: the setup starts at the first step next time
  }
}

/** Steps 1 to 3: Meu Pluggy, the key at the dashboard, and the key pasted here. */
function Setup({
  changing,
  onCancel,
  onSaved,
}: {
  /** The person already has a key and is replacing it: straight to step 3, with a way out. */
  changing: boolean;
  onCancel: () => void;
  onSaved: () => Promise<void>;
}) {
  const [step, setStep] = useState(changing ? 3 : 1);
  const [clientId, setClientId] = useState('');
  const [clientSecret, setClientSecret] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect -- read once, after hydration
    if (!changing) setStep(readStep());
  }, [changing]);

  function go(next: number) {
    setStep(next);
    setError(null);
    if (!changing) saveStep(next);
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      await banksRepository.saveKey(clientId.trim(), clientSecret.trim());
      saveStep(1);
      await onSaved();
    } catch (err) {
      setError(toStorageErrorMessage(err, 'Não foi possível salvar a chave.'));
    } finally {
      setSaving(false);
    }
  }

  const back = changing ? (
    <button type="button" onClick={onCancel} className="text-muted text-sm font-medium">
      Cancelar
    </button>
  ) : step > 1 ? (
    <button type="button" onClick={() => go(step - 1)} className="text-muted text-sm font-medium">
      ‹ Passo anterior
    </button>
  ) : null;

  if (step === 1) {
    return (
      <>
        <StepHeader step={1} title="Conecte seus bancos no Meu Pluggy" />
        <p className="text-muted text-sm">A autorização é feita no app de cada banco, uma vez só.</p>
        <a href={MEU_PLUGGY_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
          Abrir o Meu Pluggy
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <button type="button" onClick={() => go(2)} className={secondaryButton}>
          Já conectei
        </button>
      </>
    );
  }

  if (step === 2) {
    return (
      <>
        <StepHeader step={2} title="Crie a sua chave" />
        <div className="text-muted text-sm">
          <InfoTip
            label="Mais sobre a chave"
            info="A chave é o Client ID e o Client Secret, na página da aplicação. O dashboard avisa de um teste de 15 dias: ele não vale para uso pessoal, pode ignorar."
          >
            <span>Na Pluggy, crie uma aplicação e ative o conector MeuPluggy.</span>
          </InfoTip>
        </div>
        <a href={PLUGGY_DASHBOARD_URL} target="_blank" rel="noopener noreferrer" className={primaryButton}>
          Abrir o dashboard
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
        <button type="button" onClick={() => go(3)} className={secondaryButton}>
          Já criei
        </button>
        {back}
      </>
    );
  }

  return (
    <form
      className="flex flex-col gap-3"
      onSubmit={(event) => {
        event.preventDefault();
        void save();
      }}
    >
      <StepHeader step={3} title="Cole aqui a sua chave" />
      <p className="text-muted text-sm">Fica guardada cifrada. Só lê, nunca move dinheiro.</p>
      <label className="text-foreground flex flex-col gap-1 text-sm font-medium">
        Client ID
        <input
          className={inputClass}
          value={clientId}
          onChange={(event) => setClientId(event.target.value)}
          autoComplete="off"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={200}
        />
      </label>
      <label className="text-foreground flex flex-col gap-1 text-sm font-medium">
        Client Secret
        <input
          className={inputClass}
          type="password"
          value={clientSecret}
          onChange={(event) => setClientSecret(event.target.value)}
          autoComplete="new-password"
          autoCapitalize="none"
          spellCheck={false}
          maxLength={500}
        />
      </label>
      {error && <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm">{error}</p>}
      <button type="submit" className={primaryButton} disabled={saving || !clientId.trim() || !clientSecret.trim()}>
        {saving && <LoaderCircle className="h-4 w-4 animate-spin" aria-hidden />}
        {saving ? 'Conferindo…' : 'Salvar a chave'}
      </button>
      {back}
    </form>
  );
}

const KIND_LABEL: Record<BankAccountKind, string> = {
  checking: 'conta',
  savings: 'poupança',
  card: 'cartão',
  other: 'outra',
};

function ConnectionCard({
  connection,
  now,
  busy,
  onRename,
  onRetry,
  onRenew,
}: {
  connection: BankConnection;
  now: number;
  busy: boolean;
  onRename: () => void;
  onRetry: () => void;
  onRenew: () => void;
}) {
  const health = connectionHealth(connection, now);
  // The first read failed (Pluggy's side) and nothing arrived: Meu Pluggy can't be asked to read
  // again, so the way out is bringing the bank again.
  const neverArrived = health === 'error' && connection.accounts.length === 0;
  const consentLeft = health === 'reconnect' ? null : consentDaysLeft(connection, now);
  const fine = health === 'ok' || health === 'pending';
  return (
    <Card>
      <div className="flex items-center gap-3">
        <IconTile icon={Landmark} tone={health === 'ok' ? 'blue' : health === 'pending' ? 'purple' : 'amber'} />
        <div className="min-w-0 flex-1">
          <p className="text-foreground truncate font-semibold">{connection.name}</p>
          <p className={`text-sm ${fine ? 'text-muted' : 'text-warning'}`}>
            {health === 'pending' ? (
              <span className="inline-flex items-center gap-1.5">
                <LoaderCircle className="h-3.5 w-3.5 animate-spin" aria-hidden />
                Chegando… leva uns 2 minutos
              </span>
            ) : health === 'ok' ? (
              connection.lastUpdatedAt ? (
                `Atualizado ${formatAgo(connection.lastUpdatedAt, now)}`
              ) : (
                'Ainda sem atualização'
              )
            ) : health === 'stale' ? (
              `Parado: sem dados do banco ${formatAgo(connection.lastUpdatedAt!, now)}`
            ) : neverArrived ? (
              'Não chegou: deu erro na Pluggy.'
            ) : health === 'error' ? (
              'A última atualização falhou; a Pluggy tenta de novo.'
            ) : (
              'A autorização acabou.'
            )}
          </p>
        </div>
        <button
          type="button"
          onClick={onRename}
          aria-label={`Editar ${connection.name}`}
          className="text-muted hover:text-foreground flex h-10 w-10 shrink-0 items-center justify-center rounded-full"
        >
          <Pencil className="h-4 w-4" aria-hidden />
        </button>
      </div>

      {health === 'stale' && (
        <a href={MEU_PLUGGY_URL} target="_blank" rel="noopener noreferrer" className={secondaryButton}>
          Reconectar no Meu Pluggy
          <ExternalLink className="h-4 w-4" aria-hidden />
        </a>
      )}
      {(neverArrived || health === 'reconnect') && (
        <button type="button" onClick={onRetry} disabled={busy} className={secondaryButton}>
          {neverArrived ? 'Tentar de novo' : 'Trazer de novo'}
        </button>
      )}
      {consentLeft !== null && (
        <div className="bg-warning-bg text-warning flex items-center justify-between gap-2 rounded-lg px-3 py-2 text-sm">
          <span>{consentLeft === 0 ? 'A autorização vence hoje.' : `A autorização vence em ${consentLeft} ${consentLeft === 1 ? 'dia' : 'dias'}.`}</span>
          <button type="button" onClick={onRenew} disabled={busy} className="shrink-0 font-semibold">
            Renovar
          </button>
        </div>
      )}

      {connection.accounts.length > 0 && (
        <ul className="divide-border flex flex-col divide-y">
          {connection.accounts.map((account) => (
            <AccountRow
              key={account.id}
              account={account}
              // A bank that is just one card is named after it: no need to say the card's name twice.
              name={connection.accounts.length === 1 && account.name === connection.name ? null : account.name}
            />
          ))}
        </ul>
      )}
    </Card>
  );
}

/** Just what the account is: no balance, no bill and no due date (the banks only check the Capital). */
function AccountRow({ account, name }: { account: BankAccount; name: string | null }) {
  const kind = KIND_LABEL[account.kind];
  return (
    <li className="flex items-baseline justify-between gap-3 py-2 text-sm">
      <span className="text-foreground min-w-0 truncate">{name ?? kind[0].toUpperCase() + kind.slice(1)}</span>
      {name !== null && <span className="text-muted shrink-0 text-xs">{kind}</span>}
    </li>
  );
}

function RenameSheet({
  connection,
  busy,
  onClose,
  onSave,
  onRemove,
}: {
  connection: BankConnection;
  busy: boolean;
  onClose: () => void;
  onSave: (name: string) => Promise<void>;
  onRemove: () => Promise<void>;
}) {
  const [name, setName] = useState(connection.named ? connection.name : '');
  return (
    <BottomSheet open title="Editar banco" onClose={onClose}>
      <form
        className="flex flex-col gap-3"
        onSubmit={(event) => {
          event.preventDefault();
          void onSave(name);
        }}
      >
        <label className="text-foreground flex flex-col gap-1 text-sm font-medium">
          Nome
          <input
            className={inputClass}
            value={name}
            onChange={(event) => setName(event.target.value)}
            maxLength={60}
            placeholder={connection.named ? 'Nome do banco' : connection.name}
          />
        </label>
        <button type="submit" className={primaryButton} disabled={busy}>
          Salvar
        </button>
      </form>
      <button
        type="button"
        onClick={() => void onRemove()}
        disabled={busy}
        className="border-danger text-danger mt-4 min-h-[44px] w-full rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
      >
        Tirar este banco do Capital +
      </button>
    </BottomSheet>
  );
}

const ALERT_SWITCHES: { key: keyof BankAlertSettings; label: string; detail?: string }[] = [
  { key: 'expenses', label: 'Gastos para conferir' },
  { key: 'incomes', label: 'Recebimentos para conferir' },
  { key: 'silent', label: 'Aviso silencioso', detail: 'Chega sem som nem vibração.' },
];

/** What the phone is told when a bank sends data: only when it brought something to check. */
function AlertsSettings() {
  const { showToast } = useToast();
  const [draft, setDraft] = useState<BankAlertSettings | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    let active = true;
    banksRepository
      .getAlerts()
      .then((next) => {
        if (active) setDraft(next.settings);
      })
      .catch((err: unknown) => {
        if (active) setError(toStorageErrorMessage(err, 'Não foi possível abrir os avisos.'));
      });
    return () => {
      active = false;
    };
  }, []);

  async function save(current: BankAlertSettings) {
    setSaving(true);
    try {
      setDraft((await banksRepository.saveAlerts(current)).settings);
      showToast('Avisos salvos.');
    } catch (err) {
      showToast(toStorageErrorMessage(err, 'Não foi possível salvar os avisos.'), 'error');
    } finally {
      setSaving(false);
    }
  }

  if (error) return <p className="text-danger px-4 text-sm">{error}</p>;
  if (!draft) return <p className="text-muted px-4 text-sm">Carregando os avisos…</p>;

  return (
    <form
      className="flex flex-col gap-3 px-4"
      onSubmit={(event) => {
        event.preventDefault();
        void save(draft);
      }}
    >
      <p className="text-foreground font-semibold">Avisos no celular</p>
      <p className="text-muted text-sm">Quando um banco atualiza e traz algo para conferir.</p>
      {ALERT_SWITCHES.map(({ key, label, detail }) => (
        <div key={key} className="flex items-center justify-between gap-3">
          <span className="min-w-0">
            <span className="text-foreground block text-sm font-medium">{label}</span>
            {detail && <span className="text-muted block text-xs">{detail}</span>}
          </span>
          <Switch
            checked={draft[key]}
            onChange={(checked) => setDraft({ ...draft, [key]: checked })}
            label={label}
          />
        </div>
      ))}
      <button type="submit" className={primaryButton} disabled={saving}>
        {saving ? 'Salvando…' : 'Salvar avisos'}
      </button>
    </form>
  );
}

/** The gear: the key (never the Secret itself), swapping it, and disconnecting everything. */
function KeySettings({
  overview,
  busy,
  onChangeKey,
  onDisconnect,
}: {
  overview: BanksOverviewResult;
  busy: boolean;
  onChangeKey: () => void;
  onDisconnect: () => Promise<void>;
}) {
  const { key } = overview;
  return (
    <section className="flex flex-col gap-3 px-4">
      <p className="text-foreground font-semibold">Sua chave da Pluggy</p>
      {key ? (
        <dl className="text-sm">
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Client ID</dt>
            <dd className="text-foreground min-w-0 truncate font-mono text-xs">{key.clientId}</dd>
          </div>
          <div className="flex justify-between gap-3">
            <dt className="text-muted">Client Secret</dt>
            <dd className="text-foreground font-mono text-xs">••••{key.secretHint}</dd>
          </div>
        </dl>
      ) : (
        <p className="text-muted text-sm">Nenhuma chave salva ainda.</p>
      )}
      {key && (
        <button type="button" onClick={onChangeKey} disabled={busy} className={secondaryButton}>
          Trocar a chave
        </button>
      )}
      {key && (
        <button
          type="button"
          onClick={() => void onDisconnect()}
          disabled={busy}
          className="border-danger text-danger min-h-[44px] rounded-lg border px-3 text-sm font-medium disabled:opacity-50"
        >
          Desconectar tudo
        </button>
      )}
      <a
        href={MEU_PLUGGY_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="text-primary inline-flex items-center gap-1 text-sm font-medium"
      >
        Abrir o Meu Pluggy
        <ExternalLink className="h-3.5 w-3.5" aria-hidden />
      </a>
    </section>
  );
}
