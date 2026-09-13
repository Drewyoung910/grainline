import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { ensureUserByClerkId } from "@/lib/ensureUser";
import { accountAccessErrorResponse } from "@/lib/apiAccountAccess";
import { shippingAddressRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { sanitizeAddressField, sanitizeAddressName, sanitizeOptionalAddressField } from "@/lib/addressFields";
import { privateJson, privateResponse } from "@/lib/privateResponse";
import {
  isInvalidJsonBodyError,
  isRequestBodyTooLargeError,
  readBoundedJson,
} from "@/lib/requestBody";
import { HTTP_STATUS } from "@/lib/httpStatus";
import { z } from "zod";

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
]);

const RawAddressSchema = z.object({
  name: z.string().max(100),
  line1: z.string().max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().max(100),
  state: z.string().max(50),
  postalCode: z.string().max(20),
  phone: z.string().max(20).optional().nullable(),
});
const AddressSchema = z.object({
  name: z.string().min(1).max(100),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).nullable(),
  city: z.string().min(1).max(100),
  state: z.string().length(2).refine(s => US_STATE_CODES.has(s), { message: "Invalid US state code" }),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  phone: z.string().max(20).nullable(),
});
const SHIPPING_ADDRESS_BODY_MAX_BYTES = 24 * 1024;

function normalizeShippingAddressInput(raw: z.infer<typeof RawAddressSchema>) {
  return {
    name: sanitizeAddressName(raw.name),
    line1: sanitizeAddressField(raw.line1, 200),
    line2: sanitizeOptionalAddressField(raw.line2, 200),
    city: sanitizeAddressField(raw.city, 100),
    state: sanitizeAddressField(raw.state, 2).toUpperCase(),
    postalCode: sanitizeAddressField(raw.postalCode, 20),
    phone: sanitizeOptionalAddressField(raw.phone, 20),
  };
}

export async function GET() {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success, reset } = await safeRateLimit(shippingAddressRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many requests."));

  const me = await prisma.user.findUnique({
    where: { id: user.id },
    select: {
      shippingName: true,
      shippingLine1: true,
      shippingLine2: true,
      shippingCity: true,
      shippingState: true,
      shippingPostalCode: true,
      shippingPhone: true,
    },
  });
  if (!me) return privateJson({ error: "User not found" }, { status: HTTP_STATUS.NOT_FOUND });

  return privateJson({
    name: me.shippingName ?? null,
    line1: me.shippingLine1 ?? null,
    line2: me.shippingLine2 ?? null,
    city: me.shippingCity ?? null,
    state: me.shippingState?.toUpperCase() ?? null,
    postalCode: me.shippingPostalCode ?? null,
    phone: me.shippingPhone ?? null,
  });
}

export async function PUT(req: Request) {
  const { userId } = await auth();
  if (!userId) return privateJson({ error: "Unauthorized" }, { status: HTTP_STATUS.UNAUTHORIZED });
  let user: Awaited<ReturnType<typeof ensureUserByClerkId>>;
  try {
    user = await ensureUserByClerkId(userId);
  } catch (err) {
    const accountResponse = accountAccessErrorResponse(err);
    if (accountResponse) return accountResponse;
    throw err;
  }

  const { success, reset } = await safeRateLimit(shippingAddressRatelimit, userId);
  if (!success) return privateResponse(rateLimitResponse(reset, "Too many requests."));

  let body;
  try {
    body = AddressSchema.parse(normalizeShippingAddressInput(
      RawAddressSchema.parse(await readBoundedJson(req, SHIPPING_ADDRESS_BODY_MAX_BYTES)),
    ));
  } catch (e) {
    if (isRequestBodyTooLargeError(e)) {
      return privateJson({ error: "Request body too large" }, { status: HTTP_STATUS.PAYLOAD_TOO_LARGE });
    }
    if (isInvalidJsonBodyError(e)) {
      return privateJson({ error: "Invalid JSON" }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    if (e instanceof z.ZodError) {
      return privateJson({ error: "Invalid input", details: e.issues }, { status: HTTP_STATUS.BAD_REQUEST });
    }
    throw e;
  }

  await prisma.user.update({
    where: { id: user.id },
    data: {
      shippingName: body.name,
      shippingLine1: body.line1,
      shippingLine2: body.line2,
      shippingCity: body.city,
      shippingState: body.state,
      shippingPostalCode: body.postalCode,
      shippingPhone: body.phone,
    },
  });

  return privateJson({ ok: true });
}
