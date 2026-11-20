/**
 * Adamantium Construct R03 reactive coordinator (editor-side, non-executing).
 * Opt-in events, bounded work queue, fail-closed ownership tracking.
 * No MAS rights, runtime execution, network calls, timers or deploy.
 * SPDX-License-Identifier: Apache-2.0
 */
export const REACTIVE_FORMAT="adamantium.native-reactions/1";
const ID=/^[a-zA-Z0-9][a-zA-Z0-9_.:-]{0,127}$/;
const OWN_ORIGIN="adamantium-construct-native-r03";
export const REACTIVE_ORIGIN=OWN_ORIGIN;
export const MAX_REACTIVE_RULES=24;
export const MAX_REACTIVE_PENDING=16;
export const MAX_REACTIVE_RUNS=48;
export const MAX_REACTIVE_PER_FLOW=6;
const TRIGGERS=new Set(["inject","debug","change","switch","delay","comment","json","catch"]);
const PRESETS=new Set(["inject_debug","catch_debug","change_debug"]);
const isObj=v=>v!==null&&typeof v==="object"&&!Array.isArray(v);
const has=(o,k)=>Object.prototype.hasOwnProperty.call(o,k);
const safe=(okay,message)=>{if(!okay)throw new TypeError(message);};
const safeId=(v,kind)=>{safe(typeof v==="string"&&ID.test(v),"invalid "+kind);return v;};
const clone=x=>JSON.parse(JSON.stringify(x));

export function validateReactionRule(rule){
  safe(isObj(rule),"invalid reaction rule");
  const id=safeId(rule.id,"rule ID");
  safe(rule.event==="nodes:add","unsupported reaction event");
  safe(TRIGGERS.has(rule.whenType),"unsupported trigger type");
  safe(PRESETS.has(rule.presetId),"unsupported preset ID");
  safe(typeof rule.enabled==="boolean","enabled must be explicit");
  safe(typeof rule.cleanup==="boolean","cleanup must be explicit");
  const maxPerFlow=rule.maxPerFlow??1;
  safe(Number.isSafeInteger(maxPerFlow)&&maxPerFlow>=1&&maxPerFlow<=4,"invalid rule flow limit");
  return {id,event:"nodes:add",whenType:rule.whenType,presetId:rule.presetId,
    enabled:rule.enabled,cleanup:rule.cleanup,maxPerFlow};
}
export function validateReactionEvent(event){
  safe(isObj(event),"invalid native event");
  safe(["nodes:add","nodes:remove"].includes(event.event),"unsupported event");
  const flowId=safeId(event.flowId,"flow ID");
  const nodeId=safeId(event.nodeId,"node ID");
  safe(typeof event.nodeType==="string"&&TRIGGERS.has(event.nodeType),"untrusted node type");
  safe(typeof event.origin==="string"&&event.origin.length<=128,"invalid event origin");
  return {event:event.event,flowId,nodeId,nodeType:event.nodeType,origin:event.origin};
}
export function freshReactionRules(){
  return {format:REACTIVE_FORMAT,rules:[]};
}
export function restoreReactionRules(raw){
  if(raw===null||raw===undefined)return freshReactionRules();
  safe(isObj(raw)&&raw.format===REACTIVE_FORMAT&&Array.isArray(raw.rules)&&raw.rules.length<=MAX_REACTIVE_RULES,
    "invalid reaction registry");
  safe(JSON.stringify(raw).length<=24000,"reaction registry exceeds size");
  const keys=new Set();
  return {format:REACTIVE_FORMAT,rules:raw.rules.map(r=>{
    const v=validateReactionRule(r);
    safe(!keys.has(v.id),"duplicate reaction ID");keys.add(v.id);
    // Never resurrect automatic mutation permission after page reload.
    return {...v,enabled:false};
  })};
}
/**
 * One source-node trigger can create at most one atomic blueprint stamp per rule.
 * Receipt IDs and owner relationships are session-only; no production graph
 * rights or privileged identity is derived from this local ledger.
 */
export class ReactiveCoordinator {
  constructor(serializedRules=null){
    const restored=restoreReactionRules(serializedRules);
    this.rules=Object.create(null);
    for(const r of restored.rules)this.rules[r.id]=r;
    this.queue=[];
    this.busy=null;
    this.seen=new Set();
    this.owned=Object.create(null);
    this.receipts=[];
    this.started=0;
  }
  rulesSnapshot(){
    return clone({format:REACTIVE_FORMAT,rules:Object.values(this.rules)});
  }
  list(){return clone(Object.values(this.rules));}
  enabledCount(){return Object.values(this.rules).filter(r=>r.enabled).length;}
  addRule(raw){
    const rule=validateReactionRule(raw);
    safe(!has(this.rules,rule.id),"reaction ID already used");
    safe(Object.keys(this.rules).length<MAX_REACTIVE_RULES,"reaction budget exceeded");
    this.rules[rule.id]=rule;
    return clone(rule);
  }
  setEnabled(id,value){
    safeId(id,"rule ID");
    safe(typeof value==="boolean","enabled must be boolean");
    safe(has(this.rules,id),"unknown reaction rule");
    this.rules[id].enabled=value;
    if(!value)this.queue=this.queue.filter(plan=>plan.action!=="build"||plan.ruleId!==id);
    return clone(this.rules[id]);
  }
  removeRule(id){
    safeId(id,"rule ID");
    safe(has(this.rules,id),"unknown reaction rule");
    this.rules[id].enabled=false;
    delete this.rules[id];
    // Leave ownership receipts to support deliberate cleanup. Never delete
    // previously constructed graph nodes merely by removing a local rule.
    this.queue=this.queue.filter(plan=>plan.ruleId!==id);
  }
  accept(raw){
    const event=validateReactionEvent(raw);
    if(event.origin===OWN_ORIGIN || event.origin.startsWith(OWN_ORIGIN+":"))
      return {enqueued:0,reason:"own-origin"};
    const relevant=event.event==="nodes:add"
      ?Object.values(this.rules).filter(r=>r.enabled&&r.whenType===event.nodeType)
      :Object.values(this.owned).filter(o=>o.sourceId===event.nodeId&&o.flowId===event.flowId&&o.cleanup&&this.rules[o.ruleId]?.enabled===true);
    if(relevant.length===0)return {enqueued:0,reason:"unmatched"};
    let added=0;
    for(const ruleOrOwner of relevant){
      const isDelete=event.event==="nodes:remove";
      const ruleId=ruleOrOwner.ruleId||ruleOrOwner.id;
      if(isDelete&&Object.keys(this.owned).length===0)continue;
      if(!isDelete && this.started+this.queue.filter(p=>p.action==="build").length>=MAX_REACTIVE_RUNS)continue;
      const receipt=event.event+":"+event.nodeId+":"+ruleId;
      if(this.seen.has(receipt))continue;
      if(this.queue.length>=MAX_REACTIVE_PENDING)break;
      if(!isDelete){
        const count=Object.values(this.owned).filter(o=>o.ruleId===ruleId&&o.flowId===event.flowId).length;
        const pending=this.queue.filter(p=>p.action==="build"&&p.ruleId===ruleId&&p.flowId===event.flowId).length+
          (this.busy?.action==="build"&&this.busy.ruleId===ruleId&&this.busy.flowId===event.flowId?1:0);
        if(count+pending>=Math.min(ruleOrOwner.maxPerFlow,MAX_REACTIVE_PER_FLOW))continue;
      }
      const plan={
        id:receipt,action:isDelete?"cleanup":"build",
        flowId:event.flowId,sourceId:event.nodeId,ruleId,
        presetId:isDelete?null:ruleOrOwner.presetId
      };
      this.seen.add(receipt);this.queue.push(plan);added++;
    }
    return {enqueued:added,reason:added?"queued":"suppressed"};
  }
  next(){
    if(this.busy)return null;
    const plan=this.queue.shift()||null;
    if(plan){
      this.busy=plan;
      if(plan.action==="build")this.started++;
    }
    return plan?clone(plan):null;
  }
  complete(planId,{success,nodeIds=[]}={}){
    safe(typeof planId==="string"&&this.busy?.id===planId,"no matching active construction");
    safe(typeof success==="boolean","construction success must be explicit");
    safe(Array.isArray(nodeIds)&&nodeIds.length<=64,"invalid generated node IDs");
    if(success&&this.busy.action==="build"){
      safe(nodeIds.length>0,"successful build must provide generated IDs");
      const ids=new Set(nodeIds);
      for(const id of ids)safeId(id,"generated node ID");
      safe(ids.size===nodeIds.length,"repeated generated node ID");
      this.owned[this.busy.id]={planId:this.busy.id,ruleId:this.busy.ruleId,
        sourceId:this.busy.sourceId,flowId:this.busy.flowId,nodeIds:nodeIds.slice(),
        cleanup:this.rules[this.busy.ruleId]?.cleanup===true};
    }
    if(success&&this.busy.action==="cleanup"){
      const id="nodes:add:"+this.busy.sourceId+":"+this.busy.ruleId;
      delete this.owned[id];
    }
    const receipt={id:this.busy.id,action:this.busy.action,success,nodeCount:nodeIds.length};
    this.receipts=[...this.receipts.slice(-127),receipt];
    this.busy=null;
    return receipt;
  }
  getOwned(flowId,sourceId,ruleId){
    return clone(this.owned["nodes:add:"+sourceId+":"+ruleId]||null);
  }
  status(){
    return {rules:Object.keys(this.rules).length,activeRules:this.enabledCount(),
      queued:this.queue.length,busy:!!this.busy,started:this.started,
      ownership:Object.keys(this.owned).length,receipts:this.receipts.length};
  }
}
