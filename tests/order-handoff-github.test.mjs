import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverOrderHandoffJob } from '../scripts/order-handoff-github.mjs';
const context={runId:'123',runAttempt:'2',releaseCommit:'a'.repeat(40),runnerName:'Fixture runner'};
const job={id:456,run_id:123,run_attempt:2,head_sha:context.releaseCommit,name:'Guarded production migration',status:'in_progress',conclusion:null,runner_name:context.runnerName,runner_id:1};
const response=body=>new Response(JSON.stringify(body),{status:200,headers:{'content-type':'application/json'}});
test('job discovery makes one exact attempt-bound read and closes its transport',async()=>{
  let count=0,signal;
  const value=await discoverOrderHandoffJob({context,githubToken:'fixture-token'},async(url,options)=>{count++;signal=options.signal;assert.equal(url,'https://api.github.com/repos/Drewyoung910/grainline/actions/runs/123/attempts/2/jobs?per_page=100');assert.equal(options.redirect,'error');assert.equal(options.cache,'no-store');return response({total_count:1,jobs:[job]});});
  assert.equal(count,1);assert.equal(signal.aborted,true);assert.deepEqual(value,{runId:'123',runAttempt:'2',jobId:'456'});
});
test('job discovery fails closed without retry on rate limit, ambiguity, redirect, overflow or changed context',async()=>{
  for(const make of [
    ()=>new Response('{}',{status:403}),()=>new Response('{}',{status:429}),
    ()=>response({total_count:2,jobs:[job,job]}),()=>response({total_count:1,jobs:[{...job,run_attempt:1}]}),
    ()=>response({total_count:1,jobs:[{...job,runner_name:'another runner'}]}),
    ()=>response({total_count:1,jobs:[{...job,head_sha:'b'.repeat(40)}]}),
    ()=>new Response('x'.repeat(1024*1024+1),{status:200,headers:{'content-type':'application/json'}}),
    ()=>({status:200,redirected:true,body:{}}),()=>{throw new Error('fixture-provider-body-not-for-log');},
    ()=>new Response('{}',{status:200,headers:{'content-type':'application/json',link:'next'}}),
  ]){let count=0;await assert.rejects(discoverOrderHandoffJob({context,githubToken:'fixture-token'},async()=>{count++;return make();}),/^Error: Order handoff job discovery failed; no retry$/u);assert.equal(count,1);}
});
test('job discovery aborts a stalled read at its real fifteen-second deadline', { timeout: 20000 }, async()=>{
  let count=0,aborted=false;const start=Date.now();
  await assert.rejects(discoverOrderHandoffJob({context,githubToken:'fixture-token'},async(_url,{signal})=>{
    count++;return new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(new Error('fixture deadline'));},{once:true}));
  }),/^Error: Order handoff job discovery failed; no retry$/u);
  assert.equal(count,1);assert.equal(aborted,true);assert.ok(Date.now()-start>=14500 && Date.now()-start<19500);
});
