import type Stripe from "stripe";
import { stripe } from "@/lib/stripe";
import {
  buildStripeConnectV2AccountCreateParams,
  STRIPE_CONNECT_V2_API_VERSION,
  type StripeConnectV2Account,
} from "@/lib/stripeConnectV2State";

export {
  buildStripeConnectV2AccountCreateParams,
  STRIPE_CONNECT_ACCOUNT_VERSION,
  STRIPE_CONNECT_CONTROLLER_SUMMARY,
  STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX,
  STRIPE_CONNECT_V2_API_VERSION,
  isStripeConnectV2AccountEvent,
  isSupportedStripeConnectAccountVersion,
  stripeConnectV2AccountIdFromNotification,
  stripeWebhookCreatedSeconds,
  type StripeConnectV2AccountNotification,
} from "@/lib/stripeConnectV2State";

export async function createStripeConnectV2Account({
  email,
  country,
  idempotencyKey,
}: {
  email?: string | null;
  country?: string | null;
  idempotencyKey: string;
}) {
  return stripe.rawRequest(
    "POST",
    "/v2/core/accounts",
    buildStripeConnectV2AccountCreateParams({ email, country }) as unknown as Record<string, unknown>,
    {
      apiVersion: STRIPE_CONNECT_V2_API_VERSION,
      idempotencyKey,
    },
  ) as Promise<Stripe.Response<StripeConnectV2Account>>;
}
