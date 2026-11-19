// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {makeFactoryWitnessObserver} from '../../adamantium/node-factory/witness-studio-observer-r06.mjs';

test('R06 visible studio observer never exposes signer key or write-capable nodes',()=>{
 const root=resolve('owner-witness-preview');
 const snapshot=makeFactoryWitnessObserver(root);
 assert.equal(snapshot.schema,'adamantium.factory.witness-studio-observer/1');
 assert.equal(snapshot.executionAuthorized,false);
 assert.equal(snapshot.signerPrivateKeyExposed,false);
 assert.equal(snapshot.writableNodesPresent,false);
 const flow=snapshot.flows;
 assert.equal(flow.length,12);
 assert.equal(flow[0].label,'06 · SIGNED WITNESS R06');
 const allowed=new Set(['tab','comment','watch','inject','file in','json','debug']);
 assert.ok(flow.every(x=>allowed.has(x.type)));
 assert.equal(flow.filter(x=>x.type==='watch').length,1);
 assert.deepEqual(flow.filter(x=>x.type==='file in').map(x=>x.filename),
  [join(root,'witness-view.json'),join(root,'witness.jsonl')]);
 assert.equal(flow.some(x=>Object.values(x).some(v=>
  typeof v==='string'&&v.includes('signer-private.pem'))),false);
 const ids=new Set(flow.map(x=>x.id));
 assert.equal(ids.size,flow.length);
 for(const node of flow){
  for(const group of node.wires||[])
   for(const target of group)assert.ok(ids.has(target));
 }
 for(const invalid of [null,'','relative/path',resolve('/')]){
  assert.throws(()=>makeFactoryWitnessObserver(invalid),
   /absolute_owner_witness_root_required|filesystem_root_is_not_witness/);
 }
});
