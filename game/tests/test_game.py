"""Game, persistence, lab and security tests."""
import json

from django.contrib.auth.models import User
from django.test import Client, TestCase
from django.urls import reverse

from accounts.models import TutorialCompletion
from des_engine import ascii_to_hex, decrypt, encrypt
from game import autoplay
from game import puzzles as P
from game import services as S
from game.generator import generate_params
from game.models import AssessmentResult, Attempt, HintUsage, PuzzleProgress, UserAchievement

PW = "a-Strong-pass-455"


def make_user(name):
    return User.objects.create_user(name, password=PW)


class GeneratorTests(TestCase):
    def test_deterministic_and_varied(self):
        self.assertEqual(generate_params(42), generate_params(42))
        a, b = generate_params(1), generate_params(2)
        self.assertNotEqual((a["code"], a["key"]), (b["code"], b["key"]))

    def test_values_are_valid(self):
        for seed in range(60):
            p = generate_params(seed)
            self.assertEqual(len(p["code"]), 8)
            self.assertTrue(all(32 <= ord(c) < 127 for c in p["code"] + p["exit_code"]))
            self.assertNotEqual(p["code"], p["exit_code"])
            key = bytes.fromhex(p["key"])
            self.assertTrue(all(bin(b).count("1") % 2 == 1 for b in key), "odd parity")
            self.assertIn(p["r3"]["round"], range(1, 17))
            self.assertNotEqual(p["r3"]["group"], p["r3"]["bonus_group"])

    def test_answers_come_from_des_engine(self):
        p = generate_params(7)
        ctx = P.context(p)
        self.assertEqual(ctx["plain_hex"], ascii_to_hex(p["code"]))
        self.assertEqual(ctx["enc"]["output"]["hex"], encrypt(ctx["plain_hex"], p["key"]))
        self.assertEqual(P.build(p, "r1_ascii").answer["hex"], ascii_to_hex(p["code"]))
        self.assertEqual(P.build(p, "r4_code").answer["code"], p["exit_code"])
        self.assertEqual(decrypt(ctx["cipher_exit"], p["key"]), ascii_to_hex(p["exit_code"]))
        rnd = p["r3"]["round"]
        f = P.build(p, "r3_feistel")
        self.assertEqual(f.answer["r"], ctx["enc"]["rounds"][rnd - 1]["r_out"]["hex"])


class PuzzleCheckTests(TestCase):
    def setUp(self):
        self.p = generate_params(99)

    def test_every_puzzle_accepts_its_answer_and_rejects_wrong(self):
        for pid in P.BUILDERS:
            pz = P.build(self.p, pid)
            ok, errors, _, _ = P.check(pz, pz.answer)
            self.assertTrue(ok, pid)
            wrong = autoplay.wrong_answer(pz)
            ok, errors, _, _ = P.check(pz, wrong)
            self.assertFalse(ok, pid)
            self.assertFalse(errors, f"{pid}: wrong answer should be well-formed")

    def test_format_errors_are_explained(self):
        pz = P.build(self.p, "r1_ascii")
        ok, errors, _, fb = P.check(pz, {"hex": "12G4"})
        self.assertFalse(ok)
        self.assertIn("hex digits", fb)
        ok, errors, _, fb = P.check(pz, {"hex": "1234"})
        self.assertIn("exactly 16", fb)

    def test_binary_accepted_for_hex_fields(self):
        pz = P.build(self.p, "r2_split")
        as_bin = {k: format(int(v, 16), "028b") for k, v in pz.answer.items()}
        self.assertTrue(P.check(pz, as_bin)[0])

    def test_shift_diagnosis(self):
        p = dict(self.p, r2=dict(self.p["r2"], shift_round=4))  # rounds 1-4: shifts 1,1,2,2
        pz = P.build(p, "r2_shift")
        self.assertEqual(pz.view["rounds"], [1, 2, 3, 4])
        self.assertTrue(P.check(pz, dict(pz.answer))[0])
        ans = dict(pz.answer)
        c2 = pz.answer["c2"]
        ans["c3"] = c2[1:] + c2[0]  # round 3 rotated by 1 instead of 2
        ok, _, _, fb = P.check(pz, ans)
        self.assertFalse(ok)
        self.assertIn("needs a shift of 2", fb)

    def test_shift_rounds_mix_amounts(self):
        from game.generator import generate_params
        from des_engine import tables as T
        for seed in range(40):
            rounds = P.shift_rounds(generate_params(seed))
            self.assertEqual(len(rounds), 4)
            self.assertEqual({T.SHIFTS[r - 1] for r in rounds}, {1, 2})

    def test_answers_not_leaked_before_solving(self):
        for pid in P.BUILDERS:
            pub = P.build(self.p, pid).public(solved=False)
            self.assertNotIn("answer", pub)
            self.assertNotIn("reveal", pub)

    def test_challenge_mode_hides_hex_helper(self):
        for mode in ("challenge", "guided"):  # the machine never shows the bits or hex of a letter
            ch = P.build(self.p, "r1_ascii", mode).view["chars"][0]
            self.assertNotIn("hex", ch)
            self.assertNotIn("bin", ch)


class ProgressionAndScoringTests(TestCase):
    def setUp(self):
        self.u = make_user("alice")
        self.a = S.start_attempt(self.u, mode="challenge", seed=1234)

    def answer(self, pid):
        return P.build(self.a.params, pid, self.a.mode).answer

    def test_rooms_locked_in_order(self):
        with self.assertRaises(S.GameError):
            S.enter_room(self.a, 2)
        with self.assertRaises(S.GameError):
            S.open_puzzle(self.a, "r1_block")  # previous step unsolved
        S.enter_room(self.a, 1)

    def test_scoring_wrong_answers_and_hints(self):
        S.open_puzzle(self.a, "r1_ascii")
        pz = P.build(self.a.params, "r1_ascii", self.a.mode)
        self.assertFalse(S.submit(self.a, "r1_ascii", autoplay.wrong_answer(pz))["correct"])
        h1 = S.hint(self.a, "r1_ascii")
        h2 = S.hint(self.a, "r1_ascii")
        self.assertEqual((h1["penalty"], h2["penalty"]), (10, 20))
        res = S.submit(self.a, "r1_ascii", self.answer("r1_ascii"))
        self.assertTrue(res["correct"])
        self.assertEqual(res["points"], 100 - 10 - 30)
        self.a.refresh_from_db()
        self.assertEqual(self.a.score, 60)

    def test_format_error_costs_nothing(self):
        res = S.submit(self.a, "r1_ascii", {"hex": "xyz"})
        self.assertTrue(res["format_error"])
        self.assertEqual(PuzzleProgress.objects.get(attempt=self.a, puzzle_id="r1_ascii").wrong_attempts, 0)

    def test_score_never_negative(self):
        pz = P.build(self.a.params, "r1_ascii", self.a.mode)
        for _ in range(12):
            S.submit(self.a, "r1_ascii", autoplay.wrong_answer(pz))
        for _ in range(3):
            S.hint(self.a, "r1_ascii")
        self.assertEqual(S.submit(self.a, "r1_ascii", pz.answer)["points"], 0)

    def test_no_duplicate_points(self):
        S.submit(self.a, "r1_ascii", self.answer("r1_ascii"))
        self.a.refresh_from_db()
        before = self.a.score
        again = S.submit(self.a, "r1_ascii", self.answer("r1_ascii"))
        self.assertTrue(again["already_solved"])
        self.a.refresh_from_db()
        self.assertEqual(self.a.score, before)

    def test_hints_are_free_in_guided_mode(self):
        g = S.start_attempt(self.u, mode="guided", seed=5)
        self.assertEqual(S.hint(g, "r1_ascii")["penalty"], 0)
        self.assertEqual(HintUsage.objects.filter(attempt=g).count(), 1)

    def test_three_hint_levels_then_stop(self):
        for lvl in (1, 2, 3):
            self.assertEqual(S.hint(self.a, "r1_ascii")["level"], lvl)
        self.assertTrue(S.hint(self.a, "r1_ascii")["max"])
        self.assertEqual(HintUsage.objects.filter(attempt=self.a).count(), 3)

    def test_full_game_completion_badges_and_bonus(self):
        autoplay.play(self.a, skill=1.0)
        self.a.refresh_from_db()
        self.assertEqual(self.a.status, Attempt.COMPLETED)
        required = sum(len(P.required_puzzles(r)) for r in P.ROOMS)
        self.assertEqual(self.a.score, required * 100 + 100 + 4 * P.ROOM_BONUS)  # + optional bonus S-box
        codes = set(UserAchievement.objects.filter(user=self.u).values_list("code", flat=True))
        self.assertEqual(codes, set(P.ACHIEVEMENTS))
        self.assertEqual(S.state(self.a)["attempt"]["percent"], 100)

    def test_sbox_specialist_requires_no_mistakes(self):
        autoplay.play(self.a, rooms=(1, 2), skill=1.0)
        S.enter_room(self.a, 3)
        for pid in ("r3_expand", "r3_xor", "r3_sbox"):
            S.submit(self.a, pid, self.answer(pid))
        pz = P.build(self.a.params, "r3_sbox_bonus", self.a.mode)
        S.submit(self.a, "r3_sbox_bonus", autoplay.wrong_answer(pz))
        S.submit(self.a, "r3_sbox_bonus", pz.answer)
        self.assertFalse(UserAchievement.objects.filter(user=self.u, code="sbox_specialist").exists())

    def test_bonus_closes_after_permutation_opened(self):
        autoplay.play(self.a, rooms=(1, 2), skill=1.0)
        for pid in ("r3_expand", "r3_xor", "r3_sbox"):
            S.submit(self.a, pid, self.answer(pid))
        S.open_puzzle(self.a, "r3_perm")
        with self.assertRaises(S.GameError):
            S.open_puzzle(self.a, "r3_sbox_bonus")

    def test_completed_attempt_rejects_play(self):
        autoplay.play(self.a, skill=1.0)
        with self.assertRaises(S.GameError):
            S.hint(self.a, "r1_ascii")


class PersistenceTests(TestCase):
    def setUp(self):
        self.u = make_user("bob")
        self.c = Client()
        self.c.login(username="bob", password=PW)

    def start(self, mode="guided"):
        r = self.c.post(reverse("new_adventure"), {"mode": mode})
        self.assertEqual(r.status_code, 302)
        return Attempt.objects.filter(user=self.u).first()

    def api(self, url, body=None):
        if body is None:
            return self.c.get(url)
        return self.c.post(url, json.dumps(body), content_type="application/json")

    def test_progress_survives_logout_login_and_refresh(self):
        a = self.start()
        self.api(f"/api/attempt/{a.id}/room/", {"room": 1})
        ans = P.build(a.params, "r1_ascii", a.mode).answer
        self.assertTrue(self.api(f"/api/attempt/{a.id}/puzzle/r1_ascii/submit/", {"answer": ans}).json()["correct"])
        self.api(f"/api/attempt/{a.id}/puzzle/r1_block/")
        params_before = a.params
        self.c.post(reverse("logout"))
        self.assertEqual(self.api(f"/api/attempt/{a.id}/state/").status_code, 302)  # login required
        self.c.login(username="bob", password=PW)
        st = self.api(f"/api/attempt/{a.id}/state/").json()
        self.assertEqual(st["attempt"]["position"], {"room": 1, "puzzle": "r1_block"})
        self.assertEqual(st["attempt"]["score"], 100)
        a.refresh_from_db()
        self.assertEqual(a.params, params_before)  # resuming never regenerates puzzles
        r = self.c.get(reverse("resume"))
        self.assertRedirects(r, reverse("play", args=[a.id]))
        self.assertEqual(self.c.get(reverse("play", args=[a.id])).status_code, 200)

    def test_refresh_does_not_duplicate_attempts(self):
        a = self.start()
        for _ in range(3):
            self.c.get(reverse("play", args=[a.id]))
            self.api(f"/api/attempt/{a.id}/state/")
        self.assertEqual(Attempt.objects.filter(user=self.u).count(), 1)

    def test_new_adventure_keeps_history_and_changes_values(self):
        a1 = self.start()
        a2 = self.start()
        a1.refresh_from_db()
        self.assertEqual(a1.status, Attempt.ABANDONED)
        self.assertEqual(Attempt.objects.filter(user=self.u).count(), 2)
        self.assertNotEqual(a1.params["key"], a2.params["key"])
        self.assertNotEqual(a1.params["code"], a2.params["code"])
        self.assertEqual(self.c.get(reverse("results", args=[a1.id])).status_code, 200)

    def test_tutorial_skip_and_replay_saved(self):
        self.api("/api/tutorial/onboarding/", {"skipped": True})
        self.api("/api/tutorial/room1/", {})
        t = {x.tutorial_id: x.skipped for x in TutorialCompletion.objects.filter(user=self.u)}
        self.assertEqual(t, {"onboarding": True, "room1": False})
        a = self.start()
        self.assertIn("onboarding", self.api(f"/api/attempt/{a.id}/state/").json()["tutorials_done"])

    def test_notebook_unlocks_with_concepts(self):
        a = self.start()
        self.api(f"/api/attempt/{a.id}/puzzle/r1_ascii/")
        self.u.profile.refresh_from_db()
        self.assertIn("hex", self.u.profile.notebook_unlocked)
        self.assertContains(self.c.get(reverse("notebook")), "DES security limitations")

    def test_lab_flags_active_challenge(self):
        a = self.start("challenge")
        r = self.c.get(reverse("lab"))
        self.assertContains(r, "recorded as <b>practice</b>")
        a.refresh_from_db()
        self.assertTrue(a.independent)
        self.c.get(reverse("lab") + "?confirm=1")
        a.refresh_from_db()
        self.assertFalse(a.independent)


class SecurityTests(TestCase):
    def setUp(self):
        self.alice, self.eve = make_user("alice"), make_user("eve")
        self.a = S.start_attempt(self.alice, seed=3)

    def test_password_hashed(self):
        self.assertNotEqual(self.alice.password, PW)
        self.assertTrue(self.alice.password.startswith(("pbkdf2_", "argon2", "bcrypt", "scrypt")))

    def test_pages_require_login(self):
        c = Client()
        for url in [reverse("dashboard"), reverse("play", args=[self.a.id]), f"/api/attempt/{self.a.id}/state/",
                    reverse("notebook")]:
            self.assertEqual(c.get(url).status_code, 302, url)

    def test_other_students_attempts_are_404(self):
        c = Client()
        c.login(username="eve", password=PW)
        for url in [reverse("play", args=[self.a.id]), reverse("results", args=[self.a.id]),
                    f"/api/attempt/{self.a.id}/state/", f"/api/attempt/{self.a.id}/puzzle/r1_ascii/"]:
            self.assertEqual(c.get(url).status_code, 404, url)
        r = c.post(f"/api/attempt/{self.a.id}/puzzle/r1_ascii/submit/", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 404)

    def test_csrf_enforced_on_api(self):
        c = Client(enforce_csrf_checks=True)
        c.login(username="alice", password=PW)
        r = c.post(f"/api/attempt/{self.a.id}/puzzle/r1_ascii/submit/", "{}", content_type="application/json")
        self.assertEqual(r.status_code, 403)

    def test_no_instructor_pages_or_roles(self):
        c = Client()
        for url in ("/educators/", "/instructor/", "/instructor/demo/", "/accounts/register/instructor/"):
            self.assertEqual(c.get(url).status_code, 404, url)
        data = {"username": "mallory", "password1": PW, "password2": PW, "role": "instructor"}
        c.post(reverse("register"), data)  # extra field ignored
        self.assertTrue(User.objects.filter(username="mallory").exists())
        self.assertFalse(hasattr(User.objects.get(username="mallory").profile, "role"))

    def test_registration_validation(self):
        r = Client().post(reverse("register"), {"username": "x", "password1": "abc", "password2": "abd"})
        self.assertContains(r, "errorlist")
        self.assertFalse(User.objects.filter(username="x").exists())


class LabAndPageTests(TestCase):
    def test_lab_api(self):
        c = Client()
        self.assertEqual(c.post('/api/des/', '{}', content_type='application/json').status_code, 403)
        make_user('lab_lab_api'); c.login(username='lab_lab_api', password=PW)
        r = c.post("/api/des/", json.dumps({"block": "0123456789ABCDEF", "key": "133457799BBCDFF1"}),
                   content_type="application/json")
        self.assertEqual(r.json()["output"]["hex"], "85E813540F0AB405")
        self.assertEqual(len(r.json()["rounds"]), 16)
        r = c.post("/api/des/", json.dumps({"block": "85E813540F0AB405", "key": "133457799BBCDFF1", "mode": "decrypt"}),
                   content_type="application/json")
        self.assertEqual(r.json()["output"]["hex"], "0123456789ABCDEF")
        r = c.post("/api/des/", json.dumps({"block": "0123", "key": "133457799BBCDFF1"}), content_type="application/json")
        self.assertEqual(r.status_code, 400)
        self.assertIn("16", r.json()["error"])

    def test_avalanche_api(self):
        c = Client()
        self.assertEqual(c.post('/api/des/', '{}', content_type='application/json').status_code, 403)
        make_user('lab_avalanche_api'); c.login(username='lab_avalanche_api', password=PW)
        r = c.post("/api/avalanche/", json.dumps({"block": "0123456789ABCDEF", "key": "133457799BBCDFF1", "bit": 1}),
                   content_type="application/json").json()
        self.assertEqual(r["block2"], "8123456789ABCDEF")
        self.assertEqual(len(r["rows"]), 17)
        self.assertEqual(r["rows"][0]["count"], 1)  # IP only moves the one flipped bit
        self.assertEqual(r["output"]["a"], "85E813540F0AB405")
        self.assertEqual(r["output"]["b"], encrypt("8123456789ABCDEF", "133457799BBCDFF1"))
        self.assertGreater(r["output"]["count"], 16)
        r = c.post("/api/avalanche/", json.dumps({"block": "0123456789ABCDEF", "key": "133457799BBCDFF1", "bit": 8,
                                                  "target": "key"}), content_type="application/json").json()
        self.assertTrue(r["parity_bit"])
        self.assertEqual(r["output"]["count"], 0)  # parity bits are dropped by PC-1
        bad = c.post("/api/avalanche/", json.dumps({"block": "0123", "key": "133457799BBCDFF1", "bit": 1}),
                     content_type="application/json")
        self.assertEqual(bad.status_code, 400)

    def test_birthday_api(self):
        c = Client()
        self.assertEqual(c.post('/api/des/', '{}', content_type='application/json').status_code, 403)
        make_user('lab_birthday_api'); c.login(username='lab_birthday_api', password=PW)
        r = c.post("/api/birthday/", json.dumps({"bits": 12}), content_type="application/json").json()
        col = r["collision"]
        self.assertIsNotNone(col)
        self.assertLess(col["first"]["index"], col["second"]["index"])
        a = encrypt(col["first"]["plain"], r["key"])
        b = encrypt(col["second"]["plain"], r["key"])
        self.assertNotEqual(col["first"]["plain"], col["second"]["plain"])
        self.assertEqual(int(a, 16) >> 52, int(b, 16) >> 52)  # same first 12 bits
        self.assertEqual(c.post("/api/birthday/", json.dumps({"bits": 40}), content_type="application/json").status_code, 400)

    def test_public_pages(self):
        c = Client()
        for name in ("landing", "how_to_play", "login", "register"):
            self.assertEqual(c.get(reverse(name)).status_code, 200, name)
        # The DES Lab is for signed-in players only.
        self.assertRedirects(c.get(reverse("lab")), reverse("login") + "?next=" + reverse("lab"))
        self.assertNotContains(c.get(reverse("landing")), 'href="/lab/"')

    def test_student_pages(self):
        make_user("carol")
        c = Client()
        c.login(username="carol", password=PW)
        self.assertContains(c.get(reverse("dashboard")), "Welcome back, carol!")
        r = c.get(reverse("assessment", args=["pre"]))
        self.assertEqual(r.status_code, 200)
        ids = r.context["set"].split(",")
        self.assertEqual(len(ids), 7)
        answers = {"set": ",".join(ids), **{f"q_{q}": "0" for q in ids}}
        r = c.post(reverse("assessment", args=["pre"]), answers, follow=True)
        self.assertEqual(AssessmentResult.objects.get(kind="pre").score, 7)
        self.assertContains(r, "Pre-assessment results")
        self.assertContains(r, "7/7")
        ids2 = c.get(reverse("assessment", args=["post"])).context["set"].split(",")
        self.assertFalse(set(ids) & set(ids2), "a new attempt avoids the questions just seen")
        post = {"set": ",".join(ids2), **{f"q_{q}": ("0" if i < 6 else "1") for i, q in enumerate(ids2)}}
        r = c.post(reverse("assessment", args=["post"]), post, follow=True)
        self.assertContains(r, "Before vs after the game")
        self.assertContains(r, "Correct answer:")
        other = make_user("dave")
        res = AssessmentResult.objects.filter(kind="post").first()
        c2 = Client(); c2.login(username="dave", password=PW)
        self.assertEqual(c2.get(reverse("assessment_result", args=[res.id])).status_code, 404)


class PasswordTests(TestCase):
    def test_password_reset_flow(self):
        from django.core import mail
        u = User.objects.create_user("dana", email="dana@example.com", password=PW)
        r = Client().post(reverse("password_reset"), {"email": "dana@example.com"})
        self.assertRedirects(r, reverse("password_reset_done"))
        self.assertEqual(len(mail.outbox), 1)
        link = next(line for line in mail.outbox[0].body.splitlines() if "/accounts/reset/" in line)
        path = link.split("testserver", 1)[1].strip()
        c = Client()
        r = c.get(path, follow=True)  # Django redirects to a session-bound "set-password" URL
        self.assertContains(r, "Choose a new password")
        r = c.post(r.redirect_chain[-1][0], {"new_password1": "Brand-new-pass-77", "new_password2": "Brand-new-pass-77"})
        self.assertRedirects(r, reverse("password_reset_complete"))
        self.assertTrue(Client().login(username="dana", password="Brand-new-pass-77"))
        u.refresh_from_db()
        self.assertFalse(u.check_password(PW))

    def test_unknown_email_reveals_nothing(self):
        from django.core import mail
        r = Client().post(reverse("password_reset"), {"email": "nobody@example.com"})
        self.assertRedirects(r, reverse("password_reset_done"))
        self.assertEqual(len(mail.outbox), 0)

    def test_change_password_when_signed_in(self):
        make_user("erin")
        c = Client()
        c.login(username="erin", password=PW)
        self.assertContains(c.get(reverse("profile")), "My Profile")
        self.assertRedirects(c.get(reverse("password_change")), reverse("profile"))
        r = c.post(reverse("profile"), {"old_password": PW, "new_password1": "Other-pass-9876",
                                        "new_password2": "Other-pass-9876"}, follow=True)
        self.assertContains(r, "Your password was changed.")
        self.assertContains(c.get(reverse("dashboard")), "Welcome back")  # still signed in
        self.assertTrue(Client().login(username="erin", password="Other-pass-9876"))


class InventoryAndArchiveTests(TestCase):
    """The game world's inventory and archive terminals reveal values only once earned."""

    def setUp(self):
        self.u, self.eve = make_user("ivy"), make_user("eve2")
        self.a = S.start_attempt(self.u, seed=11)
        self.c = Client()
        self.c.login(username="ivy", password=PW)

    def items(self):
        r = self.c.get(f"/api/attempt/{self.a.id}/inventory/")
        self.assertEqual(r.status_code, 200)
        return {i["id"]: i for i in r.json()["items"]}

    def test_inventory_grows_with_progress(self):
        self.assertEqual(set(self.items()), {"codecard"})
        autoplay.play(self.a, rooms=(1,), skill=1.0)
        items = self.items()
        self.assertTrue({"codecard", "block", "halves", "key"} <= set(items))
        self.assertNotIn("subkeys", items)
        block = dict(items["block"]["values"])
        self.assertEqual(len(next(iter(block.values()))), 16)
        autoplay.play(self.a, skill=1.0)
        items = self.items()
        self.assertTrue({"subkeys", "cipher", "exitcipher", "exitcode"} <= set(items))
        self.assertEqual(len(items["subkeys"]["values"]), 16)
        code = dict(items["exitcode"]["values"])
        ctx = P.context(self.a.params)
        self.assertIn(self.a.params["exit_code"], code.values())
        self.assertTrue(ctx)

    def test_archives_locked_until_solved(self):
        for kind in ("keys", "encrypt", "decrypt"):
            self.assertEqual(self.c.get(f"/api/attempt/{self.a.id}/archive/{kind}/").status_code, 400, kind)
        self.assertEqual(self.c.get(f"/api/attempt/{self.a.id}/archive/nope/").status_code, 400)
        autoplay.play(self.a, skill=1.0)
        ks = self.c.get(f"/api/attempt/{self.a.id}/archive/keys/").json()["schedule"]
        self.assertEqual(len(ks["rounds"]), 16)
        enc = self.c.get(f"/api/attempt/{self.a.id}/archive/encrypt/").json()["trace"]
        dec = self.c.get(f"/api/attempt/{self.a.id}/archive/decrypt/").json()["trace"]
        self.assertEqual(len(enc["rounds"]), 16)
        self.assertEqual([r["key_index"] for r in dec["rounds"]], list(range(16, 0, -1)))
        self.assertEqual(encrypt(enc["input"]["hex"], ks["key"]["hex"]), enc["output"]["hex"])

    def test_inventory_and_archive_are_private(self):
        c = Client()
        c.login(username="eve2", password=PW)
        self.assertEqual(c.get(f"/api/attempt/{self.a.id}/inventory/").status_code, 404)
        self.assertEqual(c.get(f"/api/attempt/{self.a.id}/archive/keys/").status_code, 404)

    def test_game_page_loads_world(self):
        r = self.c.get(reverse("play", args=[self.a.id]))
        self.assertEqual(r.status_code, 200)
        for asset in ("js/world.js", "js/machines.js", "js/play.js", "css/game.css", 'id="world"', 'id="title"'):
            self.assertContains(r, asset)


class StartPageTests(TestCase):
    def test_start_page_offers_sign_in_and_register(self):
        r = self.client.get("/start/")
        self.assertContains(r, "Create an account")
        self.assertContains(r, "/accounts/login/")

    def test_home_has_only_start_playing(self):
        r = self.client.get("/")
        self.assertContains(r, "Start Playing")
        self.assertContains(r, 'href="/start/"')
        self.assertNotContains(r, ">Sign In<")
        self.assertNotContains(r, ">How to Play<")


class ShowAnswersCommandTests(TestCase):
    def test_lists_every_machine(self):
        from io import StringIO
        from django.core.management import call_command
        u = User.objects.create_user("ans_player", password="pw-12345-long")
        S.start_attempt(u, "guided")
        out = StringIO()
        call_command("show_answers", "ans_player", stdout=out)
        text = out.getvalue()
        self.assertIn("Initial Permutation", text)
        n = sum(len(v["puzzles"]) for v in P.ROOMS.values())
        self.assertIn(f"{n} machines.", text)
