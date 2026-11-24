"""Create (or reset) fictional demo student accounts for local demos.

    python manage.py seed_demo            # create demo data if missing
    python manage.py seed_demo --reset    # delete ALL demo users and recreate them
    python manage.py seed_demo --remove   # delete demo data only

Only accounts created by this command (Profile.is_demo) are ever deleted.
Simulated students play through the real game rules (game/autoplay.py), so
their scores, hints and mistakes follow the normal scoring code. All names are
fictional. The password comes from CIPHERBREAK_DEMO_PASSWORD; a default is
only allowed when DEBUG is on (local development).
"""
import os
import random

from django.conf import settings
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError
from django.db import transaction

from accounts.models import Profile
from game import assessments, autoplay
from game import services as S
from game.models import AssessmentResult, Attempt

STUDENTS = {
    # username: (description, plan)
    "student_demo": ("fresh account for a live demo", None),
    "student_ali": ("completed in Guided mode", {"mode": "guided", "rooms": (1, 2, 3, 4), "skill": .85, "hints": .15, "pre": .45, "post": .9}),
    "student_maya": ("completed in Challenge mode", {"mode": "challenge", "rooms": (1, 2, 3, 4), "skill": .7, "hints": .25, "pre": .3, "post": .8}),
    "student_omar": ("in progress (Rooms 1-2 done)", {"mode": "guided", "rooms": (1, 2), "skill": .6, "hints": .3, "pre": .4}),
    "student_lea": ("account created, not started yet", None),
}


class Command(BaseCommand):
    help = "Create, reset or remove fictional demo student accounts."

    def add_arguments(self, parser):
        parser.add_argument("--reset", action="store_true")
        parser.add_argument("--remove", action="store_true")

    def handle(self, *args, **opts):
        password = os.environ.get("CIPHERBREAK_DEMO_PASSWORD")
        if not password:
            if not settings.DEBUG:
                raise CommandError("Set CIPHERBREAK_DEMO_PASSWORD (no default password outside DEBUG mode).")
            password = "cipherbreak-demo-2026"
        if opts["reset"] or opts["remove"]:
            self.remove()
            if opts["remove"]:
                return
        if User.objects.filter(username="student_demo").exists():
            self.stdout.write("Demo data already exists. Use --reset to recreate it.")
            return
        with transaction.atomic():
            self.create(password)
        self.stdout.write(self.style.SUCCESS("Demo data created (local development only):"))
        for name, (desc, _) in STUDENTS.items():
            self.stdout.write(f"  Student:    {name} / {password}   ({desc})")

    def remove(self):
        demo_users = User.objects.filter(profile__is_demo=True)
        n = demo_users.count()
        demo_users.delete()
        self.stdout.write(f"Removed {n} demo account(s) and their data.")

    def create(self, password):
        rng = random.Random(455)
        for name, (_desc, plan) in STUDENTS.items():
            user = User.objects.create_user(name, email=f"{name}@example.com", password=password)
            Profile.objects.filter(user=user).update(is_demo=True)
            user.refresh_from_db()
            if not plan:
                continue
            self.assess(user, "pre", plan["pre"], rng)
            attempt = S.start_attempt(user, mode=plan["mode"], seed=rng.getrandbits(40))
            attempt.intro_seen = True
            attempt.save()
            autoplay.play(attempt, rooms=plan["rooms"], skill=plan["skill"], hint_rate=plan["hints"], rng=rng)
            # Spread simulated active time realistically (about 1.5-3 minutes per challenge).
            attempt.refresh_from_db()
            attempt.active_seconds = int(sum(rng.uniform(90, 180) for _ in attempt.puzzles.all()))
            attempt.save(update_fields=["active_seconds"])
            if "post" in plan:
                self.assess(user, "post", plan["post"], rng, attempt)

    def assess(self, user, kind, p_correct, rng, attempt=None):
        ids = assessments.draw(rng=rng)
        chosen = {qid: ("0" if rng.random() < p_correct else str(rng.randint(1, 3))) for qid in ids}
        score, total, per = assessments.grade(ids, chosen)
        AssessmentResult.objects.create(user=user, kind=kind, attempt=attempt, score=score, total=total,
                                        answers={"set": ids, "a": chosen}, per_objective=per)
