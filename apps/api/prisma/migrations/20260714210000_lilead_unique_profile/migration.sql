-- Deduplicate a campaign's Target Audience: one row per (campaign, profileUrl).

-- Drop existing duplicates, keeping the earliest per (campaignId, profileUrl).
DELETE FROM "LiLead" a USING "LiLead" b
 WHERE a."profileUrl" IS NOT NULL
   AND a."campaignId" = b."campaignId"
   AND a."profileUrl" = b."profileUrl"
   AND (a."createdAt" > b."createdAt" OR (a."createdAt" = b."createdAt" AND a."id" > b."id"));

-- Enforce uniqueness going forward (NULL profileUrls are allowed to repeat).
CREATE UNIQUE INDEX "LiLead_campaignId_profileUrl_key" ON "LiLead"("campaignId", "profileUrl");
