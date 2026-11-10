// Brings the Diagrama of each account from the Capital + database into the Invest + database: the
// account itself (same id, e-mail and password, so the person signs in with what they already use),
// the access to the restricted modules, the whole Diagrama, the Pluggy key (encrypted again with this
// app's key) and, as "Fora do Diagrama", the quotas of the Capital's Reserva investida.
//
// It only READS the Capital database. An account that is already in the Invest + is left alone (it
// may have changed things here since), so running it twice adds nothing.
//
// Plain JavaScript with `pg` only, so it runs inside the Invest + container on the Pi, where both
// databases are on the Docker network:
//
//   docker exec -e CAPITAL_DATABASE_URL=... -e CAPITAL_ENCRYPTION_KEY=... invest \
//     node scripts/migrate-from-capital.mjs            (a dry run: only says what it would do)
//   ... node scripts/migrate-from-capital.mjs --apply  (does it, in one transaction)
//
// DATABASE_URL and ENCRYPTION_KEY are the container's own (the Invest + database and key).
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import pg from 'pg';

const apply = process.argv.includes('--apply');
const source = process.env.CAPITAL_DATABASE_URL;
const target = process.env.DATABASE_URL;
if (!source || !target) {
  console.error('Faltam CAPITAL_DATABASE_URL (o banco do Capital +) e DATABASE_URL (o do Invest +).');
  process.exit(1);
}
if (source === target) {
  console.error('CAPITAL_DATABASE_URL e DATABASE_URL são o mesmo banco.');
  process.exit(1);
}

/** 32 bytes in base64, as lib/server/secretBox.ts reads ENCRYPTION_KEY; null when absent or wrong. */
function keyFrom(raw) {
  if (!raw?.trim()) return null;
  const key = Buffer.from(raw.trim(), 'base64');
  return key.length === 32 ? key : null;
}

/** The same format as lib/server/secretBox.ts: "v1.<iv>.<tag>.<ciphertext>", base64url. */
function decrypt(sealed, key) {
  const [version, iv, tag, ciphertext] = sealed.split('.');
  if (version !== 'v1' || !iv || !tag || ciphertext === undefined) throw new Error('formato desconhecido');
  const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(iv, 'base64url'));
  decipher.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]).toString('utf8');
}

function encrypt(plain, key) {
  const iv = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), ciphertext].map((part) => (typeof part === 'string' ? part : part.toString('base64url'))).join('.');
}

// A `date` column stays the text it is ("2026-10-08"): as a JS Date it could move a day with the time zone.
pg.types.setTypeParser(1082, (value) => value);

const capitalKey = keyFrom(process.env.CAPITAL_ENCRYPTION_KEY);
const investKey = keyFrom(process.env.ENCRYPTION_KEY);

const from = new pg.Client({ connectionString: source });
const to = new pg.Client({ connectionString: target });

const DIAGRAM_TABLES = ['diagram_settings', 'diagram_assets', 'diagram_fixed_income', 'diagram_questions', 'diagram_contributions'];

async function rowsOf(table, userId, columns = '*') {
  const { rows } = await from.query(`select ${columns} from ${table} where user_id = $1`, [userId]);
  return rows;
}

/** Inserts `rows` into `table` with exactly `columns` (each row an object with those keys). */
async function insert(table, columns, rows, conflict = '') {
  for (const row of rows) {
    const values = columns.map((column) => {
      const value = row[column];
      // jsonb columns come back parsed; they go in as JSON text.
      return value !== null && typeof value === 'object' && !(value instanceof Date) ? JSON.stringify(value) : value;
    });
    const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
    await to.query(`insert into ${table} (${columns.join(', ')}) values (${placeholders}) ${conflict}`, values);
  }
}

async function main() {
  await from.connect();
  await to.connect();
  // Never write to the Capital: every statement on that connection is read-only.
  await from.query('set session characteristics as transaction read only');

  const { rows: people } = await from.query(`
    select u.* from users u
    where u.id in (${DIAGRAM_TABLES.map((table) => `select user_id from ${table}`).join(' union ')})
    order by u.created_at`);
  const { rows: already } = await to.query('select id, email from users');
  const knownIds = new Set(already.map((row) => row.id));
  const knownEmails = new Set(already.map((row) => row.email.toLowerCase()));

  const plan = [];
  for (const person of people) {
    if (knownIds.has(person.id)) {
      plan.push({ person, skip: 'já está no Invest +' });
      continue;
    }
    if (knownEmails.has(person.email.toLowerCase())) {
      plan.push({ person, skip: 'o e-mail já tem outra conta no Invest +' });
      continue;
    }
    // One connection runs one query at a time: in order, not in parallel.
    const assets = await rowsOf('diagram_assets', person.id, 'id');
    const contributions = await rowsOf('diagram_contributions', person.id, 'id');
    const questions = await rowsOf('diagram_questions', person.id, 'id');
    const keys = await rowsOf('bank_keys', person.id);
    const reserves = await rowsOf('investment_reserves', person.id, 'ticker, total_quotas');
    const vip = await rowsOf('vip_users', person.id, 'user_id');
    plan.push({
      person,
      assets: assets.length,
      contributions: contributions.length,
      questions: questions.length,
      key: keys[0] ?? null,
      reserve: reserves[0] && Number(reserves[0].total_quotas) > 0 ? reserves[0] : null,
      vip: vip.length > 0,
    });
  }

  console.log(apply ? '== Migrando (de verdade) ==' : '== Ensaio (nada é gravado; use --apply para migrar) ==');
  for (const item of plan) {
    if (item.skip) {
      console.log(`- ${item.person.email}: pulada (${item.skip})`);
      continue;
    }
    const parts = [
      `${item.assets} ativos`,
      `${item.contributions} aportes`,
      `${item.questions} perguntas`,
      item.vip ? 'acesso aos restritos' : null,
      item.key ? (capitalKey && investKey ? 'chave da Pluggy' : 'chave da Pluggy NÃO (faltam as chaves de cifra)') : null,
      item.reserve ? `fora do Diagrama: ${Number(item.reserve.total_quotas)} de ${item.reserve.ticker}` : null,
    ].filter(Boolean);
    console.log(`- ${item.person.email}: ${parts.join(', ')}`);
  }
  const moving = plan.filter((item) => !item.skip);
  console.log(`${moving.length} conta(s) para levar, ${plan.length - moving.length} pulada(s).`);
  if (!apply || moving.length === 0) return;

  await to.query('begin');
  try {
    for (const item of moving) {
      const id = item.person.id;
      await insert('users', ['id', 'name', 'email', 'email_verified', 'image', 'created_at', 'updated_at'], [item.person]);
      // Only the e-mail and password sign-in (the password hash works as it is: scrypt with its own salt).
      await insert(
        'accounts',
        ['id', 'account_id', 'provider_id', 'user_id', 'password', 'created_at', 'updated_at'],
        (await rowsOf('accounts', id)).filter((row) => row.provider_id === 'credential'),
      );
      if (item.vip) await insert('vip_users', ['user_id', 'granted_at'], await rowsOf('vip_users', id));
      // They know the Diagrama already: no welcome. The modules are set by syncModules on boot.
      await to.query('insert into settings (user_id, onboarding_completed) values ($1, true)', [id]);

      await insert('diagram_settings', ['user_id', 'targets', 'last_amount', 'updated_at'], await rowsOf('diagram_settings', id));
      await insert(
        'diagram_assets',
        ['user_id', 'id', 'type', 'ticker', 'quantity', 'quantity_updated_on', 'sector', 'subsector', 'note', 'stop_buying', 'is_etf', 'direct_score', 'position', 'created_at', 'updated_at'],
        await rowsOf('diagram_assets', id),
      );
      await insert('diagram_fixed_income', ['user_id', 'type', 'amount', 'updated_on', 'score', 'updated_at'], await rowsOf('diagram_fixed_income', id));
      await insert(
        'diagram_questions',
        ['user_id', 'id', 'type', 'criterion', 'text', 'help', 'auto', 'weight', 'position', 'created_at', 'updated_at'],
        await rowsOf('diagram_questions', id),
      );
      await insert('diagram_answers', ['user_id', 'asset_id', 'question_id', 'answer'], await rowsOf('diagram_answers', id));
      await insert('diagram_contributions', ['user_id', 'id', 'date', 'amount', 'items', 'created_at'], await rowsOf('diagram_contributions', id));
      if (item.reserve) {
        await to.query('insert into diagram_outside (user_id, ticker, quantity) values ($1, $2, $3)', [
          id,
          item.reserve.ticker.trim().toUpperCase(),
          Number(item.reserve.total_quotas),
        ]);
      }
      if (item.key && capitalKey && investKey) {
        const secret = decrypt(item.key.client_secret, capitalKey);
        await to.query(
          'insert into bank_keys (user_id, client_id, client_secret, secret_hint) values ($1, $2, $3, $4)',
          [id, item.key.client_id, encrypt(secret, investKey), item.key.secret_hint],
        );
      }
    }

    // The owner's choices of "Restrito" for the modules both apps have.
    const { rows: access } = await from.query(`select * from module_access where module_key in ('diagram', 'banks')`);
    await insert('module_access', ['module_key', 'vip_only', 'updated_at'], access, 'on conflict (module_key) do nothing');
    // Prices and indicators everyone shares: the first screens open with them instead of waiting.
    await insert('price_cache', ['ticker', 'price', 'name', 'source', 'fetched_at'], (await from.query('select * from price_cache')).rows, 'on conflict (ticker) do nothing');
    await insert('fundamentals_cache', ['ticker', 'lpa', 'vpa', 'pvp', 'fetched_at'], (await from.query('select * from fundamentals_cache')).rows, 'on conflict (ticker) do nothing');

    // The check: what was read is what is here now.
    for (const item of moving) {
      for (const table of DIAGRAM_TABLES) {
        const [{ count: there }] = (await from.query(`select count(*)::int as count from ${table} where user_id = $1`, [item.person.id])).rows;
        const [{ count: here }] = (await to.query(`select count(*)::int as count from ${table} where user_id = $1`, [item.person.id])).rows;
        if (there !== here) throw new Error(`${item.person.email}: ${table} tem ${there} no Capital + e ${here} aqui.`);
      }
    }
    await to.query('commit');
    console.log('Pronto: tudo conferido e gravado.');
  } catch (err) {
    await to.query('rollback');
    throw err;
  }
}

main()
  .catch((err) => {
    console.error('Falhou, nada foi gravado:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await from.end().catch(() => undefined);
    await to.end().catch(() => undefined);
  });
