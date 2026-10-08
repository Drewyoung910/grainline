-- Reviewed policyless User FORCE hardening.
-- Apply only through the exact-main, CI-bound Production workflow after the
-- policyless User ENABLE predecessor and its zero-direct evidence are accepted.

BEGIN;
SET LOCAL lock_timeout = '10s';
SET LOCAL statement_timeout = '180s';

SELECT pg_catalog.pg_advisory_xact_lock(
  pg_catalog.hashtextextended('grainline.user.rls.force', 0)
);

LOCK TABLE public."User" IN ACCESS EXCLUSIVE MODE;

DO $grainline_user_force_preflight$
DECLARE
  table_owner oid;
  runtime_role_oid oid;
  staff_role_oid oid;
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
  accepted_migration_count integer;
  accepted_function_count integer;
  actual_reviewed_function_count integer;
  direct_user_reader_count integer;
  unsafe_direct_user_reader_count integer;
  accepted_index_count integer;
  actual_index_count integer;
  accepted_trigger_count integer;
  actual_trigger_count integer;
  accepted_constraint_count integer;
  actual_constraint_count integer;
BEGIN
  IF current_user <> session_user THEN
    RAISE EXCEPTION 'User FORCE requires a direct owner session';
  END IF;

  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = class.relnamespace
   WHERE namespace.nspname = 'public'
     AND class.relname = 'User'
     AND class.relkind = 'r';

  SELECT role.oid
    INTO STRICT runtime_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_app_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  SELECT role.oid
    INTO STRICT staff_role_oid
    FROM pg_catalog.pg_roles AS role
   WHERE role.rolname = 'grainline_staff_read_runtime'
     AND role.rolcanlogin
     AND NOT role.rolsuper
     AND NOT role.rolinherit
     AND NOT role.rolcreatedb
     AND NOT role.rolcreaterole
     AND NOT role.rolreplication
     AND NOT role.rolbypassrls;

  IF EXISTS (
    SELECT 1
      FROM pg_catalog.pg_auth_members AS membership
     WHERE membership.member IN (runtime_role_oid, staff_role_oid)
  ) THEN
    RAISE EXCEPTION 'User FORCE runtime role membership drifted';
  END IF;

  IF table_owner <> (
    SELECT role.oid
      FROM pg_catalog.pg_roles AS role
     WHERE role.rolname = current_user
  ) THEN
    RAISE EXCEPTION 'User FORCE table owner drifted';
  END IF;
  IF NOT (
    (
      current_user = 'neondb_owner'
      AND pg_catalog.current_database() = 'neondb'
      AND NOT (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
      AND (
        SELECT role.rolbypassrls
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
    OR
    (
      current_user = 'ci'
      AND pg_catalog.current_database() = 'grainline_ci'
      AND (
        SELECT role.rolsuper
          FROM pg_catalog.pg_roles AS role
         WHERE role.oid = table_owner
      )
    )
  ) THEN
    RAISE EXCEPTION 'User FORCE owner boundary is unreviewed';
  END IF;

  IF NOT (
    SELECT class.relrowsecurity AND NOT class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) THEN
    RAISE EXCEPTION 'User FORCE requires policyless ENABLE predecessor';
  END IF;

  SELECT pg_catalog.count(*)::integer
    INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> table_owner;
  IF nonowner_table_acl_count <> 0
     OR nonowner_column_acl_count <> 0
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User FORCE predecessor grants drifted';
  END IF;

  WITH expected(migration_name, checksum) AS (
    VALUES
      ('20261003100000_prepare_user_clerk_identity_authority', '1aaebc3f8ef52af7692a4f3701ba39549d3a285e8245976876a16d3cf0bc6bf9'),
      ('20261003230000_prepare_user_current_clerk_authorities', 'c3cd7b9b5da23074fe676593cf7cbfbd2765c7c0decac2f33e941c7f90a59386'),
      ('20261004000000_prepare_user_clerk_provider_lifecycle', '6c5407b40e59ef1a6734b042e01476d8665253bcfd3fb4a257b79fe4f2963a34'),
      ('20261004010000_prepare_user_owner_private_authorities', '07604e3a3d93c0a20bfbd13a3a6393c6bf7e5b4b158100ca91ef32794846291b'),
      ('20261004020000_prepare_user_signed_unsubscribe_authorities', '9dca041fa5d1a339e36459ef9fe2b3e0b0678bd0ffb9dc8a410510a3ad0d6dd4'),
      ('20261004030000_prepare_user_email_delivery_authorities', '315181ae09239090afb7bdb5bd5ba0c81d25338994f192f99e3975662cad345b'),
      ('20261004040000_prepare_user_public_member_aggregate', '79356a45557837d5788ede525813388fca68ff1ebaf78113d81de6c1fc5167cc'),
      ('20261004050000_prepare_user_public_seller_state', 'e55bd7d1c907322c2c4843401209f1ceb910416ff667e0565f78ef378b108696'),
      ('20261006010000_prepare_user_staff_ban_authorities', '6c8c38ff90ce800fc3bf0aa2ea429993749c3534dfd9500fce39db03bd8914bd'),
      ('20261006020000_prepare_user_account_deletion_authorities', '8afacbcd26da9a2f843c8780b4e0257efdf28a69677e070516d9e6233c97828f'),
      ('20261006030000_prepare_user_relationship_authorities', 'eef3833d5bccd93668cc32c5fcbbdda7ece7f6ee786407ea245e760c0c30bdae'),
      ('20261007010000_prepare_user_public_blog_state', 'd9229b3d9405df19e23972f857266cf4308fcbf0ff19d44bf1f0e5ec35299350'),
      ('20261007020000_prepare_user_public_review_commission_state', 'edb6d5f92503ade0d6e4e1f6bf98dbad5ab4b7a5c7e039275847d69ae97f81fb'),
      ('20261007030000_prepare_user_block_email_authorities', 'a9e1697ba9a572d07d0f5311d1a380b55c5883253181962a71ef5383ff7e1c00'),
      ('20261007040000_prepare_user_follower_authorities', 'ed12711d7729a94be0d75f5c3d80ccbfac27280d26f207fcf7ca44ecd733622f'),
      ('20261007150000_prepare_user_staff_admin_labels', '7657e99e0e809471936e96d4ec0c5f84ad6afefabe5296ae3ffe7a021bfbe5d7'),
      ('20261007155000_correct_user_clerk_identity_placeholder', 'b1968d60b24e3472c6ea7a780322f23b30a26804a93531ea9fc66b344cc69418'),
      ('20261007160000_converge_user_cross_domain_authorities', 'fad2c67b0ed3ed4d762a7a5d7d491ba8cca1ab33dc6f0253d8dff845933c4302'),
      ('20261008010000_enable_user_rls', '628f1cbb966cde1cb7f05f48ea0c5b890dce074d8f77536b3a67117c0141146f')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_migration_count
    FROM expected
    JOIN public._prisma_migrations AS migration
      ON migration.migration_name = expected.migration_name
     AND migration.checksum = expected.checksum
     AND migration.finished_at IS NOT NULL
     AND migration.rolled_back_at IS NULL
     AND migration.applied_steps_count = 1;
  IF accepted_migration_count <> 19 THEN
    RAISE EXCEPTION 'User FORCE migration ledger drifted';
  END IF;

  WITH expected(
    function_identity,
    source_md5,
    language_name,
    volatility,
    parallel_safety,
    acl_role
  ) AS (
    VALUES
      ('public.grainline_user_clerk_account(text)', '82d69a02d7c1add90bf2474a6f6c2ab3', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_clerk_gate(text)', '6b9a2c2cf280ef59c0a19d4ef76b39fb', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_clerk_actor(text)', 'b069f2651f5d6b2913608cc51de00a5e', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_clerk_commission_context(text)', '91b15e41c561b38feac917db5ac3d45b', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_clerk_lifecycle_state(text)', '31a91940a1c1d5da3aa18adb49f77a86', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_clerk_welcome_reserve(text, text)', '848d470481cd7d5150fad16da44488d6', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_owner_shipping_address_update(text, text, text, text, text, text, text, text)', 'ef95992d4557796cc70161e9bf7b9730', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_owner_legal_acceptance(text, text)', '13567a77878d880f9c4b7844ab69f928', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_owner_notification_preference_update(text, text, boolean)', '67a3a4e9ee00076393dd050daf2158b7', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_unsubscribe_token_superseded(text[], timestamp without time zone)', '3bba022ffb1fbfa364a47703aaabde13', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_unsubscribe_preferences_disable(text[])', '11485f55b3bec34f2091430245a4a2cf', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_email_recipient(text, text)', 'd432e2801da898e4bf6599ba45a2fcf2', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_email_recipient_batch(text[], text)', '0d9240133625e543714cf6c3d3791b80', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_email_account_state_by_id(text, text)', 'c7ffe3ac51f3cb4d19bfcf24dc31ebd1', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_email_account_state_by_email(text)', 'ee42b76e0d0a21abe1303b855a8bed52', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_public_active_member_count()', '3a8a443d93c74e9d5c8aa602c8d9e87a', 'sql', 's', 's', 'grainline_app_runtime'),
      ('public.grainline_seller_owner_public_state_bind()', '30616fc4688aa025d4a4e6cf0b6bbe89', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_user_public_seller_state_sync()', 'c6ec5db8fb7ce7e3f2887571334affda', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_user_staff_directory_count(text, text)', '2d642ec4192bc39a4719a61eacff6dd9', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_directory_page(text, text, integer)', 'f946822b7b4f502826a0dcee5e578831', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_exact_email_target(text, text)', '826fb0a502db7f95371e734ccf62f45b', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_report_labels(text, text[])', '8d016318ea2af985bddfcfa49ba87a58', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_email_recipient(text, text, text)', '043be3c46e269eefa2af579f22ad5bd6', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_ban_target(text, text)', '08e25f2d2451d9f0b5662767f996a240', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_capability_mint(text, text, text, timestamp without time zone)', '0897131156a9904e9d0f4159f6d8fe24', 'plpgsql', 'v', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_ban_repair_target(text, text)', '44e0cbccd6662ab4dece670463ec4e83', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_staff_ban_apply(text, text, timestamp without time zone, text)', '1ad3e2eb194e15d04ff5b8eecfca4ae6', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_staff_unban_apply(text, text, timestamp without time zone)', '28f50b9e7797fb603348abba39cb27c6', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_provider_deleted_defer(text)', 'c60e33a5e314da13b86af5d61939907c', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_account_deletion_preflight(text)', '377f16e791a7d73b6305948e3d516b95', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_account_deletion_snapshot(text)', 'd7e8e622f7632509f53f7ee51f88a406', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_account_deletion_finalize(text)', '8afb4cda989350aa0d490c27cabfc97e', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_relationship_target_state(text, text)', '18dc4447cdf2a8ccacdeb46bd589a3aa', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_conversation_participants(text, text)', '44c3946959d09676749bdf7e0c9e286c', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_custom_order_seller_state(text, text)', 'e6e8c6bf4daa6a044adcb51b96bb22f8', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_owner_notification_preferences(text)', 'c2928ac3f687fda25c0aeee52ea7bfe4', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_blog_post_author_public_state_bind()', 'ac177b2a173e7ef8bf78e3f2df2ec762', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_blog_comment_author_public_state_bind()', '1fc28b0d911b5907cdd4d7d4fe027eb7', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_user_public_blog_state_sync()', '4342d0f9566dae990b00aec51552db2d', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_seller_public_blog_state_sync()', '9471ba9ed3dd7c7e79e794507bcea02c', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_review_reviewer_public_state_bind()', 'c876dc451748740b0478bad2d6259dd4', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_commission_buyer_public_state_bind()', 'b5dcbae3dd2db834f77f3bb2c41ba2f3', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_user_public_review_commission_state_sync()', '7f92af92020752847c97278b035102a0', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_seller_public_commission_state_sync()', 'd0377683c28833f204239312c8fb9fbd', 'plpgsql', 'v', 'u', ''),
      ('public.grainline_user_block_targets()', 'bf994c0100d2de822e48dd42abdf6fb8', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_blocked_account_page()', '2fb7024df51a99615aa25eb5ed01d876', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_block_pair_lock(text)', '7a76e6427291eca1619adf9ca6354348', 'plpgsql', 'v', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_email_fallback_addresses()', 'd72916d00bab1c26e1bc689f3d15722c', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_follower_notification_page(text, text, integer)', '471b1caf9907d6d370ec1cb8ea5aa718', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_owner_broadcast_follower_page(text, text, integer, boolean)', '0986f9362622c2c1e4caaf27ca083308', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_public_listing_favorite_counts(text[])', 'b5eef25129ac0ff0397865758a5e980e', 'plpgsql', 's', 'u', 'grainline_app_runtime'),
      ('public.grainline_user_staff_admin_labels(text, text[])', '8643a8899833946d6c8019f9da7e7d9b', 'plpgsql', 's', 'u', 'grainline_staff_read_runtime'),
      ('public.grainline_user_clerk_identity_ensure(text, text, text, boolean, text, boolean, text, boolean)', 'ddbd40600df8fe58f00661a900e44833', 'plpgsql', 'v', 'u', 'grainline_app_runtime')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_function_count
    FROM expected
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = pg_catalog.to_regprocedure(expected.function_identity)
    JOIN pg_catalog.pg_language AS language
      ON language.oid = procedure.prolang
   WHERE procedure.prokind = 'f'
     AND procedure.proowner = table_owner
     AND procedure.prosecdef
     AND NOT procedure.proleakproof
     AND language.lanname = expected.language_name
     AND procedure.provolatile = expected.volatility
     AND procedure.proparallel = expected.parallel_safety
     AND COALESCE(procedure.proconfig, ARRAY[]::text[]) =
       ARRAY['search_path=pg_catalog']::text[]
     AND pg_catalog.md5(procedure.prosrc) = expected.source_md5
     AND pg_catalog.strpos(pg_catalog.upper(procedure.prosrc), 'EXECUTE') = 0
     AND (
       SELECT pg_catalog.count(*)::integer
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
     ) = CASE WHEN expected.acl_role = '' THEN 0 ELSE 1 END
     AND (
       expected.acl_role = ''
       OR pg_catalog.has_function_privilege(
         expected.acl_role, procedure.oid, 'EXECUTE'
       )
     )
     AND NOT EXISTS (
       SELECT 1
         FROM pg_catalog.aclexplode(
           COALESCE(
             procedure.proacl,
             pg_catalog.acldefault('f', procedure.proowner)
           )
         ) AS acl
        WHERE acl.grantee <> procedure.proowner
          AND (
            expected.acl_role = ''
            OR acl.grantee <> (
              SELECT role.oid
                FROM pg_catalog.pg_roles AS role
               WHERE role.rolname = expected.acl_role
            )
            OR acl.privilege_type <> 'EXECUTE'
            OR acl.is_grantable
          )
     );

  WITH expected(function_identity) AS (
    VALUES
      ('public.grainline_user_clerk_account(text)'),
      ('public.grainline_user_clerk_gate(text)'),
      ('public.grainline_user_clerk_actor(text)'),
      ('public.grainline_user_clerk_commission_context(text)'),
      ('public.grainline_user_clerk_lifecycle_state(text)'),
      ('public.grainline_user_clerk_welcome_reserve(text, text)'),
      ('public.grainline_user_owner_shipping_address_update(text, text, text, text, text, text, text, text)'),
      ('public.grainline_user_owner_legal_acceptance(text, text)'),
      ('public.grainline_user_owner_notification_preference_update(text, text, boolean)'),
      ('public.grainline_user_unsubscribe_token_superseded(text[], timestamp without time zone)'),
      ('public.grainline_user_unsubscribe_preferences_disable(text[])'),
      ('public.grainline_user_email_recipient(text, text)'),
      ('public.grainline_user_email_recipient_batch(text[], text)'),
      ('public.grainline_user_email_account_state_by_id(text, text)'),
      ('public.grainline_user_email_account_state_by_email(text)'),
      ('public.grainline_user_public_active_member_count()'),
      ('public.grainline_seller_owner_public_state_bind()'),
      ('public.grainline_user_public_seller_state_sync()'),
      ('public.grainline_user_staff_directory_count(text, text)'),
      ('public.grainline_user_staff_directory_page(text, text, integer)'),
      ('public.grainline_user_staff_exact_email_target(text, text)'),
      ('public.grainline_user_staff_report_labels(text, text[])'),
      ('public.grainline_user_staff_email_recipient(text, text, text)'),
      ('public.grainline_user_staff_ban_target(text, text)'),
      ('public.grainline_user_staff_capability_mint(text, text, text, timestamp without time zone)'),
      ('public.grainline_user_ban_repair_target(text, text)'),
      ('public.grainline_user_staff_ban_apply(text, text, timestamp without time zone, text)'),
      ('public.grainline_user_staff_unban_apply(text, text, timestamp without time zone)'),
      ('public.grainline_user_provider_deleted_defer(text)'),
      ('public.grainline_user_account_deletion_preflight(text)'),
      ('public.grainline_user_account_deletion_snapshot(text)'),
      ('public.grainline_user_account_deletion_finalize(text)'),
      ('public.grainline_user_relationship_target_state(text, text)'),
      ('public.grainline_user_conversation_participants(text, text)'),
      ('public.grainline_user_custom_order_seller_state(text, text)'),
      ('public.grainline_user_owner_notification_preferences(text)'),
      ('public.grainline_blog_post_author_public_state_bind()'),
      ('public.grainline_blog_comment_author_public_state_bind()'),
      ('public.grainline_user_public_blog_state_sync()'),
      ('public.grainline_seller_public_blog_state_sync()'),
      ('public.grainline_review_reviewer_public_state_bind()'),
      ('public.grainline_commission_buyer_public_state_bind()'),
      ('public.grainline_user_public_review_commission_state_sync()'),
      ('public.grainline_seller_public_commission_state_sync()'),
      ('public.grainline_user_block_targets()'),
      ('public.grainline_user_blocked_account_page()'),
      ('public.grainline_user_block_pair_lock(text)'),
      ('public.grainline_user_email_fallback_addresses()'),
      ('public.grainline_user_follower_notification_page(text, text, integer)'),
      ('public.grainline_user_owner_broadcast_follower_page(text, text, integer, boolean)'),
      ('public.grainline_user_public_listing_favorite_counts(text[])'),
      ('public.grainline_user_staff_admin_labels(text, text[])'),
      ('public.grainline_user_clerk_identity_ensure(text, text, text, boolean, text, boolean, text, boolean)')
  )
  SELECT pg_catalog.count(*)::integer
    INTO actual_reviewed_function_count
    FROM pg_catalog.pg_proc AS procedure
   WHERE procedure.oid IN (
     SELECT pg_catalog.to_regprocedure(expected.function_identity)
       FROM expected
   );
  IF accepted_function_count <> 53 OR actual_reviewed_function_count <> 53 THEN
    RAISE EXCEPTION
      'User FORCE authority catalog drifted: accepted=%, actual=%',
      accepted_function_count,
      actual_reviewed_function_count;
  END IF;

  SELECT pg_catalog.count(*)::integer,
         pg_catalog.count(*) FILTER (
           WHERE procedure.prosecdef
         )::integer
    INTO direct_user_reader_count, accepted_function_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0;
  SELECT pg_catalog.count(*)::integer
    INTO unsafe_direct_user_reader_count
    FROM pg_catalog.pg_proc AS procedure
    JOIN pg_catalog.pg_namespace AS namespace
      ON namespace.oid = procedure.pronamespace
   WHERE namespace.nspname = 'public'
     AND pg_catalog.strpos(procedure.prosrc, 'public."User"') > 0
     AND NOT procedure.prosecdef;
  IF direct_user_reader_count < 53
     OR accepted_function_count <> direct_user_reader_count
     OR unsafe_direct_user_reader_count <> 0 THEN
    RAISE EXCEPTION 'User FORCE cross-domain reader mode drifted';
  END IF;

  IF NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = pg_catalog.to_regprocedure(
       'public.grainline_conversation_inbox(text,boolean,text,timestamp without time zone,text,integer)'
     )
       AND NOT procedure.prosecdef
       AND pg_catalog.md5(procedure.prosrc) = '4b2884765f4ca0db432c4678f98b1bdd'
       AND pg_catalog.strpos(procedure.prosrc, 'public."User"') = 0
       AND pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
  ) OR NOT EXISTS (
    SELECT 1
      FROM pg_catalog.pg_proc AS procedure
     WHERE procedure.oid = pg_catalog.to_regprocedure(
       'public.grainline_case_resolution_claim_immutable()'
     )
       AND procedure.prosecdef
       AND pg_catalog.md5(procedure.prosrc) = '06289e9db780c559e07188c20e680887'
       AND NOT pg_catalog.has_function_privilege(
         'grainline_app_runtime', procedure.oid, 'EXECUTE'
       )
  ) THEN
    RAISE EXCEPTION 'User FORCE cross-domain convergence drifted';
  END IF;

  WITH expected(index_name, unique_index) AS (
    VALUES
      ('User_pkey', true),
      ('User_clerkId_key', true),
      ('User_email_key', true),
      ('User_deletedAt_idx', false),
      ('User_banned_deletedAt_idx', false),
      ('User_active_email_suppression_key_idx', false)
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_index_count
    FROM expected
    JOIN pg_catalog.pg_class AS index_class
      ON index_class.relname = expected.index_name
    JOIN pg_catalog.pg_index AS index_row
      ON index_row.indexrelid = index_class.oid
   WHERE index_row.indrelid = 'public."User"'::pg_catalog.regclass
     AND index_row.indisunique = expected.unique_index
     AND index_row.indisvalid
     AND index_row.indisready
     AND index_row.indislive;
  SELECT pg_catalog.count(*)::integer
    INTO actual_index_count
    FROM pg_catalog.pg_index AS index_row
   WHERE index_row.indrelid = 'public."User"'::pg_catalog.regclass;
  IF accepted_index_count <> 6 OR actual_index_count <> 6 THEN
    RAISE EXCEPTION 'User FORCE index posture drifted';
  END IF;

  WITH expected(trigger_name, function_name) AS (
    VALUES
      ('grainline_user_public_seller_state_sync',
       'grainline_user_public_seller_state_sync'),
      ('grainline_user_public_blog_state_sync',
       'grainline_user_public_blog_state_sync'),
      ('grainline_user_public_review_commission_state_sync',
       'grainline_user_public_review_commission_state_sync')
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_trigger_count
    FROM expected
    JOIN pg_catalog.pg_trigger AS trigger_row
      ON trigger_row.tgname = expected.trigger_name
    JOIN pg_catalog.pg_proc AS procedure
      ON procedure.oid = trigger_row.tgfoid
   WHERE trigger_row.tgrelid = 'public."User"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal
     AND trigger_row.tgenabled = 'O'
     AND procedure.proname = expected.function_name;
  SELECT pg_catalog.count(*)::integer
    INTO actual_trigger_count
    FROM pg_catalog.pg_trigger AS trigger_row
   WHERE trigger_row.tgrelid = 'public."User"'::pg_catalog.regclass
     AND NOT trigger_row.tgisinternal;
  IF accepted_trigger_count <> 3 OR actual_trigger_count <> 3 THEN
    RAISE EXCEPTION 'User FORCE trigger posture drifted';
  END IF;

  WITH expected(constraint_name, constraint_type) AS (
    VALUES
      ('User_pkey', 'p'::"char"),
      ('User_notificationPreferences_shape_chk', 'c'::"char"),
      ('User_notificationPreferences_size_chk', 'c'::"char")
  )
  SELECT pg_catalog.count(*)::integer
    INTO accepted_constraint_count
    FROM expected
    JOIN pg_catalog.pg_constraint AS constraint_row
      ON constraint_row.conname = expected.constraint_name
   WHERE constraint_row.conrelid = 'public."User"'::pg_catalog.regclass
     AND constraint_row.contype = expected.constraint_type
     AND constraint_row.convalidated;
  SELECT pg_catalog.count(*)::integer
    INTO actual_constraint_count
    FROM pg_catalog.pg_constraint AS constraint_row
   WHERE constraint_row.conrelid = 'public."User"'::pg_catalog.regclass;
  IF accepted_constraint_count <> 3 OR actual_constraint_count <> 3 THEN
    RAISE EXCEPTION 'User FORCE constraint posture drifted';
  END IF;
END
$grainline_user_force_preflight$;

ALTER TABLE public."User" FORCE ROW LEVEL SECURITY;

DO $grainline_user_force_postflight$
DECLARE
  table_owner oid;
  nonowner_table_acl_count integer;
  nonowner_column_acl_count integer;
BEGIN
  SELECT class.relowner
    INTO STRICT table_owner
    FROM pg_catalog.pg_class AS class
   WHERE class.oid = 'public."User"'::pg_catalog.regclass;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_table_acl_count
    FROM pg_catalog.pg_class AS class
    CROSS JOIN LATERAL pg_catalog.aclexplode(
      COALESCE(class.relacl, pg_catalog.acldefault('r', class.relowner))
    ) AS acl
   WHERE class.oid = 'public."User"'::pg_catalog.regclass
     AND acl.grantee <> class.relowner;
  SELECT pg_catalog.count(*)::integer
    INTO nonowner_column_acl_count
    FROM pg_catalog.pg_attribute AS attribute
    CROSS JOIN LATERAL pg_catalog.aclexplode(attribute.attacl) AS acl
   WHERE attribute.attrelid = 'public."User"'::pg_catalog.regclass
     AND attribute.attnum > 0
     AND NOT attribute.attisdropped
     AND acl.grantee <> table_owner;
  IF NOT (
    SELECT class.relrowsecurity AND class.relforcerowsecurity
      FROM pg_catalog.pg_class AS class
     WHERE class.oid = 'public."User"'::pg_catalog.regclass
  ) OR EXISTS (
    SELECT 1
      FROM pg_catalog.pg_policy AS policy
     WHERE policy.polrelid = 'public."User"'::pg_catalog.regclass
  ) OR nonowner_table_acl_count <> 0
     OR nonowner_column_acl_count <> 0
     OR pg_catalog.has_table_privilege(
       'grainline_app_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     OR pg_catalog.has_table_privilege(
       'grainline_staff_read_runtime', 'public."User"', 'SELECT,INSERT,UPDATE,DELETE'
     )
     THEN
    RAISE EXCEPTION 'User FORCE postflight did not reach policyless zero-direct state';
  END IF;
END
$grainline_user_force_postflight$;

COMMIT;
