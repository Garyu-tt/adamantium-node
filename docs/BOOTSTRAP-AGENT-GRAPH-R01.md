# Self-Bootstrapping Graph Platform — Agent Graph API R01

Status: **source-only prototype, no production use**. Based on the Apache-2.0 Node-RED 5.0.10 fork, stacked on architecture/read-only projection PR #1. Original Node-RED sources are unchanged.

## Verified upstream contract

- GET /flows, header Node-RED-API-Version: v2 -> {rev, flows}.
- POST /flows, header Node-RED-API-Version: v2 and body {rev, flows} -> {rev}.
- The reviewed runtime flows.js returns HTTP 409 on stale included rev; our adapter never omits rev.
- Admin routes require flows.read for GET and flows.write for POST. A valid Node-RED token is not itself an independent signed Toolbox capability.

## Seven AI-first operations

| Operation | R01 implementation |
| --- | --- |
| graph.inspect | v2 read; return only IDs/types/workspaces, never secrets or source payloads |
| graph.patch | Generate an inert draft containing a disabled lab tab and a comment; require base_revision + idempotency_key |
| graph.validate | Reject executable node kinds and incompatible lab structure |
| graph.test | Static structural and unchanged-revision checks; **not runtime execution** |
| graph.deploy | Gated v2 CAS POST and independent readback; disabled in public CLI |
| graph.rollback | Gated CAS restore from a receipt; rejects conflicting revisions |
| graph.explain | Explain proposed changes and why an approval is necessary |

Node-RED remains a replaceable bootstrap. The independent Universal Graph IR, signed capability policy, Graph Manager, Noosphere and native execution engine remain separate MAS plugins. This R01 does not install plugins, execute arbitrary code, manage WireGuard or modify deployed hosts.

## Isolation and limitations

The only accepted write shape is a disabled tab and inert comment, in an empty or already managed lab snapshot. Production graphs containing other node types cannot be patched. The public CLI always disables writes even if the caller adds a writesEnabled field or an environment variable. Loopback alone is NOT evidence of a disposable sandbox; an external trusted launcher must verify process identity and issue a short-lived grant before any real deployment.

Idempotency is per-process memory only. Node-RED provides server-side revision CAS; external process restarts require a separate durable journal and re-verification before reconciliation. The production Graph Manager will own durable CAS/leases, history and independent actor authorization.

## Sample CLI

Start node adamantium/graph-cli/cli.mjs with ADAMANTIUM_NODE_RED_URL set to an explicit loopback sandbox URL and ADAMANTIUM_NODE_RED_TOKEN injected through a supervisor (never paste credentials into chat or GitHub). Send one JSON object per line:

    {"operation":"graph.inspect"}

    {"operation":"graph.patch","base_revision":"r1","idempotency_key":"agent-r01-0001","note":"My inert graph"}

Use the returned draft_id for graph.validate, graph.test and graph.explain. The public CLI always refuses graph.deploy/graph.rollback until the independently supervised sandbox write grant exists.

## Tests and next acceptance gate

    node --test test/adamantium/agent-graph-api.test.mjs

Tests use an ephemeral loopback mock Node-RED v2 REST server to verify complete draft -> validate -> test -> gated deployment -> readback -> rollback, stale rev (409), idempotent replay, bad tokens, unsafe node rejection and concurrency conflicts. No live upstream Node-RED runtime or actual UI is exercised by this fixture.

The next gate is a launcher that starts an isolated Node-RED from a clean userDir with admin auth, binds its exact PID/port to an owner-approved temporary write grant, accepts an inert graph, verifies it appears in the real editor, tests rollback, then stops the disposable instance. Only then is the full text -> API -> editor cycle accepted. Do not deploy R01 into any existing production Node-RED installation.
