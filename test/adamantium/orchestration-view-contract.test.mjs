import assert from "node:assert/strict";
import test from "node:test";
import {ORCHESTRATION_VIEW_SCHEMA,validateOrchestrationView} from "../../adamantium/orchestration-view-contract.mjs";
import {projectOrchestrationMobileUI} from "../../adamantium/orchestration-mobile-projection.mjs";
import {validateMobileUI} from "../../adamantium/mobile-ui-contract.mjs";

const observed="2026-11-20T00:00:00Z";
const snapshot=()=>({
  schema:ORCHESTRATION_VIEW_SCHEMA,revision:17,observedAt:observed,
  authorityProviderId:"manager",
  providers:[
    {id:"manager",label:"Graph Manager",role:"graph-authority",connection:"unknown",observedAt:observed,capabilities:[]},
    {id:"agentforge",label:"AgentForge",role:"execution-provider",connection:"reachable",observedAt:observed,capabilities:["mechanicus.scoped_worker.r30"]},
    {id:"cezar",label:"Cezar",role:"development-team",connection:"unknown",observedAt:observed,capabilities:[]},
    {id:"forge",label:"Automation Forge",role:"scheduler",connection:"read-only",observedAt:observed,capabilities:[]}
  ],
  tasks:[
    {id:"task1",title:"Проверить репозиторий",status:"complete",ownerProviderId:"agentforge",dependsOn:[],blockers:[],evidenceRef:"proof1"},
    {id:"task2",title:"Разработать UI",status:"blocked",ownerProviderId:"cezar",dependsOn:["task1"],
      blockers:[{code:"missingcredential",reason:"Claude bridge authorization unverified",recoveryTaskId:"task3"}]},
    {id:"task3",title:"Проверить разрешённую авторизацию",status:"queued",ownerProviderId:null,dependsOn:["task1"],blockers:[]}
  ]
});
test("accepts evidence-based DAG and never grants backend execution",()=>{
 const v=validateOrchestrationView(snapshot());
 assert.equal(v.taskCounts.complete,1);
 assert.equal(v.taskCounts.blocked,1);
 assert.equal(v.providers[2].connection,"unknown");
 assert.equal(v.executionAuthorized,false);
 assert.equal(v.graphMutationAuthorized,false);
});
test("projects a typed, navigable mobile task UI without Android privileges",()=>{
 const p=projectOrchestrationMobileUI(snapshot());
 const result=validateMobileUI(p.document,{availableCapabilities:[]});
 assert.equal(result.screenCount,2);
 assert.equal(result.invocationAuthorized,false);
 assert.equal(p.backendMutationsAuthorized,false);
 assert.equal(p.data["orchestration.summary"].readOnly,true);
});
test("blocks raw URLs, secret fields, invoked capabilities and unexpected actions",()=>{
 for(const field of ["endpoint","authToken","canInvoke"]){
  const v=snapshot();v.providers[1][field]="untrusted";
  assert.throws(()=>validateOrchestrationView(v),/forbidden property/);
 }
 const v=snapshot();v.executeTask=true;
 assert.throws(()=>validateOrchestrationView(v),/forbidden property/);
});
test("exactly one graph authority and known executor owners",()=>{
 const a=snapshot();a.providers[2].role="graph-authority";
 assert.throws(()=>validateOrchestrationView(a),/exactly one/);
 const b=snapshot();b.tasks[1].ownerProviderId="other";
 assert.throws(()=>validateOrchestrationView(b),/invalid task owner/);
});
test("complete tasks require evidence and blockers require concrete diagnosis",()=>{
 const a=snapshot();delete a.tasks[0].evidenceRef;
 assert.throws(()=>validateOrchestrationView(a),/missing evidence/);
 const b=snapshot();b.tasks[1].blockers=[];
 assert.throws(()=>validateOrchestrationView(b),/diagnosis missing/);
});
test("cycles and missing blocker recovery branches fail closed",()=>{
 const a=snapshot();a.tasks[0].dependsOn=["task3"];
 assert.throws(()=>validateOrchestrationView(a),/cycle/);
 const b=snapshot();b.tasks[1].blockers[0].recoveryTaskId="unknown";
 assert.throws(()=>validateOrchestrationView(b),/missing recovery task/);
});
test("duplicate providers or capabilities cannot masquerade as distinct workers",()=>{
 const a=snapshot();a.providers.push({...a.providers[1]});
 assert.throws(()=>validateOrchestrationView(a),/duplicate provider/);
 const b=snapshot();b.providers[1].capabilities.push("mechanicus.scoped_worker.r30");
 assert.throws(()=>validateOrchestrationView(b),/duplicate identifier/);
});
test("does not trust status labels as authorization",()=>{
 const a=snapshot();
 a.providers[1].connection="reachable";
 a.providers[3].connection="read-only";
 const v=validateOrchestrationView(a);
 assert.equal(v.executionAuthorized,false);
 assert.equal(v.graphMutationAuthorized,false);
});
