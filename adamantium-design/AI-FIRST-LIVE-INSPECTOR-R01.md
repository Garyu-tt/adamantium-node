# Adamantium-node — AI-first live graph inspector R01

Status: **read-only isolated utility**, separately tested against VM122 on 2026-11-20. This branch is stacked on the live-graph RFC draft; there is no production merge or policy grant.

## Purpose

Allow AI agents and owner operators to observe the *actual* Node-RED Admin v2 graph revision without scraping the GUI or receiving the full flow JSON, node source, payloads, credentials or secrets.

- **inspect** outputs revision + a strict projection of tabs, node identities, types, names and outbound-edge counts.
- **watch** polls 1–20 times and emits revision changes as topology/metadata-only diffs; it never deploys or modifies anything.
- Restricts endpoints to exact explicit localhost/127.0.0.1/::1 origins and GET /flows only.
- Denies missing auth tokens by default. Lab mode --unauthenticated-lab requires explicit operator opt-in and still only accepts a loopback origin.
- Accepts a scoped bearer token exclusively through ADAMANTIUM_NODE_ACCESS_TOKEN environment variable; never print or persist it.
- The source is not a tool authorization, MAS capability, Graph IR validator, live-execution proof, or full graph diff engine. The visible type/count/name fields are **untrusted observations**. It is designed to stay useful after Node-RED Admin auth is activated.

## Run

From this branch's checkout with Node.js >=22.9:

~~~sh
node adamantium/ai-graph-inspect.mjs inspect --url http://127.0.0.1:1885/ --unauthenticated-lab
node adamantium/ai-graph-inspect.mjs watch --url http://127.0.0.1:1885/ --unauthenticated-lab --samples 5 --interval-ms 1000
~~~

**Lab flag is temporary**, never a remote service and not an authentication substitute. After enabling Node-RED adminAuth, request a short-lived token over its trusted local auth route, then use ADAMANTIUM_NODE_ACCESS_TOKEN (without --unauthenticated-lab). The CLI does not implement token acquisition or store passwords.

## Validation and observed facts

- node --test test/adamantium/ai-graph-inspect.test.mjs: 9/9 passed using Node 24.22.3 on VM122.
- Against the actual VM122 127.0.0.1:1885: observed Node-RED Admin API v2 revision 4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945, 0 tabs, 0 nodes, repeated stable revision under bounded watch.
- VM122 service and Capsule Studio are **separate**; nothing in these tools loads runtime plugins or edits Node-RED.
- Read-only graph.inspect is a useful interim bridge, not the desired signed MAS adamantium_nodes / capabilities / invoke API.

## Next release gates

1. **Operator Admin authentication:** enable Node-RED adminAuth with local secret provisioning and verified unauthenticated 401; keep localhost-only until that succeeds. No bootstrap credentials or secrets may be embedded into source, PR, logs or chat.
2. **Trusted authenticated agent path:** discover and verify approved MAS node identities, grants and exact capability action IDs; do not infer permissions from successful local reads or GitHub access.
3. **Typed graph proposals:** separate proposal/view layers from authoritative Universal Graph IR validator and graph rights. Validate CAS expected revision, provenance and independent tests before any action.
4. **Runtime execution proof:** collect checked, bounded trace receipts; metadata diff alone cannot confirm execution or detect source/config-only edits.
5. **Hot plugin install:** signed package provenance, isolated worker/ABI, state migration, canary, old-version rollback. Never silently hot-reload executable user source from an editor projection.
