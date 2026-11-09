import type { Metadata } from 'next';
import { headers } from 'next/headers';
import Link from 'next/link';
import type { ReactNode } from 'react';
import { DEFAULT_VIP_MODULES, isModuleHidden, type ModuleAccess } from '@/lib/modules';
import { userAccess, vipModules } from '@/lib/server/access';
import { getAuth } from '@/lib/server/auth';
import { getDb } from '@/lib/server/db';

export const metadata: Metadata = {
  title: 'Privacidade — Capital +',
  description: 'Como o Capital + trata os seus dados.',
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
 * The public privacy policy. Reachable without signing in (see PUBLIC_PREFIXES in proxy.ts): it was
 * linked from Google's consent screen while the app had the Gmail monitor, now retired.
 */
export default async function PrivacyPage() {
  const access = await readerAccess();
  const shows = (key: 'banks') => !isModuleHidden(access, key);
  const connections = [shows('banks') && 'com os bancos'].filter(Boolean);

  return (
    <main className="mx-auto flex w-full max-w-2xl flex-col gap-6 px-4 py-10">
      <header className="flex flex-col gap-1">
        <p className="text-primary text-sm font-semibold">Capital +</p>
        <h1 className="text-foreground text-2xl font-bold">Política de privacidade</h1>
        <p className="text-muted text-sm">Última atualização: 28 de outubro de 2026.</p>
      </header>

      <Section title="O que é o Capital +">
        <p>
          O Capital + é um app de orçamento doméstico. Ele roda num servidor próprio, com banco de dados
          próprio: os dados não ficam em serviços de banco na nuvem e não são vendidos nem compartilhados com
          ninguém. Cada conta só enxerga os próprios dados.
        </p>
      </Section>

      <Section title="O que guardamos">
        <ul className="list-disc pl-5">
          <li>Da sua conta: nome, e-mail e a senha em forma cifrada (hash).</li>
          <li>O que você lança: categorias, rendas, gastos, lembretes e os demais módulos que ligar.</li>
          <li>
            Para as notificações: o endereço de inscrição do navegador de cada aparelho em que você as ativar.
          </li>
          <li>Um cookie de sessão, só para manter você conectado.</li>
        </ul>
        <p>
          Quem administra o servidor vê a lista de contas (e-mail, data de criação e último acesso) para
          liberar recursos e proteger o servidor. Os seus lançamentos não aparecem nessa lista.
        </p>
      </Section>

      <Section title="Gmail">
        <p>
          O Capital + não tem mais o Monitor de Gmail e não lê nenhum e-mail. A autorização do Google de
          quem tinha conectado, que ficou guardada cifrada no servidor, não é mais usada. Você pode remover
          o acesso do Capital + na sua Conta Google, em{' '}
          <a
            href="https://myaccount.google.com/connections"
            className="text-primary underline"
            target="_blank"
            rel="noopener noreferrer"
          >
            myaccount.google.com
          </a>
          .
        </p>
      </Section>

      {shows('banks') && (
        <Section title="Open Finance (Meu Pluggy)">
          <p>
            Se você conectar um banco pelo Open Finance, o Capital + lê os seus bancos pelo{' '}
            <a
              href="https://meu.pluggy.ai"
              className="text-primary underline"
              target="_blank"
              rel="noopener noreferrer"
            >
              Meu Pluggy
            </a>
            , um serviço gratuito da Pluggy em que você mesmo conecta os seus bancos pelo Open Finance. O
            Capital + usa a sua própria chave da Pluggy (Client ID e Client Secret), que você cria no dashboard
            da Pluggy e cola no app.
          </p>
          <ul className="list-disc pl-5">
            <li>
              É só leitura: o Capital + não move dinheiro, não paga nada e não altera nada nos seus bancos.
            </li>
            <li>
              Guarda a sua chave (o Client Secret fica cifrado no servidor e nunca é mostrado nem enviado a
              ninguém além da Pluggy), a lista dos bancos que você trouxe, com o nome que você der a cada um,
              as contas e cartões de cada banco, com nome e saldo, os investimentos com nome e saldo, e as
              transações dos últimos 12 meses que os bancos mandam. O saldo fica guardado só para a Reserva e
              só aparece lá, nas contas que você marcar; nenhum saldo, fatura ou limite do banco aparece no
              resto do app. As transações trazem: descrição, valor, data, categoria, forma de pagamento e quem
              pagou ou recebeu (nome e documento, quando o banco informa). Uma vez por hora, o Capital +
              pergunta à Pluggy se chegou algo novo e, se você quiser, avisa no celular quando há algo para
              conferir (o aviso pode ser silencioso). O Capital + usa essas transações só para conferir, mês a
              mês, o que você lançou. Nada vira lançamento sozinho: você confere e lança com um toque; o
              Capital + lembra a categoria que você escolheu para cada descrição, para sugerir de novo.
            </li>
            <li>
              Esses dados não são vendidos, não são usados para publicidade e não são usados para treinar
              modelos de IA.
            </li>
          </ul>
          <p>
            Na engrenagem do Open Finance, &quot;Desconectar tudo&quot; apaga a chave e os bancos do Capital + e
            tira o acesso do Capital + na Pluggy. Os bancos continuam conectados no Meu Pluggy, onde você pode
            removê-los também.
          </p>
        </Section>
      )}

      <Section title="Apagar os seus dados">
        <p>
          Em Configurações (na bandeja de apps, a setinha embaixo da Início), &quot;Apagar todos os
          dados&quot; apaga tudo o que você lançou em todos os módulos
          {connections.length > 0 ? ` (inclusive as conexões ${connections.join(' e ')})` : ''} e mantém a
          conta. &quot;Excluir minha conta&quot;, no mesmo lugar, apaga a conta e todos os dados dela de uma
          vez, depois de você confirmar a senha.
        </p>
      </Section>

      <p className="text-muted text-sm">
        {/* "/" opens the app for a signed-in person and the login for anyone else (see proxy.ts). */}
        <Link href="/" className="text-primary underline">
          Voltar ao Capital +
        </Link>
      </p>
    </main>
  );
}
