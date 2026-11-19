# Self-Bootstrapping Graph Platform — R01

**Status:** isolated agent-first source-only prototype. Original Node-RED 5.0.10 packages remain unchanged. No production runtime deployment.

## Responsibilities

- Node-RED's REST v2 `GET /flows` returns a revision and flows. The upstream `POST /flows` supports revision conflict detection with HTTP 409. R01 deliberately DOES NOT call it.
- `adamantium/agent-gateway/`: authenticated loopback Agent Graph API, in-memory draft store, CAS/idempotency/audit/rollback.
- `adamantium/graph-schema/`: allowlisted inert Node-RED JSON projection, not the canonical Universal Graph IR; no scripting, files, network or credentials.
- `adamantium/node-red-adapter/`: optional bearer-authenticated read-only `/flows` v2 inspector, returns only revision, node counts and types, never unknown node configs/secrets.
- `adamantium/graph-cli/`: deterministic single-command create → validate → simulate → inspect → rollback fixture.

Independent Universal Graph IR #143 remains canonical for typed Toolbox programs. Rete is a replaceable editor; the Genome Architecture is another independent compiler. This Node-RED adapter must not silently define a competing canonical graph schema.

## Seven operations (POST /agent/graph)

| op | R01 action |
| --- | --- |
| `graph.inspect` | Reads isolated draft and revision |
| `graph.patch` | Replaces allowlisted draft; requires `base_revision` + `idempotency_key` |
| `graph.validate` | Strict inert safe-node whitelist validation |
| `graph.test` | Deterministic **simulator only** (`runtime: not-node-red`) |
| `graph.explain` | Returns guardrails and draft audit |
| `graph.rollback` | New CAS revision restoring an older draft |
| `graph.deploy` | DENIED by default; requires future isolated Lifecycle authorization |

Patch response carries new draft revision, SHA256 state fingerprint (not signature), audit sequence and `deployment: none`. The R01 in-memory store has a 10,000-revision budget. No shared DB, signed manifests, distributed leases, credentials or production execution.

## Verify with no Node-RED install

With Node.js >=22.9:

```sh
node --test adamantium/tests/agent-graph.test.mjs
node adamantium/graph-cli/cli.mjs "собери безопасный тестовый граф"
```

The CLI emits JSON with inspect → patch → validate → test → explain → inspect → rollback → inspect. Its tested graph is a disabled Node-RED tab and may only be manually imported for viewing. It never writes into the real editor.

## Optional local HTTP gateway

Provision `ADAMANTIUM_AGENT_TOKEN` (32–1024 characters, out-of-repo), optionally `ADAMANTIUM_AGENT_PORT`, then run `node adamantium/agent-gateway/server.mjs`. Binds only `127.0.0.1`; all endpoints require Bearer authentication; does not write to Node-RED.

The optional read-only inspector requires `ADAMANTIUM_NODE_RED_URL` as an explicit loopback HTTP root (for example localhost on an operator-chosen port) and `ADAMANTIUM_NODE_RED_TOKEN` from an authorized operator. Never disable Node-RED Admin API authorization merely to enable AI. WireGuard provides transport, not authorization.

## R02 acceptance / still NOT implemented

1. Launch disposable Node-RED with an independent empty userDir, authenticated admin account and isolated process; no existing flows.
2. After explicit per-operation approval, deploy *only* an allowlisted disabled test graph via v2 `POST /flows` including the upstream revision, confirm HTTP 409 stale-CAS rejection, and readback. Reject arbitrary origins or existing non-test flows.
3. Execute actual Node-RED test under sandbox, collect a real output receipt and rollback on error; no arbitrary shell/plugin loads.
4. Implement lossless Node-RED ↔ Universal Graph IR adaptation, dynamic editor projection, signed Lifecycle and Fixiki/Task Pool task decomposition. Independent QA before cutover.

Keep Node-RED as an independent compatibility engine and emergency tool until native runtime has independent acceptance, verified recovery and rollback.
