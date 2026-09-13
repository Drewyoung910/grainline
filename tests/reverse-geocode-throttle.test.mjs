import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";
import {
  NOMINATIM_SHARED_THROTTLE_ATTEMPTS,
  NOMINATIM_SHARED_THROTTLE_KEY,
  NOMINATIM_SHARED_THROTTLE_MS,
  NOMINATIM_SHARED_THROTTLE_RETRY_DELAY_MS,
  waitForNominatimSharedThrottle,
} from "../src/lib/nominatimThrottleState.ts";

const source = readFileSync("src/lib/reverse-geocode.ts", "utf8");
const throttleSource = readFileSync("src/lib/nominatimThrottleState.ts", "utf8");

describe("reverse geocode throttle guardrails", () => {
  it("wires reverse geocoding through the shared fail-closed throttle helper", () => {
    assert.match(source, /waitForNominatimSharedThrottle/);
    assert.match(source, /Sentry\.captureException\(error, \{ tags: \{ source: "reverse_geocode_throttle" \} \}\)/);
    assert.match(source, /Reverse geocode shared throttle contention exceeded/);
    assert.match(throttleSource, /NOMINATIM_SHARED_THROTTLE_KEY = "reverse-geocode:nominatim:lock"/);
    assert.match(throttleSource, /NOMINATIM_SHARED_THROTTLE_MS = 1100/);
    assert.match(throttleSource, /NOMINATIM_SHARED_THROTTLE_ATTEMPTS = 8/);
    assert.doesNotMatch(source, /waitForLocalThrottle/);
  });

  it("acquires the shared Nominatim throttle lock with the policy TTL", async () => {
    const calls = [];
    const acquired = await waitForNominatimSharedThrottle({
      setLock: async (key, value, options) => {
        calls.push({ key, value, options });
        return "OK";
      },
      sleep: async () => assert.fail("sleep should not run after an immediate lock"),
    });

    assert.equal(acquired, true);
    assert.deepEqual(calls, [{
      key: NOMINATIM_SHARED_THROTTLE_KEY,
      value: "1",
      options: { nx: true, px: NOMINATIM_SHARED_THROTTLE_MS },
    }]);
  });

  it("fails closed when the shared Nominatim throttle store errors", async () => {
    const errors = [];
    const acquired = await waitForNominatimSharedThrottle({
      setLock: async () => {
        throw new Error("redis unavailable");
      },
      sleep: async () => assert.fail("sleep should not run after a lock-store error"),
      onError: (error) => errors.push(error),
    });

    assert.equal(acquired, false);
    assert.equal(errors.length, 1);
    assert.match(String(errors[0]), /redis unavailable/);
  });

  it("fails closed after bounded shared Nominatim throttle contention", async () => {
    let lockAttempts = 0;
    const sleeps = [];
    let contentionExceeded = false;
    const acquired = await waitForNominatimSharedThrottle({
      setLock: async () => {
        lockAttempts += 1;
        return null;
      },
      sleep: async (ms) => sleeps.push(ms),
      onContentionExceeded: () => {
        contentionExceeded = true;
      },
    });

    assert.equal(acquired, false);
    assert.equal(lockAttempts, NOMINATIM_SHARED_THROTTLE_ATTEMPTS);
    assert.deepEqual(
      sleeps,
      Array.from(
        { length: NOMINATIM_SHARED_THROTTLE_ATTEMPTS - 1 },
        () => NOMINATIM_SHARED_THROTTLE_RETRY_DELAY_MS,
      ),
    );
    assert.equal(contentionExceeded, true);
  });

  it("keeps Nominatim requests identifiable and US-only", () => {
    assert.match(source, /"User-Agent": "Grainline\/1\.0 \(thegrainline\.com\)"/);
    assert.match(source, /if \(addr\.country_code !== "us"\) return null/);
  });

  it("uses bounded Nominatim locality coordinates for auto-created metros", () => {
    assert.match(source, /async function lookupLocalityCentroid\(city: string, state: string\)/);
    assert.match(source, /q: `\$\{city\}, \$\{state\}, United States`/);
    assert.match(source, /const first = Array\.isArray\(data\) \? data\[0\] : null/);
    assert.match(source, /const latitude = Number\(first\?\.lat\)/);
    assert.match(source, /const longitude = Number\(first\?\.lon\)/);
    assert.match(source, /roundedPublicMetroCoordinate\(latitude\)/);
    assert.match(source, /roundedPublicMetroCoordinate\(longitude\)/);
    assert.match(source, /const centroid = await lookupLocalityCentroid\(city, stateName\)/);
  });
});
