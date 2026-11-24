-- AlterTable
ALTER TABLE "ProtectionPlan" ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'entry',
ALTER COLUMN "entryOrderId" DROP NOT NULL;
