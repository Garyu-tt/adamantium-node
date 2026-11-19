// SPDX-License-Identifier: Apache-2.0
// Safe, read-only UI projection; signer private key never enters Node-RED.
import {isAbsolute,resolve,join,parse} from 'node:path';
const node=n=>'a1100000000000'+n;
const next=n=>[[node(n)]];
export function makePublicWitnessObserver(statusRoot){
 if(typeof statusRoot!=='string'||!isAbsolute(statusRoot))
  throw new TypeError('owner_absolute_public_status_root_required');
 const root=resolve(statusRoot);
 if(root===parse(root).root)throw new TypeError('status_root_is_filesystem_root');
 const file=join(root,'public-verifier-status.json');
 const tab=node('07');
 return {
  schema:'adamantium.factory.public-witness-observer/1',
  signerPrivateKeyExposed:false,
  mutatesLedger:false,canPublish:false,
  flows:[
   {id:tab,type:'tab',label:'07 · PUBLIC VERIFY R07',disabled:false,
    info:'Public Ed25519 checks only. No private signer, no MAS permissions.'},
   {id:node('90'),type:'comment',z:tab,name:'R07 · Независимая проверка по публичному ключу',
    info:'Показывает результат отдельной программы проверки. Не считает подпись разрешением на установку.',
    x:390,y:90,wires:[]},
   {id:node('91'),type:'watch',z:tab,name:'Следить за результатом проверки',
    files:file,recursive:false,x:180,y:180,wires:next('93')},
   {id:node('92'),type:'inject',z:tab,name:'▶ Прочитать последний отчёт',
    props:[{p:'payload'}],repeat:'',crontab:'',once:false,onceDelay:0.1,
    payload:'status',payloadType:'str',topic:'',
    x:185,y:250,wires:next('93')},
   {id:node('93'),type:'file in',z:tab,name:'Только чтение: public status',
    filename:file,filenameType:'str',format:'utf8',
    chunk:false,sendError:false,encoding:'none',allProps:false,
    x:450,y:215,wires:next('94')},
   {id:node('94'),type:'json',z:tab,name:'Разобрать статус проверки',
    property:'payload',action:'obj',pretty:false,
    x:665,y:215,wires:next('95')},
   {id:node('95'),type:'switch',z:tab,name:'Актуальна / устарела / ошибка',
    property:'payload.status',propertyType:'msg',
    rules:[
     {t:'eq',v:'verified_current',vt:'str'},
     {t:'eq',v:'verified_stale',vt:'str'},
     {t:'eq',v:'invalid',vt:'str'}
    ],checkall:'true',repair:false,outputs:3,
    x:900,y:215,wires:[[node('96')],[node('97')],[node('98')]]},
   {id:node('96'),type:'debug',z:tab,name:'✓ ПОДПИСЬ АКТУАЛЬНА',
    active:true,tosidebar:true,console:false,tostatus:true,
    complete:'payload',targetType:'msg',
    statusVal:'payload.signedSequence',statusType:'msg',
    x:1160,y:145,wires:[]},
   {id:node('97'),type:'debug',z:tab,name:'! ПОДПИСЬ УСТАРЕЛА',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1160,y:225,wires:[]},
   {id:node('98'),type:'debug',z:tab,name:'✕ ДОКАЗАТЕЛЬСТВО ОТКЛОНЕНО',
    active:true,tosidebar:true,console:false,tostatus:false,
    complete:'payload',targetType:'msg',statusVal:'',statusType:'auto',
    x:1160,y:305,wires:[]},
   {id:node('99'),type:'comment',z:tab,
    name:'Состояние проверяется без доступа к закрытому ключу',
    info:'Публичный fingerprint закрепляется вне доверия самого свидетеля. Здесь только read-only файлы.',
    x:475,y:395,wires:[]},
   {id:node('A0'),type:'comment',z:tab,
    name:'Same-host witness ≠ независимый сервер',
    info:'На одном ПК можно проверить подписи, но невозможно доказать независимость от его администратора.',
    x:465,y:470,wires:[]}
  ]
 };
}
