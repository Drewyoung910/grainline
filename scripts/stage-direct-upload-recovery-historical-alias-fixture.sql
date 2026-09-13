\set ON_ERROR_STOP on

-- Disposable PostgreSQL 16 proof fixture only. This recreates the exact
-- historical listing-variants ledger alias observed by the protected read-only
-- production inspection. It must never run against a non-loopback database.

DO $grainline_direct_upload_historical_alias_fixture$
DECLARE
  current_checksum text;
  current_row_count integer;
  historical_row_count integer;
BEGIN
  IF current_database() <> 'grainline_ci' OR current_user <> 'ci' THEN
    RAISE EXCEPTION
      'DirectUpload historical-alias fixture requires grainline_ci as ci';
  END IF;

  SELECT
    pg_catalog.count(*)::integer,
    pg_catalog.min(checksum)
  INTO current_row_count, current_checksum
  FROM public._prisma_migrations
  WHERE migration_name = '20260423_add_listing_variants'
    AND finished_at IS NOT NULL
    AND rolled_back_at IS NULL
    AND applied_steps_count = 1;

  IF current_row_count <> 1
     OR current_checksum IS NULL
     OR (
       SELECT pg_catalog.count(*)
       FROM public._prisma_migrations
       WHERE migration_name = '20260423_add_listing_variants'
     ) <> 1 THEN
    RAISE EXCEPTION
      'Reviewed listing-variants migration row is not exact before alias staging';
  END IF;

  SELECT pg_catalog.count(*)::integer
  INTO historical_row_count
  FROM public._prisma_migrations
  WHERE migration_name = '20260423000000_add_listing_variants';

  IF historical_row_count <> 0 THEN
    RAISE EXCEPTION
      'Historical listing-variants alias already exists before fixture staging';
  END IF;

  INSERT INTO public._prisma_migrations (
    id,
    checksum,
    finished_at,
    migration_name,
    logs,
    rolled_back_at,
    started_at,
    applied_steps_count
  ) VALUES (
    '00000000-0000-4000-8000-000000000143',
    current_checksum,
    NULL,
    '20260423000000_add_listing_variants',
    '',
    pg_catalog.clock_timestamp(),
    pg_catalog.clock_timestamp(),
    0
  );

  IF (
    SELECT pg_catalog.count(*)
    FROM public._prisma_migrations
    WHERE migration_name = '20260423000000_add_listing_variants'
      AND checksum = current_checksum
      AND finished_at IS NULL
      AND rolled_back_at IS NOT NULL
      AND applied_steps_count = 0
  ) <> 1 THEN
    RAISE EXCEPTION
      'Historical listing-variants alias fixture was not staged exactly';
  END IF;
END
$grainline_direct_upload_historical_alias_fixture$;
