import { round2 } from './money';
import type { Month } from './types';

/**
 * O plano da reserva: como sair de um rombo, um mês de cada vez.
 *
 * Um imprevisto grande — R$ 5.000 de saúde para quem ganha R$ 3.000 — não cabe no mês em que
 * acontece: sai da reserva de emergência, e é a reserva que fica no vermelho. Recompor isso não é
 * investir (investir é outra coisa, com objetivo de longo prazo) e nem cabe num gasto único: é um
 * **plano**, um valor por mês, lançado como imprevisto, até a reserva voltar ao lugar.
 *
 * O plano guarda só o que a pessoa decidiu — quanto e em quantos meses. Quanto já voltou, quanto
 * falta e quantos meses restam são sempre calculados a partir do que ela lançou, então pular um
 * mês não quebra nada: o plano simplesmente demora mais.
 */

/** O que a pessoa decidiu recompor, e em quanto tempo. */
export interface ReservePlan {
  /** Quanto tem de voltar para a reserva, no total. */
  targetAmount: number;
  /** Em quantos meses ela pretende fazer isso. */
  months: number;
  /** A competência em que o plano começou. */
  startMonth: Month;
  /** O que abriu o buraco, nas palavras dela ("Cirurgia do cachorro"). */
  reason?: string;
}

/** Uma parcela do plano que já foi lançada. */
export interface ReserveContribution {
  id: string;
  /** A competência em que o gasto entrou. */
  month: Month;
  amount: number;
  /** O dia do lançamento. */
  date: string;
}

/** O plano com tudo o que a tela precisa mostrar, calculado a partir do que já foi lançado. */
export interface ReservePlanSummary {
  plan: ReservePlan;
  /** Tudo o que já voltou para a reserva por este plano. */
  contributed: number;
  /** Quanto ainda falta (nunca negativo). */
  remaining: number;
  /** Quanto vale um mês do plano. */
  monthly: number;
  /** Quanto já foi lançado na competência que está na tela. */
  contributedThisMonth: number;
  /** Quantos meses ainda faltam **neste ritmo** — pular um mês adia, não quebra. */
  monthsLeft: number;
  /** Quanto do plano já foi cumprido, de 0 a 1. */
  progress: number;
  /** O plano acabou: a reserva já recebeu tudo o que tinha de receber. */
  done: boolean;
}

/** Um centavo de folga, para um plano quitado não ficar faltando R$ 0,004. */
const EPSILON = 0.005;

/** Quanto vale uma parcela do plano. */
export function reserveMonthlyAmount(plan: Pick<ReservePlan, 'targetAmount' | 'months'>): number {
  if (!(plan.months > 0)) return 0;
  return round2(plan.targetAmount / plan.months);
}

export function summarizeReservePlan(
  plan: ReservePlan,
  contributions: ReserveContribution[],
  month: Month,
): ReservePlanSummary {
  const contributed = round2(contributions.reduce((total, item) => total + item.amount, 0));
  const remaining = round2(Math.max(0, plan.targetAmount - contributed));
  const monthly = reserveMonthlyAmount(plan);
  const contributedThisMonth = round2(
    contributions.filter((item) => item.month === month).reduce((total, item) => total + item.amount, 0),
  );

  return {
    plan,
    contributed,
    remaining,
    monthly,
    contributedThisMonth,
    monthsLeft: monthly > 0 ? Math.max(0, Math.ceil((remaining - EPSILON) / monthly)) : 0,
    progress: plan.targetAmount > 0 ? Math.min(1, contributed / plan.targetAmount) : 0,
    done: remaining <= EPSILON,
  };
}

/** Por que um plano não pode ser salvo, ou null quando pode. */
export function reservePlanProblem(plan: Pick<ReservePlan, 'targetAmount' | 'months'>): string | null {
  if (!(plan.targetAmount > 0)) return 'O valor a recompor deve ser maior que zero.';
  if (!Number.isInteger(plan.months) || plan.months < 1 || plan.months > 120) {
    return 'O plano vai de 1 a 120 meses.';
  }
  return null;
}

/** A descrição que todo lançamento do plano leva, para ser reconhecível nos meses. */
export const RESERVE_CONTRIBUTION_LABEL = 'Recompor a reserva';

/** O que a tela diz antes de a pessoa montar um plano, e o porquê da categoria. */
export const RESERVE_PLAN_EXPLANATION =
  'Um imprevisto grande sai da reserva. Recompor é devolver aos poucos: uma parcela por mês, como imprevisto. Não é investimento: é fechar um buraco.';

/**
 * Por que o plano não mexe no saldo da reserva. Onde o dinheiro recomposto fica — na conta ou
 * comprando cotas — é decisão da pessoa e não muda em nada o que o plano acompanha, que é o
 * compromisso do mês. Os valores da reserva continuam vindo de onde sempre vieram: a reserva em
 * conta que ela informa e as cotas que ela compra.
 */
export const RESERVE_CONTRIBUTION_NOTE =
  'O plano acompanha o que você já devolveu. Onde o dinheiro fica, você diz.';
