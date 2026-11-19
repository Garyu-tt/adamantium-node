// AI-facing, headless Agent Graph API R01.
// No arbitrary shell, JS function nodes, network nodes, plugin installation,
// Graph IR permission minting or "auto deploy" from an AI message.
import {randomUUID} from 'node:crypto';
import {
  createDraft, digestFlows, GraphPolicyError, publicView,
  validateSafeGraph, validateSnapshotShape
} from '../graph-schema/sandbox-flow.mjs';

const fail=code=>{throw new GraphPolicyError(code);};
const keyOk=s=>typeof s==='string' &&
  /^[a-zA-Z0-9._-]{8,128}$/.test(s);

export class AgentGraphGateway {
  #client;
  #writesEnabled;
  #drafts=new Map();
  #receipts=new Map();
  #idempotency=new Map();
  #serial=Promise.resolve();

  // writesEnabled must only be supplied by a trusted, independent sandbox
  // supervisor. Never derive it from agent-supplied request JSON.
  constructor({client, writesEnabled=false}) {
    if(!client || typeof client.getFlows!=='function' ||
       typeof client.setFlows!=='function')fail('invalid_client');
    this.#client=client;
    this.#writesEnabled=writesEnabled===true;
  }
  async invoke(request) {
    const work=()=>this.#invoke(request);
    const pending=this.#serial.then(work,work);
    this.#serial=pending.then(()=>undefined,()=>undefined);
    return pending;
  }
  #memo(action,request,operation) {
    if(!keyOk(request.idempotency_key))fail('idempotency_key_required');
    const key=request.idempotency_key;
    // Replays with changed payload MUST be rejected even after success.
    const canonical=JSON.stringify({
      action, ...Object.fromEntries(
        Object.entries(request).filter(([k])=>k!=='idempotency_key')
        .sort(([a],[b])=>a.localeCompare(b))
      )
    });
    const existing=this.#idempotency.get(key);
    if(existing) {
      if(existing.canonical!==canonical)fail('idempotency_key_conflict');
      return structuredClone(existing.result);
    }
    return {key,canonical,operation};
  }
  async #idempotent(action,request,fn) {
    const lookup=this.#memo(action,request,fn);
    if(!lookup.operation)return lookup;
    const result=await fn();
    this.#idempotency.set(lookup.key,{
      canonical:lookup.canonical,result:structuredClone(result)
    });
    return result;
  }
  async #invoke(request) {
    if(!request || typeof request!=='object' ||
       Array.isArray(request))fail('invalid_agent_request');
    const operation=request.operation;
    switch(operation) {
      case 'graph.inspect': {
        const snapshot=await this.#client.getFlows();
        return {operation, ...publicView(snapshot)};
      }
      case 'graph.patch':
        return this.#idempotent(operation,request,async()=>{
          const snapshot=await this.#client.getFlows();
          const prepared=createDraft(snapshot,request);
          const draft_id=randomUUID();
          const digest=digestFlows(prepared.flows);
          this.#drafts.set(draft_id,{
            before:structuredClone(snapshot),
            after:structuredClone(prepared.flows),
            digest, tested:false
          });
          return {
            operation,draft_id,base_revision:prepared.base_revision,
            digest, summary:validateSafeGraph(prepared.flows),
            status:'draft_only',authorized:false,executed:false
          };
        });
      case 'graph.validate': {
        const d=this.#drafts.get(request.draft_id);
        if(!d)fail('unknown_draft');
        return {
          operation,draft_id:request.draft_id,
          ...validateSafeGraph(d.after),
          digest:d.digest,authorized:false
        };
      }
      case 'graph.test': {
        const d=this.#drafts.get(request.draft_id);
        if(!d)fail('unknown_draft');
        const result=validateSafeGraph(d.after);
        const current=await this.#client.getFlows();
        if(current.rev!==d.before.rev ||
           digestFlows(current.flows)!==digestFlows(d.before.flows))
          fail('snapshot_changed_before_test');
        d.tested=true;
        return {
          operation,draft_id:request.draft_id,passed:true,
          mode:'static_contract_only',checks:[
            'safe_node_types','disabled_tab','typed_ownership',
            'no_execution_nodes','source_revision_unchanged'
          ],...result,executed:false
        };
      }
      case 'graph.deploy':
        return this.#idempotent(operation,request,async()=>{
          if(!this.#writesEnabled)fail('sandbox_write_grant_required');
          const d=this.#drafts.get(request.draft_id);
          if(!d || !d.tested)fail('tested_draft_required');
          validateSafeGraph(d.after);
          const current=await this.#client.getFlows();
          if(current.rev!==d.before.rev ||
             digestFlows(current.flows)!==digestFlows(d.before.flows))
            fail('stale_revision_or_content');
          // Node-RED v2 POST includes rev unconditionally. The backend CAS
          // rejects any concurrent writer with HTTP 409.
          const saved=await this.#client.setFlows({
            rev:d.before.rev, flows:d.after
          });
          const receipt_id=randomUUID();
          const receipt={
            before:structuredClone(d.before),
            after_revision:saved.rev, after_digest:d.digest,
            confirmed:false
          };
          this.#receipts.set(receipt_id,receipt);
          const readback=await this.#client.getFlows();
          if(readback.rev!==saved.rev ||
             digestFlows(readback.flows)!==d.digest)
            fail('deployment_unverified_requires_operator_reconciliation');
          receipt.confirmed=true;
          return {
            operation,receipt_id,status:'applied_to_sandbox',
            before_revision:d.before.rev,after_revision:saved.rev,
            validated:true,executed:false
          };
        });
      case 'graph.rollback':
        return this.#idempotent(operation,request,async()=>{
          if(!this.#writesEnabled)fail('sandbox_write_grant_required');
          const receipt=this.#receipts.get(request.receipt_id);
          if(!receipt)fail('unknown_deployment_receipt');
          if(receipt.rolled_back)fail('receipt_already_rolled_back');
          const current=await this.#client.getFlows();
          // Do not overwrite any other agent's or human's newer changes.
          if(current.rev!==receipt.after_revision ||
             digestFlows(current.flows)!==receipt.after_digest)
            fail('rollback_conflict_operator_required');
          const restored=await this.#client.setFlows({
            rev:receipt.after_revision,flows:receipt.before.flows
          });
          const check=await this.#client.getFlows();
          if(check.rev!==restored.rev ||
             digestFlows(check.flows)!==digestFlows(receipt.before.flows))
            fail('rollback_readback_unverified');
          receipt.rolled_back=true;
          return {
            operation,status:'rolled_back_and_verified',
            receipt_id:request.receipt_id,
            restored_revision:restored.rev,executed:false
          };
        });
      case 'graph.explain': {
        const d=this.#drafts.get(request.draft_id);
        if(!d)fail('unknown_draft');
        return {
          operation,
          draft_id:request.draft_id,
          changes:d.after.length-d.before.flows.length,
          base_revision:d.before.rev,
          reason:'Creates only disabled Node-RED lab tab and inert comment.',
          privileges:'none',
          will_run:false,
          needs_independent_sandbox_approval:true
        };
      }
      default:fail('unsupported_graph_operation');
    }
  }
}
