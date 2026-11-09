import { afterEach, describe, expect, it, vi } from 'vitest';
import { ApiRequestError, HttpSettingsRepository, UNAUTHENTICATED_EVENT } from '../httpRepository';
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

describe('HttpSettingsRepository', () => {
  const repo = new HttpSettingsRepository();

  it('sends the settings as JSON', async () => {
    const fetchMock = mockFetch(204);
    await repo.saveSettings({ dismissedNotices: ['a'] });
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe('/api/v1/settings');
    expect(init.method).toBe('PUT');
    expect(JSON.parse(init.body)).toEqual({ dismissedNotices: ['a'] });
  });

  it('turns 401 into NotAuthenticatedError and tells the app to go to /login', async () => {
    mockFetch(401, { error: 'Sessão expirada.', code: 'UNAUTHENTICATED' });
    const listener = vi.fn();
    window.addEventListener(UNAUTHENTICATED_EVENT, listener);

    await expect(repo.getSettings()).rejects.toBeInstanceOf(NotAuthenticatedError);
    expect(listener).toHaveBeenCalledTimes(1);
    window.removeEventListener(UNAUTHENTICATED_EVENT, listener);
  });

  it("surfaces the server's message on other errors", async () => {
    mockFetch(409, { error: 'As metas precisam somar 100%.', code: 'TARGETS_NOT_100' });
    const error = await repo.completeOnboarding().catch((err: unknown) => err);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).message).toBe('As metas precisam somar 100%.');
    expect((error as ApiRequestError).code).toBe('TARGETS_NOT_100');
  });

  it('explains when the server cannot be reached', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    await expect(repo.getSettings()).rejects.toThrow('Sem conexão com o servidor');
  });
});
