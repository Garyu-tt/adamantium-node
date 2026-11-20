import test from "node:test";
import assert from "node:assert/strict";
import { createReadOnlyProjection, SOURCE_SCHEMA } from "../../adamantium/editor-projection.mjs";

const p = (id, direction, semantics) => ({ id, direction, semantics, dataType: "mechanicus.signal@1" });
const n = (id) => ({
  id, kind: "brain-region", typeRef: "genesis.region@1", graphRef: "", graphRefRevision: 0,
  ports: [
    p("signal_in", "input", "signal"), p("signal_out", "output", "signal"),
    p("grant_in", "input", "permission"), p("grant_out", "output", "permission")
  ]
});
const edge = (id, fromNode, toNode, semantics, delayTicks = 0) => ({
  id, fromNode, fromPort: semantics === "signal" ? "signal_out" : "grant_out",
  toNode, toPort: semantics === "signal" ? "signal_in" : "grant_in",
  semantics, delayTicks
});
const graph = () => ({
  schema: SOURCE_SCHEMA, schemaVersion: 1, id: "genesis.feedback",
  domain: "neural", revision: 1, interfacePorts: [],
  nodes: [n("a"), n("b")],
  edges: [edge("ab", "a", "b", "signal"), edge("ba", "b", "a", "signal")]
});

test("zero-delay cycle is only an inert projection, NOT a native validation receipt", () => {
  const projected = createReadOnlyProjection(graph());
  assert.equal(projected.mode, "read-only");
  assert.equal(projected.renderEdges.length, 2);
  assert.deepEqual(projected.renderEdges.map(e => e.delayTicks), [0, 0]);
  assert.equal(Object.hasOwn(projected, "flows"), false);
  assert.equal(Object.hasOwn(projected, "validated"), false);
  assert.equal(Object.hasOwn(projected, "authorized"), false);
  // The independent native Graph IR validator MUST reject this cycle before
  // any plan submission; this projection intentionally cannot certify that.
});

test("explicit delayed feedback remains visible without editor execution", () => {
  const g = graph();
  g.edges[1].delayTicks = 1;
  const projected = createReadOnlyProjection(g);
  assert.deepEqual(projected.renderEdges.map(e => e.delayTicks), [0, 1]);
  assert.equal(Object.hasOwn(projected, "flows"), false);
});

test("permission relationships remain semantic even beside a signal cycle", () => {
  const g = graph();
  g.edges.push(edge("grant", "a", "b", "permission"));
  const projected = createReadOnlyProjection(g);
  assert.equal(projected.renderEdges.length, 2);
  assert.equal(projected.semanticEdges.length, 1);
  assert.equal(projected.semanticEdges[0].semantics, "permission");
  assert.equal(Object.hasOwn(projected, "grants"), false);
});
