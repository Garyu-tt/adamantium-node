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
- test/adamantium/capsule-browser-fixture.html and capsule-browser-smoke.mjs — isolated real Chromium browser acceptance on a native SVG event-layer fixture; checks cardinal port geometry, typed click wiring, nested navigation, storage and original Node-RED node sentinel preservation.
- test/adamantium/capsule-node-red-editor-cdp.mjs — reproducible Chrome DevTools acceptance against a **real isolated Node-RED 5 editor**. Requires explicit loopback editor/debug endpoints and safe-mode confirmation, and refuses a nonempty flow registry.
- .github/workflows/capsule-studio-r07.yml — cross-platform Node.js 22/24 full suite with actual pinned C++ G0 build; Ubuntu additionally requires real Chrome/Chromium smoke.

## Safety and important limitations

- The native workspace SVG group is a **separate editor visualization layer**, not a modification to the original Node-RED view.js internals or built-in Node-RED flow node objects. This avoids silently changing running graph semantics.
- The layer is **not** a deployable runtime, authoritative Core Graph Manager registry, distributed library or MAS permission source.
- Clicking port connects only editor graph model channels; no live Node-RED wiring, hot-swap or arbitrary language execution is performed. All submitted Graph IR proposals still require the independently compiled native G0 gate from R06, separate MAS policy and approval.
- Frontend localStorage is not authenticated, transactional shared storage or a security boundary. Never place secrets in microprogram source. Export/import remains untrusted JSON.
- The native layer uses DOM textContent for user-defined graph titles; no HTML interpretation, eval or dynamic code execution.
- Designed to safely render up to 1200 visible nodes in one graph. More must be viewed through a narrower query/filter/paged renderer. This limit does not change the underlying Graph IR budgets.
- Pointer drag and click-to-connect were tested in Node.js SVG DOM mocks. A separate **real Chromium 156** fixture also passed SVG cardinal rail placement, click-to-connect, nested navigation and original-flow sentinel retention. This fixture emulates the native event layer; it is **not a full running Node-RED 5 editor acceptance test**.
- No native flow reload will implicitly change or activate this draft graph. The opaque overlay is removed by the Close button or sidebar toggle.
- The R07 native SVG layer now intercepts editor pointer events and common destructive keyboard shortcuts (including Delete) while its draft overlay is active, and removes its capturing listener on Close. Browser/extension/OS shortcuts and other editor-specific handlers still require independent real-browser QA before production use.

## Verification (20 November 2026)

Isolated Linux sparse checkout with SHA256-verified official Node.js binaries and the real pinned canonical ToolBox G0 compiled at da55544d738eca138b823175bdbc266a9efb8855:

- Node v22.16.0: **83/83 passed**, 0 skipped, 0 failed.
- Node v24.11.1: **83/83 passed**, 0 skipped, 0 failed.
- Chromium v156.0.8078.79 extracted into a temporary Linux test directory; `ADAMANTIUM_CHROMIUM_BIN=/absolute/path/chromium node test/adamantium/capsule-browser-smoke.mjs` printed **CAPSULE_NATIVE_BROWSER_OK**. No system browser install, no Windows desktop session or production flow changes.

These include the actual C++17 native G0 acceptance in R06 and the signed durable R05 review inbox. CI results for Windows/Linux R07 must be verified separately after workflow execution.

## Additional Windows / JediControl proof (20 November 2026)

After the owner repaired JediControl's watchdog, the authorized VM125 relay reported desktop-01 **online**, 193 JPEG frames, shell/input/write capabilities true, emergency_status=idle, and all broker/MCP/Caddy services active. This proves reachability at the time of the check, **not** a tested watchdog crash/restart cycle.

On Windows (DESKTOP-PUHG2PP), R07 was cloned into a disposable TEMP directory. We reused the installed Node-RED **5.0.10** executable but created a separate userDir, copied only the packaged Capsule editor plugin, and initialized an empty flow registry []. Node-RED bound exclusively to **127.0.0.1:18978** and its log confirmed **safe mode; flows stopped**. Existing user flows and the active editor were not modified.

A separate Chrome **157.0.8103.78** headless profile exposed CDP only on **127.0.0.1:18979**. In the genuine Node-RED editor the test invoked the registered action adamantium:toggle-native-canvas, and verified:

- The real event-layer element existed and the packaged JavaScript resources responded HTTP 200.
- The Capsule SVG mounted inside the native event layer with **2 cards, 4 typed ports and one wire**, with runtime disabled and authority none.
- Toggling again removed the layer cleanly, leaving the native flow node count at zero.
- The Windows Node.js **26.1.0** suite found **83 tests: 78 passed, 5 skipped, 0 failed**. The skipped tests required an independent compiled native G0 binary, which was not supplied in this supplementary Windows run; the earlier full Linux Node22/24 run passed all 83.

Both temporary listeners (18978 Node-RED and 18979 Chrome CDP) were stopped and confirmed absent. The user's watchdog, active Windows session and production flows were unchanged.

The acceptance script is test/adamantium/capsule-node-red-editor-cdp.mjs. It requires explicit local target URLs, an operator confirmation flag, and an **empty** flow registry. After starting a disposable safe-mode Node-RED with no flows and an isolated Chrome debugging session, run on Windows PowerShell:

~~~powershell
$env:ADAMANTIUM_R07_DISPOSABLE_SAFE_MODE = "1"
$env:ADAMANTIUM_R07_TEST_EDITOR_URL = "http://127.0.0.1:18978/"
$env:ADAMANTIUM_R07_TEST_CDP_URL = "http://127.0.0.1:18979/"
node test/adamantium/capsule-node-red-editor-cdp.mjs
~~~

R07 is still a non-executable **native SVG overlay**, not a first-class Node-RED flow/runtime node. This real-editor acceptance does **not** prove all zoom/drag interactions, MAS Core permissions, authoritative graph promotion or production hot swap. Do not auto-merge or deploy.

## Next R08 gates

1. Independent Chromium/Firefox integration test inside a disposable **real Node-RED 5 process**: verify layer attachment to native SVG eventLayer, card rendering, pointer drag under zoom, four-sided port placement and sidebar-native storage sync.
2. Native editor-wide interaction lock: prevent accidental hotkeys against selected live flow nodes while draft lens is active. If safe control hooks do not exist, implement a dedicated native workspace mode instead.
3. Introduce Graph Manager proposal status (read-only) in the toolbar, with real MAS capability identity only; do not invent network URL, permission or deployment status.
4. Add a versioned, authenticated source/template registry with per-instance references, optimistic concurrency and atomic graph revision proof.
5. After independent G0 and MAS review, design stage/dry-run/approved activation as separate transactions with pause/drain/swap/recover. No direct node execution from this UI.

Production VM121/VM122, live Windows Studio, JediControl hub and active Node-RED flows are NOT modified by this PR.
