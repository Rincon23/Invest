'use client';

import { useCallback, useEffect, useState } from 'react';
import { BellOff, BellRing, Monitor, Smartphone, Trash2 } from 'lucide-react';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { IconTile } from '@/components/ui/IconTile';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import {
  NotificationsBlockedError,
  currentSubscription,
  isIosDevice,
  pushSupport,
  rememberEndpoint,
  subscribeThisBrowser,
  unsubscribeThisBrowser,
  type PushSupport,
} from '@/lib/notifications/browser';
import type { PushDevice } from '@/lib/notifications/types';
import { notificationsRepository, type PushStatus } from '@/lib/storage';

interface State {
  support: PushSupport;
  /** iPhone or iPad: its settings and its problems are not the ones of Chrome on Android. */
  ios: boolean;
  /** The user denied notifications for this site; only the browser's settings can undo it. */
  blocked: boolean;
  status: PushStatus;
  /** This browser's subscription endpoint, if it has one. */
  endpoint: string | null;
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : 'Algo deu errado. Tente de novo.';
}

function formatWhen(iso: string): string {
  const date = new Date(iso);
  const day = date.toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' });
  const time = date.toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' });
  return `${day} às ${time}`;
}

function isPhone(device: PushDevice): boolean {
  return /Android|iPhone|iPad/.test(device.label);
}

/**
 * Configurações → Notificações: turn notifications on for this device (the permission prompt
 * only ever comes from a tap here), send a test, and see or remove the devices that receive.
 */
export function NotificationsSection() {
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [state, setState] = useState<State | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<'enable' | 'disable' | 'test' | null>(null);
  // Why turning notifications on failed. Inline, not a toast: it may be a how-to that takes a
  // moment to read (e.g. Brave's push setting).
  const [enableError, setEnableError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [status, subscription] = await Promise.all([
      notificationsRepository.getPushStatus(),
      currentSubscription(),
    ]);
    const support = pushSupport();
    setState({
      support,
      ios: isIosDevice(),
      blocked: support === 'supported' && Notification.permission === 'denied',
      status,
      endpoint: subscription?.endpoint ?? null,
    });
    setLoadError(null);
  }, []);

  useEffect(() => {
    // State is only set once the API answers (asynchronously), not during the effect.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    load().catch((err) => setLoadError(errorMessage(err)));
  }, [load]);

  const thisDevice = state?.status.devices.find((d) => d.endpoint === state.endpoint) ?? null;

  async function enable() {
    const publicKey = state?.status.publicKey;
    if (!publicKey) return;
    setBusy('enable');
    setEnableError(null);
    try {
      const subscription = await subscribeThisBrowser(publicKey);
      await notificationsRepository.registerDevice(subscription);
      rememberEndpoint(subscription.endpoint);
      await load();
      showToast('Notificações ativadas neste aparelho.', 'success');
    } catch (err) {
      if (err instanceof NotificationsBlockedError) {
        setState((current) => (current ? { ...current, blocked: true } : current));
      } else {
        setEnableError(errorMessage(err));
      }
    } finally {
      setBusy(null);
    }
  }

  async function disable() {
    const confirmed = await confirm({
      title: 'Desativar neste aparelho',
      message: 'Este aparelho para de receber; os outros continuam.',
      confirmLabel: 'Desativar',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    setBusy('disable');
    try {
      await unsubscribeThisBrowser();
      if (thisDevice) await notificationsRepository.removeDevice(thisDevice.id);
      rememberEndpoint(null);
      await load();
      showToast('Notificações desativadas neste aparelho.', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function sendTest() {
    setBusy('test');
    try {
      const report = await notificationsRepository.sendTest();
      if (report.sent > 0) {
        const devices = report.sent === 1 ? '1 aparelho' : `${report.sent} aparelhos`;
        showToast(`Notificação enviada para ${devices}. Deve chegar em alguns segundos.`, 'success');
      } else if (report.removed > 0) {
        showToast('Nenhum aparelho recebe mais. Ative de novo aqui.', 'error');
      } else {
        showToast('O serviço de notificações não respondeu. Tente de novo.', 'error');
      }
      await load();
    } catch (err) {
      showToast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  }

  async function removeDevice(device: PushDevice) {
    const confirmed = await confirm({
      title: 'Remover aparelho',
      message: `"${device.label}" para de receber. Para voltar, ative nele de novo.`,
      confirmLabel: 'Remover',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    try {
      await notificationsRepository.removeDevice(device.id);
      if (device.id === thisDevice?.id) {
        await unsubscribeThisBrowser();
        rememberEndpoint(null);
      }
      await load();
      showToast('Aparelho removido.', 'success');
    } catch (err) {
      showToast(errorMessage(err), 'error');
    }
  }

  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-muted text-sm font-semibold">Notificações</h2>
      <div className="border-border bg-card flex flex-col gap-4 rounded-xl border p-4 shadow-sm">
        {loadError ? (
          <p className="text-danger text-sm">{loadError}</p>
        ) : !state ? (
          <p className="text-muted text-sm">Carregando…</p>
        ) : (
          <>
            <ThisDevice
              state={state}
              active={Boolean(thisDevice)}
              busy={busy}
              enableError={enableError}
              onEnable={() => void enable()}
              onDisable={() => void disable()}
              onTest={() => void sendTest()}
            />

            {state.status.devices.length > 0 && (
              <div className="flex flex-col gap-2">
                <p className="text-muted text-xs font-semibold tracking-wide uppercase">
                  Aparelhos que recebem
                </p>
                <ul className="flex flex-col gap-2">
                  {state.status.devices.map((device) => {
                    const Icon = isPhone(device) ? Smartphone : Monitor;
                    const current = device.id === thisDevice?.id;
                    return (
                      <li
                        key={device.id}
                        className="border-border flex items-center gap-3 rounded-lg border px-3 py-2"
                      >
                        <Icon className="text-muted h-5 w-5 shrink-0" aria-hidden />
                        <div className="min-w-0 flex-1">
                          <p className="text-foreground truncate text-sm font-medium">
                            {device.label}
                            {current && (
                              <span className="bg-primary/10 text-primary ml-2 rounded-full px-2 py-0.5 text-xs font-semibold">
                                este aparelho
                              </span>
                            )}
                          </p>
                          <p className="text-muted text-xs">
                            {device.lastSuccessAt
                              ? `Última notificação: ${formatWhen(device.lastSuccessAt)}`
                              : `Ativado em ${formatWhen(device.createdAt)}`}
                          </p>
                        </div>
                        <button
                          type="button"
                          onClick={() => void removeDevice(device)}
                          aria-label={`Remover ${device.label}`}
                          className="text-muted hover:text-danger flex h-11 w-11 shrink-0 items-center justify-center rounded-lg"
                        >
                          <Trash2 className="h-5 w-5" aria-hidden />
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {!state.ios && (
                  <p className="text-muted text-xs">Avisos atrasados? Tire o Chrome da economia de bateria.</p>
                )}
              </div>
            )}
          </>
        )}
      </div>
    </section>
  );
}

function ThisDevice({
  state,
  active,
  busy,
  enableError,
  onEnable,
  onDisable,
  onTest,
}: {
  state: State;
  active: boolean;
  busy: 'enable' | 'disable' | 'test' | null;
  enableError: string | null;
  onEnable: () => void;
  onDisable: () => void;
  onTest: () => void;
}) {
  if (state.support === 'ios-install') {
    return (
      <div className="flex flex-col gap-3">
        <p className="text-muted text-sm">As notificações só chegam neste aparelho com o app instalado.</p>
        <InstallAppButton />
      </div>
    );
  }
  if (state.support === 'ios-update') {
    return <p className="text-muted text-sm">Atualize o iOS para receber notificações neste aparelho.</p>;
  }
  if (state.support === 'unsupported') {
    return (
      <p className="text-muted text-sm">
        Este navegador não recebe notificações. Use o Chrome.
      </p>
    );
  }
  if (!state.status.publicKey) {
    return <p className="text-muted text-sm">As notificações ainda não foram configuradas no servidor.</p>;
  }

  const subtitle = active
    ? 'Ativadas — os lembretes chegam aqui.'
    : state.blocked
      ? 'Bloqueadas pelo navegador.'
      : 'Desativadas neste aparelho.';

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-3">
        <IconTile icon={active ? BellRing : BellOff} tone={active ? 'green' : 'neutral'} />
        <div className="min-w-0">
          <p className="text-foreground text-sm font-semibold">Neste aparelho</p>
          <p className="text-muted text-xs">{subtitle}</p>
        </div>
      </div>

      {active ? (
        <div className="flex flex-col gap-2">
          <button
            type="button"
            onClick={onTest}
            disabled={busy !== null}
            className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'test' ? 'Enviando…' : 'Enviar notificação de teste'}
          </button>
          <button
            type="button"
            onClick={onDisable}
            disabled={busy !== null}
            className="border-border text-foreground min-h-[44px] rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
          >
            {busy === 'disable' ? 'Desativando…' : 'Desativar neste aparelho'}
          </button>
        </div>
      ) : state.blocked ? (
        <p className="text-muted text-sm">
          {state.ios
            ? 'Bloqueado. Libere em Ajustes → Notificações → Capital +.'
            : 'Bloqueado. Libere no cadeado do endereço.'}
        </p>
      ) : (
        <>
          <button
            type="button"
            onClick={onEnable}
            disabled={busy !== null}
            className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
          >
            {busy === 'enable' ? 'Ativando…' : 'Ativar notificações neste aparelho'}
          </button>
          {enableError && (
            <p role="alert" className="text-danger text-sm">
              {enableError}
            </p>
          )}
        </>
      )}
    </div>
  );
}
