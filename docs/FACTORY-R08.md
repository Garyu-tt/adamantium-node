# Adamantium-node R08 — off-host public evidence anchor

**Status:** draft, independently testable source, operator-driven CPU-only sandbox. R08 is stacked on R07 (#16). It neither grants MAS privileges nor deploys a production service.

## Why

R05 already has a durable hash-chain; R06 signs journal revisions using the source Windows host. R07 verifies these signatures using only public evidence. None of those stages prevents a privileged attacker who steals both source private key and ledger from rewriting the local history. R08 adds a **second Ed25519 signer on another host**. It independently validates the source public key pin, full hash-chain, every R06 signature, source revision and source witness head before signing an external checkpoint. A committed R08 receipt can later be checked on the original host using a separately pinned R08 public key.

## Trust boundaries and honest limits

| Component | Receives | Protects | Must never receive |
|---|---|---|---|
| R05 Windows ledger | signed verified proposal evidence | hash-chained journal | permission to publish from R08 |
| R06 Windows source witness | R05 chain and its source private key | first Ed25519 signature | R08 private key |
| R08 remote one-shot Python anchor | **public** R05 journal JSONL, R06 witness receipt chain and SPKI public key; source key fingerprint pinned independently in anchor identity | separate Ed25519 private key, fsynced monotonic receipt chain and source ledger ID | source signer private key, MAS tokens, Node-RED runtime or SSH agent credentials |
| R08 Windows public verifier + Node-RED lens | imported R08 **public** anchor identity, SPKI and receipt JSONL; independently provided R08 fingerprint | checks both signatures and all historical heads; reports current/stale/invalid | either private key, shell/exec, Node-RED package installer |

R08 Python uses `cryptography` with Ed25519 and the standard library. It makes **no network requests** and opens no listening ports. Key pairs are created only by explicit `init --root` under an operator-owned directory; key permissions are owner-only on POSIX. It checks for an existing root and refuses replacement. An exclusive `anchor-writer.lock` serializes signing; a crash leaves the lock for manual inspection rather than retrying a possibly ambiguous mutation.

The anchor is **not** a different administrative authority when both machines are controlled by the same owner. The R08 public receipt alone cannot prove the physical location of the signer. It provides a second cryptographic failure domain in the inspected demonstration, not hardware-backed signing, Byzantine consensus, offsite backups, native MAS capability authorization, immutable storage, or automatic replication.

## Safe operator sequence

1. Run the R07 public-only verifier against the R05/R06 ledger with the independently pinned R06 fingerprint. Refuse stale/invalid status.
2. Export the strictly whitelisted `adamantium.factory.public-bundle/1` containing `schema`, `ledgerId`, `identity`, `publicKeyPem`, `journalJSONL`, `witnessJSONL` by running `node adamantium/node-factory/export-public-bundle-r08.mjs export <ledger-absolute> <R06-witness-absolute> <pinned-source-pubkey-SHA256> <existing-public-output-dir>`.
3. Transport **only the public bundle** over an owner-approved pinned transport. Never transport either signer private key or log an authentication token.
4. On the remote host run `python3 adamantium/node-factory/offhost-anchor-r08.py init --root <new-private-anchor-dir> --ledger-id <source-ledger-id> --source-public-key-pin <pinned-source-pubkey-SHA256>` once; then `python3 ... attest --root <anchor-dir> --bundle <public-bundle-file>`.
5. Copy back **only** `anchor-identity.json`, `anchor-public.pem`, `anchor.jsonl` over an approved encrypted transport, while separately recording the remote anchor public-key SHA256 pin.
6. On Windows run `node adamantium/node-factory/cli-offhost-verifier-r08.mjs verify <source-ledger-dir> <source-witness-dir> <imported-public-anchor-dir> <source-public-pin> <anchor-public-pin> <existing-output-dir>`.
7. To visualize, use `makeOffhostAnchorAttachment(statusDirectory, preexistingTabId)` from `offhost-studio-attach-r08.mjs` and apply via editor revision CAS with a full backup. The attachment contains only `watch`, `inject`, `file in`, `json`, `switch`, `debug`, and `comment` types. It adds a second visible lane to the peer's existing R08 tab without changing existing nodes.

**Never** install this private signer under a public web root, share its private PEM, expose a signing HTTP endpoint, attach it to Node-RED's executable palette, install packages globally, modify the JediControl broker, or silently configure a tunnel.

## Demonstration evidence (2026-11-20)

The owner-authorized `jedicontrol-hub` VM125, on the newer physical server, was used **only as a one-shot preview signer**, not as a new permanent MAS platform. A separate restricted directory in its user home stores R08 key material. The existing hub services (`jedicontrol-broker`, `jedicontrol-mcp`, `caddy`) remained running throughout.

- R08 Python unit tests: **5/5 pass** on VM125, `cryptography` 38.0.4 / Python 3.11.
- Windows pure R08 public verifier tests: **3/3 pass**.
- Exported public bundle: **3,738 bytes**, SHA256 `49eef25a40664ec9b556e7f2246edbdaef19b52449ec8a197222a944e37c272b`; six whitelisted fields only.
- Remote attestation: **revision 3**, first externally signed checkpoint, replayable, R08 private key mode `0600`.
- Windows independent public-check of remote receipt: **`verified_current`**; both signatures, both histories, both revision 3 heads valid; `grantsMASCapabilities=false`.
- Visible Node-RED studio: 15 tabs, 230 nodes; **11 new read-only observer nodes** appended to the existing R08 tab with a CAS hash and a preserved backup; no missing node types or runtime errors observed.
- GitHub Actions matrix: Linux/Windows Node.js 22+24 and Python 3.11 isolated tests, with actual Node-RED 5 → Python R08 → Node.js public verifier cross-language integration.

## Next separation milestone

Move the one-shot signer into a truly independent MAS `factory_anchor` app with its own service identity, explicit bilateral authorization, separate protected anchor storage, independent key rotation, signed checkpoint transport and readback. Only then consider explicit Lifecycle promotion. A cryptographic audit receipt **never** directly authorizes installation.