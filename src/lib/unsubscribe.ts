import { prisma } from "@/lib/db";
import {
  emailSuppressionAddressKeys,
} from "@/lib/emailSuppression";
import {
  applyEmailUnsubscribe,
  newsletterTokenSuperseded,
} from "@/lib/emailServiceAccess";
import {
  VALID_EMAIL_PREFERENCE_KEYS,
} from "@/lib/notificationPreferenceKeys";
import { isOptionalEmailPreferenceKey } from "@/lib/emailPreferencePolicy";
import { normalizeUnsubscribeEmail } from "@/lib/unsubscribeToken";
import {
  disableUserSignedUnsubscribeEmailPreferences,
  userSignedUnsubscribeTokenSuperseded,
} from "@/lib/userSignedUnsubscribeAccess";

export {
  buildUnsubscribeUrl,
  createUnsubscribeToken,
  normalizeUnsubscribeEmail,
  verifyUnsubscribeToken,
} from "@/lib/unsubscribeToken";

const EMAIL_PREFS_TO_DISABLE = VALID_EMAIL_PREFERENCE_KEYS.filter(
  isOptionalEmailPreferenceKey,
);
export async function unsubscribeTokenSuperseded(
  email: string,
  issuedAtValue: string | number | null,
): Promise<boolean> {
  const normalized = normalizeUnsubscribeEmail(email);
  const issuedAt =
    typeof issuedAtValue === "number" ? issuedAtValue : Number(issuedAtValue);
  if (!normalized || !Number.isSafeInteger(issuedAt) || issuedAt <= 0)
    return true;

  const suppressionEmailKeys = emailSuppressionAddressKeys(normalized);
  const emails =
    suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [normalized];
  if (await userSignedUnsubscribeTokenSuperseded(prisma, {
    suppressionKeys: emails,
    issuedAt: new Date(issuedAt),
  })) return true;

  const [newerCurrentEmailClaim] = await prisma.$queryRaw<{ superseded: boolean }[]>`
    SELECT public.grainline_user_email_address_newer_current_claim(
      ${suppressionEmailKeys}::text[],
      ${new Date(issuedAt)}::timestamp
    ) AS "superseded"
  `;
  if (typeof newerCurrentEmailClaim?.superseded !== "boolean") return true;
  if (newerCurrentEmailClaim.superseded) return true;

  return newsletterTokenSuperseded(prisma, {
    email: normalized,
    issuedAt: new Date(issuedAt),
  });
}

export async function unsubscribeEmail(
  email: string,
): Promise<{ ok: boolean; userUpdated: boolean; newsletterUpdated: number }> {
  const normalized = normalizeUnsubscribeEmail(email);
  if (!normalized)
    return { ok: false, userUpdated: false, newsletterUpdated: 0 };
  const suppressionEmailKeys = emailSuppressionAddressKeys(normalized);
  const emails =
    suppressionEmailKeys.length > 0 ? suppressionEmailKeys : [normalized];
  let userUpdated = false;
  let newsletterUpdated = 0;

  await prisma.$transaction(async (tx) => {
    // Acquire the shared address fence before any unsubscribe mutation. The
    // transaction holds it through newsletter and suppression updates.
    const usersUpdated = await disableUserSignedUnsubscribeEmailPreferences(
      tx,
      emails,
    );
    userUpdated = usersUpdated > 0;

    newsletterUpdated = await applyEmailUnsubscribe(tx, {
      email: normalized,
      disabledPreferences: EMAIL_PREFS_TO_DISABLE,
    });
  });

  return { ok: true, userUpdated, newsletterUpdated };
}
