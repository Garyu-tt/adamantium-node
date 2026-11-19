import {clone,digest,simulateSafeFlow,validateSafeFlow} from '../graph-schema/safe-flow.mjs';

function error(code,status=400) {
  return Object.assign(new Error(code),{code,status});
}
const keyOk = s => typeof s==='string' && /^[a-zA-Z0-9_-]{8,96}$/.test(s);

// In-memory draft revision store. Source-of-truth production Graph Manager,
// signed Lifecycle and persistence are intentionally NOT implemented here.
export class AgentGraphService {
  #revision=0;
  #flow=null;
  #snapshots=new Map([[0,null]]);
  #ids=new Map();
  #audit=[];
  #sequence=0;
  dispatch(request) {
    if(!request || typeof request!=='object' || Array.isArray(request))
      throw error('invalid_operation');
    switch(request.op) {
      case 'graph.inspect': return this.inspect();
      case 'graph.validate': return this.validate(request);
      case 'graph.patch': return this.patch(request);
      case 'graph.test': return this.test(request);
      case 'graph.rollback': return this.rollback(request);
      case 'graph.explain': return this.explain();
      case 'graph.deploy':
        throw error('deployment_requires_separate_signed_lifecycle',403);
      default:throw error('unknown_operation',404);
    }
  }
  inspect() {
    return {revision:this.#revision,graph:clone(this.#flow),
      fingerprint:this.#flow?digest(this.#flow):null,
      deployment:'never',editor:'node-red-bootstrap-compatible'};
  }
  validate(req) {
    const graph=req.graph ?? this.#flow;
    if(!graph)throw error('no_graph');
    return {revision:this.#revision,...validateSafeFlow(graph),
      fingerprint:digest(graph)};
  }
  test(req) {
    if(req.base_revision !== this.#revision)throw error('version_mismatch',409);
    if(!this.#flow)throw error('no_graph');
    return {revision:this.#revision,validation:this.validate({}),
      result:simulateSafeFlow(this.#flow),proof_kind:'deterministic_simulation'};
  }
  explain() {
    return {revision:this.#revision,policy:'R01-inert-flow-only',
      allowed:['tab','inject','change','debug'],
      node_red_runtime:'not_invoked',editable:'draft_only',
      can_deploy:false,executable:false,
      audit:this.#audit.map(clone)};
  }
  #commit(kind,req,next,metadata) {
    if(!Number.isSafeInteger(req.base_revision)||req.base_revision<0)
      throw error('base_revision_required');
    if(!keyOk(req.idempotency_key))throw error('idempotency_key_required');
    const fingerprint=digest({kind,base_revision:req.base_revision,metadata,next});
    const existing=this.#ids.get(req.idempotency_key);
    if(existing) {
      if(existing.fingerprint!==fingerprint)
        throw error('idempotency_key_conflict',409);
      return clone(existing.result);
    }
    if(req.base_revision!==this.#revision)
      throw error('version_mismatch',409);
    if(this.#revision>=10000 || this.#audit.length>=10000)
      throw error('revision_budget_exhausted',409);
    if(next!==null)validateSafeFlow(next);
    this.#revision++;
    this.#flow=clone(next);
    this.#snapshots.set(this.#revision,clone(next));
    const record={sequence:++this.#sequence,operation:kind,
      base_revision:req.base_revision,revision:this.#revision,
      fingerprint:next?digest(next):null,metadata};
    this.#audit.push(record);
    const result={ok:true,revision:this.#revision,
      deployment:'none',fingerprint:record.fingerprint,
      audit_sequence:record.sequence};
    this.#ids.set(req.idempotency_key,{fingerprint,result:clone(result)});
    return result;
  }
  patch(req) {
    return this.#commit('graph.patch',req,req.graph,{origin:'agent_draft'});
  }
  rollback(req) {
    if(!Number.isSafeInteger(req.target_revision)||
       !this.#snapshots.has(req.target_revision))
      throw error('target_revision_not_found',404);
    const target=this.#snapshots.get(req.target_revision);
    return this.#commit('graph.rollback',req,target,
      {target_revision:req.target_revision});
  }
}
