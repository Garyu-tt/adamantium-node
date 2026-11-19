# AN-WB-0001 — One graph workbench, multiple specialized lenses

**Status:** Isolated read-only R01 proof of presentation contract. Not wired into the Node-RED UI; no runtime, grants, deployment or browser acceptance.

## Goal

Treat the existing Node-RED fork as the *tool blank*, not the universal backend. Sharpen its workbench into focused visual tools, each operating on the same versioned, authoritative **mechanicus.universal-graph/1** projection. Keep native Graph IR, Graph Manager, MAS authorization, GENESIS, ALT, WireGuard and storage out of the editor runtime.

## Lenses

| Lens | Typical work | Highlighted node kinds |
| --- | --- | --- |
| `program` | functions and composites | capability, composite, service |
| `neural` | brain regions / GENESIS, sensors and effectors | brain-region, sensor, effector |
| `infrastructure` | devices, WireGuard topology, resources and policies | device, service, resource, policy |
| `interface` | UI structure and modular applications | view, composite |
| `tasks` | tasks, agents and recursive blockers | capability, service, composite |
| `general` | mixed graphs | capability, composite, service |

`genesis` and `neural` source domains default to the neural lens. `tasks` is an **explicit presentation lens** until the canonical Graph IR schema adds a task domain; do not fake a new source domain. Plugin-defined lenses require a future independently versioned registry, validation and sandboxed rendering. No hardcoded color hex values: UI uses semantic `graph.node.*` and `graph.edge.*` tokens, to be mapped by an eventual theme provider.

## Actual R01 contract

`createWorkbenchView(readOnlyProjection, {lens:'auto'})` consumes the output of `createReadOnlyProjection` in PR #1. It emits an inert, allow-listed view: nodes, port types, visual emphasis, semantic style token names, four potential flow-connection semantics, and three separate relationship semantics.

- `data/control/event/signal` → `flowEdges` **visual layer only**; not executable by the view.
- `permission/dependency/route` → `relationshipEdges` **visual layer only**; never Node-RED runtime wires or grants.
- Fail-closed checks on source schema, domain, size budgets, node/port identity, edge endpoint and semantic typing.
- Extra input metadata (including possible secrets) never passes through.
- Every output has `mode: read-only`, `executionEnabled: false`, `authorizationGranted: false`.

## Next sharpening passes

1. Node-RED editor adapter: mount this view in a dedicated, isolated pane; test visual pinning, diff/undo, pan/zoom and large graph virtualization.
2. Dynamic lens registry: plugin-provided views and renderers, signed manifests, semantic design tokens, and backward compatible palette adapters.
3. Typed edit plans: editor proposal → Graph Manager validation/revision CAS → policy authorization → independent executor receipt; distinguish designed/desired/observed state.
4. Composite hierarchy: graph-of-graphs drilldown, recursive references, navigation breadcrumbs, and stable IDs; no flattening of genome weights, memories or secrets into Node-RED flows.
5. Independent browser QA with permission/route overlays, source revision races, disabled runtime by default, and unchanged upstream build.

## Verification

`node --test test/adamantium/workbench-lenses.test.mjs`

Passing the isolated unit tests does **not** establish production editor integration, full native IR validation, runtime safety, or compatibility with untested browser versions.
