import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { SELLER_PROFILE_INTERNAL_SUPPORT_FUNCTIONS } from '../scripts/seller-profile-public-catalog-disposition.mjs';
import {
  SELLER_PROFILE_RETAINED_AUTHORITY_EVIDENCE,
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
