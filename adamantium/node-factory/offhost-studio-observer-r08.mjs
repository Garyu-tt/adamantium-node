// SPDX-License-Identifier: Apache-2.0
// Pure native Node-RED view of an independently checked R08 Ed25519 receipt.
import {join,resolve,parse,isAbsolute} from 'node:path';
const id=n=>'a1100000000000'+n;
const edge=n=>[[id(n)]];
export function makeOffhostAnchorObserver(statusDirectory){
 if(typeof statusDirectory!=='string'||!isAbsolute(statusDirectory))
  throw new TypeError('absolute_offhost_status_path_required');
 const dir=resolve(statusDirectory);
 if(dir===parse(dir).root)throw new TypeError('refuse_filesystem_root');
 const status=join(dir,'offhost-verification-status-r08.json');
 const tab=id('08');
 return {
  schema:'adamantium.factory.offhost-observer/1',
  signerPrivateKeyExposed:false,
  hostCommandExecutor:false,
  productionWrite:false,
  flows:[
   {id:tab,type:'tab',label:'08 · OFFHOST ANCHOR R08',disabled:false,
    info:'Separate host signed evidence. This UI has no source/signer key and no MAS grants.'},
   {id:id('B0'),type:'comment',z:tab,
    name:'R08 · ВТОРОЙ УЗЕЛ ПОДТВЕРЖДАЕТ ЖУРНАЛ',
    info:'Первичная подпись Windows R06 → проверка на другом узле → независимая подпись R08 → только публичная проверка на Windows.',
    x:400,y:90,wires:[]},
   {id:id('B1'),type:'watch',z:tab,name:'Новый отчёт другого узла',
    files:status,recursive:false,x:200,y:195,wires:edge('B3')},
   {id:id('B2'),type:'inject',z:tab,name:'▶ Прочитать второй checkpoint',
    props:[{p:'payload'}],repeat:'',crontab:'',once:false,onceDelay:0.1,
    payload:'read',payloadType:'str',topic:'',x:200,y:270,wires:edge('B3')},
   {id:id('B3'),type:'file in',z:tab,name:'Только чтение: offhost status',
    filename:status,filenameType:'str',format:'utf8',
    chunk:false,sendError:false,encoding:'none',allProps:false,
    x:482,y:235,wires:edge('B4')},
   {id:id('B4'),type:'json',z:tab,name:'Разобрать audit JSON',
    property:'payload',action:'obj',pretty:false,x:710,y:235,wires:edge('B5')},
   {id:id('B5'),type:'switch',z:tab,name:'Актуально / устарело / отклонено',
    property:'payload.status',propertyType:'msg',
    rules:[{t:'eq',v:'verified_current',vt:'str'},
     {t:'eq',v:'verified_stale',vt:'str'},
     {t:'eq',v:'invalid',vt:'str'}],
    checkall:'true',repair:false,outputs:3,
    x:970,y:235,wires:[[id('B6')],[id('B7')],[id('B8')]]},
   {id:id('B6'),type:'debug',z:tab,name:'✓ R08 ПОДПИСИ СОВПАЛИ',
    active:true,tosidebar:true,console:false,tostatus:true,
    complete:'payload',targetType:'msg',
    statusVal:'payload.anchorSequence',statusType:'msg',x:1230,y:160,wires:[]},
   {id:id('B7'),type:'debug',z:tab,name:'! R08 НУЖНА НОВАЯ ПОДПИСЬ',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1230,y:255,wires:[]},
   {id:id('B8'),type:'debug',z:tab,name:'✕ R08 ДОКАЗАТЕЛЬСТВО ОТКЛОНЕНО',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1230,y:355,wires:[]},
   {id:id('B9'),type:'comment',z:tab,
    name:'Два физических узла — не два независимых администратора',
    info:'Эта стадия не даёт право деплоить пакет: для установки нужен независимый MAS Policy/Lifecycle.',
    x:480,y:435,wires:[]},
   {id:id('C0'),type:'comment',z:tab,
    name:'Никаких ssh, exec, function или приватных ключей в графе',
    info:'Все операции с ключами и проверкой происходят вне Node-RED. Редактор только отображает публичную квитанцию.',
    x:485,y:515,wires:[]}
  ]
 };
}
