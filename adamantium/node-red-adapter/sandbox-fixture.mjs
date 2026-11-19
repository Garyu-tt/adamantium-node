// SPDX-License-Identifier: Apache-2.0
const id=/^adamantium-[a-z][a-z0-9-]{1,48}$/;
const fail=code=>{throw Object.assign(new Error(code),{code});};
export function factoryTestFlow(nodeType){
 if(!id.test(nodeType||''))fail('invalid_generated_node_type');
 const tab='factory-r03-tab',producer='factory-r03-source';
 const transform='factory-r03-transform',sink='factory-r03-debug';
 return [
  {id:tab,type:'tab',label:'Adamantium Factory R03 sandbox',disabled:false,info:''},
  {id:producer,type:'inject',z:tab,name:'one-shot fixture',
   props:[{p:'payload'}],repeat:'',crontab:'',once:true,onceDelay:0.35,
   topic:'',payload:'node factory r03 verified',payloadType:'str',
   x:160,y:120,wires:[[transform]]},
  {id:transform,type:nodeType,z:tab,name:'generated verified transform',
   x:380,y:120,wires:[[sink]]},
  {id:sink,type:'debug',z:tab,name:'isolated verification',
   active:true,tosidebar:false,console:true,tostatus:false,
   complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
   x:630,y:120,wires:[]}
 ];
}
