# Adamantium-node

This repository is the owner-maintained **Node-RED 5.0.10 fork** intended to become the primary graph workbench of Mechanicus/AdamantiumToolBox. The upstream Node-RED README, copyright, license and history are preserved.

The first **R01** implementation is a **read-only, inert** typed graph projection prototype (not a running integration, and not a replacement for the native Universal Graph IR).

- Architecture: [docs/adamantium/ARCHITECTURE-R01.md](docs/adamantium/ARCHITECTURE-R01.md)
- Projection: [adamantium/editor-projection.mjs](adamantium/editor-projection.mjs)
- Tests: `node --test test/adamantium/editor-projection.test.mjs`
- Connected Toolbox migration decision: [AdamantiumToolBox/docs/ADAMANTIUM-NODE-ARCHITECTURE-R01.md](https://github.com/Garyu-tt/AdamantiumToolBox/blob/architecture/adamantium-node-consumers-r01/docs/ADAMANTIUM-NODE-ARCHITECTURE-R01.md)

**Policy:** never treat a visual connection as a permission, expose host secrets in flows, or execute arbitrary runtime nodes before typed capability authorization. Source remains Apache-2.0 subject to the original notices; privileged Adamantez components remain private.
