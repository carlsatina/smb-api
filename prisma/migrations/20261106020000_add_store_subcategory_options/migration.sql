-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "subcategoryOptions" JSONB NOT NULL DEFAULT '{}';

-- Backfill: register subcategories already set on products, per store and category.
UPDATE "Store" s
SET "subcategoryOptions" = agg.opts
FROM (
    SELECT t."storeId", jsonb_object_agg(t."category", t.subs) AS opts
    FROM (
        SELECT p."storeId", p."category", jsonb_agg(DISTINCT p."subcategory" ORDER BY p."subcategory") AS subs
        FROM "Product" p
        WHERE p."deletedAt" IS NULL
          AND p."category" IS NOT NULL
          AND p."subcategory" IS NOT NULL
        GROUP BY p."storeId", p."category"
    ) t
    GROUP BY t."storeId"
) agg
WHERE s."id" = agg."storeId";
