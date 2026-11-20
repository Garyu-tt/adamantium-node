# Adamantium-node Capsule Studio R08 — live editing consistency and zoom-safe native SVG

**Status:** isolated editor-only improvement, stacked on draft R07 (#43). This is **not** a runtime execution, Graph Manager write, MAS policy, persistent shared CAS store or deployable Node-RED flow node. Do not merge/install on production automatically.

## Why

R07 proved that an editable Capsule lens really mounts inside Node-RED 5's own SVG event layer. It did not yet protect a stale local tab from overwriting a newer browser draft, and its pointer geometry silently assumed identity coordinates if the native SVG transformation matrix was unavailable.

R08 addresses both under the existing source-only editor model.

## Implemented

- **adamantium/capsule-draft-storage.mjs:** a revision-tagged localStorage wrapper. Supports existing R01/R02 documents without draftRevision, starts at revision 0, and increments an advisory draftRevision on each successful save.
- Before saving, it compares the exact stored JSON bytes with the last seen version. If another editor has changed them, a CapsuleDraftConflict is thrown and the earlier value remains untouched. Invalid JSON/negative revision/oversized content/storage quota failure are rejected. Editor data is limited to 8 million UTF-16 code units (not a native Core graph-size budget).
- **adamantium/capsule-native-canvas.mjs:** integrates the storage guard for direct port connections, graph extraction, new capsules and pointer drag. Failed edits roll back local editor state; a conflicting drag reverts to its prior position. The local revision appears in the SVG toolbar and the controller's inspect() includes localConflict.
- **adamantium/capsule-preview/app.mjs:** shares that optimistic guard with the R02 sidebar editor. Edits and imports do not silently replace an externally updated draft. Atomic rollback covers regular graph actions; import/reset failures reload the stored model. Existing shared microprogram versions and library templates remain in their existing source data.
- **adamantium/capsule-native-pointer.mjs:** uses the actual SVG current transformation matrix for pointer-event conversion under Node-RED zoom/pan. When a *real* mounted SVG cannot provide a valid inverse transform, it fails closed rather than guessing screen-to-graph coordinates.
- Both new ES modules and the revised native/preview scripts are included in the Node-RED editor plugin's packaged resources; exact byte-for-byte parity and preview allowlist route coverage are tested.

## Trust and consistency scope

localStorage does **not** provide atomic multi-tab compare-and-swap. The new read-check-write is synchronous in a single JS turn but cross-process/storage-agent races remain possible. This is an *advisory, fail-on-observed-staleness* safety guard, not a cryptographic revision, durable server transaction or proof of conflict-free collaborative editing. The canonical authority for real multiagent writes must still be the native Graph Manager with authenticated per-graph CAS and independent audit/witness.

Browser storage is not encrypted or access-controlled beyond the browser's origin boundary. Do not store production secrets or executable credentials in drafts. The SVG layer does not write to Node-RED /flows and is not a native executable flow node.

## Repeatable checks

R08 unit tests:
- test/adamantium/capsule-draft-storage.test.mjs — legacy format, revision increments, stale writer rejection, input corruption, oversized payload and storage quota failure.
- test/adamantium/capsule-native-pointer.test.mjs — 0.5× and 2× zoom, SVG pan, invalid CTM fail-closed.
- test/adamantium/capsule-native-canvas.test.mjs — stale port connection rollback, zoom-aware pointer drag, external update during drag rollback.
- test/adamantium/capsule-browser-smoke.mjs — real Chromium fixture with all new static imports.
- test/adamantium/capsule-node-red-editor-r08-cdp.mjs — genuine Node-RED 5 headless Chrome DevTools pointer events. Requires manually started empty-flow, safe-mode Node-RED instance and isolated Chrome profile on explicit loopback addresses. Refuses ordinary port 1880 and nonempty /flows.

The R08 CDP script tolerates two *known* Node-RED 5 first-launch UI overlays in the **disposable test profile only**: it explicitly selects **"No, do not enable notifications"** and dismisses the identified **"Welcome to Node-RED 5.0!"** guided tour via its Close control. Any unknown shade blocks the test; it will not blindly click through. These changes do not affect the owner's regular Chrome profile or production Node-RED settings.

Example after manually starting isolated Node-RED in --safe mode on 127.0.0.1:18988 and Chrome CDP on 127.0.0.1:18989:

~~~powershell
$env:ADAMANTIUM_R07_DISPOSABLE_SAFE_MODE = '1'
$env:ADAMANTIUM_R07_TEST_EDITOR_URL = 'http://127.0.0.1:18988/'
$env:ADAMANTIUM_R07_TEST_CDP_URL = 'http://127.0.0.1:18989/'
node test/adamantium/capsule-node-red-editor-r08-cdp.mjs
~~~

The legacy R07_ environment variable names are retained for compatibility with R07's accepted test harness. R08 does not create a real Core listener.

## Verified on 20 November 2026

- **Linux:** isolated sparse checkout with pinned canonical ToolBox C++17 G0 executable. Node.js **22.16.0: 96/96** and Node.js **24.11.1: 96/96**, 0 failures and 0 skips.
- **Windows:** via authorized JediControl VM125 relay, the previously running user's Node-RED stayed untouched. A fresh R08 checkout and empty-flow Node-RED **5.0.10** instance ran in safe mode on **127.0.0.1:18988**; separate headless Chrome **157** CDP instance used **127.0.0.1:18989** with a temporary profile.
- Real Node-RED's "core:zoom-out" actions changed the SVG transform to **0.6000000×**. Actual Chrome pointer events dragged the Capsule instance; the draft stored advisory revision **1** with expected ~83.33 model-unit horizontal movement for 50 screen pixels (and 50 vertical model units for 30 screen pixels).
- Simulated a newer sidebar write to advisory revision **43** without a storage event in the same document; attempted another drag. The raw newer draft bytes remained identical after the stale commit attempt. Node-RED's flow node count remained 0, no runtime activation.
- CDP printed **R08_REAL_NODERED_ZOOM_CONFLICT_PASS**. The lens was closed and removed correctly.
- **Windows Node.js 26.1.0:** 96 tests discovered, **91 passed, 5 skipped** (native G0 binary was not provisioned into the temporary Windows test checkout), 0 failed.
- Both temporary Windows listeners **18988 and 18989 were stopped**, with no remaining listener. The watchdog, JediControl, production VM121/122 and live Windows Node-RED were unchanged.

CI: .github/workflows/capsule-studio-r08.yml compiles the actual pinned ToolBox C++ G0 on Ubuntu/Windows for Node.js 22/24, runs the full suite with native tests mandatory, and requires real Chrome/Chromium SVG smoke on Ubuntu.

## R09 gates

1. Replace localStorage conflict detection with an *authenticated server-backed Graph Manager revision ledger*, true persistent per-graph CAS and monotonic audit/witness. Keep native G0 validation and MAS approval separate.
2. Add bounded change-history/undo for local graph transactions, including nested capsule extraction, with clearly defined treatment of external changes.
3. Make the native renderer scale to deep/large graphs with viewport-based virtualization and incremental redraw instead of replacing every SVG child for each pointer move.
4. Define a genuinely safe live runtime hot-swap contract: validate → stage → drain/pause → atomically publish revision → verify → rollback/recover. Never equate preview draft saving with runtime deployment.
5. Keep runtime, source registry, G0, editor and MAS permissions independently separable, CPU-first and available through typed agent APIs.

R08 remains a draft until independent QA and CI acceptance.
