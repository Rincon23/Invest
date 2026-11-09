import { describe, expect, it } from 'vitest';
import { alignHistory, assetsHistory, dropSpikes, portfolioHistory, typesHistory, type PriceHistory } from '../history';
import type { DiagramAsset, DiagramOverview } from '../types';

function asset(id: string, type: DiagramAsset['type'], quantity: number): DiagramAsset {
  return {
    id,
    type,
    ticker: id.toUpperCase(),
    quantity,
    quantityUpdatedOn: null,
    stopBuying: false,
    isEtf: false,
    directScore: null,
    position: 0,
  };
}

type Source = Pick<DiagramOverview, 'settings' | 'assets' | 'fixedIncome' | 'quotes'>;

function source(assets: DiagramAsset[], extra: Partial<Source> = {}): Source {
  return {
    settings: { targets: { brStocks: 0.5, fiis: 0.3, fixedIncome: 0.2 }, lastAmount: null },
    assets,
    fixedIncome: [],
    quotes: {},
    ...extra,
  };
}

describe('dropSpikes', () => {
  it('tira um fechamento absurdo entre dois vizinhos que concordam', () => {
    expect(
      dropSpikes([
        ['2026-01-05', 109.98],
        ['2026-01-12', 1.064],
        ['2026-01-19', 109.5],
      ]),
    ).toEqual([
      ['2026-01-05', 109.98],
      ['2026-01-19', 109.5],
    ]);
    expect(dropSpikes([['2026-01-05', 1.1], ['2026-01-12', 110], ['2026-01-19', 109]])).toEqual([
      ['2026-01-12', 110],
      ['2026-01-19', 109],
    ]);
  });

  it('mantém uma queda de verdade, que não volta no fechamento seguinte', () => {
    const crash: [string, number][] = [
      ['2022-01-10', 238562],
      ['2022-01-17', 110000],
      ['2022-01-24', 105000],
    ];
    expect(dropSpikes(crash)).toEqual(crash);
  });
});

describe('alignHistory', () => {
  it('põe todos nas mesmas datas, repetindo o último preço nos dias sem pregão', () => {
    const history = alignHistory(
      '1m',
      [
        { id: 'petr', points: [['2026-10-15', 30], ['2026-10-16', 31]], inDollars: false },
        { id: 'btc', points: [['2026-10-15', 100], ['2026-10-17', 110]], inDollars: true },
      ],
      [['2026-10-15', 5], ['2026-10-16', 5.5]],
    );
    expect(history.dates).toEqual(['2026-10-15', '2026-10-16', '2026-10-17']);
    // Saturday: PETR4 keeps Friday's close.
    expect(history.prices.petr).toEqual([30, 31, 31]);
    // US$ × the dollar of the day (the last known one on the weekend).
    expect(history.prices.btc).toEqual([500, 550, 605]);
  });

  it('deixa null antes do primeiro preço e tira quem não tem série ou dólar', () => {
    const history = alignHistory(
      '6m',
      [
        { id: 'old', points: [['2026-05-01', 10], ['2026-06-01', 12]], inDollars: false },
        { id: 'new', points: [['2026-06-01', 50]], inDollars: false },
        { id: 'none', points: undefined, inDollars: false },
        { id: 'voo', points: [['2026-06-01', 600]], inDollars: true },
      ],
      undefined,
    );
    expect(history.prices.new).toEqual([null, 50]);
    expect(history.prices.none).toBeUndefined();
    expect(history.prices.voo).toBeUndefined();
  });
});

describe('portfolioHistory', () => {
  const history: PriceHistory = {
    range: '6m',
    dates: ['2026-05-01', '2026-06-01', '2026-07-01'],
    prices: { petr: [10, 12, 11], hglg: [100, 90, 95], novo: [null, 20, 22] },
  };

  it('soma as cotas de hoje × o preço de cada dia, com a renda fixa sem cotação parada', () => {
    const series = portfolioHistory(
      source([asset('petr', 'brStocks', 10), asset('hglg', 'fiis', 2)], {
        fixedIncome: [{ type: 'fixedIncome', amount: 1000, updatedOn: null, score: 1 }],
      }),
      history,
    );
    expect(series.mode).toBe('value');
    expect(series.points.map((point) => point.value)).toEqual([1300, 1300, 1300]);
    expect(series.change).toBe(0);
  });

  it('por tipo, só aquele tipo; o último dia usa a cotação do Diagrama', () => {
    const series = portfolioHistory(
      source([asset('petr', 'brStocks', 10), asset('hglg', 'fiis', 2)], {
        quotes: { petr: { price: 11.5, fetchedAt: '2026-07-01T12:00:00Z' } },
      }),
      history,
      'brStocks',
    );
    expect(series.points.map((point) => point.value)).toEqual([100, 120, 115]);
    expect(series.change).toBe(15);
    expect(series.changePct).toBeCloseTo(0.15);
  });

  it('um ativo que só passou a ter preço no meio do período fica parado no primeiro preço antes', () => {
    const series = portfolioHistory(source([asset('novo', 'brStocks', 1)]), history);
    expect(series.points.map((point) => point.value)).toEqual([20, 20, 22]);
  });

  it('sem nenhuma cota, cada ativo conta igual e só o % vale', () => {
    const series = portfolioHistory(source([asset('petr', 'brStocks', 0), asset('hglg', 'fiis', 0)]), history);
    expect(series.mode).toBe('index');
    expect(series.start).toBe(1);
    // (12/10 + 90/100) / 2 and (11/10 + 95/100) / 2.
    expect(series.points[1].value).toBeCloseTo(1.05);
    expect(series.points[2].value).toBeCloseTo(1.025);
    expect(series.change).toBe(0);
  });

  it('ignora os ativos de um tipo que saiu da carteira', () => {
    const series = portfolioHistory(
      source([asset('petr', 'brStocks', 10), asset('hglg', 'fiis', 2)], {
        settings: { targets: { brStocks: 1 }, lastAmount: null },
      }),
      history,
    );
    expect(series.points.map((point) => point.value)).toEqual([100, 120, 110]);
  });
});

describe('assetsHistory e typesHistory', () => {
  const history: PriceHistory = {
    range: '1a',
    dates: ['2025-10-20', '2026-04-20', '2026-10-19'],
    prices: { petr: [10, 12, 11], hglg: [100, 90, 95], novo: [null, 20, 30] },
  };

  it('lista cada ativo com a variação do preço, do melhor para o pior', () => {
    const list = assetsHistory(
      source([asset('petr', 'brStocks', 10), asset('hglg', 'fiis', 0), asset('novo', 'brStocks', 0)]),
      history,
    );
    expect(list.map((item) => item.asset.id)).toEqual(['novo', 'petr', 'hglg']);
    expect(list[0].since).toBe('2026-04-20');
    expect(list[0].prices).toEqual([20, 30]);
    expect(list[1].changePct).toBeCloseTo(0.1);
    expect(list[1].change).toBe(10);
    expect(list[2].change).toBe(0);
  });

  it('um domingo só com preço de cripto não faz a ação parecer listada depois', () => {
    const weekend: PriceHistory = {
      range: '6m',
      dates: ['2026-04-19', '2026-04-20', '2026-10-19'],
      prices: { petr: [null, 10, 11] },
    };
    expect(assetsHistory(source([asset('petr', 'brStocks', 1)]), weekend)[0].since).toBeNull();
  });

  it('a renda fixa só sem cotação aparece, mas sem subida e descida', () => {
    const types = typesHistory(
      source([asset('petr', 'brStocks', 10)], {
        fixedIncome: [{ type: 'fixedIncome', amount: 1000, updatedOn: null, score: 1 }],
      }),
      history,
    );
    expect(types.map((item) => [item.type, item.quoted])).toEqual([
      ['brStocks', true],
      ['fixedIncome', false],
    ]);
  });

  it('cada tipo da carteira com algo para mostrar', () => {
    const types = typesHistory(source([asset('petr', 'brStocks', 10), asset('hglg', 'fiis', 1)]), history);
    expect(types.map((item) => item.type)).toEqual(['brStocks', 'fiis']);
    expect(types[1].series.changePct).toBeCloseTo(-0.05);
  });
});
