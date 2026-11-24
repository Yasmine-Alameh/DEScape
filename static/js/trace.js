/* Renders DES traces produced by des_engine (shared by the Lab, the game and demo mode). */
(function () {
  "use strict";
  const CB = (window.CB = window.CB || {});
  const esc = (s) => CB.esc(s);

  function val(v, opts) {
    opts = opts || {};
    if (!v) return "";
    const showBin = opts.bin !== false;
    return `<span>${esc(v.hex)}</span>${CB.copyBtn(v.hex)} <span class="muted small">(${v.bits} bits)</span>` +
      (showBin ? `<span class="bin">${esc(CB.group(v.bin, opts.group || (v.bits === 48 ? 6 : 4)))}</span>` : "");
  }
  CB.val = val;

  function row(label, v, explain, id, opts) {
    return `<tr${id ? ` data-anim="${id}"` : ""}><td>${label}${explain ? `<div class="explain">${explain}</div>` : ""}</td><td class="v">${typeof v === "string" ? v : val(v, opts)}</td></tr>`;
  }

  function sboxCards(sboxes) {
    return `<div class="sbox-details">` + sboxes.map((s) => `
      <div class="sbox-card"><b>S${s.box}</b> in <span>${s.input}</span><br>
      row <span class="r">${s.row_bits}</span>=${s.row}, col <span class="c">${s.col_bits}</span>=${s.col}<br>
      S${s.box}[${s.row}][${s.col}] = ${s.value} → <b>${s.output}</b></div>`).join("") + `</div>`;
  }
  CB.sboxCards = sboxCards;

  /* Full encryption/decryption trace with a round selector. */
  CB.renderTrace = function (el, t, opts) {
    opts = opts || {};
    const dec = t.mode === "decrypt";
    let current = opts.round || 1;
    el.innerHTML = `
      <div class="table-wrap"><table class="trace-table">
        ${t.mode ? row(dec ? "Ciphertext input" : "Plaintext input", t.input, "64-bit block, 16 hex digits.") : row("Input block", t.input)}
        ${t.key ? row("Key", t.key, "64 bits written; 56 effective (parity bits 8, 16, …, 64 ignored).") : ""}
        ${opts.hideStart ? "" : row("After IP", t.ip, "Initial Permutation: bit positions rearranged, values unchanged.")}
        ${opts.hideStart ? "" : row("L0 | R0", `<span class="hexline"><span class="l">${t.l0.hex}</span> <span class="r">${t.r0.hex}</span></span>`, "The IP output split into two 32-bit halves.")}
      </table></div>
      <h3 style="margin-top:14px">Round <span data-rn>${current}</span> of 16 ${dec ? "(decryption: keys applied K16 → K1)" : ""}</h3>
      <div class="round-tabs" role="tablist" aria-label="Select round">${t.rounds.map((r) =>
        `<button type="button" role="tab" data-round="${r.round}" aria-selected="${r.round === current}">${r.round}</button>`).join("")}</div>
      <div class="btn-row"><button type="button" class="btn btn-sm" data-prev>◀ Previous</button>
        <button type="button" class="btn btn-sm" data-next>Next ▶</button>
        <button type="button" class="btn btn-sm btn-teal" data-replay>▶ Replay round animation</button>
        <button type="button" class="btn btn-sm hidden" data-pause>❚❚ Pause</button>
        <label class="anim-speed small">Speed <select data-speed aria-label="Animation speed"><option value="3000">Slow (3 s per step)</option><option value="2000" selected>Normal (2 s per step)</option><option value="1000">Fast (1 s per step)</option></select></label></div>
      <p class="anim-cap hidden" data-cap aria-live="polite"></p>
      <div data-round-body></div>
      ${t.preoutput ? `<h3 style="margin-top:14px">Finish</h3><div class="table-wrap"><table class="trace-table">
        ${row("Final swap R16 ‖ L16", t.preoutput, "The last round's halves are exchanged before IP⁻¹.")}
        ${row("After IP⁻¹ = output", t.output, dec ? "The recovered plaintext." : "The ciphertext.")}
      </table></div>` : ""}`;
    const body = el.querySelector("[data-round-body]");

    function draw() {
      if (typeof stopAnim === "function" && anim) stopAnim();
      const r = t.rounds[current - 1];
      const i = r.round;
      el.querySelector("[data-rn]").textContent = i;
      el.querySelectorAll("[data-round]").forEach((b) => {
        const on = +b.dataset.round === current; b.classList.toggle("active", on); b.setAttribute("aria-selected", on);
      });
      body.innerHTML = `<div class="flow" aria-hidden="true">${["L,R in", "E", "⊕ K", "S-boxes", "P", "⊕ L", "L,R out"].map((n, k) =>
        `<span class="node" data-node="${k}">${n}</span>${k < 6 ? '<span class="arrow">→</span>' : ""}`).join("")}</div>
      <div class="table-wrap"><table class="trace-table">
        ${i === 1 && opts.hideStart ? row("After IP (start of round 1)", t.ip, "Initial Permutation of the input block; its two halves are L0 and R0 below.") : ""}
        ${row(`L${i - 1} (left in)`, r.l_in, "", "0")}
        ${row(`R${i - 1} (right in)`, r.r_in, "", "0")}
        ${row(`Round key K${r.key_index}`, r.subkey, dec ? `Decryption round ${i} uses K${r.key_index} (= K17−${i}).` : "48-bit subkey from the key schedule.", "2", { group: 6 })}
        ${row(`E(R${i - 1})`, r.expanded, "Expansion: 32 → 48 bits (edge bits repeated).", "1", { group: 6 })}
        ${row(`E(R) ⊕ K${r.key_index}`, r.xor, "XOR: 1 where the bits differ. Split into 8 groups of 6 for the S-boxes.", "2", { group: 6 })}
        <tr data-anim="3"><td>S-box substitutions<div class="explain">Each 6-bit group → row (bits 1,6), column (bits 2–5) → 4 bits.</div></td>
          <td class="v"><details ${opts.openSboxes ? "open" : ""}><summary>Show the 8 S-box lookups</summary>${sboxCards(r.sboxes)}</details></td></tr>
        ${row("S-box output", r.s_output, "Eight 4-bit outputs joined: 32 bits.", "3")}
        ${row("P permutation = F(R, K)", r.p_output, "P scatters the S-box bits (diffusion).", "4")}
        ${row(`L${i} = R${i - 1}`, r.l_out, "", "6")}
        ${row(`R${i} = L${i - 1} ⊕ F`, r.r_out, "Feistel XOR with the old left half.", "5")}
      </table></div>`;
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-round]");
      if (b) { current = +b.dataset.round; draw(); }
      if (e.target.closest("[data-prev]") && current > 1) { current--; draw(); }
      if (e.target.closest("[data-next]") && current < 16) { current++; draw(); }
      if (e.target.closest("[data-replay]")) replay();
      if (e.target.closest("[data-pause]")) togglePause();
    });
    /* Round animation: one step every ~2 s (speed selectable). Each row's value appears when its step lights up. */
    const STEP_TEXT = [
      (r) => `Step 1 of 7 · The round starts with L${r.round - 1} = ${r.l_in.hex} and R${r.round - 1} = ${r.r_in.hex}.`,
      (r) => `Step 2 of 7 · Expansion E: R${r.round - 1} (32 bits) becomes ${r.expanded.hex} (48 bits).`,
      (r) => `Step 3 of 7 · XOR with round key K${r.key_index} = ${r.subkey.hex} gives ${r.xor.hex}.`,
      (r) => `Step 4 of 7 · Eight S-boxes turn 48 bits into 32: ${r.s_output.hex}.`,
      (r) => `Step 5 of 7 · Permutation P scatters the bits: F = ${r.p_output.hex}.`,
      (r) => `Step 6 of 7 · New right half R${r.round} = L${r.round - 1} ⊕ F = ${r.r_out.hex}.`,
      (r) => `Step 7 of 7 · New left half L${r.round} = old R${r.round - 1} = ${r.l_out.hex}. Round ${r.round} done.`,
    ];
    let anim = null;
    const speedSel = el.querySelector("[data-speed]"), pauseBtn = el.querySelector("[data-pause]"), cap = el.querySelector("[data-cap]");
    function stopAnim() {
      if (!anim) return;
      clearTimeout(anim.timer); anim = null;
      body.querySelectorAll("[data-node]").forEach((n) => n.classList.remove("on", "done"));
      body.querySelectorAll("tr[data-anim]").forEach((tr) => tr.classList.remove("anim-on", "anim-hide", "anim-done"));
      pauseBtn.classList.add("hidden");
    }
    function paint() {
      const k = anim.k, r = t.rounds[current - 1];
      body.querySelectorAll("[data-node]").forEach((n) => { const d = +n.dataset.node; n.classList.toggle("on", d === k); n.classList.toggle("done", d < k); });
      body.querySelectorAll("tr[data-anim]").forEach((tr) => {
        const d = +tr.dataset.anim;
        tr.classList.toggle("anim-on", d === k); tr.classList.toggle("anim-done", d < k); tr.classList.toggle("anim-hide", d > k);
      });
      const on = body.querySelector(`tr[data-anim="${k}"]`); if (on) on.scrollIntoView({ block: "nearest", behavior: "smooth" });
      cap.textContent = STEP_TEXT[k](r); cap.classList.remove("hidden");
    }
    function step() {
      if (!anim || anim.paused) return;
      paint();
      anim.timer = setTimeout(() => {
        if (!anim) return;
        anim.k++;
        if (anim.k < 7) step();
        else { stopAnim(); cap.textContent = cap.textContent + " Press Replay to watch it again."; }
      }, CB.reducedMotion() ? 400 : +speedSel.value);
    }
    function replay() {
      stopAnim(); draw();
      anim = { k: 0, paused: false, timer: null };
      pauseBtn.classList.remove("hidden"); pauseBtn.textContent = "❚❚ Pause";
      step();
    }
    function togglePause() {
      if (!anim) return;
      anim.paused = !anim.paused;
      pauseBtn.textContent = anim.paused ? "▶ Resume" : "❚❚ Pause";
      if (anim.paused) clearTimeout(anim.timer); else step();
    }
    draw();
    return { show: (n) => { current = n; draw(); }, replay };
  };

  /* Key-schedule explorer: every round inspectable independently. */
  CB.renderKeySchedule = function (el, ks, opts) {
    opts = opts || {};
    let current = opts.round || 1;
    el.innerHTML = `
      <div class="table-wrap"><table class="trace-table">
        ${row("Original 64-bit key", ks.key, "Parity bits (positions 8, 16, …, 64): " + ks.parity_bits, null, { group: 8 })}
        ${row("PC-1 output (56 bits)", ks.pc1, "Parity bits dropped, remaining 56 rearranged.", null, { group: 7 })}
        ${row("C0 (28 bits)", ks.c0, "", null, { group: 7 })}
        ${row("D0 (28 bits)", ks.d0, "", null, { group: 7 })}
      </table></div>
      <h3 style="margin-top:14px">Key round <span data-kn>${current}</span></h3>
      <div class="round-tabs" role="tablist" aria-label="Select key round">${ks.rounds.map((r) =>
        `<button type="button" data-kround="${r.round}">${r.round}</button>`).join("")}</div>
      <div data-kbody></div>
      <details style="margin-top:10px"><summary>All 16 round keys</summary><div class="table-wrap"><table>
        <tr><th>Round</th><th>Shift</th><th>Total</th><th>C</th><th>D</th><th>Subkey (48 bits)</th></tr>
        ${ks.rounds.map((r) => `<tr><td>K${r.round}</td><td>${r.shift}</td><td>${r.total_shift}</td><td class="mono">${r.c.hex}</td><td class="mono">${r.d.hex}</td><td class="mono">${r.subkey.hex} ${CB.copyBtn(r.subkey.hex)}</td></tr>`).join("")}
      </table></div></details>`;
    const body = el.querySelector("[data-kbody]");
    function draw() {
      const r = ks.rounds[current - 1];
      el.querySelector("[data-kn]").textContent = current;
      el.querySelectorAll("[data-kround]").forEach((b) => b.classList.toggle("active", +b.dataset.kround === current));
      body.innerHTML = `<div class="table-wrap"><table class="trace-table">
        ${row("Shift amount", `${r.shift} (running total ${r.total_shift})`, "Schedule: 1 1 2 2 2 2 2 2 1 2 2 2 2 2 2 1")}
        ${row(`C${current - 1} before rotation`, r.c_prev, "", null, { group: 7 })}
        ${row(`D${current - 1} before rotation`, r.d_prev, "", null, { group: 7 })}
        ${row(`C${current} after ⟲${r.shift}`, r.c, "", null, { group: 7 })}
        ${row(`D${current} after ⟲${r.shift}`, r.d, "", null, { group: 7 })}
        ${row(`C${current} ‖ D${current} (56 bits)`, r.cd, "", null, { group: 7 })}
        ${row(`PC-2 → K${current} (48 bits)`, r.subkey, "PC-2 selects 48 of the 56 bits.", null, { group: 6 })}
      </table></div>`;
    }
    el.addEventListener("click", (e) => {
      const b = e.target.closest("[data-kround]");
      if (b) { current = +b.dataset.kround; draw(); }
    });
    draw();
  };
})();
