# GENESIS R03 — reproducible three-region CPU circuit handoff

This branch stages a **non-elevated, pinned, reversible-by-isolation** R03 runtime for Windows. The executable engine remains independent of Node-RED, and the existing R02 implementation is reused only after verifying exact source-file SHA-256 hashes.

**Observed Windows verification (2026-11-20):** archive SHA-256 matched; R02 baseline hashes matched; 3 regions (LGN 128, V1 896, V2 160 active cells) executed 120 deterministic simulation steps and returned 2,646 total spikes; 846 delayed bridge deliveries; unchanged original genomes. A later Operator R01 invocation successfully ran all 15 regression tests and the four allowlisted fixtures: `moving-bar: 2646`, `dark: 0`, `bright: 8809`, `checkerboard: 6173`.

## Included
- `experiments/genesis/r03-runtime.zip.b64`: exactly five runtime files, encoded as Base64 for text-only, reviewable delivery through an immutable Git commit.
- `experiments/genesis/r03-circuit.test.cjs`: 15 Node.js regression tests; no external dependencies.
- `experiments/genesis/r03-handoff-manifest.json`: allowed paths, artifact size and hashes, pinned commit, R02 baseline hashes, operator commands and expected output.
- CI that checks SHA-256, ZIP entry allowlist, and regression test source hash **without executing the archive**.

## Operator protocol
1. Operator receives an owner-authorized scoped work order through JediControl or the MAS capability graph.
2. It resolves **only** the approved commit-pinned repository URL, checks the manifest and ZIP digest, rejects unexpected entries and verifies R02 source hashes.
3. It stages the runtime under a new, isolated directory. Existing installations are never overwritten; no global npm installation is performed.
4. It runs bounded CPU checks, commits the staged directory after success, and saves evidence in `deployment-evidence.json`.
5. It runs only allowlisted GENESIS Operator R01 actions with unique request IDs; writes immutable run records and updates `latest.json` for the read-only Node-RED monitor.

No Windows UAC, token changes, privileged device actions, production flow restarts, sensor access, or manually typed user commands are required for this *already authorized non-elevated scope*. Other rights require separate consent.

**Security boundary:** SHA-256 against an embedded or signed trusted manifest provides integrity, not independent publisher authenticity. Work toward signed manifests / capability-bound attestations is still pending.

**Scientific boundary:** synthetic 8×8 stimuli and current-bridge projections are test instrumentation, not physiological vision or evidence of sentience.
