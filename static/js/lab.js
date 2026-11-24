/* DES Learning Laboratory page. */
(function () {
  "use strict";
  const $ = (s) => document.querySelector(s);
  const vectors = JSON.parse($("#lab-vectors").textContent);
  const tables = JSON.parse($("#lab-tables").textContent);
  const params = new URLSearchParams(location.search);
  let mode = params.get("mode") === "decrypt" ? "decrypt" : "encrypt";

  function clientCheck(v, label) {
    const s = v.replace(/\s+/g, "");
    if (!s) return `The ${label} is missing. Enter exactly 16 hexadecimal digits.`;
    if (/[^0-9a-fA-F]/.test(s)) return `The ${label} contains non-hexadecimal characters. Use only 0-9 and A-F.`;
    if (s.length !== 16) return `The ${label} has ${s.length} hex digits; DES needs exactly 16.`;
    return "";
  }

  async function run() {
    const err = $("#lab-error"); err.classList.add("hidden");
    const block = $("#lab-block").value, key = $("#lab-key").value;
    const problem = clientCheck(block, mode === "decrypt" ? "ciphertext" : "message") || clientCheck(key, "key");
    if (problem) { err.textContent = problem; err.classList.remove("hidden"); return; }
    let t;
    try { t = await CB.api("/api/des/", { block, key, mode }); }
    catch (e) { err.textContent = e.message; err.classList.remove("hidden"); return; }
    $("#lab-out").classList.remove("hidden");
    const ascii = (h) => h.match(/../g).map((x) => { const c = parseInt(x, 16); return c >= 32 && c < 127 ? String.fromCharCode(c) : "·"; }).join("");
    $("#lab-summary-h").textContent = mode === "decrypt" ? "Decryption result" : "Encryption result";
    $("#lab-summary").innerHTML = `<div class="table-wrap"><table class="trace-table">
      <tr><td>${mode === "decrypt" ? "Ciphertext in" : "Plaintext in"}</td><td class="v">${t.input.hex} ${CB.copyBtn(t.input.hex)} <span class="muted small">text “${CB.esc(ascii(t.input.hex))}”</span></td></tr>
      <tr><td>Key</td><td class="v">${t.key.hex} ${CB.copyBtn(t.key.hex)}</td></tr>
      <tr><td>${mode === "decrypt" ? "Plaintext out" : "Ciphertext out"}</td><td class="v"><b class="hexline">${t.output.hex}</b> ${CB.copyBtn(t.output.hex)} <span class="muted small">text “${CB.esc(ascii(t.output.hex))}”</span></td></tr></table></div>
      <div class="btn-row"><button class="btn btn-sm" type="button" id="lab-swap">${CB.icon("arrow-left-right")} Use output as input and ${mode === "decrypt" ? "encrypt" : "decrypt"}</button></div>`;
    showKeyWarn(t.warnings);
    $("#lab-swap").onclick = () => { $("#lab-block").value = t.output.hex; mode = mode === "decrypt" ? "encrypt" : "decrypt"; run(); };
    CB.renderTrace($("#tab-rounds"), t, { openSboxes: params.get("step") === "sbox", hideStart: true });
    CB.renderKeySchedule($("#tab-keys"), t.key_schedule);
    drawTables();
    if (params.get("tab") === "keys") showTab("keys");
  }

  function permGrid(name, t, cols) {
    return `<figure class="tbl-card"><figcaption>${name} <small>${t.length} entries · ${cols} per row</small></figcaption><div class="perm-table" style="grid-template-columns:repeat(${cols},1fr);max-width:${cols * 50}px">${t.map((v, i) => `<span title="position ${i + 1}">${v}</span>`).join("")}</div></figure>`;
  }
  function drawTables() {
    const pair = (a, b) => `<div class="tbl-row">${a}${b}</div>`;
    const sbox = (sb, i) => `<figure class="tbl-card"><figcaption>S-box S${i + 1} <small>row = bits 1 and 6 · column = bits 2–5</small></figcaption><div class="table-wrap"><table class="sbox-table"><tr><th></th>${[...Array(16).keys()].map((c) => `<th>${c}</th>`).join("")}</tr>${sb.map((r, k) => `<tr><th>${k}</th>${r.map((x) => `<td>${x}</td>`).join("")}</tr>`).join("")}</table></div></figure>`;
    const S = tables.SBOXES;
    $("#tab-tables").innerHTML = `${pair(permGrid("IP (initial permutation)", tables.IP, 8), permGrid("IP⁻¹ (final permutation)", tables.IP_INV, 8))}
      ${pair(permGrid("Expansion E", tables.E, 6), permGrid("Permutation P", tables.P, 8))}
      ${pair(permGrid("PC-1 (key: 64 → 56 bits)", tables.PC1, 7), permGrid("PC-2 (56 → 48-bit round key)", tables.PC2, 6))}
      <figure class="tbl-card tbl-wide"><figcaption>Shift schedule <small>left rotations of C and D in rounds 1 to 16</small></figcaption><p class="mono shift-line">${tables.SHIFTS.map((s, i) => `<span><small>${i + 1}</small>${s}</span>`).join("")}</p></figure>
      ${pair(sbox(S[0], 0), sbox(S[1], 1))}${pair(sbox(S[2], 2), sbox(S[3], 3))}${pair(sbox(S[4], 4), sbox(S[5], 5))}${pair(sbox(S[6], 6), sbox(S[7], 7))}`;
  }
  function showTab(name) {
    ["rounds", "keys", "tables"].forEach((n) => $("#tab-" + n).classList.toggle("hidden", n !== name));
    document.querySelectorAll("[data-tab]").forEach((b) => { const on = b.dataset.tab === name; b.classList.toggle("btn-primary", on); b.setAttribute("aria-selected", on); });
  }
  document.querySelectorAll("[data-tab]").forEach((b) => b.addEventListener("click", () => showTab(b.dataset.tab)));
  $("#lab-form").addEventListener("submit", (e) => {
    e.preventDefault(); if (e.submitter) mode = e.submitter.dataset.mode;
    if (kind() === "block") { $("#lab-data-out").classList.add("hidden"); run(); } else runData();
  });
  $("#lab-vector").addEventListener("change", (e) => {
    const v = vectors[+e.target.value]; if (!v) return;
    $("#lab-key").value = v.key; $("#lab-block").value = mode === "decrypt" ? v.ciphertext : v.plaintext; run();
  });
  $("#lab-a2h").onclick = () => {
    const s = $("#lab-ascii").value;
    if (s.length !== 8) { $("#lab-error").textContent = "Type exactly 8 characters to make one 64-bit block."; $("#lab-error").classList.remove("hidden"); return; }
    $("#lab-block").value = [...s].map((c) => c.charCodeAt(0).toString(16).padStart(2, "0").toUpperCase()).join("");
  };
  $("#lab-explain").addEventListener("change", (e) => document.body.classList.toggle("hide-explain", !e.target.checked));

  /* ---------- Input type, key type, random key, any-length data ---------- */
  const kind = () => document.querySelector("input[name=lab-kind]:checked").value;
  const keyKind = () => document.querySelector("input[name=lab-keykind]:checked").value;
  function showKind() {
    const k = kind();
    document.querySelectorAll(".lab-in").forEach((d) => d.classList.toggle("hidden", d.dataset.kind !== k));
    $("#lab-modes").classList.toggle("hidden", k === "block");
  }
  document.querySelectorAll("input[name=lab-kind]").forEach((r) => r.addEventListener("change", showKind));
  function showKeyWarn(list) {
    const w = $("#lab-keywarn");
    w.innerHTML = (list || []).map((x) => `<p>${CB.icon("triangle-alert")} ${CB.esc(x)}</p>`).join("");
    w.classList.toggle("hidden", !(list && list.length));
  }
  function showKeyKind() {
    const pw = keyKind() === "password";
    document.querySelector(".lab-key-pw").classList.toggle("hidden", !pw);
    $("#lab-key").readOnly = pw;
    $(".lab-key-label").textContent = pw ? "DES key made from your password (16 hex digits = 64 bits)" : "DES key (16 hex digits = 64 bits)";
    $("#lab-keysteps").classList.toggle("hidden", !pw || !$("#lab-keysteps").innerHTML);
    if (pw) derive();
  }
  document.querySelectorAll("input[name=lab-keykind]").forEach((r) => r.addEventListener("change", showKeyKind));
  let deriveTimer = null;
  async function derive() {
    const pw = $("#lab-pass").value, box = $("#lab-keysteps");
    if (!pw) { box.innerHTML = `<p class="small muted">Type a password and its key appears here.</p>`; box.classList.remove("hidden"); return; }
    let r;
    try { r = await CB.api("/api/des/key/", { password: pw }); } catch (e) { box.textContent = e.message; return; }
    $("#lab-key").value = r.key;
    const grp = (h) => h.match(/.{1,2}/g).join(" ");
    box.innerHTML = `<b>How your password becomes a 64-bit key</b>
      <ol>
        <li>Characters → bytes (UTF-8): <span class="mono">${grp(r.password_bytes)}</span></li>
        <li>SHA-256 hash of those bytes (32 bytes; any tiny change in the password changes all of it): <span class="mono small">${grp(r.sha256)}</span></li>
        <li>Keep the first 8 bytes = 64 bits: <span class="mono">${grp(r.first8)}</span></li>
        <li>Fix the parity bit (the last bit of each byte) so every byte has an odd number of 1s: <b class="mono">${grp(r.key)}</b></li>
      </ol>
      <p class="small muted">Real systems use slow, salted methods such as PBKDF2 or Argon2 so that passwords are hard to guess. This simple version shows the idea.</p>`;
    box.classList.remove("hidden");
    showKeyWarn(r.warnings);
  }
  $("#lab-pass").addEventListener("input", () => { clearTimeout(deriveTimer); deriveTimer = setTimeout(derive, 250); });
  $("#lab-genkey").onclick = async () => {
    let r;
    try { r = await CB.api("/api/des/key/", { action: "random" }); } catch (e) { $("#lab-error").textContent = e.message; $("#lab-error").classList.remove("hidden"); return; }
    document.querySelector("input[name=lab-keykind][value=hex]").checked = true; showKeyKind();
    $("#lab-key").value = r.key; $("#lab-keysteps").classList.add("hidden");
    showKeyWarn([`New random key: 64 random bits with correct parity, checked against the DES weak and semi-weak keys. Write it down: without it the ciphertext cannot be decrypted.`]);
  };

  const readFile = (f) => new Promise((ok, bad) => {
    const r = new FileReader();
    r.onload = () => ok(String(r.result).split(",")[1] || "");
    r.onerror = () => bad(new Error("The file could not be read."));
    r.readAsDataURL(f);
  });
  function download(b64, name) {
    const bin = atob(b64), arr = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) arr[i] = bin.charCodeAt(i);
    const url = URL.createObjectURL(new Blob([arr], { type: "application/octet-stream" }));
    const a = document.createElement("a"); a.href = url; a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(url); a.remove(); }, 500);
  }
  async function runData() {
    const err = $("#lab-error"); err.classList.add("hidden");
    const fail = (m) => { err.textContent = m; err.classList.remove("hidden"); };
    const key = $("#lab-key").value, k = kind();
    const kp = clientCheck(key, "key"); if (kp) return fail(kp);
    const body = { mode, key, kind: k, cipher_mode: document.querySelector("input[name=lab-cmode]:checked").value, padding: $("#lab-pad").checked };
    if (k === "text") {
      if (mode === "decrypt") return fail("Ciphertext is binary data, not text. To decrypt, choose “Hex (any length)” and paste the ciphertext hex, or choose the .des file.");
      body.data = $("#lab-text").value;
    } else if (k === "hex") body.data = $("#lab-hexdata").value;
    else {
      const f = $("#lab-file").files[0];
      if (!f) return fail("Choose a file first.");
      if (f.size > 1024 * 1024) return fail(`That file is ${(f.size / 1024).toFixed(0)} KB. The lab accepts files up to 1 MB.`);
      body.filename = f.name; body.data = await readFile(f);
    }
    const btns = document.querySelectorAll("#lab-form button[type=submit]"); btns.forEach((b) => (b.disabled = true));
    let r;
    try { r = await CB.api("/api/des/data/", body); } catch (e) { return fail(e.message); } finally { btns.forEach((b) => (b.disabled = false)); }
    showKeyWarn(r.warnings);
    const out = $("#lab-data"), enc = mode === "encrypt";
    $("#lab-data-h").textContent = enc ? "Encryption result" : "Decryption result";
    const hexShow = r.output_hex.match(/.{1,16}/g) || [];
    const rows = r.blocks.map((b) => `<tr><td>${b.index}</td><td class="mono">${b.input}</td>${r.mode === "CBC" ? `<td class="mono">${b.des_in === b.input ? "" : b.des_in}</td>` : ""}<td class="mono">${b.des_out}</td><td class="mono">${b.output}</td>
        <td><button type="button" class="btn btn-sm" data-trace="${b.des_in}">16 rounds</button></td></tr>`).join("");
    const cbcHead = r.mode === "CBC" ? (enc ? "<th>XOR previous block (enters DES)</th>" : "") : "";
    out.innerHTML = `<div class="table-wrap"><table class="trace-table">
        <tr><td>Input</td><td class="v">${r.size_in.toLocaleString()} bytes</td></tr>
        <tr><td>Blocks</td><td class="v">${r.block_count.toLocaleString()} × 8 bytes ${r.padding ? (enc ? "(after PKCS#7 padding)" : "(padding removed after decryption)") : "(no padding)"}</td></tr>
        <tr><td>Mode</td><td class="v">${r.mode}${r.iv ? ` · IV <span class="mono">${r.iv}</span> ${enc ? "(random, stored as the first 8 bytes of the output)" : "(read from the first 8 bytes)"}` : ""}</td></tr>
        <tr><td>Output</td><td class="v">${r.size_out.toLocaleString()} bytes</td></tr></table></div>
      ${r.output_text !== null && r.output_text !== undefined ? `<h3>Decrypted text</h3><pre class="lab-textout">${CB.esc(r.output_text)}</pre>` : ""}
      <h3>Output in hex ${r.output_hex_truncated ? `<span class="small muted">(first 4 KB shown; download for all of it)</span>` : ""}</h3>
      <div class="lab-hexout mono">${hexShow.map((h) => `<span>${h}</span>`).join("")}</div>
      <div class="btn-row" style="margin-top:8px">
        <button type="button" class="btn btn-primary" id="lab-dl">${CB.icon("download")} Download ${CB.esc(r.filename)}</button>
        ${r.output_hex_truncated ? "" : CB.copyBtn(r.output_hex, "output hex")}
        ${enc && !r.output_hex_truncated ? `<button type="button" class="btn" id="lab-redo">${CB.icon("lock-open")} Decrypt this result</button>` : ""}</div>
      ${enc && r.mode === "ECB" && r.ecb_repeats ? `<p class="lab-warn">${CB.icon("triangle-alert")} ${r.ecb_repeats} ciphertext block(s) repeat an earlier block. That is ECB leaking a pattern in your data; CBC hides it.</p>` : ""}
      <h3>Block by block ${r.block_count > r.blocks.length ? `<span class="small muted">(first ${r.blocks.length} of ${r.block_count})</span>` : ""}</h3>
      <p class="small muted">${enc ? (r.mode === "CBC" ? "Each plaintext block is XOR-ed with the previous ciphertext block (the IV for block 1), then encrypted." : "Each block is encrypted on its own.") : (r.mode === "CBC" ? "Each block is decrypted, then XOR-ed with the previous ciphertext block (the IV for block 1)." : "Each block is decrypted on its own.")} Press <b>16 rounds</b> to see every DES step for that block below.</p>
      <div class="table-wrap"><table class="trace-table lab-blocks"><tr><th>#</th><th>${enc ? "Plaintext block" : "Ciphertext block"}</th>${cbcHead}<th>DES output</th><th>${enc ? "Ciphertext block" : "Plaintext block"}</th><th></th></tr>${rows}</table></div>`;
    $("#lab-data-out").classList.remove("hidden");
    $("#lab-dl").onclick = () => download(r.output_b64, r.filename);
    const redo = $("#lab-redo");
    if (redo) redo.onclick = () => {
      document.querySelector("input[name=lab-kind][value=hex]").checked = true; showKind();
      $("#lab-hexdata").value = r.output_hex; mode = "decrypt"; runData();
    };
    out.querySelectorAll("[data-trace]").forEach((b) => b.addEventListener("click", () => {
      $("#lab-block").value = b.dataset.trace; run().then(() => $("#lab-out").scrollIntoView({ behavior: "smooth" }));
    }));
    $("#lab-data-out").scrollIntoView({ behavior: "smooth", block: "start" });
  }

  /* ---------- Avalanche effect ---------- */
  const avBit = $("#av-bit");
  const clampBit = (v) => Math.max(1, Math.min(64, +v || 1));
  $("#av-dec").onclick = () => { avBit.value = clampBit(+avBit.value - 1); };
  $("#av-inc").onclick = () => { avBit.value = clampBit(+avBit.value + 1); };
  const strip = (diff) => `<span class="av-strip" aria-hidden="true">${[...diff].map((d) => `<i class="${d === "1" ? "on" : ""}"></i>`).join("")}</span>`;
  async function avalanche() {
    const err = $("#av-error"); err.classList.add("hidden");
    avBit.value = clampBit(avBit.value);
    const target = document.querySelector("input[name=av-target]:checked").value;
    const block = $("#lab-block").value, key = $("#lab-key").value;
    const problem = clientCheck(block, "message") || clientCheck(key, "key");
    if (problem) { err.textContent = problem; err.classList.remove("hidden"); return; }
    let r;
    try { r = await CB.api("/api/avalanche/", { block, key, target, bit: +avBit.value }); }
    catch (e) { err.textContent = e.message; err.classList.remove("hidden"); return; }
    const pct = (n) => Math.round((n / 64) * 100);
    const changed = target === "key" ? `<b>Key</b> <span class="mono">${r.key}</span> → <span class="mono">${r.key2}</span>` : `<b>Message</b> <span class="mono">${r.block}</span> → <span class="mono">${r.block2}</span>`;
    const rows = r.rows.map((x) => `<div class="av-row"><span class="av-r">${x.round === 0 ? "after IP" : "round " + x.round}</span>${strip(x.diff)}<span class="av-bar"><span style="width:${(x.count / 64) * 100}%"></span></span><b class="av-n">${x.count}</b></div>`).join("");
    let verdict;
    if (r.parity_bit) verdict = `<p class="av-note">Bit ${r.bit} of the key is a <b>parity bit</b> (positions 8, 16, …, 64). PC-1 throws it away, so flipping it changes <b>nothing</b>. That is why DES has only 56 effective key bits.</p>`;
    else verdict = `<p class="av-note">One flipped bit changed <b>${r.output.count} of 64</b> ciphertext bits (${pct(r.output.count)}%). Around 32 (50%) is what a strong cipher should give. Notice how the difference starts at 1 bit and spreads to about half of the bits within just a few rounds: each round's S-boxes turn a small change into several changed bits, and the Feistel swap passes it to the other half.</p>`;
    $("#av-out").innerHTML = `<p>${changed} (bit ${r.bit} flipped)</p>
      <div class="av-legend small muted"><span class="av-strip"><i class="on"></i></span> = this bit is different between the two runs</div>
      <div class="av-rows">${rows}</div>
      <div class="table-wrap"><table class="trace-table"><tr><td>Ciphertext (original)</td><td class="v mono">${r.output.a}</td></tr><tr><td>Ciphertext (1 bit flipped)</td><td class="v mono">${r.output.b}</td></tr><tr><td>Bits that differ</td><td class="v">${strip(r.output.diff)} <b>${r.output.count} / 64</b></td></tr></table></div>${verdict}`;
    $("#av-out").classList.remove("hidden");
  }
  $("#av-run").onclick = avalanche;

  /* ---------- Birthday attack ---------- */
  const runs = {};
  async function birthday() {
    const err = $("#bd-error"); err.classList.add("hidden");
    const bits = +$("#bd-bits").value, btn = $("#bd-run");
    btn.disabled = true; btn.textContent = "Encrypting…";
    let r;
    try { r = await CB.api("/api/birthday/", { bits }); }
    catch (e) { err.textContent = e.message; err.classList.remove("hidden"); return; }
    finally { btn.disabled = false; btn.innerHTML = CB.icon("dices") + " Encrypt until a block repeats"; }
    (runs[bits] = runs[bits] || []).push(r.collision ? r.collision.draws : null);
    drawBirthday(r);
  }
  function drawBirthday(r) {
    const list = runs[r.bits] || [];
    const ok = list.filter((x) => x);
    const avg = ok.length ? Math.round(ok.reduce((a, b) => a + b, 0) / ok.length) : 0;
    const max = Math.max(r.expected * 2.2, ...ok);
    const c = r.collision;
    $("#bd-out").innerHTML = `
      ${c ? `<p class="bd-hit">Repeat after <b>${c.draws.toLocaleString()}</b> blocks, out of ${r.space.toLocaleString()} possible ${r.bits}-bit values.</p>
      <p class="small">Message #${c.first.index} <span class="mono">${c.first.plain}</span> and message #${c.second.index} <span class="mono">${c.second.plain}</span> both start with <span class="mono">${c.value}</span> after DES encryption (key <span class="mono">${r.key}</span>).</p>` : `<p>No repeat found within the limit. Try again.</p>`}
      <p class="small">Birthday estimate: a repeat is expected after about <b>${Math.round(r.expected).toLocaleString()}</b> blocks (≈ 1.25 × √2<sup>${r.bits}</sup>), and is already 50% likely by <b>${Math.round(r.half).toLocaleString()}</b>. That is far fewer than ${r.space.toLocaleString()}.</p>
      <div class="bd-chart" role="img" aria-label="Blocks needed in each run compared with the birthday estimate">
        <span class="bd-exp" style="--f:${r.expected / max}"><em>expected ${Math.round(r.expected).toLocaleString()}</em></span>
        ${list.map((x, i) => `<div class="bd-run"><span class="small">run ${i + 1}</span><span class="bd-bar"><span style="width:${x ? (x / max) * 100 : 0}%"></span></span><b class="small">${x ? x.toLocaleString() : "—"}</b></div>`).join("")}
      </div>
      ${ok.length > 1 ? `<p class="small">Average of your ${ok.length} runs: <b>${avg.toLocaleString()}</b> blocks.</p>` : `<p class="small muted">Run it a few more times to see the runs cluster around the estimate.</p>`}
      <p class="small"><b>Scale it up:</b> real DES has 64-bit blocks, so the same thing happens after about 2<sup>32</sup> ≈ 4.3 billion blocks (≈ 32 GB) under one key.</p>`;
  }
  $("#bd-run").onclick = birthday;
  $("#bd-clear").onclick = () => { Object.keys(runs).forEach((k) => delete runs[k]); $("#bd-out").innerHTML = ""; };
  $("#bd-bits").onchange = () => { $("#bd-out").innerHTML = ""; };

  if (params.get("block")) $("#lab-block").value = params.get("block");
  if (params.get("key")) $("#lab-key").value = params.get("key");
  if (params.get("hexdata")) { document.querySelector("input[name=lab-kind][value=hex]").checked = true; $("#lab-hexdata").value = params.get("hexdata"); }
  showKind();
  const vi = params.get("vector");
  if (vi !== null && vectors[+vi]) { $("#lab-key").value = vectors[+vi].key; $("#lab-block").value = mode === "decrypt" ? vectors[+vi].ciphertext : vectors[+vi].plaintext; }
  if (kind() === "block") run(); else if (params.get("run") === "1") runData();
})();
