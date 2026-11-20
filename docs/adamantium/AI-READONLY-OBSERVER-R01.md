# Adamantium-node — scoped local graph observer R01 (VM122)

Status: source-only draft, independently run on the canonical VM122 with Node.js v24.22.3. Installed instance is an out-of-process, read-only graph inspector. It is NOT a MAS capability grant, agent executor or Node-RED flow edit plugin.

## Purpose and trust boundary

A separate identity ai-observer holds only Node-RED adminAuth permission read; the owner retains the independent owner identity. The observer periodically fetches the live Node-RED Admin API v2 read-only graph metadata, projects/redacts node payloads, code and credentials, and atomically writes a root-local, private JSON snapshot. No graph writes and no agent-triggered automatic deployment are authorized.

- Root provisions random per-machine bootstrap credentials for the observer account. They are never entered into GitHub, git commits, logs, command arguments, shell history or ChatGPT replies.
- systemd injects the observer credentials using LoadCredential=observer-login:/etc/adamantium-node/ai-observer-bootstrap.txt. Only the short-lived one-shot process sees a private runtime copy.
- The observer requests a bearer token with scope read (NOT *), makes a GET /flows, and discards the token in memory. Server-side tests have verified the observer cannot POST /flows.
- HTTP requests can target only an explicitly supplied loopback origin. The CLI never connects to public URLs, does not install packages, does not expose a listening port and never promotes an untrusted IR graph.
- Sensitive details and full flow JSON are not preserved; snapshots consist of safe metadata names/IDs/types, connected source/target IDs, topology and revision. Names may still reveal architectural details: keep snapshot readable only by the dedicated system user.
- All format, authority and runtimeActivated fields explicitly distinguish observation from execution and permissions.

## Operational setup on VM122

- adamantium-node.service: loopback-only 127.0.0.1:1885, adminAuth enabled for owner and read-only observer.
- adamantium-graph-observer.service: one-shot, runs as dedicated adamantium-observer user, NoNewPrivileges, private temp/devices, strict system protections, 256MB memory cap, CPU quota, no write access outside its dedicated state directory.
- adamantium-graph-observer.timer: installed locally; triggers observation every five minutes. This is a host-local systemd timer, not a ChatGPT scheduled task.
- Output: /var/lib/adamantium-observer/snapshot.json with mode 0600 and owner adamantium-observer.
- Bootstrap secret: /etc/adamantium-node/ai-observer-bootstrap.txt, root-only mode 0600. Never display in agent logs.
- Owner bootstrap secret separately stored /etc/adamantium-node/owner-bootstrap.txt, root-only mode 0600. Both remain under operator control.
- Service is not enabled on other nodes automatically; no central MAS dispatch or self-provisioning assumed.

## Verification evidence (2026-11-20)

1. Node-RED without a token: GET /flows returns HTTP 401.
2. Owner's credential: OAuth token request succeeded and an authorized GET /flows returned HTTP 200, zero active flows.
3. Observer's limited credential: token request with scope read succeeded; authorized GET /flows returned 200; deliberately stale CAS POST /flows returned 401, with original graph revision unchanged.
4. Tests at test/adamantium/ai-graph-inspect.test.mjs and test/adamantium/agent-readonly-observer.test.mjs passed 15/15 on Node.js 24.22.3 at VM122.
5. Observer one-shot unit exited 0, created a 0600 private JSON snapshot, and timer was enabled.
6. NeuroCMS remains active, local Qwen inference remains disabled, and both editor servers continue to listen on loopback only.

## Known limitations / next release gates

- Observed topology and diff are not authoritative mechanicus.universal-graph/1. Configuration-only/code-only changes may be invisible in a metadata diff; revisions still change.
- The snapshot uses local single-file atomic replacement, not a distributed transaction or replicated Noosphere historical record.
- No agent can currently invoke MAS graph actions: adamantium_nodes, adamantium_capabilities, adamantium_invoke are NOT connected. Proxmox/SSH access does not confer these permissions.
- Browser editor remains accessible only through explicitly established, authenticated local tunnels; do not publish Node-RED port 1885 directly.
- Before adding graph mutations: signed and pinned node identity, operator capability grants, native IR validator, CAS, immutable audit and independent rollback/replay proofs.
- Credential rotation, session expiry and security monitoring are future tasks. The owner must retain a recovery path via the authorized root console.
