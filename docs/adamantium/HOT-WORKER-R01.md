# Adamantium-node — Hot Worker Slot R01 (trusted signed microprograms)

Status: isolated prototype, no integration into the Node-RED runtime, native MAS Graph Manager or network-facing API. This module provides a CPU-first hot-swap mechanism for operator-reviewed and signed single-file JavaScript microprograms. It does not install npm packages or Node-RED node types.

## Why this is useful

The app's stable process can keep routing messages while an independently versioned worker switches between verified microprogram implementations. The previous worker remains available for explicit rollback. Existing in-flight calls are bound to the worker they started on, so a version switch cannot silently redirect their outputs to a different implementation.

## Contracts

- Module ABI: node-esm-handle/1, single entry.mjs exporting an asynchronous or synchronous handle(input) function.
- Typed payload: JSON-only, maximum 64 KiB per call/output; default 32 in-flight calls; default 2-second call timeout.
- Release: adamantium.hot-worker-module/1 manifest with exact fields format, abi, moduleName, releaseId, sourceSha256. The manifest is Ed25519-signed with the domain prefix ADAMANTIUM-TRUSTED-HOT-WORKER-R01.
- Identity: constructor requires a public Ed25519 key and its independently pinned SHA-256 SPKI fingerprint.
- Files: a release lives below an explicit trusted local root at ROOT/RELEASE_ID/entry.mjs. Symlinks, unsupported IDs, sources larger than 256 KiB, changed hashes and invalid signatures fail closed.
- Exact code bytes are read, SHA-256 checked, and passed into the worker as an in-memory data: module. No second filesystem read between verification and import; relative imports are intentionally unsupported.
- stage(envelope, {canaryInput,expectedCanary}): verifies identity, source, ABI and a read-only operator-specified canary; changes no active version.
- promote({expectedActiveReleaseId}): CAS on the current release ID, atomically activates the staged candidate, keeping the old worker available for rollback.
- invoke(input): captures the active worker at invocation start; in-flight calls finish on their original worker if the slot is promoted.
- rollback(expectedActiveReleaseId): CAS-protected swap back to the retained previous release.
- close(): terminate worker threads and discard ephemeral state.

## Test and operation

Run with Node.js 22 or 24:

    node --test test/adamantium/hot-worker-slot.test.mjs

Tests generate temporary Ed25519 keys and disposable module sources. No keys or dummy modules are committed. They verify switching while a previous message is still in flight, mismatch of signed identity or source SHA, failed canary, rollback, rejection of oversize data, symlink refusal, timeout recovery and generic error containment.

## Non-goals and safety gates

Node.js worker threads are NOT a security sandbox. Signed JavaScript in a worker still has process-level filesystem and network privileges. Signatures verify provenance; they do not make malicious code safe. Do not load arbitrary user/agent-authored JavaScript into this module, even if its hash matches. These source-only tests are a proof of switching mechanics, not isolation of hostile code.

Production requires all of these gates before any live runtime integration:

1. Operator-controlled release signing and offline verification, separate from the public repository. Never commit private keys.
2. OS-level process and principal separation for untrusted executors (dedicated uid, no host secrets, hard CPU/RAM/time limits, denied network, syscall limits).
3. Separate authoritative mechanicus.universal-graph/1 compiler, signed Graph Manager capability authorization, CAS and durable audit.
4. Explicit state checkpoint/restore/migration, side-effect policy, idempotency receipts and cross-restart rollback journal.
5. A fixed, independently reviewed adapter from native Node-RED runtime node to this microprogram slot. No silent npm palette installation, no remote graph mutations.
6. Signed candidate canary must be intentionally pure, without external side effects. This prototype cannot prove purity of arbitrary code.
7. Independent acceptance on the intended production host and version after peer review.

The current VM122 editor can continue serving its regular Node-RED flows without this module. This draft makes no changes to VM122 main Node-RED, NeuroCMS, Qwen, MAS permissions, WireGuard, or runtime plugins.
