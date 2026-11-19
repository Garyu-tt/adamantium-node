// SPDX-License-Identifier: Apache-2.0
// Offline vertical: contract -> npm tgz -> isolated palette -> runtime node invocation.
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,rm,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {spawnSync} from 'node:child_process';
import {createRequire} from 'node:module';
import {EventEmitter} from 'node:events';
import {generateNodePackage} from '../../adamantium/node-factory/generate.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

const npmLocations=[
  process.env.npm_execpath,
  join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
  join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')
].filter(Boolean);
function npm(cwd,...args){
  const cli=npmLocations.find(existsSync);
  assert.ok(cli,'installed_node_npm_cli_required_for_offline_pack');
  const run=spawnSync(process.execPath,[cli,...args],{
    cwd,encoding:'utf8',timeout:120000,windowsHide:true,
    env:{...process.env,npm_config_update_notifier:'false'}
  });
  assert.equal(run.error,undefined,run.error?.message);
  assert.equal(run.status,0,run.stderr?.slice(-1000));
  return run.stdout;
}
test('full package manufacturing/packing/palette install runs with no external registry',async()=>{
  const root=await mkdtemp(join(tmpdir(),'adamantium-factory-'));
  try{
    const {destination,packageName}=await generateNodePackage(demoFactoryContract(),root);
    const tarFolder=join(root,'tarballs'),palette=join(root,'palette');
    await mkdir(tarFolder);await mkdir(palette);
    const packs=JSON.parse(npm(destination,'pack','--json','--ignore-scripts',
      '--pack-destination',tarFolder));
    assert.equal(packs.length,1);
    const packed=packs[0];
    assert.ok(packed.filename.endsWith('.tgz'));
    const paths=packed.files.map(f=>f.path);
    for(const path of ['package.json','nodes/demo-uppercase.js','nodes/demo-uppercase.html'])
      assert.ok(paths.includes(path),'missing_tar_member_'+path);
    const archive=join(tarFolder,packed.filename);
    await access(archive);
    npm(root,'install','--prefix',palette,'--offline','--ignore-scripts',
      '--no-audit','--no-fund','--no-save','--no-package-lock',archive);
    const installed=join(palette,'node_modules',packageName);
    const manifest=JSON.parse(await readFile(join(installed,'package.json'),'utf8'));
    const nodeEntry=manifest['node-red'].nodes['adamantium-demo-uppercase'];
    assert.equal(nodeEntry,'nodes/demo-uppercase.js');
    const require=createRequire(import.meta.url);
    const loader=require(join(installed,nodeEntry));
    let ctor;
    loader({nodes:{
      createNode(instance){
        EventEmitter.call(instance);
        Object.setPrototypeOf(instance,EventEmitter.prototype);
        instance.send=()=>{throw new Error('unexpected_node_send_fallback')};
        instance.error=()=>{throw new Error('unexpected_node_error_fallback')};
      },
      registerType(name,handler){
        assert.equal(name,'adamantium-demo-uppercase');
        ctor=handler;
      }
    }});
    assert.equal(typeof ctor,'function');
    const instance=new ctor({});
    let delivered=null,done=false;
    instance.emit('input',{payload:'hello world'},msg=>{delivered=msg},err=>{
      assert.equal(err,undefined);done=true;
    });
    assert.equal(delivered.payload,'HELLO WORLD');
    assert.equal(done,true);
    let rejected;
    instance.emit('input',{payload:12},()=>{throw new Error('unsafe_emit')},err=>{
      rejected=err;
    });
    assert.match(rejected.message,/payload_must_be_string/);
  }finally{
    await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
});
test('package generator refuses overwriting existing package directory',async()=>{
  const root=await mkdtemp(join(tmpdir(),'adamantium-factory-'));
  try{
    await generateNodePackage(demoFactoryContract(),root);
    await assert.rejects(generateNodePackage(demoFactoryContract(),root),/EEXIST/);
  }finally{await rm(root,{recursive:true,force:true});}
});
