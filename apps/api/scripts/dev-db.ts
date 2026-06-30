/**
 * Zero-Docker local Postgres for development.
 * Downloads a real Postgres binary (first run only) and serves it on :5432
 * with the same credentials the default DATABASE_URL expects, so you can run
 * the whole app without Docker or a system Postgres install.
 *
 *   npx ts-node scripts/dev-db.ts      (or: npm run db:embedded)
 *
 * Leave it running in its own terminal. Ctrl-C to stop.
 */
import EmbeddedPostgres from 'embedded-postgres';
import { existsSync } from 'fs';
import { join } from 'path';

const DATA_DIR = join(__dirname, '..', '.pgdata');

async function main() {
  const firstRun = !existsSync(DATA_DIR);
  const pg = new EmbeddedPostgres({
    databaseDir: DATA_DIR,
    user: 'aeo',
    password: 'aeo_password',
    port: 5432,
    persistent: true,
    // Force UTF-8 so the cluster can store any inbound mail (emoji, CJK, …).
    // Without this, initdb on Windows picks the WIN1252 system locale and
    // inserts of non-Latin characters fail. Only applied on first init.
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (firstRun) {
    console.log('Initialising Postgres data directory (first run)…');
    await pg.initialise();
  }
  await pg.start();
  console.log('Postgres started on localhost:5432');

  // Ensure the "aeo" database exists.
  try {
    await pg.createDatabase('aeo');
    console.log('Created database "aeo".');
  } catch {
    console.log('Database "aeo" already exists.');
  }

  console.log(
    '\nReady. DATABASE_URL=postgresql://aeo:aeo_password@localhost:5432/aeo' +
      '\nLeave this running and, in another terminal: npm run db:migrate && npm run db:seed && npm run dev:api',
  );

  const shutdown = async () => {
    console.log('\nStopping Postgres…');
    await pg.stop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
