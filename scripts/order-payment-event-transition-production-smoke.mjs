#!/usr/bin/env node
// Canonical launcher for the bounded OrderPaymentEvent transition-compatible
// production smoke. The shared core retains its historical filename so the
// accepted aggregate-release evidence remains traceable through Git history.
import { pathToFileURL } from "node:url";
import {
  runTransitionSmoke,
} from "./order-payment-event-aggregate-production-smoke.mjs";

export { runTransitionSmoke };

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  runTransitionSmoke().then(
    (evidence) => {
      process.stdout.write(`${JSON.stringify({
        status: evidence.status,
        deploymentId: evidence.application.deploymentId,
        accountPageStatus: evidence.result.accountPageStatus,
        reviewDenialStatus: evidence.result.authenticatedReviewDenialStatus,
        cleanupPassed: Object.values(evidence.cleanup).every(Boolean),
      })}\n`);
    },
    (error) => {
      process.stderr.write(`OrderPaymentEvent transition production smoke failed [${error?.code ?? "UNCLASSIFIED"}].\n`);
      process.exitCode = 1;
    },
  );
}
