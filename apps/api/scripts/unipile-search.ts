/**
 * Read-only LinkedIn people-search probe via Unipile. Confirms the search
 * endpoint/body/response shape before we wire it into lead sourcing.
 * Sends nothing to anyone — it's a search query only.
 *
 *   KEYWORDS="Founder Export India" npm run unipile:search
 */
import 'dotenv/config';

const ACCOUNT_ID = process.env.ACCOUNT_ID ?? 'fTrIv6KoSrWeeWEbeRasrQ';
const KEYWORDS = process.env.KEYWORDS ?? 'Founder Export India';

async function main() {
  const dsn = (process.env.UNIPILE_DSN ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const key = (process.env.UNIPILE_API_KEY ?? '').trim().replace(/^['"]+|['"]+$/g, '');
  if (!dsn || !key) { console.error('❌ UNIPILE_DSN / UNIPILE_API_KEY not set'); process.exit(1); }
  const base = `https://${dsn}`;
  const H = { 'X-API-KEY': key, 'content-type': 'application/json', accept: 'application/json' };
  const url = `${base}/api/v1/linkedin/search?account_id=${ACCOUNT_ID}`;
  const body = { api: 'classic', category: 'people', keywords: KEYWORDS };

  console.log(`POST ${url}`);
  console.log(`body: ${JSON.stringify(body)}`);
  const r = await fetch(url, { method: 'POST', headers: H, body: JSON.stringify(body) });
  const text = await r.text();
  console.log(`HTTP ${r.status} ${r.statusText}`);
  if (!r.ok) { console.error('❌ ', text.slice(0, 900)); process.exit(1); }

  const data: any = JSON.parse(text);
  const items = data?.items ?? data?.results ?? data ?? [];
  console.log(`✅ ${items.length} result(s). cursor=${data?.cursor ?? data?.paging?.cursor ?? '(none)'}`);
  for (const p of items.slice(0, 8)) {
    const company = p?.current_positions?.[0]?.company ?? p?.work_experience?.[0]?.company ?? '';
    console.log(`  · ${p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ')} — ${p.headline ?? ''} | ${company} | ${p.location ?? ''} | ${p.network_distance} | ${p.public_profile_url ?? p.profile_url ?? ''}`);
  }
}

main().catch((e) => { console.error('❌ error:', e?.message ?? e); process.exit(1); });
