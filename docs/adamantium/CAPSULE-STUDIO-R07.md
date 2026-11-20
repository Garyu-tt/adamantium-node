# Adamantium-node Capsule Studio R07 — native SVG workspace lens

**Status: source implementation + DOM/controller unit tests.** Draft stacked on R06 (#37) → R05 (#34) → R04 (#30) → R03 (#26) → R02 (#25) → R01 (#23).

## Integrated native editor layer

R07 adds an opt-in **editor-only SVG overlay inside the actual Node-RED workspace**. It shares its SVG coordinates, zoom and pan. It is **not** an executable native Node-RED flow node, nor is it serialized to /flows. This distinction avoids mistaking symbolic typed capsule wires for unvalidated Node-RED runtime links.

Changes:

- packages/node_modules/@node-red/editor-client/src/js/ui/view.js: emits viewRedrawCanvas after native redraw with nodeLayer, linkLayer and active workspaceId. The existing native node/link renderer is unchanged.
- packages/node_modules/@node-red/editor-client/src/js/hooks.js: declares that extension hook.
- adamantium/capsule-canvas-geometry.mjs: pure geometry for north/east/south/west rails, typed per-tag named ports and Bézier wires. Collapsed +N ports preserve independent names. Hidden wires are counted, not merged to shared anchors.
- adamantium/capsule-native-canvas.mjs: mount two editor-only SVG groups in the native workspace. Header drag, Shift+click select + atomic Extract, double-click into nested graph, Back, Add Capsule, Refresh; two-click port connect with typed direction/semantics/dataType validation. Original native Node-RED flow nodes and links remain untouched. Disabled by default, pinned to one native workspace tab.
- adamantium/plugins/node-red-contrib-adamantium-capsules/capsule-sidebar.html: adds Основной SVG / Скрыть SVG buttons and actions, loads ES module lazily. Original R02 iframe remains.
- adamantium/plugins/node-red-contrib-adamantium-capsules/resources/canvas.css: scoped Node-RED theme-token styling. ES module and geometry files are packaged byte-for-byte.
- adamantium/capsule-preview/app.mjs: synchronizes localStorage cross-window updates without overwriting an active form; the main canvas reloads sidebar edits too.

## Development-only instructions

Build the R07 **forked Node-RED editor client**, including the new viewRedrawCanvas hook. Installing just the plugin into stock Node-RED is NOT sufficient for the R07 native canvas. Install the local editor plugin only in an isolated development Node-RED userDir, with lifecycle scripts disabled.

Open Capsules tab and press Основной SVG. The two SVG groups mount in the real native view. Скрыть SVG removes only those groups. Move cards by header, double-click a capsule to enter it, Back to return, Shift+click headers and Extract to refactor, click named ports on two nodes to add a typed edge. Click +N to expand extra ports; edges to collapsed ports are hidden and counted, never aliased or silently rewired.

State is localStorage key adamantium.capsule-studio.r01 shared with the original R02 sidebar. Full source code of microprogram definitions is included in local state, so never store secrets there. Corrupted/unavailable local data makes persistence fail closed; repair/import through the Sidebar rather than silently overwriting archives.

The initial demo appears around x=1100..1780, y=220 in the 8000×8000 native canvas. Pan/scroll if it is outside the viewport. Automatic viewport centering and real Node-RED workspace-tab creation for each subgraph are not delivered yet.

## Verification

- test/adamantium/capsule-canvas-geometry.test.mjs: four-sided anchor geometry, independent typed channels, overflow visibility and fail-closed bad edges.
- test/adamantium/capsule-native-canvas.test.mjs: deterministic fake SVG DOM integration, native flow sibling preservation, drag, selection/extract, nested navigation, port click-to-wire, corrupt storage and cross-workspace isolation.
- test/adamantium/capsule-plugin.test.mjs: package resource byte identity and native canvas toggle actions without regressions in Sidebar.
- .github/workflows/capsule-studio-r07.yml: pinned canonical native G0 C++17 build and CTest with Linux/Windows Node 22/24, full R01–R07 regression and modified native view syntax validation.

Linux reference test with the true canonical C++ G0 compiled from ToolBox commit da55544d738eca138b823175bdbc266a9efb8855: **80/80 tests passed with Node 22 and 80/80 with Node 24**, including real C++ gate tests. These controller tests use a simulated SVG DOM, not an independently observed real Chrome interactive acceptance. Rebuilding the complete R07 Node-RED editor and testing on a real browser is still a release gate.

## Safety and remaining work

The overlay is genuinely inside the native SVG node/link layers, but does NOT create or deploy ordinary Node-RED runtime nodes, does NOT call /flows and does NOT submit Graph Manager proposals automatically. Actual MAS authentication and authorization remain a separate prerequisite; review receipts do not activate graphs. Main SVG authoring integration is a distinct, local-only presentation layer.

No production VM121/VM122, live Windows Studio, WireGuard topology, MAS policies or agent prompts modified. Keep draft, no auto-merge.

R08: map these first-class visual capsule entities onto a durable, authoritative Graph IR revision store under real Core/MAS capabilities. Add undo/redo, typed keyboard links, browser acceptance for all four rails, and independently authorized activation with stop/drain/swap/rollback proof.