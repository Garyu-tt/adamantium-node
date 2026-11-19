#!/usr/bin/env node
// JSON-lines agent CLI: one input operation -> one bounded JSON result.
// No shell commands, plugin installation, outbound arbitrary URLs or GUI clicks.
import {createInterface} from 'node:readline';
import {NodeRedV2} from '../node-red-adapter/client.mjs';
import {AgentGraphGateway} from '../agent-gateway/gateway.mjs';

const MAX_LINE=16*1024;
let gateway;
try {
  const client=new NodeRedV2({
    baseURL:process.env.ADAMANTIUM_NODE_RED_URL,
    bearerToken:process.env.ADAMANTIUM_NODE_RED_TOKEN
  });
  // CLI is intentionally read/draft-only even when a caller passes
  // "allowDeploy" in JSON or an environment variable. GA3 must introduce
  // an authenticated supervisor-held write grant.
  gateway=new AgentGraphGateway({client,writesEnabled:false});
} catch (error) {
  process.stderr.write('bootstrap_configuration_denied\n');
  process.exit(2);
}
const lines=createInterface({input:process.stdin,crlfDelay:Infinity});
let seen=0;
for await (const line of lines) {
  if(++seen>128 || Buffer.byteLength(line)>MAX_LINE) {
    process.stdout.write('{"ok":false,"error":"cli_resource_limit"}\n');
    break;
  }
  try {
    const request=JSON.parse(line);
    const result=await gateway.invoke(request);
    process.stdout.write(JSON.stringify({ok:true,result})+'\n');
  } catch(error) {
    // Never serialize token, URL, nested Node-RED data or stack.
    const code=typeof error?.code==='string' &&
      /^[a-z0-9_]{2,80}$/.test(error.code) ? error.code : 'invalid_request';
    process.stdout.write(JSON.stringify({ok:false,error:code})+'\n');
  }
}
