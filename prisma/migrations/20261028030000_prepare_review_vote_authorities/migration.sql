BEGIN;

-- Fail closed instead of queueing public listing reads behind the constraint
-- and index preparation if a long-lived transaction already holds Review or
-- ReviewVote. The protected release can be retried after the blocker drains.
SET LOCAL lock_timeout = '5s';
SET LOCAL statement_timeout = '60s';

-- Compatible preparation only. ReviewVote RLS and predecessor table grants
-- remain unchanged until every caller, race proof and rollback proof passes.
DO $grainline_review_vote_preflight$
BEGIN
  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."ReviewVote"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'ReviewVote RLS must remain off during compatible preparation';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM public."ReviewVote" AS vote
     WHERE vote.value <> 1
  ) THEN
    RAISE EXCEPTION 'ReviewVote contains unsupported values';
  END IF;

  IF pg_catalog.to_regprocedure('public.grainline_review_vote_owner_toggle(text)') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.grainline_review_vote_owner_export()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.grainline_review_vote_owner_delete_all()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.grainline_review_vote_insert_guard()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.grainline_review_vote_delete_lock_guard()') IS NOT NULL
     OR pg_catalog.to_regprocedure('public.grainline_review_vote_update_forbidden()') IS NOT NULL THEN
    RAISE EXCEPTION 'ReviewVote preparation function already exists';
  END IF;
END;
$grainline_review_vote_preflight$;

ALTER TABLE public."ReviewVote"
  ADD CONSTRAINT "ReviewVote_value_one_chk"
  CHECK (value = 1) NOT VALID;

ALTER TABLE public."Review"
  ADD CONSTRAINT "Review_helpfulCount_nonnegative_chk"
  CHECK ("helpfulCount" >= 0) NOT VALID;

CREATE INDEX "ReviewVote_userId_createdAt_reviewId_idx"
  ON public."ReviewVote" ("userId", "createdAt" DESC, "reviewId");

-- The predecessor route inserts/deletes ReviewVote before updating Review.
-- Repair the scalar before installing a compatibility guard, but leave count
-- maintenance inside each compatible writer until activation has drained the
-- predecessor. Installing a count trigger here would double-update the scalar
-- while the predecessor route is still eligible to serve traffic.
LOCK TABLE public."ReviewVote" IN SHARE ROW EXCLUSIVE MODE;
LOCK TABLE public."Review" IN SHARE ROW EXCLUSIVE MODE;

WITH exact_counts AS (
  SELECT review.id,
         pg_catalog.count(vote."reviewId")::integer AS value
    FROM public."Review" AS review
    LEFT JOIN public."ReviewVote" AS vote
      ON vote."reviewId" = review.id
   GROUP BY review.id
)
UPDATE public."Review" AS review
   SET "helpfulCount" = exact_counts.value
  FROM exact_counts
 WHERE review.id = exact_counts.id
   AND review."helpfulCount" <> exact_counts.value;

CREATE FUNCTION public.grainline_review_vote_insert_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_insert_guard$
DECLARE
  discovered_reviewer_id text;
  discovered_seller_user_id text;
  target_reviewer_id text;
  target_seller_user_id text;
  locked_user_count integer := 0;
  expected_user_count integer := 0;
BEGIN
  -- Discover the three account identities without retaining a Listing or
  -- SellerProfile row lock. Account deletion takes the seller User lock before
  -- pausing SellerProfile, so retaining either target lock here would invert
  -- that order and permit a mixed-version deadlock.
  SELECT review."reviewerId",
         seller."userId"
    INTO discovered_reviewer_id,
         discovered_seller_user_id
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE review.id = NEW."reviewId";
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ReviewVote target is unavailable'
      USING ERRCODE = '23503';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO expected_user_count
    FROM (
      SELECT DISTINCT candidate.id
        FROM pg_catalog.unnest(ARRAY[
          NEW."userId",
          discovered_reviewer_id,
          discovered_seller_user_id
        ]) AS candidate(id)
    ) AS expected;

  -- Block writers and account deletion lock the same User rows first. This
  -- makes the guard compatible with the predecessor route while closing its
  -- check-then-insert race for blocks and account state.
  PERFORM 1
    FROM public."User" AS account_user
   WHERE account_user.id = ANY (ARRAY[
     NEW."userId",
     discovered_reviewer_id,
     discovered_seller_user_id
   ])
   ORDER BY account_user.id
   FOR UPDATE;
  GET DIAGNOSTICS locked_user_count = ROW_COUNT;
  IF locked_user_count <> expected_user_count THEN
    RAISE EXCEPTION 'ReviewVote account state is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = NEW."userId"
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'ReviewVote actor is inactive'
      USING ERRCODE = '42501';
  END IF;

  -- Re-read all mutable target eligibility after the canonical User locks.
  -- This closes the predecessor trigger's account-state race: a reviewer ban
  -- or deletion that committed while the insert waited must make the target
  -- unavailable, not leave behind a vote for an inactive review. Locking the
  -- target rows only now also preserves User -> Review -> SellerProfile lock
  -- ordering. The Review lock makes the predecessor INSERT compatible with
  -- parent deletion and with the fixed owner operation during app-version skew.
  SELECT review."reviewerId",
         seller."userId"
    INTO target_reviewer_id,
         target_seller_user_id
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE review.id = NEW."reviewId"
     AND review."reviewerId" = discovered_reviewer_id
     AND seller."userId" = discovered_seller_user_id
     AND review."reviewerAccountActive" = true
     AND listing."archivedAt" IS NULL
     AND (
       (
         listing."isPrivate" = true
         AND listing.status::text IN ('ACTIVE', 'SOLD')
         AND listing."reservedForUserId" = NEW."userId"
       )
       OR (
         listing."isPrivate" = false
         AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
       )
     )
     AND seller."ownerAccountActive" = true
     AND seller."chargesEnabled" = true
     AND seller."stripeAccountSupported" = true
     AND seller."vacationMode" = false
   FOR NO KEY UPDATE OF review
   FOR SHARE OF listing, seller;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'ReviewVote target is unavailable'
      USING ERRCODE = '23503';
  END IF;

  IF NEW."userId" = target_reviewer_id
     OR NEW."userId" = target_seller_user_id THEN
    RAISE EXCEPTION 'ReviewVote actor cannot vote on this review'
      USING ERRCODE = '42501';
  END IF;
  IF EXISTS (
    SELECT 1
      FROM public."Block" AS relationship
     WHERE (
       relationship."blockerId" = NEW."userId"
       AND relationship."blockedId" IN (
         target_reviewer_id,
         target_seller_user_id
       )
     ) OR (
       relationship."blockedId" = NEW."userId"
       AND relationship."blockerId" IN (
         target_reviewer_id,
         target_seller_user_id
       )
     )
  ) THEN
    RAISE EXCEPTION 'ReviewVote target is unavailable'
      USING ERRCODE = '42501';
  END IF;

  RETURN NEW;
END;
$grainline_review_vote_insert_guard$;

CREATE TRIGGER "ReviewVote_insert_guard"
BEFORE INSERT ON public."ReviewVote"
FOR EACH ROW EXECUTE FUNCTION public.grainline_review_vote_insert_guard();

CREATE FUNCTION public.grainline_review_vote_delete_lock_guard()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_delete_lock_guard$
BEGIN
  -- The predecessor route deletes ReviewVote before updating Review. Locking
  -- the parent in this BEFORE trigger gives old and new callers the canonical
  -- Review-before-ReviewVote order. During an ON DELETE CASCADE the parent row
  -- is already locked and may no longer be visible to this transaction; that
  -- is expected and the child delete may continue.
  PERFORM 1
    FROM public."Review" AS review
   WHERE review.id = OLD."reviewId"
   FOR NO KEY UPDATE;
  RETURN OLD;
END;
$grainline_review_vote_delete_lock_guard$;

CREATE TRIGGER "ReviewVote_delete_lock_guard"
BEFORE DELETE ON public."ReviewVote"
FOR EACH ROW EXECUTE FUNCTION public.grainline_review_vote_delete_lock_guard();

CREATE FUNCTION public.grainline_review_vote_update_forbidden()
RETURNS trigger
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_update_forbidden$
BEGIN
  RAISE EXCEPTION 'ReviewVote rows are immutable; toggle the vote instead'
    USING ERRCODE = '42501';
END;
$grainline_review_vote_update_forbidden$;

CREATE TRIGGER "ReviewVote_update_forbidden"
BEFORE UPDATE ON public."ReviewVote"
FOR EACH ROW EXECUTE FUNCTION public.grainline_review_vote_update_forbidden();

CREATE FUNCTION public.grainline_review_vote_owner_toggle(
  p_review_id text
)
RETURNS TABLE (
  "resultStatus" text,
  voted boolean,
  "helpfulCount" integer
)
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_owner_toggle$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  target_reviewer_id text;
  target_seller_user_id text;
  locked_user_count integer := 0;
  expected_user_count integer := 0;
  deleted_count integer := 0;
  current_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'ReviewVote owner context is invalid'
      USING ERRCODE = '42501';
  END IF;
  IF p_review_id IS NULL
     OR p_review_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'ReviewVote target is invalid'
      USING ERRCODE = '22023';
  END IF;
  IF pg_catalog.current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'ReviewVote toggle requires read committed isolation'
      USING ERRCODE = '25001';
  END IF;

  SELECT review."reviewerId",
         seller."userId"
    INTO target_reviewer_id,
         target_seller_user_id
    FROM public."Review" AS review
    JOIN public."Listing" AS listing
      ON listing.id = review."listingId"
    JOIN public."SellerProfile" AS seller
      ON seller.id = listing."sellerId"
   WHERE review.id = p_review_id;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, false, 0;
    RETURN;
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO expected_user_count
    FROM (
      SELECT DISTINCT candidate.id
        FROM pg_catalog.unnest(ARRAY[
          request_user_id,
          target_reviewer_id,
          target_seller_user_id
        ]) AS candidate(id)
    ) AS expected;

  -- Block writers lock the same User rows in ascending id order before
  -- mutating Block. Account deletion also begins with its User lock.
  PERFORM 1
    FROM public."User" AS account_user
   WHERE account_user.id = ANY (ARRAY[
     request_user_id,
     target_reviewer_id,
     target_seller_user_id
   ])
   ORDER BY account_user.id
   FOR UPDATE;
  GET DIAGNOSTICS locked_user_count = ROW_COUNT;
  IF locked_user_count <> expected_user_count THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, false, 0;
    RETURN;
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM public."User" AS actor
     WHERE actor.id = request_user_id
       AND actor.banned = false
       AND actor."deletedAt" IS NULL
  ) THEN
    RAISE EXCEPTION 'ReviewVote owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  -- Review deletion locks the parent before its ReviewVote cascade. Lock the
  -- same parent first so a toggle can never retain a child-row lock while it
  -- waits on the parent. The compatibility insert/delete guards make the
  -- predecessor route use this same order during application-version skew.
  PERFORM 1
    FROM public."Review" AS review
   WHERE review.id = p_review_id
   FOR NO KEY UPDATE;
  IF NOT FOUND THEN
    RETURN QUERY SELECT 'NOT_FOUND'::text, false, 0;
    RETURN;
  END IF;

  -- Removing the actor's own existing vote is always allowed. Block and
  -- visibility rules govern adding a vote, not withdrawing one, so a block
  -- cannot trap a historical vote.
  DELETE FROM public."ReviewVote"
   WHERE "reviewId" = p_review_id
     AND "userId" = request_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  IF deleted_count > 1 THEN
    RAISE EXCEPTION 'ReviewVote toggle changed an invalid number of rows'
      USING ERRCODE = '23514';
  END IF;

  IF deleted_count = 0 THEN
    -- Re-read the exact target after the User and Review locks. Lock Listing
    -- and SellerProfile so add eligibility cannot change, and require the
    -- target identities to match the User rows already locked above.
    SELECT review."helpfulCount"
      INTO current_count
      FROM public."Review" AS review
      JOIN public."Listing" AS listing
        ON listing.id = review."listingId"
      JOIN public."SellerProfile" AS seller
        ON seller.id = listing."sellerId"
     WHERE review.id = p_review_id
       AND review."reviewerId" = target_reviewer_id
       AND seller."userId" = target_seller_user_id
       AND review."reviewerAccountActive" = true
       AND listing."archivedAt" IS NULL
       AND (
         (
           listing."isPrivate" = true
           AND listing.status::text IN ('ACTIVE', 'SOLD')
           AND listing."reservedForUserId" = request_user_id
         )
         OR (
           listing."isPrivate" = false
           AND listing.status::text IN ('ACTIVE', 'SOLD_OUT')
         )
       )
       AND seller."ownerAccountActive" = true
       AND seller."chargesEnabled" = true
       AND seller."stripeAccountSupported" = true
       AND seller."vacationMode" = false
     FOR SHARE OF listing, seller;
    IF NOT FOUND THEN
      RETURN QUERY SELECT 'NOT_FOUND'::text, false, 0;
      RETURN;
    END IF;

    IF target_reviewer_id = request_user_id THEN
      RETURN QUERY SELECT 'SELF'::text, false, current_count;
      RETURN;
    END IF;
    IF target_seller_user_id = request_user_id THEN
      RETURN QUERY SELECT 'OWN_LISTING'::text, false, current_count;
      RETURN;
    END IF;

    IF EXISTS (
      SELECT 1
        FROM public."Block" AS relationship
       WHERE (
         relationship."blockerId" = request_user_id
         AND relationship."blockedId" IN (
           target_reviewer_id,
           target_seller_user_id
         )
       ) OR (
         relationship."blockedId" = request_user_id
         AND relationship."blockerId" IN (
           target_reviewer_id,
           target_seller_user_id
         )
       )
    ) THEN
      RETURN QUERY SELECT 'NOT_FOUND'::text, false, 0;
      RETURN;
    END IF;

    BEGIN
      INSERT INTO public."ReviewVote" ("reviewId", "userId", value)
      VALUES (p_review_id, request_user_id, 1);
    EXCEPTION
      WHEN unique_violation THEN
        -- A duplicate in-flight add is an idempotent replay. The conflicting
        -- transaction has committed before PostgreSQL reports this exception.
        NULL;
    END;
  END IF;

  -- The Review row is already locked. Recompute rather than
  -- increment/decrement so this operation also repairs predecessor drift and
  -- remains retry-safe.
  UPDATE public."Review" AS review
     SET "helpfulCount" = (
       SELECT pg_catalog.count(*)::integer
         FROM public."ReviewVote" AS vote
        WHERE vote."reviewId" = p_review_id
     )
   WHERE review.id = p_review_id
   RETURNING review."helpfulCount" INTO current_count;
  IF NOT FOUND OR current_count < 0 THEN
    RAISE EXCEPTION 'ReviewVote count projection is unavailable'
      USING ERRCODE = '23514';
  END IF;

  RETURN QUERY SELECT 'OK'::text, deleted_count = 0, current_count;
END;
$grainline_review_vote_owner_toggle$;

CREATE FUNCTION public.grainline_review_vote_owner_export()
RETURNS TABLE (
  "reviewId" text,
  value integer,
  "createdAt" timestamp(3),
  "listingId" text
)
LANGUAGE plpgsql
STABLE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_owner_export$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$'
     OR NOT EXISTS (
       SELECT 1
         FROM public."User" AS actor
        WHERE actor.id = request_user_id
          AND actor.banned = false
          AND actor."deletedAt" IS NULL
     ) THEN
    RAISE EXCEPTION 'ReviewVote export owner context is inactive'
      USING ERRCODE = '42501';
  END IF;

  RETURN QUERY
  SELECT vote."reviewId"::text,
         vote.value,
         vote."createdAt",
         review."listingId"::text
    FROM public."ReviewVote" AS vote
    JOIN public."Review" AS review
      ON review.id = vote."reviewId"
   WHERE vote."userId" = request_user_id
   ORDER BY vote."createdAt" DESC, vote."reviewId";
END;
$grainline_review_vote_owner_export$;

CREATE FUNCTION public.grainline_review_vote_owner_delete_all()
RETURNS integer
LANGUAGE plpgsql
VOLATILE
PARALLEL UNSAFE
SECURITY DEFINER
SET search_path = pg_catalog
AS $grainline_review_vote_owner_delete_all$
DECLARE
  request_user_id text := NULLIF(
    pg_catalog.btrim(pg_catalog.current_setting('app.user_id', true)),
    ''
  );
  affected_review_ids text[];
  deleted_count integer := 0;
BEGIN
  IF request_user_id IS NULL
     OR request_user_id !~ '^[A-Za-z0-9._:-]{1,191}$' THEN
    RAISE EXCEPTION 'ReviewVote deletion owner context is invalid'
      USING ERRCODE = '42501';
  END IF;

  -- Account deletion already owns this row. Taking it here too keeps direct
  -- retries and any future caller in the same User-before-Review lock order.
  PERFORM 1
    FROM public."User" AS actor
   WHERE actor.id = request_user_id
   FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 0;
  END IF;

  SELECT pg_catalog.array_agg(candidate."reviewId" ORDER BY candidate."reviewId")
    INTO affected_review_ids
    FROM (
      SELECT DISTINCT vote."reviewId"
        FROM public."ReviewVote" AS vote
       WHERE vote."userId" = request_user_id
    ) AS candidate;

  IF affected_review_ids IS NULL THEN
    RETURN 0;
  END IF;

  -- Parent deletion and the owner toggle both lock Review before ReviewVote.
  -- Lock the bounded affected set in stable order before removing child rows;
  -- the User lock plus the insert guard prevents this actor from adding a vote
  -- while account deletion is in flight.
  PERFORM 1
    FROM public."Review" AS review
   WHERE review.id = ANY (affected_review_ids)
   ORDER BY review.id
   FOR NO KEY UPDATE;

  DELETE FROM public."ReviewVote"
   WHERE "userId" = request_user_id;
  GET DIAGNOSTICS deleted_count = ROW_COUNT;

  -- Reconcile the bounded affected set so the deletion is exact and retries
  -- also close any predecessor drift. The final activation may install a
  -- general delete trigger only after predecessor traffic is drained.
  WITH exact_counts AS (
    SELECT review.id,
           pg_catalog.count(vote."reviewId")::integer AS value
      FROM public."Review" AS review
      LEFT JOIN public."ReviewVote" AS vote
        ON vote."reviewId" = review.id
     WHERE review.id = ANY (affected_review_ids)
     GROUP BY review.id
  )
  UPDATE public."Review" AS review
     SET "helpfulCount" = exact_counts.value
    FROM exact_counts
   WHERE review.id = exact_counts.id
     AND review."helpfulCount" <> exact_counts.value;

  RETURN deleted_count;
END;
$grainline_review_vote_owner_delete_all$;

REVOKE ALL ON FUNCTION public.grainline_review_vote_insert_guard()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_delete_lock_guard()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_update_forbidden()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_owner_toggle(text)
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_owner_export()
  FROM PUBLIC, grainline_app_runtime;
REVOKE ALL ON FUNCTION public.grainline_review_vote_owner_delete_all()
  FROM PUBLIC, grainline_app_runtime;

GRANT EXECUTE ON FUNCTION public.grainline_review_vote_owner_toggle(text)
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_review_vote_owner_export()
  TO grainline_app_runtime;
GRANT EXECUTE ON FUNCTION public.grainline_review_vote_owner_delete_all()
  TO grainline_app_runtime;

ALTER TABLE public."ReviewVote"
  VALIDATE CONSTRAINT "ReviewVote_value_one_chk";
ALTER TABLE public."Review"
  VALIDATE CONSTRAINT "Review_helpfulCount_nonnegative_chk";

DO $grainline_review_vote_postflight$
DECLARE
  drift_count bigint;
  missing_functions text[];
  reviewed_function text;
BEGIN
  SELECT pg_catalog.count(*)::bigint
    INTO drift_count
    FROM public."Review" AS review
    LEFT JOIN LATERAL (
      SELECT pg_catalog.count(*)::integer AS value
        FROM public."ReviewVote" AS vote
       WHERE vote."reviewId" = review.id
    ) AS actual ON true
   WHERE review."helpfulCount" <> actual.value;
  IF drift_count <> 0 THEN
    RAISE EXCEPTION 'ReviewVote projection drifted for % reviews', drift_count;
  END IF;

  SELECT pg_catalog.array_agg(expected.signature ORDER BY expected.signature)
    INTO missing_functions
    FROM (
      VALUES
        ('public.grainline_review_vote_insert_guard()'),
        ('public.grainline_review_vote_delete_lock_guard()'),
        ('public.grainline_review_vote_update_forbidden()'),
        ('public.grainline_review_vote_owner_toggle(text)'),
        ('public.grainline_review_vote_owner_export()'),
        ('public.grainline_review_vote_owner_delete_all()')
    ) AS expected(signature)
   WHERE pg_catalog.to_regprocedure(expected.signature) IS NULL;
  IF missing_functions IS NOT NULL THEN
    RAISE EXCEPTION 'ReviewVote preparation functions are missing: %', missing_functions;
  END IF;

  FOREACH reviewed_function IN ARRAY ARRAY[
    'public.grainline_review_vote_insert_guard()',
    'public.grainline_review_vote_delete_lock_guard()',
    'public.grainline_review_vote_update_forbidden()',
    'public.grainline_review_vote_owner_toggle(text)',
    'public.grainline_review_vote_owner_export()',
    'public.grainline_review_vote_owner_delete_all()'
  ] LOOP
    IF NOT EXISTS (
      SELECT 1
        FROM pg_catalog.pg_proc AS procedure
        JOIN pg_catalog.pg_roles AS owner
          ON owner.oid = procedure.proowner
       WHERE procedure.oid = pg_catalog.to_regprocedure(reviewed_function)
         AND procedure.prosecdef
         AND procedure.proconfig = ARRAY['search_path=pg_catalog']::text[]
         AND (owner.rolsuper OR owner.rolbypassrls)
    ) THEN
      RAISE EXCEPTION 'ReviewVote preparation function posture drifted: %', reviewed_function;
    END IF;
    IF pg_catalog.has_function_privilege(
         0,
         pg_catalog.to_regprocedure(reviewed_function),
         'EXECUTE'
       ) THEN
      RAISE EXCEPTION 'ReviewVote preparation function exposes PUBLIC EXECUTE: %', reviewed_function;
    END IF;
  END LOOP;

  IF (SELECT pg_catalog.count(*) FROM pg_catalog.pg_trigger
       WHERE tgrelid = 'public."ReviewVote"'::pg_catalog.regclass
         AND NOT tgisinternal) <> 3
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public."ReviewVote"'::pg_catalog.regclass
          AND NOT tgisinternal
          AND tgname = 'ReviewVote_insert_guard'
          AND tgtype = 7
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public."ReviewVote"'::pg_catalog.regclass
          AND NOT tgisinternal
          AND tgname = 'ReviewVote_delete_lock_guard'
          AND tgtype = 11
     )
     OR NOT EXISTS (
       SELECT 1 FROM pg_catalog.pg_trigger
        WHERE tgrelid = 'public."ReviewVote"'::pg_catalog.regclass
          AND NOT tgisinternal
          AND tgname = 'ReviewVote_update_forbidden'
          AND tgtype = 19
     ) THEN
    RAISE EXCEPTION 'ReviewVote preparation triggers are incomplete';
  END IF;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_class AS relation
     WHERE relation.oid = 'public."ReviewVote"'::pg_catalog.regclass
       AND (relation.relrowsecurity OR relation.relforcerowsecurity)
  ) THEN
    RAISE EXCEPTION 'ReviewVote RLS changed during compatible preparation';
  END IF;
END;
$grainline_review_vote_postflight$;

COMMIT;
