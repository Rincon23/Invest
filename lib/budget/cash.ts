import { round2, sum } from './money';
import type { CashSettings, Month } from './types';

/**
 * The cash report (bot spec §4.10): how much reserve there is, how much the card and the
 * instalment plans owe, and how far that is from the reserve I want to have.
 *
 * ```
 * valorTotalReserva = reservaConta + reserva investida livre
 * dividaTotal       = dividaCartao + dividaParcelado           (ambas negativas)
 * reservaPrevista   = custoMensalDesempregado × multiplicador
 * gapReserva        = valorTotalReserva + dividaTotal − reservaPrevista
 * ```
 */

export interface CashReportInput {
  settings: CashSettings;
  /** Value of the free (not earmarked) part of the invested reserve. */
  investedReserve: number;
  /** Card bill of the open month, as a negative number. */
  cardDebt: number;
  /** What the instalment plans still owe, as a negative number. */
  installmentDebt: number;
  /** Which competence the card bill came from, so the screen can say it. */
  cardMonth: Month;
}

export interface CashReport {
  reserveAccount: number;
  investedReserve: number;
  totalReserve: number;
  cardDebt: number;
  cardMonth: Month;
  installmentDebt: number;
  totalDebt: number;
  /** Monthly cost of the "no income" scenario. */
  monthlyCost: number;
  multiplier: number;
  expectedReserve: number;
  /** Positive: the reserve is already there. Negative: this much is missing. */
  gap: number;
}

export const DEFAULT_RESERVE_MULTIPLIER = 6;

export function createDefaultCashSettings(): CashSettings {
  return {
    reserveAccountAmount: 0,
    emergencyCosts: [],
    reserveMultiplier: DEFAULT_RESERVE_MULTIPLIER,
  };
}

export function monthlyEmergencyCost(settings: Pick<CashSettings, 'emergencyCosts'>): number {
  return sum(settings.emergencyCosts.map((cost) => cost.amount));
}

export function computeCashReport(input: CashReportInput): CashReport {
  const { settings } = input;
  const reserveAccount = round2(settings.reserveAccountAmount);
  const investedReserve = round2(input.investedReserve);
  const totalReserve = round2(reserveAccount + investedReserve);
  const cardDebt = round2(input.cardDebt);
  const installmentDebt = round2(input.installmentDebt);
  const totalDebt = round2(cardDebt + installmentDebt);
  const monthlyCost = monthlyEmergencyCost(settings);
  const multiplier = settings.reserveMultiplier || DEFAULT_RESERVE_MULTIPLIER;
  const expectedReserve = round2(monthlyCost * multiplier);

  return {
    reserveAccount,
    investedReserve,
    totalReserve,
    cardDebt,
    cardMonth: input.cardMonth,
    installmentDebt,
    totalDebt,
    monthlyCost,
    multiplier,
    expectedReserve,
    gap: round2(totalReserve + totalDebt - expectedReserve),
  };
}
