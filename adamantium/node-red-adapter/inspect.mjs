// An opt-in read-only Node-RED v2 REST client. No deployment capability.
function reject(code,status=400) {
  throw Object.assign(new Error(code),{code,status});
}
export function createNodeRedInspector({baseUrl,operatorToken,fetchImpl=fetch}) {
  let base;
  try { base=new URL(baseUrl); } catch { reject('invalid_node_red_url'); }
  if(base.protocol!=='http:' ||
    !['127.0.0.1','[::1]'].includes(base.hostname) ||
    !base.port || base.pathname!=='/' || base.search || base.hash ||
    base.username || base.password)
    reject('node_red_must_be_explicit_loopback');
  if(typeof operatorToken!=='string' || operatorToken.length<24 ||
    operatorToken.length>1024 || /[\r\n]/.test(operatorToken))
    reject('node_red_token_required');

  return Object.freeze({
    async inspect() {
      let response;
      try {
        response=await fetchImpl(new URL('flows',base),{
          method:'GET',redirect:'error',
          headers:{Authorization:'Bearer '+operatorToken,
            'Node-RED-API-Version':'v2','Cache-Control':'no-store'},
          signal:AbortSignal.timeout(2000)
        });
      }catch {reject('node_red_unreachable',503);}
      if(!response.ok)reject('node_red_read_rejected',502);
      if(Number(response.headers.get('content-length')||0)>262144)
        reject('node_red_response_too_large',413);
      if(!response.body)reject('node_red_empty_response',502);
      const reader=response.body.getReader(),chunks=[];let total=0;
      try {
        while(true) {
          const {done,value}=await reader.read();
          if(done)break;
          total+=value.byteLength;
          if(total>262144)reject('node_red_response_too_large',413);
          chunks.push(value);
        }
      }finally{await reader.cancel().catch(()=>{});}
      let raw;
      try {
        raw=JSON.parse(new TextDecoder('utf-8',{fatal:true})
          .decode(Buffer.concat(chunks.map(x=>Buffer.from(x)),total)));
      }catch {reject('node_red_invalid_v2_response',502);}
      if(!raw || typeof raw.rev!=='string' ||
         raw.rev.length>128 || !Array.isArray(raw.flows) ||
         raw.flows.length>4096)reject('node_red_invalid_v2_response',502);
      // Never send arbitrary imported node configuration, credentials or
      // unknown plugin metadata to the agent by default.
      const types=new Map();
      for(const item of raw.flows){
        if(!item || typeof item.type!=='string' ||
           item.type.length>128)reject('node_red_invalid_node',502);
        types.set(item.type,(types.get(item.type)||0)+1);
      }
      return {upstream_revision:raw.rev,node_count:raw.flows.length,
        node_types:[...types].sort(([a],[b])=>a.localeCompare(b))
          .map(([type,count])=>({type,count})),
        authority:'read_only',credentials_exposed:false};
    }
  });
}
