// SPDX-License-Identifier: Apache-2.0
import test from "node:test";
import assert from "node:assert/strict";
import {compileNodeRed} from "../../adamantium/node-red-adapter/compile.mjs";
import {demoGraph} from "../../adamantium/graph-schema/agent-graph.mjs";

test("Node-RED 5 import is disabled and contains only safe builtin nodes",()=>{
  const result=compileNodeRed(demoGraph());
  assert.equal(result.disabledByDefault,true);
  assert.equal(result.appliedToNodeRed,false);
  assert.deepEqual(result.nodes.map(n=>n.type),["tab","inject","change","debug"]);
  const [tab,source,transform,sink]=result.nodes;
  assert.equal(tab.disabled,true);
  assert.equal(source.once,false);
  assert.equal(source.repeat,"");
  assert.deepEqual(source.wires,[["transform"]]);
  assert.deepEqual(transform.wires,[["sink"]]);
  assert.equal(transform.rules[0].to,"verified");
  assert.deepEqual(sink.wires,[]);
  const serialized=JSON.stringify(result.nodes);
  for(const forbidden of ['"type":"function"','"type":"exec"',
    '"type":"http request"','"credentials"','"server"'])
    assert.equal(serialized.includes(forbidden),false);
});
test("compiler must reject injected permissions and credential fields",()=>{
  const g=demoGraph();
  g.nodes[1].credentials={apiKey:"sensitive"};
  assert.throws(()=>compileNodeRed(g),/unsafe_or_duplicate_node/);
  const another=demoGraph();
  another.edges[1].semantics="route";
  assert.throws(()=>compileNodeRed(another),/unsafe_or_duplicate_edge/);
});
