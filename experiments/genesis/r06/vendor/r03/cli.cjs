#!/usr/bin/env node
'use strict';
const fs=require('node:fs');
const path=require('node:path');
const {NeuralCircuit}=require('./lib/circuit.cjs');
const usage='node cli.cjs demo --steps 120 --seed 42 --pattern moving-bar --out out/summary.json --trace-out out/telemetry.jsonl --checkpoint-out out/checkpoint.json';
function fail(msg){console.error('GENESIS R03:',msg);console.error(usage);process.exitCode=1;}
function writeNew(p,body){if(!p)return;fs.mkdirSync(path.dirname(path.resolve(p)),{recursive:true});fs.writeFileSync(p,body,{encoding:'utf8',flag:'wx'});}
function main(){
 const argv=process.argv.slice(2);if(argv.shift()!=='demo')throw Error('only demo subcommand allowed');
 const opts={};for(let i=0;i<argv.length;i+=2){const k=argv[i],v=argv[i+1];if(!k||!k.startsWith('--')||!v)throw Error('invalid flags');if(!['--steps','--seed','--pattern','--out','--trace-out','--checkpoint-out','--resume'].includes(k)||opts[k]!==undefined)throw Error('unknown/duplicate flag '+k);opts[k]=v;}
 const steps=opts['--steps']===undefined?120:Number(opts['--steps']);
 const seed=opts['--seed']===undefined?42:Number(opts['--seed']);
 const pattern=opts['--pattern']||'moving-bar';
 if(!Number.isSafeInteger(steps)||steps<0||steps>2000)throw Error('invalid --steps budget');
 for(const k of ['--out','--trace-out','--checkpoint-out'])if(opts[k]&&fs.existsSync(opts[k]))throw Error('output exists; refusing overwrite: '+opts[k]);
 const c=new NeuralCircuit({seed,pattern});
 if(opts['--resume'])c.restore(JSON.parse(fs.readFileSync(opts['--resume'],'utf8')));
 const r=c.run(steps,{collectEvery:1});
 const summary=JSON.stringify(r.summary,null,2)+'\n';
 writeNew(opts['--out'],summary);writeNew(opts['--trace-out'],r.telemetry.map(t=>JSON.stringify(t)).join('\n')+'\n');
 writeNew(opts['--checkpoint-out'],JSON.stringify(c.checkpoint())+'\n');
 console.log(JSON.stringify({ok:true,summary:r.summary,trace_count:r.telemetry.length}));
}
try{main()}catch(e){fail(e.message)}
