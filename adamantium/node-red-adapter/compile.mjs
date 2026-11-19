// SPDX-License-Identifier: Apache-2.0
// Pure G0 IR -> disabled Node-RED 5 import adapter. Does not call Admin API.
import {validateGraph} from "../graph-schema/agent-graph.mjs";

const TAB="adamantium.bootstrap.tab";
const config = {
  "adamantium.demo.source@1": "inject",
  "adamantium.demo.set@1": "change",
  "adamantium.demo.sink@1": "debug"
};
export function compileNodeRed(input) {
  const {graph,order}=validateGraph(input);
  const ids=new Set(graph.nodes.map(n=>n.id));
  if(ids.has(TAB))throw new TypeError("reserved_tab_id");
  const outgoing=new Map(graph.nodes.map(n=>[n.id,[]]));
  for(const e of graph.edges)outgoing.get(e.fromNode).push(e.toNode);
  const nodes=[{
    id:TAB,type:"tab",label:"Adamantium Agent Demo (disabled)",disabled:true,
    info:"Safe agent-generated fixture. Enable only in a dedicated Node-RED sandbox."
  }];
  for(const [index,id] of order.entries()){
    const n=graph.nodes.find(item=>item.id===id);
    const base={
      id:n.id,type:config[n.typeRef],z:TAB,
      name:n.id,x:170+index*220,y:140,wires:[outgoing.get(n.id)]
    };
    if(base.type==="inject"){
      Object.assign(base,{props:[{p:"payload"}],repeat:"",crontab:"",
        once:false,onceDelay:0.1,topic:"",payload:"bootstrap",payloadType:"str"});
    } else if(base.type==="change"){
      Object.assign(base,{rules:[{t:"set",p:"payload",pt:"msg",to:"verified",tot:"str"}],
        action:"",property:"",from:"",to:"",reg:false});
    } else {
      Object.assign(base,{active:true,tosidebar:true,console:false,
        tostatus:false,complete:"payload",targetType:"msg",
        statusVal:"",statusType:"auto",wires:[]});
    }
    nodes.push(base);
  }
  return {format:"adamantium.node-red-import/1",
    sourceGraphId:graph.id,sourceRevision:graph.revision,
    nodes,disabledByDefault:true,appliedToNodeRed:false,
    actualNodeRedExecution:false};
}
