import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";
import {
  CONVERSATION_MESSAGE_FORCE_RELEASE,
  verifyConversationMessageForceRelease,
} from "../scripts/verify-conversation-message-force-release.mjs";

const ORDER_RELEASE_SUCCESSORS = Object.freeze([
  [
    "20260926010000_correct_order_provider_terminal_reconciliation",
    "6e835d8da110ee53384d1afd898fe0e02a8c9679f48be24a43557173b3651987",
  ],
  [
    "20260926011000_correct_order_paid_checkout_bound_reservation",
    "757d579c6ac61a9a3d5b434eb9421c1da2dad24d8051c08b61ce2e2850bb4b36",
  ],
  [
    "20260926012000_correct_order_seller_deauthorization_fulfillment",
    "de3db869562e4cdbe411efb1652f0cefb2f2a9687a079e15e84b70aaeb740263",
  ],
  [
    "20260926012100_correct_order_seller_deauthorization_label",
    "75b2c6d00f9f7996c6140a57adbcc91f207cf96e2c495478fb21a9a633f0b29f",
  ],
  [
    "20260926012200_correct_order_seller_deauthorization_projection",
    "4b8ed62faa14d9fa32c57c0045847357d04c16889f9a1d2e3b83633a1c482578",
  ],
  [
    "20260926012300_retire_legacy_checkout_reservation_creators",
    "f66b5314f6116a2900b06c98e0a5cb0236684ab8c0c712e5d6059a758571ae61",
  ],
  [
    "20260928010000_correct_order_deauthorized_case_access",
    "a92fbcbc6c809e51a14cf53c7b98958693c327040565a64929c4527ff56b112f",
  ],
  [
    "20260928020000_correct_order_label_sender_contact",
    "33a6d19fd0e50345bab11fa4c1a5a686aa72768d96db2a4cb9bce80ec7cd521b",
  ],
  [
    "20260928213000_remove_seller_buyer_email_projection",
    "b9b0540de736daa01e8ac15f4fa41af3dd5ae8ffe4d5153aa2487a972b7b6c66",
  ],
  [
    "20260928220000_retire_seller_buyer_email_projection_predecessors",
    "3a1f173fac0293ec05c43b44e9cd2a6895dcdd47effce55236e7e7c7a55fb799",
  ],
  [
    "20260929130000_revoke_order_item_shipping_quote_runtime_access",
    "32c085b262400201864e6bfb7d32829b886b99a48771f62da141352c1c8bab99",
  ],
  [
    "20260929160000_force_order_rls",
    "1f48553466fd1ee0373d48036e5e193cedbb6d4ff094ad1fba753e8c75e7e139",
  ],
  [
    "20260930030000_bound_listing_fulfillment_days",
    "ceef219897013aa84bec0155f23e0ce01d8c48472d6e8bcb166e713d1e4edd96",
  ],
  [
    "20260930031000_mark_paid_private_listing_sold",
    "0a1cb4828cce4d05abf783b12d790c13581fb7698f8063aaeaf92b5fa8c6bee1",
  ],
  [
    "20260930032000_block_checkout_user_pairs",
    "dc1cdbf14a5b126635af44fbbc4ca820ac16e46823a68071400fd5786110209d",
  ],
  [
    "20260930033000_order_ops_health_summary",
    "ed5e069248281ef8738f97bd0480ee77b85044a4ad2c9ac433ef2840a2a7e941",
  ],
]);

function fixtureRoot() {
  const root = mkdtempSync(
    path.join(os.tmpdir(), "conversation-message-force-release-"),
  );
  const migrations = path.join(root, "prisma", "migrations");
  mkdirSync(migrations, { recursive: true });
  return { root, migrations };
}

function writeRelease(migrations, release, contents) {
  const directory = path.join(migrations, release.migrationName);
  mkdirSync(directory);
  writeFileSync(path.join(directory, "migration.sql"), contents);
}

describe("Conversation and Message FORCE release artifact", () => {
  const activation = readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_FORCE_RELEASE.activation.migrationName}/migration.sql`,
    "utf8",
  );
  const force = readFileSync(
    `prisma/migrations/${CONVERSATION_MESSAGE_FORCE_RELEASE.force.migrationName}/migration.sql`,
    "utf8",
  );

  it("pins the activation baseline and exact FORCE-only hardening bytes", () => {
    assert.deepEqual(verifyConversationMessageForceRelease(), {
      status: "passed",
      activationMigration: "20260726073000_enable_conversation_message_rls",
      activationSha256:
        "d4ba421be0f66c5acbc331f9c70939846b0f9675ff5ae026c09735760d92811a",
      forceMigration: "20260726140000_force_conversation_message_rls",
      forceSha256:
        "c7f6bbb65c1b0b05c43c2ad450235523587de16f4c8b5ca3289bbff28df33a35",
      forceOnlyHardening: true,
      forcedTables: ["Conversation", "Message"],
    });
    assert.equal(
      (
        force.match(
          /^ALTER TABLE public\."(?:Conversation|Message)" FORCE ROW LEVEL SECURITY;$/gm,
        ) ?? []
      ).length,
      2,
    );
    assert.equal((force.match(/^BEGIN;$/gm) ?? []).length, 1);
    assert.equal((force.match(/^COMMIT;$/gm) ?? []).length, 1);
    assert.doesNotMatch(
      force,
      /^(?:CREATE|DROP)\s+POLICY\b|^(?:GRANT|REVOKE)\s|^(?:INSERT|UPDATE|DELETE)\s/mi,
    );
    assert.match(force, /current_user = 'neondb_owner'/);
    assert.match(
      force,
      /current_user = 'ci'[\s\S]{0,100}current_database\(\) = 'grainline_ci'/,
    );
    assert.match(force, /owner-session drain is incomplete/);
    assert.match(force, /membership-free/);
    assert.match(
      force,
      /grainline_conversation_participant_or_reported_select/,
    );
    assert.match(force, /grainline_message_participant_or_reported_select/);
    assert.match(force, /runtime table privileges must remain exact SELECT-only/);
  });

  it("fails closed on missing, drifting, or symlinked FORCE bytes", () => {
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /migration is missing/,
      );
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.force,
        `${force}\n-- drift\n`,
      );
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /migration bytes drifted/,
      );
    }
    {
      const { root, migrations } = fixtureRoot();
      writeRelease(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.activation,
        activation,
      );
      const directory = path.join(
        migrations,
        CONVERSATION_MESSAGE_FORCE_RELEASE.force.migrationName,
      );
      mkdirSync(directory);
      const target = path.join(root, "force.sql");
      writeFileSync(target, force);
      symlinkSync(target, path.join(directory, "migration.sql"));
      assert.throws(
        () => verifyConversationMessageForceRelease(root),
        /regular non-symlink/,
      );
    }
  });

  it("runs the exact FORCE proof in disposable PostgreSQL 16", () => {
    const workflow = readFileSync(
      ".github/workflows/conversation-message-force-proof.yml",
      "utf8",
    );
    assert.match(workflow, /image: postgres:16/);
    const successorFence = workflow.indexOf(
      "Isolate reviewed Order release successors from historical proof",
    );
    const coreFence = workflow.indexOf(
      "Isolate staged Core Order ENABLE from historical proof",
    );
    const compatibleApply = workflow.indexOf(
      "Apply compatible migrations including Conversation and Message FORCE",
    );
    const currentApply = workflow.indexOf(
      "Apply current migrations including DirectUpload activation",
    );
    const conversationProof = workflow.indexOf(
      "Prove FORCE-hardened Conversation and Message authority",
    );
    const successorRestore = workflow.indexOf(
      "Restore reviewed Order release successors",
    );
    const coreRestore = workflow.indexOf("Restore staged Core Order ENABLE");
    assert.ok(successorFence >= 0);
    for (const [digest, migration] of [
      [
        "a648437f13d93e1673f64935d381630e6ec2b19e7633c33837e88938240ef5c7",
        "20261002030000_preserve_order_shipping_dispute_evidence",
      ],
      [
        "3f2e6061e1de1a6f6c92645979a686ec4d3ee36409dc4499c2c62c90dafe1cf8",
        "20261002160000_add_user_email_suppression_key_index",
      ],
      [
        "a4b247ce83e871f657ee8228873c3113bdc5cf58adb7292a2e90206c147f67a8",
        "20261002161000_add_user_email_address_suppression_key_index",
      ],
      [
        "02ccc97c9e4d1e48320b58bd7ccc23aa023b7330d0add6fcf76802cc266f567c",
        "20261002162000_add_user_email_address_current_unique_index",
      ],
      [
        "4b058ca847eac24428f8bd4733ed81fed26c6aa138437740e18c58da80bb2933",
        "20261002170000_prepare_user_email_address_authority",
      ],
      [
        "b64751439f75fce70850ab43446c35ce6df45301b2a03970b560306898df1f2e",
        "20261003010000_repair_user_email_address_current_history",
      ],
      [
        "d61df27c1c565d6fffde2fea130eb27b2ef95e842dbffef5e6b2862cd57bcbee",
        "20261003020000_enable_user_email_address_rls",
      ],
      [
        "68bc032ecf38a63bd4ab9a219e315b69d8fa505bc3b99b6abf20e7d435812402",
        "20261003030000_force_user_email_address_rls",
      ],
    ]) {
      assert.match(workflow, new RegExp(`${digest} ${migration}`));
      assert.ok(workflow.indexOf(`${digest} ${migration}`) > successorFence);
      assert.ok(workflow.indexOf(`${digest} ${migration}`) < compatibleApply);
      assert.ok(workflow.lastIndexOf(migration) > successorRestore);
    }
    assert.ok(successorFence < compatibleApply);
    assert.ok(successorFence < currentApply);
    assert.ok(coreFence > successorFence && coreFence < compatibleApply);
    assert.ok(conversationProof < successorRestore);
    assert.ok(conversationProof < coreRestore);
    const fenceBlock = workflow.slice(successorFence, compatibleApply);
    const restoreBlock = workflow.slice(
      successorRestore,
      workflow.indexOf(
        "Restore reviewed Production-owner Order buyer correction",
        successorRestore,
      ),
    );
    for (const migration of [
      "20261002030000_preserve_order_shipping_dispute_evidence",
      "20261002160000_add_user_email_suppression_key_index",
      "20261002161000_add_user_email_address_suppression_key_index",
      "20261002162000_add_user_email_address_current_unique_index",
      "20261002170000_prepare_user_email_address_authority",
      "20261003010000_repair_user_email_address_current_history",
      "20261003020000_enable_user_email_address_rls",
      "20261003030000_force_user_email_address_rls",
    ]) {
      assert.match(restoreBlock, new RegExp(migration, "u"));
    }
    for (const [migration, digest] of ORDER_RELEASE_SUCCESSORS) {
      assert.match(fenceBlock, new RegExp(`${digest} ${migration}`, "u"));
      assert.match(restoreBlock, new RegExp(migration, "u"));
    }
    const coreFenceBlock = workflow.slice(coreFence, compatibleApply);
    assert.match(coreFenceBlock, /20260927090000_enable_order_rls/u);
    assert.match(
      coreFenceBlock,
      /350567d0141601fd858dcc2df99f59b085d1f66573560b027148e66278a1eec8/u,
    );
    assert.ok(coreRestore > successorRestore);
    assert.match(
      workflow,
      /Isolate DirectUpload activation until external grants converge[\s\S]*Apply compatible migrations including Conversation and Message FORCE[\s\S]*Converge pre-activation production-style runtime grants[\s\S]*Converge pre-activation DirectUpload cleanup-worker grants[\s\S]*Restore exact DirectUpload activation[\s\S]*Apply current migrations including DirectUpload activation[\s\S]*Reconverge activated production-style runtime grants[\s\S]*Reconverge activated DirectUpload cleanup-worker grants/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-force-release/,
    );
    assert.match(
      workflow,
      /Prove runtime-role provisioning refusals exit nonzero[\s\S]*runtime_role=ci -v migration_role=ci[\s\S]*runtime-role provisioning unexpectedly accepted the migration owner as runtime/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-force-rollback/,
    );
    assert.match(
      workflow,
      /npm run audit:rls-conversation-message-recipient/,
    );
    assert.match(
      workflow,
      /GRANT_AUDIT_DATABASE_URL="\$DIRECT_URL" RUNTIME_DB_ROLE=grainline_app_runtime MIGRATION_DB_ROLE=ci npm run audit:db-grants -- --allow-loopback-ci/,
    );
    assert.doesNotMatch(workflow, /PRODUCTION_MIGRATION_DIRECT_URL/);
    assert.match(workflow, /scripts\/provision-direct-upload-cleanup-role\.sql/);
  });
});
