import assert from "node:assert/strict";
import { describe, it } from "node:test";

const { isPublicHostname, normalizePublicHttpsUrl } = await import("../src/lib/urlValidation.ts");

describe("public HTTPS URL validation", () => {
  it("normalizes public HTTPS URLs and strips fragments", () => {
    assert.equal(
      normalizePublicHttpsUrl(" https://portfolio.example-shop.com/work#bio "),
      "https://portfolio.example-shop.com/work",
    );
    assert.equal(normalizePublicHttpsUrl("http://portfolio.example-shop.com/work"), null);
    assert.equal(normalizePublicHttpsUrl("https://user:pass@portfolio.example-shop.com/work"), null);
    assert.equal(normalizePublicHttpsUrl("https://portfolio.example-shop.com/" + "a".repeat(600)), null);
    assert.equal(normalizePublicHttpsUrl("https://93.184.216.34/"), "https://93.184.216.34/");
    assert.equal(normalizePublicHttpsUrl("https://[2606:2800:220:1:248:1893:25c8:1946]/"), "https://[2606:2800:220:1:248:1893:25c8:1946]/");
  });

  it("rejects loopback, private, link-local, and reserved network hosts", () => {
    for (const url of [
      "https://localhost/",
      "https://localhost./",
      "https://127.0.0.1/",
      "https://0177.0.0.1/",
      "https://2130706433/",
      "https://10.0.0.1/",
      "https://172.16.0.1/",
      "https://192.168.0.1/",
      "https://169.254.169.254/",
      "https://100.64.0.1/",
      "https://[::1]/",
      "https://[fc00::1]/",
      "https://[fe80::1]/",
      "https://[::ffff:127.0.0.1]/",
    ]) {
      assert.equal(normalizePublicHttpsUrl(url), null, `${url} should be rejected`);
    }
  });

  it("rejects private-looking hostnames and wildcard private-IP DNS aliases", () => {
    for (const hostname of [
      "internal.thegrainline.com",
      "portfolio.internal",
      "maker.local",
      "printer.lan",
      "10.0.0.1.nip.io",
      "127.0.0.1.sslip.io",
      "localtest.me",
      "lvh.me",
    ]) {
      assert.equal(isPublicHostname(hostname), false, `${hostname} should be rejected`);
      assert.equal(normalizePublicHttpsUrl(`https://${hostname}/`), null);
    }
  });
});
