// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {AgentGraphService} from "../../adamantium/agent-gateway/service.mjs";
import {demoGraph} from "../../adamantium/graph-schema/agent-graph.mjs";

const command={text:"Собери тестовый граф",base_revision:0,
  idempotency_key:"agent-command-0001"};
test("single command builds, validates, tests and exports a disabled Node-RED flow",()=>{
  const agent=new AgentGraphService();
  const result=agent.invoke("graph.bootstrap",command);
  assert.equal(result.ok,true);
  assert.equal(result.patch.revision,1);
  assert.equal(result.test.passed,true);
  assert.deepEqual(result.test.results,[{node:"sink",value:"verified"}]);
  assert.equal(result.nodeRedPreview.disabledByDefault,true);
  assert.equal(result.nodeRedPreview.appliedToNodeRed,false);
  assert.equal(agent.invoke("graph.inspect").revision,1);
  assert.equal(agent.invoke("graph.explain").authorityGranted,false);
  assert.deepEqual(agent.invoke("graph.bootstrap",command),result);
  assert.equal(agent.inspect().journalLength,1);
});
test("stale revision and idempotency payload collision fail without mutations",()=>{
  const agent=new AgentGraphService();
  agent.bootstrap(command);
  assert.throws(()=>agent.patch({graph:demoGraph(2),
    base_revision:0,idempotency_key:"first-patch"}),/revision_conflict/);
  const updated=demoGraph(2);
  const receipt=agent.patch({graph:updated,base_revision:1,
    idempotency_key:"first-patch"});
  assert.equal(receipt.revision,2);
  assert.deepEqual(agent.patch({graph:updated,base_revision:1,
    idempotency_key:"first-patch"}),receipt);
  const changed=demoGraph(2);
  changed.nodes[1].id="renamed";
  assert.throws(()=>agent.patch({graph:changed,base_revision:1,
    idempotency_key:"first-patch"}),/idempotency_payload_conflict/);
  assert.equal(agent.inspect().revision,2);
});
test("rollback restores previous verified graph under monotonic revision",()=>{
  const agent=new AgentGraphService();
  agent.bootstrap(command);
  const next=demoGraph(2);next.nodes[0].id="start";
  next.edges[0].fromNode="start";
  agent.patch({graph:next,base_revision:1,idempotency_key:"update-graph"});
  const restored=agent.rollback({base_revision:2,idempotency_key:"rollback-a"});
  assert.equal(restored.revision,3);
  assert.equal(agent.inspect().graph.nodes[0].id,"source");
  assert.equal(agent.inspect().graph.revision,3);
  assert.throws(()=>agent.patch({graph:demoGraph(3),base_revision:2,
    idempotency_key:"stale-actor"}),/revision_conflict/);
});
test("deploy never touches Node-RED: forbidden by default, simulation if opted in",()=>{
  const standard=new AgentGraphService();
  standard.bootstrap(command);
  assert.throws(()=>standard.deploy({base_revision:1,idempotency_key:"deploy-0001"}),
    /deployment_not_authorized/);
  const sandbox=new AgentGraphService({sandbox:true});
  sandbox.bootstrap(command);
  const result=sandbox.deploy({base_revision:1,idempotency_key:"deploy-0001"});
  assert.equal(result.simulated,true);
  assert.equal(result.nodeRedRuntimeStarted,false);
  assert.equal(result.productionDeployment,false);
  assert.equal(sandbox.inspect().sandboxActive.revision,1);
  sandbox.rollback({base_revision:1,idempotency_key:"rollback-0001"});
  assert.equal(sandbox.inspect().sandboxActive,null);
});
test("no arbitrary operation or credentials permitted",()=>{
  const agent=new AgentGraphService();
  assert.throws(()=>agent.invoke("shell.exec",{command:"whoami"}),/unknown_operation/);
  const graph=demoGraph();graph.nodes[0].credentials={token:"private"};
  assert.throws(()=>agent.patch({graph,base_revision:0,
    idempotency_key:"write-invalid"}),/unsafe_or_duplicate_node/);
  assert.equal(agent.inspect().revision,0);
});
