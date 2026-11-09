// @vitest-environment node
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { PGlite } from '@electric-sql/pglite';
import { drizzle } from 'drizzle-orm/pglite';
import { migrate } from 'drizzle-orm/pglite/migrator';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as schema from '../db/schema';
import type { Database } from '../db/types';
import { PostgresPushRepository, pushPublicKey, sendPushToUser, type PushSender } from '../push';

let db: Database;

beforeAll(async () => {
  const pglite = drizzle({ client: new PGlite(), schema });
  await migrate(pglite, { migrationsFolder: path.join(process.cwd(), 'drizzle') });
  db = pglite;
}, 60_000);

afterEach(() => {
  vi.unstubAllEnvs();
  vi.restoreAllMocks();
});

const ANDROID =
  'Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Mobile Safari/537.36';

async function newAccount() {
  const id = randomUUID();
  await db.insert(schema.user).values({ id, name: 'Teste', email: `${id}@teste.local` });
  return { id, push: new PostgresPushRepository(db, id) };
}

function subscription(name = randomUUID()) {
  return {
    endpoint: `https://fcm.googleapis.com/fcm/send/${name}`,
    keys: { p256dh: `p256dh-${name}`, auth: `auth-${name}` },
  };
}

/** A push service that answers `status` for the endpoints in `failing` and accepts the rest. */
function fakeSender(failing: Record<string, number> = {}) {
  const calls: { endpoint: string; payload: string }[] = [];
  const sender: PushSender = async (sub, payload) => {
    calls.push({ endpoint: sub.endpoint, payload });
    const status = failing[sub.endpoint];
    if (status) throw Object.assign(new Error(`HTTP ${status}`), { statusCode: status });
  };
  return { sender, calls };
}

describe('aparelhos que recebem notificações', () => {
  it('guarda o aparelho com um nome legível e não duplica ao registrar de novo', async () => {
    const { push } = await newAccount();
    const sub = subscription();

    const first = await push.registerDevice(sub, ANDROID);
    const again = await push.registerDevice(sub, ANDROID);

    expect(first.label).toBe('Chrome no Android');
    expect(again.id).toBe(first.id);
    expect(await push.listDevices()).toHaveLength(1);
  });

  it('troca a inscrição antiga pela nova quando o navegador a renova', async () => {
    const { push } = await newAccount();
    const old = subscription();
    await push.registerDevice(old, ANDROID);

    const renewed = subscription();
    await push.registerDevice({ ...renewed, previousEndpoint: old.endpoint }, ANDROID);

    const devices = await push.listDevices();
    expect(devices.map((d) => d.endpoint)).toEqual([renewed.endpoint]);
  });

  it('passa o aparelho para a conta que entrou nele por último', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const sub = subscription();

    await alice.push.registerDevice(sub, ANDROID);
    await bob.push.registerDevice(sub, ANDROID);

    expect(await alice.push.listDevices()).toEqual([]);
    expect(await bob.push.listDevices()).toHaveLength(1);
  });

  it('não deixa uma conta remover o aparelho de outra', async () => {
    const alice = await newAccount();
    const bob = await newAccount();
    const device = await alice.push.registerDevice(subscription(), ANDROID);

    await bob.push.removeDevice(device.id);
    expect(await alice.push.listDevices()).toHaveLength(1);

    await alice.push.removeDevice(device.id);
    expect(await alice.push.listDevices()).toEqual([]);
  });
});

describe('envio', () => {
  it('manda para todos os aparelhos do usuário e anota o último envio', async () => {
    const { id, push } = await newAccount();
    const other = await newAccount();
    await push.registerDevice(subscription(), ANDROID);
    await push.registerDevice(subscription(), null);
    await other.push.registerDevice(subscription(), ANDROID);
    const { sender, calls } = fakeSender();

    const report = await sendPushToUser(
      db,
      id,
      { title: 'Capital', body: 'Pagar a conta de luz', url: '/lembretes', tag: 'r1' },
      { sender },
    );

    expect(report).toEqual({ sent: 2, removed: 0, failed: 0 });
    expect(calls).toHaveLength(2);
    expect(JSON.parse(calls[0].payload)).toMatchObject({ body: 'Pagar a conta de luz', tag: 'r1' });
    expect((await push.listDevices()).every((d) => d.lastSuccessAt !== null)).toBe(true);
  });

  it('apaga o aparelho que o serviço de push diz que não existe mais (404/410)', async () => {
    const { id, push } = await newAccount();
    const gone = subscription();
    const expired = subscription();
    const alive = subscription();
    for (const sub of [gone, expired, alive]) await push.registerDevice(sub, ANDROID);
    const { sender } = fakeSender({ [gone.endpoint]: 410, [expired.endpoint]: 404 });

    const report = await sendPushToUser(db, id, { title: 'x', body: 'y', url: '/' }, { sender });

    expect(report).toEqual({ sent: 1, removed: 2, failed: 0 });
    expect((await push.listDevices()).map((d) => d.endpoint)).toEqual([alive.endpoint]);
  });

  it('mantém o aparelho quando a falha é passageira', async () => {
    const { id, push } = await newAccount();
    const sub = subscription();
    await push.registerDevice(sub, ANDROID);
    const { sender } = fakeSender({ [sub.endpoint]: 503 });
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const report = await sendPushToUser(db, id, { title: 'x', body: 'y', url: '/' }, { sender });

    expect(report).toEqual({ sent: 0, removed: 0, failed: 1 });
    expect(await push.listDevices()).toHaveLength(1);
  });

  it('recusa o teste quando nenhum aparelho recebe', async () => {
    const { push } = await newAccount();
    await expect(push.sendTest(undefined, fakeSender().sender)).rejects.toMatchObject({
      status: 409,
      code: 'NO_DEVICES',
    });
  });

  it('só oferece a chave pública quando o servidor tem as três variáveis VAPID', () => {
    vi.stubEnv('VAPID_PUBLIC_KEY', 'publica');
    vi.stubEnv('VAPID_PRIVATE_KEY', '');
    vi.stubEnv('VAPID_SUBJECT', 'https://capital.exemplo');
    expect(pushPublicKey()).toBeNull();

    vi.stubEnv('VAPID_PRIVATE_KEY', 'privada');
    expect(pushPublicKey()).toBe('publica');
  });
});

describe('proteção contra abuso das notificações', () => {
  it('guarda no máximo 10 aparelhos por conta, descartando o que está parado há mais tempo', async () => {
    const { push } = await newAccount();
    const first = await push.registerDevice(subscription(), ANDROID);
    for (let i = 0; i < 11; i++) await push.registerDevice(subscription(), ANDROID);

    const devices = await push.listDevices();
    expect(devices).toHaveLength(10);
    expect(devices.some((d) => d.id === first.id)).toBe(false);
  });

  it('nunca manda nada para um endereço fora dos serviços de push conhecidos, e o apaga', async () => {
    const { id, push } = await newAccount();
    await push.registerDevice(subscription(), ANDROID);
    // Gravado direto no banco, como se tivesse entrado antes da verificação existir.
    await db.insert(schema.pushSubscriptions).values({
      userId: id,
      endpoint: 'https://vitima.example/ataque',
      p256dh: 'k',
      auth: 'a',
    });
    const { sender, calls } = fakeSender();

    const report = await sendPushToUser(db, id, { title: 'Oi', body: 'teste', url: '/' }, { sender });

    expect(calls.map((c) => c.endpoint)).not.toContain('https://vitima.example/ataque');
    expect(report).toMatchObject({ sent: 1, removed: 1 });
    expect(await push.listDevices()).toHaveLength(1);
  });
});
