-- Activate the public Listing catalog boundary after the compatible Listing
-- domain preparation and application are live. Ordinary runtime callers keep
-- direct reads only for reviewed public columns on active, public, unarchived,
-- orderable listings. Every write and every non-public read remains behind a
-- bounded SECURITY DEFINER authority.

BEGIN;

SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '60s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.listing-domain.rls.activation', 0)
);

LOCK TABLE public."Listing", public."Photo", public."ListingVariantGroup", public."ListingVariantOption"
  IN ACCESS EXCLUSIVE MODE;

DO $grainline_listing_domain_activation_preflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  owner_oid oid;
  relation_state record;
  expected_columns text[];
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'Listing activation requires a direct owner session';
  END IF;

  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';
  SELECT role.oid INTO owner_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = current_user;

  IF runtime_oid IS NULL OR staff_oid IS NULL OR owner_oid IS NULL THEN
    RAISE EXCEPTION 'Listing activation roles are missing';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid IN (runtime_oid, staff_oid)
       AND (
         role.rolsuper OR role.rolinherit OR NOT role.rolcanlogin
         OR role.rolcreatedb OR role.rolcreaterole OR role.rolreplication
         OR role.rolbypassrls
       )
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member IN (runtime_oid, staff_oid)
  ) THEN
    RAISE EXCEPTION 'Listing restricted-role posture is unsafe';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_roles AS role
     WHERE role.oid = owner_oid
       AND (role.rolsuper OR role.rolbypassrls)
  ) OR (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN (
         'Listing', 'Photo', 'ListingVariantGroup', 'ListingVariantOption'
       )
       AND relation.relkind = 'r'
       AND relation.relowner = owner_oid
  ) <> 4 THEN
    RAISE EXCEPTION 'Listing activation requires four bypass-owned tables';
  END IF;

  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN (
         'Listing', 'Photo', 'ListingVariantGroup', 'ListingVariantOption'
       )
     ORDER BY relation.relname
  LOOP
    expected_columns := CASE relation_state.relname
      WHEN 'Listing' THEN ARRAY[
        'aiReviewFlags', 'aiReviewScore', 'archivedAt', 'category',
        'cityMetroId', 'clickCount', 'createdAt',
        'currency', 'customOrderConversationId', 'description',
        'favoriteCount', 'id', 'isPrivate', 'listingType', 'materials',
        'metaDescription', 'metroId', 'packagedHeightCm',
        'packagedLengthCm', 'packagedWeightGrams', 'packagedWidthCm',
        'priceCents', 'priceVersion', 'processingTimeMaxDays',
        'processingTimeMinDays', 'productHeightIn', 'productLengthIn',
        'productWidthIn', 'qualityScore', 'rejectionReason',
        'reservedForUserId', 'reviewedAt', 'reviewedByAdmin', 'sellerAverageRating',
        'sellerDisplayName', 'sellerDisplayNameNormalized', 'sellerId',
        'sellerPubliclyOrderable', 'sellerReviewCount', 'shipsWithinDays',
        'status', 'stockQuantity', 'tags', 'title', 'updatedAt', 'videoUrl',
        'viewCount'
      ]::text[]
      WHEN 'Photo' THEN ARRAY[
        'altText', 'createdAt', 'id', 'listingId', 'originalUrl', 'sortOrder',
        'url'
      ]::text[]
      WHEN 'ListingVariantGroup' THEN ARRAY[
        'id', 'listingId', 'name', 'sortOrder'
      ]::text[]
      WHEN 'ListingVariantOption' THEN ARRAY[
        'groupId', 'id', 'inStock', 'label', 'priceAdjustCents', 'sortOrder'
      ]::text[]
      ELSE NULL
    END;

    IF expected_columns IS NULL OR (
      SELECT pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attname)
        FROM pg_catalog.pg_attribute AS attribute
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    ) IS DISTINCT FROM expected_columns THEN
      RAISE EXCEPTION 'Listing table column contract drifted: %', relation_state.relname;
    END IF;

    IF relation_state.relrowsecurity
       OR relation_state.relforcerowsecurity
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_policy AS policy
          WHERE policy.polrelid = relation_state.oid
       ) THEN
      RAISE EXCEPTION 'Listing predecessor RLS posture drifted: %', relation_state.relname;
    END IF;

    IF NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'SELECT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'INSERT')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'UPDATE')
       OR NOT pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'DELETE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRUNCATE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'REFERENCES')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'TRIGGER') THEN
      RAISE EXCEPTION 'Listing predecessor runtime grants drifted: %', relation_state.relname;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM pg_catalog.aclexplode(
          COALESCE(
            relation_state.relacl,
            pg_catalog.acldefault('r', relation_state.relowner)
          )
        ) AS acl
       WHERE acl.grantee NOT IN (relation_state.relowner, runtime_oid)
    ) OR EXISTS (
      SELECT 1
        FROM pg_catalog.pg_attribute AS attribute
        CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
       WHERE attribute.attrelid = relation_state.oid
         AND attribute.attnum > 0
         AND NOT attribute.attisdropped
    ) THEN
      RAISE EXCEPTION 'Listing predecessor ACL drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  IF EXISTS (
    SELECT 1
      FROM (VALUES
        ('public.grainline_seller_staff_listing_review_transition(text,text,text,text,timestamp without time zone)'),
        ('public.grainline_seller_staff_listing_remove_transition(text,text,timestamp without time zone)'),
        ('public.grainline_seller_staff_listing_undo_transition(text,text,text)'),
        ('public.grainline_seller_staff_listing_review_queue(text,integer)'),
        ('public.grainline_listing_staff_reference_targets(text,text[])'),
        ('public.grainline_listing_actor_review_contexts(text[])'),
        ('public.grainline_listing_public_customer_photo_page(text,integer,integer)'),
        ('public.grainline_listing_staff_seller_active_public_count(text,text)'),
        ('public.grainline_listing_owner_editor(text)'),
        ('public.grainline_listing_owner_export_page(timestamp without time zone,text,integer)'),
        ('public.grainline_listing_owner_catalog_page(text,jsonb,integer,integer)'),
        ('public.grainline_listing_owner_summary_page(text,text,boolean,integer,timestamp without time zone,text,integer)'),
        ('public.grainline_listing_owner_workshop_summary()'),
        ('public.grainline_listing_owner_counts()'),
        ('public.grainline_listing_owner_rating_buckets(bigint,bigint,boolean)'),
        ('public.grainline_listing_seller_rating_summary_refresh(text)'),
        ('public.grainline_listing_service_quality_score_apply(jsonb)'),
        ('public.grainline_listing_owner_stock_lock(text,text)'),
        ('public.grainline_listing_owner_stock_apply(text,text,boolean,integer,integer)'),
        ('public.grainline_listing_owner_action_state(text)'),
        ('public.grainline_listing_owner_assign_metros(text,timestamp without time zone,text,text)'),
        ('public.grainline_listing_children_replace_core(text,integer,jsonb,jsonb)'),
        ('public.grainline_listing_owner_create(text,text,boolean,text,text,text,text,integer,text[],text,text[],double precision,double precision,double precision,double precision,double precision,double precision,integer,text,text,integer,integer,integer,integer,jsonb,jsonb)'),
        ('public.grainline_listing_owner_content_update(text,timestamp without time zone,text,text,text,text,integer,boolean,text[],text,text[],double precision,double precision,double precision,double precision,double precision,double precision,integer,text,text,integer,integer,integer,integer,jsonb,jsonb)'),
        ('public.grainline_listing_actor_transaction_source_core(text,boolean)'),
        ('public.grainline_listing_actor_transaction_source(text)'),
        ('public.grainline_listing_actor_cart_transaction_sources(text)'),
        ('public.grainline_listing_public_analytics_increment(text,text)'),
        ('public.grainline_listing_public_catalog_page(jsonb,integer,integer)'),
        ('public.grainline_listing_public_title_suggestions(text)'),
        ('public.grainline_listing_detail_source_core(text)'),
        ('public.grainline_listing_actor_detail_source(text)'),
        ('public.grainline_listing_staff_detail_source(text,text)'),
        ('public.grainline_listing_owner_ai_review_context(text)'),
        ('public.grainline_listing_owner_alt_text_backfill(text,text[],text[])'),
        ('public.grainline_listing_account_deletion_redact(text,text,bigint,uuid,timestamp without time zone)'),
        ('public.grainline_listing_owner_delete_lock(text)'),
        ('public.grainline_listing_owner_archive(text,timestamp without time zone)'),
        ('public.grainline_listing_owner_hard_delete(text,timestamp without time zone)'),
        ('public.grainline_listing_owner_transition(text,text,timestamp without time zone)'),
        ('public.grainline_listing_owner_review_transition(text,timestamp without time zone,text,text,text[],double precision)'),
        ('public.grainline_listing_message_context_titles(text)'),
        ('public.grainline_seller_owner_featured_listing_toggle(text,text)'),
        ('public.grainline_message_list(text,text,text,timestamp without time zone,text,integer)'),
        ('public.grainline_listing_materials_guard()')
      ) AS expected(identity)
     WHERE pg_catalog.to_regprocedure(expected.identity) IS NULL
  ) THEN
    RAISE EXCEPTION 'Listing compatible preparation is incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = procedure.pronamespace
      JOIN pg_catalog.pg_roles AS function_owner
        ON function_owner.oid = procedure.proowner
     WHERE namespace.nspname = 'public'
       AND (
         pg_catalog.strpos(procedure.prosrc, 'public."Listing"') > 0
         OR pg_catalog.strpos(procedure.prosrc, 'public."Photo"') > 0
         OR pg_catalog.strpos(procedure.prosrc, 'public."ListingVariantGroup"') > 0
         OR pg_catalog.strpos(procedure.prosrc, 'public."ListingVariantOption"') > 0
       )
       AND (
         NOT (function_owner.rolsuper OR function_owner.rolbypassrls)
         OR pg_catalog.has_function_privilege(0, procedure.oid, 'EXECUTE')
         OR (
           procedure.prosecdef
           AND procedure.proconfig IS DISTINCT FROM
                 ARRAY['search_path=pg_catalog']::text[]
         )
       )
  ) THEN
    RAISE EXCEPTION 'Listing retained function boundary drifted';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."Listing" AS listing
     WHERE NOT listing."isPrivate"
       AND (
         listing."reservedForUserId" IS NOT NULL
         OR listing."customOrderConversationId" IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'Listing public reservation routing inventory is not empty';
  END IF;

  IF (
    SELECT pg_catalog.count(*)
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = 'public."Listing"'::pg_catalog.regclass
       AND constraint_state.conname = 'Listing_public_reservation_routing_chk'
       AND constraint_state.contype = 'c'
       AND NOT constraint_state.convalidated
       AND pg_catalog.pg_get_constraintdef(constraint_state.oid, true) =
             'CHECK ("isPrivate" OR "reservedForUserId" IS NULL AND "customOrderConversationId" IS NULL) NOT VALID'
  ) <> 1 THEN
    RAISE EXCEPTION 'Listing public reservation routing preparation guard drifted';
  END IF;
END
$grainline_listing_domain_activation_preflight$;

ALTER TABLE public."Listing"
  VALIDATE CONSTRAINT "Listing_public_reservation_routing_chk";

CREATE POLICY listing_public_select
  ON public."Listing"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    status = 'ACTIVE'::public."ListingStatus"
    AND "isPrivate" = false
    AND "archivedAt" IS NULL
    AND "sellerPubliclyOrderable" = true
  );

CREATE POLICY photo_public_select
  ON public."Photo"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
       WHERE listing.id = "Photo"."listingId"
         AND listing.status = 'ACTIVE'::public."ListingStatus"
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
         AND listing."sellerPubliclyOrderable" = true
    )
  );

CREATE POLICY listing_variant_group_public_select
  ON public."ListingVariantGroup"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    EXISTS (
      SELECT 1
        FROM public."Listing" AS listing
       WHERE listing.id = "ListingVariantGroup"."listingId"
         AND listing.status = 'ACTIVE'::public."ListingStatus"
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
         AND listing."sellerPubliclyOrderable" = true
    )
  );

CREATE POLICY listing_variant_option_public_select
  ON public."ListingVariantOption"
  AS PERMISSIVE
  FOR SELECT
  TO grainline_app_runtime
  USING (
    EXISTS (
      SELECT 1
        FROM public."ListingVariantGroup" AS variant_group
        JOIN public."Listing" AS listing
          ON listing.id = variant_group."listingId"
       WHERE variant_group.id = "ListingVariantOption"."groupId"
         AND listing.status = 'ACTIVE'::public."ListingStatus"
         AND listing."isPrivate" = false
         AND listing."archivedAt" IS NULL
         AND listing."sellerPubliclyOrderable" = true
    )
  );

REVOKE ALL PRIVILEGES ON TABLE
  public."Listing", public."Photo", public."ListingVariantGroup", public."ListingVariantOption"
  FROM PUBLIC, grainline_app_runtime, grainline_staff_read_runtime;

GRANT SELECT (
  "id", "sellerId", "title", "description", "priceCents", "currency",
  "status", "createdAt", "updatedAt", "archivedAt", "videoUrl", "tags",
  "processingTimeMinDays", "processingTimeMaxDays", "listingType",
  "stockQuantity", "shipsWithinDays", "category", "clickCount", "viewCount",
  "isPrivate", "cityMetroId", "metroId", "qualityScore", "materials",
  "metaDescription", "productHeightIn", "productLengthIn", "productWidthIn",
  "sellerPubliclyOrderable", "sellerDisplayName",
  "sellerDisplayNameNormalized", "sellerAverageRating", "sellerReviewCount",
  "favoriteCount"
) ON TABLE public."Listing" TO grainline_app_runtime;

GRANT SELECT ("id", "listingId", "url", "altText", "sortOrder", "createdAt")
  ON TABLE public."Photo" TO grainline_app_runtime;
GRANT SELECT ("id", "listingId", "name", "sortOrder")
  ON TABLE public."ListingVariantGroup" TO grainline_app_runtime;
GRANT SELECT ("id", "groupId", "label", "priceAdjustCents", "sortOrder", "inStock")
  ON TABLE public."ListingVariantOption" TO grainline_app_runtime;

ALTER TABLE public."Listing" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Listing" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."Photo" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."Photo" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantGroup" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantGroup" FORCE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantOption" ENABLE ROW LEVEL SECURITY;
ALTER TABLE public."ListingVariantOption" FORCE ROW LEVEL SECURITY;

DO $grainline_listing_domain_activation_postflight$
DECLARE
  runtime_oid oid;
  staff_oid oid;
  relation_state record;
  expected_runtime_columns text[];
  actual_runtime_columns text[];
BEGIN
  SELECT role.oid INTO runtime_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime';
  SELECT role.oid INTO staff_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime';

  FOR relation_state IN
    SELECT relation.oid, relation.relname, relation.relowner,
           relation.relrowsecurity, relation.relforcerowsecurity,
           relation.relacl
      FROM pg_catalog.pg_class AS relation
      JOIN pg_catalog.pg_namespace AS namespace
        ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname IN (
         'Listing', 'Photo', 'ListingVariantGroup', 'ListingVariantOption'
       )
     ORDER BY relation.relname
  LOOP
    expected_runtime_columns := CASE relation_state.relname
      WHEN 'Listing' THEN ARRAY[
        'archivedAt', 'category', 'cityMetroId', 'clickCount', 'createdAt',
        'currency', 'description', 'favoriteCount', 'id', 'isPrivate',
        'listingType', 'materials', 'metaDescription', 'metroId', 'priceCents',
        'processingTimeMaxDays', 'processingTimeMinDays', 'productHeightIn',
        'productLengthIn', 'productWidthIn', 'qualityScore', 'sellerAverageRating',
        'sellerDisplayName', 'sellerDisplayNameNormalized', 'sellerId',
        'sellerPubliclyOrderable', 'sellerReviewCount', 'shipsWithinDays',
        'status', 'stockQuantity', 'tags', 'title', 'updatedAt', 'videoUrl',
        'viewCount'
      ]::text[]
      WHEN 'Photo' THEN ARRAY[
        'altText', 'createdAt', 'id', 'listingId', 'sortOrder', 'url'
      ]::text[]
      WHEN 'ListingVariantGroup' THEN ARRAY[
        'id', 'listingId', 'name', 'sortOrder'
      ]::text[]
      WHEN 'ListingVariantOption' THEN ARRAY[
        'groupId', 'id', 'inStock', 'label', 'priceAdjustCents', 'sortOrder'
      ]::text[]
      ELSE NULL
    END;

    SELECT COALESCE(
             pg_catalog.array_agg(attribute.attname::text ORDER BY attribute.attname),
             ARRAY[]::text[]
           )
      INTO actual_runtime_columns
      FROM pg_catalog.pg_attribute AS attribute
     WHERE attribute.attrelid = relation_state.oid
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND pg_catalog.has_column_privilege(
             runtime_oid, relation_state.oid, attribute.attnum, 'SELECT'
           );

    IF NOT relation_state.relrowsecurity
       OR NOT relation_state.relforcerowsecurity
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'SELECT')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'INSERT')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'UPDATE')
       OR pg_catalog.has_table_privilege(runtime_oid, relation_state.oid, 'DELETE')
       OR pg_catalog.has_any_column_privilege(
            staff_oid, relation_state.oid, 'SELECT,INSERT,UPDATE,REFERENCES'
          )
       OR actual_runtime_columns IS DISTINCT FROM expected_runtime_columns
       OR EXISTS (
         SELECT 1
           FROM pg_catalog.aclexplode(
             COALESCE(
               relation_state.relacl,
               pg_catalog.acldefault('r', relation_state.relowner)
             )
           ) AS acl
          WHERE acl.grantee <> relation_state.relowner
       ) OR EXISTS (
         SELECT 1
           FROM pg_catalog.pg_attribute AS attribute
           CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
          WHERE attribute.attrelid = relation_state.oid
            AND attribute.attnum > 0
            AND NOT attribute.attisdropped
            AND (
              acl.grantee <> runtime_oid
              OR pg_catalog.upper(acl.privilege_type) <> 'SELECT'
              OR acl.is_grantable
            )
       ) THEN
      RAISE EXCEPTION 'Listing activation postflight drifted: %', relation_state.relname;
    END IF;
  END LOOP;

  IF (
    SELECT pg_catalog.array_agg(policy.polname::text ORDER BY policy.polname)
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid IN (
       'public."Listing"'::pg_catalog.regclass,
       'public."Photo"'::pg_catalog.regclass,
       'public."ListingVariantGroup"'::pg_catalog.regclass,
       'public."ListingVariantOption"'::pg_catalog.regclass
     )
  ) IS DISTINCT FROM ARRAY[
    'listing_public_select',
    'listing_variant_group_public_select',
    'listing_variant_option_public_select',
    'photo_public_select'
  ]::text[] OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid IN (
       'public."Listing"'::pg_catalog.regclass,
       'public."Photo"'::pg_catalog.regclass,
       'public."ListingVariantGroup"'::pg_catalog.regclass,
       'public."ListingVariantOption"'::pg_catalog.regclass
     )
       AND (
         policy.polcmd <> 'r'
         OR NOT policy.polpermissive
         OR policy.polroles <> ARRAY[runtime_oid]::oid[]
         OR policy.polwithcheck IS NOT NULL
       )
  ) THEN
    RAISE EXCEPTION 'Listing activation policy catalog drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_constraint AS constraint_state
     WHERE constraint_state.conrelid = 'public."Listing"'::pg_catalog.regclass
       AND constraint_state.conname = 'Listing_public_reservation_routing_chk'
       AND constraint_state.contype = 'c'
       AND constraint_state.convalidated
  ) THEN
    RAISE EXCEPTION 'Listing public reservation routing constraint is not active';
  END IF;
END
$grainline_listing_domain_activation_postflight$;

COMMIT;
