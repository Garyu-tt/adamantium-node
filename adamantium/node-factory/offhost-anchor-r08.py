#!/usr/bin/env python3
"""R08: one-shot off-host Ed25519 *audit-only* anchor, no network service.

Inputs contain only public R05/R06 evidence. Source witness public key is
pinned separately in the anchor directory, never accepted from a bundle pin.
Uses cryptography >=38 and Python >=3.11.
"""
from __future__ import annotations
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import re
import sys
import uuid
from datetime import datetime, timezone

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey, Ed25519PublicKey
from cryptography.exceptions import InvalidSignature

ZERO = "sha256:" + "0" * 64
HEX = re.compile(r"^sha256:[a-f0-9]{64}$")
IDENT = re.compile(r"^[a-z][a-z0-9_.-]{2,95}$")
EVENT_TYPES = {"factory.proposed", "factory.verified",
               "factory.rejected", "factory.promotion.requested"}
KIND = "adamantium.factory.offhost-anchor/1"
RECEIPT = "adamantium.factory.offhost-receipt/1"
VIEW = "adamantium.factory.offhost-view/1"

class Denied(Exception):
    pass

def require(ok, why):
    if not ok:
        raise Denied(why)

def stable(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":"), allow_nan=False).encode("utf-8")

def digest(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()

def exactly(obj, keys):
    return isinstance(obj, dict) and set(obj) == set(keys)

def read_regular(path, maximum):
    require(path.is_file() and not path.is_symlink(), "untrusted_file_type")
    require(path.stat().st_size <= maximum, "source_size_budget")
    return path.read_bytes()

def parse_lines(data, maximum, purpose):
    require(len(data) <= maximum, purpose + "_size_budget")
    require(not data or data.endswith(b"\n"), purpose + "_torn_tail")
    out = []
    for line in data.splitlines():
        require(len(line) <= 16384, purpose + "_record_too_large")
        if not line:
            continue
        try:
            out.append(json.loads(line))
        except (ValueError, UnicodeDecodeError):
            raise Denied(purpose + "_invalid_json") from None
    require(len(out) <= 8192, purpose + "_record_limit")
    return out

def utc_now():
    return datetime.now(timezone.utc).isoformat(timespec="milliseconds").replace("+00:00", "Z")

def secure_root(root):
    p = Path(root).expanduser()
    require(p.is_absolute() and str(p) != p.anchor, "explicit_nonroot_path_required")
    return p.resolve()

def read_public_bundle(bundle, expected_pin):
    raw = read_regular(Path(bundle), 8 * 1024 * 1024)
    try:
        body = json.loads(raw)
    except ValueError:
        raise Denied("invalid_public_bundle") from None
    fields = ["schema", "ledgerId", "identity", "publicKeyPem", "journalJSONL", "witnessJSONL"]
    require(exactly(body, fields) and body["schema"] == "adamantium.factory.public-bundle/1",
            "bundle_schema_invalid")
    ledger_id = body["ledgerId"]
    identity = body["identity"]
    require(isinstance(ledger_id, str) and IDENT.fullmatch(ledger_id),
            "invalid_ledger_id")
    require(exactly(identity, ["schema", "ledgerId", "witnessId", "keyFingerprint"]) and
            identity["schema"] == "adamantium.factory.witness-identity/1" and
            identity["ledgerId"] == ledger_id and
            isinstance(identity["witnessId"], str) and IDENT.fullmatch(identity["witnessId"]) and
            identity["keyFingerprint"] == expected_pin, "witness_identity_not_pinned")
    pem = body["publicKeyPem"]
    require(isinstance(pem, str) and len(pem) <= 4096 and
            digest(pem.encode()) == expected_pin, "witness_key_pin_mismatch")
    try:
        public = serialization.load_pem_public_key(pem.encode())
    except ValueError:
        raise Denied("invalid_source_public_key") from None
    require(isinstance(public, Ed25519PublicKey), "wrong_source_public_algorithm")
    require(isinstance(body["journalJSONL"], str) and
            isinstance(body["witnessJSONL"], str), "invalid_jsonl_data")
    journal = parse_lines(body["journalJSONL"].encode(), 4 * 1024 * 1024, "journal")
    signed = parse_lines(body["witnessJSONL"].encode(), 3 * 1024 * 1024, "witness")
    revision, head = 0, ZERO
    historical = {0: ZERO}
    for event in journal:
        keys = ["schema", "sequence", "previous", "kind", "recordedAt", "payload", "hash"]
        require(exactly(event, keys) and event["schema"] == "adamantium.factory.event/1" and
                type(event["sequence"]) is int and event["sequence"] == revision + 1 and
                event["previous"] == head and event["kind"] in EVENT_TYPES and
                isinstance(event["recordedAt"], str) and
                isinstance(event["payload"], dict) and
                isinstance(event["hash"], str) and HEX.fullmatch(event["hash"]),
                "journal_schema_or_sequence_invalid")
        unsigned = {key: value for key, value in event.items() if key != "hash"}
        require(digest(stable(unsigned)) == event["hash"], "journal_hash_invalid")
        revision, head = event["sequence"], event["hash"]
        historical[revision] = head
    previous = None
    for proof in signed:
        keys = ["schema", "ledgerId", "witnessId", "sequence", "head",
                "previousReceipt", "issuedAt", "signature", "receiptHash"]
        require(exactly(proof, keys) and proof["schema"] == "adamantium.factory.witness-receipt/1" and
                proof["ledgerId"] == ledger_id and proof["witnessId"] == identity["witnessId"] and
                type(proof["sequence"]) is int and proof["sequence"] > (previous["sequence"] if previous else 0) and
                isinstance(proof["head"], str) and HEX.fullmatch(proof["head"]) and
                proof["previousReceipt"] == (previous["receiptHash"] if previous else ZERO) and
                historical.get(proof["sequence"]) == proof["head"] and
                isinstance(proof["signature"], str) and
                isinstance(proof["receiptHash"], str) and HEX.fullmatch(proof["receiptHash"]) and
                isinstance(proof["issuedAt"], str), "witness_chain_invalid")
        unsigned = {key: value for key, value in proof.items()
                    if key not in ("signature", "receiptHash")}
        try:
            sig = proof["signature"]
            require(re.fullmatch(r"[A-Za-z0-9_-]{70,128}", sig) is not None,
                    "witness_signature_encoding_invalid")
            public.verify(base64.urlsafe_b64decode(sig + "=" * (-len(sig) % 4)),
                          stable(unsigned))
        except (InvalidSignature, ValueError):
            raise Denied("witness_signature_invalid") from None
        require(digest(stable(dict(unsigned, signature=sig))) == proof["receiptHash"],
                "witness_receipt_hash_invalid")
        previous = proof
    require(previous is not None, "no_signed_checkpoint")
    require(previous["sequence"] == revision and previous["head"] == head,
            "witness_stale_refuse_anchor")
    return {
        "ledgerId": ledger_id, "sourceWitnessId": identity["witnessId"],
        "sourceKeyFingerprint": expected_pin, "sequence": revision, "head": head,
        "sourceReceiptHash": previous["receiptHash"], "sourceCheckpoints": len(signed)
    }

def public_fingerprint(pem):
    return digest(pem)

def load_state(root):
    identity = json.loads(read_regular(root / "anchor-identity.json", 4096))
    require(exactly(identity, ["schema", "anchorId", "keyFingerprint", "sourceKeyPin", "sourceLedgerId"]) and
            identity["schema"] == KIND and
            isinstance(identity["anchorId"], str) and IDENT.fullmatch(identity["anchorId"]) and
            HEX.fullmatch(identity["keyFingerprint"]) and
            HEX.fullmatch(identity["sourceKeyPin"]) and
            isinstance(identity["sourceLedgerId"], str) and
            IDENT.fullmatch(identity["sourceLedgerId"]), "invalid_anchor_identity")
    pem = read_regular(root / "anchor-public.pem", 4096)
    require(public_fingerprint(pem) == identity["keyFingerprint"], "anchor_key_mismatch")
    key = serialization.load_pem_public_key(pem)
    require(isinstance(key, Ed25519PublicKey), "anchor_key_algorithm_invalid")
    receipts = parse_lines(read_regular(root / "anchor.jsonl", 3 * 1024 * 1024),
                           3 * 1024 * 1024, "anchor")
    previous = None
    for rec in receipts:
        fields = ["schema", "anchorId", "ledgerId", "sourceWitnessId",
                  "sourceKeyFingerprint", "sourceSequence", "sourceHead",
                  "sourceReceiptHash", "previousReceipt", "issuedAt",
                  "signature", "receiptHash"]
        require(exactly(rec, fields) and rec["schema"] == RECEIPT and
                rec["anchorId"] == identity["anchorId"] and
                rec["sourceKeyFingerprint"] == identity["sourceKeyPin"] and
                type(rec["sourceSequence"]) is int and
                rec["sourceSequence"] > (previous["sourceSequence"] if previous else 0) and
                rec["previousReceipt"] == (previous["receiptHash"] if previous else ZERO) and
                all(isinstance(rec[k], str) and HEX.fullmatch(rec[k])
                    for k in ("sourceHead", "sourceReceiptHash", "receiptHash")),
                "anchor_chain_invalid")
        unsigned = {key: value for key, value in rec.items()
                    if key not in ("signature", "receiptHash")}
        try:
            value = rec["signature"]
            require(isinstance(value, str) and
                    re.fullmatch(r"[A-Za-z0-9_-]{70,128}", value) is not None,
                    "anchor_signature_encoding_invalid")
            key.verify(base64.urlsafe_b64decode(value + "=" * (-len(value) % 4)),
                       stable(unsigned))
        except (InvalidSignature, ValueError):
            raise Denied("anchor_signature_invalid") from None
        require(digest(stable(dict(unsigned, signature=value))) == rec["receiptHash"],
                "anchor_receipt_hash_invalid")
        previous = rec
    return identity, receipts

def publish_view(root, identity, receipts):
    current = receipts[-1] if receipts else None
    view = {
        "schema": VIEW, "anchorId": identity["anchorId"],
        "anchorKeyFingerprint": identity["keyFingerprint"],
        "sourceWitnessPublicKeyPin": identity["sourceKeyPin"],
        "sourceLedgerId": identity["sourceLedgerId"],
        "checkpoints": len(receipts), "latest": current,
        "signatureVerified": bool(current),
        "offhostProofRecorded": bool(current),
        "physicallyIsolatedSignerVerified": False,
        "masApprovalGranted": False, "productionPublished": False
    }
    temp = root / ("anchor-view." + uuid.uuid4().hex + ".tmp")
    try:
        with temp.open("x", encoding="utf-8") as f:
            os.chmod(temp, 0o600)
            f.write(json.dumps(view, ensure_ascii=False, indent=2) + "\n")
            f.flush()
            os.fsync(f.fileno())
        os.replace(temp, root / "anchor-view.json")
    finally:
        temp.unlink(missing_ok=True)
    return view

def init(root, ledger_id, pinned_source_key):
    require(not root.exists() and IDENT.fullmatch(ledger_id) and
            HEX.fullmatch(pinned_source_key), "unsafe_anchor_initialization")
    root.mkdir(mode=0o700)
    os.chmod(root, 0o700)
    key = Ed25519PrivateKey.generate()
    private = key.private_bytes(
        serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
        serialization.NoEncryption()
    )
    public = key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    )
    identity = {
        "schema": KIND, "anchorId": "anchor-" + public_fingerprint(public)[7:31],
        "keyFingerprint": public_fingerprint(public),
        "sourceKeyPin": pinned_source_key,
        "sourceLedgerId": ledger_id
    }
    for name, data, mode in [
        ("anchor-private.pem", private, 0o600),
        ("anchor-public.pem", public, 0o644),
        ("anchor-identity.json", json.dumps(identity, indent=2).encode(), 0o600),
        ("anchor.jsonl", b"", 0o600)
    ]:
        fd = os.open(root / name, os.O_WRONLY | os.O_CREAT | os.O_EXCL, mode)
        with os.fdopen(fd, "wb") as f:
            f.write(data)
            f.flush()
            os.fsync(f.fileno())
    return publish_view(root, identity, [])

def attest(root, bundle):
    fd = None
    lock = root / "anchor-writer.lock"
    try:
        fd = os.open(lock, os.O_CREAT | os.O_EXCL | os.O_WRONLY, 0o600)
    except FileExistsError:
        raise Denied("anchor_writer_busy") from None
    try:
        identity, receipts = load_state(root)
        source = read_public_bundle(bundle, identity["sourceKeyPin"])
        require(source["ledgerId"] == identity["sourceLedgerId"],
                "anchor_ledger_id_mismatch")
        prior = receipts[-1] if receipts else None
        if prior:
            require(prior["ledgerId"] == source["ledgerId"] and
                    prior["sourceWitnessId"] == source["sourceWitnessId"],
                    "anchor_source_identity_changed")
            require(source["sequence"] >= prior["sourceSequence"],
                    "anchor_source_revision_regressed")
            if source["sequence"] == prior["sourceSequence"]:
                require(source["head"] == prior["sourceHead"] and
                        source["sourceReceiptHash"] == prior["sourceReceiptHash"],
                        "anchor_source_history_conflict")
                return {"replayed": True, "receipt": prior,
                        "view": publish_view(root, identity, receipts)}
        private_pem = read_regular(root / "anchor-private.pem", 4096)
        key = serialization.load_pem_private_key(private_pem, password=None)
        require(isinstance(key, Ed25519PrivateKey), "invalid_anchor_private_key")
        public = key.public_key().public_bytes(
            serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
        )
        require(public_fingerprint(public) == identity["keyFingerprint"],
                "anchor_private_key_mismatch")
        unsigned = {
            "schema": RECEIPT, "anchorId": identity["anchorId"],
            "ledgerId": source["ledgerId"], "sourceWitnessId": source["sourceWitnessId"],
            "sourceKeyFingerprint": source["sourceKeyFingerprint"],
            "sourceSequence": source["sequence"], "sourceHead": source["head"],
            "sourceReceiptHash": source["sourceReceiptHash"],
            "previousReceipt": prior["receiptHash"] if prior else ZERO,
            "issuedAt": utc_now()
        }
        signature = base64.urlsafe_b64encode(key.sign(stable(unsigned))).decode().rstrip("=")
        signed = dict(unsigned, signature=signature)
        receipt = dict(signed, receiptHash=digest(stable(signed)))
        # Verification and source hash checked again before durable append.
        identity_latest, history_latest = load_state(root)
        require(identity_latest == identity and len(history_latest) == len(receipts),
                "anchor_changed_during_sign")
        with (root / "anchor.jsonl").open("ab") as f:
            f.write(stable(receipt) + b"\n")
            f.flush()
            os.fsync(f.fileno())
        verified_id, verified_receipts = load_state(root)
        require(verified_receipts[-1]["receiptHash"] == receipt["receiptHash"],
                "anchor_append_readback_failed")
        return {"replayed": False, "receipt": receipt,
                "view": publish_view(root, verified_id, verified_receipts)}
    finally:
        if fd is not None:
            os.close(fd)
            lock.unlink(missing_ok=True)

def main():
    parser = argparse.ArgumentParser(description="One-shot off-host factory audit; never grants MAS rights")
    parser.add_argument("operation", choices=("init", "attest", "inspect"))
    parser.add_argument("--root", required=True)
    parser.add_argument("--ledger-id")
    parser.add_argument("--source-public-key-pin")
    parser.add_argument("--bundle")
    args = parser.parse_args()
    root = secure_root(args.root)
    if args.operation == "init":
        require(args.ledger_id and args.source_public_key_pin and not args.bundle,
                "init_requires_pinned_key")
        view = init(root, args.ledger_id, args.source_public_key_pin)
        result = {"state": "initialized", "identity": view["anchorId"],
                  "fingerprint": view["anchorKeyFingerprint"], "checkpoints": 0}
    elif args.operation == "attest":
        require(args.bundle is not None and not args.ledger_id and
                not args.source_public_key_pin, "attest_requires_public_bundle")
        operation = attest(root, args.bundle)
        result = {"state": "attested", "sequence": operation["receipt"]["sourceSequence"],
                  "receiptHash": operation["receipt"]["receiptHash"],
                  "replayed": operation["replayed"], "anchorId": operation["receipt"]["anchorId"],
                  "masApprovalGranted": False, "productionPublished": False}
    else:
        identity, receipts = load_state(root)
        result = {"state": "inspected", "anchorId": identity["anchorId"],
                  "fingerprint": identity["keyFingerprint"], "checkpoints": len(receipts),
                  "latestSequence": receipts[-1]["sourceSequence"] if receipts else None,
                  "masApprovalGranted": False, "productionPublished": False}
    print(json.dumps(result, ensure_ascii=False, separators=(",", ":")))

if __name__ == "__main__":
    try:
        main()
    except (Denied, OSError, ValueError, TypeError) as exception:
        reason = str(exception) if isinstance(exception, Denied) else exception.__class__.__name__
        print(json.dumps({"state": "denied", "reason": reason}), file=sys.stderr)
        sys.exit(1)
