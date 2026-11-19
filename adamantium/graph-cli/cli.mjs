#!/usr/bin/env node
// Single-command R01 acceptance on an isolated draft store (no deployment).
import {AgentGraphService} from '../agent-gateway/service.mjs';
import {templateFlow} from '../graph-schema/safe-flow.mjs';

export function runDemo(command='собери безопасный тестовый граф') {
  if(typeof command!=='string' ||
    !/^(собери|создай) безопасный тестовый граф$/iu.test(command.trim()))
    throw Error('unsupported_agent_command');
  const agent=new AgentGraphService();
  const before=agent.dispatch({op:'graph.inspect'});
  const graph=templateFlow('agent-graph-r01-validated');
  const patch=agent.dispatch({op:'graph.patch',graph,base_revision:0,
    idempotency_key:'r01_demo_create'});
  const validation=agent.dispatch({op:'graph.validate'});
  const testing=agent.dispatch({op:'graph.test',base_revision:1});
  const explain=agent.dispatch({op:'graph.explain'});
  const preview=agent.dispatch({op:'graph.inspect'});
  const rollback=agent.dispatch({op:'graph.rollback',target_revision:0,
    base_revision:1,idempotency_key:'r01_demo_rollback'});
  const after=agent.dispatch({op:'graph.inspect'});
  if(!validation.ok || testing.result.outputs[0].value!==
    'agent-graph-r01-validated' ||
    preview.graph.length!==4 || after.graph!==null ||
    explain.can_deploy!==false)
    throw Error('demo_acceptance_failed');
  return {scenario:'agent_command_to_draft_graph_to_test_to_rollback',
    command,proof_kind:'deterministic_simulation_not_node_red_execution',
    before,patch,validation,testing,preview,rollback,after,
    result:'passed',live_node_red_changes:0};
}
if(process.argv[1] && import.meta.url===new URL(
  'file://'+process.argv[1].replaceAll('\\','/')).href){
  try {
    const command=process.argv.slice(2).join(' ')||
      'собери безопасный тестовый граф';
    process.stdout.write(JSON.stringify(runDemo(command),null,2)+'\n');
  }catch(e) {
    process.stderr.write((e?.message||'demo_failed')+'\n');
    process.exitCode=2;
  }
}
