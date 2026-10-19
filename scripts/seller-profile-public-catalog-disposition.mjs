export const SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS = new Set([
  "grainline_blog_comment_author_public_state_bind()",
  "grainline_blog_post_author_public_state_bind()",
  "grainline_case_account_deletion_redact(text)",
  "grainline_case_relationship_valid()",
  "grainline_case_seller_refund_apply(text,text)",
  "grainline_checkout_reservation_create_cart_consistent(text,text,text,text,text,jsonb)",
  "grainline_checkout_reservation_create_cart(text,text,text,text,text)",
  "grainline_checkout_reservation_create_single_consistent(text,text,integer,text[],text,jsonb)",
  "grainline_checkout_reservation_create_single(text,text,integer,text)",
  "grainline_checkout_reservation_seller_witness(text)",
  "grainline_commission_buyer_public_state_bind()",
  "grainline_conversation_listing_core(text,text,text)",
  "grainline_direct_upload_record_core(text,text,text,text,text,integer,text,text,text)",
  "grainline_direct_upload_source_delete_trigger()",
  "grainline_message_redact_for_account_deletion(text)",
  "grainline_notification_create_core(text,text,\"NotificationType\",text,text,text)",
  "grainline_order_account_deletion_scrub(text,text[])",
  "grainline_order_buyer_detail(text,text)",
  "grainline_order_seller_detail(text,text)",
  "grainline_order_seller_detail_v2(text,text)",
  "grainline_order_seller_recent_sales(text)",
  "grainline_order_staff_detail(text,text)",
  "grainline_order_staff_page(text,text,integer,integer)",
  "grainline_seller_profile_deauthorize_compat(text,text)",
  "grainline_seller_profile_private_initialize()",
  "grainline_seller_profile_private_supported_snapshot_sync()",
  "grainline_seller_profile_reconciliation_required_compat(text,text,text,timestamp without time zone)",
  "grainline_seller_profile_supported_snapshot_guard()",
  "grainline_seller_public_blog_state_sync()",
  "grainline_user_account_deletion_preflight(text)",
  "grainline_user_account_deletion_snapshot(text)",
  "grainline_user_public_seller_state_sync()",
]);

export const SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS = new Set([
  "grainline_seller_public_browse_nearby(double precision,double precision,double precision)",
  "grainline_seller_public_featured_makers()",
  "grainline_seller_public_follow_create(text,text)",
  "grainline_seller_public_follow_delete(text)",
  "grainline_seller_public_follow_state(text)",
  "grainline_seller_public_footer_metros()",
  "grainline_seller_public_location(text,text)",
  "grainline_seller_public_map_card(text)",
  "grainline_seller_public_map_points(integer)",
  "grainline_seller_public_marketplace_counts()",
  "grainline_seller_public_metro_count(text,boolean,boolean)",
  "grainline_seller_public_metro_makers(text,boolean,integer)",
  "grainline_seller_public_metro_static_slugs()",
  "grainline_seller_public_name_suggestions(text,text,boolean,integer)",
  "grainline_seller_public_nearby_metros(text)",
  "grainline_seller_public_report_target(text,text)",
  "grainline_seller_public_similar_makers(text,integer)",
  "grainline_seller_public_sitemap_counts()",
  "grainline_seller_public_sitemap_page(text,integer,integer)",
  "grainline_seller_public_view_target(text)",
  "grainline_seller_owner_account_summary()",
  "grainline_user_block_follow_cleanup(text)",
]);

export const SELLER_PROFILE_TRIGGER_DISPOSITIONS = new Map([
  ["SellerProfile_private_initialize", "grainline_seller_profile_private_initialize()"],
  ["SellerProfile_supported_snapshot_guard", "grainline_seller_profile_supported_snapshot_guard()"],
  ["grainline_direct_upload_release_seller_profile_delete", "grainline_direct_upload_source_delete_trigger()"],
  ["grainline_seller_owner_public_state_bind", "grainline_seller_owner_public_state_bind()"],
  ["grainline_seller_public_blog_state_sync", "grainline_seller_public_blog_state_sync()"],
  ["grainline_seller_public_commission_state_sync", "grainline_seller_public_commission_state_sync()"],
]);

function sameStrings(actual, expected) {
  return actual.length === expected.length
    && [...actual].sort().every((value, index) => value === [...expected].sort()[index]);
}

export function classifySellerProfileDatabaseObjects({ functions, triggers }) {
  if (functions.length !== 152) {
    throw new Error(`SellerProfile function inventory drifted: expected 152, got ${functions.length}`);
  }
  for (const row of functions) {
    if (!row.security_definer || !row.config?.includes("search_path=pg_catalog")) {
      throw new Error(`SellerProfile function lost definer/search_path hardening: ${row.signature}`);
    }
    if (row.public_execute) {
      throw new Error(`SellerProfile function is executable by PUBLIC: ${row.signature}`);
    }
    const expectedGrantees = row.runtime_execute
      ? ["ci", "grainline_app_runtime"]
      : row.execute_grantees.includes("grainline_staff_read_runtime")
        ? ["ci", "grainline_staff_read_runtime"]
        : ["ci"];
    if (!sameStrings(row.execute_grantees, expectedGrantees)) {
      throw new Error(`SellerProfile function has an unclassified execute principal: ${row.signature}`);
    }
  }

  const internalSupportFunctions = functions.filter(
    (row) => !row.runtime_execute
      && !row.execute_grantees.includes("grainline_staff_read_runtime"),
  );
  const unexpectedInternalFunctions = internalSupportFunctions
    .map((row) => row.signature)
    .filter((signature) => !SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS.has(signature));
  const missingInternalFunctions = [...SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS]
    .filter((signature) => !internalSupportFunctions.some((row) => row.signature === signature));
  if (unexpectedInternalFunctions.length || missingInternalFunctions.length) {
    throw new Error(
      `SellerProfile internal function disposition drifted: unexpected=${unexpectedInternalFunctions.join(",") || "none"}; `
      + `missing=${missingInternalFunctions.join(",") || "none"}`,
    );
  }

  const convertedAuthorityFunctions = functions.filter((row) =>
    SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS.has(row.signature));
  const missingConvertedFunctions = [...SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS]
    .filter((signature) => !convertedAuthorityFunctions.some((row) => row.signature === signature));
  if (missingConvertedFunctions.length
      || convertedAuthorityFunctions.some((row) => !row.runtime_execute)) {
    throw new Error(
      `SellerProfile converted authority drifted: missing=${missingConvertedFunctions.join(",") || "none"}`,
    );
  }
  const retainedAuthorityFunctions = functions.filter(
    (row) => (row.runtime_execute
      || row.execute_grantees.includes("grainline_staff_read_runtime"))
      && !SELLER_PROFILE_CONVERTED_AUTHORITY_FUNCTIONS.has(row.signature),
  );
  if (retainedAuthorityFunctions.length !== 98
      || internalSupportFunctions.length !== 32
      || convertedAuthorityFunctions.length !== 22) {
    throw new Error(
      `SellerProfile function dispositions drifted: retained=${retainedAuthorityFunctions.length}; `
      + `internal=${internalSupportFunctions.length}; converted=${convertedAuthorityFunctions.length}`,
    );
  }

  const sellerProfileTriggers = triggers.filter((row) => row.table_name === '"SellerProfile"');
  const unexpectedSellerProfileTriggers = sellerProfileTriggers.filter(
    (row) => SELLER_PROFILE_TRIGGER_DISPOSITIONS.get(row.trigger_name) !== row.function_signature,
  );
  const missingSellerProfileTriggers = [...SELLER_PROFILE_TRIGGER_DISPOSITIONS]
    .filter(([triggerName, functionSignature]) => !sellerProfileTriggers.some(
      (row) => row.trigger_name === triggerName && row.function_signature === functionSignature,
    ));
  if (unexpectedSellerProfileTriggers.length || missingSellerProfileTriggers.length) {
    throw new Error(
      `SellerProfile trigger disposition drifted: unexpected=${JSON.stringify(unexpectedSellerProfileTriggers)}; `
      + `missing=${JSON.stringify(missingSellerProfileTriggers)}`,
    );
  }

  const functionFamilyCounts = {};
  for (const row of functions) {
    const family = row.signature.replace(/^grainline_/u, "").split("_")[0];
    const counts = functionFamilyCounts[family]
      ?? { total: 0, appRuntime: 0, staffRead: 0, internalSupport: 0 };
    counts.total += 1;
    if (row.runtime_execute) counts.appRuntime += 1;
    else if (row.execute_grantees.includes("grainline_staff_read_runtime")) counts.staffRead += 1;
    else counts.internalSupport += 1;
    functionFamilyCounts[family] = counts;
  }

  return {
    functionDispositions: {
      retainedAuthority: retainedAuthorityFunctions.length,
      internalSupport: internalSupportFunctions.length,
      convertedAuthority: convertedAuthorityFunctions.length,
      retiredPredecessor: 0,
    },
    functionFamilyCounts,
    sellerProfileTriggerDispositions: sellerProfileTriggers.map((row) => ({
      triggerName: row.trigger_name,
      functionSignature: row.function_signature,
      disposition: "INTERNAL_SUPPORT",
    })),
  };
}
