// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {FactorySandboxAdmin} from '../../adamantium/node-red-adapter/sandbox-admin.mjs';
import {factoryTestFlow} from '../../adamantium/node-red-adapter/sandbox-fixture.mjs';
const valid={
 baseUrl:'http://127.0.0.1:49152/',token:'a'.repeat(32),
 sandboxId:'factory-0123456789abcdef'
};
test('sandbox client rejects external, default and malformed Admin API addresses',()=>{
 for(const address of [
  'http://0.0.0.0:1880/','http://localhost:1880/','https://127.0.0.1:1880/',
  'http://192.168.0.1:1880/','http://127.0.0.1:1880/admin',
  'http://127.0.0.1:1880/?token=exposed'
 ])assert.throws(()=>new FactorySandboxAdmin({...valid,baseUrl:address}),
  /sandbox_must_be_pinned_loopback/);
 assert.throws(()=>new FactorySandboxAdmin({...valid,token:'short'}),
  /sandbox_identity_required/);
 assert.throws(()=>new FactorySandboxAdmin({...valid,sandboxId:'spoof'}),
  /sandbox_identity_required/);
});
test('fixed exported test graph contains only three safe built-in nodes plus generated module',()=>{
 const safe=factoryTestFlow('adamantium-demo-uppercase');
 assert.deepEqual(safe.map(n=>n.type),
  ['tab','inject','adamantium-demo-uppercase','debug']);
 assert.equal(safe[1].repeat,'');
 assert.equal(safe[1].once,true);
 assert.equal(safe[3].console,true);
 assert.equal(safe.some(n=>['function','exec','http request'].includes(n.type)),false);
 for(const unsafe of ['exec','node-red-contrib-power','adamantium-../../x',
  'adamantium-a;require("fs")']){
  assert.throws(()=>factoryTestFlow(unsafe),/invalid_generated_node_type/);
 }
});
