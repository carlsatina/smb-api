-- MCP tokens can expire; existing tokens are given 90 days from now.

-- AlterTable
ALTER TABLE "McpToken" ADD COLUMN     "expiresAt" TIMESTAMP(3);

UPDATE "McpToken" SET "expiresAt" = NOW() + INTERVAL '90 days' WHERE "revokedAt" IS NULL;
