/**
 * Isolated safe-mode native Node-RED Q menu smoke.
 * Runs only when CONSTRUCT_DEPS_ROOT and CONSTRUCT_CHROME are supplied.
 * SPDX-License-Identifier: Apache-2.0
 */
import assert from "node:assert/strict";
import {createServer} from "node:net";
import {mkdtemp,mkdir,symlink,writeFile,rm} from "node:fs/promises";
import {spawn} from "node:child_process";
import {tmpdir} from "node:os";
import {join,resolve} from "node:path";
import {pathToFileURL,fileURLToPath} from "node:url";

const depRoot=process.env.CONSTRUCT_DEPS_ROOT;
const browserPath=process.env.CONSTRUCT_CHROME;
assert.ok(depRoot&&browserPath,"ephemeral dependencies and Chrome path are required");
const root=resolve(depRoot);
const moduleRoot=join(root,"node_modules");
const nodeRed=join(moduleRoot,"node-red","red.js");
const browserModule=join(moduleRoot,"playwright-core","index.mjs");
const {chromium}=await import(pathToFileURL(browserModule).href);
const plugin=fileURLToPath(new URL("../../adamantium/plugins/node-red-contrib-adamantium-construct/",import.meta.url));

async function freePort(){
  const server=createServer();
  await new Promise((ok,fail)=>server.once("error",fail).listen(0,"127.0.0.1",ok));
  const port=server.address().port;
  await new Promise(ok=>server.close(ok));
  return port;
}
const userDir=await mkdtemp(join(tmpdir(),"adamantium-q-r02-"));
const port=await freePort();
const base="http://127.0.0.1:"+port;
let server=null,browser=null,log="";
try {
  await mkdir(join(userDir,"node_modules"),{recursive:true});
  await symlink(plugin,join(userDir,"node_modules","node-red-contrib-adamantium-construct"),"dir");
  await writeFile(join(userDir,"settings.js"),
    "module.exports={uiHost:'127.0.0.1',httpAdminRoot:'/',editorTheme:{projects:{enabled:false}}};\n");
  server=spawn(process.execPath,[nodeRed,"--safe","--port",String(port),
    "--userDir",userDir,"--settings",join(userDir,"settings.js")],{
    cwd:root,env:{...process.env,PORT:String(port)},stdio:["ignore","pipe","pipe"]
  });
  server.stdout.on("data",c=>{log+=c.toString();});
  server.stderr.on("data",c=>{log+=c.toString();});
  let healthy=false;
  for(let i=0;i<150;i++){
    if(server.exitCode!==null)throw new Error("Node-RED exited: "+log.slice(-4000));
    try{const response=await fetch(base+"/");if(response.ok){healthy=true;break;}}catch{}
    await new Promise(ok=>setTimeout(ok,250));
  }
  assert.ok(healthy,"Node-RED did not become ready: "+log.slice(-5000));
  const plugResp=await fetch(base+"/plugins");
  assert.equal(plugResp.status,200,"editor plugin registry");
  const assets=await Promise.all(["/resources/node-red-contrib-adamantium-construct/core.mjs"].map(p=>fetch(base+p)));
  assert.equal(assets[0].status,200,"Construct native core served");
  browser=await chromium.launch({executablePath:browserPath,headless:true,args:["--no-sandbox","--disable-dev-shm-usage"]});
  const page=await browser.newPage({viewport:{width:1420,height:960}});
  const errors=[];
  page.on("pageerror",error=>errors.push(error.message));
  await page.goto(base+"/",{waitUntil:"domcontentloaded",timeout:60000});
  await page.waitForSelector("#adamantium-construct-native-overlay",{state:"attached",timeout:60000});
  await page.evaluate(()=>document.body.focus());
  await page.keyboard.press("q");
  await page.waitForSelector("#adamantium-construct-native-overlay:not([hidden])",{timeout:15000});
  await page.waitForSelector("#ada-native-cards .adamantium-construct-card",{timeout:15000});
  const cards=await page.locator("#ada-native-cards .adamantium-construct-card").count();
  assert.ok(cards>=3,"built-in native Q presets must render");
  const status=await page.locator("#ada-native-status").innerText();
  assert.match(status,/элементов/);
  await page.locator("#ada-native-stamp").selectOption("4");
  await page.locator("#ada-native-cards .adamantium-construct-card").first().locator("button").click();
  await page.waitForFunction(()=>document.getElementById("adamantium-construct-native-overlay")?.hidden===true,null,{timeout:15000});
  await page.mouse.move(800,450);
  await page.mouse.click(800,450);
  await page.waitForFunction(()=>{
    const id=RED.workspaces.active();
    return !!id && RED.nodes.filterNodes({z:id}).length>=8;
  },{timeout:15000});
  const nodes=await page.evaluate(()=>RED.nodes.filterNodes({z:RED.workspaces.active()})
    .map(n=>({id:n.id,type:n.type})));
  assert.equal(nodes.length,8,"four stamped source+sink pairs");
  assert.equal(nodes.filter(n=>n.type==="inject").length,4);
  assert.equal(nodes.filter(n=>n.type==="debug").length,4);
  const links=await page.evaluate(()=>{
    const result=[];RED.nodes.eachLink(link=>result.push({from:link.source.type,to:link.target.type}));
    return result;
  });
  assert.equal(links.length,4,"four independent connections");
  assert.ok(links.every(e=>e.from==="inject"&&e.to==="debug"));
  await page.evaluate(()=>RED.actions.invoke("core:undo"));
  await page.waitForFunction(()=>RED.nodes.filterNodes({z:RED.workspaces.active()}).length===0);
  await page.evaluate(()=>RED.actions.invoke("core:redo"));
  await page.waitForFunction(()=>RED.nodes.filterNodes({z:RED.workspaces.active()}).length===8);
  // Snapshot the first internally connected pair through the real Q menu.
  await page.evaluate(()=>{
    let chosen=[];RED.nodes.eachLink(link=>{if(!chosen.length)chosen=[link.source,link.target];});
    RED.view.select({nodes:chosen});
    document.body.focus();
  });
  await page.keyboard.press("q");
  await page.waitForSelector("#adamantium-construct-native-overlay:not([hidden])");
  await page.locator("#ada-native-title-input").fill("Saved diagnostic pair");
  page.once("dialog",dialog=>dialog.accept());
  await page.locator("#ada-native-save").click();
  await page.waitForFunction(()=>{
    const data=JSON.parse(localStorage.getItem("adamantium.native-q-library.r02")||"{}");
    return data.snapshots?.length===1;
  });
  await page.locator("#ada-native-stamp").selectOption("1");
  await page.locator("#ada-native-cards .adamantium-construct-card").first().locator("button").click();
  await page.mouse.move(650,550);
  await page.mouse.click(650,550);
  await page.waitForFunction(()=>RED.nodes.filterNodes({z:RED.workspaces.active()}).length>=10);
  const afterCopy=await page.evaluate(()=>RED.nodes.filterNodes({z:RED.workspaces.active()})
    .map(n=>n.id));
  assert.equal(afterCopy.length,10);
  assert.equal(new Set(afterCopy).size,10,"snapshot copy gets new native IDs");
  // Opt-in automatic construction on an entirely new, empty native flow.
  await page.evaluate(()=>document.body.focus());
  await page.keyboard.press("q");
  await page.waitForSelector("#adamantium-construct-native-overlay:not([hidden])");
  await page.locator("#ada-native-auto-tab").check();
  await page.evaluate(()=>RED.workspaces.add(null));
  await page.waitForFunction(()=>{
    const z=RED.workspaces.active();
    return !!z&&RED.nodes.filterNodes({z}).length===2;
  });
  const autoNodes=await page.evaluate(()=>RED.nodes.filterNodes({z:RED.workspaces.active()})
    .map(n=>n.type).sort());
  assert.deepEqual(autoNodes,["debug","inject"]);
  // A locked flow must reject editor-side changes before native import.
  await page.evaluate(()=>{RED.nodes.workspace(RED.workspaces.active()).locked=true;document.body.focus();});
  await page.keyboard.press("q");
  await page.waitForSelector("#adamantium-construct-native-overlay:not([hidden])");
  await page.locator("[data-ada-tab='builtin']").click();
  await page.locator("#ada-native-cards .adamantium-construct-card").first().locator("button").click();
  await page.waitForFunction(()=>document.querySelector("#ada-native-status")?.dataset.error==="true");
  assert.match(await page.locator("#ada-native-status").innerText(),/заблокирована/);
  assert.equal(await page.evaluate(()=>RED.nodes.filterNodes({z:RED.workspaces.active()}).length),2);
  await page.evaluate(()=>{RED.nodes.workspace(RED.workspaces.active()).locked=false;});
  assert.equal(new Set(nodes.map(n=>n.id)).size,nodes.length);
  assert.equal(errors.length,0,"browser JS errors: "+errors.join("; "));
  console.log("NATIVE_Q_SMOKE_OK stamped=8 saved_clone=2 auto_new_tab=2 locked_guard=true builtins="+cards+" port="+port);
} finally {
  if(browser)await browser.close();
  if(server){
    server.kill("SIGTERM");
    await new Promise(ok=>{if(server.exitCode!==null)return ok();server.once("exit",ok);
      setTimeout(()=>{server.kill("SIGKILL");ok();},3000).unref();});
  }
  await rm(userDir,{recursive:true,force:true});
}
