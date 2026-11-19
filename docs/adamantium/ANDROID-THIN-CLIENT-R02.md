# AN-0002 — Adamantium AI Core: thin Android shell and delivered runtimes

**Status:** R02 architecture + inert signed-package verifier; no production deployment. Parent: AN-0001 in draft PR #1.

## Decision

Install one long-lived Android APK, with an Android API capability bridge, user-controlled permissions, WireGuard bootstrap, secure updater, offline cache, UI renderer and a small generic interpreter/CPU inference core. Keep workflows, visual UI definitions, model descriptions, tokenizers, weight shards, skills and policy data on the owner-controlled server and deliver only selected, approved, signed, compatible artifacts on demand.

**Adamantium-node (Node-RED fork) becomes the IDE and build factory, NOT the mandatory mobile Node.js runtime.** The independent `mechanicus.universal-graph/1` compiler remains the authoritative typed representation. Node-RED flow JSON is a workbench/editor adapter and an optional server-side flow-runtime format, not an Android executable or permission grant.

```text
Adamantium-node graphical IDE (server)
     -> IR compiler + typed target resolver (separate MAS app)
     -> QA / graph CAS / policy and signed Lifecycle (separate)
     -> content-addressed runtime registry (WireGuard + authenticated HTTPS)
     -> on-device signed-release verifier and cache
     -> preinstalled typed interpreter / Android API bridges / optional local AI
```

### Permanent APK versus dynamic delivery

| In original APK, once | Delivered as signed update from server |
|---|---|
| Android Activity, default assistant eligibility, permission declarations, foreground services, VPN bootstrap | Versioned chat/task UI schema, workflows, prompts, skills, graph bindings |
| Camera/microphone/TTS/STT/intents/SAF/location/sensors/notifications and other declared adapters | Typed capability references that use only installed bridges |
| Native Android permission checks, user consent, transport, trusted public keys, policy enforcement | Policies, compatibility profiles, resources and model metadata |
| Minimal CPU-first interpreter, baseline local UI, secure updater, CAS and rollback | Local ALT/GENESIS weights, tokenizers, model configs, optional on-demand shards |
| Crash-safe fallback to last-known-good | New logical graph features within installed APK host ABI |

The phrase "all Android functionality" means **predeclared supported API bridges**, not pregranted powers. Some APIs and roles require explicit OS consent (microphone/camera, VPN, default assistant, notification listener, etc.), and some cannot be exposed to ordinary apps at all. New manifest permissions, new exported components, foreground service types or unsupported native kernels still require an app update. Do not silently elevate privileges.

### Server-side factory and typed output

1. Editor composes visible functional nodes and reusable components, not private state.
2. Graph Manager validates graph revision/CAS, permissions, budgets and compiler target. User edit never triggers execution automatically.
3. Compiler emits a signed **mobile-runtime profile** (graph IR reference, capability contracts, UI schema, budgets, model assets), independent of Node.js. It also emits separately typed server-runtime profiles when desired.
4. Independent QA/replay tests and Lifecycle release approval produce a signed manifest, its module hashes and staged rollout rules.
5. Device downloads only assets requested or needed, with a user-selected policy. In particular it does **not** fetch 65 GB of GPT-OSS-120B every time it connects.
6. Client validates pinned release signature, exact target ABI, declared capability set, resource budget, blob SHA-256 and monotonic release sequence; downloads CAS chunks with resume and stores them in app-private storage.
7. Stage -> fsync -> validate -> atomic activate -> health check -> audit. A failed release reverts to previous verified version without replacing APK. Preserve at least one last-known-good release.
8. When offline, last verified UI/graph/local inference assets continue to work within platform constraints. Strict Local must never silently fall back to server inference.

`adamantium/mobile-release-contract.mjs` is a **non-executing** Node.js reference for release signature/schema/hash validation; it neither installs code nor authorizes any Android action. Android must implement equivalent verification using platform crypto APIs with pinned public keys. Signatures cover the exact transmitted JSON bytes; no res serialization ambiguity. Revocation and trusted key rotation require an owner-controlled authenticated mechanism outside the payload itself.

### Capability and privacy boundary

Android bridge invocations are separately checked against *current* OS permissions, the active signed device/peer policy, user consent, graph revision, execution budgets and target capability. WireGuard peers prove network identity but are **not** application permissions. UI can only use typed bridge calls; no arbitrary JS bridge, shell, accessibility grant or private-key access.

The installed APK should cover conventional Camera, audio, intents/share, Storage Access Framework, location, sensors, BLE, notifications, TTS/STT and optional assistant-role surfaces. Each operation is disabled until permission and declared capability allow it. The Android shell can be updated normally when genuinely new OS components are required, but routine UI, workflow and model changes must not require APK replacement.

**Google Play constraint:** downloading DEX/JAR/native `.so` from outside Google Play is generally prohibited; Android 14+ imposes additional dynamic-code-loading safety requirements. Accordingly the Play-compatible runtime-publishing profile transports **declarative graphs and data/models**, not executable Android code. Arbitrary remote graph scripts are not a workaround. Supported computations come from preinstalled trusted interpreters/kernels.

### Local AI, Mesh and deployment targets

- `android-shell`: signed UI, flows, Android API contract references; interpreted locally.
- `android-local-ai`: lazy model weights/shards, tokenizers, config, compatibility requirements; existing on-device CPU-first interpreter. No cloud inference.
- `server-mas`: authorized graph-based backend and tool workflows, distinct from Android runtime.
- `node-red-compat`: optional original Node-RED runtime flows on server.

Routing is an independent MAS plugin. In **Strict Local**, no remote model execution is permitted. In **Auto Mesh**, remote model use requires explicit policy and compatible identity. The Android shell cannot depend on a server being online to bootstrap its WireGuard tunnel.

### Acceptance gates

R02: signed envelope + digest validation with fail-closed tests (not an Android deployment).
R03: Kotlin shell/permission brokers/typed interpreter and independent verifier.
R04: signed publisher + CAS chunk transfer, resume, update rollback, key/sequence tests.
R05: integrate Graph Manager and visual build targets in Adamantium-node IDE.
R06: real Pixel hardware offline tests, then network tests; memory, disk, thermal, power and user-consent checks.

**No credentials, private signing keys, privileged remote code or production mutations are introduced by R02.**
