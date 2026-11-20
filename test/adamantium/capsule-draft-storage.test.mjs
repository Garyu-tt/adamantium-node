import test from "node:test";
import assert from "node:assert/strict";
import {CapsuleDraftStorage,CapsuleDraftConflict} from "../../adamantium/capsule-draft-storage.mjs";

function storage(){
  const map=new Map();
  return {
    getItem:key=>map.get(key)??null,
    setItem:(key,value)=>map.set(key,value),
    map
  };
}
const model={format:"adamantium.capsule-model/1",graphs:{root:{instances:[]}}};
test("R08 local draft read + write increments advisory revision and retains templates",()=>{
 const s=storage(),a=new CapsuleDraftStorage({storage:s,key:"draft"});
 assert.equal(a.read().value,null);
 assert.equal(a.write({model,templates:{a:1},positions:{}}),1);
 assert.equal(a.revision,1);
 assert.equal(a.stale,false);
 const b=new CapsuleDraftStorage({storage:s,key:"draft"});
 const loaded=b.read();
 assert.equal(loaded.revision,1);
 assert.deepEqual(loaded.value.templates,{a:1});
 assert.equal(b.write({model,templates:{a:2},positions:{}}),2);
 assert.equal(a.stale,true);
 assert.equal(b.revision,2);
});
test("stale reader rejects overwrite without changing stored bytes",()=>{
 const s=storage(),a=new CapsuleDraftStorage({storage:s,key:"draft"});
 const b=new CapsuleDraftStorage({storage:s,key:"draft"});
 a.read();b.read();
 a.write({model});
 const before=s.map.get("draft");
 assert.throws(()=>b.write({model,positions:{x:123}}),CapsuleDraftConflict);
 assert.equal(s.map.get("draft"),before);
 assert.equal(b.revision,0);
 b.read();
 assert.equal(b.write({model,positions:{x:123}}),2);
});
test("existing R01 payload without a revision is supported without migration",()=>{
 const s=storage(),key="draft";
 s.setItem(key,JSON.stringify({model,positions:{},templates:{}}));
 const reader=new CapsuleDraftStorage({storage:s,key});
 assert.equal(reader.read().revision,0);
 assert.equal(reader.write({model,positions:{}}),1);
 assert.equal(JSON.parse(s.getItem(key)).draftRevision,1);
});
test("corrupt draft, unauthorized object fields and large inputs fail closed",()=>{
 const s=storage(),key="draft",a=new CapsuleDraftStorage({storage:s,key});
 s.setItem(key,"{corrupted");
 assert.throws(()=>a.read(),SyntaxError);
 assert.throws(()=>a.write({model}),CapsuleDraftConflict);
 s.setItem(key,JSON.stringify({model,draftRevision:-7}));
 assert.throws(()=>a.read(),/revision/);
 const empty=storage(),b=new CapsuleDraftStorage({storage:empty,key});
 b.read();
 assert.throws(()=>b.write({model:{},padding:"X".repeat(8000001)}),/size limit/);
 assert.equal(empty.getItem(key),null);
});
test("failed setItem never advances remembered revision",()=>{
 const s=storage();
 const a=new CapsuleDraftStorage({storage:{
    getItem:s.getItem,setItem(){throw new Error("quota");}
  },key:"draft"});
 a.read();
 assert.throws(()=>a.write({model}),/quota/);
 assert.equal(a.revision,0);
});
