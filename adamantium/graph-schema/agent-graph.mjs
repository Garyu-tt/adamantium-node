// SPDX-License-Identifier: Apache-2.0
// R01: narrow agent-editable subset of the canonical Mechanicus Graph IR v1.
// Does not execute JavaScript, resolve providers or accept policy/route edges.
export const SCHEMA = "mechanicus.universal-graph/1";
const ident = /^[a-z][a-z0-9_.-]{0,127}$/;
const known = new Map([
  ["adamantium.demo.source@1", [["out", "output"]]],
  ["adamantium.demo.set@1", [["in", "input"], ["out", "output"]]],
  ["adamantium.demo.sink@1", [["in", "input"]]]
]);
const datatype = "mas.text@1";
const port = (id, direction) => ({
  id, direction, semantics: "data", dataType: datatype
});
const fields = (value, required) => value !== null &&
  typeof value === "object" && !Array.isArray(value) &&
  Object.keys(value).length === required.length &&
  required.every(name => Object.hasOwn(value, name));
const assert = (ok, message) => { if (!ok) throw new TypeError(message); };
const nodeKeys = ["id", "kind", "typeRef", "graphRef", "graphRefRevision", "ports"];
const edgeKeys = ["id", "fromNode", "fromPort", "toNode", "toPort", "semantics", "delayTicks"];

export function validateGraph(raw) {
  assert(fields(raw, ["schema","id","schemaVersion","revision","domain",
    "interfacePorts","nodes","edges"]), "invalid_graph_shape");
  assert(raw.schema === SCHEMA && ident.test(raw.id) &&
    raw.schemaVersion === 1 && raw.domain === "program" &&
    Number.isSafeInteger(raw.revision) && raw.revision >= 1 &&
    Array.isArray(raw.interfacePorts) && raw.interfacePorts.length === 0 &&
    Array.isArray(raw.nodes) && raw.nodes.length >= 1 && raw.nodes.length <= 32 &&
    Array.isArray(raw.edges) && raw.edges.length <= 64, "invalid_graph_header");
  const nodes = new Map();
  for (const n of raw.nodes) {
    assert(fields(n, nodeKeys) && ident.test(n.id) && !nodes.has(n.id) &&
      n.kind === "capability" && known.has(n.typeRef) &&
      n.graphRef === "" && n.graphRefRevision === 0 &&
      Array.isArray(n.ports), "unsafe_or_duplicate_node");
    const expected = known.get(n.typeRef).map(([id, direction]) => port(id, direction));
    assert(JSON.stringify(n.ports) === JSON.stringify(expected), "invalid_node_ports");
    nodes.set(n.id, n);
  }
  const seenEdges = new Set();
  const inDegree = new Map([...nodes.keys()].map(id => [id, 0]));
  const forward = new Map([...nodes.keys()].map(id => [id, []]));
  for (const e of raw.edges) {
    assert(fields(e, edgeKeys) && ident.test(e.id) && !seenEdges.has(e.id) &&
      nodes.has(e.fromNode) && nodes.has(e.toNode) &&
      e.semantics === "data" && e.delayTicks === 0, "unsafe_or_duplicate_edge");
    seenEdges.add(e.id);
    const source = nodes.get(e.fromNode).ports.find(p => p.id === e.fromPort);
    const target = nodes.get(e.toNode).ports.find(p => p.id === e.toPort);
    assert(source?.direction === "output" && target?.direction === "input" &&
      source.dataType === target.dataType &&
      source.semantics === target.semantics, "incompatible_typed_edge");
    forward.get(e.fromNode).push(e.toNode);
    inDegree.set(e.toNode, inDegree.get(e.toNode) + 1);
  }
  const ready = [...inDegree].filter(([,d]) => d === 0).map(([id]) => id);
  const order = [];
  while (ready.length) {
    const id = ready.shift();
    order.push(id);
    for (const to of forward.get(id)) {
      const degree = inDegree.get(to) - 1;
      inDegree.set(to, degree);
      if (degree === 0) ready.push(to);
    }
  }
  assert(order.length === nodes.size, "instantaneous_cycle");
  return {graph: JSON.parse(JSON.stringify(raw)), order};
}

const capability = (id, typeRef) => ({
  id, kind:"capability", typeRef, graphRef:"", graphRefRevision:0,
  ports:known.get(typeRef).map(([p,d]) => port(p,d))
});
const link = (id, fromNode, toNode) => ({
  id, fromNode, fromPort:"out", toNode, toPort:"in", semantics:"data", delayTicks:0
});
export function demoGraph(revision = 1) {
  const graph = {
    schema:SCHEMA, id:"adamantium.bootstrap.demo", schemaVersion:1,
    revision, domain:"program", interfacePorts:[],
    nodes:[
      capability("source", "adamantium.demo.source@1"),
      capability("transform", "adamantium.demo.set@1"),
      capability("sink", "adamantium.demo.sink@1")
    ],
    edges:[link("source.to.transform","source","transform"),
      link("transform.to.sink","transform","sink")]
  };
  validateGraph(graph);
  return graph;
}
export function synthesize(text, revision = 1) {
  assert(typeof text === "string" && text.length <= 400 &&
    /(?:граф|graph)/i.test(text) &&
    /(?:тест|demo|пример|test)/i.test(text), "unsupported_agent_intent");
  return demoGraph(revision);
}
