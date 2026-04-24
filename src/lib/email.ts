// src/lib/email.ts
import { Resend } from "resend";

const HAS_RESEND = !!process.env.RESEND_API_KEY && !!process.env.EMAIL_FROM;
const resend = HAS_RESEND ? new Resend(process.env.RESEND_API_KEY) : null;
const APP_URL = process.env.NEXT_PUBLIC_APP_URL || "https://thegrainline.com";

if (!process.env.RESEND_API_KEY) {
  console.warn("[email] RESEND_API_KEY is not set. Emails will be logged but not sent.");
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

function esc(s: string) {
  return s
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

/** Strip HTML-like characters from user content in email subjects */
function safeSubject(s: string) {
  return s.replace(/[<>"'&]/g, "");
}

/** Validate and escape a URL for use in img src attributes */
function safeImgUrl(url: string | undefined | null): string | null {
  if (!url || !url.startsWith("https://")) return null;
  return url.replace(/"/g, "%22");
}

function fmtCents(cents: number) {
  return `$${(cents / 100).toFixed(2)}`;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  return new Date(d).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric" });
}

function trackingUrl(carrier: string | null | undefined, trackingNumber: string): string {
  const c = (carrier || "").toLowerCase();
  if (c.includes("ups")) return `https://www.ups.com/track?tracknum=${encodeURIComponent(trackingNumber)}`;
  if (c.includes("usps")) return `https://tools.usps.com/go/TrackConfirmAction?tLabels=${encodeURIComponent(trackingNumber)}`;
  if (c.includes("fedex")) return `https://www.fedex.com/apps/fedextrack/?trknbr=${encodeURIComponent(trackingNumber)}`;
  if (c.includes("dhl")) return `https://www.dhl.com/en/express/tracking.html?AWB=${encodeURIComponent(trackingNumber)}`;
  return `https://www.google.com/search?q=${encodeURIComponent((carrier ?? "") + " tracking " + trackingNumber)}`;
}

function btn(label: string, url: string): string {
  return `<p style="margin:20px 0 0;"><a href="${url}" style="display:inline-block;background:#1C1C1A;color:#FFFFFF;text-decoration:none;padding:12px 28px;font-size:14px;font-weight:600;">${esc(label)}</a></p>`;
}

function baseTemplate(title: string, body: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)}</title></head>
<body style="margin:0;padding:0;background:#FAFAF8;font-family:system-ui,-apple-system,'Segoe UI',Roboto,Helvetica,Arial,sans-serif;color:#3D3D3A;">
<table width="100%" cellpadding="0" cellspacing="0" style="background:#1C1C1A;">
  <tr><td align="center" style="padding:20px 24px;">
    <a href="${APP_URL}" style="text-decoration:none;font-size:20px;font-weight:700;color:#F5F4F0;letter-spacing:0.04em;">Grainline</a>
  </td></tr>
</table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;padding:36px 0 24px;">
    <tr><td>
      <h1 style="margin:0 0 20px;font-size:20px;font-weight:700;color:#1C1C1A;">${esc(title)}</h1>
      ${body}
    </td></tr>
  </table>
</td></tr></table>
<table width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:0 16px;">
  <table width="100%" cellpadding="0" cellspacing="0" style="max-width:560px;border-top:1px solid #E2E0DC;padding:20px 0 48px;">
    <tr><td style="font-size:11px;color:#9D9C97;line-height:1.6;">
      © 2026 Grainline LLC &nbsp;·&nbsp;
      <a href="${APP_URL}" style="color:#9D9C97;text-decoration:none;">thegrainline.com</a>
      &nbsp;·&nbsp;
      <a href="${APP_URL}/unsubscribe" style="color:#9D9C97;text-decoration:none;">Unsubscribe</a>
      <br/>
      <span style="font-size:10px;">5900 Balcones Drive STE 100, Austin, TX 78731</span>
    </td></tr>
  </table>
</td></tr></table>
</body></html>`;
}

function itemTable(items: { title: string; quantity: number; priceCents: number }[]): string {
  const rows = items
    .map(
      (it) =>
        `<tr>
        <td style="padding:8px 0;border-bottom:1px solid #E2E0DC;font-size:13px;">${esc(it.title)}</td>
        <td style="padding:8px 12px;border-bottom:1px solid #E2E0DC;font-size:13px;text-align:center;">×${it.quantity}</td>
        <td style="padding:8px 0;border-bottom:1px solid #E2E0DC;font-size:13px;text-align:right;">${fmtCents(it.priceCents * it.quantity)}</td>
      </tr>`
    )
    .join("");
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:16px 0;">
    <thead><tr>
      <th style="padding:6px 0 8px;border-bottom:2px solid #1C1C1A;font-size:11px;text-align:left;color:#9D9C97;text-transform:uppercase;letter-spacing:0.05em;">Item</th>
      <th style="padding:6px 12px 8px;border-bottom:2px solid #1C1C1A;font-size:11px;text-align:center;color:#9D9C97;text-transform:uppercase;letter-spacing:0.05em;">Qty</th>
      <th style="padding:6px 0 8px;border-bottom:2px solid #1C1C1A;font-size:11px;text-align:right;color:#9D9C97;text-transform:uppercase;letter-spacing:0.05em;">Price</th>
    </tr></thead>
    <tbody>${rows}</tbody>
  </table>`;
}

function totalsTable(order: { itemsSubtotalCents: number; shippingAmountCents: number; taxAmountCents: number }): string {
  const total = order.itemsSubtotalCents + order.shippingAmountCents + order.taxAmountCents;
  return `<table width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 20px;">
    <tr><td style="font-size:12px;color:#9D9C97;padding:3px 0;">Subtotal</td><td style="font-size:12px;color:#9D9C97;text-align:right;">${fmtCents(order.itemsSubtotalCents)}</td></tr>
    <tr><td style="font-size:12px;color:#9D9C97;padding:3px 0;">Shipping</td><td style="font-size:12px;color:#9D9C97;text-align:right;">${fmtCents(order.shippingAmountCents)}</td></tr>
    <tr><td style="font-size:12px;color:#9D9C97;padding:3px 0;">Tax</td><td style="font-size:12px;color:#9D9C97;text-align:right;">${fmtCents(order.taxAmountCents)}</td></tr>
    <tr>
      <td style="font-size:15px;font-weight:700;color:#1C1C1A;padding:10px 0 3px;border-top:1px solid #E2E0DC;">Total</td>
      <td style="font-size:15px;font-weight:700;color:#1C1C1A;text-align:right;padding:10px 0 3px;border-top:1px solid #E2E0DC;">${fmtCents(total)}</td>
    </tr>
  </table>`;
}

async function send(to: string, subject: string, html: string) {
  if (!HAS_RESEND) {
    console.log("[email:dev]", { to, subject });
    return;
  }
  try {
    await resend!.emails.send({
      from: process.env.EMAIL_FROM!,
      to,
      subject,
      html,
      headers: {
        "List-Unsubscribe": `<${APP_URL}/unsubscribe>`,
        "List-Unsubscribe-Post": "List-Unsubscribe=One-Click",
      },
    });
  } catch (err) {
    console.error("[email] send failed:", err);
  }
}

// ─── Transactional emails ────────────────────────────────────────────────────

export async function sendOrderConfirmedBuyer(opts: {
  order: {
    id: string;
    itemsSubtotalCents: number;
    shippingAmountCents: number;
    taxAmountCents: number;
    estimatedDeliveryDate?: Date | null;
    shipToLine1?: string | null;
    shipToCity?: string | null;
    shipToState?: string | null;
    shipToPostalCode?: string | null;
  };
  buyer: { name?: string | null; email: string };
  seller: { displayName?: string | null };
  items: { title: string; quantity: number; priceCents: number }[];
}) {
  const { order, buyer, seller, items } = opts;
  const name = buyer.name || "there";
  const sellerName = seller.displayName || "your maker";
  const orderUrl = `${APP_URL}/dashboard/orders/${order.id}`;

  const address = [order.shipToLine1, order.shipToCity, order.shipToState, order.shipToPostalCode]
    .filter(Boolean)
    .join(", ");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your order from <strong>${esc(sellerName)}</strong> is being prepared.</p>
    ${itemTable(items)}
    ${totalsTable(order)}
    ${address ? `<p style="font-size:13px;color:#6B6A66;margin:0 0 8px;"><strong>Shipping to:</strong> ${esc(address)}</p>` : ""}
    ${order.estimatedDeliveryDate ? `<p style="font-size:13px;color:#6B6A66;margin:0 0 16px;"><strong>Estimated delivery:</strong> ${fmtDate(order.estimatedDeliveryDate)}</p>` : ""}
    ${btn("View your order", orderUrl)}
  `;

  await send(buyer.email, "Your order is confirmed! 🪵", baseTemplate("Order Confirmed", body));
}

export async function sendOrderConfirmedSeller(opts: {
  order: {
    id: string;
    itemsSubtotalCents: number;
    shippingAmountCents: number;
    taxAmountCents: number;
    processingDeadline?: Date | null;
  };
  buyer: { name?: string | null };
  seller: { displayName?: string | null; email: string };
  items: { title: string; quantity: number; priceCents: number }[];
}) {
  const { order, buyer, seller, items } = opts;
  const buyerName = buyer.name || "A buyer";
  const sellerName = seller.displayName || "there";
  const orderUrl = `${APP_URL}/dashboard/sales/${order.id}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(sellerName)}, <strong>${esc(buyerName)}</strong> just purchased from your shop!</p>
    ${itemTable(items)}
    ${totalsTable(order)}
    ${order.processingDeadline ? `<p style="font-size:13px;color:#6B6A66;margin:8px 0 16px;"><strong>Ship by:</strong> ${fmtDate(order.processingDeadline)}</p>` : ""}
    ${btn("View order details", orderUrl)}
  `;

  await send(seller.email, "Congrats! You made a sale! 🎉", baseTemplate("New Sale!", body));
}

export async function sendOrderShipped(opts: {
  order: { id: string; estimatedDeliveryDate?: Date | null };
  buyer: { name?: string | null; email: string };
  carrier?: string | null;
  trackingNumber?: string | null;
}) {
  const { order, buyer, carrier, trackingNumber } = opts;
  const name = buyer.name || "there";
  const orderUrl = `${APP_URL}/dashboard/orders/${order.id}`;

  const trackingSection =
    trackingNumber
      ? `<p style="font-size:14px;margin:16px 0 8px;"><strong>Carrier:</strong> ${esc(carrier || "—")}</p>
         <p style="font-size:14px;margin:0 0 8px;"><strong>Tracking number:</strong> ${esc(trackingNumber)}</p>
         ${btn("Track your package", trackingUrl(carrier, trackingNumber))}`
      : "";

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your order has been shipped!</p>
    ${trackingSection}
    ${order.estimatedDeliveryDate ? `<p style="font-size:13px;color:#6B6A66;margin:16px 0 8px;"><strong>Estimated delivery:</strong> ${fmtDate(order.estimatedDeliveryDate)}</p>` : ""}
    ${btn("View order", orderUrl)}
  `;

  await send(buyer.email, "Your piece is on its way! 🚚", baseTemplate("Your order has shipped", body));
}

export async function sendReadyForPickup(opts: {
  order: { id: string };
  buyer: { name?: string | null; email: string };
  seller: { displayName?: string | null };
}) {
  const { order, buyer, seller } = opts;
  const name = buyer.name || "there";
  const sellerName = seller.displayName || "your maker";
  const orderUrl = `${APP_URL}/dashboard/orders/${order.id}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your order from <strong>${esc(sellerName)}</strong> is ready to be picked up!</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 16px;">Check the order details for pickup location and coordination.</p>
    ${btn("View order details", orderUrl)}
  `;

  await send(buyer.email, "Your order is ready for pickup!", baseTemplate("Ready for Pickup", body));
}

export async function sendOrderDelivered(opts: {
  order: { id: string };
  buyer: { name?: string | null; email: string };
}) {
  const { order, buyer } = opts;
  const name = buyer.name || "there";
  const orderUrl = `${APP_URL}/dashboard/orders/${order.id}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your order has been delivered!</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 20px;">We hope you love your new piece. If you have a moment, leaving a review helps support the maker and other buyers.</p>
    ${btn("View order & leave a review", orderUrl)}
  `;

  await send(buyer.email, "Your piece has been delivered! 🎉", baseTemplate("Order Delivered", body));
}

export async function sendCaseOpened(opts: {
  orderId: string;
  seller: { name?: string | null; email: string };
  buyer: { name?: string | null };
  caseDescription: string;
}) {
  const { orderId, seller, buyer, caseDescription } = opts;
  const sellerName = seller.name || "there";
  const buyerName = buyer.name || "A buyer";
  const orderUrl = `${APP_URL}/dashboard/sales/${orderId}`;
  const snippet = caseDescription.slice(0, 150) + (caseDescription.length > 150 ? "…" : "");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(sellerName)}, <strong>${esc(buyerName)}</strong> has opened a case regarding their order.</p>
    <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #E2E0DC;background:#F5F4F0;font-size:13px;color:#6B6A66;">${esc(snippet)}</blockquote>
    <p style="font-size:13px;color:#9D9C97;margin:0 0 16px;">You have 48 hours to respond before this is escalated to Grainline staff.</p>
    ${btn("Respond to case", orderUrl)}
  `;

  await send(seller.email, "A buyer opened a case on your order", baseTemplate("Case Opened", body));
}

export async function sendCaseMessage(opts: {
  recipientName?: string | null;
  recipientEmail: string;
  senderName?: string | null;
  caseLink: string;
  messageSnippet: string;
}) {
  const { recipientName, recipientEmail, senderName, caseLink, messageSnippet } = opts;
  const name = recipientName || "there";
  const sender = senderName || "Someone";
  const snippet = messageSnippet.slice(0, 150) + (messageSnippet.length > 150 ? "…" : "");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, <strong>${esc(sender)}</strong> sent a message in your case.</p>
    <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #E2E0DC;background:#F5F4F0;font-size:13px;color:#6B6A66;">${esc(snippet)}</blockquote>
    ${btn("View conversation", caseLink)}
  `;

  await send(recipientEmail, `${safeSubject(sender)} sent a message in your case`, baseTemplate("New Case Message", body));
}

export async function sendCaseResolved(opts: {
  orderId: string;
  buyer: { name?: string | null; email: string };
  resolution: string;
  refundAmountCents?: number | null;
}) {
  const { orderId, buyer, resolution, refundAmountCents } = opts;
  const name = buyer.name || "there";
  const orderUrl = `${APP_URL}/dashboard/orders/${orderId}`;

  const resolutionLabel =
    resolution === "REFUND_FULL"
      ? "A full refund has been issued to your original payment method."
      : resolution === "REFUND_PARTIAL" && refundAmountCents
      ? `A partial refund of ${fmtCents(refundAmountCents)} has been issued to your original payment method.`
      : "The case has been reviewed and dismissed.";

  const refundNote =
    resolution !== "DISMISSED"
      ? `<p style="font-size:13px;color:#6B6A66;margin:0 0 16px;">Refunds typically appear within 5–10 business days.</p>`
      : "";

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your case has been resolved.</p>
    <p style="font-size:14px;line-height:1.6;margin:0 0 16px;">${esc(resolutionLabel)}</p>
    ${refundNote}
    ${btn("View order", orderUrl)}
  `;

  await send(buyer.email, "Your case has been resolved", baseTemplate("Case Resolved", body));
}

export async function sendCustomOrderRequest(opts: {
  seller: { displayName?: string | null; email: string };
  buyerName?: string | null;
  description: string;
  conversationId: string;
}) {
  const { seller, buyerName, description, conversationId } = opts;
  const sellerName = seller.displayName || "there";
  const buyer = buyerName || "A buyer";
  const convoUrl = `${APP_URL}/messages/${conversationId}`;
  const snippet = description.slice(0, 200) + (description.length > 200 ? "…" : "");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(sellerName)}, <strong>${esc(buyer)}</strong> wants a custom piece!</p>
    <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #E2E0DC;background:#F5F4F0;font-size:13px;color:#6B6A66;">${esc(snippet)}</blockquote>
    ${btn("View request", convoUrl)}
  `;

  await send(seller.email, `${safeSubject(buyer)} wants a custom piece!`, baseTemplate("New Custom Order Request", body));
}

export async function sendCustomOrderReady(opts: {
  buyer: { name?: string | null; email: string };
  sellerName?: string | null;
  listingTitle: string;
  priceCents: number;
  listingId: string;
}) {
  const { buyer, sellerName, listingTitle, priceCents, listingId } = opts;
  const name = buyer.name || "there";
  const seller = sellerName || "Your maker";
  const listingUrl = `${APP_URL}/listing/${listingId}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, <strong>${esc(seller)}</strong> has created your custom piece!</p>
    <p style="font-size:16px;font-weight:700;margin:0 0 4px;">${esc(listingTitle)}</p>
    <p style="font-size:18px;font-weight:700;color:#1C1C1A;margin:0 0 20px;">${fmtCents(priceCents)}</p>
    ${btn("Purchase your piece", listingUrl)}
  `;

  await send(buyer.email, "Your custom piece is ready to purchase!", baseTemplate("Your Custom Piece is Ready", body));
}

export async function sendBackInStock(opts: {
  buyer: { name?: string | null; email: string };
  listingTitle: string;
  listingId: string;
}) {
  const { buyer, listingTitle, listingId } = opts;
  const name = buyer.name || "there";
  const listingUrl = `${APP_URL}/listing/${listingId}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, good news — a piece you saved is back in stock!</p>
    <p style="font-size:16px;font-weight:700;margin:0 0 20px;">${esc(listingTitle)}</p>
    ${btn("Shop now", listingUrl)}
  `;

  await send(buyer.email, `${safeSubject(listingTitle)} is back in stock!`, baseTemplate("Back in Stock", body));
}

export async function sendVerificationApproved(opts: {
  seller: { displayName?: string | null; email: string };
  profileId: string;
}) {
  const { seller, profileId } = opts;
  const name = seller.displayName || "there";
  const profileUrl = `${APP_URL}/seller/${profileId}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Congratulations, ${esc(name)}! You are now a <strong>Verified Maker</strong> on Grainline.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 8px;">Your profile now displays the Verified Maker badge, letting buyers know your craft is authentic and recognized by our team.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 20px;">This badge builds trust with buyers and helps your work stand out in search results.</p>
    ${btn("View your profile", profileUrl)}
  `;

  await send(seller.email, "You are now a Verified Maker! ✓", baseTemplate("You're a Verified Maker!", body));
}

export async function sendVerificationRejected(opts: {
  seller: { displayName?: string | null; email: string };
  notes?: string | null;
}) {
  const { seller, notes } = opts;
  const name = seller.displayName || "there";
  const applyUrl = `${APP_URL}/dashboard/verification`;

  const notesSection = notes
    ? `<p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 16px;"><strong>Reviewer notes:</strong> ${esc(notes)}</p>`
    : "";

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, we've reviewed your Verified Maker application.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 16px;">Unfortunately we weren't able to approve your application at this time. You're welcome to update your application and reapply whenever you're ready.</p>
    ${notesSection}
    ${btn("Reapply", applyUrl)}
  `;

  await send(seller.email, "Update on your Verified Maker application", baseTemplate("Verification Update", body));
}

export async function sendRefundIssued(opts: {
  buyer: { name?: string | null; email: string };
  refundAmountCents: number;
  orderId: string;
}) {
  const { buyer, refundAmountCents, orderId } = opts;
  const name = buyer.name || "there";
  const orderUrl = `${APP_URL}/dashboard/orders/${orderId}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, a refund has been issued for your order.</p>
    <p style="font-size:28px;font-weight:700;color:#1C1C1A;margin:0 0 8px;">${fmtCents(refundAmountCents)}</p>
    <p style="font-size:13px;color:#6B6A66;margin:0 0 20px;">Refunds typically appear within 5–10 business days depending on your bank.</p>
    ${btn("View order", orderUrl)}
  `;

  await send(buyer.email, "Your refund has been issued", baseTemplate("Refund Issued", body));
}

// ─── Lifecycle emails ─────────────────────────────────────────────────────────

export async function sendWelcomeBuyer(opts: {
  user: { name?: string | null; email: string };
}) {
  const { user } = opts;
  const name = user.name || "there";
  const mapUrl = `${APP_URL}/map`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, welcome to Grainline!</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 20px;">We connect you with makers who craft one-of-a-kind woodworking pieces in your neighborhood.</p>
    <p style="font-size:14px;font-weight:600;margin:0 0 8px;">Three things to get started:</p>
    <ol style="font-size:14px;line-height:1.8;color:#6B6A66;margin:0 0 20px;padding-left:20px;">
      <li>Browse the map to find makers near you</li>
      <li>Heart pieces you love to save them</li>
      <li>Message a maker to ask about custom work</li>
    </ol>
    ${btn("Find makers near you", mapUrl)}
  `;

  await send(user.email, "Welcome to Grainline! 🪵", baseTemplate("Welcome to Grainline", body));
}

export async function sendWelcomeSeller(opts: {
  seller: { displayName?: string | null; email: string };
}) {
  const { seller } = opts;
  const name = seller.displayName || "there";
  const profileUrl = `${APP_URL}/dashboard/profile`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, welcome to Grainline — let's get your shop set up!</p>
    <p style="font-size:14px;font-weight:600;margin:0 0 8px;">Your quick-start checklist:</p>
    <ol style="font-size:14px;line-height:1.8;color:#6B6A66;margin:0 0 20px;padding-left:20px;">
      <li>Add a banner photo to your profile</li>
      <li>Write your story — buyers love knowing who made their piece</li>
      <li>List your first piece and start selling</li>
    </ol>
    ${btn("Complete your profile", profileUrl)}
  `;

  await send(seller.email, "Welcome to Grainline — let's set up your shop!", baseTemplate("Welcome, Maker!", body));
}

export async function sendFirstListingCongrats(opts: {
  seller: { displayName?: string | null; email: string };
  listing: { id: string; title: string; priceCents: number };
}) {
  const { seller, listing } = opts;
  const name = seller.displayName || "there";
  const listingUrl = `${APP_URL}/listing/${listing.id}`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your first piece is live on Grainline!</p>
    <p style="font-size:16px;font-weight:700;margin:0 0 4px;">${esc(listing.title)}</p>
    <p style="font-size:16px;color:#1C1C1A;margin:0 0 20px;">${fmtCents(listing.priceCents)}</p>
    <p style="font-size:14px;font-weight:600;margin:0 0 8px;">Tips for your first sale:</p>
    <ul style="font-size:14px;line-height:1.8;color:#6B6A66;margin:0 0 20px;padding-left:20px;">
      <li>Add more photos — listings with 4+ photos get more views</li>
      <li>Share it on social media to drive your first traffic</li>
      <li>Enable custom orders to open another sales channel</li>
    </ul>
    ${btn("View your listing", listingUrl)}
  `;

  await send(seller.email, "Your first piece is live on Grainline! 🎉", baseTemplate("You're Live!", body));
}

export async function sendFirstSaleCongrats(opts: {
  seller: { displayName?: string | null; email: string };
  order: { id: string; itemsSubtotalCents: number; shippingAmountCents: number; taxAmountCents: number };
}) {
  const { seller, order } = opts;
  const name = seller.displayName || "there";
  const orderUrl = `${APP_URL}/dashboard/sales/${order.id}`;
  const total = order.itemsSubtotalCents + order.shippingAmountCents + order.taxAmountCents;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, you made your first sale! 🎉</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 8px;">This is just the beginning. Every great shop starts with one happy customer.</p>
    <p style="font-size:26px;font-weight:700;color:#1C1C1A;margin:16px 0 20px;">${fmtCents(total)}</p>
    ${btn("View order details", orderUrl)}
  `;

  await send(seller.email, "You made your first sale! 🎉", baseTemplate("First Sale!", body));
}

// ─── Guild verification emails ────────────────────────────────────────────────

export async function sendGuildMasterWarningEmail(opts: {
  seller: { displayName?: string | null; email: string };
  failedCriteria: string[];
}) {
  const { seller, failedCriteria } = opts;
  const name = seller.displayName || "there";
  const dashUrl = `${APP_URL}/dashboard/verification`;

  const failedList = failedCriteria
    .map((c) => `<li style="margin-bottom:4px;">${esc(c)}</li>`)
    .join("");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your Guild Master metrics have fallen below our required standards.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 8px;"><strong>Criteria not currently met:</strong></p>
    <ul style="font-size:14px;line-height:1.8;color:#6B6A66;margin:0 0 20px;padding-left:20px;">${failedList}</ul>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 20px;">You have until next month's review to bring your metrics back up. If they remain below standard for a second consecutive month, your Guild Master badge will be revoked (your Guild Member badge will remain active).</p>
    ${btn("Check your metrics", dashUrl)}
  `;

  await send(
    seller.email,
    "Your Guild Master status is at risk — Grainline",
    baseTemplate("Guild Master Status at Risk", body)
  );
}

export async function sendGuildMasterRevokedEmail(opts: {
  seller: { displayName?: string | null; email: string };
}) {
  const { seller } = opts;
  const name = seller.displayName || "there";
  const dashUrl = `${APP_URL}/dashboard/verification`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your Guild Master badge has been revoked.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 16px;">Your metrics fell below Guild Master requirements for two consecutive monthly reviews. Your <strong>Guild Member badge remains active</strong> — you can reapply for Guild Master once your metrics are back above the required thresholds.</p>
    ${btn("View your verification status", dashUrl)}
  `;

  await send(
    seller.email,
    "Guild Master badge update — Grainline",
    baseTemplate("Guild Master Badge Revoked", body)
  );
}

export async function sendGuildMemberRevokedEmail(opts: {
  seller: { displayName?: string | null; email: string };
  reason: string;
}) {
  const { seller, reason } = opts;
  const name = seller.displayName || "there";
  const dashUrl = `${APP_URL}/dashboard/verification`;

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, your Guild Member badge has been revoked.</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 16px;"><strong>Reason:</strong> ${esc(reason)}</p>
    <p style="font-size:14px;line-height:1.6;color:#6B6A66;margin:0 0 20px;">You may reapply for the Guild Member badge once the issue has been resolved.</p>
    ${btn("View verification requirements", dashUrl)}
  `;

  await send(
    seller.email,
    "Guild Member badge update — Grainline",
    baseTemplate("Guild Member Badge Revoked", body)
  );
}

// ─── Following ────────────────────────────────────────────────────────────────

export async function sendNewListingFromFollowedMakerEmail(opts: {
  to: string;
  makerName: string;
  listingTitle: string;
  listingPrice: string;
  listingUrl: string;
  listingImageUrl?: string;
}) {
  const { to, makerName, listingTitle, listingPrice, listingUrl, listingImageUrl } = opts;

  const validImgUrl = safeImgUrl(listingImageUrl);
  const imageSection = validImgUrl
    ? `<p style="margin:0 0 16px;"><img src="${validImgUrl}" alt="${esc(listingTitle)}" style="max-width:100%;max-height:240px;display:block;" /></p>`
    : "";

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">${esc(makerName)} just posted a new piece on Grainline.</p>
    ${imageSection}
    <p style="font-size:17px;font-weight:600;color:#1C1C1A;margin:0 0 4px;">${esc(listingTitle)}</p>
    <p style="font-size:15px;color:#6B6A66;margin:0 0 20px;">${esc(listingPrice)}</p>
    ${btn("View Listing", listingUrl)}
  `;

  await send(to, `${safeSubject(makerName)} just posted a new listing on Grainline`, baseTemplate("New Listing", body));
}

export async function sendNewMessageEmail(opts: {
  recipientEmail: string;
  recipientName: string;
  senderName: string;
  messagePreview: string;
  conversationUrl: string;
}) {
  const { recipientEmail, recipientName, senderName, messagePreview, conversationUrl } = opts;
  const name = recipientName || "there";
  const sender = senderName || "Someone";
  const preview = messagePreview.slice(0, 200) + (messagePreview.length > 200 ? "…" : "");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, <strong>${esc(sender)}</strong> sent you a message:</p>
    <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #E2E0DC;background:#F5F4F0;font-size:13px;color:#6B6A66;font-style:italic;">${esc(preview)}</blockquote>
    ${btn("View Conversation", conversationUrl)}
  `;

  await send(recipientEmail, `New message from ${safeSubject(sender)} on Grainline`, baseTemplate("New Message", body));
}

export async function sendNewReviewEmail(opts: {
  sellerEmail: string;
  sellerName: string;
  buyerName: string;
  listingTitle: string;
  rating: number;
  reviewPreview: string;
  reviewUrl: string;
}) {
  const { sellerEmail, sellerName, buyerName, listingTitle, rating, reviewPreview, reviewUrl } = opts;
  const name = sellerName || "there";
  const buyer = buyerName || "A buyer";
  const ratingDisplay = Number.isInteger(rating) ? `${rating}` : rating.toFixed(1);
  const preview = reviewPreview.slice(0, 200) + (reviewPreview.length > 200 ? "…" : "");

  const body = `
    <p style="font-size:15px;line-height:1.6;margin:0 0 16px;">Hi ${esc(name)}, <strong>${esc(buyer)}</strong> left a review on <strong>${esc(listingTitle)}</strong>:</p>
    <p style="font-size:18px;font-weight:600;margin:0 0 8px;">${esc(ratingDisplay)} out of 5 stars</p>
    <blockquote style="margin:0 0 16px;padding:12px 16px;border-left:3px solid #E2E0DC;background:#F5F4F0;font-size:13px;color:#6B6A66;font-style:italic;">${esc(preview)}</blockquote>
    ${btn("View Review", reviewUrl)}
  `;

  await send(sellerEmail, `New ${ratingDisplay}-star review from ${safeSubject(buyer)} on Grainline`, baseTemplate("New Review", body));
}
