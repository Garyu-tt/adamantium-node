# Adamantium Construct R01 — Graph Builder and Q Menu

Status: experimental, editor-only, stacked on Capsule Studio R02 (PR #25).
This branch does not deploy or modify any live flow, VM121/VM122 or MAS permission.

## UI
- Open Capsule Studio preview, press Q outside text fields, or click Q · Конструктор.
- Search definitions and recursive blueprint templates; choose Instance or Independent Fork.
- Shift+click a card to select, then duplicate; create a reference-view alias of the same original node identity; auto-connect two selected nodes; or atomically delete microprograms and their edges.
- Safe auto-connect only chooses one unique pair of ports with identical semantic and data type contracts. Ambiguous routes fail.
- Construct metadata joins browser localStorage and JSON import/export. Legacy R02 JSON without this metadata remains supported.

## Reuse modes
- INSTANCE: unique instance ID/config, common immutable pinned definition/version. Not shared runtime memory.
- FORK: unique definition ID and copy of the pinned source and ports. Version lineage is independent, origin tracked.
- VIEW: alias record to the exact existing graph + instance ID, no second execution; target deletion blocked until alias removed. A second visual card is not implemented yet.
- TEMPLATE INSTANCE: new recursive subtree, shared pinned microprogram definitions; captured template origin tracked.
- TEMPLATE FORK: independent recursive subtree and independently forked definitions; the new subtree shares identical definitions only internally.

The tracked template instance is pinned, not live-updated when the template changes. True linked-template migration/diff, shared runtime instances, and copy-on-write GPU/CPU weights are later stages.

## Editor-only construction API
The ConstructEngine accepts CapsuleStudio and CapsuleTemplateLibrary, and supports:
- apply: bounded atomic structural mutation (max 128 commands) with local revision compare-and-swap and exact snapshot rollback.
- preview: dry-run on deep-restored copies; originals never mutate.
- command batch references @0, @1 etc to previous step's newly created instance IDs.
- addRule / dispatch: explicit, opt-in bounded event rules with event replay deduplication; a real Node-RED event adapter is not yet subscribed.
- snapshot / restore: metadata format adamantium.construct/1 with validation and budgets.

Commands: place, capsule, template, duplicate, remove, connect, auto_connect, disconnect, alias, unalias.
Deleting a capsule subtree is intentionally rejected until explicit migration is implemented.
No user code execution, JavaScript eval, shell access, Node-RED runtime nodes, deploys or MAS grants.

## Security boundary
Q Menu operates in existing Capsule Studio preview, not native main SVG Node-RED canvas.
Browser localStorage is not encrypted server-side library; exports may contain source code and must not include secrets.
CAS here protects only the isolated Construct model, not authoritative Universal Graph IR or MAS Graph Manager.
A future remote adapter must pass capabilities, signed trust, bounded plans, version control, audit and rollback, and independently reviewed acceptance before deployment.

## Tests
Run offline with built-in Node.js test runner:
  node --test test/adamantium/capsule-studio.test.mjs test/adamantium/capsule-extract.test.mjs test/adamantium/capsule-plugin.test.mjs test/adamantium/capsule-preview.test.mjs test/adamantium/construct-engine.test.mjs
Preview server:
  node adamantium/capsule-preview-server.mjs 1886
Do not install on a production userDir. For real Node-RED plugin smoke use a disposable safe-mode userDir only.

## Reactive editor example (R01)
In the Q menu a definition has an Auto + toggle. When enabled, creating a new nested capsule from the Capsule Studio toolbar creates that capsule and its configured source-only microprogram in one atomic batch. The rule uses the typed placeholder @event.graphId and resolves it to the new child graph; event replay is deduplicated. These are Capsule Studio UI events, NOT Node-RED production tab events or runtime events. No automatic deploy occurs.
