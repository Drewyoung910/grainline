import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { readFileSync } from "node:fs";

function source(path) {
  return readFileSync(new URL(`../${path}`, import.meta.url), "utf8");
}

describe("owner-derived notification identity", () => {
  const sql = source("docs/rls-drafts/notification-service-authority.sql");
  const serviceAccess = source("src/lib/notificationServiceAccess.ts");
  const notifications = source("src/lib/notifications.ts");

  it("does not accept runtime payload, link, or dedup identity in creation authority", () => {
    assert.doesNotMatch(sql, /\bp_title\b|\bp_body\b|\bp_link\b|\bp_dedup_key\b/);
    assert.equal((sql.match(/p_related_user_id text\n\)/g) ?? []).length, 11);
    assert.equal(
      (sql.match(/text, text, public\."NotificationType", text, text, text/g) ?? []).length,
      21,
    );
    assert.doesNotMatch(serviceAccess, /\$\{title\}|\$\{body\}|\$\{link\}|\$\{dedupKey\}|authorityContextId/);
    assert.doesNotMatch(serviceAccess, /\btitle: string|\bbody: string/);
    assert.doesNotMatch(notifications, /notificationDedupKey|dedupKey,/);
  });

  it("derives stable replay identity from the validated event dimensions", () => {
    assert.match(sql, /replay_material := pg_catalog\.concat_ws\(/);
    assert.match(
      sql,
      /'grainline-notification-v1',[\s\S]{0,180}p_user_id,[\s\S]{0,80}p_type::text,[\s\S]{0,80}p_source_type,[\s\S]{0,80}p_source_id,[\s\S]{0,120}COALESCE\(p_related_user_id, '<system>'\)/,
    );
    assert.equal((sql.match(/pg_catalog\.md5\(/g) ?? []).length, 4);
    assert.match(sql, /notification_dedup_key :=[\s\S]{0,180}grainline-notification-v1-secondary/);
    assert.match(sql, /derived_dedup_key :=[\s\S]{0,180}grainline-notification-v1-secondary/);
    assert.match(
      sql,
      /'BACK_IN_STOCK',[\s\S]{0,100}'manual_restock',[\s\S]{0,100}p_restock_audit_id,[\s\S]{0,100}p_stock_notification_id/,
    );
    assert.match(sql, /"dedupKey"[\s\S]{0,180}notification_dedup_key/);
    assert.match(sql, /ON CONFLICT \("userId", "type", "dedupKey"\) DO NOTHING/);
  });

  it("derives canonical links from validated source rows", () => {
    assert.equal((sql.match(/INTO notification_link/g) ?? []).length, 27);
    assert.match(sql, /INTO notification_link, notification_title, notification_body/);
    assert.match(sql, /SELECT\s+'\/blog\/' \|\| source_post\.slug \|\| '#comment-' \|\| source_comment\.id/);
    assert.match(sql, /SELECT\s+'\/listing\/' \|\| source_listing\.id/);
    assert.match(sql, /SELECT\s+'\/account\/feed\?broadcast=' \|\| source_broadcast\.id/);
    assert.match(sql, /SELECT\s+'\/dashboard\/analytics'/);
    assert.match(sql, /SELECT\s+'\/listing\/' \|\| context_listing\.id/);
    assert.match(sql, /SELECT\s+'\/messages\/' \|\| source_conversation\.id/);
    assert.match(sql, /THEN '\/dashboard\/orders\/' \|\| source_case\."orderId"/);
    assert.match(sql, /ELSE '\/dashboard\/sales\/' \|\| source_case\."orderId"/);
    assert.match(sql, /derived notification link is invalid/);
  });

  it("derives every source payload inside owner authority", () => {
    assert.equal((sql.match(/INTO notification_link, notification_title, notification_body/g) ?? []).length, 27);
    assert.match(sql, /source_comment\.body, 60/);
    assert.match(sql, /source_case\.description, 60/);
    assert.match(sql, /source_message\.body::jsonb ->> 'description'/);
    assert.match(sql, /source_broadcast\.message, 100/);
    assert.match(sql, /source_review\."ratingX2"/);
    assert.match(sql, /notification_title := pg_catalog\.left\(notification_title, 200\)/);
    assert.match(sql, /notification_body := pg_catalog\.left\(notification_body, 1000\)/);
    assert.match(sql, /derived notification payload is invalid/);
  });
});
