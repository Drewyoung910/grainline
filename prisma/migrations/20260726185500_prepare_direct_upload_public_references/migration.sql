-- Compatible public-source DirectUpload reference synchronization.
--
-- Family wrappers derive URLs and source identity from locked durable rows.
-- The generic array/source core is private and runtime-inaccessible.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

DO $grainline_direct_upload_public_reference_preflight$
DECLARE
  candidate_function_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO candidate_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND procedure.proname = ANY (ARRAY[
       'grainline_direct_upload_sync_public_core',
       'grainline_direct_upload_message_url_core',
       'grainline_direct_upload_sync_listing',
       'grainline_direct_upload_sync_seller_profile',
       'grainline_direct_upload_sync_review',
       'grainline_direct_upload_sync_blog_post',
       'grainline_direct_upload_sync_commission_request',
       'grainline_direct_upload_sync_seller_broadcast',
       'grainline_direct_upload_sync_legacy_message',
       'grainline_direct_upload_release_source_core',
       'grainline_direct_upload_source_delete_trigger'
     ]::text[]);
  IF candidate_function_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload public reference function names already exist: %',
      candidate_function_count;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
     WHERE namespace.nspname = 'public'
       AND procedure.proname = 'grainline_direct_upload_reference_core'
       AND procedure.prosecdef
  ) THEN
    RAISE EXCEPTION 'DirectUpload reference core is missing';
  END IF;
END
$grainline_direct_upload_public_reference_preflight$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_public_core(
  p_user_id text,
  p_source_type text,
  p_source_id text,
  p_allowed_endpoints text[],
  p_urls text[]
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_public_core$
DECLARE
  normalized_urls text[];
  matched_ids text[];
  locked_upload_id text;
  upload_id text;
  stale_reference record;
BEGIN
  IF p_user_id IS NULL
     OR NOT COALESCE(
       public.grainline_direct_upload_actor_valid(p_user_id),
       false
     )
     OR p_source_type IS NULL
     OR p_source_type NOT IN (
       'LISTING_PHOTO',
       'LISTING_VIDEO',
       'SELLER_PROFILE_BANNER',
       'SELLER_PROFILE_AVATAR',
       'SELLER_PROFILE_WORKSHOP',
       'SELLER_PROFILE_GALLERY',
       'REVIEW_PHOTO',
       'BLOG_POST_COVER',
       'COMMISSION_REFERENCE',
       'SELLER_BROADCAST_IMAGE',
       'LEGACY_MESSAGE_ATTACHMENT'
     )
     OR p_source_id IS NULL
     OR p_source_id = ''
     OR pg_catalog.char_length(p_source_id) > 191
     OR p_allowed_endpoints IS NULL
     OR pg_catalog.cardinality(p_allowed_endpoints) < 1
     OR pg_catalog.cardinality(p_allowed_endpoints) > 4
     OR p_urls IS NULL
     OR pg_catalog.cardinality(p_urls) > 40 THEN
    RAISE EXCEPTION 'DirectUpload public reference input is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(p_allowed_endpoints) AS endpoint(value)
     WHERE endpoint.value IS NULL
        OR endpoint.value NOT IN (
          'listingImage',
          'messageImage',
          'messageFile',
          'messageAny',
          'reviewPhoto',
          'listingVideo',
          'bannerImage',
          'galleryImage',
          'blogImage'
        )
  ) THEN
    RAISE EXCEPTION 'DirectUpload public endpoint set is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.unnest(p_urls) AS candidate(value)
     WHERE candidate.value IS NOT NULL
       AND (
         pg_catalog.char_length(pg_catalog.btrim(candidate.value)) > 2048
         OR candidate.value ~ '[[:cntrl:]]'
       )
  ) THEN
    RAISE EXCEPTION 'DirectUpload public URL set is invalid'
      USING ERRCODE = '22023';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(url.value ORDER BY url.value),
           ARRAY[]::text[]
         )
    INTO normalized_urls
    FROM (
      SELECT DISTINCT pg_catalog.btrim(candidate.value) AS value
        FROM pg_catalog.unnest(p_urls) AS candidate(value)
       WHERE candidate.value IS NOT NULL
         AND pg_catalog.btrim(candidate.value) <> ''
         AND pg_catalog.char_length(pg_catalog.btrim(candidate.value)) <= 2048
    ) AS url;

  -- Lock both the desired and currently referenced lifecycles in one stable
  -- order before any reference mutation. This prevents two source syncs that
  -- swap public objects from taking desired/stale locks in opposite orders.
  FOR locked_upload_id IN
    SELECT upload.id
      FROM public."DirectUpload" AS upload
      JOIN (
        SELECT candidate.id
          FROM public."DirectUpload" AS candidate
         WHERE candidate."userId" = p_user_id
           AND candidate."storageClass" = 'PUBLIC'
           AND candidate.endpoint = ANY (p_allowed_endpoints)
           AND candidate."publicUrl" = ANY (normalized_urls)
           AND candidate.status IN ('VERIFIED', 'CLAIMED')
        UNION
        SELECT reference."directUploadId"
          FROM public."DirectUploadReference" AS reference
         WHERE reference."sourceType" = p_source_type
           AND reference."sourceId" = p_source_id
           AND reference."releasedAt" IS NULL
      ) AS lock_set
        ON lock_set.id = upload.id
     ORDER BY upload.id
     FOR UPDATE OF upload
  LOOP
    NULL;
  END LOOP;

  SELECT COALESCE(
           pg_catalog.array_agg(upload.id ORDER BY upload.id),
           ARRAY[]::text[]
         )
    INTO matched_ids
    FROM public."DirectUpload" AS upload
   WHERE upload."userId" = p_user_id
     AND upload."storageClass" = 'PUBLIC'
     AND upload.endpoint = ANY (p_allowed_endpoints)
     AND upload."publicUrl" = ANY (normalized_urls)
     AND upload.status IN ('VERIFIED', 'CLAIMED');

  SELECT pg_catalog.count(*)::integer
    INTO untracked
    FROM pg_catalog.unnest(normalized_urls) AS url(value)
   WHERE NOT EXISTS (
     SELECT 1
       FROM public."DirectUpload" AS upload
      WHERE upload."userId" = p_user_id
        AND upload."storageClass" = 'PUBLIC'
        AND upload.endpoint = ANY (p_allowed_endpoints)
        AND upload."publicUrl" = url.value
        AND upload.status IN ('VERIFIED', 'CLAIMED')
   );

  referenced := pg_catalog.cardinality(matched_ids);
  FOR upload_id IN
    SELECT matched.value
      FROM pg_catalog.unnest(matched_ids) AS matched(value)
     ORDER BY matched.value
  LOOP
    PERFORM public.grainline_direct_upload_reference_core(
      upload_id,
      p_source_type,
      p_source_id
    );
  END LOOP;

  released := 0;
  -- A partially legacy or foreign URL set may add references for matched
  -- lifecycles, but it must never release an existing reference. This keeps
  -- the compatible edit path from turning an ignored untracked count into a
  -- destructive cleanup capability.
  IF untracked = 0 THEN
    FOR stale_reference IN
      SELECT
        reference."directUploadId",
        reference."sourceType",
        reference."sourceId"
        FROM public."DirectUploadReference" AS reference
       WHERE reference."sourceType" = p_source_type
         AND reference."sourceId" = p_source_id
         AND reference."releasedAt" IS NULL
         AND NOT (
           reference."directUploadId" = ANY (matched_ids)
         )
       ORDER BY reference."directUploadId"
    LOOP
      IF public.grainline_direct_upload_release_core(
        stale_reference."directUploadId",
        stale_reference."sourceType",
        stale_reference."sourceId",
        'SOURCE_SYNC'
      ) THEN
        released := released + 1;
      END IF;
    END LOOP;
  END IF;

  RETURN NEXT;
END;
$grainline_direct_upload_sync_public_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_public_core(
    text, text, text, text[], text[]
  )
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_message_url_core(
  p_kind text,
  p_body text
)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
PARALLEL SAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_direct_upload_message_url_core$
DECLARE
  payload jsonb;
  attachment_url text;
BEGIN
  IF p_kind IS DISTINCT FROM 'file'
     OR p_body IS NULL
     OR pg_catalog.char_length(p_body) > 5000 THEN
    RETURN NULL;
  END IF;
  BEGIN
    payload := p_body::jsonb;
  EXCEPTION WHEN OTHERS THEN
    RETURN NULL;
  END;
  attachment_url := pg_catalog.btrim(payload ->> 'url');
  IF attachment_url = ''
     OR pg_catalog.char_length(attachment_url) > 2048 THEN
    RETURN NULL;
  END IF;
  RETURN attachment_url;
END;
$grainline_direct_upload_message_url_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_message_url_core(text, text)
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_listing(
  p_user_id text,
  p_listing_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_listing$
DECLARE
  owner_id text;
  video_url text;
  photo_urls text[];
  photo_result record;
  video_result record;
BEGIN
  SELECT seller."userId", listing."videoUrl"
    INTO owner_id, video_url
    FROM public."Listing" AS listing
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE listing.id = p_listing_id
   FOR UPDATE OF listing;
  IF NOT FOUND OR owner_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Listing upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT COALESCE(
           pg_catalog.array_agg(url.value ORDER BY url.value),
           ARRAY[]::text[]
         )
    INTO photo_urls
    FROM (
      SELECT photo.url AS value
        FROM public."Photo" AS photo
       WHERE photo."listingId" = p_listing_id
      UNION
      SELECT photo."originalUrl"
        FROM public."Photo" AS photo
       WHERE photo."listingId" = p_listing_id
         AND photo."originalUrl" IS NOT NULL
    ) AS url;

  SELECT * INTO photo_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'LISTING_PHOTO',
      p_listing_id,
      ARRAY['listingImage']::text[],
      photo_urls
    );
  SELECT * INTO video_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'LISTING_VIDEO',
      p_listing_id,
      ARRAY['listingVideo']::text[],
      ARRAY[video_url]::text[]
    );

  referenced := photo_result.referenced + video_result.referenced;
  released := photo_result.released + video_result.released;
  untracked := photo_result.untracked + video_result.untracked;
  RETURN NEXT;
END;
$grainline_direct_upload_sync_listing$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_seller_profile(
  p_user_id text,
  p_seller_profile_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_seller_profile$
DECLARE
  profile record;
  banner_result record;
  avatar_result record;
  workshop_result record;
  gallery_result record;
BEGIN
  SELECT
    seller."userId",
    seller."bannerImageUrl",
    seller."avatarImageUrl",
    seller."workshopImageUrl",
    seller."galleryImageUrls"
    INTO profile
    FROM public."SellerProfile" AS seller
   WHERE seller.id = p_seller_profile_id
   FOR UPDATE;
  IF NOT FOUND OR profile."userId" IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'SellerProfile upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;

  SELECT * INTO banner_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'SELLER_PROFILE_BANNER',
      p_seller_profile_id,
      ARRAY['bannerImage']::text[],
      ARRAY[profile."bannerImageUrl"]::text[]
    );
  SELECT * INTO avatar_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'SELLER_PROFILE_AVATAR',
      p_seller_profile_id,
      ARRAY['galleryImage']::text[],
      ARRAY[profile."avatarImageUrl"]::text[]
    );
  SELECT * INTO workshop_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'SELLER_PROFILE_WORKSHOP',
      p_seller_profile_id,
      ARRAY['galleryImage']::text[],
      ARRAY[profile."workshopImageUrl"]::text[]
    );
  SELECT * INTO gallery_result
    FROM public.grainline_direct_upload_sync_public_core(
      p_user_id,
      'SELLER_PROFILE_GALLERY',
      p_seller_profile_id,
      ARRAY['galleryImage']::text[],
      COALESCE(profile."galleryImageUrls", ARRAY[]::text[])
    );

  referenced :=
    banner_result.referenced
    + avatar_result.referenced
    + workshop_result.referenced
    + gallery_result.referenced;
  released :=
    banner_result.released
    + avatar_result.released
    + workshop_result.released
    + gallery_result.released;
  untracked :=
    banner_result.untracked
    + avatar_result.untracked
    + workshop_result.untracked
    + gallery_result.untracked;
  RETURN NEXT;
END;
$grainline_direct_upload_sync_seller_profile$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_review(
  p_user_id text,
  p_review_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_review$
DECLARE
  reviewer_id text;
  urls text[];
BEGIN
  SELECT review."reviewerId"
    INTO reviewer_id
    FROM public."Review" AS review
   WHERE review.id = p_review_id
   FOR UPDATE;
  IF NOT FOUND OR reviewer_id IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Review upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;
  SELECT COALESCE(
           pg_catalog.array_agg(photo.url ORDER BY photo.id),
           ARRAY[]::text[]
         )
    INTO urls
    FROM public."ReviewPhoto" AS photo
   WHERE photo."reviewId" = p_review_id;
  RETURN QUERY
  SELECT * FROM public.grainline_direct_upload_sync_public_core(
    p_user_id,
    'REVIEW_PHOTO',
    p_review_id,
    ARRAY['reviewPhoto']::text[],
    urls
  );
END;
$grainline_direct_upload_sync_review$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_blog_post(
  p_user_id text,
  p_blog_post_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_blog_post$
DECLARE
  post record;
BEGIN
  SELECT
    blog."authorId",
    blog."coverImageUrl"
    INTO post
    FROM public."BlogPost" AS blog
   WHERE blog.id = p_blog_post_id
   FOR UPDATE OF blog;
  IF NOT FOUND
     OR p_user_id IS DISTINCT FROM post."authorId" THEN
    RAISE EXCEPTION 'BlogPost upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM public.grainline_direct_upload_sync_public_core(
    p_user_id,
    'BLOG_POST_COVER',
    p_blog_post_id,
    ARRAY['galleryImage', 'blogImage']::text[],
    ARRAY[post."coverImageUrl"]::text[]
  );
END;
$grainline_direct_upload_sync_blog_post$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_commission_request(
  p_user_id text,
  p_commission_request_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_commission_request$
DECLARE
  request record;
BEGIN
  SELECT commission."buyerId", commission."referenceImageUrls"
    INTO request
    FROM public."CommissionRequest" AS commission
   WHERE commission.id = p_commission_request_id
   FOR UPDATE;
  IF NOT FOUND OR request."buyerId" IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'CommissionRequest upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM public.grainline_direct_upload_sync_public_core(
    p_user_id,
    'COMMISSION_REFERENCE',
    p_commission_request_id,
    ARRAY['messageImage']::text[],
    COALESCE(request."referenceImageUrls", ARRAY[]::text[])
  );
END;
$grainline_direct_upload_sync_commission_request$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_seller_broadcast(
  p_user_id text,
  p_seller_broadcast_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_seller_broadcast$
DECLARE
  broadcast record;
BEGIN
  SELECT seller."userId", broadcast_row."imageUrl"
    INTO broadcast
    FROM public."SellerBroadcast" AS broadcast_row
    JOIN public."SellerProfile" AS seller
      ON seller.id = broadcast_row."sellerProfileId"
   WHERE broadcast_row.id = p_seller_broadcast_id
   FOR UPDATE OF broadcast_row;
  IF NOT FOUND OR broadcast."userId" IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'SellerBroadcast upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;
  RETURN QUERY
  SELECT * FROM public.grainline_direct_upload_sync_public_core(
    p_user_id,
    'SELLER_BROADCAST_IMAGE',
    p_seller_broadcast_id,
    ARRAY['listingImage', 'bannerImage', 'galleryImage']::text[],
    ARRAY[broadcast."imageUrl"]::text[]
  );
END;
$grainline_direct_upload_sync_seller_broadcast$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_sync_legacy_message(
  p_user_id text,
  p_message_id text
)
RETURNS TABLE (
  referenced integer,
  released integer,
  untracked integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_sync_legacy_message$
DECLARE
  message_source record;
  attachment_url text;
BEGIN
  SELECT message_row."senderId", message_row.kind, message_row.body
    INTO message_source
    FROM public."Message" AS message_row
   WHERE message_row.id = p_message_id
   FOR UPDATE;
  IF NOT FOUND OR message_source."senderId" IS DISTINCT FROM p_user_id THEN
    RAISE EXCEPTION 'Message upload source is not owned by actor'
      USING ERRCODE = '42501';
  END IF;
  attachment_url := public.grainline_direct_upload_message_url_core(
    message_source.kind,
    message_source.body
  );
  IF attachment_url IS NULL THEN
    RAISE EXCEPTION 'Message does not contain a valid legacy attachment'
      USING ERRCODE = '23514';
  END IF;
  RETURN QUERY
  SELECT * FROM public.grainline_direct_upload_sync_public_core(
    p_user_id,
    'LEGACY_MESSAGE_ATTACHMENT',
    p_message_id,
    ARRAY['messageImage', 'messageFile', 'messageAny']::text[],
    ARRAY[attachment_url]::text[]
  );
END;
$grainline_direct_upload_sync_legacy_message$;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_release_source_core(
  p_source_types text[],
  p_source_id text,
  p_release_reason text
)
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_release_source_core$
DECLARE
  locked_upload_id text;
  active_reference record;
  released_count integer := 0;
BEGIN
  IF p_source_types IS NULL
     OR pg_catalog.cardinality(p_source_types) < 1
     OR pg_catalog.cardinality(p_source_types) > 4
     OR p_source_id IS NULL
     OR p_source_id = ''
     OR pg_catalog.char_length(p_source_id) > 191
     OR p_release_reason IS DISTINCT FROM 'SOURCE_DELETED'
     OR EXISTS (
       SELECT 1
         FROM pg_catalog.unnest(p_source_types) AS source_type(value)
        WHERE source_type.value IS NULL
           OR source_type.value NOT IN (
             'LISTING_PHOTO',
             'LISTING_VIDEO',
             'SELLER_PROFILE_BANNER',
             'SELLER_PROFILE_AVATAR',
             'SELLER_PROFILE_WORKSHOP',
             'SELLER_PROFILE_GALLERY',
             'REVIEW_PHOTO',
             'BLOG_POST_COVER',
             'COMMISSION_REFERENCE',
             'SELLER_BROADCAST_IMAGE',
             'LEGACY_MESSAGE_ATTACHMENT'
           )
     ) THEN
    RAISE EXCEPTION 'DirectUpload source release input is invalid'
      USING ERRCODE = '22023';
  END IF;

  FOR locked_upload_id IN
    SELECT upload.id
      FROM public."DirectUpload" AS upload
      JOIN (
        SELECT DISTINCT reference."directUploadId" AS id
          FROM public."DirectUploadReference" AS reference
         WHERE reference."sourceType" = ANY (p_source_types)
           AND reference."sourceId" = p_source_id
           AND reference."releasedAt" IS NULL
      ) AS lock_set
        ON lock_set.id = upload.id
     ORDER BY upload.id
     FOR UPDATE OF upload
  LOOP
    NULL;
  END LOOP;

  FOR active_reference IN
    SELECT
      reference."directUploadId",
      reference."sourceType",
      reference."sourceId"
      FROM public."DirectUploadReference" AS reference
     WHERE reference."sourceType" = ANY (p_source_types)
       AND reference."sourceId" = p_source_id
       AND reference."releasedAt" IS NULL
     ORDER BY
       reference."directUploadId",
       reference."sourceType",
       reference."sourceId"
  LOOP
    IF public.grainline_direct_upload_release_core(
      active_reference."directUploadId",
      active_reference."sourceType",
      active_reference."sourceId",
      p_release_reason
    ) THEN
      released_count := released_count + 1;
    END IF;
  END LOOP;

  RETURN released_count;
END;
$grainline_direct_upload_release_source_core$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_release_source_core(text[], text, text)
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_source_delete_trigger()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_source_delete_trigger$
BEGIN
  CASE TG_TABLE_NAME
    WHEN 'Listing' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['LISTING_PHOTO', 'LISTING_VIDEO']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'SellerProfile' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY[
          'SELLER_PROFILE_BANNER',
          'SELLER_PROFILE_AVATAR',
          'SELLER_PROFILE_WORKSHOP',
          'SELLER_PROFILE_GALLERY'
        ]::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'Review' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['REVIEW_PHOTO']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'BlogPost' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['BLOG_POST_COVER']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'CommissionRequest' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['COMMISSION_REFERENCE']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'SellerBroadcast' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['SELLER_BROADCAST_IMAGE']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    WHEN 'Message' THEN
      PERFORM public.grainline_direct_upload_release_source_core(
        ARRAY['LEGACY_MESSAGE_ATTACHMENT']::text[],
        OLD.id,
        'SOURCE_DELETED'
      );
    ELSE
      RAISE EXCEPTION 'Unexpected DirectUpload source delete table: %',
        TG_TABLE_NAME
        USING ERRCODE = '0A000';
  END CASE;
  RETURN OLD;
END;
$grainline_direct_upload_source_delete_trigger$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_source_delete_trigger()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_release_listing_delete
BEFORE DELETE ON public."Listing"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_seller_profile_delete
BEFORE DELETE ON public."SellerProfile"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_review_delete
BEFORE DELETE ON public."Review"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_blog_post_delete
BEFORE DELETE ON public."BlogPost"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_commission_request_delete
BEFORE DELETE ON public."CommissionRequest"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_seller_broadcast_delete
BEFORE DELETE ON public."SellerBroadcast"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

CREATE TRIGGER grainline_direct_upload_release_legacy_message_delete
BEFORE DELETE ON public."Message"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_source_delete_trigger();

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_listing(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_seller_profile(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_review(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_blog_post(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_commission_request(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_seller_broadcast(text, text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_sync_legacy_message(text, text)
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_listing(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_seller_profile(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_review(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_blog_post(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_commission_request(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_seller_broadcast(text, text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION
  public.grainline_direct_upload_sync_legacy_message(text, text)
  TO grainline_app_runtime;

DO $grainline_direct_upload_public_reference_postflight$
DECLARE
  runtime_grant_count integer;
  private_core_grant_count integer;
  public_grant_count integer;
  source_delete_trigger_count integer;
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO runtime_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'grainline_app_runtime'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name = ANY (ARRAY[
       'grainline_direct_upload_sync_listing',
       'grainline_direct_upload_sync_seller_profile',
       'grainline_direct_upload_sync_review',
       'grainline_direct_upload_sync_blog_post',
       'grainline_direct_upload_sync_commission_request',
       'grainline_direct_upload_sync_seller_broadcast',
       'grainline_direct_upload_sync_legacy_message'
     ]::text[]);
  IF runtime_grant_count <> 7 THEN
    RAISE EXCEPTION
      'DirectUpload public-source runtime grants are incomplete: %',
      runtime_grant_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO private_core_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'grainline_app_runtime'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name IN (
       'grainline_direct_upload_sync_public_core',
       'grainline_direct_upload_message_url_core',
       'grainline_direct_upload_release_source_core',
       'grainline_direct_upload_source_delete_trigger'
     );
  IF private_core_grant_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload public-source cores must remain runtime-inaccessible';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO source_delete_trigger_count
    FROM pg_catalog.pg_trigger AS trigger
    JOIN pg_catalog.pg_class AS class
      ON class.oid = trigger.tgrelid
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND trigger.tgname = ANY (ARRAY[
       'grainline_direct_upload_release_listing_delete',
       'grainline_direct_upload_release_seller_profile_delete',
       'grainline_direct_upload_release_review_delete',
       'grainline_direct_upload_release_blog_post_delete',
       'grainline_direct_upload_release_commission_request_delete',
       'grainline_direct_upload_release_seller_broadcast_delete',
       'grainline_direct_upload_release_legacy_message_delete'
     ]::text[])
     AND NOT trigger.tgisinternal;
  IF source_delete_trigger_count <> 7 THEN
    RAISE EXCEPTION
      'DirectUpload source delete triggers are incomplete: %',
      source_delete_trigger_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO public_grant_count
    FROM information_schema.routine_privileges AS privilege
   WHERE privilege.routine_schema = 'public'
     AND privilege.grantee = 'PUBLIC'
     AND privilege.privilege_type = 'EXECUTE'
     AND privilege.routine_name LIKE 'grainline_direct_upload_%';
  IF public_grant_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload functions must remain non-PUBLIC: %',
      public_grant_count;
  END IF;
END
$grainline_direct_upload_public_reference_postflight$;

COMMIT;
