import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { pathToFileURL } from 'node:url';

export const SCHEMA = 'mechanicus.artifact-handoff/1';
export const MAX_BYTES = 4 * 1024 * 1024;
const ID = /^[a-z][a-z0-9-]{2,63}$/;
const HASH = /^[0-9a-f]{64}$/;

export function inspectPayload(payload) {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload) || payload.schema !== SCHEMA) throw Error('schema-invalid');
  if (typeof payload.artifact_id !== 'string' || !ID.test(payload.artifact_id)) throw Error('artifact-id-invalid');
  if (payload.encoding !== 'base64' || typeof payload.content !== 'string' || payload.content.length > Math.ceil(MAX_BYTES / 3) * 4 + 16) throw Error('encoding-invalid');
  if (!Number.isSafeInteger(payload.bytes) || payload.bytes < 4 || payload.bytes > MAX_BYTES) throw Error('size-invalid');
  if (typeof payload.sha256 !== 'string' || !HASH.test(payload.sha256)) throw Error('sha256-invalid');
  if (!/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(payload.content)) throw Error('base64-invalid');
  const bytes = Buffer.from(payload.content, 'base64');
  if (bytes.toString('base64') !== payload.content || bytes.length !== payload.bytes) throw Error('base64-or-length-mismatch');
  const sha = crypto.createHash('sha256').update(bytes).digest('hex');
  if (sha !== payload.sha256) throw Error('content-hash-mismatch');
  if (bytes.subarray(0, 4).toString('hex') !== '504b0304') throw Error('zip-magic-required');
  return { bytes, sha, artifactId: payload.artifact_id };
}

export function stageArtifact(payload, inbox) {
  if (typeof inbox !== 'string' || !path.isAbsolute(inbox)) throw Error('absolute-inbox-required');
  const { bytes, sha, artifactId } = inspectPayload(payload);
  fs.mkdirSync(inbox, { recursive: true, mode: 0o700 });
  const output = path.join(inbox, `${artifactId}-${sha}.zip`);
  try {
    fs.writeFileSync(output, bytes, { flag: 'wx', mode: 0o600 });
  } catch (err) {
    if (err.code !== 'EEXIST') throw err;
    const prior = fs.readFileSync(output);
    if (!prior.equals(bytes)) throw Error('artifact-path-collision');
    return { schema: 'mechanicus.artifact-stage-result/1', artifact_id: artifactId, sha256: sha, bytes: bytes.length, staged: false, idempotent: true, path: output };
  }
  return { schema: 'mechanicus.artifact-stage-result/1', artifact_id: artifactId, sha256: sha, bytes: bytes.length, staged: true, idempotent: false, path: output };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 4) throw Error('usage: node src/stage.mjs <payload.json> <absolute_inbox>');
    const payload = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));
    console.log(JSON.stringify(stageArtifact(payload, process.argv[3])));
  } catch (err) { console.error(JSON.stringify({ schema: 'mechanicus.artifact-stage-error/1', error: err.message })); process.exitCode = 1; }
}
