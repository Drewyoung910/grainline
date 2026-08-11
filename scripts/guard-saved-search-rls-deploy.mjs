import { createHash } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  statSync,
} from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import {
  assertDeterministicPostgresEnvironment,
  assertExplicitPostgresConnectionAuthority,
  assertReviewedPostgresConnectionParameters,
  parseCanonicalPostgresDatabaseName,
} from "./postgres-url-safety.mjs";

export const SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV =
  "SAVED_SEARCH_RLS_DEPLOY_PHASE";
export const SAVED_SEARCH_RPC_MIGRATION =
  "20260717024500_add_saved_search_owner_rpcs";
export const SAVED_SEARCH_RPC_HARDENING_MIGRATION =
  "20260717025000_harden_saved_search_owner_rpc_projection";
export const SAVED_SEARCH_RLS_MIGRATION =
  "20260717030000_enable_saved_search_rls";
export const SAVED_SEARCH_FORCE_RLS_MIGRATION =
  "20260720060000_force_saved_search_rls";
export const NOTIFICATION_PREPARATION_MIGRATION =
  "20260722051500_prepare_notification_rls";
export const NOTIFICATION_ACTIVATION_MIGRATION =
  "20260722052000_enable_notification_rls";
export const NOTIFICATION_FORCE_MIGRATION =
  "20260722053000_force_notification_rls";
export const CONVERSATION_MESSAGE_CONTEXT_MIGRATION =
  "20260722184500_add_message_listing_context";
export const CONVERSATION_MESSAGE_SCALE_INDEXES_MIGRATION =
  "20260722190000_prepare_conversation_message_scale_indexes";
export const CONVERSATION_MESSAGE_INVARIANTS_MIGRATION =
  "20260722231500_enforce_conversation_message_invariants";
export const CONVERSATION_MESSAGE_BODY_SEARCH_INDEX_MIGRATION =
  "20260722232000_add_message_body_trgm_index";
export const CONVERSATION_MESSAGE_LEGACY_CLEANUP_MIGRATION =
  "20260726013500_repair_legacy_custom_order_link_context";
export const CONVERSATION_MESSAGE_AUTHORITY_PREPARATION_MIGRATION =
  "20260726022500_prepare_conversation_message_authority";
export const CONVERSATION_MESSAGE_ACTIVATION_MIGRATION =
  "20260726073000_enable_conversation_message_rls";
export const CONVERSATION_MESSAGE_FORCE_MIGRATION =
  "20260726140000_force_conversation_message_rls";
export const CASE_MESSAGE_AUTHOR_KIND_MIGRATION =
  "20260726183000_prepare_case_message_author_kind";
export const CASE_MESSAGE_HISTORY_INDEX_MIGRATION =
  "20260726183500_prepare_case_message_history_index";
export const CASE_MESSAGE_HISTORY_INDEX_CLEANUP_MIGRATION =
  "20260726183600_drop_legacy_case_message_history_indexes";
export const CASE_MESSAGE_PRIVATE_ATTACHMENTS_MIGRATION =
  "20260726184000_prepare_private_case_message_attachments";
export const DIRECT_UPLOAD_REFERENCE_LEDGER_MIGRATION =
  "20260726184500_prepare_direct_upload_reference_ledger";
export const DIRECT_UPLOAD_AUTHORITY_MIGRATION =
  "20260726185000_prepare_direct_upload_authority";
export const DIRECT_UPLOAD_PUBLIC_REFERENCES_MIGRATION =
  "20260726185500_prepare_direct_upload_public_references";
export const DIRECT_UPLOAD_LEGACY_REPAIR_MIGRATION =
  "20260726185700_repair_direct_upload_legacy_references";
export const CASE_RESOLUTION_CLAIM_PREPARATION_MIGRATION =
  "20260729024500_prepare_case_resolution_claim_schema";
export const CASE_STRIPE_DISPUTE_AUTHORITY_MIGRATION =
  "20260729043000_prepare_case_stripe_dispute_authority";
export const CASE_SELLER_REFUND_AUTHORITY_MIGRATION =
  "20260729044000_prepare_case_seller_refund_authority";
export const CASE_STAFF_RESOLUTION_AUTHORITY_MIGRATION =
  "20260729045000_prepare_case_staff_resolution_authority";
export const CASE_PARTICIPANT_RESOLUTION_AUTHORITY_MIGRATION =
  "20260729050000_prepare_case_participant_resolution_authority";
export const CASE_OPEN_AUTHORITY_MIGRATION =
  "20260729051000_prepare_case_open_authority";
export const CASE_REPLY_AUTHORITY_MIGRATION =
  "20260729052000_prepare_case_reply_authority";
export const CASE_MESSAGE_PREFLIGHT_AUTHORITY_MIGRATION =
  "20260729053000_prepare_case_message_preflight_authority";
export const CASE_MESSAGE_PAGE_AUTHORITY_MIGRATION =
  "20260729054000_prepare_case_message_page_authority";
export const CASE_RECIPIENT_READ_AUTHORITY_MIGRATION =
  "20260729055000_prepare_case_recipient_read_authority";
export const CASE_STAFF_QUEUE_AUTHORITY_MIGRATION =
  "20260729056000_prepare_case_staff_queue_authority";
export const CASE_ORDER_ACTIVE_AUTHORITY_MIGRATION =
  "20260729057000_prepare_case_order_active_authority";
export const CASE_SELLER_AGGREGATE_AUTHORITY_MIGRATION =
  "20260729058000_prepare_case_seller_aggregate_authority";
export const CASE_ACCOUNT_EXPORT_AUTHORITY_MIGRATION =
  "20260729059000_prepare_case_account_export_authority";
export const CASE_ESCALATION_CRON_AUTHORITY_MIGRATION =
  "20260729060000_prepare_case_escalation_cron_authority";
export const CASE_ACCOUNT_DELETION_AUTHORITY_MIGRATION =
  "20260729061000_prepare_case_account_deletion_authority";
export const CASE_INVARIANT_MIGRATION =
  "20260730010000_enforce_case_message_invariants";
export const CASE_READ_MODE_MIGRATION =
  "20260730020000_converge_case_read_modes";
export const DIRECT_UPLOAD_RETIREMENT_MIGRATION =
  "20260801175000_retire_direct_upload_compatibility_key";
export const DIRECT_UPLOAD_ACTIVATION_MIGRATION =
  "20260801194000_enable_direct_upload_rls";
export const CASE_ACTIVATION_MIGRATION =
  "20260804160000_enable_case_rls";
export const CASE_FORCE_MIGRATION =
  "20260804191000_force_case_rls";
export const ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION =
  "20260805012000_prepare_order_payment_shipping_compatibility";
export const STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION =
  "20260805040000_prepare_stripe_webhook_maintenance_authority";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION =
  "20260805060000_enable_stripe_webhook_event_rls";
export const STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION =
  "20260810172000_force_stripe_webhook_event_rls";
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION =
  "20260810190000_prepare_checkout_stock_reservation_authority";
export const CASE_RESOLUTION_WINDOW_MIGRATION =
  "20260811170000_align_case_resolution_window";
export const RELEASE_ZERO_MIGRATION_TREE_SHA256 =
  "3e9111525735043266cf6f18b790641ad3103126804836f4a7cccd8e5e29ff29";
export const PHASE_A_MIGRATION_TREE_SHA256 =
  "f6cde6b6a64c3876ae954b5683af0ec47d9358e356657fee34de11ec5f9005c0";
export const PHASE_B_MIGRATION_TREE_SHA256 =
  "c4facdca365cf2217ddfce923edf5c808ad4a81326ed1dad03fd24e588a83510";
export const NOTIFICATION_PREPARATION_MIGRATION_TREE_SHA256 =
  "b3dff1b6eb6052d0574610e5109b8629de36505543453ddc801c7feded205127";
export const NOTIFICATION_ACTIVATION_MIGRATION_TREE_SHA256 =
  "84808c8a6b6471f4b74dbde86f2b009cb0249519313ed6e8a5ef2dba48f61b05";
export const NOTIFICATION_FORCE_MIGRATION_TREE_SHA256 =
  "304a2d227fc747f43453fc8af9437b0115c5b2e03b21510e56d008a836c63532";
export const CONVERSATION_MESSAGE_COMPATIBILITY_MIGRATION_TREE_SHA256 =
  "6cf17cc62d54786c30fe9beb8c7166878c9fbf5c7159c00dd52657c9490fe45e";
export const CONVERSATION_MESSAGE_INVARIANTS_MIGRATION_TREE_SHA256 =
  "f573efa4e2ccdea249dcc04afe32eb5914332f87d94b931a4aa4f22ce12da805";
export const CONVERSATION_MESSAGE_LEGACY_CLEANUP_MIGRATION_TREE_SHA256 =
  "4a0a3b620f7a2c36c7581dd2a1f75203d68232b0c913403b6d870d6140d0b1ff";
export const CONVERSATION_MESSAGE_AUTHORITY_PREPARATION_MIGRATION_TREE_SHA256 =
  "3482d16e93f1d33366ccf44ab39b599585f4b9543963a38efdc1171ce98782e4";
export const CONVERSATION_MESSAGE_ACTIVATION_MIGRATION_TREE_SHA256 =
  "2404192efd95e99c3b14081e945e7dc11e2f0709f35a2431bdfcf2bd3d4dc389";
export const CONVERSATION_MESSAGE_FORCE_MIGRATION_TREE_SHA256 =
  "0bc28692fd3eef7a72cd1a7207ce977a71482b700ab111b6e807028cee6e9672";
export const CASE_MESSAGE_COMPATIBILITY_MIGRATION_TREE_SHA256 =
  "b3e3d18feccddc5375b27765f753d09b4da58bb53f24e84a4b049fa5c27013b0";
export const DIRECT_UPLOAD_PREPARATION_MIGRATION_TREE_SHA256 =
  "0dacf34460ed27a16e332d29240c09eb8e0d183dba3c89778498987d3501759c";
export const DIRECT_UPLOAD_LEGACY_REPAIR_MIGRATION_TREE_SHA256 =
  "1aa9452558c79bbb22c7683e28b20106a62108894bbaaa657367a7b408de4fb6";
export const CASE_RESOLUTION_CLAIM_PREPARATION_MIGRATION_TREE_SHA256 =
  "6396614063d488279417d1d3640304c7a4a1d4e5422cb9e43a0d0f71c34ac58c";
export const CASE_STRIPE_DISPUTE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "bc856d5e59713dd4366ce46c5139aa1d0673efdfbbaeea32a198edddc8c34b77";
export const CASE_SELLER_REFUND_AUTHORITY_MIGRATION_TREE_SHA256 =
  "bc4365fe1dd6868f0f5c29d9963dde2753530152c456bbdc034c2bb855b2740e";
export const CASE_STAFF_RESOLUTION_AUTHORITY_MIGRATION_TREE_SHA256 =
  "930beeab7be44e503c52cc8c7c7f944adbd999aac19db0b760b9426869bc6e51";
export const CASE_PARTICIPANT_RESOLUTION_AUTHORITY_MIGRATION_TREE_SHA256 =
  "bc8e4c966f24564dfabd9203f80ca5450e90eafa33bd972962784cb5a31a4f0b";
export const CASE_OPEN_AUTHORITY_MIGRATION_TREE_SHA256 =
  "32973f5b235843cd98ea03e4df4c6366102e225b7c0bb2237466e0da355ad92d";
export const CASE_REPLY_AUTHORITY_MIGRATION_TREE_SHA256 =
  "487159e563c8cf23746b8cc4c4d0aa9b14ee9402883fb5f0e4af56549e2c0e22";
export const CASE_MESSAGE_PREFLIGHT_AUTHORITY_MIGRATION_TREE_SHA256 =
  "f70ee27e87f3be98ab4381a3bfb837d838a42b93d616b9d0ef215f094785816c";
export const CASE_MESSAGE_PAGE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "8cdb0a582ca011a1a2d91896d2dd97462bdf437e1e7787838e5951e8fce0616c";
export const CASE_RECIPIENT_READ_AUTHORITY_MIGRATION_TREE_SHA256 =
  "b73828752cbee2ed779a9d86cc9087c0e228d12971c8b68f48d9cea9b1f4ab2a";
export const CASE_STAFF_QUEUE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "d572d67815d8b911d524ecb956a35363b7b2379c27556a6cdd06ca8c2dcee886";
export const CASE_ORDER_ACTIVE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "64e1aa69b021777201485ac147974880d0dc610306a0a85e725369a5a253b86a";
export const CASE_SELLER_AGGREGATE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "d2d64abab9afd6b79aeef97d941646da9ab45bda230d009faa130b58eacbcb93";
export const CASE_ACCOUNT_EXPORT_AUTHORITY_MIGRATION_TREE_SHA256 =
  "3315ab9c5400dec1e1c01b9b9c3fe3ab9b80db97207f06c9f887ea1340866ab9";
export const CASE_ESCALATION_CRON_AUTHORITY_MIGRATION_TREE_SHA256 =
  "c07d7412c61ee89092566dd3de6a7ceeb8e58c139861ee07e8fc68becc0aa5e6";
export const CASE_ACCOUNT_DELETION_AUTHORITY_MIGRATION_TREE_SHA256 =
  "6554a1c4ad4d78fae5ff052a2c4c4786d203d2397aacb87084dcf600e1a23826";
export const CASE_INVARIANT_MIGRATION_TREE_SHA256 =
  "91815465852a6ce8aafbd05ac3a6775925da5303284360b71d6f84f3a20f3b64";
export const CASE_READ_MODE_MIGRATION_TREE_SHA256 =
  "e0dfa816c70aa0aee6ccf3e6aa72e6412dc0e9f3d20413152caa236744dd6e4c";
export const DIRECT_UPLOAD_RETIREMENT_MIGRATION_TREE_SHA256 =
  "590d2aa87385991348f93b384507334e7a94fc361059d351d73318b1927f1481";
export const DIRECT_UPLOAD_ACTIVATION_MIGRATION_TREE_SHA256 =
  "31cdb0a5f66ca2ac533a81e8115be564022aaa2aeaf0d759a2819ebbaded821e";
export const CASE_ACTIVATION_MIGRATION_TREE_SHA256 =
  "644201c5cf602eb8be253fa90e62749cb5276a54f691e37bf5b44d3e5ddfed18";
export const CASE_FORCE_MIGRATION_TREE_SHA256 =
  "120721e84b25ca66c25e61bdbaf10451c7dfd363a072fa3a9c11675ee1d9003e";
export const ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION_TREE_SHA256 =
  "e595971f6129304d5f5a20640ad29d2e486648445d5dbb325bfc904d14ca825a";
export const STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_TREE_SHA256 =
  "551be631510a20c58eae7b1e84f84d23890d5c2e82b0d1332c7f9f266744f22d";
export const STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION_TREE_SHA256 =
  "fbbaeaf57b32ebd382138685ea972487ed0c52f92fe01ca88421bf2021b9b2c5";
export const STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION_TREE_SHA256 =
  "45c31a6b00bed329281022490b663088e94403abab95f31cd7e22d3cc4e4a14c";
export const CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION_TREE_SHA256 =
  "71e05c53f9f5d888eeccdcbd6da1b7da9fe657d4404ac63800c5591d13a23897";
export const CASE_RESOLUTION_WINDOW_MIGRATION_TREE_SHA256 =
  "9cf0da5550e865f1ca43e6d9a0aecc89dc0f57eefb8dd77b5b64b6395b41fe78";
export const PRISMA_CONFIG_PATH = "prisma.config.ts";
export const REVIEWED_PRISMA_CONFIG_SHA256 =
  "946211cec942f725ae24ac239cd648b56f4809cf30cb8fda530346d0f593526e";
export const REVIEWED_PRODUCTION_MIDDLEWARE_SHA256 =
  "63e7696cf15dde2f666801bd58a991b47c1c220e5e33b1e9b562ecb58ac38d0b";
export const RLS_CONTEXT_GATE_ROUTE_DIRECTORY =
  "src/app/api/internal/rls-context-gate";
export const RLS_CONTEXT_GATE_ROUTE_PATH =
  `${RLS_CONTEXT_GATE_ROUTE_DIRECTORY}/route.ts`;
export const RLS_CONTEXT_GATE_PUBLIC_PATH =
  "/api/internal/rls-context-gate";
export const RLS_CONTEXT_GATE_RUNNER_TEST_PATH =
  "tests/rls-context-runner-route.test.mjs";
export const RLS_CONTEXT_GATE_RUNNER_TEST_MARKER =
  "RLS_CONTEXT_GATE_RUNNER_ONLY_TEST";
export const REVIEWED_RUNTIME_DB_ROLE = "grainline_app_runtime";
export const REVIEWED_MIGRATION_DB_ROLE = "neondb_owner";

const RELEASE_ZERO_PHASE = "release-0";
const REVIEWED_PHASE_A = "phase-a-reviewed";
const REVIEWED_PHASE_B = "phase-b-reviewed";
const REVIEWED_NOTIFICATION_PREPARATION = "notification-preparation-reviewed";
const REVIEWED_NOTIFICATION_ACTIVATION = "notification-activation-reviewed";
const REVIEWED_NOTIFICATION_FORCE = "notification-force-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_COMPATIBILITY =
  "conversation-message-compatibility-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_INVARIANTS =
  "conversation-message-invariants-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_LEGACY_CLEANUP =
  "conversation-message-legacy-cleanup-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_AUTHORITY_PREPARATION =
  "conversation-message-authority-preparation-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_ACTIVATION =
  "conversation-message-activation-reviewed";
const REVIEWED_CONVERSATION_MESSAGE_FORCE =
  "conversation-message-force-reviewed";
const REVIEWED_CASE_MESSAGE_COMPATIBILITY =
  "case-message-compatibility-reviewed";
const REVIEWED_DIRECT_UPLOAD_PREPARATION =
  "direct-upload-preparation-reviewed";
const REVIEWED_DIRECT_UPLOAD_LEGACY_REPAIR =
  "direct-upload-legacy-repair-reviewed";
const REVIEWED_CASE_RESOLUTION_CLAIM_PREPARATION =
  "case-resolution-claim-preparation-reviewed";
const REVIEWED_CASE_STRIPE_DISPUTE_AUTHORITY =
  "case-stripe-dispute-authority-reviewed";
const REVIEWED_CASE_SELLER_REFUND_AUTHORITY =
  "case-seller-refund-authority-reviewed";
const REVIEWED_CASE_STAFF_RESOLUTION_AUTHORITY =
  "case-staff-resolution-authority-reviewed";
const REVIEWED_CASE_PARTICIPANT_RESOLUTION_AUTHORITY =
  "case-participant-resolution-authority-reviewed";
const REVIEWED_CASE_OPEN_AUTHORITY =
  "case-open-authority-reviewed";
const REVIEWED_CASE_REPLY_AUTHORITY =
  "case-reply-authority-reviewed";
const REVIEWED_CASE_MESSAGE_PREFLIGHT_AUTHORITY =
  "case-message-preflight-authority-reviewed";
const REVIEWED_CASE_MESSAGE_PAGE_AUTHORITY =
  "case-message-page-authority-reviewed";
const REVIEWED_CASE_RECIPIENT_READ_AUTHORITY =
  "case-recipient-read-authority-reviewed";
const REVIEWED_CASE_STAFF_QUEUE_AUTHORITY =
  "case-staff-queue-authority-reviewed";
const REVIEWED_CASE_ORDER_ACTIVE_AUTHORITY =
  "case-order-active-authority-reviewed";
const REVIEWED_CASE_SELLER_AGGREGATE_AUTHORITY =
  "case-seller-aggregate-authority-reviewed";
const REVIEWED_CASE_ACCOUNT_EXPORT_AUTHORITY =
  "case-account-export-authority-reviewed";
const REVIEWED_CASE_ESCALATION_CRON_AUTHORITY =
  "case-escalation-cron-authority-reviewed";
const REVIEWED_CASE_ACCOUNT_DELETION_AUTHORITY =
  "case-account-deletion-authority-reviewed";
const REVIEWED_CASE_INVARIANT = "case-invariant-reviewed";
const REVIEWED_CASE_READ_MODE = "case-read-mode-reviewed";
const REVIEWED_DIRECT_UPLOAD_RETIREMENT =
  "direct-upload-retirement-reviewed";
const REVIEWED_DIRECT_UPLOAD_ACTIVATION =
  "direct-upload-activation-reviewed";
const REVIEWED_CASE_ACTIVATION = "case-activation-reviewed";
const REVIEWED_CASE_FORCE = "case-force-reviewed";
const REVIEWED_ORDER_PAYMENT_SHIPPING_COMPATIBILITY =
  "order-payment-shipping-compatibility-reviewed";
const REVIEWED_STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY =
  "stripe-webhook-maintenance-authority-reviewed";
const REVIEWED_STRIPE_WEBHOOK_EVENT_ACTIVATION =
  "stripe-webhook-event-activation-reviewed";
const REVIEWED_STRIPE_WEBHOOK_EVENT_FORCE =
  "stripe-webhook-event-force-reviewed";
const REVIEWED_CHECKOUT_STOCK_RESERVATION_AUTHORITY =
  "checkout-stock-reservation-authority-reviewed";
const REVIEWED_CASE_RESOLUTION_WINDOW =
  "case-resolution-window-reviewed";
const APP_SOURCE_ROOTS = ["src/app", "app", "src/pages", "pages"];
const TEST_SOURCE_ROOTS = ["tests"];
const TEST_SOURCE_EXTENSIONS = new Set([
  ".cjs",
  ".cts",
  ".js",
  ".jsx",
  ".mjs",
  ".mts",
  ".ts",
  ".tsx",
]);
const CONTEXT_GATE_PATH_MARKER = "rls-context-gate";
const CONTEXT_GATE_SOURCE_MARKERS = [
  RLS_CONTEXT_GATE_PUBLIC_PATH,
  "RLS_CONTEXT_GATE_TRIGGER_SECRET",
  "RLS_CONTEXT_GATE_ALLOWED_COMMIT_SHA",
  "claimProviderRuntimeRunSlot",
  "rls-context-acceptance-gate.mjs",
];

export function computeTextSha256(source) {
  if (typeof source !== "string") {
    throw new TypeError("source must be a string");
  }
  return createHash("sha256").update(source, "utf8").digest("hex");
}

export function computeFileSha256(filePath) {
  return createHash("sha256").update(readFileSync(filePath)).digest("hex");
}

function constantStringValue(node, bindings, seen = new Set()) {
  if (ts.isStringLiteralLike(node)) return node.text;
  if (
    ts.isParenthesizedExpression(node)
    || ts.isAsExpression(node)
    || ts.isNonNullExpression(node)
    || ts.isTypeAssertionExpression(node)
    || ts.isSatisfiesExpression(node)
  ) {
    return constantStringValue(node.expression, bindings, seen);
  }
  if (
    ts.isBinaryExpression(node)
    && node.operatorToken.kind === ts.SyntaxKind.PlusToken
  ) {
    const left = constantStringValue(node.left, bindings, seen);
    const right = constantStringValue(node.right, bindings, seen);
    return left === null || right === null ? null : `${left}${right}`;
  }
  if (ts.isTemplateExpression(node)) {
    let value = node.head.text;
    for (const span of node.templateSpans) {
      const expression = constantStringValue(span.expression, bindings, seen);
      if (expression === null) return null;
      value += `${expression}${span.literal.text}`;
    }
    return value;
  }
  if (ts.isIdentifier(node)) {
    if (seen.has(node.text)) return null;
    const initializer = bindings.get(node.text);
    if (!initializer) return null;
    const nextSeen = new Set(seen);
    nextSeen.add(node.text);
    return constantStringValue(initializer, bindings, nextSeen);
  }
  return null;
}

export function middlewareContainsContextGateExemption(middlewareSource) {
  if (typeof middlewareSource !== "string") {
    throw new TypeError("middlewareSource must be a string");
  }

  const sourceFile = ts.createSourceFile(
    "middleware.ts",
    middlewareSource,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TS,
  );
  if (sourceFile.parseDiagnostics.length > 0) {
    throw new Error("could not parse middleware while checking the temporary RLS context-gate exemption");
  }

  const bindings = new Map();
  const collectBindings = (node) => {
    if (
      ts.isVariableDeclaration(node)
      && ts.isIdentifier(node.name)
      && node.initializer
    ) {
      bindings.set(node.name.text, node.initializer);
    }
    ts.forEachChild(node, collectBindings);
  };
  collectBindings(sourceFile);

  let found = false;
  const inspect = (node) => {
    if (found) return;
    const value = constantStringValue(node, bindings);
    if (
      typeof value === "string"
      && value.includes(RLS_CONTEXT_GATE_PUBLIC_PATH)
    ) {
      found = true;
      return;
    }
    ts.forEachChild(node, inspect);
  };
  inspect(sourceFile);
  return found;
}

export function findContextGateAppArtifacts(rootDirectory = process.cwd()) {
  const artifacts = new Set();
  const visitedDirectories = new Set();

  const inspectFile = (physicalPath, logicalPath) => {
    const source = readFileSync(physicalPath, "utf8");
    if (CONTEXT_GATE_SOURCE_MARKERS.some((marker) => source.includes(marker))) {
      artifacts.add(logicalPath);
    }
  };

  const inspectEntry = (physicalPath, logicalPath) => {
    if (logicalPath.toLowerCase().includes(CONTEXT_GATE_PATH_MARKER)) {
      artifacts.add(logicalPath);
    }

    const linkStat = lstatSync(physicalPath);
    const resolvedPath = linkStat.isSymbolicLink()
      ? realpathSync(physicalPath)
      : physicalPath;
    const resolvedStat = linkStat.isSymbolicLink()
      ? statSync(resolvedPath)
      : linkStat;

    if (resolvedStat.isFile()) {
      inspectFile(resolvedPath, logicalPath);
      return;
    }
    if (!resolvedStat.isDirectory()) return;

    const realDirectory = realpathSync(resolvedPath);
    if (visitedDirectories.has(realDirectory)) return;
    visitedDirectories.add(realDirectory);

    for (const entry of readdirSync(realDirectory, { withFileTypes: true })) {
      inspectEntry(
        path.join(realDirectory, entry.name),
        path.posix.join(logicalPath, entry.name),
      );
    }
  };

  for (const sourceRoot of APP_SOURCE_ROOTS) {
    const absoluteSourceRoot = path.resolve(rootDirectory, sourceRoot);
    if (!existsSync(absoluteSourceRoot)) continue;
    inspectEntry(absoluteSourceRoot, sourceRoot);
  }

  return [...artifacts].sort((a, b) => a.localeCompare(b));
}

export function contextGateRouteArtifactExists(rootDirectory = process.cwd()) {
  return findContextGateAppArtifacts(rootDirectory).length > 0;
}

export function findContextGateRunnerTestArtifacts(rootDirectory = process.cwd()) {
  const artifacts = new Set();

  const inspectEntry = (physicalPath, logicalPath) => {
    const entryStat = lstatSync(physicalPath);
    if (entryStat.isSymbolicLink()) {
      // Production test artifacts do not require symlinks. Treat every link as
      // suspicious instead of following a target that can disappear or escape
      // the reviewed source tree between guard and build.
      artifacts.add(logicalPath);
      return;
    }
    if (entryStat.isDirectory()) {
      for (const entry of readdirSync(physicalPath, { withFileTypes: true })) {
        inspectEntry(
          path.join(physicalPath, entry.name),
          path.posix.join(logicalPath, entry.name),
        );
      }
      return;
    }
    if (!entryStat.isFile()) return;

    if (logicalPath === RLS_CONTEXT_GATE_RUNNER_TEST_PATH) {
      artifacts.add(logicalPath);
      return;
    }
    if (!TEST_SOURCE_EXTENSIONS.has(path.extname(logicalPath).toLowerCase())) {
      return;
    }

    const source = readFileSync(physicalPath, "utf8");
    const containsRunnerRoute =
      source.includes(RLS_CONTEXT_GATE_ROUTE_PATH)
      || source.includes(RLS_CONTEXT_GATE_PUBLIC_PATH);
    if (
      containsRunnerRoute
      && source.includes(RLS_CONTEXT_GATE_RUNNER_TEST_MARKER)
    ) {
      artifacts.add(logicalPath);
    }
  };

  for (const sourceRoot of TEST_SOURCE_ROOTS) {
    const absoluteSourceRoot = path.resolve(rootDirectory, sourceRoot);
    if (!existsSync(absoluteSourceRoot)) continue;
    inspectEntry(absoluteSourceRoot, sourceRoot);
  }

  return [...artifacts].sort((a, b) => a.localeCompare(b));
}

export function contextGateRunnerTestExists(rootDirectory = process.cwd()) {
  return findContextGateRunnerTestArtifacts(rootDirectory).length > 0;
}

export function computeMigrationTreeSha256(migrationDirectory, migrationNames) {
  if (!Array.isArray(migrationNames)) {
    throw new TypeError("migrationNames must be an array");
  }
  const hash = createHash("sha256");
  for (const migrationName of [...migrationNames].sort()) {
    const migrationPath = path.join(migrationDirectory, migrationName, "migration.sql");
    if (!existsSync(migrationPath)) {
      throw new Error(`reviewed migration ${migrationName} is missing migration.sql`);
    }
    hash.update(migrationName, "utf8");
    hash.update("\0", "utf8");
    hash.update(readFileSync(migrationPath));
    hash.update("\0", "utf8");
  }
  return hash.digest("hex");
}

function assertReviewedMigrationTree(phase, migrationTreeSha256) {
  const expected = {
    [RELEASE_ZERO_PHASE]: RELEASE_ZERO_MIGRATION_TREE_SHA256,
    [REVIEWED_PHASE_A]: PHASE_A_MIGRATION_TREE_SHA256,
    [REVIEWED_PHASE_B]: PHASE_B_MIGRATION_TREE_SHA256,
    [REVIEWED_NOTIFICATION_PREPARATION]:
      NOTIFICATION_PREPARATION_MIGRATION_TREE_SHA256,
    [REVIEWED_NOTIFICATION_ACTIVATION]:
      NOTIFICATION_ACTIVATION_MIGRATION_TREE_SHA256,
    [REVIEWED_NOTIFICATION_FORCE]:
      NOTIFICATION_FORCE_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_COMPATIBILITY]:
      CONVERSATION_MESSAGE_COMPATIBILITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_INVARIANTS]:
      CONVERSATION_MESSAGE_INVARIANTS_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_LEGACY_CLEANUP]:
      CONVERSATION_MESSAGE_LEGACY_CLEANUP_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_AUTHORITY_PREPARATION]:
      CONVERSATION_MESSAGE_AUTHORITY_PREPARATION_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_ACTIVATION]:
      CONVERSATION_MESSAGE_ACTIVATION_MIGRATION_TREE_SHA256,
    [REVIEWED_CONVERSATION_MESSAGE_FORCE]:
      CONVERSATION_MESSAGE_FORCE_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_MESSAGE_COMPATIBILITY]:
      CASE_MESSAGE_COMPATIBILITY_MIGRATION_TREE_SHA256,
    [REVIEWED_DIRECT_UPLOAD_PREPARATION]:
      DIRECT_UPLOAD_PREPARATION_MIGRATION_TREE_SHA256,
    [REVIEWED_DIRECT_UPLOAD_LEGACY_REPAIR]:
      DIRECT_UPLOAD_LEGACY_REPAIR_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_RESOLUTION_CLAIM_PREPARATION]:
      CASE_RESOLUTION_CLAIM_PREPARATION_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_STRIPE_DISPUTE_AUTHORITY]:
      CASE_STRIPE_DISPUTE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_SELLER_REFUND_AUTHORITY]:
      CASE_SELLER_REFUND_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_STAFF_RESOLUTION_AUTHORITY]:
      CASE_STAFF_RESOLUTION_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_PARTICIPANT_RESOLUTION_AUTHORITY]:
      CASE_PARTICIPANT_RESOLUTION_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_OPEN_AUTHORITY]:
      CASE_OPEN_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_REPLY_AUTHORITY]:
      CASE_REPLY_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_MESSAGE_PREFLIGHT_AUTHORITY]:
      CASE_MESSAGE_PREFLIGHT_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_MESSAGE_PAGE_AUTHORITY]:
      CASE_MESSAGE_PAGE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_RECIPIENT_READ_AUTHORITY]:
      CASE_RECIPIENT_READ_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_STAFF_QUEUE_AUTHORITY]:
      CASE_STAFF_QUEUE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_ORDER_ACTIVE_AUTHORITY]:
      CASE_ORDER_ACTIVE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_SELLER_AGGREGATE_AUTHORITY]:
      CASE_SELLER_AGGREGATE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_ACCOUNT_EXPORT_AUTHORITY]:
      CASE_ACCOUNT_EXPORT_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_ESCALATION_CRON_AUTHORITY]:
      CASE_ESCALATION_CRON_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_ACCOUNT_DELETION_AUTHORITY]:
      CASE_ACCOUNT_DELETION_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_INVARIANT]:
      CASE_INVARIANT_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_READ_MODE]:
      CASE_READ_MODE_MIGRATION_TREE_SHA256,
    [REVIEWED_DIRECT_UPLOAD_RETIREMENT]:
      DIRECT_UPLOAD_RETIREMENT_MIGRATION_TREE_SHA256,
    [REVIEWED_DIRECT_UPLOAD_ACTIVATION]:
      DIRECT_UPLOAD_ACTIVATION_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_ACTIVATION]:
      CASE_ACTIVATION_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_FORCE]:
      CASE_FORCE_MIGRATION_TREE_SHA256,
    [REVIEWED_ORDER_PAYMENT_SHIPPING_COMPATIBILITY]:
      ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION_TREE_SHA256,
    [REVIEWED_STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY]:
      STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_STRIPE_WEBHOOK_EVENT_ACTIVATION]:
      STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION_TREE_SHA256,
    [REVIEWED_STRIPE_WEBHOOK_EVENT_FORCE]:
      STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION_TREE_SHA256,
    [REVIEWED_CHECKOUT_STOCK_RESERVATION_AUTHORITY]:
      CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION_TREE_SHA256,
    [REVIEWED_CASE_RESOLUTION_WINDOW]:
      CASE_RESOLUTION_WINDOW_MIGRATION_TREE_SHA256,
  }[phase];
  if (migrationTreeSha256 !== expected) {
    throw new Error(
      `${phase} migration tree fingerprint changed; review every added, removed, renamed, or modified migration before updating the temporary SavedSearch deploy guard`,
    );
  }
}

function assertReviewedPrismaMigrationConfig(prismaConfigSha256) {
  if (prismaConfigSha256 !== REVIEWED_PRISMA_CONFIG_SHA256) {
    throw new Error(
      `${PRISMA_CONFIG_PATH} fingerprint changed; the effective Prisma migration directory could have been redirected, so review the config before updating the temporary SavedSearch deploy guard`,
    );
  }
}

export function parseGuardedNeonDatabaseIdentity(value, label) {
  if (typeof value !== "string" || value.length === 0 || value !== value.trim()) {
    throw new Error(`${label} must be a non-empty PostgreSQL URL without surrounding whitespace`);
  }

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid PostgreSQL URL`);
  }
  if (!/^postgres(?:ql)?:$/.test(parsed.protocol)) {
    throw new Error(`${label} must use the postgres/postgresql protocol`);
  }
  const { username } = assertExplicitPostgresConnectionAuthority(parsed, label);
  assertReviewedPostgresConnectionParameters(parsed, label);
  const databaseName = parseCanonicalPostgresDatabaseName(parsed, label);

  const match = parsed.hostname.toLowerCase().match(
    /^(ep-[a-z0-9-]+?)(-pooler)?\.([a-z0-9-]+)\.([a-z0-9-]+)\.neon\.tech$/,
  );
  if (!match) {
    throw new Error(`${label} must identify one reviewed Neon endpoint`);
  }

  return Object.freeze({
    databaseName,
    endpointId: match[1],
    isPooler: Boolean(match[2]),
    port: parsed.port || "5432",
    region: `${match[3]}.${match[4]}`,
    username,
  });
}

export function assertGuardedDeployEnvironment(env) {
  assertDeterministicPostgresEnvironment(env, "guarded production migration");
  const runtimeUrl = env?.DATABASE_URL;
  const directUrl = env?.DIRECT_URL;
  const runtimeRole = env?.RUNTIME_DB_ROLE;
  const migrationRole = env?.MIGRATION_DB_ROLE;
  const auditUrl = env?.GRANT_AUDIT_DATABASE_URL;
  const missing = [];

  if (!runtimeUrl?.trim()) missing.push("DATABASE_URL");
  if (!directUrl) missing.push("DIRECT_URL");
  if (!runtimeRole) missing.push("RUNTIME_DB_ROLE");
  if (!migrationRole) missing.push("MIGRATION_DB_ROLE");
  if (missing.length > 0) {
    throw new Error(
      `guarded production migration requires ${missing.join(", ")} before any migration runs`,
    );
  }
  if (runtimeRole !== runtimeRole.trim() || migrationRole !== migrationRole.trim()) {
    throw new Error(
      "RUNTIME_DB_ROLE and MIGRATION_DB_ROLE must not contain surrounding whitespace before any migration runs",
    );
  }
  if (
    runtimeRole !== REVIEWED_RUNTIME_DB_ROLE
    || migrationRole !== REVIEWED_MIGRATION_DB_ROLE
  ) {
    throw new Error(
      `guarded rollout requires the reviewed roles ${REVIEWED_RUNTIME_DB_ROLE} and ${REVIEWED_MIGRATION_DB_ROLE} before any migration runs`,
    );
  }
  if (runtimeRole === migrationRole) {
    throw new Error(
      "RUNTIME_DB_ROLE and MIGRATION_DB_ROLE must be distinct before any migration runs",
    );
  }
  if (auditUrl && (auditUrl !== auditUrl.trim() || auditUrl !== directUrl)) {
    throw new Error(
      "GRANT_AUDIT_DATABASE_URL must be absent or exactly match DIRECT_URL before any migration runs",
    );
  }

  const runtimeIdentity = parseGuardedNeonDatabaseIdentity(
    runtimeUrl,
    "DATABASE_URL",
  );
  const migrationIdentity = parseGuardedNeonDatabaseIdentity(
    directUrl,
    "DIRECT_URL",
  );
  if (!runtimeIdentity.isPooler) {
    throw new Error("DATABASE_URL must use the pooled Neon endpoint before any migration runs");
  }
  if (migrationIdentity.isPooler) {
    throw new Error("DIRECT_URL must use the direct Neon endpoint before any migration runs");
  }
  if (runtimeIdentity.username !== runtimeRole) {
    throw new Error("DATABASE_URL username must match RUNTIME_DB_ROLE before any migration runs");
  }
  if (migrationIdentity.username !== migrationRole) {
    throw new Error("DIRECT_URL username must match MIGRATION_DB_ROLE before any migration runs");
  }
  if (
    runtimeIdentity.endpointId !== migrationIdentity.endpointId
    || runtimeIdentity.region !== migrationIdentity.region
    || runtimeIdentity.port !== migrationIdentity.port
    || runtimeIdentity.databaseName !== migrationIdentity.databaseName
  ) {
    throw new Error(
      "DATABASE_URL and DIRECT_URL must target the same Neon endpoint, region, port, and database before any migration runs",
    );
  }
}

function assertProductionArtifactExcludesContextGate({
  phase,
  contextGateRouteExists,
  contextGateRunnerTestExists: runnerTestExists,
  middlewareSource,
}) {
  if (typeof contextGateRouteExists !== "boolean") {
    throw new TypeError("contextGateRouteExists must be a boolean");
  }
  if (typeof middlewareSource !== "string") {
    throw new TypeError("middlewareSource must be a string");
  }
  if (typeof runnerTestExists !== "boolean") {
    throw new TypeError("contextGateRunnerTestExists must be a boolean");
  }

  const hasMiddlewareExemption =
    middlewareContainsContextGateExemption(middlewareSource);
  const middlewareFingerprintChanged =
    computeTextSha256(middlewareSource)
      !== REVIEWED_PRODUCTION_MIDDLEWARE_SHA256;
  const violations = [];

  if (contextGateRouteExists) {
    violations.push(
      `temporary context-gate app artifact (including ${RLS_CONTEXT_GATE_ROUTE_PATH})`,
    );
  }
  if (runnerTestExists) {
    violations.push(
      `runner-only test ${RLS_CONTEXT_GATE_RUNNER_TEST_PATH}`,
    );
  }
  if (hasMiddlewareExemption) {
    violations.push(
      `middleware exemption for ${RLS_CONTEXT_GATE_PUBLIC_PATH}`,
    );
  }
  if (middlewareFingerprintChanged) {
    violations.push("reviewed production middleware fingerprint changed");
  }

  if (violations.length > 0) {
    throw new Error(
      `${phase} production artifact must exclude the temporary RLS context gate; found ${violations.join(" and ")}`,
    );
  }
}

function assertNoLaterMigration(migrationNames, reviewedLatestMigration, phase) {
  const laterMigrations = migrationNames
    .filter((name) => name.localeCompare(reviewedLatestMigration) > 0)
    .sort((a, b) => a.localeCompare(b));
  if (laterMigrations.length > 0) {
    throw new Error(
      `${phase} requires ${reviewedLatestMigration} to remain the latest migration; review or retire the temporary SavedSearch deploy guard before deploying ${laterMigrations.join(", ")}`,
    );
  }
}

export function validateSavedSearchRlsDeployShape({
  phase,
  migrationNames,
  migrationTreeSha256,
  prismaConfigSha256,
  contextGateRouteExists,
  contextGateRunnerTestExists: runnerTestExists,
  middlewareSource,
}) {
  if (!Array.isArray(migrationNames)) {
    throw new TypeError("migrationNames must be an array");
  }

  const migrations = new Set(migrationNames);
  const hasRpcMigration = migrations.has(SAVED_SEARCH_RPC_MIGRATION);
  const hasRpcHardeningMigration = migrations.has(
    SAVED_SEARCH_RPC_HARDENING_MIGRATION,
  );
  const hasRlsMigration = migrations.has(SAVED_SEARCH_RLS_MIGRATION);
  const hasForceRlsMigration = migrations.has(SAVED_SEARCH_FORCE_RLS_MIGRATION);
  const hasNotificationPreparationMigration = migrations.has(
    NOTIFICATION_PREPARATION_MIGRATION,
  );
  const hasNotificationActivationMigration = migrations.has(
    NOTIFICATION_ACTIVATION_MIGRATION,
  );
  const hasNotificationForceMigration = migrations.has(
    NOTIFICATION_FORCE_MIGRATION,
  );
  const hasConversationMessageContextMigration = migrations.has(
    CONVERSATION_MESSAGE_CONTEXT_MIGRATION,
  );
  const hasConversationMessageScaleIndexesMigration = migrations.has(
    CONVERSATION_MESSAGE_SCALE_INDEXES_MIGRATION,
  );
  const hasConversationMessageInvariantsMigration = migrations.has(
    CONVERSATION_MESSAGE_INVARIANTS_MIGRATION,
  );
  const hasConversationMessageBodySearchIndexMigration = migrations.has(
    CONVERSATION_MESSAGE_BODY_SEARCH_INDEX_MIGRATION,
  );
  const hasConversationMessageLegacyCleanupMigration = migrations.has(
    CONVERSATION_MESSAGE_LEGACY_CLEANUP_MIGRATION,
  );
  const hasConversationMessageAuthorityPreparationMigration = migrations.has(
    CONVERSATION_MESSAGE_AUTHORITY_PREPARATION_MIGRATION,
  );
  const hasConversationMessageActivationMigration = migrations.has(
    CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
  );
  const hasConversationMessageForceMigration = migrations.has(
    CONVERSATION_MESSAGE_FORCE_MIGRATION,
  );
  const hasCaseMessageAuthorKindMigration = migrations.has(
    CASE_MESSAGE_AUTHOR_KIND_MIGRATION,
  );
  const hasCaseMessageHistoryIndexMigration = migrations.has(
    CASE_MESSAGE_HISTORY_INDEX_MIGRATION,
  );
  const hasCaseMessageHistoryIndexCleanupMigration = migrations.has(
    CASE_MESSAGE_HISTORY_INDEX_CLEANUP_MIGRATION,
  );
  const hasCaseMessagePrivateAttachmentsMigration = migrations.has(
    CASE_MESSAGE_PRIVATE_ATTACHMENTS_MIGRATION,
  );
  const hasDirectUploadReferenceLedgerMigration = migrations.has(
    DIRECT_UPLOAD_REFERENCE_LEDGER_MIGRATION,
  );
  const hasDirectUploadAuthorityMigration = migrations.has(
    DIRECT_UPLOAD_AUTHORITY_MIGRATION,
  );
  const hasDirectUploadPublicReferencesMigration = migrations.has(
    DIRECT_UPLOAD_PUBLIC_REFERENCES_MIGRATION,
  );
  const hasDirectUploadLegacyRepairMigration = migrations.has(
    DIRECT_UPLOAD_LEGACY_REPAIR_MIGRATION,
  );
  const hasCaseResolutionClaimPreparationMigration = migrations.has(
    CASE_RESOLUTION_CLAIM_PREPARATION_MIGRATION,
  );
  const hasCaseStripeDisputeAuthorityMigration = migrations.has(
    CASE_STRIPE_DISPUTE_AUTHORITY_MIGRATION,
  );
  const hasCaseSellerRefundAuthorityMigration = migrations.has(
    CASE_SELLER_REFUND_AUTHORITY_MIGRATION,
  );
  const hasCaseStaffResolutionAuthorityMigration = migrations.has(
    CASE_STAFF_RESOLUTION_AUTHORITY_MIGRATION,
  );
  const hasCaseParticipantResolutionAuthorityMigration = migrations.has(
    CASE_PARTICIPANT_RESOLUTION_AUTHORITY_MIGRATION,
  );
  const hasCaseOpenAuthorityMigration = migrations.has(
    CASE_OPEN_AUTHORITY_MIGRATION,
  );
  const hasCaseReplyAuthorityMigration = migrations.has(
    CASE_REPLY_AUTHORITY_MIGRATION,
  );
  const hasCaseMessagePreflightAuthorityMigration = migrations.has(
    CASE_MESSAGE_PREFLIGHT_AUTHORITY_MIGRATION,
  );
  const hasCaseMessagePageAuthorityMigration = migrations.has(
    CASE_MESSAGE_PAGE_AUTHORITY_MIGRATION,
  );
  const hasCaseRecipientReadAuthorityMigration = migrations.has(
    CASE_RECIPIENT_READ_AUTHORITY_MIGRATION,
  );
  const hasCaseStaffQueueAuthorityMigration = migrations.has(
    CASE_STAFF_QUEUE_AUTHORITY_MIGRATION,
  );
  const hasCaseOrderActiveAuthorityMigration = migrations.has(
    CASE_ORDER_ACTIVE_AUTHORITY_MIGRATION,
  );
  const hasCaseSellerAggregateAuthorityMigration = migrations.has(
    CASE_SELLER_AGGREGATE_AUTHORITY_MIGRATION,
  );
  const hasCaseAccountExportAuthorityMigration = migrations.has(
    CASE_ACCOUNT_EXPORT_AUTHORITY_MIGRATION,
  );
  const hasCaseEscalationCronAuthorityMigration = migrations.has(
    CASE_ESCALATION_CRON_AUTHORITY_MIGRATION,
  );
  const hasCaseAccountDeletionAuthorityMigration = migrations.has(
    CASE_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
  );
  const hasCaseInvariantMigration = migrations.has(
    CASE_INVARIANT_MIGRATION,
  );
  const hasCaseReadModeMigration = migrations.has(
    CASE_READ_MODE_MIGRATION,
  );
  const hasDirectUploadRetirementMigration = migrations.has(
    DIRECT_UPLOAD_RETIREMENT_MIGRATION,
  );
  const hasDirectUploadActivationMigration = migrations.has(
    DIRECT_UPLOAD_ACTIVATION_MIGRATION,
  );
  const hasCaseActivationMigration = migrations.has(
    CASE_ACTIVATION_MIGRATION,
  );
  const hasCaseForceMigration = migrations.has(
    CASE_FORCE_MIGRATION,
  );
  const hasOrderPaymentShippingCompatibilityMigration = migrations.has(
    ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION,
  );
  const hasStripeWebhookMaintenanceAuthorityMigration = migrations.has(
    STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION,
  );
  const hasStripeWebhookEventActivationMigration = migrations.has(
    STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
  );
  const hasStripeWebhookEventForceMigration = migrations.has(
    STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
  );
  const hasCheckoutStockReservationAuthorityMigration = migrations.has(
    CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
  );
  const hasCaseResolutionWindowMigration = migrations.has(
    CASE_RESOLUTION_WINDOW_MIGRATION,
  );

  if (phase === RELEASE_ZERO_PHASE) {
    if (!hasRpcMigration || !hasRpcHardeningMigration || hasRlsMigration) {
      throw new Error(
        `${RELEASE_ZERO_PHASE} requires ${SAVED_SEARCH_RPC_MIGRATION} and ${SAVED_SEARCH_RPC_HARDENING_MIGRATION} to exist and ${SAVED_SEARCH_RLS_MIGRATION} to be absent`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      SAVED_SEARCH_RPC_HARDENING_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
    };
  }

  if (phase === REVIEWED_PHASE_A) {
    if (!hasRpcMigration || !hasRpcHardeningMigration || !hasRlsMigration
        || hasForceRlsMigration) {
      throw new Error(
        `${REVIEWED_PHASE_A} requires exactly the first three SavedSearch rollout migrations`,
      );
    }

    assertNoLaterMigration(migrationNames, SAVED_SEARCH_RLS_MIGRATION, phase);
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
    };
  }

  if (phase === REVIEWED_PHASE_B) {
    if (!hasRpcMigration || !hasRpcHardeningMigration || !hasRlsMigration
        || !hasForceRlsMigration) {
      throw new Error(
        `${REVIEWED_PHASE_B} requires all four SavedSearch rollout migrations to exist`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      SAVED_SEARCH_FORCE_RLS_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
    };
  }

  if (phase === REVIEWED_NOTIFICATION_PREPARATION) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
    ) {
      throw new Error(
        `${REVIEWED_NOTIFICATION_PREPARATION} requires SavedSearch Phase B plus the exact Notification preparation migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      NOTIFICATION_PREPARATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
    };
  }

  if (phase === REVIEWED_NOTIFICATION_ACTIVATION) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
    ) {
      throw new Error(
        `${REVIEWED_NOTIFICATION_ACTIVATION} requires SavedSearch Phase B plus the exact Notification preparation and activation migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      NOTIFICATION_ACTIVATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
    };
  }

  if (phase === REVIEWED_NOTIFICATION_FORCE) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
    ) {
      throw new Error(
        `${REVIEWED_NOTIFICATION_FORCE} requires SavedSearch Phase B plus the exact Notification preparation, activation, and FORCE migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      NOTIFICATION_FORCE_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_COMPATIBILITY) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_COMPATIBILITY} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message context and scale-index migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_SCALE_INDEXES_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_INVARIANTS) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_INVARIANTS} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message compatibility, invariant, and body-search-index migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_BODY_SEARCH_INDEX_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
      hasConversationMessageInvariantsMigration,
      hasConversationMessageBodySearchIndexMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_LEGACY_CLEANUP) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
      || !hasConversationMessageLegacyCleanupMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_LEGACY_CLEANUP} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message compatibility, invariant, body-search-index, and legacy-cleanup migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_LEGACY_CLEANUP_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
      hasConversationMessageInvariantsMigration,
      hasConversationMessageBodySearchIndexMigration,
      hasConversationMessageLegacyCleanupMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_AUTHORITY_PREPARATION) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
      || !hasConversationMessageLegacyCleanupMigration
      || !hasConversationMessageAuthorityPreparationMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_AUTHORITY_PREPARATION} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message compatibility, invariant, body-search-index, legacy-cleanup, and functions-only authority-preparation migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_AUTHORITY_PREPARATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
      hasConversationMessageInvariantsMigration,
      hasConversationMessageBodySearchIndexMigration,
      hasConversationMessageLegacyCleanupMigration,
      hasConversationMessageAuthorityPreparationMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_ACTIVATION) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
      || !hasConversationMessageLegacyCleanupMigration
      || !hasConversationMessageAuthorityPreparationMigration
      || !hasConversationMessageActivationMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_ACTIVATION} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message compatibility, invariants, body-search-index, legacy-cleanup, authority-preparation, and initial activation migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_ACTIVATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
      hasConversationMessageInvariantsMigration,
      hasConversationMessageBodySearchIndexMigration,
      hasConversationMessageLegacyCleanupMigration,
      hasConversationMessageAuthorityPreparationMigration,
      hasConversationMessageActivationMigration,
    };
  }

  if (phase === REVIEWED_CONVERSATION_MESSAGE_FORCE) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
      || !hasConversationMessageLegacyCleanupMigration
      || !hasConversationMessageAuthorityPreparationMigration
      || !hasConversationMessageActivationMigration
      || !hasConversationMessageForceMigration
    ) {
      throw new Error(
        `${REVIEWED_CONVERSATION_MESSAGE_FORCE} requires completed SavedSearch and Notification RLS plus the exact Conversation/Message compatibility, invariants, body-search-index, legacy-cleanup, authority-preparation, initial activation, and FORCE migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CONVERSATION_MESSAGE_FORCE_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasRpcMigration,
      hasRpcHardeningMigration,
      hasRlsMigration,
      hasForceRlsMigration,
      hasNotificationPreparationMigration,
      hasNotificationActivationMigration,
      hasNotificationForceMigration,
      hasConversationMessageContextMigration,
      hasConversationMessageScaleIndexesMigration,
      hasConversationMessageInvariantsMigration,
      hasConversationMessageBodySearchIndexMigration,
      hasConversationMessageLegacyCleanupMigration,
      hasConversationMessageAuthorityPreparationMigration,
      hasConversationMessageActivationMigration,
      hasConversationMessageForceMigration,
    };
  }

  if (phase === REVIEWED_CASE_MESSAGE_COMPATIBILITY) {
    if (
      !hasRpcMigration
      || !hasRpcHardeningMigration
      || !hasRlsMigration
      || !hasForceRlsMigration
      || !hasNotificationPreparationMigration
      || !hasNotificationActivationMigration
      || !hasNotificationForceMigration
      || !hasConversationMessageContextMigration
      || !hasConversationMessageScaleIndexesMigration
      || !hasConversationMessageInvariantsMigration
      || !hasConversationMessageBodySearchIndexMigration
      || !hasConversationMessageLegacyCleanupMigration
      || !hasConversationMessageAuthorityPreparationMigration
      || !hasConversationMessageActivationMigration
      || !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_MESSAGE_COMPATIBILITY} requires completed Conversation/Message FORCE plus the exact CaseMessage author-kind, history-index, legacy-index-cleanup and private-attachment migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_MESSAGE_PRIVATE_ATTACHMENTS_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasConversationMessageForceMigration,
      hasCaseMessageAuthorKindMigration,
      hasCaseMessageHistoryIndexMigration,
      hasCaseMessageHistoryIndexCleanupMigration,
      hasCaseMessagePrivateAttachmentsMigration,
    };
  }

  if (phase === REVIEWED_DIRECT_UPLOAD_PREPARATION) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
    ) {
      throw new Error(
        `${REVIEWED_DIRECT_UPLOAD_PREPARATION} requires the exact CaseMessage compatibility boundary plus the DirectUpload reference-ledger, fixed-authority and public-reference migrations`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      DIRECT_UPLOAD_PUBLIC_REFERENCES_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseMessagePrivateAttachmentsMigration,
      hasDirectUploadReferenceLedgerMigration,
      hasDirectUploadAuthorityMigration,
      hasDirectUploadPublicReferencesMigration,
    };
  }

  if (phase === REVIEWED_DIRECT_UPLOAD_LEGACY_REPAIR) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
    ) {
      throw new Error(
        `${REVIEWED_DIRECT_UPLOAD_LEGACY_REPAIR} requires the exact DirectUpload compatible-preparation boundary plus the narrowly reviewed legacy-reference repair migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      DIRECT_UPLOAD_LEGACY_REPAIR_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseMessagePrivateAttachmentsMigration,
      hasDirectUploadReferenceLedgerMigration,
      hasDirectUploadAuthorityMigration,
      hasDirectUploadPublicReferencesMigration,
      hasDirectUploadLegacyRepairMigration,
    };
  }

  if (phase === REVIEWED_CASE_RESOLUTION_CLAIM_PREPARATION) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_RESOLUTION_CLAIM_PREPARATION} requires the exact DirectUpload legacy-repair boundary plus the coexistence-safe Case resolution-claim preparation migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_RESOLUTION_CLAIM_PREPARATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasDirectUploadLegacyRepairMigration,
      hasCaseResolutionClaimPreparationMigration,
    };
  }

  if (phase === REVIEWED_CASE_STRIPE_DISPUTE_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_STRIPE_DISPUTE_AUTHORITY} requires the exact Case resolution-claim preparation plus the compatible fixed Stripe-dispute authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_STRIPE_DISPUTE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_SELLER_REFUND_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_SELLER_REFUND_AUTHORITY} requires the exact fixed Stripe-dispute authority boundary plus the compatible fixed seller-refund authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_SELLER_REFUND_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_STAFF_RESOLUTION_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_STAFF_RESOLUTION_AUTHORITY} requires the exact seller-refund boundary plus the compatible four-operation staff-resolution authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_STAFF_RESOLUTION_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_PARTICIPANT_RESOLUTION_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_PARTICIPANT_RESOLUTION_AUTHORITY} requires the exact staff-resolution boundary plus the compatible participant mark-resolved authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_PARTICIPANT_RESOLUTION_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_OPEN_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_OPEN_AUTHORITY} requires the exact participant-resolution boundary plus the compatible buyer Case-open authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_OPEN_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_REPLY_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_REPLY_AUTHORITY} requires the exact buyer Case-open boundary plus the compatible Case-reply authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_REPLY_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_MESSAGE_PREFLIGHT_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_MESSAGE_PREFLIGHT_AUTHORITY} requires the exact Case-reply boundary plus the compatible Case-message preflight authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_MESSAGE_PREFLIGHT_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_MESSAGE_PAGE_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_MESSAGE_PAGE_AUTHORITY} requires the exact Case-message preflight boundary plus the compatible bounded Case-message page authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_MESSAGE_PAGE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_RECIPIENT_READ_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_RECIPIENT_READ_AUTHORITY} requires the exact Case-message page boundary plus the compatible Case recipient-read authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_RECIPIENT_READ_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_STAFF_QUEUE_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_STAFF_QUEUE_AUTHORITY} requires the exact Case recipient-read boundary plus the compatible Case staff-queue authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_STAFF_QUEUE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_ORDER_ACTIVE_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_ORDER_ACTIVE_AUTHORITY} requires the exact Case staff-queue boundary plus the compatible Case-aware Order authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_ORDER_ACTIVE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
      hasCaseOrderActiveAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_SELLER_AGGREGATE_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_SELLER_AGGREGATE_AUTHORITY} requires the exact Case-aware Order boundary plus the compatible seller aggregate authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_SELLER_AGGREGATE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
      hasCaseOrderActiveAuthorityMigration,
      hasCaseSellerAggregateAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_ACCOUNT_EXPORT_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_ACCOUNT_EXPORT_AUTHORITY} requires the exact seller aggregate boundary plus the compatible participant account-export authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_ACCOUNT_EXPORT_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
      hasCaseOrderActiveAuthorityMigration,
      hasCaseSellerAggregateAuthorityMigration,
      hasCaseAccountExportAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_ESCALATION_CRON_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
      || !hasCaseEscalationCronAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_ESCALATION_CRON_AUTHORITY} requires the exact account-export boundary plus the compatible escalation and cron-transition authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_ESCALATION_CRON_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
      hasCaseOrderActiveAuthorityMigration,
      hasCaseSellerAggregateAuthorityMigration,
      hasCaseAccountExportAuthorityMigration,
      hasCaseEscalationCronAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_ACCOUNT_DELETION_AUTHORITY) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
      || !hasCaseEscalationCronAuthorityMigration
      || !hasCaseAccountDeletionAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_ACCOUNT_DELETION_AUTHORITY} requires the exact escalation/cron boundary plus the compatible account-deletion authority migration`,
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_ACCOUNT_DELETION_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseResolutionClaimPreparationMigration,
      hasCaseStripeDisputeAuthorityMigration,
      hasCaseSellerRefundAuthorityMigration,
      hasCaseStaffResolutionAuthorityMigration,
      hasCaseParticipantResolutionAuthorityMigration,
      hasCaseOpenAuthorityMigration,
      hasCaseReplyAuthorityMigration,
      hasCaseMessagePreflightAuthorityMigration,
      hasCaseMessagePageAuthorityMigration,
      hasCaseRecipientReadAuthorityMigration,
      hasCaseStaffQueueAuthorityMigration,
      hasCaseOrderActiveAuthorityMigration,
      hasCaseSellerAggregateAuthorityMigration,
      hasCaseAccountExportAuthorityMigration,
      hasCaseEscalationCronAuthorityMigration,
      hasCaseAccountDeletionAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_INVARIANT) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
      || !hasCaseEscalationCronAuthorityMigration
      || !hasCaseAccountDeletionAuthorityMigration
      || !hasCaseInvariantMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_INVARIANT} requires the exact compatible Case `
        + "authority boundary plus the reviewed invariant migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_INVARIANT_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseAccountDeletionAuthorityMigration,
      hasCaseInvariantMigration,
    };
  }

  if (phase === REVIEWED_CASE_READ_MODE) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
      || !hasCaseEscalationCronAuthorityMigration
      || !hasCaseAccountDeletionAuthorityMigration
      || !hasCaseInvariantMigration
      || !hasCaseReadModeMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_READ_MODE} requires the accepted Case invariant `
        + "boundary plus the compatible four-function read-mode migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_READ_MODE_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseInvariantMigration,
      hasCaseReadModeMigration,
    };
  }

  if (phase === REVIEWED_DIRECT_UPLOAD_RETIREMENT) {
    if (
      !hasConversationMessageForceMigration
      || !hasCaseMessageAuthorKindMigration
      || !hasCaseMessageHistoryIndexMigration
      || !hasCaseMessageHistoryIndexCleanupMigration
      || !hasCaseMessagePrivateAttachmentsMigration
      || !hasDirectUploadReferenceLedgerMigration
      || !hasDirectUploadAuthorityMigration
      || !hasDirectUploadPublicReferencesMigration
      || !hasDirectUploadLegacyRepairMigration
      || !hasCaseResolutionClaimPreparationMigration
      || !hasCaseStripeDisputeAuthorityMigration
      || !hasCaseSellerRefundAuthorityMigration
      || !hasCaseStaffResolutionAuthorityMigration
      || !hasCaseParticipantResolutionAuthorityMigration
      || !hasCaseOpenAuthorityMigration
      || !hasCaseReplyAuthorityMigration
      || !hasCaseMessagePreflightAuthorityMigration
      || !hasCaseMessagePageAuthorityMigration
      || !hasCaseRecipientReadAuthorityMigration
      || !hasCaseStaffQueueAuthorityMigration
      || !hasCaseOrderActiveAuthorityMigration
      || !hasCaseSellerAggregateAuthorityMigration
      || !hasCaseAccountExportAuthorityMigration
      || !hasCaseEscalationCronAuthorityMigration
      || !hasCaseAccountDeletionAuthorityMigration
      || !hasCaseInvariantMigration
      || !hasCaseReadModeMigration
      || !hasDirectUploadRetirementMigration
    ) {
      throw new Error(
        `${REVIEWED_DIRECT_UPLOAD_RETIREMENT} requires the accepted Case `
        + "read-mode boundary plus the reviewed DirectUpload compatibility-key retirement migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      DIRECT_UPLOAD_RETIREMENT_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseReadModeMigration,
      hasDirectUploadRetirementMigration,
    };
  }

  if (phase === REVIEWED_DIRECT_UPLOAD_ACTIVATION) {
    if (
      !hasCaseReadModeMigration
      || !hasDirectUploadRetirementMigration
      || !hasDirectUploadActivationMigration
    ) {
      throw new Error(
        `${REVIEWED_DIRECT_UPLOAD_ACTIVATION} requires the reviewed `
        + "DirectUpload retirement and service-only activation migrations",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      DIRECT_UPLOAD_ACTIVATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasDirectUploadRetirementMigration,
      hasDirectUploadActivationMigration,
    };
  }

  if (phase === REVIEWED_CASE_ACTIVATION) {
    if (
      !hasCaseReadModeMigration
      || !hasDirectUploadRetirementMigration
      || !hasDirectUploadActivationMigration
      || !hasCaseActivationMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_ACTIVATION} requires the accepted Case read-mode `
        + "and DirectUpload activation boundaries plus the policyless Case "
        + "ENABLE migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_ACTIVATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseActivationMigration,
      hasDirectUploadActivationMigration,
    };
  }

  if (phase === REVIEWED_CASE_FORCE) {
    if (
      !hasCaseReadModeMigration
      || !hasDirectUploadRetirementMigration
      || !hasDirectUploadActivationMigration
      || !hasCaseActivationMigration
      || !hasCaseForceMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_FORCE} requires the accepted DirectUpload and `
        + "policyless Case activation boundaries plus the posture-only "
        + "Case FORCE migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_FORCE_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseActivationMigration,
      hasCaseForceMigration,
      hasDirectUploadActivationMigration,
    };
  }

  if (phase === REVIEWED_ORDER_PAYMENT_SHIPPING_COMPATIBILITY) {
    if (
      !hasCaseActivationMigration
      || !hasCaseForceMigration
      || !hasOrderPaymentShippingCompatibilityMigration
    ) {
      throw new Error(
        `${REVIEWED_ORDER_PAYMENT_SHIPPING_COMPATIBILITY} requires the `
        + "completed Case FORCE boundary plus the reviewed additive "
        + "Order/payment/shipping compatibility migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      ORDER_PAYMENT_SHIPPING_COMPATIBILITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseForceMigration,
      hasOrderPaymentShippingCompatibilityMigration,
    };
  }

  if (phase === REVIEWED_STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY) {
    if (
      !hasCaseForceMigration
      || !hasOrderPaymentShippingCompatibilityMigration
      || !hasStripeWebhookMaintenanceAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY} requires the `
        + "completed Case FORCE boundary, the reviewed Order/payment/shipping "
        + "compatibility migration, and the reviewed Stripe webhook "
        + "maintenance-authority migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseForceMigration,
      hasOrderPaymentShippingCompatibilityMigration,
      hasStripeWebhookMaintenanceAuthorityMigration,
    };
  }

  if (phase === REVIEWED_STRIPE_WEBHOOK_EVENT_ACTIVATION) {
    if (
      !hasCaseForceMigration
      || !hasOrderPaymentShippingCompatibilityMigration
      || !hasStripeWebhookMaintenanceAuthorityMigration
      || !hasStripeWebhookEventActivationMigration
    ) {
      throw new Error(
        `${REVIEWED_STRIPE_WEBHOOK_EVENT_ACTIVATION} requires the `
        + "completed Case FORCE boundary, the reviewed Order/payment/shipping "
        + "compatibility and Stripe maintenance migrations, and the reviewed "
        + "StripeWebhookEvent policyless activation migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      STRIPE_WEBHOOK_EVENT_ACTIVATION_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseForceMigration,
      hasOrderPaymentShippingCompatibilityMigration,
      hasStripeWebhookMaintenanceAuthorityMigration,
      hasStripeWebhookEventActivationMigration,
    };
  }

  if (phase === REVIEWED_STRIPE_WEBHOOK_EVENT_FORCE) {
    if (
      !hasCaseForceMigration
      || !hasOrderPaymentShippingCompatibilityMigration
      || !hasStripeWebhookMaintenanceAuthorityMigration
      || !hasStripeWebhookEventActivationMigration
      || !hasStripeWebhookEventForceMigration
    ) {
      throw new Error(
        `${REVIEWED_STRIPE_WEBHOOK_EVENT_FORCE} requires the completed `
        + "StripeWebhookEvent policyless activation and the reviewed "
        + "posture-only FORCE migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      STRIPE_WEBHOOK_EVENT_FORCE_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseForceMigration,
      hasOrderPaymentShippingCompatibilityMigration,
      hasStripeWebhookMaintenanceAuthorityMigration,
      hasStripeWebhookEventActivationMigration,
      hasStripeWebhookEventForceMigration,
    };
  }

  if (phase === REVIEWED_CHECKOUT_STOCK_RESERVATION_AUTHORITY) {
    if (
      !hasStripeWebhookEventActivationMigration
      || !hasStripeWebhookEventForceMigration
      || !hasCheckoutStockReservationAuthorityMigration
    ) {
      throw new Error(
        `${REVIEWED_CHECKOUT_STOCK_RESERVATION_AUTHORITY} requires the `
        + "completed StripeWebhookEvent policyless activation and FORCE "
        + "boundaries plus the reviewed CheckoutStockReservation authority migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CHECKOUT_STOCK_RESERVATION_AUTHORITY_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasStripeWebhookEventActivationMigration,
      hasStripeWebhookEventForceMigration,
      hasCheckoutStockReservationAuthorityMigration,
    };
  }

  if (phase === REVIEWED_CASE_RESOLUTION_WINDOW) {
    if (
      !hasCaseForceMigration
      || !hasStripeWebhookEventActivationMigration
      || !hasStripeWebhookEventForceMigration
      || !hasCheckoutStockReservationAuthorityMigration
      || !hasCaseResolutionWindowMigration
    ) {
      throw new Error(
        `${REVIEWED_CASE_RESOLUTION_WINDOW} requires the completed Case FORCE `
        + "boundary, the reviewed StripeWebhookEvent and reservation candidates, "
        + "and the exact Case resolution-window migration",
      );
    }

    assertNoLaterMigration(
      migrationNames,
      CASE_RESOLUTION_WINDOW_MIGRATION,
      phase,
    );
    assertReviewedMigrationTree(phase, migrationTreeSha256);
    assertReviewedPrismaMigrationConfig(prismaConfigSha256);
    assertProductionArtifactExcludesContextGate({
      phase,
      contextGateRouteExists,
      contextGateRunnerTestExists: runnerTestExists,
      middlewareSource,
    });

    return {
      phase,
      hasCaseForceMigration,
      hasStripeWebhookEventActivationMigration,
      hasStripeWebhookEventForceMigration,
      hasCheckoutStockReservationAuthorityMigration,
      hasCaseResolutionWindowMigration,
    };
  }

  const received = phase === undefined || phase === "" ? "missing" : phase;
  throw new Error(
    `${SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV} is ${received}; expected ${RELEASE_ZERO_PHASE}, ${REVIEWED_PHASE_A}, ${REVIEWED_PHASE_B}, ${REVIEWED_NOTIFICATION_PREPARATION}, ${REVIEWED_NOTIFICATION_ACTIVATION}, ${REVIEWED_NOTIFICATION_FORCE}, ${REVIEWED_CONVERSATION_MESSAGE_COMPATIBILITY}, ${REVIEWED_CONVERSATION_MESSAGE_INVARIANTS}, ${REVIEWED_CONVERSATION_MESSAGE_LEGACY_CLEANUP}, ${REVIEWED_CONVERSATION_MESSAGE_AUTHORITY_PREPARATION}, ${REVIEWED_CONVERSATION_MESSAGE_ACTIVATION}, ${REVIEWED_CONVERSATION_MESSAGE_FORCE}, ${REVIEWED_CASE_MESSAGE_COMPATIBILITY}, ${REVIEWED_DIRECT_UPLOAD_PREPARATION}, ${REVIEWED_DIRECT_UPLOAD_LEGACY_REPAIR}, ${REVIEWED_CASE_RESOLUTION_CLAIM_PREPARATION}, ${REVIEWED_CASE_STRIPE_DISPUTE_AUTHORITY}, ${REVIEWED_CASE_SELLER_REFUND_AUTHORITY}, ${REVIEWED_CASE_STAFF_RESOLUTION_AUTHORITY}, ${REVIEWED_CASE_PARTICIPANT_RESOLUTION_AUTHORITY}, ${REVIEWED_CASE_OPEN_AUTHORITY}, ${REVIEWED_CASE_REPLY_AUTHORITY}, ${REVIEWED_CASE_MESSAGE_PREFLIGHT_AUTHORITY}, ${REVIEWED_CASE_MESSAGE_PAGE_AUTHORITY}, ${REVIEWED_CASE_RECIPIENT_READ_AUTHORITY}, ${REVIEWED_CASE_STAFF_QUEUE_AUTHORITY}, ${REVIEWED_CASE_ORDER_ACTIVE_AUTHORITY}, ${REVIEWED_CASE_SELLER_AGGREGATE_AUTHORITY}, ${REVIEWED_CASE_ACCOUNT_EXPORT_AUTHORITY}, ${REVIEWED_CASE_ESCALATION_CRON_AUTHORITY}, ${REVIEWED_CASE_ACCOUNT_DELETION_AUTHORITY}, ${REVIEWED_CASE_INVARIANT}, ${REVIEWED_CASE_READ_MODE}, ${REVIEWED_DIRECT_UPLOAD_RETIREMENT}, ${REVIEWED_DIRECT_UPLOAD_ACTIVATION}, ${REVIEWED_CASE_ACTIVATION}, ${REVIEWED_CASE_FORCE}, ${REVIEWED_ORDER_PAYMENT_SHIPPING_COMPATIBILITY}, ${REVIEWED_STRIPE_WEBHOOK_MAINTENANCE_AUTHORITY}, ${REVIEWED_STRIPE_WEBHOOK_EVENT_ACTIVATION}, ${REVIEWED_STRIPE_WEBHOOK_EVENT_FORCE}, ${REVIEWED_CHECKOUT_STOCK_RESERVATION_AUTHORITY}, or ${REVIEWED_CASE_RESOLUTION_WINDOW}`,
  );
}

export function validateCurrentSavedSearchRlsDeployShape({
  phase,
  rootDirectory = process.cwd(),
} = {}) {
  const migrationDirectory = path.resolve(rootDirectory, "prisma/migrations");
  const prismaConfigPath = path.resolve(rootDirectory, PRISMA_CONFIG_PATH);
  const middlewarePath = path.resolve(rootDirectory, "src/middleware.ts");
  const migrationNames = readdirSync(migrationDirectory, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name);

  return validateSavedSearchRlsDeployShape({
    phase,
    migrationNames,
    migrationTreeSha256: computeMigrationTreeSha256(
      migrationDirectory,
      migrationNames,
    ),
    prismaConfigSha256: computeFileSha256(prismaConfigPath),
    contextGateRouteExists: contextGateRouteArtifactExists(rootDirectory),
    contextGateRunnerTestExists: contextGateRunnerTestExists(rootDirectory),
    middlewareSource: readFileSync(middlewarePath, "utf8"),
  });
}

function runDeployGuard() {
  assertGuardedDeployEnvironment(process.env);
  const result = validateCurrentSavedSearchRlsDeployShape({
    phase: process.env[SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV],
  });

  process.stdout.write(
    `SavedSearch RLS deploy guard passed for ${result.phase}.\n`,
  );
}

const isDirectExecution =
  process.argv[1] !== undefined
  && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);

if (isDirectExecution) {
  try {
    runDeployGuard();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`SavedSearch RLS deploy guard failed: ${message}\n`);
    process.exitCode = 1;
  }
}
