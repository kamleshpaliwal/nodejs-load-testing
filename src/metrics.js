export function percentile(values, p) {
  if (!values.length) return null;
  const a = [...values].sort((x,y)=>x-y); const idx = (a.length - 1) * p;
  const lo = Math.floor(idx), hi = Math.ceil(idx); return a[lo] + (a[hi]-a[lo])*(idx-lo);
}
export function aggregate(events, scheduled, startedAt, endedAt) {
  const done = events.filter(e=>e.type==='scenario' && e.completedAt);
  const latency = done.map(e=>e.latencyMs); const errors = done.filter(e=>!e.ok).length;
  const timeouts = done.filter(e=>e.errorType==='timeout').length;
  const dur = Math.max((endedAt-startedAt)/1000, 0.001);
  return { scheduledScenarios: scheduled, startedScenarios: events.filter(e=>e.type==='scenario'&&e.startedAt).length,
    completedScenarios: done.length, failedScenarios: errors, droppedScenarios: Math.max(0,scheduled-done.length),
    scenarioRate: done.length/dur, latencyMs: latency.length ? { min:Math.min(...latency), max:Math.max(...latency), mean:latency.reduce((a,b)=>a+b,0)/latency.length, p50:percentile(latency,.5),p90:percentile(latency,.9),p95:percentile(latency,.95),p99:percentile(latency,.99),p999:percentile(latency,.999) } : null,
    errorRatePercent: done.length ? errors/done.length*100 : null,
    timeoutRatePercent: done.length ? timeouts/done.length*100 : null,
    httpRequests: events.filter(e=>e.type==='request').length,
    httpRequestsPerSecond: events.filter(e=>e.type==='request').length/dur };
}
export function evaluateSlo(summary, cfg) {
  const s=cfg.slo, checks=[];
  const add=(id,observed,limit,pass,why)=>checks.push({id,observed,limit,status:observed==null?'NOT_EVALUABLE':(pass?'PASS':'FAIL'),reason:why});
  if (summary.completedScenarios < (s.minSamples ?? 1)) checks.push({id:'minimum-samples',observed:summary.completedScenarios,limit:s.minSamples,status:'NOT_EVALUABLE',reason:'Insufficient completed scenarios for reliable threshold evaluation'});
  add('p95-latency',summary.latencyMs?.p95,s.p95LatencyMs,summary.latencyMs?.p95<=s.p95LatencyMs,'Scenario completion latency, milliseconds');
  add('error-rate',summary.errorRatePercent,s.maxErrorRatePercent,summary.errorRatePercent<=s.maxErrorRatePercent,'Failed scenario count / completed scenario count, percent');
  add('timeout-rate',summary.timeoutRatePercent,s.maxTimeoutRatePercent,summary.timeoutRatePercent<=s.maxTimeoutRatePercent,'Timed-out scenarios / completed scenario count, percent');
  add('scenario-throughput',summary.scenarioRate,s.minScenariosPerSecond,summary.scenarioRate>=s.minScenariosPerSecond,'Completed scenarios / measurement seconds');
  add('dropped-arrivals',summary.scheduledScenarios?summary.droppedScenarios/summary.scheduledScenarios*100:null,s.maxDroppedArrivalPercent,summary.scheduledScenarios?summary.droppedScenarios/summary.scheduledScenarios*100<=s.maxDroppedArrivalPercent:null,'Dropped scheduled scenarios / scheduled scenarios, percent');
  return {checks, verdict:checks.some(x=>x.status==='FAIL')?'FAIL':checks.some(x=>x.status==='NOT_EVALUABLE')?'NOT_EVALUABLE':'PASS'};
}
