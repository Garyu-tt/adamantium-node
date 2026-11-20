# Adamantium IDE Shell R01 — opt-in editor UI

This release adds a **real Node-RED editor plugin**, independent of paid website builders and executable model services. It does **not** implement a new graph runtime.

## Included

- `node-red-contrib-adamantium-ide-shell`: editor-only plugin with `Studio` sidebar, light/dark/stock themes, focus mode, density toggles, keyboard command palette (`Ctrl+K`), `Alt+Shift+F` focus toggle, Escape restoration.
- Scoped CSS design tokens with keyboard-visible focus and reduced-motion fallback.
- Actions to open the existing *optional* Capsule Studio and Construct Q menu plugins. They are not bundled; `Q` remains owned by Construct.
- Explicitly inert Live/Draft/Hot Swap status. No claims of real execution or promotion.

## Installation in **isolated Node-RED userDir** (Node-RED 5)

After source review:

```sh
cd /path/to/isolated-node-red-userdir
npm install --no-save /path/to/node-red-contrib-adamantium-ide-shell
```

Start the isolated Node-RED instance as usual; open **Studio** sidebar. Default theme is **off**. The plugin changes only local browser appearance and has no runtime nodes. Installing a new Node-RED editor plugin may require restarting **that isolated Node-RED process**; it is not a verified hot-load operation.

## Trust boundaries

No external CSS, JavaScript, AI, fonts, images, analytics or dependencies. No network fetch from this plugin besides Node-RED's own packaged CSS asset. No server settings, flows, runtime state, credentials or model code are read or changed by the shell. Appearance is saved in browser localStorage; focus is session-only.

Do not publish a Node-RED editor without enabling `adminAuth`, authenticated ingress, and a verified operator identity. Existing VM122 test runtime is loopback-only with adminAuth not yet verified. Do not merge, deploy or expose this into production based only on source review.

The plugin uses existing `RED.plugins.registerPlugin`, `RED.sidebar`, and `RED.actions` editor APIs. It should be browser-smoke-tested in an isolated Node-RED 5 safe-mode instance before activating in a real userDir.

## QA acceptance

1. Editor starts with unchanged default Node-RED appearance.
2. Studio tab appears and all three theme buttons work.
3. Refresh keeps dark/light theme and density; **focus mode does not persist**.
4. `Ctrl+K` opens keyboard-searchable commands; Escape returns focus.
5. `Alt+Shift+F` toggles panels; Escape restores both.
6. `Q` still belongs to the optional Construct plugin.
7. Missing Capsule/Construct plugins produce no flow mutations.
8. No `/flows`, `/nodes`, `/settings` write, Deploy, API token, network model or runtime call originates from this package.

Licensed Apache-2.0, following the parent repository.