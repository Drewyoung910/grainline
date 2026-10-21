import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const preparationRows = [
  ["20261019010000_prepare_seller_profile_public_map_authority", "25193a54dbf69e37d069390005d36dab09643c9c3dcf4856f782a2b0313073b6"],
  ["20261019020000_prepare_seller_profile_public_location_authority", "a39d12ed273a726aa8c672c5f7573089b0f97bcd29d7d6ad544a6cbd2a35b476"],
  ["20261019030000_prepare_seller_profile_public_browse_authority", "da1f272743b97b9f6b921e208f2b3e7e3e952ac65184b7d6d93d6454d2b0be36"],
  ["20261019040000_prepare_seller_profile_public_name_authority", "7dc4c93e4d29af8166fb58d694cff6432cd9b5c62b57119c47b31f0470ad17a1"],
  ["20261019050000_prepare_seller_profile_public_sitemap_authority", "f12b64e02603f9142bf633b9884f77d1633253529f33dce073a547449a8cbe98"],
  ["20261019060000_prepare_seller_profile_public_marketplace_counts", "ba0980df1115cbab28e869c5519126b08f3e34a83ab9ef0054dafd53b71a67a8"],
  ["20261019070000_prepare_seller_profile_public_metro_count", "69f7d237d6c106c498f81f314d64f7e4a1e405f2484187d04b19ffd1fe7cd72a"],
  ["20261019080000_prepare_seller_profile_public_similar_makers", "8bea99e1e51f11361c35139a2d75183204f0cd33a20bafd8924e7dddc9a649b9"],
  ["20261019090000_prepare_seller_profile_public_featured_makers", "d049c645d0ce85230eaa6134b585cf4891ccfb90380f58cc4b1b89f61f6205b6"],
  ["20261019100000_prepare_seller_profile_public_map_card", "65d818e962a3056a682e3ab76b01345ae82817427bb01a007f32da7a72da47ac"],
  ["20261019110000_prepare_seller_profile_public_metro_directory", "3e1c576dac1f9d2123a6fb3b695ca2483a2f9fc1fade2047e20a3bf7f84828a6"],
  ["20261019120000_prepare_seller_profile_public_footer_metros", "722cafad100b347a0fdd669ce1e16f63ea6aecf9adba721eac53fe93c3158638"],
  ["20261019130000_prepare_seller_profile_public_view_target", "4004dcf2f8da8b59752da4eba46863d9ff6c0a3229ecd1b23921741aa8adff29"],
  ["20261019140000_prepare_seller_profile_block_follow_cleanup", "5b56459ec32d62116fc12cfce7870fc6a778ea2cd922029d83c5f18c1a404d84"],
  ["20261019150000_prepare_seller_profile_public_report_target", "70e28281827123f0a7c14400c3c1eaa65bb2f0d8044d7568cd029b201c7bde6f"],
  ["20261019160000_prepare_seller_profile_owner_account_summary", "85bdd6251d25251568798742eadfdccf312c5f25057db7e0f79e9afbcae84e37"],
  ["20261019170000_prepare_seller_profile_follow_authority", "011181ae7b57698345c651702f18b6c1d172f1323e67b8dd3b7a2ef6c4d0ae47"],
  ["20261019180000_prepare_seller_profile_owner_core", "378c3abe7060f1a8c3bd229bd3a73ccc9072256017bcace4f62833b98e264e18"],
  ["20261019190000_prepare_seller_profile_owner_blog_editor", "c984a369dee02cf4011708e57eb24138dc657bfcabbab92bf5f921c15a0096fb"],
  ["20261019200000_prepare_seller_profile_owner_listing_review", "02273b11ee46fa9689e6c0a2be32346cc256c479186f366a9f6b21351dd671ea"],
  ["20261019210000_prepare_seller_profile_owner_listing_metro_source", "b4a11ed2aaf432aea4d7f6e3663e812698b54df63b140361cfd8af23517b7e90"],
  ["20261019220000_prepare_seller_profile_owner_listing_publish_review", "807242150ef6452d1e99c9f3b5201badc9c241dc14ca13f0ac612392a8e16d63"],
  ["20261019230000_prepare_seller_profile_owner_dashboard_state", "2d3ac9d43531942a9f94d0b2f4659e9379c3123204e7712595d4713310d28ef1"],
  ["20261020000000_prepare_seller_profile_conversation_participant_cards", "8bd46a842ff4f3e31b42278bdf3ed91cbc8aee0509c2242b85fc64b61d6903c2"],
  ["20261020010000_prepare_seller_profile_owner_vacation_update", "d4ec24cd7d2b3bcd8da76acf030fab0db9c6a18d619a0bf8a7b8916c7481d0dc"],
  ["20261020020000_prepare_seller_profile_public_blog_author", "c164cc97898dd0d84b3a824159ba7e007f6ddd21a15c362262d32f62e27923c0"],
  ["20261020030000_correct_seller_profile_conversation_participant_cards", "e5488c3b8db5f0b8b349f60e69c3a995017e82be57e3e635eff22ccaef08705f"],
  ["20261020040000_prepare_seller_profile_account_feed_cards", "2991cceb677b83aa75fbe10c5d7a0014b6afbdba42e185c1e94c0249b5072573"],
  ["20261020050000_prepare_seller_profile_customer_photo_header", "4a9c8d656605405aeb2ce89abbde5d31bb98ccf3db45646506b653397e95536a"],
  ["20261020060000_prepare_seller_profile_founding_maker_grant", "5ee05b3a5c8f06c63602dcc0df326e3c1b7f3e35df13dec6e033e04bae3c5971"],
  ["20261020070000_prepare_seller_profile_metrics_identity", "5a2c3ac19d76cc00b6d911e2040b748c332c1595376d6a13bc3ae436acaf6ab4"],
  ["20261020080000_prepare_seller_profile_service_identities", "b4a2ad97489e203016d843b2fe084b36cc62d6d8d64682bd43be6721937e56c2"],
  ["20261020090000_prepare_seller_profile_exact_map_consent", "671899f5b0939c4986983ce07b7e0331ec7b28987b98d55a8ded2854cc0dedad"],
  ["20261020100000_prepare_seller_profile_public_profile_authority", "f4366cf05dcd3d53f75d148e95b7dc78bcab3d292c1fa17d2184e23139402a29"],
  ["20261020110000_prepare_seller_profile_owner_guild_application_state", "0fa4353f4dc8c7317a73912f542b94e9160af9def759be1cbcce322d90ddcacc"],
  ["20261020120000_prepare_seller_profile_owner_bootstrap", "6f3fcee52d8e7b39dcf5c4e1e0e357fa35c3f288f124de738028618484868a80"],
  ["20261020130000_prepare_seller_profile_staff_report_targets", "4679ea74eb3680327ea4819f0d08226290c0962ab137d2c066f216a031b47f04"],
  ["20261020140000_prepare_seller_profile_staff_feature_transition", "2932c7222c2d7f371437c3e004239680bcf94a1825fc007f4fff7be278c579b6"],
  ["20261020150000_prepare_seller_profile_account_deletion_media", "2abae33161112015bc2571f0a313d37351cf4ec9304ffe0f1159db236d4848da"],
  ["20261020160000_prepare_seller_profile_owner_featured_listing_toggle", "995aff448bbb0aedc196797e51abedb0d1e11dcf3509e8b9fbba556550dc0afb"],
  ["20261020170000_prepare_seller_profile_owner_auxiliary_updates", "fb2179840cac27db6a0992a9859fcb09ae149fa0bdc44e1f397ee538257ef550"],
  ["20261020180000_prepare_seller_profile_owner_onboarding_state", "5b331072c75d0aa5905cbb3759164e73274e93f810b8f8286a492e56350a6c42"],
  ["20261020190000_prepare_seller_profile_owner_dashboard_states", "f6a2899c1d9154684ba2828175ec04d8ae4a8357fcf332e2a1b7c9d390e87726"],
  ["20261020200000_prepare_seller_profile_owner_profile_editor", "bbd8169ef1b51b30512f035e5c33ffa70296b2964f315ce68e0d87cc5e4bc29c"],
  ["20261020210000_correct_seller_exact_map_consent_evidence", "18e75324c5ba5a8f7d44a8eed34fc114e3ca07ec34d5fce64fa7c2dcb93014eb"],
  ["20261020220000_prepare_seller_profile_owner_residual_authorities", "755714e79d73bd383a4f6f67c6c773e002fe402988716cfb87cbde67bb54c0c8"],
  ["20261020230000_prepare_seller_profile_staff_orderability_transition", "a6912d3fa0fd6c183cfa246d349b00ae1984d980411831e482b246a8b49226de"],
];

export const SELLER_PROFILE_PUBLIC_PREPARATIONS = Object.freeze(
  preparationRows.map(([name, checksum]) => Object.freeze({ name, checksum })),
);

export const SELLER_PROFILE_PUBLIC_ENABLE = Object.freeze({
  name: "20261020240000_enable_seller_profile_rls",
  checksum: "0ffbb49886ed5be2269fe6808da1058b6cc9cb7d50df16e02afb0053735141a9",
});

export function sellerProfilePublicPreparationNames() {
  return SELLER_PROFILE_PUBLIC_PREPARATIONS.map(({ name }) => name);
}

export function verifySellerProfilePublicPreparationSources(root = process.cwd()) {
  assert.equal(SELLER_PROFILE_PUBLIC_PREPARATIONS.length, 47);
  const seen = new Set();
  for (const migration of [
    ...SELLER_PROFILE_PUBLIC_PREPARATIONS,
    SELLER_PROFILE_PUBLIC_ENABLE,
  ]) {
    assert.match(migration.name, /^202610[0-9]{8}_[a-z0-9_]+$/u);
    assert.match(migration.checksum, /^[0-9a-f]{64}$/u);
    assert.equal(seen.has(migration.name), false, `${migration.name} is duplicated`);
    seen.add(migration.name);
    const migrationPath = join(root, "prisma", "migrations", migration.name, "migration.sql");
    const actual = createHash("sha256")
      .update(readFileSync(migrationPath))
      .digest("hex");
    assert.equal(actual, migration.checksum, `${migration.name} source checksum drifted`);
  }
  assert.equal(
    SELLER_PROFILE_PUBLIC_PREPARATIONS.at(-1).name,
    "20261020230000_prepare_seller_profile_staff_orderability_transition",
  );
  return Object.freeze({
    preparations: SELLER_PROFILE_PUBLIC_PREPARATIONS.length,
    first: SELLER_PROFILE_PUBLIC_PREPARATIONS[0].name,
    last: SELLER_PROFILE_PUBLIC_PREPARATIONS.at(-1).name,
    enable: SELLER_PROFILE_PUBLIC_ENABLE.name,
  });
}
