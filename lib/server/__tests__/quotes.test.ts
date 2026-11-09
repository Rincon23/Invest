// @vitest-environment node
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  QuoteUnavailableError,
  fetchPriceHistory,
  fetchQuote,
  fetchQuotes,
  normalizeTicker,
  parseB3Quotation,
  parseYahooSpark,
  parseYahooSparkHistory,
  yahooHistorySymbol,
} from '../quotes';

/** Answers captured from the real services on 16/09/2026 (trimmed). */
const B3_AUPO11 = {
  BizSts: { cd: 'OK' },
  Msg: { dtTm: '2026-09-16 08:10:37' },
  Trad: [
    {
      scty: {
        SctyQtn: { opngPric: 110.36, minPric: 110.2, maxPric: 110.4, curPrc: 110.25 },
        mkt: { nm: 'RendaFixaPrivada' },
        symb: 'AUPO11',
        desc: 'BTGP AUPO   F11',
      },
      ttlQty: 2054,
    },
  ],
};
const B3_NOT_FOUND = { BizSts: { cd: 'NOK', desc: 'Quotation not available.' }, Msg: {} };

function sparkEntry(symbol: string, price: number, longName: string) {
  return { symbol, response: [{ meta: { symbol, regularMarketPrice: price, longName } }] };
}
const YAHOO_SPARK = {
  spark: {
    result: [
      sparkEntry('PETR4.SA', 50.43, 'Petróleo Brasileiro S.A. - Petrobras'),
      sparkEntry('HGLG11.SA', 148.17, 'CSHG Logística FII'),
    ],
    error: null,
  },
};

afterEach(() => {
  vi.unstubAllGlobals();
});

function json(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
}

describe('leitura das respostas', () => {
  it('normaliza o código do ativo', () => {
    expect(normalizeTicker(' aupo11.sa ')).toBe('AUPO11');
    expect(normalizeTicker('PETR4')).toBe('PETR4');
  });

  it('lê o preço e o nome da B3', () => {
    expect(parseB3Quotation('AUPO11', B3_AUPO11)).toEqual({
      ticker: 'AUPO11',
      price: 110.25,
      name: 'BTGP AUPO F11',
      source: 'b3',
    });
  });

  it('não inventa preço quando a B3 não conhece o ativo ou devolve outro', () => {
    expect(parseB3Quotation('XXXX99', B3_NOT_FOUND)).toBeNull();
    expect(parseB3Quotation('PETR4', B3_AUPO11)).toBeNull();
    expect(parseB3Quotation('AUPO11', null)).toBeNull();
  });

  it('lê vários ativos do Yahoo de uma vez', () => {
    expect(parseYahooSpark(YAHOO_SPARK)).toEqual([
      { ticker: 'PETR4', price: 50.43, name: 'Petróleo Brasileiro S.A. - Petrobras', source: 'yahoo' },
      { ticker: 'HGLG11', price: 148.17, name: 'CSHG Logística FII', source: 'yahoo' },
    ]);
    expect(parseYahooSpark({ spark: { result: null, error: { code: 'Not Found' } } })).toEqual([]);
  });
});

describe('busca das cotações', () => {
  it('usa a B3 primeiro e só pergunta ao Yahoo o que ficou faltando', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request) => {
      const url = String(input);
      if (url.includes('cotacao.b3.com.br') && url.endsWith('/AUPO11')) return json(B3_AUPO11);
      if (url.includes('cotacao.b3.com.br')) return json(B3_NOT_FOUND);
      return json(YAHOO_SPARK);
    });
    vi.stubGlobal('fetch', fetchMock);

    const quotes = await fetchQuotes(['aupo11', 'PETR4', 'HGLG11', 'XXXX99']);

    expect(quotes.get('AUPO11')).toMatchObject({ price: 110.25, source: 'b3' });
    expect(quotes.get('PETR4')).toMatchObject({ price: 50.43, source: 'yahoo' });
    expect(quotes.get('HGLG11')).toMatchObject({ price: 148.17, source: 'yahoo' });
    expect(quotes.has('XXXX99')).toBe(false);

    const yahooCalls = fetchMock.mock.calls.map(([url]) => String(url)).filter((url) => url.includes('yahoo'));
    expect(yahooCalls).toHaveLength(1);
    expect(decodeURIComponent(yahooCalls[0])).toContain('symbols=PETR4.SA,HGLG11.SA,XXXX99.SA');
  });

  it('continua de pé quando a B3 cai: tudo vai para o Yahoo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes('cotacao.b3.com.br')
          ? Promise.reject(new TypeError('fetch failed'))
          : json(YAHOO_SPARK),
      ),
    );
    expect((await fetchQuote('PETR4')).source).toBe('yahoo');
  });

  it('explica quando nenhuma das duas fontes tem o ativo', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL | Request) =>
        String(input).includes('cotacao.b3.com.br')
          ? json(B3_NOT_FOUND)
          : json({ spark: { result: null, error: { code: 'Not Found' } } }, 404),
      ),
    );
    await expect(fetchQuote('XXXX99')).rejects.toBeInstanceOf(QuoteUnavailableError);
    await expect(fetchQuote('XXXX99')).rejects.toThrow(/XXXX99/);
  });
});

describe('preços passados (Histórico → Investimentos)', () => {
  const at = (iso: string) => Date.parse(iso) / 1000;
  function history(symbol: string, gmtoffset: number, stamps: string[], closes: (number | null)[]) {
    return {
      symbol,
      response: [{ meta: { symbol, gmtoffset }, timestamp: stamps.map(at), indicators: { quote: [{ close: closes }] } }],
    };
  }

  it('usa o símbolo do Yahoo de cada mercado', () => {
    expect(yahooHistorySymbol({ market: 'b3', ticker: 'PETR4' })).toBe('PETR4.SA');
    expect(yahooHistorySymbol({ market: 'us', ticker: 'VOO' })).toBe('VOO');
    expect(yahooHistorySymbol({ market: 'crypto', ticker: 'BTC' })).toBe('BTC-USD');
  });

  it('lê os fechamentos por dia no fuso do mercado, sem os dias sem preço', () => {
    const payload = {
      spark: {
        result: [
          history(
            'PETR4.SA',
            -10800,
            ['2026-10-15T13:00:00Z', '2026-10-16T13:00:00Z', '2026-10-17T02:00:00Z'],
            [30.1, null, 30.5],
          ),
          { symbol: 'XXXX99.SA', response: [{ meta: {}, timestamp: null, indicators: { quote: [{}] } }] },
        ],
      },
    };
    const found = parseYahooSparkHistory(payload, '1d');
    // 23:00 in São Paulo on the 16th is still the 16th there.
    expect(found.get('PETR4.SA')).toEqual([
      ['2026-10-15', 30.1],
      ['2026-10-16', 30.5],
    ]);
    expect(found.has('XXXX99.SA')).toBe(false);
  });

  it('semanal: cada fechamento vai para a segunda-feira da sua semana, o mais novo vale', () => {
    const payload = {
      spark: {
        result: [history('VOO', -14400, ['2026-10-05T13:30:00Z', '2026-10-12T13:30:00Z', '2026-10-15T20:00:00Z'], [690, 700, 705])],
      },
    };
    expect(parseYahooSparkHistory(payload, '1wk').get('VOO')).toEqual([
      ['2026-10-05', 690],
      ['2026-10-12', 705],
    ]);
  });

  it('pede de 10 em 10, com o período e o intervalo', async () => {
    const fetchMock = vi.fn(async () => json({ spark: { result: [] } }));
    vi.stubGlobal('fetch', fetchMock);
    const symbols = Array.from({ length: 12 }, (_, index) => `AAAA${index}.SA`);
    await fetchPriceHistory(symbols, '5y', '1wk');
    const urls = fetchMock.mock.calls.map((call) => decodeURIComponent(String((call as unknown[])[0])));
    expect(urls).toHaveLength(2);
    expect(urls[0]).toContain('range=5y');
    expect(urls[0]).toContain('interval=1wk');
    expect(urls[1]).toContain('symbols=AAAA10.SA,AAAA11.SA');
  });
});
