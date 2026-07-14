import { PrismaClient, Role } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

/** Seeds a demo tenant with a super admin, a sub-admin, and a user. */
async function main() {
  const tenant = await prisma.tenant.upsert({
    where: { id: '00000000-0000-0000-0000-000000000001' },
    update: {},
    create: {
      id: '00000000-0000-0000-0000-000000000001',
      name: 'Demo Agency',
      plan: 'pro',
    },
  });

  // Seed accounts are configurable via env so no test address is hardcoded.
  const seedPassword = process.env.SEED_PASSWORD || 'Password123!';
  const password = await argon2.hash(seedPassword, { type: argon2.argon2id });

  const adminEmail = (process.env.SEED_ADMIN_EMAIL || 'admin@grapme.local').toLowerCase();
  const subAdminEmail = (process.env.SEED_SUBADMIN_EMAIL || 'subadmin@grapme.local').toLowerCase();
  const demoUserEmail = (process.env.SEED_USER_EMAIL || 'user@grapme.local').toLowerCase();

  const accounts: Array<{ name: string; email: string; role: Role }> = [
    { name: 'Super Admin', email: adminEmail, role: Role.SUPER_ADMIN },
    { name: 'Sub Admin', email: subAdminEmail, role: Role.SUB_ADMIN },
    { name: 'Demo User', email: demoUserEmail, role: Role.USER },
  ];

  for (const a of accounts) {
    await prisma.user.upsert({
      where: { email: a.email },
      update: {},
      create: {
        tenantId: tenant.id,
        name: a.name,
        email: a.email,
        passwordHash: password,
        role: a.role,
      },
    });
  }

  // Baseline permission catalog
  const permissions = [
    ['approve_campaigns', 'Approve or reject campaigns'],
    ['approve_schedules', 'Approve or reject schedules'],
    ['approve_sequences', 'Approve or reject follow-up sequences'],
    ['approve_imports', 'Approve or reject contact imports'],
    ['view_user_inbox', 'View inbox of assigned users'],
    ['manage_credits', 'Grant or deduct user credits'],
  ];
  for (const [key, description] of permissions) {
    await prisma.permission.upsert({
      where: { key },
      update: { description },
      create: { key, description },
    });
  }

  // eslint-disable-next-line no-console
  console.log(`Seed complete. Login with ${adminEmail} / ${seedPassword}`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
