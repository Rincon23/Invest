import type { BankAccountKind } from './types';

/**
 * Pluggy never says which bank a Meu Pluggy connection is (the connector is always "MeuPluggy"),
 * so the Capital suggests a name from the accounts and the person can change it.
 */

/** Bank codes (COMPE) of the banks people use most; the code starts an account's transfer number. */
const BANKS_BY_CODE: Record<string, string> = {
  '001': 'Banco do Brasil',
  '004': 'Banco do Nordeste',
  '033': 'Santander',
  '041': 'Banrisul',
  '070': 'BRB',
  '077': 'Inter',
  '102': 'XP',
  '104': 'Caixa',
  '197': 'Stone',
  '208': 'BTG Pactual',
  '212': 'Banco Original',
  '237': 'Bradesco',
  '260': 'Nubank',
  '290': 'PagBank',
  '323': 'Mercado Pago',
  '336': 'C6 Bank',
  '341': 'Itaú',
  '380': 'PicPay',
  '403': 'Cora',
  '422': 'Safra',
  '748': 'Sicredi',
  '756': 'Sicoob',
};

/** An account as Pluggy sends it, only the parts that name it. */
export interface PluggyAccountName {
  type?: string | null;
  subtype?: string | null;
  name?: string | null;
  marketingName?: string | null;
  transferNumber?: string | null;
}

export function accountKind(subtype: string | null | undefined): BankAccountKind {
  switch (subtype) {
    case 'CHECKING_ACCOUNT':
      return 'checking';
    case 'SAVINGS_ACCOUNT':
      return 'savings';
    case 'CREDIT_CARD':
      return 'card';
    default:
      return 'other';
  }
}

const INVESTMENT_LABELS: Record<string, string> = {
  CDB: 'CDB',
  LCI: 'LCI',
  LCA: 'LCA',
  LC: 'LC',
  TREASURY: 'Tesouro',
  CRI: 'CRI',
  CRA: 'CRA',
  CORPORATE_DEBT: 'debênture',
  DEBENTURES: 'debênture',
  STOCK: 'ação',
  REAL_ESTATE_FUND: 'FII',
  ETF: 'ETF',
  BDR: 'BDR',
  INVESTMENT_FUND: 'fundo',
  MULTIMARKET_FUND: 'fundo multimercado',
  FIXED_INCOME_FUND: 'fundo de renda fixa',
  STOCK_FUND: 'fundo de ações',
  RETIREMENT: 'previdência',
};

/** How an investment shows up: its kind in plain words ("CDB", "Tesouro", "ação"). */
export function investmentLabel(type: string | null | undefined, subtype: string | null | undefined): string {
  if (subtype && INVESTMENT_LABELS[subtype]) return INVESTMENT_LABELS[subtype];
  if (type === 'FIXED_INCOME') return 'renda fixa';
  if (type === 'EQUITY') return 'renda variável';
  if (type === 'MUTUAL_FUND') return 'fundo';
  return 'investimento';
}

/** Fixed income is what a reserve usually is; stocks and funds can be marked too, one tap further. */
export function isUsualReserve(type: string | null | undefined): boolean {
  return type === 'FIXED_INCOME';
}

/** "208/0001/1234567-8" → "BTG Pactual"; null when the code is not a known bank. */
export function bankFromTransferNumber(transferNumber: string | null | undefined): string | null {
  const code = /^\s*(\d{3})\s*\//.exec(transferNumber ?? '')?.[1];
  return code ? (BANKS_BY_CODE[code] ?? null) : null;
}

/** "AMAZON MASTERCARD PLATINUM" → "Amazon Mastercard Platinum"; mixed case stays as the bank wrote it. */
export function tidyName(name: string): string {
  const trimmed = name.replace(/\s+/g, ' ').trim();
  if (trimmed !== trimmed.toUpperCase() || !/[A-ZÀ-Ú]/.test(trimmed)) return trimmed;
  return trimmed.toLowerCase().replace(/(^|\s)(\p{L})/gu, (_, space: string, letter: string) => space + letter.toUpperCase());
}

/** A company's legal name ("Nu Pagamentos S.A. - Instituição de Pagamento"), not an account's. */
const LEGAL_NAME = /\bS\.?\s?A\.?(\s|$|-)|\bLtda\b|Institui[cç][aã]o de Pagamento/i;

/**
 * How an account shows up in the Capital: its own name; "Conta Nubank" when the bank sent its legal
 * name instead; and "Cartão …" for a card that doesn't say so.
 */
export function accountDisplayName(account: PluggyAccountName): string {
  const name = tidyName(account.name || account.marketingName || '');
  if (accountKind(account.subtype) === 'card') {
    if (!name) return 'Cartão';
    return /cart[aã]o/i.test(name) ? name : `Cartão ${name.charAt(0).toUpperCase()}${name.slice(1)}`;
  }
  if (LEGAL_NAME.test(name)) {
    const bank = bankFromTransferNumber(account.transferNumber);
    return bank ? `Conta ${bank}` : name.split(' - ')[0];
  }
  return name || 'Conta';
}

/**
 * The name the Capital suggests for a connection: the bank of an account's transfer number, else
 * the first account's own name (without the legal tail, "Nu Pagamentos S.A. - Instituição…"),
 * else the first card's.
 */
export function suggestBankName(accounts: PluggyAccountName[]): string {
  for (const account of accounts) {
    const bank = bankFromTransferNumber(account.transferNumber);
    if (bank) return bank;
  }
  const banking = accounts.find((account) => accountKind(account.subtype) !== 'card' && account.name);
  if (banking?.name) return tidyName(banking.name.split(' - ')[0]);
  const card = accounts.find((account) => account.name);
  return card ? accountDisplayName(card) : 'Banco';
}
