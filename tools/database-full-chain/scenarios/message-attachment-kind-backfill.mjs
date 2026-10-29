import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

export const MESSAGE_ATTACHMENT_KIND_BACKFILL_FIXTURE_ANCHOR =
  "20261027010000_restore_resend_webhook_receipts";

function rowsOf(result) {
  return Array.isArray(result) ? result : (result?.rows ?? []);
}

async function sendNullKindMessage(database, fixture, key, body) {
  const messageId = fixture.messages[key];
  const result = rowsOf(await database.query(
    `SELECT *
       FROM public.grainline_message_send_ordinary(
         $1, $2, $3, $4, NULL, NULL
       )`,
    [messageId, fixture.senderId, fixture.conversationId, body],
  ));
  assert.equal(result.length, 1);
  assert.equal(result[0]?.messageId, messageId);
}

export async function seedMessageAttachmentKindBackfillFixture(database) {
  const namespace = `message_attachment_kind_${Date.now()}_${Math.random().toString(16).slice(2)}`;
  const participantIds = [
    `${namespace}_sender`,
    `${namespace}_recipient`,
  ].sort();
  const senderId = participantIds[0];
  const recipientId = participantIds[1];
  const conversationId = `${namespace}_conversation`;
  const legitimateKey = `messageAny/${senderId}/legacy-owned.png`;
  const foreignKey = `messageAny/${recipientId}/legacy-foreign.png`;
  const wrongEndpointKey = `listingImage/${senderId}/legacy-listing.png`;
  const legitimateUrl = `https://media.example.test/${legitimateKey}`;
  const foreignUrl = `https://media.example.test/${foreignKey}`;
  const wrongEndpointUrl = `https://media.example.test/${wrongEndpointKey}`;
  const now = "2026-10-27 12:00:00";
  const messages = Object.fromEntries(
    [
      "ownedStructured",
      "foreignStructured",
      "wrongEndpointStructured",
      "rawOwnedUrl",
      "malformedJson",
      "ordinaryText",
    ].map((key) => [key, randomUUID()]),
  );
  const fixture = Object.freeze({
    senderId,
    recipientId,
    conversationId,
    legitimateUrl,
    foreignUrl,
    wrongEndpointUrl,
    messages: Object.freeze(messages),
    originalOwnedBody: JSON.stringify({
      kind: "file",
      url: legitimateUrl,
      name: "Legacy owned.png",
      type: "image/png",
    }),
  });

  await database.query(
    `INSERT INTO public."User"
       (id, "clerkId", email, name, role, banned, "createdAt", "updatedAt")
     VALUES
       ($1, $2, $3, 'Legacy attachment sender', 'USER', false, $7, $7),
       ($4, $5, $6, 'Legacy attachment recipient', 'USER', false, $7, $7)`,
    [
      senderId,
      `clerk_${senderId}`.slice(0, 191),
      `${senderId}@example.test`.slice(0, 191),
      recipientId,
      `clerk_${recipientId}`.slice(0, 191),
      `${recipientId}@example.test`.slice(0, 191),
      now,
    ],
  );
  await database.query(
    `INSERT INTO public."Conversation"
       (id, "userAId", "userBId", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, $4, $4)`,
    [conversationId, senderId, recipientId, now],
  );
  await database.query(
    `INSERT INTO public."DirectUpload"
       (id, key, endpoint, "userId", "publicUrl", "storageClass",
        "contentType", "expectedSize", status, "verifiedAt", "createdAt", "updatedAt")
     VALUES
       ($1, $2, 'messageAny', $3, $4, 'PUBLIC', 'image/png', 128,
        'VERIFIED', $13, $13, $13),
       ($5, $6, 'messageAny', $7, $8, 'PUBLIC', 'image/png', 128,
        'VERIFIED', $13, $13, $13),
       ($9, $10, 'listingImage', $11, $12, 'PUBLIC', 'image/png', 128,
        'VERIFIED', $13, $13, $13)`,
    [
      `${namespace}_owned_upload`,
      legitimateKey,
      senderId,
      legitimateUrl,
      `${namespace}_foreign_upload`,
      foreignKey,
      recipientId,
      foreignUrl,
      `${namespace}_wrong_endpoint_upload`,
      wrongEndpointKey,
      senderId,
      wrongEndpointUrl,
      now,
    ],
  );

  await sendNullKindMessage(
    database,
    fixture,
    "ownedStructured",
    fixture.originalOwnedBody,
  );
  await sendNullKindMessage(
    database,
    fixture,
    "foreignStructured",
    JSON.stringify({
      kind: "file",
      url: foreignUrl,
      name: "Not sender owned.png",
      type: "image/png",
    }),
  );
  await sendNullKindMessage(
    database,
    fixture,
    "wrongEndpointStructured",
    JSON.stringify({
      kind: "file",
      url: wrongEndpointUrl,
      name: "Listing image.png",
      type: "image/png",
    }),
  );
  await sendNullKindMessage(database, fixture, "rawOwnedUrl", legitimateUrl);
  await sendNullKindMessage(database, fixture, "malformedJson", '{"kind":"file"');
  await sendNullKindMessage(database, fixture, "ordinaryText", "ordinary message");

  return fixture;
}

export async function proveMessageAttachmentKindBackfill({ database, fixture }) {
  const rows = rowsOf(await database.query(
    `SELECT id, body, kind
       FROM public."Message"
      WHERE id = ANY($1::text[])
      ORDER BY id`,
    [Object.values(fixture.messages)],
  ));
  assert.equal(rows.length, 6);
  const byId = new Map(rows.map((row) => [row.id, row]));

  assert.deepEqual(byId.get(fixture.messages.ownedStructured), {
    id: fixture.messages.ownedStructured,
    body: fixture.originalOwnedBody,
    kind: "file",
  });
  for (const key of [
    "foreignStructured",
    "wrongEndpointStructured",
    "rawOwnedUrl",
    "malformedJson",
    "ordinaryText",
  ]) {
    assert.equal(
      byId.get(fixture.messages[key])?.kind,
      null,
      `${key} must not gain durable attachment authority`,
    );
  }

  const uploadRows = rowsOf(await database.query(
    `SELECT "publicUrl", status, "claimedByType", "claimedById"
       FROM public."DirectUpload"
      WHERE "publicUrl" = ANY($1::text[])
      ORDER BY "publicUrl"`,
    [[fixture.legitimateUrl, fixture.foreignUrl, fixture.wrongEndpointUrl]],
  ));
  assert.equal(uploadRows.length, 3);
  assert.ok(uploadRows.every((row) => row.status === "VERIFIED"));
  assert.ok(uploadRows.every((row) => row.claimedByType === null));
  assert.ok(uploadRows.every((row) => row.claimedById === null));

  return Object.freeze({
    restoredOwnedStructuredAttachmentCount: 1,
    rejectedUnprovenMessageCount: 5,
  });
}
