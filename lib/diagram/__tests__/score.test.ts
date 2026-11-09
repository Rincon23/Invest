import { describe, expect, it } from 'vitest';
import { normalizeAssetTicker, looksLikeEtf } from '../tickers';
import { assetScore, formatScore, questionsScore } from '../score';
import type { DiagramQuestion } from '../types';

function questions(count: number, weight = 1): DiagramQuestion[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `q${index}`,
    type: 'brStocks' as const,
    criterion: `C${index}`,
    text: `Pergunta ${index}?`,
    weight,
    position: index,
  }));
}

describe('questionsScore', () => {
  it('keeps an unanswered question in the denominator (BPAC3: 13 Sim out of 14 is 0,93)', () => {
    const list = questions(14);
    const answers = Object.fromEntries(list.slice(0, 13).map((q) => [q.id, 1 as const]));
    const score = questionsScore(list, answers);
    expect(score.score).toBeCloseTo(13 / 14, 9);
    expect(score).toMatchObject({ positive: 13, negative: 0, unanswered: 1 });
    expect(formatScore(score.score)).toBe('9,3');
  });

  it('weighs each answer by its question, and a weight of 0 turns a question off', () => {
    const list = [...questions(2), { ...questions(1)[0], id: 'heavy', weight: 2 }, { ...questions(1)[0], id: 'off', weight: 0 }];
    const score = questionsScore(list, { q0: 1, q1: -1, heavy: -1, off: 1 });
    // (1 − 1 − 2) / (1 + 1 + 2)
    expect(score.score).toBeCloseTo(-0.5, 9);
    expect(score).toMatchObject({ positive: 1, negative: 3 });
    expect(formatScore(score.score)).toBe('−5');
  });

  it('is the same score whatever the screen: the asset sheet and the list read the same function', () => {
    const list = questions(3);
    const answers = { q0: 1 as const, q1: -1 as const };
    expect(assetScore({ isEtf: false, directScore: null }, list, answers).score).toBe(
      questionsScore(list, answers).score,
    );
  });

  it('has no score until something counts', () => {
    expect(questionsScore([], {}).score).toBeNull();
    expect(assetScore({ isEtf: true, directScore: null }, questions(3)).score).toBeNull();
  });
});

describe('tickers', () => {
  it('cleans what the person pastes from a quote site', () => {
    expect(normalizeAssetTicker('us', 'BATS:WTAI')).toBe('WTAI');
    expect(normalizeAssetTicker('b3', ' petr4.sa ')).toBe('PETR4');
    expect(normalizeAssetTicker('crypto', 'btc-brl')).toBe('BTC');
  });

  it('recognises an ETF by the source kind or the name', () => {
    expect(looksLikeEtf('Vanguard S&P 500 ETF')).toBe(true);
    expect(looksLikeEtf('BTG Pactual Teva AUVP Acoes Fundamentos FDI')).toBe(true);
    expect(looksLikeEtf('Weg SA', 'EQUITY')).toBe(false);
    expect(looksLikeEtf(undefined, 'ETF')).toBe(true);
  });
});
