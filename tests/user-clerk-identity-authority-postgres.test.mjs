import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { PGlite } from "@electric-sql/pglite";

const emailAuthorityMigration = readFileSync(
  "prisma/migrations/20261002170000_prepare_user_email_address_authority/migration.sql",
  "utf8",
);
const identityAuthorityMigration = readFileSync(
  "prisma/migrations/20261003100000_prepare_user_clerk_identity_authority/migration.sql",
  "utf8",
);
const identityPlaceholderCorrectionPath =
  process.env.USER_CLERK_IDENTITY_PLACEHOLDER_CORRECTION_MIGRATION_PATH ??
  "prisma/migrations/20261007155000_correct_user_clerk_identity_placeholder/migration.sql";
const identityPlaceholderCorrection = readFileSync(identityPlaceholderCorrectionPath, "utf8");

async function createDatabase() {
  const database = new PGlite();
  await database.exec(`
    CREATE ROLE grainline_app_runtime LOGIN NOINHERIT;
    CREATE ROLE grainline_untrusted LOGIN NOINHERIT;
    CREATE TYPE public."Role" AS ENUM ('USER', 'EMPLOYEE', 'ADMIN');
    CREATE TABLE public."User" (
      id text PRIMARY KEY,
      "clerkId" varchar(255) NOT NULL,
      email varchar(254) NOT NULL,
      name varchar(100),
      "imageUrl" varchar(2048),
      role public."Role" NOT NULL DEFAULT 'USER',
      "createdAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" timestamp(3) without time zone NOT NULL,
      "deletedAt" timestamp(3) without time zone,
      "termsAcceptedAt" timestamp(3) without time zone,
      "termsVersion" varchar(50),
      "ageAttestedAt" timestamp(3) without time zone,
      "welcomeEmailSentAt" timestamp(3) without time zone,
      "shippingName" varchar(100),
      "shippingLine1" varchar(200),
      "shippingLine2" varchar(200),
      "shippingCity" varchar(100),
      "shippingState" varchar(50),
      "shippingPostalCode" varchar(20),
      "shippingPhone" varchar(30),
      "notificationPreferences" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "emailPreferenceOptInAt" timestamp(3) without time zone,
      banned boolean NOT NULL DEFAULT false,
      "bannedAt" timestamp(3) without time zone,
      "banReason" varchar(500),
      "bannedBy" varchar(255),
      CONSTRAINT "User_clerkId_key" UNIQUE ("clerkId"),
      CONSTRAINT "User_email_key" UNIQUE (email)
    );
    CREATE TABLE public."UserEmailAddress" (
      id text PRIMARY KEY,
      "userId" varchar(191) NOT NULL REFERENCES public."User"(id) ON DELETE CASCADE,
      email varchar(254) NOT NULL,
      source varchar(80),
      "isCurrent" boolean NOT NULL DEFAULT false,
      "firstSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "lastSeenAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "currentSinceAt" timestamp(3) without time zone NOT NULL DEFAULT CURRENT_TIMESTAMP,
      UNIQUE ("userId", email)
    );
    CREATE UNIQUE INDEX "UserEmailAddress_one_current_per_user_key"
      ON public."UserEmailAddress" ("userId")
      WHERE "isCurrent" = true;
  `);
  await database.exec(emailAuthorityMigration);
  await database.exec(identityAuthorityMigration);
  await database.exec(identityPlaceholderCorrection);
  return database;
}

async function setRole(database, role) {
  await database.exec(`SET ROLE ${role}`);
}

async function resetRole(database) {
  await database.exec("RESET ROLE");
}

async function ensureIdentity(database, {
  newUserId,
  clerkId,
  email = null,
  updateEmail = false,
  name = null,
  updateName = false,
  imageUrl = null,
  updateImage = false,
}) {
  return (await database.query(`
    SELECT *
      FROM public.grainline_user_clerk_identity_ensure(
        $1::text,
        $2::text,
        $3::text,
        $4::boolean,
        $5::text,
        $6::boolean,
        $7::text,
        $8::boolean
      )
  `, [
    newUserId,
    clerkId,
    email,
    updateEmail,
    name,
    updateName,
    imageUrl,
    updateImage,
  ])).rows[0];
}

test("disposable PostgreSQL proves Clerk identity create, update, collision, and account gates", async () => {
  const database = await createDatabase();
  try {
    await setRole(database, "grainline_app_runtime");
    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "user_one",
      clerkId: "user_clerk_one",
      email: "one@example.com",
      updateEmail: true,
      name: "One",
      updateName: true,
      imageUrl: "https://example.com/one.png",
      updateImage: true,
    }), {
      user_id: "user_one",
      email_conflict: false,
      created: true,
    });

    const account = (await database.query(`
      SELECT id, "clerkId", email, name, "imageUrl", role, banned
        FROM public.grainline_user_clerk_account('user_clerk_one')
    `)).rows;
    assert.deepEqual(account, [{
      id: "user_one",
      clerkId: "user_clerk_one",
      email: "one@example.com",
      name: "One",
      imageUrl: "https://example.com/one.png",
      role: "USER",
      banned: false,
    }]);

    const gate = (await database.query(`
      SELECT * FROM public.grainline_user_clerk_gate('user_clerk_one')
    `)).rows[0];
    assert.deepEqual(Object.keys(gate), [
      "id",
      "role",
      "banned",
      "deletedAt",
      "termsAcceptedAt",
      "termsVersion",
      "ageAttestedAt",
    ]);
    assert.equal(gate.id, "user_one");
    assert.equal(gate.role, "USER");
    assert.equal(gate.banned, false);

    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "ignored_second_id",
      clerkId: "user_clerk_one",
      email: "one-new@example.com",
      updateEmail: true,
      name: "One Updated",
      updateName: true,
    }), {
      user_id: "user_one",
      email_conflict: false,
      created: false,
    });

    await resetRole(database);
    const history = (await database.query(`
      SELECT email, source, "isCurrent"
        FROM public."UserEmailAddress"
       WHERE "userId" = 'user_one'
       ORDER BY email
    `)).rows;
    assert.deepEqual(history, [
      { email: "one-new@example.com", source: "ensure_user", isCurrent: true },
      { email: "one@example.com", source: "ensure_user_create", isCurrent: false },
    ]);

    await setRole(database, "grainline_app_runtime");
    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "user_two",
      clerkId: "user_clerk_two",
      email: "one-new@example.com",
      updateEmail: true,
      name: "Two",
      updateName: true,
    }), {
      user_id: "user_two",
      email_conflict: true,
      created: true,
    });
    const conflictAccount = (await database.query(`
      SELECT id, email, name
        FROM public.grainline_user_clerk_account('user_clerk_two')
    `)).rows[0];
    assert.deepEqual(conflictAccount, {
      id: "user_two",
      email: "user_clerk_two@placeholder.invalid",
      name: "Two",
    });

    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "user_mixed_no_email",
      clerkId: "user_2NNEqMixedNoEmail",
    }), {
      user_id: "user_mixed_no_email",
      email_conflict: false,
      created: true,
    });
    assert.deepEqual((await database.query(`
      SELECT email
        FROM public.grainline_user_clerk_account('user_2NNEqMixedNoEmail')
    `)).rows[0], {
      email: `user_2nneqmixednoemail-${createHash("md5")
        .update("user_2NNEqMixedNoEmail")
        .digest("hex")}@placeholder.invalid`,
    });

    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "user_lowercase_counterpart",
      clerkId: "user_2nneqmixednoemail",
    }), {
      user_id: "user_lowercase_counterpart",
      email_conflict: false,
      created: true,
    });
    assert.deepEqual((await database.query(`
      SELECT email
        FROM public.grainline_user_clerk_account('user_2nneqmixednoemail')
    `)).rows[0], {
      email: "user_2nneqmixednoemail@placeholder.invalid",
    });

    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "user_mixed_conflict",
      clerkId: "user_2NNEqMixedConflict",
      email: "one-new@example.com",
      updateEmail: true,
    }), {
      user_id: "user_mixed_conflict",
      email_conflict: true,
      created: true,
    });
    assert.deepEqual((await database.query(`
      SELECT email
        FROM public.grainline_user_clerk_account('user_2NNEqMixedConflict')
    `)).rows[0], {
      email: `user_2nneqmixedconflict-${createHash("md5")
        .update("user_2NNEqMixedConflict")
        .digest("hex")}@placeholder.invalid`,
    });

    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "ignored_third_id",
      clerkId: "user_clerk_two",
      email: "one-new@example.com",
      updateEmail: true,
      name: "Two Updated",
      updateName: true,
    }), {
      user_id: "user_two",
      email_conflict: true,
      created: false,
    });
    assert.deepEqual((await database.query(`
      SELECT email, name
        FROM public.grainline_user_clerk_account('user_clerk_two')
    `)).rows[0], {
      email: "user_clerk_two@placeholder.invalid",
      name: "Two Updated",
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves blocked accounts do not mutate and concurrent retries stay idempotent", async () => {
  const database = await createDatabase();
  try {
    await setRole(database, "grainline_app_runtime");
    const outcomes = await Promise.all([
      ensureIdentity(database, {
        newUserId: "race_one",
        clerkId: "user_clerk_race",
        email: "race@example.com",
        updateEmail: true,
      }),
      ensureIdentity(database, {
        newUserId: "race_two",
        clerkId: "user_clerk_race",
        email: "race@example.com",
        updateEmail: true,
      }),
    ]);
    assert.equal(outcomes.filter((row) => row.created).length, 1);
    assert.equal(new Set(outcomes.map((row) => row.user_id)).size, 1);

    await resetRole(database);
    assert.equal((await database.query(`
      SELECT count(*)::integer AS count
        FROM public."User"
       WHERE "clerkId" = 'user_clerk_race'
    `)).rows[0].count, 1);
    await database.query(`
      UPDATE public."User"
         SET banned = true
       WHERE "clerkId" = 'user_clerk_race'
    `);

    await setRole(database, "grainline_app_runtime");
    assert.deepEqual(await ensureIdentity(database, {
      newUserId: "blocked_retry",
      clerkId: "user_clerk_race",
      email: "mutated@example.com",
      updateEmail: true,
      name: "Mutated",
      updateName: true,
    }), {
      user_id: outcomes[0].user_id,
      email_conflict: false,
      created: false,
    });
    assert.deepEqual((await database.query(`
      SELECT email, name, banned
        FROM public.grainline_user_clerk_account('user_clerk_race')
    `)).rows[0], {
      email: "race@example.com",
      name: null,
      banned: true,
    });
  } finally {
    await database.close();
  }
});

test("disposable PostgreSQL proves exact function privileges and no direct User table access", async () => {
  const database = await createDatabase();
  try {
    const catalog = (await database.query(`
      SELECT
        p.proname,
        p.prosecdef AS security_definer,
        p.provolatile AS volatility,
        p.proconfig AS config,
        pg_catalog.has_function_privilege(
          'grainline_app_runtime', p.oid, 'EXECUTE'
        ) AS runtime_execute,
        pg_catalog.has_function_privilege(
          'grainline_untrusted', p.oid, 'EXECUTE'
        ) AS untrusted_execute
      FROM pg_catalog.pg_proc AS p
      INNER JOIN pg_catalog.pg_namespace AS n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public'
        AND p.proname LIKE 'grainline_user_clerk_%'
      ORDER BY p.proname
    `)).rows;
    assert.deepEqual(catalog.map((row) => row.proname), [
      "grainline_user_clerk_account",
      "grainline_user_clerk_gate",
      "grainline_user_clerk_identity_ensure",
    ]);
    for (const row of catalog) {
      assert.equal(row.security_definer, true);
      assert.deepEqual(row.config, ["search_path=pg_catalog"]);
      assert.equal(row.runtime_execute, true);
      assert.equal(row.untrusted_execute, false);
    }
    assert.deepEqual(catalog.map((row) => row.volatility), ["s", "s", "v"]);

    const privileges = (await database.query(`
      SELECT
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', 'public."User"', 'SELECT'
        ) AS runtime_select,
        pg_catalog.has_table_privilege(
          'grainline_app_runtime', 'public."User"', 'INSERT,UPDATE,DELETE'
        ) AS runtime_write
    `)).rows[0];
    assert.deepEqual(privileges, {
      runtime_select: false,
      runtime_write: false,
    });

    await setRole(database, "grainline_app_runtime");
    await assert.rejects(
      database.query(`SELECT * FROM public."User"`),
      (error) => error?.code === "42501",
    );
    await assert.rejects(
      database.query(`INSERT INTO public."User" (id, "clerkId", email, "updatedAt")
        VALUES ('forged', 'forged', 'forged@example.com', CURRENT_TIMESTAMP)`),
      (error) => error?.code === "42501",
    );

    await resetRole(database);
    await setRole(database, "grainline_untrusted");
    await assert.rejects(
      database.query(`SELECT * FROM public.grainline_user_clerk_gate('user_clerk_one')`),
      (error) => error?.code === "42501",
    );
  } finally {
    await database.close();
  }
});
