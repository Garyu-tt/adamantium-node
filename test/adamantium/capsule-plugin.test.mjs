import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import vm from "node:vm";

const root=new URL("../../adamantium/",import.meta.url);
const packageRoot=new URL("plugins/node-red-contrib-adamantium-capsules/",root);
const load=async(path,base=packageRoot)=>readFile(new URL(path,base),"utf8");
test("Node-RED editor package declares a real editor plugin (no executable runtime node)",async()=>{
 const pkg=JSON.parse(await load("package.json"));
 assert.equal(pkg.name,"node-red-contrib-adamantium-capsules");
 assert.ok(pkg["node-red"]?.plugins?.["adamantium-capsules"]);
 assert.equal(pkg["node-red"].nodes,undefined);
 assert.equal(pkg.scripts?.postinstall,undefined);
});
test("packaged resources match single source-of-truth files byte-for-byte",async()=>{
 for(const path of ["capsule-studio.mjs","capsule-extract.mjs","capsule-ir-proposal.mjs","editor-projection.mjs","construct-engine.mjs"]){
  assert.equal(await load("resources/"+path),await load(path,root));
 }
 for(const path of ["index.html","app.mjs"]){
  assert.equal(await load("resources/preview/"+path),await load("capsule-preview/"+path,root));
 }
});
test("Node-RED sidebar registration, lazy iframe and keyboard action work under editor mocks",async()=>{
 const html=await load("capsule-sidebar.html");
 const match=html.match(/<script type="text\/javascript">([\s\S]+?)<\/script>/);
 assert.ok(match,"editor registration script");
 const widgets=[];
 function $(tag,opts){
   const element={tag,attrs:{},styles:{},events:{},children:[],textValue:"",css(v){Object.assign(this.styles,v);return this;},
     appendTo(parent){parent.children.push(this);return this;},attr(v,value){
       if(typeof v==="string"){if(arguments.length===1)return this.attrs[v];this.attrs[v]=value;}
       else Object.assign(this.attrs,v);return this;
     },text(v){this.textValue=v;return this;},
     on(event,callback){this.events[event]=callback;return this;}
   };
   if(opts)Object.assign(element.attrs,opts);
   widgets.push(element);return element;
 }
 let registered,tab,shown;
 const actions={};
 const RED={
  plugins:{registerPlugin:(name,def)=>{registered={name,def};}},
  sidebar:{containsTab:()=>false,addTab:(value)=>{tab=value;},show:(value)=>{shown=value;}},
  actions:{add:(name,fn)=>{actions[name]=fn;}}
 };
 let opened;
 vm.runInNewContext(match[1],{RED,$,document:{baseURI:"https://example.org/red/"},window:{open:(...args)=>{opened=args;}},URL});
 assert.equal(registered.name,"adamantium-capsules-r02");
 registered.def.onadd();
 assert.equal(tab.id,"adamantium-capsules-r02");
 assert.equal(tab.iconClass,"fa fa-object-group");
 assert.equal(tab.label,"Capsules");
 assert.ok(typeof tab.onchange==="function");
 assert.equal(tab.content.children.length,3);
 const frame=widgets.find(w=>w.tag==="<iframe>");
 assert.ok(frame);
 assert.equal(frame.attrs.src,undefined,"iframe remains inert until tab becomes visible");
 tab.onchange();
 assert.equal(frame.attrs.src,"https://example.org/red/resources/node-red-contrib-adamantium-capsules/preview/index.html");
 assert.match(frame.attrs.sandbox,/allow-scripts/);
 assert.equal(frame.attrs.referrerpolicy,"no-referrer");
 actions["adamantium:show-capsule-studio"]();
 assert.equal(shown,tab.id);
 const fullScreen=widgets.find(w=>w.attrs.text==="На весь экран ↗");
 assert.ok(fullScreen);
 fullScreen.events.click();
 assert.equal(opened[1],"_blank");
 assert.equal(opened[2],"noopener,noreferrer");
});
