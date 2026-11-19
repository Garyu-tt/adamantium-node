/**
 * Adamantium-node R02: inert, signed mobile data-release verifier.
 * This does NOT authorize an Android capability, execute a flow, fetch content,
 * install code, touch files, or select a mesh node.
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, verify as verifySignature } from 'node:crypto';

export const MOBILE_RELEASE_SCHEMA = 'mechanicus.mobile-runtime-release/1';
export const MOBILE_TARGET = 'adamantium.ai-core.mobile';
const ALLOWED_KINDS = new Set([
  'graph-ir', 'ui-schema', 'model-weights', 'tokenizer', 'model-config',
  'prompt-template', 'policy-data', 'localization', 'media-asset'
]);
const MAX_BLOB = 256 * 1024 ** 3;
const SHA = /^[a-f0-9]{64}$/;
const ID = /^[a-z][a-z0-9._-]{0,127}$/;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const own = (obj, key) => Object.prototype.hasOwnProperty.call(obj, key);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
function fail(reason) { throw new TypeError(`Rejected mobile release: ${reason}`); }
function exactKeys(value, names, context) {
  if (!object(value)) fail(`${context} is not an object`);
  for (const key of Object.keys(value)) if (!names.includes(key)) fail(`${context} unknown key ${key}`);
  for (const key of names) if (!own(value, key)) fail(`${context} missing ${key}`);
}
function int(value, label, min=0) {
  if (!Number.isSafeInteger(value) || value < min) fail(`${label} must be a safe integer >= ${min}`);
  return value;
}
function id(value, label) {
  if (typeof value !== 'string' || !ID.test(value)) fail(`invalid ${label}`);
  return value;
}
function hex(value, label) {
  if (typeof value !== 'string' || !SHA.test(value)) fail(`invalid ${label}`);
  return value;
}
function decodedBase64(value, label, maxBytes) {
  if (typeof value !== 'string' || value.length > Math.ceil(maxBytes / 3) * 4 + 4 ||
      !BASE64.test(value)) fail(`invalid ${label}`);
  const buf = Buffer.from(value, 'base64');
  if (buf.length > maxBytes || buf.toString('base64') !== value) fail(`noncanonical ${label}`);
  return buf;
}

/**
 * The signed bytes are EXACTLY the decoded UTF-8 manifest bytes, not a
 * reserialized JSON object. Signature verification precedes JSON parsing.
 * trustedKeys is a pinned, operator-owned map from key ID to public KeyObject/PEM.
 * availableCapabilities contains capabilities declared in the installed APK,
 * NOT permissions granted by the OS and NOT permission to invoke them.
 */
export function verifyMobileRelease(envelope, {
  trustedKeys, currentSequence=0, shellProtocol=1, availableCapabilities=[]
} = {}) {
  exactKeys(envelope, ['keyId', 'algorithm', 'manifestBase64', 'signatureBase64'], 'envelope');
  const keyId = id(envelope.keyId, 'envelope.keyId');
  if (envelope.algorithm !== 'Ed25519') fail('algorithm must be Ed25519');
  const key = trustedKeys instanceof Map ? trustedKeys.get(keyId) : trustedKeys?.[keyId];
  if (!key) fail('untrusted signing key');
  const manifestBytes = decodedBase64(envelope.manifestBase64, 'manifestBase64', 512 * 1024);
  const signature = decodedBase64(envelope.signatureBase64, 'signatureBase64', 64);
  if (signature.length !== 64 || !verifySignature(null, manifestBytes, key, signature)) {
    fail('invalid Ed25519 signature');
  }
  let m;
  try { m = JSON.parse(manifestBytes.toString('utf8')); }
  catch { fail('invalid signed manifest JSON'); }
  exactKeys(m, [
    'schema','target','sequence','minShellProtocol','graphDigest',
    'requiredCapabilities','modules','metadata'
  ], 'manifest');
  if (m.schema !== MOBILE_RELEASE_SCHEMA || m.target !== MOBILE_TARGET) fail('incompatible schema or target');
  int(m.sequence,'sequence',1);
  int(currentSequence,'currentSequence');
  if (m.sequence <= currentSequence) fail('replay/downgrade sequence');
  int(m.minShellProtocol,'minShellProtocol',1);
  int(shellProtocol,'shellProtocol',1);
  if (m.minShellProtocol > shellProtocol) fail('APK shell protocol too old');
  hex(m.graphDigest,'graphDigest');
  if (!Array.isArray(m.requiredCapabilities) || m.requiredCapabilities.length > 256) fail('invalid capabilities');
  const capabilities = new Set();
  const allowed = new Set(availableCapabilities);
  for (const raw of m.requiredCapabilities) {
    const cap = id(raw,'requiredCapability');
    if (capabilities.has(cap)) fail('duplicate capability');
    if (!allowed.has(cap)) fail(`APK does not declare ${cap}`);
    capabilities.add(cap);
  }
  if (!Array.isArray(m.modules) || m.modules.length > 4096) fail('invalid module list');
  const seen = new Set();
  let bytes = 0;
  for (const module of m.modules) {
    exactKeys(module,['id','kind','sha256','bytes','activation'], 'module');
    const moduleId = id(module.id,'module.id');
    if (seen.has(moduleId)) fail('duplicate module ID');
    seen.add(moduleId);
    if (!ALLOWED_KINDS.has(module.kind)) fail('executable/unknown module kind not allowed');
    hex(module.sha256,'module.sha256');
    const size = int(module.bytes,'module.bytes',1);
    if (size > MAX_BLOB || bytes + size > Number.MAX_SAFE_INTEGER) fail('blob/storage budget exceeded');
    bytes += size;
    if (!['on-demand','startup'].includes(module.activation)) fail('invalid activation policy');
  }
  exactKeys(m.metadata,['releaseId','graphRevision','issuedAt'], 'metadata');
  id(m.metadata.releaseId,'releaseId');
  int(m.metadata.graphRevision,'graphRevision',1);
  if (typeof m.metadata.issuedAt !== 'string' || m.metadata.issuedAt.length > 40 ||
      !Number.isFinite(Date.parse(m.metadata.issuedAt))) fail('invalid issuedAt');
  return Object.freeze({
    schema:m.schema, target:m.target, sequence:m.sequence, graphDigest:m.graphDigest,
    signer:keyId, totalBlobBytes:bytes, requiredCapabilities:Object.freeze([...capabilities]),
    modules:Object.freeze(m.modules.map(v=>Object.freeze({...v}))),
    manifestSHA256:createHash('sha256').update(manifestBytes).digest('hex'),
    invocationAuthorized:false, installAuthorized:false
  });
}

/** Check actual artifact bytes before they can be staged into a CAS cache. */
export function verifyBlob(blob, descriptor) {
  if (!Buffer.isBuffer(blob) && !(blob instanceof Uint8Array)) fail('blob must be bytes');
  if (!object(descriptor)) fail('missing blob descriptor');
  if (blob.length !== descriptor.bytes) fail('blob length mismatch');
  if (createHash('sha256').update(blob).digest('hex') !== descriptor.sha256) fail('blob hash mismatch');
  return true;
}
