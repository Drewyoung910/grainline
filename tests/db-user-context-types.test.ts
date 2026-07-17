import type { Prisma } from "@prisma/client";
import { prisma } from "@/lib/db";
import type { DbUserContextTransactionClient } from "@/lib/dbUserContext";

declare const rawTransactionClient: Prisma.TransactionClient;

function requiresContextualTransaction(_client: DbUserContextTransactionClient) {}

// These expected errors are the compile-time security contract: neither the
// global Prisma client nor a raw transaction has the private brand issued only
// after setDbUserContext() verifies transaction-local context.
// @ts-expect-error global PrismaClient is not context-branded
requiresContextualTransaction(prisma);
// @ts-expect-error raw TransactionClient is not context-branded
requiresContextualTransaction(rawTransactionClient);
