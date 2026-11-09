import type { Metadata } from 'next';
import Link from 'next/link';

export const metadata: Metadata = {
  title: 'Link inválido — Capital +',
};

export default function AuthCodeErrorPage() {
  return (
    <main className="mx-auto flex min-h-dvh w-full max-w-sm flex-col justify-center gap-6 px-6 py-12 text-center">
      <h1 className="text-foreground text-xl font-bold">Link inválido ou expirado</h1>
      <p className="text-muted text-sm">
        Este link de confirmação não é mais válido. Peça um novo na tela de acesso.
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
