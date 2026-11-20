/**
 * Adamantium-node AI-first read-only observer R01.
 * Inspect a *local* Node-RED Admin API v2 without reading secrets or mutating flows.
 * All writes, auth provisioning, MAS rights and Graph IR transformations are out of scope.
 * SPDX-License-Identifier: Apache-2.0
 */
import {pathToFileURL} from "node:url";

export function validateEndpoint(raw) {
  if (typeof raw !== "string" || raw.length > 256) throw new Error("Explicit --url required");
  const u = new URL(raw);
  if (!["http:", "https:"].includes(u.protocol) ||
      !["127.0.0.1", "localhost", "[::1]"].includes(u.hostname) ||
      u.username || u.password || u.search || u.hash || u.pathname !== "/") {
    throw new Error("Only explicit loopback Node-RED origins are permitted");
  }
  return u.origin;
}
export function projection(data) {
  if (!data || typeof data !== "object" || typeof data.rev !== "string" ||
      !Array.isArray(data.flows) || data.flows.length > 15000) {
    throw new Error("Invalid or unsupported Node-RED API v2 response");
  }
  const all = data.flows;
  const ids = new Set();
  const counts = Object.create(null);
  const tabs = [];
  const nodes = [];
  const edges = [];
  for (const n of all) {
    if (!n || typeof n.id !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(n.id) ||
        ids.has(n.id) || typeof n.type !== "string" || n.type.length > 120) {
      throw new Error("Malformed node identity or duplicate ID");
    }
    ids.add(n.id);
    counts[n.type] = (counts[n.type] || 0) + 1;
    const safe = {id:n.id, type:n.type};
    if (typeof n.z === "string") safe.tabId = n.z;
    if (typeof n.name === "string") safe.name = n.name.slice(0, 120);
    if (n.disabled === true) safe.disabled = true;
    if (n.type === "tab") {
      safe.name = typeof n.label === "string" ? n.label.slice(0, 120) : safe.name || "Unnamed";
      tabs.push(safe);
    } else {
      let count = 0;
      for (const [output,group] of (Array.isArray(n.wires) ? n.wires : []).entries()) {
        if (!Array.isArray(group)) throw new Error("Malformed wire group");
        for (const to of group) {
          if (typeof to !== "string" || !/^[A-Za-z0-9._-]{1,128}$/.test(to) ||
              edges.length >= 50000) throw new Error("Malformed or oversized topology");
          edges.push({from:n.id,output,to});
          count++;
        }
      }
      safe.outboundEdges = count;
      nodes.push(safe);
    }
  }
  const totalEdges = edges.length;
  const danglingEdges = edges.filter(e=>!ids.has(e.to)).length;
  return {
    format:"adamantium.node-red-readonly/1",
    source:"node-red-admin-v2",
    trustedGraphIR:false,
    authorizationGranted:false,
    liveExecutionConfirmed:false,
    revision:data.rev,
    summary:{tabs:tabs.length,nodes:nodes.length,outboundEdges:totalEdges,danglingEdges,types:counts},
    tabs,nodes,edges
  };
}
export function difference(before,after) {
  if (!before || !after ||
      before.format !== "adamantium.node-red-readonly/1" ||
      after.format !== before.format) throw new Error("Projection format mismatch");
  const old = new Map([...before.tabs,...before.nodes].map(n=>[n.id,n]));
  const now = new Map([...after.tabs,...after.nodes].map(n=>[n.id,n]));
  const added=[], removed=[], changed=[];
  for (const [id,n] of now) {
    if (!old.has(id)) added.push(id);
    else if (JSON.stringify(n)!==JSON.stringify(old.get(id))) changed.push(id);
  }
  for (const id of old.keys()) if (!now.has(id)) removed.push(id);
  const key=e=>e.from+":"+e.output+"->"+e.to;
  const oldEdges=new Set(before.edges.map(key)), newEdges=new Set(after.edges.map(key));
  const addedEdges=[...newEdges].filter(k=>!oldEdges.has(k));
  const removedEdges=[...oldEdges].filter(k=>!newEdges.has(k));
  return {format:"adamantium.node-red-readonly-diff/1",from:before.revision,to:after.revision,added,removed,changed,
    addedEdges,removedEdges,
    note:"Topology/metadata-only diff. Source/config/code changes may be invisible and are never authorization receipts."};
}
export async function inspect(origin,token,{fetchImpl=fetch,allowUnauthenticatedLab=false}={}) {
  if (!token && !allowUnauthenticatedLab) throw new Error("Missing token; --unauthenticated-lab needed for temporary loopback-only lab");
  const u = validateEndpoint(origin);
  const headers={"Node-RED-API-Version":"v2","Accept":"application/json"};
  if(token) headers.Authorization="Bearer "+token;
  const response = await fetchImpl(u+"/flows",{method:"GET",headers,redirect:"error",signal:AbortSignal.timeout(7000)});
  if (!response.ok) throw new Error("Node-RED GET /flows returned HTTP "+response.status);
  return projection(await response.json());
}
function parseArgs(argv) {
  const [command,...rest]=argv;
  if (!["inspect","watch"].includes(command)) throw new Error("Usage: inspect|watch --url http://127.0.0.1:1885/ [--unauthenticated-lab] [--samples N] [--interval-ms N]");
  const opts={command,origin:null,allowUnauthenticatedLab:false,samples:3,intervalMs:1000};
  for(let i=0;i<rest.length;i++) {
    const arg=rest[i];
    if(arg==="--url")opts.origin=rest[++i];
    else if(arg==="--unauthenticated-lab")opts.allowUnauthenticatedLab=true;
    else if(arg==="--samples")opts.samples=Number(rest[++i]);
    else if(arg==="--interval-ms")opts.intervalMs=Number(rest[++i]);
    else throw new Error("Unknown argument "+arg);
  }
  if(!Number.isInteger(opts.samples)||opts.samples<1||opts.samples>20 ||
     !Number.isInteger(opts.intervalMs)||opts.intervalMs<200||opts.intervalMs>10000)throw new Error("Invalid watch bounds");
  opts.origin=validateEndpoint(opts.origin);
  return opts;
}
export async function main(argv=process.argv.slice(2)) {
  const opts=parseArgs(argv);
  const token=process.env.ADAMANTIUM_NODE_ACCESS_TOKEN || "";
  let last=null;
  for(let i=0;i<(opts.command==="inspect"?1:opts.samples);i++) {
    if(i)await new Promise(r=>setTimeout(r,opts.intervalMs));
    const snapshot=await inspect(opts.origin,token,opts);
    if(opts.command==="inspect")console.log(JSON.stringify(snapshot));
    else console.log(JSON.stringify({sample:i+1,at:new Date().toISOString(),
      revision:snapshot.revision,
      summary:snapshot.summary,
      changed:last?difference(last,snapshot):null}));
    last=snapshot;
  }
}
if (process.argv[1] && import.meta.url===pathToFileURL(process.argv[1]).href) {
  main().catch(error=>{console.error("adamantium inspect:",error.message);process.exitCode=1;});
}
