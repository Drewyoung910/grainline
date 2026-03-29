-- CreateEnum
CREATE TYPE "public"."NotificationType" AS ENUM ('NEW_MESSAGE', 'NEW_ORDER', 'ORDER_SHIPPED', 'ORDER_DELIVERED', 'CASE_OPENED', 'CASE_MESSAGE', 'CASE_RESOLVED', 'CUSTOM_ORDER_REQUEST', 'CUSTOM_ORDER_LINK', 'VERIFICATION_APPROVED', 'VERIFICATION_REJECTED', 'BACK_IN_STOCK', 'NEW_REVIEW', 'LOW_STOCK', 'NEW_FAVORITE', 'NEW_BLOG_COMMENT', 'BLOG_COMMENT_REPLY', 'NEW_FOLLOWER');

-- CreateTable
CREATE TABLE "public"."Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "type" "public"."NotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "link" TEXT,
    "read" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Notification_userId_read_idx" ON "public"."Notification"("userId", "read");

-- CreateIndex
CREATE INDEX "Notification_userId_createdAt_idx" ON "public"."Notification"("userId", "createdAt");

-- AddForeignKey
ALTER TABLE "public"."Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "public"."User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
