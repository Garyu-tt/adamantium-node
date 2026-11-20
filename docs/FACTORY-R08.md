# Adamantium-node R08: separately provisionable factory audit anchor

**State:** Source/test draft and owner-visible read-only Studio status. This is not an independently deployed server or a live MAS capability. The actual canonical Noosphere VM121 is running, but its existence does not prove an authorized `factory_anchor.attest` capability, so R08 does not install software on VM121 or copy journal material to it.

## Trust domains

R05 source journal: generates and stores exact candidate/proof/change events with CAS/replay. R06 audit witness: signs `(source revision, source head)` with its own Ed25519 key. R07 public verifier: checks every R06 signature and R05 historical hash chain using an **independently pinned R06 public key**.

R08 introduces **FactoryEvidenceAnchor**: a separately provisionable package with its own Ed25519 private key and on-disk append-only signed journal. It only reads a package of **public** R05 journal bytes and R06 public witness identity, public PEM and signed receipts. No source or witness private key is transported. Its operator-provisioned policy pins the exact ledger ID, witness identity and source public-key fingerprint.

Upon attestation R08 invokes the R07 verifier. It rejects unsigned, stale, tampered, wrong-witness or missing-history evidence. If an R08 checkpoint already exists, the entire prior R06 source receipt must remain present in the submitted chain; otherwise it rejects attempts to fork or forget previously anchored history. Every accepted entry binds an R08 sequence, source sequence/head, exact previous R08 receipt and source R06 signed-receipt hash, then is signed with R08's separate Ed25519 key and fsynced.

**Limitations:** Same-host temporary test directories are *not* independently operated hosts; the R08 core correctly exposes `independentlyHosted:false`, `independentOperatorVerified:false`, `externalMASCapabilityConnected:false`, and `actualRemoteTransport:false`. The core is an independently installable signer but does not supply an internet-reachable service or authenticated mTLS transport yet. Do not hardcode DNS, static IP, WireGuard peer or trusted CA to pretend otherwise. The default is `not_connected`.

## How a real independent anchor is connected

1. Discover the target via live Mechanicus capability graph and confirm a separate trust/host boundary and owner-approved `factory_anchor` installation. The Proxmox VM list is discovery evidence, not a deploy grant.
2. Install Core + R08 **on that approved target**, with a private key generated on the destination. Do not copy the laptop's R06 signer PEM or R08 test key. Bind a dedicated owner-approved trust policy to the exact ledger/witness identity and pinned public fingerprint.
3. Require authenticated transport with independent source/destination identities and a pinned server key (prefer mutual TLS over the existing WireGuard network, but do not assume any tunnel is already authorized or alive). Transfer public evidence only, enforce payload/quota/timeouts and idempotency/revision rules; verify final signed R08 readback from the separate host.
4. Store the R08 anchor's **public key pin** on the laptop independently from the remote response. Use a client-side public verifier to validate R08 receipts against R05+R06 evidence. Keep signing keys at destination and never let the Studio execute an arbitrary command.
5. Only then may the read-only UI show `verified_attestation` and `remoteHostVerified:true`. Any missing permission, unreachable target, unknown capability, unsigned record or host mismatch remains `not_connected`/`invalid`.

## Visual observer

`makeRemoteFactoryAnchorObserver(statusRoot)` creates `08 · REMOTE ANCHOR R08` using only native Node-RED `watch`, `inject`, `file in`, `json`, `switch`, `debug` and `comment` nodes. It reads `remote-anchor-status.json` from an owner-chosen isolated folder. The three visible branches are `not_connected`, `verified_attestation`, and `invalid`. On the owner's current laptop, the initial state must be *not_connected* until an actual independent-host witness service is authenticated. **This flow is read-only and does not open any network port.**

## Test gates

Linux and Windows Node 22/24 test pinned witness identities, Ed25519 anchor receipt-chain continuity, idempotent replay, stale/forked source denial, lock refusal, tampering and read-only Studio graph. The real Node22 Linux/Windows test also exercises the entire real isolated Node-RED R02→R08 path: generated package execution and rollback, R05 journaling, R06 signature, R07 public verification, R08 separate-key signed record. CI demonstrates cryptography and isolation of processes/data, **not physical host independence**.

## MAS authority

No signed receipt creates authorization for Lifecycle, deployment, network interface changes, publication, host migration, file transfers or configuration writes. `installationApproved:false`, `grantsMASPermission:false`, `productionPublished:false` remain hard-coded until a separate verified MAS policy service explicitly authorizes an appropriate action. R08 is a witness, not the execution authority.