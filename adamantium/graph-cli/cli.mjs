#!/usr/bin/env node
// SPDX-License-Identifier: Apache-2.0
// Safe local CLI. No shell node, production runtime writes or network exposure.
import {createHash} from "node:crypto";
import {AgentGraphService} from "../agent-gateway/service.mjs";
import {startGateway} from "../agent-gateway/http.mjs";
import {compileNodeRed} from "../node-red-adapter/compile.mjs";

const command=process.argv[2]||"help";
const text=process.argv.slice(3).join(" ")||"Собери тестовый граф";
function staged(){
  const gateway=new AgentGraphService();
  const idempotency_key="cli:"+createHash("sha256").update(text).digest("hex").slice(0,32);
  const result=gateway.invoke("graph.bootstrap",{
    text,base_revision:0,idempotency_key});
  return {gateway,result};
}
try{
  if(command==="demo"){
    const {gateway,result}=staged();
    process.stdout.write(JSON.stringify({bootstrap:result,inspect:gateway.inspect()},null,2)+"\n");
  }else if(command==="node-red"){
    const {gateway}=staged();
    // Raw array accepted by Node-RED Editor > Import.
    process.stdout.write(JSON.stringify(compileNodeRed(gateway.inspect().graph).nodes,null,2)+"\n");
  }else if(command==="serve"){
    const token=process.env.ADAMANTIUM_AGENT_API_TOKEN;
    const {url}=await startGateway({token,sandbox:process.argv.includes("--sandbox"),
      factoryVerify:process.argv.includes("--factory-verify")});
    process.stderr.write("Adamantium Agent Graph API listening at "+url+
      " (token-required, loopback, in-memory, no production deploy)\n");
  }else{
    process.stderr.write("Usage:\n"+
      "  node adamantium/graph-cli/cli.mjs demo [Собери тестовый граф]\n"+
      "  node adamantium/graph-cli/cli.mjs node-red [Собери тестовый граф]\n"+
      "  ADAMANTIUM_AGENT_API_TOKEN=<secret> node adamantium/graph-cli/cli.mjs serve [--sandbox] [--factory-verify]\n");
    if(command!=="help")process.exitCode=2;
  }
}catch(err){
  process.stderr.write("Agent graph rejected: "+(err.code||err.message)+"\n");
  process.exitCode=1;
}
