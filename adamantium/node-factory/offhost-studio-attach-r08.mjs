// SPDX-License-Identifier: Apache-2.0
// Attach a second R08 public proof lane without replacing another agent's tab.
// Existing graph nodes are never mutated. Caller owns CAS/backup/restart.
import {makeOffhostAnchorObserver} from './offhost-studio-observer-r08.mjs';
export function makeOffhostAnchorAttachment(statusDirectory,existingTabId){
 if(typeof existingTabId!=='string'||!/^[a-f0-9]{16}$/.test(existingTabId))
  throw new TypeError('explicit_existing_hex_tab_required');
 const proposed=makeOffhostAnchorObserver(statusDirectory);
 const nodes=proposed.flows.filter(n=>n.type!=='tab');
 const sourceIds=new Map(nodes.map((node,i)=>[
  node.id,'b08b0000000000'+(i+1).toString(16).padStart(2,'0')
 ]));
 const allowed=new Set(['comment','watch','inject','file in','json','switch','debug']);
 const lane=nodes.map(node=>{
  if(!allowed.has(node.type))throw new TypeError('offhost_unsafe_view_node');
  return {
   ...node,
   id:sourceIds.get(node.id),
   z:existingTabId,
   x:node.x,
   y:node.y+640,
   wires:(node.wires||[]).map(targets=>targets.map(target=>{
    if(!sourceIds.has(target))throw new TypeError('offhost_unbound_target');
    return sourceIds.get(target);
   }))
  };
 });
 if(new Set(lane.map(n=>n.id)).size!==lane.length)
  throw new TypeError('offhost_duplicate_ids');
 return {
  schema:'adamantium.factory.offhost-attachment/1',
  targetTabId:existingTabId,nodes:lane,
  preservesExisting:true,privateKeyExposed:false,
  authCapabilitiesGranted:false,productionWrites:false
 };
}
