# Adamantium-node R07 — independent public-only factory evidence verifier

**Stage:** safe draft, stacked on R06 (signed factory witness). R07 is deliberately separate from the signer and from the R05 editor runtime. It has NO need for an Ed25519 private key.

## Purpose

Take only published / local **public** material: (1) the exact R05 journal JSONL, (2) the R06 witness identity and signed receipt JSONL, (3) the Ed25519 *public* SPKI PEM, and (4) an independently pinned SHA-256 public-key fingerprint. Reject any signature, journal, sequence, identity or hash-chain mismatch. Report `verified_current`, `verified_stale`, or `invalid` explicitly; never treat a valid old signature as proof that all subsequent journal writes are signed.

`public-witness-verifier-r07.mjs` uses only `createPublicKey` and `crypto.verify`. It does NOT import R06's private signing class or read `signer-private.pem`. It never issues MAS permissions or evaluates business approval.

## Tri-state semantics

| Status | Definition |
|---|---|
| `verified_current` | All signed checkpoints validate and final signed revision **exactly** matches the current complete R05 hash-chain head |
| `verified_stale` | Signatures and historical heads validate, but journal advanced after the most recent signature |
| `invalid` | Bad key/fingerprint, malformed data, modified hash chain, forged signature, bad identity, torn tail, no signed checkpoint, or changed evidence during CLI verification |

Even with `verified_current`, the result always has `approvalGranted:false`, `policyEnforced:false`, `productionPublished:false`, `authorizesModuleInstallation:false`.

## Explicit local CLI

```sh
node adamantium/node-factory/cli-public-verifier-r07.mjs verify \
  <existing-absolute-ledger-directory> \
  <existing-absolute-witness-directory> \
  <operator-pinned-public-key-fingerprint> \
  <separate-existing-absolute-output-directory>
```

Output is a single atomic replaceable `public-verifier-status.json` file intended for a **read-only observer**. It refuses any directory nested in / containing the ledger or witness paths. Existing output is replaced only if it declares R07's exact status schema. It never prints or writes the signer private key, never starts Node-RED, and never exposes a signing endpoint.

## On-screen independent verification

`makePublicWitnessObserver(outputDirectory)` generates a native Node-RED graph with watch + inject → file in → json → switch, then three visible output branches: signature current / signature stale / evidence rejected. All nodes are read-only or diagnostic; the observer does not have an `exec`, `function`, shell, file-write, module-installer or privileged graph node.

The current demo witness and source journal are on the **same Windows notebook** but are separate directories. It is valid cryptographic signature testing, NOT independent-host protection. Holding the local signer private key also permits legitimate signing of future heads; R07 does not magically prevent theft of that key. Independent physical hosting, offsite signed anchoring and independent MAS approver remain future work.

## Tests

Linux/Windows Node22/24 run pure tests for the public verifier, malicious fingerprints, forged receipts, tampered journals, torn tails, stale status, the actual local CLI and observer graph. Linux/Windows Node22 also run the full R02→R07 pipeline with a real isolated Node-RED 5 execution, durable journal, signed receipt, public-only verification and cleanup.

## Next

Once a true independent witness capability is discovered, require **bilaterally authorized** source and target identities, externally pinned witness public key, signed checkpoints and explicit Lifecycle decision to promote an approved module. Until then, these are advisory, observable evidence only.
