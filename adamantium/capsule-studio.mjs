/**
 * Adamantium-node Capsule Studio R01.
 * Editor-only graph authoring model. Never runs user code or grants MAS permissions.
 * Definitions are reused; instances pin an immutable definition version.
 * SPDX-License-Identifier: Apache-2.0
 */
export const FORMAT = "adamantium.capsule-studio/1";
export const SIDES = Object.freeze(["north", "east", "south", "west"]);
const SEMANTICS = new Set(["data","control","event","signal"]);
const ID = /^[a-z][a-z0-9_.-]{0,95}$/;
const TYPE = /^[a-z][a-z0-9_.-]*@[1-9][0-9]*$/;
const own = (o,k) => Object.prototype.hasOwnProperty.call(o,k);
const object = v => v && typeof v === "object" && !Array.isArray(v);
function check(condition, message) { if (!condition) throw new TypeError(message); }
function key(v,field) { check(typeof v === "string" && ID.test(v), "invalid "+field); return v; }
function label(v,field) { check(typeof v === "string" && v.trim().length > 0 && v.length <= 128, "invalid "+field); return v.trim(); }
function copy(v) { return JSON.parse(JSON.stringify(v)); }
function portsOf(raw) {
  check(Array.isArray(raw) && raw.length <= 128, "ports required (max 128)");
  const seen=new Set();
  return raw.map(p=>{
    check(object(p),"invalid port");
    const tag=key(p.tag,"port tag");
    check(!seen.has(tag),"duplicate port tag: "+tag); seen.add(tag);
    check(p.direction === "input" || p.direction === "output","invalid direction");
    check(SEMANTICS.has(p.semantics),"invalid semantics");
    check(typeof p.dataType === "string" && TYPE.test(p.dataType),"invalid dataType");
    return {tag,direction:p.direction,semantics:p.semantics,dataType:p.dataType};
  });
}
function definitionSignature(language,source,ports) {
  return JSON.stringify([language,source,ports.slice().sort((a,b)=>a.tag.localeCompare(b.tag))]);
}
export class CapsuleStudio {
  constructor() {
    this.seq=0;
    this.definitions={};
    this.graphs={};
    this.favorites=[];
    this.rootGraphId=null;
  }
  next(prefix) { this.seq++; return prefix+"_"+this.seq.toString(36); }
  graph(id) { check(own(this.graphs,id),"graph not found: "+id); return this.graphs[id]; }
  instance(graphId,instanceId) {
    const instance=this.graph(graphId).instances.find(i=>i.id===instanceId);
    check(!!instance,"instance not found: "+instanceId);
    return instance;
  }
  createGraph(title="Main",parent=null) {
    label(title,"graph title");
    if (parent) {
      check(object(parent) && own(this.graphs,parent.graphId),"invalid parent");
      const depth=this.path(parent.graphId).length;
      check(depth < 32,"max nesting depth reached");
    } else {
      check(this.rootGraphId===null,"root already exists");
    }
    check(Object.keys(this.graphs).length < 2000,"graph budget exceeded");
    const id=this.next("graph");
    this.graphs[id]={id,title,parent:parent ? copy(parent) : null,instances:[],edges:[],boundary:[]};
    if (!parent) this.rootGraphId=id;
    return id;
  }
  createDefinition({name,language,source,ports=[],description=""}) {
    label(name,"definition name");
    key(language,"language");
    check(typeof source==="string" && source.length<=250000,"source too large");
    check(typeof description==="string" && description.length<=1000,"invalid description");
    const normalized=portsOf(ports);
    const fingerprint=definitionSignature(language,source,normalized);
    for (const d of Object.values(this.definitions)) {
      if (Object.values(d.versions).some(v=>v.fingerprint===fingerprint)) {
        return {id:d.id,version:Number(Object.keys(d.versions).find(v=>d.versions[v].fingerprint===fingerprint)),reused:true};
      }
    }
    check(Object.keys(this.definitions).length < 2000,"definition budget exceeded");
    const id=this.next("def");
    this.definitions[id]={id,name,description,language,versions:{1:{source,ports:normalized,fingerprint}}};
    return {id,version:1,reused:false};
  }
  reviseDefinition(id,{source,ports}) {
    const d=this.definitions[id]; check(!!d,"definition not found");
    check(typeof source==="string" && source.length<=250000,"source too large");
    const normalized=portsOf(ports);
    const fingerprint=definitionSignature(d.language,source,normalized);
    for (const [number,version] of Object.entries(d.versions)) {
      if (version.fingerprint===fingerprint) return Number(number);
    }
    const version=Math.max(...Object.keys(d.versions).map(Number))+1;
    check(version<=1000,"version budget exceeded");
    d.versions[version]={source,ports:normalized,fingerprint};
    return version;
  }
  place(graphId,definitionId,version=1,config={}) {
    const graph=this.graph(graphId), def=this.definitions[definitionId];
    check(!!def && !!def.versions[version],"unknown definition/version");
    check(object(config),"invalid instance config");
    check(JSON.stringify(config).length<=4000,"config too large");
    check(graph.instances.length<5000,"instance budget exceeded");
    const id=this.next("node");
    graph.instances.push({id,kind:"microprogram",definitionId,version,config:copy(config)});
    return id;
  }
  createCapsule(parentGraphId,title) {
    const parent=this.graph(parentGraphId);
    check(parent.instances.length<5000,"instance budget exceeded");
    const id=this.next("capsule");
    const childId=this.createGraph(title,{graphId:parentGraphId,instanceId:id});
    parent.instances.push({id,kind:"capsule",childGraphId:childId,title});
    return {instanceId:id,graphId:childId};
  }
  path(graphId) {
    const path=[], visited=new Set();
    let current=this.graph(graphId);
    while(current) {
      check(!visited.has(current.id),"cyclic graph parent");
      visited.add(current.id); path.unshift({id:current.id,title:current.title});
      current=current.parent ? this.graph(current.parent.graphId) : null;
    }
    return path;
  }
  enter(parentGraphId,capsuleInstanceId) {
    const instance=this.instance(parentGraphId,capsuleInstanceId);
    check(instance.kind==="capsule","not a capsule");
    return instance.childGraphId;
  }
  exit(graphId) { return this.graph(graphId).parent?.graphId ?? null; }
  resolvePorts(graphId,instanceId) {
    const i=this.instance(graphId,instanceId);
    if (i.kind==="microprogram") return this.definitions[i.definitionId].versions[i.version].ports.map(copy);
    const child=this.graph(i.childGraphId);
    return child.boundary.map(b=>({tag:b.tag,side:b.side,direction:b.direction,semantics:b.semantics,dataType:b.dataType}));
  }
  expose(graphId,{side,instanceId,tag,externalTag}) {
    const graph=this.graph(graphId);
    check(!!graph.parent,"root has no parent boundary");
    check(SIDES.includes(side),"invalid side");
    const p=this.resolvePorts(graphId,instanceId).find(p=>p.tag===tag);
    check(!!p,"internal port not found");
    const existing=graph.boundary.find(b=>b.instanceId===instanceId && b.internalTag===tag && b.side===side);
    if (existing) return existing.tag;
    const name=externalTag===undefined ? this.next("port") : key(externalTag,"external port tag");
    check(!graph.boundary.some(b=>b.tag===name),"duplicate boundary tag");
    check(graph.boundary.length<128,"boundary port budget exceeded");
    // Project the identical data contract across the boundary; no data movement here.
    graph.boundary.push({tag:name,side,instanceId,internalTag:tag,direction:p.direction,semantics:p.semantics,dataType:p.dataType});
    return name;
  }
  boundaryCard(graphId,side,visibleLimit=4) {
    check(SIDES.includes(side),"invalid side");
    check(Number.isSafeInteger(visibleLimit) && visibleLimit>=1 && visibleLimit<=128,"invalid visible limit");
    const ports=this.graph(graphId).boundary.filter(p=>p.side===side);
    return {side,returnTo:this.exit(graphId),visible:copy(ports.slice(0,visibleLimit)),hiddenCount:Math.max(0,ports.length-visibleLimit)};
  }
  connect(graphId,{fromId,fromTag,toId,toTag}) {
    const graph=this.graph(graphId);
    const from=this.resolvePorts(graphId,fromId).find(p=>p.tag===fromTag);
    const to=this.resolvePorts(graphId,toId).find(p=>p.tag===toTag);
    check(!!from && !!to,"missing connection endpoint");
    check(from.direction==="output" && to.direction==="input","connection direction mismatch");
    check(from.dataType===to.dataType && from.semantics===to.semantics,"typed connection mismatch");
    check(SEMANTICS.has(from.semantics),"semantic-only edges are not executable wires");
    check(!graph.edges.some(e=>e.fromId===fromId && e.fromTag===fromTag && e.toId===toId && e.toTag===toTag),"duplicate connection");
    check(graph.edges.length<20000,"edge budget exceeded");
    const id=this.next("edge");
    graph.edges.push({id,fromId,fromTag,toId,toTag,semantics:from.semantics,dataType:from.dataType});
    return id;
  }
  unexpose(graphId,tag) {
    const graph=this.graph(graphId);
    const b=graph.boundary.find(p=>p.tag===tag);
    check(!!b,"boundary port not found");
    const parent=graph.parent;
    const used=this.graph(parent.graphId).edges.some(e=>e.fromId===parent.instanceId&&e.fromTag===tag || e.toId===parent.instanceId&&e.toTag===tag);
    check(!used,"port still wired externally; disconnect first");
    graph.boundary=graph.boundary.filter(p=>p.tag!==tag);
  }
  removeInstance(graphId,id) {
    const graph=this.graph(graphId), i=this.instance(graphId,id);
    check(i.kind!=="capsule","capsule removal requires explicit subtree migration");
    const referenced=graph.boundary.some(b=>b.instanceId===id);
    check(!referenced,"instance exposed on parent; unexpose first");
    graph.edges=graph.edges.filter(e=>e.fromId!==id && e.toId!==id);
    graph.instances=graph.instances.filter(x=>x.id!==id);
  }
  favorite(definitionId,value=true) {
    check(!!this.definitions[definitionId],"definition not found");
    this.favorites=this.favorites.filter(id=>id!==definitionId);
    if (value) this.favorites.push(definitionId);
  }
  palette(query="",mode="all") {
    check(typeof query==="string" && query.length<=128,"invalid query");
    check(["all","used","favorites"].includes(mode),"invalid palette mode");
    const count={};
    for (const g of Object.values(this.graphs)) for (const i of g.instances) if(i.kind==="microprogram") count[i.definitionId]=(count[i.definitionId]||0)+1;
    return Object.values(this.definitions).filter(d=>{
      if (mode==="used" && !count[d.id]) return false;
      if (mode==="favorites" && !this.favorites.includes(d.id)) return false;
      return (d.name+" "+d.language+" "+d.description).toLowerCase().includes(query.toLowerCase());
    }).map(d=>({id:d.id,name:d.name,language:d.language,description:d.description,versions:Object.keys(d.versions).map(Number),used:count[d.id]||0,favorite:this.favorites.includes(d.id)}))
      .sort((a,b)=>b.used-a.used || a.name.localeCompare(b.name));
  }
  snapshot() { return copy({format:FORMAT,seq:this.seq,rootGraphId:this.rootGraphId,definitions:this.definitions,graphs:this.graphs,favorites:this.favorites}); }
  static restore(raw) {
    check(object(raw) && raw.format===FORMAT,"unknown studio snapshot format");
    check(Number.isSafeInteger(raw.seq) && raw.seq>=0,"invalid snapshot seq");
    check(object(raw.definitions)&&object(raw.graphs)&&Array.isArray(raw.favorites),"malformed snapshot");
    check(Object.keys(raw.definitions).length<=2000&&Object.keys(raw.graphs).length<=2000,"snapshot budget exceeded");
    const s=new CapsuleStudio(); s.seq=raw.seq; s.rootGraphId=raw.rootGraphId;
    // Rebuild trusted shapes; imported state cannot insert arbitrary object prototypes.
    for(const [id,d] of Object.entries(raw.definitions)) {
      key(id,"definition id"); check(object(d)&&d.id===id,"malformed definition");
      label(d.name,"definition name"); key(d.language,"language");
      check(object(d.versions),"malformed versions");
      const versions={};
      for(const [v,data] of Object.entries(d.versions)) {
        check(/^[1-9][0-9]*$/.test(v) && object(data),"invalid version");
        check(typeof data.source==="string"&&data.source.length<=250000,"invalid source");
        const ports=portsOf(data.ports);
        const fingerprint=definitionSignature(d.language,data.source,ports);
        check(fingerprint===data.fingerprint,"invalid definition fingerprint");
        versions[v]={source:data.source,ports,fingerprint};
      }
      s.definitions[id]={id,name:d.name,description:d.description||"",language:d.language,versions};
    }
    for(const [id,g] of Object.entries(raw.graphs)) {
      key(id,"graph id"); check(object(g)&&g.id===id,"malformed graph");
      label(g.title,"graph title");
      check(Array.isArray(g.instances)&&Array.isArray(g.edges)&&Array.isArray(g.boundary),"malformed graph arrays");
      check(g.instances.length<=5000&&g.edges.length<=20000&&g.boundary.length<=128,"snapshot graph budget exceeded");
      s.graphs[id]={id,title:g.title,parent:g.parent?copy(g.parent):null,instances:[],edges:[],boundary:[]};
    }
    check(!!s.graphs[s.rootGraphId] && s.graphs[s.rootGraphId].parent===null,"invalid root");
    for(const [id,g] of Object.entries(raw.graphs)) {
      const target=s.graph(id);
      const ids=new Set();
      for(const i of g.instances) {
        check(object(i),"invalid instance"); key(i.id,"instance id");
        check(!ids.has(i.id),"duplicate instance"); ids.add(i.id);
        if(i.kind==="microprogram") {
          check(!!s.definitions[i.definitionId]?.versions[i.version],"invalid definition link");
          target.instances.push({id:i.id,kind:"microprogram",definitionId:i.definitionId,version:i.version,config:copy(i.config||{})});
        } else {
          check(i.kind==="capsule" && !!s.graphs[i.childGraphId],"invalid capsule");
          const child=s.graphs[i.childGraphId];
          check(child.parent?.graphId===id&&child.parent?.instanceId===i.id,"invalid capsule parent link");
          target.instances.push({id:i.id,kind:"capsule",childGraphId:i.childGraphId,title:label(i.title,"capsule title")});
        }
      }
    }
    for (const [id,g] of Object.entries(raw.graphs)) {
      const target=s.graph(id), tags=new Set();
      for(const b of g.boundary) {
        check(!!target.parent && SIDES.includes(b.side),"invalid boundary side");
        key(b.tag,"boundary tag"); check(!tags.has(b.tag),"duplicate boundary tag");tags.add(b.tag);
        const p=s.resolvePorts(id,b.instanceId).find(p=>p.tag===b.internalTag);
        check(!!p && p.direction===b.direction && p.dataType===b.dataType && p.semantics===b.semantics,"broken boundary contract");
        target.boundary.push(copy(b));
      }
    }
    for (const [id,g] of Object.entries(raw.graphs)) {
      const target=s.graph(id), edges=new Set();
      for(const e of g.edges) {
        key(e.id,"edge id");check(!edges.has(e.id),"duplicate edge id");edges.add(e.id);
        const f=s.resolvePorts(id,e.fromId).find(p=>p.tag===e.fromTag);
        const t=s.resolvePorts(id,e.toId).find(p=>p.tag===e.toTag);
        check(!!f&&!!t&&f.direction==="output"&&t.direction==="input"&&f.dataType===t.dataType&&f.semantics===t.semantics,"invalid saved edge");
        check(e.semantics===f.semantics&&e.dataType===f.dataType,"invalid saved edge data");
        target.edges.push(copy(e));
      }
      s.path(id);
    }
    s.favorites=raw.favorites.map(id=>{check(!!s.definitions[id],"invalid favorite");return id;});
    return s;
  }
}
