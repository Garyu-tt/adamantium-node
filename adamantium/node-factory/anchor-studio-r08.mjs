// SPDX-License-Identifier: Apache-2.0
// Inert UI adapter: observed status cannot grant a network or MAS capability.
import {isAbsolute,resolve,parse,join} from 'node:path';
const nid=n=>'a1100000000000'+n;
const wires=n=>[[nid(n)]];
export function makeRemoteFactoryAnchorObserver(statusRoot){
 if(typeof statusRoot!=='string'||!isAbsolute(statusRoot))
  throw new TypeError('explicit_absolute_owner_status_root_required');
 const root=resolve(statusRoot);
 if(root===parse(root).root)throw new TypeError('filesystem_root_not_status');
 const file=join(root,'remote-anchor-status.json');
 const tab=nid('08');
 return {
  schema:'adamantium.factory.remote-anchor-observer/1',
  networkApplied:false,sourcePrivateKeyShared:false,installGrant:false,
  flows:[
   {id:tab,type:'tab',label:'08 · REMOTE ANCHOR R08',disabled:false,
    info:'Separate audit host is not connected until a verified MAS capability and pinned attestation exist.'},
   {id:nid('B0'),type:'comment',z:tab,
    name:'R08 · ОТДЕЛЬНЫЙ АУДИТ / СВИДЕТЕЛЬ',
    info:'Полностью независимый сервер пока НЕ ПОДКЛЮЧЁН. Любой локальный тест отдельным процессом не считается отдельным хостом.',
    x:430,y:95,wires:[]},
   {id:nid('B1'),type:'watch',z:tab,name:'Следить за публичным статусом удалённого свидетеля',
    files:file,recursive:false,x:195,y:185,wires:wires('B3')},
   {id:nid('B2'),type:'inject',z:tab,name:'▶ Проверить статус подключения',
    props:[{p:'payload'}],repeat:'',crontab:'',once:false,onceDelay:0.1,
    payload:'refresh',payloadType:'str',topic:'',x:195,y:250,wires:wires('B3')},
   {id:nid('B3'),type:'file in',z:tab,
    name:'Только чтение remote-anchor-status.json',
    filename:file,filenameType:'str',format:'utf8',
    chunk:false,sendError:false,encoding:'none',allProps:false,
    x:492,y:220,wires:wires('B4')},
   {id:nid('B4'),type:'json',z:tab,name:'Декодировать статус',
    property:'payload',action:'obj',pretty:false,
    x:695,y:220,wires:wires('B5')},
   {id:nid('B5'),type:'switch',z:tab,name:'Не подключён / Доказательство / Ошибка',
    property:'payload.status',propertyType:'msg',
    rules:[
     {t:'eq',v:'not_connected',vt:'str'},
     {t:'eq',v:'verified_attestation',vt:'str'},
     {t:'eq',v:'invalid',vt:'str'}
    ],checkall:'true',repair:false,outputs:3,
    x:962,y:225,wires:[[nid('B6')],[nid('B7')],[nid('B8')]]},
   {id:nid('B6'),type:'debug',z:tab,name:'○ НЕ ПОДКЛЮЧЕНО',
    active:true,tosidebar:true,console:false,tostatus:true,
    complete:'payload',targetType:'msg',statusVal:'payload.status',statusType:'msg',
    x:1200,y:150,wires:[]},
   {id:nid('B7'),type:'debug',z:tab,name:'✓ ПОДПИСЬ ЯКОРЯ',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1200,y:225,wires:[]},
   {id:nid('B8'),type:'debug',z:tab,name:'✕ ОТКЛОНЕНО',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1200,y:310,wires:[]},
   {id:nid('B9'),type:'comment',z:tab,
    name:'Нет MAS-доступа к независимому внешнему signer',
    info:'VM121 работает, но установка сервиса не авторизована. R08 UI не подключается к VM121 и не пересылает туда журналы или ключи.',
    x:530,y:385,wires:[]},
   {id:nid('BA'),type:'comment',z:tab,
    name:'Привилегии всегда отдельно от криптографического доказательства',
    info:'Сама подпись не означает одобрение, запуск, публикацию, ACL, изменение VPN или доступ к сети.',
    x:550,y:455,wires:[]}
  ]
 };
}
