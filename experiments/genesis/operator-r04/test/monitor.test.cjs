'use strict';
const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path'),vm=require('node:vm');
const src=fs.readFileSync(path.join(__dirname,'../monitor/validate-result.function.js'),'utf8');
function monitor(payload){
 const logs=[],states=[];
 const ctx={msg:{payload},node:{warn:s=>logs.push(s),status:s=>states.push(s)},Date,Set,Object,Number,String};
 const out=vm.runInNewContext('(function(){'+src+'\n})()',ctx,{timeout:1500});
 return {out,logs,states};
}
const base=(action,extra={})=>({request_id:'r04-monitor-test',action,status:'passed',finished_at:new Date().toISOString(),...extra});
const summary={schema:'mechanicus.neural-circuit/3',simulation_steps:120,total_spikes:2646,
 genomes_unchanged:true,sensor:{raw_camera_access:false},regions:{LGN:{},V1:{},V2:{}},
 sensory_stream:{accepted:120}};
test('accepts R04 verified synthetic report without leaking whole region records',()=>{
 const x=monitor(base('run-r04-moving',{summary}));
 assert.equal(x.out.payload.healthy,true);assert.equal(x.out.payload.summary.region_count,3);
 assert.equal(x.out.payload.summary.total_spikes,2646);assert.ok(!('regions' in x.out.payload.summary));
 assert.equal(x.states[0].fill,'green');
});
test('preserves R03 and tests R02/R04 compatibility',()=>{
 assert.equal(monitor(base('run-r03-moving',{summary})).out.payload.healthy,true);
 assert.equal(monitor(base('test-r02')).out.payload.healthy,true);
 assert.equal(monitor(base('test-r04')).out.payload.healthy,true);
});
test('rejects unallowlisted action and malformed report',()=>{
 assert.equal(monitor(base('powershell')).out,null);
 assert.equal(monitor([]).out,null);
});
test('red for invalid R04 stream, stale for old but otherwise valid',()=>{
 const wrong=structuredClone(summary);wrong.sensory_stream.accepted=10;
 const x=monitor(base('run-r04-moving',{summary:wrong}));assert.equal(x.out.payload.healthy,false);assert.equal(x.states[0].fill,'red');
 const old=monitor(base('run-r04-moving',{summary,finished_at:'2020-01-01T00:00:00Z'}));
 assert.equal(old.out.payload.stale,true);assert.equal(old.states[0].fill,'yellow');
});
