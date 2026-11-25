"""Pre/post assessments drawn from the slide-based DES question bank (see question_bank.py).

Every attempt draws a fresh random set of 7 questions: PER_OBJECTIVE question for each of the 7
learning objectives, in random order, with the options shuffled. The drawn question ids are kept in the
saved answers, so each result can be reviewed exactly as it was taken.
The first option in the bank is the correct one; the stored option value is its bank index.
"""
import random
import re

from .question_bank import BANK, BY_ID, LEGACY, OBJECTIVES  # noqa: F401

PER_OBJECTIVE = 1


def draw(rng=None, avoid=()):
    """Pick a random set of question ids: PER_OBJECTIVE per objective, avoiding recently seen ids if possible."""
    rng = rng or random.SystemRandom()
    avoid = set(avoid)
    chosen = []
    for lo in OBJECTIVES:
        pool = [q[0] for q in BANK if q[1] == lo]
        fresh = [q for q in pool if q not in avoid]
        src = fresh if len(fresh) >= PER_OBJECTIVE else pool
        chosen += rng.sample(src, PER_OBJECTIVE)
    rng.shuffle(chosen)
    return chosen


def questions(ids, rng=None):
    """The questions for these ids, with their options shuffled."""
    rng = rng or random.SystemRandom()
    out = []
    for qid in ids:
        _id, lo, text, options, _why, slides = BY_ID[qid]
        order = list(range(len(options)))
        rng.shuffle(order)
        out.append({"id": qid, "objective": lo, "text": text, "slides": slides,
                    "options": [{"value": str(j), "label": options[j]} for j in order]})
    return out


def valid_set(ids):
    return bool(ids) and len(ids) == len(set(ids)) and all(i in BY_ID for i in ids)


def _answer_map(answers, kind):
    """(ids, {id: chosen}) for new results, and for results saved before the bank existed."""
    if isinstance(answers, dict) and "set" in answers:
        return answers["set"], answers.get("a", {})
    ids = LEGACY.get(kind, [])
    return ids, {qid: (answers or {}).get(str(i)) for i, qid in enumerate(ids)}


def grade(ids, chosen):
    """chosen: {id: option value}. Returns (score, total, per_objective {LO: [correct, asked]})."""
    per = {}
    for qid in ids:
        lo = BY_ID[qid][1]
        c = per.setdefault(lo, [0, 0])
        c[1] += 1
        if str(chosen.get(qid)) == "0":
            c[0] += 1
    score = sum(c[0] for c in per.values())
    return score, len(ids), per


def per_counts(per_objective):
    """Normalise saved per-objective results to {LO: [correct, asked]} (old results stored 1/0)."""
    out = {}
    for lo, v in (per_objective or {}).items():
        out[lo] = list(v) if isinstance(v, (list, tuple)) else [int(v), 1]
    return out


# Explanations in the bank cite their slides; players see them without the slide numbers.
_WHY_OVERRIDES = {
    "c3-p06": "IP and IP⁻¹ are inverse tables: the final permutation undoes the initial IP.",
    "c3-e03": "By the rule L1 = R0: L1 = 3cf03c0f.",
    "c3-c05": "S-box design criterion 3: if two inputs differ in exactly 1 bit, the outputs must differ in at least 2 bits.",
}
_SLIDE_PAREN = re.compile(r"\s*\(slides? [\d, and]+(?: rule)?\)", re.I)
_SLIDE_LEAD = re.compile(r"(^|(?<=\. ))slides? \d+(?:(?:,| and) \d+)*(?: \([a-z]\))?(?: example)?(?:, criterion (\d+))?:\s*(\w?)", re.I)


def clean_why(qid, why):
    """The explanation with its slide references removed (for display to players)."""
    if qid in _WHY_OVERRIDES:
        return _WHY_OVERRIDES[qid]
    why = _SLIDE_PAREN.sub("", why)
    why = _SLIDE_LEAD.sub(lambda m: m.group(1) + (f"Criterion {m.group(2)}: " + m.group(3) if m.group(2) else m.group(3).upper()), why)
    return why.strip()


def review(kind, answers):
    """Per-question review: the player's choice, the correct answer and a short explanation."""
    ids, chosen = _answer_map(answers, kind)
    out = []
    for n, qid in enumerate(ids, 1):
        _id, lo, text, options, why, _slides = BY_ID[qid]
        c = chosen.get(qid)
        try:
            chosen_label = options[int(c)]
        except (TypeError, ValueError, IndexError):
            chosen_label = None
        out.append({"n": n, "objective": lo, "text": text, "chosen": chosen_label,
                    "correct": options[0], "ok": str(c) == "0", "why": clean_why(qid, why)})
    return out


def seen_ids(results, limit=2):
    """Question ids from a player's most recent results, so a new attempt can avoid repeats."""
    seen = []
    for r in results[:limit]:
        ids, _ = _answer_map(r.answers, r.kind)
        seen += ids
    return seen
