// SPDX-License-Identifier: Apache-2.0
// R05 editor-independent, strict G0 v1 structural projection. No execution rights.
import {validateFactoryContract} from './contract.mjs';
const port=(id,dataType,direction)=>({id,dataType,direction,semantics:'data'});
const node=(id,typeRef,ports)=>({
 id,kind:'capability',typeRef,graphRef:'',ports,graphRefRevision:0
});
const edge=(id,fromNode,fromPort,toNode,toPort)=>({
 id,fromNode,fromPort,toNode,toPort,semantics:'data',delayTicks:0
});
export function factoryToUniversalGraph(contract){
 const input=validateFactoryContract(contract);
 const artifactType='mechanicus.factory.artifact@1';
 const contractType='mechanicus.factory.contract@1';
 const proofType='mechanicus.factory.proof@1';
 const receiptType='mechanicus.factory.receipt@1';
 return {
  schema:'mechanicus.universal-graph/1',
  id:'factory.'+input.id,revision:1,schemaVersion:1,
  domain:'program',interfacePorts:[],
  nodes:[
   node('contract','mechanicus.factory.contract-reader@1',[
    port('output',contractType,'output')]),
   node('generate','mechanicus.factory.package-generator@1',[
    port('input',contractType,'input'),port('output',artifactType,'output')]),
   node('verify','mechanicus.factory.isolated-verifier@1',[
    port('input',artifactType,'input'),port('output',proofType,'output')]),
   node('audit','mechanicus.factory.ledger-writer@1',[
    port('input',proofType,'input'),port('output',receiptType,'output')])
  ],
  edges:[
   edge('e.contract.generate','contract','output','generate','input'),
   edge('e.generate.verify','generate','output','verify','input'),
   edge('e.verify.audit','verify','output','audit','input')
  ]
 };
}
export function explainFactoryProjection(contract){
 const graph=factoryToUniversalGraph(contract);
 return {
  schema:'adamantium.factory.g0-preview/1',graph,
  canonicalEditor:'independent',
  declaredCapabilitiesOnly:true,
  executed:false,
  validatedWithNativeG0Compiler:false,
  privilegesGranted:false,published:false,
  nodeRedFlowCompiled:false
 };
}
