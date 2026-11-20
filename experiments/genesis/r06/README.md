# GENESIS R06 — append-only live-growth migration for Dante's experimental V1

**Status:** locally tested CPU-only prototype; not a production deployment or physically calibrated neural tissue. No Windows installation has been performed for R06. Designed for Node.js ≥22 without external dependencies, servers, network sockets, hardware sensors, or UAC.

## Why R06 exists

R05 honestly blocked live structural changes: a fresh compiler dropped 2,300 of 3,500 existing three-region synapses and would have removed 320 of 591 connections whose weights had changed through plasticity. Merely changing the number of active cells is **not** safe neuron growth.

R06 implements **append-only growth** of an already-active R03 circuit. A graph revision is compiled separately at the same deterministic seed, then source neuron identities, source synapse identities, learned weights, all dynamic neuron arrays, synaptic ring buffers, internal and inter-region queued events and source genome hashes are transplanted into a new circuit object. Only then can the single-threaded host atomically replace its circuit reference at a tick boundary. No pruning is attempted or permitted.

### Stable identities

- Neuron ID: `population.id@localOrdinal`, not the raw Float32Array offset, which changes when population counts change.
- Synthetic synapse ID: `projection | source-neuron-ID | target-neuron-ID | neurotransmitter-kind | delay`.
- For pre-existing edges, preserve **original insertion order** and numerical weights; only brand-new target edges are appended. The original 896-cell V1's 2,343 edges are all retained rather than just the 1,200 that happened to survive a fresh recompile.
- The native 500,000,000-cap virtual address space is unchanged; a 1,000,000-neuron virtual region is **not** materialized in full.

## Verified 120-tick default experiment

| Metric | R06 result |
| --- | --- |
| Source V1 active cells | 896 |
| Grown V1 active cells | 1,024 |
| V1 inherited synthetic synapses | 2,343 / 2,343 |
| New V1 synthetic synapses | 2,981 |
| Removed V1 synthetic synapses | 0 |
| Changed synapses in entire original circuit | 591 |
| Changed V1 synapses maintained by exact ID | 329 / 329 |
| Changed synapses at risk under naive R05 rebuild | 320 |
| Outstanding local synaptic delay-ring events moved | 196 |
| R04 queued sensory frames used in integrated test | 3 |

This is an **engineering** preservation criterion. A real living brain does not evolve by simply keeping all synthetic contacts and appending random connections, and migration alone does not establish learning or cognition.

## API and consistency

- `LiveGrowth.stage({id,base,active_v1,genome_hashes})`: CAS-anchored, validates genotype, constructs a separate candidate and returns a hashed plan with learned-state loss avoided.
- `LiveGrowth.commit(plan.sha256)`: refuses stale source state, altered candidate, unsafe target, or wrong plan hash; swaps a **local JS pointer**, not distributed state.
- `LiveGrowth.rollback()`: permitted only before any new tick or mutation; otherwise requires explicit snapshot recovery.
- `LiveGrowth.snapshot()` / `LiveGrowth.resume(record)`: complete structural topology plus native neuronal checkpoint; validates identity, schema and hash. R03 checkpoint alone cannot replay grown topology because it lacks a structural edge manifest.
- `LiveSessionGrowth`: compatible with R04 `DanteSession`, including queued typed frames and runtime revision/reward policy. Rebinds stream and revision-manager circuit references. Independently validates R04 event checksums, ordering and reward-policy binding.

**Safety boundaries:** No hidden promotion to production, no hot swap of neuron topology across threads, processes, network hosts, or GPU; no pruning; no outside data acquisition; no claims about hardware or biological equivalence. The SHA-256 integrity record is not a cryptographic publisher signature and does not authenticate who authored a checkpoint.

## Reproduce

```bash
node --version              # >=22
npm test                    # all new and prior version regressions
npm run demo               # one synthetic migration, queued-sensor replay, printed JSON evidence
```

`node cli.cjs demo --out <new-directory>` optionally publishes a create-only JSON evidence file and complete topology checkpoint. An existing destination causes a fail-closed error. This demo does not alter R03/R04/R05 installation folders.

## Next

- GENESIS R07: growth constraints, staged neuron/synapse maturation and homeostatic rebalancing (not immediate fully connected insertion).
- Durable version history in Noosphere with independent copy, provenance and signed manifest.
- Distributed cross-node two-phase quiescence / coordinated snapshots before any multi-host change. Do **not** describe the present local pointer swap as distributed atomicity.
