#!/usr/bin/env python3
# SPDX-License-Identifier: Apache-2.0
"""Offline cross-implementation R08 signer tests, no live MAS / network."""
import base64
import importlib.util
import json
import subprocess
import sys
from pathlib import Path
import tempfile
import unittest
import hashlib

from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PrivateKey

SOURCE = Path(__file__).resolve().parents[2] / "adamantium" / "node-factory" / "offhost-anchor-r08.py"
spec = importlib.util.spec_from_file_location("offhost_anchor_r08", SOURCE)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

def j(obj):
    return json.dumps(obj, ensure_ascii=False, separators=(",", ":")).encode()

def h(value):
    return "sha256:" + hashlib.sha256(value).hexdigest()

def source_bundle():
    source_key = Ed25519PrivateKey.generate()
    pub = source_key.public_key().public_bytes(
        serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo
    ).decode()
    fingerprint = h(pub.encode())
    identity = {
        "schema": "adamantium.factory.witness-identity/1",
        "ledgerId": "factory-offhost",
        "witnessId": "witness-test-r08",
        "keyFingerprint": fingerprint
    }
    rec = {
        "schema": "adamantium.factory.event/1",
        "sequence": 1,
        "previous": module.ZERO,
        "kind": "factory.proposed",
        "recordedAt": "2026-11-20T00:00:00.000Z",
        "payload": {"proposalId": "candidate-" + "a" * 32, "sourceDigest": h(b"test")},
    }
    rec["hash"] = h(j(rec))
    unsigned = {
        "schema": "adamantium.factory.witness-receipt/1",
        "ledgerId": "factory-offhost",
        "witnessId": identity["witnessId"],
        "sequence": 1,
        "head": rec["hash"],
        "previousReceipt": module.ZERO,
        "issuedAt": "2026-11-20T00:00:01.000Z"
    }
    signature = base64.urlsafe_b64encode(source_key.sign(j(unsigned))).decode().rstrip("=")
    signed = dict(unsigned, signature=signature)
    signed["receiptHash"] = h(j(signed))
    data = {
        "schema": "adamantium.factory.public-bundle/1",
        "ledgerId": "factory-offhost",
        "identity": identity,
        "publicKeyPem": pub,
        "journalJSONL": j(rec).decode() + "\n",
        "witnessJSONL": j(signed).decode() + "\n"
    }
    return data, fingerprint

class OffHostAnchorTest(unittest.TestCase):
    def setUp(self):
        self.context = tempfile.TemporaryDirectory(prefix="adamantium-r08-test-")
        self.addCleanup(self.context.cleanup)
        self.tmp = Path(self.context.name)
        self.root = self.tmp / "anchor"
        self.bundle = self.tmp / "source.json"
        self.input, self.pin = source_bundle()
        self.bundle.write_text(json.dumps(self.input, ensure_ascii=False), encoding="utf-8")

    def init(self):
        self.assertEqual(module.init(self.root, "factory-offhost", self.pin)["checkpoints"], 0)
        self.assertTrue((self.root / "anchor-private.pem").exists())

    def test_single_checkpoint_replay_and_no_privileges(self):
        self.init()
        first = module.attest(self.root, self.bundle)
        self.assertFalse(first["replayed"])
        self.assertEqual(first["receipt"]["sourceSequence"], 1)
        self.assertEqual(first["view"]["checkpoints"], 1)
        self.assertFalse(first["view"]["masApprovalGranted"])
        self.assertFalse(first["view"]["productionPublished"])
        again = module.attest(self.root, self.bundle)
        self.assertTrue(again["replayed"])
        self.assertEqual(again["receipt"]["receiptHash"],first["receipt"]["receiptHash"])
        self.assertEqual(module.load_state(self.root)[1][0]["sourceHead"],
                         first["receipt"]["sourceHead"])
        self.assertNotIn("anchor-private.pem", json.dumps(first))

    def test_source_bundle_pin_and_modification_denied(self):
        self.init()
        source = dict(self.input)
        source["journalJSONL"] = source["journalJSONL"].replace("factory.proposed", "factory.verified")
        self.bundle.write_text(json.dumps(source), encoding="utf-8")
        with self.assertRaisesRegex(module.Denied, "journal_hash_invalid"):
            module.attest(self.root, self.bundle)
        source["journalJSONL"] = self.input["journalJSONL"]
        source["publicKeyPem"] = source["publicKeyPem"].replace("A", "B", 1)
        self.bundle.write_text(json.dumps(source), encoding="utf-8")
        with self.assertRaisesRegex(module.Denied, "witness_key_pin_mismatch"):
            module.attest(self.root, self.bundle)
        self.assertEqual(len(module.load_state(self.root)[1]), 0)

    def test_wrong_ledger_id_and_unpinned_identity_denied(self):
        self.init()
        source = dict(self.input, ledgerId="other-ledger")
        self.bundle.write_text(json.dumps(source), encoding="utf-8")
        with self.assertRaisesRegex(module.Denied, "witness_identity_not_pinned"):
            module.attest(self.root, self.bundle)
        source = dict(self.input)
        source["identity"] = dict(source["identity"], keyFingerprint="sha256:"+"b"*64)
        self.bundle.write_text(json.dumps(source), encoding="utf-8")
        with self.assertRaisesRegex(module.Denied, "witness_identity_not_pinned"):
            module.attest(self.root, self.bundle)

    def test_signer_integrity_rejection_and_lock(self):
        self.init()
        result=module.attest(self.root,self.bundle)
        path=self.root/"anchor.jsonl"
        good=path.read_text()
        path.write_text(good.replace(result["receipt"]["sourceHead"],h(b"foreign")))
        with self.assertRaisesRegex(module.Denied,"anchor_signature_invalid|anchor_receipt_hash_invalid"):
            module.load_state(self.root)
        path.write_text(good)
        lock=self.root/"anchor-writer.lock"
        lock.write_text("foreign worker")
        with self.assertRaisesRegex(module.Denied,"anchor_writer_busy"):
            module.attest(self.root,self.bundle)
        self.assertEqual(lock.read_text(),"foreign worker")

    def test_cli_non_destructive_init_and_inspect(self):
        argv=[sys.executable,str(SOURCE),"init","--root",str(self.root),
              "--ledger-id","factory-offhost","--source-public-key-pin",self.pin]
        p=subprocess.run(argv,text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(p.stdout)["checkpoints"],0)
        duplicate=subprocess.run(argv,text=True,capture_output=True)
        self.assertNotEqual(duplicate.returncode,0)
        argv=[sys.executable,str(SOURCE),"inspect","--root",str(self.root)]
        result=subprocess.run(argv,text=True,capture_output=True,check=True)
        self.assertEqual(json.loads(result.stdout)["checkpoints"],0)

if __name__=="__main__":
    unittest.main(verbosity=2)
