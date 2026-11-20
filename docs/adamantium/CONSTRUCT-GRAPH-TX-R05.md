# Adamantium Construct R05 — revisioned graph transactions and Graph Manager review-only handoff

Status: experimental source-only in-process CPU simulator. Stacked draft on R04 PR #42. Never a live MAS Graph Manager write adapter.

## Current Graph Manager capability gate

On 2026-11-20 the published AdamantiumToolBox Graph Manager service exposed GET /graph and GET /health with an internal-authentication check. Its manifest declares only graph_manager.read. Its runtime test explicitly verifies /invoke returns HTTP 404. R05 therefore presents proposal summaries as review_only / noExecution and always reports canCommit:false and canRollback:false for the current Graph Manager. Never invent mutation actions.

## Working sandbox implementation

- Immutable and allowlisted native blueprint revisions, SHA-256 digests and monotonic revision IDs.
- Two independent QA approvals, author self-review blocked, rejected proposals cannot commit.
- CAS expected active revision and exact candidate digest, per-process exclusive mutation lock and second CAS after async authorization.
- Authorization defaults DENY. Only explicitly injected test-only authorizers can approve in the sandbox.
- Atomic active-graph revision pointer switch with in-flight event tickets pinned to their starting revision. New events read the newest active revision. No stop-the-world pause in this *in-process simulator*.
- Explicit rollback by CAS to older retained revision; in-flight tickets never change graph versions. Future commits advance to a new revision ID.
- Passive event interpreter limited to inject, debug and comment. No custom node JS, no filesystem, no networking or external side effects.
- Max 16 revisions, 24 proposals, 32 in-flight events, 128 event steps/fanout, 32 KB JSON payload and 64 graph nodes.
- Review-only handoff carries IDs, base revision, digest, reviewer names and change summary; no private package code or credentials.

## Not implemented

No Node-RED runtime hot swap, actual MAS deployment, signed peer identities, durable journal, remote graph write, external rollback, state handover, plugin install or multi-node consensus. This pure sandbox does not call Graph Manager /invoke. Signatures and authoritative permissions must come from a separately approved and deployed MAS runtime capability, which is not present in the verified Graph Manager 0.1 contract.

## Acceptance

- node --check adamantium/construct-native/graph-tx.mjs
- node --test test/adamantium/construct-graph-tx.test.mjs
- Four-way Windows/Linux Node 22/24 tests: QA quorum, fail closed permissions, CAS, digest conflict, exclusive lock, old/new concurrent tickets, monotonic rollback, dangerous type rejection and bounded event simulation.

## Production integration requirements

Graph Manager or separately registered runtime must explicitly supply typed signed, permission-filtered prepare/commit/abort capability, idempotency, durable receipts, state migration, atomic CAS, health checks, no ambiguous write retries and independent external side effect rollback. R05 provides an isolated transaction reference model, not a substitute for that production gate.
