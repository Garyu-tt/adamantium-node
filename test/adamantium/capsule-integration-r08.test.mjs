import test from "node:test";
import assert from "node:assert/strict";
import {readFile} from "node:fs/promises";
import {createHash} from "node:crypto";

const root=new URL("../../adamantium/",import.meta.url);
const plugin=new URL("plugins/node-red-contrib-adamantium-capsules/",root);
const source=(path)=>new URL(path,root);
const resource=(path)=>new URL(path,plugin);
const read=async(url)=>(await readFile(url)).toString("utf8");
const digest=(bytes)=>createHash("sha256").update(bytes).digest("hex");

test("R08 declares one inert editor-only plugin and pins its feature version",async()=>{
 const manifest=JSON.parse(await read(resource("package.json")));
 assert.equal(manifest.name,"node-red-contrib-adamantium-capsules");
 assert.equal(manifest.version,"0.4.0");
 assert.deepEqual(manifest["node-red"]?.plugins,
  {"adamantium-capsules":"capsule-sidebar.html"});
 assert.ok(!Object.hasOwn(manifest["node-red"],"nodes"),
  "editor-only plugin must not become an executable Node-RED node");
 assert.match(manifest.scripts.check,/construct-engine\.mjs/);
 assert.match(manifest.scripts.check,/capsule-native-canvas\.mjs/);
});

test("R08 portable package uses byte-identical source for all integrated modules",async()=>{
 const pairs=[
  ["capsule-preview/app.mjs","resources/preview/app.mjs"],
  ["capsule-preview/index.html","resources/preview/index.html"],
  ["construct-engine.mjs","resources/construct-engine.mjs"],
  ["capsule-native-layout.mjs","resources/capsule-native-layout.mjs"],
  ["capsule-native-canvas.mjs","resources/capsule-native-canvas.mjs"]
 ];
 for(const [left,right] of pairs){
  const a=await readFile(source(left)),b=await readFile(resource(right));
  assert.equal(digest(a),digest(b),left+" and "+right+" must be exact matches");
 }
});

test("R08 preview preserves Q constructor and signed Graph IR proposal export",async()=>{
 const html=await read(source("capsule-preview/index.html"));
 const app=await read(source("capsule-preview/app.mjs"));
 assert.match(html,/Capsule Studio R08/);
 assert.match(html,/id="constructMenuToggle"/);
 assert.match(html,/id="exportIR"/);
 assert.match(html,/#workspace\s*\{[^}]*flex:\s*1 1 auto;/);
 assert.match(app,/openConstructMenu/);
 assert.match(app,/createCapsuleIRProposal/);
 assert.match(app,/window\.addEventListener\("storage"/);
});

test("native SVG lens remains a separate inert editor draft and captures Q",async()=>{
 const sidebar=await read(resource("capsule-sidebar.html"));
 const native=await read(source("capsule-native-canvas.mjs"));
 assert.match(sidebar,/adamantium:toggle-native-canvas/);
 assert.match(sidebar,/На основной SVG/);
 assert.match(native,/adamantium-native-capsule-layer/);
 assert.match(native,/data-authority/);
 assert.match(native,/data-runtime/);
 assert.match(native,/constructKey/);
 assert.match(native,/stopImmediatePropagation/);
 assert.doesNotMatch(native,/RED\.nodes\.add\(/,
  "the native Capsule lens must never deploy runtime flow nodes");
});
