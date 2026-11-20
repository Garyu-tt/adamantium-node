# Adamantium Construct R04 — immutable local blueprint vault + construction logistics

**Status:** experimental draft stacked on R03 PR #40. Editor-only, CPU-first planning. It does **not** deploy, run a graph, install plugins, write to MAS, or move any processes on VM122.

## R04 versioned library

- Vault format \`adamantium.construct-vault/1\` with optimistic \`revision\`, immutable \`id@version\` entries and per-entry SHA-256 content digests.
- Two independent classifications per entry: \`sourceAccess:open|closed\` and \`distribution:free|paid\`.
- A separate explicit \`publicListing\` opt-in is **required** for public catalog export. Public export rejects closed source and recursively omits any package whose dependency closure includes hidden entries. Paid/open packages can appear only when their source is open and public listing approved. Private full backup requires a different explicit confirmation.
- SHA-256 is an integrity checksum, **not a signature, authentication, encryption, permission grant or DRM**. Untrusted imports are validated against allowlisted Node-RED types/properties and their digests.
- Dependencies are exact \`id@version\` pins; versions cannot be silently overwritten or downgraded. Import conflicts fail closed. The local browser archive is not a multi-node replicated source and is not encrypted; do not save credentials or source intended only for protected servers.
- Up to 64 package versions total; up to 12 versions per ID, 8 exact dependencies per package, 64 native nodes in a single construction plan. JSON maximum 1.5MB.
- Saved source snippets are only Node-RED allowlisted primitive node parameters from R02; no arbitrary custom-node scripts or credential/config references.

## Deterministic construction planner

- Resolve transitive dependencies via bounded DFS, deduplicate them and order before dependent packages. Reject missing versions, cycles, deep graphs and quota exhaustion.
- Plan ID hashes the exact vault revision, requested roots and package SHA-256 digests. Change to any package or revision invalidates an old plan.
- The planner emits exact step order and relative **editor construction units**, not guessed CPU/GPU/RAM performance.
- Compiler builds all primitive graph items into one temporary native Node-RED import array with new IDs and preserved *internal* wiring.
- Editor adapter previews steps, graph totals and cost first. The user then explicitly clicks **Построить проверенный план**. It checks a fresh SHA-256 fingerprint of active Flow node IDs/types/positions/wires, type registration and a single-writer local per-Flow lease before one native editor import. Normal Node-RED Undo remains available.
- Work tickets are idempotent with immutable receipt IDs and per-Flow scheduling. The work queue runs locally in the editor; this is not a persistent distributed scheduler, a server-wide lock, or a guarantee of atomic rollback on a native import exception.
- The R03 reactive policy still excludes every Construct-generated node event, including R04 plan imports, to prevent recursive graph construction.

## Native Q usage

1. Q → **Библиотека R04**; select approved native nodes from the Flow and enter an ID, title, version, dependencies and the *separate* source/distribution/publication fields. Save after confirmation.
2. Existing packages appear with current latest version. Click **Спланировать** and inspect exact dependency closure, node count, internal wire count and construction units.
3. Click **Построить проверенный план** to stage in native canvas, placing the selection with the cursor. No Deploy is invoked.
4. **Экспорт публичного каталога** includes only approved packages with a publishable complete dependency closure. **Экспорт частного архива** requires a separate warning confirmation and may include closed code. **Импорт JSON** verifies contents and rejects conflicts.

## Limits and trust boundaries

- Browser localStorage and per-page leases do not implement distributed transactions, consensus, durable replanning or multi-user mutation safety.
- Dynamic node-set registry refresh remains R03; untrusted plugins are not automatically installed.
- Do not claim compatibility between source-level paid/private classifications and executable runtime authorization. MAS policies remain independent and authoritative.
- No runtime real-time graph changes or hot swaps: Q imports are only editor state until the operator uses normal Node-RED Deploy.
- Production import requires separate operator-approved integration with native Graph Manager CAS, signed Mesh identity, auth, audit and rollback; VM122 untouched.

## Verification

- Pure source tests: \`node --test test/adamantium/construct-vault.test.mjs\`.
- Node.js 22/24 × Linux/Windows CI verifies digest integrity, immutability, CAS conflicts, transitive publication privacy, cycle detection, deterministic graph compilation, queue/lease behavior and package resource equality.
- Isolated Node-RED 5.0.10 --safe + Chromium browser smoke exercises native Q R01–R03 regressions and R04 package save, SHA-256 receipt, preview, stage, and public/private export. Deployment is never triggered.
