/**
 * Adamantium-node R01: inert, read-only editor projection.
 *
 * This does NOT execute a MAS capability, translate native Graph IR in full,
 * grant permissions, or modify the source graph.
 * SPDX-License-Identifier: Apache-2.0
 */

export const PROJECTION_VERSION = "adamantium.editor-projection/0.1";

const DRAWABLE = new Set(["data", "control", "event", "signal", "feedback"]);
const SEMANTIC = new Set(["permission", "network", "dependency", "containment"]);
const ALL_EDGES = new Set([...DRAWABLE, ...SEMANTIC]);

function fail(message) {
  throw new TypeError(`Invalid graph projection: ${message}`);
}

function record(value) {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function identifier(value, label) {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._:\/-]{0,127}$/.test(value)) {
    fail(`${label} must be a bounded identifier`);
  }
  return value;
}

function ports(node, direction) {
  const entries = node.ports?.[direction] ?? [];
  if (!Array.isArray(entries)) fail(`${node.id}.${direction} must be an array`);
  const ids = new Set();
  return entries.map((port) => {
    if (!record(port)) fail(`invalid port in ${node.id}`);
    const id = identifier(port.id, "port ID");
    if (ids.has(id)) fail(`duplicate port ${node.id}.${id}`);
    ids.add(id);
    if (typeof port.type !== "string" || !port.type || port.type.length > 128) {
      fail(`missing typed contract for ${node.id}.${id}`);
    }
    return { id, type: port.type };
  });
}

/**
 * Minimal versioned interchange shape used by the R01 projection fixture.
 * The authoritative Universal Graph IR is owned outside this editor.
 * Inputs: {id, revision, nodes:[{id,domain,kind,ports}], edges:[{id,kind,from,to,delayTicks?}]}.
 * Endpoint: {nodeId,portId}. No arbitrary metadata is copied into the UI.
 */
export function createReadOnlyProjection(graph) {
  if (!record(graph)) fail("graph must be an object");
  const id = identifier(graph.id, "graph ID");
  if (!Number.isSafeInteger(graph.revision) || graph.revision < 0) {
    fail("revision must be a nonnegative integer");
  }
  if (!Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    fail("nodes and edges must be arrays");
  }
  if (graph.nodes.length > 100000 || graph.edges.length > 200000) {
    fail("projection size budget exceeded");
  }

  const nodes = new Map();
  const renderNodes = graph.nodes.map((node) => {
    if (!record(node)) fail("node must be an object");
    const nodeId = identifier(node.id, "node ID");
    if (nodes.has(nodeId)) fail(`duplicate node: ${nodeId}`);
    const domain = identifier(node.domain, "node domain");
    const kind = identifier(node.kind, "node kind");
    const inputs = ports(node, "inputs");
    const outputs = ports(node, "outputs");
    const projectionNode = { id: nodeId, domain, kind, ports: { inputs, outputs } };
    nodes.set(nodeId, projectionNode);
    return projectionNode;
  });

  const edgeIds = new Set();
  const renderEdges = [];
  const semanticEdges = [];
  for (const edge of graph.edges) {
    if (!record(edge)) fail("edge must be an object");
    const edgeId = identifier(edge.id, "edge ID");
    if (edgeIds.has(edgeId)) fail(`duplicate edge: ${edgeId}`);
    edgeIds.add(edgeId);
    if (!ALL_EDGES.has(edge.kind)) fail(`unsupported edge kind: ${edge.kind}`);
    if (!record(edge.from) || !record(edge.to)) fail(`invalid edge endpoints: ${edgeId}`);
    const source = nodes.get(identifier(edge.from.nodeId, "source node"));
    const target = nodes.get(identifier(edge.to.nodeId, "target node"));
    if (!source || !target) fail(`dangling edge: ${edgeId}`);
    const sourcePort = identifier(edge.from.portId, "source port");
    const targetPort = identifier(edge.to.portId, "target port");
    if (!source.ports.outputs.some(p => p.id === sourcePort) ||
        !target.ports.inputs.some(p => p.id === targetPort)) {
      fail(`missing typed port on ${edgeId}`);
    }
    if (edge.kind === "feedback" &&
        (!Number.isSafeInteger(edge.delayTicks) || edge.delayTicks < 1)) {
      fail(`feedback edge ${edgeId} requires explicit positive delayTicks`);
    }
    const projected = {
      id: edgeId, kind: edge.kind,
      from: { nodeId: source.id, portId: sourcePort },
      to: { nodeId: target.id, portId: targetPort }
    };
    if (edge.kind === "feedback") projected.delayTicks = edge.delayTicks;
    (DRAWABLE.has(edge.kind) ? renderEdges : semanticEdges).push(projected);
  }

  // No executable Node-RED flow is emitted. Permission/network/dependency
  // edges remain inert semantics, never deployable wires.
  return {
    format: PROJECTION_VERSION,
    source: { graphId: id, revision: graph.revision },
    mode: "read-only",
    renderNodes,
    renderEdges,
    semanticEdges
  };
}
