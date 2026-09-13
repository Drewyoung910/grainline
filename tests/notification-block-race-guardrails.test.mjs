import assert from "node:assert/strict";
import fs from "node:fs";
import { describe, it } from "node:test";

describe("Notification reciprocal-block serialization", () => {
  const blockAccess = fs.readFileSync("src/lib/blockMutationAccess.ts", "utf8");
  const blockRoute = fs.readFileSync("src/app/api/users/[id]/block/route.ts", "utf8");
  const unblockAction = fs.readFileSync("src/app/account/blocked/actions.ts", "utf8");
  const accountDeletion = fs.readFileSync("src/lib/accountDeletion.ts", "utf8");
  const serviceSql = fs.readFileSync(
    "docs/rls-drafts/notification-service-authority.sql",
    "utf8",
  );

  it("serializes ordinary block and unblock mutations on a sorted user pair", () => {
    assert.match(blockAccess, /prisma\.\$transaction\(async \(tx\) =>/);
    assert.equal(
      (blockAccess.match(/isolationLevel: Prisma\.TransactionIsolationLevel\.ReadCommitted/g) ?? []).length,
      2,
    );
    assert.match(blockAccess, /WHERE block_user\.id IN \(\$\{blockerId\}, \$\{blockedId\}\)/);
    assert.match(blockAccess, /ORDER BY block_user\.id\s+FOR UPDATE/);
    assert.match(blockAccess, /await lockBlockUserPair\(tx, blockerId, blockedId\)/);
    assert.match(blockAccess, /await tx\.block\.upsert/);
    assert.match(blockAccess, /await tx\.block\.deleteMany/);
    assert.ok(
      blockAccess.indexOf("await lockBlockUserPair(tx, blockerId, blockedId)") <
        blockAccess.indexOf("await tx.block.upsert"),
      "block creation must lock the pair before inserting",
    );
    assert.ok(
      blockAccess.lastIndexOf("await lockBlockUserPair(tx, blockerId, blockedId)") <
        blockAccess.indexOf("await tx.block.deleteMany"),
      "unblock must lock the pair before deleting",
    );
  });

  it("routes both user-facing mutation surfaces through the shared protocol", () => {
    assert.match(blockRoute, /await createUserBlock\(me\.id, blockedId\)/);
    assert.match(blockRoute, /await deleteUserBlock\(me\.id, blockedId\)/);
    assert.doesNotMatch(blockRoute, /prisma\.block\.(?:upsert|deleteMany)/);
    assert.match(unblockAction, /await deleteUserBlock\(me\.id, blockedId\)/);
    assert.doesNotMatch(unblockAction, /prisma\.block\.deleteMany/);
  });

  it("locks the same sorted pair before every service-side block absence check", () => {
    assert.match(serviceSql, /FROM public\."User" AS notification_user_lock/);
    assert.match(serviceSql, /current_setting\('transaction_isolation'\) <> 'read committed'/);
    assert.match(serviceSql, /notification creation requires read committed isolation/);
    assert.match(serviceSql, /ORDER BY notification_user_lock\.id\s+FOR SHARE/);
    assert.ok(
      serviceSql.indexOf('AS notification_user_lock') <
        serviceSql.indexOf('FROM public."Block" AS source_block'),
      "the shared pair lock must precede all reciprocal Block absence checks",
    );
    assert.equal((serviceSql.match(/FROM public\."Block" AS source_block/g) ?? []).length, 1);
    const blockPolicy = serviceSql.slice(
      serviceSql.indexOf("Social/content/message/commission notifications honor reciprocal blocks"),
      serviceSql.indexOf("Source-tagged operations must prove the domain object"),
    );
    for (const sourceType of [
      "blog_comment",
      "commission_interest",
      "commission_request",
      "favorite",
      "follow",
      "followed_maker_new_blog",
      "followed_maker_new_listing",
      "message",
      "review",
      "seller_broadcast",
    ]) {
      assert.match(blockPolicy, new RegExp(`'${sourceType}'`));
    }
    assert.doesNotMatch(blockPolicy, /'case'|'order_checkout'|'order_payment'/);
    assert.match(blockPolicy, /blocking\s+-- must not hide transactional, dispute, or safety state/);
  });

  it("preserves account deletion's earlier conflicting lifecycle lock", () => {
    assert.ok(
      accountDeletion.indexOf("await deleteAccountNotificationServiceRows(tx, user.id)") <
        accountDeletion.indexOf("await tx.block.deleteMany({ where: { blockerId: user.id } })"),
      "account deletion must take the notification cleanup User lock before removing blocks",
    );
  });

  it("locks nullable parent and commission-interest evidence before service insert", () => {
    assert.match(serviceSql, /FOR SHARE OF reply_comment, reply_parent/);
    assert.match(serviceSql, /IF NOT FOUND THEN\s+RETURN NULL;\s+END IF;[\s\S]*FROM public\."BlogComment" AS source_comment/);
    assert.match(serviceSql, /FOR SHARE OF locked_request, locked_interest, locked_seller/);
    assert.match(serviceSql, /locked_request\."buyerId" = p_related_user_id/);
    assert.match(serviceSql, /locked_seller\."userId" = p_user_id/);
  });
});
