(() => {
  'use strict';

  /* =========================================================
     State
     ========================================================= */
  const STORE_KEY = 'soberpile.v1';
  const DEFAULT_STATE = {
    settings: {
      startDate: '2026-10-01',
      price: 20,
      sizeMl: 750,
      abv: 40,
      hoursPerDay: 4,
      units: 'metric',
      sound: true,
      goalName: '',
      goalAmount: 0,
      supportName: '',
      supportPhone: '',
      why: '',
      tape: '',
    },
    slips: [],          // 'YYYY-MM-DD' days that were not sober
    journal: {},        // date -> { mood, sleep, sleepHours, text }
    cravings: [],       // { ts, intensity, triggers[], where, note, timer }
    letters: [],        // { id, created, unlockDay, title, body }
    wins: [],           // { ts, text }
    seenBottles: 0,     // bottles already shown dropping
  };

  function load() {
    try {
      const raw = localStorage.getItem(STORE_KEY);
      if (raw) {
        const s = JSON.parse(raw);
        return { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...(s.settings || {}) } };
      }
    } catch (e) { /* ignore */ }
    return structuredClone(DEFAULT_STATE);
  }
  let state = load();
  function save() { try { localStorage.setItem(STORE_KEY, JSON.stringify(state)); } catch (e) { /* ignore */ } }

  /* =========================================================
     Utilities
     ========================================================= */
  const $ = (s, el = document) => el.querySelector(s);
  const $$ = (s, el = document) => [...el.querySelectorAll(s)];
  const pad = n => String(n).padStart(2, '0');
  const ymd = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
  const todayStr = () => ymd(new Date());
  const toUTC = s => { const [y, m, d] = s.split('-').map(Number); return Date.UTC(y, m - 1, d); };
  const daysBetween = (a, b) => Math.round((toUTC(b) - toUTC(a)) / 864e5);
  const addDays = (s, n) => { const t = new Date(toUTC(s) + n * 864e5); return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`; };
  const fmtDate = (s, opts = { month: 'short', day: 'numeric', year: 'numeric' }) => new Date(toUTC(s)).toLocaleDateString(undefined, { ...opts, timeZone: 'UTC' });
  const fmtDay = s => fmtDate(s, { weekday: 'short', month: 'short', day: 'numeric' });
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const int = n => Math.round(n).toLocaleString();
  const money = n => '$' + Math.round(n).toLocaleString();
  const compact = n => n >= 1e6 ? (n / 1e6).toFixed(1).replace(/\.0$/, '') + 'M' : n >= 1e4 ? (n / 1e3).toFixed(1).replace(/\.0$/, '') + 'k' : int(n);
  const plural = (n, w, p = w + 's') => `${n === 1 ? w : p}`;
  const uid = () => Math.random().toString(36).slice(2, 10);
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));

  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg;
    t.classList.add('show');
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.remove('show'), 2600);
  }

  /* =========================================================
     Numbers
     ========================================================= */
  function calc() {
    const s = state.settings;
    const today = todayStr();
    const span = Math.max(0, daysBetween(s.startDate, today) + 1);
    const slipSet = new Set(state.slips.filter(d => d >= s.startDate && d <= today));
    const soberDates = [];
    for (let i = 0; i < span; i++) {
      const d = addDays(s.startDate, i);
      if (!slipSet.has(d)) soberDates.push(d);
    }
    const lastSlip = [...slipSet].sort().pop();
    const streak = lastSlip ? daysBetween(lastSlip, today) : span;
    const bottles = soberDates.length;
    const liters = bottles * s.sizeMl / 1000;
    const ethanolG = liters * 1000 * (s.abv / 100) * 0.789;
    const calories = ethanolG * 7;
    return {
      today, span, soberDates, streak, bottles, liters,
      gallons: liters / 3.78541,
      stdDrinks: ethanolG / 14,
      calories,
      fatLb: calories / 3500,
      money: bottles * s.price,
      hours: bottles * s.hoursPerDay,
      oldBottles: 365 * 3,
    };
  }

  function volumeText(c, digits = 2) {
    return state.settings.units === 'us' ? `${c.gallons.toFixed(digits)} gal` : `${c.liters.toFixed(digits)} L`;
  }

  const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 500, 730, 1000, 1095, 1461];
  const milestoneName = d => d % 365 === 0 ? `${d / 365} ${plural(d / 365, 'year')}` : `${d} days`;

  const LIQUIDS = [
    { name: 'a kitchen pot', L: 7.6, icon: '🍲' },
    { name: 'a 5-gallon bucket', L: 18.9, icon: '🪣' },
    { name: 'a beer keg', L: 58.7, icon: '🛢️' },
    { name: 'a bathtub', L: 150, icon: '🛁' },
    { name: 'an oil drum', L: 208, icon: '🛢️' },
    { name: 'a hot tub', L: 1500, icon: '♨️' },
  ];

  const TIMELINE = [
    { day: 1, when: 'Days 1–3', title: 'The hardest part', text: 'Withdrawal from heavy daily drinking peaks in the first few days and can be dangerous. You got through it.' },
    { day: 4, when: 'Days 4–7', title: 'The body starts to settle', text: 'Hydration and blood sugar steady. Sleep is often rough for a while as the brain recalibrates.' },
    { day: 7, when: 'Week 1', title: 'Clearer mornings', text: 'Many people notice less stomach trouble, fewer shakes and clearer thinking in the morning.' },
    { day: 14, when: 'Week 2', title: 'Healing from the inside', text: 'The stomach lining is repairing, reflux often eases, and sleep usually starts improving.' },
    { day: 21, when: 'Weeks 3–4', title: 'Mood comes in waves', text: 'Irritability, low mood or restless sleep can come and go for weeks or months (post-acute withdrawal). It is normal and it passes.' },
    { day: 30, when: '1 month', title: 'Liver fat dropping', text: 'Liver fat can fall noticeably, blood pressure often improves, and skin looks more hydrated.' },
    { day: 60, when: '2 months', title: 'Energy returning', text: 'Energy and focus keep improving. Cravings tend to come less often and pass faster.' },
    { day: 90, when: '3 months', title: 'A real turning point', text: 'Mood is steadier, brain fog lifts, and new routines start feeling natural.' },
    { day: 180, when: '6 months', title: 'Deep repair', text: 'For many people, fatty-liver changes largely reverse with sustained sobriety. Immune function improves.' },
    { day: 365, when: '1 year', title: 'A whole year', text: 'Risks of liver disease, several cancers and heart problems keep falling the longer you stay sober.' },
    { day: 1095, when: '3 years', title: 'Even', text: 'Sober as long as you drank. Every bottle from those three years, matched by one you didn\'t drink.' },
  ];

  const MOODS = { 1: '😣', 2: '😕', 3: '😐', 4: '🙂', 5: '😄' };
  const MOOD_WORDS = { 1: 'Rough', 2: 'Low', 3: 'Okay', 4: 'Good', 5: 'Great' };
  const SLEEP_WORDS = { 1: 'Awful', 2: 'Poor', 3: 'Okay', 4: 'Good', 5: 'Great' };
  const TRIGGERS = ['Stress', 'Boredom', 'Time of day', 'Tired', 'Lonely', 'Angry', 'Anxious', 'Saw alcohol', 'Social', 'Celebrating', 'Pain', 'Other'];

  /* =========================================================
     Audio (glass clink, synthesized)
     ========================================================= */
  let audioCtx = null;
  function ensureAudio() {
    if (!audioCtx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      audioCtx = new AC();
    }
    if (audioCtx.state === 'suspended') audioCtx.resume();
  }
  document.addEventListener('pointerdown', ensureAudio, { passive: true });

  function clink(vol = 0.5) {
    if (!state.settings.sound || !audioCtx || audioCtx.state !== 'running') return;
    const now = audioCtx.currentTime;
    const base = 1900 + Math.random() * 1600;
    [[1, 1], [2.76, 0.4], [5.4, 0.15]].forEach(([mult, amp]) => {
      const o = audioCtx.createOscillator();
      const g = audioCtx.createGain();
      o.type = 'sine';
      o.frequency.value = base * mult;
      g.gain.setValueAtTime(0.0001, now);
      g.gain.exponentialRampToValueAtTime(Math.max(0.0002, vol * 0.12 * amp), now + 0.004);
      g.gain.exponentialRampToValueAtTime(0.0001, now + 0.18 + 0.2 * amp);
      o.connect(g).connect(audioCtx.destination);
      o.start(now);
      o.stop(now + 0.45);
    });
  }

  /* =========================================================
     Drawing: glass bottles, cases, display case
     ========================================================= */
  const TINTS = [
    { body: '#87ad92', dark: '#3f5f4a', light: '#d5ebdb', alpha: 0.93, cap: 'cork' },   // sage
    { body: '#dde3db', dark: '#97a198', light: '#ffffff', alpha: 0.9, cap: 'cork' },    // frosted
    { body: '#b9cfc3', dark: '#6f8b7e', light: '#f3fbf6', alpha: 0.74, cap: 'green' },  // clear
    { body: '#557f63', dark: '#263f2f', light: '#a4cdb0', alpha: 0.95, cap: 'green' },  // deep green
  ];
  const SHAPES = ['gin', 'flask', 'tall', 'ribbed'];

  function roundRect(c, x, y, w, h, r) {
    r = Math.min(r, w / 2, h / 2);
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function shapeOf(shape) {
    return {
      gin: { neckW: 0.36, neckH: 0.24, shoulder: 0.06, r: 0.12, square: true },
      flask: { neckW: 0.34, neckH: 0.18, shoulder: 0.16, r: 0.3, square: false },
      tall: { neckW: 0.26, neckH: 0.34, shoulder: 0.14, r: 0.16, square: false },
      ribbed: { neckW: 0.36, neckH: 0.22, shoulder: 0.1, r: 0.18, square: true },
    }[shape];
  }

  function bottlePath(c, w, h, sh) {
    const top = -h / 2, bot = h / 2;
    const nw = w * sh.neckW, nh = h * sh.neckH, so = h * sh.shoulder, r = w * sh.r;
    const ys = top + nh + so;
    c.beginPath();
    c.moveTo(-nw / 2, top + h * 0.03);
    c.lineTo(-nw / 2, top + nh);
    if (sh.square) c.quadraticCurveTo(-w / 2, top + nh, -w / 2, ys);
    else c.bezierCurveTo(-nw / 2, top + nh + so * 0.55, -w / 2, top + nh + so * 0.25, -w / 2, ys);
    c.lineTo(-w / 2, bot - r);
    c.quadraticCurveTo(-w / 2, bot, -w / 2 + r, bot);
    c.lineTo(w / 2 - r, bot);
    c.quadraticCurveTo(w / 2, bot, w / 2, bot - r);
    c.lineTo(w / 2, ys);
    if (sh.square) c.quadraticCurveTo(w / 2, top + nh, nw / 2, top + nh);
    else c.bezierCurveTo(w / 2, top + nh + so * 0.25, nw / 2, top + nh + so * 0.55, nw / 2, top + nh);
    c.lineTo(nw / 2, top + h * 0.03);
    c.closePath();
    return { top, bot, nw, nh, ys };
  }

  // A glass bottle shaded to read as 3D: side falloff, vertical depth, specular streaks, rim light.
  function drawBottle(c, w, h, shape, tintIdx, glow, shadow) {
    const sh = shapeOf(shape);
    const t = TINTS[tintIdx];
    const g = bottlePath(c, w, h, sh);

    c.save();
    if (glow) { c.shadowColor = `rgba(166,242,198,${0.9 * glow})`; c.shadowBlur = 30 * glow; }
    else if (shadow) { c.shadowColor = 'rgba(0,0,0,0.5)'; c.shadowBlur = w * 0.35; c.shadowOffsetY = w * 0.12; }
    c.globalAlpha = t.alpha;
    let gr = c.createLinearGradient(-w / 2, 0, w / 2, 0);
    gr.addColorStop(0, t.dark);
    gr.addColorStop(0.22, t.body);
    gr.addColorStop(0.4, t.light);
    gr.addColorStop(0.62, t.body);
    gr.addColorStop(1, t.dark);
    c.fillStyle = gr;
    c.fill();
    c.restore();

    c.save();
    bottlePath(c, w, h, sh);
    c.clip();
    // depth: darker toward the bottom, faint light at the shoulder
    gr = c.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, 'rgba(255,255,255,0.10)');
    gr.addColorStop(0.45, 'rgba(0,0,0,0)');
    gr.addColorStop(1, 'rgba(0,0,0,0.28)');
    c.fillStyle = gr;
    c.fillRect(-w / 2, -h / 2, w, h);
    if (shape === 'ribbed') {
      for (let i = 1; i < 7; i++) {
        const x = -w / 2 + (w / 7) * i;
        c.fillStyle = i % 2 ? 'rgba(0,0,0,0.13)' : 'rgba(255,255,255,0.12)';
        c.fillRect(x - w * 0.025, g.ys, w * 0.05, g.bot - g.ys);
      }
    }
    // specular streaks
    c.fillStyle = 'rgba(255,255,255,0.55)';
    roundRect(c, -w * 0.3, g.ys + h * 0.03, Math.max(1.2, w * 0.07), (g.bot - g.ys) * 0.78, w * 0.04);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.22)';
    roundRect(c, w * 0.26, g.ys + h * 0.06, Math.max(1, w * 0.04), (g.bot - g.ys) * 0.6, w * 0.02);
    c.fill();
    c.fillStyle = 'rgba(255,255,255,0.4)';
    c.fillRect(-g.nw * 0.3, g.top + h * 0.1, Math.max(1, w * 0.05), g.nh * 0.75);
    c.restore();

    // rim light + soft dark edge
    bottlePath(c, w, h, sh);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(1, w * 0.03);
    c.strokeStyle = 'rgba(0,0,0,0.35)';
    c.stroke();
    c.lineWidth = Math.max(0.6, w * 0.018);
    c.strokeStyle = 'rgba(255,255,255,0.28)';
    c.stroke();

    // lip ring
    c.fillStyle = 'rgba(255,255,255,0.3)';
    c.fillRect(-g.nw / 2, g.top + h * 0.085, g.nw, h * 0.018);

    // cork or cap
    const capW = g.nw * 1.08, capH = h * (t.cap === 'cork' ? 0.09 : 0.08);
    gr = c.createLinearGradient(-capW / 2, 0, capW / 2, 0);
    if (t.cap === 'cork') { gr.addColorStop(0, '#9c8a6a'); gr.addColorStop(0.4, '#e6d9bd'); gr.addColorStop(1, '#a8957a'); }
    else { gr.addColorStop(0, '#1f3a2a'); gr.addColorStop(0.4, '#4f7d61'); gr.addColorStop(1, '#203b2b'); }
    c.fillStyle = gr;
    roundRect(c, -capW / 2, g.top - h * 0.02, capW, capH, w * 0.05);
    c.fill();

    // blank paper label
    const bodyH = g.bot - g.ys;
    const lw = w * (shape === 'flask' ? 0.6 : 0.68), lh = bodyH * (shape === 'tall' ? 0.42 : 0.5);
    const ly = g.ys + bodyH * 0.2;
    gr = c.createLinearGradient(-lw / 2, 0, lw / 2, 0);
    gr.addColorStop(0, '#bdb7a8');
    gr.addColorStop(0.35, '#ece7da');
    gr.addColorStop(0.75, '#e2dccd');
    gr.addColorStop(1, '#b3ad9e');
    c.fillStyle = gr;
    roundRect(c, -lw / 2, ly, lw, lh, w * 0.04);
    c.fill();
  }

  function drawCase(c, w, h, count) {
    let gr = c.createLinearGradient(0, -h / 2, 0, h / 2);
    gr.addColorStop(0, '#5c7a66');
    gr.addColorStop(1, '#34493b');
    // necks peeking out
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w / 4) * (i + 0.5);
      c.fillStyle = i % 2 ? 'rgba(221,227,219,0.9)' : 'rgba(135,173,146,0.95)';
      roundRect(c, x - w * 0.05, -h / 2 - h * 0.3, w * 0.1, h * 0.36, 3);
      c.fill();
      c.fillStyle = '#d9cbb0';
      roundRect(c, x - w * 0.055, -h / 2 - h * 0.34, w * 0.11, h * 0.08, 2);
      c.fill();
    }
    c.fillStyle = gr;
    roundRect(c, -w / 2, -h / 2, w, h, w * 0.04);
    c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.18)';
    c.lineWidth = 1;
    c.stroke();
    if (w > 40) {
      c.fillStyle = '#e8e3d6';
      roundRect(c, -w * 0.14, -h * 0.26, w * 0.28, h * 0.52, 4);
      c.fill();
      c.fillStyle = '#2b3a31';
      c.font = `800 ${h * 0.3}px Figtree, -apple-system, sans-serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(count), 0, 1);
    }
  }

  // Dark glass display case the pile sits in. Returns the geometry the physics uses.
  function boxGeometry(W, H) {
    const x = Math.round(W * 0.06), w = W - x * 2;
    const y = Math.round(H * 0.19);
    const floor = Math.round(H * 0.7);
    return { x, y, w, floor, tray: Math.round(H * 0.79), r: Math.min(34, W * 0.08) };
  }

  function drawScene(c, W, H, b) {
    let g = c.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, '#1c2220');
    g.addColorStop(1, '#141817');
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);

    // back of the case
    const bh = b.floor - b.y + 12;
    roundRect(c, b.x, b.y, b.w, bh, b.r);
    g = c.createRadialGradient(W / 2, b.floor, 10, W / 2, b.floor - bh * 0.3, Math.max(b.w, bh) * 0.85);
    g.addColorStop(0, '#26352e');
    g.addColorStop(0.55, '#141b18');
    g.addColorStop(1, '#0c100f');
    c.fillStyle = g;
    c.fill();
    // inner wall shading on the sides
    c.save();
    roundRect(c, b.x, b.y, b.w, bh, b.r);
    c.clip();
    g = c.createLinearGradient(b.x, 0, b.x + b.w, 0);
    g.addColorStop(0, 'rgba(166,242,198,0.07)');
    g.addColorStop(0.08, 'rgba(0,0,0,0)');
    g.addColorStop(0.92, 'rgba(0,0,0,0)');
    g.addColorStop(1, 'rgba(166,242,198,0.07)');
    c.fillStyle = g;
    c.fillRect(b.x, b.y, b.w, bh);
    g = c.createLinearGradient(0, b.y, 0, b.y + bh * 0.25);
    g.addColorStop(0, 'rgba(0,0,0,0.45)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g;
    c.fillRect(b.x, b.y, b.w, bh * 0.25);
    c.restore();
    // glowing rim
    roundRect(c, b.x, b.y, b.w, bh, b.r);
    g = c.createLinearGradient(0, b.y, 0, b.floor);
    g.addColorStop(0, 'rgba(166,242,198,0.55)');
    g.addColorStop(0.5, 'rgba(166,242,198,0.18)');
    g.addColorStop(1, 'rgba(166,242,198,0.05)');
    c.strokeStyle = g;
    c.lineWidth = 2.5;
    c.stroke();

    // soft light pooling on the floor
    g = c.createRadialGradient(W / 2, b.floor, 0, W / 2, b.floor, b.w * 0.55);
    g.addColorStop(0, 'rgba(166,242,198,0.12)');
    g.addColorStop(1, 'rgba(166,242,198,0)');
    c.fillStyle = g;
    c.fillRect(b.x, b.floor - b.w * 0.3, b.w, b.w * 0.3);

    // tray the bottles rest on
    const tx = b.x - 6, tw = b.w + 12;
    roundRect(c, tx, b.floor - 4, tw, b.tray - b.floor + 4, 16);
    g = c.createLinearGradient(0, b.floor, 0, b.tray);
    g.addColorStop(0, '#323a37');
    g.addColorStop(0.18, '#232a27');
    g.addColorStop(1, '#121615');
    c.fillStyle = g;
    c.fill();
    g = c.createLinearGradient(tx, 0, tx + tw, 0);
    g.addColorStop(0, 'rgba(166,242,198,0.08)');
    g.addColorStop(0.5, 'rgba(166,242,198,0.45)');
    g.addColorStop(1, 'rgba(166,242,198,0.08)');
    c.strokeStyle = g;
    c.lineWidth = 1.5;
    c.beginPath();
    c.moveTo(tx + 14, b.floor - 3);
    c.lineTo(tx + tw - 14, b.floor - 3);
    c.stroke();
    // shadow under the tray
    c.save();
    c.filter = 'blur(8px)';
    c.fillStyle = 'rgba(0,0,0,0.4)';
    roundRect(c, tx + 16, b.tray - 6, tw - 32, 16, 8);
    c.fill();
    c.restore();
  }

  // faint reflection across the front of the case, drawn over the bottles
  function drawGlassFront(c, b) {
    const bh = b.floor - b.y;
    const g = c.createLinearGradient(b.x, b.y, b.x + b.w, b.floor);
    g.addColorStop(0, 'rgba(255,255,255,0.06)');
    g.addColorStop(0.3, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.62, 'rgba(255,255,255,0.0)');
    g.addColorStop(0.7, 'rgba(255,255,255,0.035)');
    g.addColorStop(0.78, 'rgba(255,255,255,0.0)');
    c.fillStyle = g;
    roundRect(c, b.x, b.y, b.w, bh, b.r);
    c.fill();
  }

  /* =========================================================
     The pile (Matter.js physics)
     ========================================================= */
  const Pile = (() => {
    const M = window.Matter;
    const BASE_W = 36, BASE_H = 92, MAX_LOOSE = 140, CASE_SIZE = 12;
    const DIMS = { gin: [1, 1], flask: [1.18, 0.8], tall: [0.88, 1.08], ribbed: [1.05, 0.95] };
    let engine, runner, canvas, ctx, W = 0, H = 0, box = null, dpr = 1, walls = [], items = [], gen = 0;
    let running = false, lastClink = 0, scale = 1, built = false, scene = null, down = null;

    function init(c) {
      canvas = c;
      ctx = canvas.getContext('2d');
      engine = M.Engine.create({ enableSleeping: true });
      engine.gravity.y = 1.1;
      runner = M.Runner.create();
      const mouse = M.Mouse.create(canvas);
      ['mousewheel', 'DOMMouseScroll', 'wheel'].forEach(ev => canvas.removeEventListener(ev, mouse.mousewheel));
      const mc = M.MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.15, damping: 0.1, render: { visible: false } } });
      M.Composite.add(engine.world, mc);
      M.Events.on(engine, 'collisionStart', onCollide);

      canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
      canvas.addEventListener('pointerup', e => {
        if (!down) return;
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved < 8 && Date.now() - down.t < 400) {
          const r = canvas.getBoundingClientRect();
          const pt = { x: e.clientX - r.left, y: e.clientY - r.top };
          const hits = M.Query.point(items.map(i => i.body), pt);
          if (hits.length) {
            const it = items.find(i => i.body === hits[hits.length - 1]);
            if (it) onTapItem(it);
          }
        }
        down = null;
      });
    }

    function onCollide(ev) {
      const now = performance.now();
      if (now - lastClink < 35) return;
      for (const p of ev.pairs) {
        const a = p.bodyA, b = p.bodyB;
        if (a.isStatic && b.isStatic) continue;
        const v = Math.hypot(a.velocity.x - b.velocity.x, a.velocity.y - b.velocity.y);
        if (v > 2.2) {
          clink(clamp(v / 12, 0.08, 1));
          lastClink = now;
          break;
        }
      }
    }

    function measure() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = r.width; H = r.height;
      box = boxGeometry(W, H);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.pixelRatio = dpr;
      if (W > 10 && H > 10) {
        scene = document.createElement('canvas');
        scene.width = canvas.width;
        scene.height = canvas.height;
        const sc = scene.getContext('2d');
        sc.scale(dpr, dpr);
        drawScene(sc, W, H, box);
      }
    }

    function makeWalls() {
      M.Composite.remove(engine.world, walls);
      const t = 200, opts = { isStatic: true, friction: 0.9, restitution: 0.1 };
      walls = [
        M.Bodies.rectangle(W / 2, box.floor + t / 2, W * 3, t, opts),
        M.Bodies.rectangle(box.x + 3 - t / 2, box.floor - H * 2, t, H * 4, opts),
        M.Bodies.rectangle(box.x + box.w - 3 + t / 2, box.floor - H * 2, t, H * 4, opts),
      ];
      M.Composite.add(engine.world, walls);
    }

    // list: [{ date, day, isNew }] oldest first
    function build(list, { animateAll = true } = {}) {
      gen++;
      const myGen = gen;
      measure();
      if (W < 10 || H < 10) return;
      makeWalls();
      M.Composite.remove(engine.world, items.map(i => i.body));
      items = [];

      // group older bottles into cases once the pile gets big
      const units = [];
      if (list.length > MAX_LOOSE) {
        const caseable = list.length - (CASE_SIZE + (list.length % CASE_SIZE));
        for (let i = 0; i < caseable; i += CASE_SIZE) units.push({ kind: 'case', days: list.slice(i, i + CASE_SIZE) });
        list.slice(caseable).forEach(d => units.push({ kind: 'bottle', days: [d] }));
      } else {
        list.forEach(d => units.push({ kind: 'bottle', days: [d] }));
      }

      const unitArea = u => u.kind === 'case' ? 3.4 * 0.62 : 1;
      const totalArea = units.reduce((a, u) => a + unitArea(u), 0) * BASE_W * BASE_H;
      scale = totalArea ? clamp(Math.sqrt((0.48 * box.w * (box.floor - box.y)) / totalArea), 0.26, 1.7) : 1;

      const old = units.filter(u => !u.days.some(d => d.isNew));
      const fresh = units.filter(u => u.days.some(d => d.isNew));
      const stagger = old.length ? clamp(1600 / old.length, 8, 90) : 0;

      old.forEach((u, i) => {
        if (animateAll) setTimeout(() => myGen === gen && drop(u, false), i * stagger);
        else drop(u, false, true);
      });
      const freshStart = animateAll ? old.length * stagger + 700 : 400;
      fresh.forEach((u, i) => setTimeout(() => {
        if (myGen !== gen) return;
        drop(u, true);
        if (navigator.vibrate) navigator.vibrate(18);
        const d = u.days[u.days.length - 1];
        toast(`Day ${d.day}'s bottle just hit the pile`);
      }, freshStart + i * 650));
      built = true;
    }

    function drop(u, isFresh, settled) {
      const isCase = u.kind === 'case';
      const day = u.days[u.days.length - 1];
      const hash = Math.imul(day.day + 7, 2654435761) >>> 0;
      const shape = SHAPES[hash % SHAPES.length];
      const tint = (hash >>> 4) % TINTS.length;
      const [dw, dh] = isCase ? [3.4, 0.62] : DIMS[shape];
      const w = BASE_W * dw * scale;
      const h = BASE_H * dh * scale;
      // bias drops toward the middle so the bottles heap into a mound
      const spread = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
      const x = clamp(W / 2 + spread * box.w * 0.34, box.x + w / 2 + 6, box.x + box.w - w / 2 - 6);
      const y = settled ? box.floor - h - Math.random() * (box.floor - box.y) * 0.5 : -h - Math.random() * 60;
      const body = M.Bodies.rectangle(x, y, w, h, {
        chamfer: { radius: isCase ? 3 : [w * 0.3, w * 0.3, w * 0.16, w * 0.16] },
        restitution: 0.18, friction: 0.55, frictionStatic: 0.9, frictionAir: 0.004,
        density: isCase ? 0.004 : 0.002,
        angle: (Math.random() - 0.5) * (isCase ? 0.4 : 1.6),
      });
      M.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: isFresh ? 4 : 2 });
      M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.15);
      items.push({
        body, w, h, kind: u.kind, days: u.days, shape, tint,
        glowUntil: isFresh ? performance.now() + 4500 : 0,
      });
      M.Composite.add(engine.world, body);
    }

    function frame(t) {
      if (!running) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (scene) ctx.drawImage(scene, 0, 0);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const now = performance.now();
      const shadows = items.length < 90;
      for (const it of items) {
        const b = it.body;
        if (b.position.y > H + 400) continue;
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        if (it.kind === 'case') drawCase(ctx, it.w, it.h, it.days.length);
        else {
          const glow = it.glowUntil > now ? (it.glowUntil - now) / 4500 : 0;
          drawBottle(ctx, it.w, it.h, it.shape, it.tint, glow, shadows);
        }
        ctx.restore();
      }
      if (box) drawGlassFront(ctx, box);
      requestAnimationFrame(frame);
    }

    function start() {
      if (running) return;
      running = true;
      M.Runner.run(runner, engine);
      requestAnimationFrame(frame);
    }
    function stop() {
      running = false;
      M.Runner.stop(runner);
    }
    const size = () => ({ W, H });
    return { init, build, start, stop, size, isBuilt: () => built };
  })();

  /* =========================================================
     Today screen
     ========================================================= */
  let pileView = 'bottles';
  let currentTab = 'today';
  let pileDirty = false;

  function pileList(c) {
    const startNew = Math.min(state.seenBottles, c.bottles);
    return c.soberDates.map((d, i) => ({ date: d, day: daysBetween(state.settings.startDate, d) + 1, isNew: i >= startNew }));
  }

  function rebuildPile(animateAll = true) {
    if (currentTab !== 'today') { pileDirty = true; return; }
    const c = calc();
    const list = pileList(c);
    if (state.seenBottles === 0) list.forEach(d => { d.isNew = false; });
    Pile.build(list, { animateAll });
    state.seenBottles = c.bottles;
    save();
  }

  function renderToday() {
    const c = calc();
    const s = state.settings;
    $('#dayCount').textContent = int(c.streak);
    $('#dayWord').textContent = plural(c.streak, 'day');
    $('#subline').textContent = c.streak === 0 ? 'Day one starts now.' : 'Look how far you\'ve come.';
    $('#captionMain').textContent = `${int(c.bottles)} ${plural(c.bottles, 'bottle')} left behind`;
    $('#captionSub').textContent = pileView === 'bottles' ? 'A little more freedom. Every day.' : 'Every drop of it, still in the bottle.';
    $('#qsMoney').textContent = money(c.money);
    $('#qsVolume').textContent = volumeText(c, c.liters >= 100 ? 0 : 2);
    $('#basisText').textContent = `Estimated from ${s.sizeMl} mL at $${s.price} a day`;
    const next = MILESTONES.find(m => m > c.streak) || c.streak + 365;
    const pct = c.streak / next;
    $('#msLabel').textContent = `${pct >= 0.85 ? 'Almost at' : pct >= 0.5 ? 'Halfway to' : 'On the way to'} ${milestoneName(next)}`;
    $('#msCount').textContent = `${int(c.streak)} / ${int(next)}`;
    $('#msBar').style.width = `${pct * 100}%`;
    $('#checkinLabel').textContent = state.journal[c.today] ? 'Update today\'s check-in' : 'Check in for today';
    if (pileView === 'liquid') renderLiquid();
  }

  function renderLiquid() {
    const c = calc();
    const next = LIQUIDS.find(l => l.L > c.liters) || LIQUIDS[LIQUIDS.length - 1];
    const pct = clamp(c.liters / next.L, 0, 1);
    const fillTop = 30 + 150 * (1 - pct);
    const glass = 'M30 22 h100 q6 0 6 6 l-6 150 q-1 12 -13 12 h-74 q-12 0 -13 -12 l-6 -150 q0 -6 6 -6z';
    $('#liquidView').innerHTML = `
      <svg class="tank" viewBox="0 0 160 200" aria-hidden="true">
        <defs>
          <linearGradient id="liq" x1="0" x2="1"><stop offset="0" stop-color="#8f6a26"/><stop offset=".4" stop-color="#e3c27a"/><stop offset="1" stop-color="#7d5b1e"/></linearGradient>
          <linearGradient id="gl" x1="0" x2="1"><stop offset="0" stop-color="rgba(166,242,198,.18)"/><stop offset=".4" stop-color="rgba(255,255,255,.06)"/><stop offset="1" stop-color="rgba(166,242,198,.14)"/></linearGradient>
          <clipPath id="tankClip"><path d="${glass}"/></clipPath>
        </defs>
        <path d="${glass}" fill="url(#gl)"/>
        <g clip-path="url(#tankClip)">
          <rect x="0" y="${fillTop}" width="160" height="200" fill="url(#liq)" opacity=".92"/>
          <ellipse cx="80" cy="${fillTop}" rx="60" ry="5" fill="#f0d89c" opacity=".8"/>
        </g>
        <path d="${glass}" fill="none" stroke="rgba(166,242,198,.55)" stroke-width="2"/>
        <path d="M40 36 l5 128" stroke="#fff" stroke-opacity=".35" stroke-width="5" stroke-linecap="round"/>
      </svg>
      <div class="big">${volumeText(c)}</div>
      <div class="sub">${Math.round(pct * 100)}% of ${next.name} ${next.icon}</div>
      <div class="liquid-list">${LIQUIDS.map(l => `<span class="${c.liters >= l.L ? 'done' : ''}">${c.liters >= l.L ? '✓ ' : ''}${l.name.replace(/^an? /, '')}</span>`).join('')}</div>`;
  }

  function setPileView(v) {
    pileView = v;
    $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $('#liquidView').hidden = v !== 'liquid';
    renderToday();
  }

  function onTapItem(it) {
    if (it.kind === 'case') {
      const a = it.days[0], b = it.days[it.days.length - 1];
      openSheet(`<h2>A case of ${it.days.length}</h2><p class="sheet-sub">Days ${a.day}–${b.day} · ${fmtDate(a.date, { month: 'short', day: 'numeric' })} to ${fmtDate(b.date)}</p>
        <div class="list">${it.days.filter(d => state.journal[d.date]?.text).map(d => entryItem(d.date)).join('') || '<div class="empty">No journal entries in this case.</div>'}</div>`);
      return;
    }
    const d = it.days[0];
    const e = state.journal[d.date];
    const drinks = Math.round(state.settings.sizeMl * state.settings.abv / 100 * 0.789 / 14);
    openSheet(`
      <div class="bottle-card"><canvas id="bottleMini" width="92" height="184"></canvas>
        <div><h2>Day ${d.day}</h2><p class="sheet-sub">${fmtDay(d.date)}</p>
        <p class="small muted" style="margin-top:6px">${money(state.settings.price)} kept · ${drinks} drinks skipped</p></div></div>
      ${e ? entryItem(d.date) : `<div class="empty">Nothing written for this day yet.</div>`}
      <button class="btn primary block" style="margin-top:12px" data-action="editEntry" data-date="${d.date}">${e ? 'Edit' : 'Write about'} this day</button>`);
    const c = $('#bottleMini').getContext('2d');
    c.translate(46, 94);
    drawBottle(c, 56, 150, it.shape, it.tint, 0, true);
  }

  /* =========================================================
     Progress screen
     ========================================================= */
  function renderProgress(openId) {
    const c = calc();
    const s = state.settings;
    const goal = s.goalAmount > 0;
    const goalPct = goal ? clamp(c.money / s.goalAmount, 0, 1) : 0;
    const nowIdx = TIMELINE.reduce((acc, t, i) => (c.streak >= t.day ? i : acc), -1);
    const nextMs = MILESTONES.find(m => m > c.streak);
    const oldPct = clamp(c.bottles / c.oldBottles, 0, 1);
    const letters = state.letters.slice().sort((a, b) => a.unlockDay - b.unlockDay);
    const opts = [7, 14, 30, 60, 90, 180, 365, 730, 1095].filter(d => d > c.bottles);

    $('#screen-progress').innerHTML = `
      <h1 class="page-title">Progress</h1>
      <div class="card hero">
        <div class="big num">${int(c.streak)}</div>
        <div class="lbl">${plural(c.streak, 'day')} alcohol-free${c.streak !== c.span ? ' this streak' : ''}</div>
        <div class="meta">
          <div><b class="num">${int(c.bottles)}</b>bottles in pile</div>
          <div><b class="num">${Math.floor(c.span / 7)}</b>weeks</div>
          <div><b class="num">${int(c.hours)}</b>hours back</div>
        </div>
      </div>

      <div class="section-title">What you didn't drink</div>
      <div class="stat-grid">
        <div class="stat"><div class="k">Money kept</div><div class="v num">${money(c.money)}</div><div class="d">${money(s.price)} a bottle</div></div>
        <div class="stat"><div class="k">Whiskey</div><div class="v num">${volumeText(c, 1)}</div><div class="d">${int(c.bottles)} × ${s.sizeMl} mL</div></div>
        <div class="stat"><div class="k">Standard drinks</div><div class="v num">${int(c.stdDrinks)}</div><div class="d">~${Math.round(c.stdDrinks / Math.max(c.bottles, 1))} a day skipped</div></div>
        <div class="stat"><div class="k">Calories</div><div class="v num">${compact(c.calories)}</div><div class="d">≈ ${c.fatLb.toFixed(1)} lb of fat</div></div>
        <div class="stat wide"><div class="k">Undoing the drinking years</div><div class="v num">${(oldPct * 100).toFixed(1)}%</div>
          <div class="bar"><i style="width:${oldPct * 100}%"></i></div>
          <div class="d" style="margin-top:6px">${int(c.bottles)} of ~${int(c.oldBottles)} bottles from 3 years at a bottle a day</div></div>
      </div>

      <div class="section-title">Saving for</div>
      ${goal ? `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(s.goalName || 'My goal')}</b><span class="muted small num">${money(c.money)} / ${money(s.goalAmount)}</span></div>
          <div class="bar" style="height:12px"><i style="width:${goalPct * 100}%"></i></div>
          <p class="small muted" style="margin-top:8px">${goalPct >= 1 ? 'You did it. Every dollar came from bottles you didn\'t buy. 🎉' : `About ${Math.ceil((s.goalAmount - c.money) / Math.max(s.price, 1))} more sober days to go.`}</p>
          <button class="link small" style="margin-top:8px" data-action="editGoal">Change goal</button></div>`
        : `<button class="card" style="width:100%;text-align:left" data-action="editGoal"><b>Pick something to save for</b><p class="small muted" style="margin-top:4px">A trip, a guitar, a car payment. Every bottle you don't buy goes toward it.</p></button>`}

      <div class="section-title">Milestones</div>
      <div class="badges">${MILESTONES.map(m => `<div class="badge ${c.streak >= m ? 'got' : m === nextMs ? 'next' : ''}"><b>${m % 365 === 0 ? m / 365 : m}</b><span>${m % 365 === 0 ? plural(m / 365, 'year') : plural(m, 'day')}</span></div>`).join('')}</div>

      <div class="section-title">Keep going</div>
      <details class="group" id="d-letters">
        <summary><span class="ico">✉️</span><span class="t"><b>Letters to future you</b><span>${letters.length ? `${letters.filter(l => c.bottles >= l.unlockDay).length} opened · ${letters.filter(l => c.bottles < l.unlockDay).length} sealed` : 'Seal one now, open it at a milestone'}</span></span></summary>
        <div class="body">
          <div class="list" style="margin-top:0">${letters.map(l => {
            const open = c.bottles >= l.unlockDay;
            return `<button class="item letter ${open ? 'open' : ''}" data-action="openLetter" data-id="${l.id}"><span class="env">${open ? '📬' : '🔒'}</span><span class="t"><b>${esc(l.title || 'Letter')}</b><span class="tiny faint">${open ? `Opened at ${l.unlockDay} bottles` : `Opens at ${l.unlockDay} bottles · ${l.unlockDay - c.bottles} days to go`}</span></span></button>`;
          }).join('')}</div>
          ${opts.length ? `<div style="margin-top:12px">
            <label class="field" style="margin-top:0"><span>Title</span><input id="letterTitle" placeholder="To me, at 90 days"></label>
            <label class="field"><span>Letter</span><textarea id="letterBody" placeholder="What do you want to tell yourself when you get there?"></textarea></label>
            <label class="field"><span>Open when the pile hits</span><select id="letterDay">${opts.map(d => `<option value="${d}" ${d === 90 ? 'selected' : ''}>${d} bottles</option>`).join('')}</select></label>
            <button class="btn primary block" style="margin-top:12px" data-action="sealLetter">Seal letter</button>
          </div>` : ''}
        </div>
      </details>

      <details class="group" id="d-wins">
        <summary><span class="ico">⏳</span><span class="t"><b>Time reclaimed</b><span>~${int(c.hours)} hours back · what you did with them</span></span></summary>
        <div class="body">
          <p class="small muted">Drinking took about ${s.hoursPerDay} hours a day. Log what you're doing with that time instead, big or small.</p>
          <div style="display:flex;gap:8px;margin-top:12px"><input class="input" id="winText" placeholder="Fixed the porch, went to the gym…"><button class="btn primary" data-action="addWin">Add</button></div>
          <div class="list">${state.wins.slice().reverse().map((w, i) => `<div class="item"><div class="top"><span>${new Date(w.ts).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}</span><button class="x" data-action="delWin" data-i="${state.wins.length - 1 - i}" aria-label="Delete">×</button></div><p>${esc(w.text)}</p></div>`).join('')}</div>
        </div>
      </details>

      <div class="section-title">Your body is healing</div>
      <div class="card">
        <div class="timeline">${TIMELINE.map((t, i) => `<div class="tl ${i < nowIdx ? 'done' : i === nowIdx ? 'now' : ''}"><div class="when">${t.when}${i === nowIdx ? ' · you are here' : ''}</div><h3>${t.title}</h3><p>${t.text}</p></div>`).join('')}</div>
        <p class="note">General information, not medical advice. Everyone heals differently, so check in with a doctor about your own health.</p>
      </div>`;
    if (openId) $('#' + openId).open = true;
  }

  /* =========================================================
     Journal screen
     ========================================================= */
  function entryEditor(date) {
    const e = state.journal[date] || {};
    return `<div class="editor" data-date="${date}">
      <div class="field-label">Mood</div>
      <div class="chips mood" data-group="mood">${[1, 2, 3, 4, 5].map(v => `<button type="button" class="chip ${e.mood === v ? 'on' : ''}" data-action="pick" data-v="${v}" aria-label="${MOOD_WORDS[v]}">${MOODS[v]}</button>`).join('')}</div>
      <div class="field-label">Sleep last night</div>
      <div class="chips even" data-group="sleep">${[1, 2, 3, 4, 5].map(v => `<button type="button" class="chip ${e.sleep === v ? 'on' : ''}" data-action="pick" data-v="${v}">${SLEEP_WORDS[v]}</button>`).join('')}</div>
      <label class="field"><span>Hours slept</span><input type="number" inputmode="decimal" step="0.5" min="0" max="16" name="sleepHours" value="${e.sleepHours ?? ''}" placeholder="e.g. 7"></label>
      <label class="field"><span>Notes</span><textarea name="text" placeholder="How did today go? What helped? Anything future-you should remember?">${esc(e.text || '')}</textarea></label>
      <button class="btn primary block" style="margin-top:14px" data-action="saveEntry">Save</button>
    </div>`;
  }

  function entryItem(date) {
    const e = state.journal[date];
    if (!e) return '';
    const day = daysBetween(state.settings.startDate, date) + 1;
    return `<button class="item" style="text-align:left;width:100%" data-action="editEntry" data-date="${date}">
      <div class="top"><span class="entry-day">${fmtDay(date)}${day > 0 ? ` · Day ${day}` : ''}</span><span class="entry-meta">${e.mood ? MOODS[e.mood] : ''}</span></div>
      ${e.sleep || e.sleepHours ? `<div class="tiny faint" style="margin-top:2px">Sleep: ${e.sleep ? SLEEP_WORDS[e.sleep] : ''}${e.sleepHours ? ` · ${e.sleepHours}h` : ''}</div>` : ''}
      ${e.text ? `<p>${esc(e.text)}</p>` : ''}</button>`;
  }

  function chartSVG() {
    const days = 30, W = 340, H = 140, padL = 22, padR = 6, padT = 10, padB = 20;
    const end = todayStr();
    const xs = i => padL + (i / (days - 1)) * (W - padL - padR);
    const ys = v => padT + (1 - (v - 1) / 4) * (H - padT - padB);
    const series = key => {
      let d = '', pts = '', pen = false;
      for (let i = 0; i < days; i++) {
        const v = state.journal[addDays(end, i - days + 1)]?.[key];
        if (v) {
          d += `${pen ? 'L' : 'M'}${xs(i).toFixed(1)} ${ys(v).toFixed(1)} `;
          pts += `<circle cx="${xs(i).toFixed(1)}" cy="${ys(v).toFixed(1)}" r="3"/>`;
          pen = true;
        } else pen = false;
      }
      return { d, pts };
    };
    const m = series('mood'), s = series('sleep');
    const grid = [1, 2, 3, 4, 5].map(v => `<line x1="${padL}" x2="${W - padR}" y1="${ys(v)}" y2="${ys(v)}" stroke="#2a312e"/><text x="${padL - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10" fill="#6d7672">${v}</text>`).join('');
    const lbl = [0, 14, 29].map(i => `<text x="${xs(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}" font-size="10" fill="#6d7672">${fmtDate(addDays(end, i - 29), { month: 'short', day: 'numeric' })}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood and sleep over the last 30 days">${grid}${lbl}
      <path d="${s.d}" fill="none" stroke="#d9b56a" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><g fill="#d9b56a">${s.pts}</g>
      <path d="${m.d}" fill="none" stroke="#a6f2c6" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><g fill="#a6f2c6">${m.pts}</g></svg>
      <div class="legend"><span><i style="background:#a6f2c6"></i>Mood</span><span><i style="background:#d9b56a"></i>Sleep quality</span></div>`;
  }

  function renderJournal() {
    const t = todayStr();
    const dates = Object.keys(state.journal).filter(d => d !== t).sort().reverse();
    const hasData = Object.keys(state.journal).length > 0;
    $('#screen-journal').innerHTML = `
      <h1 class="page-title">Journal</h1>
      <div class="card">
        <div style="display:flex;justify-content:space-between;align-items:baseline;margin-bottom:12px"><b>Today's check-in</b><span class="small faint">${fmtDay(t)}</span></div>
        ${entryEditor(t)}
      </div>
      <div class="section-title">Last 30 days</div>
      <div class="card">${hasData ? chartSVG() : '<div class="empty">Check in daily and you\'ll watch your mood and sleep improve here.</div>'}</div>
      <div class="section-title">Past entries</div>
      <div class="list">${dates.map(entryItem).join('') || '<div class="empty">Past check-ins show up here, and on their bottles in the pile.</div>'}</div>
      <button class="btn ghost block" style="margin-top:8px;color:var(--mint)" data-action="pickPastDay">+ Add an entry for another day</button>`;
  }

  function saveEditor(ed) {
    const date = ed.dataset.date;
    const mood = Number($('[data-group="mood"] .chip.on', ed)?.dataset.v) || null;
    const sleep = Number($('[data-group="sleep"] .chip.on', ed)?.dataset.v) || null;
    const hrs = parseFloat($('[name="sleepHours"]', ed).value);
    const text = $('[name="text"]', ed).value.trim();
    if (!mood && !sleep && !text && isNaN(hrs)) delete state.journal[date];
    else state.journal[date] = { mood, sleep, sleepHours: isNaN(hrs) ? null : hrs, text };
    save();
    toast('Saved');
  }

  /* =========================================================
     Support screen
     ========================================================= */
  const PHONE_ICON = '<svg viewBox="0 0 24 24"><path d="M22 16.9v3a2 2 0 01-2.2 2 19.8 19.8 0 01-8.6-3.1 19.5 19.5 0 01-6-6A19.8 19.8 0 012.1 4.2 2 2 0 014.1 2h3a2 2 0 012 1.7c.1.9.4 1.8.7 2.7a2 2 0 01-.5 2.1L8 9.8a16 16 0 006 6l1.3-1.3a2 2 0 012.1-.4c.9.3 1.8.6 2.7.7a2 2 0 011.7 2z"/></svg>';
  const CHAT_ICON = '<svg viewBox="0 0 24 24"><path d="M21 12a8 8 0 01-11.6 7.1L4 20.5l1.4-4.9A8 8 0 1121 12z"/></svg>';

  function cravingPatterns() {
    const cr = state.cravings;
    if (!cr.length) return '<div class="empty">No cravings logged yet. Each one you log and beat shows up here.</div>';
    const parts = { Morning: 0, Afternoon: 0, Evening: 0, Night: 0 };
    const trig = {};
    cr.forEach(c => {
      const h = new Date(c.ts).getHours();
      parts[h >= 5 && h < 12 ? 'Morning' : h >= 12 && h < 17 ? 'Afternoon' : h >= 17 && h < 21 ? 'Evening' : 'Night']++;
      (c.triggers || []).forEach(t => { trig[t] = (trig[t] || 0) + 1; });
    });
    const maxP = Math.max(...Object.values(parts), 1);
    const topT = Object.entries(trig).sort((a, b) => b[1] - a[1]).slice(0, 5);
    const maxT = Math.max(...topT.map(t => t[1]), 1);
    const last7 = cr.filter(c => Date.now() - c.ts < 7 * 864e5).length;
    const prev7 = cr.filter(c => Date.now() - c.ts >= 7 * 864e5 && Date.now() - c.ts < 14 * 864e5).length;
    const rated = cr.filter(c => c.intensity);
    const avg = rated.length ? rated.reduce((a, c) => a + c.intensity, 0) / rated.length : 0;
    return `
      <div class="stat-grid">
        <div class="stat"><div class="k">Cravings beaten</div><div class="v num">${cr.length}</div><div class="d">every one passed</div></div>
        <div class="stat"><div class="k">This week</div><div class="v num">${last7}</div><div class="d">${prev7 ? (last7 <= prev7 ? `down from ${prev7}` : `up from ${prev7}`) : avg ? `avg strength ${avg.toFixed(1)}/10` : '&nbsp;'}</div></div>
      </div>
      <div class="field-label">When they hit</div>
      <div class="hbars">${Object.entries(parts).map(([k, v]) => `<div class="hbar"><span>${k}</span><div class="bar"><i style="width:${(v / maxP) * 100}%"></i></div><span class="n">${v}</span></div>`).join('')}</div>
      ${topT.length ? `<div class="field-label">Top triggers</div><div class="hbars">${topT.map(([k, v]) => `<div class="hbar"><span>${esc(k)}</span><div class="bar"><i style="width:${(v / maxT) * 100}%"></i></div><span class="n">${v}</span></div>`).join('')}</div>` : ''}
      <div class="field-label">Recent</div>
      <div class="list" style="margin-top:0">${cr.slice().reverse().slice(0, 8).map(c => `<div class="item"><div class="top"><span>${new Date(c.ts).toLocaleString(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span><span>${c.intensity ? c.intensity + '/10' : ''}</span></div>
        ${(c.triggers || []).length || c.where ? `<div class="tiny muted" style="margin-top:2px">${[...(c.triggers || []).map(esc), c.where ? esc(c.where) : ''].filter(Boolean).join(' · ')}</div>` : ''}
        ${c.note ? `<p>${esc(c.note)}</p>` : ''}</div>`).join('')}</div>`;
  }

  function renderSupport(openId) {
    const s = state.settings;
    const tel = s.supportPhone.replace(/[^\d+]/g, '');
    $('#screen-support').innerHTML = `
      <h1 class="page-title">Support</h1>
      <div class="card pause-card">
        <h2>Craving right now?</h2>
        <p>Most cravings peak and fade within 15 minutes. Let's ride this one out together.</p>
        <button class="btn primary block big" style="margin-top:0" data-action="craving">Start a 15-minute pause</button>
      </div>

      <div class="section-title">Reach out</div>
      <div class="call-list">
        ${tel ? `<a class="call main" href="tel:${esc(tel)}"><span class="ic">${PHONE_ICON}</span><span><b>Call ${esc(s.supportName || 'my person')}</b><span>${esc(s.supportPhone)}</span></span></a>`
          : `<button class="call" style="text-align:left;width:100%" data-action="openDetails" data-id="d-person"><span class="ic">${PHONE_ICON}</span><span><b>Add your person</b><span>A sponsor, friend or family member to call</span></span></button>`}
        <a class="call" href="tel:18006624357"><span class="ic">${PHONE_ICON}</span><span><b>SAMHSA Helpline</b><span>1-800-662-4357 · free, confidential, 24/7</span></span></a>
        <a class="call" href="sms:988"><span class="ic">${CHAT_ICON}</span><span><b>988 Lifeline</b><span>Call or text 988 any time you're in crisis</span></span></a>
      </div>

      <div class="section-title">Your tools</div>
      <details class="group" id="d-person">
        <summary><span class="ico">📞</span><span class="t"><b>Your support person</b><span>${s.supportName ? esc(s.supportName) : 'Not set yet'}</span></span></summary>
        <div class="body">
          <div class="row2"><label class="field" style="margin-top:0"><span>Name</span><input data-setting="supportName" value="${esc(s.supportName)}" placeholder="Sponsor, friend…"></label>
          <label class="field" style="margin-top:0"><span>Phone</span><input data-setting="supportPhone" type="tel" value="${esc(s.supportPhone)}" placeholder="555-123-4567"></label></div>
        </div>
      </details>
      <details class="group" id="d-why">
        <summary><span class="ico">🧭</span><span class="t"><b>Your why & the tape</b><span>Shown to you during cravings</span></span></summary>
        <div class="body">
          <label class="field" style="margin-top:0"><span>Why I quit</span><textarea data-setting="why" placeholder="Who and what you're doing this for.">${esc(s.why)}</textarea></label>
          <label class="field"><span>Play the tape forward</span><textarea data-setting="tape" placeholder="How did a drinking night actually end? The next morning? Write it honestly so you can read it when a craving lies to you.">${esc(s.tape)}</textarea></label>
        </div>
      </details>
      <details class="group" id="d-patterns">
        <summary><span class="ico">📈</span><span class="t"><b>Craving patterns</b><span>${state.cravings.length ? `${state.cravings.length} logged` : 'Find your triggers'}</span></span></summary>
        <div class="body">${cravingPatterns()}
          <button class="btn block" style="margin-top:12px" data-action="logCraving">+ Log a craving</button></div>
      </details>`;
    if (openId) $('#' + openId).open = true;
  }

  /* =========================================================
     Settings sheet
     ========================================================= */
  function settingsHTML() {
    const s = state.settings;
    const standalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
    return `<h2>Settings</h2>
      ${standalone ? '' : `<div class="banner" style="margin-top:14px"><span class="ico">📲</span><div><b>Put it on your home screen</b><br><span class="muted">iPhone: tap Share, then <b>Add to Home Screen</b>. Android: tap ⋮, then <b>Install app</b>.</span></div></div>`}
      <div class="sec">Your numbers</div>
      <label class="field"><span>Sober since</span><input type="date" data-setting="startDate" value="${s.startDate}" max="${todayStr()}"></label>
      <div class="row2">
        <label class="field"><span>Price per bottle ($)</span><input type="number" inputmode="decimal" min="0" step="0.5" data-setting="price" value="${s.price}"></label>
        <label class="field"><span>Bottle size</span><select data-setting="sizeMl">${[[375, '375 mL (pint)'], [750, '750 mL (fifth)'], [1000, '1 L'], [1750, '1.75 L (handle)']].map(([v, l]) => `<option value="${v}" ${s.sizeMl === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
      </div>
      <div class="row2">
        <label class="field"><span>Alcohol (% ABV)</span><input type="number" inputmode="decimal" min="1" max="75" data-setting="abv" value="${s.abv}"></label>
        <label class="field"><span>Hours drinking / day</span><input type="number" inputmode="decimal" min="0" max="24" step="0.5" data-setting="hoursPerDay" value="${s.hoursPerDay}"></label>
      </div>
      <label class="field"><span>Volume units</span><select data-setting="units"><option value="metric" ${s.units === 'metric' ? 'selected' : ''}>Liters</option><option value="us" ${s.units === 'us' ? 'selected' : ''}>Gallons</option></select></label>
      <div class="sec">The pile</div>
      <label class="switch"><span>Glass clink sounds</span><input type="checkbox" data-setting="sound" ${s.sound ? 'checked' : ''}></label>

      <div class="sec">If you slip</div>
      <p class="small muted">A slip doesn't erase your pile. Every bottle you didn't drink stays. Mark the day and your streak starts again.</p>
      <div style="display:flex;gap:8px;margin-top:10px"><input class="input" type="date" id="slipDate" value="${todayStr()}" min="${s.startDate}" max="${todayStr()}"><button class="btn" data-action="addSlip">Mark day</button></div>
      <div class="list">${state.slips.slice().sort().reverse().map(d => `<div class="item" style="display:flex;justify-content:space-between;align-items:center"><span>${fmtDay(d)}</span><button class="x" data-action="delSlip" data-d="${d}" aria-label="Remove">×</button></div>`).join('')}</div>

      <div class="sec">Your data</div>
      <p class="small muted">Everything stays on this phone. Back it up now and then.</p>
      <div class="btn-row" style="margin-top:10px">
        <button class="btn" data-action="export">Export backup</button>
        <label class="btn" style="cursor:pointer">Import<input type="file" accept="application/json" id="importFile" hidden></label>
      </div>
      <button class="btn ghost danger block" style="margin-top:8px" data-action="reset">Erase everything</button>
      <button class="btn primary block" style="margin-top:16px" data-action="closeSheet">Done</button>`;
  }

  /* =========================================================
     Craving mode
     ========================================================= */
  const BREATH = [['Breathe in', 4000, 1], ['Hold', 4000, 1], ['Breathe out', 6000, 0.55]];
  let crav = null;

  function goodDayNote() {
    const good = Object.entries(state.journal).filter(([, e]) => e.mood >= 4 && e.text);
    if (!good.length) return null;
    const [d, e] = good[Math.floor(Math.random() * good.length)];
    return { d, text: e.text };
  }

  function openCraving() {
    const c = calc();
    const s = state.settings;
    const gd = goodDayNote();
    const tel = s.supportPhone.replace(/[^\d+]/g, '');
    crav = { start: Date.now(), dur: 15 * 60 * 1000, phase: -1, timer: null };
    const ov = $('#craving');
    ov.hidden = false;
    ov.innerHTML = `
      <div class="top"><span class="kicker">Let's pause</span><button class="close" data-action="closeCraving" aria-label="Close">×</button></div>
      <h2>Ride it out. It will pass.</h2>
      <p class="lead">Most cravings peak and fade within 15 minutes. Breathe with the circle.</p>
      <div class="breathe-wrap">
        <svg class="ring" viewBox="0 0 100 100"><circle class="track" cx="50" cy="50" r="46"/><circle class="prog" id="cravRing" cx="50" cy="50" r="46" stroke-dasharray="289.03" stroke-dashoffset="0"/></svg>
        <div class="breath" id="breath"></div>
        <div class="breathe-center"><div class="phase" id="breathPhase">Breathe in</div><div class="clock" id="cravClock">15:00</div><div class="tiny">until it passes</div></div>
      </div>
      <div class="remind">
        <div class="card"><div class="k">Your pile</div><p><b>${int(c.bottles)} ${plural(c.bottles, 'bottle')}</b>, ${money(c.money)} and ${int(c.stdDrinks)} drinks you didn't have. Don't knock the pile over for one night.</p></div>
        ${s.why ? `<div class="card"><div class="k">Why you quit</div><p>${esc(s.why)}</p></div>` : ''}
        <div class="card"><div class="k">Play the tape forward</div><p>${s.tape ? esc(s.tape) : 'Think past the first drink. Picture the 10th, the night, the next morning. That\'s where one drink actually ends.'}</p></div>
        ${gd ? `<div class="card"><div class="k">From a good day · ${fmtDate(gd.d, { month: 'short', day: 'numeric' })}</div><p>${esc(gd.text)}</p></div>` : ''}
      </div>
      <div class="call-row">
        ${tel ? `<a class="btn primary wide" href="tel:${esc(tel)}">Call ${esc(s.supportName || 'my person')}</a>` : ''}
        <a class="btn" href="tel:18006624357">SAMHSA line</a>
        <a class="btn" href="sms:988">Text 988</a>
        <button class="btn primary wide" data-action="cravingPassed">It passed. Log it</button>
      </div>`;
    tickCraving();
    crav.timer = setInterval(tickCraving, 250);
  }

  function tickCraving() {
    if (!crav) return;
    const now = Date.now();
    const left = Math.max(0, crav.dur - (now - crav.start));
    const clock = $('#cravClock');
    if (!clock) return;
    clock.textContent = `${Math.floor(left / 60000)}:${pad(Math.floor((left % 60000) / 1000))}`;
    $('#cravRing').setAttribute('stroke-dashoffset', (289.03 * (1 - left / crav.dur)).toFixed(2));
    const cyc = BREATH.reduce((a, b) => a + b[1], 0);
    const t = (now - crav.start) % cyc;
    let acc = 0, idx = 0;
    for (let i = 0; i < BREATH.length; i++) { if (t < acc + BREATH[i][1]) { idx = i; break; } acc += BREATH[i][1]; }
    if (idx !== crav.phase) {
      crav.phase = idx;
      const [label, ms, sc] = BREATH[idx];
      $('#breathPhase').textContent = label;
      const b = $('#breath');
      b.style.transitionDuration = ms + 'ms';
      b.style.transform = `scale(${sc})`;
      if (navigator.vibrate && idx !== 1) navigator.vibrate(12);
    }
    if (left === 0) {
      clearInterval(crav.timer);
      $('#breathPhase').textContent = 'You made it';
      $('.lead', $('#craving')).textContent = '15 minutes. The craving lied and you didn\'t listen. Log it so you can learn your patterns.';
    }
  }

  function closeCraving() {
    if (crav) clearInterval(crav.timer);
    crav = null;
    $('#craving').hidden = true;
    $('#craving').innerHTML = '';
  }

  function cravingForm(fromTimer) {
    return `<h2>Log the craving</h2><p class="sheet-sub">${fromTimer ? 'You beat it. ' : ''}Patterns show up after a few weeks.</p>
      <div class="craving-form" data-timer="${fromTimer ? 1 : 0}">
        <div class="field-label">How strong was it? <b id="intVal">5</b>/10</div>
        <input type="range" min="1" max="10" value="5" id="cfInt">
        <div class="field-label">What set it off?</div>
        <div class="chips" data-group="triggers" data-multi="1">${TRIGGERS.map(t => `<button type="button" class="chip" data-action="pick" data-v="${t}">${t}</button>`).join('')}</div>
        <label class="field"><span>Where were you?</span><input id="cfWhere" placeholder="Home, driving past the store…"></label>
        <label class="field"><span>Anything else?</span><textarea id="cfNote" placeholder="What you felt, what helped."></textarea></label>
        <button class="btn primary block" style="margin-top:14px" data-action="saveCraving">Save</button>
      </div>`;
  }

  /* =========================================================
     Sheet
     ========================================================= */
  let sheetKind = null;
  function openSheet(html, kind = null) {
    sheetKind = kind;
    $('#sheetBody').innerHTML = html;
    $('#sheetWrap').hidden = false;
    $('.sheet').scrollTop = 0;
  }
  function closeSheet() { sheetKind = null; $('#sheetWrap').hidden = true; $('#sheetBody').innerHTML = ''; }
  function refreshSettingsSheet() {
    if (sheetKind !== 'settings') return;
    const sc = $('.sheet').scrollTop;
    $('#sheetBody').innerHTML = settingsHTML();
    $('.sheet').scrollTop = sc;
  }

  /* =========================================================
     Navigation
     ========================================================= */
  function showTab(tab) {
    currentTab = tab;
    $$('.screen').forEach(s => s.classList.toggle('active', s.dataset.screen === tab));
    $$('.tabbar .tab[data-tab]').forEach(b => b.classList.toggle('on', b.dataset.tab === tab));
    if (tab === 'today') {
      renderToday();
      Pile.start();
      requestAnimationFrame(() => {
        if (pileDirty) { pileDirty = false; rebuildPile(false); return; }
        const r = $('#pileCanvas').getBoundingClientRect();
        const sz = Pile.size();
        if (!Pile.isBuilt() || Math.abs(r.width - sz.W) > 20 || Math.abs(r.height - sz.H) > 40) rebuildPile(!Pile.isBuilt());
      });
    } else Pile.stop();
    if (tab === 'progress') renderProgress();
    if (tab === 'journal') renderJournal();
    if (tab === 'support') renderSupport();
    $(`#screen-${tab}`).scrollTop = 0;
  }

  function refreshAll() {
    renderToday();
    if (currentTab === 'progress') renderProgress();
    if (currentTab === 'journal') renderJournal();
  }

  /* =========================================================
     Actions
     ========================================================= */
  const actions = {
    tab: el => showTab(el.dataset.tab),
    view: el => setPileView(el.dataset.view),
    settings: () => openSheet(settingsHTML(), 'settings'),
    checkin: () => actions.editEntry({ dataset: { date: todayStr() } }),
    craving: () => openCraving(),
    closeCraving: () => closeCraving(),
    cravingPassed: () => { closeCraving(); openSheet(cravingForm(true)); },
    logCraving: () => openSheet(cravingForm(false)),
    openDetails: el => { const d = $('#' + el.dataset.id); d.open = true; d.scrollIntoView({ behavior: 'smooth', block: 'center' }); },
    saveCraving: el => {
      const f = el.closest('.craving-form');
      state.cravings.push({
        ts: Date.now(),
        intensity: Number($('#cfInt').value),
        triggers: $$('[data-group="triggers"] .chip.on', f).map(c => c.dataset.v),
        where: $('#cfWhere').value.trim(),
        note: $('#cfNote').value.trim(),
        timer: f.dataset.timer === '1',
      });
      save();
      closeSheet();
      toast(`Craving #${state.cravings.length} beaten 💪`);
      if (currentTab === 'support') renderSupport('d-patterns');
    },
    pick: el => {
      const group = el.parentElement;
      if (group.dataset.multi) el.classList.toggle('on');
      else {
        const was = el.classList.contains('on');
        $$('.chip', group).forEach(c => c.classList.remove('on'));
        if (!was) el.classList.add('on');
      }
    },
    saveEntry: el => {
      saveEditor(el.closest('.editor'));
      if (!$('#sheetWrap').hidden) closeSheet();
      refreshAll();
    },
    editEntry: el => {
      const d = el.dataset.date;
      const day = daysBetween(state.settings.startDate, d) + 1;
      const isToday = d === todayStr();
      openSheet(`<h2>${isToday ? 'How are you feeling today?' : fmtDay(d)}</h2><p class="sheet-sub">${isToday ? fmtDay(d) + ' · ' : ''}${day > 0 ? `Day ${day}` : ''}</p><div style="margin-top:14px">${entryEditor(d)}</div>
        ${state.journal[d] ? `<button class="btn ghost danger block" style="margin-top:6px" data-action="delEntry" data-date="${d}">Delete entry</button>` : ''}`);
    },
    delEntry: el => { if (!confirm('Delete this entry?')) return; delete state.journal[el.dataset.date]; save(); closeSheet(); refreshAll(); },
    pickPastDay: () => openSheet(`<h2>Pick a day</h2><label class="field"><span>Date</span><input type="date" id="pastDay" max="${todayStr()}" value="${addDays(todayStr(), -1)}"></label><button class="btn primary block" style="margin-top:14px" data-action="goPastDay">Continue</button>`),
    goPastDay: () => { const v = $('#pastDay').value; if (v) actions.editEntry({ dataset: { date: v } }); },
    editGoal: () => openSheet(`<h2>Saving for</h2><p class="sheet-sub">Your bottle money goes here.</p>
      <label class="field"><span>What is it?</span><input id="goalName" value="${esc(state.settings.goalName)}" placeholder="New truck tires, a trip…"></label>
      <label class="field"><span>Cost ($)</span><input id="goalAmount" type="number" inputmode="decimal" min="0" value="${state.settings.goalAmount || ''}" placeholder="600"></label>
      <button class="btn primary block" style="margin-top:14px" data-action="saveGoal">Save</button>`),
    saveGoal: () => { state.settings.goalName = $('#goalName').value.trim(); state.settings.goalAmount = parseFloat($('#goalAmount').value) || 0; save(); closeSheet(); renderProgress(); },
    sealLetter: () => {
      const body = $('#letterBody').value.trim();
      if (!body) { toast('Write something first'); return; }
      state.letters.push({ id: uid(), created: todayStr(), unlockDay: Number($('#letterDay').value), title: $('#letterTitle').value.trim(), body });
      save(); renderProgress('d-letters'); toast('Sealed. See you there.');
    },
    openLetter: el => {
      const l = state.letters.find(x => x.id === el.dataset.id);
      const c = calc();
      if (!l) return;
      if (c.bottles < l.unlockDay) {
        openSheet(`<h2>🔒 Still sealed</h2><p class="sheet-sub">Written ${fmtDate(l.created)}. Opens when your pile hits ${l.unlockDay} bottles, ${l.unlockDay - c.bottles} days from now.</p>
          <button class="btn ghost danger block" style="margin-top:16px" data-action="delLetter" data-id="${l.id}">Delete letter</button>`);
      } else {
        openSheet(`<h2>${esc(l.title || 'A letter from you')}</h2><p class="sheet-sub">Written on ${fmtDate(l.created)}, opened at ${l.unlockDay} bottles</p>
          <p style="margin-top:16px;white-space:pre-wrap;font-size:18px;line-height:1.55">${esc(l.body)}</p>
          <button class="btn ghost danger block" style="margin-top:16px" data-action="delLetter" data-id="${l.id}">Delete letter</button>`);
      }
    },
    delLetter: el => { if (!confirm('Delete this letter?')) return; state.letters = state.letters.filter(l => l.id !== el.dataset.id); save(); closeSheet(); renderProgress('d-letters'); },
    addWin: () => {
      const v = $('#winText').value.trim();
      if (!v) return;
      state.wins.push({ ts: Date.now(), text: v });
      save(); renderProgress('d-wins'); toast('Nice. That\'s time well spent.');
    },
    delWin: el => { state.wins.splice(Number(el.dataset.i), 1); save(); renderProgress('d-wins'); },
    addSlip: () => {
      const d = $('#slipDate').value;
      if (!d || state.slips.includes(d)) return;
      if (!confirm(`Mark ${fmtDay(d)} as a drinking day? Your pile keeps every other bottle.`)) return;
      state.slips.push(d);
      state.seenBottles = Math.min(state.seenBottles, calc().bottles);
      save(); refreshSettingsSheet(); renderToday(); rebuildPile(false);
      toast('Marked. One day at a time. Start again now.');
    },
    delSlip: el => { state.slips = state.slips.filter(d => d !== el.dataset.d); save(); refreshSettingsSheet(); renderToday(); rebuildPile(false); },
    export: () => {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `sober-pile-backup-${todayStr()}.json`;
      a.click();
      setTimeout(() => URL.revokeObjectURL(a.href), 1000);
    },
    reset: () => {
      if (!confirm('Erase all your data on this phone? Export a backup first if you want to keep it.')) return;
      if (!confirm('Really erase everything?')) return;
      state = structuredClone(DEFAULT_STATE); save(); location.reload();
    },
    closeSheet: () => closeSheet(),
  };

  document.addEventListener('click', e => {
    const el = e.target.closest('[data-action]');
    if (!el) return;
    const fn = actions[el.dataset.action];
    if (fn) { e.preventDefault(); fn(el, e); }
  });

  document.addEventListener('input', e => {
    if (e.target.id === 'cfInt') $('#intVal').textContent = e.target.value;
  });

  document.addEventListener('change', e => {
    const el = e.target;
    if (el.id === 'importFile' && el.files[0]) {
      el.files[0].text().then(txt => {
        try {
          const s = JSON.parse(txt);
          if (!s.settings) throw new Error('bad');
          if (!confirm('Replace the data on this phone with this backup?')) return;
          state = { ...structuredClone(DEFAULT_STATE), ...s, settings: { ...DEFAULT_STATE.settings, ...s.settings }, seenBottles: 0 };
          save(); location.reload();
        } catch (err) { toast('That file isn\'t a Sober Pile backup'); }
      });
      return;
    }
    const key = el.dataset.setting;
    if (!key) return;
    let v = el.type === 'checkbox' ? el.checked : el.value;
    if (['price', 'abv', 'hoursPerDay', 'sizeMl'].includes(key)) v = parseFloat(v) || 0;
    if (key === 'startDate' && (!v || v > todayStr())) { el.value = state.settings.startDate; return; }
    state.settings[key] = typeof v === 'string' ? v.trim() : v;
    if (key === 'startDate') state.seenBottles = 0;
    save();
    renderToday();
    if (key === 'startDate' || key === 'sizeMl') rebuildPile(true);
    toast('Saved');
  });

  // new day while the app sits open / comes back from background
  let lastDay = todayStr();
  function checkDay() {
    if (todayStr() !== lastDay) {
      lastDay = todayStr();
      renderToday();
      rebuildPile(false);
    }
  }
  document.addEventListener('visibilitychange', () => { if (!document.hidden) checkDay(); });
  setInterval(checkDay, 60000);

  let resizeT;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = setTimeout(() => rebuildPile(false), 250);
  });

  /* =========================================================
     Boot
     ========================================================= */
  Pile.init($('#pileCanvas'));
  showTab('today');

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
