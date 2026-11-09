import { describe, expect, it } from 'vitest';
import { amountToInputValue, formatAmountTyping, formatBRL, parseAmountInput, round2 } from '../money';

describe('money utils', () => {
  it('arredonda para 2 casas evitando erro de ponto flutuante', () => {
    expect(round2(0.1 + 0.2)).toBe(0.3);
  });

  it('formata em BRL', () => {
    // Intl.NumberFormat uses a non-breaking space (U+00A0) between "R$" and the amount.
    expect(formatBRL(1234.5)).toBe('R$ 1.234,50');
  });

  it('interpreta valores digitados com vírgula decimal', () => {
    expect(parseAmountInput('1.234,56')).toBe(1234.56);
    expect(parseAmountInput('144,8')).toBe(144.8);
  });

  it('interpreta valores digitados com ponto decimal', () => {
    expect(parseAmountInput('144.80')).toBe(144.8);
  });

  it('converte número para valor editável', () => {
    expect(amountToInputValue(144.8)).toBe('144,80');
  });

  it('digita como app de banco: os números entram pelos centavos', () => {
    expect(formatAmountTyping('1')).toBe('0,01');
    expect(formatAmountTyping('12')).toBe('0,12');
    expect(formatAmountTyping('123')).toBe('1,23');
    expect(formatAmountTyping('123456')).toBe('1.234,56');
    expect(formatAmountTyping('12345678901')).toBe('123.456.789,01');
  });

  it('continua a partir do que já está no campo e ignora o que não é número', () => {
    // O campo mostra "1.234,56" e a pessoa digita mais um 7.
    expect(formatAmountTyping('1.234,567')).toBe('12.345,67');
    // Apagar o último dígito volta uma casa.
    expect(formatAmountTyping('1.234,5')).toBe('123,45');
    expect(formatAmountTyping('0,0')).toBe('');
    expect(formatAmountTyping('R$ 7,00')).toBe('7,00');
    expect(formatAmountTyping('')).toBe('');
  });

  it('o valor digitado volta como número', () => {
    expect(parseAmountInput(formatAmountTyping('123456'))).toBe(1234.56);
  });
});
