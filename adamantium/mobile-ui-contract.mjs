/**
 * Adamantium-node R03: inert, declarative mobile UI validation.
 * The signed release verifier remains the trust gate; a validated UI is never
 * an authorization to execute an Android API, launch code or change policy.
 */
export const UI_SCHEMA = "mechanicus.mobile-ui/1";
export const UI_TARGET = "adamantium.ai-core.mobile";
const NAME = /^[a-z][a-z0-9._-]{0,95}$/;
const COMPONENTS = new Set([
  "column","row","heading","text","status","divider","chat-thread",
  "composer","task-tree","model-picker","device-metrics","module-list",
  "download-progress","button","spacer"
]);
const ACTIONS = new Set(["navigate","request-capability","local-view"]);
const MAX_COMPONENTS=512, MAX_DEPTH=16;
function ensure(ok,reason){if(!ok)throw new TypeError("UI rejected: "+reason)}
function obj(v){return !!v && typeof v==="object" && !Array.isArray(v)}
function exact(v,keys,context){
  ensure(obj(v),context+" must be object");
  for(const k of Object.keys(v)) ensure(keys.includes(k),context+" unknown field "+k);
}
function id(v,field){ensure(typeof v==="string"&&NAME.test(v),"invalid "+field);return v}
function str(v,field,max=180){
  ensure(typeof v==="string" && v.length<=max && !/[\u0000-\u001f]/.test(v),"invalid "+field);
}
function action(a,ctx,screens,declared){
  exact(a,["type","target","capability"],ctx+".action");
  ensure(ACTIONS.has(a.type),"action type forbidden");
  id(a.target,ctx+".action.target");
  if(a.type==="navigate"){
    ensure(screens.has(a.target),"navigation target missing");
    ensure(!Object.hasOwn(a,"capability"),"unexpected navigation capability");
  }else if(a.type==="request-capability"){
    ensure(declared.has(a.target),"capability not declared by APK");
    ensure(a.capability===a.target,"capability identifier mismatch");
  }else{
    ensure(!Object.hasOwn(a,"capability"),"view action cannot grant a capability");
  }
}
function node(n,context,depth,state){
  ensure(depth<=MAX_DEPTH,"component depth exceeded");
  exact(n,["id","type","label","dataRef","children","action"],context);
  id(n.id,context+".id");
  ensure(!state.nodes.has(n.id),"duplicate component id "+n.id);
  state.nodes.add(n.id);ensure(state.nodes.size<=MAX_COMPONENTS,"component budget exceeded");
  ensure(COMPONENTS.has(n.type),"unknown component "+n.type);
  if(Object.hasOwn(n,"label"))str(n.label,context+".label");
  if(Object.hasOwn(n,"dataRef"))id(n.dataRef,context+".dataRef");
  if(Object.hasOwn(n,"action")){
    ensure(n.type==="button","only buttons can request an action");
    action(n.action,context,state.screens,state.declared);
  }
  if(n.type==="button")ensure(Object.hasOwn(n,"action"),"button without action");
  if(Object.hasOwn(n,"children")){
    ensure(["row","column"].includes(n.type),"only layout components contain children");
    ensure(Array.isArray(n.children)&&n.children.length<=64,"invalid child count");
    for(const child of n.children)node(child,context+".child",depth+1,state);
  }
  if(["row","column"].includes(n.type))ensure(Array.isArray(n.children),"layout needs children");
}
// Signed packages must pass verifyMobileRelease() and verifyBlob() BEFORE this.
export function validateMobileUI(document,{availableCapabilities=[]}={}){
  exact(document,["schema","target","revision","screens","navigation","dataBindings"],"document");
  ensure(document.schema===UI_SCHEMA&&document.target===UI_TARGET,"target/schema mismatch");
  ensure(Number.isSafeInteger(document.revision)&&document.revision>=1,"bad revision");
  ensure(Array.isArray(document.screens)&&document.screens.length>0&&document.screens.length<=24,"bad screens");
  ensure(Array.isArray(document.navigation)&&document.navigation.length>0&&document.navigation.length<=24,"bad navigation");
  exact(document.dataBindings,["providers"],"dataBindings");
  ensure(Array.isArray(document.dataBindings.providers)&&document.dataBindings.providers.length<=64,"invalid data providers");
  const declared=new Set(availableCapabilities.map(x=>id(x,"availableCapability")));
  const providers=new Set();
  for(const provider of document.dataBindings.providers){
    exact(provider,["id","source"],"data provider");
    id(provider.id,"provider.id");
    ensure(!providers.has(provider.id),"duplicate provider");
    providers.add(provider.id);
    ensure(["sample","view-state","typed-snapshot"].includes(provider.source),"forbidden binding source");
  }
  const screens=new Set();
  for(const s of document.screens){
    exact(s,["id","title","tree"],"screen");
    id(s.id,"screen.id");str(s.title,"screen.title");
    ensure(!screens.has(s.id),"duplicate screen");
    screens.add(s.id);
  }
  const nodes=new Set();
  for(const s of document.screens)node(s.tree,"screen."+s.id,0,{nodes,screens,declared});
  const navigation=new Set();
  for(const n of document.navigation){
    exact(n,["screen","label"],"navigation");
    ensure(screens.has(n.screen),"navigation screen missing");
    ensure(!navigation.has(n.screen),"duplicate navigation");
    navigation.add(n.screen);str(n.label,"navigation.label",40);
  }
  for(const s of document.screens)ensure(navigation.has(s.id),"screen missing navigation item");
  return Object.freeze({
    schema:document.schema,target:document.target,revision:document.revision,
    screenCount:screens.size,componentCount:nodes.size,providerCount:providers.size,
    invocationAuthorized:false,networkAuthorized:false,installAuthorized:false
  });
}
