/**
 * Optional localhost-only HTTP harness for R05 signed proposal review inbox.
 * The HTTP layer is NOT a MAS Core ingress or a bearer-token implementation:
 * authenticateHttp is mandatory and must be backed by Core transport identity.
 * Never bind a public interface or forward through a production reverse proxy.
 * SPDX-License-Identifier: Apache-2.0
 */
import {createServer} from "node:http";
import {DurableCapsuleProposalInbox} from "./capsule-durable-inbox.mjs";
const MAX_BODY=2_000_000;
function fail(status,message){
  const err=new Error(message);err.httpStatus=status;throw err;
}
async function readJSON(req){
  const contentType=req.headers["content-type"];
  if(typeof contentType!=="string"||!/^application\/json(?:\s*;\s*charset=utf-8)?$/i.test(contentType)){
    fail(415,"expected application/json");
  }
  let size=0;
  const chunks=[];
  for await(const chunk of req){
    size+=chunk.length;
    if(size>MAX_BODY)fail(413,"request body too large");
    chunks.push(chunk);
  }
  if(size===0)fail(400,"empty JSON request");
  try{return JSON.parse(Buffer.concat(chunks,size).toString("utf8"));}
  catch{fail(400,"invalid JSON");}
}
function send(res,status,body){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff",
    "Content-Security-Policy":"default-src 'none'","Connection":"close"});
  res.end(JSON.stringify(body));
}
export function createCapsuleInboxHttpHarness({inbox,authenticateHttp}){
  if(!(inbox instanceof DurableCapsuleProposalInbox))
    throw new TypeError("HTTP inbox requires durable reference instance");
  if(typeof authenticateHttp!=="function")
    throw new TypeError("HTTP inbox requires explicit transport authentication");
  const server=createServer(async(req,res)=>{
    try{
      if(req.url==="/healthz"&&req.method==="GET"){
        send(res,200,{service:"capsule-inbox-reference",live:true,
          authoritative:false,execution:false});return;
      }
      if(req.url!=="/api/proposals/preflight"&&req.url!=="/api/proposals/invoke"){
        send(res,404,{error:"not-found"});return;
      }
      if(req.method!=="POST"){
        send(res,405,{error:"method-not-allowed"});return;
      }
      // NO default identity. The implementation cannot infer or grant MAS
      // privileges from an HTTP header on its own.
      const context=await authenticateHttp(req);
      if(!context)fail(403,"transport authentication rejected");
      const body=await readJSON(req);
      const result=req.url.endsWith("preflight")
        ?await inbox.preflight(body,context)
        :await inbox.invoke(body,context);
      send(res,200,result);
    }catch(err){
      const status=[400,403,405,413,415].includes(err.httpStatus)?err.httpStatus:403;
      // Do not echo exception messages with graph/keys/policy details.
      send(res,status,{error:status===413?"too-large":"request-rejected"});
    }
  });
  server.requestTimeout=10_000;
  server.headersTimeout=5_000;
  server.keepAliveTimeout=1_000;
  return {
    async listen(port=0){
      if(!Number.isSafeInteger(port)||port<0||port>65535)throw new TypeError("invalid port");
      await new Promise((resolve,reject)=>{
        server.once("error",reject);
        server.listen(port,"127.0.0.1",()=>{
          server.off("error",reject);resolve();
        });
      });
      const address=server.address();
      if(!address||address.address!=="127.0.0.1"){
        server.close();throw new Error("refusing nonloopback listener");
      }
      return {url:"http://127.0.0.1:"+address.port,loopbackOnly:true,
        authorizedCore:false};
    },
    async close(){
      if(!server.listening)return;
      await new Promise((resolve,reject)=>server.close(e=>e?reject(e):resolve()));
    }
  };
}
