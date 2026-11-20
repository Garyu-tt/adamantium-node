import test from "node:test";
import assert from "node:assert/strict";
import {createHash} from "node:crypto";
import {readFile} from "node:fs/promises";
import {spawnSync} from "node:child_process";
import path from "node:path";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {createCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {createPinnedNativeG0Validator,encodeNativeG0Wire} from "../../adamantium/capsule-native-g0.mjs";
import {DurableCapsuleProposalInbox} from "../../adamantium/capsule-durable-inbox.mjs";
import {SignedGraphProposalBridge} from "../../adamantium/capsule-signed-proposal-bridge.mjs";
import {generateKeyPairSync} from "node:crypto";
import os from "node:os";
import fs from "node:fs/promises";

const BIN=process.env.ADAMANTIUM_G0_VALIDATOR_BIN;
const REQ=process.env.ADAMANTIUM_G0_REQUIRED==="true";
const NEED_NATIVE=!!BIN;
const PORT=(tag,direction)=>({tag,direction,semantics:"data",dataType:"core.json@1"});
function sample() {
 const studio=new CapsuleStudio(),root=studio.createGraph("Root");
 const definition=studio.createDefinition({
  name:"Rust Parser",language:"rust",source:"SECRET_CODE_DO_NOT_SERIALIZE",
  ports:[PORT("in","input"),PORT("out","output")]
 });
 const a=studio.place(root,definition.id),b=studio.place(root,definition.id);
 studio.connect(root,{fromId:a,fromTag:"out",toId:b,toTag:"in"});
 const nested=studio.createCapsule(root,"Child");
 const worker=studio.place(nested.graphId,definition.id);
 studio.expose(nested.graphId,{side:"north",instanceId:worker,tag:"in",externalTag:"input"});
 studio.expose(nested.graphId,{side:"south",instanceId:worker,tag:"out",externalTag:"output"});
 return {studio,root};
}
async function gate(){
 const data=await readFile(BIN);
 const binarySha256=createHash("sha256").update(data).digest("hex");
 return createPinnedNativeG0Validator({binaryPath:path.resolve(BIN),binarySha256,timeoutMs:3000});
}
test("R06 typed native wire export is source-free and never serializes permission grants",()=>{
 const {studio}=sample();
 const p=createCapsuleIRProposal(studio,{revision:2});
 const wire=encodeNativeG0Wire(p);
 assert.match(wire,/^UGIR1\nROOT graph_/);
 assert.match(wire,/NODE capsule_/);
 assert.match(wire,/ENDGRAPH\n/);
 assert.ok(!wire.includes("SECRET_CODE_DO_NOT_SERIALIZE"));
 assert.ok(!wire.includes("permission"));
 assert.throws(()=>createPinnedNativeG0Validator({
  binaryPath:"./relative-program",binarySha256:"f".repeat(64)
 }),/absolute/);
});
test("R06 native tests require explicit prebuilt binary in CI",()=>{
 if(REQ)assert.ok(NEED_NATIVE,"CI must provide ADAMANTIUM_G0_VALIDATOR_BIN");
});
test("native G0 C++17 accepts nested typed Capsule graph with exact count match",
 {skip:!NEED_NATIVE},async()=>{
  const {studio,root}=sample(),validate=await gate();
  const p=createCapsuleIRProposal(studio,{revision:2});
  const result=await validate({graphId:root,proposal:p,expectedRevision:1,principalId:"operator_1"});
  assert.equal(result.accepted,true);
  assert.equal(result.graphsSha256,
   createHash("sha256").update(JSON.stringify(p.graphs)).digest("hex"));
});
test("native G0 C++17 independently refuses over-deep composite nesting",
 {skip:!NEED_NATIVE},async()=>{
  const studio=new CapsuleStudio(),root=studio.createGraph("Root");
  let graph=root;
  for(let i=0;i<17;i++){
    const child=studio.createCapsule(graph,"Depth"+i);
    graph=child.graphId;
  }
  const p=createCapsuleIRProposal(studio,{revision:2});
  const validate=await gate();
  const result=await validate({graphId:root,proposal:p,expectedRevision:1,principalId:"operator_1"});
  assert.equal(result.accepted,false,"native C++ compiler enforces max_depth=16 independently");
});
test("native G0 rejects malformed wire text directly",
 {skip:!NEED_NATIVE},()=>{
  for(const input of ["UGIR1\nROOT root\n1\nGRAPH root 1 program 1 0 1 0\n",
   "UGIR1\nROOT root\n99999999\n",
   "UGIR1\nROOT root\n1\nGRAPH root 1 program 4294967297 0 0 0\nENDGRAPH\nEND\n",
   "UGIR1\nROOT root\n1\nGRAPH root 1 program 1 0 0 0\nENDGRAPH\nEND\nFORGED\n"]) {
    const r=spawnSync(BIN,{input,encoding:"utf8",timeout:3000});
    assert.notEqual(r.status,0);
    assert.match(r.stdout,/INVALID_INPUT|REJECT/);
  }
});
test("wrong pinned executable digest and stale scope fail closed before native invocation",
 {skip:!NEED_NATIVE},async()=>{
  const {studio,root}=sample();
  const p=createCapsuleIRProposal(studio,{revision:2});
  const wrong=createPinnedNativeG0Validator({
    binaryPath:path.resolve(BIN),binarySha256:"0".repeat(64)
  });
  await assert.rejects(wrong({graphId:root,proposal:p,expectedRevision:1,principalId:"operator_1"}),/fingerprint/);
  const correct=await gate();
  await assert.rejects(correct({graphId:"different",proposal:p,expectedRevision:1,principalId:"operator_1"}),/scope/);
  await assert.rejects(correct({graphId:root,proposal:p,expectedRevision:2,principalId:"operator_1"}),/CAS revision/);
});
test("real R05 durable signed inbox calls compiled native C++ gate, accepts review ONLY",
 {skip:!NEED_NATIVE},async()=>{
  const {studio,root}=sample();
  const baseline=createCapsuleIRProposal(studio,{revision:1});
  const candidate=createCapsuleIRProposal(studio,{revision:2});
  const kp=generateKeyPairSync("ed25519");
  const privateKeyPem=kp.privateKey.export({type:"pkcs8",format:"pem"}).toString();
  const publicKeyPem=kp.publicKey.export({type:"spki",format:"pem"}).toString();
  const fingerprint=createHash("sha256").update(
    kp.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const directory=await fs.mkdtemp(path.join(os.tmpdir(),"capsule-native-r06-"));
  const policy="a".repeat(64),node="core_test",now=Date.now();
  let calls=0;
  const nativeGate=await gate();
  const inbox=await DurableCapsuleProposalInbox.open({
   directory,baseline,privateKeyPem,nodeId:node,policySha256:policy,
   now:()=>now,authenticate:async()=>({verified:true,principalId:"operator_1"}),
   authorize:async()=>true,isPrimary:async()=>true,
   nativeValidate:async args=>{calls++;return nativeGate(args);}
  });
  try {
   const bridge=new SignedGraphProposalBridge({
    transport:{
     preflight:payload=>inbox.preflight(payload,{}),
     invoke:payload=>inbox.invoke(payload,{})
    },
    nodeId:node,graphId:root,policySha256:policy,
    pinnedPublicKeyPem:publicKeyPem,pinnedFingerprint:fingerprint,now:()=>now
   });
   const receipt=await bridge.submit({requestId:"native_inbox_1",proposal:candidate});
   assert.equal(receipt.status,"accepted-for-review");
   assert.equal(receipt.graphApproved,false);
   assert.equal(receipt.runtimeActivated,false);
   assert.equal(inbox.summary().revision,1);
   assert.equal(inbox.summary().reviewQueue,1);
   assert.equal(calls,1);
  }finally{
   await inbox.close();
   await fs.rm(directory,{recursive:true,force:true});
  }
});
