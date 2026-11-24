"""
Game rules: progression, scoring, hints and achievements.

All decisions happen here on the server; the browser only displays results.
Score for a solved puzzle =
    max(0, 100 − 10 × wrong attempts − hint penalties)
Hint penalties (Challenge mode only): hint 1 = 10, hint 2 = 20, hint 3 = 30.
Room completion bonus = 50. Points are awarded exactly once per puzzle.
"""
import secrets

from django.db import transaction
from django.utils import timezone

from . import puzzles as P
from .generator import generate_params
from .models import Attempt, HintUsage, PuzzleProgress, PuzzleSubmission, RoomProgress, UserAchievement


class GameError(Exception):
    """A rule violation that should be shown to the player (HTTP 400/403)."""


# ---------------------------------------------------------------------------
# Attempts
# ---------------------------------------------------------------------------

def start_attempt(user, mode="guided", timed=False, seed=None, direction="encrypt"):
    """Create a new adventure with freshly generated values.

    Previous attempts are kept; any other active attempt is marked abandoned
    only by an explicit user action (see abandon_attempt)."""
    recent = list(user.attempts.order_by("-started_at").values_list("params", flat=True)[:10])
    avoid = [p.get("code") for p in recent] + [p.get("exit_code") for p in recent]
    seed = seed if seed is not None else secrets.randbits(48)
    params = generate_params(seed, avoid_codes=avoid, direction=direction)
    independent = mode == Attempt.CHALLENGE
    return Attempt.objects.create(user=user, mode=mode, timed=mode == Attempt.CHALLENGE,  # Challenge mode always has the 1-hour countdown
                                 
                                  seed=seed, params=params, independent=independent)


def abandon_attempt(attempt):
    if attempt.status == Attempt.ACTIVE:
        attempt.status = Attempt.ABANDONED
        attempt.save(update_fields=["status"])


def room_status(attempt, room, rooms_done):
    if room in rooms_done:
        return "completed"
    if room == 1 or (room - 1) in rooms_done:
        return "available"
    return "locked"


def completed_rooms(attempt):
    return set(attempt.rooms.filter(completed_at__isnull=False).values_list("room", flat=True))


def state(attempt):
    """Everything the game screen needs to draw the map, top bar and progress."""
    done = completed_rooms(attempt)
    progress = {pp.puzzle_id: pp for pp in attempt.puzzles.all()}
    room_bonus = dict(attempt.rooms.values_list("room", "bonus_points"))
    earned = set(UserAchievement.objects.filter(attempt=attempt).values_list("code", flat=True))
    rooms = []
    for n, info in P.ROOMS.items():
        pz = []
        for pid in info["puzzles"]:
            pp = progress.get(pid)
            pz.append({"id": pid, "title": P.build(attempt.params, pid, attempt.mode).title,
                       "optional": P.PUZZLE_META[pid]["optional"], "solved": bool(pp and pp.solved),
                       "points": pp.points if pp else 0, "objective": P.PUZZLE_META[pid]["objective"],
                       "available": puzzle_available(attempt, pid, progress, done)})
        score = sum(p["points"] for p in pz) + room_bonus.get(n, 0)
        status = room_status(attempt, n, done)
        rooms.append({
            "n": n, "name": info["name"], "status": status, "score": score,
            "badge": P.ACHIEVEMENTS[info["badge"]]["name"], "badge_earned": info["badge"] in earned,
            "puzzles": pz,
            "solved": sum(1 for p in pz if p["solved"] and not p["optional"]),
            "required": sum(1 for p in pz if not p["optional"]),
            "locked_reason": (f"Complete {P.ROOMS[n - 1]['name']} first." if status == "locked" else ""),
        })
    required_total = sum(r["required"] for r in rooms)
    solved_total = sum(r["solved"] for r in rooms)
    return {
        "attempt": {
            "id": attempt.id, "mode": attempt.mode, "label": attempt.label, "timed": attempt.timed,
            "time_limit": Attempt.TIME_LIMIT if attempt.timed else None, "time_left": time_left(attempt),
            "direction": attempt.params.get("direction", "encrypt"),
            "status": attempt.status, "score": attempt.score, "intro_seen": attempt.intro_seen,
            "position": attempt.position or {"room": 0}, "active_seconds": attempt.active_seconds,
            "independent": attempt.independent, "integrity_note": attempt.integrity_note,
            "hints_used": attempt.hints.count(),
            "mistakes": sum(pp.wrong_attempts for pp in progress.values()),
            "percent": round(100 * solved_total / required_total),
            "hint_cost": attempt.mode == Attempt.CHALLENGE,
        },
        "rooms": rooms,
        "achievements": [{"code": c, **P.ACHIEVEMENTS[c], "earned": c in earned} for c in P.ACHIEVEMENTS],
        "user_achievements": list(UserAchievement.objects.filter(user=attempt.user).values_list("code", flat=True)),
    }


def puzzle_available(attempt, pid, progress=None, done=None):
    """A puzzle opens when its room is open and every earlier REQUIRED puzzle is solved."""
    room = P.room_of(pid)
    done = completed_rooms(attempt) if done is None else done
    if room_status(attempt, room, done) == "locked":
        return False
    if progress is None:
        progress = {pp.puzzle_id: pp for pp in attempt.puzzles.all()}
    if pid == "r3_sbox_bonus" and "r3_perm" in progress:
        bonus = progress.get("r3_sbox_bonus")
        if not (bonus and bonus.solved):
            return False  # the bonus closes once the combined S-box output has been revealed
    for earlier in P.ROOMS[room]["puzzles"]:
        if earlier == pid:
            return True
        if not P.PUZZLE_META[earlier]["optional"]:
            pp = progress.get(earlier)
            if not (pp and pp.solved):
                return False
    return True


def time_left(attempt):
    """Seconds of play time left in a Challenge adventure (None when there is no countdown)."""
    if not attempt.timed:
        return None
    return max(0, Attempt.TIME_LIMIT - attempt.active_seconds)


def check_clock(attempt):
    """End a timed adventure as failed once its hour of play time is used up. Returns True if it just ended."""
    if attempt.timed and attempt.status == Attempt.ACTIVE and attempt.active_seconds >= Attempt.TIME_LIMIT:
        attempt.status = Attempt.FAILED
        attempt.save(update_fields=["status"])
        return True
    return False


def tick(attempt):
    """Heartbeat from the game screen while it is open: counts play time and runs the countdown."""
    if attempt.status == Attempt.ACTIVE:
        attempt.touch()
        attempt.save(update_fields=["active_seconds", "last_active"])
        check_clock(attempt)
    return {"status": attempt.status, "time_left": time_left(attempt), "active_seconds": attempt.active_seconds}


def _require_active(attempt):
    check_clock(attempt)
    if attempt.status == Attempt.FAILED:
        raise GameError("Time is up! The hour ran out, so this adventure has ended. Start a new adventure to try again.")
    if attempt.status != Attempt.ACTIVE:
        raise GameError("This adventure is no longer active. Start a new adventure to play again.")


@transaction.atomic
def enter_room(attempt, room):
    _require_active(attempt)
    if room not in P.ROOMS:
        raise GameError("Unknown room.")
    done = completed_rooms(attempt)
    if room_status(attempt, room, done) == "locked":
        raise GameError(f"{P.ROOMS[room]['name']} is locked. Complete {P.ROOMS[room - 1]['name']} first.")
    RoomProgress.objects.get_or_create(attempt=attempt, room=room)
    attempt.position = {"room": room, "puzzle": attempt.position.get("puzzle") if attempt.position.get("room") == room else None}
    attempt.touch()
    attempt.save(update_fields=["position", "active_seconds", "last_active"])


@transaction.atomic
def open_puzzle(attempt, pid):
    """Return the public puzzle data and record that it was opened."""
    if pid not in P.BUILDERS:
        raise GameError("Unknown puzzle.")
    room = P.room_of(pid)
    progress = {pp.puzzle_id: pp for pp in attempt.puzzles.all()}
    if not puzzle_available(attempt, pid, progress):
        raise GameError("Finish the previous step first.")
    pz = P.build(attempt.params, pid, attempt.mode)
    pp = progress.get(pid)
    if attempt.status == Attempt.ACTIVE:
        RoomProgress.objects.get_or_create(attempt=attempt, room=room)
        if pp is None:
            pp = PuzzleProgress.objects.create(attempt=attempt, puzzle_id=pid, room=room,
                                               objective=P.PUZZLE_META[pid]["objective"],
                                               optional=P.PUZZLE_META[pid]["optional"])
        attempt.position = {"room": room, "puzzle": pid}
        attempt.touch()
        attempt.save(update_fields=["position", "active_seconds", "last_active"])
        attempt.user.profile.unlock_notebook(P.PUZZLE_META[pid]["concepts"])
    data = pz.public(solved=bool(pp and pp.solved), hints_used=pp.hint_level if pp else 0)
    data["progress"] = _progress_dict(pp)
    return data


def _progress_dict(pp):
    if not pp:
        return {"wrong": 0, "hint_level": 0, "points": 0, "hint_penalty": 0}
    return {"wrong": pp.wrong_attempts, "hint_level": pp.hint_level, "points": pp.points,
            "hint_penalty": pp.hint_penalty}


def puzzle_points(pp):
    return max(0, P.POINTS_PER_PUZZLE - P.WRONG_PENALTY * pp.wrong_attempts - pp.hint_penalty)


@transaction.atomic
def submit(attempt, pid, answer):
    _require_active(attempt)
    attempt = Attempt.objects.select_for_update().get(pk=attempt.pk)
    if not puzzle_available(attempt, pid):
        raise GameError("Finish the previous step first.")
    pp, _ = PuzzleProgress.objects.select_for_update().get_or_create(
        attempt=attempt, puzzle_id=pid,
        defaults={"room": P.room_of(pid), "objective": P.PUZZLE_META[pid]["objective"],
                  "optional": P.PUZZLE_META[pid]["optional"]})
    pz = P.build(attempt.params, pid, attempt.mode)
    if pp.solved:
        return {"correct": True, "already_solved": True, "points": 0, "feedback": "Already solved, so no extra points.",
                "reveal": pz.reveal, "success": pz.success, "answer": pz.answer}

    correct, errors, field_results, feedback = P.check(pz, answer)
    if errors:  # malformed input does not count as a mistake
        return {"correct": False, "format_error": True, "feedback": feedback, "errors": errors}

    PuzzleSubmission.objects.create(attempt=attempt, puzzle_id=pid, answer=answer, correct=correct)
    result = {"correct": correct, "feedback": feedback, "fields": field_results}
    attempt.touch()
    if not correct:
        pp.wrong_attempts += 1
        pp.save(update_fields=["wrong_attempts"])
        result["progress"] = _progress_dict(pp)
        attempt.save(update_fields=["active_seconds", "last_active"])
        return result

    pp.solved = True
    pp.solved_at = timezone.now()
    pp.points = puzzle_points(pp)
    pp.save()
    awarded = pp.points
    breakdown = {"base": P.POINTS_PER_PUZZLE, "wrong": pp.wrong_attempts,
                 "wrong_penalty": P.WRONG_PENALTY * pp.wrong_attempts,
                 "hint_penalty": pp.hint_penalty, "points": pp.points}
    new_badges = []
    room = P.room_of(pid)
    room_done = False
    rp, _ = RoomProgress.objects.select_for_update().get_or_create(attempt=attempt, room=room)
    solved = set(attempt.puzzles.filter(solved=True).values_list("puzzle_id", flat=True))
    if rp.completed_at is None and all(p in solved for p in P.required_puzzles(room)):
        rp.completed_at = timezone.now()
        rp.bonus_points = P.ROOM_BONUS
        rp.save()
        awarded += P.ROOM_BONUS
        room_done = True
        new_badges += _award(attempt, P.ROOMS[room]["badge"])
    new_badges += _check_special_badges(attempt)
    attempt.score += awarded
    if room == 4 and room_done:
        attempt.status = Attempt.COMPLETED
        attempt.completed_at = timezone.now()
    attempt.save()
    result.update({"points": pp.points, "awarded": awarded, "breakdown": breakdown, "room_completed": room_done,
                   "room_bonus": P.ROOM_BONUS if room_done else 0, "achievements": new_badges,
                   "reveal": pz.reveal, "success": pz.success, "answer": pz.answer,
                   "escaped": attempt.status == Attempt.COMPLETED, "score": attempt.score})
    return result


def _award(attempt, code):
    _, created = UserAchievement.objects.get_or_create(user=attempt.user, code=code,
                                                       defaults={"attempt": attempt})
    return [{"code": code, **P.ACHIEVEMENTS[code]}] if created else []


def _check_special_badges(attempt):
    got = []
    pz = {pp.puzzle_id: pp for pp in attempt.puzzles.all()}
    s1, s2 = pz.get("r3_sbox"), pz.get("r3_sbox_bonus")
    if s1 and s2 and s1.solved and s2.solved and s1.wrong_attempts == 0 and s2.wrong_attempts == 0:
        got += _award(attempt, "sbox_specialist")
    o, r = pz.get("r4_order"), pz.get("r4_round")
    if o and r and o.solved and r.solved and o.wrong_attempts == 0 and r.wrong_attempts == 0:
        got += _award(attempt, "reverse_engineer")
    return got


@transaction.atomic
def hint(attempt, pid):
    """Reveal the next hint level (1..3) for a puzzle. Returns the new hint."""
    _require_active(attempt)
    if not puzzle_available(attempt, pid):
        raise GameError("Finish the previous step first.")
    pp, _ = PuzzleProgress.objects.select_for_update().get_or_create(
        attempt=attempt, puzzle_id=pid,
        defaults={"room": P.room_of(pid), "objective": P.PUZZLE_META[pid]["objective"],
                  "optional": P.PUZZLE_META[pid]["optional"]})
    pz = P.build(attempt.params, pid, attempt.mode)
    if pp.hint_level >= 3:
        return {"level": 3, "hints": pz.hints, "penalty": 0, "max": True}
    level = pp.hint_level + 1
    # Hints never cost points in Guided mode, after solving, or in demos.
    penalty = P.HINT_PENALTIES[level] if attempt.mode == Attempt.CHALLENGE and not pp.solved else 0
    HintUsage.objects.get_or_create(attempt=attempt, puzzle_id=pid, level=level, defaults={"penalty": penalty})
    pp.hint_level = level
    pp.hint_penalty += penalty
    pp.save(update_fields=["hint_level", "hint_penalty"])
    attempt.touch()
    attempt.save(update_fields=["active_seconds", "last_active"])
    return {"level": level, "hint": pz.hints[level - 1], "hints": pz.hints[:level], "penalty": penalty,
            "max": level == 3}


def flag_not_independent(attempt, reason):
    if attempt.mode == Attempt.CHALLENGE and attempt.status == Attempt.ACTIVE and attempt.independent:
        attempt.independent = False
        attempt.integrity_note = reason
        attempt.save(update_fields=["independent", "integrity_note"])


# ---------------------------------------------------------------------------
# Results and learning analytics
# ---------------------------------------------------------------------------

def objective_stats(puzzle_qs):
    """Accuracy per learning objective = solved / (solved + wrong attempts)."""
    stats = {lo: {"solved": 0, "wrong": 0, "hints": 0, "seen": 0} for lo in P.OBJECTIVES}
    for pp in puzzle_qs:
        s = stats[pp.objective]
        s["seen"] += 1
        s["solved"] += int(pp.solved)
        s["wrong"] += pp.wrong_attempts
        s["hints"] += pp.hint_level
    for s in stats.values():
        denom = s["solved"] + s["wrong"]
        s["accuracy"] = round(100 * s["solved"] / denom) if denom else None
    return stats


def results(attempt):
    pz = list(attempt.puzzles.all())
    stats = objective_stats(pz)
    mastered, practice = [], []
    for lo, s in stats.items():
        if s["seen"] == 0:
            continue
        if s["solved"] and s["wrong"] == 0 and s["hints"] <= 1:
            mastered.append(lo)
        else:
            practice.append(lo)
    end = attempt.completed_at or attempt.last_active
    return {
        "attempt": attempt,
        "rooms_completed": len(completed_rooms(attempt)),
        "hints_used": attempt.hints.count(),
        "mistakes": sum(p.wrong_attempts for p in pz),
        "puzzles": pz,
        "stats": stats,
        "mastered": [(lo, P.OBJECTIVES[lo]) for lo in mastered],
        "practice": [(lo, P.OBJECTIVES[lo]) for lo in practice],
        "wall_minutes": round((end - attempt.started_at).total_seconds() / 60, 1),
        "active_minutes": round(attempt.active_seconds / 60, 1),
        "achievements": [{"code": a.code, **P.ACHIEVEMENTS[a.code]}
                         for a in UserAchievement.objects.filter(attempt=attempt)],
    }


# ---------------------------------------------------------------------------
# Inventory and archives (for the in-world game)
# ---------------------------------------------------------------------------

def inventory(attempt):
    """Items the player has collected, derived from solved puzzles (real DES values)."""
    solved = set(attempt.puzzles.filter(solved=True).values_list("puzzle_id", flat=True))
    ctx = P.context(attempt.params)
    enc, ks = ctx["enc"], ctx["ks"]
    items = []

    def add(item_id, name, icon, desc, values):
        items.append({"id": item_id, "name": name, "icon": icon, "desc": desc, "values": values})

    if P.is_dec(ctx):
        # Decrypt mission: the message is secret until the player decrypts it, so it never appears early.
        add("intercept", "Intercepted signal", "card", "The encrypted message caught by the radio (8 byte values).",
            [["Bytes", " ".join(str(int(ctx["cipher_in"][i:i + 2], 16)) for i in range(0, 16, 2))]])
        if "r1_ascii" in solved:
            add("block", "Ciphertext block", "chip", "The intercepted message as one 64-bit DES block (hex).",
                [["Ciphertext", ctx["cipher_in"]]])
        if "r1_split" in solved:
            add("halves", "L0 / R0 halves", "halves", "The ciphertext after IP, split into two 32-bit halves.",
                [["After IP", enc["ip"]["hex"]], ["L0", enc["l0"]["hex"]], ["R0", enc["r0"]["hex"]]])
        if any(p.startswith("r2_") for p in solved) or "r1_split" in solved:
            add("key", "Vault key", "key", "The 64-bit DES key (56 effective bits).", [["Key", ks["key"]["hex"]]])
        if "r2_cycle" in solved:
            add("subkeys", "16 round-key chips", "chips", "K1 … K16, 48 bits each. Decryption uses them from K16 down to K1.",
                [[f"K{r['round']}", r["subkey"]["hex"]] for r in ks["rounds"]])
        if "r3_swap" in solved:
            add("cipher", "Decrypted tape", "tape", "The ciphertext after 16 decryption rounds and IP⁻¹.",
                [["Ciphertext", ctx["cipher_in"]], ["Plaintext", enc["output"]["hex"]]])
        if "r4_code" in solved:
            add("exitcode", "Secret message", "star", "The plaintext read as characters.",
                [["Plaintext", ctx["plain_hex"]], ["Message", attempt.params["code"]]])
        return items

    add("codecard", "Access code card", "card", "The 8-character code found at the Hex Gate.",
        [["Code", attempt.params["code"]]])
    if "r1_ascii" in solved:
        add("block", "64-bit block", "chip", "The access code as one DES block (hex).",
            [["Block", ctx["plain_hex"]]])
    if "r1_split" in solved:
        add("halves", "L0 / R0 halves", "halves", "The block after IP, split into two 32-bit halves.",
            [["After IP", enc["ip"]["hex"]], ["L0", enc["l0"]["hex"]], ["R0", enc["r0"]["hex"]]])
    if any(p.startswith("r2_") for p in solved) or "r1_split" in solved:
        add("key", "Vault key", "key", "The 64-bit DES key (56 effective bits).", [["Key", ks["key"]["hex"]]])
    if "r2_cycle" in solved:
        add("subkeys", "16 round-key chips", "chips", "K1 … K16, 48 bits each (from PC-1, rotations and PC-2).",
            [[f"K{r['round']}", r["subkey"]["hex"]] for r in ks["rounds"]])
    if "r3_swap" in solved:
        add("cipher", "Ciphertext tape", "tape", "Your block after all 16 rounds and IP⁻¹.",
            [["Plaintext", ctx["plain_hex"]], ["Ciphertext", enc["output"]["hex"]]])
    if "r4_order" in solved or completed_rooms(attempt) >= {1, 2, 3}:
        add("exitcipher", "Sealed exit message", "lock", "The ciphertext guarding the exit.",
            [["Ciphertext", ctx["cipher_exit"]]])
    if "r4_code" in solved:
        add("exitcode", "Exit code", "star", "Recovered by DES decryption.",
            [["Plaintext", ctx["exit_hex"]], ["Code", attempt.params["exit_code"]]])
    return items


ARCHIVES = {"keys": "r2_cycle", "encrypt": "r3_swap", "decrypt": "r4_round"}


def archive(attempt, kind):
    """Full DES traces, unlocked in-world after the matching challenge is solved."""
    if kind not in ARCHIVES:
        raise GameError("Unknown archive.")
    need = ARCHIVES[kind]
    if not attempt.puzzles.filter(puzzle_id=need, solved=True).exists():
        raise GameError("This archive is still encrypted. Solve the machine next to it first.")
    ctx = P.context(attempt.params)
    if kind == "keys":
        return {"kind": kind, "schedule": ctx["ks"]}
    # "encrypt" = the Room 3 reactor run, "decrypt" = the Room 4 run. In a decrypt mission they swap roles.
    t = ctx["enc"] if kind == "encrypt" else ctx["r4"]
    dec = (kind == "decrypt") != P.is_dec(ctx)
    return {"kind": kind, "mode": "decrypt" if dec else "encrypt",
            "trace": {k: v for k, v in t.items() if k != "key_schedule"}}


# ---------------------------------------------------------------------------
# Notebook: "My DES values" (copy them, or check them in the DES Lab)
# ---------------------------------------------------------------------------

def des_values(attempt):
    """The real DES values of one adventure that the player has already earned, with DES Lab checks.

    Nothing appears before the machine that produces it is solved, so the notebook never gives away an answer."""
    from urllib.parse import urlencode

    solved = set(attempt.puzzles.filter(solved=True).values_list("puzzle_id", flat=True))
    rooms_done = completed_rooms(attempt)
    ctx = P.context(attempt.params)
    key = ctx["ks"]["key"]["hex"]
    has_key = "r1_split" in solved or any(p.startswith("r2_") for p in solved)
    vals, checks = [], []

    def lab(block, mode):
        return "/lab/?" + urlencode({"block": block, "key": key, "mode": mode})

    if P.is_dec(ctx):
        if "r1_ascii" in solved:
            vals.append(("Intercepted ciphertext", ctx["cipher_in"]))
        if has_key:
            vals.append(("Key", key))
        if "r3_swap" in solved:
            plain = ctx["enc"]["output"]["hex"]
            vals.append(("Decrypted plaintext", plain))
            checks.append(("Decrypt the ciphertext in the DES Lab", lab(ctx["cipher_in"], "decrypt")))
            checks.append(("Encrypt the plaintext back", lab(plain, "encrypt")))
        if "r4_code" in solved:
            vals.append(("Secret message", attempt.params["code"]))
    else:
        if "r1_ascii" in solved:
            vals.append(("Plaintext block (access code)", ctx["plain_hex"]))
        if has_key:
            vals.append(("Key", key))
        if "r3_swap" in solved:
            cipher = ctx["enc"]["output"]["hex"]
            vals.append(("Ciphertext", cipher))
            checks.append(("Encrypt the plaintext in the DES Lab", lab(ctx["plain_hex"], "encrypt")))
            checks.append(("Decrypt the ciphertext back", lab(cipher, "decrypt")))
        if "r4_order" in solved or rooms_done >= {1, 2, 3}:
            vals.append(("Exit ciphertext", ctx["cipher_exit"]))
        if "r4_code" in solved:
            vals.append(("Exit plaintext", ctx["exit_hex"]))
            checks.append(("Decrypt the exit ciphertext in the DES Lab", lab(ctx["cipher_exit"], "decrypt")))
    if "r1_ascii" in solved and has_key and not checks:
        first = ctx["cipher_in"] if P.is_dec(ctx) else ctx["plain_hex"]
        checks.append(("Try your block in the DES Lab", lab(first, "decrypt" if P.is_dec(ctx) else "encrypt")))
    return {"attempt": attempt, "direction": ctx["dir"], "values": vals, "checks": checks}


def notebook_values(user, limit=3):
    out = []
    for a in user.attempts.order_by("-id")[:limit]:
        v = des_values(a)
        if v["values"]:
            out.append(v)
    return out
