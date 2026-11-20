# GENESIS R04 — independent typed-sensory / acquired genome / runtime revision prototype

This package is **not** a calibrated brain model. It is a CPU-only, offline experimental extension of GENESIS R03. No external sensor, camera, network service, privileged host capability or Node-RED execution is provided.

## Contracts
- `mechanicus.sensor-frame/1`: exactly 64 finite normalized float values, typed synthetic source, channel, contiguous tick and monotonic sequence plus SHA-256. Bounded queue, rejects duplicates/gaps and invalid/hardware sources.
- `mechanicus.acquired-circuit/2`: lossless *synaptic weight* overlays from R03, bound to seed, genotype checksums, original baseline synapse weights and topology. Saves to immutable create-only JSON; applies only to a fresh, matching circuit. This is **not** a complete neuronal memory or checkpoint.
- `mechanicus.dante-session-checkpoint/1`: replayable full checkpoint (neuronal state, queued frames, genomic fingerprints, and runtime policy). Rejects pending policy transactions, corrupt hashes and incompatible circuit revisions.
- `mechanicus.neural-runtime-revision/1`: allowed `reward` and `sensory_gain` runtime policy changes after a tick. Does **not** replace topology, edit chromosomes, or hot swap neural code.

### Usage
`node --test test/*.test.cjs`
`node cli.cjs demo --pattern moving-bar --steps 120 --id local-r04-test --out <new-output-directory>`

All R03 source is vendored under `vendor/r03/` unchanged for isolated tests; canonical R03 and Node-RED are not modified. Overwriting existing acquired snapshots or summary names is rejected. For exact continuation, `lib/session-checkpoint.cjs` captures the R03 neuronal checkpoint, the bounded sensor queue, and the runtime revision in one independently verified record. Acquired overlay alone is not a checkpoint.

SHA256 detects accidental corruption only. No cryptographic publisher signature, signed capability tokens, actual 8×8 camera input or distributed WireGuard ingress is shipped. Model results remain toy computation.
