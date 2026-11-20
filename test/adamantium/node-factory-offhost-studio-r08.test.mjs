// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {resolve,join} from 'node:path';
import {makeOffhostAnchorAttachment} from '../../adamantium/node-factory/offhost-studio-attach-r08.mjs';

test('attach R08 second signer to preexisting peer tab without touching other flows',()=>{
 const source=resolve('owner-readonly-status');
 const target='a110000000000008';
 const a=makeOffhostAnchorAttachment(source,target);
 assert.equal(a.schema,'adamantium.factory.offhost-attachment/1');
 assert.equal(a.preservesExisting,true);
 assert.equal(a.productionWrites,false);
 assert.equal(a.authCapabilitiesGranted,false);
 assert.equal(a.privateKeyExposed,false);
 assert.equal(a.nodes.length,11);
 assert.ok(a.nodes.every(n=>n.z===target));
 assert.equal(new Set(a.nodes.map(n=>n.id)).size,a.nodes.length);
 assert.ok(a.nodes.every(n=>n.id.startsWith('b08b')));
 assert.ok(a.nodes.every(n=>n.y>640));
 const allowed=new Set(['comment','watch','inject','file in','json','switch','debug']);
 assert.ok(a.nodes.every(n=>allowed.has(n.type)));
 assert.ok(a.nodes.every(n=>!JSON.stringify(n).includes('anchor-private.pem')));
 assert.deepEqual(a.nodes.filter(n=>n.type==='file in').map(n=>n.filename),
  [join(source,'offhost-verification-status-r08.json')]);
 const identifiers=new Set(a.nodes.map(n=>n.id));
 for(const node of a.nodes)for(const list of node.wires||[])
  for(const edge of list)assert.ok(identifiers.has(edge));
 for(const bad of [null,'','xyz','<tab>'])
  assert.throws(()=>makeOffhostAnchorAttachment(source,bad),
   /explicit_existing_hex_tab_required/);
});
