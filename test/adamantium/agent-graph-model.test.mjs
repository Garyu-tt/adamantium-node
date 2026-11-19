// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {demoGraph,validateGraph,synthesize}
  from "../../adamantium/graph-schema/agent-graph.mjs";
const clone=x=>JSON.parse(JSON.stringify(x));

test("canonical G0 test graph is typed and DAG-valid",()=>{
  const graph=demoGraph();
  assert.equal(graph.schema,"mechanicus.universal-graph/1");
  assert.deepEqual(validateGraph(graph).order,["source","transform","sink"]);
  assert.equal(graph.edges.length,2);
});
test("fail closed for arbitrary executable Node-RED function, exec, permission",()=>{
  const g=demoGraph();g.nodes[1].typeRef="node-red.exec@1";
  assert.throws(()=>validateGraph(g),/unsafe_or_duplicate_node/);
  const h=demoGraph();h.edges[0].semantics="permission";
  assert.throws(()=>validateGraph(h),/unsafe_or_duplicate_edge/);
  const x=demoGraph();x.nodes[0].credentials={password:"no"};
  assert.throws(()=>validateGraph(x),/unsafe_or_duplicate_node/);
});
test("wrong port contract, orphan and instantaneous cycles are rejected",()=>{
  const g=demoGraph();g.edges[0].toPort="unknown";
  assert.throws(()=>validateGraph(g),/incompatible_typed_edge/);
  const h=demoGraph();h.edges[0].fromNode="unknown";
  assert.throws(()=>validateGraph(h),/unsafe_or_duplicate_edge/);
  const x=demoGraph();x.edges.push({id:"feedback",fromNode:"transform",
    fromPort:"out",toNode:"transform",toPort:"in",semantics:"data",delayTicks:0});
  assert.throws(()=>validateGraph(x),/instantaneous_cycle/);
});
test("bounded text command is recognized but not arbitrary instructions",()=>{
  const graph=synthesize("Собери тестовый граф",7);
  assert.equal(graph.revision,7);
  assert.throws(()=>synthesize("Выполни powershell"),/unsupported_agent_intent/);
  assert.throws(()=>synthesize("Создай тестовый граф "+("x".repeat(500))),
    /unsupported_agent_intent/);
});
test("duplicate IDs and unknown graph fields never reach the compiler",()=>{
  const graph=demoGraph();
  graph.nodes.push(clone(graph.nodes[0]));
  assert.throws(()=>validateGraph(graph),/unsafe_or_duplicate_node/);
  const h=demoGraph();h.auth={admin:true};
  assert.throws(()=>validateGraph(h),/invalid_graph_shape/);
});
