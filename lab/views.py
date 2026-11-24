"""Independent DES Learning Laboratory (works without any game progress)."""
import json
import math
import secrets

from django.contrib.auth.decorators import login_required
from django.http import JsonResponse
from django.shortcuts import render
from django.views.decorators.csrf import ensure_csrf_cookie
from django.views.decorators.http import require_POST

from des_engine import DESInputError, TEST_VECTORS, des_trace, encrypt_many, round_states, validate_hex64
from des_engine import bulk
from des_engine import tables as T
import base64
import binascii
from game.models import Attempt
from game.services import flag_not_independent


def _signed_in(view):
    """The DES Lab is for signed-in players only (API calls answer 403 otherwise)."""
    def wrapped(request, *a, **kw):
        if not request.user.is_authenticated:
            return JsonResponse({"error": "Please sign in to use the DES Lab."}, status=403)
        return view(request, *a, **kw)
    wrapped.__name__ = view.__name__
    return wrapped


def _active_challenge(request):
    if not request.user.is_authenticated:
        return None
    return request.user.attempts.filter(status=Attempt.ACTIVE, mode=Attempt.CHALLENGE, independent=True).first()


@login_required
@ensure_csrf_cookie
def lab(request):
    challenge = _active_challenge(request)
    if challenge and request.GET.get("confirm") != "1":
        # Showing full DES traces during an independent challenge would reveal answers.
        return render(request, "lab/warning.html", {"attempt": challenge, "query": request.GET.urlencode()})
    if challenge:
        flag_not_independent(challenge, "Opened the DES Laboratory during the challenge.")
    return render(request, "lab/lab.html", {
        "vectors": TEST_VECTORS,
        "tables": {"IP": T.IP, "IP_INV": T.IP_INV, "E": T.E, "P": T.P, "PC1": T.PC1, "PC2": T.PC2,
                   "SHIFTS": T.SHIFTS, "SBOXES": T.SBOXES},
    })


@require_POST
@_signed_in
def api_des(request):
    try:
        body = json.loads(request.body or "{}")
    except ValueError:
        body = {}
    mode = body.get("mode", "encrypt")
    try:
        trace = des_trace(body.get("block"), body.get("key"), decrypt=(mode == "decrypt"))
    except DESInputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    trace["warnings"] = bulk.key_warnings(trace["key"]["hex"])
    return JsonResponse(trace)


@require_POST
@_signed_in
def api_key(request):
    """Password → 64-bit key (with every step), or a fresh random key."""
    body = _body(request)
    if body.get("action") == "random":
        key = bulk.random_key()
        return JsonResponse({"key": key, "warnings": bulk.key_warnings(key)})
    try:
        steps = bulk.key_from_password(body.get("password"))
    except DESInputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    steps["warnings"] = bulk.key_warnings(steps["key"])
    return JsonResponse(steps)


def _printable(data):
    try:
        text = data.decode("utf-8")
    except UnicodeDecodeError:
        return None
    if any(ord(c) < 32 and c not in "\n\r\t" for c in text):
        return None
    return text


@require_POST
@_signed_in
def api_data(request):
    """Encrypt or decrypt a whole message or file (any length) with PKCS#7 padding and ECB or CBC."""
    body = _body(request)
    decrypt = body.get("mode") == "decrypt"
    kind = body.get("kind", "text")
    raw = body.get("data") or ""
    try:
        key = validate_hex64(body.get("key"), "key")
        if kind == "text":
            data = raw.encode("utf-8")
        elif kind == "hex":
            cleaned = "".join(str(raw).split())
            if cleaned.lower().startswith("0x"):
                cleaned = cleaned[2:]
            if any(c not in "0123456789abcdefABCDEF" for c in cleaned):
                raise DESInputError("The hex input contains characters other than 0-9 and A-F.")
            if len(cleaned) % 2:
                raise DESInputError(f"The hex input has {len(cleaned)} digits: hex bytes come in pairs, so the count must be even.")
            data = bytes.fromhex(cleaned)
        elif kind == "file":
            try:
                data = base64.b64decode(raw, validate=True)
            except (binascii.Error, ValueError):
                raise DESInputError("The file could not be read. Please choose it again.")
        else:
            raise DESInputError("Unknown input type.")
        out, info = bulk.crypt(data, key, decrypt=decrypt, mode=body.get("cipher_mode", "ECB"),
                               padding=bool(body.get("padding", True)), iv_hex=body.get("iv") or None)
    except DESInputError as exc:
        return JsonResponse({"error": str(exc)}, status=400)
    name = (body.get("filename") or "").strip().replace("/", "_").replace("\\", "_")[:120]
    if kind == "file" and name:
        if decrypt:
            name = name[:-4] if name.lower().endswith(".des") else "decrypted-" + name
        else:
            name = name + ".des"
    else:
        name = "decrypted.txt" if decrypt else "ciphertext.des"
    hex_out = out.hex().upper()
    info.update({
        "size_in": len(data), "size_out": len(out),
        "output_hex": hex_out[:8192], "output_hex_truncated": len(hex_out) > 8192,
        "output_b64": base64.b64encode(out).decode(),
        "output_text": _printable(out) if decrypt else None,
        "filename": name, "warnings": bulk.key_warnings(key),
    })
    if not decrypt and info["mode"] == "ECB":
        seen, repeats = set(), 0
        for i in range(0, len(out), 8):
            b = out[i:i + 8]
            repeats += b in seen
            seen.add(b)
        info["ecb_repeats"] = repeats
    return JsonResponse(info)


def _body(request):
    try:
        return json.loads(request.body or "{}")
    except ValueError:
        return {}


def _flip(hex64, bit):
    """Flip bit `bit` (1 = leftmost, 64 = rightmost) of a 16-hex-digit value."""
    v = int(hex64, 16) ^ (1 << (64 - bit))
    return format(v, "016X")


@require_POST
@_signed_in
def api_avalanche(request):
    """Avalanche effect: run DES twice, the second time with ONE bit flipped (in the message or
    in the key), and count how many of the 64 state bits differ after IP and after every round."""
    body = _body(request)
    try:
        block = validate_hex64(body.get("block"), "message")
        key = validate_hex64(body.get("key"), "key")
        bit = int(body.get("bit", 1))
    except (DESInputError, TypeError, ValueError) as exc:
        return JsonResponse({"error": str(exc) or "Enter a bit position from 1 to 64."}, status=400)
    if not 1 <= bit <= 64:
        return JsonResponse({"error": "The bit position must be between 1 and 64."}, status=400)
    target = "key" if body.get("target") == "key" else "message"
    block2, key2 = (block, _flip(key, bit)) if target == "key" else (_flip(block, bit), key)
    s1, out1 = round_states(block, key)
    s2, out2 = round_states(block2, key2)
    rows = []
    for i, (a, b) in enumerate(zip(s1, s2)):
        diff = "".join("1" if x != y else "0" for x, y in zip(a, b))
        rows.append({"round": i, "a": format(int(a, 2), "016X"), "b": format(int(b, 2), "016X"),
                     "diff": diff, "count": diff.count("1")})
    o1, o2 = bin(int(out1, 16))[2:].zfill(64), bin(int(out2, 16))[2:].zfill(64)
    odiff = "".join("1" if x != y else "0" for x, y in zip(o1, o2))
    return JsonResponse({
        "target": target, "bit": bit, "parity_bit": target == "key" and bit % 8 == 0,
        "block": block, "key": key, "block2": block2, "key2": key2,
        "rows": rows, "output": {"a": out1, "b": out2, "diff": odiff, "count": odiff.count("1")},
    })


BIRTHDAY_SIZES = (8, 12, 16, 20, 24)


@require_POST
@_signed_in
def api_birthday(request):
    """Birthday bound on a reduced block size: encrypt consecutive messages with real DES under a
    random key, keep only the first n bits of every ciphertext, and stop at the first repeat.
    With an n-bit block a repeat is expected after about sqrt(pi/2 * 2^n) ~ 1.25 * 2^(n/2) blocks."""
    body = _body(request)
    try:
        n = int(body.get("bits", 16))
    except (TypeError, ValueError):
        n = 16
    if n not in BIRTHDAY_SIZES:
        return JsonResponse({"error": f"Choose a block size of {', '.join(map(str, BIRTHDAY_SIZES))} bits."}, status=400)
    key = format(secrets.randbits(64), "016X")
    start = secrets.randbits(63)
    limit = 16 * int(2 ** (n / 2)) + 64
    seen = {}
    plains = [format((start + i) % (1 << 64), "016X") for i in range(limit)]
    found = None
    for i, (pt, ct) in enumerate(zip(plains, encrypt_many(plains, key)), start=1):
        short = int(ct, 16) >> (64 - n)
        if short in seen:
            found = {"draws": i, "value": format(short, f"0{(n + 3) // 4}X"),
                     "first": {"index": seen[short][0], "plain": seen[short][1]}, "second": {"index": i, "plain": pt}}
            break
        seen[short] = (i, pt)
    return JsonResponse({
        "bits": n, "key": key, "space": 2 ** n,
        "expected": round(math.sqrt(math.pi / 2 * 2 ** n), 1),
        "half": round(math.sqrt(2 * math.log(2) * 2 ** n), 1),
        "collision": found,
    })
