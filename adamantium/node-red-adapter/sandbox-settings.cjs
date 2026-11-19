// SPDX-License-Identifier: Apache-2.0
// Runtime settings exclusively for ephemeral, loopback-only factory test nodes.
// Supply unique token and identity by environment; never commit a live credential.
'use strict';
const {timingSafeEqual}=require('node:crypto');
const token=process.env.ADAMANTIUM_NODE_SANDBOX_TOKEN;
const identity=process.env.ADAMANTIUM_NODE_SANDBOX_ID;
if(typeof token!=='string'||token.length<24||
 !/^[a-z0-9-]{16,96}$/.test(identity||''))
 throw new Error('sandbox_identity_and_token_required');
function matches(given) {
 if(typeof given!=='string')return false;
 const a=Buffer.from(given),b=Buffer.from(token);
 return a.length===b.length&&timingSafeEqual(a,b);
}
module.exports={
 flowFile:'flows.json',flowFilePretty:true,uiHost:'127.0.0.1',
 apiMaxLength:'64kb',
 httpNodeRoot:false,
 adminAuth:{
  type:'credentials',
  users:[{username:'factory-sandbox',permissions:'*'}],
  tokens:async supplied=>matches(supplied)?
   {username:'factory-sandbox',permissions:'*'}:null
 },
 httpAdminMiddleware(req,res,next){
  res.setHeader('X-Adamantium-Sandbox-Id',identity);
  next();
 },
 telemetry:{enabled:false,updateNotification:false},
 diagnostics:{enabled:false,ui:false},
 editorTheme:{projects:{enabled:false}},
 externalModules:{
  autoInstall:false,
  palette:{allowInstall:false,allowUpload:false,allowUpdate:false},
  modules:{allowInstall:false}
 },
 functionExternalModules:false,
 logging:{console:{level:'info',audit:false,metrics:false}}
};
