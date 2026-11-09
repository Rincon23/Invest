import { describe, expect, it } from 'vitest';
import { autoAnswer, grahamAnswer, grahamFairValue, pvpAnswer } from '../indicators';

describe('grahamAnswer — a aba Fórmulas da planilha (08/10/2026)', () => {
  // [ticker, LPA, VPA, preço, nota da planilha]
  const rows: [string, number, number, number, 1 | -1][] = [
    ['SAPR3', 0.81, 8.4, 9.96, 1],
    ['SBSP3', 2.48, 12.4, 33.36, -1],
    ['CMIG3', 1.69, 10.09, 18.31, 1],
    ['CPFE3', 5, 21.09, 50.36, 1],
    ['EGIE3', 1.81, 9.6, 31.79, 1],
    ['ITUB3', 4.17, 19.02, 53.5, -1],
    ['BPAC3', 1.51, 6.69, 26.54, 1],
    ['BBDC3', 2.22, 16.97, 18.95, 1],
    ['BBAS3', 2.74, 33.45, 24.26, 1],
    ['BBSE3', 4.74, 6.51, 40.81, -1],
    ['PSSA3', 5.7, 24.03, 53.56, 1],
    ['B3SA3', 0.98, 3.62, 22.77, 1],
    ['ITSA3', 1.51, 8.04, 16.14, 1],
    ['RADL3', 0.74, 4.19, 20.82, 1],
    ['SAUD3', 0.19, 0.49, 15.65, 1],
    ['WEGE3', 1.5, 4.23, 51.77, 1],
    ['TGMA3', 3.61, 13.8, 45.25, -1],
    ['ABEV3', 0.99, 5.72, 16.15, 1],
    ['MDIA3', 2.06, 24.66, 19.86, 1],
    ['SLCE3', 0.65, 10.66, 17.52, 1],
    ['LEVE3', 4.9, 7.9, 37.91, -1],
    ['VIVA3', 2.48, 12.83, 28.9, 1],
    ['EZTC3', 2.02, 18.57, 18.27, 1],
    ['VALE3', 3.51, 43.07, 67.64, 1],
    ['KLBN3', 0.12, 1.45, 3.8, 1],
    ['CMIN3', 0.41, 1.3, 5.06, -1],
    ['TIMS3', 0.84, 5.03, 18.89, 1],
    ['PETR3', 8.35, 34.54, 61.93, 1],
  ];

  it.each(rows)('%s dá a mesma nota da planilha', (_ticker, lpa, vpa, price, expected) => {
    expect(grahamAnswer(price, lpa, vpa)?.answer).toBe(expected);
  });

  it('calcula o preço justo √(22,5 × LPA × VPA)', () => {
    expect(grahamFairValue(0.81, 8.4)).toBeCloseTo(12.373, 3);
    expect(grahamAnswer(51.77, 1.5, 4.23)?.verdict).toBe('notApplicable');
    expect(grahamAnswer(45.25, 3.61, 13.8)?.verdict).toBe('expensive');
  });

  it('dá Não com prejuízo ou patrimônio negativo, e nada sem dados', () => {
    expect(grahamAnswer(10, -0.5, 8)).toMatchObject({ verdict: 'negative', answer: -1, fairValue: null });
    expect(grahamAnswer(null, 1, 1)).toBeNull();
    expect(grahamAnswer(10, null, 1)).toBeNull();
  });
});

describe('pvpAnswer', () => {
  it('é Sim abaixo de 1 e Não de 1 para cima', () => {
    expect(pvpAnswer(0.88)).toBe(1);
    expect(pvpAnswer(1)).toBe(-1);
    expect(pvpAnswer(1.12)).toBe(-1);
    expect(pvpAnswer(null)).toBeNull();
  });

  it('responde pela pergunta automática certa', () => {
    const indicators = { lpa: 1.5, vpa: 4.23, pvp: 0.95, fetchedAt: '2026-10-10T12:00:00Z' };
    expect(autoAnswer('pvp', indicators, null)).toBe(1);
    expect(autoAnswer('graham', indicators, 51.77)).toBe(1);
    expect(autoAnswer('graham', undefined, 51.77)).toBeNull();
  });
});
