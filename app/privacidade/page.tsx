import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DEFAULT_VIP_MODULES, isModuleHidden, type ModuleAccess } from '@/lib/modules';
import { userAccess, vipModules } from '@/lib/server/access';
import { getAuth } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';

export const metadata: Metadata = {
  title: 'Privacidade — Invest +',
  description: 'Como o Invest + trata os seus dados.',
};

// Depends on who reads it (the restricted modules' sections); never prerendered at build time.
export const dynamic = 'force-dynamic';

/**
 * Who is reading: signed in or not, an account without access never sees the section of a
 * restricted module ("Restrito" in Administração), so the page never tells it the module exists.
 */
async function readerAccess(): Promise<ModuleAccess> {
  // Read the headers before anything touches the database (see app/(app)/layout.tsx).
  const requestHeaders = await headers();
  try {
    const session = await getAuth().api.getSession({ headers: requestHeaders });
    const db = getDb();
    if (session) return await userAccess(db, session.user.id, session.user.email);
    return { vip: false, vipModules: await vipModules(db) };
  } catch {
    // Without the database, the modules restricted from the start stay out.
    return { vip: false, vipModules: DEFAULT_VIP_MODULES };
  }
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="flex flex-col gap-2">
      <h2 className="text-foreground text-lg font-semibold">{title}</h2>
      <div className="text-muted flex flex-col gap-2 text-sm leading-relaxed">{children}</div>
    </section>
  );
}

/**
 * The public privacy policy. Reachable without signing in (see PUBLIC_PREFIXES in proxy.ts).
 */
export default async function PrivacyPage() {
  const access = await readerAccess();
  const shows = (key: 'banks') => !isModuleHidden(access, key);
  const connections = [shows('banks') && 'com os bancos'].filter(Boolean);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-primary text-sm font-semibold">Invest +</p>
        <h1 className="text-foreground text-2xl font-bold">Política de privacidade</h1>
        <p className="text-muted text-sm">Última atualização: 9 de novembro de 2026.</p>
      </header>

      <Section title="O que é o Invest +">
        <p>
          O Invest + é um app de investimentos: diz quanto aportar em cada ativo (o Diagrama), mostra como a
          carteira andou e, se você quiser, confere a carteira com a sua corretora. Ele roda num servidor
          próprio, com banco de dados próprio: os dados não ficam em serviços de banco na nuvem e não são
          vendidos nem compartilhados com ninguém. Cada conta só enxerga os próprios dados.
        </p>
      </Section>

      <Section title="O que guardamos">
        <ul className="list-disc pl-5">
          <li>Da sua conta: nome, e-mail e a senha em forma cifrada (hash).</li>
          <li>O seu Diagrama: tipos e metas, ativos com quantidades e notas, perguntas e aportes.</li>
          <li>
            Para as notificações: o endereço de inscrição do navegador de cada aparelho em que você as ativar.
          </li>
          <li>Um cookie de sessão, só para manter você conectado.</li>
        </ul>
        <p>
          As cotações vêm da B3 e do Yahoo Finance, e os indicadores (LPA, VPA, P/VP) do Fundamentus, sempre
          pelo código do ativo: nada da sua conta vai junto.
        </p>
        <p>
          Quem administra o servidor vê a lista de contas (e-mail, data de criação e último acesso) para
          liberar recursos e proteger o servidor. A sua carteira não aparece nessa lista.
        </p>
      </Section>

      {shows('banks') && (
        <Section title="Open Finance (Meu Pluggy)">
          <p>
            Se você conectar uma corretora pelo Open Finance, o Invest + lê os seus investimentos pelo{' '}
            <a
              href="https://meu.pluggy.ai"
              className="text-primary underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meu Pluggy
            </a>
            , um serviço gratuito da Pluggy em que você mesmo conecta os seus bancos pelo Open Finance. O
            {' '}Invest + usa a sua própria chave da Pluggy (Client ID e Client Secret), que você cria no
            dashboard da Pluggy e cola no app.
          </p>
          <ul className="list-disc pl-5">
            <li>
              É só leitura: o Invest + não move dinheiro, não compra nem vende nada e não altera nada nos seus
              bancos.
            </li>
            <li>
              Guarda a sua chave (o Client Secret fica cifrado no servidor e nunca é mostrado nem enviado a
              ninguém além da Pluggy), a lista das corretoras que você trouxe, com o nome que você der a cada
              uma, e os investimentos de cada uma: nome, código, tipo, quantidade e saldo. Não lê transações nem
              o saldo das contas. Uma vez por hora, o Invest + pergunta à Pluggy se chegou algo novo. Os
              investimentos servem só para conferir as quantidades do Diagrama: nada muda sozinho, você confere
              e corrige com um toque.
            </li>
            <li>
              Esses dados não são vendidos, não são usados para publicidade e não são usados para treinar
              modelos de IA.
            </li>
          </ul>
          <p>
            Na engrenagem do Open Finance, &quot;Desconectar tudo&quot; apaga a chave e as corretoras do{' '}
            Invest + e tira o acesso do Invest + na Pluggy. Elas continuam conectadas no Meu Pluggy, onde você
            pode removê-las também.
          </p>
        </Section>
      )}

      <Section title="Apagar os seus dados">
        <p>
          Em Configurações (na bandeja de apps, a setinha embaixo da Início), &quot;Apagar todos os
          dados&quot; apaga o seu Diagrama e tudo o que você guardou no app
          {connections.length > 0 ? ` (inclusive as conexões ${connections.join(' e ')})` : ''} e mantém a
          conta. &quot;Excluir minha conta&quot;, no mesmo lugar, apaga a conta e todos os dados dela de uma
          vez, depois de você confirmar a senha.
        </p>
      </Section>

      <p className="text-muted text-sm">
        {/* "/" opens the app for a signed-in person and the login for anyone else (see proxy.ts). */}
        <Link href="/" className="text-primary underline">
          Voltar ao Invest +
        </Link>
      </p>
    </main>
  );
}
