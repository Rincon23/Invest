/** One entry in the changelog notified through the bell (see `lib/server/announcements.ts`). */
export interface FeatureAnnouncement {
  /** Stable id, never reused or renamed once shipped: becomes the notification's `sourceKey`. */
  key: string;
  title: string;
  body: string;
  href?: string;
  /**
   * When this shipped (ISO instant). Only accounts created before it are notified — a brand-new
   * account starts already caught up, since everything in the app is new to it anyway.
   */
  publishedAt: string;
}

/**
 * Every user-visible feature Capital has announced through the bell, oldest first. Whenever a
 * new module, screen or button ships that existing users should hear about, add an entry here —
 * `lib/server/announcements.ts` notifies every account created before `publishedAt`; anyone who
 * signs up afterwards never sees it, because their app was already born with it.
 */
export const FEATURE_ANNOUNCEMENTS: FeatureAnnouncement[] = [
  {
    key: 'notification-center',
    title: '🔔 Central de notificações',
    body: 'Agora o Capital + guarda um histórico de tudo que já te avisou. Toque no sino para ver.',
    href: '/notificacoes',
    publishedAt: '2026-09-18T12:00:00Z',
  },
  {
    key: 'cards-module',
    title: '💳 Módulo Cartões',
    body: 'Cadastre seus cartões, veja quando cada fatura vence e marque como paga — o Capital + avisa antes do vencimento.',
    href: '/carteira/cartoes',
    publishedAt: '2026-09-19T12:00:00Z',
  },
  {
    key: 'card-single-module',
    title: '💳 Cartão agora é um módulo só',
    body: 'Fatura, cartões e parcelados ficam juntos em Cartão. E ao lançar um gasto no cartão dá para parcelar na hora, escolhendo se o gasto conta todo no mês da compra ou parcela a parcela.',
    href: '/cartao',
    publishedAt: '2026-09-19T21:00:00Z',
  },
  {
    key: 'home-widgets-calendar-filter',
    title: '✨ Início do seu jeito',
    body: 'Em Organizar Início (o lápis) dá para tirar e adicionar widgets — e Lembretes ganhou um calendário dos próximos 30 dias. Em Lançamentos, o botão Filtrar mostra só a categoria que você quiser.',
    href: '/',
    publishedAt: '2026-10-06T06:00:00Z',
  },
  {
    key: 'home-screen-pages',
    title: '📱 A Início virou a tela do celular',
    body: 'O rodapé saiu: a Início agora tem telas com widgets — deslize para o lado para trocar de tela e puxe a setinha de baixo para ver todos os apps. No lápis você cria áreas, leva widgets de uma para outra e põe ou tira widgets pela bandeja.',
    href: '/',
    publishedAt: '2026-10-06T21:00:00Z',
  },
  {
    key: 'contas-do-mes',
    title: '🧾 Contas do mês',
    body: 'Os gastos recorrentes viraram Contas do mês: veja o que falta lançar, ponha o dia do vencimento e receba um aviso com o botão Lançar. E as duas reservas agora são um módulo só, Reserva.',
    href: '/carteira/recorrentes',
    publishedAt: '2026-10-19T04:00:00Z',
  },
  {
    key: 'missions',
    title: '🌱 Missões',
    body: 'Tarefas que dão XP e fazem a sua árvore crescer. E agora todo módulo já vem pronto.',
    href: '/missoes',
    publishedAt: '2026-10-26T15:00:00Z',
  },
  {
    key: 'investing-facts',
    title: '💡 Você sabia?',
    body: 'Agora as Missões trazem um fato real sobre investimentos por dia, com a fonte, e toda segunda chega uma frase no celular. Dá para desligar nas notificações.',
    href: '/',
    publishedAt: '2026-10-30T15:00:00Z',
  },
];
