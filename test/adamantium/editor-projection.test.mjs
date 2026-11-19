import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyProjection, PROJECTION_VERSION, SOURCE_SCHEMA } from "../../adamantium/editor-projection.mjs";

const port=(id,direction,semantics,dataType) => ({id,direction,semantics,dataType});
const fixture=()=>({
  schema: SOURCE_SCHEMA,
  schemaVersion: 1,
  id: "genesis.demo", domain: "genesis", revision: 7, interfacePorts: [],
  nodes: [
    {id:"sensor",kind:"sensor",typeRef:"genesis.sensor@1",graphRef:"",graphRefRevision:0,ports:[
      port("context","input","signal","genesis.signal@1"),
      port("signal","output","signal","genesis.signal@1"),
      port("grant","output","permission","security.grant@1")
    ]},
    {id:"neuron",kind:"brain-region",typeRef:"genesis.neuron@1",graphRef:"",graphRefRevision:0,ports:[
      port("signal","input","signal","genesis.signal@1"),
      port("feedback","output","signal","genesis.signal@1"),
      port("grant","input","permission","security.grant@1")
    ]}
  ],
  edges:[
    {id:"input",fromNode:"sensor",fromPort:"signal",toNode:"neuron",toPort:"signal",semantics:"signal",delayTicks:0},
    {id:"loop",fromNode:"neuron",fromPort:"feedback",toNode:"sensor",toPort:"context",semantics:"signal",delayTicks:1},
    {id:"auth",fromNode:"sensor",fromPort:"grant",toNode:"neuron",toPort:"grant",semantics:"permission",delayTicks:0}
  ]
});

test("projects canonical Graph IR v1, delayed feedback and inert permission relationships", () => {
  const graph=fixture();
  graph.__private="MUST_NOT_APPEAR"; // hypothetical upstream metadata is not projected
  const result=createReadOnlyProjection(graph);
  assert.equal(result.format,PROJECTION_VERSION);
  assert.equal(result.mode,"read-only");
  assert.deepEqual(result.source,{schema:SOURCE_SCHEMA,graphId:"genesis.demo",revision:7,domain:"genesis"});
  assert.equal(result.renderNodes.length,2);
  assert.equal(result.renderEdges.length,2);
  assert.equal(result.renderEdges[1].delayTicks,1);
  assert.equal(result.semanticEdges.length,1);
  assert.equal(result.semanticEdges[0].semantics,"permission");
  assert.equal(JSON.stringify(result).includes("MUST_NOT_APPEAR"),false);
  assert.equal(Object.hasOwn(result,"flows"),false);
});

test("fails closed for wrong version, duplicate nodes and dangling graph edges", () => {
  const bad=fixture();bad.schemaVersion=2;
  assert.throws(()=>createReadOnlyProjection(bad),/source schema/);
  const dup=fixture();dup.nodes.push(dup.nodes[0]);
  assert.throws(()=>createReadOnlyProjection(dup),/duplicate node/);
  const dangling=fixture();dangling.edges[0].fromNode="missing";
  assert.throws(()=>createReadOnlyProjection(dangling),/dangling edge/);
});

test("requires exact type and semantics on ports; permission never becomes wire", () => {
  const mismatched=fixture();mismatched.nodes[1].ports[0].dataType="genesis.other@1";
  assert.throws(()=>createReadOnlyProjection(mismatched),/typed port/);
  const missing=fixture();missing.edges[0].fromPort="unknown";
  assert.throws(()=>createReadOnlyProjection(missing),/missing endpoint/);
  const illegal=fixture();illegal.edges[2].delayTicks=1;
  assert.throws(()=>createReadOnlyProjection(illegal),/illegal delay/);
  const badSemantics=fixture();badSemantics.edges[0].semantics="exec";
  assert.throws(()=>createReadOnlyProjection(badSemantics),/unsupported edge/);
});

test("enforces a bounded projection budget",()=>{
  const g=fixture();g.edges=Array.from({length:200001},()=>null);
  assert.throws(()=>createReadOnlyProjection(g),/budget exceeded/);
});
