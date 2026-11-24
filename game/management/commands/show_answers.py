"""Print the answer to every machine in a player's adventure (for demos and recordings).

    python manage.py show_answers student_demo             # the player's current adventure
    python manage.py show_answers student_demo --attempt 7 # a specific adventure

Every adventure generates its own messages and keys, so the answers differ each time:
start the adventure in the game first, then run this in a second terminal.
This is a developer tool only. It is not reachable from the website.
"""
from django.contrib.auth.models import User
from django.core.management.base import BaseCommand, CommandError

from game import puzzles as P
from game.models import Attempt

ROW_WIDTH = {64: 8, 56: 7, 48: 6, 32: 8, 28: 7}


def fmt_value(field, value):
    kind = field["kind"]
    if kind == "choice":
        label = next((o["label"] for o in field["options"] if o["value"] == value), value)
        return [f"{label}"]
    if kind == "order":
        keys = value.split(",")
        return [", ".join(f"D{i + 1} = K{k}" for i, k in enumerate(keys))]
    if kind == "bin" and len(value) in ROW_WIDTH:
        w = ROW_WIDTH[len(value)]
        rows = [value[i:i + w] for i in range(0, len(value), w)]
        lines = [f"{value}   (as {len(rows)} rows of {w}:)"]
        lines += [f"      row {r + 1}: {' '.join(row)}" for r, row in enumerate(rows)]
        return lines
    return [value]


class Command(BaseCommand):
    help = "Show the answers to every machine in a player's adventure (developer tool, not in the game)."

    def add_arguments(self, parser):
        parser.add_argument("username")
        parser.add_argument("--attempt", type=int, help="adventure id (default: the player's current or latest one)")

    def handle(self, username, attempt=None, **opts):
        try:
            user = User.objects.get(username=username)
        except User.DoesNotExist:
            raise CommandError(f"No player called {username!r}.")
        qs = Attempt.objects.filter(user=user)
        if attempt:
            a = qs.filter(pk=attempt).first()
        else:
            a = qs.filter(status=Attempt.ACTIVE).order_by("-id").first() or qs.order_by("-id").first()
        if not a:
            raise CommandError(f"{username} has no adventure yet. Start one in the game first.")
        out = self.stdout.write
        out(f"Answers for {username}, adventure #{a.pk} ({a.mode} mode, {a.params.get('direction', 'encrypt')} mission, {a.status})")
        out("=" * 72)
        n = 0
        for room, info in P.ROOMS.items():
            out(f"\nROOM {room}: {info['name']}")
            for i, pid in enumerate(info["puzzles"], 1):
                pz = P.build(a.params, pid, a.mode)
                n += 1
                out(f"\n  Machine {i}: {pz.title}")
                if pid == "r2_shift":
                    sched = pz.view.get("schedule") or []
                    for r in P.shift_rounds(a.params):
                        out(f"    Round {r}: turn both disks left by {sched[r - 1]}, then press RECORD")
                for f in pz.fields:
                    lines = fmt_value(f, str(pz.answer.get(f["name"], "")))
                    out(f"    {f.get('label') or f['name']}: {lines[0]}")
                    for extra in lines[1:]:
                        out(extra)
        out(f"\n{n} machines.")
