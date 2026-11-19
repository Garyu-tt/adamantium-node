# AN-0004 — One graph authority, multiple execution adapters

Status: draft, read-only integration specification. Depends on AN-0001 Universal Graph IR, AN-0002 signed Android thin client and AN-0003 dynamic UI. Nothing in this PR deploys services or triggers production actions.

## Architectural responsibilities

**Graph Manager / Conductor** remains the independent authority for work orders, DAGs, CAS/leases, agent assignment, budgets, permissions, recursive blocker remediation, QA and evidence-backed completion.

**AgentForge** is a specialized execution provider. Its data, workers and queue remain owned by its service. Register only capabilities confirmed in the signed MAS registry, with current policy and operator identity.

**Cezar** remains an optional coding-team provider for Git worktrees, coder/reviewer/tester teams and development tasks. Its service and model authentication are NOT currently confirmed; it must not be treated as an available executor until checked.

**Mechanicus Automation Forge** handles independent automation/scheduling, but read-only status cannot confer execution rights. OpenHands may be another optional execution adapter, not the orchestrator.

**Adamantium-node** is the graphical IDE and build factory, using Node-RED editing affordances and optional Node-RED flow runtime. Independent mechanicus.universal-graph/1, Graph Manager, credentials, Noosphere and typed MAS capabilities do not belong inside the editor.

**ALT/local coding models** are replaceable model-inference capabilities, never the control plane.

## Read-only observations on canonical Noosphere VM

On November 20, 2026, three AgentForge Python processes were observed on distinct loopback ports. Their /health replies returned HTTP 200, version R28 and available graph/metagraph indicators. The process on port 48731 lives in an R29 candidate path, and ports 48732/48733 serve two older R14 paths. Neither running process nor health reply proves canonical worker availability or write permission; historical scoped_worker R30 contract must be checked independently.

Mechanicus Automation Forge R21 systemd was active. The /healthz request returned HTTP 200 with mode read-only. The /api/v1/stats request timed out. The CMS link service was active, but no write rights were inferred.

A live Cezar service was not confirmed. Earlier development work involved the NeuroCMS R43 development copy; Claude credentials/bridge remained a blocker. Production NeuroCMS must not be modified by speculative integration.

## Shaped orchestration view

The new orchestration-view-contract.mjs validates one graph authority, optional role-based providers, states including unknown and read-only, typed capability names, bounded tasks, DAG dependencies, explicit blocker diagnostics and evidence references for completion. It rejects endpoints, bearer tokens, invocation permission flags and unexpected fields. Merely validating this data is NEVER an authorization or provenance check.

The orchestration-mobile-projection.mjs produces two screens using the existing R03 mobile-ui/1 declarative component ABI: tasks and diagnostics. Its bindings are typed snapshots. The UI cannot dispatch work, alter permissions, write graph state or operate Android APIs.

## Planned live flow (NOT YET DEPLOYED)

1. Approved Graph Manager generates authenticated, timestamped capability-graph snapshots with explicit status and provenance.
2. A request becomes a work-order DAG with independent UI, implementation, testing, approval and deployment tasks.
3. Graph Manager dispatches only to reachable, policy-approved, signed and compatible workers through scoped capability API; CAS lease, deduplication and retry budgets prevent duplicates.
4. Missing executable/credentials lead to visible diagnostic child tasks. Only independent QA and hashes establish completion.
5. Release Factory signs declarative mobile bundles and streams changed content-addressed assets over authorized WireGuard/HTTPS; client retains last-known-good offline UI.
6. Cezar and OpenHands can be removed without removing the graph or breaking noncoding workflows.

R04 delivers source/view contracts and tests ONLY. R05 must implement server-side authenticated snapshot export; R06 optional scoped adapters; R07 end-to-end QA+Release Factory; R08 Android device UI and offline checks. There is no active write-capable MAS bridge verified by this PR, no remote Cezar management, no credential access, no production deploy.
