/**
 * Adamantium-node R04: signed, scope-bound proposal transport adapter.
 *
 * This is a CLIENT CONTRACT, not a MAS authority or an installed Core route.
 * No endpoint URL, credentials, shell, runtime executor or automatic retry.
 * The caller must supply a previously authenticated, exact-node transport;
 * Core must independently authorize every write and perform the native G0 gate.
 *
 * SPDX-License-Identifier: Apache-2.0
 */
import { createHash, createPublicKey, verify } from "node:crypto";
import { inspectCapsuleIRProposal } from "./capsule-ir-proposal.mjs";

export const OFFER_VERSION = "adamantium.core-graph-proposal-offer/1";
export const RECEIPT_VERSION = "adamantium.core-graph-proposal-receipt/1";
export const REQUEST_VERSION = "adamantium.core-graph-proposal-request/1";
const ACTION_CONTRACT = "mechanicus.graph.propose/1";
const ID = /^[a-z][a-z0-9_.-]{0,127}$/;
const HASH = /^[a-f0-9]{64}$/;
const obj = x => x!==null && typeof x==="object" && !Array.isArray(x);
function requireCondition(yes,message) {
  if(!yes)throw new TypeError("Signed graph proposal: "+message);
}
function assertKeys(value,required,label) {
  requireCondition(obj(value),label+" must be an object");
  const keys=Object.keys(value).sort();
  requireCondition(JSON.stringify(keys)===JSON.stringify(required.slice().sort()),
    label+" contains unknown/missing fields");
}
function checkID(value,field) {
  requireCondition(typeof value==="string" && value.length<=128 && ID.test(value),
    "invalid "+field);
  return value;
}
function checkHash(value,field) {
  requireCondition(typeof value==="string" && HASH.test(value),"invalid "+field);
  return value;
}
function asBytes(value){
  const text=JSON.stringify(value);
  requireCondition(text.length<=2_000_000,"proposal exceeds 2MB transport budget");
  return Buffer.from(text);
}
/** Deterministic representation of signed JSON, not a generic protocol for
 * arbitrary JS objects. Input must be ordinary JSON without any secret fields.
 * It is used only with the strict typed offer/receipt payloads below. */
export function canonicalJSONString(value) {
  if(value===null||typeof value==="string"||typeof value==="boolean"||
    (typeof value==="number"&&Number.isFinite(value)))return JSON.stringify(value);
  requireCondition(Array.isArray(value)||obj(value),"non-JSON signed field");
  if(Array.isArray(value))return "["+value.map(canonicalJSONString).join(",")+"]";
  const keys=Object.keys(value).sort();
  return "{"+keys.map(k=>JSON.stringify(k)+":"+canonicalJSONString(value[k])).join(",")+"}";
}
export function signedPayloadBytes(payload) {
  return Buffer.from("ADAMANTIUM-GRAPH-PROPOSAL-R04\n"+canonicalJSONString(payload),"utf8");
}
function verifyEnvelope(envelope,expectedKey) {
  assertKeys(envelope,["payload","signature"],"signed envelope");
  requireCondition(typeof envelope.signature==="string" &&
    /^[A-Za-z0-9+/]+={0,2}$/.test(envelope.signature) &&
    envelope.signature.length<=1000,"invalid signature encoding");
  const signature=Buffer.from(envelope.signature,"base64");
  requireCondition(signature.length===64,"invalid Ed25519 signature length");
  const canonical=signature.toString("base64");
  requireCondition(canonical===envelope.signature,"noncanonical signature encoding");
  const valid=verify(null,signedPayloadBytes(envelope.payload),expectedKey,signature);
  requireCondition(valid,"invalid Ed25519 signature");
  return envelope.payload;
}
function validateTime(payload,now) {
  requireCondition(Number.isSafeInteger(payload.issuedAt)&&Number.isSafeInteger(payload.expiresAt),
    "invalid signed timestamps");
  requireCondition(payload.expiresAt>payload.issuedAt &&
    payload.expiresAt-payload.issuedAt<=120_000,"invalid time window");
  requireCondition(payload.issuedAt<=now+5_000 &&
    payload.issuedAt>=now-120_000 &&
    payload.expiresAt>now,"expired or future signed proof");
}
function fingerprintPublicKey(key){
  return createHash("sha256").update(key.export({format:"der",type:"spki"})).digest("hex");
}
function sha256(value) {return createHash("sha256").update(asBytes(value)).digest("hex");}
function verifyScope(payload,{nodeId,graphId,policySha256,now}){
  requireCondition(payload.nodeId===nodeId,"signed node identity mismatch");
  requireCondition(payload.graphId===graphId,"signed graph scope mismatch");
  requireCondition(payload.policySha256===policySha256,"policy digest mismatch");
  validateTime(payload,now);
}
/**
 * A *propose-only* bridge. The transport MUST be restricted to the owner's
 * preauthenticated, verified Core graph capability session; this module does
 * not create that session, discover network hosts, approve or activate work.
 */
export class SignedGraphProposalBridge {
  #transport;#nodeId;#graphId;#policy;#key;#clock;#offers;
  constructor({transport,nodeId,graphId,policySha256,pinnedPublicKeyPem,pinnedFingerprint,now=()=>Date.now()}) {
    requireCondition(obj(transport)&&typeof transport.preflight==="function" &&
      typeof transport.invoke==="function","missing capability-aware transport");
    checkID(nodeId,"nodeId");checkID(graphId,"graphId");
    checkHash(policySha256,"policySha256");
    checkHash(pinnedFingerprint,"pinnedFingerprint");
    requireCondition(typeof pinnedPublicKeyPem==="string" && pinnedPublicKeyPem.length<=4096,
      "missing pinned public key");
    requireCondition(typeof now==="function","invalid clock");
    const publicKey=createPublicKey(pinnedPublicKeyPem);
    requireCondition(publicKey.asymmetricKeyType==="ed25519","pinned key must be Ed25519");
    requireCondition(fingerprintPublicKey(publicKey)===pinnedFingerprint,
      "pinned public key fingerprint mismatch");
    this.#transport=transport;this.#nodeId=nodeId;this.#graphId=graphId;
    this.#policy=policySha256;this.#key=publicKey;this.#clock=now;this.#offers=new Set();
  }
  /**
   * Exactly one authenticated preflight + one invoke. No mutation retry after
   * timeout: the caller must perform an independent readback / receipt lookup.
   */
  async submit({requestId,proposal}) {
    checkID(requestId,"requestId");
    const inspected=inspectCapsuleIRProposal(proposal);
    requireCondition(inspected.rootGraphId===this.#graphId,"proposal root not in approved scope");
    const start=this.#clock();
    requireCondition(Number.isSafeInteger(start) && start>=0,"invalid clock");
    const preflight=await this.#transport.preflight({
      nodeId:this.#nodeId,graphId:this.#graphId,contract:ACTION_CONTRACT
    });
    assertKeys(preflight,["status","mode","canInvoke","nodeId","signedOffer"],"preflight");
    requireCondition(preflight.status==="reachable" && preflight.mode==="primary" &&
      preflight.canInvoke===true && preflight.nodeId===this.#nodeId,
      "capability unavailable or in read-only standby");
    const offer=verifyEnvelope(preflight.signedOffer,this.#key);
    assertKeys(offer,["format","nodeId","graphId","policySha256","issuedAt","expiresAt",
      "offerId","revision","headSha256","actionContract","actionId"],"offer");
    requireCondition(offer.format===OFFER_VERSION,"unsupported offer schema");
    verifyScope(offer,{nodeId:this.#nodeId,graphId:this.#graphId,
      policySha256:this.#policy,now:this.#clock()});
    checkID(offer.offerId,"offerId");checkID(offer.actionId,"actionId");
    checkHash(offer.headSha256,"headSha256");
    requireCondition(offer.actionContract===ACTION_CONTRACT,"action contract mismatch");
    requireCondition(Number.isSafeInteger(offer.revision)&&offer.revision>=1,"invalid authoritative revision");
    requireCondition(inspected.revision===offer.revision+1,"candidate revision not based on fresh offer");
    requireCondition(!this.#offers.has(offer.offerId),"replayed signed offer");
    this.#offers.add(offer.offerId);
    const candidate=JSON.parse(JSON.stringify(proposal));
    const proposalSha256=sha256(candidate);
    const payload={
      format:REQUEST_VERSION,requestId,nodeId:this.#nodeId,graphId:this.#graphId,
      policySha256:this.#policy,offerId:offer.offerId,
      expectedRevision:offer.revision,expectedHeadSha256:offer.headSha256,
      proposedRevision:inspected.revision,proposalSha256,proposal:candidate
    };
    // The exact actionId is signed by the offer. No hardcoded host or action ID.
    // No retries, even if transport.invoke throws or times out ambiguously.
    const answer=await this.#transport.invoke({
      nodeId:this.#nodeId,actionId:offer.actionId,payload
    });
    const receipt=verifyEnvelope(answer,this.#key);
    assertKeys(receipt,["format","nodeId","graphId","policySha256","issuedAt","expiresAt",
      "offerId","requestId","proposalSha256","expectedRevision","expectedHeadSha256",
      "status","receiptId"],"receipt");
    requireCondition(receipt.format===RECEIPT_VERSION,"unsupported receipt schema");
    verifyScope(receipt,{nodeId:this.#nodeId,graphId:this.#graphId,
      policySha256:this.#policy,now:this.#clock()});
    checkID(receipt.receiptId,"receiptId");
    requireCondition(receipt.offerId===offer.offerId && receipt.requestId===requestId &&
      receipt.proposalSha256===proposalSha256 && receipt.expectedRevision===offer.revision &&
      receipt.expectedHeadSha256===offer.headSha256,"receipt does not match proposed graph");
    requireCondition(receipt.status==="accepted-for-review"||receipt.status==="rejected",
      "unsupported receipt status");
    return Object.freeze({
      format:RECEIPT_VERSION,receiptId:receipt.receiptId,status:receipt.status,
      requestId,proposalSha256,graphId:this.#graphId,nodeId:this.#nodeId,
      receiptVerified:true,graphApproved:false,runtimeActivated:false,
      source:"pinned-node-identity-only"
    });
  }
}
