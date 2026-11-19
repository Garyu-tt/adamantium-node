/**
 * Adamantium-node R01: inert workbench lenses for the read-only Graph IR projection.
 * A lens changes presentation only. It NEVER confers permission or execution authority.
 * SPDX-License-Identifier: Apache-2.0
 */

export const WORKBENCH_FORMAT = 'adamantium.workbench-view/0.1';
const PROJECTION_FORMAT = 'adamantium.editor-projection/0.1';
const SOURCE_SCHEMA = 'mechanicus.universal-graph/1';
const FLOW = new Set(['data', 'control', 'event', 'signal']);
const RELATIONSHIP = new Set(['dependency', 'permission', 'route']);
const NODE_KINDS = new Set(['capability', 'composite', 'service', 'device', 'sensor', 'effector', 'brain-region', 'resource', 'view', 'policy']);
const LENSES = Object.freeze({
  general:      { title: 'Universal graph',  emphasis: ['capability', 'composite', 'service'] },
  program:      { title: 'Program graph',    emphasis: ['capability', 'composite', 'service'] },
  neural:       { title: 'Brain & GENESIS', emphasis: ['brain-region', 'sensor', 'effector'] },
  infrastructure:{title: 'Infrastructure', emphasis: ['device', 'service', 'resource', 'policy'] },
  interface:    { title: 'Interface graph', emphasis: ['view', 'composite'] },
  tasks:        { title: 'Tasks & agents',  emphasis: ['capability', 'service', 'composite'] }
});
const DOMAIN_DEFAULT = Object.freeze({
  general: 'general', program: 'program', genesis: 'neural', neural: 'neural',
  infrastructure: 'infrastructure', interface: 'interface'
});
const NAME = /^[a-z][a-z0-9_.-]*$/;
const isObject = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const fail = msg => { throw new TypeError(`Invalid workbench view: ${msg}`); };
function name(v, field) {
  if (typeof v !== 'string' || v.length > 128 || !NAME.test(v)) fail(field);
  return v;
}
function projectionPort(p) {
  if (!isObject(p)) fail('port');
  const id = name(p.id, 'port.id');
  if (!['input','output'].includes(p.direction)) fail('port.direction');
  if (!FLOW.has(p.semantics) && !RELATIONSHIP.has(p.semantics)) fail('port.semantics');
  if (typeof p.dataType !== 'string' || p.dataType.length > 256 || !/^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/.test(p.dataType)) fail('port.dataType');
  return { id, direction: p.direction, semantics: p.semantics, dataType: p.dataType };
}
function projectionEdge(edge, nodes, relationship) {
  if (!isObject(edge)) fail('edge');
  const id = name(edge.id, 'edge.id');
  const kind = edge.semantics;
  if (!(relationship ? RELATIONSHIP : FLOW).has(kind)) fail(`edge classification: ${id}`);
  const fromNode = name(edge.fromNode, 'edge.fromNode');
  const toNode = name(edge.toNode, 'edge.toNode');
  const fromPort = name(edge.fromPort, 'edge.fromPort');
  const toPort = name(edge.toPort, 'edge.toPort');
  const source = nodes.get(fromNode), target = nodes.get(toNode);
  if (!source || !target) fail(`dangling edge: ${id}`);
  const out = source.get(fromPort), input = target.get(toPort);
  if (!out || !input || out.direction !== 'output' || input.direction !== 'input' ||
      out.semantics !== kind || input.semantics !== kind || out.dataType !== input.dataType) fail(`edge port mismatch: ${id}`);
  if (!Number.isSafeInteger(edge.delayTicks) || edge.delayTicks < 0 ||
      (edge.delayTicks > 0 && !['event','signal'].includes(kind))) fail(`invalid delay: ${id}`);
  return {
    id, from: { nodeId: fromNode, portId: fromPort },
    to: { nodeId: toNode, portId: toPort }, semantics: kind,
    delayTicks: edge.delayTicks, visualLayer: relationship ? 'relationship' : 'flow',
    styleToken: `graph.edge.${kind}`
  };
}

/**
 * Consumes only the vetted subset produced by createReadOnlyProjection().
 * Never treats an editor wire, a task dependency, or a route as a live grant.
 * Requires native validation of the source IR separately. No Node-RED flow emitted.
 */
export function createWorkbenchView(projection, {lens = 'auto'} = {}) {
  if (!isObject(projection) || projection.format !== PROJECTION_FORMAT || projection.mode !== 'read-only') fail('projection format or mode');
  const source = projection.source;
  if (!isObject(source) || source.schema !== SOURCE_SCHEMA || !Number.isSafeInteger(source.revision) || source.revision < 1) fail('source');
  const graphId = name(source.graphId, 'source.graphId');
  if (!Object.hasOwn(DOMAIN_DEFAULT, source.domain)) fail('source domain');
  if (!Array.isArray(projection.renderNodes) || !Array.isArray(projection.renderEdges) || !Array.isArray(projection.semanticEdges)) fail('projection arrays');
  if (projection.renderNodes.length > 100000 || (projection.renderEdges.length + projection.semanticEdges.length) > 200000) fail('projection budget');
  const selected = lens === 'auto' ? DOMAIN_DEFAULT[source.domain] : lens;
  if (typeof selected !== 'string' || !Object.hasOwn(LENSES, selected)) fail('unknown lens');
  const preset = LENSES[selected];
  const ids = new Set(), nodes = new Map();
  const renderNodes = projection.renderNodes.map(node => {
    if (!isObject(node)) fail('node');
    const id = name(node.id, 'node.id');
    if (ids.has(id) || !NODE_KINDS.has(node.kind) || !Array.isArray(node.ports) || node.ports.length > 4096) fail(`invalid/duplicate node: ${id}`);
    ids.add(id);
    const ports = node.ports.map(projectionPort);
    const portIds = new Set();
    for (const p of ports) {
      if (portIds.has(p.id)) fail(`duplicate node port: ${id}.${p.id}`);
      portIds.add(p.id);
    }
    nodes.set(id, new Map(ports.map(p => [p.id, p])));
    return {
      id, kind: node.kind, ports,
      emphasis: preset.emphasis.includes(node.kind) ? 'primary' : 'standard',
      styleToken: `graph.node.${node.kind}`,
      drilldownGraphRef: node.kind === 'composite' ? name(node.graphRef, 'node.graphRef') : null
    };
  });
  const edgeIds = new Set();
  const mapEdges = (items, relationship) => items.map(edge => {
    const projected = projectionEdge(edge, nodes, relationship);
    if (edgeIds.has(projected.id)) fail(`duplicate edge: ${projected.id}`);
    edgeIds.add(projected.id);
    return projected;
  });
  return {
    format: WORKBENCH_FORMAT, mode: 'read-only',
    source: { schema: SOURCE_SCHEMA, graphId, revision: source.revision, domain: source.domain },
    lens: { id: selected, title: preset.title, visualOnly: true },
    renderNodes, flowEdges: mapEdges(projection.renderEdges, false),
    relationshipEdges: mapEdges(projection.semanticEdges, true),
    executionEnabled: false, authorizationGranted: false
  };
}

export function listWorkbenchLenses() {
  return Object.entries(LENSES).map(([id, {title}]) => ({id, title}));
}
