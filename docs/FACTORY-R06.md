# Adamantium-node R06 — signed factory witness (Ed25519, advisory-only)

R06 signs **exact journal sequence + head** of a verified R05 factory ledger. It does not publish packages, install nodes, authorize MAS graph writes, create WireGuard routes or grant Lifecycle rights. Signing is a record of evidence, not consent.

## Source and witness separation

Signer material is created in an **explicit, new directory**, different from the source R05 ledger. Signing refuses same or nested directories. An Ed25519 private key remains only in the witness directory; `signer-private.pem` must be protected by host-specific file ACLs and backup policy. Public metadata includes `witnessId`, SHA-256 public key fingerprint and the ledger identifier. Do not commit the private key or any credentials to Git.

A signed receipt is `{ledgerId,witnessId,sequence,head,previousReceipt,issuedAt,signature,receiptHash}`. The validator replays every receipt with the pinned public key, strict shape and monotonic sequence; checks the previous receipt link and unsigned data signature. When checking against a ledger, it must match the historical hash at every checkpoint, not just the latest. A changed signature, truncated journal or changed source history fails closed.

Multiple signatures of the same unchanged sequence are deduplicated. An exclusive lock protects append; an abandoned lock is **not** auto-deleted. The signed chain is fsynced and verified after append; `witness-view.json` is a replaceable display cache, not an authority.

## Demo on one host is *not* independent hosting

Running the witness and ledger in separate directories on a single Windows laptop proves Ed25519 signing and path isolation, **not** physical independence. A malicious operator with access to the private key and full disk can rewrite both histories. For a true independent trust boundary, move the signer to a separately controlled host, pin the expected public key fingerprint in the consuming service and store checkpoints in an external tamper-evident anchor. R06 supports checking an owner-pinned `expectedKeyFingerprint`, including via the CLI `inspect` command, but does **not** deploy an off-host signer, separate trust authority or automatic cross-host transport.

## Reproducible CLI

```text
node adamantium/node-factory/cli-r06.mjs init <new-absolute-witness-directory> <ledger-id>
node adamantium/node-factory/cli-r06.mjs issue <witness-directory> <existing-absolute-ledger-directory>
node adamantium/node-factory/cli-r06.mjs inspect <witness-directory> [ledger-directory] [pinned-public-key-fingerprint]
```

`inspect` produces `witness-view.json`-equivalent public data without reading or printing the signer private key. The `eligibleForIndependentReview` flag requires a verified R05 candidate, an advisory promotion request and a signed witness that covers the *current* journal head. It is never an entitlement: `approvalGranted:false`, `policyEnforced:false`, `productionPublished:false` always.

## Visible Adamantium-node studio

On a workstation, the existing Node-RED 5 studio can use `makeFactoryWitnessObserver(witnessRoot)` from `adamantium/node-factory/witness-studio-observer-r06.mjs` to produce an explicitly configured **read-only** observation graph with native `watch`, `file in`, `json` and `debug` nodes to read `witness-view.json` and `witness.jsonl`. It appears in the isolated operator preview as `06 · SIGNED WITNESS R06`. The witness signer is run by a separate operator process; the UI does not gain private-key access, shell access, direct write to journal or a production deploy button.

## Validation gates

Unit tests (Windows/Linux Node22/24) cover valid signatures, chained revisions, replay, stale history, tampering, manual lock and denial for protected paths. A real integration test (Windows/Linux Node22) verifies an R05 durable candidate using the *actual disposable Node-RED 5 runtime*, signs its journal, reopens the signer with a pinned public fingerprint, and checks `approvalGranted:false`.

R06 is a stacked draft on the R05 durable factory, which is itself stacked on R04. No source PR alone proves an independently deployed witness service, actual signed MAS policy review, or production releases.
