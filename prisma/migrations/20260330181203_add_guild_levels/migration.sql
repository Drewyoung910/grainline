-- CreateEnum
CREATE TYPE "public"."GuildLevel" AS ENUM ('NONE', 'GUILD_MEMBER', 'GUILD_MASTER');

-- AlterEnum
-- This migration adds more than one value to an enum.
-- With PostgreSQL versions 11 and earlier, this is not possible
-- in a single migration. This can be worked around by creating
-- multiple migrations, each migration adding only one value to
-- the enum.


ALTER TYPE "public"."VerificationStatus" ADD VALUE 'GUILD_MASTER_PENDING';
ALTER TYPE "public"."VerificationStatus" ADD VALUE 'GUILD_MASTER_APPROVED';
ALTER TYPE "public"."VerificationStatus" ADD VALUE 'GUILD_MASTER_REJECTED';

-- AlterTable
ALTER TABLE "public"."SellerProfile" ADD COLUMN     "guildLevel" "public"."GuildLevel" NOT NULL DEFAULT 'NONE',
ADD COLUMN     "guildMasterAppliedAt" TIMESTAMP(3),
ADD COLUMN     "guildMasterApprovedAt" TIMESTAMP(3),
ADD COLUMN     "guildMasterReviewNotes" TEXT,
ADD COLUMN     "guildMemberApprovedAt" TIMESTAMP(3);
