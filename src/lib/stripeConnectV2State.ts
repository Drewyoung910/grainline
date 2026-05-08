export const STRIPE_CONNECT_V2_API_VERSION = "2026-02-25.clover";
export const STRIPE_CONNECT_ACCOUNT_VERSION = "v2";
export const STRIPE_CONNECT_CONTROLLER_SUMMARY =
  "dashboard:express|fees:application|losses:application|requirements:stripe";
export const STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX = "v2.core.account";

export function isSupportedStripeConnectAccountVersion(version: string | null | undefined) {
  return version == null || version === STRIPE_CONNECT_ACCOUNT_VERSION;
}

export type StripeConnectV2AccountCreateParams = {
  contact_email?: string;
  identity: {
    country: string;
  };
  dashboard: "express";
  defaults: {
    responsibilities: {
      fees_collector: "application";
      losses_collector: "application";
    };
  };
  configuration: {
    merchant: {
      capabilities: {
        card_payments: {
          requested: true;
        };
      };
    };
    recipient: {
      capabilities: {
        stripe_balance: {
          stripe_transfers: {
            requested: true;
          };
        };
      };
    };
  };
};

export type StripeConnectV2Account = {
  id: string;
  object?: "v2.core.account";
  dashboard?: string;
};

export type StripeConnectV2AccountNotification = {
  related_object?: {
    id?: unknown;
    type?: unknown;
  } | null;
};

function normalizedStripeCountry(country: string | null | undefined) {
  const normalized = country?.trim().toUpperCase();
  return normalized && /^[A-Z]{2}$/.test(normalized) ? normalized : "US";
}

export function buildStripeConnectV2AccountCreateParams({
  email,
  country,
}: {
  email?: string | null;
  country?: string | null;
}): StripeConnectV2AccountCreateParams {
  const params: StripeConnectV2AccountCreateParams = {
    identity: {
      country: normalizedStripeCountry(country),
    },
    dashboard: "express",
    defaults: {
      responsibilities: {
        fees_collector: "application",
        losses_collector: "application",
      },
    },
    configuration: {
      merchant: {
        capabilities: {
          card_payments: {
            requested: true,
          },
        },
      },
      recipient: {
        capabilities: {
          stripe_balance: {
            stripe_transfers: {
              requested: true,
            },
          },
        },
      },
    },
  };

  const contactEmail = email?.trim();
  if (contactEmail) params.contact_email = contactEmail;
  return params;
}

export function stripeWebhookCreatedSeconds(created: number | string | null | undefined) {
  if (typeof created === "number" && Number.isFinite(created)) return created;
  if (typeof created !== "string") return undefined;
  const createdMillis = Date.parse(created);
  return Number.isFinite(createdMillis) ? Math.floor(createdMillis / 1000) : undefined;
}

export function stripeConnectV2AccountIdFromNotification(notification: StripeConnectV2AccountNotification) {
  const related = notification.related_object;
  if (related?.type !== "v2.core.account" || typeof related.id !== "string") return null;
  return related.id;
}

export function isStripeConnectV2AccountEvent(type: string) {
  return type === STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX ||
    type.startsWith(`${STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX}.`) ||
    type.startsWith(`${STRIPE_CONNECT_V2_ACCOUNT_EVENT_PREFIX}[`);
}
