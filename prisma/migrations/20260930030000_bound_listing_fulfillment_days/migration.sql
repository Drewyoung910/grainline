ALTER TABLE public."Listing"
  ADD CONSTRAINT "Listing_ships_within_days_valid_chk"
  CHECK (
    "shipsWithinDays" IS NULL
    OR ("shipsWithinDays" >= 1 AND "shipsWithinDays" <= 365)
  ) NOT VALID;

ALTER TABLE public."Listing"
  VALIDATE CONSTRAINT "Listing_ships_within_days_valid_chk";
