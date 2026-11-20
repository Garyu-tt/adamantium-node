import test from "node:test";
import assert from "node:assert/strict";
import {createServer} from "node:http";
import {generateKeyPairSync,sign,createHash} from "node:crypto";
import {CapsuleStudio} from "../../adamantium/capsule-studio.mjs";
import {createCapsuleIRProposal} from "../../adamantium/capsule-ir-proposal.mjs";
import {
 SignedGraphProposalBridge,OFFER_VERSION,RECEIPT_VERSION,
 signedPayloadBytes
} from "../../adamantium/capsule-signed-proposal-bridge.mjs";

const NOW=1795176000000;
const HEAD="c".repeat(64),POLICY="d".repeat(64);
const NODE="mock_core",ACTION="capability_graph_propose";
const seal=(privateKey,payload)=>({
  payload,signature:sign(null,signedPayloadBytes(payload),privateKey).toString("base64")
});
const utf8=reply=>{
  const data=JSON.stringify(reply);
  return {data,headers:{"content-type":"application/json","cache-control":"no-store"}};
};
function fixture(){
  const s=new CapsuleStudio(),root=s.createGraph("Root");
  const def=s.createDefinition({name:"Rust",language:"rust",source:"fn run(x:i32)->i32{x*2}",ports:[]});
  s.place(root,def.id);
  return {root,proposal:createCapsuleIRProposal(s,{revision:2})};
}
async function startMockCore({failInvoke=false}={}){
  const {root,proposal}=fixture();
  const keypair=generateKeyPairSync("ed25519");
  const publicKeyPem=keypair.publicKey.export({type:"spki",format:"pem"}).toString();
  const pinnedFingerprint=createHash("sha256")
    .update(keypair.publicKey.export({type:"spki",format:"der"})).digest("hex");
  const calls=[];
  const offer={
    format:OFFER_VERSION,nodeId:NODE,graphId:root,policySha256:POLICY,
    issuedAt:NOW-1000,expiresAt:NOW+30_000,
    offerId:"offer_http",revision:1,headSha256:HEAD,
    actionContract:"mechanicus.graph.propose/1",actionId:ACTION
  };
  const server=createServer(async(req,res)=>{
    try {
      if(req.url==="/preflight"&&req.method==="GET"){
        calls.push("preflight");
        res.writeHead(200,utf8({}).headers);
        res.end(utf8({status:"reachable",mode:"primary",canInvoke:true,nodeId:NODE,
          signedOffer:seal(keypair.privateKey,offer)}).data);
        return;
      }
      if(req.url==="/invoke"&&req.method==="POST"){
        calls.push("invoke");
        if(failInvoke){res.writeHead(503);res.end("unknown result");return;}
        let text="";
        for await (const chunk of req) {
          text+=chunk.toString("utf8");
          if(text.length>2_000_000){res.writeHead(413);res.end();return;}
        }
        const json=JSON.parse(text);
        assert.equal(json.nodeId,NODE);
        assert.equal(json.actionId,ACTION);
        assert.equal(json.payload.format,"adamantium.core-graph-proposal-request/1");
        assert.equal(json.payload.graphId,root);
        assert.equal(json.payload.expectedRevision,1);
        assert.equal(json.payload.expectedHeadSha256,HEAD);
        assert.equal(json.payload.proposedRevision,2);
        assert.equal(json.payload.policySha256,POLICY);
        assert.equal(json.payload.proposalSha256,
          createHash("sha256").update(JSON.stringify(proposal)).digest("hex"));
        const receipt={
          format:RECEIPT_VERSION,nodeId:NODE,graphId:root,policySha256:POLICY,
          issuedAt:NOW,expiresAt:NOW+30_000,offerId:json.payload.offerId,
          requestId:json.payload.requestId,proposalSha256:json.payload.proposalSha256,
          expectedRevision:1,expectedHeadSha256:HEAD,
          receiptId:"receipt_http",status:"accepted-for-review"
        };
        const response=utf8(seal(keypair.privateKey,receipt));
        res.writeHead(200,response.headers);res.end(response.data);
        return;
      }
      res.writeHead(404);res.end();
    } catch(error) {
      res.writeHead(400);res.end("Invalid test request");
    }
  });
  await new Promise(resolve=>server.listen(0,"127.0.0.1",resolve));
  const address=server.address();
  assert.equal(address.address,"127.0.0.1");
  const base="http://127.0.0.1:"+address.port;
  const transport={
    async preflight(args){
      assert.equal(args.nodeId,NODE);
      assert.equal(args.graphId,root);
      const response=await fetch(base+"/preflight");
      if(!response.ok)throw new Error("Preflight HTTP "+response.status);
      return response.json();
    },
    async invoke(args) {
      const response=await fetch(base+"/invoke",{
        method:"POST",headers:{"content-type":"application/json"},
        body:JSON.stringify(args)
      });
      if(!response.ok)throw new Error("Ambiguous HTTP "+response.status);
      return response.json();
    }
  };
  const bridge=new SignedGraphProposalBridge({
    transport,nodeId:NODE,graphId:root,policySha256:POLICY,
    pinnedPublicKeyPem:publicKeyPem,pinnedFingerprint,now:()=>NOW
  });
  return {bridge,proposal,calls,server,base};
}
async function dispose(server){
 await new Promise((resolve,reject)=>server.close(err=>err?reject(err):resolve()));
}
test("real loopback HTTP mock: pinned, dynamically routed signed proposal gets receipt, not approval",async()=>{
  const {bridge,proposal,calls,server,base}=await startMockCore();
  try{
    const result=await bridge.submit({requestId:"http_1",proposal});
    assert.equal(result.status,"accepted-for-review");
    assert.equal(result.graphApproved,false);
    assert.equal(result.runtimeActivated,false);
    assert.deepEqual(calls,["preflight","invoke"]);
    assert.equal((await fetch(base+"/unknown")).status,404);
  }finally{await dispose(server);}
});
test("real loopback HTTP ambiguous 503 has no retry, and no runtime activation",async()=>{
  const {bridge,proposal,calls,server}=await startMockCore({failInvoke:true});
  try{
    await assert.rejects(bridge.submit({requestId:"uncertain_http",proposal}),/Ambiguous HTTP 503/);
    assert.deepEqual(calls,["preflight","invoke"]);
    await assert.rejects(bridge.submit({requestId:"uncertain_http",proposal}),/replayed signed offer/);
    assert.deepEqual(calls,["preflight","invoke","preflight"]);
  }finally{await dispose(server);}
});
