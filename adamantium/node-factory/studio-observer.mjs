// SPDX-License-Identifier: Apache-2.0
// Read-only owner-provisioned Node-RED observer for an existing R05 ledger.
// Not exposed to untrusted agent API: the ledgerRoot is an operator-only path.
import {isAbsolute,parse,resolve,join} from 'node:path';
const id=n=>'a1100000000000'+n;
const output=i=>[[id(i)]];
const inject=(n,name,wire,y)=>({
 id:id(n),type:'inject',z:id('05'),name,
 props:[{p:'payload'}],repeat:'',crontab:'',once:false,onceDelay:0.3,
 topic:'',payload:'read',payloadType:'str',x:185,y,wires:output(wire)
});
const source=(n,name,filename,wire,y)=>({
 id:id(n),type:'file in',z:id('05'),name,
 filename,filenameType:'str',format:'utf8',
 chunk:false,sendError:false,encoding:'none',allProps:false,
 x:470,y,wires:output(wire)
});
const json=(n,name,wire,y)=>({
 id:id(n),type:'json',z:id('05'),name,property:'payload',
 action:'obj',pretty:false,x:700,y,wires:output(wire)
});
const debug=(n,name,y)=>({
 id:id(n),type:'debug',z:id('05'),name,active:true,
 tosidebar:true,console:false,tostatus:false,complete:'payload',
 targetType:'msg',statusVal:'',statusType:'auto',x:935,y,wires:[]
});
export function makeFactoryLedgerObserver(ledgerRoot){
 if(typeof ledgerRoot!=='string'||!isAbsolute(ledgerRoot))
  throw new TypeError('absolute_owner_provisioned_ledger_required');
 const normalized=resolve(ledgerRoot);
 if(normalized===parse(normalized).root)
  throw new TypeError('filesystem_root_not_a_ledger');
 const snapshot=join(normalized,'view.json');
 const graph=join(normalized,'g0-preview.json');
 return {
  schema:'adamantium.factory.studio-observer/1',
  editorIsAuthority:false,journalWritableFromFlow:false,
  flows:[
   {id:id('05'),type:'tab',label:'05 · R05 DURABLE FACTORY',
    disabled:false,info:'Only observes a separate durable factory journal.'},
   {id:id('50'),type:'comment',z:id('05'),
    name:'R05 · durable proof events, read-only',info:'No MAS grants or production install',
    x:290,y:90,wires:[]},
   {id:id('51'),type:'watch',z:id('05'),
    name:'Watch R05 materialized view',files:snapshot,recursive:false,
    x:190,y:190,wires:output('53')},
   inject('52','Show current ledger','53',260),
   source('53','Read-only view.json',snapshot,'54',215),
   json('54','Parse journal snapshot','55',215),
   debug('55','Factory proof → Debug',215),
   {id:id('56'),type:'comment',z:id('05'),
    name:'Hash chain is not independent witness',
    info:'External signed checkpoint is required to detect whole-history rollback',
    x:495,y:305,wires:[]},
   inject('61','Show canonical G0 preview','62',420),
   source('62','Read-only G0 projection',graph,'63',420),
   json('63','Parse G0','64',420),
   debug('64','G0 → Debug',420),
   {id:id('65'),type:'comment',z:id('05'),
    name:'No authorization; G0 schema only',
    info:'Structural proof does not grant install or execution rights',
    x:505,y:525,wires:[]}
  ]
 };
}
