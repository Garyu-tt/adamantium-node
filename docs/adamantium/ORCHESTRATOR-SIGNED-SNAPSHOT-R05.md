# AN-0005 — Signed, read-only Graph Manager snapshots for the orchestration workbench

**Status:** R05 draft, offline reference only. Stacked on R04 PR #10 (R03 UI, R02 Android release envelope, R01 Universal Graph IR). No deployment or live Graph Manager binding in this PR.

## Reason

The R04 task DAG and Android UI contracts validate SHAPE, not SOURCE or FRESHNESS. A valid JSON payload from an untrusted process must never masquerade as a Graph Manager work order, and a green /health from AgentForge or Automation Forge never implies dispatch permission.

R05 supplies a separate snapshot contract: `mechanicus.orchestration-signed-snapshot/1`. It is a read-only _projection_ to UI. It is **not** a new orchestrator, shared queue or means to invoke MAS capabilities.

### Signed envelope

`{keyId, algorithm:"Ed25519", payloadBase64, signatureBase64}`, with a pinned public key for the explicitly approved Graph Manager identity. Signature covers exact UTF-8 payload bytes before JSON parsing. Strict deterministic serialization rejects extra fields, JSON duplicate keys and ambiguous rewrites.

Payload contains `schema`, `streamId`, `sequence`, `revision`, `issuerProviderId`, `issuedAt`, `expiresAt`, and one R04 orchestration view snapshot. Acceptance requires:
- Valid pinned Ed25519 signature AND issuer bound to `snapshot.authorityProviderId` and the independently configured expected identity.
- Timestamp/observation checks, 5-minute maximum TTL and bounded future skew. Stale providers cannot be advertised as reachable.
- Monotonic sequence and graph revision; no replay or mixed stream IDs.
- DAG correctness, explicit blocker reasons/recovery references, and nonnull completion evidence.
- No endpoints, credentials, private keys, executable code, CLI commands, write permissions or arbitrary Android actions embedded in a snapshot.

### UI and offline behavior

A successful verification feeds the **existing** R04 projector into the R03 `mechanicus.mobile-ui/1` ABI. It gives a tasks screen, agents list and diagnostics without hardcoded provider addresses. Projected data is immutable for the UI.

The read-model retains the last signed envelope in memory for an offline last-known-good snapshot. Once its TTL expires it remains visible as **offline-stale**, never as fresh, and never authorizes execution. Android must persist the envelope and sequence high-water mark in protected device storage; this reference module supplies only an in-memory state transition.

Transport may deliver the same signed envelope via HTTPS or server-sent events. An SSE frame must name `orchestration.snapshot` and carry a sequence ID matching the signed payload. The transport **still requires** independent HTTPS/WireGuard identity and authorization. Receiving an SSE frame is not authentication and not permission to dispatch.

### Server-side owners

Graph Manager (and only its trusted signing service) issues live snapshots after reading the canonical task graph and permissions. AgentForge, Cezar, Automation Forge and OpenHands are optional provider adapters. Only Graph Manager/Conductor can authorize execution via approved MAS capability APIs; neither a signed view nor a Node-RED canvas can.

The reference issuer function is for integration/testing and MUST NOT be put in an Android app, embedded in an IDE bundle, or supplied a production signing private key. Mobile/public client only pins public verification keys.

### Checks before enabling live integration

1. Validate real Graph Manager snapshot exporter and its approved signing identity; no local service health check suffices.
2. Implement protected monotonic sequence persistence and operator-controlled key rotation/revocation.
3. Bind authorized HTTPS ingress through WireGuard with independently verified pinned peer identity; no hardcoded IPs/credentials in the UI schema.
4. Verify offline UI, key rotation, clock skew, interrupted updates, rollback and the Android device's encrypted cache.
5. Link approved capability graph and authenticated server actions independently; **no writes** via R05 code.

This PR does NOT modify an existing server process, install mobile software or enable production writes.