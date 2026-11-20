# GENESIS R05 — Development Planner (bounded shadow phenotyping)

An isolated CPU-first experiment for Dante's brain-region construction. A region is a **genetically described phenotype**, distinct from the population of materialized neurons running on CPU.

**R05 is not yet live neurogenesis.** It compiles a shadow three-region circuit for a new active-neuron budget and checks the exact structural diff without changing a running circuit. A safe commit is allowed **only at tick 0 on an untrained circuit with no queued events**. Existing learning and physiological state never migrate silently. After a simulation begins, topology changes are **preview-only**, not hot-swapped; rollbacks after new execution begins are refused. R04 runtime policy changes remain a separate feature.

- Compiler: reused and independently versioned R03 LGN/V1/V2 sparse neural solver (bundled, non-networked).
- Genotype: only immutable references; population counts and synapses are newly materialized from deterministic seed.
- Audit: stable synaptic identity = projection + source population/local neuron address + target population/local neuron address + kind + delay.
- Preview: old/new active cells, retained/new/dropped connections, changed learned synapses at risk, resource estimates, genome hashes and checkpoint anchor.
- Apply: SHA-256-bound CAS proposal, one staged revision, fail-closed on pending changes, stale source state or attempted loss of learned state.
- Revert: only immediately after commit before executing even one tick.
- Safety: no camera, microphone, Windows UAC, GPU requirement, network listener, Node-RED restart, model training, production migration or VM change.
- No synthetic synapses are claimed as anatomical measurements; active V1 1024 still belongs to a virtual region of 1,000,000 neurons and HQ500M virtual address cap.

## Reproduce

With Node.js >=22:

```sh
npm test
npm run demo
```

Expected example: initial 896 active V1 cells, preview a new 1024-cell V1 phenotype, explicitly show discarded/added synthetic connections, commit at tick 0, run a deterministic 120-step visual stimulus. A separate unit test ensures attempting structural commit **after** computation has started fails without mutation.

## Future work

To perform genuine live growth, implement stable neuron UUID and synapse IDs across revisions, atomic neural-state + synaptic-weight migration for each independent region, queue drain/suspend, typed bridge remapping, reversible state conversion, zero-loss proof and full rollback checkpoints. Do not remove the tick-boundary safety rule until those tests exist. In the meantime, the existing R04 acquired-genome store remains the canonical exact learned-weights record for a fixed topology.
