// SPDX-License-Identifier: Apache-2.0
// Loopback-only, token-protected agent interface. No Node-RED runtime writes.
import http from "node:http";
import {AgentGraphService} from "./service.mjs";
import {AgentFactoryService} from "./factory-service.mjs";
import {compileNodeRed} from "../node-red-adapter/compile.mjs";

const LIMIT=128*1024;
const mapError=e=>e.code==="revision_conflict"||e.code==="idempotency_payload_conflict"?
  409:e.code==="deployment_not_authorized"?403:
  e.code==="graph_not_found"||e.code==="proposal_not_found"?404:
  e.code==="factory_worker_busy"?409:e.code==="factory_verification_quota"?429:422;
function respond(res,status,body){
  res.writeHead(status,{"Content-Type":"application/json; charset=utf-8",
    "Cache-Control":"no-store","X-Content-Type-Options":"nosniff"});
  res.end(JSON.stringify(body));
}
async function readJSON(req){
  if(req.headers["content-type"]?.split(";")[0]!=="application/json")
    throw Object.assign(new Error("json_content_type_required"),{status:415});
  let text="",size=0;
  for await(const chunk of req){
    size+=chunk.length;
    if(size>LIMIT)throw Object.assign(new Error("body_budget_exceeded"),{status:413});
    text+=chunk.toString("utf8");
  }
  try{return JSON.parse(text);}catch{
    throw Object.assign(new Error("invalid_json"),{status:400});
  }
}
/** Sandbox is a simulated state only. It never issues real Node-RED deploys. */
export function createGateway({token,sandbox=false,factoryVerify=false,factoryRunner}={}){
  if(typeof token!=="string"||token.length<24||token.length>256)
    throw new TypeError("explicit_server_token_required");
  const service=new AgentGraphService({sandbox});
  const factory=new AgentFactoryService({verifyEnabled:factoryVerify,runner:factoryRunner});
  const server=http.createServer(async(req,res)=>{
    try{
      if(req.url==="/health"&&req.method==="GET")
        return respond(res,200,{status:"ready",mode:"isolated-agent-bootstrap",
          nodeRedConnected:false,productionDeployment:false});
      const authority=req.headers.authorization;
      if(authority!==("Bearer "+token))
        return respond(res,401,{error:"unauthorized"});
      // Block browser-initiated cross-origin mutation without CORS exemption.
      if(req.headers.origin){
        const localOrigin="http://"+req.headers.host;
        if(req.headers.origin!==localOrigin)
          return respond(res,403,{error:"cross_origin_request_forbidden"});
      }
      if(req.method==="GET"&&req.url==="/v1/factory")
        return respond(res,200,factory.inspect());
      if(req.method==="GET"&&req.url==="/v1/graph")
        return respond(res,200,service.inspect());
      if(req.method==="GET"&&req.url==="/v1/node-red/import"){
        const graph=service.inspect().graph;
        return graph?respond(res,200,compileNodeRed(graph)):
          respond(res,404,{error:"graph_not_found"});
      }
      if(req.method!=="POST"||req.url!=="/v1/agent")
        return respond(res,404,{error:"unknown_route"});
      const payload=await readJSON(req);
      if(!payload||typeof payload!=="object"||Array.isArray(payload)||
        !Object.hasOwn(payload,"operation")||
        typeof payload.operation!=="string"||
        !Object.hasOwn(payload,"arguments")||
        typeof payload.arguments!=="object"||payload.arguments===null||
        Array.isArray(payload.arguments))
        return respond(res,400,{error:"invalid_agent_request"});
      const response=payload.operation.startsWith("factory.")?
        await factory.invoke(payload.operation,payload.arguments):
        service.invoke(payload.operation,payload.arguments);
      respond(res,200,{ok:true,response});
    }catch(e){
      respond(res,e.status||mapError(e),{ok:false,error:e.code||e.message||"invalid_request"});
    }
  });
  return {server,service,factory};
}
export async function startGateway({token,sandbox=false,port=8769,
 factoryVerify=false,factoryRunner}={}){
  if(!Number.isInteger(port)||port<0||port>65535)
    throw new RangeError("invalid_port");
  const {server,service,factory}=createGateway({token,sandbox,factoryVerify,factoryRunner});
  await new Promise((resolve,reject)=>{
    server.once("error",reject);
    server.listen(port,"127.0.0.1",resolve);
  });
  return {server,service,factory,url:"http://127.0.0.1:"+server.address().port};
}
