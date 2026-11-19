import assert from "node:assert/strict";
import test from "node:test";
import { generateKeyPairSync, sign } from "node:crypto";
import {
  SIGNED_VIEW_SCHEMA, verifySignedOrchestrationView,
  projectVerifiedOrchestrationMobileUI
} from "../../adamantium/orchestration-signed-snapshot.mjs";
import { ORCHESTRATION_VIEW_SCHEMA } from "../../adamantium/orchestration-view-contract.mjs";
import { validateMobileUI } from "../../adamantium/mobile-ui-contract.mjs";

const { publicKey, privateKey } = generateKeyPairSync("ed25519");
const attacker = generateKeyPairSync("ed25519");
const NOW = Date.parse("2026-11-20T12:00:00.000Z");
const time = delta => new Date(NOW + delta).toISOString();
const DOMAIN = Buffer.from("mechanicus.signed-orchestration-view/1\0", "utf8");
const view = () => ({
  schema: ORCHESTRATION_VIEW_SCHEMA,
  revision: 77,
  observedAt: time(-2000),
  authorityProviderId: "manager",
  providers: [
    { id: "manager", label: "Graph Manager", role: "graph-authority",
      connection: "read-only", observedAt: time(-2000), capabilities: [] },
    { id: "agentforge", label: "AgentForge", role: "execution-provider",
      connection: "reachable", observedAt: time(-2000), capabilities: [] },
    { id: "cezar", label: "Cezar", role: "development-team",
      connection: "unknown", observedAt: time(-2000), capabilities: [] }
  ],
  tasks: [
    { id: "task1", title: "Inspect release", status: "complete",
      ownerProviderId: "agentforge", dependsOn: [], blockers: [], evidenceRef: "proof1" },
    { id: "task2", title: "Check Claude adapter", status: "blocked",
      ownerProviderId: "cezar", dependsOn: ["task1"],
      blockers: [{ code: "missingauth", reason: "Authentication not verified",
        recoveryTaskId: "task3" }] },
    { id: "task3", title: "Diagnose credentials", status: "queued",
      ownerProviderId: null, dependsOn: ["task1"], blockers: [] }
  ]
});
const document = () => ({
  schema: SIGNED_VIEW_SCHEMA,
  publisherProviderId: "manager",
  sequence: 11,
  issuedAt: time(-1000),
  expiresAt: time(120000),
  policySha256: "a".repeat(64),
  readOnly: true,
  view: view()
});
const env = (doc=document(), signingKey=privateKey) => {
  const bytes = Buffer.from(JSON.stringify(doc), "utf8");
  return {
    keyId: "primary.signer",
    algorithm: "Ed25519",
    payloadBase64: bytes.toString("base64"),
    signatureBase64: sign(null, Buffer.concat([DOMAIN, bytes]), signingKey).toString("base64")
  };
};
const params = () => ({
  trustedKeys: new Map([["primary.signer", publicKey]]),
  trustedAuthorityProviderId: "manager",
  lastAcceptedSequence: 10,
  now: NOW
});
const checked = () => verifySignedOrchestrationView(env(), params());

test("accepts fresh Ed25519 snapshot only from the pinned Graph Manager", () => {
  const result = checked();
  assert.equal(result.sourceAuthenticated, true);
  assert.equal(result.readOnly, true);
  assert.equal(result.authorityProviderId, "manager");
  assert.equal(result.snapshotObservedAt, time(-2000));
  assert.equal(result.sequence, 11);
  assert.equal(result.view.taskCounts.blocked, 1);
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.graphMutationAuthorized, false);
  assert.equal(result.invocationAuthorized, false);
  assert.equal(Object.isFrozen(result), true);
});
test("produces strictly read-only dynamic mobile UI from an authenticated snapshot", () => {
  const output = projectVerifiedOrchestrationMobileUI(checked());
  const valid = validateMobileUI(output.document, {availableCapabilities: []});
  assert.equal(valid.screenCount, 2);
  assert.equal(output.backendMutationsAuthorized, false);
  assert.equal(output.sourceAuthenticated, true);
  assert.equal(output.data["orchestration.summary"].readOnly, true);
});
test("does not allow a manually forged sourceAuthenticated object to bypass signature", () => {
  const real = checked();
  assert.throws(() => projectVerifiedOrchestrationMobileUI({...real}), /verified view required/);
  assert.throws(() => projectVerifiedOrchestrationMobileUI({
    sourceAuthenticated:true, readOnly:true,executionAuthorized:false,view:real.view
  }), /verified view required/);
});
test("rejects tampered signed payloads and attacker keys", () => {
  const signed = env();
  const altered = document(); altered.view.tasks[0].title = "Run privileged shell";
  assert.throws(() => verifySignedOrchestrationView({
    ...signed, payloadBase64:Buffer.from(JSON.stringify(altered)).toString("base64")
  }, params()), /signature/);
  assert.throws(() => verifySignedOrchestrationView(env(document(),attacker.privateKey),params()), /signature/);
  assert.throws(() => verifySignedOrchestrationView(signed,{
    ...params(), trustedKeys:new Map()
  }), /not pinned/);
});
test("refuses rollback, stale, future, overlong and expired views", () => {
  assert.throws(() => verifySignedOrchestrationView(env(),{...params(),lastAcceptedSequence:11}), /replayed/);
  const expired=document(); expired.expiresAt=time(-1);
  assert.throws(() => verifySignedOrchestrationView(env(expired),params()), /expired/);
  const future=document(); future.issuedAt=time(45000);
  assert.throws(() => verifySignedOrchestrationView(env(future),params()), /future/);
  const long=document(); long.expiresAt=time(600000);
  assert.throws(() => verifySignedOrchestrationView(env(long),params()), /excessive/);
  const stale=document(); stale.view.observedAt=time(-600000);
  assert.throws(() => verifySignedOrchestrationView(env(stale),params()), /stale/);
});
test("rejects an alternate authority even when a signer is trusted", () => {
  const wrong=document();wrong.publisherProviderId="cezar";
  assert.throws(() => verifySignedOrchestrationView(env(wrong),params()), /untrusted graph authority/);
  const sub=document();sub.view.authorityProviderId="cezar";
  assert.throws(() => verifySignedOrchestrationView(env(sub),params()), /invalid authority/);
});
test("rejects malformed signatures, noncanonical JSON, and unknown envelope fields", () => {
  assert.throws(() => verifySignedOrchestrationView({...env(),signatureBase64:"???"},
    params()), /base64/);
  assert.throws(() => verifySignedOrchestrationView({...env(),endpoint:"http://localhost"},
    params()), /unknown field/);
  const nice=Buffer.from(JSON.stringify(document(),null,2));
  const e=env();
  e.payloadBase64=nice.toString("base64");
  e.signatureBase64=sign(null,Buffer.concat([DOMAIN,nice]),privateKey).toString("base64");
  assert.throws(() => verifySignedOrchestrationView(e,params()), /noncanonical/);
});
test("rejects secret, endpoint or fake authorization fields inside signed providers", () => {
  for (const field of ["endpoint","canInvoke","authToken"]) {
    const doc=document();doc.view.providers[1][field] = "something";
    assert.throws(() => verifySignedOrchestrationView(env(doc),params()), /forbidden property/);
  }
  const doc=document();doc.readOnly=false;
  assert.throws(() => verifySignedOrchestrationView(env(doc),params()), /read-only/);
});
test("healthy executor is not a signed capability grant", () => {
  const result=checked();
  assert.equal(result.view.providers[1].connection, "reachable");
  assert.equal(result.executionAuthorized, false);
  assert.equal(result.view.executionAuthorized, false);
});
