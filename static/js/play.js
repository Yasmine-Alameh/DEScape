/* DEScape — The 16-Round Escape: game controller.
 * Title screen → intro → explorable rooms. Walk to machines and use them; the server
 * owns every rule, answer and score. This file connects the world, the machines,
 * NOVA, the HUD, the inventory and the menus.
 */
(function () {
  "use strict";
  const B = window.CB_BOOT, W = window.World, esc = CB.esc;
  const API = `/api/attempt/${B.attemptId}`;
  const $ = (s, el) => (el || document).querySelector(s);
  const $$ = (s, el) => Array.from((el || document).querySelectorAll(s));
  const sleep = (ms) => new Promise((r) => setTimeout(r, CB.reducedMotion() ? Math.min(ms, 60) : ms));
  const tutDone = new Set(B.tutorialsDone);
  const ARCHIVES = { keys: "r2_cycle", encrypt: "r3_swap", decrypt: "r4_round" };
  let S = null, P = null, machine = null, answer = {}, room = 0, inv = null, mode = "title";
  const ui = { machineOpen: false, dialog: null };

  /* ---------------- API ---------------- */
  async function call(url, body) {
    try { return await CB.api(url, body); }
    catch (e) { bubble("Couldn't reach the server: " + e.message + ". Your last saved progress is safe."); throw e; }
  }
  async function loadState() {
    S = await CB.api(API + "/state/");
    S.tutorials_done.forEach((t) => tutDone.add(t));
    syncClock(S.attempt);
    drawHud(); return S;
  }
  const puzzleInfo = (id) => { for (const r of S.rooms) { const p = r.puzzles.find((x) => x.id === id); if (p) return { r, p }; } return null; };

  /* ---------------- World status hooks ---------------- */
  W.state.statusOf = (id) => {
    if (id === "info") return "available";
    if (id.startsWith("archive:")) { const i = puzzleInfo(ARCHIVES[id.slice(8)]); return (i && i.p.solved) || B.mode === "demo" ? "solved" : "locked"; }
    const i = puzzleInfo(id); if (!i) return "locked";
    return i.p.solved ? "solved" : i.p.available ? "available" : "locked";
  };
  W.state.doorState = (d) => {
    if (!S) return "locked";
    if (d.kind === "back") return "open";
    if (W.state.scene === 0) return S.rooms[d.to - 1].status === "locked" ? "locked" : "open";
    const r = S.rooms[W.state.scene - 1];
    return r.status === "completed" ? "open" : "locked";
  };
  function updateHint() {
    const st = W.state;
    if (st.forcedHint) { st.hintTarget = st.forcedHint; return; }
    if (room === 0) { const r = S.rooms.find((x) => x.status === "available"); st.hintTarget = r ? "door:" + r.n : null; return; }
    const r = S.rooms[room - 1];
    if (r.status === "completed") { st.hintTarget = "door:" + (room < 4 ? room + 1 : "escape"); return; }
    const next = r.puzzles.find((p) => p.available && !p.solved && !p.optional);
    st.hintTarget = next ? next.id : null;
  }
  window.Game = { reactorPower: (p) => (W.state.reactorPower = p) };

  /* ---------------- HUD ---------------- */
  function drawHud() {
    const a = S.attempt;
    $("#hud-room").textContent = room ? `ROOM ${room} · ${S.rooms[room - 1].name.toUpperCase()}` : "MAIN LOBBY";
    $("#hud-score").textContent = a.score;
    $("#hud-pct").textContent = a.percent + "%"; $("#hud-bar").style.width = a.percent + "%";
    $("#hud-rooms").innerHTML = S.rooms.map((r) => `<span class="rlock ${r.status}" title="Room ${r.n}: ${esc(r.name)}, ${r.status}">${r.status === "completed" ? "✓" : r.status === "locked" ? CB.icon("lock") : r.n}</span>`).join("");
    $("#game").dataset.room = room;
    let obj = "Explore the lobby.";
    if (room === 0) { const r = S.rooms.find((x) => x.status === "available"); obj = a.status === "completed" ? "You escaped! Explore freely or open the menu." : r ? `Enter Room ${r.n}: ${r.name}` : "All rooms cleared."; }
    else {
      const r = S.rooms[room - 1], next = r.puzzles.find((p) => p.available && !p.solved && !p.optional);
      obj = r.status === "completed" ? (room < 4 ? `Gate open → Room ${room + 1}` : "The exit is open. Walk out!") : next ? `${next.title} (${r.solved}/${r.required})` : "Explore the room";
    }
    $("#hud-obj").textContent = obj;
    updateHint(); drawLabels();
  }
  /* ---------------- Challenge mode: 1-hour countdown ----------------
     The server owns the clock (play time, see services.tick); the screen counts down between
     heartbeats. At 0:00 the adventure fails and the player can try again. */
  const clock = { left: null, run: 0, beat: 0, over: false };
  function syncClock(a) {
    if (!a || !a.timed || a.time_left == null) return;
    clock.left = a.time_left; clock.run = 0;
    if (a.status === "failed") timeUp();
  }
  const fmtClock = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  async function heartbeat() {
    try {
      const d = await CB.api(API + "/tick/", {});
      if (S) { S.attempt.status = d.status; S.attempt.active_seconds = d.active_seconds; }
      if (d.time_left != null) { clock.left = d.time_left; clock.run = 0; }
      if (d.status === "failed") timeUp();
    } catch (e) { /* offline: keep counting locally */ }
  }
  setInterval(() => {
    if (!S || !S.attempt.timed || clock.left == null || clock.over) return;
    const live = mode !== "title" && !document.hidden && S.attempt.status === "active";
    if (live) { clock.run++; clock.beat++; }
    const left = Math.max(0, clock.left - clock.run);
    $("#hud-timer-wrap").classList.remove("hidden");
    $("#hud-timer-lab").textContent = "TIME LEFT";
    $("#hud-timer").textContent = fmtClock(left);
    $("#hud-timer-wrap").classList.toggle("low", left <= 300);
    if (live && (clock.beat >= 20 || left === 0)) { clock.beat = 0; heartbeat(); }
  }, 1000);
  function timeUp() {
    if (clock.over) return;
    clock.over = true; W.state.paused = true;
    $("#hud-timer").textContent = "0:00";
    CB.sound("deny"); if (CB.music && CB.music.stop) CB.music.stop();
    const m = CB.modal(CB.icon("timer") + " Time is up!", `<div class="timeup">
        <p class="nova-line"><span class="nova-face" aria-hidden="true"></span><span>“The hour is over and the lab has sealed itself. This challenge has failed, but everything you learned stays with you.”</span></p>
        <p>You solved <b>${S.attempt.percent}%</b> of the mission with <b>${S.attempt.score}</b> points. Start a new Challenge to try again with a fresh message and key.</p>
        <div class="btn-row"><button type="button" class="btn btn-primary btn-lg" id="tu-retry">${CB.icon("rotate-ccw")} Try again</button>
          <a class="btn" href="${B.resultsUrl}">See my results</a><a class="btn" href="${B.dashboardUrl}">Dashboard</a></div></div>`,
      { onClose: () => { location.href = B.dashboardUrl; } });
    m.el.classList.add("game-modal");
    $("#tu-retry", m.el).onclick = () => $("#restart-form").submit();
  }

  function drawLabels() {
    const sc = W.SCENES[room];
    $("#labels").innerHTML = sc.doors.filter((d) => d.y === 0).map((d) => {
      const ds = W.state.doorState(d);
      return `<span class="dlabel ${ds}" style="left:calc(var(--s) * ${(d.x + 1) * 16}px);top:calc(var(--s) * 19px)">${ds === "locked" ? CB.icon("lock") + " " : ""}${esc(d.label)}</span>`;
    }).join("");
  }

  /* ---------------- NOVA speech bubble + dialogue box ---------------- */
  let bubbleTimer = null;
  function bubble(text, ms) {
    const el = $("#nova-say"); el.classList.remove("hidden"); el.querySelector("span").textContent = text;
    clearTimeout(bubbleTimer); bubbleTimer = setTimeout(() => el.classList.add("hidden"), ms || Math.max(3500, text.length * 55));
  }
  function placeBubble() {
    const el = $("#nova-say"); if (el.classList.contains("hidden")) return;
    const s = W.scale(), n = W.state.nova;
    const left = Math.min(Math.max(n.x * s, 140), W.VW * s - 140);
    el.style.left = left + "px"; el.style.top = Math.max(8, (n.y - 10) * s) + "px";
  }
  function placeNextTag() {
    const el = $("#next-tag"), g = W.guidePoint(), f = W.state.focus, pt = $("#press-tag"), sc = W.scale();
    if (f && mode === "play" && !W.state.paused) {
      pt.classList.remove("hidden"); pt.style.left = (f.x + f.w / 2) * 16 * sc + "px"; pt.style.top = (f.y * 16 - 14) * sc + "px";
    } else pt.classList.add("hidden");
    if (!g || mode !== "play" || (f && W.state.hintTarget === f.id)) { el.classList.add("hidden"); return; }
    const s = W.scale(); el.classList.remove("hidden");
    el.style.left = g[0] * s + "px"; el.style.top = (W.state.hintTarget.startsWith("door:") ? g[1] + 22 : g[1] - 20) * s + "px";
  }
  /* Typewriter dialogue: returns a promise resolved when the player finishes reading. */
  function say(lines) {
    lines = [].concat(lines);
    return new Promise((resolve) => {
      const box = $("#dialog"), text = $("#dialog-text");
      let k = 0, typing = null, full = false;
      W.state.paused = true; box.classList.remove("hidden"); ui.dialog = { next };
      function show() {
        clearInterval(typing); full = false; const t = lines[k];
        if (CB.reducedMotion()) { text.innerHTML = t; full = true; return; }
        let j = 0; text.textContent = "";
        const plain = t.replace(/<[^>]+>/g, "");
        typing = setInterval(() => { j += 2; text.textContent = plain.slice(0, j); if (j % 6 === 0) CB.sound("type"); if (j >= plain.length) { clearInterval(typing); text.innerHTML = t; full = true; } }, 18);
      }
      function next() {
        if (!full) { clearInterval(typing); text.innerHTML = lines[k]; full = true; return; }
        k++; if (k >= lines.length) return done(); show();
      }
      function done() {
        clearInterval(typing); box.classList.add("hidden"); ui.dialog = null;
        if (!ui.machineOpen) W.state.paused = false;
        $("#dialog-next").onclick = $("#dialog-skip").onclick = null; resolve();
      }
      $("#dialog-next").onclick = next; $("#dialog-skip").onclick = done;
      show(); setTimeout(() => $("#dialog-next").focus(), 30);
    });
  }
  let bannerTimer = null;
  function banner(html, ms, cls) {
    const el = $("#banner"); el.className = "banner " + (cls || ""); el.innerHTML = html;
    clearTimeout(bannerTimer); if (ms !== 0) bannerTimer = setTimeout(() => el.classList.add("hidden"), ms || 2600);
  }

  /* ---------------- Interaction prompt ---------------- */
  W.on("focus", (s) => {
    const el = $("#prompt");
    if (!s || mode !== "play") { el.classList.add("hidden"); return; }
    const stt = W.state.statusOf(s.id);
    el.classList.remove("hidden");
    el.innerHTML = `<kbd>ENTER</kbd> ${esc(s.label)} <span class="st ${stt}">${stt === "solved" ? (s.id.startsWith("archive") ? "OPEN" : "✓ DONE") : stt === "locked" ? CB.icon("lock") + " LOCKED" : s.id === "info" ? "" : "● READY"}</span>`;
    el.onclick = () => interact({ type: "station", s });
  });
  W.on("interact", (t) => interact(t));
  W.on("door", (d) => throughDoor(d));
  W.on("lockeddoor", (d) => {
    CB.sound("deny"); W.shake(2);
    if (room === 0) { const r = S.rooms[d.to - 1]; bubble(`Room ${r.n} is sealed. ${r.locked_reason}`); }
    else bubble(room === 4 ? "The exit stays sealed until the exit code and my final question are answered." : `This gate opens when every machine in ${S.rooms[room - 1].name} is solved.`);
  });

  function interact(t) {
    if (mode !== "play" || ui.machineOpen || ui.dialog || W.state.transitioning) return;
    if (t.type === "door") {
      if (W.state.doorState(t.d) === "open") return throughDoor(t.d);
      return W.emit("lockeddoor", t.d);
    }
    const s = t.s, stt = W.state.statusOf(s.id);
    if (s.id === "info") return briefing();
    if (s.id.startsWith("archive:")) {
      if (stt === "locked") { CB.sound("deny"); return bubble(`The archive unlocks after “${puzzleInfo(ARCHIVES[s.id.slice(8)]).p.title}”.`); }
      return openArchive(s.id.slice(8));
    }
    if (stt === "locked") {
      CB.sound("deny"); W.shake(2);
      const r = S.rooms[room - 1], next = r.puzzles.find((p) => p.available && !p.solved && !p.optional);
      return bubble(s.id === "r3_sbox_bonus" ? "The bonus S-box closed once you started the P module." : `Offline. Power it up by finishing “${next ? next.title : "the earlier machines"}” first.`);
    }
    openPuzzle(s.id);
  }

  /* ---------------- Doors and room transitions ---------------- */
  async function throughDoor(d) {
    if (W.state.transitioning) return;
    if (d.to === "escape") return escapeSequence();
    await goRoom(d.to, room);
  }
  async function goRoom(n, from) {
    const st = W.state; st.transitioning = true; st.paused = true;
    CB.sound("door"); st.fadeTarget = 1; await sleep(320);
    try { await call(API + "/room/", { room: n }); }
    catch (e) { st.fadeTarget = 0; st.transitioning = false; st.paused = false; return; }
    room = n; W.load(n, from); st.reactorPower = n === 3 ? reactorLevel() : 0;
    drawHud(); st.fadeTarget = 0; await sleep(250);
    st.transitioning = false; st.paused = false;
    if (n && !tutDone.has("room" + n)) await roomIntro(n);
    else if (n) bubble(n === 4 && S.rooms[3].status === "completed" ? "The exit is open. Walk through the top door!" : ROOM_HELLO[n]);
  }
  function reactorLevel() {
    const r = S.rooms[2]; if (r.puzzles.find((p) => p.id === "r3_swap").solved) return 1;
    return r.puzzles.filter((p) => p.solved && !p.optional).length / 7;
  }
  const ROOM_HELLO = { 1: "You are now in the Hex Gate. Follow the yellow arrow.", 2: "You are now in the Key Vault. Follow the yellow arrow.", 3: "You are now in the Round Reactor. Follow the yellow arrow.", 4: "You are now in the Final Decryption Chamber. Follow the yellow arrow." };
  const DEC = B.direction === "decrypt";  // Decrypt mission: Rooms 1-3 decrypt, Room 4 re-encrypts to check
  const ROOM_INTRO_DEC = {
    1: ["<b>Decrypt mission · Room 1 · The Hex Gate.</b> We intercepted an <b>encrypted</b> message. Let's decrypt it with DES.",
      "DES always works on blocks of exactly <b>64 bits</b>, written as <b>16 hex digits</b>. The radio gives us the ciphertext as 8 byte values.",
      "Decryption starts exactly like encryption: ciphertext → hex block → IP → split into L0 and R0. Follow the yellow arrow!"],
    3: ["<b>Room 3 · The Round Reactor.</b> It runs the DES round function F. Repair it module by module, then decrypt.",
      "A decryption round is the <b>same round</b> as in encryption: <b>E</b>, <b>⊕</b> round key, <b>S-boxes</b>, <b>P</b>, then the Feistel update.",
      "The only difference: the keys go <b>backwards</b>. Decryption round 1 uses K16, round 2 uses K15, … round 16 uses K1."],
    4: ["<b>Room 4 · The Final Decryption Chamber.</b> You decrypted the message. Is it really right?",
      "Proof: <b>encrypt</b> the recovered plaintext with the same key. If we get the intercepted ciphertext back, the decryption was correct.",
      "Load the keys in encryption order, run an encryption round, read the secret message, then answer my last question."],
  };
  const ROOM_INTRO = {
    1: ["<b>Room 1 · The Hex Gate.</b> This gate opens only for a correct 64-bit DES block.",
      "DES always works on blocks of exactly <b>64 bits</b>, written as <b>16 hex digits</b>. One hex digit = 4 bits; one character = 8 bits.",
      "Four machines: the access terminal (text → hex), the block inspector, the IP patch panel, and the block splitter. Just follow the yellow arrow and the glowing path on the floor!"],
    2: ["<b>Room 2 · The Key Vault.</b> This machine turns ONE 64-bit key into SIXTEEN 48-bit round keys.",
      "Only 56 key bits matter. <b>PC-1</b> drops the 8 parity bits and rearranges the rest into two halves, <b>C</b> and <b>D</b>.",
      "Each round, C and D rotate left by 1 or 2 places, then <b>PC-2</b> picks 48 bits to make that round's key."],
    3: ["<b>Room 3 · The Round Reactor.</b> It runs the DES round function F. It's offline, let's repair it module by module.",
      "One round: <b>E</b> expands R from 32 to 48 bits, <b>⊕</b> mixes in the round key, eight <b>S-boxes</b> squeeze 48 bits back to 32, and <b>P</b> scatters them.",
      "Then the <b>Feistel update</b>: new L = old R, new R = old L ⊕ F. Repair every module, then ignite the core for all 16 rounds."],
    4: ["<b>Room 4 · The Final Decryption Chamber.</b> The exit is sealed with DES ciphertext.",
      "Good news: DES decryption is the <b>same algorithm</b>. The only change: round keys run in <b>reverse</b>, K16 first and K1 last.",
      "Load the keys, run a decryption round, read the exit code from the plaintext, then I have one last question for you."],
  };
  async function roomIntro(n) {
    await say((DEC && ROOM_INTRO_DEC[n]) || ROOM_INTRO[n]);
    tutDone.add("room" + n); CB.api(`/api/tutorial/room${n}/`, {}).catch(() => {});
    bubble("Follow the yellow arrow and the glowing path!");
  }

  /* ---------------- Machines ---------------- */
  async function openPuzzle(pid) {
    try { P = await call(`${API}/puzzle/${pid}/`); } catch (e) { return; }
    showMachine();
  }
  function showMachine() {
    const back = $("#machine-back"), body = $("#mc-body");
    ui.machineOpen = true; W.state.paused = true; CB.sound("open");
    answer = {}; P.fields.forEach((f) => (answer[f.name] = ""));
    const M = { set: (k, v) => { answer[k] = String(v); updateEngage(); }, mode: B.mode };
    machine = Machines.build(P, M);
    const r = S.rooms[room - 1] || S.rooms.find((x) => x.puzzles.some((p) => p.id === P.id));
    const idx = r.puzzles.findIndex((p) => p.id === P.id);
    $("#machine").dataset.room = r.n;
    $("#mc-kicker").textContent = `ROOM ${r.n} · ${r.puzzles[idx].optional ? "BONUS" : `MACHINE ${idx + 1}`}`;
    $("#mc-title").textContent = P.title;
    $("#mc-task").textContent = P.task;
    $("#mc-nova").textContent = P.nova || "";
    body.innerHTML = machine.html; body.scrollTop = 0;
    $("#mc-feedback").className = "mc-feedback"; $("#mc-feedback").innerHTML = "";
    $("#mc-hints").innerHTML = P.progress && P.progress.hint_level ? hintsHtml(P.hints, P.progress) : "";
    $("#mc-stamp").classList.add("hidden");
    $("#machine").classList.remove("solved", "shake");
    back.classList.remove("hidden");
    if (machine.bind) machine.bind(body);
    if (P.solved) solvedState(null);
    else { $("#mc-engage").innerHTML = CB.icon("arrow-right") + " NEXT"; $("#mc-engage").onclick = engage; $("#mc-foot").classList.remove("done"); updateEngage(); }
    $("#mc-close").focus();
    $("#machine").classList.remove("lesson-mode"); $("#mc-lesson").classList.add("hidden");
    if (!P.solved && !tutDone.has("p_" + P.id)) startLesson(true);
  }
  function updateEngage() {
    if (!P || P.solved) return;
    const ready = P.fields.every((f) => answer[f.name] !== "");
    $("#mc-engage").classList.toggle("ready", ready);
  }
  function closeMachine() {
    if (CB.tutorialActive && CB.tutorialActive()) return;
    $("#machine-back").classList.add("hidden"); ui.machineOpen = false; W.state.paused = false;
    const solvedNow = P && P._justSolved; const res = P && P._res;
    if (solvedNow) celebrateStation(P.id, res);
    P = null; machine = null; drawHud();
    $("#world").focus();
  }
  async function engage() {
    const missing = P.fields.filter((f) => answer[f.name] === "");
    if (missing.length) {
      CB.sound("deny");
      return feedback("info", `Set every control first: ${missing.map((f) => esc(f.label)).join(" · ")}`);
    }
    const btn = $("#mc-engage"); btn.disabled = true;
    let res;
    try { res = await call(`${API}/puzzle/${P.id}/submit/`, { answer }); }
    catch (e) { feedback("bad", esc(e.message)); btn.disabled = false; return; }
    btn.disabled = false;
    if (res.format_error) return feedback("info", "ℹ " + esc(res.feedback) + " <span class='tiny'>(Format problems never cost points.)</span>");
    if (!res.correct) {
      CB.sound("bad"); const m = $("#machine"); m.classList.remove("shake"); void m.offsetWidth; m.classList.add("shake");
      feedback("bad", `✗ ${esc(res.feedback)}<br><span class="tiny">Stuck? Press ${CB.icon("lightbulb")} HINT for a guided explanation.</span>`);
      if (machine.wrong) machine.wrong($("#mc-body"), res);
      return;
    }
    CB.sound("good");
    P.solved = true; P.reveal = res.reveal; P.success = res.success; P.answer = res.answer; P._justSolved = !res.already_solved; P._res = res;
    if (machine.solved) machine.solved($("#mc-body"), res);
    if ((res.achievements || []).length) setTimeout(() => badgePop(res.achievements), 900);
    await loadState();
    solvedState(res);
    refreshInventory(true);
  }
  /* ---------------- "Badge unlocked!" celebration ---------------- */
  const BADGE_CHEERS = ["Congratulations, you earned it!", "Amazing work, agent! This one is yours.", "Look at that shine! Well deserved.", "Brilliant! Another badge for your collection."];
  let badgeQueue = Promise.resolve();
  function badgePop(list) {
    list.forEach((a, i) => { badgeQueue = badgeQueue.then(() => showBadge(a, i)); });
    return badgeQueue;
  }
  function showBadge(a, i) {
    return new Promise((resolve) => {
      const el = document.createElement("div");
      el.className = "badge-pop"; el.setAttribute("role", "dialog"); el.setAttribute("aria-modal", "true"); el.setAttribute("aria-labelledby", "bp-t");
      const sparks = Array.from({ length: 18 }, (_, k) => `<i style="--a:${k * 20}deg;--d:${(k % 3) * 0.15}s"></i>`).join("");
      el.innerHTML = `<div class="bp-card">
          <p class="bp-k" id="bp-t">BADGE UNLOCKED!</p>
          <div class="bp-medal"><span class="bp-sparks" aria-hidden="true">${sparks}</span><span class="bp-ic">${CB.icon(a.icon || "medal")}</span></div>
          <h3 class="bp-name">${esc(a.name)}</h3>
          <p class="bp-cond">${esc(a.condition || "")}</p>
          <p class="nova-line"><span class="nova-face" aria-hidden="true"></span><span>“${BADGE_CHEERS[(i + a.name.length) % BADGE_CHEERS.length]}”</span></p>
          <button type="button" class="pxbtn go" id="bp-ok">AWESOME ▶</button>
        </div>`;
      document.body.appendChild(el);
      CB.sound("badge"); setTimeout(() => CB.sound("unlock"), 350);
      const prevPaused = W.state.paused; W.state.paused = true;
      const done = () => {
        el.classList.add("out"); document.removeEventListener("keydown", onKey, true);
        setTimeout(() => { el.remove(); if (!ui.machineOpen && !ui.dialog) W.state.paused = prevPaused; resolve(); }, 250);
      };
      const onKey = (e) => { if (["Enter", " ", "Escape"].includes(e.key)) { e.preventDefault(); e.stopPropagation(); done(); } };
      document.addEventListener("keydown", onKey, true);
      $("#bp-ok", el).onclick = done;
      setTimeout(() => $("#bp-ok", el).focus(), 60);
    });
  }
  function solvedState(res) {
    const m = $("#machine"); m.classList.add("solved");
    const st = $("#mc-stamp"); st.classList.remove("hidden");
    if (!res) st.textContent = "SOLVED";
    else st.textContent = "ACCESS GRANTED";
    const bd = res && res.breakdown;
    feedback("good", `✓ ${esc(P.success || (res && res.success) || "Solved")}` +
      (bd ? `<div class="score-line">+${bd.points} pts${res.room_bonus ? ` · ROOM BONUS +${res.room_bonus}` : ""}</div>` : P.progress ? `<div class="score-line">${P.progress.points} pts earned</div>` : "") +
      `<div class="reveal" id="mc-reveal">${revealHtml(P.reveal)}</div>`);
    if (P.id === "r4_round" && P.reveal && P.reveal.trace) CB.renderTrace($("#dec-trace"), Object.assign({ mode: "decrypt" }, P.reveal.trace));
    $("#mc-foot").classList.add("done");
    const btn = $("#mc-engage"); btn.textContent = "CONTINUE ▶"; btn.classList.add("ready"); btn.onclick = closeMachine;
    setTimeout(() => btn.focus(), 50);
  }
  function feedback(kind, html) { const f = $("#mc-feedback"); f.className = "mc-feedback show " + kind; f.innerHTML = html; f.scrollIntoView({ block: "nearest" }); }

  function revealHtml(rv) {
    if (!rv) return "";
    const v = (label, x) => x && x.hex ? `<p><b>${label}</b> <span class="mono">${x.hex}</span> ${CB.copyBtn(x.hex)}<br><span class="mono tiny">${CB.group(x.bin, x.bits === 48 ? 6 : x.bits === 56 || x.bits === 28 ? 7 : 4)}</span></p>` : "";
    switch (P.id) {
      case "r1_ascii": return `<p><b>Your 64-bit block</b> <span class="hexline">${rv.hex}</span></p>`;
      case "r1_block": return `<div class="bytes small">${rv.bytes.map((b) => `<div class="byte"><b>${b.hex}</b><span class="bn">${b.bin}</span></div>`).join("")}</div>`;
      case "r1_ip_bit": return v("Block after IP", rv.ip);
      case "r1_split": return `<p class="hexline"><span class="l">L0 = ${rv.l0.hex}</span> <span class="r">R0 = ${rv.r0.hex}</span></p>`;
      case "r2_parity": return `<p>Parity positions ${rv.parity_positions.join(", ")} hold <span class="mono">${rv.parity_bits}</span>. PC-1 drops them.</p>`;
      case "r2_pc1_bit": return v("PC-1 output (56 bits)", rv.pc1);
      case "r2_split": return v("C0", rv.c0) + v("D0", rv.d0);
      case "r2_shift": return v(`C${rv.round || ""} after the rotations`, rv.c) + v(`D${rv.round || ""} after the rotations`, rv.d);
      case "r2_pc2": return v(`Round key K${rv.round}`, rv.subkey);
      case "r2_cycle": return `<p>All 16 round keys forged:</p><div class="keycarts small">${rv.subkeys.map((k, i) => `<span class="kcart"><b>K${i + 1}</b><small>${k}</small></span>`).join("")}</div>`;
      case "r3_expand": return v("E(R): 48 bits", rv.expanded);
      case "r3_xor": return v("E(R) ⊕ K: 48 bits", rv.xor);
      case "r3_sbox": case "r3_sbox_bonus": return CB.sboxCards([rv.sbox]);
      case "r3_perm": return v("F(R, K) = P(S-output)", rv.p_output);
      case "r3_feistel": return `<p class="hexline"><span class="l">L = ${rv.l.hex}</span> <span class="r">R = ${rv.r.hex}</span></p>`;
      case "r3_swap": return v("Pre-output R16‖L16", rv.preoutput) + `<p><b>${DEC ? "Plaintext" : "Ciphertext"} after IP⁻¹</b> <span class="hexline">${rv.output.hex}</span> ${CB.copyBtn(rv.output.hex)}</p>`;
      case "r4_order": return `<p class="mono">${rv.order.map((k) => "K" + k).join(" → ")}</p>`;
      case "r4_round": return `<p>All 16 decryption rounds:</p><div id="dec-trace"></div>`;
      case "r4_code": return v("Recovered plaintext", rv.plain) + `<p>${DEC ? "Secret message" : "Exit code"} <b class="hexline">${esc(P.answer ? P.answer.code : "")}</b></p>`;
      case "r4_verdict": return `<p>DES: historically important and great for learning, but its 56-bit key makes it unsafe for real data today. Use AES-GCM or ChaCha20-Poly1305.</p>`;
    }
    return "";
  }

  /* After closing a freshly solved machine: sparks at the station, maybe open the gate. */
  async function celebrateStation(pid, res) {
    const s = W.SCENES[room] && W.SCENES[room].stations.find((x) => x.id === pid);
    if (s) { const [x, y] = W.stationCenter(s); W.burst(x, y - 6, ["#47f59a", "#ffffff", "#34e0ff"], 40, { speed: 70 }); }
    if (!CB.reducedMotion()) W.shake(3);
    if (room === 3) W.state.reactorPower = reactorLevel();
    if (pid === "r3_swap") { W.flash("#47f59a"); W.burst(160, 90, ["#47f59a", "#e8fff4"], 80, { speed: 110 }); }
    if (res && res.room_completed) await roomCleared(res);
    await flowPop(pid);
    if (!(res && res.room_completed)) {
      const r = S.rooms[room - 1], next = r && r.puzzles.find((p) => p.available && !p.solved && !p.optional);
      if (next) bubble(`Next: ${next.title}. Follow the yellow arrow.`);
    }
    if (res && res.escaped) bubble("The exit door is open! Walk through it.");
  }
  /* The DES road map: after each machine, a pop-up says which DES step was just finished
     and which step comes next, so the player always knows where they are in the algorithm. */
  const DES_FLOW = [
    { g: "Plaintext", steps: [["r1_ascii", "Text → hex"], ["r1_block", "64-bit block"], ["r1_ip_bit", "IP"], ["r1_split", "L0 | R0"]] },
    { g: "Key schedule", steps: [["r2_parity", "56-bit key"], ["r2_pc1_bit", "PC-1"], ["r2_split", "C0 | D0"], ["r2_shift", "Shifts"], ["r2_pc2", "PC-2"], ["r2_cycle", "16 keys"]] },
    { g: "Encryption round", steps: [["r3_expand", "E"], ["r3_xor", "⊕ key"], ["r3_sbox", "S-boxes"], ["r3_perm", "P"], ["r3_feistel", "Feistel"], ["r3_swap", "16 rounds + IP⁻¹"]] },
    { g: "Decryption", steps: [["r4_order", "K16→K1"], ["r4_round", "Decrypt"], ["r4_code", "Plaintext"], ["r4_verdict", "Verdict"]] },
  ];
  if (DEC) {
    DES_FLOW[0] = { g: "Ciphertext", steps: [["r1_ascii", "Bytes → hex"], ["r1_block", "64-bit block"], ["r1_ip_bit", "IP"], ["r1_split", "L0 | R0"]] };
    DES_FLOW[2] = { g: "Decryption round", steps: [["r3_expand", "E"], ["r3_xor", "⊕ key"], ["r3_sbox", "S-boxes"], ["r3_perm", "P"], ["r3_feistel", "Feistel"], ["r3_swap", "16 rounds + IP⁻¹"]] };
    DES_FLOW[3] = { g: "Verify by encrypting", steps: [["r4_order", "K1→K16"], ["r4_round", "Encrypt"], ["r4_code", "Message"], ["r4_verdict", "Verdict"]] };
  }
  const FLOW_DEC = {
    r1_ascii: ["turning the intercepted bytes into <b>16 hex digits</b>", "looking inside that <b>64-bit ciphertext block</b>, byte by byte", "Decryption works on the same 64-bit blocks as encryption."],
    r2_cycle: ["the whole <b>key schedule</b> (all 16 round keys)", "<b>one decryption round</b>, starting with Expansion E (Room 3)", "Decryption needs the very same 16 keys, only used in reverse order."],
    r3_feistel: ["<b>one full decryption round</b> (E, ⊕K, S-boxes, P, Feistel update)", "<b>all 16 rounds</b>, the final swap and <b>IP⁻¹</b>", "Running the round 16 times with K16…K1 produces the plaintext."],
    r3_swap: ["<b>DES decryption</b>: you have the plaintext", "<b>checking it</b> by encrypting again (Room 4)", "Encryption uses the same machine with the keys in normal order."],
    r4_order: ["loading the keys in <b>encryption order (K1 → K16)</b>", "<b>running an encryption round</b>", "Same round function, same steps, only the key order changed."],
    r4_round: ["the <b>16 encryption rounds</b>: the intercepted ciphertext came back, so your decryption was right", "<b>reading the secret message</b>", "Turn the plaintext bytes you decrypted into characters."],
    r4_code: ["<b>decryption</b>: the secret message is readable", "the <b>security verdict</b>", "Why is DES no longer safe to use today?"],
  };
  const FLOW = {
    r1_ascii: ["turning the access code into <b>16 hex digits</b>", "looking inside that <b>64-bit block</b>, byte by byte", "Every DES step works on these 64 bits, so you need to be able to read them."],
    r1_block: ["reading the <b>64-bit block</b>", "the <b>Initial Permutation (IP)</b>", "IP is the very first operation DES applies to the block."],
    r1_ip_bit: ["the <b>Initial Permutation</b>", "<b>splitting the block into L0 and R0</b>", "The 16 rounds always work on a left half and a right half of 32 bits each."],
    r1_split: ["preparing the data block (IP, then L0 | R0)", "the <b>key</b>: where the 16 round keys come from (Room 2)", "Every round needs its own 48-bit key, so DES builds them before the rounds start."],
    r2_parity: ["finding the <b>8 parity bits</b> (only 56 key bits count)", "<b>PC-1</b>, which drops those parity bits and shuffles the other 56", "PC-1 is the first step of the key schedule."],
    r2_pc1_bit: ["<b>PC-1</b> (64 → 56 bits)", "<b>splitting the 56 bits into C0 and D0</b>", "The two 28-bit halves are rotated separately."],
    r2_split: ["splitting the key into <b>C0 and D0</b>", "the <b>left circular shifts</b>", "Each round rotates C and D by 1 or 2 places, so every round key is different."],
    r2_shift: ["the <b>circular shifts</b>", "<b>PC-2</b>, which picks 48 bits for this round's key", "PC-2 turns the 56 shifted bits into the 48-bit round key Kᵢ."],
    r2_pc2: ["<b>PC-2</b> (56 → 48 bits = one round key)", "<b>repeating shift + PC-2 sixteen times</b>", "That gives all 16 round keys, K1 to K16."],
    r2_cycle: ["the whole <b>key schedule</b> (all 16 round keys)", "<b>one encryption round</b>, starting with Expansion E (Room 3)", "Now that the keys exist, the data block can go through the rounds."],
    r3_expand: ["<b>Expansion E</b> (R: 32 → 48 bits)", "<b>XOR with the round key</b>", "E made R the same size as the 48-bit key, so they can be XORed."],
    r3_xor: ["the <b>XOR with the round key</b>", "the <b>S-boxes</b>", "The S-boxes shrink the 48 bits back to 32 and add the non-linearity that makes DES hard to break."],
    r3_sbox: ["the <b>S-box substitution</b> (48 → 32 bits)", "the <b>permutation P</b>", "P spreads the S-box outputs across all 32 bits."],
    r3_perm: ["<b>P</b>, the last part of the f-function", "the <b>Feistel update</b>", "Now L and R get updated: new L = old R, new R = old L ⊕ f(R, K)."],
    r3_feistel: ["<b>one full round</b> (E, ⊕K, S-boxes, P, Feistel update)", "<b>all 16 rounds</b>, the final swap and <b>IP⁻¹</b>", "Running the same round 16 times with K1…K16 produces the ciphertext."],
    r3_swap: ["<b>DES encryption</b>: you have the ciphertext", "<b>decryption</b> (Room 4)", "Decryption uses the same machine with the keys in reverse order."],
    r4_order: ["loading the keys in <b>reverse order (K16 → K1)</b>", "<b>running a decryption round</b>", "Same round function, same steps, only the key order changed."],
    r4_round: ["the <b>16 decryption rounds</b>", "<b>recovering the plaintext</b> from the hex output", "IP⁻¹ gives back the original 64 bits; now turn them into characters."],
    r4_code: ["<b>decryption</b>: the exit code is back", "the <b>security verdict</b>", "Why is DES no longer safe to use today?"],
    r4_verdict: ["the <b>whole DES algorithm</b>, encryption and decryption", "<b>the exit</b>", "Walk through the exit door to escape!"],
  };
  function flowPop(pid) {
    const f = (DEC && FLOW_DEC[pid]) || FLOW[pid]; if (!f) return Promise.resolve();
    return new Promise((resolve) => {
      const el = $("#flow-pop");
      const chips = DES_FLOW.map((g) => `<div class="fp-group"><span class="fp-g">${g.g}</span><div class="fp-steps">${g.steps.map(([id, name]) => {
        const P2 = S.puzzles ? S.puzzles.find((x) => x.id === id) : null;
        const done = id === pid || (P2 && P2.solved) || S.rooms.some((r) => r.puzzles.some((x) => x.id === id && x.solved));
        const cls = id === pid ? "now" : done ? "done" : "";
        return `<span class="fp-s ${cls}">${id === pid ? "✓ " : ""}${name}</span>`;
      }).join("")}</div></div>`).join("");
      el.innerHTML = `<div class="fp-card"><p class="fp-k">DES ROAD MAP · STEP COMPLETE</p>
        <p class="fp-main">Now that we finished ${f[0]}, we move on to ${f[1]}.</p>
        <p class="fp-why">${f[2]}</p>
        <div class="fp-map">${chips}</div>
        <div class="fp-foot"><button type="button" class="pxbtn go" id="fp-ok">GOT IT ▶</button></div></div>`;
      W.state.paused = true; el.classList.remove("hidden"); CB.sound("open");
      const done = () => { el.classList.add("hidden"); ui.dialog = null; if (!ui.machineOpen) W.state.paused = false; resolve(); };
      ui.dialog = { next: done };
      $("#fp-ok").onclick = done; setTimeout(() => $("#fp-ok").focus(), 30);
    });
  }
  const SUMMARY_DEC = {
    1: "You turned the intercepted bytes into a 64-bit hex block, read its bytes, applied IP, and split it into L0 and R0.",
    3: "You ran a whole decryption round (E, XOR with the key, S-boxes, P, Feistel update), then all 16 rounds with K16 … K1 and the final swap: plaintext!",
    4: "You proved the decryption by encrypting again with K1 … K16, read the secret message, and explained why DES is obsolete.",
  };
  const SUMMARY = {
    1: "You turned the access code into a 64-bit hex block, read its bytes, applied IP, and split it into L0 and R0.",
    2: "You saw why only 56 key bits count, applied PC-1, split C0/D0, rotated the halves, and used PC-2 to forge all 16 round keys.",
    3: "You ran a whole round: E expansion, XOR with the key, S-box lookups, P, and the Feistel update, then all 16 rounds and the final swap.",
    4: "You decrypted with the same keys in reverse order, recovered the plaintext, and explained why DES is obsolete.",
  };
  async function roomCleared(res) {
    const r = S.rooms[room - 1];
    const gate = W.SCENES[room].doors.find((d) => d.y === 0);
    W.state.paused = true;
    banner(`<b>ROOM CLEARED</b><span>${esc(r.name)} · +${res.room_bonus} BONUS · ${r.score} PTS</span>`, 3200, "big");
    CB.sound("unlock"); await sleep(500);
    W.openDoor(gate); CB.sound("door"); W.shake(7);
    W.burst((gate.x + 1) * 16, 18, ["#ffb547", "#47f59a", "#ffffff"], 70, { speed: 90 });
    await sleep(1400);
    W.state.paused = false;
    await say([`<b>Learning check.</b> ${(DEC && SUMMARY_DEC[room]) || SUMMARY[room]}`, room < 4 ? `The gate to <b>${esc(S.rooms[room].name)}</b> is open. Walk through the top door when you're ready.` : "The exit door is open. Walk through it to escape!"]);
    drawHud();
  }

  /* ---------------- Hints ---------------- */
  function hintsHtml(hints, progress) {
    if (!hints || !hints.length) return "";
    const names = ["HINT 1 · CONCEPT", "HINT 2 · SIMILAR EXAMPLE", "HINT 3 · WALKTHROUGH"];
    return hints.map((h, k) => `<div class="hint"><b>${names[k]}</b><p>${esc(h)}</p></div>`).join("") +
      (progress && progress.hint_penalty ? `<p class="tiny muted">Hint penalty on this machine: −${progress.hint_penalty}</p>` : "");
  }
  async function requestHint() {
    if (!ui.machineOpen) { bubble(room ? "Walk up to a glowing machine and press ENTER. Hints live inside each machine (HINT button)." : "Pick a door with a green light. Room 1 is first!"); return; }
    if (P.solved) return feedback("info", "Already solved. Use ? HOW IT WORKS or the Notebook to review.");
    const lvl = (P.progress && P.progress.hint_level) || 0;
    if (lvl >= 3) return feedback("info", "You've seen all three hints. Follow the walkthrough step by step, or replay HOW IT WORKS.");
    if (S.attempt.hint_cost && !confirm(`Hint ${lvl + 1} costs ${[10, 20, 30][lvl]} points on this machine (Challenge mode). Show it?`)) return;
    let res; try { res = await call(`${API}/puzzle/${P.id}/hint/`, {}); } catch (e) { return; }
    P.progress = P.progress || {}; P.progress.hint_level = res.level; P.progress.hint_penalty = (P.progress.hint_penalty || 0) + res.penalty;
    $("#mc-hints").innerHTML = hintsHtml(res.hints, P.progress);
    const last = $$("#mc-hints .hint").pop(); if (last) { last.classList.add("new"); last.scrollIntoView({ block: "nearest", behavior: "smooth" }); }
    CB.sound("scan");
  }

  /* ---------------- Inventory ---------------- */
  const ICONS = { card: "id-card", chip: "cpu", halves: "scissors", key: "key-round", chips: "layers", tape: "cassette-tape", lock: "lock", star: "star" };
  const icon = (it) => CB.icon(ICONS[it.icon] || "package");
  async function refreshInventory(announce) {
    let data; try { data = await CB.api(API + "/inventory/"); } catch (e) { return; }
    const old = inv ? new Set(inv.map((i) => i.id)) : null;
    inv = data.items;
    if (announce && old) {
      const fresh = inv.filter((i) => !old.has(i.id));
      fresh.forEach((it, k) => setTimeout(() => {
        CB.sound("pickup"); banner(`<span class="ico">${icon(it)}</span><b>ITEM ACQUIRED</b><span>${esc(it.name)}</span>`, 2600, "item");
        $("#inv-dot").classList.remove("hidden");
      }, 600 + k * 1800));
    }
  }
  async function showInventory() {
    await refreshInventory(false); $("#inv-dot").classList.add("hidden");
    const m = CB.modal(CB.icon("backpack") + " Inventory", `<p class="tiny muted">Everything you've recovered so far. Values are real DES results from your adventure; copy any of them.</p>
      <div class="inv-grid">${inv.map((it) => `<div class="inv-item"><div class="inv-ico">${icon(it)}</div><div><b>${esc(it.name)}</b><p class="tiny">${esc(it.desc)}</p>
        ${it.values.map(([l, x]) => `<div class="inv-val"><small>${esc(l)}</small><span class="mono">${esc(x)}</span>${CB.copyBtn(x)}</div>`).join("")}</div></div>`).join("")}</div>`);
    m.el.classList.add("game-modal");
  }

  /* ---------------- Archives, briefing, map, notebook, menu ---------------- */
  async function openArchive(kind) {
    let d; try { d = await call(`${API}/archive/${kind}/`); } catch (e) { return; }
    CB.sound("scan");
    const title = kind === "keys" ? CB.icon("archive") + " Key archive: key expansion, round by round"
      : d.mode === "decrypt" ? CB.icon("archive") + " Decryption log, 16 rounds with K16 → K1"
      : CB.icon("archive") + (kind === "encrypt" ? " Round archive, your block's 16 encryption rounds" : " Verification log, 16 encryption rounds with K1 → K16");
    const m = CB.modal(title, `<div id="arch"></div>`); m.el.classList.add("game-modal", "wide");
    if (d.schedule) CB.renderKeySchedule($("#arch", m.el), d.schedule);
    else CB.renderTrace($("#arch", m.el), Object.assign({ mode: d.mode || (kind === "decrypt" ? "decrypt" : "encrypt") }, d.trace));
  }
  let briefingResolve = null;
  const BRIEF_DEC = { 1: ["binary", "Turn the intercepted bytes into a 64-bit block, apply IP, split into L0 and R0."], 3: ["atom", "Expansion, XOR, S-boxes, P and the Feistel update, 16 times with the keys backwards."], 4: ["lock", "Encrypt the result again to prove it, read the message, judge DES's security."] };
  const BRIEF = { 1: ["binary", "Turn the code into a 64-bit block, apply IP, split into L0 and R0."], 2: ["key-round", "Parity bits, PC-1, shifts and PC-2: build all 16 round keys."], 3: ["atom", "Expansion, XOR, S-boxes, P and the Feistel update, 16 times."], 4: ["lock-open", "Use the keys in reverse to decrypt, then judge DES's security."] };
  function briefing() {
    CB.sound("scan");
    const steps = DEC ? ["ciphertext", "IP", "L0 | R0", "16 × round F (K16 → K1)", "swap", "IP⁻¹", "plaintext"] : ["64-bit block", "IP", "L0 | R0", "16 × round F", "swap", "IP⁻¹", "ciphertext"];
    const BR = (n) => (DEC && BRIEF_DEC[n]) || BRIEF[n];
    const m = CB.modal(CB.icon("satellite") + " Mission briefing", `<p>The lab's exits are locked by <b>DES</b>, the Data Encryption Standard (1977). Learn how it works, machine by machine, to escape.${DEC ? " <b>Decrypt mission:</b> decrypt an intercepted message, then prove it by encrypting it again." : ""}</p>
      <div class="pipeline">${steps.map((s, i) => `<span class="pipe-step" style="--i:${i}">${s}</span>`).join("<i>→</i>")}</div>
      <div class="brief-rooms">${S.rooms.map((r) => `<div class="brief-room ${r.status}"><span class="br-ic" aria-hidden="true">${CB.icon(BR(r.n)[0])}</span><b>ROOM ${r.n}</b><span class="br-name">${esc(r.name)}</span><p>${BR(r.n)[1]}</p><small>${r.status === "completed" ? CB.icon("check") + " cleared" : r.status === "locked" ? CB.icon("lock") + " locked" : CB.icon("lock-open") + " open"}</small></div>`).join("")}</div>`, { onClose: () => { if (briefingResolve) { const r = briefingResolve; briefingResolve = null; r(); } } });
    m.el.classList.add("game-modal");
  }
  function showMap() {
    const m = CB.modal(CB.icon("map") + " Facility map", `<div class="map-grid">${S.rooms.map((r) => `<div class="map-room ${r.status}">
      <div class="mr-head"><b>ROOM ${r.n}</b><span>${esc(r.name)}</span><em>${r.status === "completed" ? "✓ CLEARED" : r.status === "locked" ? CB.icon("lock") + " LOCKED" : "● OPEN"}</em></div>
      <ol>${r.puzzles.map((p) => `<li class="${p.solved ? "ok" : p.available ? "av" : "lk"}">${p.solved ? "✓" : p.available ? "●" : CB.icon("lock")} ${esc(p.title)}${p.optional ? " ★" : ""}
        ${p.available || p.solved ? `<button type="button" class="pxbtn tiny ghost" data-use="${p.id}" data-room="${r.n}">USE</button>` : ""}</li>`).join("")}</ol>
      <p class="tiny">${r.solved}/${r.required} solved · ${r.score} pts · ${r.badge_earned ? CB.icon("medal") : "○"} ${esc(r.badge)}</p>
      ${r.status !== "locked" ? `<button type="button" class="pxbtn small" data-go="${r.n}">GO TO ROOM</button>` : `<p class="tiny muted">${esc(r.locked_reason)}</p>`}</div>`).join("")}</div>
      <h3>Achievements</h3><div class="ach-grid">${S.achievements.map((a) => `<div class="ach ${a.earned || S.user_achievements.includes(a.code) ? "on" : ""}"><span>${CB.icon(a.icon)}</span><b>${esc(a.name)}</b><small>${esc(a.condition)}</small></div>`).join("")}</div>`);
    m.el.classList.add("game-modal", "wide");
    $$("[data-go]", m.el).forEach((b) => b.addEventListener("click", () => { m.close(); if (+b.dataset.go !== room) goRoom(+b.dataset.go, room); }));
    $$("[data-use]", m.el).forEach((b) => b.addEventListener("click", async () => {
      m.close(); const n = +b.dataset.room;
      if (n !== room) await goRoom(n, room);
      openPuzzle(b.dataset.use);
    }));
  }
  function showNotebook() {
    const page = P && P.concepts ? P.concepts[0] : "";
    const m = CB.modal(CB.icon("notebook") + " Learning notebook", `<iframe src="${B.notebookUrl}?embed=1&page=${page}" title="Learning notebook"></iframe>`); m.el.classList.add("game-modal", "wide");
  }
  function howTo() {
    const m = CB.modal(CB.icon("circle-help") + " How to play", `<ol class="howto">
      <li><b>Explore.</b> Walk with <kbd>WASD</kbd>/<kbd>arrows</kbd>, or click/tap where you want to go. NOVA follows you.</li>
      <li><b>Use machines.</b> Walk up to a glowing machine and press <kbd>ENTER</kbd> (or click it). The big yellow arrow and the glowing path on the floor always lead to your next goal. Green light = solved, red = locked.</li>
      <li><b>Operate them.</b> Turn dials, flip bit switches, patch cables, rotate disks, drag keys into order, then press <b>${CB.icon("arrow-right")} NEXT</b>.</li>
      <li><b>Learn first.</b> Before every machine NOVA teaches the DES step it uses, with a worked example and a practice question. Replay it any time with the LESSON button.</li>
      <li><b>Follow DES.</b> After each machine, the DES road map shows the step you finished and the step that comes next.</li>
      <li><b>Escape.</b> Clearing a room opens its gate. Clear all four and walk out the exit. Progress saves after every action.</li></ol>
      <div class="btnrow"><button type="button" class="pxbtn" id="ht-onb">↻ Replay the controls tutorial</button></div>`);
    m.el.classList.add("game-modal");
    $("#ht-onb", m.el).onclick = () => { m.close(); onboarding(true); };
  }
  async function openExplorer() {
    if (B.mode === "challenge" && S.attempt.status === "active" && S.attempt.independent) {
      if (!confirm("The DES Explorer shows complete DES calculations, which could reveal answers.\n\nIf you open it now, this attempt will be recorded as practice (not an independent challenge result). Continue?")) return;
      try { await call(API + "/flag/", {}); } catch (e) { /* continue */ }
      await loadState();
    }
    window.open(B.labUrl + (B.mode === "challenge" ? "?confirm=1" : ""), "_blank", "noopener");
  }
  function pauseMenu() {
    W.state.paused = true;
    const m = CB.modal(CB.icon("pause") + " Paused", `<div class="pause-menu">
      <button type="button" class="pxbtn go" data-close>▶ RESUME</button>
      <button type="button" class="pxbtn" data-a="how">${CB.icon("circle-help")} HOW TO PLAY</button>
      <button type="button" class="pxbtn" data-a="map">${CB.icon("map")} MAP &amp; ACHIEVEMENTS</button>
      <button type="button" class="pxbtn" data-a="inv">${CB.icon("backpack")} INVENTORY</button>
      <button type="button" class="pxbtn" data-a="notes">${CB.icon("notebook")} NOTEBOOK</button>
      <button type="button" class="pxbtn" data-a="lab">${CB.icon("microscope")} DES EXPLORER</button>
      <button type="button" class="pxbtn ghost" data-a="title">⟲ TITLE SCREEN</button>
      <button type="button" class="pxbtn ghost" data-a="restart">↻ NEW ADVENTURE</button>
      <a class="pxbtn ghost" href="${B.dashboardUrl}">⟵ SAVE &amp; QUIT TO DASHBOARD</a></div>
      <p class="tiny muted">${esc(S.attempt.label)} · progress is saved automatically.</p>`, { onClose: () => { if (!ui.machineOpen && !ui.dialog) W.state.paused = false; } });
    m.el.classList.add("game-modal", "narrow");
    $$("[data-a]", m.el).forEach((b) => b.addEventListener("click", () => {
      const a = b.dataset.a; m.close();
      ({ how: howTo, map: showMap, inv: showInventory, notes: showNotebook, lab: openExplorer, title: showTitle,
        restart: () => { if (S.attempt.status !== "active" || confirm("Start a new adventure with new values? This unfinished attempt will be closed (results stay in your history).")) $("#restart-form").submit(); } })[a]();
    }));
  }

  /* ---------------- Lessons (teach before the challenge) ---------------- */
  function startLesson(auto) {
    const steps = Lessons.build(P); if (!steps) return;
    const m = $("#machine"), el = $("#mc-lesson"); let i = 0, ok = false;
    m.classList.add("lesson-mode"); el.classList.remove("hidden"); $("#machine").scrollTop = 0;
    const finish = () => {
      m.classList.remove("lesson-mode"); el.classList.add("hidden"); el.innerHTML = "";
      if (!tutDone.has("p_" + P.id)) { tutDone.add("p_" + P.id); CB.api(`/api/tutorial/p_${P.id}/`, {}).catch(() => {}); }
      const first = $("#mc-body button, #mc-body .dial"); if (first) first.focus();
    };
    const draw = () => {
      const s = steps[i]; ok = !s.practice;
      el.innerHTML = `<div class="lx-head"><span class="lx-kick">LEARN FIRST · ${i + 1} / ${steps.length}</span><div class="lx-dots">${steps.map((_, k) => `<i class="${k < i ? "done" : k === i ? "cur" : ""}"></i>`).join("")}</div></div>
        <div class="lx-card"><span class="nova-face" aria-hidden="true"></span><div class="lx-content"><h3>${s.t}</h3>${s.h}
        ${s.practice ? `<div class="lx-practice"><label for="lx-in">${s.practice.q}</label>${s.practice.fmt ? `<p class="lx-fmt">${CB.icon("pencil")} Type ${s.practice.fmt}</p>` : ""}<div><input id="lx-in" autocomplete="off" spellcheck="false" placeholder="${s.practice.ph || ""}"><button type="button" class="pxbtn small" id="lx-check">CHECK</button></div><p class="lx-res" id="lx-res" aria-live="polite"></p></div>` : ""}</div></div>
        <div class="lx-btns"><button type="button" class="pxbtn ghost small" id="lx-skip">SKIP LESSON</button><span class="grow"></span>
        ${i ? '<button type="button" class="pxbtn ghost" id="lx-back">◀ BACK</button>' : ""}
        <button type="button" class="pxbtn go" id="lx-next" ${ok ? "" : "disabled"}>${s.last ? "TRY IT ▶" : "NEXT ▶"}</button></div>`;
      $("#lx-skip").onclick = finish;
      if ($("#lx-back")) $("#lx-back").onclick = () => { i--; draw(); };
      $("#lx-next").onclick = () => { if (i >= steps.length - 1) finish(); else { i++; draw(); } };
      if (s.practice) {
        let tries = 0;
        const check = () => {
          const v = $("#lx-in").value.replace(/\s+/g, "").toUpperCase(), res = $("#lx-res");
          tries++;
          if (s.practice.a.map((x) => String(x).toUpperCase()).includes(v)) { res.className = "lx-res good"; res.textContent = "✓ Correct! " + (s.practice.why || ""); $("#lx-next").disabled = false; $("#lx-next").focus(); CB.sound("good"); }
          else {
            const specific = s.practice.wrong && s.practice.wrong[v];
            res.className = "lx-res bad";
            res.textContent = tries >= 2 ? `Not quite. The answer is ${s.practice.a[0]}. ${s.practice.why || ""}` : `Not quite. ${specific || s.practice.hint || "Read the example above again and try once more."}`;
            if (tries >= 2) $("#lx-next").disabled = false; CB.sound("bad");
          }
        };
        $("#lx-check").onclick = check;
        $("#lx-in").addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); check(); } e.stopPropagation(); });
        setTimeout(() => $("#lx-in").focus(), 30);
      } else setTimeout(() => $("#lx-next").focus(), 30);
    };
    draw();
  }


  /* ---------------- Intro + onboarding ---------------- */
  async function intro() {
    W.state.forcedHint = null;
    W.state.alarm = true; CB.sound("alarm");
    const flash = setInterval(() => { W.flash("#ff3050"); }, 900);
    await say([CB.icon("triangle-alert") + " <b>EMERGENCY LOCKDOWN!</b>",
      "An experiment triggered the lab's cipher locks. Every exit is sealed.",
      "Hello! I'm <b>NOVA</b>, the lab's research assistant. Four security systems control the exit:",
      "the <b>Hex Gate</b>, the <b>Key Vault</b>, the <b>Round Reactor</b> and the <b>Final Decryption Chamber</b>.",
      "Each one is protected by <b>DES</b>, a classic block cipher. Learn how it works, and you walk out of here."]);
    clearInterval(flash); W.state.alarm = false;
    CB.api(API + "/intro/", {}).catch(() => {});
    if (!B.preTaken) {
      await new Promise((resolve) => {
        const m = CB.modal("Optional pre-assessment", `<p>Before Room 1 you can take a 7-question check of what you already know about DES. It's optional, takes about 3 minutes, and shows you what you learned afterwards.</p>
          <div class="btnrow"><a class="pxbtn go" href="${B.preUrl}">TAKE IT NOW</a><button type="button" class="pxbtn ghost" data-close>SKIP FOR NOW</button></div>`, { onClose: resolve });
        m.el.classList.add("game-modal", "narrow");
      });
    }
  }
  async function onboarding(replay) {
    await say(["I'll float beside you the whole way. Let's learn the controls.",
      "Move with <b>WASD</b> or the <b>arrow keys</b>. You can also <b>click or tap</b> the floor to walk there."]);
    if (!W.state._moved || replay) {
      W.state._moved = false;
      banner("<b>MOVE</b><span>WASD · ARROWS · CLICK THE FLOOR</span>", 0, "tip");
      await new Promise((r) => { const h = () => r(); W.on("firstmove", h); });
      $("#banner").classList.add("hidden");
    }
    W.state.forcedHint = "info"; updateHint();
    await say("Nice moves! Machines glow when you can use them. Walk to the <b>holotable</b> in the middle (follow the yellow arrow) and press <b>E</b>, or just click it.");
    banner("<b>USE</b><span>WALK UP · PRESS ENTER · OR CLICK</span>", 0, "tip");
    await new Promise((r) => (briefingResolve = r));
    $("#banner").classList.add("hidden");
    W.state.forcedHint = null; updateHint();
    await say(["Doors: <b>red</b> light = locked, <b>green</b> = open. Room 1, the <b>Hex Gate</b>, is the first door on the left.",
      "The top bar shows your score and escape progress, plus <b>hints (H)</b>, <b>items (I)</b>, <b>map (M)</b>, <b>notebook (N)</b> and the <b>menu (Esc)</b>.",
      "Before each machine I'll teach you the DES step it uses, then you try it yourself. Follow the <b>yellow arrow</b>. Let's go!"]);
    tutDone.add("onboarding"); CB.api("/api/tutorial/onboarding/", {}).catch(() => {});
    drawHud();
  }

  /* ---------------- Escape ---------------- */
  async function escapeSequence() {
    const st = W.state; st.transitioning = true; st.paused = true; mode = "escape";
    CB.sound("unlock"); W.flash("#ffffff"); st.fadeTarget = 1; await sleep(700);
    await loadState();
    const a = S.attempt, earned = S.achievements.filter((x) => x.earned);
    const el = document.createElement("div"); el.className = "escape-screen"; el.setAttribute("role", "dialog"); el.setAttribute("aria-labelledby", "esc-h");
    el.innerHTML = `<div class="esc-inner"><p class="t-kicker">LOCKDOWN LIFTED</p><h1 id="esc-h" class="t-logo small"><span>YOU</span><span>ESCAPED!</span></h1>
      <div class="esc-stats"><div><b>${a.score}</b><small>FINAL SCORE</small></div><div><b>${Math.max(1, Math.round(a.active_seconds / 60))} min</b><small>ACTIVE TIME</small></div>
        <div><b>${S.rooms.filter((r) => r.status === "completed").length}/4</b><small>ROOMS</small></div><div><b>${a.hints_used}</b><small>HINTS</small></div><div><b>${a.mistakes}</b><small>MISTAKES</small></div></div>
      <div class="ach-grid">${earned.map((x) => `<div class="ach on"><span>${CB.icon(x.icon)}</span><b>${esc(x.name)}</b></div>`).join("")}</div>
      <p>You are a <b>DEScape Graduate</b>. Remember: understanding DES ≠ DES being secure. Use modern authenticated encryption (AES-GCM, ChaCha20-Poly1305) for real data.</p>
      <div class="btnrow center">
        <form method="post" action="/adventure/new/"><input type="hidden" name="csrfmiddlewaretoken" value="${CB.csrf()}"><input type="hidden" name="mode" value="${B.mode === "demo" ? "guided" : B.mode}"><button class="pxbtn go">↻ PLAY AGAIN (NEW VALUES)</button></form>
        <a class="pxbtn" href="${B.resultsUrl}">${CB.icon("chart-column")} MY RESULTS</a>
        ${B.mode !== "demo" ? `<a class="pxbtn amber" href="${B.postUrl}">${CB.icon("clipboard-list")} POST-ASSESSMENT</a>` : ""}
        <button type="button" class="pxbtn ghost" id="esc-stay">KEEP EXPLORING</button>
        <a class="pxbtn ghost" href="${B.dashboardUrl}">DASHBOARD</a></div></div>`;
    document.body.appendChild(el);
    W.confetti(); st.fadeTarget = 0.4;
    $("#esc-stay", el).onclick = () => { el.remove(); st.fadeTarget = 0; st.transitioning = false; st.paused = false; mode = "play"; W.load(4); W.state.player.y = 140; };
    $("button, a", el).focus();
  }

  /* ---------------- Title screen ---------------- */
  function showTitle() {
    mode = "title"; W.state.paused = true;
    $("#title").classList.remove("hidden"); $("#game").classList.add("on-title");
    const a = S && S.attempt;
    $("#t-start").textContent = !a || !a.intro_seen ? "▶ NEW GAME" : a.status === "completed" ? "▶ CONTINUE (ESCAPED)" : "▶ CONTINUE";
    drawSound(); setTimeout(() => $("#t-start").focus(), 50);
  }
  async function startFromTitle() {
    if (mode !== "title") return;
    $("#title").classList.add("hidden"); $("#game").classList.remove("on-title");
    CB.sound("open"); if (CB.settings.music) CB.music.start();
    mode = "play"; W.state.paused = false;
    const pos = S.attempt.position || {}, forced = +new URLSearchParams(location.search).get("room");
    room = forced && S.rooms[forced - 1] ? forced : pos.room || 0;
    if (W.state.scene !== room || !started) W.load(room);
    started = true;
    W.state.reactorPower = room === 3 ? reactorLevel() : 0;
    drawHud();
    if (!S.attempt.intro_seen) { room = 0; W.load(0); drawHud(); await intro(); }
    if (!tutDone.has("onboarding") && B.mode !== "demo" && room === 0) await onboarding();
    else if (room && !tutDone.has("room" + room)) await roomIntro(room);
    else bubble(S.attempt.status === "completed" ? "You already escaped! Explore, replay machines, or open the menu." : room ? ROOM_HELLO[room] : "Welcome back! Follow the yellow arrow.");
  }
  let started = false;

  /* ---------------- Sound toggles ---------------- */
  function drawSound() {
    const on = !!CB.settings.sound, b = $("#b-mute");
    b.querySelector("span").innerHTML = CB.icon(on ? "volume-2" : "volume-x"); b.querySelector("b").textContent = on ? "SOUND ON" : "MUTED";
    b.setAttribute("aria-pressed", String(!on)); b.classList.toggle("muted", !on);
  }
  // One switch for all audio: sound effects and the background music together.
  const toggleMute = () => {
    const on = !CB.settings.sound; CB.settings.sound = on; CB.settings.music = on; CB.saveSettings();
    if (on && mode !== "title") CB.music.start(); else if (!on) CB.music.stop();
    drawSound(); CB.sound("click");
  };

  /* ---------------- Main loop ---------------- */
  let last = performance.now(), stepAcc = 0;
  function frame(now) {
    const dt = Math.min(0.05, (now - last) / 1000); last = now;
    if (mode === "title") W.renderTitle(dt);
    else {
      W.update(dt); W.render(); placeBubble(); placeNextTag();
      if (W.state.player.moving) { stepAcc += dt; if (stepAcc > 0.28) { stepAcc = 0; CB.sound("step"); } }
    }
    requestAnimationFrame(frame);
  }

  /* ---------------- Keyboard ---------------- */
  function modalOpen() { return !!document.querySelector(".modal-back") || (CB.tutorialActive && CB.tutorialActive()); }
  document.addEventListener("keydown", (e) => {
    const k = e.key.toLowerCase();
    if (mode === "title") { if (k === "enter" && (document.activeElement === document.body || document.activeElement === $("#t-start"))) { e.preventDefault(); startFromTitle(); } return; }
    if (mode !== "play" || modalOpen()) return;
    if (ui.dialog) { if ((k === "enter" || k === " ") && !(document.activeElement && document.activeElement.closest("#dialog"))) { e.preventDefault(); ui.dialog.next(); } return; }
    if (ui.machineOpen) {
      if (k === "escape") { e.preventDefault(); closeMachine(); }
      else if (k === "h" && !e.target.closest(".dial, input, textarea")) requestHint();
      return;
    }
    if (["arrowup", "arrowdown", "arrowleft", "arrowright", " "].includes(k)) e.preventDefault();
    if ((k === "e" || k === "enter" || k === " ") && W.state.focus) { e.preventDefault(); interact({ type: "station", s: W.state.focus }); }
    else if (k === "i") showInventory();
    else if (k === "m") showMap();
    else if (k === "n") showNotebook();
    else if (k === "h") requestHint();
    else if (k === "escape") pauseMenu();
  });
  // On-screen pad for touch screens
  $$("#touchpad button").forEach((b) => {
    const k = b.dataset.k;
    const down = (e) => { e.preventDefault(); if (k === "e") { if (W.state.focus) interact({ type: "station", s: W.state.focus }); return; } W.state.keys[k] = true; };
    const up = () => { W.state.keys[k] = false; };
    b.addEventListener("pointerdown", down); b.addEventListener("pointerup", up); b.addEventListener("pointerleave", up);
  });

  /* ---------------- Boot ---------------- */
  async function boot() {
    W.init($("#world"));
    W.onFit = (s) => $("#stage").style.setProperty("--s", s);
    W.fit();
    $("#b-hint").onclick = requestHint; $("#b-inv").onclick = showInventory; $("#b-map").onclick = showMap;
    $("#b-notes").onclick = showNotebook; $("#b-menu").onclick = pauseMenu;
    $("#b-mute").onclick = toggleMute;
    $("#t-start").onclick = startFromTitle; $("#t-how").onclick = howTo;
    $("#mc-close").onclick = closeMachine; $("#mc-hint").onclick = requestHint; $("#mc-tut").onclick = () => P && startLesson(false);
    $("#machine-back").addEventListener("click", (e) => { if (e.target.id === "machine-back") closeMachine(); });
    if ("ontouchstart" in window) $("#game").classList.add("touch");
    requestAnimationFrame(frame);
    try { await loadState(); } catch (e) { $("#t-start").disabled = true; $(".t-press").textContent = "Could not load your adventure: " + e.message; return; }
    refreshInventory(false);
    W.load(0);
    showTitle();
    if (new URLSearchParams(location.search).get("skiptitle") === "1") startFromTitle();
  }
  document.addEventListener("DOMContentLoaded", boot);
})();
