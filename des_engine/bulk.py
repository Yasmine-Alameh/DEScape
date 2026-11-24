"""
Fast DES for whole messages and files (used by the DES Lab "any text or file" tool).

The traced engine in core.py works on bit strings so that every step can be shown;
that is ideal for one block but slow for a file. This module computes exactly the same
DES with integers and lookup tables (the usual "SP-box" technique), then adds what is
needed to encrypt more than one 64-bit block:

* PKCS#7 padding: the message is filled up to a multiple of 8 bytes. If n bytes are
  missing, n bytes with value n are added (a full block of 08s when nothing is missing),
  so the padding can always be removed again after decryption.
* Modes of operation:
    - ECB (Electronic Code Book): every block is encrypted on its own. Equal plaintext
      blocks give equal ciphertext blocks, which leaks patterns.
    - CBC (Cipher Block Chaining): each plaintext block is XOR-ed with the previous
      ciphertext block before encryption; the first block uses a random IV. Here the IV is
      stored as the first 8 bytes of the output so decryption can find it.

The results are checked against core.py in the test-suite.
"""
from __future__ import annotations

import hashlib
import os

from . import tables as T
from .core import DESInputError, key_schedule, validate_hex64

MAX_BYTES = 1024 * 1024  # 1 MB per request keeps the lab responsive

WEAK_KEYS = {
    "0101010101010101", "FEFEFEFEFEFEFEFE", "E0E0E0E0F1F1F1F1", "1F1F1F1F0E0E0E0E",
}
SEMI_WEAK_KEYS = {
    "011F011F010E010E", "1F011F010E010E01", "01E001E001F101F1", "E001E001F101F101",
    "01FE01FE01FE01FE", "FE01FE01FE01FE01", "1FE01FE00EF10EF1", "E01FE01FF10EF10E",
    "1FFE1FFE0EFE0EFE", "FE1FFE1FFE0EFE0E", "E0FEE0FEF1FEF1FE", "FEE0FEE0FEF1FEF1",
}


def _byte_tables(table, in_bits):
    out_bits = len(table)
    tbls = [[0] * 256 for _ in range(in_bits // 8)]
    for out_i, src in enumerate(table):
        s = src - 1
        byte, shift = s // 8, 7 - s % 8
        mask = 1 << (out_bits - 1 - out_i)
        t = tbls[byte]
        for v in range(256):
            if (v >> shift) & 1:
                t[v] |= mask
    return tbls


def _apply(tbls, x, in_bits):
    r = 0
    shift = in_bits - 8
    for t in tbls:
        r |= t[(x >> shift) & 0xFF]
        shift -= 8
    return r


_IP = _byte_tables(T.IP, 64)
_IP_INV = _byte_tables(T.IP_INV, 64)
_E = _byte_tables(T.E, 32)
_P = _byte_tables(T.P, 32)
_SP = []
for _i, _box in enumerate(T.SBOXES):
    row = []
    for six in range(64):
        r, c = ((six >> 4) & 2) | (six & 1), (six >> 1) & 0xF
        row.append(_apply(_P, _box[r][c] << (28 - 4 * _i), 32))
    _SP.append(row)


def subkeys_int(key_hex):
    keys, _ = key_schedule(validate_hex64(key_hex, "key"))
    return [int(k, 2) for k in keys]


def _block(x, ks):
    x = _apply(_IP, x, 64)
    left, right = x >> 32, x & 0xFFFFFFFF
    for k in ks:
        e = _apply(_E, right, 32) ^ k
        f = 0
        shift = 42
        for sp in _SP:
            f |= sp[(e >> shift) & 63]
            shift -= 6
        left, right = right, left ^ f
    return _apply(_IP_INV, (right << 32) | left, 64)


def encrypt_block(block_hex, key_hex):
    return format(_block(int(validate_hex64(block_hex, "block"), 16), subkeys_int(key_hex)), "016X")


def decrypt_block(block_hex, key_hex):
    return format(_block(int(validate_hex64(block_hex, "block"), 16), subkeys_int(key_hex)[::-1]), "016X")


def pkcs7_pad(data: bytes) -> bytes:
    n = 8 - len(data) % 8
    return data + bytes([n]) * n


def pkcs7_unpad(data: bytes) -> bytes:
    if not data or len(data) % 8:
        raise DESInputError("The decrypted data is not a whole number of blocks, so it has no valid padding.")
    n = data[-1]
    if not 1 <= n <= 8 or data[-n:] != bytes([n]) * n:
        raise DESInputError(
            "The padding check failed after decryption. This almost always means the key (or the mode) "
            "is not the one used for encryption, or the data was not encrypted with PKCS#7 padding.")
    return data[:-n]


def _no_parity(key_hex):
    """The key with its 8 parity bits cleared: keys that differ only in parity are the same DES key."""
    return bytes(b & 0xFE for b in bytes.fromhex(key_hex)).hex().upper()


def key_warnings(key_hex):
    key = validate_hex64(key_hex, "key")
    notes = []
    norm = _no_parity(key)
    if norm in {_no_parity(k) for k in WEAK_KEYS}:
        notes.append("This is a DES WEAK key: all 16 round keys are identical, so encrypting twice gives back the original. Never use it.")
    elif norm in {_no_parity(k) for k in SEMI_WEAK_KEYS}:
        notes.append("This is a DES SEMI-WEAK key: it has a partner key that decrypts what it encrypts. Avoid it.")
    bad = [i + 1 for i in range(8) if bin(int(key[2 * i:2 * i + 2], 16)).count("1") % 2 == 0]
    if bad:
        notes.append(f"Parity bits are not odd in byte(s) {', '.join(map(str, bad))}. That's fine for this lab: "
                     "DES ignores the parity bits (8, 16, …, 64), so only 56 bits matter.")
    return notes


def key_from_password(password: str):
    """Turn a password into a 64-bit DES key and explain each step.

    1. the password's characters → bytes (UTF-8);
    2. SHA-256 of those bytes (a hash: same password → same 32 bytes, tiny change → totally different);
    3. keep the first 8 bytes = 64 bits;
    4. fix the parity bit of each byte (bit 8, 16, …, 64) so every byte has an odd number of 1s.
    Real systems use slow, salted derivations such as PBKDF2 or Argon2; this is a teaching version.
    """
    if password is None or password == "":
        raise DESInputError("Type a password first.")
    raw = password.encode("utf-8")
    digest = hashlib.sha256(raw).digest()
    first8 = digest[:8]
    fixed = bytes((b & 0xFE) | (0 if bin(b >> 1).count("1") % 2 else 1) for b in first8)
    return {"password_bytes": raw.hex().upper(), "sha256": digest.hex().upper(),
            "first8": first8.hex().upper(), "key": fixed.hex().upper()}


def random_key():
    while True:
        b = bytes((x & 0xFE) | (0 if bin(x >> 1).count("1") % 2 else 1) for x in os.urandom(8))
        k = b.hex().upper()
        if not any(_no_parity(k) == _no_parity(w) for w in WEAK_KEYS | SEMI_WEAK_KEYS):
            return k


def crypt(data: bytes, key_hex: str, decrypt=False, mode="ECB", padding=True, iv_hex=None, keep=16):
    """Encrypt or decrypt ``data``. Returns (output_bytes, info). ``info["blocks"]`` describes the
    first ``keep`` blocks (input, value that entered DES, DES output, result) for the lab view."""
    mode = (mode or "ECB").upper()
    if mode not in ("ECB", "CBC"):
        raise DESInputError("Choose the ECB or CBC mode.")
    if len(data) > MAX_BYTES:
        raise DESInputError(f"That is {len(data):,} bytes. The lab accepts up to {MAX_BYTES // 1024} KB at a time.")
    ks = subkeys_int(key_hex)
    if decrypt:
        ks = ks[::-1]
    blocks_info = []
    iv = None
    if not decrypt:
        if padding:
            data = pkcs7_pad(data)
        elif len(data) % 8:
            raise DESInputError(f"Without padding the input must be a multiple of 8 bytes; it has {len(data)} "
                                f"({len(data) % 8} too many for whole blocks). Turn PKCS#7 padding on.")
        if not data:
            raise DESInputError("There is nothing to encrypt. With padding on, even an empty message becomes one block.")
        out = bytearray()
        if mode == "CBC":
            iv = int(validate_hex64(iv_hex, "IV"), 16) if iv_hex else int.from_bytes(os.urandom(8), "big")
            out += iv.to_bytes(8, "big")
        prev = iv
        for i in range(0, len(data), 8):
            p = int.from_bytes(data[i:i + 8], "big")
            x = p ^ prev if mode == "CBC" else p
            c = _block(x, ks)
            out += c.to_bytes(8, "big")
            if len(blocks_info) < keep:
                blocks_info.append({"index": i // 8 + 1, "input": format(p, "016X"), "des_in": format(x, "016X"),
                                    "des_out": format(c, "016X"), "output": format(c, "016X")})
            prev = c
        result = bytes(out)
    else:
        if len(data) % 8:
            raise DESInputError(f"Ciphertext must be a whole number of 8-byte blocks; this has {len(data)} bytes. "
                                "It may be incomplete or not DES ciphertext.")
        if mode == "CBC":
            if len(data) < 16:
                raise DESInputError("CBC ciphertext starts with an 8-byte IV, so it needs at least 16 bytes (IV + one block).")
            iv = int.from_bytes(data[:8], "big")
            data = data[8:]
        if not data:
            raise DESInputError("There is no ciphertext to decrypt.")
        out = bytearray()
        prev = iv
        for i in range(0, len(data), 8):
            c = int.from_bytes(data[i:i + 8], "big")
            d = _block(c, ks)
            p = d ^ prev if mode == "CBC" else d
            out += p.to_bytes(8, "big")
            if len(blocks_info) < keep:
                blocks_info.append({"index": i // 8 + 1, "input": format(c, "016X"), "des_in": format(c, "016X"),
                                    "des_out": format(d, "016X"), "output": format(p, "016X")})
            prev = c
        result = bytes(out)
        if padding:
            result = pkcs7_unpad(result)
    nblocks = (len(data) // 8)
    return result, {"blocks": blocks_info, "block_count": nblocks, "mode": mode,
                    "iv": format(iv, "016X") if iv is not None else None, "padding": bool(padding)}
