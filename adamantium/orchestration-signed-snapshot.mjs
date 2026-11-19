/**
 * R05: verify a READ-ONLY Graph Manager orchestration view, without dispatch.
 * This module has no network, process execution, credentials, or Android access.
 * A health endpoint alone is NEVER the graph authority.
 */
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import { validateOrchestrationView } from "./orchestration-view-contract.mjs";
import { projectOrchestrationMobileUI } from "./orchestration-mobile-projection.mjs";

export const SIGNED_VIEW_SCHEMA = "mechanicus.signed-orchestration-view/1";
const DOMAIN = Buffer.from("mechanicus.signed-orchestration-view/1\0", "utf8");
const ID = /^[a-z][a-z0-9._:-]{0,127}$/;
const SHA = /^[0-9a-f]{64}$/;
const B64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;
const MAX_VIEW_BYTES = 2 * 1024 * 1024;
const MAX_TTL_MS = 5 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 30 * 1000;
const fail = reason => { throw new TypeError("Signed orchestration view rejected: " + reason); };
const isObj = v => !!v && typeof v === "object" && !Array.isArray(v);
function shape(obj, properties, label) {
  if (!isObj(obj)) fail(label + " must be an object");
  const names = Object.keys(obj);
  for (const name of names) if (!properties.includes(name)) fail(label + " unknown field " + name);
  for (const name of properties) if (!Object.hasOwn(obj, name)) fail(label + " missing " + name);
}
function identifier(id, label) {
  if (typeof id !== "string" || !ID.test(id)) fail("invalid " + label);
  return id;
}
function bytes64(value, maxBytes, label) {
  if (typeof value !== "string" || value.length > 4 * Math.ceil(maxBytes / 3) + 4 ||
      !B64.test(value)) fail("invalid base64 " + label);
  const result = Buffer.from(value, "base64");
  if (result.length > maxBytes || result.toString("base64") !== value) fail("noncanonical base64 " + label);
  return result;
}
function timestamp(value, label) {
  if (typeof value !== "string" || value.length > 40 ||
      !/^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(value)) fail("invalid " + label);
  const ms = Date.parse(value);
  if (!Number.isFinite(ms) || new Date(ms).toISOString() !==
       (value.length === 20 ? value.replace("Z", ".000Z") :
        value.replace(/\.(\d{1,3})Z$/, (_, digits) => "." + digits.padEnd(3, "0") + "Z"))) {
    fail("noncanonical " + label);
  }
  return ms;
}
/**
 * `trustedKeys` is a pinned, operator-authorized Map<keyId, Ed25519 public key>.
 * `trustedAuthorityProviderId` is the exact graph authority in the signed view.
 * `lastAcceptedSequence` is durable anti-replay state owned by the caller.
 * The result is immutable and has NO authority to invoke any capability.
 */
export function verifySignedOrchestrationView(envelope, {
  trustedKeys, trustedAuthorityProviderId,
  lastAcceptedSequence = 0, now = Date.now()
} = {}) {
  shape(envelope, ["keyId", "algorithm", "payloadBase64", "signatureBase64"], "envelope");
  identifier(envelope.keyId, "keyId");
  identifier(trustedAuthorityProviderId, "trustedAuthorityProviderId");
  if (envelope.algorithm !== "Ed25519") fail("unsupported algorithm");
  if (!Number.isSafeInteger(lastAcceptedSequence) || lastAcceptedSequence < 0) fail("invalid replay floor");
  if (!Number.isFinite(now) || now < 0) fail("invalid clock");
  const key = trustedKeys instanceof Map ? trustedKeys.get(envelope.keyId) : trustedKeys?.[envelope.keyId];
  if (!key) fail("signing key not pinned");
  let pub;
  try { pub = createPublicKey(key); }
  catch { if (key?.type === "public") pub = key; else fail("invalid public key"); }
  if (pub.asymmetricKeyType !== "ed25519" || pub.type !== "public") fail("trusted key is not an Ed25519 public key");
  const payload = bytes64(envelope.payloadBase64, MAX_VIEW_BYTES, "payload");
  const signature = bytes64(envelope.signatureBase64, 64, "signature");
  if (signature.length !== 64) fail("invalid signature length");
  const signed = Buffer.concat([DOMAIN, payload]);
  if (!edVerify(null, signed, pub, signature)) fail("signature verification failed");
  let doc;
  try { doc = JSON.parse(payload.toString("utf8")); }
  catch { fail("invalid JSON"); }
  // Avoid parser disagreement over duplicate keys, whitespace, normalization,
  // extra bytes and noncanonical serialized values. R05 producer uses JSON.stringify.
  if (!Buffer.from(JSON.stringify(doc), "utf8").equals(payload)) fail("noncanonical JSON payload");
  shape(doc, [
    "schema", "publisherProviderId", "sequence", "issuedAt", "expiresAt",
    "policySha256", "readOnly", "view"
  ], "signed document");
  if (doc.schema !== SIGNED_VIEW_SCHEMA) fail("unsupported signed schema");
  if (doc.readOnly !== true) fail("only read-only signed snapshots permitted");
  identifier(doc.publisherProviderId, "publisherProviderId");
  if (doc.publisherProviderId !== trustedAuthorityProviderId) fail("untrusted graph authority");
  if (!Number.isSafeInteger(doc.sequence) || doc.sequence <= lastAcceptedSequence)
    fail("stale or replayed sequence");
  const issued = timestamp(doc.issuedAt, "issuedAt");
  const expires = timestamp(doc.expiresAt, "expiresAt");
  if (issued > now + MAX_CLOCK_SKEW_MS) fail("snapshot from the future");
  if (expires <= now || expires <= issued || expires - issued > MAX_TTL_MS)
    fail("expired or excessive snapshot lifetime");
  if (typeof doc.policySha256 !== "string" || !SHA.test(doc.policySha256)) fail("invalid policy digest");
  const view = validateOrchestrationView(doc.view);
  if (view.authorityProviderId !== trustedAuthorityProviderId) fail("authority identity mismatch");
  // Reject stale view wrapped in a freshly signed envelope.
  const observed = timestamp(doc.view.observedAt, "view.observedAt");
  if (observed > issued + MAX_CLOCK_SKEW_MS || issued - observed > MAX_TTL_MS)
    fail("stale or future observation");
  return Object.freeze({
    sourceAuthenticated: true,
    signerKeyId: envelope.keyId,
    authorityProviderId: trustedAuthorityProviderId,
    sequence: doc.sequence,
    graphRevision: view.revision,
    expiresAt: doc.expiresAt,
    policySha256: doc.policySha256,
    payloadSha256: createHash("sha256").update(payload).digest("hex"),
    view,
    readOnly: true,
    invocationAuthorized: false,
    executionAuthorized: false,
    graphMutationAuthorized: false
  });
}
/** Convert only an authenticated view to the installed read-only mobile UI. */
export function projectVerifiedOrchestrationMobileUI(verified) {
  if (!verified || verified.sourceAuthenticated !== true || verified.readOnly !== true ||
      !verified.view || verified.executionAuthorized !== false) fail("verified view required");
  const ui = projectOrchestrationMobileUI({
    schema: verified.view.schema,
    revision: verified.view.revision,
    observedAt: verified.view.observedAt ?? new Date(0).toISOString(),
    authorityProviderId: verified.view.authorityProviderId,
    providers: verified.view.providers,
    tasks: verified.view.tasks
  });
  return Object.freeze({ ...ui, sourceAuthenticated: true,
    signerKeyId: verified.signerKeyId, expiresAt: verified.expiresAt,
    backendMutationsAuthorized: false });
}
