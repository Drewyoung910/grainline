import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {createHash} from 'node:crypto';
import {verifyRetrievedOrderEvidence} from '../scripts/verify-retrieved-evidence.mjs';
const hash=b=>createHash('sha256').update(b).digest('hex');
function fixture(t){
 const parent=fs.mkdtempSync(path.join(fs.realpathSync(os.tmpdir()),'order-received-'));fs.chmodSync(parent,0o700);t.after(()=>fs.rmSync(parent,{recursive:true,force:true}));
 const directory=path.join(parent,'received');fs.mkdirSync(directory,{mode:0o700});
 const expected={runId:'123',runAttempt:'1',releaseCommit:'a'.repeat(40),sourceCatalogSha256:'b'.repeat(64)};
 const body={version:1,...expected,outcome:'failed',productionExecutionAuthorized:false,completeProductionScope:false,evidenceUploadProven:false,hostLossDurabilityProven:false};
 const bytes=Buffer.from(JSON.stringify(body)+'\n');fs.writeFileSync(path.join(directory,'binding.json'),bytes,{mode:0o600});
 const manifest={version:1,outcome:'failed',files:[{name:'binding.json',bytes:bytes.length,sha256:hash(bytes)}],productionExecutionAuthorized:false,completeProductionScope:false};
 const raw=JSON.stringify(manifest)+'\n';fs.writeFileSync(path.join(directory,'manifest.json'),raw,{mode:0o600});expected.manifestSha256=hash(raw);
 return{parent,directory,expected,manifest,verify:()=>verifyRetrievedOrderEvidence({directory,expected})};
}
test('retrieval verifies an independently bound failed bundle without granting release authority',t=>{
 const f=fixture(t),result=f.verify();assert.equal(result.integrityVerified,true);assert.equal(result.evidenceOutcome,'failed');assert.equal(result.actualOffHostDeliveryProven,false);assert.equal(result.productionExecutionAuthorized,false);
});
test('retrieval refuses altered bytes, swapped manifest, wrong attempt, missing or extra data and links',t=>{
 for(const alter of [
  f=>fs.appendFileSync(path.join(f.directory,'binding.json'),' '),
  f=>fs.appendFileSync(path.join(f.directory,'manifest.json'),' '),
  f=>{f.expected.runAttempt='2';},
  f=>fs.unlinkSync(path.join(f.directory,'binding.json')),
  f=>fs.writeFileSync(path.join(f.directory,'capability'),'fixture-private-channel',{mode:0o600}),
  f=>fs.mkdirSync(path.join(f.directory,'unexpected-empty-directory'),{mode:0o700}),
  f=>fs.chmodSync(f.directory,0o755),
  f=>{const original=path.join(f.directory,'binding.json'),other=path.join(f.parent,'binding.json');fs.renameSync(original,other);fs.symlinkSync(other,original);},
 ]){const f=fixture(t);alter(f);assert.throws(f.verify,/retrieved evidence rejected/u);}
});
test('retrieval rejects path traversal even if a caller supplies a matching malformed manifest hash',t=>{
 const f=fixture(t);f.manifest.files.push({name:'../private-env',bytes:0,sha256:hash('')});const raw=JSON.stringify(f.manifest);fs.writeFileSync(path.join(f.directory,'manifest.json'),raw);f.expected.manifestSha256=hash(raw);assert.throws(f.verify,/retrieved evidence rejected/u);
});
