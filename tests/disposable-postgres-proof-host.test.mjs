import assert from "node:assert/strict";
import test from "node:test";
import { proofServerHostAccepted } from "../scripts/disposable-postgres-proof-host.mjs";

test("published loopback proofs admit private Docker server addresses only in CI", () => {
  assert.equal(proofServerHostAccepted("127.0.0.1"), true);
  for (const host of ["10.0.0.1", "172.16.0.1", "172.18.0.2", "172.31.255.254", "192.168.0.1"]) {
    assert.equal(proofServerHostAccepted(host), false, host);
    assert.equal(proofServerHostAccepted(host, true), true, host);
  }
  for (const host of [null, undefined, "", "localhost", "::1", "8.8.8.8", "172.15.0.1", "172.32.0.1", "192.169.0.1", "172.18.0.999", "10...1", "10.01.0.1", "10.1.2.3 "]) {
    assert.equal(proofServerHostAccepted(host, true), false, String(host));
  }
});
