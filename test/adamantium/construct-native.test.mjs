import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";
import {
 FORMAT,BUILTINS,MAX_NODES,validateBlueprint,preparePlacement,captureSelection,
 freshLibrary,restoreLibrary,addSnapshot,addReference,stampBlueprint,makeSubflowPlacement
} from "../../adamantium/construct-native/core.mjs";

test("presets are vetted, bounded, offline-only, and connect internally",()=>{
 assert.equal(BUILTINS.length,3);
 for(const preset of BUILTINS){
  const clean=validateBlueprint(preset.blueprint);
  assert.ok(clean.nodes.length>=2);
  assert.ok(clean.nodes.length<=MAX_NODES);
  const ids=new Set(clean.nodes.map(n=>n.id));
  for(const n of clean.nodes)for(const port of n.wires)for(const target of port)assert.ok(ids.has(target));
 }
});
test("stamp duplicates connected assemblies without any shared node IDs",()=>{
 const b=BUILTINS[0].blueprint;
 const original=JSON.stringify(b),stamped=stampBlueprint(b,4);
 assert.equal(stamped.nodes.length,8);
 const ids=stamped.nodes.map(n=>n.id);
 assert.equal(new Set(ids).size,ids.length);
 const each=ids.reduce((result,n)=>{const prefix=n.split("_n")[0];(result[prefix]??=[]).push(n);return result;},{});
 assert.equal(Object.keys(each).length,4);
 for(const n of stamped.nodes)for(const group of n.wires)for(const target of group)
   assert.equal(n.id.split("_n")[0],target.split("_n")[0]);
 assert.equal(JSON.stringify(b),original,"stamping must not mutate saved blueprint");
});
test("native placement regenerates positions and scopes all nodes to target flow",()=>{
 const transformed=preparePlacement(BUILTINS[0].blueprint,"flow_1",{x:500,y:350});
 assert.equal(transformed[0].x,500);
 assert.equal(transformed[0].y,350);
 assert.ok(transformed.every(n=>n.z==="flow_1"));
 assert.ok(transformed[1].x>transformed[0].x);
 assert.throws(()=>preparePlacement(BUILTINS[0].blueprint,"../other"),/flow ID/);
});
test("capture selected native nodes retains only internal links and never credentials",()=>{
 const raw=[
  {id:"abc",type:"inject",x:100,y:200,props:[{p:"payload"}],name:"Trigger",wires:[["def","outside"]]},
  {id:"def",type:"debug",x:340,y:200,name:"Inspector",complete:"true",wires:[]}
 ];
 const b=captureSelection(raw);
 assert.equal(b.nodes[0].wires[0].length,1);
 assert.equal(b.nodes[0].wires[0][0],b.nodes[1].id);
 assert.equal(b.nodes[0].z,undefined);
 assert.ok(!JSON.stringify(b).includes("outside"));
 assert.throws(()=>captureSelection([{...raw[0],credentials:{password:"secret"}}]),/credentials/);
 assert.throws(()=>captureSelection([{...raw[0],type:"http request"}]),/vetted built-in types/);
});
test("no implicit config nodes, ambient privilege, unsupported types or wire escapes",()=>{
 const src=BUILTINS[0].blueprint.nodes[0];
 assert.throws(()=>validateBlueprint({nodes:[{...src,type:"exec"}]}),/unsupported native node type/);
 assert.throws(()=>validateBlueprint({nodes:[{...src,wires:[["not_here"]]}]}),/wire escapes/);
 assert.throws(()=>stampBlueprint(BUILTINS[0].blueprint,12),/quantity/);
 assert.throws(()=>captureSelection(Array.from({length:65},(_,i)=>({...src,id:"id_"+i}))),/1..64/);
 assert.throws(()=>validateBlueprint({nodes:[{...src,props:[{"__proto__":"polluted",constructor:"x"}]}]}),/unsafe payload key/);
});
test("local snapshot library roundtrip, distinct independent IDs and bookmarks to same identity",()=>{
 let store=freshLibrary();
 assert.equal(store.format,FORMAT);
 store=addSnapshot(store,"Диагностика",BUILTINS[0].blueprint);
 const afterFirst=store.snapshots[0].id;
 store=addSnapshot(store,"Диагностика 2",BUILTINS[0].blueprint);
 assert.notEqual(afterFirst,store.snapshots[1].id);
 store=addReference(store,"Same node","flow01","abc");
 assert.equal(store.references[0].nodeId,"abc");
 assert.equal(store.references[0].flowId,"flow01");
 assert.deepEqual(restoreLibrary(JSON.parse(JSON.stringify(store))),store);
 assert.deepEqual(restoreLibrary(null),freshLibrary());
});
test("imported library data is validated, never treated as executable directives",()=>{
 const malformed={format:FORMAT,seq:0,snapshots:[],references:[]};
 assert.throws(()=>restoreLibrary({...malformed,seq:-1}),/invalid native library/);
 assert.throws(()=>addSnapshot(malformed,"",BUILTINS[0].blueprint),/title/);
 assert.throws(()=>restoreLibrary({...malformed,references:[{id:"r1",title:"unsafe",nodeId:"x",flowId:"../bad"}]}),/target flow/);
 assert.throws(()=>validateBlueprint({nodes:[{id:"a",type:"inject",x:1,y:2,wires:[],props:[{prototype:"bad"}]}]}),/unsafe payload key/);
});
test("subflow instance only references a declared definition; no duplicated source",()=>{
 const placement=makeSubflowPlacement("s1","f1");
 assert.deepEqual(placement[0],{id:"linked_subflow",type:"subflow:s1",z:"f1",x:180,y:150,wires:[[]]});
 assert.throws(()=>makeSubflowPlacement("../../evil","f1"),/subflow ID/);
});
test("plugin is a real Node-RED editor plugin, no runtime executable nodes",async()=>{
 const root=new URL("../../adamantium/plugins/node-red-contrib-adamantium-construct/",import.meta.url);
 const pkg=JSON.parse(await readFile(new URL("package.json",root),"utf8"));
 assert.equal(pkg.name,"node-red-contrib-adamantium-construct");
 assert.ok(pkg["node-red"].plugins["adamantium-native"]);
 assert.equal(pkg["node-red"].nodes,undefined);
 assert.equal(pkg.scripts?.postinstall,undefined);
 assert.equal(await readFile(new URL("resources/core.mjs",root),"utf8"),
   await readFile(new URL("../../adamantium/construct-native/core.mjs",import.meta.url),"utf8"));
 for(const filename of ["reactor.mjs","reactor-editor.mjs"]){
   assert.equal(await readFile(new URL("resources/"+filename,root),"utf8"),
     await readFile(new URL("../../adamantium/construct-native/"+filename,import.meta.url),"utf8"));
 }

 const html=await readFile(new URL("native-q-menu.html",root),"utf8");
 const reg=html.match(/<script type="text\/javascript">([\s\S]*?)<\/script>/);
 assert.ok(reg);
 let plugin=null;
 vm.runInNewContext(reg[1],{RED:{plugins:{registerPlugin:(name,data)=>plugin={name,data}}}});
 assert.equal(plugin.name,"adamantium-construct-native-r02");
 assert.equal(typeof plugin.data.onadd,"function");
 assert.match(reg[1],/RED\.view\.importNodes/);
 assert.match(reg[1],/RED\.actions\.invoke\("core:delete-selection"\)/);
 assert.match(reg[1],/RED\.events\.on\("flows:add"/);
 assert.match(reg[1],/generateIds:true/);
 assert.match(reg[1],/RED\.workspaces\.isLocked/);
 assert.doesNotMatch(reg[1],/RED\.nodes\.import\(/);
 assert.doesNotMatch(reg[1],/RED\.nodes\.add\(/);
 assert.doesNotMatch(reg[1],/deployFlows|flows\.set|fetch\(|eval\(/);
});
