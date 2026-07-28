-- Normalize the exact prelaunch DirectUpload legacy population after the
-- compatible application drain.
--
-- Fresh databases have no DirectUpload rows and take the explicit no-op path.
-- The production path accepts only the aggregate shape inspected on
-- 2026-07-28: three valid public listing-image lifecycle rows, all CLAIMED
-- under obsolete claim labels, with no normalized references or Case
-- attachments. Durable targets and reference identity are derived through the
-- already-reviewed family functions. Historical durable URLs without a
-- lifecycle row are deliberately not materialized.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

LOCK TABLE
  public."DirectUpload",
  public."DirectUploadReference",
  public."CaseMessageAttachment",
  public."Photo",
  public."Listing",
  public."SellerProfile",
  public."ReviewPhoto",
  public."Review",
  public."BlogPost",
  public."CommissionRequest",
  public."SellerBroadcast",
  public."Message",
  public."User"
IN SHARE ROW EXCLUSIVE MODE;

DO $grainline_direct_upload_legacy_repair$
DECLARE
  upload_count integer;
  reference_count integer;
  invalid_upload_count integer;
  unknown_claim_count integer;
  case_attachment_count integer;
  matching_source_count integer;
  active_reference_count integer;
  referenced_upload_count integer;
  normalized_upload_count integer;
  orphan_upload_count integer;
  postflight_invalid_count integer;
  source_record record;
  sync_record record;
  referenced_total integer := 0;
  repair_at timestamp(3) :=
    public.grainline_direct_upload_utc_now();
BEGIN
  SELECT pg_catalog.count(*)::integer
    INTO upload_count
    FROM public."DirectUpload";
  SELECT pg_catalog.count(*)::integer
    INTO reference_count
    FROM public."DirectUploadReference";

  IF upload_count = 0 AND reference_count = 0 THEN
    RETURN;
  END IF;

  IF upload_count <> 3 OR reference_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair scope drifted: uploads=% references=%',
      upload_count,
      reference_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO case_attachment_count
    FROM public."CaseMessageAttachment";
  IF case_attachment_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair refuses Case attachment rows: %',
      case_attachment_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO invalid_upload_count
    FROM public."DirectUpload" AS upload
    LEFT JOIN public."User" AS owner
      ON owner.id = upload."userId"
   WHERE owner.id IS NULL
      OR owner.banned
      OR owner."deletedAt" IS NOT NULL
      OR upload.endpoint IS DISTINCT FROM 'listingImage'
      OR upload."storageClass" IS DISTINCT FROM 'PUBLIC'
      OR upload.status IS DISTINCT FROM 'CLAIMED'
      OR upload.key NOT LIKE 'listingImage/%'
      OR pg_catalog.position('..' IN upload.key) > 0
      OR upload.key ~ '[[:cntrl:]]'
      OR upload."publicUrl" IS NULL
      OR upload."publicUrl" NOT LIKE 'https://%'
      OR pg_catalog.right(
           upload."publicUrl",
           pg_catalog.char_length(upload.key) + 1
         ) IS DISTINCT FROM '/' || upload.key
      OR upload."contentType" NOT IN (
           'image/jpeg',
           'image/png',
           'image/webp'
         )
      OR upload."expectedSize" <= 0
      OR upload."expectedSize" > 12582912
      OR upload."verifiedAt" IS NULL
      OR upload."claimedAt" IS NULL
      OR upload."claimedByType" IS NULL
      OR upload."claimedById" IS NULL
      OR upload."cleanupAfter" IS NOT NULL
      OR upload."cleanupLeaseId" IS NOT NULL
      OR upload."cleanupLeaseAt" IS NOT NULL
      OR upload."deletedAt" IS NOT NULL
      OR upload.attempts < 0
      OR upload."createdAt" > upload."updatedAt";
  IF invalid_upload_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair found invalid lifecycle rows: %',
      invalid_upload_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO unknown_claim_count
    FROM public."DirectUpload" AS upload
   WHERE upload."claimedByType" NOT IN (
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
     'LEGACY_MESSAGE_ATTACHMENT',
     'CASE_MESSAGE_ATTACHMENT',
     'MESSAGE_ATTACHMENT'
   );
  IF unknown_claim_count <> 3 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair claim-label scope drifted: %',
      unknown_claim_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = 'DirectUpload'
       AND (
         relation.relkind IS DISTINCT FROM 'r'
         OR relation.relrowsecurity
         OR relation.relforcerowsecurity
       )
  )
     OR NOT EXISTS (
       SELECT 1
         FROM pg_catalog.pg_class AS relation
         JOIN pg_catalog.pg_namespace AS namespace
           ON namespace.oid = relation.relnamespace
        WHERE namespace.nspname = 'public'
          AND relation.relname = 'DirectUploadReference'
          AND relation.relkind = 'r'
          AND relation.relrowsecurity
          AND relation.relforcerowsecurity
     )
     OR NOT pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."DirectUpload"',
       'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."DirectUploadReference"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair database posture drifted';
  END IF;

  -- Invoke only durable sources that currently match one of the three locked
  -- lifecycle rows. The family functions re-read and validate each target;
  -- the migration never trusts legacy claimedByType/claimedById values.
  FOR source_record IN
    SELECT listing.id, seller."userId" AS user_id
      FROM public."Listing" AS listing
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = seller."userId"
          AND (
            (
              upload.endpoint = 'listingImage'
              AND EXISTS (
                SELECT 1
                  FROM public."Photo" AS photo
                 WHERE photo."listingId" = listing.id
                   AND upload."publicUrl" IN (
                     photo.url,
                     photo."originalUrl"
                   )
              )
            )
            OR (
              upload.endpoint = 'listingVideo'
              AND upload."publicUrl" = listing."videoUrl"
            )
          )
     )
     ORDER BY listing.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_listing(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT seller.id, seller."userId" AS user_id
      FROM public."SellerProfile" AS seller
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = seller."userId"
          AND (
            (
              upload.endpoint = 'bannerImage'
              AND upload."publicUrl" = seller."bannerImageUrl"
            )
            OR (
              upload.endpoint = 'galleryImage'
              AND (
                upload."publicUrl" = seller."avatarImageUrl"
                OR upload."publicUrl" = seller."workshopImageUrl"
                OR upload."publicUrl" = ANY(
                  COALESCE(
                    seller."galleryImageUrls",
                    ARRAY[]::text[]
                  )
                )
              )
            )
          )
     )
     ORDER BY seller.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_seller_profile(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT review.id, review."reviewerId" AS user_id
      FROM public."Review" AS review
     WHERE EXISTS (
       SELECT 1
         FROM public."ReviewPhoto" AS photo
         JOIN public."DirectUpload" AS upload
           ON upload."userId" = review."reviewerId"
          AND upload.endpoint = 'reviewPhoto'
          AND upload."publicUrl" = photo.url
        WHERE photo."reviewId" = review.id
     )
     ORDER BY review.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_review(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT post.id, post."authorId" AS user_id
      FROM public."BlogPost" AS post
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = post."authorId"
          AND upload.endpoint IN ('galleryImage', 'blogImage')
          AND upload."publicUrl" = post."coverImageUrl"
     )
     ORDER BY post.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_blog_post(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT request.id, request."buyerId" AS user_id
      FROM public."CommissionRequest" AS request
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = request."buyerId"
          AND upload.endpoint = 'messageImage'
          AND upload."publicUrl" = ANY(
            COALESCE(
              request."referenceImageUrls",
              ARRAY[]::text[]
            )
          )
     )
     ORDER BY request.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_commission_request(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT broadcast.id, seller."userId" AS user_id
      FROM public."SellerBroadcast" AS broadcast
      JOIN public."SellerProfile" AS seller
        ON seller.id = broadcast."sellerProfileId"
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = seller."userId"
          AND upload.endpoint IN (
            'listingImage',
            'bannerImage',
            'galleryImage'
          )
          AND upload."publicUrl" = broadcast."imageUrl"
     )
     ORDER BY broadcast.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_seller_broadcast(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  FOR source_record IN
    SELECT message.id, message."senderId" AS user_id
      FROM public."Message" AS message
     WHERE EXISTS (
       SELECT 1
         FROM public."DirectUpload" AS upload
        WHERE upload."userId" = message."senderId"
          AND upload.endpoint IN (
            'messageImage',
            'messageFile',
            'messageAny'
          )
          AND upload."publicUrl" =
            public.grainline_direct_upload_message_url_core(
              message.kind,
              message.body
            )
     )
     ORDER BY message.id
  LOOP
    SELECT *
      INTO STRICT sync_record
      FROM public.grainline_direct_upload_sync_legacy_message(
        source_record.user_id,
        source_record.id
      );
    referenced_total :=
      referenced_total + COALESCE(sync_record.referenced, 0);
  END LOOP;

  SELECT pg_catalog.count(*)::integer
    INTO matching_source_count
    FROM public."DirectUploadReference" AS reference
   WHERE reference."releasedAt" IS NULL;
  IF referenced_total <> 2 OR matching_source_count <> 2 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair derived unexpected references: returned=% active=%',
      referenced_total,
      matching_source_count;
  END IF;

  WITH canonical_reference AS MATERIALIZED (
    SELECT DISTINCT ON (reference."directUploadId")
      reference."directUploadId",
      reference."sourceType",
      reference."sourceId",
      reference."createdAt"
      FROM public."DirectUploadReference" AS reference
     WHERE reference."releasedAt" IS NULL
     ORDER BY
       reference."directUploadId",
       reference."sourceType",
       reference."sourceId"
  )
  UPDATE public."DirectUpload" AS upload
     SET "claimedAt" = COALESCE(
           upload."claimedAt",
           canonical_reference."createdAt"
         ),
         "claimedByType" = canonical_reference."sourceType",
         "claimedById" = canonical_reference."sourceId",
         "cleanupAfter" = NULL,
         "cleanupLeaseId" = NULL,
         "cleanupLeaseAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = repair_at
    FROM canonical_reference
   WHERE upload.id = canonical_reference."directUploadId"
     AND upload.status = 'CLAIMED';
  GET DIAGNOSTICS normalized_upload_count = ROW_COUNT;

  UPDATE public."DirectUpload" AS upload
     SET status = 'VERIFIED',
         "claimedAt" = NULL,
         "claimedByType" = NULL,
         "claimedById" = NULL,
         "cleanupAfter" = repair_at + interval '7 days',
         "cleanupLeaseId" = NULL,
         "cleanupLeaseAt" = NULL,
         "lastError" = NULL,
         "updatedAt" = repair_at
   WHERE upload.status = 'CLAIMED'
     AND NOT EXISTS (
       SELECT 1
         FROM public."DirectUploadReference" AS reference
        WHERE reference."directUploadId" = upload.id
          AND reference."releasedAt" IS NULL
     );
  GET DIAGNOSTICS orphan_upload_count = ROW_COUNT;

  SELECT pg_catalog.count(DISTINCT reference."directUploadId")::integer
    INTO referenced_upload_count
    FROM public."DirectUploadReference" AS reference
   WHERE reference."releasedAt" IS NULL;
  IF normalized_upload_count <> referenced_upload_count
     OR normalized_upload_count NOT BETWEEN 1 AND 2
     OR orphan_upload_count <> 3 - referenced_upload_count
     OR orphan_upload_count NOT BETWEEN 1 AND 2 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair upload partition drifted: normalized=% referenced=% orphan=%',
      normalized_upload_count,
      referenced_upload_count,
      orphan_upload_count;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO active_reference_count
    FROM public."DirectUploadReference" AS reference
   WHERE reference."releasedAt" IS NULL;

  SELECT pg_catalog.count(*)::integer
    INTO postflight_invalid_count
    FROM public."DirectUpload" AS upload
   WHERE (
       upload.status = 'CLAIMED'
       AND (
         upload."claimedAt" IS NULL
         OR upload."claimedByType" IS NULL
         OR upload."claimedById" IS NULL
         OR upload."cleanupAfter" IS NOT NULL
         OR NOT EXISTS (
           SELECT 1
             FROM public."DirectUploadReference" AS reference
            WHERE reference."directUploadId" = upload.id
              AND reference."releasedAt" IS NULL
         )
       )
     )
      OR (
        upload.status = 'VERIFIED'
        AND (
          upload."claimedAt" IS NOT NULL
          OR upload."claimedByType" IS NOT NULL
          OR upload."claimedById" IS NOT NULL
          OR upload."cleanupAfter" IS DISTINCT FROM
            repair_at + interval '7 days'
          OR EXISTS (
            SELECT 1
              FROM public."DirectUploadReference" AS reference
             WHERE reference."directUploadId" = upload.id
               AND reference."releasedAt" IS NULL
          )
        )
      )
      OR upload.status NOT IN ('CLAIMED', 'VERIFIED')
      OR (
        upload."claimedByType" IS NOT NULL
        AND upload."claimedByType" NOT IN (
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
          'LEGACY_MESSAGE_ATTACHMENT',
          'CASE_MESSAGE_ATTACHMENT',
          'MESSAGE_ATTACHMENT'
        )
      );
  IF active_reference_count <> 2 OR postflight_invalid_count <> 0 THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair postflight failed: references=% invalid=%',
      active_reference_count,
      postflight_invalid_count;
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."DirectUploadReference" AS reference
      JOIN public."DirectUpload" AS upload
        ON upload.id = reference."directUploadId"
     WHERE reference."releasedAt" IS NOT NULL
        OR reference.exclusive
        OR upload."storageClass" IS DISTINCT FROM 'PUBLIC'
        OR upload.status IS DISTINCT FROM 'CLAIMED'
  ) THEN
    RAISE EXCEPTION
      'DirectUpload legacy repair created an invalid reference';
  END IF;
END
$grainline_direct_upload_legacy_repair$;

COMMIT;
