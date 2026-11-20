/**
 * Adamantium-node R06: fail-closed CPU-first native Universal Graph G0 gate.
 *
 * This is an adapter to the OFFLINE C++17 compiler, not a MAS policy provider,
 * authorizer, deployment endpoint, or executable flow runtime.
 * Native library source is supplied separately from pinned ToolBox G0 commit.
 * SPDX-License-Identifier: Apache-2.0
 */
import {readFile,lstat} from "node:fs/promises";
import {createHash} from "node:crypto";
import {spawn} from "node:child_process";
import path from "node:path";
import {inspectCapsuleIRProposal} from "./capsule-ir-proposal.mjs";

export const NATIVE_GATE="adamantium.capsule-native-g0-gate/1";
const SHA=/^[a-f0-9]{64}$/;
const TOKEN=/^[A-Za-z0-9_.@-]{1,300}$/;
const id=/^[a-z][a-z0-9_.-]{0,127}$/;
function assert(x,why){if(!x)throw new TypeError("Native G0 gate: "+why);}
function token(x,field){
  assert(typeof x==="string"&&TOKEN.test(x),"invalid wire "+field);
  return x;
}
function count(n,field){
  assert(Number.isSafeInteger(n)&&n>=0&&n<=4294967295,"invalid "+field);
  return String(n);
}
function encodePort(p){return ["PORT",token(p.id,"port id"),token(p.dataType,"dataType"),
  token(p.direction,"direction"),token(p.semantics,"semantics")].join(" ");}
function encodeNode(node) {
  return [
    ["NODE",token(node.id,"node id"),token(node.kind,"kind"),
      node.typeRef?token(node.typeRef,"typeRef"):"-",
      node.graphRef?token(node.graphRef,"graphRef"):"-",
      count(node.graphRefRevision,"graphRefRevision"),
      count(node.ports.length,"node ports")].join(" "),
    ...node.ports.map(encodePort)
  ];
}
/** Unambiguous restricted token transport. No arbitrary source strings. */
export function encodeNativeG0Wire(proposal) {
  const info=inspectCapsuleIRProposal(proposal);
  const lines=["UGIR1","ROOT "+token(info.rootGraphId,"root"),
    String(info.graphCount)];
  for(const graph of proposal.graphs) {
    lines.push(["GRAPH",token(graph.id,"graph id"),count(graph.revision,"revision"),
      token(graph.domain,"domain"),count(graph.schemaVersion,"schemaVersion"),
      count(graph.interfacePorts.length,"interfacePorts"),
      count(graph.nodes.length,"nodes"),count(graph.edges.length,"edges")].join(" "));
    lines.push(...graph.interfacePorts.map(encodePort));
    for(const node of graph.nodes)lines.push(...encodeNode(node));
    for(const edge of graph.edges)lines.push(["EDGE",token(edge.id,"edge id"),
      token(edge.fromNode,"fromNode"),token(edge.fromPort,"fromPort"),
      token(edge.toNode,"toNode"),token(edge.toPort,"toPort"),
      token(edge.semantics,"edge semantics"),count(edge.delayTicks,"delay")].join(" "));
    lines.push("ENDGRAPH");
  }
  lines.push("END");
  const data=lines.join("\n")+"\n";
  assert(Buffer.byteLength(data,"utf8")<=2_000_000,"native input exceeds 2 MB");
  return data;
}
function execute(binary,data,timeoutMs) {
  return new Promise((resolve,reject)=>{
    let settled=false,stdout="",stderr="";
    const child=spawn(binary,[],{shell:false,windowsHide:true,
      stdio:["pipe","pipe","pipe"],timeout:timeoutMs,killSignal:"SIGKILL",
      env:{PATH:process.env.PATH||""}});
    function finish(error,value){
      if(settled)return;settled=true;
      if(error)reject(error);else resolve(value);
    }
    child.on("error",error=>finish(error));
    child.stdout.on("data",piece=>{
      stdout+=piece.toString("utf8");
      if(stdout.length>1000)child.kill("SIGKILL");
    });
    child.stderr.on("data",piece=>{
      stderr+=piece.toString("utf8");
      if(stderr.length>1000)child.kill("SIGKILL");
    });
    child.stdin.on("error",error=>finish(error));
    child.on("close",(code,signal)=>{
      if(signal)finish(new Error("Native G0 gate terminated or timed out"));
      else finish(null,{code,stdout:stdout.trim(),stderr:stderr.trim()});
    });
    child.stdin.end(data);
  });
}
/**
 * Requires a locally operator-pinned, SHA256-verified native validator binary.
 * The process has no shell, no plugins, no network input and bounded IO/time.
 * A native reject is accepted:false. Failure to launch/verify/parse fails CLOSED.
 */
export function createPinnedNativeG0Validator({
  binaryPath,binarySha256,timeoutMs=3000
}={}) {
  assert(typeof binaryPath==="string"&&path.isAbsolute(binaryPath),
    "operator must supply an absolute binary path");
  assert(typeof binarySha256==="string"&&SHA.test(binarySha256),
    "operator must pin exact native binary SHA256");
  assert(Number.isSafeInteger(timeoutMs)&&timeoutMs>=200&&timeoutMs<=15000,
    "invalid compiler timeout");
  return async function nativeValidate({graphId,proposal,expectedRevision,principalId}) {
    assert(typeof principalId==="string"&&id.test(principalId),"missing Core-authenticated principal");
    assert(typeof graphId==="string"&&id.test(graphId),"invalid graph scope");
    const info=inspectCapsuleIRProposal(proposal);
    assert(info.rootGraphId===graphId,"root graph scope mismatch");
    assert(Number.isSafeInteger(expectedRevision)&&expectedRevision>=1&&
      info.revision===expectedRevision+1,"expected CAS revision mismatch");
    const graphJSON=JSON.stringify(proposal.graphs);
    const graphsSha256=createHash("sha256").update(graphJSON).digest("hex");
    const stat=await lstat(binaryPath);
    assert(stat.isFile()&&!stat.isSymbolicLink(),"native executable is not a regular file");
    const binary=await readFile(binaryPath);
    assert(binary.length<=20_000_000,"unexpected native executable size");
    assert(createHash("sha256").update(binary).digest("hex")===binarySha256,
      "native binary fingerprint mismatch");
    const wire=encodeNativeG0Wire(proposal);
    const output=await execute(binaryPath,wire,timeoutMs);
    if(output.code===2&&/^REJECT [0-9]+ [a-z0-9_.-]+ [a-z0-9_.-]+$/.test(output.stdout)){
      return {accepted:false,graphsSha256};
    }
    const match=output.code===0 && /^OK ([0-9]+) ([0-9]+) ([0-9]+)$/.exec(output.stdout);
    assert(!!match&&output.stderr==="","native compiler failed or returned malformed proof");
    const graphCount=Number(match[1]),nodes=Number(match[2]),edges=Number(match[3]);
    assert(graphCount===info.graphCount &&
      nodes===proposal.graphs.reduce((s,g)=>s+g.nodes.length,0) &&
      edges===proposal.graphs.reduce((s,g)=>s+g.edges.length,0),
      "native result count mismatch");
    return {accepted:true,graphsSha256};
  };
}
