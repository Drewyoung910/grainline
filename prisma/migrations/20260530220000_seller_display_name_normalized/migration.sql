ALTER TABLE "SellerProfile"
  ADD COLUMN "displayNameNormalized" VARCHAR(100);

UPDATE "SellerProfile"
SET "displayNameNormalized" = COALESCE(
  NULLIF(
    LEFT(
      BTRIM(
        regexp_replace(
          translate(
            regexp_replace(
              "displayName",
              U&'[\061C\200E\200F\202A-\202E\2066-\2069\200B-\200D\FEFF]',
              '',
              'g'
            ),
            U&'\0410\0430\0412\0415\0435\0406\0456\041A\043A\041C\041D\041E\043E\0420\0440\0421\0441\0422\0442\0423\0443\0425\0445\0408\0458',
            'AaBEeIiKkMHOoPpCcTtYyXxJj'
          ),
          '[[:space:]]+',
          ' ',
          'g'
        )
      ),
      100
    ),
    ''
  ),
  'Maker'
);

ALTER TABLE "SellerProfile"
  ALTER COLUMN "displayNameNormalized" SET NOT NULL;

CREATE INDEX "SellerProfile_displayNameNormalized_idx"
  ON "SellerProfile"("displayNameNormalized");
