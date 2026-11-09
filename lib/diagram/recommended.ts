import type { DiagramQuestion, QuestionType } from './types';

/** A recommended question, before it is copied into someone's account. */
export type RecommendedQuestion = Pick<DiagramQuestion, 'criterion' | 'text'> & { help?: string };

const COMPANY: RecommendedQuestion[] = [
  { criterion: 'Setor perene', text: 'A empresa está num setor perene, que vai continuar existindo?' },
  {
    criterion: 'Lucros',
    text: 'Os lucros são consistentes?',
    help: 'Lucro nos últimos 10 anos. Atenção: 8 de 10, ou todos se abriu capital há 5 a 9 anos. Ruim: lucros inconsistentes ou capital aberto há menos de 5 anos.',
  },
  {
    criterion: 'Dívida/EBITDA',
    text: 'A dívida líquida/EBITDA está saudável?',
    help: 'Até 2 nos últimos 5 anos. Atenção: até 3. Ruim: acima de 3.',
  },
  { criterion: 'Crescimento', text: 'Cresceu mais de 10% ao ano (CAGR de 5 anos)?' },
  { criterion: 'Dividendos', text: 'Paga dividendos de forma consistente?' },
  { criterion: '30 anos', text: 'Está no mercado há mais de 30 anos?' },
  { criterion: 'ROE', text: 'O ROE é maior que 10%?' },
  { criterion: 'Tecnologia', text: 'Investe em tecnologia e pesquisa?' },
  { criterion: 'Blue chip', text: 'É uma blue chip?' },
  { criterion: 'Independente', text: 'É independente (não é estatal)?' },
  { criterion: 'Líder', text: 'É líder no mercado do seu país?' },
  { criterion: 'Governança', text: 'Tem boa governança, sem casos de corrupção?' },
];

const REAL_ESTATE: RecommendedQuestion[] = [
  { criterion: 'Localização', text: 'Os imóveis estão em boa localização?' },
  { criterion: 'Imóveis novos', text: 'Os imóveis são novos ou sem manutenção pesada pela frente?' },
  { criterion: 'P/VP', text: 'O P/VP está abaixo de 1?' },
  { criterion: 'Dividendos', text: 'Paga dividendos de forma consistente há mais de 4 anos?' },
  { criterion: 'Diversificação', text: 'Não depende de um inquilino ou de um imóvel só?' },
  { criterion: 'Yield', text: 'O yield está na média do segmento ou acima?' },
];

/**
 * The lists "Usar as recomendadas" copies into an account, one type at a time (the copy is the
 * person's: editable, with no link to these). Nobody starts with them: every account starts with
 * empty lists. Criptomoedas has none — the person writes their own or uses a direct score.
 */
export const RECOMMENDED_QUESTIONS: Record<QuestionType, RecommendedQuestion[]> = {
  brStocks: [
    {
      criterion: 'Tag along',
      text: 'O tag along é maior que 80%?',
      help: 'Ideal: 100%. Atenção: 80%. Ruim: abaixo de 80%.',
    },
    ...COMPANY,
  ],
  // Tag along is a Brazilian rule.
  intlStocks: COMPANY,
  fiis: REAL_ESTATE,
  reits: REAL_ESTATE,
  crypto: [],
};
