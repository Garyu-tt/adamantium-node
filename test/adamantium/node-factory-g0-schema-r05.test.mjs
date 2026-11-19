// SPDX-License-Identifier: Apache-2.0
// Independent JSON Schema 2020-12 validation, canonical ToolBox G0 fixture pinned.
import test from 'node:test';
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createRequire} from 'node:module';
import {factoryToUniversalGraph} from '../../adamantium/node-factory/g0-projection.mjs';
import {demoFactoryContract} from '../../adamantium/node-factory/contract.mjs';
const require=createRequire(import.meta.url);
const Ajv2020=require('ajv/dist/2020.js').default;
const schema=JSON.parse(await readFile(
 new URL('./fixtures/graph-ir-v1.schema.json',import.meta.url),'utf8'));
const compiler=new Ajv2020({strict:false,allErrors:true});
const validate=compiler.compile(schema);
test('R05 typed factory graph conforms to canonical Mechanicus G0 v1 schema',()=>{
 assert.equal(schema.$id,'https://infracare-it.com/standards/universal-graph/graph-ir-v1.schema.json');
 const graph=factoryToUniversalGraph(demoFactoryContract());
 assert.equal(validate(graph),true,JSON.stringify(validate.errors));
 assert.equal(graph.schema,'mechanicus.universal-graph/1');
 assert.equal(graph.domain,'program');
 assert.equal(graph.nodes.length,4);
 assert.equal(graph.edges.length,3);
 const injected=JSON.parse(JSON.stringify(graph));
 injected.authorized=true;
 assert.equal(validate(injected),false,'G0 schema must reject privilege injection');
 const invalidPort=JSON.parse(JSON.stringify(graph));
 invalidPort.nodes[0].ports[0].dataType='not-a-versioned-type';
 assert.equal(validate(invalidPort),false,'G0 data types must be versioned');
});
