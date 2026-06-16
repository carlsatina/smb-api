-- CreateEnum
CREATE TYPE "AiProvider" AS ENUM ('OPENAI', 'ANTHROPIC');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "aiApiKeyEncrypted" TEXT,
ADD COLUMN     "aiApiKeyLast4" TEXT,
ADD COLUMN     "aiModel" TEXT,
ADD COLUMN     "aiProvider" "AiProvider";
