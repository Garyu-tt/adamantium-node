// SPDX-License-Identifier: Apache-2.0
// R01 in-memory agent transaction engine: no process or Node-RED mutation.
import {createHash} from "node:crypto";
import {validateGraph, synthesize} from "../graph-schema/agent-graph.mjs";
import {compileNodeRed} from "../node-red-adapter/compile.mjs";

const copy = x => x === null ? null : JSON.parse(JSON.stringify(x));
const check = (v, code) => { if (!v) throw Object.assign(new Error(code), {code}); };
const digest = x => createHash("sha256").update(JSON.stringify(x)).digest("hex");
function simulate(graph) {
  const {order} = validateGraph(graph);
  const incoming = new Map(graph.nodes.map(n => [n.id, []]));
  for (const edge of graph.edges) incoming.get(edge.toNode).push(edge.fromNode);
  const outputs = new Map(), trace = [], results = [];
  for (const id of order) {
    const node = graph.nodes.find(n => n.id === id);
    const parents = incoming.get(id).map(p => outputs.get(p));
    const type = node.typeRef;
    if (type === "adamantium.demo.source@1") {
      outputs.set(id, "bootstrap");
      trace.push({node:id, status:"source", value:"bootstrap"});
    } else {
      check(parents.length === 1 && typeof parents[0] === "string",
        "simulation_missing_or_ambiguous_input");
      if (type === "adamantium.demo.set@1") {
        outputs.set(id, "verified");
        trace.push({node:id, status:"transformed", value:"verified"});
      } else {
        results.push({node:id, value:parents[0]});
        trace.push({node:id, status:"collected", value:parents[0]});
      }
    }
  }
  check(results.length >= 1, "simulation_no_sink");
  return {passed:results.every(r => r.value === "verified"),results,trace,
    engine:"adamantium.deterministic-simulator/1", actualNodeRedExecution:false};
}
export class AgentGraphService {
  constructor({sandbox=false}={}) {
    this.sandbox = sandbox === true;
    this.revision = 0;
    this.graph = null;
    this.history = [];
    this.events = [];
    this.memos = new Map();
    this.sandboxActive = null;
  }
  #key(key) {
    check(typeof key === "string" && /^[a-zA-Z0-9_.:-]{8,96}$/.test(key),
      "idempotency_key_required");
  }
  #memo(op,key,payload) {
    this.#key(key);
    const existing=this.memos.get(op+":"+key),signature=digest(payload);
    if(existing) {
      check(existing.signature===signature,"idempotency_payload_conflict");
      return copy(existing.response);
    }
    return null;
  }
  #remember(op,key,payload,response) {
    this.memos.set(op+":"+key,{signature:digest(payload),response:copy(response)});
    if(this.memos.size>1024) this.memos.delete(this.memos.keys().next().value);
  }
  inspect() {return {revision:this.revision,graph:copy(this.graph),
    sandboxActive:copy(this.sandboxActive),journalLength:this.events.length,
    persistence:"volatile",productionDeployment:false};}
  validate(candidate=this.graph) {
    check(candidate!==null,"graph_not_found");
    const {order}=validateGraph(candidate);
    return {valid:true,order,revision:candidate.revision,
      compiler:"strict-r01-typed-subset",executed:false};
  }
  test(candidate=this.graph) {
    check(candidate!==null,"graph_not_found");
    return simulate(candidate);
  }
  explain(candidate=this.graph) {
    check(candidate!==null,"graph_not_found");
    this.validate(candidate);
    return {graphId:candidate.id,revision:candidate.revision,
      nodes:candidate.nodes.map(n=>({id:n.id,type:n.typeRef})),
      connections:candidate.edges.map(e=>({from:e.fromNode,to:e.toNode,kind:e.semantics})),
      authorityGranted:false,productionReady:false};
  }
  patch({graph,base_revision,idempotency_key}) {
    const payload={graph,base_revision};
    const cached=this.#memo("patch",idempotency_key,payload);
    if(cached)return cached;
    check(Number.isSafeInteger(base_revision)&&base_revision===this.revision,
      "revision_conflict");
    const next=validateGraph(graph).graph;
    check(next.revision===this.revision+1,"graph_revision_mismatch");
    if(this.graph) check(next.id===this.graph.id,"graph_identity_change");
    this.history.push(copy(this.graph));
    this.graph=next;this.revision=next.revision;
    const receipt={ok:true,revision:this.revision,graphId:next.id,
      persisted:false,executed:false,priorRevision:base_revision};
    this.events.push({kind:"graph.patch",revision:this.revision,
      requestDigest:digest(payload)});
    this.#remember("patch",idempotency_key,payload,receipt);
    return copy(receipt);
  }
  rollback({base_revision,idempotency_key}) {
    const payload={base_revision};
    const cached=this.#memo("rollback",idempotency_key,payload);
    if(cached)return cached;
    check(base_revision===this.revision,"revision_conflict");
    check(this.history.length>0,"no_rollback_snapshot");
    const previous=this.history.pop();
    const nextRevision=this.revision+1;
    this.graph=previous===null?null:{...previous,revision:nextRevision};
    this.revision=nextRevision;
    this.sandboxActive=null;
    const receipt={ok:true,revision:this.revision,restored:previous!==null,
      productionRollback:false,priorRevision:base_revision};
    this.events.push({kind:"graph.rollback",revision:this.revision});
    this.#remember("rollback",idempotency_key,payload,receipt);
    return copy(receipt);
  }
  deploy({base_revision,idempotency_key}) {
    const payload={base_revision};
    const cached=this.#memo("deploy",idempotency_key,payload);
    if(cached)return cached;
    check(this.sandbox,"deployment_not_authorized");
    check(base_revision===this.revision,"revision_conflict");
    const result=this.test();
    check(result.passed,"sandbox_test_failed");
    this.sandboxActive=copy(this.graph);
    const receipt={ok:true,revision:this.revision,
      simulated:true,nodeRedRuntimeStarted:false,productionDeployment:false,
      result:copy(result)};
    this.events.push({kind:"sandbox.deploy",revision:this.revision});
    this.#remember("deploy",idempotency_key,payload,receipt);
    return copy(receipt);
  }
  bootstrap({text,base_revision,idempotency_key}) {
    const payload={text,base_revision};
    const cached=this.#memo("bootstrap",idempotency_key,payload);
    if(cached)return cached;
    check(base_revision===this.revision,"revision_conflict");
    const candidate=synthesize(text,this.revision+1);
    const checked=this.validate(candidate);
    const test=this.test(candidate);
    check(test.passed,"bootstrap_test_failed");
    const exported=compileNodeRed(candidate);
    const patch=this.patch({graph:candidate,base_revision,
      idempotency_key:"bootstrap.patch:"+idempotency_key});
    const receipt={ok:true,patch,validation:checked,test,
      nodeRedPreview:exported,editorImportRequired:true,
      productionDeployment:false};
    this.#remember("bootstrap",idempotency_key,payload,receipt);
    return copy(receipt);
  }
  invoke(op,args={}) {
    const method={
      "graph.inspect":()=>this.inspect(),
      "graph.validate":()=>this.validate(args.graph??this.graph),
      "graph.test":()=>this.test(args.graph??this.graph),
      "graph.explain":()=>this.explain(args.graph??this.graph),
      "graph.patch":()=>this.patch(args),
      "graph.deploy":()=>this.deploy(args),
      "graph.rollback":()=>this.rollback(args),
      "graph.bootstrap":()=>this.bootstrap(args)
    }[op];
    check(typeof method==="function","unknown_operation");
    return method();
  }
}
