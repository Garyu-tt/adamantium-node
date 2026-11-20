import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {createHash,generateKeyPairSync} from "node:crypto";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {createCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {SignedGraphProposalBridge} from "../../adamantium/capsule-signed-proposal-bridge.mjs";
import {DurableCapsuleProposalInbox,INBOX_VERSION} from "../../adamantium/capsule-durable-inbox.mjs";

const NOW=1795180000000, POLICY="a".repeat(64), NODE="core_primary";
const p=(tag,direction)=>({tag,direction,dataType:"core.json@1",semantics:"data"});
function prepare(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Main");
  const def=studio.createDefinition({
    name:"Transform",language:"rust",source:"let SECRET_NOT_FOR_IR = 123;",
    ports:[p("input","input"),p("output","output")]
  });
  const a=studio.place(root,def.id),b=studio.place(root,def.id);
  studio.connect(root,{fromId:a,fromTag:"output",toId:b,toTag:"input"});
  return {root,baseline:createCapsuleIRProposal(studio,{revision:1}),
    candidate:createCapsuleIRProposal(studio,{revision:2})};
}
async function harness({primary=true,allowed=true,authenticated=true,validatorAccept=true}={}){
  const {root,baseline,candidate}=prepare();
  const dir=await fs.mkdtemp(path.join(os.tmpdir(),"capsules-r05-"));
  const pair=generateKeyPairSync("ed25519");
  const privateKeyPem=pair.privateKey.export({type:"pkcs8",format:"pem"}).toString();
  const pinnedPublicKeyPem=pair.publicKey.export({type:"spki",format:"pem"}).toString();
  const pinnedFingerprint=createHash("sha256").update(
    pair.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const checks={auth:0,authorize:0,native:0,primary:0};
  const settings={
    directory:dir,baseline,privateKeyPem,nodeId:NODE,policySha256:POLICY,
    authenticate:async()=>{checks.auth++;return authenticated?{verified:true,principalId:"user_editor"}:null;},
    authorize:async()=>{checks.authorize++;return allowed;},
    nativeValidate:async({proposal})=>{
      checks.native++;
      return {accepted:validatorAccept,
        graphsSha256:createHash("sha256").update(JSON.stringify(proposal.graphs)).digest("hex")};
    },
    isPrimary:async()=>{checks.primary++;return primary;},
    now:()=>NOW
  };
  const inbox=await DurableCapsuleProposalInbox.open(settings);
  const transport={
    preflight:(query)=>inbox.preflight(query,{}),
    invoke:(query)=>inbox.invoke(query,{})
  };
  const bridge=new SignedGraphProposalBridge({transport,nodeId:NODE,graphId:root,
    policySha256:POLICY,pinnedPublicKeyPem,pinnedFingerprint,now:()=>NOW});
  return {inbox,bridge,transport,settings,dir,checks,root,baseline,candidate,
    async teardown(){await inbox.close().catch(()=>{});await fs.rm(dir,{recursive:true,force:true});}};
}
test("R05 real signed Core inbox persists an accepted proposal; does not advance live head",async()=>{
  const h=await harness();
  try {
    const before=h.inbox.summary();
    assert.equal(before.format,INBOX_VERSION);
    const signed=await h.bridge.submit({requestId:"review_1",proposal:h.candidate});
    assert.equal(signed.status,"accepted-for-review");
    assert.equal(signed.receiptVerified,true);
    assert.equal(signed.graphApproved,false);
    assert.equal(signed.runtimeActivated,false);
    const after=h.inbox.summary();
    assert.equal(after.revision,1,"review acceptance is not Graph Manager promotion");
    assert.equal(after.headSha256,before.headSha256);
    assert.equal(after.reviewQueue,1);
    assert.equal(after.auditEntries,2);
    assert.equal(h.checks.native,1);
    const stored=await fs.readFile(path.join(h.dir,"inbox.json"),"utf8");
    assert.ok(!stored.includes("SECRET_NOT_FOR_IR"));
    await h.inbox.close();
    const reopened=await DurableCapsuleProposalInbox.open(h.settings);
    try {
      assert.equal(reopened.summary().reviewQueue,1);
      assert.equal(reopened.summary().auditEntries,2);
      assert.equal(reopened.summary().headSha256,before.headSha256);
    } finally {
      await reopened.close();
    }
  } finally {await h.teardown();}
});
test("duplicate transport deliveries return bit-for-bit same signed receipt and do not repeat native validation",async()=>{
  const h=await harness();
  try{
    const preflight=await h.transport.preflight({nodeId:NODE,graphId:h.root,contract:"mechanicus.graph.propose/1"});
    assert.equal(preflight.mode,"primary");
    const offer=preflight.signedOffer.payload;
    const candidate=h.candidate;
    const request={nodeId:NODE,actionId:offer.actionId,payload:{
      format:"adamantium.core-graph-proposal-request/1",requestId:"repeat_1",
      nodeId:NODE,graphId:h.root,policySha256:POLICY,offerId:offer.offerId,
      expectedRevision:offer.revision,expectedHeadSha256:offer.headSha256,
      proposedRevision:2,
      proposalSha256:createHash("sha256").update(JSON.stringify(candidate)).digest("hex"),
      proposal:candidate
    }};
    const first=await h.transport.invoke(request);
    const replay=await h.transport.invoke(structuredClone(request));
    assert.deepEqual(first,replay);
    assert.equal(h.checks.native,1);
    assert.equal(h.inbox.summary().reviewQueue,1);
    await assert.rejects(h.transport.invoke({...request,payload:{...request.payload,requestId:"new_2"}}),
      /expired\/used offer/);
    await assert.rejects(h.transport.invoke({...request,payload:{...request.payload,expectedRevision:3}}),
      /idempotency key reused/);
    assert.equal(h.checks.native,1);
  }finally{await h.teardown();}
});
test("missing authentication, policy approval or primary role rejects before issuing a signed offer",async()=>{
  for(const flags of [{authenticated:false},{allowed:false},{primary:false}]){
    const h=await harness(flags);
    try {
      await assert.rejects(h.bridge.submit({requestId:"blocked_1",proposal:h.candidate}),
        /authentication failed|authorization denied|not verified primary/);
      assert.equal(h.inbox.summary().auditEntries,0);
      assert.equal(h.inbox.summary().reviewQueue,0);
      assert.equal(h.checks.native,0);
    } finally {await h.teardown();}
  }
});
test("native validation rejection yields a signed rejected receipt and no review queue",async()=>{
  const h=await harness({validatorAccept:false});
  try {
    const response=await h.bridge.submit({requestId:"no_1",proposal:h.candidate});
    assert.equal(response.status,"rejected");
    assert.equal(response.graphApproved,false);
    assert.equal(h.inbox.summary().reviewQueue,0);
    assert.equal(h.inbox.summary().auditEntries,2);
    assert.equal(h.checks.native,1);
  }finally{await h.teardown();}
});
test("single writer lock refuses a second opener and leaves no silent lock takeover",async()=>{
  const h=await harness();
  try{
    await assert.rejects(DurableCapsuleProposalInbox.open(h.settings),/EEXIST/);
    assert.equal(h.inbox.summary().reviewQueue,0);
  }finally{await h.teardown();}
});
test("persisted audit tampering is detected before operating and doesn't overwrite corrupt store",async()=>{
  const h=await harness();
  try {
    await h.transport.preflight({nodeId:NODE,graphId:h.root,contract:"mechanicus.graph.propose/1"});
    await h.inbox.close();
    const file=path.join(h.dir,"inbox.json");
    const saved=JSON.parse(await fs.readFile(file,"utf8"));
    saved.state.audit[0].kind="not_the_original";
    await fs.writeFile(file,JSON.stringify(saved));
    await assert.rejects(DurableCapsuleProposalInbox.open(h.settings),/invalid snapshot signature/);
    assert.equal(JSON.parse(await fs.readFile(file,"utf8")).state.audit[0].kind,"not_the_original");
  } finally {await h.teardown();}
});
test("inbox refuses to initialize with no explicit baseline or with bad signing key",async()=>{
  const h=await harness();
  const extra=await fs.mkdtemp(path.join(os.tmpdir(),"capsules-r05-empty-"));
  try{
    await assert.rejects(DurableCapsuleProposalInbox.open({...h.settings,directory:extra,baseline:null}),
      /explicit verified baseline/);
    await assert.rejects(DurableCapsuleProposalInbox.open({
      ...h.settings,directory:extra,privateKeyPem:"not a valid key"
    }));
  }finally{await h.teardown();await fs.rm(extra,{recursive:true,force:true});}
});

test("signed snapshot rejects editing the Graph IR without access to the private signer",async()=>{
 const h=await harness();
 try{
   await h.inbox.close();
   const file=path.join(h.dir,"inbox.json");
   const snapshot=JSON.parse(await fs.readFile(file,"utf8"));
   snapshot.state.current.graphs[0].domain="interface";
   await fs.writeFile(file,JSON.stringify(snapshot));
   await assert.rejects(DurableCapsuleProposalInbox.open(h.settings),/invalid snapshot signature/);
 }finally{await h.teardown();}
});
test("two concurrent submissions on one signed offer serialize and cannot double-spend it",async()=>{
 const h=await harness();
 try{
   const offer=(await h.transport.preflight({
     nodeId:NODE,graphId:h.root,contract:"mechanicus.graph.propose/1"
   })).signedOffer.payload;
   const body=(requestId)=>({nodeId:NODE,actionId:offer.actionId,payload:{
     format:"adamantium.core-graph-proposal-request/1",requestId,
     nodeId:NODE,graphId:h.root,policySha256:POLICY,offerId:offer.offerId,
     expectedRevision:1,expectedHeadSha256:offer.headSha256,proposedRevision:2,
     proposalSha256:createHash("sha256").update(JSON.stringify(h.candidate)).digest("hex"),
     proposal:h.candidate
   }});
   const results=await Promise.allSettled([
     h.transport.invoke(body("different_1")),h.transport.invoke(body("different_2"))
   ]);
   assert.equal(results.filter(x=>x.status==="fulfilled").length,1);
   assert.equal(results.filter(x=>x.status==="rejected").length,1);
   assert.equal(h.inbox.summary().reviewQueue,1);
   assert.equal(h.checks.native,1);
 }finally{await h.teardown();}
});

test("a closed inbox cannot mutate state after releasing its single-writer lock",async()=>{
 const h=await harness();
 try{
   await h.inbox.close();
   await assert.rejects(h.inbox.preflight({
     nodeId:NODE,graphId:h.root,contract:"mechanicus.graph.propose/1"
   },{}),/closed/);
   assert.equal(h.inbox.summary().reviewQueue,0);
 }finally{await h.teardown();}
});
