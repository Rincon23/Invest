'use client';

import { useActionState, useState, type ReactNode } from 'react';
import {
  requestPasswordReset,
  resendConfirmation,
  signIn,
  signUp,
  type AuthActionState,
} from '@/lib/auth/actions';
import { InstallAppButton } from '@/components/pwa/InstallAppButton';

const EMPTY: AuthActionState = {};

const FIELD_CLASS =
  'border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-md border px-3 outline-none focus:ring-2';
const PRIMARY_BTN =
  'bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 font-semibold disabled:opacity-50';

type Mode = 'sign-in' | 'sign-up' | 'forgot';

export function LoginScreen({
  passwordReset = false,
  accountDeleted = false,
}: {
  passwordReset?: boolean;
  accountDeleted?: boolean;
}) {
  const [mode, setMode] = useState<Mode>('sign-in');

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-8 px-6 py-12">
      <header className="flex flex-col gap-1 text-center">
        {/* Lido "Capital plus": sem o rótulo, o leitor de tela diria "Capital mais". */}
        <h1 className="text-foreground text-2xl font-bold" aria-label="Capital plus">
          Capital +
        </h1>
        <p className="text-muted text-sm">Orçamento doméstico por categorias</p>
      </header>

      {mode === 'sign-in' && (
        <SignInForm onModeChange={setMode} passwordReset={passwordReset} accountDeleted={accountDeleted} />
      )}
      {mode === 'sign-up' && <SignUpForm onModeChange={setMode} />}
      {mode === 'forgot' && <ForgotForm onModeChange={setMode} />}

      <InstallAppButton />
    </main>
  );
}

function Feedback({ state }: { state: AuthActionState }) {
  if (!state.error) return null;
  return (
    <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm" role="alert">
      {state.error}
    </p>
  );
}

function SwitchLink({ children, onClick }: { children: ReactNode; onClick: () => void }) {
  return (
    <button type="button" onClick={onClick} className="text-accent min-h-[36px] text-sm font-medium">
      {children}
    </button>
  );
}

function SignInForm({
  onModeChange,
  passwordReset,
  accountDeleted,
}: {
  onModeChange: (mode: Mode) => void;
  passwordReset: boolean;
  accountDeleted: boolean;
}) {
  const [state, action, pending] = useActionState(signIn, EMPTY);

  return (
    <form action={action} className="flex flex-col gap-4">
      <Feedback state={state} />
      {passwordReset && !state.error && (
        <p className="text-success text-center text-sm" role="status">
          Senha redefinida. Entre com a nova senha.
        </p>
      )}
      {accountDeleted && !state.error && (
        <p className="text-success text-center text-sm" role="status">
          Conta excluída, com todos os dados dela. Obrigado por ter usado o Capital +.
        </p>
      )}
      <label className="text-muted flex flex-col gap-1 text-sm">
        E-mail
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={FIELD_CLASS}
        />
      </label>
      <label className="text-muted flex flex-col gap-1 text-sm">
        Senha
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          className={FIELD_CLASS}
        />
      </label>
      <button type="submit" disabled={pending} className={PRIMARY_BTN}>
        {pending ? 'Entrando…' : 'Entrar'}
      </button>
      <div className="flex items-center justify-between">
        <SwitchLink onClick={() => onModeChange('forgot')}>Esqueci a senha</SwitchLink>
        <SwitchLink onClick={() => onModeChange('sign-up')}>Criar conta</SwitchLink>
      </div>
    </form>
  );
}

function SignUpForm({ onModeChange }: { onModeChange: (mode: Mode) => void }) {
  const [state, action, pending] = useActionState(signUp, EMPTY);

  if (state.notice === 'check-email' || state.notice === 'check-email-resent') {
    return (
      <CheckEmail
        email={state.email ?? ''}
        resent={state.notice === 'check-email-resent'}
        onBack={() => onModeChange('sign-in')}
      />
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Feedback state={state} />
      <div className="grid grid-cols-2 gap-3">
        <label className="text-muted flex min-w-0 flex-col gap-1 text-sm">
          Nome
          <input
            type="text"
            name="firstName"
            autoComplete="given-name"
            required
            maxLength={60}
            defaultValue={state.firstName}
            className={FIELD_CLASS}
          />
        </label>
        <label className="text-muted flex min-w-0 flex-col gap-1 text-sm">
          Sobrenome
          <input
            type="text"
            name="lastName"
            autoComplete="family-name"
            required
            maxLength={60}
            defaultValue={state.lastName}
            className={FIELD_CLASS}
          />
        </label>
      </div>
      <label className="text-muted flex flex-col gap-1 text-sm">
        E-mail
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={FIELD_CLASS}
        />
      </label>
      <label className="text-muted flex flex-col gap-1 text-sm">
        Senha
        <input
          type="password"
          name="password"
          autoComplete="new-password"
          required
          minLength={8}
          className={FIELD_CLASS}
        />
        <span className="text-muted-foreground text-xs">Pelo menos 8 caracteres.</span>
      </label>
      <button type="submit" disabled={pending} className={PRIMARY_BTN}>
        {pending ? 'Criando conta…' : 'Criar conta'}
      </button>
      <div className="text-center">
        <SwitchLink onClick={() => onModeChange('sign-in')}>Já tenho conta</SwitchLink>
      </div>
    </form>
  );
}

function ForgotForm({ onModeChange }: { onModeChange: (mode: Mode) => void }) {
  const [state, action, pending] = useActionState(requestPasswordReset, EMPTY);

  if (state.notice === 'reset-sent') {
    return (
      <div className="flex flex-col gap-4 text-center">
        <p className="text-foreground text-sm">
          Se existir uma conta para <strong>{state.email}</strong>, enviamos um link para redefinir a senha.
        </p>
        <SwitchLink onClick={() => onModeChange('sign-in')}>Voltar para entrar</SwitchLink>
      </div>
    );
  }

  return (
    <form action={action} className="flex flex-col gap-4">
      <Feedback state={state} />
      <p className="text-muted text-sm">Enviaremos um link para redefinir sua senha.</p>
      <label className="text-muted flex flex-col gap-1 text-sm">
        E-mail
        <input
          type="email"
          name="email"
          autoComplete="email"
          required
          defaultValue={state.email}
          className={FIELD_CLASS}
        />
      </label>
      <button type="submit" disabled={pending} className={PRIMARY_BTN}>
        {pending ? 'Enviando…' : 'Enviar link'}
      </button>
      <div className="text-center">
        <SwitchLink onClick={() => onModeChange('sign-in')}>Voltar</SwitchLink>
      </div>
    </form>
  );
}

function CheckEmail({ email, resent, onBack }: { email: string; resent: boolean; onBack: () => void }) {
  const [state, action, pending] = useActionState(resendConfirmation, EMPTY);
  const confirmedResent = resent || state.notice === 'check-email-resent';

  return (
    <div className="flex flex-col gap-4 text-center">
      <p className="text-foreground text-sm">
        Enviamos um link de confirmação para <strong>{email}</strong>. Clique nele para ativar sua conta e
        depois faça login.
      </p>
      {confirmedResent && <p className="text-success text-sm">E-mail reenviado.</p>}
      <Feedback state={state} />
      <form action={action}>
        <input type="hidden" name="email" value={email} />
        <button
          type="submit"
          disabled={pending}
          className="border-border text-foreground min-h-[44px] w-full rounded-lg border px-4 text-sm font-medium disabled:opacity-50"
        >
          {pending ? 'Reenviando…' : 'Reenviar e-mail'}
        </button>
      </form>
      <SwitchLink onClick={onBack}>Voltar para entrar</SwitchLink>
    </div>
  );
}
