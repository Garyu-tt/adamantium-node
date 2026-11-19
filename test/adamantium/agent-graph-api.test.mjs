import test from 'node:test';
import assert from 'node:assert/strict';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {NodeRedV2} from '../../adamantium/node-red-adapter/client.mjs';
import {AgentGraphGateway} from '../../adamantium/agent-gateway/gateway.mjs';

const TOKEN='local-disposable-fixture-token-1234567890';
async function fixture() {
  let rev=1,flows=[],writes=0,unauthorized=false,forceConflict=false;
  const server=createServer(async(req,res)=>{
    const send=(status,value)=>{
      res.writeHead(status,{'Content-Type':'application/json'});
      res.end(JSON.stringify(value));
    };
    if(req.url!=='/flows' || !['GET','POST'].includes(req.method))
      return send(404,{error:'missing'});
    if(unauthorized || req.headers.authorization!=='Bearer '+TOKEN)
      return send(401,{error:'secret not to be returned'});
    if(req.headers['node-red-api-version']!=='v2')
      return send(400,{error:'wrong api version'});
    if(req.method==='GET')return send(200,{rev:'r'+rev,flows});
    if(req.headers['node-red-deployment-type']!=='nodes')
      return send(400,{error:'wrong deployment type'});
    let body='';
    for await (const chunk of req){
      body+=chunk;
      if(body.length>256*1024)return send(413,{error:'too big'});
    }
    let submitted;
    try{submitted=JSON.parse(body)}catch{return send(400,{error:'bad json'})}
    if(forceConflict || submitted.rev!=='r'+rev)
      return send(409,{code:'version_mismatch'});
    if(!Array.isArray(submitted.flows))
      return send(400,{error:'bad flows'});
    writes++;
    flows=structuredClone(submitted.flows);
    rev++;
    return send(200,{rev:'r'+rev});
  });
  server.listen(0,'127.0.0.1');
  await once(server,'listening');
  const port=server.address().port;
  const client=new NodeRedV2({
    baseURL:'http://127.0.0.1:'+port+'/',bearerToken:TOKEN
  });
  return {
    client,
    close:()=>new Promise((resolve,reject)=>
      server.close(error=>error?reject(error):resolve())),
    state:()=>({rev:'r'+rev,flows:structuredClone(flows),writes}),
    mutate(value){rev++;flows=structuredClone(value)},
    unauthorized(v){unauthorized=v},
    conflict(v){forceConflict=v}
  };
}

test('agent graph R01: draft, validate, test, guarded deploy, CAS rollback',async()=>{
  const fake=await fixture();
  try{
    const gateway=new AgentGraphGateway({
      client:fake.client,writesEnabled:true // trusted test harness only
    });
    assert.deepEqual(await gateway.invoke({operation:'graph.inspect'}),{
      operation:'graph.inspect',revision:'r1',count:0,nodes:[]
    });
    const patch={operation:'graph.patch',idempotency_key:'build-demo-0001',
      base_revision:'r1',note:'Verified agent bootstrap R01'};
    const draft=await gateway.invoke(patch);
    assert.equal(draft.status,'draft_only');
    assert.equal(draft.authorized,false);
    assert.equal(draft.executed,false);
    assert.equal(fake.state().writes,0);
    assert.deepEqual(await gateway.invoke(patch),draft);
    await assert.rejects(
      gateway.invoke({...patch,note:'Different note'}),
      /idempotency_key_conflict/);
    const validated=await gateway.invoke({
      operation:'graph.validate',draft_id:draft.draft_id
    });
    assert.equal(validated.valid,true);
    assert.equal(validated.disabled,true);
    const tested=await gateway.invoke({
      operation:'graph.test',draft_id:draft.draft_id
    });
    assert.equal(tested.passed,true);
    assert.equal(tested.mode,'static_contract_only');
    assert.equal(tested.executed,false);
    const explained=await gateway.invoke({
      operation:'graph.explain',draft_id:draft.draft_id
    });
    assert.equal(explained.will_run,false);
    const approval={operation:'graph.deploy',draft_id:draft.draft_id,
      idempotency_key:'deploy-demo-0001'};
    const applied=await gateway.invoke(approval);
    assert.equal(applied.status,'applied_to_sandbox');
    assert.equal(fake.state().writes,1);
    assert.equal(fake.state().flows.length,2);
    assert.equal(fake.state().flows[0].disabled,true);
    assert.equal(fake.state().flows[1].type,'comment');
    assert.deepEqual(await gateway.invoke(approval),applied);
    assert.equal(fake.state().writes,1,'replay must not issue another POST');
    const inspected=await gateway.invoke({operation:'graph.inspect'});
    assert.equal(inspected.count,2);
    assert.equal(JSON.stringify(inspected).includes('Verified agent'),false);
    const rollback={operation:'graph.rollback',
      receipt_id:applied.receipt_id,idempotency_key:'rollback-demo-0001'};
    const result=await gateway.invoke(rollback);
    assert.equal(result.status,'rolled_back_and_verified');
    assert.equal(fake.state().writes,2);
    assert.deepEqual(fake.state().flows,[]);
    assert.deepEqual(await gateway.invoke(rollback),result);
    assert.equal(fake.state().writes,2);
    await assert.rejects(
      gateway.invoke({operation:'graph.rollback',receipt_id:applied.receipt_id,
        idempotency_key:'rollback-demo-0002'}),/receipt_already_rolled_back/);
  }finally{await fake.close()}
});

test('agent graph R01 fails closed on approval, unsafe edits and stale rev',async()=>{
  const fake=await fixture();
  try{
    const noWrite=new AgentGraphGateway({client:fake.client});
    const draft=await noWrite.invoke({
      operation:'graph.patch',idempotency_key:'build-demo-0002',
      base_revision:'r1',note:'Disabled lab graph'
    });
    await noWrite.invoke({operation:'graph.test',draft_id:draft.draft_id});
    await assert.rejects(noWrite.invoke({operation:'graph.deploy',
      draft_id:draft.draft_id,idempotency_key:'deploy-demo-0002'}),
    /sandbox_write_grant_required/);
    assert.equal(fake.state().writes,0);

    const gateway=new AgentGraphGateway({client:fake.client,
      writesEnabled:true});
    const draft2=await gateway.invoke({operation:'graph.patch',
      idempotency_key:'build-demo-0003',
      base_revision:'r1',note:'Will be stale'});
    await assert.rejects(gateway.invoke({operation:'graph.deploy',
      draft_id:draft2.draft_id,idempotency_key:'deploy-demo-0003'}),
    /tested_draft_required/);
    await gateway.invoke({operation:'graph.test',draft_id:draft2.draft_id});
    fake.mutate([{id:'external',type:'exec',command:'unsafe'}]);
    await assert.rejects(gateway.invoke({operation:'graph.deploy',
      draft_id:draft2.draft_id,idempotency_key:'deploy-demo-0004'}),
    /stale_revision_or_content/);
    await assert.rejects(gateway.invoke({operation:'graph.patch',
      idempotency_key:'build-demo-0004',
      base_revision:'r2',note:'No existing flows may be overwritten'}),
    /non_isolated_or_unsafe_graph/);
    await assert.rejects(gateway.invoke({operation:'graph.patch',
      idempotency_key:'build-demo-0005',
      base_revision:'r2',note:'<script>'}),
    /invalid_patch_input/);
    await assert.rejects(gateway.invoke({operation:'graph.mint-grant'}),
    /unsupported_graph_operation/);
    assert.equal(fake.state().writes,0);
  }finally{await fake.close()}
});

test('Node-RED v2 transport never accepts remote endpoints or leaks bearer',async()=>{
  assert.throws(()=>new NodeRedV2({
    baseURL:'http://example.org:1880/',bearerToken:TOKEN
  }),/loopback_only_endpoint/);
  assert.throws(()=>new NodeRedV2({
    baseURL:'http://127.0.0.1:1880/evil',bearerToken:TOKEN
  }),/loopback_only_endpoint/);
  assert.throws(()=>new NodeRedV2({
    baseURL:'http://127.0.0.1:1880/',bearerToken:'123'
  }),/bearer_token_required/);
  const fake=await fixture();
  try{
    fake.unauthorized(true);
    await assert.rejects(fake.client.getFlows(),e=>{
      assert.equal(e.code,'node_red_authorization_denied');
      assert.equal(e.message.includes(TOKEN),false);
      return true;
    });
    fake.unauthorized(false);
    fake.conflict(true);
    await assert.rejects(fake.client.setFlows({rev:'r1',flows:[]}),
      /stale_revision/);
    assert.equal(fake.state().writes,0);
  }finally{await fake.close()}
});

test('two concurrent writers: server-side rev fences the losing writer',async()=>{
  const fake=await fixture();
  try {
    const snapshot=await fake.client.getFlows();
    const [a,b]=await Promise.allSettled([
      fake.client.setFlows({rev:snapshot.rev,flows:[]}),
      fake.client.setFlows({rev:snapshot.rev,flows:[]})
    ]);
    assert.equal([a,b].filter(x=>x.status==='fulfilled').length,1);
    assert.equal([a,b].filter(x=>x.status==='rejected').length,1);
    assert.equal(fake.state().writes,1);
  }finally{await fake.close()}
});
