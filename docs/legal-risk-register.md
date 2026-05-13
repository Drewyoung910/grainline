# Grainline Legal And Compliance Risk Register

Last updated: 2026-05-13

This document is not legal advice. It is a product/legal issue tracker to help prepare focused questions for counsel and to connect legal decisions to code behavior.

Legal requirements change and depend on jurisdiction, business model, transaction volume, seller location, buyer location, and vendor configuration. Before relying on any item here, verify with counsel and current primary sources.

## How To Use This Register

For each issue, track:

- Risk area.
- Product behavior affected.
- Current implementation evidence.
- Open legal question.
- Mitigation owner.
- Launch status: `BLOCKER`, `PRE-LAUNCH`, `POST-LAUNCH`, or `ACCEPTED`.
- Counsel decision/date.

## Current Risk Areas

### Terms, Privacy, Clickwrap, And Age

- Product behavior: signup, OAuth, `/accept-terms`, durable `User` terms/age fields, Terms/Privacy pages.
- Current technical mitigation: server-side terms acceptance and age attestation enforced through middleware.
- Legal questions: final wording, versioning cadence, enforceability of clickwrap presentation, age attestation sufficiency.
- Status: attorney sign-off required before removing DRAFT banners.

### Marketplace Payments And Money Transmission

- Product behavior: Stripe Checkout, Stripe Connect, platform fee, seller transfers, refunds, disputes, tax handling.
- Current technical mitigation: Stripe Connect marketplace model, destination-charge accounting, explicit refund/transfer reversal helpers.
- Legal questions: agent-of-payee/money-transmitter position, refund liability, negative balance responsibility, dispute handling.
- Status: counsel/accounting review required.

### Sales Tax And Marketplace Facilitator Duties

- Product behavior: tax collection, tax retention, seller payouts, receipts, reports.
- Current technical mitigation: tax is handled separately from seller transfer math.
- Legal questions: filing calendar, Texas and other-state thresholds, seller-facing disclosure, exemption/certificate handling.
- Status: accountant/counsel review required.

### Seller Identity, Business Disclosures, And INFORM

- Product behavior: seller onboarding, seller profile, receipts, public listing/shop disclosures, admin verification.
- Current technical mitigation: seller profiles, Stripe onboarding, guild verification, admin tools.
- Legal questions: whether business registration numbers, tax certificates, high-volume seller identity disclosures, contact details, or third-party identity verification must be required or optionally displayed. INFORM Consumers Act thresholds and disclosure rules need counsel review against Grainline's seller volumes and marketplace model.
- Status: product/legal decision open.

### Consumer Protection, Returns, Shipping, And Fulfillment

- Product behavior: listing pages, made-to-order timelines, order timeline, shipping labels, returns/refunds, case system.
- Current technical mitigation: order cases, refund routes, estimated delivery fields, seller policies, support paths.
- Legal questions: required shipping/return disclosures, late shipment handling, custom/made-to-order cancellation language, damaged/not-as-described workflows, and whether Grainline should offer a platform-funded buyer protection program similar to larger marketplaces.
- Status: counsel review recommended.

### Privacy, Data Rights, And Retention

- Product behavior: account export, account deletion, legal data request form, order PII retention, audit logs, Sentry.
- Current technical mitigation: export route, deletion/anonymization flow, support/legal request records, 45-day SLA helper, retention cron.
- Legal questions: state privacy law scope, retention periods, deletion exceptions, audit-log retention, processor/vendor disclosure.
- Status: counsel review required.

### User-Generated Content, Reviews, IP, And DMCA

- Product behavior: listings, photos, reviews, blog posts, messages, custom order text, reporting, admin moderation.
- Current technical mitigation: content moderation, report routes, admin review surfaces, AI review, first-party upload validation.
- Legal questions: DMCA agent/process, repeat infringer policy, review moderation policy, user content license terms.
- Status: counsel review recommended.

### Accessibility

- Product behavior: public marketplace pages, checkout-adjacent flows, account/dashboard/admin pages.
- Current technical mitigation: accessibility page exists; a11y has been partially audited.
- Legal questions: WCAG target level, remediation priority, ongoing monitoring.
- Status: pre-launch audit recommended.

### Email, SMS, And Marketing Consent

- Product behavior: transactional emails, broadcast emails, newsletters, unsubscribe, notification preferences.
- Current technical mitigation: unsubscribe tokens, suppression handling, notification preferences, outbox.
- Legal questions: CAN-SPAM wording, marketing consent boundaries, seller broadcast limits.
- Status: review recommended.

### Geographic Scope And Sanctions

- Product behavior: US-only geo block, Terms language, shipping/address flows.
- Current technical mitigation: middleware uses Vercel country header where available and Terms position the service as US-only.
- Legal questions: whether US-only controls are sufficient, sanctions/export screening requirements.
- Status: counsel review recommended.

### Insurance And Business Operations

- Product behavior: not code-specific, but affects launch readiness and support workflows.
- Legal questions: general liability, product liability, cyber liability, marketplace insurance, seller requirements.
- Status: business decision open.

### Security Disclosure, Vulnerability Reports, And Incident Notice

- Product behavior: `/security`, `/.well-known/security.txt`, security mailbox, incident runbook, user notification, regulator notification.
- Current technical mitigation: security hardening plan and audit log exist; no public vulnerability disclosure channel is confirmed yet.
- Legal questions: safe-harbor language for vulnerability reporters, triage SLA wording, disclosure boundaries, breach-notification obligations by state, and whether cyber-insurance carrier notice is required for suspected incidents.
- Status: pre-launch policy decision recommended.

## Attorney Question Backlog

1. Are the current Terms/Privacy pages ready to remove DRAFT banners?
2. Is the Stripe Connect model sufficient for marketplace payment compliance?
3. What seller identity/business information must be collected or displayed at launch?
4. What sales-tax filing and reporting obligations apply before the first live transaction?
5. What retention periods should apply to users, orders, messages, cases, audit logs, and support requests?
6. What return/cancellation/dispute policy language is required for made-to-order woodworking?
7. Is the current user-content/review/reporting system sufficient for DMCA and moderation obligations?
8. What accessibility standard should Grainline commit to publicly?
9. Should Grainline publish a vulnerability disclosure policy and security.txt contact before launch?
10. Should Grainline offer platform-funded buyer protection, and if so what dollar cap, eligibility rules, and seller recoupment terms apply?
