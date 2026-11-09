/**
 * "Você sabia?": true and encouraging facts about investing, one a day on the Missões bar and in the
 * app drawer, one a week on the phone (`lib/server/motivation.ts`). The same for everyone.
 *
 * They live in the database, where the owner edits them in Administração; `DEFAULT_FACTS` is what it
 * starts with. Nothing here may be made up or promise a result: a simulation is calculated by
 * `savedAmount`, not typed, and says the rate it uses; anything else comes from a source a person
 * can open. A dated figure says its date, so it stays true when it gets old. Checked on 2026-10-30.
 */

export interface InvestingFact {
  id: string;
  /** The phrase: short, it sits on the Missões bar and in a notification. */
  text: string;
  /** What the phrase leaves out: how it was worked out and its limits. */
  detail: string;
  sourceLabel: string;
  sourceUrl: string | null;
}

/** What Administração writes. */
export type FactInput = Omit<InvestingFact, 'id'>;

export const FACT_LIMITS = { text: 200, detail: 500, sourceLabel: 120, sourceUrl: 500 };

/** A real return (above inflation) a bit below what the Tesouro IPCA+ paid on 2026-10-22, 6,63%. */
const REAL_RATE = 0.06;

/** What `monthly`, saved at the end of every month, adds up to after `years`, in today's money. */
export function savedAmount(monthly: number, years: number, annualRate: number = REAL_RATE): number {
  const monthlyRate = (1 + annualRate) ** (1 / 12) - 1;
  return (monthly * ((1 + annualRate) ** years - 1)) / monthlyRate;
}

const brl = (value: number) => `R$ ${value.toLocaleString('pt-BR')}`;
const thousands = (value: number) => `${brl(Math.round(value / 1000))} mil`;

const RATE_TEXT = `a ${REAL_RATE * 100}% ao ano acima da inflação`;
const NOT_A_PROMISE =
  'É uma simulação, não uma promessa: em dinheiro de hoje, com os depósitos corrigidos pela inflação, antes de impostos e taxas.';
const PAST_NOTE = 'O passado não garante o futuro.';

const IPCA_PLUS_SOURCE = {
  sourceLabel: 'InvestNews, taxas do Tesouro Direto em 22/10/2026',
  sourceUrl: 'https://investnews.com.br/investimentos/tesouro-direto-taxas-rendimento-hoje-prefixados-sobem-22102026/amp/',
};
const SIMULATION_SOURCE = {
  ...IPCA_PLUS_SOURCE,
  sourceLabel: 'Conta de juros compostos, com a taxa do Tesouro IPCA+ em 22/10/2026 (InvestNews)',
};
const CENTRAL_BANK_SOURCE = {
  sourceLabel: 'Banco Central, séries 4391 (CDI) e 433 (IPCA)',
  sourceUrl: 'https://www3.bcb.gov.br/sgspub/',
};

function simulation(monthly: number, years: number): FactInput {
  return {
    text: `Sabia que ${brl(monthly)} por mês, ${RATE_TEXT}, podem virar ${thousands(savedAmount(monthly, years))} em ${years} anos?`,
    detail: `Do seu bolso saem ${thousands(monthly * 12 * years)}. ${NOT_A_PROMISE}`,
    ...SIMULATION_SOURCE,
  };
}

const FACTS: FactInput[] = [
  simulation(300, 20),
  {
    text: `Sabia que ${brl(1000)} no CDI em julho de 1994 viraram cerca de ${thousands(108_652)}? A inflação levou ${brl(1000)} a ${thousands(8977)}.`,
    detail: `De julho de 1994 a setembro de 2026, antes de impostos. ${PAST_NOTE}`,
    ...CENTRAL_BANK_SOURCE,
  },
  simulation(100, 30),
  {
    text: 'Sabia que, desde 1900, nenhum período de 20 anos da bolsa americana (S&P 500) terminou no negativo?',
    detail: `São 106 períodos, de 1900–1919 a 2005–2024, com dividendos e antes da inflação. ${PAST_NOTE}`,
    sourceLabel: 'Crestmont Research, via Motley Fool',
    sourceUrl: 'https://www.fool.com/investing/2025/02/18/investment-strategy-foolproof-1900-wall-street',
  },
  {
    text: `Sabia que, guardando por 30 anos ${RATE_TEXT}, ${Math.round((1 - (12 * 30) / savedAmount(1, 30)) * 100)}% do total pode vir dos rendimentos, e não do seu bolso?`,
    detail: NOT_A_PROMISE,
    ...SIMULATION_SOURCE,
  },
  {
    text: 'Sabia que o Tesouro Direto tinha mais de 3,8 milhões de investidores ativos em agosto de 2026, 21,7% a mais em um ano?',
    detail: 'São 3.832.453 investidores ativos, segundo o balanço mensal do Tesouro Nacional.',
    sourceLabel: 'Balanço do Tesouro Direto, agosto de 2026',
    sourceUrl: 'https://static.poder360.com.br/uploads/2026/09/Balanco-TD-Ago-2026.pdf',
  },
  simulation(500, 30),
  {
    text: 'Sabia que cerca de 95% da fortuna de Warren Buffett veio depois dos 65 anos?',
    detail: 'Estimativa da Barron’s, de 2025. Mostra o peso de deixar o dinheiro render por muito tempo.',
    sourceLabel: 'Barron’s, via Entrepreneur',
    sourceUrl: 'https://www.entrepreneur.com/business-news/warren-buffetts-wealth-grew-after-he-turned-65-years-old/495874',
  },
  {
    text: `Sabia que 10 anos a mais fazem diferença? ${brl(500)} por mês, ${RATE_TEXT}, podem virar ${thousands(savedAmount(500, 20))} em 20 anos ou ${thousands(savedAmount(500, 30))} em 30.`,
    detail: NOT_A_PROMISE,
    ...SIMULATION_SOURCE,
  },
  {
    text: `Sabia que o FGC garante até ${thousands(250_000)} por CPF em cada instituição, em CDB, LCI, LCA e poupança?`,
    detail: `O limite vale por conglomerado financeiro, com teto de ${brl(1)} milhão a cada quatro anos.`,
    sourceLabel: 'Fundo Garantidor de Créditos',
    sourceUrl: 'https://www.fgc.org.br/sobre-garantia-fgc',
  },
  simulation(1000, 25),
  {
    text: 'Sabia que, desde 1994, todo período de 20 anos no CDI ao menos dobrou o poder de compra?',
    detail: `São 148 períodos até setembro de 2026, antes de impostos. O pior multiplicou o poder de compra por 2,3. ${PAST_NOTE}`,
    ...CENTRAL_BANK_SOURCE,
  },
  {
    text: 'Sabia que dá para estimar em quanto tempo o dinheiro dobra? Divida 72 pela taxa anual: a 6%, são 12 anos.',
    detail: 'É a “regra dos 72”, uma aproximação. A conta exata a 6% dá 11,9 anos.',
    sourceLabel: 'Conta de juros compostos',
    sourceUrl: null,
  },
  {
    text: 'Sabia que o dinheiro no Tesouro Selic pode ser sacado a qualquer momento? Guardar não é travar.',
    detail: 'Antes do vencimento, vale o preço de mercado do dia.',
    sourceLabel: 'Tesouro Direto',
    sourceUrl: 'https://www.tesourodireto.com.br/produtos/titulos/selic',
  },
  simulation(50, 40),
  {
    text: 'Sabia que os fundos imobiliários bateram recorde em março de 2026, com 3,13 milhões de investidores na B3?',
    detail: 'Recorde da série histórica da B3, noticiado em maio de 2026.',
    sourceLabel: 'Suno Notícias, com dados da B3',
    sourceUrl: 'https://www.suno.com.br/noticias/fundos-imobiliarios-recorde-b3-marco-2026/amp/',
  },
  {
    text: 'Sabia que, desde o Plano Real, o CDI rendeu em média 8% ao ano acima da inflação?',
    detail: `De julho de 1994 a setembro de 2026, antes de impostos. ${PAST_NOTE}`,
    ...CENTRAL_BANK_SOURCE,
  },
  {
    text: 'Sabia que, em outubro de 2026, o Tesouro IPCA+ 2050 pagava 6,63% ao ano acima da inflação?',
    detail: 'Taxa de compra em 22/10/2026, para quem fica até o vencimento. Ela muda todos os dias.',
    ...IPCA_PLUS_SOURCE,
  },
];

/** What the database starts with. In a row they alternate: one simulation never follows another. */
export const DEFAULT_FACTS: InvestingFact[] = FACTS.map((fact, index) => ({ id: `fato-${index + 1}`, ...fact }));

const dayNumber = (date: string) => Math.floor(Date.parse(`${date}T12:00:00Z`) / (24 * 60 * 60 * 1000));

/** The fact of the day `date` (YYYY-MM-DD): the next one every day, the same for everyone. */
export function factOfDay(facts: InvestingFact[], date: string): InvestingFact {
  return facts[dayNumber(date) % facts.length];
}

/** The fact of the week `date` is in: it goes through all of them, however many there are. */
export function factOfWeek(facts: InvestingFact[], date: string): InvestingFact {
  return facts[Math.floor(dayNumber(date) / 7) % facts.length];
}
