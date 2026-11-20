# GENESIS Artifact Handoff R01 — consent-aware delivery primitive

**Scope:** This is a no-network, dependency-free, **non-executing** Node.js module for staging an immutable ZIP that an *already-authorized* Mechanicus/JediControl dispatcher has delivered as an envelope. It does not extract the archive, execute the code, modify Node-RED flows, install on Windows, or bypass local consent/UAC.

The envelope contract is `mechanicus.artifact-handoff/1`: `artifact_id` (strict slug), `encoding:"base64"`, `bytes`, `sha256` and `content`. `inspectPayload` checks bounds (4 MiB max), strict base64, declared length, SHA-256 and ZIP signature. `stageArtifact` stores `<artifact_id>-<sha256>.zip` in a caller-supplied **absolute inbox** via create-only writes, and repeats idempotently. A SHA-256 is an integrity check, **not an authenticity signature**. It is the caller's responsibility to enforce authorization, signed provenance, quotas and directory ACLs.

Run `node --test test/stage.test.mjs` (Node 22+) from this directory.

**R03 status:** the 3-region GENESIS R03 ZIP exists as a conversation artifact, locally verified with 15/15 Node 22 tests, but is **not deployed on Windows**. This handoff module alone does not change that.

## Follow-up implementation gates

1. Have the capability-driven MAS dispatcher create a temporary, narrow artifact intake operation. It must honor JediControl paused/emergency state, controller leases, and explicit owner permissions. No hardcoded endpoints, bearer tokens or arbitrary shell commands in flows.
2. Validate signed provenance independently of the SHA-256. Verify archive contents and reject traversal, symlinks and unexpected files **before** any extraction by a separate installer.
3. Stage R03 into an isolated user-owned experiment directory; compare the exact content digest, then run bounded tests and a CPU-only demonstration.
4. Use request IDs, CAS leases, bounded retries, typed results and independent QA. Never alter existing GENESIS R02 or Studio files in place.
5. Treat inability to get the source artifact through an approved connector as a concrete missing capability, not a request for the owner to paste PowerShell.

Existing draft: PR #17, GENESIS Neural Region Designer R01.
