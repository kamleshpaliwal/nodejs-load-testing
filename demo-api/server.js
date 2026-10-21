import http from 'node:http';
import crypto from 'node:crypto';

const items=new Map(), idem=new Map(), audit=[]; let sequence=0;
const testEnabled=process.env.DEMO_TEST_ENDPOINTS !== '0';
const json=(res,status,data,headers={})=>{res.writeHead(status,{'content-type':'application/json',...headers});res.end(data===null?'':JSON.stringify(data));};
const readBody=req=>new Promise((resolve,reject)=>{let raw='';req.on('data',c=>{raw+=c;if(raw.length>1e6)reject(Error('body too large'));});req.on('end',()=>{try{resolve(raw?JSON.parse(raw):{});}catch{reject(Error('invalid JSON'));}});});
const log=(req,type,outcome,id,before,after,reason)=>audit.push({runId:req.headers['x-run-id']||null,operationId:req.headers['x-operation-id']||null,resourceId:id,operation:type,outcome,idempotencyFingerprint:req.headers['idempotency-key']?crypto.createHash('sha256').update(req.headers['idempotency-key']).digest('hex').slice(0,16):null,committedAt:new Date().toISOString(),versionBefore:before,versionAfter:after,sequence:++sequence,reason});
const server=http.createServer(async(req,res)=>{
  const u=new URL(req.url,'http://localhost'); const delay=Number(u.searchParams.get('delay')||req.headers['x-test-delay-ms']||0);
  if(testEnabled&&delay>0) await new Promise(r=>setTimeout(r,Math.min(delay,10000)));
  if(testEnabled&&u.searchParams.get('fail')) return json(res,500,{error:'injected failure'});
  res.setHeader('x-correlation-id',req.headers['x-correlation-id']||crypto.randomUUID());
  if(req.method==='GET'&&u.pathname==='/health') return json(res,200,{ok:true});
  if(testEnabled&&req.method==='GET'&&u.pathname==='/__test/audit') {const runId=u.searchParams.get('runId');return json(res,200,{events:audit.filter(x=>!runId||x.runId===runId)});}
  if(testEnabled&&req.method==='GET'&&u.pathname==='/__test/metrics') return json(res,200,{itemCount:items.size,auditCount:audit.length,sequence});
  if(req.method==='POST'&&u.pathname==='/api/items') {
    const body=await readBody(req); const key=req.headers['idempotency-key']; const fingerprint=crypto.createHash('sha256').update(JSON.stringify(body)).digest('hex');
    if(key&&idem.has(key)){const prev=idem.get(key); if(prev.fingerprint!==fingerprint)return json(res,409,{error:'idempotency key payload mismatch'}); return json(res,prev.status,prev.response,{ 'idempotency-replayed':'true' });}
    const id=crypto.randomUUID(), item={...body,id,version:1}; items.set(id,item); log(req,'create','committed',id,null,1);
    const response={item}; if(key)idem.set(key,{fingerprint,status:201,response}); return json(res,201,response,{etag:'"1"'});
  }
  const match=u.pathname.match(/^\/api\/items\/([^/]+)$/); if(match){const id=decodeURIComponent(match[1]),item=items.get(id);
    if(req.method==='GET')return item?json(res,200,{item},{etag:`"${item.version}"`}):json(res,404,{error:'not found'});
    if(req.method==='PUT'||req.method==='PATCH'){
      const body=await readBody(req); const before=item?.version??null;
      if(!item){log(req,'update','rejected',id,before,before,'not_found');return json(res,404,{error:'not found'});}
      const condition=req.headers['if-match']; if(condition&&condition!==`"${item.version}"`){log(req,'update','rejected',id,before,before,'stale_version');return json(res,412,{error:'stale version',version:item.version},{etag:`"${item.version}"`});}
      const next=req.method==='PUT'?{...body,id,version:item.version+1}:{...item,...body,id,version:item.version+1}; items.set(id,next);log(req,req.method.toLowerCase(),'committed',id,before,next.version);return json(res,200,{item:next},{etag:`"${next.version}"`});
    }
    if(req.method==='DELETE'){if(!item)return json(res,404,{error:'not found'});items.delete(id);log(req,'delete','committed',id,item.version,null);res.writeHead(204);return res.end();}
  }
  json(res,404,{error:'not found'});
});
const port=Number(process.env.PORT||3000); server.listen(port,'127.0.0.1',()=>console.log(JSON.stringify({event:'demo-listening',url:`http://127.0.0.1:${port}`,testEndpoints:testEnabled})));
for(const sig of ['SIGINT','SIGTERM'])process.on(sig,()=>server.close(()=>process.exit(0)));
