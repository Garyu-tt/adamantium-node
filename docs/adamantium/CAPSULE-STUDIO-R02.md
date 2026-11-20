# Adamantium-node Capsule Studio R02 — refactor + Node-RED editor plugin

**Status:** experimental working editor plugin and source-only model. Stacked on R01 draft #23; do not merge into production until independent review. No production flows, VM121/VM122, MAS gates, JediControl services or developer schedules have been changed.

## What is implemented

### Extract selection → nested graph

Select multiple cards using Shift+click on their headings, then click **Извлечь выбранные**. The refactor preserves existing external edge identifiers, moves internal edges unchanged and rewires each crossing connection through a typed interface port on the new capsule.

- Incoming edges are exposed on **west**, outgoing on **east** by default; manual exposure remains available on **north/east/south/west**.
- Repeated cross-boundary connections to the same internal endpoint share one external tagged port, retaining separate wires outside. Distinct internal endpoints retain independent channels. Maximum 128 boundary ports. Above four visible ports per side extras are collapsed but remain independent.
- Entire graph extraction is supported (zero external ports). Recursive child-parent links are fixed after moving existing capsules. Editor change is transactional: fail-closed validation and exact rollback of the prior model state.

### Reusable graph templates

Inside a nested graph click **Сохранить шаблон**. A template captures recursive topology and references to pinned versions of language microprogram definitions; it does not duplicate their source code. Templates appear alongside definitions in the palette, can be dragged into a graph, and instantiate independent nested graph trees. Structurally identical templates are reused. JSON import checks fingerprint and budgets; invalid/missing definition references fail instead of creating incomplete components.

### Real Node-RED editor integration

Package: adamantium/plugins/node-red-contrib-adamantium-capsules

The package declares **only** an editor plugin via node-red.plugins, not a runtime node. It registers a **Capsules** sidebar panel using the public editor RED.plugins and RED.sidebar APIs, plus the action adamantium:show-capsule-studio. The tab lazily loads the already functional Capsule Studio preview from Node-RED's static /resources/ route. A full-screen editor button opens the same browser application.

The sidebar integration is real and tested in a disposable Node-RED 5 instance, but the capsule graph has **not** yet been merged into Node-RED's native main SVG canvas, Admin v2 /flows or native Universal Graph IR storage. The source in editor remains inert (nonexecuting); publication, language executors, hot swap and server-side shared catalog are future work requiring separate policy gates.

Package resources are copied from canonical adamantium/capsule-studio.mjs, capsule-extract.mjs and capsule-preview/ sources. Cross-platform tests require exact byte equality to prevent divergence. Plugin install is NOT automatic.

## Local test and installation, disposable only

From the repository branch:

~~~sh
node --test test/adamantium/capsule-studio.test.mjs test/adamantium/capsule-extract.test.mjs test/adamantium/capsule-plugin.test.mjs test/adamantium/capsule-preview.test.mjs
~~~

For a standalone preview:

~~~sh
node adamantium/capsule-preview-server.mjs 1886
~~~

Open http://127.0.0.1:1886/ on the same host.

For a **separate development Node-RED userDir** only, copy or install (with lifecycle scripts disabled) the local package directory under that userDir's node_modules. Restart only that isolated Node-RED process and reload the editor; the sidebar **Capsules** tab will appear. The plugin is statically bundled, creates no external API routes or executable flow nodes and requires no shell or MAS permissions.

## Security boundaries

- No user-provided language code is evaluated, compiled, run or transmitted by these modules.
- Full sources and graph topology are embedded in exported JSON; **never** store secrets in them.
- Browser localStorage is local to the preview origin; **not** a shared server-side library. Since the plugin is same-origin editor code, treat it as trusted editor code and do not install arbitrary unreviewed plugins.
- Node-RED native Subflows are not equivalent to four-sided typed ports. No implicit translation to deployable Node-RED flow wiring is claimed.
- Execution, permission/dependency/route edges, MAS authorization, code signing and runtime hot swap remain outside this UI module. Changes to external native IR must pass a separate authoritative validator and optimistic-concurrency gate.

## Verification

2026-11-20:
- Windows connected via owner-authorized JediControl on DESKTOP-PUHG2PP: Node.js v26.1.0 offline model/editor/plugin tests passed in the earlier 21-test iteration.
- A disposable Node-RED 5 safe-mode instance was started using only a temporary userDir and loopback listener 127.0.0.1:18976; plugin package copied to that temporary node_modules. Observed GET /resources/.../preview/index.html 200, GET /resources/.../preview/app.mjs 200, GET /resources/.../capsule-extract.mjs 200, GET /plugins 200 with plugin registered.
- Headless Chrome loaded this isolated Node-RED editor and DOM contained the rendered Capsules sidebar with the Open Graph button. Disposable instance was terminated after verification. Existing live studio at 127.0.0.1:1885 and production services untouched.
- Future acceptance gates: visual drag/drop & wire hit-testing across all four sides, native editor renderer tests, CAS save/rollback, independent Graph IR compatibility, Node 22/24 CI matrix and packaging/security review.
