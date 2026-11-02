import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const migration = readFileSync(
  "prisma/migrations/20261102050000_prepare_listing_domain_authorities/migration.sql",
  "utf8",
);
const access = readFileSync("src/lib/sellerProfileStaffAccess.ts", "utf8");
const audit = readFileSync("src/lib/audit.ts", "utf8");
const undoStart = migration.indexOf(
  "CREATE FUNCTION public.grainline_seller_staff_listing_undo_transition(",
);
const undoEnd = migration.indexOf(
  "$grainline_seller_staff_listing_undo_transition$;",
  undoStart,
);
const undoAuthority = undoStart >= 0 && undoEnd >= 0
  ? migration.slice(
      undoStart,
      undoEnd + "$grainline_seller_staff_listing_undo_transition$;".length,
    )
  : "";

test("listing undo is one protected staff transition with durable audit evidence", () => {
  assert.match(
    undoAuthority,
    /CREATE FUNCTION public\.grainline_seller_staff_listing_undo_transition\(\s*p_actor_id text,\s*p_log_id text,\s*p_reason text/u,
  );
  assert.match(undoAuthority, /SESSION_USER <> 'grainline_staff_read_runtime'/u);
  assert.match(
    undoAuthority,
    /FROM public\."AdminAuditLog" AS source_audit_row[\s\S]*FOR UPDATE/u,
  );
  assert.match(
    undoAuthority,
    /FROM public\."Listing" AS listing[\s\S]*FOR UPDATE/u,
  );
  assert.match(
    undoAuthority,
    /UPDATE public\."Listing"[\s\S]*UPDATE public\."AdminAuditLog"[\s\S]*INSERT INTO public\."AdminAuditLog"/u,
  );
  assert.match(
    migration,
    /GRANT EXECUTE ON FUNCTION public\.grainline_seller_staff_listing_undo_transition\(\s*text,text,text\s*\) TO grainline_staff_read_runtime/u,
  );
});

test("listing undo no longer mutates Listing through ordinary runtime Prisma", () => {
  assert.match(access, /sellerProfileStaffListingUndoTransition/u);
  assert.match(access, /grainline_seller_staff_listing_undo_transition/u);
  assert.match(audit, /sellerProfileStaffListingUndoTransition\(staffClient/u);
  assert.doesNotMatch(audit, /tx\.listing\.updateMany/u);
  assert.doesNotMatch(audit, /listingUndoCurrentStatusWhere/u);
  assert.doesNotMatch(audit, /listingUndoDataFromMetadata/u);
});
