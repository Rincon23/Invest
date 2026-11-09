import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, HttpBudgetRepository, UNAUTHENTICATED_EVENT } from '../httpRepository';
import { closeMonthsBefore, fetchMonthsToClose } from '../monthClosing';
import { NotAuthenticatedError } from '../repository';

function mockFetch(status: number, body?: unknown) {
  const fetchMock = vi.fn().mockResolvedValue(
    new Response(body === undefined ? null : JSON.stringify(body), {
      status,
      headers: { 'Content-Type': 'application/json' },
    }),
  );
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('HttpBudgetRepository', () => {
  const repo = new HttpBudgetRepository();

  it('treats MONTH_NOT_FOUND as "month not created yet"', async () => {
    mockFetch(404, { error: 'O mês 2026-01 não foi encontrado.', code: 'MONTH_NOT_FOUND' });
    await expect(repo.getMonth('2026-01')).resolves.toBeUndefined();
  });

  it('sends writes as JSON to the entry URL, with the id encoded', async () => {
    const fetchMock = mockFetch(204);
    const expense = {
      id: 'e 1',
      categoryKind: 'fixedCost' as const,
      description: 'Luz',
      amount: 120.99,
      date: '2026-01-10',
    };
    await repo.saveExpense('2026-01', expense);

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/months/2026-01/expenses/e%201');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual(expense);
  });

  it('says whether closing the month should also open the next one', async () => {
    const fetchMock = mockFetch(204);
    await repo.closeMonth('2026-01', true);
    await repo.closeMonth('2026-02');
    await repo.closeMonth('2026-03', false, true);

    const [closeAndOpen, closeOnly, withoutLeftovers] = fetchMock.mock.calls;
    expect(closeAndOpen[0]).toBe('/api/v1/months/2026-01/close');
    expect(JSON.parse(closeAndOpen[1].body)).toEqual({ openNext: true, dropLeftovers: false });
    expect(JSON.parse(closeOnly[1].body)).toEqual({ openNext: false, dropLeftovers: false });
    expect(JSON.parse(withoutLeftovers[1].body)).toEqual({ openNext: false, dropLeftovers: true });
  });

  it('asks what is left to close, and closes every month before one', async () => {
    const fetchMock = mockFetch(204);
    await closeMonthsBefore('2026-03', true);
    expect(fetchMock.mock.calls[0][0]).toBe('/api/v1/months/2026-03/close-before');
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({ dropLeftovers: true });

    const listing = mockFetch(200, []);
    await expect(fetchMonthsToClose('2026-03')).resolves.toEqual([]);
    expect(listing.mock.calls[0][0]).toBe('/api/v1/months/2026-03/to-close');
  });

  it('turns 401 into NotAuthenticatedError and tells the app to go to /login', async () => {
    mockFetch(401, { error: 'Sessão expirada.', code: 'UNAUTHENTICATED' });
    const listener = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, listener);

    await expect(repo.listMonths()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHENTICATED_EVENT, listener);
  });

  it("surfaces the server's message on other errors", async () => {
    mockFetch(409, { error: 'O mês 2026-01 está fechado. Reabra-o para editar.', code: 'MONTH_CLOSED' });
    const error = await repo.deleteIncome('2026-01', 'i1').catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).message).toBe('O mês 2026-01 está fechado. Reabra-o para editar.');
    expect((error as ApiRequestError).code).toBe('MONTH_CLOSED');
  });

  it('explains when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(repo.getSettings()).rejects.toThrow('Sem conexão com o servidor');
  });
});
