# DEScape — The 16-Round Escape

An educational escape-room game that teaches DES (EECE 455, American University of Beirut).
Players escape a locked cryptography lab by solving four rooms, each built on real DES
calculations made by our own DES engine with full tracing.

> **DES is not secure.** It is used here only as a teaching tool. Its 56-bit effective key can be
> found by exhaustive search. Real systems should use current authenticated encryption (e.g. AES-GCM).

---

## 1. Run it locally (about 2 minutes)

Requires Python 3.10+.

```bash
cd DEScape
python -m venv .venv
# Windows: .venv\Scripts\activate     macOS/Linux: source .venv/bin/activate
pip install -r requirements.txt
python manage.py migrate
python manage.py seed_demo          # fictional demo student accounts
python manage.py runserver
```

Open **http://127.0.0.1:8000/**.

### Demo accounts (local development only)

All demo accounts use the password **`cipherbreak-demo-2026`** (set `CIPHERBREAK_DEMO_PASSWORD`
before running `seed_demo` to choose another; outside DEBUG mode a password *must* be supplied).

| Username | Role | State |
|---|---|---|
| `student_demo` | Student | Fresh account, use it for the live demo |
| `student_ali` | Student | Completed in Guided mode, pre + post assessment |
| `student_maya` | Student | Completed in Challenge mode, pre + post assessment |
| `student_omar` | Student | In progress (Rooms 1–2 done), shows saved progress / Resume |
| `student_lea` | Student | Account created, not started |

Each demo account has a fictional email `<username>@example.com`, so you can try **Forgot your password?**.

### Password reset (local demo)

The sign-in page has **Forgot your password?**. For the local demo, Django's *console email backend* is
used: no real email is sent, and the reset email (with its link) is **printed in the terminal running
`runserver`**. Copy the link into the browser to choose a new password. Students who registered without
an email can't reset by email, but any signed-in user can use **Change my password** on the dashboard.
For a real deployment, set `DJANGO_EMAIL_BACKEND=django.core.mail.backends.smtp.EmailBackend`,
`DJANGO_EMAIL_HOST` and `DJANGO_DEFAULT_FROM_EMAIL`.

The simulated students' data was produced by playing through the real game rules
(`game/autoplay.py`); it is fictional sample data, not real student results.

### Reset demo data

```bash
python manage.py seed_demo --reset   # delete ONLY demo accounts, then recreate
python manage.py seed_demo --remove  # delete demo data only
```
Only accounts flagged as demo (created by this command) are ever deleted. To wipe everything,
stop the server, delete `db.sqlite3`, then run `migrate` and `seed_demo` again.

### Run the tests

```bash
python manage.py test        # 66 tests: DES engine, game rules, persistence, security, DES Lab (incl. avalanche & birthday)
```
`pycryptodome` is used **only** in one test to cross-check our DES against an independent library.

Optional: `python manage.py createsuperuser` gives access to `/admin/`.

DEScape is **student-only**: there are no instructor accounts, classrooms or educator pages.

---

### Answer sheet for demos (developer tool)

Every adventure generates new values, so the answers change each time. Start an adventure in the
game, then in a second terminal run:

```
python manage.py show_answers student_demo
```

It prints every machine in order (room, machine, title, answer; bit grids are shown row by row in
the same shape as the game). Add `--attempt <id>` for an older adventure. This command is not
reachable from the website.

## 2. Suggested 15–20 minute demonstration

1. Intro splash (opens straight on the animated DES logo, where D, E and S drop in one by one, then a scan sweep; press Enter or click to continue to the home page, where the logo animates again with sound; shown once per browser session, add `?intro=1` to see it again) → landing page (animated DES logo and one Start Playing button, which asks you to sign in or create an account) → "How to Play" (the DES security note, controls, scoring and the DES Lab experiments) (every page has a **← Back** button).
2. Sign in as `student_omar` → dashboard shows saved progress, badges, statistics → **Resume Adventure**.
3. Sign out, sign in as `student_demo` → **Start New Adventure (Guided)** → title screen → lockdown intro
   with NOVA → walk around the lobby (WASD/arrows or click) → mission briefing at the holotable.
4. Room 1 (Hex Gate): walk to each machine and press Enter: letter plates + hex dials (text → hex),
   block inspector (bit switches), the IP permutation bench (do the whole 64-bit permutation yourself), laser splitter (L0/R0). The gate opens.
5. Room 2 (Key Vault): choose the parity bits, the PC-1 bench, splitter (C0/D0), rotate the C/D rotor disks for four rounds in a row
   (recording C and D after each round), the PC-2 bench, pull the forge lever to make K1…K16; the key archive terminal shows every key round.
6. Room 3 (Round Reactor): XOR gate wiring, S-box grid, P patch panel, Feistel router,
   ignite the reactor core (all 16 rounds, round log with every operation).
7. Room 4 (Exit Chamber): drag key cartridges into reverse order, the decryption engine, the exit keypad's letter wheels,
   NOVA's security questions → walk out of the exit → escape screen.
8. Results page (mastered vs needs-practice concepts). Before Room 1 and after the escape, the optional pre/post-assessment
   shows a results page: score, every answer with the correct one and a short explanation, and a before-vs-after table.
9. **DES Lab** → encrypt the textbook vector, then **Avalanche effect** (flip one bit, watch the difference spread
   round by round; try key bit 8 to see a parity bit change nothing) and **Birthday attack** (real DES on a
   shortened block, first repeat after about 2^(n/2) blocks; Sweet32).

Before every machine NOVA gives a short step-by-step lesson with a practice question; after every machine a
**DES road map** pop-up says "Now that we finished X, we move on to Y".

---

## 3. Features

**Two missions: Encrypt or Decrypt.** On the dashboard the player picks a mission for each new adventure.
*Encrypt mission*: Rooms 1-3 encrypt the access code (rounds use K1 ... K16), Room 4 decrypts the exit code
(K16 ... K1). *Decrypt mission*: Room 1 turns an intercepted ciphertext (given as 8 byte values) into a hex block,
Room 3 runs the 16 **decryption** rounds (K16 ... K1) to get the plaintext, and Room 4 proves the result by
**encrypting** it again (K1 ... K16), then the player reads the secret message. The message never appears before
it is decrypted.

**DES Lab for any message or file.** Besides the single-block explorer, the Lab encrypts or decrypts text of any
length, raw hex, or any uploaded file (up to 1 MB), with a download of the result. The page explains PKCS#7 padding
and the ECB / CBC modes (CBC stores its random IV as the first 8 bytes). The key can be 16 hex digits, a **password**
(shown step by step: UTF-8 bytes, SHA-256, first 8 bytes, parity fixed), or a **random key** button. Edge cases are
handled with clear messages: empty input (one padding block), lengths that are not a multiple of 8, no padding,
wrong key or bad padding on decryption, truncated ciphertext, and warnings for weak / semi-weak keys (e.g.
0000000000000000) and bad parity. Code: `des_engine/bulk.py` (checked against the traced engine in the tests).

**Notebook: My DES values.** The notebook lists the real plaintext, key and ciphertext of the player's recent
adventures (only values already earned), each with a Copy button and buttons that open the DES Lab pre-filled to
check them.

**Game.** A 2D pixel-art escape room drawn on a canvas (all art is generated in code; no image files).
Title screen, lockdown intro, then you walk your character through a lobby and four themed rooms with
**WASD / arrow keys or click-to-walk** (on-screen pad on touch screens). NOVA is a floating drone that follows
you and talks in speech bubbles and a dialogue box. Walk up to a machine and press **Enter** (or click it) to open it.
Every challenge is an in-world machine operated with game mechanics: hex dials, letter plates, bit switches,
a permutation bench for IP / PC-1 / PC-2 / E / P (the player builds the whole output bit by bit: click the source lamp or type the bit, and each row is checked), a laser splitter, rotor disks, a key forge lever, XOR gate
wiring, an S-box machine done in 4 guided steps (row, column, look-up, 4 output bits), a Feistel router with numbered
steps (copy the right half, then XOR column by column with a binary helper), a reactor core that runs all 16 rounds
with a live log and then asks about the final swap, drag-and-drop key ordering for decryption (D1 uses K16 ... D16 uses K1),
an exit keypad of letter wheels with a visible hex character table, and NOVA's dialogue questions.
Every machine opens with a short numbered list of what to do. Juicy feedback: "ACCESS GRANTED" stamp, sparks, screen shake, gate-opening
animation, item pickups, synthesized sound effects. HUD with score, escape progress, room locks and timer;
inventory of recovered items (code card, block, halves, key, 16 key chips, ciphertext tape, exit code);
archive terminals in Rooms 2–4 that show the full key schedule and every encryption/decryption round;
facility map (also opens any machine without walking, for keyboard/screen-reader users), pause menu
(Esc), escape screen and results. 4 rooms / 21 challenges (one optional bonus). Locked doors and machines
explain what to do first, and a big yellow arrow plus a glowing path on the floor always lead to the next goal.

**Teaching.** NOVA's in-world onboarding teaches the controls by doing (move, then use the holotable),
and every room starts with a short NOVA briefing of the DES step it covers. Every challenge has its own interactive tutorial that explains, demonstrates,
requires an action (e.g. "rotate the C disk once") or a small practice question with checked feedback
before moving on (it highlights the real parts of the machine). Auto-starts in Guided mode, available on demand in Challenge mode. Three hint levels
(concept → similar example → walkthrough) that teach the method. Targeted mistake feedback
(e.g. "You rotated by 1; round 3 needs a shift of 2"). Learning Notebook with 14 pages.

**Scoring.** Up to 100 per challenge, −10 per wrong answer, hints −10/−20/−30 in Challenge mode
(free in Guided), +50 per room; never negative; awarded once; format errors cost nothing. Six achievements.
Optional timer display (no time limit). Server-side validation of everything.

**Replayability.** Each adventure gets a random seed → new message code, key (odd parity, no weak keys),
exit code, selected round, S-box groups, table positions, key-rotation round, decryption round and
shuffled options. In Room 4 the decryption keys are ordered by **drag-and-drop** onto the 16 round slots
(drag between slots to swap); clicking or pressing Enter on a key still places it in the next empty slot,
and clicking a filled slot sends its key back. Parameters are stored with the attempt, so refresh/resume never changes puzzles.
Recently used codes are avoided for the same student.

**Accounts & persistence.** Django authentication (hashed passwords, sessions, CSRF). Student accounts only. A settings
(gear) button opens **My Profile** with the player's details and the password change form. Signing out asks for confirmation. Progress saved after every action (room entry, puzzle open, submission, hint, tutorial).
Previous attempts are kept.

**DES Lab** (for signed-in players; works without playing): any hex block/key, encrypt/decrypt, text → hex helper, rounds 1–16 with
every operation, expandable S-box lookups, full key schedule, all DES tables, copy buttons, standard test
vectors, round animation replay, show/hide explanations, plus two experiments: the **avalanche effect** (one flipped
message/key bit, bits that differ after IP and after each of the 16 rounds) and the **birthday attack** (real DES
with the ciphertext cut to 8–24 bits, encrypt until the first repeat and compare with the ≈1.25·2^(n/2)
estimate; explains the 2^32-block bound and Sweet32 for DES's 64-bit block). Room 4's security verdict asks about both. If a student opens it
during an *independent* Challenge attempt, they are warned and that attempt is relabelled as practice.

**Sound & music.** Original background music generated live in the browser with the Web Audio API
(a slow ambient chord loop with a soft arpeggio; no audio files, nothing copyrighted) plus synthesized
sound effects. One **sound button in the bottom-right corner** (title screen and game) mutes or unmutes
all audio; the choice is remembered in the browser. There is no separate settings panel.

**Accessibility.** Keyboard navigation, visible focus, ARIA labels/live regions, feedback in text not just
colour, animations turned off automatically when the operating system's "reduce motion" setting is on,
responsive desktop/mobile with an on-screen D-pad on touch screens.

**Look & feel.** The DEScape maze logo (site header, home page, game title screen, favicon) and its
cyan-to-green colours for buttons and progress bars; the pixel lab artwork as a slowly drifting
background; line icons from the open-source Lucide set (ISC licence, `static/icons/`) instead of emojis;
the current page is highlighted in the top menu. Static files carry a version stamp so browsers never
show stale pages after an update.

---

## 4. Architecture

```
cipherbreak/        Django settings and URL routes
des_engine/         Pure-Python DES + tracing (no Django dependency)   ← algorithm
  tables.py         Standard FIPS 46-3 tables (IP, IP⁻¹, E, P, PC-1, PC-2, shifts, S1–S8)
  core.py           validation, key_schedule(), feistel(), des_trace(), encrypt(), decrypt()
  tests/            DES unit tests
game/               The game                                              ← game logic
  generator.py      seeded generation of a new adventure
  puzzles.py        the 21 challenges: view data, fields, answers (from des_engine), hints, feedback
  services.py       progression, scoring, hints, achievements, results (all server-side rules)
  assessments.py    pre/post question bank (7 questions on the main DES topics)
  notebook.py       Learning Notebook content
  autoplay.py       plays an attempt through the real rules (tests + demo data)
  models.py         Attempt, RoomProgress, PuzzleProgress, PuzzleSubmission, HintUsage,
                    UserAchievement, AssessmentResult
  views.py          pages + JSON API used by the game screen
  management/commands/seed_demo.py
  tests/            game, persistence, security, lab tests
accounts/           Profile (notebook), TutorialCompletion, registration
lab/                DES Learning Laboratory page + /api/des/
templates/          HTML pages
static/css/app.css  visual theme, rooms, animations, responsive + reduced-motion rules
static/css/game.css game art direction: HUD, machines, title/escape screens
static/js/          world.js (canvas pixel-art engine: rooms, player, NOVA, doors, lighting, particles),
                    machines.js (the puzzle machines), play.js (game flow, HUD, NOVA, inventory, menus),
                    common.js (API, sound, settings), tutorial.js (overlay engine),
                    trace.js (round & key explorers), lab.js
```

The browser never receives an answer before the challenge is solved; it sends answers to
`/api/attempt/<id>/puzzle/<pid>/submit/` and displays the server's verdict.

### Suggested split for a four-person team
- **Algorithm & implementation:** `des_engine/`, `game/puzzles.py`, `game/services.py`.
- **UI & technical diagrams:** `templates/`, `static/css/`, `static/js/` (world in `world.js`, machines in `machines.js`, explorers in `trace.js`).
- **Testing & verification:** `des_engine/tests/`, `game/tests/`, manual browser checklist below.
- **Report & presentation:** this README, the Notebook content, the demo script in section 2.

---

## 5. How each DES operation is implemented (`des_engine/core.py`)

Bits are handled as strings of `'0'/'1'`, bit 1 = leftmost, exactly as numbered in the standard, so
every intermediate value can be shown to students as both hex and binary.

| Operation | Implementation |
|---|---|
| Input validation | `validate_hex64`: exactly 16 hex digits (spaces allowed), clear messages for missing / wrong length / non-hex; leading zeros preserved by zero-padded formatting |
| IP / IP⁻¹ / E / P / PC-1 / PC-2 | `permute(bits, table)`: `output[i] = input[table[i]]` with the standard 1-based tables |
| Key schedule | `key_schedule`: PC-1 → C0, D0 (28 bits each) → for rounds 1–16 rotate left by `SHIFTS[i]` → PC-2 on C‖D → 48-bit Kᵢ. Trace keeps PC-1, C0/D0, shift, running total, C/D before and after, C‖D and Kᵢ |
| S-boxes | `sbox_lookup`: row = bits 1&6, column = bits 2–5, value from S1–S8, output as 4 bits; trace keeps all of these |
| F-function | `feistel(R, K)`: E(R) → ⊕K → 8 S-boxes → P |
| Rounds | `des_trace`: IP → L0,R0 → 16 × (Lᵢ = Rᵢ₋₁, Rᵢ = Lᵢ₋₁ ⊕ F(Rᵢ₋₁, Kᵢ)) → swap R16‖L16 → IP⁻¹ |
| Decryption | same `des_trace` with `decrypt=True`: the same subkeys applied in order K16…K1 (no separate key set) |

Verification: the classic vector `0123456789ABCDEF` / `133457799BBCDFF1` → `85E813540F0AB405`,
all 16 published round keys for that key, published round-1 intermediates (E, XOR, S-box output, F, R1),
L16/R16, five more known-answer vectors, 200 random encrypt/decrypt round trips, and 300 random blocks
cross-checked against pycryptodome. Results are computed, never hard-coded.

---

## 6. Verification done

- `python manage.py test` — 66 tests pass.
- Automated browser runs (Chromium, Playwright) that play a complete adventure through the real game:
  title screen, intro, onboarding (moving, using the holotable), walking to every machine by clicking the
  world, operating each machine's controls (dials, switches, cables, cutter, rotors, forge, sockets, gates,
  S-box grid, router, reactor, key cartridges, letter wheels, dialogue), gates opening, archives,
  inventory, map, and walking out of the exit: **no console errors**.
- DES Lab (round 16, S-box details, key tab, input validation, avalanche, birthday), Back buttons, and an
  internal link scan (no broken links).
- Mobile layout checked at iPhone 13 size.

---

## 7. Limitations / not included

- **Learning-gain claims:** the platform records pre/post scores but makes no claim that the game improves
  learning; the demo data is simulated.
- **Email** is printed to the terminal in the local demo (see "Password reset"); a real mail server must be
  configured for deployment.
- **Drag-and-drop on phones:** browsers' native drag-and-drop doesn't work with touch, so on phones and
  tablets the key-order puzzle uses the tap-to-place fallback.
- **Advanced replay challenges** beyond the optional bonus S-box are not separate unlockable levels;
  variety comes from new values, rounds, groups and positions each adventure.
- **Deployment:** runs locally with the Django dev server (SQLite), or online on Render's free plan
  (`render.yaml`: gunicorn, WhiteNoise, free PostgreSQL via `DATABASE_URL`, `DJANGO_DEBUG=0`); guide in
  `deploy/RENDER.md`. A PythonAnywhere alternative is in `deploy/PYTHONANYWHERE.md`.
- Automated UI tests are Playwright scripts we ran during development (`tools/ui_tests/`), not part of `manage.py test`.
