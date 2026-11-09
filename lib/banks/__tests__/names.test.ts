import { describe, expect, it } from 'vitest';
import { accountDisplayName, bankFromTransferNumber, formatAgo, suggestBankName } from '..';

describe('the name the Capital suggests for a bank', () => {
  it('comes from the bank code of an account', () => {
    expect(bankFromTransferNumber('208/0001/1234567-8')).toBe('BTG Pactual');
    expect(bankFromTransferNumber('260/0001/9-1')).toBe('Nubank');
    expect(bankFromTransferNumber('999/0001/1')).toBeNull();
    expect(
      suggestBankName([
        { subtype: 'CREDIT_CARD', name: 'Cartão BTG GOLD' },
        { subtype: 'CHECKING_ACCOUNT', name: 'BTG Banking', transferNumber: '208/0001/1234567-8' },
      ]),
    ).toBe('BTG Pactual');
  });

  it("falls back to the account's own name, without the legal tail, then to the card's", () => {
    expect(
      suggestBankName([{ subtype: 'CHECKING_ACCOUNT', name: 'Nu Pagamentos S.A. - Instituição de Pagamento' }]),
    ).toBe('Nu Pagamentos S.A.');
    expect(suggestBankName([{ subtype: 'CREDIT_CARD', name: 'AMAZON MASTERCARD PLATINUM' }])).toBe(
      'Cartão Amazon Mastercard Platinum',
    );
    expect(suggestBankName([])).toBe('Banco');
  });

  it('names cards as cards, keeping how the bank wrote mixed-case names', () => {
    expect(accountDisplayName({ subtype: 'CREDIT_CARD', name: 'gold' })).toBe('Cartão Gold');
    expect(accountDisplayName({ subtype: 'CREDIT_CARD', name: 'Cartão BTG GOLD' })).toBe('Cartão BTG GOLD');
    expect(accountDisplayName({ subtype: 'CHECKING_ACCOUNT', name: 'BTG Investimentos' })).toBe('BTG Investimentos');
    expect(accountDisplayName({ subtype: 'SAVINGS_ACCOUNT', name: null })).toBe('Conta');
    // A legal name is not an account's name.
    expect(
      accountDisplayName({
        subtype: 'CHECKING_ACCOUNT',
        name: 'Nu Pagamentos S.A. - Instituição de Pagamento',
        transferNumber: '260/0001/9-1',
      }),
    ).toBe('Conta Nubank');
    expect(
      accountDisplayName({ subtype: 'CHECKING_ACCOUNT', name: 'Banco Qualquer S.A. - Instituição de Pagamento' }),
    ).toBe('Banco Qualquer S.A.');
  });
});

describe('formatAgo', () => {
  const now = new Date('2026-10-20T15:00:00Z').getTime();
  it('says how long ago, never "agora"', () => {
    expect(formatAgo('2026-10-20T14:59:40Z', now)).toBe('há menos de 1 min');
    expect(formatAgo('2026-10-20T14:35:00Z', now)).toBe('há 25 min');
    expect(formatAgo('2026-10-20T10:00:00Z', now)).toBe('há 5 h');
    expect(formatAgo('2026-10-19T10:00:00Z', now)).toBe('ontem');
    expect(formatAgo('2026-10-16T10:00:00Z', now)).toBe('há 4 dias');
  });
});
