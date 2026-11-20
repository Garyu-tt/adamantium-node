# Adamantium-node — isolated server staging runbook
Status: **DESIGN ONLY — no server changes in this PR**  
Date: 2026-11-20

## Verified infrastructure facts at discovery time

- Canonical Proxmox node `sc211-s01` responds via the InfraCare read-only connector.
- `mk-noosphere` (VM121) is running and is dedicated to Noosphere storage.
- `mk-neurocms` (VM122) is running under severe memory pressure (guest balloon telemetry showed ~187 MB free and substantial swap). Do **not** co-host an additional heavy IDE there.
- `jedicontrol-hub` (VM125) is running and is not a general-purpose editor host.
- `mk-staging` (VM120) is stopped with a 2 GiB configured memory limit; do not start, repurpose or deploy to it without inspecting owners, backups and resource fit.
- A verified guest shell/MAS deploy capability was **not** available through the current connector session. The available Linux executor targets older `mirbi-linux`, not the canonical Proxmox guests. Do not claim a live install.
- No static addresses or credentials are declared or inferred by this proposal.

## Placement decision

**Preferred:** dedicated small VM or isolated container on the new `sc211-s01` host, registered via the owner-approved node registry. Initial budget: 2–4 vCPU, 4–8 GiB RAM and SSD-backed persistent volume, verified against actual available capacity; CPU-first; no mandatory GPU.

The instance should have separate low-privilege OS identity, per-instance `userDir`, logs, encrypted backups and rollback checkpoint. Never run the editor as root or directly on the Proxmox hypervisor.

## Required gates before executing ANY deployment

1. Resolve the exact target guest by authoritative inventory and operator-approved identity (do not assume VM numbers imply permission).
2. Obtain an explicitly approved exact capability for guest install/exec, write, restart and readback; no raw API bypass or secret copying. If no such capability, stop and report `blocked/no_approved_deploy_route`.
3. Inspect free RAM/disk and existing listener conflicts, maintenance windows, snapshot/backup policy, WireGuard routing, authorized ingress and service ownership.
4. Verify pinned source release/commit, Node.js >=22.9 compatibility, clean license and dependency inventory, CI status and required offline tests.
5. Bring up a **disposable** instance with a separate userDir and only loopback HTTP inside the guest. Disable arbitrary palette install/exec/network by default; production credentials must not be imported.
6. Set up the authenticated owner-approved private ingress (TLS, admin auth, role policies, CSRF/session controls as appropriate) **before** any remote editor exposure. WireGuard connectivity alone is not authentication or capability approval.
7. Test Node-RED Admin v2 read-only `GET /flows`, initial rev, revision-aware `POST /flows` only against a disabled synthetic fixture and verify 409 on stale CAS, isolated test execution, readback and rollback.
8. Validate a user-visible editor session through the authenticated private ingress, without installing unreviewed draft PRs as production plugins.
9. Freeze immutable release artifact and record real endpoint/revision/health receipt; separately approve promotion. Capture evidence but redact secrets.
10. On failure: stop only the new isolated instance, restore its own snapshot and log the exact failure. Never restart NeuroCMS/Noosphere/hub, and never alter foreign Node-RED userDir.

## Safe staged promotion plan

- **S0:** verified host and remote command capability only, no writes.
- **S1:** disposable upstream-equivalent fork boot, baseline smoke tests, private ingress and auth. No business flows.
- **S2:** reviewed agent graph API + recursive view proposal integrated behind opt-in feature flag; test read-only interoperability with canonical Universal Graph IR.
- **S3:** approved plugin/node *addition* in isolated worker process; installation evidence and reload-free palette visibility.
- **S4:** targeted live flow revision, stateless hot swap, shadow test and rollback; stateful migration remains blocked until verified contract.
- **S5:** separate explicit production promotion with backup, canary and operator-approved MAS Lifecycle grant.

## Acceptance evidence required

```text
target_identity: verified / blocked
approved_deploy_capability: exact advertised action or none
source_commit: pinned SHA
build_ci: pass / fail / not-run
guest_resources_precheck: pass / fail / not-read
service_runtime: running / stopped / not-installed
editor_private_auth: verified / unverified
node_red_version: observed version or unknown
admin_v2_cas_409: pass / fail / not-tested
live_edit_e2e: pass / fail / not-tested
hot_node_add_e2e: pass / fail / not-tested
recovery_rollback: pass / fail / not-tested
production_changes: none until separately approved
```

## Required integration with agent peers

Existing five peers may independently take source, UI, QA and deployment-gate work only via existing policy and task ownership. Each independent QA report must identify tested branch SHA and real runtime evidence. Draft PR existence or a Node-RED Studio screenshot is not proof of server install.

**Do not interpret this document as authorization to bypass operator-approved transport or deploy automatically to a busy shared guest.**
