# Adamantium Construct R02 — native Node-RED Q menu (editor-only)

Status: experimental draft. Stacked on R01 Construct PR #32. Uses a second isolated editor plugin, not a fork of Node-RED native core.

## Native editor operations

- Load Node-RED with this package only inside a disposable development userDir. Press Q outside input fields or invoke the registered action adamantium:show-native-construct.
- Built-ins: simple credential-free standard Node-RED assemblies. RED.view.importNodes stages them directly on the native SVG canvas, attaches new selection to the cursor, and leverages built-in history/Undo and ID generation.
- Stamp 1, 2 or 4 assemblies in one imported unit; wire endpoints remain inside their own stamped copy.
- Save a vetted, selected subset of built-in native nodes as a local snapshot, with explicitly approved node types/properties, no credentials, no config-node references, and no links to unselected nodes. The user must explicitly name and confirm saving; data stays in browser localStorage.
- Duplicate a selected native flow region as an independent snapshot with fresh IDs. No shared runtime memory.
- Add a bookmark/reference to the selected native node. The bookmark navigates to the same node identity and creates zero new runtime nodes. A second visual card is not implemented.
- List existing native Subflow definitions. Placing one creates a native subflow instance using the registered subflow type; a shared definition is reused with independent state/config.
- Delete selection by invoking native core:delete-selection after explicit confirmation.
- Opt-in auto-place on new tab listens for flows:add and workspace:change. Existing flows remain untouched. A new active empty unlocked workspace receives one selected vetted preset. Toggle defaults OFF, session-only.
- A button opens existing Capsule Studio for recursive typed graph definitions and independent source forks; these representations are not falsely conflated.

## Reuse semantics

| Operation | Definition | Runtime state |
|---|---|---|
| Native preset/snapshot clone | Independent native nodes and IDs | Independent |
| Native Subflow instance | Shared registered definition | Independent per instance |
| Bookmark/reference | Original exact same node identity | Same existing runtime node |
| Capsule Studio source fork (R01) | Independent source definition lineage | Source-only until executor approved |

No live shared graph sync, native Subflow source fork, or automatic runtime hot-swap is claimed.

## Security boundaries

- Only node-red.plugins is registered; no runtime node, server route, network API or arbitrary code execution.
- Native mutations use RED.view.importNodes and built-in editor actions; never deploy. Permission/read-only checks and locked flow guards precede writes.
- Custom/untrusted node types cannot be captured. Credentials, config nodes, external refs and unselected wires are rejected.
- User labels render via textContent, never dynamic innerHTML. The only template innerHTML is static trusted editor plugin markup.
- Browser localStorage is NOT encrypted. Do not save secrets or sensitive payloads; saving strings is explicit local user action with confirmation.
- Auto-build is OFF by default, active only for the current browser page, and one preset at most per newly added active workspace. No generalized unbounded node-add hook.
- Native canvas has no authoritative Graph IR CAS or MAS authorization. No privileged runtime patch is present.
- Production deploy, shared library, logistics and hot swap require a separate reviewed Graph Manager adapter.

## Verification

Offline Node.js built-in tests:

    node --test test/adamantium/construct-native.test.mjs

GitHub Actions matrix on Linux/Windows, Node 22/24 checks code and source-resource byte identity. This does not substitute for real browser acceptance: test a disposable Node-RED 5 safe-mode userDir and verify Q overlay, native drag/Undo, locked flow rejection, Subflow instance import, and consent prompts before any production install.
