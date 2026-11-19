// SPDX-License-Identifier: Apache-2.0
// Source generator, never arbitrary supplied JS/HTML or npm lifecycle hooks.
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {validateFactoryContract} from './contract.mjs';

const sha256=text=>'sha256:'+createHash('sha256').update(text).digest('hex');
const nl='\n';
function source(contract){
  const type='adamantium-'+contract.id;
  const operation=contract.transform==='uppercase'?
    'msg.payload = msg.payload.toUpperCase();':
    'msg.payload += '+JSON.stringify(contract.suffix)+';';
  return [
    "'use strict';",
    "module.exports = function(RED) {",
    "  function GeneratedNode(config) {",
    "    RED.nodes.createNode(this, config);",
    "    const node = this;",
    "    node.on('input', function(msg, send, done) {",
    "      const emit = send || node.send.bind(node);",
    "      const finish = done || function(err) { if(err) node.error(err, msg); };",
    "      if (!msg || typeof msg.payload !== 'string') {",
    "        finish(new TypeError('payload_must_be_string'));",
    "        return;",
    "      }",
    "      "+operation,
    "      emit(msg);",
    "      finish();",
    "    });",
    "  }",
    "  RED.nodes.registerType("+JSON.stringify(type)+", GeneratedNode);",
    "};",
    ""
  ].join(nl);
}
function editor(contract){
  const type='adamantium-'+contract.id;
  return [
    '<script type="text/javascript">',
    'RED.nodes.registerType('+JSON.stringify(type)+',{',
    '  category:"function", defaults:{name:{value:""}},',
    '  inputs:1,outputs:1,',
    '  label:function(){return this.name||'+JSON.stringify(contract.label)+';}',
    '});',
    '</script>',
    '<script type="text/html" data-template-name="'+type+'">',
    '<div class="form-row"><label for="node-input-name">Name</label>',
    '<input type="text" id="node-input-name" placeholder="Name"></div>',
    '</script>',
    '<script type="text/html" data-help-name="'+type+'">',
    '<p>Contract-generated string transform. No network, filesystem or shell access.</p>',
    '</script>',
    ''
  ].join(nl);
}
export function renderNodePackage(input){
  const c=validateFactoryContract(input);
  const name='node-red-contrib-adamantium-'+c.id;
  const type='adamantium-'+c.id;
  const packageJSON={
    name,version:'0.1.0',description:'Safe generated Adamantium Node-RED factory node',
    private:true,license:'Apache-2.0',
    engines:{node:'>=22.9'},
    keywords:['node-red','adamantium','generated'],
    'node-red':{nodes:{[type]:'nodes/'+c.id+'.js'}},
    files:['nodes/'],
  };
  const files={
    'package.json':JSON.stringify(packageJSON,null,2)+nl,
    ['nodes/'+c.id+'.js']:source(c),
    ['nodes/'+c.id+'.html']:editor(c)
  };
  return {
    packageName:name,nodeType:type,contract:c,files,
    sha256:Object.fromEntries(Object.entries(files).map(([p,body])=>[p,sha256(body)])),
    publishAllowed:false,installIntoProductionAllowed:false
  };
}
export async function generateNodePackage(input,parent){
  const rendered=renderNodePackage(input);
  if(typeof parent!=='string'||parent.length===0)
    throw new TypeError('explicit_output_parent_required');
  const destination=resolve(parent,rendered.packageName);
  // Exclusive creation: never replace another build or existing palette.
  await mkdir(destination,{recursive:false});
  await mkdir(join(destination,'nodes'));
  for(const [path,body] of Object.entries(rendered.files))
    await writeFile(join(destination,path),body,{flag:'wx',encoding:'utf8',mode:0o644});
  return {destination,...rendered};
}
