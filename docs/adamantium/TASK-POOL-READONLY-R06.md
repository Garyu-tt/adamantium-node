# AN-0006 — Task Pool as work-order source; Graph Manager is a visualization

**Status:** read-only source integration, stacked on R05 PR #13. No production runtime or live MAS credentials. The adapter is inert until an approved host supplies an authenticated, permission-filtered Core graph and a Core read callback.

## Corrected ownership

Review of the existing AdamantiumToolBox source corrected the earlier R04/R05 assumption that Graph Manager itself owns the canonical task DAG.

- **Core** owns the permission-filtered visible capability graph and approved action routing, but not task records.
- **Task Pool** owns persisted task states, serialized transitions, leases and individual task revisions. Its read-only resource is task_pool.index, contract mas-task-provider-1, listAction task_pool.list, with tasks.read permission.
- **Orchestrator** owns workflow execution jobs and reports them under independent orchestration.read capability.
- **Graph Manager** is a UI-based visual federation reading the permitted graph and optional task source. It does not own task data.
- **AgentForge / Cezar** are optional execution adapters. They are not automatically task authorities.
- **Adamantium-node** is the visual editor, renderer and publisher; not a competing task scheduler.

On the checked mk-noosphere VM, AgentForge and Automation Forge were observed but a live Graph Manager process was not independently confirmed. There is no connected Adamantium MAS nodes/capabilities/invoke bridge in this chat. Source code manifest ports do not establish live services. No runtime permissions were inferred.

## R06 read adapter

1. Discovers only a visible mas-task-provider-1 resource and a same-owner action with the exact .list suffix; claim/submit/complete cannot be used as read fallbacks.
2. Takes the already authenticated Core graph and approved read callback from the host. Contains no URLs, passwords, direct HTTP, mesh fallback or executable actions.
3. Returns source-not-visible with no task list if the read resource is absent; source-read-failed with no task list if the authorized read fails. Does not invent tasks or silently present empty queues.
4. Accepts at most 200 task rows, mapping valid UUIDs to prefixed UI IDs. The underlying Task Pool may hold 256 tasks, so coverage is reported as partial regardless of result length.
5. Does not forward raw task payloads, lease tokens, result objects or credentials.

## Honest status projection

| Source Task Pool state | Read-only UI state | Interpretation |
|---|---|---|
| queued | queued | Waiting for assignment |
| claimed | claimed | Leased, not proven running |
| needs_review | needs-review | Uncertain outcome, diagnostic explanation |
| completed | completed-unverified | Task Pool reports finished; independent QA not established |
| failed | failed | Failure |
| cancelled | cancelled | Cancelled, not failed |

The Task Pool requires array contains **capabilities**, not DAG dependencies. R06 must not invent predecessor edges from requires. For a verified completion, an independent authorized QA receipt is still needed; R06 never upgrades a Task Pool completed status to complete by inference.

R04 task-view validation now accepts these genuine states without losing its requirement for explicit blockers and completion evidence.

## Signing and live integration

R06 produces a bounded, validated raw snapshot for the R05 signed envelope, plus a UI-ready projection. A trusted signing service must explicitly own an authorized Task Pool identity/delegation. R05 currently binds issuerProviderId to authorityProviderId, so a Graph Manager UI cannot silently impersonate Task Pool or become its signer. No private signing key is stored in R06.

The source graph must be authenticated separately from this library, including a pinned Mesh/HTTPS identity and approved read-only Core capability. Signature verification provides authenticity and freshness, **never task execution authority**.

## Reproduction

Run:

    node --test test/adamantium/task-pool-read-adapter.test.mjs

Nine cases validate exact read discovery, absent source, real state fidelity, no fabricated QA, input and ambiguity rejection, partial coverage and R05 signed-envelope/R03 UI compatibility.

## Unfinished gates

- Find and verify a live authorized Core + Task Pool using the canonical MAS registry, not a guessed port.
- Implement trusted publisher sequence and revision; independent task revisions cannot serve as global version.
- Persist signed last-known-good and monotonic high-water mark in protected Android storage.
- Integrate optional separate Orchestrator read adapter and proof-bearing QA events.
- Obtain lifecycle approval before connecting to running production services.

**No service restart, task mutation, deployment or permission change is part of R06.**
