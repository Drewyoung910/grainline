-- CreateTable
CREATE TABLE "public"."SiteConfig" (
    "id" INTEGER NOT NULL DEFAULT 1,
    "fallbackShippingCents" INTEGER NOT NULL DEFAULT 1500,

    CONSTRAINT "SiteConfig_pkey" PRIMARY KEY ("id")
);
