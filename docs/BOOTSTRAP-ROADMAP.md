# Adamantium Node R01 — Self-Bootstrapping Graph Platform

**Status:** isolated, CPU-first agent bootstrap prototype. Existing Node-RED upstream packages, 
runtime, editor and working flow files remain untouched. Node-RED is the optional legacy 
visual IDE/runtime until an independently tested Adamantium Graph Core replaces it.

## Canonical contract

Use **Mechanicus Universal Graph IR** (`mechanicus.universal-graph/1`) as the shared model 
with AdamantiumToolBox. The adapter in `adamantium/graph-schema/agent-graph.mjs` validates 
only a **strict R01 subset**, not all graph types or module semantics. It cannot grant 
permissions, represent arbitrary programs or execute a provider. Full IR compatibility 
requires cross-project differential fixtures with the C++17 G0 compiler.

## Components

| Component | Isolated responsibility |
|---|---|
| `graph-schema/agent-graph.mjs` | Versioned typed ports, exact allowlist, DAG validation, deterministic demo builder |
| `agent-gateway/service.mjs` | Volatile in-memory graph revisions, CAS, idempotent mutations, audit events, rollback |
| `agent-gateway/http.mjs` | Loopback `127.0.0.1` agent API; explicit bearer token; 128 KiB body bound; origin isolation |
| `node-red-adapter/compile.mjs` | Pure conversion of safe graph to disabled Node-RED 5 import JSON |
| `graph-cli/cli.mjs` | One-command dry-run and JSON export with no Node-RED installation |

## Seven agent operations

- `graph.inspect`: return current revision and graph; no secrets.
- `graph.patch`: atomically replace an approved typed graph with `base_revision` and `idempotency_key`. Revision conflicts are HTTP **409**.
- `graph.validate`: strict IR-subset validation, typed edges, cycles and fixed capabilities.
- `graph.test`: bounded deterministic simulator; does **not** run actual Node-RED processes or arbitrary code.
- `graph.deploy`: disabled by default; `--sandbox` marks an in-memory copy as active only. **Never contacts Node-RED**.
- `graph.rollback`: revert latest in-memory checkpoint under CAS, increment revision monotonically.
- `graph.explain`: return the graph's declared node types and edges without permission grants.

`graph.bootstrap` is the eighth convenience operation: a supported natural-language command 
creates the three-node demo (`source → set → sink`), validates, simulates, commits to volatile 
storage and returns **disabled Node-RED import JSON**. It rejects requests that cannot be 
mapped to this exact safe template. No general LLM text-to-graph translation exists yet.

## Try without Node-RED or admin rights

From the repository root with Node.js 22.9+ installed:

```sh
node adamantium/graph-cli/cli.mjs demo 'Собери тестовый граф'
node adamantium/graph-cli/cli.mjs node-red 'Собери тестовый граф' > safe-flow.json
```

Import `safe-flow.json` using Node-RED Editor → Import. The imported tab is **disabled** 
and the inject node has no repeat/on-start settings. To run it, a human must consciously 
enable it inside an **isolated** Node-RED environment. No existing flow is replaced.

## Authenticated agent HTTP API

Start the gateway with a locally provisioned strong `ADAMANTIUM_AGENT_API_TOKEN` 
environment variable. It deliberately refuses to start without one. 
`node adamantium/graph-cli/cli.mjs serve` binds **only** to loopback port 8769. 
Use `--sandbox` for simulated deploy actions. Do not expose this prototype on WireGuard, 
the public internet, or a remote tunnel; it has no multiuser RBAC or durable leases.

```http
POST /v1/agent
Authorization: Bearer (provisioned locally)
Content-Type: application/json

{"operation":"graph.bootstrap","arguments":{"text":"Собери тестовый граф","base_revision":0,"idempotency_key":"demo-request-0001"}}
```

Other routes: authenticated `GET /v1/graph` and `GET /v1/node-red/import`; 
unauthenticated `GET /health` exposes only readiness and inert mode. 
Responses have `Cache-Control: no-store`. The server rejects cross-origin browser requests, 
unknown actions, oversized bodies and unauthenticated POST requests.

## Node-RED compatibility boundary

Official Admin API v2 already supports `GET /flows` → `{rev,flows}` and 
`POST /flows` with a revision guard (HTTP 409 on stale writes). **R01 never invokes POST /flows.** 
A future `node-red-adapter` transport must run against a dedicated sandbox profile, 
retrieve the actual revision, negotiate access through policy, require explicit signed 
authorization and prove rollback before touching even that sandbox.

The original `packages/` code is left unchanged. R01's test scope is the 
standalone adapter, not Node-RED 5's complete runtime regression. 
Build/test runs do not require npm dependencies, GUI, GPU, external MAS apps or the editor.

## Release gates

1. **R01:** typed AI command → graph → validate → simulated test → disabled Node-RED import → in-memory rollback.
2. **R02:** exact shared IR conformance, durable journal/CAS with recoverable replay, agent auth policy.
3. **R03:** real Node-RED Admin API adapter in isolated `userDir` with independent execution tests, 
   freeze and diff, explicit consent, signed deployment/rollback receipts.
4. **R04:** native CPU-first Graph Executor and pluggable capability resolution; Node-RED becomes 
   a replaceable executor. Neuronal GENESIS and infra permission edges retain distinct semantics.
5. **R05:** agent-editable Graph IDE and verified graph-genome expression; switching or regenerating 
   the runtime requires independent bootstrapping and recovery.

**Not yet proven:** connected Node-RED runtime, auto-populated Node-RED editor, durable 
recovery after process crash, signed identity, actual MAS capability invocation, distributed 
execution or autonomous self-modification. Treat this as a proposal until these gates pass.
