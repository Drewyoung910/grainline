-- CreateEnum
CREATE TYPE "public"."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');

-- AlterTable
ALTER TABLE "public"."User" ADD COLUMN     "role" "public"."Role" NOT NULL DEFAULT 'USER';
