// R01: deliberately narrow Node-RED compatibility projection, NOT the canonical
// Universal Graph IR. Never accept Function, exec, HTTP, TCP, file or plugins.
import {createHash} from 'node:crypto';

const id = /^[a-z][a-z0-9_]{0,63}$/;
const allowed = new Set(['tab','inject','change','debug']);
const plain = value => value !== null && typeof value === 'object' &&
  !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype;
function requireValue(ok, code) {
  if (!ok) throw Object.assign(new Error(code), {code, status:400});
}
const exact = (obj, keys) => plain(obj) &&
  Object.keys(obj).every(key=>keys.includes(key));
const safeString = value => typeof value === 'string' &&
  value.length <= 256 && !/[\u0000-\u001f]/.test(value);

export function validateSafeFlow(flow) {
  requireValue(Array.isArray(flow) && flow.length===4,'invalid_flow_shape');
  requireValue(JSON.stringify(flow).length <= 16384,'flow_size_limit');
  const nodes = new Map();
  for(const n of flow) {
    requireValue(plain(n)&&id.test(n.id)&&allowed.has(n.type) &&
      !nodes.has(n.id), 'invalid_node_or_duplicate');
    const keys = {
      tab:['id','type','label','disabled','info'],
      inject:['id','type','z','name','props','repeat','crontab','once',
              'onceDelay','topic','payload','payloadType','wires'],
      change:['id','type','z','name','rules','action','property','from','to','reg','wires'],
      debug:['id','type','z','name','active','tosidebar','console',
             'tostatus','complete','targetType','statusVal','statusType','wires']
    };
    requireValue(exact(n,keys[n.type]),'unknown_or_unsafe_node_properties');
    nodes.set(n.id,n);
  }
  const tabs=[...nodes.values()].filter(n=>n.type==='tab');
  const injects=[...nodes.values()].filter(n=>n.type==='inject');
  const changes=[...nodes.values()].filter(n=>n.type==='change');
  const debugs=[...nodes.values()].filter(n=>n.type==='debug');
  requireValue(tabs.length===1&&injects.length===1&&
    changes.length===1&&debugs.length===1,'template_profile_required');
  const [tab]=tabs,[inject]=injects,[change]=changes,[debug]=debugs;
  requireValue(safeString(tab.label)&&tab.disabled===true&&
    (!('info' in tab)||tab.info===''),'tab_not_disabled');
  for(const n of [inject,change,debug])
    requireValue(n.z===tab.id && safeString(n.name),'invalid_tab_binding');
  requireValue(inject.once===false && inject.repeat==='' &&
    inject.crontab==='' && inject.payloadType==='str' &&
    safeString(inject.payload) && inject.topic==='' &&
    Array.isArray(inject.props) && inject.props.length===0,
    'unsafe_inject_behavior');
  requireValue(Array.isArray(change.rules) && change.rules.length===1 &&
    exact(change.rules[0],['t','p','pt','to','tot']) &&
    change.rules[0].t==='set' && change.rules[0].p==='payload' &&
    change.rules[0].pt==='msg' && change.rules[0].tot==='str' &&
    safeString(change.rules[0].to),'unsafe_change_rule');
  requireValue(debug.complete==='payload' && debug.targetType==='msg' &&
    debug.console===false && debug.tostatus===false &&
    debug.tosidebar===true && debug.active===true,
    'unsafe_debug_node');
  requireValue(JSON.stringify(inject.wires)==='[["'+change.id+'"]]' &&
    JSON.stringify(change.wires)==='[["'+debug.id+'"]]' &&
    JSON.stringify(debug.wires)==='[]','unsafe_wiring');
  return {ok:true, nodes:flow.length, edges:2, disabled:true};
}

export function templateFlow(message='hello-from-adamantium', suffix='r01') {
  requireValue(safeString(message)&&id.test('t_'+suffix),'invalid_template_input');
  const tab='t_'+suffix, source='i_'+suffix, transformer='c_'+suffix,
        sink='d_'+suffix;
  const flow=[
    {id:tab,type:'tab',label:'Adamantium R01 sandbox',disabled:true,info:''},
    {id:source,type:'inject',z:tab,name:'safe-source',props:[],
     repeat:'',crontab:'',once:false,onceDelay:0.1,topic:'',
     payload:'start',payloadType:'str',wires:[[transformer]]},
    {id:transformer,type:'change',z:tab,name:'constant-transform',
     rules:[{t:'set',p:'payload',pt:'msg',to:message,tot:'str'}],
     wires:[[sink]]},
    {id:sink,type:'debug',z:tab,name:'safe-observation',active:true,
     tosidebar:true,console:false,tostatus:false,complete:'payload',
     targetType:'msg',statusVal:'',statusType:'auto',wires:[]}
  ];
  validateSafeFlow(flow);
  return flow;
}

export function simulateSafeFlow(flow) {
  validateSafeFlow(flow);
  const msg=flow.find(node=>node.type==='change').rules[0].to;
  return {engine:'adamantium.safe-simulator/1',runtime:'not-node-red',
    outputs:[{port:'debug.payload',value:msg}],events:3,
    executed_external_actions:false};
}
export function clone(value) { return JSON.parse(JSON.stringify(value)); }
export function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}
