-- AlterEnum
ALTER TYPE "Environment" ADD VALUE 'simulated';

-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "proposalId" TEXT,
ADD COLUMN     "protectionPlanId" TEXT,
ADD COLUMN     "simulatedLocal" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
ALTER TABLE "OrderProposal" ADD COLUMN     "status" TEXT NOT NULL DEFAULT 'OPEN',
ADD COLUMN     "tokenHash" TEXT,
ADD COLUMN     "usedAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "from" TEXT,
    "to" TEXT NOT NULL,
    "actor" TEXT NOT NULL,
    "reason" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SimLedger" (
    "accountId" TEXT NOT NULL,
    "state" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SimLedger_pkey" PRIMARY KEY ("accountId")
);

-- CreateTable
CREATE TABLE "IdempotencyKey" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "orderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "IdempotencyKey_pkey" PRIMARY KEY ("key")
);

-- CreateIndex
CREATE INDEX "OrderEvent_orderId_at_idx" ON "OrderEvent"("orderId", "at");

-- CreateIndex
CREATE UNIQUE INDEX "OrderProposal_tokenHash_key" ON "OrderProposal"("tokenHash");

-- CreateIndex
CREATE INDEX "OrderProposal_userId_createdAt_idx" ON "OrderProposal"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

