// R01 deliberately supports only inert, disabled Node-RED lab tabs/comments.
// This is an *adapter guard*, not a Universal Graph IR validator or auth engine.
import {createHash} from 'node:crypto';

export class GraphPolicyError extends Error {
  constructor(code) { super(code); this.name='GraphPolicyError'; this.code=code; }
}
const deny=code=>{throw new GraphPolicyError(code)};
const LAB='Adamantium R01 Lab';
const hex=s=>createHash('sha256').update(s).digest('hex').slice(0,16);
export const TAB_ID=hex('adamantium-r01/bootstrap/lab-tab');
const ident=/^[a-zA-Z0-9._-]{8,128}$/;
const labelOk=s=>typeof s==='string' && s.length>=1 && s.length<=180 &&
  !/[\u0000-\u001f\u007f<>]/.test(s);
const own=o=>o!==null && typeof o==='object' && !Array.isArray(o) &&
  Object.getPrototypeOf(o)===Object.prototype;

export function validatePatchInput(input) {
  if(!own(input) || !ident.test(input.idempotency_key||'') ||
    !labelOk(input.note)) deny('invalid_patch_input');
}
export function validateSnapshotShape(snapshot) {
  if(!own(snapshot)||typeof snapshot.rev!=='string'||
     snapshot.rev.length===0||snapshot.rev.length>128||
     !Array.isArray(snapshot.flows)||snapshot.flows.length>256)
    deny('invalid_snapshot');
}
export function publicView(snapshot) {
  validateSnapshotShape(snapshot);
  // Exclude credentials, code, source scripts, environment and payloads.
  return {
    revision:snapshot.rev,
    count:snapshot.flows.length,
    nodes:snapshot.flows.map(n=>{
      if(!own(n))return {kind:'invalid'};
      return {
        id:typeof n.id==='string' ? n.id.slice(0,128) : '',
        type:typeof n.type==='string' ? n.type.slice(0,80) : 'unknown',
        workspace:typeof n.z==='string' ? n.z.slice(0,128) : ''
      };
    })
  };
}
function isManagedSnapshot(flows) {
  if(!Array.isArray(flows)||flows.length>128)return false;
  let tabs=0;
  for(const n of flows) {
    if(!own(n)||typeof n.id!=='string')return false;
    if(n.type==='tab') {
      if(n.id!==TAB_ID||n.label!==LAB||n.disabled!==true) return false;
      tabs++;
    } else if(n.type==='comment') {
      if(n.z!==TAB_ID||!ident.test(n.id)||!labelOk(n.name) ||
        n.name!=='Agent note'||typeof n.info!=='string' ||
        !labelOk(n.info)||!Number.isFinite(n.x)||!Number.isFinite(n.y) ||
        n.x<0||n.y<0||n.x>5000||n.y>5000) return false;
    } else return false;
  }
  return tabs === 1 && flows.filter(n=>n.type==='comment').length<=127;
}
export function validateSafeGraph(flows) {
  if(!isManagedSnapshot(flows))deny('non_isolated_or_unsafe_graph');
  const unique=new Set(flows.map(n=>n.id));
  if(unique.size!==flows.length)deny('duplicate_node_id');
  return {
    valid:true,
    executable:false,
    kinds:['tab','comment'],
    nodes:flows.length,
    disabled:true
  };
}
export function createDraft(snapshot, input) {
  validatePatchInput(input);
  validateSnapshotShape(snapshot);
  if(snapshot.rev!==input.base_revision)deny('stale_base_revision');
  if(snapshot.flows.length && !isManagedSnapshot(snapshot.flows))
    deny('non_isolated_or_unsafe_graph');
  const id=hex('adamantium-r01/comment/'+input.idempotency_key);
  if(snapshot.flows.some(n=>n.id===id))deny('node_already_exists');
  const flows=structuredClone(snapshot.flows);
  if(!flows.length)
    flows.push({id:TAB_ID,type:'tab',label:LAB,disabled:true,info:''});
  flows.push({
    id,type:'comment',z:TAB_ID,name:'Agent note',info:input.note,
    x:220,y:100+(flows.length-1)*65,wires:[]
  });
  validateSafeGraph(flows);
  return {base_revision:snapshot.rev,flows};
}
export function digestFlows(flows) {
  return createHash('sha256').update(JSON.stringify(flows)).digest('hex');
}
