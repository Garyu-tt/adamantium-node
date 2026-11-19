# Adamantium-node R04: Agent Graph API → verified Node Factory

**Status:** draft, source and isolated integration tests. Built on R01 agent-gateway, R02 contract-based package generation and R03 genuine Node-RED 5 test runtime. The Node-RED upstream code and production palette remain unchanged.

## Scope

The agent can propose a new Node-RED node type using an exact structured contract, then request proof that the generated package works in a disposable Node-RED runtime. The agent cannot submit raw JavaScript, install the generated module into a persistent user palette, publish to npm or change the host's global environment.

```text
AI agent → factory.propose(contract + expected catalog revision + idempotency key)
         → independent schema validation + content-hashed source preview
         → factory.verify(proposal id + revision + idempotency key) [opt-in]
         → generate safe Node-RED JS/HTML/package.json
         → npm pack --ignore-scripts
         → npm install --offline --ignore-scripts into new sandbox
         → verify actual installed SHA-256 files
         → launch **new** local Node-RED 5.0.10 runtime on dynamic port
         → Admin v2 GET /nodes, GET /flows, CAS POST /flows
         → observe fixed one-shot message output
         → CAS rollback + readback; terminate process + delete sandbox
         → agent receives proof receipt; not an install/deploy grant
```

## Agent operations

| Operation | Returns | Writes to production? |
|---|---|---|
| `factory.template` | Accepted contract template and safe transformations | No |
| `factory.inspect` | Volatile catalog revision, candidates and non-secret evidence | No |
| `factory.propose` | Candidate ID, source digests, CAS revision, proposed status | No |
| `factory.verify` | Signed? **No**. Real sandbox-only Node-RED execution/rollback receipt | No |
| `factory.install`, `factory.deploy`, `factory.publish` | HTTP 403, fail-closed | No |

Every proposal requires `base_revision` and `idempotency_key`. A repeated exact request returns the prior receipt; a changed payload with the same key is rejected. Proposals are bounded to 12 per gateway lifetime. Verification attempts are limited to three, with exactly one active worker. Failed attempts mark the candidate rejected; there is no automatic production retry.

### Example

All requests use the already-authenticated loopback `POST /v1/agent` (`Authorization: Bearer …` and `Content-Type: application/json`). The token is provisioned locally, not included in the request file or Git repository.

```json
{
  "operation": "factory.propose",
  "arguments": {
    "contract": {
      "schema": "adamantium.node-factory/1",
      "id": "demo-uppercase",
      "label": "Adamantium Demo Uppercase",
      "transform": "uppercase",
      "suffix": ""
    },
    "base_revision": 0,
    "idempotency_key": "agent-factory-proposal-0001"
  }
}
```

The response includes `id` and `catalogRevision`. Request verification using those exact values:

```json
{
  "operation": "factory.verify",
  "arguments": {
    "proposal_id": "<id returned by factory.propose>",
    "base_revision": 1,
    "idempotency_key": "agent-factory-verification-0001"
  }
}
```

## How to launch

Default gateway remains proposal-only. To allow real **disposable local** Node-RED verification, start it with the explicit `--factory-verify` opt-in:

```sh
ADAMANTIUM_AGENT_API_TOKEN=<locally-provisioned-secret> \
  node adamantium/graph-cli/cli.mjs serve --factory-verify
```

The server still binds only to `127.0.0.1:8769`. It never opens a WAN or WireGuard interface. `graph.deploy` retains its separate original simulated behavior and cannot be turned into a production write by the factory flag.

## Security / evidence boundaries

- R04 accepts only R02's fixed source templates: `uppercase` or appended literal suffix. It **does not** synthesize arbitrary code from natural language. The AI translates its request into a bounded JSON contract.
- All package output paths are internally generated from validated slugs; callers cannot supply a sandbox path, Node-RED port, executable, module source or npm registry.
- Test package installation is offline, scripts disabled, package metadata has `private:true`; the installed artifact is hashed and compared with the candidate source manifest.
- The Node-RED child receives its own random token and random sandbox identity. The agent gateway token is removed from the child environment.
- No persistent workspace write beyond the gateway's own in-memory proposal catalog. Each isolated test userDir and package is removed after the test. On ambiguous rollback, no success receipt is emitted.
- Evidence claims `sandboxDestroyed:true` only after the isolated runtime has stopped and files have been removed. It claims neither a signed build attestation nor independent privilege approval.
- No arbitrary shell operation is reachable through the gateway. The only child process is the fixed Node-RED sandbox and offline npm tools controlled by the trusted server implementation.
- There is **no** signed promotion, durable storage of proposals after restart, multi-user authorization, cross-host distribution, graphical palette verification or automatic dependency discovery yet.

## Gate tests

`node --test test/adamantium/node-factory-agent-r04.test.mjs test/adamantium/node-factory-gateway-r04.test.mjs` runs without a full Node-RED npm installation.

`node --test test/adamantium/node-factory-real-agent-r04.test.mjs` requires the repo's locked Node-RED dependencies. It verifies the full HTTP-to-sandbox lifecycle on Windows and Linux in CI.

## Next R05

Replace the in-memory candidate catalog with an independent durable Task Pool + signed manifest witness; add multi-agent leases, typed Universal Graph IR G0 compiler validation, optional isolated NodeDev UI as a *plugin* after v5 compatibility tests, and a permission-gated Lifecycle promotion proposal. Keep the original Node-RED as an emergency executor.
