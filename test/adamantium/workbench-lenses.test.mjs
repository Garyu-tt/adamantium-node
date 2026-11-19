import test from 'node:test';
import assert from 'node:assert/strict';
import {createWorkbenchView, listWorkbenchLenses, WORKBENCH_FORMAT} from '../../adamantium/workbench-lenses.mjs';

const port = (id,direction,semantics,dataType='mechanicus.any@1') => ({id,direction,semantics,dataType});
const fixture = () => ({
  format: 'adamantium.editor-projection/0.1', mode: 'read-only',
  source: {schema:'mechanicus.universal-graph/1',graphId:'demo.graph',revision:2,domain:'genesis'},
  renderNodes: [
    {id:'source',kind:'sensor',ports:[port('signal','output','signal'),port('grant','output','permission')]},
    {id:'sink',kind:'brain-region',ports:[port('signal','input','signal'),port('grant','input','permission')]}
  ],
  renderEdges: [{id:'signal',fromNode:'source',fromPort:'signal',toNode:'sink',toPort:'signal',semantics:'signal',delayTicks:1}],
  semanticEdges: [{id:'grant',fromNode:'source',fromPort:'grant',toNode:'sink',toPort:'grant',semantics:'permission',delayTicks:0}]
});

test('uses native-domain lens; readonly presentation only', () => {
  const view = createWorkbenchView(fixture());
  assert.equal(view.format,WORKBENCH_FORMAT);
  assert.equal(view.lens.id,'neural');
  assert.equal(view.renderNodes[1].emphasis,'primary');
  assert.equal(view.mode,'read-only');
  assert.equal(view.executionEnabled,false);
  assert.equal(view.authorizationGranted,false);
  assert.equal(Object.hasOwn(view,'flows'),false);
  assert.equal(listWorkbenchLenses().length,6);
});

test('preserves distinct typed signal flow and nonexecuting permission relationship', () => {
  const view = createWorkbenchView(fixture());
  assert.equal(view.flowEdges[0].visualLayer,'flow');
  assert.equal(view.flowEdges[0].delayTicks,1);
  assert.equal(view.relationshipEdges[0].visualLayer,'relationship');
  assert.equal(view.relationshipEdges[0].semantics,'permission');
  assert.equal(view.flowEdges.length,1);
});

test('explicit lenses only change visual emphasis, not authorization', () => {
  const p = fixture();
  const program = createWorkbenchView(p,{lens:'program'});
  const infra = createWorkbenchView(p,{lens:'infrastructure'});
  assert.notEqual(program.lens.id,infra.lens.id);
  assert.deepEqual(program.flowEdges,infra.flowEdges);
  assert.equal(program.executionEnabled,false);
  assert.equal(infra.authorizationGranted,false);
  assert.throws(()=>createWorkbenchView(p,{lens:'admin'}),/unknown lens/);
});

test('does not expose untrusted extra fields or secrets in the view', () => {
  const p = fixture();
  p.secret='SECRET'; p.renderNodes[0].internal='SECRET'; p.renderEdges[0].token='SECRET';
  assert.equal(JSON.stringify(createWorkbenchView(p)).includes('SECRET'),false);
});

test('fails closed on unknown schema, read-write input and malformed edge classification', () => {
  const p = fixture(); p.mode='read-write';
  assert.throws(()=>createWorkbenchView(p),/projection format or mode/);
  p.mode='read-only'; p.source.domain='unsupported';
  assert.throws(()=>createWorkbenchView(p),/source domain/);
  p.source.domain='genesis'; p.semanticEdges[0].semantics='control';
  assert.throws(()=>createWorkbenchView(p),/classification/);
});

test('rejects dangling, mismatched, duplicate or delayed permission edges', () => {
  const p = fixture();p.renderEdges[0].toNode='missing';
  assert.throws(()=>createWorkbenchView(p),/dangling/);
  const q = fixture(); q.renderNodes[1].ports[0].dataType='other.type@1';
  assert.throws(()=>createWorkbenchView(q),/port mismatch/);
  const r = fixture(); r.semanticEdges[0].id='signal';
  assert.throws(()=>createWorkbenchView(r),/duplicate edge/);
  const s = fixture(); s.semanticEdges[0].delayTicks=1;
  assert.throws(()=>createWorkbenchView(s),/invalid delay/);
});
