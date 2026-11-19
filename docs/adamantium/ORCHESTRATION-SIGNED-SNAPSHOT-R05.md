# AN-0005 — Signed Graph Manager snapshot boundary

**Status:** review-only R05; depends on R04 PR #10. This is not a deployment.

## The problem

R04's `mechanicus.orchestration-view/1` verifies the shape of a DAG, not
its authenticity. A healthy AgentForge HTTP endpoint, a local systemd unit,
or an untrusted UI mock may describe service availability but cannot
authorize task execution, assert itself to be Graph Manager, or publish
the canonical DAG.

On the server check of 20 November 2026, three separate AgentForge
instances answered `/health` with version R28. Automation Forge was
systemd-active and answered its generic `/health`; `/healthz` required
authentication (401). Neither the 200 nor 401 result proves eligibility
to submit work or to mutate any global graph.

## Signed read-only data model

`adamantium/orchestration-signed-snapshot.mjs` validates a byte-for-byte,
**Ed25519-signed** read-only statement from the operator-pinned Graph Manager
publishing key. No network, key material, action invocation or signing
credentials are included.

Envelope (field order does not matter):
```json
{
  "keyId": "operator.approved.signer",
  "algorithm": "Ed25519",
  "payloadBase64": "...",
  "signatureBase64": "..."
}
```

Sign the bytes `UTF8("mechanicus.signed-orchestration-view/1\\0") ||
UTF8(JSON.stringify(document))`; the NUL is a **single zero byte**, not
the two printable characters backslash and zero. Signature is 64 bytes.

The decoded, compact JSON document has exactly:
`schema` = `mechanicus.signed-orchestration-view/1`,
`publisherProviderId`, monotonic `sequence` (positive integer),
`issuedAt`, `expiresAt` (UTC ISO timestamps),
`policySha256` (64 lowercase hex characters),
`readOnly` = true, `view` (the full R04 snapshot).

A successful read requires:
- Public-key pin already installed by operator policy; no trust-on-first-use.
- The publisher ID matches the **expected canonical** Graph Manager provider.
- Exact signature over compact JSON bytes and domain-separated prefix.
- Sequence greater than the persistently stored last accepted sequence.
- Strict observation timestamp, not excessively behind issuance.
- Issuance no more than 30 seconds in the future; expiry not passed and
  validity no more than 5 minutes.
- A single graph-authority provider, graph DAG closure, blocker diagnostics
  and completed-task evidence under R04 validation.
- No URL, credential, `canInvoke`, command or other undeclared properties.

The serializer is deliberately restricted to compact `JSON.stringify`
equivalence for this reference implementation; this is NOT RFC 8785
cross-language canonical JSON. A future publisher in a different language
should either follow this encoding precisely with compatibility vectors
or migrate to a versioned JCS/CBOR signing contract without ambiguity.

## Output and trust boundaries

`verifySignedOrchestrationView` gives a frozen authenticated read-only
snapshot with `executionAuthorized: false`,
`graphMutationAuthorized: false`, `invocationAuthorized: false`.
Its provenance is session-bound inside the verifier. The mobile projector
requires that same verified object, rejecting forged objects with
`sourceAuthenticated: true`.

The R03 mobile interpreter receives only the existing **task tree,
provider listing and diagnostics**. It never receives service endpoints,
secrets, permission grants or write actions. A signed snapshot shows
information, not capability.

### Future service implementation steps (not done in R05)

1. Confirm actual independent Graph Manager Core primary identity, pinned
   Mesh key, approved read-only `view.snapshot` capability and policy digest.
2. Have **that** authenticated exporter sign and publish the statement.
   Keys remain in approved signer/HSM/OS keystore, never in GitHub, Node-RED
   editor flows, mobile UI assets or ChatGPT.
3. Serve snapshots over an authenticated WireGuard/HTTPS read-only transport.
   Persist anti-replay state separately from UI cache; retain last-known-good
   for offline DISPLAY only and mark expired snapshots stale.
4. Verify with Android platform Ed25519 APIs and test canonical byte vectors,
   clock drift, reboots, rollback, corrupt payload, key rotation and loss of
   connectivity before enabling a production read-only panel.
5. Only an independent capability/action authorization path can submit work.
   A user pressing a UI button never reuses this view signature as action
   approval.

No CAS lease, submission, retry, job scheduling, service restart, credential
inspection or deployment is performed in this PR. Cezar is still optional
and unverified; AgentForge/Automation Forge are **not** made canonical by
their health replies.
