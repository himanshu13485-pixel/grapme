/**
 * Read-only profile lookup via Unipile. Resolves a LinkedIn profile URL for a
 * connected account and prints the fields the outreach engine relies on
 * (provider_id, name, company, network_distance). Generates a normal profile
 * view — sends no message / connection request.
 *
 *   PROFILE_URL=https://www.linkedin.com/in/xxx npm run unipile:resolve
 */
import 'dotenv/config';

const PROFILE_URL = process.env.PROFILE_URL ?? 'https://www.linkedin.com/in/sachdevahimanshu/';
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? 'fTrIv6KoSrWeeWEbeRasrQ';

function identifier(url: string): string {
  const m = url.match(/\/in\/([^/?#]+)/i);
  return m ? decodeURIComponent(m[1]) : url;
}

async function main() {
  const dsn = (process.env.UNIPILE_DSN ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const key = (process.env.UNIPILE_API_KEY ?? '').trim().replace(/^['"]+|['"]+$/g, '');
  if (!dsn || !key) { console.error('❌ UNIPILE_DSN / UNIPILE_API_KEY not set'); process.exit(1); }

  const id = identifier(PROFILE_URL);
  const url = `https://${dsn}/api/v1/users/${encodeURIComponent(id)}?account_id=${ACCOUNT_ID}`;
  console.log(`Resolving "${id}" as account ${ACCOUNT_ID} …`);

  const r = await fetch(url, { headers: { 'X-API-KEY': key, accept: 'application/json' } });
  const text = await r.text();
  console.log(`HTTP ${r.status} ${r.statusText}`);
  if (!r.ok) { console.error('❌ ', text.slice(0, 700)); process.exit(1); }

  const p: any = JSON.parse(text);
  console.log('  provider_id     :', p.provider_id);
  console.log('  name            :', [p.first_name, p.last_name].filter(Boolean).join(' ') || p.name);
  console.log('  headline        :', p.headline);
  console.log('  company         :', p.work_experience?.[0]?.company ?? p.company ?? '(none)');
  console.log('  location        :', p.location ?? '(none)');
  console.log('  network_distance:', p.network_distance);
  console.log('  is_relationship :', p.is_relationship);

  const connected = p.network_distance === 'FIRST_DEGREE' || p.is_relationship === true;
  console.log(connected
    ? '\n✅ 1st-degree connection — a Direct Message can be sent (no connection request needed).'
    : '\n⚠ NOT 1st-degree — a DM would require a connection request first; pick a connection for the safe DM test.');
}

main().catch((e) => { console.error('❌ error:', e?.message ?? e); process.exit(1); });
