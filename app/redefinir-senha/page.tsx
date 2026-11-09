import type { Metadata } from 'next';
import Link from 'next/link';
import { ResetPasswordScreen } from '@/components/screens/ResetPasswordScreen';

export const metadata: Metadata = {
  title: 'Nova senha — Capital +',
};

/**
 * Target of the password-reset e-mail. Better Auth checks the link and redirects here with
 * `?token=…` (valid) or `?error=…` (invalid or expired). Public: there is no session yet.
 */
export default async function RedefinirSenhaPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const { token, error } = await searchParams;

  if (error || typeof token !== 'string' || token === '') {
    return (
      <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12 text-center">
        <h1 className="text-foreground text-xl font-bold">Link inválido ou expirado</h1>
        <p className="text-muted text-sm">
          Este link para redefinir a senha não é mais válido. Peça um novo na tela de acesso.
        </p>
        <Link
          href="/login"
          className="bg-primary text-primary-foreground min-h-[44px] rounded-lg px-4 py-2 font-semibold"
        >
          Voltar para entrar
        </Link>
      </main>
    );
  }

  return <ResetPasswordScreen token={token} />;
}
