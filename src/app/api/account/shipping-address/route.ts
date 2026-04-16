import { NextResponse } from "next/server";
import { auth } from "@clerk/nextjs/server";
import { prisma } from "@/lib/db";
import { shippingAddressRatelimit, safeRateLimit, rateLimitResponse } from "@/lib/ratelimit";
import { sanitizeText } from "@/lib/sanitize";
import { z } from "zod";

const US_STATE_CODES = new Set([
  "AL","AK","AZ","AR","CA","CO","CT","DE","FL","GA",
  "HI","ID","IL","IN","IA","KS","KY","LA","ME","MD",
  "MA","MI","MN","MS","MO","MT","NE","NV","NH","NJ",
  "NM","NY","NC","ND","OH","OK","OR","PA","RI","SC",
  "SD","TN","TX","UT","VT","VA","WA","WV","WI","WY"
]);

const AddressSchema = z.object({
  name: z.string().min(1).max(100),
  line1: z.string().min(1).max(200),
  line2: z.string().max(200).optional().nullable(),
  city: z.string().min(1).max(100),
  state: z.string().length(2).refine(s => US_STATE_CODES.has(s.toUpperCase()), { message: "Invalid US state code" }),
  postalCode: z.string().regex(/^\d{5}(-\d{4})?$/),
  phone: z.string().max(20).optional().nullable(),
});

export async function GET() {
  const { userId } = await auth();
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const me = await prisma.user.findUnique({
    where: { clerkId: userId },
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
  if (!me) return NextResponse.json({ error: "User not found" }, { status: 404 });

  const { success, reset } = await safeRateLimit(shippingAddressRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many requests.");

  return NextResponse.json({
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
  if (!userId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { success, reset } = await safeRateLimit(shippingAddressRatelimit, userId);
  if (!success) return rateLimitResponse(reset, "Too many requests.");

  let body;
  try {
    body = AddressSchema.parse(await req.json());
  } catch (e) {
    if (e instanceof z.ZodError) {
      return NextResponse.json({ error: "Invalid input", details: e.issues }, { status: 400 });
    }
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  await prisma.user.update({
    where: { clerkId: userId },
    data: {
      shippingName: sanitizeText(body.name),
      shippingLine1: sanitizeText(body.line1),
      shippingLine2: body.line2 ? sanitizeText(body.line2) : null,
      shippingCity: sanitizeText(body.city),
      shippingState: body.state.toUpperCase(),
      shippingPostalCode: body.postalCode,
      shippingPhone: body.phone ? sanitizeText(body.phone) : null,
    },
  });

  return NextResponse.json({ ok: true });
}
