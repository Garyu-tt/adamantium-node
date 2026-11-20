import test from "node:test";
import assert from "node:assert/strict";
import {generateKeyPairSync,createHash,sign} from "node:crypto";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {createCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {
  SignedGraphProposalBridge, signedPayloadBytes,
  OFFER_VERSION,RECEIPT_VERSION,REQUEST_VERSION
} from "../../adamantium/capsule-signed-proposal-bridge.mjs";

const POLICY="a".repeat(64);
const HEAD="b".repeat(64);
const NOW=1837177200000;
const NODE="core_primary";
const ACTION="graph_propose_42";
const port=(tag,direction)=>({tag,direction,dataType:"core.json@1",semantics:"data"});
function scenario(){
  const studio=new CapsuleStudio(),root=studio.createGraph("Root");
  const def=studio.createDefinition({name:"Python",language:"python",
    source:"def run(data): return data # SECRET_NOT_TRANSPORTED",
    ports:[port("data","input"),port("result","output")]});
  studio.place(root,def.id);
  return {proposal:createCapsuleIRProposal(studio,{revision:2}),root};
}
function keypair(){
  const kp=generateKeyPairSync("ed25519");
  const pem=kp.publicKey.export({format:"pem",type:"spki"}).toString();
  const fingerprint=createHash("sha256")
    .update(kp.publicKey.export({format:"der",type:"spki"})).digest("hex");
  return {privateKey:kp.privateKey,pem,fingerprint};
}
function signing(kp,payload){
  return {payload,signature:sign(null,signedPayloadBytes(payload),kp.privateKey).toString("base64")};
}
function fixtures(overrides={}){
  const {proposal,root}=scenario(),kp=keypair();
  const offer={
    format:OFFER_VERSION,nodeId:NODE,graphId:root,policySha256:POLICY,
    issuedAt:NOW-1000,expiresAt:NOW+60000,offerId:"offer_1",
    revision:1,headSha256:HEAD,actionContract:"mechanicus.graph.propose/1",
    actionId:ACTION
  };
  let invokes=0,preflights=0,seenRequest=null;
  const transport={
    async preflight(args){
      preflights++;
      assert.deepEqual(args,{nodeId:NODE,graphId:root,contract:"mechanicus.graph.propose/1"});
      return {status:"reachable",mode:"primary",canInvoke:true,nodeId:NODE,
        signedOffer:signing(kp,{...offer,...overrides.offer}) ,...overrides.preflight};
    },
    async invoke(args){
      invokes++;
      seenRequest=args;
      if(overrides.invokeError)throw overrides.invokeError;
      const request=args.payload;
      const receipt={
        format:RECEIPT_VERSION,nodeId:NODE,graphId:root,policySha256:POLICY,
        issuedAt:NOW,expiresAt:NOW+60000,
        offerId:request.offerId,requestId:request.requestId,
        proposalSha256:request.proposalSha256,expectedRevision:1,
        expectedHeadSha256:HEAD,status:"accepted-for-review",receiptId:"receipt_1",
        ...overrides.receipt
      };
      return signing(kp,receipt);
    }
  };
  const bridge=new SignedGraphProposalBridge({
    transport,nodeId:NODE,graphId:root,
    policySha256:POLICY,pinnedPublicKeyPem:kp.pem,pinnedFingerprint:kp.fingerprint,
    now:()=>NOW
  });
  return {bridge,transport,kp,offer,root,proposal,
    getStats:()=>({invokes,preflights,seenRequest})};
}
test("fresh signed offer routes to its exact action and verifies a pinned receipt",async()=>{
  const {bridge,proposal,root,getStats}=fixtures();
  const result=await bridge.submit({requestId:"request_1",proposal});
  assert.equal(result.status,"accepted-for-review");
  assert.equal(result.receiptVerified,true);
  assert.equal(result.graphApproved,false);
  assert.equal(result.runtimeActivated,false);
  assert.equal(result.source,"pinned-node-identity-only");
  const {preflights,invokes,seenRequest}=getStats();
  assert.equal(preflights,1);
  assert.equal(invokes,1);
  assert.deepEqual({nodeId:seenRequest.nodeId,actionId:seenRequest.actionId},
    {nodeId:NODE,actionId:ACTION});
  const sent=seenRequest.payload;
  assert.equal(sent.format,REQUEST_VERSION);
  assert.equal(sent.requestId,"request_1");
  assert.equal(sent.graphId,root);
  assert.equal(sent.expectedHeadSha256,HEAD);
  assert.equal(sent.expectedRevision,1);
  assert.equal(sent.proposedRevision,2);
  assert.equal(sent.policySha256,POLICY);
  assert.equal(sent.proposalSha256,
    createHash("sha256").update(JSON.stringify(proposal)).digest("hex"));
  assert.ok(!JSON.stringify(sent).includes("SECRET_NOT_TRANSPORTED"));
  assert.equal(sent.proposal.executable,false);
});
test("read-only standby and unavailable capability refuse write without invoking",async()=>{
  for(const preflight of [
    {mode:"read_only_standby"},{canInvoke:false},{status:"offline"},{nodeId:"foreign_node"}
  ]){
    const {bridge,proposal,getStats}=fixtures({preflight});
    await assert.rejects(bridge.submit({requestId:"q_1",proposal}),/capability unavailable/);
    assert.equal(getStats().invokes,0);
  }
});
test("tampered offer, incorrect policy and expired offer fail closed",async()=>{
  for(const offer of [
    {policySha256:"b".repeat(64)},{graphId:"unrelated_graph"},
    {nodeId:"rogue_node"},{expiresAt:NOW-1},{issuedAt:NOW+10000},
    {actionContract:"mechanicus.graph.execute/1"},{headSha256:"0"},
    {revision:2}
  ]){
    const {bridge,proposal,getStats}=fixtures({offer});
    await assert.rejects(bridge.submit({requestId:"r_1",proposal}));
    assert.equal(getStats().invokes,0);
  }
});
test("bad pinned Ed25519 fingerprint blocks construction",()=>{
  const {kp,root}=fixtures();
  assert.throws(()=>new SignedGraphProposalBridge({
    transport:{preflight:async()=>{},invoke:async()=>{}},
    nodeId:NODE,graphId:root,policySha256:POLICY,
    pinnedPublicKeyPem:kp.pem,pinnedFingerprint:"0".repeat(64)
  }),/fingerprint mismatch/);
});
test("forged or altered signed receipt is not accepted as approval",async()=>{
  for(const receipt of [
    {proposalSha256:"a".repeat(64)},
    {requestId:"unrelated_request"},
    {expectedRevision:8},
    {offerId:"stolen_offer"},
    {status:"activated"},
    {policySha256:"e".repeat(64)},
    {graphId:"unrelated_graph"}
  ]){
    const {bridge,proposal,getStats}=fixtures({receipt});
    await assert.rejects(bridge.submit({requestId:"r_1",proposal}));
    assert.equal(getStats().invokes,1);
  }
});
test("no automatic retry after ambiguous remote failure; repeated offer cannot be reused",async()=>{
  const failed=fixtures({invokeError:new Error("uncertain remote outcome")});
  await assert.rejects(failed.bridge.submit({requestId:"uncertain_1",proposal:failed.proposal}),
    /uncertain remote outcome/);
  assert.equal(failed.getStats().invokes,1);
  await assert.rejects(failed.bridge.submit({requestId:"uncertain_1",proposal:failed.proposal}),
    /replayed signed offer/);
  assert.equal(failed.getStats().invokes,1);
});
test("invalid typed proposal cannot trigger even preflight",async()=>{
  const {bridge,proposal,getStats}=fixtures();
  const invalid=structuredClone(proposal);
  invalid.graphs[0].nodes[0].ports[0].dataType="untyped";
  await assert.rejects(bridge.submit({requestId:"r_1",proposal:invalid}));
  assert.equal(getStats().preflights,0);
  assert.equal(getStats().invokes,0);
});
test("signed rejected proposal receipt remains rejected and never becomes a runtime activation",async()=>{
  const {bridge,proposal}=fixtures({receipt:{status:"rejected"}});
  const result=await bridge.submit({requestId:"reject_1",proposal});
  assert.equal(result.status,"rejected");
  assert.equal(result.graphApproved,false);
  assert.equal(result.runtimeActivated,false);
});
