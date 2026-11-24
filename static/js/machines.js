/* DEScape — in-world puzzle machines.
 * Every DES puzzle is operated as a device (dials, bit lamps, patch cables, cutters,
 * rotor disks, XOR gates, S-box grids, key racks, letter wheels). Each machine turns
 * the player's manipulations into the answer fields the server checks; the server
 * still owns every rule and answer.
 *
 * Machines.build(P, M) -> { html, bind(root), solved?(res), wrong?(res) }
 * M = { set(name, value), mode, sound(kind), esc }
 */
(function () {
  "use strict";
  const esc = (s) => CB.esc(s);
  const HEX = "0123456789ABCDEF".split("");
  const $ = (s, el) => el.querySelector(s);
  const $$ = (s, el) => Array.from(el.querySelectorAll(s));

  /* ---------- shared building blocks ---------- */
  function lampGrid(bits, opts) {
    opts = opts || {};
    const cols = opts.cols || 8;
    return `<div class="lamps ${opts.cls || ""}" ${opts.id ? `id="${opts.id}"` : ""} style="--cols:${cols}" role="group" aria-label="${opts.label || "bits"}">` +
      bits.split("").map((b, i) => {
        const tag = opts.buttons ? "button type=\"button\"" : "span";
        const end = opts.buttons ? "button" : "span";
        const hidden = opts.hide && opts.hide.includes(i + 1);
        return `<${tag} class="lamp ${hidden ? "unk" : b === "1" ? "on" : "off"}" data-pos="${i + 1}" aria-label="bit ${i + 1}${hidden ? "" : " = " + b}">` +
          `<i>${hidden ? "?" : b}</i>${opts.numbered === false ? "" : `<small>${i + 1}</small>`}</${end}>`;
      }).join("") + `</div>`;
  }
  function bitSwitches(n, id, label) {
    return `<div class="switches" id="${id}" role="group" aria-label="${label}">` +
      Array.from({ length: n }, (_, i) => `<button type="button" class="bitsw" data-i="${i}" aria-label="${label} bit ${i + 1}: unset">?</button>`).join("") + `</div>`;
  }
  function bindSwitches(root, id, onChange) {
    const btns = $$(`#${id} .bitsw`, root), vals = btns.map(() => "?");
    btns.forEach((b, i) => b.addEventListener("click", () => {
      vals[i] = vals[i] === "1" ? "0" : "1";
      b.textContent = vals[i]; b.classList.toggle("on", vals[i] === "1"); b.classList.add("set");
      b.setAttribute("aria-label", b.getAttribute("aria-label").replace(/: .*/, ": " + vals[i]));
      CB.sound("click"); onChange(vals.includes("?") ? "" : vals.join(""), vals);
    }));
    return vals;
  }
  /* Rotary/flip dial: ▲ ▼ buttons, arrow keys, or type a symbol directly. */
  function dial(id, value, label, extraCls) {
    return `<div class="dial ${extraCls || ""}" id="${id}" tabindex="0" role="spinbutton" aria-label="${label}" aria-valuetext="${value}">
      <button type="button" class="up" tabindex="-1" aria-hidden="true">▲</button><span class="face">${value}</span><button type="button" class="dn" tabindex="-1" aria-hidden="true">▼</button></div>`;
  }
  function bindDial(root, id, values, onChange, start) {
    const el = $("#" + id, root); let k = Math.max(0, values.indexOf(String(start ?? values[0])));
    const show = (dir) => {
      const face = $(".face", el); face.textContent = values[k]; el.setAttribute("aria-valuetext", values[k]);
      if (dir && !CB.reducedMotion()) { face.classList.remove("flip-up", "flip-dn"); void face.offsetWidth; face.classList.add(dir > 0 ? "flip-up" : "flip-dn"); }
      onChange(values[k]);
    };
    const step = (d) => { k = (k + d + values.length) % values.length; CB.sound("click"); show(d); };
    $(".up", el).addEventListener("click", () => step(1));
    $(".dn", el).addEventListener("click", () => step(-1));
    el.addEventListener("wheel", (e) => { e.preventDefault(); step(e.deltaY < 0 ? 1 : -1); }, { passive: false });
    el.addEventListener("keydown", (e) => {
      if (e.key === "ArrowUp") { e.preventDefault(); step(1); }
      else if (e.key === "ArrowDown") { e.preventDefault(); step(-1); }
      else if (e.key.length === 1) {
        const i = values.findIndex((v) => v.toUpperCase() === e.key.toUpperCase());
        if (i >= 0) {
          e.preventDefault(); k = i; CB.sound("click"); show(1);
          const group = el.closest("[data-dialgroup]");
          if (group) { const all = $$(".dial", group), nx = all[all.indexOf(el) + 1]; if (nx) nx.focus(); }
        }
      }
    });
    show(0);
    return { set(v) { const i = values.indexOf(String(v)); if (i >= 0) { k = i; show(0); } } };
  }
  const NUMS = (a, b) => Array.from({ length: b - a + 1 }, (_, i) => String(a + i));
  function numberDial(root, id, lo, hi, start, onChange) {
    const el = $("#" + id, root);
    if (!el || el.tagName !== "INPUT") return bindDial(root, id, NUMS(lo, hi), onChange, start);
    // a number box: type the value, or use the ▲ ▼ buttons / arrow keys
    const box = el.closest(".numbox");
    const clamp = (x) => Math.min(hi, Math.max(lo, x));
    const fire = () => { const t = el.value.trim(); if (t === "" || isNaN(+t)) { onChange(""); return; } onChange(String(Math.round(+t))); };
    el.min = lo; el.max = hi; el.value = start;
    el.addEventListener("input", fire);
    el.addEventListener("change", () => { if (el.value !== "") { el.value = clamp(Math.round(+el.value)); fire(); } });
    el.addEventListener("keydown", (e) => { if (e.key === "Enter") e.preventDefault(); });
    const step = (d) => { const x = el.value === "" ? start : +el.value; el.value = clamp(x + d); CB.sound("click"); fire(); };
    $(".up", box).addEventListener("click", () => step(1));
    $(".dn", box).addEventListener("click", () => step(-1));
    fire();
    return { set(v) { el.value = v; fire(); } };
  }
  const numBox = (id, value, label) => `<span class="numbox"><button type="button" class="dn" tabindex="-1" aria-label="Down">▼</button><input type="number" id="${id}" value="${value}" inputmode="numeric" aria-label="${label}"><button type="button" class="up" tabindex="-1" aria-label="Up">▲</button><small>type it or use the arrows</small></span>`;
  function hexDials(prefix, n, label) {
    return `<div class="dials" id="${prefix}" data-dialgroup>` + Array.from({ length: n }, (_, i) => dial(`${prefix}-${i}`, "0", `${label} digit ${i + 1}`)).join("") + `</div>`;
  }
  function bindHexDials(root, prefix, n, onChange) {
    const vals = Array(n).fill("0");
    for (let i = 0; i < n; i++) bindDial(root, `${prefix}-${i}`, HEX, (v) => { vals[i] = v; onChange(vals.join("")); });
    return vals;
  }
  const valBox = (label, x, cls) => `<div class="cart ${cls || ""}"><b>${label}</b><span class="hx">${x.hex}</span><span class="bn">${CB.group(x.bin, x.bits === 48 ? 6 : x.bits === 56 || x.bits === 28 ? 7 : 4)}</span></div>`;
  const screen = (inner, id) => `<div class="crt" ${id ? `id="${id}"` : ""}>${inner}</div>`;
  const note = (id, text) => `<p class="mnote" id="${id}" aria-live="polite">${text || ""}</p>`;
  const drawer = (title, inner, id) => `<details class="drawer" ${id ? `id="${id}"` : ""}><summary>${title}</summary><div class="drawer-body">${inner}</div></details>`;
  const fieldOf = (P, name) => P.fields.find((f) => f.name === name);

  /* ---------- Permutation patch-bay (IP, PC-1, PC-2, P) ---------- */
  /* ---------- Permutation bench: the player performs the WHOLE permutation ----------
     Every output cell shows (←n) which input bit it copies. Click that input bit (a cable flies
     over) or type 0/1. Rows are checked as they fill up; after two correct rows a fast-entry box
     lets the player type a whole row. Values come from the real engine (view.input + view.table). */
  function permuteMachine(P, M, cfg) {
    const v = P.view, table = v.table, inp = v.input, N = table.length, cols = cfg.outCols;
    const rows = Math.ceil(N / cols);
    const outCells = table.map((src, i) => `<button type="button" class="ocell${i === 0 ? " cur" : ""}" data-k="${i + 1}" aria-label="Output bit ${i + 1}, copies ${cfg.srcWord} ${src}"><small>${i + 1}</small><i>·</i><em>←${src}</em></button>`).join("");
    return {
      html: `<div class="permbench">
        <div class="pb-col"><h4>${cfg.srcTitle}</h4>${lampGrid(inp, { cols: cfg.srcCols, id: "m-src", buttons: true, label: cfg.srcTitle })}
          <p class="tiny muted">${cfg.srcHelp}</p></div>
        <div class="pb-col"><h4>${cfg.outTitle} <span class="pb-count" id="m-count">0 / ${N}</span></h4>
          <div class="ogrid" id="m-out" tabindex="0" style="--cols:${cols}" role="grid" aria-label="${cfg.outTitle}">${outCells}</div>
          <p class="tiny muted">Each cell shows <b>←n</b>: the ${cfg.srcWord} it copies. The yellow cell is next.</p>
        </div>
      </div>
      ${note("m-note", `Click the ${cfg.srcWord} named in the yellow cell (or press 0 / 1). Fill every cell to perform the whole ${cfg.op}.`)}
      <svg class="cable" id="m-cable" aria-hidden="true"></svg>`,
      bind(root) {
        const out = Array(N).fill(null), okRow = Array(rows).fill(false);
        let cur = 0;
        const cells = $$("#m-out .ocell", root), noteEl = $("#m-note", root);
        const rowOf = (i) => Math.floor(i / cols), rowCells = (r) => cells.slice(r * cols, Math.min(N, (r + 1) * cols));
        const correctRows = () => okRow.filter(Boolean).length;
        function paint() {
          cells.forEach((c, i) => {
            c.querySelector("i").textContent = out[i] === null ? "·" : out[i];
            c.classList.toggle("on", out[i] === "1"); c.classList.toggle("set", out[i] !== null);
            c.classList.toggle("cur", i === cur); c.classList.toggle("ok", okRow[rowOf(i)]);
          });
          const filled = out.filter((x) => x !== null).length;
          $("#m-count", root).textContent = `${filled} / ${N}`;
          M.set("out", filled === N ? out.join("") : "");
        }
        function checkRow(r) {
          const idx = rowCells(r).map((c) => +c.dataset.k - 1);
          if (idx.some((i) => out[i] === null)) return;
          const bad = idx.filter((i) => out[i] !== inp[table[i] - 1]);
          if (!bad.length) {
            okRow[r] = true; CB.sound("good");
            noteEl.innerHTML = correctRows() === rows ? `All ${N} bits placed. Press <b>${CB.icon("arrow-right")} NEXT</b>.` :
              `Row ${r + 1} is correct!`;
          } else {
            CB.sound("bad");
            bad.forEach((i) => { cells[i].classList.add("bad"); setTimeout(() => cells[i].classList.remove("bad"), 900); out[i] = null; });
            cur = bad[0];
            noteEl.innerHTML = `Row ${r + 1} has ${bad.length} wrong bit${bad.length > 1 ? "s" : ""}. Look at the ←n number in output cell ${bad[0] + 1} and copy ${cfg.srcWord} ${table[bad[0]]}.`;
          }
        }
        function nextEmpty(from) { for (let k = 0; k < N; k++) { const i = (from + k) % N; if (out[i] === null) return i; } return from; }
        function place(val) {
          const i = cur; out[i] = val; const r = rowOf(i);
          cur = nextEmpty(i + 1);
          checkRow(r); paint();
        }
        function flyCable(srcPos, i) {
          const svg = $("#m-cable", root), box = root.getBoundingClientRect();
          const a = $(`#m-src .lamp[data-pos="${srcPos}"]`, root).getBoundingClientRect(), b = cells[i].getBoundingClientRect();
          const x1 = a.left + a.width / 2 - box.left, y1 = a.top + a.height / 2 - box.top, x2 = b.left + b.width / 2 - box.left, y2 = b.top + b.height / 2 - box.top;
          svg.setAttribute("width", root.scrollWidth); svg.setAttribute("height", root.scrollHeight);
          svg.innerHTML = `<path d="M${x1},${y1} C${(x1 + x2) / 2},${y1 - 40} ${(x1 + x2) / 2},${y2 + 40} ${x2},${y2}" /><circle cx="${x1}" cy="${y1}" r="4"/><circle cx="${x2}" cy="${y2}" r="4"/>`;
          clearTimeout(flyCable.t); flyCable.t = setTimeout(() => { svg.innerHTML = ""; }, 650);
        }
        $$("#m-src .lamp", root).forEach((l) => l.addEventListener("click", () => {
          const pos = +l.dataset.pos, need = table[cur];
          if (pos !== need) {
            l.classList.add("wrong"); setTimeout(() => l.classList.remove("wrong"), 500); CB.sound("deny");
            noteEl.innerHTML = `Output cell ${cur + 1} copies ${cfg.srcWord} <b>${need}</b> (see ←${need}), not ${pos}.`;
            return;
          }
          flyCable(pos, cur); CB.sound("zap");
          noteEl.textContent = `${cfg.srcWord[0].toUpperCase() + cfg.srcWord.slice(1)} ${pos} = ${inp[pos - 1]} → output bit ${cur + 1}.`;
          place(inp[pos - 1]);
        }));
        cells.forEach((c, i) => c.addEventListener("click", () => { cur = i; paint(); $("#m-out", root).focus(); }));
        $("#m-out", root).addEventListener("keydown", (e) => {
          if (e.key === "0" || e.key === "1") { e.preventDefault(); CB.sound("click"); place(e.key); }
          else if (e.key === "Backspace") { e.preventDefault(); cur = Math.max(0, out[cur] === null ? cur - 1 : cur); out[cur] = null; okRow[rowOf(cur)] = false; paint(); }
          else if (e.key === "ArrowRight") { e.preventDefault(); cur = Math.min(N - 1, cur + 1); paint(); }
          else if (e.key === "ArrowLeft") { e.preventDefault(); cur = Math.max(0, cur - 1); paint(); }
          else if (e.key === "ArrowDown") { e.preventDefault(); cur = Math.min(N - 1, cur + cols); paint(); }
          else if (e.key === "ArrowUp") { e.preventDefault(); cur = Math.max(0, cur - cols); paint(); }
          e.stopPropagation();
        });
        paint();
      },
    };
  }

  /* ---------- Laser cutter (L0/R0 and C0/D0) ---------- */
  function cutter(P, M, cfg) {
    const hex = cfg.value.hex, n = hex.length, f = P.fields;
    return {
      html: `<h4>${cfg.title}</h4>
        <div class="cutter" id="m-cutter">${hex.split("").map((h, i) => `<span class="hd" data-i="${i}"><b>${h}</b><small>${CB.group(cfg.value.bin.slice(i * 4, i * 4 + 4))}</small></span>${i < n - 1 ? `<button type="button" class="gap" data-cut="${i + 1}" aria-label="Cut after digit ${i + 1}"><i></i></button>` : ""}`).join("")}</div>
        <p class="tiny muted">${n} hex digits × 4 bits = ${n * 4} bits. Click a gap to aim the laser.</p>
        <div class="trays"><div class="tray l" id="m-trayL"><b>${f[0].label}</b><span class="hx">—</span><small></small></div>
          <div class="tray r" id="m-trayR"><b>${f[1].label}</b><span class="hx">—</span><small></small></div></div>
        ${note("m-note", cfg.help)}`,
      bind(root) {
        $$("#m-cutter .gap", root).forEach((g) => g.addEventListener("click", () => {
          const c = +g.dataset.cut;
          $$("#m-cutter .gap", root).forEach((x) => x.classList.toggle("cut", x === g));
          $$("#m-cutter .hd", root).forEach((d) => { d.classList.toggle("left", +d.dataset.i < c); d.classList.toggle("right", +d.dataset.i >= c); });
          const L = hex.slice(0, c), R = hex.slice(c);
          $("#m-trayL .hx", root).textContent = L; $("#m-trayR .hx", root).textContent = R;
          $("#m-trayL small", root).textContent = `${L.length * 4} bits`; $("#m-trayR small", root).textContent = `${R.length * 4} bits`;
          M.set(f[0].name, L); M.set(f[1].name, R); CB.sound("zap");
          $("#m-note", root).textContent = L.length === R.length ? "Two equal halves. Press NEXT when you're sure." : `Left ${L.length * 4} bits, right ${R.length * 4} bits. Are the halves equal?`;
        }));
      },
    };
  }

  /* ---------- Big switches for multiple-choice ---------- */
  function choiceSwitches(field, id) {
    return `<fieldset class="levers" id="${id}"><legend>${esc(field.label)}</legend>${field.options.map((o) =>
      `<button type="button" class="lever" data-v="${o.value}" aria-pressed="false"><span class="knob"></span><span>${esc(o.label)}</span></button>`).join("")}</fieldset>`;
  }
  function bindChoice(root, id, name, M) {
    $$(`#${id} .lever`, root).forEach((b) => b.addEventListener("click", () => {
      $$(`#${id} .lever`, root).forEach((x) => { x.classList.remove("on"); x.setAttribute("aria-pressed", "false"); });
      b.classList.add("on"); b.setAttribute("aria-pressed", "true"); CB.sound("click"); M.set(name, b.dataset.v);
    }));
  }

  /* ---------- Feistel router (encrypt module 5 and decryption round) ---------- */
  function router(P, M, dec) {
    const v = P.view;
    const lName = dec ? "LEFT in" : `L${v.round - 1}`, rName = dec ? "RIGHT in" : `R${v.round - 1}`;
    const outL = dec ? "new LEFT" : `L${v.round}`, outR = dec ? "new RIGHT" : `R${v.round}`;
    const fName = dec ? "F" : `F(R${v.round - 1}, K${v.key_index || v.round})`;
    const encR = dec && v.direction === "encrypt";  // decrypt mission, Room 4: an ENCRYPTION round
    const word = encR ? "Encryption" : "Decryption";
    const sn = (n) => (dec ? n + 1 : n);  // decryption has an extra first step (the key)
    const diagram = `<svg class="fx-diag" viewBox="0 0 220 150" aria-hidden="true">
        <rect x="10" y="8" width="80" height="28" class="bl"/><text x="50" y="27">${lName}</text>
        <rect x="130" y="8" width="80" height="28" class="br"/><text x="170" y="27">${rName}</text>
        <rect x="150" y="56" width="46" height="24" class="bf"/><text x="173" y="73">F</text>
        <path d="M170,36 V56" class="w"/><path d="M170,36 C170,70 50,70 50,112" class="w r"/>
        <path d="M50,36 V62" class="w l"/><circle cx="50" cy="74" r="11" class="x"/><text x="50" y="79" class="xt">⊕</text>
        <path d="M150,68 H62" class="w f"/><path d="M50,85 C50,100 170,96 170,112" class="w l"/>
        <rect x="10" y="112" width="80" height="28" class="ol"/><text x="50" y="131">${outL}</text>
        <rect x="130" y="112" width="80" height="28" class="or"/><text x="170" y="131">${outR}</text>
      </svg>`;
    const digits = (h, cls) => h.split("").map((d) => `<span class="fx-d ${cls}">${d}</span>`).join("");
    return {
      html: `<div class="fx">
        <div class="fx-top">
          ${diagram}
          <div class="fx-rule"><h4>The rule, every round</h4>
            <p><b class="c-r">1.</b> The new <b>LEFT</b> half is just the old <b>RIGHT</b> half, copied.</p>
            <p><b class="c-l">2.</b> The new <b>RIGHT</b> half = old <b>LEFT</b> ⊕ F, XOR-ed digit by digit.</p>
            ${dec ? (encR ? `<p class="muted small">Encryption and decryption use this very same rule. Only the key order changes: encryption round r uses Kr.</p>` : `<p class="muted small">Decryption uses the very same rule. Only the key changes: round r uses K(17 − r).</p>`) : `<p class="muted small">F was already computed for you by modules 1 to 4: ${fName} = <b class="mono">${v.f.hex}</b>.</p>`}
            ${!dec && v.direction === "decrypt" ? `<p class="muted small">Decryption round ${v.round} uses K${v.key_index}: decryption runs the round keys backwards.</p>` : ""}</div>
        </div>
        ${dec ? `<section class="fx-step" id="m-fx-k"><h4><span class="fx-n">1</span> Which key does ${word.toLowerCase()} round ${v.round} use?</h4>
          ${encR ? `<p>Encryption runs the 16 keys <b>forwards</b>: round 1 uses K1, round 2 uses K2, … round r uses <b>Kr</b>. (Your decryption used them backwards.)</p>`
                 : `<p>Decryption runs the 16 keys <b>backwards</b>: round 1 uses K16, round 2 uses K15, … round r uses <b>K(17 − r)</b>.</p>`}
          <div class="kstrip">${Array.from({ length: 16 }, (_, i) => `<span class="${i + 1 === v.round ? "cur" : ""}"><small>round ${i + 1}</small><b>${i + 1 === v.round ? "K?" : "K" + (encR ? i + 1 : 16 - i)}</b></span>`).join("")}</div>
          <div class="keydial-row"><span>${word} round ${v.round} uses K</span>${numBox("m-kdial", "1", "Subkey number")}</div></section>` : ""}
        <section class="fx-step" id="m-fx-l"><h4><span class="fx-n">${sn(1)}</span> Make the new LEFT half (${outL})</h4>
          <p>Which half is copied into ${outL}? Click it.</p>
          <div class="fx-pick" id="m-outL">
            <button type="button" data-c="L"><small>${lName}</small><span class="mono">${v.l.hex}</span></button>
            <button type="button" data-c="R"><small>${rName}</small><span class="mono">${v.r.hex}</span></button>
            <span class="fx-arrow">→</span>
            <div class="fx-res" id="m-fx-lres"><small>${outL}</small><span class="mono hx">? ? ? ? ? ? ? ?</span></div>
          </div></section>
        <section class="fx-step" id="m-fx-r"><h4><span class="fx-n">${sn(2)}</span> Make the new RIGHT half (${outR}): XOR each column</h4>
          <p>Work column by column: XOR the two digits above, then set the dial under them. Click a dial to see its digits in binary.</p>
          <div class="fx-grid" id="m-rd" data-dialgroup>
            <span class="fx-lab c-l">${lName}</span>${digits(v.l.hex, "l")}
            <span class="fx-lab c-f">⊕ F</span>${digits(v.f.hex, "f")}
            <span class="fx-lab">= ${outR}</span>${Array.from({ length: 8 }, (_, i) => dial(`m-rd-${i}`, "0", `${outR} digit ${i + 1}`)).join("")}
          </div>
          <div class="xhelp" id="m-xhelp" aria-live="polite"></div>
        </section>
      </div>`,
      bind(root) {
        if (dec) numberDial(root, "m-kdial", 1, 16, 1, (x) => M.set("key", x));
        $$("#m-outL button", root).forEach((b) => b.addEventListener("click", () => {
          $$("#m-outL button", root).forEach((x) => x.classList.toggle("on", x === b));
          const x = b.dataset.c === "R" ? v.r : v.l;
          const res = $("#m-fx-lres", root); res.classList.remove("fly"); void res.offsetWidth; res.classList.add("fly");
          $("#m-fx-lres .hx", root).textContent = x.hex; M.set("l", x.hex); CB.sound("zap");
          $("#m-fx-lres", root).classList.toggle("warn", b.dataset.c !== "R");
          $("#m-fx-lres small", root).textContent = b.dataset.c === "R" ? `${outL}` : `${outL}? Check the rule: LEFT gets the old RIGHT`;
        }));
        bindHexDials(root, "m-rd", 8, (s) => M.set("r", s));
        const bin = (h) => parseInt(h, 16).toString(2).padStart(4, "0");
        const cells = (x, c) => x.split("").map((t) => `<span class="xb ${c || ""}">${t}</span>`).join("");
        $$("#m-rd .dial", root).forEach((d, i) => d.addEventListener("focus", () => {
          $$("#m-rd .fx-d", root).forEach((x, k) => x.classList.toggle("cur", k % 8 === i));
          const a = v.l.hex[i], b = v.f.hex[i];
          $("#m-xhelp", root).innerHTML = `<div class="xhelp-h">Column ${i + 1}: ${a} ⊕ ${b}, bit by bit (1 where the bits differ)</div><div class="lx-xor" style="--n:4"><span class="xs">${a}</span>${cells(bin(a))}<span class="xt"></span><span class="xs">⊕ ${b}</span>${cells(bin(b))}<span class="xt"></span><span class="xs">=</span>${cells("????", "q")}<span class="xt">then turn those 4 bits back into one hex digit</span></div>`;
        }));
      },
    };
  }


  /* ============== The machines ============== */
  const BUILD = {
    ascii(P, M) {
      const v = P.view;
      if (v.direction === "decrypt") {
        return {
          html: `<h4>Intercepted radio signal · 8 byte values · set 2 hex digits under each number</h4>
            <div class="letters" id="m-letters" data-dialgroup>${v.chars.map((c, i) => `<div class="letter-col"><button type="button" class="plate" id="m-char${i}" data-i="${i}" aria-label="Inspect byte ${i + 1}: ${c.dec}">${c.dec}</button>
              <div class="pair">${dial(`m-hx-${i * 2}`, "0", `Byte ${i + 1} high hex digit`)}${dial(`m-hx-${i * 2 + 1}`, "0", `Byte ${i + 1} low hex digit`)}</div></div>`).join("")}</div>
            ${screen(`<div id="m-detail" aria-live="polite">These 8 numbers are the encrypted bytes (0 to 255). They are not letters yet: that is what decryption will reveal. Click a number to start converting it: number → 8 bits → 2 hex digits.</div>`, "m-scan")}
            ${drawer("Hex ↔ binary table", `<p class="mono small">0=0000 1=0001 2=0010 3=0011 4=0100 5=0101 6=0110 7=0111<br>8=1000 9=1001 A=1010 B=1011 C=1100 D=1101 E=1110 F=1111</p><p class="small">Tip: number ÷ 16 → the quotient is the first hex digit, the remainder the second.</p>`)}
            <p class="mnote">Use the arrows, or click a dial and type the number / letter you want.</p>`,
          bind(root) {
            const vals = Array(16).fill("0");
            for (let i = 0; i < 16; i++) bindDial(root, `m-hx-${i}`, HEX, (x) => { vals[i] = x; M.set("hex", vals.join("")); });
            $$(".plate", root).forEach((t) => t.addEventListener("click", () => {
              $$(".plate", root).forEach((x) => x.classList.remove("active")); t.classList.add("active");
              const c = v.chars[+t.dataset.i];
              $("#m-detail", root).innerHTML = `Byte <b>${+t.dataset.i + 1}</b> = number <b>${c.dec}</b> → bits <b class="nib">????</b><b class="nib">????</b> → hex <b class="nib">?</b><b class="nib">?</b> <span class="tiny">Your turn: ${c.dec} ÷ 16 gives the two hex digits.</span>`;
              CB.sound("scan");
            }));
          },
        };
      }
      return {
        html: `<h4>Access terminal, code <span class="mono glow">${esc(v.code)}</span> · set 2 hex digits under each letter</h4>
          <div class="letters" id="m-letters" data-dialgroup>${v.chars.map((c, i) => `<div class="letter-col"><button type="button" class="plate" id="m-char${i}" data-i="${i}" aria-label="Inspect character ${i + 1}: ${esc(c.ch)}">${esc(c.ch)}</button>
            <div class="pair">${dial(`m-hx-${i * 2}`, "0", `Character ${i + 1} high hex digit`)}${dial(`m-hx-${i * 2 + 1}`, "0", `Character ${i + 1} low hex digit`)}</div></div>`).join("")}</div>
          ${screen(`<div id="m-detail" aria-live="polite">Click a letter to see its character code (a decimal number). Then convert it yourself: number → 8 bits → 2 hex digits.</div>`, "m-scan")}
          ${drawer("Hex ↔ binary table", `<p class="mono small">0=0000 1=0001 2=0010 3=0011 4=0100 5=0101 6=0110 7=0111<br>8=1000 9=1001 A=1010 B=1011 C=1100 D=1101 E=1110 F=1111</p><p class="small">Tip: 8 bits = 128 64 32 16 | 8 4 2 1. Subtract the biggest values that fit.</p>`)}
          <p class="mnote">Use the arrows, or click a dial and type the number / letter you want.</p>`,
        bind(root) {
          const vals = Array(16).fill("0");
          for (let i = 0; i < 16; i++) bindDial(root, `m-hx-${i}`, HEX, (x) => { vals[i] = x; M.set("hex", vals.join("")); });
          $$(".plate", root).forEach((t) => t.addEventListener("click", () => {
            $$(".plate", root).forEach((x) => x.classList.remove("active")); t.classList.add("active");
            const c = v.chars[+t.dataset.i];
            $("#m-detail", root).innerHTML = `<span class="big">'${esc(c.ch)}'</span> → number <b>${c.dec}</b> → bits <b class="nib">????</b><b class="nib">????</b> → hex <b class="nib">?</b><b class="nib">?</b> <span class="tiny">Your turn: write ${c.dec} as 8 bits, then each 4 bits as one hex digit.</span>`;
            CB.sound("scan");
          }));
        },
      };
    },
    block(P, M) {
      const v = P.view, hidden = v.hidden_byte;
      return {
        html: `<h4>Block inspector</h4>${screen(`<div class="hexline big">${v.block}</div>`)}
          <div class="bytes" id="m-bytes">${v.bytes.map((b) => `<div class="byte ${b.bin ? "" : "hid"}"><small>byte ${b.index}</small><b>${b.hex}</b>${b.bin ? `<span class="bn">${b.bin}</span>` : bitSwitches(8, "m-hb", `Byte ${b.index}`)}</div>`).join("")}</div>
          ${note("m-note", `Byte ${hidden}'s bit lamps are dark. Flip its 8 switches to the right bits (each hex digit = 4 bits).`)}
          ${choiceSwitches(fieldOf(P, "choice"), "m-choice")}`,
        bind(root) { bindSwitches(root, "m-hb", (x) => M.set("bin", x)); bindChoice(root, "m-choice", "choice", M); },
      };
    },
    ip(P, M) {
      return permuteMachine(P, M, { op: "Initial Permutation", srcCols: 8, outCols: 8, srcTitle: "Input block: 64 bits", srcHelp: "Rows are bytes. Small numbers are bit positions 1–64.", outTitle: "IP output: 64 bits", srcWord: "input bit" });
    },
    split(P, M) { return cutter(P, M, { value: P.view.ip, title: "Block after IP: aim the splitter", help: "DES cuts the 64-bit block into a left half L0 and a right half R0." }); },
    key(P, M) {
      const v = P.view;
      return {
        html: `<div class="parity-layout">
            <div><h4>Vault key reader, ${v.key.hex}</h4>
              ${lampGrid(v.key.bin, { cols: 8, id: "m-keybits", buttons: true, label: "Key bits", cls: "taggable" })}
              <p class="tiny muted">Each row is one byte (8 bits). Click a lamp to tag it as a parity bit (P); click again to untag.</p></div>
            <div class="parity-side">
              <div class="pinfo"><h5>${CB.icon("info")} What is a parity bit?</h5>
                <p>An extra <b>check bit</b>, not part of the secret. Each byte of a DES key carries one, set so the byte has an <b>odd number of 1s</b>. It only detects typing or transmission errors, so DES throws it away.</p></div>
              <div class="pcount"><span>Parity bits tagged</span><b id="m-pcount">0 / 8</b></div>
              <div class="pinfo"><h5>${CB.icon("key-round")} Effective key length</h5>
                <div class="keydial-row"><span>Key bits left after removing the parity bits:</span>${numBox("m-eff", "64", "Effective key bits")}</div></div>
            </div>
          </div>
          ${note("m-note", "")}`,
        bind(root) {
          const tagged = new Set();
          const patterns = { "0": [8, 16, 24, 32, 40, 48, 56, 64], "1": [1, 9, 17, 25, 33, 41, 49, 57], "2": [57, 58, 59, 60, 61, 62, 63, 64] };
          const update = () => {
            const s = [...tagged].sort((a, b) => a - b).join(",");
            let choice = "";
            if (!tagged.size) choice = "3";
            Object.entries(patterns).forEach(([k, arr]) => { if (arr.join(",") === s) choice = k; });
            M.set("choice", choice);
            $("#m-pcount", root).textContent = `${tagged.size} / 8`;
            $("#m-note", root).textContent = tagged.size && !choice ? `${tagged.size} bit(s) tagged. Parity bits follow a regular pattern; keep tagging until it is complete.` : tagged.size ? `${tagged.size} parity bits tagged. Now set the effective key length.` : "Choose the parity bits: one in every byte.";
          };
          $$("#m-keybits .lamp", root).forEach((l) => l.addEventListener("click", () => {
            const p = +l.dataset.pos; if (tagged.has(p)) tagged.delete(p); else tagged.add(p);
            l.classList.toggle("tag", tagged.has(p)); CB.sound("click"); update();
          }));
          numberDial(root, "m-eff", 0, 64, 64, (x) => M.set("effective", x));
          update();
        },
      };
    },
    pc1(P, M) {
      return permuteMachine(P, M, { op: "PC-1", srcCols: 8, outCols: 7, srcTitle: "64-bit key", srcHelp: "Rows are bytes. The last column holds the parity bits: PC-1 never copies them.", outTitle: "PC-1 output: 56 bits", srcWord: "key bit" });
    },
    keysplit(P, M) { return cutter(P, M, { value: P.view.pc1, title: "PC-1 output (56 bits): aim the splitter", help: "The 56 bits split into two 28-bit halves, C0 and D0." }); },
    shift(P, M) {
      const v = P.view;
      const rounds = v.rounds || [v.round];
      const first = rounds[0], last = rounds[rounds.length - 1];
      return {
        html: `<h4>Rotation schedule</h4><div class="sched" id="m-sched">${v.schedule.map((s, i) => `<span data-r="${i + 1}" class="${rounds.includes(i + 1) ? "task" : ""} ${i + 1 < first ? "past" : ""}"><small>R${i + 1}</small>${s}</span>`).join("")}</div>
          <div class="shift-layout">
            <div class="rotors" id="m-rotors">${["c", "d"].map((h) => `<div class="rotor-wrap" id="m-${h}wrap">
              <div class="rotor" id="m-rotor-${h}"><div class="hub">${h.toUpperCase()}<small id="m-${h}n">0 turns</small></div></div>
              <div class="rot-btns"><button type="button" class="mbtn" id="m-rot-${h}">${CB.icon("rotate-ccw")} Rotate ${h.toUpperCase()} left</button></div>
              <p class="lin mono" id="m-${h}lin"></p></div>`).join("")}</div>
            <div class="shift-log">
              <p class="shift-now" id="m-now"></p>
              <div class="rot-btns"><button type="button" class="mbtn" id="m-record">${CB.icon("check")} Record round</button><button type="button" class="mbtn ghost" id="m-undo">Redo this round</button></div>
              <table class="shift-table"><thead><tr><th>Round</th><th>Shift</th><th>C</th><th>D</th></tr></thead><tbody>
                <tr class="done"><td>${first - 1}</td><td>start</td><td class="mono">${CB.group(v.c_prev.bin, 7)}</td><td class="mono">${CB.group(v.d_prev.bin, 7)}</td></tr>
                ${rounds.map((r) => `<tr id="m-row-${r}"><td>${r}</td><td>?</td><td class="mono">—</td><td class="mono">—</td></tr>`).join("")}
              </tbody></table>
            </div>
          </div>
          ${note("m-note", `Start: C${first - 1} and D${first - 1}. You will do ${rounds.length} rounds in a row (R${first}–R${last}). For each round, read its shift in the schedule, rotate BOTH disks that many times, then press Record round. The amber lamp is bit 1; watch it wrap to the end.`)}`,
        bind(root) {
          const st = { c: v.c_prev.bin, d: v.d_prev.bin }, base = { c: v.c_prev.bin, d: v.d_prev.bin }, n = { c: 0, d: 0 };
          let idx = 0;
          const cur = () => rounds[idx];
          const header = () => {
            $$("#m-sched span", root).forEach((s) => {
              const r = +s.dataset.r, k = rounds.indexOf(r);
              s.classList.toggle("cur", r === cur());
              s.classList.toggle("past", r < first || (k > -1 && k < idx));
            });
            $("#m-now", root).innerHTML = idx < rounds.length ? `Now: <b>round ${cur()}</b>. Rotate C and D, then record C${cur()} and D${cur()}.` : `<b>All ${rounds.length} rounds recorded.</b>`;
            $("#m-record", root).disabled = idx >= rounds.length; $("#m-undo", root).disabled = idx >= rounds.length;
          };
          const draw = (h) => {
            const rotor = $(`#m-rotor-${h}`, root);
            $$(".rb", rotor).forEach((x) => x.remove());
            const R = 92;
            st[h].split("").forEach((b, i) => {
              const s = document.createElement("span"); const a = (i / 28) * 2 * Math.PI - Math.PI / 2;
              s.className = "rb " + (b === "1" ? "on " : "") + ((i + n[h]) % 28 === 0 ? "first" : "");
              s.style.left = `calc(50% + ${Math.cos(a) * R}px)`; s.style.top = `calc(50% + ${Math.sin(a) * R}px)`; s.textContent = b; rotor.appendChild(s);
            });
            $(`#m-${h}n`, root).textContent = `${n[h]} turn${n[h] === 1 ? "" : "s"}`;
            $(`#m-${h}lin`, root).textContent = `${h.toUpperCase()} = ${CB.group(st[h], 7)}`;
          };
          ["c", "d"].forEach((h) => {
            $(`#m-rot-${h}`, root).addEventListener("click", () => {
              if (idx >= rounds.length) return;
              st[h] = st[h].slice(1) + st[h][0]; n[h]++; CB.sound("rotor");
              const rotor = $(`#m-rotor-${h}`, root);
              if (!CB.reducedMotion()) { rotor.classList.remove("spin"); void rotor.offsetWidth; rotor.classList.add("spin"); }
              draw(h);
            });
            draw(h);
          });
          $("#m-undo", root).addEventListener("click", () => {
            ["c", "d"].forEach((h) => { st[h] = base[h]; n[h] = 0; draw(h); });
            $("#m-note", root).textContent = `Disks back to C${cur() - 1} and D${cur() - 1}. Try round ${cur()} again.`;
          });
          $("#m-record", root).addEventListener("click", () => {
            const r = cur(), need = v.schedule[r - 1];
            if (n.c === 0 || n.d === 0) { $("#m-note", root).textContent = "Rotate both disks first: C and D always shift by the same amount."; return; }
            if (n.c !== need || n.d !== need) {
              CB.sound("deny");
              $("#m-note", root).innerHTML = n.c !== n.d
                ? `C turned ${n.c} times and D ${n.d} times. Both halves always rotate by the <b>same</b> amount. Press <b>Redo this round</b>.`
                : `You rotated ${n.c}. Look at <b>R${r}</b> in the schedule: how many places does round ${r} shift? Press <b>Redo this round</b> and try again.`;
              return;
            }
            M.set(`c${r}`, st.c); M.set(`d${r}`, st.d); CB.sound("good");
            const row = $(`#m-row-${r}`, root); row.classList.add("done");
            row.innerHTML = `<td>${r}</td><td>${need}</td><td class="mono">${CB.group(st.c, 7)}</td><td class="mono">${CB.group(st.d, 7)}</td>`;
            base.c = st.c; base.d = st.d; n.c = 0; n.d = 0; idx++;
            ["c", "d"].forEach(draw); header();
            $("#m-note", root).innerHTML = idx < rounds.length
              ? `Round ${r} recorded (shift ${need}). Round ${cur()} continues from C${r} and D${r}.`
              : `All rounds recorded: ${rounds.map((x) => v.schedule[x - 1]).join(" + ")} = ${rounds.reduce((t, x) => t + v.schedule[x - 1], 0)} places in total. Press ${CB.icon("arrow-right")} NEXT.`;
          });
          header();
        },
      };
    },
    pc2(P, M) {
      const v = P.view;
      return permuteMachine(P, M, { op: "PC-2", srcCols: 7, outCols: 6, srcTitle: `C${v.round} ‖ D${v.round} (56 bits)`, srcHelp: "First 4 rows = C, last 4 rows = D.", outTitle: `Round key K${v.round}: 48 bits`, srcWord: "C‖D bit" });
    },
    keyexplorer(P, M) {
      const ks = P.view.schedule;
      return {
        html: `<ol class="rc-steps">
            <li><b>Pull the lever</b> to make all 16 round keys. Each card shows how far that round rotates C and D (⟲1 or ⟲2).</li>
            <li><b>Add up</b> the 16 rotations and type the total in the box (or use the arrows).</li>
            <li><b>Compare</b> C16 with C0 (open the inspector below) and choose the answer.</li>
          </ol>
          <div class="forge" id="m-forge">
            <button type="button" class="biglever" id="m-run"><span class="handle"></span>PULL TO FORGE K1 → K16</button>
            <div class="kslots" id="m-kslots">${ks.rounds.map((r) => `<button type="button" class="kslot" data-k="${r.round}"><small>K${r.round}</small><span>⟲${r.shift}</span></button>`).join("")}</div>
            <div class="gauge"><span>Total rotation</span><b id="m-total">0</b><i id="m-gbar"></i></div></div>
          ${note("m-note", "Pull the lever. Each round rotates C and D, then PC-2 stamps out a 48-bit key.")}
          <div class="answers-row"><div class="keydial-row"><span>Total rotation after round 16</span>${numBox("m-tot", "0", "Total rotation")}</div>
          ${choiceSwitches(fieldOf(P, "same"), "m-same")}</div>
          ${drawer("Inspect every key round (C, D, shift, PC-2, subkey)", `<div id="m-ks"></div>`, "m-ksd")}`,
        bind(root) {
          CB.renderKeySchedule($("#m-ks", root), ks);
          numberDial(root, "m-tot", 0, 64, 0, (x) => M.set("total", x));
          bindChoice(root, "m-same", "same", M);
          $$(".kslot", root).forEach((b) => b.addEventListener("click", () => {
            $("#m-ksd", root).open = true; const t = $(`[data-kround="${b.dataset.k}"]`, root); if (t) t.click();
          }));
          $("#m-run", root).addEventListener("click", () => {
            const lever = $("#m-run", root); lever.classList.add("pulled"); lever.disabled = true;
            let k = 0;
            const step = () => {
              const r = ks.rounds[k], slot = $$(".kslot", root)[k];
              slot.classList.add("lit"); slot.title = r.subkey.hex;
              $("#m-gbar", root).style.width = (r.total_shift / 28) * 100 + "%";
              $("#m-note", root).innerHTML = `Round ${r.round}: rotate ⟲${r.shift} → C${r.round}=${r.c.hex}, D${r.round}=${r.d.hex} → K${r.round} = <b>${r.subkey.hex}</b>`;
              $("#m-total", root).textContent = "…";
              CB.sound("forge"); k++;
              if (k < 16) setTimeout(step, CB.reducedMotion() ? 40 : 260);
              else { lever.disabled = false; lever.classList.remove("pulled"); $("#m-total", root).textContent = "?"; $("#m-note", root).innerHTML += "<br>All 16 keys forged. Count the rotations in the schedule and compare C16 with C0 in the inspector."; }
            };
            step();
          });
        },
      };
    },
    expand(P, M) {
      const v = P.view;
      return permuteMachine(P, M, { op: "expansion E", srcCols: 4, outCols: 6, srcTitle: `R${v.round - 1}: 32 bits in (rows of 4)`, srcHelp: "Each row is one 4-bit group. E copies each group plus the edge bits of its neighbours.", outTitle: "E output: 48 bits (8 groups of 6)", srcWord: "R bit" });
    },
    xor(P, M) {
      const v = P.view, g = v.group, a = v.expanded.bin.slice(6 * g, 6 * g + 6), k = v.subkey.bin.slice(6 * g, 6 * g + 6);
      const hl = (bits) => bits.split("").map((b, i) => `<span class="${Math.floor(i / 6) === g ? "hl" : ""}">${b}</span>${i % 6 === 5 ? " " : ""}`).join("");
      return {
        html: `<div class="busrows">${screen(`<div><small>E(R${v.round - 1})</small> <span class="mono">${hl(v.expanded.bin)}</span></div><div><small>K${v.key_index}</small> <span class="mono">${hl(v.subkey.bin)}</span></div>`)}</div>
          <h4>XOR wiring, group ${g + 1} (bits ${6 * g + 1}–${6 * g + 6})</h4>
          <div class="xor-layout"><div class="gates" id="m-gates">${a.split("").map((x, i) => `<div class="xgate" data-i="${i}">
            <span class="in ${x === "1" ? "on" : ""}">${x}</span><span class="in ${k[i] === "1" ? "on" : ""}">${k[i]}</span>
            <svg viewBox="0 0 76 90" class="sym" aria-hidden="true"><path class="lead" d="M18,0 V19 M58,0 V19 M38,80 V90"/><path class="back" d="M8,12 Q38,28 68,12"/><path class="body" d="M8,22 Q38,38 68,22 Q68,62 38,80 Q8,62 8,22 Z"/><text x="38" y="58" text-anchor="middle">XOR</text></svg>
            <button type="button" class="bitsw out" aria-label="Output bit ${i + 1}: unset">?</button></div>`).join("")}</div>
          <table class="truth" aria-label="XOR truth table"><caption>XOR rule</caption><tr><th>a</th><th>b</th><th>a⊕b</th></tr><tr><td>0</td><td>0</td><td>0</td></tr><tr><td>0</td><td>1</td><td>1</td></tr><tr><td>1</td><td>0</td><td>1</td></tr><tr><td>1</td><td>1</td><td>0</td></tr></table></div>`,
        bind(root) {
          const out = Array(6).fill("?");
          $$("#m-gates .out", root).forEach((b, i) => b.addEventListener("click", () => {
            out[i] = out[i] === "1" ? "0" : "1"; b.textContent = out[i]; b.classList.add("set"); b.classList.toggle("on", out[i] === "1");
            $$("#m-gates .xgate", root).forEach((x) => x.classList.remove("live", "dead"));
            CB.sound("click"); M.set("x", out.includes("?") ? "" : out.join(""));
          }));
        },
        solved(root) { $$("#m-gates .xgate", root).forEach((x, i) => setTimeout(() => x.classList.add("live"), i * 90)); },
        wrong(root) { $$("#m-gates .xgate", root).forEach((x) => x.classList.add("dead")); },
      };
    },
    sbox(P, M) {
      const v = P.view, inp = v.input;
      const R = parseInt(inp[0] + inp[5], 2), C = parseInt(inp.slice(1, 5), 2), VAL = v.table[R][C];
      const VB = VAL.toString(2).padStart(4, "0");
      const bitsBig = (hlRow, hlCol) => `<div class="sx-in">${inp.split("").map((b, i) => {
        const isRow = i === 0 || i === 5;
        const cls = isRow ? (hlRow ? "row" : "dim") : (hlCol ? "col" : "dim");
        return `<span class="sx-bit ${cls}"><small>bit ${i + 1}</small><b>${b}</b></span>`;
      }).join("")}</div>`;
      const steps = ["Row", "Column", "Look up", "4 bits"];
      return {
        html: `<div class="sx">
          <ol class="sx-steps" id="m-sx-steps">${steps.map((s, i) => `<li data-s="${i}"><span>${i + 1}</span>${s}</li>`).join("")}</ol>
          <div class="sx-card" id="m-sx-0">
            <h4>Step 1: find the ROW</h4>
            <p class="sx-lead">The row comes from the <b class="rowc">first and last</b> bits only.</p>
            ${bitsBig(true, false)}
            <div class="sx-eq"><span class="sx-pill row">${inp[0]}</span><span class="sx-pill row">${inp[5]}</span><span class="sx-arrow">→</span><span>2-bit number = which row?</span></div>
            <div class="sx-choices" id="m-sx-rows">${[0, 1, 2, 3].map((r) => `<button type="button" class="sx-ch" data-v="${r}"><b>${r}</b><small>${r.toString(2).padStart(2, "0")}</small></button>`).join("")}</div>
          </div>
          <div class="sx-card hidden" id="m-sx-1">
            <h4>Step 2: find the COLUMN</h4>
            <p class="sx-lead">The column comes from the <b class="colc">middle four</b> bits (bits 2 to 5).</p>
            ${bitsBig(false, true)}
            <div class="sx-place">${inp.slice(1, 5).split("").map((b, i) => `<span><small>${[8, 4, 2, 1][i]}</small><b>${b}</b></span>`).join("")}<em>Add the place values where the bit is 1.</em></div>
            <div class="sx-choices sx-16" id="m-sx-cols">${[...Array(16).keys()].map((c) => `<button type="button" class="sx-ch" data-v="${c}"><b>${c}</b></button>`).join("")}</div>
          </div>
          <div class="sx-card hidden" id="m-sx-2">
            <h4>Step 3: look it up in S${v.box}</h4>
            <p class="sx-lead">Follow row <b class="rowc">${R}</b> across and column <b class="colc">${C}</b> down. Click the cell where they meet.</p>
            <div class="sgrid sx-grid" id="m-sgrid" role="grid" aria-label="S${v.box} table">
              <span class="corner">S${v.box}</span>${[...Array(16).keys()].map((c) => `<span class="ch ${c === C ? "colhl" : ""}">${c}</span>`).join("")}
              ${v.table.map((row, r) => `<span class="rh ${r === R ? "rowhl" : ""}">${r}</span>${row.map((x, c) => `<button type="button" class="sc ${r === R ? "rowhl" : ""} ${c === C ? "colhl" : ""}" data-r="${r}" data-c="${c}">${x}</button>`).join("")}`).join("")}
            </div>
          </div>
          <div class="sx-card hidden" id="m-sx-3">
            <h4>Step 4: write ${VAL} as 4 bits</h4>
            <p class="sx-lead">Turn on the place values that add up to <b>${VAL}</b>.</p>
            <div class="sx-out" id="m-sx-out">${[8, 4, 2, 1].map((pv, i) => `<button type="button" class="sx-ob" data-i="${i}"><small>${pv}</small><b>0</b></button>`).join("")}<span class="sx-sum">= <b id="m-sx-sum">0</b></span></div>
          </div>
          <div class="sx-summary" id="m-sx-sum-line"></div>
        </div>
        ${note("m-note", "")}`,
        bind(root) {
          let step = 0;
          const say = (t) => { $("#m-note", root).innerHTML = t; };
          const summary = () => {
            const parts = [];
            if (step > 0) parts.push(`row <b class="rowc">${R}</b>`);
            if (step > 1) parts.push(`column <b class="colc">${C}</b>`);
            if (step > 2) parts.push(`value <b>${VAL}</b>`);
            $("#m-sx-sum-line", root).innerHTML = parts.length ? `S${v.box}(${inp}): ` + parts.join(" · ") : "";
          };
          const go = (s) => {
            step = s;
            $$(".sx-card", root).forEach((c, i) => c.classList.toggle("hidden", i !== s));
            $$("#m-sx-steps li", root).forEach((li, i) => { li.classList.toggle("done", i < s); li.classList.toggle("cur", i === s); });
            summary();
          };
          const bad = (btn, msg) => { btn.classList.add("bad"); setTimeout(() => btn.classList.remove("bad"), 500); CB.sound("deny"); say(msg); };
          $$("#m-sx-rows .sx-ch", root).forEach((b) => b.addEventListener("click", () => {
            const x = +b.dataset.v;
            if (x !== R) return bad(b, `Not ${x}. Read the two row bits <b>${inp[0]}${inp[5]}</b> as a binary number: 00 = 0, 01 = 1, 10 = 2, 11 = 3.`);
            b.classList.add("ok"); CB.sound("good"); M.set("row", String(R));
            say(`Row ${R}: the bits ${inp[0]}${inp[5]} in binary.`); setTimeout(() => go(1), 450);
          }));
          $$("#m-sx-cols .sx-ch", root).forEach((b) => b.addEventListener("click", () => {
            const x = +b.dataset.v;
            if (x !== C) return bad(b, `Not ${x}. ${inp.slice(1, 5)}: add 8, 4, 2 and 1 only where the bit is 1.`);
            b.classList.add("ok"); CB.sound("good"); M.set("col", String(C));
            const terms = inp.slice(1, 5).split("").map((t, i) => (t === "1" ? [8, 4, 2, 1][i] : null)).filter((t) => t !== null);
            say(`Column ${C}${terms.length > 1 ? ` (${terms.join(" + ")})` : ""}.`); setTimeout(() => go(2), 450);
          }));
          $$("#m-sgrid .sc", root).forEach((b) => b.addEventListener("click", () => {
            const r = +b.dataset.r, c = +b.dataset.c;
            if (r !== R || c !== C) return bad(b, `That cell is row ${r}, column ${c}. You need row <b class="rowc">${R}</b> and column <b class="colc">${C}</b>, where the two highlighted lines cross.`);
            b.classList.add("sel"); CB.sound("good");
            say(`S${v.box}[${R}][${C}] = ${VAL}.`); setTimeout(() => go(3), 450);
          }));
          const ob = [0, 0, 0, 0];
          $$("#m-sx-out .sx-ob", root).forEach((b) => b.addEventListener("click", () => {
            const i = +b.dataset.i; ob[i] ^= 1; b.classList.toggle("on", !!ob[i]); $("b", b).textContent = ob[i];
            const bits = ob.join(""), sum = parseInt(bits, 2);
            $("#m-sx-sum", root).textContent = sum; CB.sound("click");
            M.set("out", bits);
            if (bits === VB) { $("#m-sx-out", root).classList.add("ok"); $$("#m-sx-steps li", root)[3].classList.add("done"); say(`${VAL} = <b>${VB}</b>. Press ${CB.icon("arrow-right")} NEXT.`); }
            else { $("#m-sx-out", root).classList.remove("ok"); say(sum > VAL ? `That makes ${sum}, more than ${VAL}.` : `That makes ${sum}. Keep going until it adds up to ${VAL}.`); }
          }));
          go(0);
          say("One step at a time: first the row.");
        },
      };
    },
    perm(P, M) {
      const v = P.view;
      const t = permuteMachine(P, M, { op: "permutation P", srcCols: 4, outCols: 8, srcTitle: "S1…S8 outputs (32 bits)", srcHelp: "Each row is one S-box's 4 output bits.", outTitle: "P output: 32 bits", srcWord: "S-output bit" });
      t.html = drawer("This round's S-box lookups", CB.sboxCards(v.sboxes)) + t.html;
      return t;
    },
    feistel(P, M) { return router(P, M, false); },
    decround(P, M) { return router(P, M, true); },
    fullrun(P, M) {
      const tr = P.view.trace, f = fieldOf(P, "choice");
      const last = tr.rounds[15];
      const isDec = P.view.direction === "decrypt", outWord = isDec ? "plaintext" : "ciphertext";
      return {
        html: `<div class="fr">
          <section class="fx-step" id="m-fr-1"><h4><span class="fx-n">1</span> Run all 16 rounds</h4>
            <p>Every round is exactly the step you just did: <b>E → XOR with the round key → S-boxes → P</b>, then the Feistel update (new L = old R, new R = old L ⊕ F). ${isDec ? "This is <b>decryption</b>, so the keys run backwards: round 1 uses K16, round 2 uses K15, … round 16 uses K1." : "Round 1 uses K1, round 2 uses K2, … round 16 uses K16."} Pull the lever and watch L and R change round by round.</p>
            <div class="reactor" id="m-reactor">
              <div class="ring" id="m-ring">${tr.rounds.map((r, i) => `<span class="rl" style="--a:${(i / 16) * 360}deg"><i>${r.round}</i></span>`).join("")}<div class="core" id="m-core"><small>L | R</small><b id="m-lr">${tr.l0.hex}<br>${tr.r0.hex}</b></div></div>
              <div class="reactor-side">
                <button type="button" class="biglever" id="m-ignite"><span class="handle"></span>PULL TO RUN 16 ROUNDS</button>
                <div class="fr-log-wrap"><table class="fr-log" id="m-frlog"><thead><tr><th>Round</th><th>Key</th><th>L</th><th>R</th></tr></thead>
                  <tbody><tr class="on"><td>start</td><td></td><td class="mono">${tr.l0.hex}</td><td class="mono">${tr.r0.hex}</td></tr>
                  ${tr.rounds.map((r) => `<tr data-r="${r.round}"><td>${r.round}</td><td>K${r.key_index}</td><td class="mono">${r.l_out.hex}</td><td class="mono">${r.r_out.hex}</td></tr>`).join("")}</tbody></table></div>
              </div></div>
          </section>
          <section class="fx-step locked" id="m-fr-2"><h4><span class="fx-n">2</span> The final swap</h4>
            <p>After round 16 you have <b class="c-l">L16</b> and <b class="c-r">R16</b>. DES <b>swaps them one last time</b> and puts <b class="c-r">R16</b> first. Why? Round 16 is not supposed to end with a swap; undoing it makes decryption able to use exactly the same steps, just with the keys in reverse.</p>
            <div class="fr-swap"><span class="fr-h l">L16<small id="m-frl">${"?".repeat(8)}</small></span><span class="fr-h r">R16<small id="m-frr">${"?".repeat(8)}</small></span><span class="fx-arrow">⇄</span><span class="muted">Which block goes into IP⁻¹?</span></div>
            <div class="ipinv">${f.options.map((o) => `<button type="button" class="cartopt" data-v="${o.value}">${esc(o.label)}</button>`).join("")}</div>
          </section>
          <section class="fx-step locked" id="m-fr-3"><h4><span class="fx-n">3</span> IP⁻¹ gives the ${outWord}</h4>
            <p>IP⁻¹ is the inverse of the initial permutation: it moves the 64 bits back to their original order. The result is the <b>${outWord}</b>. Press ${CB.icon("arrow-right")} NEXT to run it.</p>
          </section>
          ${drawer("Full round log: every operation of every round (E, XOR, S-boxes, P)", `<div id="m-trace"></div>`, "m-logd")}
        </div>
        ${note("m-note", "Step 1: pull the lever.")}`,
        bind(root) {
          const view = CB.renderTrace($("#m-trace", root), Object.assign({ mode: isDec ? "decrypt" : "encrypt" }, tr));
          const say = (t) => { $("#m-note", root).innerHTML = t; };
          $$(".cartopt", root).forEach((b) => b.addEventListener("click", () => {
            $$(".cartopt", root).forEach((x) => x.classList.toggle("on", x === b)); M.set("choice", b.dataset.v); CB.sound("zap");
            $("#m-fr-3", root).classList.remove("locked");
            say(`Step 3: press ${CB.icon("arrow-right")} NEXT to apply IP⁻¹.`);
          }));
          $("#m-ignite", root).addEventListener("click", () => {
            const lever = $("#m-ignite", root); lever.classList.add("pulled"); lever.disabled = true;
            let k = 0; const lamps = $$("#m-ring .rl", root);
            $$("#m-frlog tbody tr[data-r]", root).forEach((x) => x.classList.remove("on", "cur"));
            const step = () => {
              const r = tr.rounds[k]; lamps[k].classList.add("lit");
              $("#m-lr", root).innerHTML = `${r.l_out.hex}<br>${r.r_out.hex}`; view.show(r.round);
              const row = $(`#m-frlog tr[data-r="${r.round}"]`, root);
              $$("#m-frlog tr.cur", root).forEach((x) => x.classList.remove("cur"));
              row.classList.add("on", "cur"); row.scrollIntoView({ block: "nearest" });
              say(`Round ${r.round} with K${r.key_index}: L${r.round} = ${r.l_out.hex}, R${r.round} = ${r.r_out.hex}`);
              CB.sound("power"); if (window.Game) window.Game.reactorPower((k + 1) / 16);
              k++;
              if (k < 16) setTimeout(step, CB.reducedMotion() ? 40 : 280);
              else {
                $("#m-core", root).classList.add("hot"); lever.classList.remove("pulled"); lever.disabled = false;
                $("#m-frl", root).textContent = last.l_out.hex; $("#m-frr", root).textContent = last.r_out.hex;
                $("#m-fr-2", root).classList.remove("locked");
                say(`All 16 rounds done. Step 2: choose the block that goes into IP⁻¹.`);
                $("#m-fr-2", root).scrollIntoView({ block: "nearest", behavior: CB.reducedMotion() ? "auto" : "smooth" });
              }
            };
            step();
          });
        },
      };
    },
    order(P, M) {
      const v = P.view, enc = v.direction === "encrypt", RL = enc ? "E" : "D", RW = enc ? "Encryption" : "Decryption";
      return {
        html: `<div class="keyrack-head">${screen(`<div>${enc ? "Recovered message, to encrypt again" : "Exit ciphertext"}${enc ? "" : ` <b class="mono">${v.cipher}</b>`} · key <b class="mono">${v.key.hex}</b></div>`)}</div>
          <ol class="rc-steps">
            ${enc ? `<li>Encryption uses the 16 keys <b>in the order they were made</b>: encryption round 1 (E1) needs <b>K1</b>, E2 needs <b>K2</b>, … E16 needs <b>K16</b>. Your decryption used the same keys backwards.</li>`
                  : `<li>Decryption uses the <b>same 16 keys, backwards</b>: decryption round 1 (D1) needs <b>K16</b>, D2 needs <b>K15</b>, … D16 needs <b>K1</b>.</li>`}
            <li><b>Drag</b> each key from the pile into its round (or click a key to put it into the next empty round). Click a filled round to take the key out.</li>
          </ol>
          <div class="keycarts" id="m-chips">${v.chips.map((c) => `<button type="button" class="kcart" draggable="true" data-k="${c.k}" aria-label="Round key K${c.k}"><b>K${c.k}</b><small>${c.hex}</small></button>`).join("")}</div>
          <div class="kslots rack" id="m-slots">${[...Array(16).keys()].map((i) => `<div class="kslot" data-slot="${i}" tabindex="0" role="button" aria-label="${RW} round ${i + 1}: empty"><small>Round ${RL}${i + 1}</small><span>—</span></div>`).join("")}</div>
          <div class="btnrow"><button type="button" class="mbtn ghost" id="m-undo">Undo</button><button type="button" class="mbtn ghost" id="m-clear">Eject all</button></div>`,
        bind(root) {
          let slots = Array(16).fill(null); const hist = [];
          const draw = () => {
            $$(".kcart", root).forEach((c) => { const u = slots.includes(+c.dataset.k); c.classList.toggle("used", u); c.setAttribute("aria-disabled", u); });
            $$("#m-slots .kslot", root).forEach((d, i) => { const k = slots[i]; d.querySelector("span").textContent = k ? "K" + k : "—"; d.classList.toggle("lit", !!k); d.draggable = !!k; d.setAttribute("aria-label", `${RW} round ${i + 1}: ${k ? "K" + k : "empty"}`); });
            M.set("order", slots.every(Boolean) ? slots.join(",") : "");
          };
          const place = (k, i) => { hist.push(slots.slice()); const from = slots.indexOf(k), occ = slots[i]; if (from >= 0) slots[from] = occ; slots[i] = k; CB.sound("clunk"); draw(); };
          $$(".kcart", root).forEach((c) => {
            c.addEventListener("click", () => { const k = +c.dataset.k, i = slots.indexOf(null); if (!slots.includes(k) && i >= 0) place(k, i); });
            c.addEventListener("dragstart", (e) => { e.dataTransfer.setData("text/plain", c.dataset.k); e.dataTransfer.effectAllowed = "move"; });
          });
          $$("#m-slots .kslot", root).forEach((d, i) => {
            d.addEventListener("dragstart", (e) => { if (slots[i]) e.dataTransfer.setData("text/plain", String(slots[i])); });
            d.addEventListener("dragover", (e) => { e.preventDefault(); d.classList.add("over"); });
            d.addEventListener("dragleave", () => d.classList.remove("over"));
            d.addEventListener("drop", (e) => { e.preventDefault(); d.classList.remove("over"); const k = +e.dataTransfer.getData("text/plain"); if (k) place(k, i); });
            const clear = () => { if (slots[i]) { hist.push(slots.slice()); slots[i] = null; CB.sound("click"); draw(); } };
            d.addEventListener("click", clear);
            d.addEventListener("keydown", (e) => { if (["Enter", " ", "Delete", "Backspace"].includes(e.key)) { e.preventDefault(); clear(); } });
          });
          $("#m-undo", root).onclick = () => { if (hist.length) { slots = hist.pop(); draw(); } };
          $("#m-clear", root).onclick = () => { hist.push(slots.slice()); slots = Array(16).fill(null); draw(); };
          draw();
        },
      };
    },
    recover(P, M) {
      const v = P.view, pairs = v.plain.hex.match(/../g);
      const chars = [..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"];
      const strip = `<div class="lx-ascii rc-ascii" id="m-ascii">${chars.map((c) => `<span data-h="${c.charCodeAt(0).toString(16).toUpperCase()}"><b>${c}</b><small>${c.charCodeAt(0).toString(16).toUpperCase()}</small></span>`).join("")}</div>`;
      return {
        html: `${screen(`<div>${v.direction === "decrypt" ? "Your Reactor decrypted the intercepted ciphertext" : "Ciphertext"} <b class="mono">${v.cipher}</b> → 16 decryption rounds → plaintext bytes</div><div class="hexline big" id="m-plain">${pairs.join(" ")}</div>`)}
          <ol class="rc-steps">
            <li><b>Read</b> the hex byte above a wheel (for example <span class="mono">4F</span>).</li>
            <li><b>Find</b> that code in the table: the small yellow number under each character is its hex code.</li>
            <li><b>Turn</b> the wheel to that character (arrows, or click the wheel and type the letter).</li>
          </ol>
          <div class="wheels" id="m-wheels" data-dialgroup>${pairs.map((p, i) => `<div class="wheel-col" data-i="${i}"><span class="mono byte">${p}</span>${dial(`m-wh-${i}`, "A", `Character ${i + 1} (byte ${p})`, "wheel")}</div>`).join("")}</div>
          <div class="rc-help" id="m-rchelp">Click a wheel to start with its byte.</div>
          <h4>Character table (hex code under each character)</h4>
          ${strip}
          ${drawer("Decryption log, all 16 rounds (keys K16 → K1)", `<div id="m-dtrace"></div>`)}`,
        bind(root) {
          const vals = Array(8).fill("A");
          for (let i = 0; i < 8; i++) {
            bindDial(root, `m-wh-${i}`, chars, (x) => { vals[i] = x; M.set("code", vals.join("")); }, "A");
            $(`#m-wh-${i}`, root).addEventListener("focus", () => {
              const p = pairs[i], d = parseInt(p, 16);
              $$("#m-wheels .wheel-col", root).forEach((c) => c.classList.toggle("cur", +c.dataset.i === i));
              $$("#m-ascii span", root).forEach((s) => s.classList.remove("hl"));
              $("#m-rchelp", root).innerHTML = `Wheel ${i + 1}: byte <b class="mono">${p}</b> = ${p[0]} × 16 + ${parseInt(p[1], 16)} = <b>${d}</b>. Find <b class="mono">${p}</b> in the table below, then turn this wheel to that character.`;
            });
          }
          CB.renderTrace($("#m-dtrace", root), Object.assign({ mode: "decrypt" }, v.trace));
        },
      };
    },
    verdict(P, M) {
      return {
        html: `<div class="dialog-q" id="m-verdict">${P.fields.map((f, i) => `<div class="vq" data-i="${i}" ${i ? "hidden" : ""}>
            <p class="nova-line"><span class="nova-face" aria-hidden="true"></span><span>“${esc(f.label)}”</span></p>
            <div class="vopts">${f.options.map((o) => `<button type="button" class="vopt" data-f="${f.name}" data-v="${o.value}">${esc(o.label)}</button>`).join("")}</div></div>`).join("")}
          <div class="vprog" id="m-vprog">${P.fields.map((f, i) => `<span data-i="${i}">${i + 1}</span>`).join("")}</div></div>`,
        bind(root) {
          const qs = $$(".vq", root), prog = $$("#m-vprog span", root);
          const show = (i) => { qs.forEach((q, k) => (q.hidden = k !== i)); prog.forEach((p, k) => p.classList.toggle("cur", k === i)); };
          prog.forEach((p, i) => p.addEventListener("click", () => show(i)));
          $$(".vopt", root).forEach((b) => b.addEventListener("click", () => {
            const q = b.closest(".vq"); $$(".vopt", q).forEach((x) => x.classList.toggle("on", x === b));
            M.set(b.dataset.f, b.dataset.v); CB.sound("click");
            const i = +q.dataset.i; prog[i].classList.add("done");
            if (i < qs.length - 1) setTimeout(() => show(i + 1), 250);
          }));
          show(0);
        },
        wrong(root, res) {
          const prog = $$("#m-vprog span", root);
          Object.entries(res.fields || {}).forEach(([name, ok]) => { const i = +name.slice(1); if (prog[i]) { prog[i].classList.toggle("bad", !ok); prog[i].classList.toggle("done", ok); } });
          const first = Object.entries(res.fields || {}).find(([, ok]) => !ok);
          if (first) prog[+first[0].slice(1)].click();
        },
      };
    },
  };

  window.Machines = {
    build(P, M) { const b = BUILD[P.view.kind]; return b ? b(P, M) : { html: "<p>Unknown machine.</p>" }; },
    kinds: Object.keys(BUILD),
  };
})();
