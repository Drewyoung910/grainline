import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS } from '../scripts/seller-profile-public-catalog-disposition.mjs';
import {
  SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE,
  preserveSellerProfileRetainedAuthorityEvidence,
  verifySellerProfileRetainedAuthorityEvidence,
} from '../scripts/seller-profile-public-retained-authority-evidence.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

function fixture() {
  const retained = Object.keys(SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE).map((signature, index) => ({
    signature,
    runtime_execute: index < 91,
    execute_grantees: index < 91 ? ['ci', 'grainline_app_runtime'] : ['ci', 'grainline_staff_read_runtime'],
  }));
  const internal = [...SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS].map((signature) => ({
    signature,
    runtime_execute: false,
    execute_grantees: ['ci'],
  }));
  return { functions: [...retained, ...internal] };
}

test('every retained SellerProfile authority maps to behavioral evidence or an explicit gap', () => {
  assert.deepEqual(verifySellerProfileRetainedAuthorityEvidence(root, fixture()), {
    retainedAuthorities: 98,
    evidenceCounts: {
      DIRECT_DATABASE_BEHAVIOR: 96,
      COMPOSED_DATABASE_BEHAVIOR: 2,
      SOURCE_ONLY_GAP: 0,
    },
    gaps: [],
  });
});

test('new or retired callable authorities reopen evidence review', () => {
  const changed = fixture();
  changed.functions[0] = {
    signature: 'grainline_unreviewed_runtime_authority(text)',
    runtime_execute: true,
    execute_grantees: ['ci', 'grainline_app_runtime'],
  };
  assert.throws(
    () => verifySellerProfileRetainedAuthorityEvidence(root, changed),
    /evidence drifted/u,
  );
});

test('preserves every test-backed authority proof before CI isolates successors', (context) => {
  const destination = fs.mkdtempSync(path.join(os.tmpdir(), 'seller-profile-retained-evidence-'));
  context.after(() => fs.rmSync(destination, { recursive: true, force: true }));

  const result = preserveSellerProfileRetainedAuthorityEvidence(root, destination);
  assert.ok(result.copiedFiles.includes('tests/user-staff-ban-authorities.test.mjs'));
  assert.ok(result.copiedFiles.includes('tests/order-label-authority-postgres.test.mjs'));
  assert.equal(
    fs.readFileSync(path.join(destination, 'user-staff-ban-authorities.test.mjs'), 'utf8'),
    fs.readFileSync(path.join(root, 'tests/user-staff-ban-authorities.test.mjs'), 'utf8'),
  );
});
