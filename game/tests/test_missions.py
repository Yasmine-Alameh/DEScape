"""Encrypt / Decrypt missions, the DES Lab's whole-message tools, and the notebook's DES values."""
import base64
import json

from django.contrib.auth.models import User
from django.test import Client, TestCase

from des_engine import decrypt, encrypt, hex_to_ascii
from game import autoplay
from game import puzzles as P
from game import services as S
from game.generator import generate_params

PW = "a-Strong-pass-455"


def make_user(name):
    return User.objects.create_user(name, password=PW)


class DecryptMissionTests(TestCase):
    def setUp(self):
        self.p = generate_params(7, direction="decrypt")
        self.ctx = P.context(self.p)

    def test_default_is_encrypt(self):
        self.assertEqual(generate_params(7)["direction"], "encrypt")
        self.assertEqual(P.context(generate_params(7))["dir"], "encrypt")

    def test_every_puzzle_accepts_its_answer_and_rejects_wrong(self):
        for pid in P.BUILDERS:
            pz = P.build(self.p, pid)
            self.assertTrue(P.check(pz, pz.answer)[0], pid)
            ok, errors, _, _ = P.check(pz, autoplay.wrong_answer(pz))
            self.assertFalse(ok, pid)

    def test_rooms_1_to_3_decrypt_the_intercepted_ciphertext(self):
        key, code = self.p["key"], self.p["code"]
        cipher = encrypt(P.context(self.p)["plain_hex"], key)
        self.assertEqual(P.build(self.p, "r1_ascii").answer["hex"], cipher)
        self.assertEqual(self.ctx["enc"]["input"]["hex"], cipher)
        # the reactor's 16 rounds run K16 … K1 and produce the plaintext
        self.assertEqual([r["key_index"] for r in self.ctx["enc"]["rounds"]], list(range(16, 0, -1)))
        self.assertEqual(self.ctx["enc"]["output"]["hex"], decrypt(cipher, key))
        self.assertEqual(hex_to_ascii(self.ctx["enc"]["output"]["hex"]), code)
        self.assertEqual(P.build(self.p, "r4_code").answer["code"], code)

    def test_room_4_verifies_by_encrypting(self):
        self.assertEqual(P.build(self.p, "r4_order").answer["order"], ",".join(map(str, range(1, 17))))
        pz = P.build(self.p, "r4_round")
        self.assertEqual(pz.answer["key"], str(self.p["r4"]["round"]))
        self.assertEqual(self.ctx["r4"]["output"]["hex"], self.ctx["cipher_in"])

    def test_secret_message_not_leaked_before_decryption(self):
        code = self.p["code"]
        for pid in P.BUILDERS:
            if pid == "r4_code":
                continue
            pub = json.dumps(P.build(self.p, pid).public(solved=False))
            self.assertNotIn(code, pub, pid)

    def test_full_playthrough_and_inventory(self):
        u = make_user("dora")
        a = S.start_attempt(u, seed=5, direction="decrypt")
        self.assertEqual(S.state(a)["attempt"]["direction"], "decrypt")
        inv = json.dumps(S.inventory(a))
        self.assertNotIn(a.params["code"], inv)
        autoplay.play(a, skill=1.0)
        a.refresh_from_db()
        self.assertEqual(a.status, "completed")
        items = {i["id"]: i for i in S.inventory(a)}
        self.assertEqual(dict(items["exitcode"]["values"])["Message"], a.params["code"])
        self.assertEqual(S.archive(a, "encrypt")["mode"], "decrypt")
        self.assertEqual(S.archive(a, "decrypt")["mode"], "encrypt")

    def test_dashboard_starts_chosen_mission(self):
        make_user("mia")
        c = Client()
        c.login(username="mia", password=PW)
        c.post("/adventure/new/", {"mode": "guided", "direction": "decrypt"})
        a = User.objects.get(username="mia").attempts.latest("id")
        self.assertEqual(a.params["direction"], "decrypt")


class LabDataApiTests(TestCase):
    def setUp(self):
        make_user("lab")
        self.c = Client()
        self.c.login(username="lab", password=PW)

    def post(self, url, data):
        return self.c.post(url, json.dumps(data), content_type="application/json")

    def test_text_round_trip_both_modes(self):
        for mode in ("ECB", "CBC"):
            r = self.post("/api/des/data/", {"mode": "encrypt", "key": "133457799BBCDFF1", "kind": "text",
                                              "data": "Hello DES, any length!", "cipher_mode": mode, "padding": True})
            self.assertEqual(r.status_code, 200, r.content)
            out = r.json()["output_hex"]
            r = self.post("/api/des/data/", {"mode": "decrypt", "key": "133457799BBCDFF1", "kind": "hex",
                                              "data": out, "cipher_mode": mode, "padding": True})
            self.assertEqual(r.json()["output_text"], "Hello DES, any length!")

    def test_file_round_trip(self):
        raw = bytes(range(256)) * 3 + b"xyz"
        b64 = base64.b64encode(raw).decode()
        r = self.post("/api/des/data/", {"mode": "encrypt", "key": "0E329232EA6D0D73", "kind": "file", "data": b64,
                                          "filename": "pic.bin", "cipher_mode": "CBC", "padding": True})
        j = r.json()
        self.assertEqual(j["filename"], "pic.bin.des")
        r = self.post("/api/des/data/", {"mode": "decrypt", "key": "0E329232EA6D0D73", "kind": "file",
                                          "data": j["output_b64"], "filename": "pic.bin.des", "cipher_mode": "CBC", "padding": True})
        self.assertEqual(base64.b64decode(r.json()["output_b64"]), raw)
        self.assertEqual(r.json()["filename"], "pic.bin")

    def test_wrong_key_and_no_padding_errors(self):
        r = self.post("/api/des/data/", {"mode": "encrypt", "key": "133457799BBCDFF1", "kind": "text", "data": "secret",
                                          "cipher_mode": "ECB", "padding": True})
        out = r.json()["output_hex"]
        r = self.post("/api/des/data/", {"mode": "decrypt", "key": "0123456789ABCDEF", "kind": "hex", "data": out,
                                          "cipher_mode": "ECB", "padding": True})
        self.assertEqual(r.status_code, 400)
        self.assertIn("padding", r.json()["error"].lower())
        r = self.post("/api/des/data/", {"mode": "encrypt", "key": "133457799BBCDFF1", "kind": "text", "data": "abc",
                                          "cipher_mode": "ECB", "padding": False})
        self.assertEqual(r.status_code, 400)

    def test_weak_key_and_ecb_repeats(self):
        r = self.post("/api/des/data/", {"mode": "encrypt", "key": "0101010101010101", "kind": "text", "data": "A" * 32,
                                          "cipher_mode": "ECB", "padding": True})
        j = r.json()
        self.assertTrue(any("WEAK" in w for w in j["warnings"]))
        self.assertTrue(j["ecb_repeats"])

    def test_password_and_random_key(self):
        r = self.post("/api/des/key/", {"password": "aub-eece455"})
        self.assertEqual(r.json()["key"], "D6CEF4015BDC1A16")
        k = self.post("/api/des/key/", {"action": "random"}).json()["key"]
        self.assertEqual(len(k), 16)
        self.assertTrue(all(bin(b).count("1") % 2 for b in bytes.fromhex(k)))


class NotebookValuesTests(TestCase):
    def test_values_appear_only_after_solving(self):
        u = make_user("nina")
        a = S.start_attempt(u, seed=3)
        c = Client()
        c.login(username="nina", password=PW)
        html = c.get("/notebook/").content.decode()
        self.assertNotIn(P.context(a.params)["plain_hex"], html)
        autoplay.play(a, rooms=(1,), skill=1.0)
        html = c.get("/notebook/").content.decode()
        self.assertIn(P.context(a.params)["plain_hex"], html)
        self.assertIn("/lab/?block=", html)


class AssessmentBankTests(TestCase):
    def test_bank_shape(self):
        from game import question_bank as Q
        self.assertGreaterEqual(len(Q.BANK), 100)
        self.assertEqual(len(Q.BY_ID), len(Q.BANK) + len(Q.OLD_BANK))
        for lo in Q.OBJECTIVES:
            self.assertTrue(any(q[1] == lo for q in Q.BANK), lo)
        for qid, lo, text, options, why, slides in Q.BANK:
            self.assertTrue(qid.startswith("c3-") and slides, qid)
            self.assertIn(lo, Q.OBJECTIVES)
            self.assertEqual(len(set(options)), 4, qid)
            self.assertTrue(why)

    def test_random_sets_and_legacy_review(self):
        from game import assessments as A
        sets = {tuple(sorted(A.draw())) for _ in range(5)}
        self.assertGreater(len(sets), 1)
        ids = A.draw()
        self.assertEqual(len(ids), 7)
        self.assertTrue(all(i.startswith("c3-") for i in ids))
        self.assertEqual(sorted(A.BY_ID[i][1] for i in ids), list(A.OBJECTIVES))
        score, total, per = A.grade(ids, {i: "0" for i in ids})
        self.assertEqual((score, total), (7, 7))
        self.assertEqual(per["LO1"], [1, 1])
        old = A.review("pre", {str(i): "0" for i in range(7)})  # a result saved before the bank existed
        self.assertEqual(len(old), 7)
        self.assertTrue(all(r["ok"] for r in old))


class ChallengeClockTests(TestCase):
    def test_hour_runs_out(self):
        u = make_user("tim")
        a = S.start_attempt(u, mode="challenge", seed=4)
        self.assertTrue(a.timed)
        self.assertEqual(S.state(a)["attempt"]["time_left"], 3600)
        a.active_seconds = 3599
        a.save()
        self.assertEqual(S.tick(a)["status"], "active")
        a.active_seconds = 3600
        a.save()
        self.assertEqual(S.tick(a)["status"], "failed")
        with self.assertRaises(S.GameError):
            S.enter_room(a, 1)
        c = Client()
        c.login(username="tim", password=PW)
        self.assertEqual(c.post(f"/api/attempt/{a.id}/tick/").json()["status"], "failed")
        guided = S.start_attempt(u, mode="guided", seed=5)
        self.assertIsNone(S.state(guided)["attempt"]["time_left"])
