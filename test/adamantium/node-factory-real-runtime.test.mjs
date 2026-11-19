// SPDX-License-Identifier: Apache-2.0
// An actual Node-RED test-helper runtime (not an EventEmitter mock).
import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {createRequire} from 'node:module';
import {generateNodePackage} from '../../adamantium/node-factory/generate.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';

const require=createRequire(import.meta.url);
const helper=require('node-red-node-test-helper');
helper.init(require.resolve('node-red'));
const callbackPromise=fn=>new Promise((resolve,reject)=>{
  fn(err=>err?reject(err):resolve());
});
test('generated node executes inside actual Node-RED runtime', {timeout:30000}, async()=>{
  const root=await mkdtemp(join(tmpdir(),'adamantium-real-node-red-'));
  let serverStarted=false;
  try{
    const result=await generateNodePackage(demoFactoryContract(),root);
    const nodeModule=require(join(result.destination,'nodes/demo-uppercase.js'));
    await callbackPromise(done=>helper.startServer(done));
    serverStarted=true;
    await new Promise((resolve,reject)=>{
      const flow=[
        {id:'test-node',type:result.nodeType,name:'generated',
          wires:[['capture-node']]},
        {id:'capture-node',type:'helper'}
      ];
      helper.load(nodeModule,flow,err=>{
        if(err){reject(err);return;}
        const input=helper.getNode('test-node');
        const sink=helper.getNode('capture-node');
        if(!input||!sink){reject(new Error('runtime_fixture_missing_node'));return;}
        sink.once('input',msg=>{
          try{assert.equal(msg.payload,'REAL NODE-RED RUNTIME');resolve();}
          catch(e){reject(e);}
        });
        input.receive({payload:'real node-red runtime'});
      });
    });
  }finally{
    if(serverStarted){
      try{await callbackPromise(done=>helper.unload(done));}finally{
        await callbackPromise(done=>helper.stopServer(done));
      }
    }
    await rm(root,{recursive:true,force:true,maxRetries:3,retryDelay:100});
  }
});
