# Capsule Studio R03: native Graph IR proposals and local-only CAS staging

Status: **draft reference implementation**. This change is stacked on Capsule Studio R02 (PR #25). It DOES NOT add an authoritative Graph Manager writer, node execution, active graph hot-swap, an unrestricted language runner, or a production deployment.

## R03 adapter

The new editor-only projection in adamantium/capsule-ir-proposal.mjs reads a validated CapsuleStudio snapshot and generates:

- One independent graph document for each nested graph, following the draft Graph IR v1 format from Garyu-tt/AdamantiumToolBox PR #143 (standards/universal-graph/graph-ir-v1.schema.json).
- Recursive child graphs represented as composite nodes with typeRef="", graphRef and graphRefRevision pinned to the proposal's candidate revision.
- Language microprograms represented as inert service nodes with typed ports and an opaque versioned typeRef; no user code, secrets, instance settings or executable handles are carried in the Graph IR documents.
- Typed graph edges with delayTicks:0. Directed zero-delay cycles fail closed. Feedback with explicit delays is not implemented and cannot be inferred from wire topology.
- A separate boundaryBindings **editor sidecar** for north/east/south/west, internal endpoint, container identity, typed interface ports and stable tags. The native IR v1 schema has no fields for those, so the sidecar must never be disguised as an IR schema extension.
- A nonprivileged definitionHandles list identifying already-pinned definitions by language/version/typeRef. Not a package manifest or a permission grant.

All imported proposals are rechecked for exact canonical graph/node/port/edge field keys, contracts, non-executable data semantics, semantic port compatibility, single ownership of composite children, no orphans, complete boundary sidecar bindings, revision consistency and no hidden extra fields that might smuggle code or access privileges. The existing read-only editor-projection validator is only one layer: a native C++17 Universal Graph IR compiler/validator plus independently signed MAS policy remains the authoritative acceptance gate.

## Local-only CAS experiment

adamantium/capsule-draft-ledger.mjs implements an **in-memory** and **single-process** candidate staging experiment. It is explicitly nonauthoritative:

- InMemoryCapsuleDraftLedger.propose requires a unique requestId, exact local expectedRevision and expectedHead, a candidate at revision+1 and the same root graph identity.
- Deterministic SHA-256 of the JSON proposal is a content digest, **not an authenticity signature**. Reusing the same requestId for a different candidate fails; identical repeats are idempotent.
- applyLocal requires unchanged expectedRevision/head, and only changes the in-memory preview document. Nothing is written to a Node-RED flow registry, the Universal Graph IR native store or any runtime executor.
- rollbackLocal restores the previous local draft as a **new** monotonic revision, never decrementing the current revision. No active graphs are swapped. Stale pending drafts are discarded.
- Every receipt explicitly includes authoritative:false, masApproved:false, runtimeActivated:false, externalSideEffects:false.

This ledger must NOT be reused as a production authorization, multi-process lock, durable store or actual hot-swap implementation. Authoritative Core must verify the expected graph revision, policy scope and independently authenticated identity before any persistent stage/promote action. Real runtime activation must be a separate transaction with pause/drain/commit/rollback semantics and proof of agent capability.

## Editor access

Capsule Studio has **Экспорт IR-предложения** next to the full-fidelity JSON export. It creates the inert proposal with revision=1, validates it and downloads it as JSON. Revision 1 is illustrative only, not the current revision of Graph Manager. The exported bundle includes no microprogram source code. It does NOT submit anything to a server, edit a Node-RED flow, compile or execute a language.

The preview still runs independently or inside its registered Node-RED editor sidebar. The package resources bundle capsule-ir-proposal.mjs and editor-projection.mjs with exact content-matching tests. The localhost preview server allowlists these source modules.

## Testing

Run from the branch root (Node >=22.9):

~~~sh
node --test test/adamantium/capsule-ir-proposal.test.mjs test/adamantium/capsule-draft-ledger.test.mjs
~~~

For full regressions:

~~~sh
node --test test/adamantium/capsule-*.test.mjs
~~~

R03 CI: Linux + Windows with Node 22 and 24. The test suite includes recursive graph references, boundary consistency, permission edge rejection, input tampering, source secrecy, zero-delay cycles, idempotency, stale expected revisions and monotonic local rollback.

## Next phase

Integrate draft proposals with a separately authorized graph manager identity through a typed API. Require signature/provenance, canonical independent validator, complete CAS revision with exact graph scope, immutable storage and audit evidence before any real persistent promotion. Native Node-RED workspace view and hot-update controls remain follow-on work. Keep production deployment, live Windows flow edits and VM121/VM122 untouched until independently reviewed.
