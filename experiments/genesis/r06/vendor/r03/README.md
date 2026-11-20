# GENESIS R03 — Dante three-region synthetic sensory circuit

CPU-first deterministic experimental circuit **not a real neural tissue model**. No cameras, microphones, network endpoints, MAS privileged actions, private data, hardware sensors or clinical applications. This R03 experiment uses the independently installed R02 solver as a version-pinned code snapshot (`lib/neural-engine.cjs` and the shared R01 region contract) and runs it within three small neural regions.

- LGN: 128 active synthetic excitatory/inhibitory neurons of 20k virtual addresses.
- V1: 896 active cells from the already-validated genome, within a million addresses.
- V2: 160 active synthetic cells of 50k virtual addresses.
- A synthetic 8×8 grayscale fixture drives LGN. Three typed **current-bridge** projections route counted spikes: LGN→V1 L4.E, V1 L2.E→V2, and V2→V1 L6.E. This is *not* simulated long-range axonal physiology, and unmodeled thalamic and cortical regions remain explicit limitations.
- Replay checkpoint includes all engine state, queues and genome-hash verification. SHA-256 detects accidental changes but is **not** a signature.
- All inherited genome descriptors are immutable in execution; acquired synaptic deltas remain separate.
- `Node-RED` remains a visual editor and read-only telemetry client. It does not execute or own neuronal states.

Node.js >=22, no npm dependencies.

```bash
npm test
node cli.cjs demo --steps 120 --seed 42 --pattern moving-bar --out out/summary.json --trace-out out/telemetry.jsonl --checkpoint-out out/checkpoint.json
```

Available fixture modes: `moving-bar`, `checkerboard`, `bright`, `dark`. Inputs must be validated arrays of exactly 64 `[0,1]` floats, not raw image/camera streams. Overwrites are refused. Checkpoints cannot be reused with different genome hashes, seed, pattern, or computational budgets.

All neuron models and chemistry are approximate: this is an instrumentation prototype, not realistic vision, sentience, awareness, or cognitive function. No need for GPU, no remote host assumptions. The next milestone is a signed artifact/adapter contract, Graph Manager rights checks, valid sensory-to-neuron encoding, and optional distributed transport (WireGuard) without giving the editor privileged host access.
