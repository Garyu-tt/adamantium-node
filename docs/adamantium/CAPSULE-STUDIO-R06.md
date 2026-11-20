# Adamantium-node R06 — canonical native G0 gate

**Status:** isolated tested native C++17 compiler integration. Stacked on draft R05, R04, R03, R02, R01. No merge or deploy is implied.

## Canonical source

This adapter links to the unchanged CPU-first Universal Graph IR C++17 compiler from Garyu-tt/AdamantiumToolBox PR #143. The source commit is pinned to **da55544d738eca138b823175bdbc266a9efb8855**. No independent implementation is substituted for the native compiler.

## Modules

- native/capsule-g0-bridge.cpp — bounded 2MB stdin parser for source-free typed IR, calls mas::graph::compile(), returns deterministic OK or REJECT. No code execution.
- native/CMakeLists.txt — requires explicit MAS_G0_ROOT and links the canonical static native library.
- adamantium/capsule-native-g0.mjs — validates R03 proposal, serializes strict ASCII transport, pins local compiled executable SHA256, runs without a shell with resource/time limits, verifies native graph/node/edge counts and returns R05 nativeValidate() result.
- test/adamantium/capsule-native-g0.test.mjs — native G0 acceptance, 17-level nested rejection, bad binary digest, CAS scope mismatch, malformed input, real R05 durable inbox + signed receipt.
- .github/workflows/capsule-studio-r06.yml — pinned ToolBox source checkout and native build plus upstream CTest; Linux/Windows Node 22/24 native tests required.

## Local build

With an independently checked-out ToolBox commit at the pinned revision:

    cmake -S native -B build -DMAS_G0_ROOT=/absolute/path/to/ToolBox/native/universal-graph
    cmake --build build --config Release
    ctest --test-dir build --build-config Release --output-on-failure

Set ADAMANTIUM_G0_VALIDATOR_BIN to the absolute path of the native executable; calculate its SHA256 locally and pass it to createPinnedNativeG0Validator({binaryPath,binarySha256}). The CI runner derives the SHA256 only from the just-built pinned source, which is not an operator trust grant.

## Verified 20 November 2026

On owner's Linux test host the native compiler adapter was compiled with GCC 14.2, toolchain files extracted to a disposable temporary directory without system installation.

Canonical upstream G0 test succeeded and evaluated a synthetic 10,000-node graph, printing UGRAPH_G0_OK (21 ms on that machine only, not a benchmark guarantee).

With the native C++ executable actually present:
- Node v22.16.0: **67 tests passed, 0 failed, 0 skipped**.
- Node v24.11.1: **67 tests passed, 0 failed, 0 skipped**.

A native 17-level composite depth failure was proved even though R03 JavaScript structural validation accepted the proposal. Real R05 signed review inbox now has a tested native G0 callback, but the graph remains pending review, not promoted or executed.

## Trust limitations

- Native G0 validates **structure**, not permission. R05 Core authenticate/authorize/isPrimary remain explicitly injected and are mocked in these tests. Do not confuse the signed receipt with runtime approval.
- A binary SHA256 check before spawning does not prevent filesystem TOCTOU replacement, does not isolate the native process with seccomp/AppContainer and is not a release signature. Production requires an immutable executable path and sandbox.
- No real MAS Graph Manager provider has been connected, discovered or deployed. No public listener, VM121/VM122, active Node-RED, Windows desktop, runtime code executor or production access policy changed.
- Native G0 limits composite nesting to 16 levels; editor previews may need to warn when graphs exceed this bound.
- Neural Event/Signal delayed feedback exists in native G0 but requires separately approved explicit-delay editor support. R03's normal exported edges are zero-delay.
- Main Node-RED SVG canvas and atomic runtime hot swap are separate future integrations.

## Next gate

Discover a live authorized Graph Manager capability, connect native G0 under its separate MAS permissions, and add authoritative durable review/approve/promote CAS with independent monotonic anti-rollback witness, signed receipts, and pause/drain/swap/recover semantics. No auto-merge or production rollout in this draft.
