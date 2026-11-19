// SPDX-License-Identifier: Apache-2.0
// Inert read-only Node-RED lens for a separate R06 Ed25519 signer.
import {isAbsolute,resolve,parse,join} from 'node:path';
const id=n=>'a1100000000000'+n;
const wires=n=>[[id(n)]];
export function makeFactoryWitnessObserver(witnessRoot){
 if(typeof witnessRoot!=='string'||!isAbsolute(witnessRoot))
  throw new TypeError('absolute_owner_witness_root_required');
 const root=resolve(witnessRoot);
 if(root===parse(root).root)throw new TypeError('filesystem_root_is_not_witness');
 const view=join(root,'witness-view.json');
 const chain=join(root,'witness.jsonl');
 const tab=id('06');
 const fileIn=(n,name,file,next,y)=>({
  id:id(n),type:'file in',z:tab,name,
  filename:file,filenameType:'str',format:'utf8',
  chunk:false,sendError:false,encoding:'none',allProps:false,
  x:495,y,wires:wires(next)
 });
 const inject=(n,name,next,y)=>({
  id:id(n),type:'inject',z:tab,name,props:[{p:'payload'}],
  repeat:'',crontab:'',once:false,onceDelay:0.1,
  payload:'read',payloadType:'str',topic:'',x:190,y,wires:wires(next)
 });
 return {
  schema:'adamantium.factory.witness-studio-observer/1',
  executionAuthorized:false,
  signerPrivateKeyExposed:false,
  writableNodesPresent:false,
  flows:[
   {id:tab,type:'tab',label:'06 · SIGNED WITNESS R06',disabled:false,
    info:'Detached Ed25519 receipts; no right to install or publish modules'},
   {id:id('70'),type:'comment',z:tab,
    name:'Signed witness — проверяемая ревизия фабрики',
    info:'Читает только публичный snapshot и подписи из отдельной директории.',
    x:350,y:95,wires:[]},
   {id:id('71'),type:'watch',z:tab,
    name:'Подписанный checkpoint изменился',
    files:view,recursive:false,x:200,y:195,wires:wires('73')},
   inject('72','▶ Проверить witness', '73',260),
   fileIn('73','Только чтение witness-view.json',view,'74',230),
   {id:id('74'),type:'json',z:tab,
    name:'Разобрать подписанный статус',property:'payload',
    action:'obj',pretty:false,x:710,y:230,wires:wires('75')},
   {id:id('75'),type:'debug',z:tab,name:'WITNESS ▶ Debug',
    active:true,tosidebar:true,console:false,tostatus:true,
    complete:'payload',targetType:'msg',
    statusVal:'payload.checkpoints',statusType:'msg',
    x:960,y:230,wires:[]},
   {id:id('76'),type:'comment',z:tab,
    name:'Подпись не равна разрешению',
    info:'approvalGranted=false; policyEnforced=false; productionPublished=false.',
    x:420,y:340,wires:[]},
   inject('78','▶ Показать цепочку подписей', '79',440),
   fileIn('79','Только чтение witness.jsonl',chain,'80',440),
   {id:id('80'),type:'debug',z:tab,
    name:'SIGNED RECEIPTS ▶ Debug',active:true,tosidebar:true,
    console:false,tostatus:false,complete:'payload',targetType:'msg',
    statusVal:'',statusType:'auto',x:850,y:440,wires:[]},
   {id:id('81'),type:'comment',z:tab,
    name:'Демо на одном хосте ≠ независимый сервер',
    info:'Для настоящей защиты от совместного отката нужен отдельный хост/якорь и закреплённый публичный ключ.',
    x:530,y:535,wires:[]}
  ]
 };
}
