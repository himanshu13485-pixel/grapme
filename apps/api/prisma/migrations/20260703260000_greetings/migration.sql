-- Daily client login greeting: on/off flag + admin-authored messages.
ALTER TABLE "Tenant" ADD COLUMN "greetingsEnabled" BOOLEAN NOT NULL DEFAULT true;

CREATE TABLE "Greeting" (
  "id" TEXT NOT NULL,
  "tenantId" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Greeting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "Greeting_tenantId_idx" ON "Greeting"("tenantId");
ALTER TABLE "Greeting"
  ADD CONSTRAINT "Greeting_tenantId_fkey"
  FOREIGN KEY ("tenantId") REFERENCES "Tenant"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Seed a starter set of Happy Business messages for every existing tenant.
INSERT INTO "Greeting" ("id", "tenantId", "message", "sortOrder")
SELECT md5(t."id" || '|' || g.ord::text), t."id", g.msg, g.ord
FROM "Tenant" t
CROSS JOIN (VALUES
  ('Wishing you a productive day full of new opportunities!', 0),
  ('May your outreach turn into lasting partnerships today.', 1),
  ('Here''s to closing great deals and growing your business!', 2),
  ('Every email you send is a step toward success — keep going!', 3),
  ('Great businesses are built one connection at a time. Happy connecting!', 4),
  ('May today bring you promising leads and warm replies.', 5),
  ('Your next big client could be just one message away!', 6),
  ('Consistency wins — wishing you a day of strong results.', 7)
) AS g(msg, ord)
ON CONFLICT DO NOTHING;
