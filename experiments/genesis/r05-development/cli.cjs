'use strict';
const {NeuralCircuit}=require('./vendor/r03/lib/circuit.cjs');
const {DevelopmentPlanner}=require('./lib/development-planner.cjs');
function main(){
 if(process.argv.length>3||!['demo',undefined].includes(process.argv[2]))throw Error('supported command: demo');
 const dev=new DevelopmentPlanner(new NeuralCircuit());
 const preview=dev.stage({id:'r05-v1-1024',base:dev.revision,active_v1:1024,genome_hashes:structuredClone(dev.circuit.genomeHashes)});
 const report={schema:'mechanicus.genesis-r05-demo/1',preview,source_genome_unchanged:true,commit:dev.commit(preview.sha256)};
 report.result=dev.circuit.run(120).summary;
 report.status=dev.status();
 process.stdout.write(JSON.stringify(report,null,2)+'\n');
}
try{main()}catch(e){process.stderr.write(String(e.message)+'\n');process.exitCode=1;}
