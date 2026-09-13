-- Compatible DirectUpload reference-ledger preparation.
--
-- This migration is additive for the live DirectUpload application paths:
-- it does not enable RLS on DirectUpload and does not revoke the old runtime
-- table grants. DirectUploadReference is service-only and FORCE-hardened from
-- birth; only later reviewed SECURITY DEFINER functions may write it.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.direct-upload.rls.activation', 0)
);

ALTER TABLE public."DirectUpload"
  ADD COLUMN "cleanupLeaseId" VARCHAR(64),
  ADD COLUMN "cleanupLeaseAt" TIMESTAMP(3);

ALTER TABLE public."DirectUpload"
  ADD CONSTRAINT "DirectUpload_userId_fkey"
  FOREIGN KEY ("userId") REFERENCES public."User"("id")
  ON DELETE RESTRICT ON UPDATE CASCADE
  NOT VALID;

ALTER TABLE public."DirectUpload"
  ADD CONSTRAINT "DirectUpload_endpoint_check"
  CHECK (
    endpoint IN (
      'listingImage',
      'messageImage',
      'messageFile',
      'messageAny',
      'caseEvidenceImage',
      'messagePrivateImage',
      'reviewPhoto',
      'listingVideo',
      'bannerImage',
      'galleryImage',
      'blogImage'
    )
  ) NOT VALID,
  ADD CONSTRAINT "DirectUpload_key_endpoint_check"
  CHECK (
    key LIKE endpoint || '/%'
    AND position('..' IN key) = 0
    AND key !~ '[[:cntrl:]]'
  ) NOT VALID,
  ADD CONSTRAINT "DirectUpload_public_url_key_check"
  CHECK (
    "storageClass" = 'PRIVATE'
    OR (
      "publicUrl" LIKE 'https://%'
      AND pg_catalog.right(
            "publicUrl",
            pg_catalog.char_length(key) + 1
          ) = '/' || key
    )
  ) NOT VALID,
  ADD CONSTRAINT "DirectUpload_endpoint_storage_content_size_check"
  CHECK (
    (
      "storageClass" = 'PUBLIC'
      AND endpoint IN (
        'listingImage',
        'messageImage',
        'messageAny',
        'reviewPhoto',
        'bannerImage',
        'galleryImage',
        'blogImage'
      )
      AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND "expectedSize" <= CASE endpoint
        WHEN 'listingImage' THEN 12582912
        WHEN 'bannerImage' THEN 15728640
        ELSE 8388608
      END
    )
    OR (
      "storageClass" = 'PUBLIC'
      AND endpoint = 'listingVideo'
      AND "contentType" IN ('video/mp4', 'video/quicktime')
      AND "expectedSize" <= 134217728
    )
    OR (
      "storageClass" = 'PUBLIC'
      AND endpoint IN ('messageFile', 'messageAny')
      AND "contentType" = 'application/pdf'
      AND "expectedSize" <= 8388608
    )
    OR (
      "storageClass" = 'PRIVATE'
      AND endpoint IN ('caseEvidenceImage', 'messagePrivateImage')
      AND "contentType" IN ('image/jpeg', 'image/png', 'image/webp')
      AND "expectedSize" <= 8388608
    )
  ) NOT VALID,
  ADD CONSTRAINT "DirectUpload_cleanup_lease_pair_check"
  CHECK (
    ("cleanupLeaseId" IS NULL AND "cleanupLeaseAt" IS NULL)
    OR ("cleanupLeaseId" IS NOT NULL AND "cleanupLeaseAt" IS NOT NULL)
  ) NOT VALID;

-- Preserve the reviewed Case evidence migration and support old/new
-- application coexistence. Old code writes objectKey; new code dual-writes
-- objectKey plus directUploadId. The trigger derives the id for old writes and
-- rejects any key/id/owner/metadata mismatch.
ALTER TABLE public."CaseMessageAttachment"
  ADD COLUMN "directUploadId" TEXT;

UPDATE public."CaseMessageAttachment" AS attachment
   SET "directUploadId" = upload.id
  FROM public."DirectUpload" AS upload
 WHERE upload.key = attachment."objectKey"
   AND upload."userId" = attachment."uploaderId"
   AND upload.endpoint = 'caseEvidenceImage'
   AND upload."storageClass" = 'PRIVATE'
   AND upload."publicUrl" IS NULL
   AND upload."contentType" = attachment."contentType"
   AND upload."expectedSize" = attachment."byteSize"
   AND upload.status IN ('VERIFIED', 'CLAIMED');

DO $grainline_case_attachment_backfill$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM public."CaseMessageAttachment" AS attachment
     WHERE attachment."directUploadId" IS NULL
  ) THEN
    RAISE EXCEPTION
      'CaseMessageAttachment contains an unbindable DirectUpload source';
  END IF;
END
$grainline_case_attachment_backfill$;

ALTER TABLE public."CaseMessageAttachment"
  ALTER COLUMN "directUploadId" SET NOT NULL,
  ADD CONSTRAINT "CaseMessageAttachment_directUploadId_key"
    UNIQUE ("directUploadId"),
  ADD CONSTRAINT "CaseMessageAttachment_directUploadId_fkey"
    FOREIGN KEY ("directUploadId") REFERENCES public."DirectUpload"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE OR REPLACE FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_case_attachment_bind$
DECLARE
  upload record;
BEGIN
  IF TG_OP = 'UPDATE'
     AND (
       NEW.id IS DISTINCT FROM OLD.id
       OR NEW."caseMessageId" IS DISTINCT FROM OLD."caseMessageId"
       OR NEW."uploaderId" IS DISTINCT FROM OLD."uploaderId"
       OR NEW."objectKey" IS DISTINCT FROM OLD."objectKey"
       OR NEW."directUploadId" IS DISTINCT FROM OLD."directUploadId"
       OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
       OR NEW."byteSize" IS DISTINCT FROM OLD."byteSize"
       OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt"
     ) THEN
    RAISE EXCEPTION 'CaseMessageAttachment identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;

  SELECT
    candidate.id,
    candidate.key,
    candidate."userId",
    candidate.endpoint,
    candidate."storageClass",
    candidate."publicUrl",
    candidate."contentType",
    candidate."expectedSize",
    candidate.status
    INTO upload
   FROM public."DirectUpload" AS candidate
   WHERE candidate.key = NEW."objectKey"
   FOR UPDATE;

  IF NOT FOUND
     OR (
       NEW."directUploadId" IS NOT NULL
       AND NEW."directUploadId" IS DISTINCT FROM upload.id
     )
     OR upload."userId" IS DISTINCT FROM NEW."uploaderId"
     OR upload.endpoint IS DISTINCT FROM 'caseEvidenceImage'
     OR upload."storageClass" IS DISTINCT FROM 'PRIVATE'
     OR upload."publicUrl" IS NOT NULL
     OR upload."contentType" IS DISTINCT FROM NEW."contentType"
     OR upload."expectedSize" IS DISTINCT FROM NEW."byteSize"
     OR upload.status NOT IN ('VERIFIED', 'CLAIMED') THEN
    RAISE EXCEPTION 'CaseMessageAttachment DirectUpload binding is invalid'
      USING ERRCODE = '23514';
  END IF;

  NEW."directUploadId" := upload.id;
  RETURN NEW;
END;
$grainline_direct_upload_case_attachment_bind$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_case_attachment_bind()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_case_attachment_bind
BEFORE INSERT OR UPDATE
ON public."CaseMessageAttachment"
FOR EACH ROW EXECUTE FUNCTION
  public.grainline_direct_upload_case_attachment_bind();

CREATE TABLE public."DirectUploadReference" (
  id TEXT NOT NULL,
  "directUploadId" TEXT NOT NULL,
  "sourceType" VARCHAR(50) NOT NULL,
  "sourceId" VARCHAR(191) NOT NULL,
  exclusive BOOLEAN NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMP(3),
  "releaseReason" VARCHAR(200),

  CONSTRAINT "DirectUploadReference_pkey" PRIMARY KEY (id),
  CONSTRAINT "DirectUploadReference_directUploadId_fkey"
    FOREIGN KEY ("directUploadId") REFERENCES public."DirectUpload"(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT "DirectUploadReference_sourceType_check"
    CHECK (
      "sourceType" IN (
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
    ),
  CONSTRAINT "DirectUploadReference_sourceId_check"
    CHECK (
      "sourceId" <> ''
      AND pg_catalog.char_length("sourceId") <= 191
      AND "sourceId" !~ '[[:cntrl:]]'
    ),
  CONSTRAINT "DirectUploadReference_release_check"
    CHECK (
      ("releasedAt" IS NULL AND "releaseReason" IS NULL)
      OR ("releasedAt" IS NOT NULL AND "releaseReason" IS NOT NULL)
    )
);

CREATE UNIQUE INDEX "DirectUploadReference_active_source_key"
  ON public."DirectUploadReference"(
    "directUploadId",
    "sourceType",
    "sourceId"
  )
  WHERE "releasedAt" IS NULL;

CREATE UNIQUE INDEX "DirectUploadReference_active_exclusive_key"
  ON public."DirectUploadReference"("directUploadId")
  WHERE "releasedAt" IS NULL AND exclusive = true;

CREATE INDEX "DirectUploadReference_directUploadId_releasedAt_idx"
  ON public."DirectUploadReference"("directUploadId", "releasedAt");

CREATE INDEX "DirectUploadReference_sourceType_sourceId_releasedAt_idx"
  ON public."DirectUploadReference"(
    "sourceType",
    "sourceId",
    "releasedAt"
  );

CREATE INDEX "DirectUploadReference_releasedAt_createdAt_idx"
  ON public."DirectUploadReference"("releasedAt", "createdAt");

ALTER TABLE public."DirectUploadReference" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."DirectUploadReference" FORCE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public."DirectUploadReference"
  FROM PUBLIC, grainline_app_runtime;

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_identity_immutable()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_direct_upload_identity_immutable$
BEGIN
  IF NEW.key IS DISTINCT FROM OLD.key
     OR NEW.endpoint IS DISTINCT FROM OLD.endpoint
     OR NEW."userId" IS DISTINCT FROM OLD."userId"
     OR NEW."publicUrl" IS DISTINCT FROM OLD."publicUrl"
     OR NEW."storageClass" IS DISTINCT FROM OLD."storageClass"
     OR NEW."contentType" IS DISTINCT FROM OLD."contentType"
     OR NEW."expectedSize" IS DISTINCT FROM OLD."expectedSize"
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'DirectUpload identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$grainline_direct_upload_identity_immutable$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_identity_immutable()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_identity_immutable
BEFORE UPDATE ON public."DirectUpload"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_direct_upload_identity_immutable();

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_status_transition()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY INVOKER
SET search_path = pg_catalog
AS $grainline_direct_upload_status_transition$
BEGIN
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  IF NOT (
    (OLD.status = 'PRESIGNED' AND NEW.status IN ('VERIFIED', 'DELETING'))
    OR (OLD.status = 'VERIFIED' AND NEW.status IN ('CLAIMED', 'DELETING'))
    OR (OLD.status = 'CLAIMED' AND NEW.status = 'VERIFIED')
    OR (OLD.status = 'DELETING' AND NEW.status IN ('DELETED', 'DELETE_FAILED'))
    OR (OLD.status = 'DELETE_FAILED' AND NEW.status = 'DELETING')
  ) THEN
    RAISE EXCEPTION 'invalid DirectUpload status transition: % -> %',
      OLD.status, NEW.status
      USING ERRCODE = '23514';
  END IF;

  RETURN NEW;
END;
$grainline_direct_upload_status_transition$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_status_transition()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_status_transition
BEFORE UPDATE OF status ON public."DirectUpload"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_direct_upload_status_transition();

CREATE OR REPLACE FUNCTION public.grainline_direct_upload_reference_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_direct_upload_reference_guard$
DECLARE
  lifecycle record;
BEGIN
  IF TG_OP = 'INSERT' THEN
    IF NEW."releasedAt" IS NOT NULL OR NEW."releaseReason" IS NOT NULL THEN
      RAISE EXCEPTION 'DirectUploadReference must start active'
        USING ERRCODE = '23514';
    END IF;

    SELECT upload."storageClass", upload.status
      INTO lifecycle
      FROM public."DirectUpload" AS upload
     WHERE upload.id = NEW."directUploadId"
     FOR UPDATE;
    IF NOT FOUND OR lifecycle.status NOT IN ('VERIFIED', 'CLAIMED') THEN
      RAISE EXCEPTION 'DirectUploadReference lifecycle is not claimable'
        USING ERRCODE = '23514';
    END IF;
    NEW.exclusive := lifecycle."storageClass" = 'PRIVATE';
    RETURN NEW;
  END IF;

  IF NEW."directUploadId" IS DISTINCT FROM OLD."directUploadId"
     OR NEW."sourceType" IS DISTINCT FROM OLD."sourceType"
     OR NEW."sourceId" IS DISTINCT FROM OLD."sourceId"
     OR NEW.exclusive IS DISTINCT FROM OLD.exclusive
     OR NEW."createdAt" IS DISTINCT FROM OLD."createdAt" THEN
    RAISE EXCEPTION 'DirectUploadReference identity fields are immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."releasedAt" IS NOT NULL
     AND (
       NEW."releasedAt" IS DISTINCT FROM OLD."releasedAt"
       OR NEW."releaseReason" IS DISTINCT FROM OLD."releaseReason"
     ) THEN
    RAISE EXCEPTION 'DirectUploadReference release is immutable'
      USING ERRCODE = '23514';
  END IF;
  IF OLD."releasedAt" IS NULL AND NEW."releasedAt" IS NULL THEN
    RAISE EXCEPTION 'DirectUploadReference update must release the reference'
      USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$grainline_direct_upload_reference_guard$;

REVOKE ALL ON FUNCTION
  public.grainline_direct_upload_reference_guard()
  FROM PUBLIC, grainline_app_runtime;

CREATE TRIGGER grainline_direct_upload_reference_guard
BEFORE INSERT OR UPDATE ON public."DirectUploadReference"
FOR EACH ROW
EXECUTE FUNCTION public.grainline_direct_upload_reference_guard();

DO $grainline_direct_upload_reference_postflight$
DECLARE
  reference_state record;
BEGIN
  SELECT class.relrowsecurity, class.relforcerowsecurity
    INTO reference_state
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'DirectUploadReference'
     AND class.relkind = 'r';
  IF NOT FOUND
     OR NOT reference_state.relrowsecurity
     OR NOT reference_state.relforcerowsecurity THEN
    RAISE EXCEPTION 'DirectUploadReference RLS posture is incomplete';
  END IF;

  IF pg_catalog.has_table_privilege(
       'grainline_app_runtime',
       'public."DirectUploadReference"',
       'SELECT,INSERT,UPDATE,DELETE'
     ) THEN
    RAISE EXCEPTION
      'grainline_app_runtime must not have DirectUploadReference CRUD';
  END IF;
END
$grainline_direct_upload_reference_postflight$;

COMMIT;
