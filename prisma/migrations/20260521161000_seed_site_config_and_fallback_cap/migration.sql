-- SiteConfig is a singleton. Ensure the default fallback-shipping row exists so
-- runtime fallback lookups do not depend on a manual admin seed.
INSERT INTO "SiteConfig" ("id", "fallbackShippingCents")
VALUES (1, 1500)
ON CONFLICT ("id") DO NOTHING;
