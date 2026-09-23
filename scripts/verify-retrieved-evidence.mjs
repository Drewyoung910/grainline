// Offline retrieval verifier. An independent delivery record supplies the hash;
// a digest read from the downloaded bundle is never its own trust anchor.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
const hash=x=>createHash('sha256').update(x).digest('hex');
const exact=(x,names)=>assert.deepEqual(Object.keys(x).sort(),[...names].sort());
function read(file,limit){
  assert.equal(fs.realpathSync(file),file);const fd=fs.openSync(file,fs.constants.O_RDONLY|fs.constants.O_NOFOLLOW|fs.constants.O_NONBLOCK);
  try{
    const before=fs.fstatSync(fd,{bigint:true});assert.ok(before.isFile()&&before.nlink===1n&&before.uid===BigInt(process.getuid())&&(before.mode&0o7777n)===0o600n&&before.size<=BigInt(limit));
    const bytes=fs.readFileSync(fd),after=fs.fstatSync(fd,{bigint:true}),named=fs.lstatSync(file,{bigint:true});
    for(const key of ['dev','ino','mode','uid','size','nlink','mtimeNs','ctimeNs']){assert.equal(after[key],before[key]);assert.equal(named[key],before[key]);}
    return bytes;
  }finally{fs.closeSync(fd);}
}
export function verifyRetrievedOrderEvidence({directory,expected}){
  try{
    exact(expected,['manifestSha256','runId','runAttempt','releaseCommit','sourceCatalogSha256']);
    for(const key of ['manifestSha256','sourceCatalogSha256'])assert.match(expected[key],/^[a-f0-9]{64}$/u);
    assert.match(expected.releaseCommit,/^[a-f0-9]{40}$/u);
    for(const key of ['runId','runAttempt'])assert.match(expected[key],/^[1-9][0-9]{0,15}$/u);
    assert.equal(path.resolve(directory),directory);assert.equal(fs.realpathSync(directory),directory);
    const actual=[],directories=[],directoryNames=[];
    function walk(root,depth=0){
      assert.ok(depth<=2 && directories.length<300);directoryNames.push(path.relative(directory,root));
      assert.equal(fs.realpathSync(root),root);const s=fs.lstatSync(root,{bigint:true});assert.ok(s.isDirectory()&&s.uid===BigInt(process.getuid())&&(s.mode&0o7777n)===0o700n);
      const names=fs.readdirSync(root).sort();directories.push(()=>{const now=fs.lstatSync(root,{bigint:true});for(const k of ['dev','ino','mode','uid'])assert.equal(now[k],s[k]);assert.deepEqual(fs.readdirSync(root).sort(),names);});
      for(const name of names){const f=path.join(root,name),stat=fs.lstatSync(f);assert.ok(!stat.isSymbolicLink());if(stat.isDirectory())walk(f,depth+1);else{assert.ok(stat.isFile());actual.push(path.relative(directory,f));assert.ok(actual.length<=301);}}
    }
    walk(directory);const manifestBytes=read(path.join(directory,'manifest.json'),256*1024);assert.equal(hash(manifestBytes),expected.manifestSha256);
    const manifest=JSON.parse(manifestBytes);exact(manifest,['version','outcome','files','productionExecutionAuthorized','completeProductionScope']);
    assert.equal(manifest.version,1);assert.ok(['passed','failed','incomplete'].includes(manifest.outcome));
    assert.equal(manifest.productionExecutionAuthorized,false);assert.equal(manifest.completeProductionScope,false);assert.ok(manifest.files.length<=300);
    const names=new Set(),checks=[];let total=0;
    for(const item of manifest.files){
      exact(item,['name','bytes','sha256']);assert.match(item.sha256,/^[a-f0-9]{64}$/u);
      assert.ok(Number.isSafeInteger(item.bytes)&&item.bytes>=0&&item.bytes<=16*1024*1024);total+=item.bytes;assert.ok(total<=32*1024*1024);
      assert.ok(typeof item.name==='string'&&!names.has(item.name));names.add(item.name);
      assert.match(item.name,/^(?:binding\.json|supervisor\/(?:launch|result|phase-[0-5])\.json|worker\/checkpoint-[1-9][0-9]{0,5}-(?:preparing|installed|prepared|executing-admitted|admitted-complete|failed)-(?:disk-guard|install|engine-download|client-generation|generated-identity|complete|graph-import)\.json|journal\/execution\.(?:json|pending|lock)|capsule\/prisma\.config\.mjs|selected\/(?:migration_lock\.toml|\d{14}_[a-z0-9_]+\/migration\.sql))$/u);
      const file=path.join(directory,item.name),check=()=>{const bytes=read(file,16*1024*1024);assert.equal(bytes.length,item.bytes);assert.equal(hash(bytes),item.sha256);};check();checks.push(check);
    }
    assert.deepEqual(actual.sort(),[...names,'manifest.json'].sort());assert.ok(names.has('binding.json'));
    const expectedDirectories=new Set(['']);for(const name of names){let d=path.dirname(name);while(d!=='.'){expectedDirectories.add(d);d=path.dirname(d);}}
    assert.deepEqual(directoryNames.sort(),[...expectedDirectories].sort());
    const binding=JSON.parse(read(path.join(directory,'binding.json'),16384));
    for(const key of ['runId','runAttempt','releaseCommit','sourceCatalogSha256'])assert.equal(binding[key],expected[key]);
    assert.equal(binding.outcome,manifest.outcome);
    for(const key of ['productionExecutionAuthorized','completeProductionScope','evidenceUploadProven','hostLossDurabilityProven'])assert.equal(binding[key],false);
    checks.forEach(check=>check());directories.forEach(check=>check());assert.equal(hash(read(path.join(directory,'manifest.json'),256*1024)),expected.manifestSha256);
    return Object.freeze({integrityVerified:true,evidenceOutcome:manifest.outcome,fileCount:actual.length,
      productionExecutionAuthorized:false,completeProductionScope:false,actualOffHostDeliveryProven:false,hostLossDurabilityProven:false});
  }catch{throw new Error('Order retrieved evidence rejected; preserve received bundle');}
}
