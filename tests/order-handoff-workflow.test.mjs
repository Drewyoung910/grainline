import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import test from 'node:test';

const workflow = fs.readFileSync('.github/workflows/production-migrations.yml', 'utf8');
const pins = JSON.parse(fs.readFileSync('docs/order-handoff-toolchain-pins.json', 'utf8'));
const steps = workflow.split(/^      - /mu).slice(1);
function step(id) {
  const found = steps.filter(value => value.includes(`        id: ${id}\n`));
  assert.equal(found.length, 1, `one ${id} step`);
  return found[0];
}

test('private replacement is disabled, manual, protected and serialized across database migrations', () => {
  assert.match(workflow, /^on:\n  workflow_dispatch:\n    inputs:/mu);
  assert.doesNotMatch(workflow, /^  (?:push|pull_request|schedule|workflow_run):/mu);
  assert.match(workflow, /^permissions:\n  contents: read\n  actions: read\n/mu);
  assert.match(workflow, /^concurrency:\n  group: production-database-migrations\n  cancel-in-progress: false\n/mu);
  assert.match(workflow, /^    if: \$\{\{ false \}\}/mu);
  assert.match(workflow, /^    environment: Production$/mu);
  assert.match(workflow, /^    name: Guarded production migration$/mu);
  assert.equal(steps.length, 7);
  assert.match(workflow, /^    runs-on: ubuntu-24\.04$/mu);
  assert.equal(pins.workflowActivated, false);
  assert.equal(pins.productionExecutionAuthorized, false);
  assert.deepEqual([...workflow.matchAll(/^      - uses: ([^\n]+)|^        uses: ([^\n]+)/gmu)].map(m => (m[1] ?? m[2]).split(' #')[0]), [
    `actions/checkout@${pins.actions['checkout'].commit}`, `actions/setup-node@${pins.actions['setup-node'].commit}`, `actions/upload-artifact@${pins.actions['upload-artifact'].commit}`,
  ]);
  assert.match(steps[0], /ref: \$\{\{ github.sha \}\}\n          persist-credentials: false/u);
  assert.equal(pins.toolchain.nodeVersion, 'v22.23.2');
  assert.equal(pins.toolchain.npmVersion, '10.9.8');
  assert.match(steps[1], /node-version: '22\.23\.2'/u);
  assert.match(steps[1], /architecture: x64/u);
  assert.match(steps[1], /package-manager-cache: false/u);
  assert.match(steps[1], /check-latest: false/u);
  assert.match(steps[1], /token: ''/u);
  assert.doesNotMatch(steps[1], /registry-url:|mirror:|\n          cache:/u);
});

test('owner credential and token reach only the post-install handoff step', () => {
  const execute = step('execute');
  assert.equal(steps.filter(value => value.includes('secrets.')).length, 1);
  assert.equal(steps.filter(value => value.includes('github.token')).length, 1);
  assert.match(execute, /ORDER_HANDOFF_GITHUB_TOKEN: \$\{\{ github.token \}\}/u);
  assert.match(execute, /ORDER_HANDOFF_OWNER_URL: \$\{\{ secrets.PRODUCTION_MIGRATION_DIRECT_URL \}\}/u);
  assert.match(execute, /ORDER_HANDOFF_OWNER_URL_SHA256: \$\{\{ vars.PRODUCTION_MIGRATION_DIRECT_URL_SHA256 \}\}/u);
  const header = workflow.slice(0, workflow.indexOf('    steps:'));
  assert.doesNotMatch(header, /secrets\.|github.token|\n    env:/u);
  for (const id of ['prepare', 'evidence', 'upload']) assert.doesNotMatch(step(id), /secrets\.|github.token/u);
  assert.ok(steps.indexOf(step('prepare')) < steps.indexOf(execute));
  assert.match(step('prepare'), /ORDER_REVIEWED_TOOLCHAIN_JSON: \$\{\{ vars.ORDER_REVIEWED_TOOLCHAIN_JSON \}\}/u);
  for (const [id, program] of [['prepare', 'launch'], ['execute', 'client'], ['evidence', 'evidence']]) {
    const body = step(id);
    assert.match(body, new RegExp(`scripts/order-handoff-${program}\\.mjs`, 'u'));
    assert.doesNotMatch(body, /from ['"](?:\.\/|\.\.\/|[^n][^']*node_modules)/u);
  }
  assert.doesNotMatch(workflow, /npx prisma|psql |SAVED_SEARCH_RLS_DEPLOY_PHASE|migrate resolve|continue-on-error/u);
});

test('failed attempts still collect and upload evidence while final success requires every outcome', () => {
  for (const id of ['evidence', 'upload']) assert.match(step(id), /if: \$\{\{ always\(\) && steps.prepare.outputs.control != '' \}\}/u);
  assert.match(step('evidence'), /finally \{[\s\S]*manifest_sha256=\$\{digest\}/u);
  const upload = step('upload');
  assert.match(upload, /path: \$\{\{ steps.prepare.outputs.control \}\}\/evidence\n/u);
  assert.match(upload, /if-no-files-found: error\n/u);
  assert.match(upload, /include-hidden-files: false\n/u);
  assert.match(upload, /retention-days: 7\n/u);
  assert.match(upload, /archive: true\n/u);
  assert.match(upload, /overwrite: false\n/u);
  const final = steps.at(-1);
  assert.match(final, /if: \$\{\{ always\(\) \}\}/u);
  for (const key of ['EXECUTION', 'EVIDENCE', 'UPLOAD']) assert.ok(final.includes(`test "$${key}_OUTCOME" = success`));
});

test('historical workflow evidence is byte-pinned outside Actions and cannot stand in for the replacement', () => {
  const bytes = fs.readFileSync('tests/fixtures/order-handoff/historical-production-migrations.yml.txt');
  assert.equal(createHash('sha256').update(bytes).digest('hex'), 'f243a1876b3daf32e4dda600a427953da6544c789f04c3d21f3fb1112cfe60cc');
  assert.notEqual(workflow, bytes.toString());
  assert.doesNotMatch(workflow, /tests\/fixtures|historical-production-migrations/u);
});
