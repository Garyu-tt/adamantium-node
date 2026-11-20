// GENESIS Operator Monitor R04 — replace ONLY the existing read-only validator body.
// No command dispatch, no direct shell access. Input: parsed local latest.json.
const r=msg.payload;
if(!r||typeof r!=='object'||Array.isArray(r)){
  node.warn('Operator report is not an object');return null;
}
const actions=new Set([
  'test-r02','test-r03','test-r04',
  'run-r03-moving','run-r03-dark','run-r03-bright','run-r03-checkerboard',
  'run-r04-moving','run-r04-dark','run-r04-bright','run-r04-checkerboard',
  'status'
]);
if(!actions.has(r.action)){
  node.warn('Operator action not allowlisted');return null;
}
const requestId=String(r.request_id||r.id||'unknown').slice(0,65);
const finishedAt=r.finished_at||r.at||null;
const ts=finishedAt?Date.parse(finishedAt):NaN;
const stale=!Number.isFinite(ts)||(Date.now()-ts)>600000||(Date.now()-ts)<-120000;
const passed=r.status==='passed'||r.passed===true;
const s=(r.summary&&typeof r.summary==='object'&&!Array.isArray(r.summary))?r.summary:null;
const isCircuit=/^run-r0[34]-/.test(r.action);
let reportConsistent=!isCircuit;
if(isCircuit&&s){
 reportConsistent=s.schema==='mechanicus.neural-circuit/3'&&s.simulation_steps===120&&
  s.genomes_unchanged===true&&s.sensor?.raw_camera_access===false&&
  ['LGN','V1','V2'].every(k=>Object.prototype.hasOwnProperty.call(s.regions||{},k));
 if(r.action.startsWith('run-r04-')){
  reportConsistent=reportConsistent&&s.sensory_stream?.accepted===120;
 }
}
const verifiedStatus=passed&&reportConsistent&&!stale;
const summary=s?{
 schema:s.schema||null,
 simulation_steps:Number.isSafeInteger(s.simulation_steps)?s.simulation_steps:null,
 total_spikes:Number.isSafeInteger(s.total_spikes)?s.total_spikes:null,
 region_count:s.regions&&typeof s.regions==='object'?Object.keys(s.regions).length:null,
 genomes_unchanged:s.genomes_unchanged===true,
 synthetic_frames_accepted:s.sensory_stream?.accepted??null,
 hardware_access_reported:s.sensor?.raw_camera_access===true
}:null;
msg.payload={schema:'mechanicus.genesis-operator-monitor/2',action:r.action,request_id:requestId,
 passed,report_consistent:reportConsistent,stale,healthy:verifiedStatus,
 finished_at:finishedAt,summary,source:'local-operator-report'};
node.status({fill:!passed||!reportConsistent?'red':stale?'yellow':'green',shape:'dot',
 text:!passed?'operator FAIL':!reportConsistent?'inconsistent report':stale?'operator STALE':r.action+' PASS'});
return msg;
