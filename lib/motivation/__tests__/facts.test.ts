import { describe, expect, it } from 'vitest';
import { DEFAULT_FACTS, FACT_LIMITS, factOfDay, factOfWeek, savedAmount } from '../facts';

const plain = (text: string) => text.replace(/ /g, ' ');
const texts = DEFAULT_FACTS.map((fact) => plain(fact.text));

describe('savedAmount', () => {
  it('soma os depósitos mensais com juros compostos', () => {
    expect(Math.round(savedAmount(300, 20))).toBe(136_032);
    expect(Math.round(savedAmount(100, 30))).toBe(97_451);
    expect(Math.round(savedAmount(500, 30))).toBe(487_256);
    expect(Math.round(savedAmount(1000, 25))).toBe(676_289);
    expect(Math.round(savedAmount(50, 40))).toBe(95_384);
  });

  it('com rendimento quase zero, devolve só o que saiu do bolso', () => {
    expect(savedAmount(300, 20, 1e-6)).toBeCloseTo(72_000, -1);
  });
});

describe('as frases de partida', () => {
  it('escrevem os números que a conta dá', () => {
    expect(texts).toContain(
      'Sabia que R$ 300 por mês, a 6% ao ano acima da inflação, podem virar R$ 136 mil em 20 anos?',
    );
    expect(texts).toContain(
      'Sabia que R$ 1.000 por mês, a 6% ao ano acima da inflação, podem virar R$ 676 mil em 25 anos?',
    );
    expect(texts).toContain(
      'Sabia que, guardando por 30 anos a 6% ao ano acima da inflação, 63% do total pode vir dos rendimentos, e não do seu bolso?',
    );
    expect(texts.some((text) => text.includes('R$ 227 mil em 20 anos ou R$ 487 mil em 30'))).toBe(true);
    expect(texts.some((text) => text.includes('cerca de R$ 109 mil'))).toBe(true);
  });

  it('toda simulação diz a taxa e que não é promessa', () => {
    const simulations = DEFAULT_FACTS.filter((fact) => plain(fact.text).includes('podem virar'));
    expect(simulations.length).toBeGreaterThan(0);
    for (const fact of simulations) {
      expect(fact.text).toContain('acima da inflação');
      expect(fact.detail).toContain('não uma promessa');
    }
  });

  it('nenhuma se repete, e todas têm explicação e fonte', () => {
    expect(new Set(texts).size).toBe(texts.length);
    expect(new Set(DEFAULT_FACTS.map((fact) => fact.id)).size).toBe(DEFAULT_FACTS.length);
    for (const fact of DEFAULT_FACTS) {
      expect(fact.detail.length).toBeGreaterThan(0);
      expect(fact.sourceLabel.length).toBeGreaterThan(0);
      if (fact.sourceUrl) expect(fact.sourceUrl).toMatch(/^https:\/\//);
    }
  });

  it('cabem nos limites que a Administração usa', () => {
    for (const fact of DEFAULT_FACTS) {
      expect(fact.text.length, fact.text).toBeLessThanOrEqual(150);
      expect(fact.detail.length, fact.detail).toBeLessThanOrEqual(FACT_LIMITS.detail);
      expect(fact.sourceLabel.length, fact.sourceLabel).toBeLessThanOrEqual(FACT_LIMITS.sourceLabel);
      expect((fact.sourceUrl ?? '').length, fact.text).toBeLessThanOrEqual(FACT_LIMITS.sourceUrl);
    }
  });
});

describe('qual frase aparece', () => {
  it('muda todo dia, a mesma para todo mundo, e dá a volta', () => {
    const today = DEFAULT_FACTS.indexOf(factOfDay(DEFAULT_FACTS, '2026-11-02'));
    expect(DEFAULT_FACTS.indexOf(factOfDay(DEFAULT_FACTS, '2026-11-03'))).toBe((today + 1) % DEFAULT_FACTS.length);
    const lap = new Date(Date.UTC(2026, 10, 2 + DEFAULT_FACTS.length)).toISOString().slice(0, 10);
    expect(factOfDay(DEFAULT_FACTS, lap)).toBe(DEFAULT_FACTS[today]);
  });

  it('muda toda semana e é a mesma dentro da semana', () => {
    const monday = DEFAULT_FACTS.indexOf(factOfWeek(DEFAULT_FACTS, '2026-11-02'));
    expect(factOfWeek(DEFAULT_FACTS, '2026-11-02')).toBe(factOfWeek(DEFAULT_FACTS, '2026-11-04'));
    expect(DEFAULT_FACTS.indexOf(factOfWeek(DEFAULT_FACTS, '2026-11-09'))).toBe((monday + 1) % DEFAULT_FACTS.length);
  });

  it('nas segundas passa por todas, mesmo com um múltiplo de 7 frases', () => {
    const facts = DEFAULT_FACTS.slice(0, 14);
    const mondays = Array.from({ length: 14 }, (_, week) =>
      factOfWeek(facts, new Date(Date.UTC(2026, 10, 2 + week * 7)).toISOString().slice(0, 10)),
    );
    expect(new Set(mondays).size).toBe(14);
  });
});
