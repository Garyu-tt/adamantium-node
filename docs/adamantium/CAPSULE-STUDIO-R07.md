# Adamantium-node Capsule Studio R07 — native SVG workspace lens

Status: **editor-only native SVG layer in the actual Node-RED editor workspace, source + tests**. Stacked on R06 (#37), R05 (#34), R04 (#30), R03 (#26), R02 (#25), R01 (#23). Do not merge or install on production without independent QA.

## What R07 does

The R02 plugin sidebar now exposes the action **adamantium:toggle-native-canvas** and the button **На основной SVG**. This dynamically imports a **static packaged** ES module and mounts an independent SVG group with class adamantium-native-capsule-layer inside:

    #red-ui-workspace-chart svg .red-ui-workspace-chart-event-layer

This is the very same D3-native editor scene that Node-RED uses for its grid, link and node layers, not an iframe/Canvas clone. The scene shares the native SVG coordinates and zoom transform, while its opaque draft backdrop prevents accidental pointer manipulation of the running Node-RED flow behind it. The new layer is intentionally **NOT** registered as RED.nodes objects, Subflows, native /flows data or a deployable runtime node.

The native SVG draft lens provides:
- Recursive capsules with double-click to enter; parent/root navigation and four explicit boundary portal cards.
- True four-sided typed port anchors: north, east, south, west. Plain microprogram ports default to west inputs/east outputs; capsules retain their individually exposed side choice.
- Stable individual port tags and type/semantics, separate Bézier wire geometry, direct click-to-connect with the existing CapsuleStudio exact contract validation.
- Overflow display of **+N per side**, with individual channels preserved in the layout. Expanding a side reveals the hidden tagged ports and dynamically expands the capsule card. No channel merging.
- Pointer dragging of cards with graph-scoped positions; Shift+pointerdown selection and extract-to-recursive-capsule, backed by the R02 atomic graph refactor preserving external edge IDs and contracts.
- A local toolbar with capsule creation, extract selection, navigation and close. No editor deployment shortcut.
- The same localStorage key as R01/R02: adamantium.capsule-studio.r01. Both the sidebar iframe and native SVG lens now listen for storage events for near-realtime draft synchronization across same-origin contexts. Definition versions and saved graph templates remain stored by the existing R01/R02 model.

## Source and packaging

- adamantium/capsule-native-layout.mjs — independent pure CPU-first layout projection; geometry and typed routing, no DOM.
- adamantium/capsule-native-canvas.mjs — main SVG mount, render, drag, connect, navigate and localStorage transaction layer.
- adamantium/plugins/node-red-contrib-adamantium-capsules/capsule-sidebar.html — native toggle action and lazy module loader.
- adamantium/plugins/node-red-contrib-adamantium-capsules/resources/capsule-native-layout.mjs and capsule-native-canvas.mjs — exact copies of the canonical source, verified in plugin tests.
- adamantium/capsule-preview/app.mjs and its packaged copy — sidebar live storage synchronization.
- test/adamantium/capsule-native-layout.test.mjs — geometry, cardinal sides, stable tag uniqueness, overflow, nested navigation, bounds.
- test/adamantium/capsule-native-canvas.test.mjs — isolated fake native SVG DOM, port hit testing, direct SVG connection edits, drag, extract, navigation, storage sync, model isolation and untrusted storage failure.
- .github/workflows/capsule-studio-r07.yml — cross-platform Node.js 22/24 full suite with the actual pinned C++ G0 build.

## Safety and important limitations

- The native workspace SVG group is a **separate editor visualization layer**, not a modification to the original Node-RED view.js internals or built-in Node-RED flow node objects. This avoids silently changing running graph semantics.
- The layer is **not** a deployable runtime, authoritative Core Graph Manager registry, distributed library or MAS permission source.
- Clicking port connects only editor graph model channels; no live Node-RED wiring, hot-swap or arbitrary language execution is performed. All submitted Graph IR proposals still require the independently compiled native G0 gate from R06, separate MAS policy and approval.
- Frontend localStorage is not authenticated, transactional shared storage or a security boundary. Never place secrets in microprogram source. Export/import remains untrusted JSON.
- The native layer uses DOM textContent for user-defined graph titles; no HTML interpretation, eval or dynamic code execution.
- Designed to safely render up to 1200 visible nodes in one graph. More must be viewed through a narrower query/filter/paged renderer. This limit does not change the underlying Graph IR budgets.
- Pointer-drag and click-to-connect were tested via Node.js SVG DOM mocks; real browser acceptance and deployment to live Node-RED are distinct QA gates.
- No native flow reload will implicitly change or activate this draft graph. The opaque overlay is removed by the Close button or sidebar toggle.
- The R07 native SVG layer now intercepts editor pointer events and common destructive keyboard shortcuts (including Delete) while its draft overlay is active, and removes its capturing listener on Close. Browser/extension/OS shortcuts and other editor-specific handlers still require independent real-browser QA before production use.

## Verification (20 November 2026)

Isolated Linux sparse checkout with SHA256-verified official Node.js binaries and the real pinned canonical ToolBox G0 compiled at da55544d738eca138b823175bdbc266a9efb8855:

- Node v22.16.0: **82/82 passed**, 0 skipped, 0 failed.
- Node v24.11.1: **82/82 passed**, 0 skipped, 0 failed.

These include the actual C++17 native G0 acceptance in R06 and the signed durable R05 review inbox. CI results for Windows/Linux R07 must be verified separately after workflow execution.

## Next R08 gates

1. Independent Chromium/Firefox integration test inside a disposable **real Node-RED 5 process**: verify layer attachment to native SVG eventLayer, card rendering, pointer drag under zoom, four-sided port placement and sidebar-native storage sync.
2. Native editor-wide interaction lock: prevent accidental hotkeys against selected live flow nodes while draft lens is active. If safe control hooks do not exist, implement a dedicated native workspace mode instead.
3. Introduce Graph Manager proposal status (read-only) in the toolbar, with real MAS capability identity only; do not invent network URL, permission or deployment status.
4. Add a versioned, authenticated source/template registry with per-instance references, optimistic concurrency and atomic graph revision proof.
5. After independent G0 and MAS review, design stage/dry-run/approved activation as separate transactions with pause/drain/swap/recover. No direct node execution from this UI.

Production VM121/VM122, live Windows Studio, JediControl hub and active Node-RED flows are NOT modified by this PR.
