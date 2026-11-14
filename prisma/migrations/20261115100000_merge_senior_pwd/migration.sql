-- AlterTable
ALTER TABLE "DiscountType" ADD COLUMN     "holderTypes" JSONB NOT NULL DEFAULT '[]';


-- Merge each store's Senior Citizen and PWD presets into one "Senior Citizen / PWD"
-- discount. Sales keep their own SC/PWD code, so reports still separate them.
UPDATE "SaleDiscount" sd
SET "discountTypeId" = sc."id"
FROM "DiscountType" pwd
JOIN "DiscountType" sc ON sc."storeId" = pwd."storeId" AND sc."code" = 'SC' AND sc."statutory" = true
WHERE sd."discountTypeId" = pwd."id" AND pwd."code" = 'PWD' AND pwd."statutory" = true;

UPDATE "DiscountType" sc
SET "code" = 'SCPWD',
    "name" = 'Senior Citizen / PWD',
    "holderTypes" = '[{"code":"SC","name":"Senior Citizen"},{"code":"PWD","name":"Person with Disability"}]'::jsonb,
    "isActive" = sc."isActive" OR EXISTS (
        SELECT 1 FROM "DiscountType" pwd
        WHERE pwd."storeId" = sc."storeId" AND pwd."code" = 'PWD' AND pwd."statutory" = true AND pwd."isActive" = true
    ),
    "updatedAt" = CURRENT_TIMESTAMP
WHERE sc."code" = 'SC' AND sc."statutory" = true;

DELETE FROM "DiscountType" WHERE "code" = 'PWD' AND "statutory" = true;
