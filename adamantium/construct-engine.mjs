/**
 * Adamantium Construct R01: editor-only, transactional graph construction.
 * No MAS grants, no execution, no native Node-RED deploy/hot-swap.
 * SPDX-License-Identifier: Apache-2.0
 */
import { CapsuleStudio } from "./capsule-studio.mjs";
import { CapsuleTemplateLibrary } from "./capsule-extract.mjs";

export const CONSTRUCT_FORMAT = "adamantium.construct/1";
const validId = /^[a-z][a-z0-9_.-]{0,95}$/;
const plain = value => value!==null && typeof value==="object" && !Array.isArray(value);
const clone = value => JSON.parse(JSON.stringify(value));
function requireIt(condition,message){ if(!condition) throw new TypeError(message); }
function id(value,label="identifier"){ requireIt(typeof value==="string"&&validId.test(value),"invalid "+label);return value; }
function limited(value,max=128){ requireIt(Array.isArray(value)&&value.length>0&&value.length<=max,"commands must contain 1.."+max+" entries");return value; }

export class ConstructEngine {
  constructor(studio,templates){
    requireIt(studio instanceof CapsuleStudio,"CapsuleStudio is required");
    requireIt(templates instanceof CapsuleTemplateLibrary,"CapsuleTemplateLibrary is required");
    this.studio=studio;
    this.templates=templates;
    this.revision=0;
    this.views={};
    this.forks={};
    this.linked={};
    this.rules={};
    this.processed=[];
  }
  snapshot(){
    return clone({format:CONSTRUCT_FORMAT,revision:this.revision,views:this.views,
      forks:this.forks,linked:this.linked,rules:this.rules,processed:this.processed});
  }
  static restore(studio,templates,raw){
    const engine=new ConstructEngine(studio,templates);
    if(raw===null||raw===undefined)return engine;
    requireIt(plain(raw)&&raw.format===CONSTRUCT_FORMAT,"unknown Construct format");
    requireIt(Number.isSafeInteger(raw.revision)&&raw.revision>=0&&raw.revision<10000000,"invalid Construct revision");
    requireIt(JSON.stringify(raw).length<=1000000,"Construct metadata exceeds size limit");
    for(const key of ["views","forks","linked","rules"])requireIt(plain(raw[key]),"invalid "+key);
    requireIt(Array.isArray(raw.processed)&&raw.processed.length<=1024,"invalid processed events");
    engine.revision=raw.revision;
    for(const [name,view] of Object.entries(raw.views)){
      id(name,"view ID");
      requireIt(plain(view)&&typeof view.graphId==="string"&&typeof view.instanceId==="string","invalid view");
      studio.instance(view.graphId,view.instanceId);
      engine.views[name]={graphId:view.graphId,instanceId:view.instanceId};
    }
    for(const [name,origin] of Object.entries(raw.forks)){
      id(name,"fork definition ID");
      requireIt(!!studio.definitions[name]&&plain(origin)&&typeof origin.definitionId==="string"&&Number.isSafeInteger(origin.version),
        "invalid fork origin");
      engine.forks[name]=clone(origin);
    }
    for(const [name,link] of Object.entries(raw.linked)){
      id(name,"linked assembly graph");
      requireIt(!!studio.graphs[name]&&plain(link)&&!!templates.templates[link.templateId],"invalid linked assembly");
      engine.linked[name]={templateId:link.templateId,version:link.version||1};
    }
    for(const [name,rule] of Object.entries(raw.rules)){
      id(name,"rule ID");
      engine.rules[name]=engine.checkRule(rule);
    }
    const keys=new Set();
    for(const item of raw.processed){
      id(item,"processed event ID");requireIt(!keys.has(item),"duplicate processed event");keys.add(item);
    }
    engine.processed=raw.processed.slice();
    return engine;
  }
  checkRule(rule){
    requireIt(plain(rule),"invalid rule");
    id(rule.id,"rule ID");
    requireIt(typeof rule.eventType==="string"&&/^[a-z][a-z0-9_.:-]{0,95}$/.test(rule.eventType),"invalid event type");
    requireIt(typeof rule.enabled==="boolean","rule enabled must be boolean");
    limited(rule.commands,32);
    const commands=clone(rule.commands);
    requireIt(JSON.stringify(commands).length<=20000,"rule command budget exceeded");
    for(const command of commands)this.checkCommand(command);
    return {id:rule.id,eventType:rule.eventType,enabled:rule.enabled,commands};
  }
  checkCommand(command){
    requireIt(plain(command)&&typeof command.type==="string","invalid construction command");
    requireIt(["place","capsule","template","duplicate","remove","connect","auto_connect",
      "disconnect","alias","unalias"].includes(command.type),"unsupported construction command");
    requireIt(JSON.stringify(command).length<=8000,"construction command too large");
  }
  restoreState(before,meta){
    const safe=CapsuleStudio.restore(before.studio);
    Object.assign(this.studio,safe);
    const safeTemplates=CapsuleTemplateLibrary.restore(before.templates);
    Object.assign(this.templates,safeTemplates);
    this.revision=meta.revision;
    this.views=meta.views;this.forks=meta.forks;this.linked=meta.linked;
    this.rules=meta.rules;this.processed=meta.processed;
  }
  savedState(){
    return {studio:this.studio.snapshot(),templates:this.templates.snapshot()};
  }
  resolve(value,results){
    if(typeof value==="string"&&/^@[0-9]+(?:\.(?:graphId|instanceId|id))?$/.test(value)){
      const match=value.match(/^@([0-9]+)(?:\.(graphId|instanceId|id))?$/);
      const result=results[Number(match[1])];
      const key=match[2]||"instanceId";
      const resolved=result?.[key]||(match[2]?null:result?.id);
      requireIt(typeof resolved==="string","reference to missing command result");
      return resolved;
    }
    return value;
  }
  forkDefinition(definitionId,version){
    const source=this.studio.definitions[definitionId];
    requireIt(!!source&&!!source.versions[version],"definition/version not found");
    requireIt(Object.keys(this.studio.definitions).length<2000,"definition budget exceeded");
    const newId=this.studio.next("def");
    const data=clone(source.versions[version]);
    this.studio.definitions[newId]={id:newId,name:source.name+" (fork)",
      description:source.description,language:source.language,versions:{"1":data}};
    this.forks[newId]={definitionId,version};
    return {definitionId:newId,version:1};
  }
  detachSubtree(graphId){
    const mapping=new Map(),walk=(current,depth)=>{
      requireIt(depth<32,"nested graph too deep");
      for(const instance of this.studio.graph(current).instances){
        if(instance.kind==="capsule"){walk(instance.childGraphId,depth+1);continue;}
        const key=instance.definitionId+"@"+instance.version;
        if(!mapping.has(key))mapping.set(key,this.forkDefinition(instance.definitionId,instance.version));
        const independent=mapping.get(key);
        instance.definitionId=independent.definitionId;instance.version=independent.version;
      }
    };
    walk(graphId,0);
  }
  duplicate(graphId,instanceId,mode="instance"){
    requireIt(["instance","fork","view"].includes(mode),"invalid reuse mode");
    const existing=this.studio.instance(graphId,instanceId);
    if(mode==="view"){
      requireIt(Object.keys(this.views).length<2000,"view budget exceeded");
      const viewId=this.studio.next("view");
      this.views[viewId]={graphId,instanceId};
      return {id:viewId,kind:"view",target:{graphId,instanceId}};
    }
    if(existing.kind==="microprogram"){
      const def=mode==="fork"?this.forkDefinition(existing.definitionId,existing.version):
        {definitionId:existing.definitionId,version:existing.version};
      const id=this.studio.place(graphId,def.definitionId,def.version,existing.config);
      return {instanceId:id,kind:"microprogram",reuse:mode};
    }
    requireIt(existing.kind==="capsule","unknown node kind");
    const title=existing.title;
    const captured=this.templates.capture(this.studio,existing.childGraphId,title);
    const created=this.templates.place(this.studio,graphId,captured.id);
    if(mode==="fork")this.detachSubtree(created.graphId);
    else this.linked[created.graphId]={templateId:captured.id,version:1};
    return {...created,kind:"capsule",reuse:mode};
  }
  command(command,results){
    this.checkCommand(command);
    const value=x=>this.resolve(x,results);
    switch(command.type){
      case "place":{
        const graphId=id(value(command.graphId),"graph ID");
        let definitionId=id(command.definitionId,"definition ID");
        const version=command.version||1;
        requireIt(Number.isSafeInteger(version)&&version>0,"invalid definition version");
        const mode=command.mode||"instance";
        requireIt(["instance","fork"].includes(mode),"invalid placement mode");
        if(mode==="fork"){const d=this.forkDefinition(definitionId,version);definitionId=d.definitionId;
          return {instanceId:this.studio.place(graphId,definitionId,d.version,command.config||{}),kind:"microprogram",reuse:"fork"};}
        return {instanceId:this.studio.place(graphId,definitionId,version,command.config||{}),kind:"microprogram",reuse:"instance"};
      }
      case "capsule":{
        const created=this.studio.createCapsule(id(command.graphId,"graph ID"),command.title||"New Capsule");
        return {...created,kind:"capsule"};
      }
      case "template":{
        const mode=command.mode||"instance";
        requireIt(["instance","fork"].includes(mode),"invalid template placement mode");
        const templateId=id(command.templateId,"template ID");
        const created=this.templates.place(this.studio,id(value(command.graphId),"graph ID"),templateId);
        if(mode==="fork")this.detachSubtree(created.graphId);
        else this.linked[created.graphId]={templateId,version:1};
        return {...created,kind:"capsule",reuse:mode};
      }
      case "duplicate":return this.duplicate(id(command.graphId,"graph ID"),id(value(command.instanceId),"instance ID"),command.mode||"instance");
      case "alias":{
        const graphId=id(command.graphId,"graph ID"),instanceId=id(value(command.instanceId),"instance ID");
        this.studio.instance(graphId,instanceId);
        requireIt(Object.keys(this.views).length<2000,"view budget exceeded");
        const viewId=this.studio.next("view");
        this.views[viewId]={graphId,instanceId};
        return {id:viewId,kind:"view"};
      }
      case "unalias":{
        const viewId=id(value(command.viewId),"view ID");
        requireIt(!!this.views[viewId],"view missing");
        delete this.views[viewId];
        return {id:viewId,removed:true};
      }
      case "remove":{
        const graphId=id(command.graphId,"graph ID"),instanceId=id(value(command.instanceId),"instance ID");
        requireIt(!Object.values(this.views).some(v=>v.graphId===graphId&&v.instanceId===instanceId),
          "instance has linked views; remove aliases first");
        const instance=this.studio.instance(graphId,instanceId);
        requireIt(instance.kind!=="capsule","capsule subtree removal requires separate migration");
        this.studio.removeInstance(graphId,instanceId);
        return {id:instanceId,removed:true};
      }
      case "connect":{
        const graphId=id(command.graphId,"graph ID");
        const idValue=this.studio.connect(graphId,{fromId:value(command.fromId),fromTag:command.fromTag,
          toId:value(command.toId),toTag:command.toTag});
        return {id:idValue,kind:"edge"};
      }
      case "auto_connect":{
        const graphId=id(command.graphId,"graph ID"),fromId=id(value(command.fromId),"from ID"),toId=id(value(command.toId),"to ID");
        requireIt(fromId!==toId,"self auto-wiring is unsupported");
        const outgoing=this.studio.resolvePorts(graphId,fromId).filter(p=>p.direction==="output");
        const incoming=this.studio.resolvePorts(graphId,toId).filter(p=>p.direction==="input");
        const matches=[];
        for(const a of outgoing)for(const b of incoming){
          if(a.dataType===b.dataType&&a.semantics===b.semantics)matches.push([a,b]);
        }
        requireIt(matches.length===1,"auto-connect requires exactly one compatible port pair");
        const [from,to]=matches[0];
        const edge=this.studio.connect(graphId,{fromId,fromTag:from.tag,toId,toTag:to.tag});
        return {id:edge,kind:"edge"};
      }
      case "disconnect":{
        const graph=this.studio.graph(id(command.graphId,"graph ID"));
        const edgeId=id(value(command.edgeId),"edge ID");
        requireIt(graph.edges.some(e=>e.id===edgeId),"edge not found");
        graph.edges=graph.edges.filter(e=>e.id!==edgeId);
        return {id:edgeId,removed:true};
      }
      default:throw new TypeError("unknown command");
    }
  }
  apply(commands,{expectedRevision=this.revision,eventId=null}={}){
    limited(commands);
    requireIt(Number.isSafeInteger(expectedRevision)&&expectedRevision===this.revision,"stale Construct revision");
    if(eventId!==null){
      id(eventId,"event ID");
      if(this.processed.includes(eventId))return {skipped:true,revision:this.revision,results:[]};
    }
    const before=this.savedState(),meta=this.snapshot();
    try {
      const results=[];
      for(const command of commands)results.push(this.command(command,results));
      // Validate all saved graph objects, dependencies and template state.
      CapsuleStudio.restore(this.studio.snapshot());
      CapsuleTemplateLibrary.restore(this.templates.snapshot());
      this.revision++;
      if(eventId!==null)this.processed=[...this.processed.slice(-1023),eventId];
      return {skipped:false,revision:this.revision,results};
    } catch(error){
      this.restoreState(before,meta);
      throw error;
    }
  }
  addRule(rule,{expectedRevision=this.revision}={}){
    requireIt(expectedRevision===this.revision,"stale Construct revision");
    const clean=this.checkRule(rule);
    requireIt(Object.keys(this.rules).length<64||this.rules[clean.id],"rule budget exceeded");
    this.rules[clean.id]=clean;this.revision++;
    return {id:clean.id,revision:this.revision};
  }
  dispatch(event){
    requireIt(plain(event)&&typeof event.id==="string"&&typeof event.type==="string","invalid construction event");
    id(event.id,"event ID");
    requireIt(/^[a-z][a-z0-9_.:-]{0,95}$/.test(event.type),"invalid event type");
    if(this.processed.includes(event.id))return {skipped:true,revision:this.revision,results:[]};
    const matching=Object.values(this.rules).filter(r=>r.enabled&&r.eventType===event.type);
    requireIt(matching.length<=8,"too many rules for one event");
    const commands=matching.flatMap(r=>r.commands).map(command=>{
      const out=clone(command);
      if(out.graphId==="@event.graphId"){
        requireIt(plain(event.context),"event graph context required");
        const graphId=id(event.context.graphId,"event graph");
        this.studio.graph(graphId);
        out.graphId=graphId;
      }
      return out;
    });
    if(commands.length===0)return {skipped:true,revision:this.revision,results:[]};
    return this.apply(limited(commands),{expectedRevision:this.revision,eventId:event.id});
  }
  preview(commands){
    const copiedStudio=CapsuleStudio.restore(this.studio.snapshot());
    const copiedTemplates=CapsuleTemplateLibrary.restore(this.templates.snapshot());
    const copied=ConstructEngine.restore(copiedStudio,copiedTemplates,this.snapshot());
    const result=copied.apply(commands);
    return {result,before:{graphs:Object.keys(this.studio.graphs).length,
      definitions:Object.keys(this.studio.definitions).length},
      after:{graphs:Object.keys(copiedStudio.graphs).length,
      definitions:Object.keys(copiedStudio.definitions).length}};
  }
}
