# GENESIS Operator R04 — additive, standard-user extension

Status: **tested locally, NOT installed on Windows**. Windows desktop-01 was offline via JediControl on 2026-11-20. This package is not a claim of remote deployment.

This optional replacement of `operator.cjs` retains all Operator R01 actions (`status`, R02 tests, R03 tests and all R03 patterns) and adds: `test-r04`, `run-r04-moving`, `run-r04-dark`, `run-r04-bright`, `run-r04-checkerboard`. It runs only in a standard user’s already authorized JediControl/MAS scope. It does not create additional network listeners, scheduler jobs, privileged agents, Windows services or credentials.

## Safety and requirements
- Required existing R04 installation: `%LOCALAPPDATA%/Mechanicus/experiments/genesis_neural_stream_r04`.
- R04 must have `deployment-evidence.json` with exact pinned full artifact SHA-256 and source commit, plus verified status. Evidence is local integrity metadata, **not independent publisher attestation**.
- Per-action request IDs must be ASCII 8–64 characters and unique; the old Operator R01 audit path and `latest.json` remain unchanged.
- All launches execute the current installed Node.js binary with fixed arguments; `exec`/shell forwarding, hardware/camera access, mutation of source genomes and production service restart are prohibited.
- Test actions check both 26 R04 and 15 R03 regressions before reporting success; R04 fixtures validate deterministic 120-step output, 3 regions, genotype immutability and 120 synthetic frames.

## Deployment intent
Deploy only after the Windows JediControl device reconnects and the scoped owner-authorized R04 installation is verified. Prior to any change, compare the installed Operator R01 source to the known baseline SHA-256 `9fb1bd0e33202013ead5431ae7de055851392ccca9291d1f75cadd1398609551`, create a timestamped backup, validate the candidate's SHA-256, test with Node 22+, replace only the single operator script, and roll back on failure. **Do not** overwrite a divergent operator or force an upgrade.

The Node-RED monitor is a separate read-only projection. `monitor/validate-result.function.js` is the proposed replacement validator body for the existing `GENESIS | 08 Operator Monitor` function node. Apply through review with Node-RED revision-CAS; do not import duplicate tabs or replace a running workspace.

## Local verification

```bash
GENESIS_TEST_R04_PATH=/path/to/GENESIS_R04 node --test test/operator-r04.test.cjs test/monitor.test.cjs
```

All fixtures use generated 8×8 data; there is no real sensory perception, biological calibration or evidence of subjective experience.
