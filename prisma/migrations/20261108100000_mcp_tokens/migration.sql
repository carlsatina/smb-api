-- Access tokens for AI apps connecting through the MCP server. A token belongs
-- to an owner and covers the stores they picked.

-- CreateEnum
CREATE TYPE "McpTokenAccess" AS ENUM ('READ_ONLY', 'READ_WRITE');

-- CreateTable
CREATE TABLE "McpToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "tokenPrefix" TEXT NOT NULL,
    "access" "McpTokenAccess" NOT NULL DEFAULT 'READ_ONLY',
    "lastUsedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "McpToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "McpTokenStore" (
    "tokenId" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,

    CONSTRAINT "McpTokenStore_pkey" PRIMARY KEY ("tokenId","storeId")
);

-- CreateIndex
CREATE UNIQUE INDEX "McpToken_tokenHash_key" ON "McpToken"("tokenHash");

-- CreateIndex
CREATE INDEX "McpToken_userId_revokedAt_idx" ON "McpToken"("userId", "revokedAt");

-- CreateIndex
CREATE INDEX "McpTokenStore_storeId_idx" ON "McpTokenStore"("storeId");

-- AddForeignKey
ALTER TABLE "McpToken" ADD CONSTRAINT "McpToken_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpTokenStore" ADD CONSTRAINT "McpTokenStore_tokenId_fkey" FOREIGN KEY ("tokenId") REFERENCES "McpToken"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "McpTokenStore" ADD CONSTRAINT "McpTokenStore_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE;
