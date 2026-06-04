import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

function source(path) {
  return readFileSync(path, "utf8");
}

describe("currency formatting drift guardrails", () => {
  it("uses shared currency formatting for refund and guild money copy", () => {
    const sellerRefund = source("src/app/api/orders/[id]/refund/route.ts");
    const caseResolve = source("src/app/api/cases/[id]/resolve/route.ts");
    const guildMetrics = source("src/app/api/cron/guild-metrics/route.ts");
    const followerFanout = source("src/lib/followerListingNotifications.ts");
    const threadMessages = source("src/components/ThreadMessages.tsx");

    assert.match(sellerRefund, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(sellerRefund, /const refundAmountDisplay = formatCurrencyCents\(\s*refundAmountCents,\s*order\.currency,\s*\)/s);
    assert.doesNotMatch(sellerRefund, /refundAmountCents \/ 100|refund of \$\$\{/);

    assert.match(caseResolve, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(caseResolve, /formatCurrencyCents\(persistedRefundAmountCents, caseRecord\.order\.currency\)/);
    assert.doesNotMatch(caseResolve, /persistedRefundAmountCents \/ 100|\(\$\$\{/);

    assert.match(guildMetrics, /import \{ formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(guildMetrics, /formatCurrencyCents\(metrics\.totalSalesCents\)/);
    assert.match(guildMetrics, /formatCurrencyCents\(GUILD_MASTER_REQUIREMENTS\.totalSalesCents\)/);
    assert.doesNotMatch(guildMetrics, /totalSalesCents \/ 100/);

    assert.match(followerFanout, /formatCurrencyCents\(listing\.priceCents, listing\.currency\)/);
    assert.doesNotMatch(followerFanout, /priceCents \/ 100|toFixed\(2\)/);

    assert.match(threadMessages, /import \{ DEFAULT_CURRENCY, formatCurrencyCents \} from "@\/lib\/money"/);
    assert.match(threadMessages, /formatCurrencyCents\(link\.priceCents, link\.currency \?\? DEFAULT_CURRENCY\)/);
    assert.doesNotMatch(threadMessages, /link\.priceCents \/ 100|toFixed\(2\)/);
  });
});
