#!/usr/bin/env node
'use strict';
const fs=require('node:fs'),path=require('node:path');
const {LiveSessionGrowth}=require('./lib/session-growth.cjs');
const {patternFrame}=require('./vendor/r03/lib/circuit.cjs');
function parse(){
 const args=process.argv.slice(2);
 if(args[0]!=='demo'||args.some((a,i)=>i>0&&!['--out'].includes(a)&&args[i-1]!=='--out'))throw Error('usage: node cli.cjs demo [--out DIRECTORY]');
 const pos=args.indexOf('--out');
 if(pos>=0&&(pos!==1||!args[pos+1]||args.length!==3))throw Error('invalid --out argument');
 return {out:pos<0?null:path.resolve(args[pos+1])};
}
function main(){
 const {out}=parse();const session=new LiveSessionGrowth();session.session.runSynthetic(120);
 const before=session.session.circuit.checkpoint().sha256;
 for(let i=0;i<3;i++)session.session.enqueue(session.session.frame(patternFrame('checkerboard',120+i)));
 const preview=session.stage({id:'r06-v1-1024',base:session.growth.revision,active_v1:1024,genome_hashes:structuredClone(session.session.circuit.genomeHashes)});
 const commit=session.commit(preview.sha256);
 const snap=session.snapshot(),replica=LiveSessionGrowth.resume(snap);
 for(let i=0;i<3;i++){
  const original=session.session.step(),clone=replica.session.step();
  if(JSON.stringify(original)!==JSON.stringify(clone))throw Error('queued sensory replay diverged');
 }
 const a=session.session.runSynthetic(12),b=replica.session.runSynthetic(12);
 if(JSON.stringify(a.traces)!==JSON.stringify(b.traces)||session.session.circuit.checkpoint().sha256!==replica.session.circuit.checkpoint().sha256)throw Error('migrated dynamic replay diverged');
 const report={schema:'mechanicus.genesis-r06-demo/1',source_tick:preview.source_tick,source_checkpoint_sha256:before,
  plan_sha256:preview.sha256,active_before:896,active_after:commit.active_v1,
  old_synapses_preserved:preview.actual_union.old_synapses_retained,new_synapses:preview.actual_union.new_synapses,
  dropped_synapses:preview.actual_union.removed_synapses,old_delayed_events_migrated:preview.actual_union.old_pending_events,
  learned_synapses_at_risk_in_naive_recompile:preview.source_acquired.changed_synapses_at_risk,
  acquired_weights_preserved:commit.all_acquired_weights_preserved,queued_sensory_frames_preserved:commit.sensory_queue_preserved,
  snapshots_replay_equal:true,postgrowth_steps:15,postgrowth_total_spikes:a.summary.total_spikes,
  genome_unchanged:a.summary.genomes_unchanged,sensor_hardware_access:a.summary.sensor.raw_camera_access,
  claim:'bounded CPU-only in-process append-only simulation; no real biological neurogenesis or distributed live swap'};
 if(out){
  if(fs.existsSync(out))throw Error('refusing overwrite: output directory already exists');
  fs.mkdirSync(out,{recursive:false,mode:0o700});
  fs.writeFileSync(path.join(out,'growth-evidence.json'),JSON.stringify(report,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
  fs.writeFileSync(path.join(out,'growth-checkpoint.json'),JSON.stringify(snap,null,2)+'\n',{encoding:'utf8',flag:'wx',mode:0o600});
 }
 console.log(JSON.stringify(report,null,2));
}
try{main()}catch(e){console.error('GENESIS R06: '+e.message);process.exitCode=1}
