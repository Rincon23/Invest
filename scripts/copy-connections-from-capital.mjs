// Brings into the Invest + the Open Finance connections each person already has in the Capital +,
// so the brokers show up here without a new authorization. Since 2026-11 Pluggy's free plan creates
// connections only through its Connect Widget, and the same connection (a Pluggy "item") is read by
// both apps with the person's own key — so this only copies the item ids, never creates anything.
//
// Who: accounts that are in the Invest + with a Pluggy key whose Client ID is the same as in the
// Capital + (the same Pluggy application can read the same items). What: the connections that sent
// some investment, with the investments of their last read, so "Conferir investimentos" works at
// once; the hourly read keeps them fresh from then on. A connection already here is left alone.
//
// It only READS the Capital database. Plain JavaScript with `pg`, run inside the Invest container:
//
//   docker exec -e CAPITAL_DATABASE_URL=... invest node scripts/copy-connections-from-capital.mjs
//   ... node scripts/copy-connections-from-capital.mjs --apply
import pg from 'pg';

const apply = process.argv.includes('--apply');
const source = process.env.CAPITAL_DATABASE_URL;
const target = process.env.DATABASE_URL;
if (!source || !target || source === target) {
  console.error('Faltam CAPITAL_DATABASE_URL (o banco do Capital +) e DATABASE_URL (o do Invest +), diferentes.');
  process.exit(1);
}

const from = new pg.Client({ connectionString: source });
const to = new pg.Client({ connectionString: target });

async function main() {
  await from.connect();
  await to.connect();
  await from.query('set session characteristics as transaction read only');

  const { rows: people } = await to.query(
    'select k.user_id, k.client_id, u.email from bank_keys k join users u on u.id = k.user_id order by u.email',
  );
  const plan = [];
  for (const person of people) {
    const { rows: keys } = await from.query('select client_id from bank_keys where user_id = $1', [person.user_id]);
    if (keys[0]?.client_id !== person.client_id) {
      plan.push({ person, skip: 'a chave da Pluggy não é a mesma do Capital +' });
      continue;
    }
    const { rows: connections } = await from.query(
      `select c.* from bank_connections c
       where c.user_id = $1 and c.status <> 'pending'
         and exists (select 1 from bank_investments i where i.user_id = c.user_id and i.item_id = c.item_id)
       order by c.created_at`,
      [person.user_id],
    );
    const { rows: here } = await to.query('select item_id from bank_connections where user_id = $1', [person.user_id]);
    const known = new Set(here.map((row) => row.item_id));
    const items = [];
    for (const connection of connections) {
      if (known.has(connection.item_id)) continue;
      const { rows: investments } = await from.query(
        'select * from bank_investments where user_id = $1 and item_id = $2',
        [person.user_id, connection.item_id],
      );
      items.push({ connection, investments });
    }
    plan.push({ person, items });
  }

  console.log(apply ? '== Trazendo as conexões (de verdade) ==' : '== Ensaio (nada é gravado; use --apply) ==');
  for (const entry of plan) {
    const who = entry.person.email;
    if (entry.skip) {
      console.log(`- ${who}: pulada (${entry.skip})`);
      continue;
    }
    const names = entry.items.map(
      (item) => `${item.connection.name ?? item.connection.suggested_name ?? 'Banco'} (${item.investments.length} investimentos)`,
    );
    console.log(`- ${who}: ${names.length > 0 ? names.join(', ') : 'nada novo para trazer'}`);
  }
  if (!apply) return;

  await to.query('begin');
  try {
    for (const entry of plan) {
      if (entry.skip) continue;
      const userId = entry.person.user_id;
      for (const { connection, investments } of entry.items) {
        await to.query(
          `insert into bank_connections
             (user_id, item_id, name, suggested_name, status, last_updated_at, next_auto_sync_at,
              consent_expires_at, synced_update_at, checked_at, created_at)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [
            userId,
            connection.item_id,
            connection.name,
            connection.suggested_name,
            connection.status,
            connection.last_updated_at,
            connection.next_auto_sync_at,
            connection.consent_expires_at,
            connection.synced_update_at,
            connection.checked_at,
            connection.created_at,
          ],
        );
        for (const investment of investments) {
          await to.query(
            `insert into bank_investments
               (user_id, investment_id, item_id, name, type, subtype, code, isin, quantity, balance, balance_at)
             values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
            [
              userId,
              investment.investment_id,
              investment.item_id,
              investment.name,
              investment.type,
              investment.subtype,
              investment.code,
              investment.isin,
              investment.quantity,
              investment.balance,
              investment.balance_at,
            ],
          );
        }
      }
    }
    await to.query('commit');
    console.log('Pronto: conexões e investimentos gravados.');
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
