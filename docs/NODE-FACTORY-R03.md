# Adamantium-node R03 — actual isolated Node-RED 5 Admin API integration

**Status:** self-contained integration test and sandbox-only adapter. The real installed Node-RED service, default `~/.node-red`, MAS capability graph, JediControl and the production palette are **not** modified.

## One verified vertical

```text
Typed R02 contract
  → generated Node-RED package with fixed templates and SHA-256
  → npm pack + offline install into a new isolated palette
  → verify SHA-256 of installed files
  → copy exact installed package into a new temporary Node-RED userDir
  → start Node-RED 5.0.10 from the repository (loopback, ephemeral token, UI disabled for remote access)
  → GET /nodes with Accept: application/json, verify type registration
  → GET /flows (Node-RED-API-Version: v2) and pin baseline rev
  → POST /flows with that rev and only a four-node test flow
  → GET /flows readback and observe one-shot generated uppercase output
  → POST /flows with stale rev, prove HTTP 409 rejection
  → POST /flows with active rev to restore the original empty snapshot
  → GET /flows readback, restart same disposable userDir, verify empty flows
  → terminate child and remove temporary directory
```

## Safety invariants

- The process listens on `127.0.0.1` only, on a dynamically allocated port. No public ingress, WireGuard exposure, process takeover, auto-start or system service installation.
- The dedicated `userDir` and generated package directory are new and writable only by the caller; never use `~/.node-red`, a production registry, or an existing Node-RED profile.
- Node-RED Admin API requires an ephemeral random bearer token checked through `adminAuth.tokens`. Its raw value is never written to repository files or emitted into CI logs.
- A random `X-Adamantium-Sandbox-Id` response header pins the target instance independently of port number. The client refuses an unpinned or foreign endpoint; it accepts only literal IPv4 loopback.
- Dynamic package installation/upload/update, Projects, telemetry, HTTP-In routes and automatic external modules are disabled in sandbox settings.
- `FactorySandboxAdmin.deployFactory` refuses any nonempty existing flow list. It accepts only the verified `adamantium-...` registered test node type and constructs the fixed inject → generated node → debug flow itself.
- Every mutation uses Node-RED API v2 `rev`, checks the exact following revision, and reads the resulting graph back. No blind retries on ambiguous network responses.
- Rollback requires the exact deployment receipt, matching active revision and flow digest; it restores only the previously observed empty baseline and checks persistence across a restart.
- In this test `debug` prints a known fixed string to the disposable process log; it never transmits arbitrary messages to remote services.

## Scope boundaries

R03 is **not** a universal AI deployment right. It uses the Node-RED native revision token rather than pretending its in-memory R01 counters are globally shared. `graph.patch`, signed MAS authorization, durable idempotency receipts, branch merges and graph/genome mutation remain separate responsibilities.

The palette is verified through authenticated Node-RED registry API and by execution of the generated package. The browser UI's visible palette state is not yet tested with a graphical end-to-end test. Existing `packages/` code is untouched.

## Tests

With repository dependencies installed by `npm ci --ignore-scripts --no-audit --no-fund`:

```bash
node --test test/adamantium/node-factory-admin-guards.test.mjs
node --test test/adamantium/node-factory-admin-r03.test.mjs
```

GitHub Actions runs the integration on Node 22 for Linux and Windows. Existing R01/R02 tests must continue to pass. Test-generated temporary files are deleted on completion; **do not** run this against a live Node-RED profile.

## Next

Expose an isolated, explicitly authorized Node-RED agent adapter that reads the shared Universal Graph IR, validates against G0 native compiler, obtains an independent policy decision and emits exact rollback receipts. NodeDev and UIBUILDER remain optional external builder/IDE plugins until version-5 compatibility is separately proven.
