export const STRIPE_CONNECT_V2_API_VERSION = "2026-02-25.clover";
export const STRIPE_CONNECT_ACCOUNT_VERSION = "v2";
export const STRIPE_CONNECT_CONTROLLER_SUMMARY =
  "dashboard:express|fees:application|losses:application|requirements:stripe";

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
