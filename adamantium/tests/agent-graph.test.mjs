import test from 'node:test';
import {strict as assert} from 'node:assert';
import {createServer} from 'node:http';
import {once} from 'node:events';
import {AgentGraphService} from '../agent-gateway/service.mjs';
import {createAgentGateway} from '../agent-gateway/server.mjs';
import {createNodeRedInspector} from '../node-red-adapter/inspect.mjs';
import {templateFlow,validateSafeFlow,simulateSafeFlow} from '../graph-schema/safe-flow.mjs';
import {runDemo} from '../graph-cli/cli.mjs';

test('one text command produces draft, validates, simulates and rolls back',()=>{
  const result=runDemo('собери безопасный тестовый граф');
  assert.equal(result.result,'passed');
  assert.equal(result.after.revision,2);
  assert.equal(result.after.graph,null);
  assert.equal(result.patch.deployment,'none');
  assert.equal(result.testing.result.runtime,'not-node-red');
  assert.equal(result.live_node_red_changes,0);
  assert.throws(()=>runDemo('выполни shell rm -rf /'),
    /unsupported_agent_command/);
});
test('CAS, idempotency, history and deny-by-default deployment',()=>{
  const service=new AgentGraphService();
  const graph=templateFlow('test payload','case1');
  assert.deepEqual(validateSafeFlow(graph),{
    ok:true,nodes:4,edges:2,disabled:true});
  const first={op:'graph.patch',graph,base_revision:0,
    idempotency_key:'stable_key_012345'};
  const accepted=service.dispatch(first);
  assert.equal(accepted.revision,1);
  assert.deepEqual(service.dispatch(first),accepted);
  const changed=structuredClone(graph);
  changed[2].rules[0].to='changed';
  assert.throws(()=>service.dispatch({...first,graph:changed}),
    e=>e.status===409&&e.code==='idempotency_key_conflict');
  assert.throws(()=>service.dispatch({
    op:'graph.patch',graph,base_revision:0,
    idempotency_key:'another_key_012345'}),
    e=>e.status===409&&e.code==='version_mismatch');
  assert.equal(service.dispatch({op:'graph.inspect'}).graph[2].rules[0].to,
    'test payload');
  assert.equal(service.dispatch({op:'graph.test',base_revision:1})
    .result.outputs[0].value,'test payload');
  assert.throws(()=>service.dispatch({op:'graph.deploy'}),
    e=>e.status===403&&e.code==='deployment_requires_separate_signed_lifecycle');
  assert.equal(service.dispatch({op:'graph.explain'}).audit.length,1);
  assert.equal(service.dispatch({op:'graph.rollback',
    target_revision:0,base_revision:1,
    idempotency_key:'revert_key_12345'}).revision,2);
  assert.equal(service.dispatch({op:'graph.inspect'}).graph,null);
  assert.throws(()=>service.dispatch({op:'graph.test',base_revision:1}),
    e=>e.status===409);
});
test('scripting, network, unsafe timed inject and permission injection denied',()=>{
  const valid=templateFlow();
  const mutations=[
    f=>{f[2].type='function';f[2].func='return msg;';},
    f=>{f[1].repeat='1';},
    f=>{f[1].once=true;},
    f=>{f[0].disabled=false;},
    f=>{f[3].console=true;},
    f=>{f[2].rules[0].p='__proto__';},
    f=>{f[2].rules[0].tot='jsonata';},
    f=>{f[1].url='https://example.com';},
    f=>{f[3].wires=[['i_r01']];},
    f=>{f[1].credentials={apiKey:'fake'};},
    f=>{f[1].type='http request';},
    f=>{f[1].wires=[['d_r01']];}
  ];
  for(const mutate of mutations){
    const graph=structuredClone(valid);mutate(graph);
    assert.throws(()=>validateSafeFlow(graph));
  }
  assert.equal(simulateSafeFlow(valid).executed_external_actions,false);
});
test('authenticated loopback Agent Graph HTTP operations',async()=>{
  const token='a-valid-temporary-test-token-of-40-characters';
  const app=createAgentGateway({token});
  app.listen(0,'127.0.0.1');
  await once(app,'listening');
  const base='http://127.0.0.1:'+app.address().port;
  const call=(op,authorized=true)=>fetch(base+'/agent/graph',{
    method:'POST',headers:{'Content-Type':'application/json',
      ...(authorized?{Authorization:'Bearer '+token}:{})},
    body:JSON.stringify(op)});
  try{
    assert.equal((await call({op:'graph.inspect'},false)).status,401);
    const created=await call({op:'graph.patch',
      graph:templateFlow('http case','http1'),base_revision:0,
      idempotency_key:'http_graph_patch_1'});
    assert.equal(created.status,200);
    assert.equal((await created.json()).result.revision,1);
    const testRun=await call({op:'graph.test',base_revision:1});
    assert.equal((await testRun.json()).result.result.runtime,'not-node-red');
    const denied=await call({op:'graph.deploy'});
    assert.equal(denied.status,403);
    const rolled=await call({op:'graph.rollback',base_revision:1,
      target_revision:0,idempotency_key:'http_graph_rollback_1'});
    assert.equal((await rolled.json()).result.revision,2);
    assert.equal((await call({op:'graph.inspect'})).status,200);
  } finally {await new Promise(resolve=>app.close(resolve));}
});
test('Node-RED v2 inspector is read-only and never exposes node payloads',async()=>{
  const secret='opaque-secret-do-not-expose',token='local-node-red-test-token-123456789';
  let methods=[];
  const fixture=createServer((req,res)=>{
    methods.push(req.method);
    if(req.method!=='GET'||req.url!='/flows'||
       req.headers.authorization!=='Bearer '+token||
       req.headers['node-red-api-version']!=='v2'){
      res.writeHead(403);res.end('denied');return;
    }
    res.setHeader('Content-Type','application/json');
    res.end(JSON.stringify({rev:'abc123',flows:[
      {id:'test1',type:'tab',secret,credentials:{password:'private'}},
      {id:'node2',type:'function',func:'process.exit()'}
    ]}));
  });
  fixture.listen(0,'127.0.0.1');await once(fixture,'listening');
  try{
    const inspector=createNodeRedInspector({
      baseUrl:'http://127.0.0.1:'+fixture.address().port+'/',
      operatorToken:token
    });
    const result=await inspector.inspect();
    assert.equal(result.upstream_revision,'abc123');
    assert.equal(result.node_count,2);
    assert.equal(JSON.stringify(result).includes(secret),false);
    assert.equal(JSON.stringify(result).includes('password'),false);
    assert.equal(result.authority,'read_only');
    assert.deepEqual(methods,['GET']);
  }finally{await new Promise(resolve=>fixture.close(resolve));}
  assert.throws(()=>createNodeRedInspector({
    baseUrl:'http://example.com:1880/',operatorToken:token}),
    /node_red_must_be_explicit_loopback/);
});
