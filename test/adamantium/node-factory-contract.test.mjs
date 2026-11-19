// SPDX-License-Identifier: Apache-2.0
import test from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {demoFactoryContract,validateFactoryContract} from '../../adamantium/node-factory/contract.mjs';
import {renderNodePackage} from '../../adamantium/node-factory/generate.mjs';
const clone=x=>JSON.parse(JSON.stringify(x));

test('deterministic package has real Node-RED node and palette metadata',()=>{
  const first=renderNodePackage(demoFactoryContract());
  const second=renderNodePackage(demoFactoryContract());
  assert.deepEqual(first,second);
  assert.equal(first.packageName,'node-red-contrib-adamantium-demo-uppercase');
  const meta=JSON.parse(first.files['package.json']);
  assert.equal(meta['node-red'].nodes['adamantium-demo-uppercase'],
    'nodes/demo-uppercase.js');
  assert.equal(meta.private,true);
  assert.equal(meta.scripts,undefined);
  assert.equal(Object.keys(first.files).length,3);
  for(const [p,source] of Object.entries(first.files)){
    assert.equal('sha256:'+createHash('sha256').update(source).digest('hex'),first.sha256[p]);
    assert.equal(source.includes('eval('),false);
  }
  assert.equal(first.installIntoProductionAllowed,false);
  assert.equal(first.publishAllowed,false);
});
test('rejects arbitrary JS, package paths, credentials and unknown metadata',()=>{
  const data=demoFactoryContract();
  for(const change of [
    {id:'../escape'},
    {id:'x'.repeat(200)},
    {label:'</script><script>alert(1)</script>'},
    {suffix:'abc\nboom'},
    {transform:'require("child_process").execSync'},
    {suffix:{toString(){throw new Error('bad')}}}
  ]){
    const invalid={...data,...change};
    assert.throws(()=>validateFactoryContract(invalid));
  }
  assert.throws(()=>validateFactoryContract({...data,permissions:['root']}),/invalid_contract_fields/);
  assert.throws(()=>validateFactoryContract({...data,source:'process.exit(1)'}),/invalid_contract_fields/);
  assert.equal(clone(data).id,'demo-uppercase');
});
test('generated suffix transform remains escaped literal, not executable code',()=>{
  const input={schema:'adamantium.node-factory/1',id:'demo-suffix',
    label:'Suffix Demo',transform:'suffix',suffix:'"; require("fs"); //'};
  const output=renderNodePackage(input);
  assert.equal(output.files['nodes/demo-suffix.js'].includes(
    'msg.payload += "\\"; require(\\"fs\\"); //";'),true);
});
