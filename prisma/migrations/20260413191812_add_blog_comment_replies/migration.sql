-- AlterTable
ALTER TABLE "BlogComment" ADD COLUMN     "parentId" TEXT;

-- CreateIndex
CREATE INDEX "BlogComment_parentId_idx" ON "BlogComment"("parentId");

-- AddForeignKey
ALTER TABLE "BlogComment" ADD CONSTRAINT "BlogComment_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "BlogComment"("id") ON DELETE SET NULL ON UPDATE CASCADE;
