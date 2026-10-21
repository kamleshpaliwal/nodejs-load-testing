import test from 'node:test';
import assert from 'node:assert/strict';
import {spawn} from 'node:child_process';
import {setTimeout as sleep} from 'node:timers/promises';

const port=Number(process.env.TEST_PORT||32177), base=`http://127.0.0.1:${port}`;
let child;
test('demo API CRUD, idempotency, audit, and stale-version races',async()=>{
  child=spawn(process.execPath,['demo-api/server.js'],{env:{...process.env,PORT:String(port)},stdio:'ignore'});
  try {
  let ready=false;for(let i=0;i<100;i++){try{if((await fetch(`${base}/health`)).ok){ready=true;break;}}catch{}await sleep(30);}assert.equal(ready,true,'demo server starts');
  const headers={'content-type':'application/json','x-run-id':'integration-run','x-operation-id':'create-1'};
  const payload={name:'one',value:1,runId:'integration-run'};
  const [a,b]=await Promise.all([1,2].map(()=>fetch(`${base}/api/items`,{method:'POST',headers:{...headers,'idempotency-key':'same'},body:JSON.stringify(payload)})));
  assert.equal(a.status,201);assert.equal(b.status,201);assert.equal(a.headers.get('idempotency-replayed')||b.headers.get('idempotency-replayed'),'true');
  const created=await a.json(), id=created.item.id;
  const mismatch=await fetch(`${base}/api/items`,{method:'POST',headers:{...headers,'idempotency-key':'same'},body:JSON.stringify({...payload,value:2})});assert.equal(mismatch.status,409);
  const staleHeaders={...headers,'if-match':'"1"'};
  const updates=await Promise.all([1,2].map(n=>fetch(`${base}/api/items/${id}`,{method:'PATCH',headers:staleHeaders,body:JSON.stringify({value:n+5})})));
  assert.deepEqual(updates.map(x=>x.status).sort(),[200,412]);
  const item=await (await fetch(`${base}/api/items/${id}`)).json();assert.equal(item.item.version,2);
  const audit=await (await fetch(`${base}/__test/audit?runId=integration-run`)).json();assert.equal(audit.events.filter(e=>e.outcome==='committed').length,2);
  assert.equal((await fetch(`${base}/api/items/${id}`,{method:'DELETE'})).status,204);
  } finally {child?.kill('SIGTERM');child=null;}
});
