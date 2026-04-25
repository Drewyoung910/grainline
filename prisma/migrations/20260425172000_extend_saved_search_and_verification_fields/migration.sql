-- Preserve full browse filter state when a user saves a search.
ALTER TABLE "SavedSearch"
  ADD COLUMN "listingType" "ListingType",
  ADD COLUMN "shipsWithinDays" INTEGER,
  ADD COLUMN "minRating" INTEGER,
  ADD COLUMN "lat" DOUBLE PRECISION,
  ADD COLUMN "lng" DOUBLE PRECISION,
  ADD COLUMN "radiusMiles" INTEGER,
  ADD COLUMN "sort" TEXT;

-- Persist the Guild Master application narrative separately from the original
-- Guild Member craft description.
ALTER TABLE "MakerVerification"
  ADD COLUMN "guildMasterCraftBusiness" TEXT;
