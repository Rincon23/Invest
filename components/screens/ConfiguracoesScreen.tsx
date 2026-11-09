'use client';

import { useActionState, useEffect, useState, type ChangeEvent } from 'react';
import { useRouter } from 'next/navigation';
import { PageHeader } from '@/components/layout/PageHeader';
import { useHomeHref } from '@/components/modules/useHomeHref';
import { useAuth } from '@/components/providers/AuthProvider';
import { useSettings } from '@/components/providers/SettingsProvider';
import { useTheme } from '@/components/providers/ThemeProvider';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';
import { BottomSheet } from '@/components/ui/BottomSheet';
import { useConfirm } from '@/components/ui/ConfirmSheet';
import { useToast } from '@/components/ui/Toast';
import {
  deleteAccount,
  signOut,
  updateName,
  type DeleteAccountState,
  type UpdateNameState,
} from '@/lib/auth/actions';
import { MAX_NAME_PART, splitName } from '@/lib/auth/names';
import { budgetRepository, downloadBackup, readBackupFile } from '@/lib/storage';
import { hasLocalData, importLocalDataToCloud } from '@/lib/storage/localMigration';

/**
 * What belongs to no module: the account, the theme, backups and the local data of this device.
 * Privacidade is an entry of the app drawer, and each module's own settings live behind
 * the gear in its screen (categories in Categorias, reminder times in Lembretes, and so on).
 */
export function ConfiguracoesScreen() {
  const { settings } = useSettings();
  const { theme, setTheme } = useTheme();
  const confirm = useConfirm();
  const { showToast } = useToast();
  const [importError, setImportError] = useState<string | null>(null);
  const homeHref = useHomeHref();

  async function handleExport() {
    const payload = await budgetRepository.exportData();
    downloadBackup(payload);
  }

  async function handleImportFile(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setImportError(null);
    try {
      const payload = await readBackupFile(file);
      await budgetRepository.importData(payload);
      // Full reload (not router navigation): every screen's IndexedDB-backed state must
      // be re-read from scratch after a wholesale data replacement.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch (err) {
      setImportError(err instanceof Error ? err.message : 'Erro ao importar.');
    }
  }

  async function handleClearAll() {
    const confirmed = await confirm({
      title: 'Apagar todos os dados',
      message: 'Apaga tudo; a conta continua. Não dá para desfazer.',
      confirmLabel: 'Apagar tudo',
      cancelLabel: 'Manter',
      destructive: true,
    });
    if (!confirmed) {
      showToast('Operação cancelada. Nenhuma alteração foi realizada.', 'info');
      return;
    }
    await budgetRepository.clearAll();
    // eslint-disable-next-line @next/next/no-location-assign-relative-destination
    window.location.href = '/';
  }

  // Rendered on the client only, like every screen that waits for the settings: the theme lives in
  // this device's storage, so the server could only guess which button is selected.
  if (!settings) {
    return <div className="text-muted flex flex-1 items-center justify-center px-4 py-16">Carregando…</div>;
  }

  return (
    <div className="flex flex-1 flex-col gap-6 pb-10">
      <PageHeader title="Configurações" backHref={homeHref} />

      <AccountSection />

      <InstallAppButton className="mx-4 w-auto" />

      <section className="flex flex-col gap-3 px-4">
        <h2 className="text-muted text-sm font-semibold">Tema</h2>
        <div className="flex gap-2">
          {(['light', 'dark', 'system'] as const).map((option) => (
            <button
              key={option}
              type="button"
              onClick={() => setTheme(option)}
              className={`min-h-[44px] flex-1 rounded-lg border px-3 text-sm font-medium ${
                theme === option
                  ? 'border-primary bg-primary text-primary-foreground'
                  : 'border-border text-foreground'
              }`}
            >
              {option === 'light' ? 'Claro' : option === 'dark' ? 'Escuro' : 'Sistema'}
            </button>
          ))}
        </div>
      </section>

      <section className="flex flex-col gap-3 px-4">
        <h2 className="text-muted text-sm font-semibold">Backup</h2>
        <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
          <button
            type="button"
            onClick={handleExport}
            className="border-border text-foreground min-h-[44px] rounded-lg border px-4 text-sm font-medium"
          >
            Exportar dados
          </button>
          <label className="border-border text-foreground flex min-h-[44px] cursor-pointer items-center justify-center rounded-lg border px-4 text-sm font-medium">
            Importar dados
            <input type="file" accept="application/json" className="hidden" onChange={handleImportFile} />
          </label>
          {importError && <p className="text-danger text-sm">{importError}</p>}
        </div>
      </section>

      <LocalDataSection />

      <section className="px-4">
        <button
          type="button"
          onClick={() => void handleClearAll()}
          className="border-danger text-danger min-h-[44px] w-full rounded-lg border px-4 text-sm font-semibold"
        >
          Apagar todos os dados
        </button>
      </section>
    </div>
  );
}

function AccountSection() {
  const { user } = useAuth();
  const [deleting, setDeleting] = useState(false);

  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-muted text-sm font-semibold">Conta</h2>
      <div className="border-border bg-card flex flex-col gap-3 rounded-xl border p-4 shadow-sm">
        <NameForm current={user.name} />
        <p className="text-muted text-sm break-all">{user.email ?? 'Sessão ativa'}</p>
        <form action={signOut}>
          <button
            type="submit"
            className="border-border text-foreground min-h-[44px] w-full rounded-lg border px-4 text-sm font-medium"
          >
            Sair
          </button>
        </form>
        <button
          type="button"
          onClick={() => setDeleting(true)}
          className="text-danger min-h-[44px] w-full rounded-lg px-4 text-sm font-medium"
        >
          Excluir minha conta
        </button>
      </div>
      {deleting && <DeleteAccountSheet onClose={() => setDeleting(false)} />}
    </section>
  );
}

const NAME_IDLE: UpdateNameState = {};

/**
 * "Seu nome": the name and surname the account goes by. The app only ever uses the first one —
 * "Bom dia, Enzo" on Início, and in the reminders' notifications.
 */
function NameForm({ current }: { current: string | null }) {
  const [state, action, pending] = useActionState(updateName, NAME_IDLE);
  const router = useRouter();
  const { showToast } = useToast();
  const { first, last } = splitName(current);

  useEffect(() => {
    if (!state.saved) return;
    showToast('Nome salvo.');
    // The name comes from the server with the session: read it again so every screen gets it.
    router.refresh();
  }, [state, router, showToast]);

  return (
    <form action={action} className="flex flex-col gap-3">
      {!current && (
        <p className="bg-primary/10 text-foreground rounded-lg px-3 py-2 text-xs leading-relaxed">
          Como podemos te chamar? O Capital + usa o seu primeiro nome na Início e nos lembretes.
        </p>
      )}
      <div className="grid grid-cols-2 gap-3">
        <label className="text-muted flex min-w-0 flex-col gap-1 text-sm">
          Nome
          <input
            type="text"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={MAX_NAME_PART}
            defaultValue={first}
            key={`first-${first}`}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>
        <label className="text-muted flex min-w-0 flex-col gap-1 text-sm">
          Sobrenome
          <input
            type="text"
            name="lastName"
            autoComplete="family-name"
            maxLength={MAX_NAME_PART}
            defaultValue={last}
            key={`last-${last}`}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] w-full rounded-lg border px-3 py-2 text-base outline-none focus:ring-2"
          />
        </label>
      </div>
      {state.error && <p className="text-danger text-sm">{state.error}</p>}
      <button
        type="submit"
        disabled={pending}
        className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 text-sm font-semibold disabled:opacity-50"
      >
        {pending ? 'Salvando…' : 'Salvar nome'}
      </button>
    </form>
  );
}

const NO_ERROR: DeleteAccountState = {};

/** Deletes the account and everything in it, once the password is typed again. */
function DeleteAccountSheet({ onClose }: { onClose: () => void }) {
  const [state, action, pending] = useActionState(deleteAccount, NO_ERROR);

  return (
    <BottomSheet open onClose={onClose} title="Excluir minha conta" confirmDiscard={false}>
      <form action={action} className="flex flex-col gap-4">
        <p className="text-muted text-sm">
          A conta e tudo o que ela guarda somem de vez. Para guardar uma cópia, use &quot;Exportar dados&quot;
          antes.
        </p>
        {state.error && (
          <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm" role="alert">
            {state.error}
          </p>
        )}
        <label className="text-muted flex flex-col gap-1 text-sm">
          Sua senha, para confirmar
          <input
            type="password"
            name="password"
            required
            autoComplete="current-password"
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-md border px-3 outline-none focus:ring-2"
          />
        </label>
        <button
          type="submit"
          disabled={pending}
          className="bg-danger min-h-[44px] w-full rounded-lg px-4 font-semibold text-white disabled:opacity-50"
        >
          {pending ? 'Excluindo…' : 'Excluir conta e todos os dados'}
        </button>
        <button
          type="button"
          onClick={onClose}
          className="border-border text-foreground min-h-[44px] w-full rounded-lg border px-4 text-sm font-medium"
        >
          Manter minha conta
        </button>
      </form>
    </BottomSheet>
  );
}

function LocalDataSection() {
  const confirm = useConfirm();
  const [available, setAvailable] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void hasLocalData().then((has) => {
      if (active) setAvailable(has);
    });
    return () => {
      active = false;
    };
  }, []);

  if (!available) return null;

  async function handleImport() {
    const confirmed = await confirm({
      title: 'Importar dados deste dispositivo',
      message: 'Substitui os dados atuais da sua conta. Não dá para desfazer.',
      confirmLabel: 'Importar',
      destructive: true,
    });
    if (!confirmed) return;
    setBusy(true);
    setError(null);
    try {
      await importLocalDataToCloud();
      // Full reload (not router navigation): every screen's repository-backed state
      // must be re-read from scratch after a wholesale data replacement.
      // eslint-disable-next-line @next/next/no-location-assign-relative-destination
      window.location.href = '/';
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Erro ao importar.');
      setBusy(false);
    }
  }

  return (
    <section className="flex flex-col gap-3 px-4">
      <h2 className="text-muted text-sm font-semibold">Dados locais deste dispositivo</h2>
      <div className="border-border bg-card flex flex-col gap-2 rounded-xl border p-4 shadow-sm">
        <p className="text-muted text-sm">
          Há dados da versão anterior neste aparelho.
        </p>
        <button
          type="button"
          onClick={() => void handleImport()}
          disabled={busy}
          className="border-border text-foreground min-h-[44px] rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
        >
          {busy ? 'Importando…' : 'Importar dados deste dispositivo'}
        </button>
        {error && <p className="text-danger text-sm">{error}</p>}
      </div>
    </section>
  );
}
