# Adamantium Construct R03 — bounded reactive native graph construction

**Status:** experimental draft on top of native R02 PR #36. Native Q Editor only; no MAS writes, privilege escalation, native Node-RED deploy or process restart.

## What R03 adds

- Opt-in reaction rules under Q → **Реактивные правила R03**.
- Choose a supported native trigger node type (inject/debug/change/switch/delay/comment/json/catch), a vetted preset (inject_debug / catch_debug / change_debug), a limit per flow (1..4), and optionally cleanup when the original trigger node is removed.
- **Adding a user-created node** of the selected type to the active writable Flow schedules one protected preset placement, using the existing native Node-RED editor import and Undo history. No file system, runtime API or shell.
- **Removing the triggering node** can remove only the assembly created by that exact rule and trigger, when its generated IDs and readback fingerprints are intact, all expected nodes are still on the active Flow, and every link stays inside the generated assembly. If the assembly was changed, linked to external nodes, or the source has been restored via Undo, the cleanup fails closed and preserves it.
- Dynamically updates the Q catalog view when native Node-RED node types, plugin node sets or Subflows are registered or removed. This does **not** auto-install third-party packages or grant unknown node types permission to execute.
- All per-session rule queues, receipts and ownership are maintained separately from the source/code Graph IR. Saved rule definitions are **disabled again after page reload**; no latent background construction.

## Limits and anti-loop safety

- Maximum 24 rules configured, at most 16 pending operations, 48 new builds per browser session, 1..4 successes per flow per rule.
- Events caused by Construct itself are marked with a namespace origin and ignored. The generated nodes cannot recursively trigger further generated nodes.
- One event+source+rule receipt is processed only once, including after a failed attempt; no automatic retries or exponential fanout.
- Structural changes require current editable Flow and flows.write permission if the editor exposes the permission check; locked, other-tab or missing sources fail closed.
- Native Graph Manager remains authoritative for runtime. This module only proposes local editor changes; Node-RED Deploy still requires the normal user decision.
- Reuse is explicit: snapshot=independent copy, native Subflow=shared definition with separate instance state, reference=bookmark to exact original identity, Capsule Studio=separate typed recursive graph.
- No network calls, timers, model-generated shell commands, plugin installs or cross-node automatic routing.

## Source and package

- Canonical pure policy: adamantium/construct-native/reactor.mjs
- Native event adapter: adamantium/construct-native/reactor-editor.mjs
- Packaged byte-for-byte resources in adamantium/plugins/node-red-contrib-adamantium-construct/resources/
- UI: native-q-menu.html
- Core tests: test/adamantium/construct-reactive.test.mjs
- Real browser acceptance: test/adamantium/construct-native-browser-smoke.mjs (disposable Node-RED 5.0.10 --safe + Chromium)

## Acceptance

The isolated Node.js matrix (Windows/Ubuntu, Node 22/24) tests opt-in, event replay, ownership, quotas, fail-closed invalid types, cleanup, non-recursive construction. The browser smoke must verify adding an external native inject node triggers exactly one approved catch+debug assembly and deleting the untouched source removes only its owned pair. R02 stamps, Undo/Redo, snapshot copies, auto-tab and locked flow tests remain mandatory.

Production live-update and Mesh construction logistics are **NOT implemented in R03**. They require reviewed MAS Graph Manager capability, single-writer serialization/rollback, event authorization and signed IR transactions; no implicit installation on VM122.
