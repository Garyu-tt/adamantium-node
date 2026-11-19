// SPDX-License-Identifier: Apache-2.0
// Explicit local-only factory: generate -> offline npm pack -> isolated palette.
import {mkdir,readFile,access} from 'node:fs/promises';
import {existsSync} from 'node:fs';
import {resolve,join,dirname} from 'node:path';
import {createHash} from 'node:crypto';
import {spawnSync} from 'node:child_process';
import {generateNodePackage} from './generate.mjs';

function npmTool(cwd,...args){
  const candidate=[
    process.env.npm_execpath,
    join(dirname(process.execPath),'node_modules/npm/bin/npm-cli.js'),
    join(dirname(process.execPath),'../lib/node_modules/npm/bin/npm-cli.js')
  ].filter(Boolean).find(existsSync);
  if(!candidate)throw new Error('local_npm_cli_not_found');
  const run=spawnSync(process.execPath,[candidate,...args],{
    cwd,encoding:'utf8',timeout:120000,windowsHide:true,
    env:{...process.env,npm_config_update_notifier:'false'}
  });
  if(run.error||run.status!==0)
    throw new Error('offline_npm_failure:'+String(run.error?.code||run.status)+
      ':'+(run.stderr||'').slice(-350));
  return run.stdout;
}
const sha=bytes=>'sha256:'+createHash('sha256').update(bytes).digest('hex');
export async function manufactureIsolated(contract,root){
  if(typeof root!=='string'||root.length===0)
    throw new TypeError('explicit_isolated_root_required');
  const absolute=resolve(root);
  if(existsSync(absolute))throw new Error('isolated_root_exists_no_overwrite');
  // No automatic cleanup or destructive overwrite; newly created root only.
  await mkdir(absolute,{recursive:false});
  for(const subdir of ['source','archives','palette'])
    await mkdir(join(absolute,subdir));
  const generated=await generateNodePackage(contract,join(absolute,'source'));
  const result=JSON.parse(npmTool(generated.destination,'pack','--json',
    '--ignore-scripts','--pack-destination',join(absolute,'archives')));
  if(!Array.isArray(result)||result.length!==1||
     typeof result[0].filename!=='string'||
     !/^node-red-contrib-adamantium-[a-z0-9-]+-0\.1\.0\.tgz$/.test(result[0].filename))
    throw new Error('untrusted_tarball_metadata');
  const archive=join(absolute,'archives',result[0].filename);
  await access(archive);
  npmTool(absolute,'install','--prefix',join(absolute,'palette'),
    '--offline','--ignore-scripts','--no-audit','--no-fund',
    '--no-save','--no-package-lock',archive);
  const pkgPath=join(absolute,'palette','node_modules',generated.packageName);
  const manifest=JSON.parse(await readFile(join(pkgPath,'package.json'),'utf8'));
  if(manifest.name!==generated.packageName||manifest.private!==true||
    manifest.scripts!==undefined||
    manifest['node-red']?.nodes?.[generated.nodeType]!==('nodes/'+contract.id+'.js'))
    throw new Error('installed_palette_manifest_invalid');
  for(const path of Object.keys(generated.files)){
    const actual=await readFile(join(pkgPath,path));
    if(sha(actual)!==generated.sha256[path])
      throw new Error('installed_package_hash_mismatch');
  }
  return {
    schema:'adamantium.factory.receipt/1',isolationRoot:absolute,
    packageName:generated.packageName,nodeType:generated.nodeType,
    archive,source:generated.destination,palette:pkgPath,
    artifactHashes:generated.sha256,verifiedInstalledFiles:true,
    nodeRedVersionCompatibility:'unverified_until_real_runtime_test',
    runtimeStarted:false,registeredInProduction:false,published:false
  };
}
