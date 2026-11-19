# Adamantium Node R02 — isolated Node Factory

**Purpose:** create a real Node-RED node package from a trusted typed contract, pack it offline, install it into an isolated test palette, and prove its behavior using a Node-RED 5 runtime. The fork's existing `packages/` and the operator's production Node-RED instances are never modified.

## Trust boundary

- **NodeDev:** useful optional exploratory IDE, but its compatibility with Node-RED 5.0.10 has **not** been established. It is neither installed by R02 nor made a dependency.
- **Node Generator, UIBUILDER, nrlint, Dashboard:** optional, not installed. Contracts, graph validation, real tests and package signing remain independent of specific editor extensions.
- **Generated source:** fixed templates only, `uppercase` or safe literal `suffix`; no arbitrary JavaScript, Function Node, `eval`, shell, network, filesystem, raw HTML or credentials from user input.
- **Package metadata:** `private:true` and no lifecycle scripts; hard-bounded names and labels prevent package path traversal and injected editor script.
- **No installation to live palette** and no permission grants. An agent cannot use package creation as a shortcut to execution privileges.

## Actual pipeline

```text
contract JSON → strict validator → deterministic JS + HTML + package.json
→ SHA-256 manifest → npm pack --ignore-scripts
→ npm install --offline --ignore-scripts into brand-new palette root
→ SHA-256 readback of installed files
→ node-red-node-test-helper loads installed module in Node-RED 5 test runtime
→ test receipt (not a production deployment)
```

Example contract: `adamantium/node-factory/examples/demo-uppercase.json`.

Use Node.js ≥22.9, npm, and an explicit *new* sandbox directory. No global packages or production paths:

```bash
node adamantium/node-factory/cli.mjs \
  adamantium/node-factory/examples/demo-uppercase.json \
  ./my-new-factory-sandbox
```

On Windows PowerShell use one line, substituting a new isolated destination:

```powershell
node adamantium/node-factory/cli.mjs adamantium/node-factory/examples/demo-uppercase.json "$env:LOCALAPPDATA\Mechanicus\factory-example-01"
```

CLI output contains a read-only manufacture receipt with exact source paths, installed palette path, SHA-256 hashes and `registeredInProduction:false`. Existing sandbox root causes a hard failure instead of an overwrite.

### Generated node

`node-red-contrib-adamantium-demo-uppercase@0.1.0` registers the node type `adamantium-demo-uppercase`. It receives a Node-RED `msg` with string `payload`, uppercases the string, emits one message and calls `done()`. Any non-string payload yields a typed error and no output.

To inspect the produced package, look inside the sandbox's `source/`, `archives/` and `palette/` directories. Node-RED 5 palettes can find nodes through the package.json `node-red.nodes` mapping, but R02 does **not** push the package to an actual user palette UI. The real-runtime test loads the verified installed module directly.

## Validation gates

- Built-in Node tests: deterministic byte-for-byte output, preserved schema/types, rejected path/script injection, offline tarball membership, installed hash readback and node invocation.
- Real Node-RED 5: `node-red-node-test-helper` executes the installed node against a flow and checks its received message; requires the repository's npm-locked devDependencies.
- CI runs offline package tests on Node 22/24, Linux/Windows, plus a separate Linux Node 22 real-runtime job.
- This is **not yet** a NodeDev visual-node manufacturing test, real editor palette registration, npm/private-registry publication, MAS capability install or self-host bootstrap.

## Relationship to Adamantium Genome

Factory recipes can eventually become typed functional genes, artifact digests can be referenced by a signed acquired genome, and the actual runtime phenotype can be selected by the independent MAS Lifecycle. Nothing in R02 grants those capabilities. GitHub pull requests are reviewable source candidates, not live deployments.

## Next gates

R03: start an isolated Node-RED 5 server with an empty `userDir`; provision the verified package into that userDir, confirm the palette registry sees the node; construct a disposable flow via Admin API v2 (`rev`/409 CAS); run a test message; take a verified rollback point and revert. Only after that would NodeDev be tested as an optional *separate* template source with Node-RED 5.
