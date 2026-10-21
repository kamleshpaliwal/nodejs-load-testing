export function checkInvariant({id,name,condition,expected,actual,context={}}) {
  return {id,name,passed:Boolean(condition),expected,actual,category:'functional',timestamp:new Date().toISOString(),...context};
}
export function versionTransition(before,after,expectedDelta=1) {
  return {valid:Number.isInteger(before)&&Number.isInteger(after)&&after===before+expectedDelta,expected:before+expectedDelta,actual:after};
}
export function detectDuplicateCommits(records) {
  const groups=new Map();
  for(const r of records.filter(x=>x.outcome==='committed')) {const k=r.operationId||`${r.runId}:${r.resourceId}:${r.operation}`;groups.set(k,(groups.get(k)||0)+1);}
  return [...groups].filter(([,n])=>n>1).map(([operationId,count])=>({operationId,count}));
}
