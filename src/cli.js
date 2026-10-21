import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import crypto from 'node:crypto';
import { performance, monitorEventLoopDelay } from 'node:perf_hooks';
import { parseArgs,loadConfig,redactConfig } from './config.js';
import { crudScenario } from './scenario.js';
import { aggregate,evaluateSlo } from './metrics.js';

const args=parseArgs(process.argv.slice(2));
if(args.help){console.log('Usage: npm run loadtest -- [--config file] [--target URL] [--rps N] [--duration N] [--concurrency N] [--seed N] [--allow-non-local] [--destructive]');process.exit(0);}
const cfg=loadConfig(args); const runId=`run-${new Date().toISOString().replace(/[:.]/g,'-')}-${crypto.randomBytes(3).toString('hex')}`;
const out=path.resolve('results',runId); fs.mkdirSync(out,{recursive:true});
const startedWall=new Date().toISOString(), start=performance.now(), events=[], assertions=[], errors=[], resourceIds=new Set();
const eventDelay=monitorEventLoopDelay({resolution:20});eventDelay.enable(); const eluStart=performance.eventLoopUtilization();
console.log(JSON.stringify({event:'loadtest-start',runId,target:redactConfig(cfg).target,scenarioRate:cfg.scenarioRate,durationSeconds:cfg.durationSeconds,concurrency:cfg.concurrency,seed:cfg.seed,destructive:cfg.destructive,slo:cfg.slo,output:out}));
let scheduled=0, active=0, peak=0, halted=false, schedDelays=[]; const tasks=new Set();
const measureStart=performance.now(), deadline=measureStart+cfg.durationSeconds*1000, interval=1000/cfg.scenarioRate;
let next=measureStart;
while(cfg.scenarioRate>0 && next<deadline && !halted){
  const wait=next-performance.now(); if(wait>0) await new Promise(r=>setTimeout(r,wait));
  if(performance.now()>=deadline)break;
  const index=scheduled++; const due=next; next+=interval;
  const delay=Math.max(0,performance.now()-due); schedDelays.push(delay);
  if(active>=cfg.concurrency){events.push({type:'scenario',runId,scenarioId:'crud',scheduledAt:due,startedAt:null,completedAt:null,dropped:true,schedulingDelayMs:delay});continue;}
  active++; peak=Math.max(peak,active);
  const task=(async()=>{const began=performance.now();let result;try{result=await crudScenario({cfg,runId,index,events,resourceIds});}catch(e){result={ok:false,error:e.message,operationId:`${runId}-${index}`};}
    const completed=performance.now(); const ev={type:'scenario',runId,scenarioId:'crud',operationId:result.operationId,resourceId:result.resourceId,dataFingerprint:result.dataFingerprint,scheduledAt:due,startedAt:began,completedAt:completed,latencyMs:completed-due,serviceDurationMs:completed-began,schedulingDelayMs:Math.max(0,began-due),ok:result.ok,error:result.error||null,requestCount:result.requests||0};events.push(ev);if(!result.ok)errors.push({category:'scenario',operationId:result.operationId,message:result.error});
    assertions.push({id:'crud-lifecycle',name:'CRUD lifecycle invariants',runId,scenarioId:'crud',operationId:result.operationId,resourceId:result.resourceId,passed:Boolean(result.ok),expected:'create/read/update/read/delete/not-found',actual:result.ok?'all steps satisfied':result.error,category:'functional',timestamp:new Date().toISOString()});
    active--;})(); tasks.add(task);task.finally(()=>tasks.delete(task));
}
const measurementEnd=deadline; const drainUntil=performance.now()+cfg.drainTimeoutMs;
while(tasks.size&&performance.now()<drainUntil)await Promise.race([Promise.allSettled([...tasks]),new Promise(r=>setTimeout(r,20))]);
halted=tasks.size>0; const completedAt=new Date().toISOString(); eventDelay.disable();
if(halted)errors.push({category:'drain-timeout',message:`${tasks.size} scenarios still in flight after drain timeout`});
const summary=aggregate(events,scheduled,measureStart,measurementEnd); summary.peakConcurrentScenarios=peak;summary.maxSchedulingDelayMs=schedDelays.length?Math.max(...schedDelays):null;summary.eventLoopDelayMs={mean:eventDelay.mean/1e6,max:eventDelay.max/1e6,p99:eventDelay.percentile(99)/1e6}; summary.generator={memoryBytes:process.memoryUsage().rss,eventLoopUtilization:performance.eventLoopUtilization(eluStart).utilization,platform:process.platform};
const slo=evaluateSlo(summary,cfg); const perf=slo.verdict; const correctness=assertions.some(a=>!a.passed)?'FAIL':'PASS';
let auditVerification={status:'NOT_VERIFIABLE',reason:'Target does not provide an authoritative test audit endpoint'};
try{const r=await fetch(new URL(`/__test/audit?runId=${encodeURIComponent(runId)}`,cfg.target),{headers:cfg.headers,redirect:'manual'});if(r.ok){const records=(await r.json()).events;const committed=records.filter(x=>x.outcome==='committed');const expectedLogicalOperations=events.filter(x=>x.type==='scenario'&&x.completedAt).length*3;auditVerification={status:committed.length===expectedLogicalOperations?'PASS':'FAIL',records:records.length,committed:committed.length,expectedLogicalOperations,findings:committed.length===expectedLogicalOperations?[]:[`Expected ${expectedLogicalOperations} commits, observed ${committed.length}`]};}}catch{}
const cleanup={enabled:cfg.cleanup,attempted:false,status:'NOT_APPLICABLE',remainingResources:null};
if(cfg.cleanup&&resourceIds.size){cleanup.attempted=true;let deleted=0;for(const id of resourceIds){const r=await fetch(new URL(`/api/items/${encodeURIComponent(id)}`,cfg.target),{method:'DELETE',headers:{...cfg.headers,'x-run-id':runId,'x-operation-id':`${runId}-cleanup-${id}`},redirect:'manual'}).catch(()=>null);if(r?.status===204||r?.status===404)deleted++;}cleanup.remainingResources=resourceIds.size-deleted;cleanup.status=cleanup.remainingResources===0?'PASS':'FAIL';}
const manifest={runId,startedAt:startedWall,endedAt:completedAt,target:redactConfig(cfg).target,seed:cfg.seed,version:process.env.APP_VERSION||null,gitCommit:process.env.GIT_COMMIT||null,node:process.version,platform:process.platform,arch:process.arch,mode:'open-loop',schedulingPolicy:'fixed-rate scenario arrivals; overload drops arrivals at concurrency cap',phase:{id:'measurement',warmupSeconds:cfg.warmupSeconds,measurementSeconds:cfg.durationSeconds,drainTimeoutMs:cfg.drainTimeoutMs},effectiveConfig:redactConfig(cfg),namespace:cfg.namespace,artifacts:['manifest.json','events.jsonl','summary.json','phase-metrics.json','thresholds.json','assertions.json','audit-verification.json','errors.json','report.html'],verdict:{performance:perf,correctness,audit:auditVerification.status}};
summary.performanceVerdict=perf;summary.correctnessVerdict=correctness;summary.auditVerification=auditVerification.status;summary.cleanup=cleanup;
const phaseMetrics={samplingIntervalMs:1000,phases:[{id:'measurement',start:measureStart,end:measurementEnd,scheduled:summary.scheduledScenarios,completed:summary.completedScenarios,dropped:summary.droppedScenarios,requests:summary.httpRequests}]};
const write=(name,data)=>fs.writeFileSync(path.join(out,name),typeof data==='string'?data:JSON.stringify(data,null,2));
write('manifest.json',manifest);write('events.jsonl',events.map(x=>JSON.stringify(x)).join('\n')+'\n');write('summary.json',summary);write('phase-metrics.json',phaseMetrics);write('thresholds.json',slo);write('assertions.json',assertions);write('audit-verification.json',auditVerification);write('errors.json',errors.slice(0,100));
const html=`<!doctype html><meta charset="utf-8"><title>Load test ${runId}</title><style>body{font:15px system-ui;max-width:960px;margin:3rem auto;padding:0 1rem;color:#17202a}table{border-collapse:collapse}td,th{padding:.5rem;border:1px solid #ccd1d1;text-align:left}.pass{color:#087443}.fail{color:#b42318}</style><h1>REST API load test</h1><p>Run ${runId} · target ${manifest.target}</p><h2>Verdicts</h2><p>Performance: <b class="${perf.toLowerCase()}">${perf}</b> · Correctness: <b>${correctness}</b> · Audit: ${auditVerification.status}</p><h2>Summary</h2><pre>${JSON.stringify(summary,null,2)}</pre><h2>SLO checks</h2><table><tr><th>Check</th><th>Observed</th><th>Limit</th><th>Status</th></tr>${slo.checks.map(c=>`<tr><td>${c.id}</td><td>${c.observed??'n/a'}</td><td>${c.limit}</td><td>${c.status}</td></tr>`).join('')}</table><h2>Audit verification</h2><pre>${JSON.stringify(auditVerification,null,2)}</pre><h2>Errors</h2><pre>${JSON.stringify(errors.slice(0,25),null,2)}</pre><h2>Cleanup</h2><pre>${JSON.stringify(cleanup,null,2)}</pre>`;write('report.html',html);
console.log(JSON.stringify({event:'loadtest-complete',runId,performance:perf,correctness,audit:auditVerification.status,scheduled:summary.scheduledScenarios,completed:summary.completedScenarios,dropped:summary.droppedScenarios,requests:summary.httpRequests,latencyMs:summary.latencyMs,output:out}));
if(perf==='FAIL'||correctness==='FAIL'||auditVerification.status==='FAIL'||cleanup.status==='FAIL')process.exitCode=1;
