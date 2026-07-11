/**
 * Provisions a CLIENT-portal login for the LinkedIn demo client so you can log in
 * and test the client portal (email + LinkedIn tabs, campaign wizard, approvals).
 *
 * Mirrors the admin "Set client login" flow (programs.service.setClientLogin):
 * creates/updates a Role.CLIENT user and sets it as the demo client's ownerUserId.
 *
 *   npm run prisma:seed:linkedin-login          (from apps/api)
 *
 * Idempotent. Override the credentials with env vars:
 *   CLIENT_LOGIN_EMAIL, CLIENT_LOGIN_PASSWORD
 */
import 'dotenv/config';
import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

const EMAIL = (process.env.CLIENT_LOGIN_EMAIL ?? 'client@acme.test').toLowerCase();
const PASSWORD = process.env.CLIENT_LOGIN_PASSWORD ?? 'Client@123';

async function main() {
  const tenant = await prisma.tenant.findFirst();
  if (!tenant) { console.error('No tenant found — run the aeo seed first (start-dev.bat migrates + seeds).'); process.exit(1); }

  // Prefer the LinkedIn demo client; fall back to the first client.
  const client =
    (await prisma.client.findFirst({ where: { tenantId: tenant.id, name: 'Acme Exports (LinkedIn Demo)' } })) ??
    (await prisma.client.findFirst({ where: { tenantId: tenant.id }, orderBy: { createdAt: 'asc' } }));
  if (!client) { console.error('No client found — run "npm run prisma:seed:linkedin" first.'); process.exit(1); }

  const passwordHash = await argon2.hash(PASSWORD, { type: argon2.argon2id });

  let owner = await prisma.user.findUnique({ where: { email: EMAIL } });
  if (owner) {
    owner = await prisma.user.update({ where: { id: owner.id }, data: { passwordHash, role: Role.CLIENT } });
  } else {
    owner = await prisma.user.create({
      data: { tenantId: tenant.id, name: client.contactPerson || client.name, email: EMAIL, passwordHash, role: Role.CLIENT },
    });
  }
  await prisma.client.update({ where: { id: client.id }, data: { ownerUserId: owner.id } });

  console.log(`Client login ready for "${client.name}" (id ${client.id}):`);
  console.log(`  Email:    ${EMAIL}`);
  console.log(`  Password: ${PASSWORD}`);
  console.log(`  → Log in at /login, then open the client's LinkedIn tab.`);
}

main().catch((e) => { console.error(e); process.exit(1); }).finally(() => prisma.$disconnect());
