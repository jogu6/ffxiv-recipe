import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runLocalGeneration} from '../pipeline/tool/local-generation.mjs';
import {parseMonitorArgs,runUbuntuMonitor} from '../tools/run-lodestone-monitor.mjs';
function fixture(t){const root=fs.mkdtempSync(path.join(os.tmpdir(),'ffxiv-local-generation-'));fs.mkdirSync(path.join(root,'pipeline/state'),{recursive:true});t.after(()=>fs.rmSync(root,{recursive:true,force:true}));return root}
test('local generation executes only fixed node commands and never publishes',async t=>{
 const root=fixture(t);let reads=0;const commands=[];
 const result=await runLocalGeneration({root,current:{Version:'test'},config:{autoPublish:{nodeHeapMb:256}},
  snapshot:()=>{},restore:()=>assert.fail('No rollback expected'),
  readApplied:()=>++reads===1?null:{valid:true},
  run:async(executable,args)=>{assert.equal(executable,process.execPath);assert.ok(!args.includes('push'));assert.ok(!args.includes('commit'));commands.push(args);return {stdout:''}}});
 assert.equal(result.status,'generated');assert.equal(result.published,false);assert.ok(commands.length>5);
 assert.equal(fs.existsSync(path.join(root,'pipeline/state/auto-publish.lock')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'pipeline/state/local-generation.json'))).status,'generated');
});
test('failed local generation restores the original public files and releases lock',async t=>{
 const root=fixture(t);let restored=0;
 await assert.rejects(runLocalGeneration({root,current:{Version:'test'},snapshot:()=>{},restore:()=>restored++,readApplied:()=>null,
 run:async()=>{throw new Error('generation stopped')}}),/generation stopped/);
 assert.equal(restored,1);assert.equal(fs.existsSync(path.join(root,'pipeline/state/auto-publish.lock')),false);
 assert.equal(JSON.parse(fs.readFileSync(path.join(root,'pipeline/state/local-generation.json'))).status,'failed');
});
test('local monitor uses repository-private config and never reads GitHub credentials',async t=>{
 const root=fixture(t);let reads=0;let observed;
 const options=parseMonitorArgs(['--run-local','--root',root]);
 await runUbuntuMonitor(options,{platform:'linux',inspect:()=>({ok:true,lockPresent:false,publicationLockPresent:false}),
  readPrivate:file=>{reads++;assert.equal(file,path.join(root,'pipeline/config/lodestone-monitor.vps.local.json'));return '{}'},
  loadMonitor:async()=>({runMonitor:async opts=>{observed=opts;return {outcome:'unchanged'}}})});
 assert.equal(reads,1);assert.equal(observed.notificationsEnabled,false);assert.equal(observed.config.autoPublish.enabled,false);
 await assert.rejects(observed.notifyFailure({error:new Error('safe failure')}),/safe failure/);
});
