/**
 * Register (idempotently) the Unipile "messaging" webhook so LinkedIn replies
 * are POSTed to this API's inbox endpoint. Reads APP_PUBLIC_URL (your ngrok URL)
 * and UNIPILE_WEBHOOK_SECRET. Re-run after each ngrok restart (URL changes).
 *
 *   npm run unipile:webhook            (from apps/api)
 */
import 'dotenv/config';

const NAME = 'aeo-linkedin-replies';

async function main() {
  const dsn = (process.env.UNIPILE_DSN ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const key = (process.env.UNIPILE_API_KEY ?? '').trim().replace(/^['"]+|['"]+$/g, '');
  const pub = (process.env.APP_PUBLIC_URL ?? '').trim().replace(/\/+$/, '');
  const secret = process.env.UNIPILE_WEBHOOK_SECRET ?? '';
  if (!dsn || !key) { console.error('❌ UNIPILE_DSN / UNIPILE_API_KEY not set in apps/api/.env'); process.exit(1); }
  if (!pub || /localhost|127\.0\.0\.1/.test(pub)) {
    console.error('❌ APP_PUBLIC_URL must be your public ngrok URL (not localhost).');
    console.error('   Run `ngrok http 4000`, set APP_PUBLIC_URL=https://<id>.ngrok-free.app in .env, restart, then re-run.');
    process.exit(1);
  }

  const base = `https://${dsn}`;
  const H = { 'X-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' };
  const requestUrl = `${pub}/api/v1/linkedin/webhooks/unipile/messaging${secret ? `?secret=${encodeURIComponent(secret)}` : ''}`;

  // Remove any previous webhook we created (keeps it idempotent across ngrok restarts).
  try {
    const listRes = await fetch(`${base}/api/v1/webhooks`, { headers: H });
    const list: any = await listRes.json();
    for (const w of (list?.items ?? list ?? [])) {
      const id = w.id ?? w.webhook_id ?? w.source_id;
      if (w.name === NAME && id) { await fetch(`${base}/api/v1/webhooks/${id}`, { method: 'DELETE', headers: H }); console.log(`removed old webhook ${id}`); }
    }
  } catch { /* ignore listing errors */ }

  const body = { source: 'messaging', request_url: requestUrl, name: NAME, format: 'json', events: ['message_received'] };
  const r = await fetch(`${base}/api/v1/webhooks`, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  if (!r.ok) { console.error(`❌ create failed HTTP ${r.status}: ${text.slice(0, 600)}`); process.exit(1); }
  const res: any = JSON.parse(text);

  console.log(`✅ messaging webhook registered: ${res.webhook_id}`);
  console.log(`   → ${requestUrl}`);
  console.log('   Now reply to the campaign message from your other LinkedIn account —');
  console.log('   it should appear in the client\'s Inbox within a few seconds.');
}

main().catch((e) => { console.error('❌', e?.message ?? e); process.exit(1); });
