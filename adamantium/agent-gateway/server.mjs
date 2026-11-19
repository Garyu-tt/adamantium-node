import {createServer} from 'node:http';
import {timingSafeEqual} from 'node:crypto';
import {AgentGraphService} from './service.mjs';
import {createNodeRedInspector} from '../node-red-adapter/inspect.mjs';

function authorized(given,expected){
  if(typeof given!=='string' || !given.startsWith('Bearer '))return false;
  const a=Buffer.from(given.slice(7)),b=Buffer.from(expected);
  return a.length===b.length && timingSafeEqual(a,b);
}
function json(res,code,data){
  const result=JSON.stringify(data);
  res.writeHead(code,{'Content-Type':'application/json; charset=utf-8',
    'Cache-Control':'no-store','X-Content-Type-Options':'nosniff'});
  res.end(result);
}
async function payload(req){
  const size=Number(req.headers['content-length']||0);
  if(size>16384)throw Object.assign(Error('request_too_large'),{status:413});
  let count=0;const pieces=[];
  for await(const chunk of req){
    count+=chunk.length;
    if(count>16384)throw Object.assign(Error('request_too_large'),{status:413});
    pieces.push(chunk);
  }
  try{return JSON.parse(Buffer.concat(pieces).toString('utf8'));}
  catch{throw Object.assign(Error('invalid_json'),{status:400});}
}
export function createAgentGateway({token,service=new AgentGraphService(),inspector}){
  if(typeof token!=='string' || token.length<32 || token.length>1024)
    throw Error('secure_agent_token_required');
  return createServer(async(req,res)=>{
    if(!authorized(req.headers.authorization,token)){
      json(res,401,{ok:false,error:'authentication_required'});return;
    }
    try{
      if(req.method==='GET' && req.url==='/health'){
        json(res,200,{ok:true,component:'adamantium-agent-graph-r01',
          mode:'isolated_draft_only'});return;
      }
      if(req.method==='GET' && req.url==='/upstream/inspect'){
        if(!inspector)throw Object.assign(Error('upstream_not_configured'),{status:404});
        json(res,200,{ok:true,result:await inspector.inspect()});return;
      }
      if(req.method!=='POST'||req.url!=='/agent/graph')
        throw Object.assign(Error('unknown_endpoint'),{status:404});
      const command=await payload(req);
      const result=service.dispatch(command);
      json(res,200,{ok:true,result});
    }catch(e){
      const status=Number.isInteger(e.status)&&e.status>=400&&e.status<600?
        e.status:400;
      json(res,status,{ok:false,error: e.code||(
        /^[a-z_]+$/.test(e.message||'')?e.message:'request_rejected')});
    }
  });
}
export async function startFromEnvironment(){
  const token=process.env.ADAMANTIUM_AGENT_TOKEN;
  let inspector;
  if(process.env.ADAMANTIUM_NODE_RED_URL || process.env.ADAMANTIUM_NODE_RED_TOKEN){
    inspector=createNodeRedInspector({
      baseUrl:process.env.ADAMANTIUM_NODE_RED_URL,
      operatorToken:process.env.ADAMANTIUM_NODE_RED_TOKEN
    });
  }
  const port=Number(process.env.ADAMANTIUM_AGENT_PORT||0);
  if(!Number.isInteger(port)||port<0||port>65535)
    throw Error('invalid_loopback_port');
  const server=createAgentGateway({token,inspector});
  await new Promise((resolve,reject)=>{
    server.once('error',reject);
    server.listen(port,'127.0.0.1',resolve);
  });
  const {port:actualPort}=server.address();
  process.stdout.write('Adamantium Agent Graph R01 localhost:'+actualPort+
    ' (draft-only, no deploy)\n');
  return server;
}
if(process.argv[1] && new URL(import.meta.url).pathname.replaceAll('\\','/')===
  process.argv[1].replaceAll('\\','/')){
  startFromEnvironment().catch(err=>{
    process.stderr.write((err.code||err.message||'gateway_start_failed')+'\n');
    process.exitCode=2;
  });
}
