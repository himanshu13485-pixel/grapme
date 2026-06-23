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

  const password = await argon2.hash('Password123!', { type: argon2.argon2id });

  const accounts: Array<{ name: string; email: string; role: Role }> = [
    { name: 'Super Admin', email: 'admin@aeo.test', role: Role.SUPER_ADMIN },
    { name: 'Sub Admin', email: 'subadmin@aeo.test', role: Role.SUB_ADMIN },
    { name: 'Demo User', email: 'user@aeo.test', role: Role.USER },
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
  console.log('Seed complete. Login with admin@aeo.test / Password123!');
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
