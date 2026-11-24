"""Student-facing pages and the JSON API used by the game screen."""
import json

from django.contrib import messages
from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import get_object_or_404, redirect, render
from django.urls import reverse
from django.views.decorators.http import require_POST

from accounts.models import TutorialCompletion

from . import assessments, notebook
from . import puzzles as P
from . import services as S
from .models import AssessmentResult, Attempt, UserAchievement


@login_required
def assessment_result(request, result_id):
    res = get_object_or_404(AssessmentResult, pk=result_id, user=request.user)
    review = assessments.review(res.kind, res.answers or {})
    compare = None
    if res.kind == "post":
        pre = request.user.assessments.filter(kind="pre", taken_at__lte=res.taken_at).first()
        if pre:
            rows = []
            a, b = assessments.per_counts(pre.per_objective), assessments.per_counts(res.per_objective)
            for lo, name in P.OBJECTIVES.items():
                if lo in b:
                    pa, pb = a.get(lo, [0, 0]), b[lo]
                    rows.append({"lo": lo, "name": name, "pre": pa, "post": pb,
                                 "pre_full": pa[1] and pa[0] == pa[1], "post_full": pb[0] == pb[1]})
            pre_pct = round(100 * pre.score / pre.total) if pre.total else 0
            post_pct = round(100 * res.score / res.total) if res.total else 0
            compare = {"pre": pre, "rows": rows, "change": post_pct - pre_pct, "pre_pct": pre_pct, "post_pct": post_pct}
    if res.kind == "pre":
        next_url = reverse("play", args=[res.attempt_id]) if res.attempt_id else reverse("dashboard")
        next_label = "Continue to the game"
    else:
        next_url = reverse("results", args=[res.attempt_id]) if res.attempt_id else reverse("dashboard")
        next_label = "See your adventure results" if res.attempt_id else "Back to dashboard"
    pct = round(100 * res.score / res.total) if res.total else 0
    return render(request, "game/assessment_result.html", {"res": res, "review": review, "compare": compare,
                                                           "next_url": next_url, "next_label": next_label, "pct": pct})


# ---------------------------------------------------------------------------
# Public pages
# ---------------------------------------------------------------------------

def landing(request):
    return render(request, "landing.html", {"rooms": P.ROOMS})


def start(request):
    if request.user.is_authenticated:
        return redirect("dashboard")
    return render(request, "start.html")


def how_to_play(request):
    return render(request, "how_to_play.html", {"rooms": P.ROOMS, "achievements": P.ACHIEVEMENTS,
                                                "scoring": {"base": P.POINTS_PER_PUZZLE, "wrong": P.WRONG_PENALTY,
                                                            "hints": P.HINT_PENALTIES, "bonus": P.ROOM_BONUS}})


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

@login_required
def dashboard(request):
    user = request.user
    attempts = list(user.attempts.prefetch_related("rooms", "puzzles"))
    active = next((a for a in attempts if a.status == Attempt.ACTIVE), None)
    active_state = S.state(active) if active else None
    completed = [a for a in attempts if a.status == Attempt.COMPLETED]
    earned = {ua.code: ua for ua in UserAchievement.objects.filter(user=user)}
    badges = [{"code": c, **info, "earned": c in earned, "earned_at": earned[c].earned_at if c in earned else None}
              for c, info in P.ACHIEVEMENTS.items()]
    from .models import PuzzleProgress
    all_pp = PuzzleProgress.objects.filter(attempt__user=user)
    stats = [(P.OBJECTIVES[lo], s) for lo, s in S.objective_stats(all_pp).items()]
    history = []
    for a in attempts:
        history.append({"a": a, "rooms": sum(1 for r in a.rooms.all() if r.completed_at),
                        "hints": a.hints.count()})
    pre = user.assessments.filter(kind="pre").first()
    post = user.assessments.filter(kind="post").first()
    return render(request, "dashboard.html", {
        "active": active, "active_state": active_state, "history": history, "completed": completed,
        "badges": badges, "stats": stats, "objectives": P.OBJECTIVES,
        "best_score": max([a.score for a in completed], default=0),
        "lifetime_points": sum(a.score for a in attempts),
        "puzzles_solved": all_pp.filter(solved=True).count(),
        "hints_total": sum(h["hints"] for h in history),
        "pre": pre, "post": post,
        "assessment_change": (round(100 * post.score / post.total) - round(100 * pre.score / pre.total)) if pre and post and pre.total and post.total else None,
        "rooms": P.ROOMS,
    })


@login_required
@require_POST
def new_adventure(request):
    mode = request.POST.get("mode", Attempt.GUIDED)
    if mode not in (Attempt.GUIDED, Attempt.CHALLENGE):
        mode = Attempt.GUIDED
    for old in request.user.attempts.filter(status=Attempt.ACTIVE):
        S.abandon_attempt(old)  # the dashboard asks for confirmation first; results are kept
    direction = "decrypt" if request.POST.get("direction") == "decrypt" else "encrypt"
    attempt = S.start_attempt(request.user, mode=mode, timed=request.POST.get("timed") == "on", direction=direction)
    return redirect("play", attempt_id=attempt.id)


@login_required
def resume(request):
    attempt = request.user.attempts.filter(status=Attempt.ACTIVE).first()
    if not attempt:
        messages.info(request, "You have no adventure in progress. Start a new one!")
        return redirect("dashboard")
    return redirect("play", attempt_id=attempt.id)


@login_required
def play(request, attempt_id):
    attempt = get_object_or_404(Attempt, pk=attempt_id, user=request.user)
    if attempt.status == Attempt.ABANDONED:
        messages.info(request, "That adventure was replaced by a newer one. Its results are kept in your history.")
        return redirect("results", attempt_id=attempt.id)
    tutorials = list(TutorialCompletion.objects.filter(user=request.user).values_list("tutorial_id", flat=True))
    boot = {
        "attemptId": attempt.id, "username": request.user.username, "mode": attempt.mode,
        "direction": attempt.params.get("direction", "encrypt"),
        "tutorialsDone": tutorials, "notebookUrl": reverse("notebook"),
        "labUrl": reverse("lab"), "dashboardUrl": reverse("dashboard"),
        "resultsUrl": reverse("results", args=[attempt.id]),
        "postUrl": reverse("assessment", args=["post"]) + f"?attempt={attempt.id}",
        "preTaken": request.user.assessments.filter(kind="pre").exists(),
        "preUrl": reverse("assessment", args=["pre"]) + f"?attempt={attempt.id}",
    }
    return render(request, "game/play.html", {"attempt": attempt, "boot": boot})


@login_required
def results(request, attempt_id):
    attempt = get_object_or_404(Attempt, pk=attempt_id, user=request.user)
    ctx = S.results(attempt)
    ctx["objectives"] = P.OBJECTIVES
    ctx["post_taken"] = request.user.assessments.filter(kind="post").exists()
    return render(request, "game/results.html", ctx)


@login_required
def notebook_view(request):
    unlocked = request.user.profile.notebook_unlocked
    return render(request, "game/notebook.html", {
        "pages": notebook.pages(unlocked), "embed": request.GET.get("embed") == "1",
        "my_values": S.notebook_values(request.user),
        "focus": request.GET.get("page", "")})


@login_required
def assessment(request, kind):
    if kind not in ("pre", "post"):
        return redirect("dashboard")
    attempt_id = request.GET.get("attempt") or request.POST.get("attempt")
    attempt = Attempt.objects.filter(pk=attempt_id, user=request.user).first() if attempt_id else None
    if request.method == "POST":
        ids = [i for i in request.POST.get("set", "").split(",") if i]
        if not assessments.valid_set(ids):
            messages.error(request, "That question set was not valid. Here is a fresh set.")
            return redirect(request.path + (f"?attempt={attempt.id}" if attempt else ""))
        chosen = {qid: request.POST.get(f"q_{qid}") for qid in ids}
        score, total, per = assessments.grade(ids, chosen)
        res = AssessmentResult.objects.create(user=request.user, kind=kind, attempt=attempt, score=score,
                                              total=total, answers={"set": ids, "a": chosen}, per_objective=per)
        return redirect("assessment_result", result_id=res.id)
    # A fresh random set every time, avoiding the questions of the player's last two results when possible.
    ids = assessments.draw(avoid=assessments.seen_ids(list(request.user.assessments.all()[:2])))
    qs = assessments.questions(ids)
    previous = request.user.assessments.filter(kind=kind).first()
    return render(request, "game/assessment.html", {"kind": kind, "questions": qs, "attempt": attempt,
                                                    "set": ",".join(ids), "bank_size": len(assessments.BANK),
                                                    "previous": previous, "objectives": P.OBJECTIVES})


# ---------------------------------------------------------------------------
# JSON API
# ---------------------------------------------------------------------------

def _json_body(request):
    try:
        return json.loads(request.body or "{}")
    except ValueError:
        return {}


def api_view(fn):
    """Login required, attempt ownership enforced, GameError -> 400."""
    @login_required
    def wrapper(request, attempt_id, *args, **kwargs):
        attempt = get_object_or_404(Attempt, pk=attempt_id, user=request.user)
        try:
            return JsonResponse(fn(request, attempt, *args, **kwargs))
        except S.GameError as exc:
            return JsonResponse({"error": str(exc)}, status=400)
    wrapper.__name__ = fn.__name__
    return wrapper


@require_POST
@api_view
def api_tick(request, attempt):
    return S.tick(attempt)


@api_view
def api_state(request, attempt):
    data = S.state(attempt)
    data["tutorials_done"] = list(TutorialCompletion.objects.filter(user=request.user)
                                  .values_list("tutorial_id", flat=True))
    return data


@require_POST
@api_view
def api_enter_room(request, attempt):
    room = int(_json_body(request).get("room", 0))
    if room == 0:  # back to the lobby
        attempt.position = {"room": 0}
        attempt.touch()
        attempt.save(update_fields=["position", "active_seconds", "last_active"])
    else:
        S.enter_room(attempt, room)
    return {"ok": True, "position": attempt.position}


@api_view
def api_puzzle(request, attempt, pid):
    return S.open_puzzle(attempt, pid)


@require_POST
@api_view
def api_submit(request, attempt, pid):
    return S.submit(attempt, pid, _json_body(request).get("answer", {}))


@require_POST
@api_view
def api_hint(request, attempt, pid):
    return S.hint(attempt, pid)


@api_view
def api_inventory(request, attempt):
    return {"items": S.inventory(attempt)}


@api_view
def api_archive(request, attempt, kind):
    return S.archive(attempt, kind)


@require_POST
@api_view
def api_intro_seen(request, attempt):
    attempt.intro_seen = True
    attempt.save(update_fields=["intro_seen"])
    return {"ok": True}


@require_POST
@api_view
def api_flag(request, attempt):
    S.flag_not_independent(attempt, "Opened the DES Explorer during the challenge.")
    return {"ok": True, "independent": attempt.independent}


@login_required
@require_POST
def api_tutorial(request, tutorial_id):
    body = _json_body(request)
    TutorialCompletion.objects.update_or_create(user=request.user, tutorial_id=tutorial_id[:40],
                                                defaults={"skipped": bool(body.get("skipped"))})
    return JsonResponse({"ok": True})
