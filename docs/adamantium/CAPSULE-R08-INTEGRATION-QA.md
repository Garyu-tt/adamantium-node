# Capsule R08 — combined native SVG workspace + Construct R05 (draft)

This is an **editor-only** integration branch stacked on PR #43. It brings the R05 Construct Q-menu and signed IR proposal-export UI from PR #33 alongside R07's recursive Capsule SVG lens in the **actual** Node-RED 5 workspace.

## Why a new integration is necessary

Installing PR #43's plugin directly on the VM122 running R05 would silently remove `resources/construct-engine.mjs` and the preview's `constructMenuToggle`. The source branches diverged after the R04 foundation. This integration preserves both.

## Features preserved

- Construct reusable library, Q-menu, batch additions and typed auto-wiring in the independent Capsule Studio preview.
- Graph IR export proposal and its strict source-only contract. This export does not authorize or execute a graph.
- Native Node-RED SVG event-layer Capsule editor, with nested graph navigation, four-sided typed ports, wire editing and localStorage draft sync.
- Standalone native Node-RED Construct R03 remains an independent second editor plugin; this branch does not modify that package.

## Verified on canonical VM122, 2026-11-20

Source lineage: R05 PR #33 at `ea3960365884056215a0dcd162636ef81e902d11` plus R07 PR #43 at `8a4ae132408073357eedf0ccd804510ea8b8ad24`.

- Node 24.22.3 in a separate worktree: full `capsule-*.test.mjs` plus Construct suite **104 total: 99 passed, 0 failed, 5 skipped**. Skips require separately installed native C++ G0 validation executable. Do not present them as passes.
- Packaged `capsule-native-layout.mjs`, `capsule-native-canvas.mjs`, `construct-engine.mjs` and preview `app.mjs` are byte-for-byte copies of their canonical source paths.
- Real Firefox + geckodriver on an **isolated safe-mode** Node-RED 5.0.10, loopback port `1887`, with fresh empty userDir and both R07 Capsule + R03 native Construct editor plugins. No production data.
- Real Node-RED SVG lens mounted via `RED.actions.invoke("adamantium:toggle-native-canvas")`: 2 cards, 4 ports, 1 wire, `data-runtime="disabled"`; native Node-RED flow remained empty, closing the lens detached all its SVG elements.
- Found an actual cross-plugin keyboard collision: pressing Q with a focused Node-RED toolbar BUTTON during open Capsule lens also opened native Construct. Fixed by intercepting non-editable Q at window capture while Capsule is mounted. Verified using Firefox: during Capsule, Q **does not open native Construct**; after Capsule closes, Q **does** open it normally. Added a Node test verifying Q is intercepted from BUTTON but normal typing into INPUT remains permitted.
- Separate packaged preview retains both `constructMenuToggle` and `exportIR`. In real Firefox pressing Q, choosing Construct's Create action incremented local preview nodes 3→4; scrollable preview workspace height approx. 685 px. No Node-RED deployment.

## Security and production gates

- **Draft, not yet rolled out to VM122 main**. Live editor stays on R05 + native Construct R03 and Node-RED adminAuth.
- Both Capsule variants are `localStorage` editor drafts, not native Node-RED flow nodes, MAS capabilities, language runners, signed Graph Manager decisions or authoritative `mechanicus.universal-graph/1`.
- R08 separately implements best-effort stale localStorage byte checking, a rollback of failed model writes and failed drags, and protection against overwriting a malformed saved draft. It adds adversarial hidden +N wire tests for wrong-direction and mismatched typed connections; these are validated before any visual clipping. These patches were independently tested on VM122. PR #46 is based on a different native R07 implementation; its remaining QA and actual browser regression coverage must still be reconciled before production promotion.
- Native G0 end-to-end validation has not been executed for this combined branch; 5 native-gated tests are skipped in the VM122 source-only suite.
- No remote ingress or authorization bypass, no silent plugin installation, no executable graph deploy, no controller lease manipulation, and no JediControl watchdog disruption.

## R08 local draft safety hardening

On VM122 Node 24.22.3, independent local suite after security patch: 104 tests, 99 passed, 0 failed, 5 native G0 skipped. Added four controller tests covering localStorage cross-tab stale writes, quota failure rollback, drag rollback and malformed draft overwrite denial, plus one layout test for forged hidden +N wiring. This is best-effort only: browser localStorage has no atomic multi-document CAS, so authoritative concurrent edits still require Graph Manager.
