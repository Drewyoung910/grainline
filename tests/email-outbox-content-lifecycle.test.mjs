import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  accountEmailOutboxWhere,
  EMAIL_OUTBOX_EXPORT_SELECT,
  redactEmailOutboxRepresentations,
  sellerBroadcastOutboxCancellationWhere,
} = await import("../src/lib/emailOutboxContentLifecycle.ts");

function matchesWhere(row, where) {
  if (where.AND) return where.AND.every((part) => matchesWhere(row, part));
  if (where.OR) return where.OR.some((part) => matchesWhere(row, part));
  if (where.id?.in && !where.id.in.includes(row.id)) return false;
  if (typeof where.userId === "string" && row.userId !== where.userId) return false;
  if (where.userId === null && row.userId !== null) return false;
  if (where.recipientEmail?.in && !where.recipientEmail.in.includes(row.recipientEmail)) return false;
  if (where.payloadVersion === null && row.payloadVersion !== null) return false;
  if (where.payloadVersion?.not === null && row.payloadVersion === null) return false;
  return true;
}

function fakeClient(rows) {
  return {
    emailOutbox: {
      async updateMany({ where, data }) {
        let count = 0;
        for (const row of rows) {
          if (!matchesWhere(row, where)) continue;
          Object.assign(row, structuredClone(data));
          count += 1;
        }
        return { count };
      },
    },
  };
}

describe("email outbox mixed-format lifecycle", () => {
  it("redacts legacy and structured rows without switching their representation", async () => {
    const rows = [
      {
        id: "legacy",
        userId: "owner",
        recipientEmail: "owner@example.com",
        subject: "Private legacy subject",
        html: "<p>Private legacy body</p>",
        payloadVersion: null,
        payload: null,
      },
      {
        id: "structured",
        userId: null,
        recipientEmail: "owner@example.com",
        subject: null,
        html: null,
        payloadVersion: 1,
        payload: { buyerName: "Private structured content" },
      },
      {
        id: "unrelated",
        userId: "other",
        recipientEmail: "owner@example.com",
        subject: null,
        html: null,
        payloadVersion: 1,
        payload: { buyerName: "Keep me" },
      },
    ];

    await redactEmailOutboxRepresentations(
      fakeClient(rows),
      accountEmailOutboxWhere("owner", ["owner@example.com"]),
      {
        subject: "Email removed after account deletion",
        html: "[Email removed after account deletion]",
      },
    );

    assert.deepEqual(rows[0], {
      id: "legacy",
      userId: "owner",
      recipientEmail: "owner@example.com",
      subject: "Email removed after account deletion",
      html: "[Email removed after account deletion]",
      payloadVersion: null,
      payload: null,
    });
    assert.deepEqual(rows[1], {
      id: "structured",
      userId: null,
      recipientEmail: "owner@example.com",
      subject: null,
      html: null,
      payloadVersion: 1,
      payload: {},
    });
    assert.deepEqual(rows[2], {
      id: "unrelated",
      userId: "other",
      recipientEmail: "owner@example.com",
      subject: null,
      html: null,
      payloadVersion: 1,
      payload: { buyerName: "Keep me" },
    });
  });

  it("uses email fallback only for rows without another stable account owner", () => {
    assert.deepEqual(accountEmailOutboxWhere("owner", ["reused@example.com"]), {
      OR: [
        { userId: "owner" },
        {
          userId: null,
          recipientEmail: { in: ["reused@example.com"] },
        },
      ],
    });
    assert.deepEqual(accountEmailOutboxWhere("owner", []), { userId: "owner" });
  });

  it("exports the structured envelope while continuing to omit rendered HTML", () => {
    assert.equal(EMAIL_OUTBOX_EXPORT_SELECT.subject, true);
    assert.equal(EMAIL_OUTBOX_EXPORT_SELECT.payloadVersion, true);
    assert.equal(EMAIL_OUTBOX_EXPORT_SELECT.payload, true);
    assert.equal("html" in EMAIL_OUTBOX_EXPORT_SELECT, false);
  });

  it("cancels a seller broadcast by its durable source identity", () => {
    assert.deepEqual(sellerBroadcastOutboxCancellationWhere("broadcast_123"), {
      preferenceKey: "EMAIL_SELLER_BROADCAST",
      sourceType: "seller_broadcast",
      sourceId: "broadcast_123",
      status: { in: ["PENDING", "FAILED"] },
    });
  });
});
