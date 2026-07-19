#!/usr/bin/env node

import {
  SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV,
  validateCurrentSavedSearchRlsDeployShape,
} from "./guard-saved-search-rls-deploy.mjs";

try {
  const result = validateCurrentSavedSearchRlsDeployShape({
    phase: process.env[SAVED_SEARCH_RLS_DEPLOY_PHASE_ENV],
  });
  process.stdout.write(
    `SavedSearch RLS release artifact guard passed for ${result.phase}.\n`,
  );
} catch (error) {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(
    `SavedSearch RLS release artifact guard failed: ${message}\n`,
  );
  process.exitCode = 1;
}
