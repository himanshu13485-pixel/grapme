/**
 * Read-only Unipile connectivity check. Validates UNIPILE_DSN + UNIPILE_API_KEY
 * by listing the accounts connected under your Unipile API key. Sends nothing to
 * LinkedIn — safe to run anytime.
 *
 *   npm run unipile:ping        (from apps/api)
 */
import 'dotenv/config';

async function main() {
  const dsn = process.env.UNIPILE_DSN;
  const key = process.env.UNIPILE_API_KEY;
  if (!dsn || !key) {
    console.error('❌ UNIPILE_DSN / UNIPILE_API_KEY not set in apps/api/.env');
    process.exit(1);
  }
  const host = dsn.replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const apiKey = key.trim().replace(/^['"]+|['"]+$/g, '');
  const url = `https://${host}/api/v1/accounts`;
  console.log(`GET ${url} …`);
  console.log(`API key loaded: ${apiKey.length} chars` + (apiKey.length ? ` (${apiKey.slice(0, 2)}…${apiKey.slice(-2)})` : ' — EMPTY!'));
  const weird = apiKey.match(/[^A-Za-z0-9._=/+-]/g);
  if (weird) console.log(`⚠ key has unexpected characters: ${[...new Set(weird)].map((c) => JSON.stringify(c)).join(', ')} — likely a bad paste (space/newline/quote).`);
  const looksJwt = apiKey.split('.').length === 3;
  console.log(`  shape: ${looksJwt ? 'JWT-like (3 dot-segments)' : 'opaque token'}`);

  const r = await fetch(url, { headers: { 'X-API-KEY': apiKey, accept: 'application/json' } });
  const text = await r.text();
  console.log(`HTTP ${r.status} ${r.statusText}`);
  if (!r.ok) {
    console.error('❌ Unipile rejected the request. Response:');
    console.error('  ', text.slice(0, 800));
    process.exit(1);
  }
  let data: any = {};
  try { data = JSON.parse(text); } catch { /* non-JSON */ }
  const items = data?.items ?? data ?? [];
  console.log(`✅ Unipile API key is valid. ${items.length} account(s):`);
  for (const a of items) {
    const status = a?.sources?.[0]?.status ?? a?.status ?? '?';
    console.log(`  · ${a.type} "${a.name}" [${a.id}] status=${status}`);
  }
  if (items.length === 0) {
    console.log('  (no accounts yet — connect one via LinkedIn Outreach → client → Accounts → Connect Account)');
  }

  const publicUrl = process.env.APP_PUBLIC_URL;
  console.log(publicUrl ? `\nAPP_PUBLIC_URL = ${publicUrl} (connect callback will target this)` : '\n⚠ APP_PUBLIC_URL not set — connecting an account locally needs a public tunnel (ngrok) so Unipile can call back.');
}

main().catch((e) => {
  console.error('❌ Unipile error');
  console.error('  name:   ', e?.name);
  console.error('  message:', e?.message);
  console.error('  status: ', e?.status ?? e?.statusCode ?? e?.response?.status);
  console.error('  body:   ', JSON.stringify(e?.body ?? e?.response?.data ?? e?.cause ?? e, Object.getOwnPropertyNames(e ?? {})));
  process.exit(1);
});
