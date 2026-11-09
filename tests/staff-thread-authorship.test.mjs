import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

const { staffThreadMessagePresentation } = await import(
  "../src/lib/staffThreadMessagePresentation.ts"
);

describe("reported-thread staff authorship", () => {
  const participants = [
    {
      id: "user-a",
      authorLabel: "Alex · Participant A",
      imageUrl: "https://example.test/a.jpg",
      align: "left",
    },
    {
      id: "user-b",
      authorLabel: "Alex · Participant B",
      imageUrl: null,
      align: "right",
    },
  ];

  it("keeps ordinary participant views unchanged", () => {
    assert.equal(staffThreadMessagePresentation("user-a", undefined), null);
  });

  it("identifies and separates both reported-thread participants", () => {
    assert.deepEqual(staffThreadMessagePresentation("user-a", participants), {
      authorLabel: "Alex · Participant A",
      imageUrl: "https://example.test/a.jpg",
      alignRight: false,
    });
    assert.deepEqual(staffThreadMessagePresentation("user-b", participants), {
      authorLabel: "Alex · Participant B",
      imageUrl: null,
      alignRight: true,
    });
  });

  it("does not silently attribute an unexpected sender to either party", () => {
    assert.deepEqual(staffThreadMessagePresentation("unexpected", participants), {
      authorLabel: "Unknown participant",
      imageUrl: null,
      alignRight: false,
    });
  });

  it("wires durable participant identities into every message-card branch", () => {
    const page = readFileSync("src/app/messages/[id]/page.tsx", "utf8");
    const thread = readFileSync("src/components/ThreadMessages.tsx", "utf8");

    assert.match(page, /reviewParticipants=\{isStaffReviewMode/);
    assert.match(page, /Participant A/);
    assert.match(page, /Participant B/);
    assert.match(
      thread,
      /staffThreadMessagePresentation\(\s*m\.senderId,\s*reviewParticipants,?\s*\)/,
    );
    assert.equal(
      (thread.match(/<ReviewAuthorLabel presentation=\{reviewPresentation\} \/>/g) ?? []).length,
      4,
    );
  });
});
