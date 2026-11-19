# AN-0001 — Adamantium-node: graph-first Mechanicus architecture

**Date:** 2026-11-19 · **Status:** R01 design + isolated read-only projection; NOT deployed.

## Decision

Use the existing owner fork of **Node-RED 5.0.10** as **Adamantium-node**, the primary graph workbench, editor host, graph-composition UX, and optional event-flow executor for the Mechanicus ecosystem. Preserve its Apache-2.0 attribution, notices, origin and upstream update path.

**Do not** mistake Node-RED's JSON flows for the authoritative graph, its JavaScript runtime for the universal scheduler, or a drawn wire for permission to execute.

The pre-existing headless, CPU-first **Universal Graph IR** remains the authoritative typed intermediate representation, independently compiled/validated by its own MAS component. Adamantium-node owns *projections, user edits and human-facing orchestration*, not the native IR database or host credentials.

## Component graph

```text
Adamantium-node (Node-RED fork)
 ├─ Editor shell, graph projection, diff / undo, composite views
 ├─ Node-RED flow compatibility runtime (OPTIONAL)
 └─ Node/port renderer and workbench events
          | versioned read/edit projection, no implicit execution
 Universal Graph IR + Graph Manager (separate MAS apps)
 ├─ Revision/CAS, typed semantics, composition and cycle policies
 ├─ Capability Registry / policy binding (authorization at invocation)
 ├─ Task Pool → Conductor → Fixiki → QA → signed Lifecycle
 └─ Runtime selection through discovered capabilities
          | authorized typed invokes, audited and budgeted
 Independent runtime providers
 ├─ AdamantiumToolBox plugin host / Frank Addons / native / CPU
 ├─ GENESIS structural genome + brain/simulation runtime
 ├─ ALT × GENESIS weights/shards/restoration executor
 ├─ Dante sensory/motor/world/sleep/audio simulation
 ├─ WireGuard Mesh + graph network/policy adapter
 ├─ Noosphere 3.0 storage + history/provenance
 ├─ Android AI Core mobile runtime and device capability agent
 └─ Other providers: graph DNS, UI, archive, browser, server operations
```

**Authority boundaries:**
- Adamantium-node: *requested design* and editor revisions, not live state.
- Universal Graph IR: typed authoritative structure, *not* grants.
- Graph Manager: validated change plans, CAS and dependency evidence.
- Capability Registry/Policy: current signed identities, permissions and dispatch.
- Execution providers: measured actual state, supported operations and receipts.
- Noosphere and respective storage providers: independent durable state and provenance.
- GENESIS genotype/learned overlays: separate immutable and mutable lineage, **not** editor JSON.
- Adamantez private control plane: secrets and privileged implementations never enter public flows.

## Domain and edge semantics

Each adapter negotiates a versioned contract for typed nodes, port directions, graph revision, composite references and edge kind. Domains include **task, capability, dataflow, UI, network, DNS, GENESIS, ALT, Dante, storage and telemetry**; plugins may register new domains without changing the core or editor.

Edges are semantically distinct:
- `data`, `control`, `event`, `signal`: candidate executable wires only after an executor is explicitly selected and policy authorizes invocation.
- Delayed feedback is an `event` or `signal` edge with explicit `delayTicks >= 1`; the independent native compiler enforces cycle policies and runtime budgets.
- `permission`: a **policy relationship**, never a runtime wire or authorization by itself.
- `route`: desired network topology, not proof of an established WireGuard tunnel or transport privilege.
- `dependency`: orchestration metadata, not a flow message. Containment is expressed by composite `graphRef` nodes, not a Graph IR v1 edge kind.

The initial `adamantium/editor-projection.mjs` reads a **subset of the actual draft `mechanicus.universal-graph/1` JSON shape** (PR #143), producing an **inert, read-only R01 projection** with typed endpoint checks and budget guards. The native C++17 compiler + full JSON Schema validation remain authoritative. It **does not** persist editor changes, load custom nodes into Node-RED, provide full Graph IR structural validation or execute anything. This is intentional fail-closed staging.

## GENESIS contract (do not collapse the three meanings of 'graph')

1. **Structural genome** (genotype): typed genes for Transformer/MoE, neuronal regions/synapses, structural constraints, configurable regulatory rules and versioned composition. Immutable baseline, acquired overlays and experiments are different namespaces.
2. **Expression planner:** genotype + signed artifacts + compatible hardware budgets → *inert* Universal Graph IR change plan. No installation, permission, or live-agent claim.
3. **Execution phenotype:** selected authorized runtimes report actual deployed services and observed state. GENESIS, Dante and ALT are separate providers and may share genetic representations without sharing execution semantics.
4. **ALT × GENESIS weight recovery:** store blobs, compact residuals, compression descriptors, exact hashes and provenance in dedicated storage. Graph nodes contain only content-addressed references and required budgets. Loading/streaming/restoration occurs outside the UI; verification must check reconstructed tensor fidelity and measured RAM/VRAM.
5. **Learning:** observations and acquired changes flow through quarantine → reproducible QA → explicit promotion. Never promote an experimental overlay merely because a visualization rendered.

The existing genome work and native Graph IR remain independent of Node.js, Rete, Qt, Wayfire and GPUs. The Node-RED fork is the **default graphical workbench**, not a mandatory dependency of headless genotype/brain execution.

## Distributed runtime and policy

- WireGuard provides the authenticated *transport* between approved peers, not the application authorization layer. Dynamically discover logical nodes; do not hardcode private endpoints.
- Operator-approved Ed25519 node identity, typed capabilities, explicit target, scoped RBAC/ABAC, current policy digest and fresh health are required for mutations.
- `Core + one plugin` must remain functional. No direct browser shell or arbitrary Node-RED `exec` node may bypass the MAS policy path.
- CPU-first fallback. GPU/NPU/TPU are negotiated capabilities, not required dependencies. No implicit host deployment.
- Separate task leases, idempotency keys, bounded repair recursion, independent QA, audit receipts and rollback. `BLOCKED` initiates a traceable repair branch when safe and authorized; otherwise it waits for an explicit external permission.

## Migration — reversible, not a bulk replacement

| Phase | Deliverable | Acceptance |
|---|---|---|
| AN0 | Fork baseline, provenance, isolated projection contract | Upstream remains buildable; no runtime changes |
| AN1 | Native Graph IR ↔ read-only Node-RED view adapter | Typed round-trip fixtures incl. permission and delayed feedback |
| AN2 | Controlled editor diff → validated IR plan | CAS, undo, ACL and no execution from UI writes |
| AN3 | Runtime broker adapters and composable MAS node palette | Core+1 isolation, dry-run, per-invoke auth and revoke |
| AN4 | GENESIS/ALT/Dante/Noosphere/WireGuard adapters | CPU tests, separate state, checksum/provenance and host readback |
| AN5 | Shadow execution and canary switchover | Independent QA, signed Lifecycle, automatic rollback |
| AN6 | Old editor optionality/retirement | Behavioral parity and explicit owner-approved migration |

**No mass rename/deletion, no automatic activation, no production cutover in R01.** Keep a branch/snapshot of prior editors and flows, test both directions before changing a default. Node-RED source stays rebased/merged from reviewed upstream commits, never force-reset over owner changes.

## R01 verification

`node --test test/adamantium/editor-projection.test.mjs`

This tests only an inert projection prototype, not a running node editor, GENESIS brain, WireGuard cluster or actual neural weight restoration.
