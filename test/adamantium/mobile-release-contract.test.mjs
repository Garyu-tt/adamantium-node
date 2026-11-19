import assert from 'node:assert/strict';
import test from 'node:test';
import { generateKeyPairSync, sign, createHash } from 'node:crypto';
import { MOBILE_RELEASE_SCHEMA, MOBILE_TARGET, verifyMobileRelease, verifyBlob } from '../../adamantium/mobile-release-contract.mjs';

const {privateKey,publicKey} = generateKeyPairSync('ed25519');
const trustedKeys = new Map([['operator.release.v1',publicKey]]);
const payload = Buffer.from('model shard', 'utf8');
const sha = createHash('sha256').update(payload).digest('hex');
const config = {trustedKeys,currentSequence:6,shellProtocol:1,
  availableCapabilities:['android.camera.capture','android.voice.input']};
const manifest = () => ({
  schema:MOBILE_RELEASE_SCHEMA,target:MOBILE_TARGET,
  sequence:7,minShellProtocol:1,graphDigest:'a'.repeat(64),
  requiredCapabilities:['android.camera.capture'],
  modules:[{id:'model.shard.0',kind:'model-weights',sha256:sha,bytes:payload.length,activation:'on-demand'}],
  metadata:{releaseId:'stable.7',graphRevision:42,issuedAt:'2026-11-20T00:00:00Z'}
});
function envelope(m=manifest(),key=privateKey){
  const bytes=Buffer.from(JSON.stringify(m));
  return {keyId:'operator.release.v1',algorithm:'Ed25519',
    manifestBase64:bytes.toString('base64'),signatureBase64:sign(null,bytes,key).toString('base64')};
}

test('accepts signed, declared, on-demand model release without granting execution',()=>{
  const release=verifyMobileRelease(envelope(),config);
  assert.equal(release.sequence,7);
  assert.equal(release.installAuthorized,false);
  assert.equal(release.invocationAuthorized,false);
  assert.equal(release.totalBlobBytes,payload.length);
  assert.equal(verifyBlob(payload,release.modules[0]),true);
});
test('rejects altered manifests and untrusted keys',()=>{
  const original=envelope();
  const modified=JSON.parse(Buffer.from(original.manifestBase64,'base64').toString());
  modified.sequence=8;
  assert.throws(()=>verifyMobileRelease({...original,manifestBase64:Buffer.from(JSON.stringify(modified)).toString('base64')},config),/signature/);
  const attacker=generateKeyPairSync('ed25519');
  assert.throws(()=>verifyMobileRelease(envelope(manifest(),attacker.privateKey),config),/signature/);
  assert.throws(()=>verifyMobileRelease({...original,keyId:'unknown'},config),/untrusted/);
});
test('rejects rollback, absent static Android capabilities and unsupported APK ABI',()=>{
  assert.throws(()=>verifyMobileRelease(envelope(),{...config,currentSequence:7}),/replay/);
  assert.throws(()=>verifyMobileRelease(envelope(),{...config,availableCapabilities:[]}),/does not declare/);
  assert.throws(()=>verifyMobileRelease(envelope({...manifest(),minShellProtocol:2}),config),/too old/);
});
test('prohibits remotely delivered DEX/native executables and extra privilege keys',()=>{
  const m=manifest();m.modules[0].kind='dex';
  assert.throws(()=>verifyMobileRelease(envelope(m),config),/not allowed/);
  const bad=manifest();bad.modules[0].onActivate='android.execute.shell';
  assert.throws(()=>verifyMobileRelease(envelope(bad),config),/unknown key/);
  const e=manifest();e.requiredCapabilities.push('android.accessibility.control');
  assert.throws(()=>verifyMobileRelease(envelope(e),config),/does not declare/);
});
test('detects bad chunk, duplicate module, invalid signer format and malformed data',()=>{
  const signed=envelope();const release=verifyMobileRelease(signed,config);
  assert.throws(()=>verifyBlob(Buffer.from('model sHard'),release.modules[0]),/hash mismatch/);
  assert.throws(()=>verifyBlob(Buffer.from('short'),release.modules[0]),/length mismatch/);
  const m=manifest();m.modules.push({...m.modules[0]});
  assert.throws(()=>verifyMobileRelease(envelope(m),config),/duplicate module ID/);
  assert.throws(()=>verifyMobileRelease({...signed,signatureBase64:'*'},config),/invalid signatureBase64/);
  assert.throws(()=>verifyMobileRelease({...signed,algorithm:'none'},config),/algorithm/);
});
