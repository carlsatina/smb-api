-- AlterTable
ALTER TABLE "StoreMember" ADD COLUMN     "permissionOverrides" JSONB NOT NULL DEFAULT '{}';
