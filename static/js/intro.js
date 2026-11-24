/* DEScape: intro splash on the home page.
   Shown once per browser session. The first click/key starts the logo
   reveal and the intro sound (browsers only allow sound after a click),
   then the splash fades out to the homepage. */
(function () {
  // Home page logo: letters D, E, S slam in every time the page opens.
  const hero = document.getElementById("hero-logo");
  function heroSound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    try { if (JSON.parse(localStorage.getItem("cb-settings") || "{}").sound === false) return; } catch (e) {}
    const ac = new AC();
    if (ac.state !== "running") { ac.close(); return; }  // browser blocks sound before a click: stay silent
    const out = ac.createGain(); out.gain.value = 0.4; out.connect(ac.destination);
    const t0 = ac.currentTime + 0.05;
    [0.3, 0.75, 1.2].forEach((d, i) => {
      const t = t0 + d + 0.15, k = ac.createOscillator(), kg = ac.createGain();
      k.type = "sine"; k.frequency.setValueAtTime(160 + i * 30, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.3);
      kg.gain.setValueAtTime(0.4, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      k.connect(kg).connect(out); k.start(t); k.stop(t + 0.36);
    });
  }
  window.DEScapeHero = function () {
    if (!hero) return;
    hero.classList.add("replay"); void hero.offsetWidth; hero.classList.remove("replay");
    try { heroSound(); } catch (e) {}
  };
})();
(function () {
  const el = document.getElementById("intro");
  if (!el) return;
  let seen = false;
  try { seen = sessionStorage.getItem("descape_intro") === "1"; } catch (e) {}
  if (seen && !/[?&]intro=1\b/.test(location.search)) { el.remove(); if (window.DEScapeHero) window.DEScapeHero(); return; }
  el.hidden = false;
  document.body.style.overflow = "hidden";

  let started = false, done = false;

  function sound() {
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    let muted = false;
    try { muted = (JSON.parse(localStorage.getItem("cb-settings") || "{}").sound === false); } catch (e) {}
    if (muted) return;
    const ac = new AC();
    if (ac.state !== "running") { ac.close(); return; }
    const out = ac.createGain(); out.gain.value = 0.55; out.connect(ac.destination);
    const t0 = ac.currentTime + 0.05;
    // 1) one heavy "slam" per letter: D, E, S
    [0.2, 0.65, 1.1].forEach((d, i) => {
      const t = t0 + d + 0.12;
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = "square"; o.frequency.setValueAtTime([220, 277, 330][i], t); o.frequency.exponentialRampToValueAtTime([110, 138, 165][i], t + 0.25);
      g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(0.16, t + 0.01); g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
      o.connect(g).connect(out); o.start(t); o.stop(t + 0.32);
      const k = ac.createOscillator(), kg = ac.createGain();
      k.type = "sine"; k.frequency.setValueAtTime(160, t); k.frequency.exponentialRampToValueAtTime(45, t + 0.3);
      kg.gain.setValueAtTime(0.45, t); kg.gain.exponentialRampToValueAtTime(0.0001, t + 0.35);
      k.connect(kg).connect(out); k.start(t); k.stop(t + 0.36);
    });
    // 2) scan sweep across the finished logo
    const ts = t0 + 1.55;
    const sw = ac.createOscillator(), swg = ac.createGain(), bp = ac.createBiquadFilter();
    sw.type = "sawtooth"; bp.type = "bandpass"; bp.Q.value = 6;
    sw.frequency.setValueAtTime(220, ts); sw.frequency.exponentialRampToValueAtTime(1400, ts + 0.9);
    bp.frequency.setValueAtTime(600, ts); bp.frequency.exponentialRampToValueAtTime(4000, ts + 0.9);
    swg.gain.setValueAtTime(0.0001, ts); swg.gain.exponentialRampToValueAtTime(0.12, ts + 0.15); swg.gain.exponentialRampToValueAtTime(0.0001, ts + 1);
    sw.connect(bp).connect(swg).connect(out); sw.start(ts); sw.stop(ts + 1.05);
    // 3) a warm chord "unlock" when the logo lands
    const tc = t0 + 2.55;
    [261.63, 329.63, 392.0, 523.25, 783.99].forEach((f, i) => {
      const o = ac.createOscillator(), g = ac.createGain();
      o.type = i < 3 ? "triangle" : "sine"; o.frequency.value = f; o.detune.value = (i - 2) * 4;
      g.gain.setValueAtTime(0.0001, tc); g.gain.exponentialRampToValueAtTime(0.12, tc + 0.04 + i * 0.03);
      g.gain.exponentialRampToValueAtTime(0.0001, tc + 2.6);
      o.connect(g).connect(out); o.start(tc); o.stop(tc + 2.7);
    });
    // low impact
    const k = ac.createOscillator(), kg = ac.createGain();
    k.type = "sine"; k.frequency.setValueAtTime(140, tc); k.frequency.exponentialRampToValueAtTime(40, tc + 0.5);
    kg.gain.setValueAtTime(0.5, tc); kg.gain.exponentialRampToValueAtTime(0.0001, tc + 0.6);
    k.connect(kg).connect(out); k.start(tc); k.stop(tc + 0.7);
  }

  function finish() {
    if (done) return; done = true;
    try { sessionStorage.setItem("descape_intro", "1"); } catch (e) {}
    el.classList.add("leaving");
    document.body.style.overflow = "";
    setTimeout(() => { el.remove(); if (window.DEScapeHero) window.DEScapeHero(); }, 850);
  }

  // Opens straight on the animated DES logo screen. Enter (or a click) goes on to the home page.
  // Browsers only allow sound after a click or key, so the sound plays now if allowed,
  // otherwise it is skipped silently.
  function start() {
    if (started) return;
    started = true;
    try { sound(); } catch (e) {}
    el.classList.add("play");
    setTimeout(() => { const f = el.querySelector(".flash"); if (f) f.classList.add("gone"); }, 2400);
  }
  start();
  el.addEventListener("click", finish);
  document.addEventListener("keydown", function onKey(e) {
    if (done) { document.removeEventListener("keydown", onKey); return; }
    if (e.key === "Enter" || e.key === "Escape" || e.key === " ") { e.preventDefault(); finish(); }
  });
})();
