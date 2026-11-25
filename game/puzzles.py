"""
Puzzle definitions for the four rooms.

Each puzzle is rebuilt on demand from the attempt's stored parameters. Every
expected answer comes from the DES engine (``des_engine``); nothing is
hard-coded. The client receives ``view`` (what to show), ``fields`` (what to
answer) and, after solving, ``reveal`` (the full computed values). The
``answer`` never leaves the server.
"""
from dataclasses import dataclass, field
from functools import lru_cache

from des_engine import ascii_to_hex, des_trace, encrypt, hex_to_ascii, hex_to_bits
from des_engine import tables as T
from des_engine.core import rotate_left

# ---------------------------------------------------------------------------
# Rooms, objectives and achievements
# ---------------------------------------------------------------------------

OBJECTIVES = {
    "LO1": "Represent a 64-bit block correctly in hexadecimal",
    "LO2": "Explain the 64-bit key representation and 56-bit effective key strength",
    "LO3": "Generate DES subkeys using PC-1, circular shifts and PC-2",
    "LO4": "Explain and follow the operations within a DES Feistel round",
    "LO5": "Perform S-box row/column calculations",
    "LO6": "Explain DES decryption and reversed round-key order",
    "LO7": "Explain why DES should not be used for modern security",
}

ROOMS = {
    1: {"name": "The Hex Gate", "badge": "hex_explorer",
        "puzzles": ["r1_ascii", "r1_block", "r1_ip_bit", "r1_split"]},
    2: {"name": "The Key Vault", "badge": "key_master",
        "puzzles": ["r2_parity", "r2_pc1_bit", "r2_split", "r2_shift", "r2_pc2", "r2_cycle"]},
    3: {"name": "The Round Reactor", "badge": "round_master",
        "puzzles": ["r3_expand", "r3_xor", "r3_sbox", "r3_sbox_bonus", "r3_perm", "r3_feistel", "r3_swap"]},
    4: {"name": "The Exit Chamber", "badge": "graduate",
        "puzzles": ["r4_order", "r4_round", "r4_code", "r4_verdict"]},
}

ACHIEVEMENTS = {
    "hex_explorer": {"name": "Hex Explorer", "icon": "hexagon",
                     "condition": "Unlock the Hex Gate (complete Room 1)."},
    "key_master": {"name": "Key Master", "icon": "key-round",
                   "condition": "Open the Key Vault by generating the round keys (complete Room 2)."},
    "sbox_specialist": {"name": "S-box Specialist", "icon": "grid-3x3",
                        "condition": "Solve the main AND the bonus S-box challenge with no wrong answers."},
    "round_master": {"name": "Round Master", "icon": "atom",
                     "condition": "Repair the Round Reactor (complete Room 3)."},
    "reverse_engineer": {"name": "Reverse Engineer", "icon": "arrow-left-right",
                         "condition": "Solve the key-order and decryption-round challenges on the first try."},
    "graduate": {"name": "DEScape Graduate", "icon": "graduation-cap",
                 "condition": "Escape the lab (complete Room 4)."},
}

POINTS_PER_PUZZLE = 100
WRONG_PENALTY = 10
HINT_PENALTIES = {1: 10, 2: 20, 3: 30}
ROOM_BONUS = 50


def room_of(pid):
    return int(pid[1])


def required_puzzles(room):
    return [p for p in ROOMS[room]["puzzles"] if not PUZZLE_META[p]["optional"]]


# ---------------------------------------------------------------------------
# Context: all DES values for one attempt
# ---------------------------------------------------------------------------

@lru_cache(maxsize=256)
def _context(code, exit_code, key, direction="encrypt"):
    plain_hex = ascii_to_hex(code)
    if direction == "decrypt":
        # Decrypt mission: Rooms 1-3 DECRYPT an intercepted ciphertext (rounds use K16 … K1);
        # Room 4 proves the result by ENCRYPTING the recovered message again (K1 … K16).
        cipher = encrypt(plain_hex, key)
        work = des_trace(cipher, key, decrypt=True)
        check = des_trace(plain_hex, key)
        return {"dir": "decrypt", "block_hex": cipher, "plain_hex": plain_hex, "enc": work,
                "ks": work["key_schedule"], "cipher_in": cipher, "r4": check,
                "r4_cipher": cipher, "r4_plain": work}
    enc = des_trace(plain_hex, key)
    exit_hex = ascii_to_hex(exit_code)
    cipher_exit = encrypt(exit_hex, key)
    dec = des_trace(cipher_exit, key, decrypt=True)
    return {"dir": "encrypt", "block_hex": plain_hex, "plain_hex": plain_hex, "enc": enc, "ks": enc["key_schedule"],
            "exit_hex": exit_hex, "cipher_exit": cipher_exit, "dec": dec,
            "r4": dec, "r4_cipher": cipher_exit, "r4_plain": dec}


def context(params):
    return _context(params["code"], params["exit_code"], params["key"], params.get("direction", "encrypt"))


def is_dec(ctx):
    return ctx["dir"] == "decrypt"


# ---------------------------------------------------------------------------
# Puzzle object and answer normalisation
# ---------------------------------------------------------------------------

@dataclass
class Puzzle:
    id: str
    title: str
    nova: str                 # NOVA: what we are doing and why it matters
    task: str                 # one-line instruction
    view: dict
    fields: list
    answer: dict
    hints: list
    success: str              # learning summary after solving
    reveal: dict = field(default_factory=dict)
    tips: dict = field(default_factory=dict)  # field -> targeted feedback

    @property
    def meta(self):
        return PUZZLE_META[self.id]

    def public(self, solved=False, hints_used=0):
        data = {
            "id": self.id, "room": room_of(self.id), "title": self.title,
            "objective": self.meta["objective"],
            "objective_text": OBJECTIVES[self.meta["objective"]],
            "optional": self.meta["optional"], "concepts": self.meta["concepts"],
            "nova": self.nova, "task": self.task, "view": self.view,
            "fields": self.fields, "solved": solved,
            "hints": self.hints[:hints_used],
        }
        if solved:
            data["reveal"] = self.reveal
            data["success"] = self.success
            data["answer"] = self.answer  # safe to show once solved
        return data


class FormatError(ValueError):
    pass


def normalize(spec, raw):
    """Normalise one submitted field according to its spec."""
    kind = spec["kind"]
    raw = "" if raw is None else str(raw)
    text = raw.replace(" ", "").replace("_", "").strip()
    if text == "":
        raise FormatError(f"“{spec['label']}” is empty.")
    if kind == "hex":
        n = spec["length"]
        if len(text) == 4 * n and set(text) <= {"0", "1"}:
            text = format(int(text, 2), f"0{n}X")
        if not all(c in "0123456789abcdefABCDEF" for c in text):
            raise FormatError(f"“{spec['label']}” must contain only hex digits 0-9, A-F.")
        if len(text) != n:
            raise FormatError(f"“{spec['label']}” needs exactly {n} hex digits (you entered {len(text)}).")
        return text.upper()
    if kind == "bin":
        n = spec["length"]
        if not set(text) <= {"0", "1"}:
            raise FormatError(f"“{spec['label']}” must contain only 0 and 1.")
        if len(text) != n:
            raise FormatError(f"“{spec['label']}” needs exactly {n} bits (you entered {len(text)}).")
        return text
    if kind == "int":
        if not text.lstrip("-").isdigit():
            raise FormatError(f"“{spec['label']}” must be a whole number.")
        return str(int(text))
    if kind == "choice":
        allowed = [str(o["value"]) for o in spec["options"]]
        if text not in allowed:
            raise FormatError(f"Choose one option for “{spec['label']}”.")
        return text
    if kind == "order":
        parts = [p for p in text.replace(";", ",").split(",") if p]
        if not all(p.isdigit() for p in parts):
            raise FormatError("The order must be a list of round-key numbers.")
        return ",".join(str(int(p)) for p in parts)
    if kind == "text":
        return raw.strip()
    raise FormatError("Unknown field type")


def hexf(name, label, length, tip=None):
    return {"name": name, "label": label, "kind": "hex", "length": length, "tip": tip}


def binf(name, label, length):
    return {"name": name, "label": label, "kind": "bin", "length": length}


def intf(name, label):
    return {"name": name, "label": label, "kind": "int"}


def choicef(name, label, options):
    return {"name": name, "label": label, "kind": "choice",
            "options": [{"value": str(i), "label": t} for i, t in options]}


def ordered(texts, order):
    """Return (option_list, index_of_correct) with options shuffled by ``order``.
    texts[0] is always the correct answer."""
    opts = [(i, texts[i]) for i in order]
    return opts, "0"


def bit_table(bits, start=1):
    return [{"pos": i + start, "bit": b} for i, b in enumerate(bits)]


# ---------------------------------------------------------------------------
# ROOM 1, The Hex Gate
# ---------------------------------------------------------------------------

def r1_ascii(p, ctx, mode):
    if is_dec(ctx):
        return _r1_cipher_in(p, ctx, mode)
    code = p["code"]
    chars = []
    for c in code:
        # Only the decimal character code is shown; the player does the bits → hex conversion.
        chars.append({"ch": c, "dec": ord(c)})
    first = code[0]
    return Puzzle(
        id="r1_ascii", title="Decode the access code",
        nova=("Every character becomes 2 hex digits, so the 8-character code becomes the "
              "16 hex digits (64 bits) the door needs."),
        task=f"Convert the access code “{code}” into its 16-digit hexadecimal block.",
        view={"kind": "ascii", "code": code, "chars": chars},
        fields=[hexf("hex", "64-bit block (16 hex digits)", 16)],
        answer={"hex": ctx["plain_hex"]},
        hints=[
            "Each character is one byte. Split its 8 bits into two groups of 4 (nibbles); each nibble is one hex digit.",
            "Example with a different letter: 'A' = 65 = 0100 0001 → 4 and 1 → '41'. 'z' = 122 = 0111 1010 → '7A'.",
            f"Start with '{first}': its number is {ord(first)}, bits = {format(ord(first), '08b')[:4]} {format(ord(first), '08b')[4:]}. "
            "Convert each nibble (0000=0 … 1001=9, 1010=A … 1111=F), write the two digits, then repeat "
            "for the remaining 7 characters in order. You should end with exactly 16 digits.",
        ],
        success=f"Great! “{code}” is the 64-bit block {ctx['plain_hex']}. 8 characters × 2 hex digits = 16 hex digits = 64 bits.",
        reveal={"hex": ctx["plain_hex"], "bin": hex_to_bits(ctx["plain_hex"])},
    )


def _r1_cipher_in(p, ctx, mode):
    c = ctx["cipher_in"]
    values = [int(c[2 * i:2 * i + 2], 16) for i in range(8)]
    first = values[0]
    return Puzzle(
        id="r1_ascii", title="Read the intercepted ciphertext",
        nova=("Decrypt mission: we intercepted an encrypted message. The radio gives its 8 bytes as "
              "numbers from 0 to 255. Every byte becomes 2 hex digits, so the 8 numbers become the 16 hex "
              "digits (64 bits) of the ciphertext block we must decrypt."),
        task="Write the 8 intercepted byte values as one 16-digit hexadecimal ciphertext block.",
        view={"kind": "ascii", "code": "", "direction": "decrypt",
              "chars": [{"ch": "", "dec": v} for v in values]},
        fields=[hexf("hex", "Ciphertext block (16 hex digits)", 16)],
        answer={"hex": c},
        hints=[
            "Each number is one byte (0–255) = 8 bits = 2 hex digits. Divide by 16: the quotient is the first digit, the remainder the second.",
            "Example with a different number: 200 = 12 × 16 + 8 → C and 8 → 'C8'. 7 = 0 × 16 + 7 → '07' (keep the leading 0).",
            f"Start with {first}: {first} ÷ 16 = {first // 16} remainder {first % 16}. Write both as hex digits, then do the other 7 numbers in order. You should end with exactly 16 digits.",
        ],
        success=f"Great! The intercepted ciphertext block is {c}: 8 bytes × 2 hex digits = 16 hex digits = 64 bits.",
        reveal={"hex": c, "bin": hex_to_bits(c)},
    )


def r1_block(p, ctx, mode):
    block = ctx["block_hex"]
    k = p["r1"]["byte_index"]
    byte_hex = block[2 * (k - 1):2 * k]
    texts = ["Both: 8 characters (8 × 8 bits) and 16 hex digits (16 × 4 bits)",
             "Only the 8 characters; hex digits carry 8 bits each",
             "Only 8 hex digits, because each hex digit is one byte",
             "Neither; DES blocks are 56 bits"]
    opts, correct = ordered(texts, p["r1"]["block_options"])
    bytes_view = [{"index": i + 1, "hex": block[2 * i:2 * i + 2],
                   "bin": None if i + 1 == k else format(int(block[2 * i:2 * i + 2], 16), "08b")}
                  for i in range(8)]
    return Puzzle(
        id="r1_block", title="Inspect the 64-bit block",
        nova="A DES block is always 64 bits. Let's inspect it byte by byte to be sure you can move between hex and binary.",
        task=f"Answer the block question and write the 8 bits of byte {k} (hex {byte_hex}).",
        view={"kind": "block", "block": block, "bytes": bytes_view, "hidden_byte": k},
        fields=[choicef("choice", "Which representations contain exactly 64 bits?", opts),
                binf("bin", f"Byte {k} in binary (8 bits)", 8)],
        answer={"choice": correct, "bin": format(int(byte_hex, 16), "08b")},
        hints=[
            "Count bits: one character is 8 bits; one hex digit is 4 bits.",
            "Example: hex 5C → 5 = 0101, C = 1100 → 01011100. 16 hex digits × 4 bits = 64 bits.",
            f"Byte {k} is {byte_hex}. Convert '{byte_hex[0]}' to 4 bits, then '{byte_hex[1]}' to 4 bits, and join them.",
        ],
        tips={"choice": "Remember: 8 characters × 8 bits and 16 hex digits × 4 bits.",
              "bin": "Convert each hex digit separately into 4 bits."},
        success="Correct! 16 hex digits and 8 bytes both describe the same 64-bit block.",
        reveal={"bytes": [{"index": i + 1, "hex": block[2 * i:2 * i + 2],
                           "bin": format(int(block[2 * i:2 * i + 2], 16), "08b")} for i in range(8)]},
    )


def r1_ip_bit(p, ctx, mode):
    enc = ctx["enc"]
    return Puzzle(
        id="r1_ip_bit", title="Initial Permutation (IP)",
        nova=("Before the rounds start, DES shuffles bit POSITIONS with the Initial Permutation. "
              "Bits move, but no bit changes its value. Output position k takes input bit IP[k]."),
        task="Perform the whole Initial Permutation: fill all 64 output bits using the IP table.",
        view={"kind": "ip", "input": enc["input"]["bin"], "table": T.IP},
        fields=[binf("out", "IP output (64 bits)", 64)],
        answer={"out": enc["ip"]["bin"]},
        hints=[
            "Each output cell shows a number from the IP table: that is the INPUT bit to copy into it.",
            "Example: output bit 1 shows ←58, so copy input bit 58. Output bit 2 shows ←50, so copy input bit 50.",
            "Work row by row. For each cell, find its input bit number in the left grid and copy that 0 or 1. "
            "After two correct rows you can type a whole row at once.",
        ],
        tips={"out": "Copy the input bit named in each cell (←n). Values never change, only positions."},
        success="Exactly. You performed the full Initial Permutation: same bits, new positions.",
        reveal={"ip": enc["ip"]},
    )


def r1_split(p, ctx, mode):
    enc = ctx["enc"]
    return Puzzle(
        id="r1_split", title="Split into L0 and R0",
        nova="The permuted block is cut into two 32-bit halves: L0 (left) and R0 (right). The Feistel rounds work on these halves.",
        task="Enter L0 and R0 in hex (8 hex digits = 32 bits each).",
        view={"kind": "split", "ip": enc["ip"]},
        fields=[hexf("l0", "L0 (left 32 bits)", 8), hexf("r0", "R0 (right 32 bits)", 8)],
        answer={"l0": enc["l0"]["hex"], "r0": enc["r0"]["hex"]},
        hints=[
            "32 bits = 8 hex digits. The block after IP has 16 hex digits.",
            "Example: if IP output were 0011223344556677, then L0 = 00112233 and R0 = 44556677.",
            "Take the first 8 hex digits of the IP result for L0 and the last 8 for R0 (not the original block!).",
        ],
        tips={"l0": "L0 comes from the block AFTER IP, first half.", "r0": "R0 is the second half of the IP output."},
        success="Great! Your 64-bit block is ready for the rounds. The Hex Gate is unlocking…",
        reveal={"l0": enc["l0"], "r0": enc["r0"]},
    )


# ---------------------------------------------------------------------------
# ROOM 2, The Key Vault
# ---------------------------------------------------------------------------

def r2_parity(p, ctx, mode):
    ks = ctx["ks"]
    texts = ["Bits 8, 16, 24, …, 64 (the last bit of every byte)",
             "Bits 1, 9, 17, …, 57 (the first bit of every byte)",
             "Bits 57–64 (the whole last byte)",
             "None; all 64 bits are key bits"]
    opts, correct = ordered(texts, p["r2"]["parity_options"])
    return Puzzle(
        id="r2_parity", title="The original key",
        nova=("Parity bits are check bits, not secret bits: each byte of the 64-bit key has one, set so the byte "
              "has an odd number of 1s. DES ignores them, so only 56 bits give real key strength."),
        task="Choose the parity bits, then set the effective key length.",
        view={"kind": "key", "key": ks["key"]},
        fields=[choicef("choice", "Which bits are parity bits?", opts),
                intf("effective", "Effective key length (bits)")],
        answer={"choice": correct, "effective": "56"},
        hints=[
            "Each of the 8 key bytes donates one parity bit.",
            "In the key byte 0x13 = 0001001 1, the final bit (the 8th) is the parity bit.",
            "Parity bits sit at every 8th position. 64 − 8 = the number of effective bits.",
        ],
        tips={"effective": "Subtract the 8 parity bits from 64."},
        success="Right: a 64-bit key, but only 56 effective bits. That is 2^56 possible keys, which matters later.",
        reveal={"parity_positions": ks["parity_positions"], "parity_bits": ks["parity_bits"]},
    )


def r2_pc1_bit(p, ctx, mode):
    ks = ctx["ks"]
    return Puzzle(
        id="r2_pc1_bit", title="Activate PC-1",
        nova="Permuted Choice 1 does two jobs at once: it DROPS the 8 parity bits and REARRANGES the other 56.",
        task="Perform PC-1: fill all 56 output bits from the 64-bit key using the PC-1 table.",
        view={"kind": "pc1", "input": ks["key"]["bin"], "table": T.PC1},
        fields=[binf("out", "PC-1 output (56 bits)", 56)],
        answer={"out": ks["pc1"]["bin"]},
        hints=[
            "PC-1 has 56 entries. Each output cell shows (←n) which key bit to copy.",
            "Example: PC-1 starts 57, 49, 41… so output bit 1 = key bit 57. No multiple of 8 ever appears: those are the parity bits.",
            "Work row by row (7 bits per row) and copy each named key bit. After two correct rows you can type a whole row.",
        ],
        tips={"out": "Copy the key bit named in each cell. Parity bits (8, 16, …, 64) are never used."},
        success="Correct! PC-1 dropped the parity bits and rearranged the other 56.",
        reveal={"pc1": ks["pc1"]},
    )


def r2_split(p, ctx, mode):
    ks = ctx["ks"]
    return Puzzle(
        id="r2_split", title="Split the key: C0 and D0",
        nova="The 56-bit PC-1 output splits into two 28-bit halves, C0 and D0. Each half rotates independently.",
        task="Enter C0 and D0 (7 hex digits each, or 28 bits).",
        view={"kind": "keysplit", "pc1": ks["pc1"]},
        fields=[hexf("c0", "C0 (first 28 bits)", 7), hexf("d0", "D0 (last 28 bits)", 7)],
        answer={"c0": ks["c0"]["hex"], "d0": ks["d0"]["hex"]},
        hints=[
            "56 / 2 = 28 bits. 28 bits = 7 hex digits.",
            "Example: if PC-1 gave F0CCAA0 + 556678F (14 hex digits) then C0 = F0CCAA0, D0 = 556678F.",
            "PC-1 is 14 hex digits; split them 7 + 7. You may also type the 28 bits of each half.",
        ],
        success="Right! C0 and D0 are loaded onto the vault's two rotating disks.",
        reveal={"c0": ks["c0"], "d0": ks["d0"]},
    )


SHIFT_STEPS = 4


def shift_rounds(p):
    """The consecutive rounds whose rotations the player performs (ending at shift_round)."""
    end = p["r2"]["shift_round"]
    return list(range(max(1, end - SHIFT_STEPS + 1), end + 1))


def r2_shift(p, ctx, mode):
    ks = ctx["ks"]
    rounds = shift_rounds(p)
    first, last = rounds[0], rounds[-1]
    start = ks["rounds"][first - 1]
    fields, answer = [], {}
    for r in rounds:
        info = ks["rounds"][r - 1]
        fields += [binf(f"c{r}", f"C{r} (28 bits)", 28), binf(f"d{r}", f"D{r} (28 bits)", 28)]
        answer[f"c{r}"], answer[f"d{r}"] = info["c"]["bin"], info["d"]["bin"]
    plan = " + ".join(str(T.SHIFTS[r - 1]) for r in rounds)
    return Puzzle(
        id="r2_shift", title="Rotate the key disks",
        nova=("Every round, C and D rotate LEFT. Bits pushed off the left end re-enter on the right. "
              "Rounds 1, 2, 9 and 16 rotate by 1; all others rotate by 2."),
        task=f"Rounds {first}–{last}: starting from C{first - 1} and D{first - 1}, rotate the disks round by round "
             f"and record C and D after each round.",
        view={"kind": "shift", "rounds": rounds, "round": last, "c_prev": start["c_prev"], "d_prev": start["d_prev"],
              "schedule": T.SHIFTS},
        fields=fields,
        answer=answer,
        hints=[
            f"Look up rounds {first} to {last} in the shift schedule. Each round continues from the previous round's C and D.",
            "Example: rotating 1011000 left by 1 gives 0110001; by 2 gives 1100010.",
            f"The shifts for rounds {first}–{last} are {plan}. For each round, press Rotate on both disks that many "
            "times, then press Record round.",
        ],
        success=(f"Correct! Rounds {first}–{last} rotated by {plan} = "
                 f"{sum(T.SHIFTS[r - 1] for r in rounds)} places in total; the leading bits wrapped around to the end."),
        reveal={"c": ks["rounds"][last - 1]["c"], "d": ks["rounds"][last - 1]["d"], "round": last,
                "rounds": rounds},
    )


def r2_pc2(p, ctx, mode):
    ks = ctx["ks"]
    rnd = p["r2"]["shift_round"]
    info = ks["rounds"][rnd - 1]
    return Puzzle(
        id="r2_pc2", title="Activate PC-2",
        nova=("PC-2 picks 48 of the 56 bits of C‖D and rearranges them. 48 bits are needed because "
              "the round function expands the 32-bit half to 48 bits before XOR-ing it with the key."),
        task=f"Perform PC-2 on C{rnd}‖D{rnd}: fill all 48 bits of round key K{rnd}.",
        view={"kind": "pc2", "round": rnd, "input": info["cd"]["bin"], "table": T.PC2},
        fields=[binf("out", f"K{rnd} (48 bits)", 48)],
        answer={"out": info["subkey"]["bin"]},
        hints=[
            "PC-2 has 48 entries (8 rows of 6). Each output cell shows which bit of C‖D to copy.",
            "Example: PC-2 starts 14, 17, 11… so key bit 1 = C‖D bit 14. Bits 9, 18, 22, 25, 35, 38, 43 and 54 are never used.",
            "Work row by row (6 bits per row). After two correct rows you can type a whole row.",
        ],
        tips={"out": "Copy the C‖D bit named in each cell."},
        success=f"Correct! You generated round key K{rnd} = {info['subkey']['hex']}.",
        reveal={"subkey": info["subkey"], "round": rnd},
    )


def r2_cycle(p, ctx, mode):
    ks = ctx["ks"]
    texts_same = ["Yes, C16 equals C0 and D16 equals D0", "No, they are different"]
    return Puzzle(
        id="r2_cycle", title="Run the full key machine",
        nova="Now run the machine for all 16 rounds. Explore any round in the key explorer, then answer the vault's final check.",
        task="Use the explorer: how many positions have the disks rotated in total after round 16, and is C16 back to C0?",
        view={"kind": "keyexplorer", "schedule": ks},
        fields=[intf("total", "Total rotation after 16 rounds"),
                choicef("same", "Compare C16 with C0", list(enumerate(texts_same)))],
        answer={"total": "28", "same": "0"},
        hints=[
            "Add up the shift schedule 1,1,2,2,2,2,2,2,1,2,2,2,2,2,2,1.",
            "Example: after round 3 the total is 1+1+2 = 4. The explorer shows the running total for every round.",
            "The sum is the length of each half. Rotating a 28-bit value by 28 positions brings it back to the start, compare the values in rounds 0 and 16.",
        ],
        tips={"total": "Sum the 16 shift amounts."},
        success="Excellent. DES now has the sixteen round keys required for its Feistel network.",
        reveal={"subkeys": [r["subkey"]["hex"] for r in ks["rounds"]]},
    )


# ---------------------------------------------------------------------------
# ROOM 3, The Round Reactor
# ---------------------------------------------------------------------------

def _round(p, ctx):
    return ctx["enc"]["rounds"][p["r3"]["round"] - 1]


def r3_expand(p, ctx, mode):
    rd = _round(p, ctx)
    return Puzzle(
        id="r3_expand", title="Module 1, Expansion E",
        nova=("The F-function starts by expanding the 32-bit right half to 48 bits. E copies the edge "
              "bits of each 4-bit group into neighbouring groups, so 16 bits appear twice."),
        task=f"Round {rd['round']}: perform the expansion E(R{rd['round'] - 1}): fill all 48 output bits.",
        view={"kind": "expand", "round": rd["round"], "input": rd["r_in"]["bin"], "table": T.E},
        fields=[binf("out", f"E(R{rd['round'] - 1}) (48 bits)", 48)],
        answer={"out": rd["expanded"]["bin"]},
        hints=[
            "E output position k takes bit E[k] of the 32-bit R. Each output cell shows which R bit to copy.",
            "Example: E starts 32, 1, 2, 3, 4, 5 → output bit 1 is R's LAST bit (32); each row of 6 repeats the edge bits of its neighbours.",
            "Work row by row (6 bits per row). After two correct rows you can type a whole row.",
        ],
        tips={"out": "Copy the R bit named in each cell; some R bits are used twice."},
        success="Correct! E turned 32 bits into 48, ready to be mixed with the 48-bit round key.",
        reveal={"expanded": rd["expanded"]},
    )


def r3_xor(p, ctx, mode):
    rd = _round(p, ctx)
    g = p["r3"]["group"]
    return Puzzle(
        id="r3_xor", title="Module 2, XOR with the round key",
        nova="Next, E(R) is XOR-ed with the round key. XOR gives 1 when the bits DIFFER and 0 when they are the same.",
        task=f"Complete the XOR circuit for bits {6 * g + 1}–{6 * g + 6} (the input to S-box S{g + 1}).",
        view={"kind": "xor", "round": rd["round"], "expanded": rd["expanded"], "subkey": rd["subkey"],
              "key_index": rd["key_index"], "group": g},
        fields=[binf("x", f"E(R) ⊕ K{rd['key_index']}, bits {6 * g + 1}–{6 * g + 6}", 6)],
        answer={"x": rd["xor"]["bin"][6 * g:6 * g + 6]},
        hints=[
            "Truth table: 0⊕0=0, 0⊕1=1, 1⊕0=1, 1⊕1=0.",
            "Example: 110010 ⊕ 011011 = 101001.",
            f"Line up E(R) bits {6 * g + 1}–{6 * g + 6} above the key bits {6 * g + 1}–{6 * g + 6} and XOR each column.",
        ],
        tips={"x": "Not quite. Remember that XOR returns 1 when the bits differ."},
        success="The circuit lights up! Here is the full 48-bit XOR result, split into 8 groups of 6.",
        reveal={"xor": rd["xor"]},
    )


def _sbox_puzzle(pid, title, p, ctx, g, optional_note=""):
    rd = _round(p, ctx)
    s = rd["sboxes"][g]
    return Puzzle(
        id=pid, title=title,
        nova=("Each S-box turns 6 bits into 4. The FIRST and LAST bits form the row (0–3); the MIDDLE "
              "four bits form the column (0–15). The cell gives a number 0–15, written as 4 bits." + optional_note),
        task=f"S-box S{g + 1} receives {s['input']}. Find its row, column and 4-bit output.",
        view={"kind": "sbox", "round": rd["round"], "box": g + 1, "input": s["input"], "table": T.SBOXES[g]},
        fields=[intf("row", "Row (0–3)"), intf("col", "Column (0–15)"), binf("out", "Output (4 bits)", 4)],
        answer={"row": str(s["row"]), "col": str(s["col"]), "out": s["output"]},
        hints=[
            "Row = bits 1 and 6 read as a 2-bit number. Column = bits 2–5 read as a 4-bit number.",
            "Example (S1): input 011011 → row bits 0,1 = 01 = 1; column 1101 = 13; S1[1][13] = 5 → 0101.",
            f"Your input is {s['input']}: the row bits are '{s['input'][0]}' and '{s['input'][5]}', "
            f"the column bits are '{s['input'][1:5]}'. Convert both to decimal, click that cell, and write the number in 4 bits.",
        ],
        tips={"row": "Row uses the first and last bits only.", "col": "Column uses the middle four bits.",
              "out": "Write the cell value as exactly 4 bits (e.g. 5 → 0101)."},
        success=f"Correct! S{g + 1}[{s['row']}][{s['col']}] = {s['value']} = {s['output']}.",
        reveal={"sbox": s},
    )


def r3_sbox(p, ctx, mode):
    return _sbox_puzzle("r3_sbox", "Module 3, S-box substitution", p, ctx, p["r3"]["group"])


def r3_sbox_bonus(p, ctx, mode):
    return _sbox_puzzle("r3_sbox_bonus", "Bonus, A second S-box", p, ctx, p["r3"]["bonus_group"],
                        " This bonus challenge is optional; solve it with no mistakes for the S-box Specialist badge.")


def r3_perm(p, ctx, mode):
    rd = _round(p, ctx)
    return Puzzle(
        id="r3_perm", title="Module 4, Permutation P",
        nova="The eight 4-bit S-box outputs form 32 bits. P scatters them so each S-box influences several S-boxes in the next round.",
        task="Perform the permutation P: fill all 32 output bits from the S-box outputs.",
        view={"kind": "perm", "round": rd["round"], "input": rd["s_output"]["bin"], "sboxes": rd["sboxes"],
              "table": T.P},
        fields=[binf("out", "P output (32 bits)", 32)],
        answer={"out": rd["p_output"]["bin"]},
        hints=[
            "P has 32 entries in 4 rows of 8. Each output cell shows which S-output bit to copy.",
            "Example: P starts 16, 7, 20 → output bit 1 is S-output bit 16; output bit 3 is S-output bit 20.",
            "Work row by row. After two correct rows you can type a whole row at once.",
        ],
        tips={"out": "Copy the S-output bit named in each cell."},
        success="Correct! The P output is F(R, K), the result of the round function.",
        reveal={"p_output": rd["p_output"], "f_output": rd["f_output"]},
    )


def r3_feistel(p, ctx, mode):
    rd = _round(p, ctx)
    i = rd["round"]
    ki = rd["key_index"]
    extra = (f" This is decryption round {i}, so it uses K{ki} (decryption runs the keys backwards)." if is_dec(ctx) else "")
    return Puzzle(
        id="r3_feistel", title="Module 5, Feistel update",
        nova=f"Now the Feistel rule: L{i} = R{i - 1}, and R{i} = L{i - 1} ⊕ F(R{i - 1}, K{ki}).{extra}",
        task=f"Compute L{i} and R{i} in hex.",
        view={"kind": "feistel", "round": i, "key_index": ki, "direction": ctx["dir"],
              "l": rd["l_in"], "r": rd["r_in"], "f": rd["f_output"]},
        fields=[hexf("l", f"L{i}", 8), hexf("r", f"R{i}", 8)],
        answer={"l": rd["l_out"]["hex"], "r": rd["r_out"]["hex"]},
        hints=[
            "The new left half is simply the old right half. The new right half needs one XOR.",
            "Example: L=1234ABCD, F=0F0F0F0F → L⊕F = 1D3BA4C2 (XOR each hex digit through its 4 bits).",
            f"L{i} = R{i - 1} copied. For R{i}, XOR L{i - 1} and F digit by digit (the binary rows help).",
        ],
        tips={"l": f"L{i} is just a copy of R{i - 1}.", "r": "XOR the OLD left half with F."},
        success="You have successfully completed the Feistel update.",
        reveal={"l": rd["l_out"], "r": rd["r_out"]},
    )


def r3_swap(p, ctx, mode):
    enc = ctx["enc"]
    last = enc["rounds"][-1]
    texts = [f"R16‖L16 = {last['r_out']['hex']}{last['l_out']['hex']} (swap the halves)",
             f"L16‖R16 = {last['l_out']['hex']}{last['r_out']['hex']} (keep the order)"]
    opts, correct = ordered(texts, p["r3"]["swap_options"])
    dec = is_dec(ctx)
    result = "plaintext" if dec else "ciphertext"
    return Puzzle(
        id="r3_swap", title="Ignite the reactor, all 16 rounds",
        nova=(f"Three steps: run all 16 {'decryption ' if dec else ''}rounds{' (keys K16 down to K1)' if dec else ''}, "
              f"do the final swap, then IP⁻¹ turns the block into the {result}."),
        task="Run all 16 rounds, then choose the block that goes into IP⁻¹.",
        view={"kind": "fullrun", "direction": ctx["dir"],
              "trace": {k: enc[k] for k in ("input", "ip", "l0", "r0", "rounds", "key")}},
        fields=[choicef("choice", "Pre-output block", opts)],
        answer={"choice": correct},
        hints=[
            "Decryption must be able to reuse the same structure; this is why the halves are swapped at the end.",
            "Example: if L16 = AAAAAAAA and R16 = BBBBBBBB, the pre-output is BBBBBBBBAAAAAAAA.",
            f"The pre-output places R16 first, then L16. Then IP⁻¹ gives the {result}.",
        ],
        success=f"Reactor online! {result.capitalize()} = {enc['output']['hex']}.",
        reveal={"preoutput": enc["preoutput"], "output": enc["output"]},
    )


# ---------------------------------------------------------------------------
# ROOM 4, The Exit Chamber
# ---------------------------------------------------------------------------

def r4_order(p, ctx, mode):
    ks = ctx["ks"]
    chips = [{"k": i, "hex": ks["rounds"][i - 1]["subkey"]["hex"]} for i in p["r4"]["order_shuffle"]]
    if is_dec(ctx):
        return Puzzle(
            id="r4_order", title="Load the encryption keys",
            nova=("You decrypted with the keys backwards (K16 first). To PROVE the message is right, we encrypt it "
                  "again: encryption uses the same 16 subkeys in the normal order, K1 first."),
            task="Put the round keys in the order the encryption rounds use them.",
            view={"kind": "order", "direction": "encrypt", "chips": chips, "cipher": ctx["cipher_in"], "key": ks["key"]},
            fields=[{"name": "order", "label": "Key order (e.g. 3,1,2…)", "kind": "order"}],
            answer={"order": ",".join(str(i) for i in range(1, 17))},
            hints=[
                "Encryption round 1 uses the first round key the key schedule made.",
                "With a 3-round toy Feistel cipher, encryption uses K1, K2, K3 and decryption K3, K2, K1.",
                "Start with K1 and finish with K16.",
            ],
            success="Correct: K1, K2, …, K16. The same keys you decrypted with, in the opposite order.",
            reveal={"order": list(range(1, 17))},
        )
    return Puzzle(
        id="r4_order", title="Load the decryption keys",
        nova=("Decryption uses the SAME Feistel structure and the SAME 16 subkeys, applied in REVERSE "
              "order. No new keys are generated."),
        task="Click the round keys in the order the decryption rounds use them.",
        view={"kind": "order", "direction": "decrypt", "chips": chips, "cipher": ctx["cipher_exit"], "key": ctx["ks"]["key"]},
        fields=[{"name": "order", "label": "Key order (e.g. 3,1,2…)", "kind": "order"}],
        answer={"order": ",".join(str(i) for i in range(16, 0, -1))},
        hints=[
            "Decryption round 1 must undo encryption round 16.",
            "With a 3-round toy Feistel cipher using K1,K2,K3, decryption uses K3, K2, K1.",
            "Start with the key used last during encryption and finish with K1.",
        ],
        success="Correct: K16, K15, …, K1. Same keys, reversed order.",
        reveal={"order": list(range(16, 0, -1))},
    )


def r4_round(p, ctx, mode):
    dec = ctx["r4"]
    j = p["r4"]["round"]
    rd = dec["rounds"][j - 1]
    if is_dec(ctx):
        return Puzzle(
            id="r4_round", title="Run an encryption round",
            nova="To check the message, NOVA encrypts it again. An encryption round is the same Feistel round; round j simply uses Kj.",
            task=f"Encryption round {j}: which subkey is used, and what are the new halves?",
            view={"kind": "decround", "direction": "encrypt", "round": j, "l": rd["l_in"], "r": rd["r_in"], "f": rd["f_output"]},
            fields=[intf("key", f"Subkey number used in encryption round {j}"),
                    hexf("l", f"New left half after round {j}", 8), hexf("r", f"New right half after round {j}", 8)],
            answer={"key": str(rd["key_index"]), "l": rd["l_out"]["hex"], "r": rd["r_out"]["hex"]},
            hints=[
                "Encryption round j uses Kj. The Feistel update: new L = old R; new R = old L ⊕ F.",
                "Example: encryption round 3 uses K3 (decryption round 3 would use K14).",
                f"Round {j} uses K{j}. Copy the right half into the left, then XOR the left half with F.",
            ],
            tips={"key": "Encryption round j uses key j."},
            success=f"Correct! All 16 encryption rounds give back the intercepted ciphertext {ctx['cipher_in']}: your decryption was right.",
            reveal={"trace": {k: dec[k] for k in ("input", "ip", "l0", "r0", "rounds", "preoutput", "output")}},
        )
    return Puzzle(
        id="r4_round", title="Run a decryption round",
        nova="A decryption round looks exactly like an encryption round. Only the key index changes.",
        task=f"Decryption round {j}: which subkey is used, and what are the new halves?",
        view={"kind": "decround", "direction": "decrypt", "round": j, "l": rd["l_in"], "r": rd["r_in"], "f": rd["f_output"]},
        fields=[intf("key", f"Subkey number used in decryption round {j}"),
                hexf("l", f"New left half after round {j}", 8), hexf("r", f"New right half after round {j}", 8)],
        answer={"key": str(rd["key_index"]), "l": rd["l_out"]["hex"], "r": rd["r_out"]["hex"]},
        hints=[
            "Decryption round j uses K(17 − j). The Feistel update is unchanged: new L = old R; new R = old L ⊕ F.",
            "Example: decryption round 3 uses K14.",
            f"Round {j} uses K{17 - j}. Copy the right half into the left, then XOR the left half with F.",
        ],
        tips={"key": "Decryption round j uses key 17 − j."},
        success="Correct! The chamber processes all 16 decryption rounds…",
        reveal={"trace": {k: dec[k] for k in ("input", "ip", "l0", "r0", "rounds", "preoutput", "output")}},
    )


def r4_code(p, ctx, mode):
    dec = ctx["r4_plain"]
    out = dec["output"]["hex"]
    secret = is_dec(ctx)
    return Puzzle(
        id="r4_code", title="Read the secret message" if secret else "Recover the exit code",
        nova=("Your 16 decryption rounds in the Reactor produced 64 bits of plaintext. Turn those 8 bytes into "
              "readable characters: that is the secret message, and it opens the exit."
              if secret else
              "The 16 decryption rounds produced 64 bits of plaintext. Turn those 8 bytes back into readable characters."),
        task=("Enter the 8-character message hidden in the decrypted block." if secret
              else "Enter the 8-character exit code hidden in the decrypted block."),
        view={"kind": "recover", "direction": ctx["dir"], "cipher": ctx["r4_cipher"], "plain": dec["output"],
              "trace": {k: dec[k] for k in ("input", "ip", "l0", "r0", "rounds", "preoutput", "output")}},
        fields=[{"name": "code", "label": "Exit code (8 characters)", "kind": "text"}],
        answer={"code": hex_to_ascii(out)},
        hints=[
            "Split the 16 hex digits into 8 pairs. Each pair is one character.",
            "Example: 41 = 65 = 'A', 30 = 48 = '0', 5A = 90 = 'Z'.",
            f"The first pair is {out[:2]} = {int(out[:2], 16)} in decimal. Use the character-code table for each pair.",
        ],
        tips={"code": "Convert each hex pair to its character; capitals matter."},
        success="The exit console accepts the code!",
        reveal={"plain": dec["output"]},
    )


VERDICT_QUESTIONS = [
    ("How many bits of a DES key provide cryptographic strength?",
     ["56 bits", "64 bits", "128 bits", "48 bits"]),
    ("Why is DES considered insecure today?",
     ["Its 56-bit key space can be searched exhaustively with modern hardware",
      "Its S-boxes are secret and unknown",
      "It cannot be decrypted correctly",
      "It uses too many rounds"]),
    ("What is DES's status today?",
     ["Obsolete: withdrawn as a standard and replaced (e.g. by AES)",
      "Recommended for new hospital systems",
      "Mandatory for modern web traffic",
      "Secure as long as the key is secret"]),
    ("Avalanche effect: you flip ONE bit of the message and encrypt again with the same key. What happens?",
     ["About half of the 64 ciphertext bits change",
      "Exactly one ciphertext bit changes",
      "Nothing changes",
      "Only the last byte changes"]),
    ("Birthday attack: DES has a 64-bit block. Roughly how many blocks under one key until repeated ciphertext blocks become likely?",
     ["About 2^32 blocks (≈ 32 GB), the Sweet32 problem",
      "About 2^64 blocks, so it never happens in practice",
      "About 2^56 blocks, the same as the key size",
      "Never: DES blocks cannot repeat"]),
    ("You must protect real sensitive data. What should you choose?",
     ["A current standard such as AES-GCM or ChaCha20-Poly1305 (authenticated encryption)",
      "DES, since you now understand it well",
      "DES applied twice with the same key",
      "Your own homemade cipher"]),
]


def r4_verdict(p, ctx, mode):
    fields = []
    for i, (q, texts) in enumerate(VERDICT_QUESTIONS):
        orders = p["r4"]["verdict_options"]
        opts, _ = ordered(texts, orders[i] if i < len(orders) else [0, 1, 2, 3])
        fields.append(choicef(f"q{i}", q, opts))
    return Puzzle(
        id="r4_verdict", title="The security verdict",
        nova=("You have successfully used DES. Does this mean DES is safe for protecting modern sensitive "
              "information?"),
        task="Answer NOVA's six security questions to open the exit.",
        view={"kind": "verdict"},
        fields=fields,
        answer={f"q{i}": "0" for i in range(len(VERDICT_QUESTIONS))},
        hints=[
            "Think about the effective key length you found in the Key Vault.",
            "2^56 ≈ 7.2 × 10^16 keys, cracked in under a day back in 1999. Avalanche: one changed bit should change about half the output bits. Birthday bound: an n-bit block repeats after about 2^(n/2) blocks.",
            "Understanding an algorithm is not the same as it being secure: modern systems use current, vetted, authenticated encryption.",
        ],
        success="Exactly. A functioning algorithm is not necessarily a secure algorithm.",
        reveal={},
    )


BUILDERS = {
    "r1_ascii": r1_ascii, "r1_block": r1_block, "r1_ip_bit": r1_ip_bit, "r1_split": r1_split,
    "r2_parity": r2_parity, "r2_pc1_bit": r2_pc1_bit, "r2_split": r2_split, "r2_shift": r2_shift,
    "r2_pc2": r2_pc2, "r2_cycle": r2_cycle,
    "r3_expand": r3_expand, "r3_xor": r3_xor, "r3_sbox": r3_sbox, "r3_sbox_bonus": r3_sbox_bonus,
    "r3_perm": r3_perm, "r3_feistel": r3_feistel, "r3_swap": r3_swap,
    "r4_order": r4_order, "r4_round": r4_round, "r4_code": r4_code, "r4_verdict": r4_verdict,
}

PUZZLE_META = {
    "r1_ascii": {"objective": "LO1", "optional": False, "concepts": ["overview", "sizes", "hex"]},
    "r1_block": {"objective": "LO1", "optional": False, "concepts": ["sizes", "hex"]},
    "r1_ip_bit": {"objective": "LO1", "optional": False, "concepts": ["ip"]},
    "r1_split": {"objective": "LO4", "optional": False, "concepts": ["ip", "feistel"]},
    "r2_parity": {"objective": "LO2", "optional": False, "concepts": ["sizes", "keys"]},
    "r2_pc1_bit": {"objective": "LO3", "optional": False, "concepts": ["keys"]},
    "r2_split": {"objective": "LO3", "optional": False, "concepts": ["keys"]},
    "r2_shift": {"objective": "LO3", "optional": False, "concepts": ["shifts"]},
    "r2_pc2": {"objective": "LO3", "optional": False, "concepts": ["keys"]},
    "r2_cycle": {"objective": "LO3", "optional": False, "concepts": ["shifts"]},
    "r3_expand": {"objective": "LO4", "optional": False, "concepts": ["feistel", "expansion"]},
    "r3_xor": {"objective": "LO4", "optional": False, "concepts": ["xor"]},
    "r3_sbox": {"objective": "LO5", "optional": False, "concepts": ["sbox"]},
    "r3_sbox_bonus": {"objective": "LO5", "optional": True, "concepts": ["sbox"]},
    "r3_perm": {"objective": "LO4", "optional": False, "concepts": ["pperm"]},
    "r3_feistel": {"objective": "LO4", "optional": False, "concepts": ["feistel"]},
    "r3_swap": {"objective": "LO4", "optional": False, "concepts": ["encryption"]},
    "r4_order": {"objective": "LO6", "optional": False, "concepts": ["decryption"]},
    "r4_round": {"objective": "LO6", "optional": False, "concepts": ["decryption"]},
    "r4_code": {"objective": "LO6", "optional": False, "concepts": ["decryption", "hex"]},
    "r4_verdict": {"objective": "LO7", "optional": False, "concepts": ["security"]},
}

assert set(BUILDERS) == set(PUZZLE_META) == {p for r in ROOMS.values() for p in r["puzzles"]}


def build(params, pid, mode="guided"):
    if pid not in BUILDERS:
        raise KeyError(pid)
    return BUILDERS[pid](params, context(params), mode)


def check(puzzle, submitted):
    """Return (correct, errors, field_results, feedback).

    ``errors`` lists format problems (the attempt is NOT counted as a mistake);
    ``field_results`` maps field -> True/False for well-formed answers.
    """
    submitted = submitted or {}
    normalized, errors = {}, []
    for spec in puzzle.fields:
        try:
            normalized[spec["name"]] = normalize(spec, submitted.get(spec["name"]))
        except FormatError as exc:
            errors.append(str(exc))
    if errors:
        return False, errors, {}, "Check the format first: " + " ".join(errors)
    results = {name: normalized[name] == str(puzzle.answer[name]) for name in puzzle.answer}
    if all(results.values()):
        return True, [], results, puzzle.success
    wrong = [n for n, ok in results.items() if not ok]
    feedback = _diagnose(puzzle, normalized, wrong)
    return False, [], results, feedback


def _diagnose(puzzle, given, wrong):
    """Targeted NOVA feedback for common mistakes."""
    pid = puzzle.id
    if pid == "r2_shift":
        view = puzzle.view
        c_prev = view["c_prev"]["bin"]
        for rnd in view["rounds"]:
            need = T.SHIFTS[rnd - 1]
            g = given.get(f"c{rnd}")
            if g != puzzle.answer[f"c{rnd}"] or given.get(f"d{rnd}") != puzzle.answer[f"d{rnd}"]:
                for amount in (0, 1, 2, 3):
                    if g == rotate_left(c_prev, amount) and amount != need:
                        return f"Round {rnd} is off: you rotated by {amount}, but round {rnd} needs a shift of {need}."
                if g == rotate_left(c_prev, -need):
                    return f"Round {rnd}: careful, DES rotates LEFT. Bits leaving the left end re-enter on the right."
                return f"Rounds before {rnd} are right; re-check round {rnd} (shift {need}, starting from the previous round's C and D)."
            c_prev = puzzle.answer[f"c{rnd}"]
    if pid == "r1_ascii":
        g, a = given.get("hex", ""), puzzle.answer["hex"]
        for i in range(8):
            if g[2 * i:2 * i + 2] != a[2 * i:2 * i + 2]:
                if puzzle.view.get("direction") == "decrypt":
                    return f"Not quite. Bytes before #{i + 1} are right; re-check byte #{i + 1} ({puzzle.view['chars'][i]['dec']})."
                return f"Not quite. Characters before #{i + 1} are right; re-check character #{i + 1} ('{puzzle.view['code'][i]}')."
    if pid in ("r3_sbox", "r3_sbox_bonus") and given.get("row") == puzzle.answer["row"] \
            and given.get("col") == puzzle.answer["col"]:
        return "Row and column are right! Now read the cell value and write it as 4 bits."
    if pid == "r4_order":
        order = given.get("order", "")
        if order == ",".join(str(i) for i in range(16, 0, -1)) and puzzle.view.get("direction") == "encrypt":
            return "That's the decryption order. Encryption starts with K1, the first key the schedule made."
        if order == ",".join(str(i) for i in range(1, 17)) and puzzle.view.get("direction") != "encrypt":
            return "That's the encryption order. Decryption must undo the LAST round first."
        if len(order.split(",")) != 16:
            return "Use all 16 round keys exactly once."
    if pid == "r4_code" and given.get("code", "").upper() == puzzle.answer["code"].upper():
        return "So close! Capitals and lowercase letters have different hex values; check the case."
    if pid in ("r1_ip_bit", "r2_pc1_bit", "r2_pc2", "r3_expand", "r3_perm"):
        g, a = given.get("out", ""), puzzle.answer["out"]
        bad = [i + 1 for i in range(len(a)) if i >= len(g) or g[i] != a[i]]
        if bad:
            return (f"Not quite: {len(bad)} bit(s) are wrong, the first at output position {bad[0]}. "
                    f"Check which bit cell {bad[0]} should copy.")
    tips = [puzzle.tips[n] for n in wrong if n in puzzle.tips]
    labels = [f["label"] for f in puzzle.fields if f["name"] in wrong]
    msg = "Not quite. Check: " + "; ".join(labels) + "."
    if tips:
        msg += " " + " ".join(tips)
    return msg
