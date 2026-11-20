# Adamantium-node — Capsule Studio R01

Status: **experimental isolated authoring preview**; **not** an installed Node-RED editor patch, runtime, MAS plugin or approved executable. Based on the draft foundation branch; do not merge/deploy without independent review.

## Goal

One card can contain an independent graph. Double-click the capsule to enter; choose any of four boundary cards (north/east/south/west) or breadcrumbs to return. Exposing a tagged internal port on a boundary automatically projects a corresponding external port onto the parent capsule. Ports have stable IDs, direction, data type and data/control/event/signal semantics. No physical execution path is synthesized.

A palette stores **definitions**, never duplicated code. Reusing a definition creates distinct **instances** with pinned versions. Selecting a previous definition from the palette or dragging it into the canvas adds an instance without copying source. New definition registration detects structurally identical code + language + typed ports. Versions coexist; existing instances do not update automatically. Favorite and Used filters are derived from real instances.

## Included

- adamantium/capsule-studio.mjs: dependency-free editor model with recursive capsules, four-sided boundary projection, identity-safe tagged connections, max-four collapsed visible ports, deduplication, version pinning, favorite/used catalog, validation and JSON snapshots.
- adamantium/capsule-preview/index.html + app.mjs: functional browser UI (canvas, draggable cards, double-click navigation, sidebar palette, code/port editor, two-click wiring, expose-to-boundary dialog, source-only languages, browser-local storage, explicit export/import).
- adamantium/capsule-preview-server.mjs: *only* local 127.0.0.1 static source server; fixed route allowlist; no privileged APIs, executable code, uploads, or network listeners beyond localhost.
- test/adamantium/capsule-studio.test.mjs + capsule-preview.test.mjs: 11 Node built-in offline tests.
- .github/workflows/capsule-studio-r01.yml: Windows/Linux Node 22/24 checks.

## Start an isolated preview

Node.js >=22.9 installed:

~~~shell
node adamantium/capsule-preview-server.mjs 1886
~~~

Open **http://127.0.0.1:1886/** on the **same computer**. This is deliberately not reachable through WireGuard, another device or production ingress.

Demo: JSON Parser Python and Event Router Rust share a canonical definition library; a third parser is inside a nested capsule. The source code is *not run*. It is an input artifact for a future approved language/compiler executor.

To define a new language node, click **+ Микропрограмма**. Specify a language ID (python, cpp, rust, frank, etc.), source code and one port per line:

~~~text
data input core.json@1 data
result output core.json@1 data
error output core.error@1 event
~~~

Click **+** in the palette to reuse it. Click **v+** to publish a new version without migrating existing instances. Click a port and then a compatible port on another card to connect. Inside a child graph use **↗** next to a port to expose it on a selected side.

Storage is **localStorage** on the preview origin; export/import produces a self-contained JSON model including full source code. **Never put secrets into microprogram sources**. This local snapshot format (adamantium.capsule-studio/1) is *not* the authoritative mechanicus.universal-graph/1 schema. In particular, successful visual validation is *not* permission to execute, approve, write native Graph IR, install Node-RED packages or deploy MAS agents.

## Trust boundaries and remaining work

R01 neither executes code nor compiles another language; there is no shell/worker/eval. It does not alter Node-RED flows or use the Node-RED admin API. For production integration, create separate reviewable layers:

1. Native editor adapter and four-side port layout inside the Node-RED canvas, with CAS against the parent graph revision. Node-RED standard ports are not assumed to provide arbitrary four-sided input/output layout; no implicit runtime wiring.
2. Versioned catalog registry in an authorized MAS plugin, a content-addressed source CAS, per-scope access policies, search/indexing, dependency resolution and explicit migration plans. No automatic propagation of a new version to existing instances.
3. Typed conversion of this editor-only model into proposals targeting the **independent** native Universal Graph IR validator; permission/dependency/route graph edges remain semantic, never executable wires or grants.
4. Approved, isolated language runners for Python/Rust/C++/Frankenstein and optional others. Only execution receipts and explicit approved I/O data cross graph boundaries. Bounded CPU/memory/time, no automatic arbitrary shell or network permissions.
5. Atomic extract-selection-to-component, consistent catalog leases, import provenance, peer review and persistence beyond one browser.

This R01 intentionally leaves upstream packages/, live Node-RED on the owner's Windows machine and both canonical production VMs untouched.

## Verification

2026-11-20: via the owner's connected JediControl transport, the Windows desktop DESKTOP-PUHG2PP executed Node.js v26.1.0 node --check on all three JS modules and node --test on both test files: **11 tests passed, 0 failed**. The static local HTTP server test verified allowlisted resources, 404/405 rejection and CSP. Browser interaction beyond those tests still requires separate UI acceptance.
