# GENESIS Artifact Courier R01 — guarded, command-free delivery contract

Status: **architecture + acceptance criteria only**. Do not infer that the courier is deployed. This is additive to the already installed, owner-authorized JediControl R07 and GENESIS Operator R01. No new admin credentials, no bypass of UAC, leases, emergency stop or MAS capability policies.

## Goal

Move validated GENESIS experiments (R03 onward) from a trusted artifact origin to an explicitly approved runtime without asking the owner to paste shell commands. Provide measurable deployment evidence and keep Node-RED an editor/read-only viewer rather than a neural executor.

## Logical steps

1. **Resolve destination dynamically:** enumerate operator-approved MAS nodes and exact `artifact.stage` / `artifact.verify` / `experiment.test` capabilities. Missing capabilities fail closed. Do not silently substitute another node, fixed host, or privileged bridge.
2. **Prepare manifest:** `artifact_id`, `schema`, `source_sha256`, `size_bytes`, `content_type`, `relative_path`, `target_node_id`, `allowed_actions`, `request_id`, `valid_until` and origin provenance. The artifact hash verifies bytes, not identity. Authenticate the publisher separately.
3. **Bounded staged transfer:** split content into <=256 KiB numbered chunks; include chunk SHA-256, count, immutable request ID, explicit max size, and idempotent retry only for verified missing chunks. Do not use an arbitrary shell, public upload endpoint, or unencrypted secrets.
4. **Validate before commit:** assembled SHA-256 must match the approved manifest; archive entries must reject absolute paths, traversal, symlinks and overwrites; unpack into a versioned quarantine directory only. Validate `package.json`, Node.js engine and no postinstall scripts; execute offline tests with a timeout and CPU/RAM budgets.
5. **Atomic activation:** install a distinct immutable experiment version only after tests succeed, preserve existing R02 and work queues. If a file or runtime path already exists, return `already-present` only when content hash matches; otherwise quarantine and report conflict. Never replace Studio flow history.
6. **Observe:** produce signed/authorized execution outcome with `request_id`, target identity, runtime version, digest, test counts, time bounds and explicit failed checks. Publish only a sanitized **read-only** projection to Adamantium-node, with stale/unknown state separated from success.
7. **Recover:** on interrupted transfer restart from missing chunks; on failing tests discard staged content and keep previous runtime. On uncertain mutations, read back state before any retry.

## Operator interface

`genesis.operator.execute({operation:"test-r03", request_id:"...", target_node:"..."} )` is a **logical capability request**, not a network endpoint. Authenticated JediControl can currently run a limited allowlist on the authorized Windows desktop. The MAS graph and distributed `artifact.stage` capability are not yet proven live; do not claim full autonomous delivery from ChatGPT.

## Read-only monitor

The experimental Node-RED graph `GENESIS | 08 Operator Monitor` reads only the local `latest.json` produced by Operator R01, checks allowed action names, emits freshness and status to Debug, and does not invoke external commands. It may remain pending deployment when another writer updates Studio; use Node-RED CAS/merge, not force replacement.

## Acceptance gates

- 0 user-entered shell commands for normal authorized R02/R03 tests.
- Byte-for-byte staged R03 digest verification before extraction; exact expected digest from the prepared archive: `455d1bb7e52a049cd61cd42b8dbb1803a5b534ac46b7541f01f439a3ff9ff776`.
- R03 experimental circuit: 15 offline tests must pass; 120-step seed-42 fixture produces 2,646 synthetic spikes in the current validated implementation.
- Failure injection: missing chunk, duplicate request, corrupt chunk, corrupted zip, path traversal, mismatched target, lost lease, unavailable agent, restart during transfer — all fail closed and preserve earlier version.
- No shell elevation, credential manipulation, Device unlock, Studio restart or production Toolbox mutation without separate authorization.
- Never conflate an editor's virtual HQ500M addresses with concurrently materialized neurons.

## Evidence to date

On the authorized Windows Studio, R02 is installed and the R01 operator `test-r02` completed successfully with request ID `r02-regression-20261120-033201`. On the local isolated Node 22 environment, R03 passes 15/15 tests. The R03 archive has **not yet been delivered to Windows**, and the new monitor has been imported but is not yet verified deployed. These are distinct gates.
