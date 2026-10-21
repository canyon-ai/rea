import { mkdir, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import assert from 'node:assert/strict';
import { parseEvidence } from '../dist/domain/evidence.js';

// Owned synthetic targets only. Never execute the target's TypeScript.
const root = resolve(fileURLToPath(new URL('..', import.meta.url)));
const out = resolve(process.argv[2] ?? join(root, '..', 'rea-trial'));
await mkdir(out, { recursive: true });
const run = promisify(execFile);
const observations = [];
const safeEnvironment = Object.fromEntries(['PATH','Path','SystemRoot','WINDIR','TEMP','TMP','USERPROFILE','LOCALAPPDATA','APPDATA','PATHEXT'].filter(k=>process.env[k]).map(k=>[k,process.env[k]]));
async function cli(command, args, name, expected = 0) {
  const started = performance.now();
  let result, observedRefusal = false;
  try { result = await run(process.execPath, [join(root,'scripts','rea.mjs'), command,...args,'--json'], { cwd: root, env: safeEnvironment, timeout: 90000, maxBuffer: 32*1024*1024, windowsHide: true }); }
  catch(error) {
    if(!expected) throw error;
    // A timeout, signal, launch failure or wrong status is not the expected refusal.
    assert.equal(error.code,expected,`Expected exit ${expected} from ${name}`);
    result=error; observedRefusal=true;
  }
  if(expected) assert(observedRefusal,`${name} unexpectedly succeeded instead of refusing`);
  await writeFile(join(out,name+'.stderr.txt'),result.stderr??'');
  await writeFile(join(out,name+'.json'),result.stdout??'');
  const value=JSON.parse(result.stdout);
  if(expected) assert.equal(value.code,'invalid_request',`${name} did not return the intended typed input refusal`);
  observations.push({name,command,durationMs:Math.round(performance.now()-started),status:expected?'expected-refusal':'success'});
  if(!expected) parseEvidence(value);
  return value;
}
for(const version of ['left','right']) {
  const path=join(out,version); await mkdir(path,{recursive:true});
  await writeFile(join(path,'package.json'),JSON.stringify({name:'owned-static-fixture',type:'module',main:'index.ts'}));
  await writeFile(join(path,'index.ts'),"import { connected } from './connected.ts'; export function entry(){ return connected(); }\n");
  await writeFile(join(path,'connected.ts'),"export function connected(){ return 'CONNECTED_SENTINEL'; }\n");
  await writeFile(join(path,'orphan.ts'),"export function unused(){ return 'ORPHAN_SENTINEL'; }\n");
  await writeFile(join(path,'contract.ts'),version==='left'?"export function contract(){ return {kind:'result',count:1}; }\n":"export function contract(){ return {kind:'result',total:1}; }\n");
  await writeFile(join(path,'dynamic.ts'),"export function dynamic(input: unknown){ return {...input as object,kind:'dynamic'}; }\n");
}
const left=await cli('analyze-javascript-application',[join(out,'left')],'left');
const right=await cli('analyze-javascript-application',[join(out,'right')],'right');
async function request(command,input,name,expected=0){const p=join(out,name+'.input.json');await writeFile(p,JSON.stringify(input));return cli(command,[p],name,expected);}
const trace=await request('trace-application-feature',{application:left,seed:{kind:'module',value:'index.ts'},direction:'outgoing'},'trace');
const traceText=JSON.stringify(trace.normalized_result);
assert(traceText.includes('connected.ts'),'Entry trace lost connected helper');
assert(!traceText.includes('orphan.ts'),'Orphan falsely reported as reachable from entry');
const compare=await request('compare-javascript-export-shapes',{left,right,left_module_path:'contract.ts',left_export_name:'contract',right_module_path:'contract.ts',right_export_name:'contract'},'shapes');
assert(compare.normalized_result.changes.some(c=>c.path==='/count'&&c.status==='removed'));
assert(compare.normalized_result.changes.some(c=>c.path==='/total'&&c.status==='added'));
const dynamic=await request('compare-javascript-export-shapes',{left,right,left_module_path:'dynamic.ts',left_export_name:'dynamic',right_module_path:'dynamic.ts',right_export_name:'dynamic'},'dynamic');
assert.equal(dynamic.normalized_result.coverage.status,'partial','Dynamic spread incorrectly presented as complete certainty');
const tampered=structuredClone(left);tampered.subject.digest.sha256='f'.repeat(64);
await request('trace-application-feature',{application:tampered,seed:{kind:'module',value:'index.ts'},direction:'outgoing'},'tampered',1);
const report={schema:'canyon.rea-static-trial/1',reaVersion:'6.7.0',targetExecution:false,checks:{connectedPath:true,orphanNotReachable:true,contractFieldRemoval:true,contractFieldAddition:true,dynamicUnknownRetained:true,tamperedEvidenceRefused:true},observations,limitations:['Static reachability is not proof of runtime execution or complete absence.','An earlier fixture with extensionless TypeScript import ./connected reported resolution_status:not-found; this trial uses explicit .ts paths. Analyze real build output or verify actual resolver coverage before asserting absence.','No native providers, runtime capture or Windows historical-source reader qualified.','No model calls; model cost and tokens not measured.']};
await writeFile(join(out,'trial-report.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify(report,null,2));
