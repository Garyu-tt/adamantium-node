// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {join,resolve} from 'node:path';
import {makeRemoteFactoryAnchorObserver} from '../../adamantium/node-factory/anchor-studio-r08.mjs';

test('R08 fails closed in studio: no remote signer without real MAS connection',()=>{
 const dir=resolve('operator-status-dir');
 const ui=makeRemoteFactoryAnchorObserver(dir);
 assert.equal(ui.flows.length,12);
 assert.equal(ui.networkApplied,false);
 assert.equal(ui.sourcePrivateKeyShared,false);
 assert.equal(ui.installGrant,false);
 assert.equal(ui.flows[0].label,'08 · REMOTE ANCHOR R08');
 const types=new Set(['tab','comment','watch','inject','file in','json','switch','debug']);
 assert.ok(ui.flows.every(x=>types.has(x.type)));
 assert.deepEqual(ui.flows.filter(x=>x.type==='file in').map(x=>x.filename),
  [join(dir,'remote-anchor-status.json')]);
 assert.deepEqual(ui.flows.find(x=>x.type==='switch').rules.map(x=>x.v),
  ['not_connected','verified_attestation','invalid']);
 const ids=new Set(ui.flows.map(x=>x.id));
 assert.equal(ids.size,ui.flows.length);
 for(const n of ui.flows)for(const row of n.wires||[])
  for(const id of row)assert.ok(ids.has(id));
 assert.ok(ui.flows.every(x=>!JSON.stringify(x).includes('anchor-private.pem')));
 for(const bad of ['',null,'relative',resolve('/')])
  assert.throws(()=>makeRemoteFactoryAnchorObserver(bad),
   /explicit_absolute_owner_status_root_required|filesystem_root_not_status/);
});
