"""Fast whole-message DES (des_engine.bulk) agrees with the traced engine and handles edge cases."""
import os
import random
import unittest

from des_engine import DESInputError, TEST_VECTORS, decrypt, encrypt
from des_engine import bulk


class BulkTests(unittest.TestCase):
    def test_vectors_and_random_blocks_match_core(self):
        for v in TEST_VECTORS:
            self.assertEqual(bulk.encrypt_block(v["plaintext"], v["key"]), v["ciphertext"])
        rng = random.Random(455)
        for _ in range(60):
            b, k = "%016X" % rng.getrandbits(64), "%016X" % rng.getrandbits(64)
            self.assertEqual(bulk.encrypt_block(b, k), encrypt(b, k))
            self.assertEqual(bulk.decrypt_block(b, k), decrypt(b, k))

    def test_round_trip_every_length(self):
        key = "133457799BBCDFF1"
        for n in range(0, 25):  # empty input and every non-multiple of 8
            data = os.urandom(n)
            for mode in ("ECB", "CBC"):
                out, info = bulk.crypt(data, key, mode=mode)
                self.assertEqual(len(out), (n // 8 + 1) * 8 + (8 if mode == "CBC" else 0))
                back, _ = bulk.crypt(out, key, decrypt=True, mode=mode)
                self.assertEqual(back, data)

    def test_padding_rules(self):
        self.assertEqual(bulk.pkcs7_pad(b""), b"\x08" * 8)
        self.assertEqual(bulk.pkcs7_pad(b"abc"), b"abc" + b"\x05" * 5)
        with self.assertRaises(DESInputError):
            bulk.pkcs7_unpad(b"abcdefg\x09")
        with self.assertRaises(DESInputError):
            bulk.crypt(b"abc", "133457799BBCDFF1", padding=False)
        out, _ = bulk.crypt(b"\x00" * 16, "133457799BBCDFF1", padding=False)
        self.assertEqual(len(out), 16)

    def test_wrong_key_is_detected_by_padding(self):
        out, _ = bulk.crypt(b"attack at dawn", "133457799BBCDFF1")
        with self.assertRaises(DESInputError):
            bulk.crypt(out, "0E329232EA6D0D73", decrypt=True)

    def test_ciphertext_length_checks(self):
        with self.assertRaises(DESInputError):
            bulk.crypt(b"1234567", "133457799BBCDFF1", decrypt=True)
        with self.assertRaises(DESInputError):
            bulk.crypt(b"12345678", "133457799BBCDFF1", decrypt=True, mode="CBC")

    def test_weak_and_semi_weak_keys(self):
        for k in ("0000000000000000", "0101010101010101", "FFFFFFFFFFFFFFFF", "1F1F1F1F0E0E0E0E"):
            self.assertTrue(any("WEAK key" in w for w in bulk.key_warnings(k)), k)
            # a weak key: encrypting twice gives back the original
            self.assertEqual(bulk.encrypt_block(bulk.encrypt_block("0123456789ABCDEF", k), k), "0123456789ABCDEF")
        self.assertTrue(any("SEMI-WEAK" in w for w in bulk.key_warnings("01FE01FE01FE01FE")))
        self.assertEqual(bulk.encrypt_block(bulk.encrypt_block("0123456789ABCDEF", "01FE01FE01FE01FE"), "FE01FE01FE01FE01"),
                         "0123456789ABCDEF")
        self.assertEqual(bulk.key_warnings("133457799BBCDFF1"), [])

    def test_password_and_random_keys(self):
        a, b = bulk.key_from_password("aub-eece455"), bulk.key_from_password("aub-eece456")
        self.assertEqual(a["key"], "D6CEF4015BDC1A16")
        self.assertNotEqual(a["key"], b["key"])
        with self.assertRaises(DESInputError):
            bulk.key_from_password("")
        for _ in range(20):
            k = bulk.random_key()
            self.assertEqual(bulk.key_warnings(k), [])
