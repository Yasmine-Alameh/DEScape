/* DEScape — "Learn first" lessons shown inside each machine before the player tries it.
 * Every lesson explains the idea step by step with a worked example (never the player's own
 * answer), checks understanding with one practice question, then says exactly what to do.
 * Lessons.build(P) -> [{ t: title, h: html, practice?: { q, a: [answers], why } }]
 */
(function () {
  "use strict";
  const esc = (s) => CB.esc(s);
  const bin8 = (n) => n.toString(2).padStart(8, "0");
  const hex2 = (n) => n.toString(16).toUpperCase().padStart(2, "0");
  const nib = (b) => `<span class="lx-nib">${b}</span>`;
  const box = (txt, cls) => `<span class="lx-box ${cls || ""}">${txt}</span>`;
  const arrow = `<span class="lx-arrow">→</span>`;
  const row = (...parts) => `<div class="lx-row">${parts.join("")}</div>`;
  const HEXTABLE = `<div class="lx-hextable">${[...Array(16).keys()].map((i) => `<span><b>${i.toString(16).toUpperCase()}</b>${i.toString(2).padStart(4, "0")}</span>`).join("")}</div>`;
  const TRY = (text) => ({ t: "Your turn", h: `<p>${text}</p>`, last: true });
  /* Character table for Room 4 (E9). */
  const ASCII_STRIP = `<div class="lx-ascii">${[..."ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789"].map((c) => `<span><b>${c}</b><small>${c.charCodeAt(0).toString(16).toUpperCase()}</small></span>`).join("")}</div>`;
  /* Column-aligned XOR sum (E2): one cell per bit, the ⊕ / = signs in their own left column. */
  const xorGrid = (rows) => {
    const n = Math.max(...rows.map((r) => r[1].length));
    return `<div class="lx-xor" style="--n:${n}">${rows.map(([sign, bits, cls, tail]) =>
      `<span class="xs">${sign}</span>${bits.split("").map((b) => `<span class="xb ${cls || ""}">${b}</span>`).join("")}<span class="xt">${tail || ""}</span>`).join("")}</div>`;
  };
  /* Practice on a long stretch of a real table: find output position `ask` (C3). */
  const tablePractice = (name, values, src, ask, extra) => {
    const cells = values.map((v, i) => `<span class="${i === 0 ? "" : ""}"><small>${i + 1}</small><b>${v}</b></span>`).join("");
    const val = values[ask - 1], wrong = {};
    wrong[String(ask)] = `${ask} is the output position (the small number). The answer is the big number written in cell ${ask}.`;
    if (ask > 1) wrong[String(values[ask - 2])] = `${values[ask - 2]} is in cell ${ask - 1}. Move one cell to the right.`;
    if (ask < values.length) wrong[String(values[ask])] = `${values[ask]} is in cell ${ask + 1}. Move one cell to the left.`;
    return { t: "Practice", h: `<p>Here are the first ${values.length} cells of the <b>${name}</b> table. The small number is the cell (output position), the big number is the ${src} bit it copies.</p>
        <div class="lx-table">${cells}</div>${extra || ""}`,
      practice: { q: `Output bit ${ask} is copied from which ${src} bit?`, fmt: `the ${src} bit number (the big number in cell ${ask})`, ph: `e.g. ${values[0]}`, a: [String(val)],
        hint: `Count along to cell ${ask} (small number ${ask}) and read the big number in it.`, wrong,
        why: `Cell ${ask} holds ${val}, so output bit ${ask} = ${src} bit ${val}.` } };
  };
  const permIntro = (name, n, src) => [
    { t: `What ${name} does`, h: `<p><b>${name}</b> takes ${src} and builds a new list of ${n} bits by <b>moving bits to new positions</b>. The bit values never change, only where they sit.</p>` },
    { t: "How to read the table", h: `<p>Cell number <b>k</b> of the table tells you <b>which input bit goes to output position k</b>.</p>
        ${row(box("cell 1 says 58"), arrow, box("output bit 1 = input bit 58", "hl"))}
        <p class="lx-small">Small example with 4 bits: input <b>1 0 1 1</b>, table <b>[3, 1, 4, 2]</b></p>
        ${row(box("out1 = in3 = 1"), box("out2 = in1 = 1"), box("out3 = in4 = 1"), box("out4 = in2 = 0"))}
        <p>So the output is <b>1110</b>.</p>` },
  ];
  const patchTry = (word) => TRY(`Now do the <b>whole</b> permutation. The yellow output cell is next: it shows <b>←n</b>, the ${word} to copy. <b>Click ${word} n</b> on the left (a cable carries its value over), or press <b>0</b>/<b>1</b>. Each full row is checked for you. After 2 correct rows you can type a whole row at once.`);

  const L = {
    r1_ascii(P) {
      const code = P.view.code, spare = "KMQWXJVNRB".split("").filter((c) => !code.includes(c));
      const ex = spare[0] || "K", pr = spare[1] || "M";
      const n = ex.charCodeAt(0), b = bin8(n), m = pr.charCodeAt(0), mb = bin8(m);
      return [
        { t: "What the door needs", h: `<p>The gate only opens for a <b>64-bit block</b> written as <b>16 hex digits</b>. Your code has <b>8 characters</b>, so every character must become <b>2 hex digits</b>.</p>
          ${row(box("8 characters"), arrow, box("8 × 2 = 16 hex digits", "hl"), arrow, box("64 bits"))}` },
        { t: "Step 1 · Character → number", h: `<p>A computer stores every character as a number (its code). Capital letters start at A = 65:</p>
          <div class="lx-codes">${"ABCDEFGHIJKLMNOPQRSTUVWXYZ".split("").map((c) => `<span><b>${c}</b>${c.charCodeAt(0)}</span>`).join("")}${"0123456789".split("").map((c) => `<span><b>${c}</b>${c.charCodeAt(0)}</span>`).join("")}</div>
          <p>Example: <b>'${ex}' = ${n}</b>. (Inside the machine, clicking a letter shows its number for you.)</p>` },
        { t: "Step 2 · Number → 8 bits", h: `<p>Write the number in binary with exactly 8 bits (one byte).</p>
          ${row(box(`'${ex}'`), arrow, box(String(n)), arrow, box(`${nib(b.slice(0, 4))} ${nib(b.slice(4))}`, "hl"))}` },
        { t: "Step 3 · Each group of 4 bits = 1 hex digit", h: `<p>Split the 8 bits into two groups of 4. Each group is one hex digit:</p>${HEXTABLE}
          ${row(box(nib(b.slice(0, 4))), arrow, box(parseInt(b.slice(0, 4), 2).toString(16).toUpperCase(), "hl"), `<span class="lx-gap"></span>`, box(nib(b.slice(4))), arrow, box(parseInt(b.slice(4), 2).toString(16).toUpperCase(), "hl"))}
          <p>So <b>'${ex}' → ${hex2(n)}</b>. Do this for all 8 characters, in order, and you have the 16 hex digits.</p>` },
        { t: "Practice", h: `<p>Your turn with the letter <b>'${pr}'</b>. Steps 1 and 2 are already done for you:</p>
          ${row(box(`'${pr}'`), arrow, box(`${m} (decimal)`), arrow, box(`${nib(mb.slice(0, 4))} | ${nib(mb.slice(4))}`, "hl"))}
          <p>Now do step 3: turn <b>each group of 4 bits</b> into one hex digit using the table, and write the two digits side by side.</p>${HEXTABLE}`,
          practice: { q: `What are the 2 hex digits for '${pr}'?`, fmt: `2 hex digits (0–9 or A–F), for example 4B`, ph: "e.g. 4B", a: [hex2(m)],
            hint: `Look up ${mb.slice(0, 4)} in the table, then ${mb.slice(4)}. Write the two results together.`,
            wrong: { [String(m)]: `${m} is the decimal number, not hex. Convert each 4-bit group (${mb.slice(0, 4)} and ${mb.slice(4)}) with the table.`, [mb]: "That is the binary. Turn each group of 4 bits into one hex digit." },
            why: `${mb.slice(0, 4)} → ${hex2(m)[0]} and ${mb.slice(4)} → ${hex2(m)[1]}, so '${pr}' = ${hex2(m)}.` } },
        TRY("Click a letter plate to see its number. Convert that number to 8 bits and then to 2 hex digits yourself. Then set the <b>two dials under that letter</b>: use the ▲▼ arrows, or click a dial and just type the number/letter you want."),
      ];
    },
    r1_block() {
      return [
        { t: "A block is 8 bytes", h: `<p>Your 16 hex digits are <b>8 bytes</b>. One byte = <b>2 hex digits</b> = <b>8 bits</b>.</p>${row(box("4E"), arrow, box(`${nib("0100")} ${nib("1110")}`, "hl"))}<p>Each hex digit turns into 4 bits using this table:</p>${HEXTABLE}` },
        { t: "Practice", h: "<p>Count the bits in a whole block.</p>", practice: { q: "A block has 16 hex digits, and each hex digit is 4 bits. How many bits is the block?", fmt: "a whole number", ph: "e.g. 32", a: ["64"], hint: "Multiply: 16 × 4.", wrong: { "16": "16 is the number of hex digits. Each one is 4 bits, so multiply by 4." }, why: "16 × 4 = 64 bits, the DES block size." } },
        TRY("One byte's lamps are dark. Flip its 8 switches to that byte's bits (convert each of its 2 hex digits into 4 bits). Then pull the lever with the correct statement."),
      ];
    },
    r1_ip_bit() {
      return [...permIntro("The Initial Permutation (IP)", 64, "your 64-bit block"),
        tablePractice("IP", [58, 50, 42, 34, 26, 18, 10, 2, 60, 52, 44, 36, 28, 20, 12, 4], "input", 11),
        patchTry("input bit")];
    },
    r1_split() {
      return [
        { t: "Two halves", h: `<p>After IP, DES cuts the 64-bit block into a <b>left half L0</b> and a <b>right half R0</b>, 32 bits each = <b>8 hex digits each</b>.</p>
          ${row(box("00112233", "l"), box("44556677", "r"))}<p>L0 = 00112233 &nbsp; R0 = 44556677</p>` },
        { t: "Practice", h: "<p>After IP the block is <b>AABBCCDD11223344</b> (16 hex digits).</p><p>L0 = the <b>first 8</b> hex digits, R0 = the <b>last 8</b>.</p>", practice: { q: "What is R0?", fmt: "8 hex digits", ph: "e.g. AABBCCDD", a: ["11223344"], hint: "R is the right half: take the last 8 hex digits.", wrong: { "AABBCCDD": "That is L0, the left half. R0 is the right half." }, why: "R0 = the last 8 hex digits = 11223344." } },
        TRY("Click the gap where the laser should cut. The two halves drop into the trays."),
      ];
    },
    r2_parity() {
      return [
        { t: "64 bits written, 56 used", h: `<p>A DES key is written as 64 bits, but only <b>56</b> of them are real key bits.</p>` },
        { t: "Parity bits", h: `<p>The <b>last bit of every byte</b> (bits 8, 16, 24, …, 64) is a <b>parity bit</b>, used only for error checking. It adds no security.</p>
          ${row(box("1 0 1 1 0 1 0 " + `<b class="lx-pb">1</b>`), arrow, box("bit 8 = parity", "hl"))}` },
        { t: "Practice", h: "<p>The key has 64 bits. One bit in every byte (8 bytes) is a parity bit, and DES ignores those.</p>", practice: { q: "How many key bits are left after removing the 8 parity bits?", fmt: "a whole number", ph: "e.g. 48", a: ["56"], hint: "Subtract: 64 − 8.", wrong: { "64": "64 includes the parity bits. Remove the 8 parity bits." }, why: "64 − 8 = 56 effective key bits." } },
        TRY("Click the lamps that are parity bits to tag them (P). Then set the dial to the number of effective key bits."),
      ];
    },
    r2_pc1_bit() {
      return [...permIntro("PC-1 (Permuted Choice 1)", 56, "the 64-bit key"),
        { t: "PC-1 drops the parity bits", h: "<p>PC-1 only has 56 cells. Bits 8, 16, …, 64 never appear in it, so the parity bits are thrown away here.</p>" },
        tablePractice("PC-1", [57, 49, 41, 33, 25, 17, 9, 1, 58, 50, 42, 34, 26, 18], "key", 12, "<p class='tiny muted'>Notice: no multiple of 8 ever appears. Those are the parity bits PC-1 drops.</p>"),
        patchTry("key bit")];
    },
    r2_split() {
      return [
        { t: "C0 and D0", h: `<p>The 56-bit PC-1 output is cut into two 28-bit halves: <b>C0</b> (first half) and <b>D0</b> (second half).</p>${row(box("56 bits = 14 hex"), arrow, box("C0: 7 hex", "l"), box("D0: 7 hex", "r"))}` },
        { t: "Practice", h: "<p>C0 and D0 are 28 bits each. One hex digit holds 4 bits.</p>", practice: { q: "How many hex digits do you need to write 28 bits?", fmt: "a whole number", ph: "e.g. 8", a: ["7"], hint: "Divide: 28 ÷ 4.", why: "28 ÷ 4 = 7 hex digits." } },
        TRY("Click the gap where the laser should cut."),
      ];
    },
    r2_shift(P) {
      const rs = P.view.rounds || [P.view.round];
      return [
        { t: "Left rotation", h: `<p>Every round, C and D <b>rotate left</b>: every bit moves one place left and the first bit <b>wraps around to the end</b>.</p>
          ${row(box(`<b class="lx-pb">1</b>011000`), arrow, box(`011000<b class="lx-pb">1</b>`, "hl"))}` },
        { t: "How far?", h: `<p>Rounds <b>1, 2, 9 and 16</b> rotate by <b>1</b>. All other rounds rotate by <b>2</b>.</p><p>The rotations <b>build on each other</b>: each round starts from the C and D that the previous round produced.</p><p>You will do <b>rounds ${rs[0]}–${rs[rs.length - 1]}</b> in a row. Read each round's shift in the schedule bar at the top of the machine.</p>` },
        { t: "Practice", h: "<p>A left rotation moves every bit one place left, and the first bit wraps around to the end.</p><p class='lx-ex'>1100101 → rotate 1 → 1001011</p>", practice: { q: "Rotate 1100101 left by 2 places. What do you get?", fmt: "7 bits (0s and 1s)", ph: "e.g. 1001011", a: ["0010111"], hint: "Do the 1-place rotation twice: start from 1001011 and rotate once more.", wrong: { "1001011": "That is only 1 place. Rotate it one more time." }, why: "1100101 → 1001011 → 0010111." } },
        TRY(`For each round ${rs[0]}–${rs[rs.length - 1]}: press “Rotate C left” and “Rotate D left” as many times as that round's shift, then press “Record round”. If you overshoot, press “Redo this round”.`),
      ];
    },
    r2_pc2() {
      return [
        { t: "Making a round key", h: "<p>After rotating, C and D are joined into 56 bits (C‖D). <b>PC-2</b> picks <b>48</b> of them in a new order: that is the round key K<sub>i</sub>.</p>" },
        ...permIntro("PC-2", 48, "the 56 bits of C‖D").slice(1),
        tablePractice("PC-2", [14, 17, 11, 24, 1, 5, 3, 28, 15, 6, 21, 10], "C‖D", 9),
        patchTry("C‖D bit")];
    },
    r2_cycle() {
      return [
        { t: "16 round keys", h: "<p>Repeat <b>rotate → PC-2</b> sixteen times and you get the 16 round keys K1 … K16.</p>" },
        { t: "Counting rotations", h: "<p>Add up the rotation amounts round by round: 1, 1, 2, 2, 2, 2, 2, 2, 1, 2, 2, 2, 2, 2, 2, 1.</p>" },
        { t: "Practice", h: "<p>The shifts add up: each round rotates C and D a bit further than the round before.</p><p class='lx-ex'>round: 1  2  3  4<br>shift: 1  1  2  2</p>", practice: { q: "How many places in total have C and D rotated after round 4?", fmt: "a whole number", ph: "e.g. 4", a: ["6"], hint: "Add the four shifts: 1 + 1 + 2 + 2.", wrong: { "2": "2 is only round 4's shift. Add all four rounds together." }, why: "1 + 1 + 2 + 2 = 6 places." } },
        TRY("Pull the lever to forge all 16 keys. Click any key slot to inspect that round. Then set the total rotation dial and answer whether C16 equals C0."),
      ];
    },
    r3_expand() {
      return [
        { t: "Expansion E", h: "<p>Each round works on the right half R (32 bits). <b>E</b> stretches it to <b>48 bits</b> so it can be mixed with the 48-bit round key. It does this by copying the edge bits of each 4-bit group into the neighbouring groups.</p>" },
        ...permIntro("E", 48, "the 32-bit right half").slice(1),
        tablePractice("E", [32, 1, 2, 3, 4, 5, 4, 5, 6, 7, 8, 9, 8, 9, 10, 11], "R", 7, "<p class='tiny muted'>Notice: some R bits appear twice. That is how 32 bits become 48.</p>"),
        patchTry("R bit"),
      ];
    },
    r3_xor() {
      return [
        { t: "XOR", h: `<p>XOR (⊕) gives <b>1 when the two bits are different</b>, and 0 when they are the same.</p>
          <table class="lx-truth"><tr><th>a</th><th>b</th><th>a ⊕ b</th></tr><tr><td>0</td><td>0</td><td>0</td></tr><tr><td>0</td><td>1</td><td>1</td></tr><tr><td>1</td><td>0</td><td>1</td></tr><tr><td>1</td><td>1</td><td>0</td></tr></table>` },
        { t: "Worked example", h: xorGrid([["", "101100"], ["⊕", "011010", "", "the key bits"], ["=", "110110", "hl", "1 where the bits differ"]]) + "<p>Go column by column: each bit sits right under the bit it is XOR-ed with.</p>" },
        { t: "Practice", h: "<p>XOR compares two bits: <b>different → 1</b>, <b>same → 0</b>. Go column by column:</p>" + xorGrid([["", "110010"], ["⊕", "011011"], ["=", "??????", "q"]]) + "", practice: { q: "What is 110010 ⊕ 011011?", fmt: "6 bits (0s and 1s)", ph: "e.g. 100100", a: ["101001"], hint: "First column: 1 and 0 are different → 1. Second: 1 and 1 are the same → 0. Keep going.", why: "1/0→1, 1/1→0, 0/1→1, 0/0→0, 1/1→0, 0/1→1 = 101001." } },
        TRY("Each gate has two input bits. Click its output lamp until it shows the XOR of the two."),
      ];
    },
    r3_sbox() {
      return [
        { t: "S-boxes", h: "<p>Eight S-boxes turn the 48 bits back into 32: each takes <b>6 bits in</b> and gives <b>4 bits out</b> by looking up a table.</p>" },
        { t: "Row and column", h: `<p><b>Row</b> = first + last bit. <b>Column</b> = the middle four bits.</p>
          ${row(box(`<b class="lx-r">0</b>1101<b class="lx-r">1</b>`), arrow, box("row 01 = 1"), box("column 1101 = 13", "hl"))}` },
        { t: "Look up", h: "<p>Find that row and column in the S-box table. The number in the cell (0–15) is written as 4 bits, e.g. 5 → 0101, 14 → 1110.</p>" + HEXTABLE },
        { t: "Practice", h: "<p>S-box input: <b>1</b>0011<b>0</b>. The <b>row</b> is made from the <b>first and last</b> bits.</p><p class='lx-ex'>row bits 00 = 0, 01 = 1, 10 = 2, 11 = 3</p>", practice: { q: "For the input 100110, which row do you use?", fmt: "a row number from 0 to 3", ph: "e.g. 1", a: ["2"], hint: "Take the first bit (1) and the last bit (0): that's 10 in binary.", wrong: { "10": "10 is the binary. Convert it to a row number from 0 to 3." }, why: "First and last bits are 1 and 0 → 10 in binary = row 2." } },
        TRY("The machine walks you through it in 4 steps: pick the row, pick the column, click the cell where they meet, then switch on the bits that add up to the value."),
      ];
    },
    r3_perm() {
      return [...permIntro("Permutation P", 32, "the 32 S-box output bits"),
        tablePractice("P", [16, 7, 20, 21, 29, 12, 28, 17, 1, 15, 23, 26, 5, 18, 31, 10], "S-box output", 8),
        patchTry("S-output bit")];
    },
    r3_feistel() {
      return [
        { t: "The Feistel rule", h: `<p>At the end of each round:</p>${row(box("new L = old R", "l"), box("new R = old L ⊕ F", "r"))}<p>F is the result of E → XOR → S-boxes → P you just built.</p>` },
        { t: "XOR in hex", h: `<p>XOR hex digits through binary, one digit at a time:</p>${xorGrid([["A", "1010"], ["⊕ 3", "0011"], ["=", "1001", "hl", "= 9"]])}${HEXTABLE}` },
        { t: "Practice", h: "<p>The new R is <b>L ⊕ f(R, K)</b>. To XOR hex digits, write each as 4 bits, XOR, and turn the result back into hex.</p>" + xorGrid([["C", "1100"], ["⊕ 5", "0101"], ["=", "????", "q"]]) + "", practice: { q: "What is C ⊕ 5, written as one hex digit?", fmt: "1 hex digit (0–9 or A–F)", ph: "e.g. A", a: ["9"], hint: "1100 ⊕ 0101: compare column by column, then look the 4-bit result up in the hex table.", wrong: { "1001": "Right bits! Now write 1001 as one hex digit." }, why: "1100 ⊕ 0101 = 1001 = 9." } },
        TRY("Two steps: click the half that becomes the new LEFT, then XOR column by column to dial in the new RIGHT. Click a dial to see that column in binary."),
      ];
    },
    r3_swap() {
      return [
        { t: "16 rounds", h: "<p>DES repeats the round 16 times, using K1, K2, …, K16.</p>" },
        { t: "The final swap", h: `<p>After round 16 the halves are <b>swapped</b> (R16 first, then L16), and that block goes through IP⁻¹ to give the ciphertext.</p>${row(box("L16 | R16"), arrow, box("R16 ‖ L16", "hl"), arrow, box("IP⁻¹"), arrow, box("ciphertext"))}` },
        { t: "Practice", h: "<p>After round 16, DES swaps the halves one last time: it puts <b>R16 first</b>, then <b>L16</b>, and only then applies IP⁻¹.</p>", practice: { q: "If L16 = AAAA and R16 = BBBB, what goes into IP⁻¹?", fmt: "the two halves joined together (8 hex digits)", ph: "e.g. 1111AAAA", a: ["BBBBAAAA"], hint: "Write R16, then L16 right after it.", wrong: { "AAAABBBB": "That is L16 then R16 (no swap). Put R16 first." }, why: "R16 first, then L16: BBBBAAAA." } },
        TRY("Pull the ignition lever to run all 16 rounds (open the round log to inspect any round), then choose the block that goes into IP⁻¹."),
      ];
    },
    r4_order() {
      return [
        { t: "Same machine, backwards", h: "<p>DES decryption is the <b>same algorithm with the same 16 keys</b>, only the order changes: <b>K16 first, K1 last</b>.</p>" + row(box("encrypt: K1 → K16"), box("decrypt: K16 → K1", "hl")) },
        { t: "Practice", h: "<p>Decryption undoes the rounds in reverse, like taking off layers: the <b>last</b> key used to encrypt is the <b>first</b> key used to decrypt.</p>", practice: { q: "A tiny 3-round cipher encrypted with K1, then K2, then K3. Which key does decryption use first?", fmt: "the key number, for example 2 (or K2)", ph: "e.g. K2", a: ["3", "K3"], hint: "Which key was used last during encryption?", wrong: { "1": "K1 was used first to encrypt, so it is undone last.", "K1": "K1 was used first to encrypt, so it is undone last." }, why: "The last key used (K3) is the first one undone." } },
        TRY("Drag each key into the decryption round that uses it (or click a key to put it in the next empty round)."),
      ];
    },
    r4_round() {
      return [
        { t: "A decryption round", h: `<p>It is a normal Feistel round. Decryption round <b>i</b> uses key <b>K(17 − i)</b>.</p>${row(box("new L = right in", "l"), box("new R = left in ⊕ F", "r"))}` },
        { t: "Practice", h: "<p>DES decryption uses K16 in round 1, K15 in round 2, … The rule: <b>decryption round r uses K(17 − r)</b>.</p>", practice: { q: "Which key does decryption round 5 use?", fmt: "the key number, for example 14 (or K14)", ph: "e.g. K14", a: ["12", "K12"], hint: "17 − 5 = ?", wrong: { "5": "That's the encryption key for round 5. Decryption runs backwards: 17 − 5.", "K5": "That's the encryption key for round 5. Decryption runs backwards: 17 − 5." }, why: "17 − 5 = 12, so round 5 uses K12." } },
        TRY("Three steps: set the key number, click the half that becomes the new LEFT, then XOR column by column to dial in the new RIGHT."),
      ];
    },
    r4_code() {
      return [
        { t: "Bytes back into characters", h: `<p><b>Goal:</b> turn the decrypted block back into 8 readable characters. It is Room 1 in reverse: each pair of hex digits is one character.</p>
          <ol class="lx-steps">
            <li>Take one pair of hex digits ${box("42")}</li>
            <li>Split it into its two digits ${box("4")} ${box("2")}</li>
            <li>Make the decimal number: first digit × 16 + second digit ${box("4 × 16 + 2 = 66")}</li>
            <li>Look up 66 in the character table below ${box("66 = 'B'", "hl")}</li>
          </ol>` },
        { t: "The character table", h: `<p>Capital letters and digits have these codes (hex). Letters are in order, so once you know <b>A = 41</b> you can count forward.</p>${ASCII_STRIP}` },
        { t: "Practice", h: `<p>Use the steps and the table:</p>${ASCII_STRIP}`, practice: { q: "Which character is hex 4D?", fmt: "one character (a capital letter)", ph: "e.g. B", a: ["M"], hint: "4 × 16 + 13 (D = 13) = 77. Find 4D in the table.", wrong: { "77": "77 is the decimal number. Which letter has that code?", "D": "D is just the second hex digit. Read the whole pair 4D in the table.", "N": "N is 4E. Go one letter back.", "L": "L is 4C. Go one letter forward." }, why: "4D: 4 × 16 + 13 = 77 = 'M'." } },
        TRY("Turn each letter wheel to the character for the byte above it: use the arrows, or click a wheel and type the letter. The reference drawer lists every code."),
      ];
    },
    r4_verdict() {
      return [
        { t: "Is DES safe?", h: "<p>DES has only <b>56</b> effective key bits: 2<sup>56</sup> ≈ 72 quadrillion keys. That sounds big, but special hardware already tried them all in days back in 1998.</p>" },
        { t: "The avalanche effect", h: "<p>A good cipher reacts to the smallest change. Flip <b>1 bit</b> of the message or key and about <b>half of the 64 output bits</b> (≈ 32) should change. The S-boxes and the Feistel swap spread one changed bit to many bits in just a few rounds.</p><p class='lx-ex'>Original → <span class='mono'>85E813540F0AB405</span><br>1 bit flipped → a completely different block, ≈ 32 bits different</p><p class='small'>Try it yourself later in the <b>DES Lab → Avalanche effect</b>.</p>",
          practice: { q: "About how many of the 64 output bits should change when you flip one input bit?", fmt: "a number of bits", ph: "e.g. 10", hint: "A strong cipher changes about half of the bits. Half of 64 is…", a: ["32", "about32", "half", "50%"], why: "About half: 32 of 64 bits. That makes the output look unrelated to the input." } },
        { t: "The birthday attack", h: "<p>In a room of just <b>23 people</b>, two probably share a birthday. Repeats appear after about <b>√(possibilities)</b> tries.</p><p>DES blocks have 64 bits, so encrypted blocks start to repeat after about √2<sup>64</sup> = <b>2<sup>32</sup> blocks</b> (≈ 32 GB) under one key. A repeat leaks information about the plaintexts. This is the <b>Sweet32</b> attack (2016). AES uses 128-bit blocks, which pushes this to 2<sup>64</sup>.</p><p class='small'>Watch it happen in the <b>DES Lab → Birthday attack</b>.</p>",
          practice: { q: "With a 64-bit block, repeats become likely after about 2^? blocks.", fmt: "just the exponent (the number after 2^)", ph: "e.g. 16", hint: "√2^64: take half of the exponent 64.", wrong: { "64": "2^64 is the number of possible blocks. Repeats start at the square root of that." }, a: ["32"], why: "√2^64 = 2^32. Half the exponent: that is the birthday bound." } },
        { t: "What to use instead", h: "<p>Modern systems use <b>AES</b> (128-bit blocks and 128-bit or longer keys) with authenticated modes such as AES-GCM. DES is for learning only.</p>" },
        TRY("Answer NOVA's six questions."),
      ];
    },
  };
  L.r3_sbox_bonus = L.r3_sbox;

  /* ---- Decrypt mission versions (the player decrypts an intercepted ciphertext) ---- */
  const D = {
    r1_ascii() {
      return [
        { t: "Decrypt mission", h: `<p>We intercepted an <b>encrypted</b> message. Your job: decrypt it with DES. The radio gives the ciphertext as <b>8 byte values</b> (numbers 0 to 255), and DES needs it as <b>16 hex digits</b>.</p>
          ${row(box("8 byte values"), arrow, box("8 × 2 = 16 hex digits", "hl"), arrow, box("64-bit ciphertext block"))}
          <p>The bytes are not readable letters: that is the point of encryption. Readable text only comes back after decryption, in Room 4.</p>` },
        { t: "Number → 2 hex digits", h: `<p>Divide the number by 16. The <b>quotient</b> is the first hex digit, the <b>remainder</b> the second.</p>
          ${row(box("200"), arrow, box("200 = 12 × 16 + 8"), arrow, box("C 8", "hl"))}${HEXTABLE}
          <p>Small numbers still need two digits: 7 → <b>07</b>.</p>` },
        { t: "Practice", h: "<p>Convert one byte value to 2 hex digits.</p>", practice: { q: "What is 171 in 2 hex digits?", fmt: "2 hex digits (0–9 or A–F)", ph: "e.g. 4B", a: ["AB"], hint: "171 ÷ 16 = 10 remainder 11. 10 = A, 11 = B.", wrong: { "171": "That is the decimal number. Divide by 16 to get the two hex digits." }, why: "171 = 10 × 16 + 11 → A and B → AB." } },
        TRY("Click a number to start, convert it to 2 hex digits, then set the <b>two dials under it</b> (arrows, or click a dial and type)."),
      ];
    },
    r3_swap() {
      return [
        { t: "16 decryption rounds", h: "<p>Decryption runs the very same 16 rounds, with the keys <b>backwards</b>: K16, K15, …, K1.</p>" + row(box("encrypt: K1 → K16"), box("decrypt: K16 → K1", "hl")) },
        { t: "The final swap", h: `<p>After round 16 the halves are <b>swapped</b> (R16 first, then L16), and that block goes through IP⁻¹. In decryption the result is the <b>plaintext</b>.</p>${row(box("L16 | R16"), arrow, box("R16 ‖ L16", "hl"), arrow, box("IP⁻¹"), arrow, box("plaintext"))}` },
        L.r3_swap()[2],
        TRY("Pull the lever to run all 16 decryption rounds (open the round log to inspect any round), then choose the block that goes into IP⁻¹."),
      ];
    },
    r4_order() {
      return [
        { t: "Prove it: encrypt again", h: "<p>If your decryption is right, <b>encrypting</b> the recovered message with the same key must give back the intercepted ciphertext. Encryption uses the same 16 keys in the normal order: <b>K1 first, K16 last</b>.</p>" + row(box("decrypt: K16 → K1"), box("encrypt: K1 → K16", "hl")) },
        { t: "Practice", h: "<p>Encryption and decryption are mirror images: decryption's <b>last</b> key is encryption's <b>first</b>.</p>", practice: { q: "A tiny 3-round cipher decrypted with K3, then K2, then K1. Which key does encryption use first?", fmt: "the key number, for example 2 (or K2)", ph: "e.g. K2", a: ["1", "K1"], hint: "Which key did decryption use last?", wrong: { "3": "K3 is used first in decryption. Encryption runs the other way.", "K3": "K3 is used first in decryption. Encryption runs the other way." }, why: "Encryption goes K1, K2, K3." } },
        TRY("Drag each key into the encryption round that uses it (or click a key to put it in the next empty round)."),
      ];
    },
    r4_round() {
      return [
        { t: "An encryption round", h: `<p>The same Feistel round you used for decryption. Encryption round <b>i</b> uses key <b>Ki</b>.</p>${row(box("new L = right in", "l"), box("new R = left in ⊕ F", "r"))}` },
        { t: "Practice", h: "<p>Encryption uses K1 in round 1, K2 in round 2, … ; decryption round r uses K(17 − r).</p>", practice: { q: "Which key does encryption round 5 use?", fmt: "the key number, for example 14 (or K14)", ph: "e.g. K14", a: ["5", "K5"], hint: "Encryption goes forwards.", wrong: { "12": "That is the key for decryption round 5 (17 − 5). Encryption goes forwards.", "K12": "That is the key for decryption round 5 (17 − 5). Encryption goes forwards." }, why: "Encryption round 5 uses K5." } },
        TRY("Three steps: set the key number, click the half that becomes the new LEFT, then XOR column by column to dial in the new RIGHT."),
      ];
    },
  };
  window.Lessons = { build: (P) => (P.view && P.view.direction && D[P.id] && ((P.id === "r1_ascii" && P.view.direction === "decrypt") || (P.id === "r3_swap" && P.view.direction === "decrypt") || (["r4_order", "r4_round"].includes(P.id) && P.view.direction === "encrypt")) ? D[P.id](P) : (L[P.id] ? L[P.id](P) : null)) };



})();
