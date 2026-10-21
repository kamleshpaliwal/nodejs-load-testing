import { performance } from 'node:perf_hooks';
import crypto from 'node:crypto';
import { makeItem } from './data.js';

export async function request(base, method, pathname, { body, headers={}, timeoutMs=3000, fetchImpl=fetch }={}) {
  const started=performance.now(); const controller=new AbortController(); const timer=setTimeout(()=>controller.abort(),timeoutMs);
  try { const res=await fetchImpl(new URL(pathname,base),{method,headers:{'content-type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body),signal:controller.signal,redirect:'manual'}); const text=await res.text(); let data; try{data=text?JSON.parse(text):null}catch{data=text}
    return {status:res.status,data,latencyMs:performance.now()-started,headers:Object.fromEntries(res.headers)};
  } catch(e) { return {status:null,data:null,latencyMs:performance.now()-started,error:e.name==='AbortError'?'timeout':e.message,errorType:e.name==='AbortError'?'timeout':'network'}; }
  finally {clearTimeout(timer);}
}

export async function crudScenario({cfg,runId,index,phaseId='measurement',events,resourceIds}) {
  const opId=`${runId}-${index}`; const correlationId=opId; const headers={...cfg.headers,'x-run-id':runId,'x-operation-id':opId,'x-correlation-id':correlationId};
  const item=makeItem(cfg.seed,index,cfg.namespace); let id=null, ok=true, error=null, count=0;
  const call=async(method,path,body,expected)=>{const r=await request(cfg.target,method,path,{body,headers,timeoutMs:cfg.requestTimeoutMs}); count++;
    events.push({type:'request',runId,phaseId,scenarioId:'crud',operationId:opId,requestId:`${opId}-${count}`,method,endpoint:path,completedAt:new Date().toISOString(),latencyMs:r.latencyMs,status:r.status,error:r.error||null,errorType:r.errorType||null});
    if(r.status!==expected){ok=false;error=error||`Expected ${expected}, got ${r.status}: ${JSON.stringify(r.data)}`;} return r;};
  let r=await call('POST','/api/items',{...item,runId,namespace:cfg.namespace},201); id=r.data?.item?.id;
  if(id) resourceIds.add(id); else {ok=false;error=error||'Create response did not contain item.id';}
  if(id){ r=await call('GET',`/api/items/${encodeURIComponent(id)}`,undefined,200); if(JSON.stringify(r.data?.item)!==JSON.stringify({...item,runId,namespace:cfg.namespace,id,version:1})) { /* compare relevant fields below */ if(r.data?.item?.name!==item.name||r.data?.item?.value!==item.value) {ok=false;error=error||'Read-after-create state mismatch';} }
    const updated={value:item.value+1}; r=await call('PATCH',`/api/items/${encodeURIComponent(id)}`,updated,200); if(r.data?.item?.value!==updated.value){ok=false;error=error||'PATCH did not commit expected value';}
    r=await call('GET',`/api/items/${encodeURIComponent(id)}`,undefined,200); if(r.data?.item?.value!==updated.value){ok=false;error=error||'Read-after-update mismatch';}
    r=await call('DELETE',`/api/items/${encodeURIComponent(id)}`,undefined,204);
    r=await call('GET',`/api/items/${encodeURIComponent(id)}`,undefined,404);
  }
  return {ok,error,operationId:opId,resourceId:id,requests:count,dataFingerprint:crypto.createHash('sha256').update(JSON.stringify(item)).digest('hex').slice(0,16)};
}
