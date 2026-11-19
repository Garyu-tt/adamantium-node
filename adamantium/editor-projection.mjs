/**
 * Adamantium-node R01: inert read-only projection of Mechanicus Graph IR v1.
 * Source contract: standards/universal-graph/graph-ir-v1.schema.json
 * in AdamantiumToolBox (draft G0, PR #143).
 *
 * This does not execute, authorize, persist or edit a native graph.
 * SPDX-License-Identifier: Apache-2.0
 */

export const PROJECTION_VERSION = "adamantium.editor-projection/0.1";
export const SOURCE_SCHEMA = "mechanicus.universal-graph/1";

const DOMAINS = new Set(["general", "program", "genesis", "neural", "infrastructure", "interface"]);
const KINDS = new Set(["capability", "composite", "service", "device", "sensor", "effector", "brain-region", "resource", "view", "policy"]);
const SEMANTICS = new Set(["data", "control", "event", "signal", "dependency", "permission", "route"]);
const NON_EXECUTABLE = new Set(["dependency", "permission", "route"]);
const NAME = /^[a-z][a-z0-9_.-]*$/;
const CONTRACT = /^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/;

function fail(message) { throw new TypeError(`Invalid Graph IR v1 projection: ${message}`); }
function obj(value) { return value !== null && typeof value === "object" && !Array.isArray(value); }
function name(value, label) {
  if (typeof value !== "string" || value.length > 128 || !NAME.test(value)) fail(`invalid ${label}`);
  return value;
}
function contract(value, label) {
  if (typeof value !== "string" || value.length > 256 || !CONTRACT.test(value)) fail(`invalid ${label}`);
  return value;
}
function version(value, label, min=0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`invalid ${label}`);
  return value;
}
function port(p) {
  if (!obj(p)) fail("port must be an object");
  const id=name(p.id,"port.id");
  const dataType=contract(p.dataType,"port.dataType");
  if (!["input","output"].includes(p.direction)) fail("port.direction");
  if (!SEMANTICS.has(p.semantics)) fail("port.semantics");
  return {id,dataType,direction:p.direction,semantics:p.semantics};
}

/** Read-only projection. Validate source with its canonical JSON Schema and
 * native C++17 compiler before treating it as a trusted IR revision. */
export function createReadOnlyProjection(graph) {
  if (!obj(graph) || graph.schema !== SOURCE_SCHEMA || graph.schemaVersion !== 1) fail("unsupported source schema");
  const id = name(graph.id,"graph.id");
  version(graph.revision,"graph.revision",1);
  if (!DOMAINS.has(graph.domain)) fail("graph.domain");
  if (!Array.isArray(graph.interfacePorts) || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    fail("interfacePorts/nodes/edges must be arrays");
  }
  if (graph.interfacePorts.length > 4096 || graph.nodes.length > 100000 || graph.edges.length > 200000) {
    fail("projection size budget exceeded");
  }
  const interfacePorts=graph.interfacePorts.map(port);
  const nodes = new Map();
  const renderNodes = graph.nodes.map((n) => {
    if (!obj(n)) fail("node must be an object");
    const nid = name(n.id,"node.id");
    if (nodes.has(nid)) fail(`duplicate node ${nid}`);
    if (!KINDS.has(n.kind) || !Array.isArray(n.ports) || n.ports.length > 4096) fail(`invalid node ${nid}`);
    const inputs=new Map(), outputs=new Map(), displayPorts=[];
    for (const p of n.ports) {
      const parsed=port(p);
      if (inputs.has(parsed.id) || outputs.has(parsed.id)) fail(`duplicate port ${nid}.${parsed.id}`);
      (parsed.direction==="input" ? inputs : outputs).set(parsed.id,parsed);
      displayPorts.push(parsed);
    }
    if (n.kind==="composite") {
      if (n.typeRef!=="" || !n.graphRef || n.graphRefRevision < 1) fail(`invalid composite ${nid}`);
      name(n.graphRef,"node.graphRef");
      version(n.graphRefRevision,"node.graphRefRevision",1);
    } else {
      contract(n.typeRef,"node.typeRef");
      if (n.graphRef!=="" || n.graphRefRevision!==0) fail(`invalid noncomposite ${nid}`);
    }
    nodes.set(nid,{inputs,outputs});
    return {id:nid,kind:n.kind,typeRef:n.typeRef,graphRef:n.graphRef,graphRefRevision:n.graphRefRevision,ports:displayPorts};
  });
  const ids=new Set(), renderEdges=[], semanticEdges=[];
  for (const e of graph.edges) {
    if (!obj(e)) fail("edge must be an object");
    const eid=name(e.id,"edge.id");
    if (ids.has(eid)) fail(`duplicate edge ${eid}`);
    ids.add(eid);
    if (!SEMANTICS.has(e.semantics)) fail(`unsupported edge semantics ${eid}`);
    const source=nodes.get(name(e.fromNode,"edge.fromNode"));
    const target=nodes.get(name(e.toNode,"edge.toNode"));
    if (!source || !target) fail(`dangling edge ${eid}`);
    const src=source.outputs.get(name(e.fromPort,"edge.fromPort"));
    const dst=target.inputs.get(name(e.toPort,"edge.toPort"));
    if (!src || !dst) fail(`missing endpoint port ${eid}`);
    if (src.dataType!==dst.dataType || src.semantics!==e.semantics || dst.semantics!==e.semantics) {
      fail(`typed port/semantics mismatch ${eid}`);
    }
    version(e.delayTicks,"edge.delayTicks");
    if (e.delayTicks>0 && e.semantics!=="event" && e.semantics!=="signal") {
      fail(`illegal delay on ${eid}`);
    }
    const projected={id:eid,semantics:e.semantics,fromNode:e.fromNode,fromPort:e.fromPort,toNode:e.toNode,toPort:e.toPort,delayTicks:e.delayTicks};
    (NON_EXECUTABLE.has(e.semantics) ? semanticEdges : renderEdges).push(projected);
  }
  // No Node-RED flow is emitted. Permission/route/dependency edges
  // are semantic overlays, never deployable wires or RBAC grants.
  return {
    format:PROJECTION_VERSION,
    source:{schema:SOURCE_SCHEMA,graphId:id,revision:graph.revision,domain:graph.domain},
    mode:"read-only",
    interfacePorts,renderNodes,renderEdges,semanticEdges
  };
}
