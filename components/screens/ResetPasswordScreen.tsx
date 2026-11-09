'use client';

import { useActionState } from 'react';
import { resetPassword, type AuthActionState } from '@/lib/auth/actions';

const EMPTY: AuthActionState = {};

/** "Nova senha" form, opened from the password-reset e-mail link. */
export function ResetPasswordScreen({ token }: { token: string }) {
  const [state, action, pending] = useActionState(resetPassword, EMPTY);

  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12">
      <h1 className="text-foreground text-xl font-bold">Nova senha</h1>
      <form action={action} className="flex flex-col gap-4">
        {state.error && (
          <p className="bg-danger-bg text-danger rounded-lg px-3 py-2 text-sm" role="alert">
            {state.error}
          </p>
        )}
        <input type="hidden" name="token" value={token} />
        <label className="text-muted flex flex-col gap-1 text-sm">
          Senha
          <input
            type="password"
            name="password"
            autoComplete="new-password"
            required
            minLength={8}
            className="border-border bg-background text-foreground focus:ring-primary min-h-[44px] rounded-md border px-3 outline-none focus:ring-2"
          />
          <span className="text-muted-foreground text-xs">Pelo menos 8 caracteres.</span>
        </label>
        <button
          type="submit"
          disabled={pending}
          className="bg-primary text-primary-foreground min-h-[44px] w-full rounded-lg px-4 font-semibold disabled:opacity-50"
        >
          {pending ? 'Salvando…' : 'Salvar nova senha'}
        </button>
      </form>
    </main>
  );
}
