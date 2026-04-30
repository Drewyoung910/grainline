import assert from "node:assert/strict";
import { describe, it } from "node:test";

const {
  parseCommissionInterestMessageBody,
  parseCustomOrderLinkMessageBody,
  parseCustomOrderRequestMessageBody,
  parseFileMessageBody,
  parseThreadMessagesEvent,
} = await import("../src/lib/messageBodies.ts");

describe("message body parsers", () => {
  it("parses file message bodies and rejects malformed JSON", () => {
    assert.deepEqual(
      parseFileMessageBody(JSON.stringify({ kind: "file", url: "https://cdn.example/file.pdf", name: "Plan.pdf", type: "application/pdf" })),
      { kind: "file", url: "https://cdn.example/file.pdf", name: "Plan.pdf", type: "application/pdf" },
    );
    assert.equal(parseFileMessageBody("{bad json"), null);
    assert.equal(parseFileMessageBody(JSON.stringify({ kind: "file", name: "missing-url" })), null);
  });

  it("normalizes typed card payloads instead of trusting raw JSON shapes", () => {
    assert.deepEqual(
      parseCommissionInterestMessageBody(JSON.stringify({
        commissionId: "cm_1",
        sellerName: "Maker",
        budgetMinCents: 10000,
        budgetMaxCents: "not-a-number",
      })),
      {
        commissionId: "cm_1",
        commissionTitle: undefined,
        sellerName: "Maker",
        budgetMinCents: 10000,
        budgetMaxCents: undefined,
        timeline: undefined,
      },
    );
    assert.deepEqual(
      parseCustomOrderRequestMessageBody(JSON.stringify({ description: "Build a bench", budget: 1200, timelineLabel: null })),
      {
        description: "Build a bench",
        dimensions: undefined,
        budget: 1200,
        timelineLabel: null,
        listingTitle: undefined,
      },
    );
    assert.deepEqual(
      parseCustomOrderLinkMessageBody(JSON.stringify({ listingId: "lst_1", title: "Bench", priceCents: 45000, currency: "usd" })),
      { listingId: "lst_1", title: "Bench", priceCents: 45000, currency: "usd" },
    );
  });

  it("parses SSE message events and drops malformed rows", () => {
    assert.deepEqual(
      parseThreadMessagesEvent(JSON.stringify({
        type: "messages",
        messages: [
          {
            id: "msg_1",
            senderId: "user_1",
            recipientId: "user_2",
            body: "hello",
            kind: null,
            createdAt: "2026-04-30T00:00:00.000Z",
          },
          { id: "bad", body: "missing fields" },
        ],
      })),
      [
        {
          id: "msg_1",
          senderId: "user_1",
          recipientId: "user_2",
          body: "hello",
          kind: null,
          isSystemMessage: undefined,
          createdAt: "2026-04-30T00:00:00.000Z",
          readAt: undefined,
        },
      ],
    );
    assert.equal(parseThreadMessagesEvent(JSON.stringify({ type: "heartbeat" })), null);
    assert.equal(parseThreadMessagesEvent("{bad json"), null);
  });
});
