/**
 * Attach an EXISTING Unipile LinkedIn account to a client's seat in aeo (DB only —
 * sends nothing to LinkedIn). Fetches the account's name/status from Unipile and
 * upserts a CONNECTED LinkedInAccount row.
 *
 *   npm run link:unipile                              (defaults below)
 *   ACCOUNT_ID=xxx CLIENT_ID=yyy npm run link:unipile
 */
import 'dotenv/config';
import { PrismaClient, LinkedInAccountStatus } from '@prisma/client';

const prisma = new PrismaClient();

// Defaults for the current test: "Prashant Verma" → the LinkedIn demo client.
const ACCOUNT_ID = process.env.ACCOUNT_ID ?? 'fTrIv6KoSrWeeWEbeRasrQ';
const CLIENT_NAME = 'Acme Exports (LinkedIn Demo)';

const STATUS_MAP: Record<string, LinkedInAccountStatus> = {
  OK: 'CONNECTED', CONNECTED: 'CONNECTED', CREDENTIALS: 'CREDENTIALS',
  PERMISSIONS: 'CREDENTIALS', STOPPED: 'DISCONNECTED', ERROR: 'ERROR', CONNECTING: 'PENDING',
};

async function fetchUnipileAccount(id: string): Promise<{ name?: string; status?: string }> {
  const dsn = (process.env.UNIPILE_DSN ?? '').replace(/^https?:\/\//i, '').replace(/\/+$/, '');
  const key = (process.env.UNIPILE_API_KEY ?? '').trim().replace(/^['"]+|['"]+$/g, '');
  if (!dsn || !key) return {};
  try {
    const r = await fetch(`https://${dsn}/api/v1/accounts/${id}`, { headers: { 'X-API-KEY': key, accept: 'application/json' } });
    if (!r.ok) { console.warn(`  (Unipile getOne ${r.status} — using defaults)`); return {}; }
    const a: any = await r.json();
    return { name: a?.name, status: a?.sources?.[0]?.status ?? a?.status };
  } catch (e) { console.warn(`  (Unipile lookup failed: ${(e as Error).message})`); return {}; }
}

async function main() {
  const client = process.env.CLIENT_ID
    ? await prisma.client.findUnique({ where: { id: process.env.CLIENT_ID } })
    : await prisma.client.findFirst({ where: { name: CLIENT_NAME } });
  if (!client) { console.error('Client not found. Run "npm run prisma:seed:linkedin" first, or set CLIENT_ID.'); process.exit(1); }

  const meta = await fetchUnipileAccount(ACCOUNT_ID);
  const status = STATUS_MAP[(meta.status ?? 'OK').toUpperCase()] ?? LinkedInAccountStatus.CONNECTED;
  const fullName = meta.name ?? 'Prashant Verma';

  const row = await prisma.linkedInAccount.upsert({
    where: { unipileAccountId: ACCOUNT_ID },
    create: { tenantId: client.tenantId, clientId: client.id, unipileAccountId: ACCOUNT_ID, status, fullName, lastSyncedAt: new Date() },
    update: { clientId: client.id, status, fullName, lastSyncedAt: new Date() },
  });

  // Make sure the client's LinkedIn channel is on, so the account is usable in the panel.
  await prisma.client.update({ where: { id: client.id }, data: { linkedInEnabled: true } });

  console.log(`Linked Unipile account "${fullName}" [${ACCOUNT_ID}] → client "${client.name}"`);
  console.log(`  aeo account row: ${row.id}  status=${row.status}`);
  console.log('  → Now visible in LinkedIn Outreach → this client → Accounts (Connected).');
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
