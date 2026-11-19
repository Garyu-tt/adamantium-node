import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyProjection, PROJECTION_VERSION } from "../../adamantium/editor-projection.mjs";

const fixture = () => ({
  id: "genesis.demo", revision: 7,
  nodes: [
    {
      id: "sensor", domain: "genesis", kind: "sensory",
      ports: { inputs: [{id:"context",type:"signal.v1"}], outputs: [{id:"signal",type:"signal.v1"}] },
      metadata: { access_token: "MUST_NOT_APPEAR" }
    },
    {
      id: "neuron", domain: "genesis", kind: "region",
      ports: { inputs: [{id:"signal",type:"signal.v1"}], outputs: [{id:"signal",type:"signal.v1"}] },
      parameters: { weights: [1, 2, 3], access_token: "MUST_NOT_APPEAR" }
    }
  ],
  edges: [
    { id: "input", kind: "signal", from: {nodeId:"sensor",portId:"signal"}, to: {nodeId:"neuron",portId:"signal"} },
    { id: "loop", kind: "feedback", delayTicks: 1, from: {nodeId:"neuron",portId:"signal"}, to: {nodeId:"sensor",portId:"context"} },
    { id: "auth", kind: "permission", from: {nodeId:"sensor",portId:"signal"}, to: {nodeId:"neuron",portId:"signal"} }
  ]
});

test("projects typed GENESIS feedback without runnable Node-RED flow", () => {
  const projection = createReadOnlyProjection(fixture());
  assert.equal(projection.format, PROJECTION_VERSION);
  assert.equal(projection.mode, "read-only");
  assert.deepEqual(projection.source, {graphId:"genesis.demo",revision:7});
  assert.equal(projection.renderNodes.length, 2);
  assert.equal(projection.renderEdges.length, 2);
  assert.equal(projection.semanticEdges.length, 1);
  assert.equal(projection.semanticEdges[0].kind, "permission");
  assert.equal(JSON.stringify(projection).includes("MUST_NOT_APPEAR"), false);
  assert.equal(JSON.stringify(projection).includes('"weights"'), false);
  assert.equal(Object.hasOwn(projection, "flows"), false);
});

test("rejects invalid graph, duplicate ids, dangling edges, and untyped ports", () => {
  assert.throws(() => createReadOnlyProjection(null), /graph must/);
  const dup = fixture(); dup.nodes.push(dup.nodes[0]);
  assert.throws(() => createReadOnlyProjection(dup), /duplicate node/);
  const dangling = fixture(); dangling.edges[0].to.nodeId = "missing";
  assert.throws(() => createReadOnlyProjection(dangling), /dangling/);
  const untyped = fixture(); untyped.nodes[0].ports.outputs[0].type = "";
  assert.throws(() => createReadOnlyProjection(untyped), /typed contract/);
  const invalidPort = fixture(); invalidPort.edges[0].from.portId = "unknown";
  assert.throws(() => createReadOnlyProjection(invalidPort), /missing typed port/);
});

test("requires bounded delayed feedback, keeps policy edges nonexecutable", () => {
  const delayed = fixture(); delete delayed.edges[1].delayTicks;
  assert.throws(() => createReadOnlyProjection(delayed), /positive delayTicks/);
  const unknown = fixture(); unknown.edges[2].kind = "exec";
  assert.throws(() => createReadOnlyProjection(unknown), /unsupported edge kind/);
  const normal = createReadOnlyProjection(fixture());
  assert.deepEqual(normal.semanticEdges.map(e=>e.kind),["permission"]);
});

test("rejects over-budget graph size", () => {
  const giant = fixture();
  giant.edges = Array.from({length:200001},()=>null);
  assert.throws(() => createReadOnlyProjection(giant), /budget exceeded/);
});
