// Plays DEScape through the real game UI: title → intro → onboarding → walk to
// machines → operate each machine → gates → escape. Screenshots into $SHOTS.
const { chromium } = require("playwright");
const { execSync } = require("child_process");
const BASE = "http://127.0.0.1:8000", SHOTS = process.env.SHOTS || "/tmp/claude-0/gshots";
const user = process.argv[2] || "student_demo", mode = process.argv[3] || "guided";
const STOP = process.env.STOP || "";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const errors = [];
execSync(`mkdir -p ${SHOTS}`);
(async () => {
  const b = await chromium.launch();
  const page = await b.newPage({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: +(process.env.DSF || 1) });
  page.on("console", (m) => { if (["error", "warning"].includes(m.type())) errors.push(`console.${m.type()}: ${m.text()}`); });
  page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
  page.on("dialog", (d) => d.accept());
  let shotN = 0;
  const shot = async (n) => { shotN++; await page.screenshot({ path: `${SHOTS}/${mode}_${String(shotN).padStart(2, "0")}_${n}.png` }); };
  await page.goto(BASE + "/accounts/login/");
  await page.fill("#id_username", user); await page.fill("#id_password", "cipherbreak-demo-2026");
  await page.click("main form button[type=submit]"); await page.waitForURL("**/dashboard/");
  await page.check(`input[name=mode][value=${mode}]`);
  await page.click("#new-adv button[type=submit]"); await page.waitForURL("**/play/**");
  const aid = +page.url().replace(/\/$/, "").split("/").pop();
  console.log("attempt", aid);
  const A = JSON.parse(execSync(`python3 /tmp/claude-0/answers.py ${aid}`).toString());
  await sleep(1200); await shot("title");
  await page.click("#t-start");

  const dialogs = async (label) => {
    let k = 0;
    for (let t = 0; t < 60; t++) {
      if (await page.locator("#dialog:not(.hidden)").count()) {
        if (label && k === 0) await shot(label);
        await page.click("#dialog-next"); k++; await sleep(120);
      } else if (k > 0) { await sleep(300); if (!(await page.locator("#dialog:not(.hidden)").count())) break; }
      else await sleep(150);
      if (t > 25 && k === 0) break;
    }
    return k;
  };
  const skipTut = async (label) => {
    await sleep(500);
    if (await page.locator("#mc-lesson:not(.hidden)").count()) {
      if (label) { await shot(label); for (let k = 0; k < +(process.env.LXN || 2); k++) { if (await page.locator("#lx-next:not([disabled])").count()) { await page.click("#lx-next"); await sleep(200); } } await shot(label + "_b"); if (process.env.LXN) { await page.fill("#lx-in", "77").catch(()=>{}); await page.click("#lx-check").catch(()=>{}); await sleep(300); await shot(label + "_c"); } }
      await page.click("#lx-skip"); await sleep(200);
    }
  };
  const canvasClick = async (vx, vy) => {
    const r = await page.locator("#world").boundingBox();
    await page.mouse.click(r.x + (vx / 320) * r.width, r.y + (vy / 192) * r.height);
  };
  const scene = () => page.evaluate(() => World.state.scene);
  const stationXY = (id) => page.evaluate((id) => { const s = World.SCENES[World.state.scene].stations.find((x) => x.id === id); return World.stationCenter(s); }, id);
  const gotoDoor = async (to) => {
    const d = await page.evaluate((to) => World.SCENES[World.state.scene].doors.find((x) => String(x.to) === String(to)), to);
    const before = await scene();
    await canvasClick(d.x * 16 + 16, 8);
    for (let t = 0; t < 80; t++) { await sleep(150); if ((await scene()) !== before && !(await page.evaluate(() => World.state.transitioning))) break; }
  };

  // intro
  await sleep(500); await dialogs("intro");
  if (await page.locator(".modal").count()) { await shot("pre_modal"); await page.click(".modal [data-close]:has-text('SKIP')"); }
  await dialogs();
  // onboarding: move
  await sleep(300); await shot("onb_move");
  await page.keyboard.down("ArrowLeft"); await sleep(400); await page.keyboard.up("ArrowLeft");
  await sleep(300); await dialogs();
  await shot("onb_holotable");
  const info = await stationXY("info"); await canvasClick(info[0], info[1]);
  await page.waitForSelector(".modal", { timeout: 15000 }); await sleep(500); await shot("briefing");
  await page.click(".modal [data-close]"); await sleep(300);
  await dialogs("onb_hud");
  await shot("lobby");

  const hexFields = async (dialPrefix, s) => { await page.click(`#${dialPrefix}-0 .face`); await page.focus(`#${dialPrefix}-0`); for (const ch of s) { await page.keyboard.press(ch); await sleep(15); } };
  const sw = async (sel, bits) => { const btns = page.locator(sel); for (let i = 0; i < bits.length; i++) { await btns.nth(i).click(); if (bits[i] === "0") await btns.nth(i).click(); } };
  const numDial = async (id, from, to) => { await page.focus(`#${id}`); const key = to > from ? "ArrowUp" : "ArrowDown"; for (let i = 0; i < Math.abs(to - from); i++) await page.keyboard.press(key); };
  const lever = (id, v) => page.click(`#${id} .lever[data-v='${v}']`);

  const DRIVE = {
    async ascii(a) { await page.click("#m-char0"); await hexFields("m-hx", a.hex); },
    async block(a) { await sw("#m-hb .bitsw", a.bin); await lever("m-choice", a.choice); },
    async permute(a) {
      const t = await page.evaluate(() => null);
      const view = await page.evaluate(() => ({ n: document.querySelectorAll("#m-out .ocell").length }));
      // click the first two sources (cable mechanic), then type the rest
      for (let i = 0; i < 2; i++) { const src = await page.locator(`#m-out .ocell[data-k='${i + 1}'] em`).innerText(); await page.click(`#m-src .lamp[data-pos='${src.replace("←", "")}']`); }
      await page.focus("#m-out"); for (const ch of a.out.slice(2)) { await page.keyboard.press(ch); }
    },
    async split(a, P) { const L = a[P.fields[0].name]; await page.click(`#m-cutter .gap[data-cut='${L.length}']`); },
    async key(a) { for (const p of [8, 16, 24, 32, 40, 48, 56, 64]) await page.click(`#m-keybits .lamp[data-pos='${p}']`); await numDial("m-eff", 64, +a.effective); },
    async shift(a, P) { for (const r of (P.view.rounds || [P.view.round])) { const n = P.view.schedule[r - 1]; for (let i = 0; i < n; i++) { await page.click("#m-rot-c"); await page.click("#m-rot-d"); } await page.click("#m-record"); } },
    async keyexplorer(a) { await page.click("#m-run"); await sleep(4800); await numDial("m-tot", 0, +a.total); await lever("m-same", a.same); },
    async xor(a) { await sw("#m-gates .out", a.x); },
    async sbox(a) { await page.click(`#m-sx-rows .sx-ch[data-v='${a.row}']`); await sleep(600); await page.click(`#m-sx-cols .sx-ch[data-v='${a.col}']`); await sleep(600); await page.click(`#m-sgrid .sc[data-r='${a.row}'][data-c='${a.col}']`); await sleep(600); for (let i = 0; i < 4; i++) if (a.out[i] === "1") await page.click(`#m-sx-out .sx-ob[data-i='${i}']`); },
    async router(a, P, dec) { if (dec) await numDial("m-kdial", 1, +a.key); const route = a.l === P.view.r.hex ? "R" : "L"; await page.click(`#m-outL [data-c='${route}']`); await hexFields("m-rd", a.r); },
    async fullrun(a) { await page.click("#m-ignite"); await sleep(5200); await page.click(`.cartopt[data-v='${a.choice}']`); },
    async order(a) { for (const k of a.order.split(",")) await page.click(`.kcart[data-k='${k}']`); },
    async recover(a) { await page.click("#m-wh-0 .face"); await page.focus("#m-wh-0"); for (const ch of a.code) { await page.keyboard.press(ch === " " ? "Space" : ch); await sleep(15); } },
    async verdict(a) { for (let i = 0; i < 6; i++) { await page.click(`.vopt[data-f='q${i}'][data-v='${a["q" + i]}']`); await sleep(350); } },
  };
  const kindOf = { ascii: "ascii", block: "block", ip: "permute", pc1: "permute", pc2: "permute", perm: "permute", split: "split", keysplit: "split", key: "key", shift: "shift", keyexplorer: "keyexplorer", expand: "permute", xor: "xor", sbox: "sbox", feistel: "router", decround: "router", fullrun: "fullrun", order: "order", recover: "recover", verdict: "verdict" };

  let first = true;
  const solve = async (pid, opts) => {
    opts = opts || {};
    const [x, y] = await stationXY(pid);
    await canvasClick(x, y);
    await page.waitForSelector("#machine-back:not(.hidden)", { timeout: 20000 });
    await sleep(400);
    await skipTut(first || opts.shotTut ? `tut_${pid}` : null); first = false;
    const P = await page.evaluate(() => null);
    const pub = A.p[pid];
    const view = await page.evaluate(async (pid) => (await CB.api(`/api/attempt/${CB_BOOT.attemptId}/puzzle/${pid}/`)).view, pid);
    const kind = kindOf[view.kind];
    if (opts.wrongFirst) { // deliberately wrong to see feedback
      await page.click("#mc-engage"); await sleep(300);
    }
    await DRIVE[kind](pub.answer, { fields: pub.fields, view }, view.kind === "decround");
    if (opts.shot) await shot(`m_${pid}_set`);
    await page.click("#mc-engage");
    await page.waitForSelector("#mc-stamp:not(.hidden)", { timeout: 8000 }).catch(async () => { await shot(`FAIL_${pid}`); console.log("FAILED", pid, await page.locator("#mc-feedback").innerText()); });
    await sleep(500);
    if (opts.shot) await shot(`m_${pid}_solved`);
    await page.click("#mc-engage"); // CONTINUE
    await sleep(700);
    await dialogs(opts.clearShot ? `cleared_${pid}` : null);
    for (let t = 0; t < 30 && !(await page.locator("#flow-pop:not(.hidden)").count()); t++) await sleep(100);
    if (await page.locator("#flow-pop:not(.hidden)").count()) { if (opts.flowShot) await shot(`flow_${pid}`); await page.click("#fp-ok"); await sleep(250); }
    while (await page.locator(".toast").count()) await sleep(200);
  };

  const ROOMS = A.rooms;
  for (let n = 1; n <= 4; n++) {
    if (n === 1) await gotoDoor(1); else await gotoDoor(n);
    await sleep(400); await dialogs(`room${n}_intro`);
    await sleep(300); await shot(`room${n}`);
    for (const pid of ROOMS[n]) {
      if (pid === "r3_sbox_bonus") continue;
      const showcase = ["r1_ascii", "r1_ip_bit", "r1_split", "r2_parity", "r2_shift", "r2_cycle", "r3_xor", "r3_sbox", "r3_feistel", "r3_swap", "r4_order", "r4_code", "r4_verdict", "r2_pc2", "r3_expand", "r4_round"].includes(pid);
      await solve(pid, { shot: showcase, shotTut: pid === "r4_verdict", flowShot: ["r1_ascii", "r3_feistel"].includes(pid), clearShot: pid === ROOMS[n][ROOMS[n].length - 1] });
      if (pid === "r2_cycle" || pid === "r3_swap") {
        // the archive terminal is now online
        const kind = pid === "r2_cycle" ? "keys" : "encrypt";
        const [x, y] = await stationXY("archive:" + kind); await canvasClick(x, y);
        await page.waitForSelector(".modal", { timeout: 15000 }); await sleep(400); await shot(`archive_${kind}`);
        await page.click(".modal [data-close]"); await sleep(200);
      }
      if (STOP === pid) { await shot("stop"); console.log("errors", errors); await b.close(); return; }
    }
    await shot(`room${n}_done`);
  }
  // inventory
  await page.keyboard.press("i"); await page.waitForSelector(".modal"); await sleep(300); await shot("inventory"); await page.click(".modal [data-close]");
  await page.keyboard.press("m"); await page.waitForSelector(".modal"); await sleep(300); await shot("map"); await page.click(".modal [data-close]");
  await gotoDoor("escape");
  await page.waitForSelector(".escape-screen", { timeout: 15000 }); await sleep(1500); await shot("escape");
  const st = JSON.parse(execSync(`python3 /tmp/claude-0/answers.py ${aid}`).toString());
  console.log("final status", st.status, "score", st.score);
  console.log("errors", JSON.stringify(errors, null, 1));
  await b.close();
})().catch((e) => { console.error("TEST ERROR", e); console.log("errors", errors); process.exit(1); });
