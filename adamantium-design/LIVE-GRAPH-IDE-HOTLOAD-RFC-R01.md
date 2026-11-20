# RFC AN-LIVE-IDE-R01 — Realtime graph IDE, hot-load and AI-first contract
Status: **PROPOSAL / NOT IMPLEMENTED / NOT DEPLOYED**  
Date: 2026-11-20  
Base: upstream Node-RED 5.0.10 fork; current `main` remains unchanged.

## Problem and design intent

Adamantium-node is the **visual graph workbench and optional Node-RED flow runtime** of Mechanicus, not the authoritative executor or permission system for all other domains. The native, CPU-first `mechanicus.universal-graph/1` stays the source of typed structure. MAS Core owns permissions and lifecycle; Graph Manager owns projections; plugin owners own mutable domain state. Nodes, graphs and plugins must all be dynamically discoverable under authorized capabilities.

Non-negotiable user experience: **watch a graph execute, edit it concurrently, add node definitions and plugins dynamically, and let agents work without a GUI click bot**.

## 1. Separate authoring from execution

- **GraphDefinition**: stable identity, nested definitions, typed named input/output ports, node references, typed execution/semantic edges, pure versioned configuration. Execution edges: data/event/control/signal. Semantic edges: dependency/permission/route; never silently executable.
- **GraphRevision**: immutable source content hash, expected parent revision, author, signed provenance, test evidence, dependency lock and approval metadata. Layout and selection are separately versioned.
- **RuntimeDeployment**: exact graph revision + artifact hashes + host placement + policy digest + monotonic epoch, not a moving `latest`.
- **ExecutionInstance**: pinned runtime revision, progress cursor, causal trace, queues, checkpoints, pending side effects and state schema version.
- **NodeDefinition**: content-addressed, reusable palette item with language, ABI, typed ports, capability manifest and semantic version.
- **NodeInstance**: graph-scoped configuration and state reference. Definition updates **never** silently rewrite instances.

A collapsed node can open by double-click into recursively nested graph space; expose named ports across container boundaries. Keep breadcrumbs, recursive search, graph-level tests, reusable node palette and lazy loading. A nested container does **not** imply a Node-RED Subflow is sufficient for every domain.

## 2. Live authoring and conflict model

- Live UI presence, cursor and layout can use CRDT synchronization (e.g. Yjs), but canonical graph mutations require **CAS/ETag**, schema validation, authorization and an append-only change log.
- Graph editing is allowed while Rn executes; users edit draft Rn+1. Changes are displayed immediately, but they **do not** mutate live executor code until a verified commit.
- Agent-facing transactional API concepts: inspect, query, create draft, apply typed patch with expected revision and idempotency key, validate, test in isolated harness, explain semantic diff, propose deployment, request approval, commit, inspect deployment receipt, rollback. Exact MAS actions must be dynamically advertised; no hardcoded backend URLs or unauthorized generic shell.
- Native Node-RED Admin API v2 `GET /flows` + `POST /flows` supports revision conflict (409) and deployment scope `nodes`/`flows`/`full`/`reload`; preserve this for Node-RED flows. It does **not** grant cross-domain or MAS authority.
- Running and edited revision badges, branchable timeline, multi-user role ownership, peer-review handoff, merge conflict diff, and a live change impact preview.

## 3. Safe real-time executor / hot swap

Change pipeline:
1. Draft Rn+1 -> typecheck cycles (zero-delay signal loops rejected by native validator), capability/policy check, dependency lock and static checks.
2. Build immutable versioned artifacts; test in disposable sandbox with no privileged credentials or uncontrolled egress.
3. Optional shadow replay with side effects muted, compare output/metrics. This is a preview, not production approval.
4. Stage new workers next to old workers; checkpoint/serialize state when migration schema exists, otherwise drain old instances and start **new** instances on Rn+1.
5. Change routing at a controlled boundary with fencing epoch and source readback; keep existing in-flight work pinned to Rn as needed.
6. Monitor canary, rollback routing to Rn on failure, preserve audit and old artifacts.

**Do not claim global ACID transactions across multiple machines.** Use idempotent outbox, leases, compensation for irreversible side effects, and explicit state-transfer policy. A process crash or remote network partition must not produce two authoritative writers.

## 4. Hot-loaded node and plugin architecture

- Discovery from approved signed plugin registry + exact owner policy. Runtime must run with **Core + thin bridge alone**; every other plugin is optional.
- Immutable NodeDefinition artifacts with manifest, source hash, supported runtimes and ports. New definitions can appear in the palette immediately without restarting the whole IDE.
- Isolated workers for JS/TS, Python, Rust/C/C++/Go via approved build or WASM, optional Frankenstein and other local languages. Per-language runtime is optional; never force GPU or arbitrary root shell.
- Versioned worker processes permit loading updated code side-by-side then swapping selected instances. Native Node-RED can install new palette modules via Admin API; it cannot universally unload and reload an already imported JS module safely. Do not promise true in-process hot reload.
- Quarantine/untrusted packages, dependency and SBOM scan, deny by default for filesystem/network/exec/secrets, CPU/RAM/time/output quotas, package lifecycle scripts disabled unless explicitly approved.
- Per-plugin activate/deactivate/upgrade/rollback with manifest compatibility tests. Sensitive private plugins stay behind AdamantezTolls/Adamantez gateway; no private server source or credentials in public palette packages.

## 5. Debugging, observability, and resource placement

- Live edge pulses; throughput, backpressure, queue length, latency p50/p95/p99, retries, errors, worker CPU/RAM and optional accelerator usage per node.
- Breakpoints, step, pause, watch variables (redacted), synthetic input injection, causal trace, isolated deterministic replay and graph-level unit/integration/property tests.
- Trace capture has quotas, retention and PII/secret filtering. Replay never replays external writes accidentally.
- Graph placement lens: WireGuard overlay path, node availability, locality, cost and latency, failover readiness. An edge showing a permission relationship must never implicitly confer permission.
- CPU-first distribution; optional GPU/NPU workers announced via independently authorized capability registry; every workload has a CPU fallback or a clear unsupported result.

## 6. AI-first ergonomics (no reliance on screenshots)

- Typed JSON Schemas / semantic node catalogue / source maps / typed error messages and revision tokens.
- `graph.explain`, `graph.diff`, `graph.search`, `graph.plan`, `graph.patch`, `graph.test`, `graph.preview`, `graph.deploy`, `graph.rollback` are **design-level operations**, not claimed existing endpoints.
- Every action returns actual evidence, execution status and correlation ID. No “done” for merely claimed/drafted work.
- Natural language -> explicit task DAG -> graph patch candidates; parallel agent peers and independent QA. Failures spawn bounded diagnostic/repair subtasks with proven fix receipts, not infinite retry.
- Human view and agent view share one authoritative state; compact semantic diffs minimize token use. Two-sided edits use CAS and visible conflicts.
- Plugin-created editor tools expose capabilities and permission-filtered documentation dynamically; avoid hardcoded per-plugin UI assumptions.

## 7. UX enhancements

Infinite canvas with level-of-detail virtualization, nested drill-down, breadcrumbs, quick search and cross-graph jump, re-usable node palette, rich typed-port autocomplete, inline multi-language editor/LSP, minimap, split canvases, outline, keyboard command palette, auto-layout, dependency impact heatmap, meaningful resource themes and responsive Android AI Core companion. Theme tokens are centralized; no hardcoded visual identity.

Domain lenses: program, neural, infrastructure, UI, tasks, network, general. Lenses only project data unless an independent authorized edit contract exists.

## 8. Strict distributed/plugin boundaries

- Node-RED editor is optional. Authoritative IR and GENESIS genotype/phenotype/ALT weights remain usable without Node.js.
- Graph Manager is **not** Task Pool state owner; Orchestrator owns workflow execution. Noosphere owns persistence, provenance and temporal records.
- Adamantium AI Core is a phone runtime + capability gateway, not a renamed Toolbox. WireGuard underlies the private virtual LAN; never grant permissions merely because a node joins the tunnel.
- Agent-staged changes require approved MAS Lifecycle identity/policy gates. Read-only observer proofs and Ed25519 witness receipts do not themselves authorize module installation or production execution.

## 9. Priority and measurable release gates

**P0 | Foundation:** dedicated isolated server stage, upstream compatibility baseline, signed node definition format, typed port schema, Node-RED v2 CAS adapter, real-runtime smoke and rollback test; no production changes.

**P1 | Editor:** recursive graphs, definition/instance catalog, keyboard/palette search, agent semantic API, live execution telemetry (read-only).

**P2 | Runtime:** isolated workers, hot-load *new* node definitions, targeted graph re-deploy, safe worker-version hot swap for stateless instances, stateful migration contract, canary/rollback.

**P3 | Distribution:** MAS capability routing, WireGuard network/placement visualization, multi-host execution leases and fencing, collaboration, causal replay and CI evidence.

**P4 | Domains:** GENESIS/ALT, Dante, Noosphere, Android AI Core, infrastructure/DNS and UI lenses through independent optional plugins.

Acceptance must prove: a running test graph stays responsive while editing a new revision; stale revision produces 409; adding an approved new node definition becomes visible without editor restart; new code changes don't alter old pinned instances; failed worker/canary reverts cleanly; secret-bearing and permission edges remain non-executable; partial network outage never authorizes unknown host execution.

## Node-RED upstream references

- https://nodered.org/docs/api/admin/methods/post/flows/
- https://nodered.org/docs/api/admin/methods/post/nodes/
- https://nodered.org/docs/user-guide/editor/workspace/subflows
- https://nodered.org/docs/user-guide/runtime/configuration
- https://nodered.org/docs/api/hooks/install/

## Honest current status

As of the review, fork `main` is based on Node-RED 5.0.10 and these features are mostly separate draft PRs. This RFC records design intent, **not** live deployment, tested hot-swapping or a grant to merge existing draft branches.
