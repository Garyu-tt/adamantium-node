// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {makeFactoryLedgerObserver} from '../../adamantium/node-factory/studio-observer.mjs';

test('R05 generated editor observer is read-only and requires owner-selected ledger path',()=>{
 const root=resolve('safe-operator-ledger');
 const preview=makeFactoryLedgerObserver(root);
 assert.equal(preview.editorIsAuthority,false);
 assert.equal(preview.journalWritableFromFlow,false);
 assert.equal(preview.flows.length,13);
 assert.deepEqual(preview.flows.filter(x=>x.type==='tab').map(x=>x.label),
  ['05 · R05 DURABLE FACTORY']);
 const allowed=new Set(['tab','comment','inject','watch','file in','json','debug']);
 assert.equal(preview.flows.every(x=>allowed.has(x.type)),true);
 const watchers=preview.flows.filter(x=>x.type==='watch');
 assert.equal(watchers.length,1);
 assert.equal(watchers[0].files,join(root,'view.json'));
 assert.equal(watchers[0].recursive,false);
 assert.deepEqual(preview.flows.filter(x=>x.type==='file in').map(x=>x.filename),
  [join(root,'view.json'),join(root,'g0-preview.json')]);
 assert.equal(preview.flows.some(x=>x.type==='exec'||x.type==='file'||x.type==='function'),false);
 const ids=new Set(preview.flows.map(x=>x.id));
 assert.equal(ids.size,preview.flows.length);
 for(const node of preview.flows){
  for(const targets of node.wires||[]){
   for(const target of targets)assert.equal(ids.has(target),true);
  }
 }
 for(const bad of ['',null,'ledger','.',resolve('/')]){
  assert.throws(()=>makeFactoryLedgerObserver(bad),
   /absolute_owner_provisioned_ledger_required|filesystem_root_not_a_ledger/);
 }
});
