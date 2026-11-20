'use strict';

/**
 * GENESIS Neural Region Designer R01.
 * Pure model functions. No Node-RED, browser, simulation or network dependency.
 * Config describes a genome-backed structure, NOT a million allocated cells.
 */
const SCHEMA = 'mechanicus.neural-region/1';
const HQ500M_VIRTUAL_ADDRESS_CAP = 500_000_000;
const PROFILES = Object.freeze(['biological-spiking', 'rate-based', 'ann', 'hybrid', 'custom']);
const PROJECTION_MODES = Object.freeze(['exact','probabilistic','spatial','topographic','genetic','learned','manual','import']);
const QUANTITY_KINDS = Object.freeze(['synaptic_contacts','unique_neuron_pairs','axons']);
const MAX_SAFE_ITEMS = 100_000;

const parameterDescriptors = Object.freeze([
  {path:'neurons.total', type:'integer', unit:'neurons', min:0, max:HQ500M_VIRTUAL_ADDRESS_CAP, genome:true, origin:'experimental'},
  {path:'geometry.volume_mm3', type:'number', unit:'mm^3', min:0, genome:true, origin:'reference-or-experimental'},
  {path:'geometry.thickness_um', type:'number', unit:'um', min:0, genome:true, origin:'reference-or-experimental'},
  {path:'layers[].share', type:'number', unit:'%', min:0, max:100, genome:true, origin:'experimental'},
  {path:'layers[].density_per_mm3', type:'number', unit:'neurons/mm^3', min:0, genome:true, origin:'reference-or-experimental'},
  {path:'populations[].inhibitory_share', type:'number', unit:'fraction', min:0, max:1, genome:true, origin:'reference-or-experimental'},
  {path:'projections[].rule.probability', type:'number', unit:'fraction', min:0, max:1, genome:true, origin:'experimental'},
  {path:'projections[].rule.delay_ms', type:'number', unit:'ms', min:0, genome:true, origin:'reference-or-experimental'},
  {path:'receptors[].density_per_um2', type:'number', unit:'receptors/um^2', min:0, genome:true, origin:'reference-or-experimental'},
  {path:'development.neurogenesis.rate_per_day', type:'number', unit:'neurons/day', min:0, genome:true, origin:'experimental'},
  {path:'runtime.active_budget', type:'integer', unit:'active neuron states', min:0, max:HQ500M_VIRTUAL_ADDRESS_CAP, genome:false, origin:'execution'},
  {path:'runtime.bytes_per_neuron', type:'integer', unit:'bytes/neuron', min:1, genome:false, origin:'estimate'},
  {path:'runtime.bytes_per_synapse', type:'integer', unit:'bytes/synapse', min:1, genome:false, origin:'estimate'}
]);

function defaultRegion(){
  return {
    schema:SCHEMA,
    id:'dante.visual.v1.left',
    identity:{name:'Experimental V1 region',profile:'biological-spiking',atlas_ref:null,classification:'experimental'},
    geometry:{kind:'cortical-sheet',volume_mm3:null,thickness_um:null,hemisphere:'left'},
    neurons:{total:1_000_000,allocation:'percentages'},
    layers:[
      {id:'L1',name:'I',share:3,populations:[]},
      {id:'L2',name:'II',share:14,populations:[]},
      {id:'L3',name:'III',share:24,populations:[]},
      {id:'L4',name:'IV',share:31,populations:[{id:'L4.E',kind:'excitatory',share:0.8,cell_model:'AdEx',receptors:[{type:'AMPA',compartment:'dendrite'},{type:'NMDA',compartment:'dendrite'}]}]},
      {id:'L5',name:'V',share:18,populations:[]},
      {id:'L6',name:'VI',share:10,populations:[]}
    ],
    projections:[
      {id:'L4-E-to-L23',source:'L4.E',target:'L2/L3.E',rule:{mode:'probabilistic',probability:0.02,seed:42},quantity:{kind:'synaptic_contacts'},synapse_model:'chemical'}
    ],
    chemistry:{mediator_catalog:['glutamate','GABA','dopamine','serotonin','acetylcholine'],custom_receptors:[]},
    development:{neurogenesis:{enabled:false,rate_per_day:0},structural_plasticity:{enabled:true}},
    genome:{source:{id:'genesis.dante.v1',revision:1},acquired:[],mutation_bounds:{},epigenetics:[]},
    runtime:{mode:'design-only',backend:'auto',active_budget:896,virtual_address_limit:HQ500M_VIRTUAL_ADDRESS_CAP,bytes_per_neuron:64,bytes_per_synapse:24},
    provenance:{classification:'experimental',measured:false,source_refs:[],seed:42},
    extensions:{}
  };
}

function jsonCopy(value){return JSON.parse(JSON.stringify(value));}
function isObj(v){return v!==null && typeof v==='object' && !Array.isArray(v);}
function validNumber(v,min=0,max=Number.MAX_SAFE_INTEGER){return typeof v==='number'&&Number.isFinite(v)&&v>=min&&v<=max;}
function validInteger(v,min=0,max=Number.MAX_SAFE_INTEGER){return Number.isSafeInteger(v)&&v>=min&&v<=max;}

/** Integer apportionment by largest remainder; exact sum, reproducible ties. */
function apportion(total,weights){
  if(!validInteger(total))throw new TypeError('total must be a nonnegative safe integer');
  if(!Array.isArray(weights)||weights.length===0)return [];
  if(weights.length>MAX_SAFE_ITEMS||weights.some(v=>!validNumber(v)))throw new TypeError('invalid weights');
  const weightSum=weights.reduce((a,b)=>a+b,0);
  if(!(weightSum>0)){
    if(total===0)return weights.map(()=>0);
    throw new RangeError('cannot allocate a positive total with zero weights');
  }
  const ideals=weights.map(w=>total*w/weightSum);
  const counts=ideals.map(v=>Math.floor(v));
  let rest=total-counts.reduce((a,b)=>a+b,0);
  if(rest<0||rest>weights.length)throw new RangeError('numerical allocation error');
  const order=ideals.map((v,i)=>({i,r:v-counts[i]})).sort((a,b)=>b.r-a.r||a.i-b.i);
  for(let i=0;i<rest;i++)counts[order[i].i]++;
  return counts;
}

/** Normalize percentages with 0.01% resolution after editing one layer. */
function redistributeShares(layers,index,percent){
  if(!Array.isArray(layers)||layers.length<1||!validInteger(index,0,layers.length-1)||!validNumber(percent,0,100))throw new TypeError('invalid layer adjustment');
  const amounts=layers.map(x=>Math.round(Number(x.share||0)*100));
  if(amounts.some(n=>!validInteger(n,0,10000)))throw new TypeError('invalid layer share');
  const newUnits=Math.round(percent*100);
  if(layers.length===1)return [{...layers[0],share:100}];
  const otherIndices=layers.map((_,i)=>i).filter(i=>i!==index);
  const weights=otherIndices.map(i=>amounts[i]);
  if(weights.every(w=>w===0))weights.fill(1);
  const allocated=apportion(10000-newUnits,weights);
  return layers.map((layer,i)=>({...layer,share:i===index?newUnits/100:allocated[otherIndices.indexOf(i)]/100}));
}

function allocateLayers(region){
  if(!isObj(region)||!Array.isArray(region.layers)||!isObj(region.neurons))throw new TypeError('region or layers missing');
  const ls=region.layers;
  if(ls.length>MAX_SAFE_ITEMS)throw new RangeError('too many layers');
  const mode=region.neurons.allocation||'percentages';
  if(!['percentages','absolute','density'].includes(mode))throw new TypeError('unsupported allocation mode');
  let weights, total;
  if(mode==='percentages'){
    total=region.neurons.total;
    weights=ls.map(l=>l.share);
    if(!validInteger(total,0,HQ500M_VIRTUAL_ADDRESS_CAP)||weights.some(v=>!validNumber(v,0,100)))throw new TypeError('invalid percentage allocation');
    const s=weights.reduce((a,b)=>a+b,0);
    if(Math.abs(s-100)>0.00001)throw new RangeError('layer percentages must sum to 100%');
  }else if(mode==='absolute'){
    weights=ls.map(l=>l.count);
    if(weights.some(v=>!validInteger(v)))throw new TypeError('absolute counts must be nonnegative integers');
    total=weights.reduce((a,b)=>a+b,0);
  }else{
    weights=ls.map(l=>{
      const volume=l.volume_mm3??(validNumber(region.geometry?.volume_mm3)?region.geometry.volume_mm3*(l.share||0)/100:NaN);
      const density=l.density_per_mm3;
      if(!validNumber(volume)||!validNumber(density))throw new TypeError('density requires volumes and densities');
      return volume*density;
    });
    if(weights.some(x=>!Number.isFinite(x)))throw new RangeError('unrepresentable density');
    total=Math.round(weights.reduce((a,b)=>a+b,0));
  }
  if(!validInteger(total,0,HQ500M_VIRTUAL_ADDRESS_CAP))throw new RangeError('neuron address cap exceeded');
  const counts=mode==='absolute'?weights:apportion(total,weights);
  return {total,mode,layers:ls.map((l,i)=>({id:l.id,name:l.name||l.id,neurons:counts[i],share:total?100*counts[i]/total:0}))};
}

/** Explicit validation: unknown biology is never replaced with invented data. */
function validateRegion(region){
  const errors=[],warnings=[];
  const error=(path,message)=>errors.push({path,message});
  const warning=(path,message)=>warnings.push({path,message});
  if(!isObj(region))return {ok:false,errors:[{path:'$',message:'region must be an object'}],warnings};
  if(region.schema!==SCHEMA)error('schema','schema must be '+SCHEMA);
  if(typeof region.id!=='string'||!region.id.trim())error('id','stable region id required');
  if(!PROFILES.includes(region.identity?.profile))error('identity.profile','unknown region computation profile');
  if(!isObj(region.neurons)||!validInteger(region.neurons.total,0,HQ500M_VIRTUAL_ADDRESS_CAP))error('neurons.total','must be integer in 0..500000000');
  if(!isObj(region.runtime)||region.runtime.mode!=='design-only')warning('runtime.mode','this package does not execute a biological simulation');
  if(region.runtime?.virtual_address_limit!==undefined && !validInteger(region.runtime.virtual_address_limit,0,HQ500M_VIRTUAL_ADDRESS_CAP))error('runtime.virtual_address_limit','outside HQ500M address cap');
  if(region.runtime?.active_budget!==undefined && !validInteger(region.runtime.active_budget,0,HQ500M_VIRTUAL_ADDRESS_CAP))error('runtime.active_budget','invalid active budget');
  if(!Array.isArray(region.layers))error('layers','layers must be an array');
  else{
    const seen=new WeakSet(),queue=[{arr:region.layers,path:'layers'}];let processed=0;
    while(queue.length){
      const {arr,path}=queue.pop();
      if(seen.has(arr)){error(path,'cyclic or reused layer container');continue;}
      seen.add(arr);
      if((processed+=arr.length)>MAX_SAFE_ITEMS){error(path,'validation item budget exceeded');break;}
      const localIds=new Set();
      for(let i=0;i<arr.length;i++){
        const l=arr[i],p=path+'['+i+']';
        if(!isObj(l)){error(p,'layer or module must be object');continue;}
        if(typeof l.id!=='string'||!l.id.trim())error(p+'.id','layer id required');
        else if(localIds.has(l.id))error(p+'.id','duplicate layer id');
        else localIds.add(l.id);
        if(region.neurons?.allocation==='percentages' && !validNumber(l.share,0,100))error(p+'.share','percentage outside 0..100');
        if(l.count!==undefined && !validInteger(l.count))error(p+'.count','must be nonnegative integer');
        if(l.populations!==undefined){
          if(!Array.isArray(l.populations))error(p+'.populations','must be an array');
          else for(let j=0;j<l.populations.length;j++){
            const pop=l.populations[j],pp=p+'.populations['+j+']';
            if(!isObj(pop)||typeof pop.id!=='string')error(pp,'population must have an id');
            if(pop?.share!==undefined && !validNumber(pop.share,0,1))error(pp+'.share','population share outside 0..1');
            if(pop?.receptors!==undefined && !Array.isArray(pop.receptors))error(pp+'.receptors','receptors must be array');
          }
        }
        if(l.sublayers!==undefined){
          if(!Array.isArray(l.sublayers))error(p+'.sublayers','must be an array');
          else queue.push({arr:l.sublayers,path:p+'.sublayers'});
        }
      }
      if(arr.length && arr.every(x=>validNumber(x?.share,0,100))){
        const sum=arr.reduce((s,l)=>s+l.share,0);
        if(Math.abs(sum-100)>0.00001)error(path+'.share','sibling shares must sum to 100% (got '+sum+')');
      }
    }
    if(region.neurons?.allocation==='absolute'||region.neurons?.allocation==='density'){
      try{const allocated=allocateLayers(region);if(allocated.total!==region.neurons.total)warning('neurons.total','computed allocation total differs: '+allocated.total);}
      catch(e){error('neurons.allocation',e.message);}
    }
  }
  if(!Array.isArray(region.projections))error('projections','must be an array');
  else if(region.projections.length>MAX_SAFE_ITEMS)error('projections','too many projections');
  else region.projections.forEach((p,i)=>{
    const path='projections['+i+']';
    if(!isObj(p)||typeof p.source!=='string'||typeof p.target!=='string')return error(path,'source and target required');
    if(!PROJECTION_MODES.includes(p.rule?.mode))error(path+'.rule.mode','unsupported connectivity mode');
    if(p.rule?.mode==='probabilistic' && !validNumber(p.rule.probability,0,1))error(path+'.rule.probability','must be in 0..1');
    if(p.rule?.seed!==undefined && !validInteger(p.rule.seed))error(path+'.rule.seed','must be a nonnegative integer');
    if(p.quantity?.kind!==undefined && !QUANTITY_KINDS.includes(p.quantity.kind))error(path+'.quantity.kind','unknown quantity: distinguish axons/pairs/contacts');
    if(p.rule?.mode==='exact' && (!p.quantity||!validInteger(p.quantity.value)||!QUANTITY_KINDS.includes(p.quantity.kind)))error(path+'.quantity','exact mode requires quantity.kind and integer quantity.value');
  });
  if(region.identity?.classification==='biological-reference' && region.development?.neurogenesis?.enabled)warning('development.neurogenesis','neurogenesis should be grounded in the selected atlas evidence');
  if(region.provenance?.measured===true && (!Array.isArray(region.provenance.source_refs)||region.provenance.source_refs.length===0))warning('provenance','measured data requires source references');
  return {ok:errors.length===0,errors,warnings};
}

function estimateResources(region){
  const model=validateRegion(region);
  if(!model.ok)return {ok:false,errors:model.errors};
  const total=region.neurons.total;
  const fullPerNeuron=region.runtime.bytes_per_neuron??64;
  const perSynapse=region.runtime.bytes_per_synapse??24;
  if(!validInteger(fullPerNeuron,1)||!validInteger(perSynapse,1))return {ok:false,errors:[{path:'runtime',message:'invalid cost assumptions'}]};
  const active=Math.min(total,region.runtime.active_budget??total);
  const contacts=region.projections.reduce((s,p)=>s+(p.quantity?.kind==='synaptic_contacts'&&validInteger(p.quantity.value)?p.quantity.value:0),0);
  return {
    ok:true,virtual_addresses:total,active_states:active,
    estimated_active_neuron_bytes:active*fullPerNeuron,
    estimated_full_neuron_bytes:total*fullPerNeuron,
    estimated_known_synapse_bytes:contacts*perSynapse,
    unknown_projection_costs:region.projections.filter(p=>p.quantity?.kind!=='synaptic_contacts'||!validInteger(p.quantity?.value)).length,
    caveat:'Lower-bound assumptions only; morphology, chemistry, runtime overhead, traffic and plasticity are not measured.'
  };
}


/**
 * Lossless typed export of region structure to a graph-editor-independent IR.
 * This is the GENESIS R01 profile of mechanicus.universal-graph/1,
 * not a claim of full compliance with other MAS Graph Manager wire contracts.
 */
function toUniversalGraphIR(region){
  const validation=validateRegion(region);
  if(!validation.ok)throw new TypeError('invalid region: '+validation.errors.map(x=>x.path).join(','));
  const r=jsonCopy(region),{layers,projections,...regionProperties}=r;
  const rootId='region:'+r.id;
  const nodes=[{id:rootId,kind:'neural.region',properties:regionProperties}],edges=[];
  const queue=layers.map((layer,index)=>({layer,parentId:rootId,index,path:String(index)}));
  while(queue.length){
    const {layer,parentId,index,path}=queue.shift();
    const key=rootId+'/layer/'+path;
    const {sublayers,populations,...props}=layer;
    nodes.push({id:key,kind:'neural.layer',properties:props,container_flags:{populations:Array.isArray(populations),sublayers:Array.isArray(sublayers)}});
    edges.push({id:'contains:'+key,kind:'contains',source:parentId,target:key,order:index});
    (populations||[]).forEach((pop,j)=>{
      const pid=key+'/population/'+j;
      nodes.push({id:pid,kind:'neural.population',properties:jsonCopy(pop)});
      edges.push({id:'contains:'+pid,kind:'contains',source:key,target:pid,order:j});
    });
    (sublayers||[]).forEach((child,j)=>queue.push({layer:child,parentId:key,index:j,path:path+'/'+j}));
  }
  projections.forEach((p,i)=>edges.push({id:rootId+'/projection/'+i,kind:'neural.projection',source:p.source,target:p.target,properties:jsonCopy(p),order:i}));
  return {schema:'mechanicus.universal-graph/1',profile:'genesis.neural-region/1',graph_id:rootId,nodes,edges};
}

function fromUniversalGraphIR(graph){
  if(!isObj(graph)||graph.schema!=='mechanicus.universal-graph/1'||graph.profile!=='genesis.neural-region/1'||!Array.isArray(graph.nodes)||!Array.isArray(graph.edges))throw new TypeError('unknown graph IR');
  if(graph.nodes.length>MAX_SAFE_ITEMS*3||graph.edges.length>MAX_SAFE_ITEMS*4)throw new RangeError('graph exceeds R01 safety budget');
  const root=graph.nodes.filter(n=>n.kind==='neural.region');
  if(root.length!==1)throw new TypeError('one region root required');
  const rootId=root[0].id,nodes=new Map();
  for(const n of graph.nodes){if(nodes.has(n.id))throw new TypeError('duplicate graph node id');nodes.set(n.id,n);}
  const children=new Map();
  for(const e of graph.edges){
    if(e.kind!=='contains')continue;
    if(!nodes.has(e.source)||!nodes.has(e.target))throw new TypeError('dangling containment edge');
    if(!children.has(e.source))children.set(e.source,[]);
    children.get(e.source).push(e);
  }
  const result={...jsonCopy(root[0].properties),layers:[],projections:[]};
  const queue=[{id:rootId,layerArray:result.layers,popArray:null}];
  const seen=new Set([rootId]);
  while(queue.length){
    const task=queue.shift();
    const next=(children.get(task.id)||[]).slice().sort((a,b)=>a.order-b.order);
    for(const e of next){
      if(seen.has(e.target))throw new TypeError('cyclic or multiply parented hierarchy');
      seen.add(e.target);
      const n=nodes.get(e.target);
      if(n.kind==='neural.layer'){
        if(!task.layerArray)throw new TypeError('layer nested under non-layer node');
        const l={...jsonCopy(n.properties)};
        if(n.container_flags?.populations)l.populations=[];
        if(n.container_flags?.sublayers)l.sublayers=[];
        if((children.get(n.id)||[]).some(x=>nodes.get(x.target).kind==='neural.layer') && !l.sublayers)l.sublayers=[];
        if((children.get(n.id)||[]).some(x=>nodes.get(x.target).kind==='neural.population') && !l.populations)l.populations=[];
        task.layerArray.push(l);
        queue.push({id:n.id,layerArray:l.sublayers||null,popArray:l.populations||null});
      }else if(n.kind==='neural.population'){
        if(!task.popArray)throw new TypeError('population without parent layer');
        task.popArray.push(jsonCopy(n.properties));
      }else throw new TypeError('unsupported hierarchy node kind');
    }
  }
  result.projections=graph.edges.filter(e=>e.kind==='neural.projection').slice().sort((a,b)=>a.order-b.order).map(e=>jsonCopy(e.properties));
  const v=validateRegion(result);
  if(!v.ok)throw new TypeError('reconstructed region invalid: '+v.errors.map(x=>x.path).join(','));
  return result;
}

const formatManifest={
  schema:SCHEMA,profiles:PROFILES,connectivity:PROJECTION_MODES,quantities:QUANTITY_KINDS,
  descriptors:parameterDescriptors,
  extension_contract:'mechanicus.neural-region-field-plugin/1',
  portability:{graph_ir:'mechanicus.universal-graph/1',neuroml2:'planned',sonata:'planned'}
};
module.exports={SCHEMA,HQ500M_VIRTUAL_ADDRESS_CAP,PROFILES,PROJECTION_MODES,QUANTITY_KINDS,parameterDescriptors,formatManifest,defaultRegion,jsonCopy,apportion,redistributeShares,allocateLayers,validateRegion,estimateResources,toUniversalGraphIR,fromUniversalGraphIR};
