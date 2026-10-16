(() => {
  'use strict';

  /* =========================================================
     State
     ========================================================= */
  const APP_VERSION = '1.17';
  const STORE_KEY = 'soberpile.v1';
  const DEFAULT_STATE = {
    settings: {
      startDate: '2026-10-01',
      price: 20,
      sizeMl: 750,
      abv: 40,
      hoursPerDay: 4,
      daysPerBottle: 3,
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
    // one bottle for every `daysPerBottle` sober days (about 3 a week by default)
    const dpb = Math.max(1, Math.round(s.daysPerBottle) || 1);
    const soberDays = soberDates.length;
    const bottleList = [];
    for (let i = dpb - 1; i < soberDays; i += dpb) bottleList.push({ date: soberDates[i], covers: soberDates.slice(i - dpb + 1, i + 1) });
    const bottles = bottleList.length;
    const nextBottleIn = dpb - (soberDays % dpb);
    const liters = bottles * s.sizeMl / 1000;
    const ethanolG = liters * 1000 * (s.abv / 100) * 0.789;
    const calories = ethanolG * 7;
    return {
      today, span, soberDates, soberDays, bottleList, nextBottleIn, dpb, streak, bottles, liters,
      gallons: liters / 3.78541,
      stdDrinks: ethanolG / 14,
      calories,
      fatLb: calories / 3500,
      money: bottles * s.price,
      hours: soberDays * s.hoursPerDay,
      oldBottles: Math.round((365 * 3) / dpb),
    };
  }

  function volumeText(c, digits = 2) {
    const fmt = v => (v >= 100 ? int(v) : v.toFixed(digits));
    return state.settings.units === 'us' ? `${fmt(c.gallons)} gal` : `${fmt(c.liters)} L`;
  }

  const MILESTONES = [1, 3, 7, 14, 30, 60, 90, 180, 365, 500, 730, 1000, 1095, 1461];
  const milestoneName = d => d % 365 === 0 ? `${d / 365} ${plural(d / 365, 'year')}` : `${d} days`;

  // Exact US units, so every comparison is real-world accurate.
  const GAL = 3.785411784;            // liters in a US gallon
  const SHOT_L = (1.5 * GAL) / 128;   // a standard US shot: 1.5 fl oz = 44.36 mL
  const SHOT_ML = SHOT_L * 1000;

  // Containers to compare the whiskey against, smallest to largest. L = liters.
  const LIQUIDS = [
    // art: a photo of the container. clear = see-through, so whiskey is drawn inside `poly`
    // (normalised to the image, liquid from `bottom` up to `top`); otherwise a fill line is drawn on it.
    {
      id: 'shot', one: 'shot', many: 'shots', L: SHOT_L, note: '1.5 oz',
      art: {
        src: 'assets/c-shot.png', clear: true, top: 0.17, bottom: 0.74,
        poly: [[0.055, 0.155], [0.083, 0.363], [0.125, 0.552], [0.198, 0.661], [0.307, 0.722], [0.509, 0.74], [0.708, 0.722], [0.817, 0.661], [0.89, 0.552], [0.932, 0.363], [0.95, 0.155]],
      },
    },
    {
      id: 'soda', one: '2-liter soda', many: '2-liter sodas', L: 2,
      art: {
        src: 'assets/c-soda.png', clear: true, top: 0.14, bottom: 0.97,
        poly: [[0.304, 0.136], [0.186, 0.182], [0.106, 0.227], [0.05, 0.273], [0.031, 0.318], [0.025, 0.864], [0.05, 0.909], [0.106, 0.955], [0.161, 0.977],
          [0.832, 0.977], [0.888, 0.955], [0.944, 0.909], [0.969, 0.864], [0.969, 0.318], [0.944, 0.273], [0.888, 0.227], [0.801, 0.182], [0.683, 0.136]],
      },
    },
    {
      id: 'jug', one: 'gallon jug', many: 'gallon jugs', L: GAL,
      art: {
        src: 'assets/c-jug.png', clear: true, top: 0.165, bottom: 0.93,
        poly: [[0.305, 0.156], [0.242, 0.189], [0.182, 0.221], [0.126, 0.254], [0.082, 0.286], [0.052, 0.318], [0.034, 0.351], [0.021, 0.383], [0.016, 0.448], [0.015, 0.562], [0.016, 0.805], [0.030, 0.870], [0.056, 0.902], [0.113, 0.934], [0.258, 0.963], [0.500, 0.975], [0.745, 0.963], [0.891, 0.934], [0.947, 0.902], [0.970, 0.870], [0.982, 0.805], [0.985, 0.643], [0.979, 0.513], [0.975, 0.481], [0.765, 0.448], [0.749, 0.416], [0.737, 0.383], [0.725, 0.351], [0.713, 0.318], [0.701, 0.286], [0.702, 0.254], [0.771, 0.221], [0.776, 0.189], [0.679, 0.156]],
      },
    },
    { id: 'keg', one: 'beer keg', many: 'beer kegs', L: 15.5 * GAL, note: '15.5 gallon', art: { src: 'assets/c-keg.png', clear: false, top: 0.13, bottom: 0.95 } },
    { id: 'drum', one: 'oil drum', many: 'oil drums', L: 55 * GAL, note: '55 gallon', art: { src: 'assets/c-drum.png', clear: false, top: 0.1, bottom: 0.96 } },
    {
      id: 'hottub', one: 'hot tub', many: 'hot tubs', L: 500 * GAL, note: '500 gallon',
      art: {
        src: 'assets/c-hottub.png', clear: true, top: 0.03, bottom: 0.5,
        poly: [[0.068, 0.225], [0.188, 0.093], [0.393, 0.027], [0.620, 0.027], [0.825, 0.103], [0.942, 0.225], [0.935, 0.337], [0.648, 0.489], [0.379, 0.499], [0.075, 0.327]],
      },
    },
    {
      id: 'pool', one: 'backyard pool', many: 'backyard pools', L: 2000 * GAL, note: '2,000 gallon',
      // open basin seen from above: the whiskey is an ellipse rising from the floor to the rim
      art: { src: 'assets/c-pool.png', basin: { cx: 0.502, cy: 0.389, rx: 0.471, ry: 0.236, depth: 0.184 } },
    },
    {
      id: 'olympic', one: 'Olympic pool', many: 'Olympic pools', L: 660000 * GAL, note: '660,000 gallon',
      // rectangular basin in perspective: the surface rises from the floor outline to the rim outline
      art: { src: 'assets/c-olympic.png', quad: { rim: [[0.246, 0.053], [0.754, 0.053], [0.94, 0.832], [0.061, 0.832]], floor: [[0.251, 0.137], [0.749, 0.137], [0.913, 0.832], [0.089, 0.832]] } },
    },
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
     Drawing: realistic glass bottles (pre-rendered sprites),
     sunlit plaster wall, stone ledge, glass jar
     ========================================================= */
  const GLASSES = [
    { liquid: ['#3e1c04', '#8e4c10', '#cf8226', '#f2b452', '#a35b14', '#3e1c04'], glass: 'rgba(255,246,228,0.10)', edge: 'rgba(60,32,8,0.5)', cap: 'brass' },
    { liquid: ['#2f1402', '#6f360a', '#b5641a', '#e09538', '#7e400d', '#2f1402'], glass: 'rgba(255,246,228,0.10)', edge: 'rgba(45,22,4,0.55)', cap: 'black' },
    { liquid: ['#5c300a', '#ad6d26', '#e3a556', '#f8d18e', '#bd7f35', '#5c300a'], glass: 'rgba(255,246,228,0.12)', edge: 'rgba(70,40,12,0.45)', cap: 'cork' },
    { tint: ['#0e1308', '#263412', '#435623', '#6c8044', '#2f4019', '#0e1308'], edge: 'rgba(12,18,3,0.7)', cap: 'black' },
    { tint: ['#170b03', '#3e220c', '#6d4319', '#a06a33', '#4a2a10', '#170b03'], edge: 'rgba(15,8,2,0.7)', cap: 'brass' },
  ];
  const BOTTLE_SHAPES = {
    square: { neckW: 0.34, neckH: 0.26, shoulder: 0.06, r: 0.1, square: true, dims: [1.05, 0.96] },
    round: { neckW: 0.3, neckH: 0.32, shoulder: 0.15, r: 0.14, square: false, dims: [0.95, 1.06] },
    flask: { neckW: 0.32, neckH: 0.22, shoulder: 0.18, r: 0.32, square: false, dims: [1.15, 0.84] },
    tall: { neckW: 0.26, neckH: 0.36, shoulder: 0.2, r: 0.12, square: false, dims: [0.86, 1.12] },
  };
  const SHAPE_KEYS = Object.keys(BOTTLE_SHAPES);
  const LIGHT = { x: 9, y: 7 };  // shadow offset: sunlight from the upper left

  // Photographic whiskey bottle used for every bottle in the pile (falls back to drawn bottles).
  const PHOTO = new Image();
  PHOTO.src = 'assets/bottle.png';
  const PHOTO_RATIO = 171 / 440;
  const photoReady = () => PHOTO.complete && PHOTO.naturalWidth > 0;

  function roundRect(c, x, y, w, h, r) {
    r = Math.max(0, Math.min(r, w / 2, h / 2));
    c.beginPath();
    c.moveTo(x + r, y);
    c.arcTo(x + w, y, x + w, y + h, r);
    c.arcTo(x + w, y + h, x, y + h, r);
    c.arcTo(x, y + h, x, y, r);
    c.arcTo(x, y, x + w, y, r);
    c.closePath();
  }

  function seeded(seed) {
    let x = (seed % 2147483646) + 1;
    return () => { x = (x * 16807) % 2147483647; return (x - 1) / 2147483646; };
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

  function hGrad(c, x0, x1, stops) {
    const g = c.createLinearGradient(x0, 0, x1, 0);
    const n = stops.length - 1;
    stops.forEach((s, i) => g.addColorStop([0, 0.16, 0.38, 0.5, 0.74, 1][i] ?? i / n, s));
    return g;
  }

  // Aged paper label with grain, stains, worn edges and faint print.
  function paintLabel(c, x, y, w, h, seed) {
    const rnd = seeded(seed);
    c.save();
    // slightly irregular, worn outline
    c.beginPath();
    const j = () => (rnd() - 0.5) * Math.min(w, h) * 0.04;
    c.moveTo(x + j(), y + j());
    for (let i = 1; i <= 6; i++) c.lineTo(x + (w * i) / 6 + j(), y + j());
    for (let i = 1; i <= 6; i++) c.lineTo(x + w + j(), y + (h * i) / 6 + j());
    for (let i = 5; i >= 0; i--) c.lineTo(x + (w * i) / 6 + j() * 2, y + h + j() * 2);
    for (let i = 5; i >= 1; i--) c.lineTo(x + j(), y + (h * i) / 6 + j());
    c.closePath();
    c.fillStyle = '#e4d4b0';
    c.fill();
    c.clip();
    // grain
    for (let i = 0; i < (w * h) / 5; i++) {
      c.fillStyle = rnd() < 0.5 ? `rgba(120,85,40,${0.04 + rnd() * 0.1})` : `rgba(255,250,235,${0.05 + rnd() * 0.12})`;
      c.fillRect(x + rnd() * w, y + rnd() * h, 0.8 + rnd() * 1.2, 0.8 + rnd() * 1.2);
    }
    // stains
    for (let i = 0; i < 4; i++) {
      const sx = x + rnd() * w, sy = y + rnd() * h, sr = Math.max(w, h) * (0.15 + rnd() * 0.3);
      const g = c.createRadialGradient(sx, sy, 0, sx, sy, sr);
      g.addColorStop(0, `rgba(150,105,50,${0.08 + rnd() * 0.12})`);
      g.addColorStop(1, 'rgba(150,105,50,0)');
      c.fillStyle = g;
      c.fillRect(x, y, w, h);
    }
    // darker worn edges
    const eg = c.createRadialGradient(x + w / 2, y + h / 2, Math.min(w, h) * 0.3, x + w / 2, y + h / 2, Math.max(w, h) * 0.75);
    eg.addColorStop(0, 'rgba(110,75,35,0)');
    eg.addColorStop(1, 'rgba(110,75,35,0.45)');
    c.fillStyle = eg;
    c.fillRect(x, y, w, h);
    // faint, unbranded print: a border and a few lines of "type"
    c.strokeStyle = 'rgba(70,45,22,0.3)';
    c.lineWidth = Math.max(0.5, w * 0.012);
    c.strokeRect(x + w * 0.1, y + h * 0.1, w * 0.8, h * 0.8);
    c.fillStyle = 'rgba(60,38,18,0.32)';
    c.fillRect(x + w * 0.25, y + h * 0.26, w * 0.5, Math.max(1, h * 0.07));
    [0.46, 0.56, 0.66].forEach((ly, i) => c.fillRect(x + w * (0.22 + i * 0.04), y + h * ly, w * (0.56 - i * 0.08), Math.max(0.6, h * 0.025)));
    c.restore();
  }

  function paintCap(c, g, w, h, kind) {
    const cw = g.nw * 1.12, ch = h * 0.085, cy = g.top - h * 0.01;
    let gr;
    if (kind === 'brass') {
      gr = hGrad(c, -cw / 2, cw / 2, ['#4f3a14', '#9c7a36', '#e9cd88', '#fbe9b8', '#a8843d', '#4a3511']);
      c.fillStyle = gr;
      roundRect(c, -cw / 2, cy, cw, ch, cw * 0.12);
      c.fill();
      c.strokeStyle = 'rgba(60,40,10,0.35)';
      c.lineWidth = Math.max(0.5, w * 0.008);
      for (let i = 1; i < 8; i++) { const x = -cw / 2 + (cw / 8) * i; c.beginPath(); c.moveTo(x, cy + 1); c.lineTo(x, cy + ch - 1); c.stroke(); }
      // foil collar on the neck
      c.fillStyle = hGrad(c, -g.nw / 2, g.nw / 2, ['#5a4318', '#a5843f', '#e3c67f', '#f3dea5', '#9c7a35', '#5a4318']);
      c.fillRect(-g.nw / 2 - 0.5, cy + ch, g.nw + 1, h * 0.05);
    } else if (kind === 'black') {
      gr = hGrad(c, -cw / 2, cw / 2, ['#050505', '#1c1c1c', '#5a5a5a', '#2a2a2a', '#111', '#050505']);
      c.fillStyle = gr;
      roundRect(c, -cw / 2, cy, cw, ch * 1.1, cw * 0.14);
      c.fill();
    } else {
      gr = hGrad(c, -cw / 2, cw / 2, ['#5e4224', '#9a7447', '#cfa977', '#dcbb8c', '#a07a4c', '#5e4224']);
      c.fillStyle = gr;
      roundRect(c, -cw / 2 * 0.92, cy - h * 0.012, cw * 0.92, ch * 1.15, cw * 0.1);
      c.fill();
      c.fillStyle = 'rgba(60,40,20,0.35)';
      for (let i = 0; i < 10; i++) c.fillRect(-cw * 0.4 + Math.random() * cw * 0.8, cy + Math.random() * ch, 1, 1);
    }
  }

  function paintBottle(c, w, h, shapeKey, gi, seed) {
    const sh = BOTTLE_SHAPES[shapeKey];
    const G = GLASSES[gi];
    const g = bottlePath(c, w, h, sh);
    const t = w * 0.05;   // glass thickness

    c.save();
    c.clip();
    if (G.tint) {
      // coloured glass bottle with dark contents
      c.fillStyle = hGrad(c, -w / 2, w / 2, G.tint);
      c.fillRect(-w / 2, -h / 2, w, h);
    } else {
      c.fillStyle = G.glass;
      c.fillRect(-w / 2, -h / 2, w, h);
      // whiskey, filled up into the neck
      const lt = g.top + g.nh * 0.6;
      c.save();
      bottlePath(c, w - t * 2, h - t * 2, sh);
      c.clip();
      c.fillStyle = hGrad(c, -w / 2 + t, w / 2 - t, G.liquid);
      c.fillRect(-w / 2, lt, w, h);
      // meniscus
      c.fillStyle = 'rgba(255,224,160,0.55)';
      c.fillRect(-w / 2, lt, w, Math.max(1, h * 0.006));
      // light passing through and pooling near the base
      const cg = c.createRadialGradient(w * 0.08, g.bot - h * 0.14, 0, w * 0.08, g.bot - h * 0.14, w * 0.55);
      cg.addColorStop(0, 'rgba(255,210,120,0.55)');
      cg.addColorStop(1, 'rgba(255,210,120,0)');
      c.fillStyle = cg;
      c.fillRect(-w / 2, g.ys, w, h);
      c.restore();
    }
    // depth: darker toward the base
    let vg = c.createLinearGradient(0, -h / 2, 0, h / 2);
    vg.addColorStop(0, 'rgba(255,255,255,0.06)');
    vg.addColorStop(0.55, 'rgba(0,0,0,0)');
    vg.addColorStop(1, 'rgba(25,10,0,0.3)');
    c.fillStyle = vg;
    c.fillRect(-w / 2, -h / 2, w, h);
    // thick glass at the edges and the base
    bottlePath(c, w, h, sh);
    c.lineWidth = t * 2.2;
    c.strokeStyle = G.edge;
    c.stroke();
    c.fillStyle = 'rgba(255,240,215,0.18)';
    c.fillRect(-w / 2, g.bot - h * 0.035, w, h * 0.035);

    // label
    const bodyH = g.bot - g.ys;
    const lw = w * (shapeKey === 'flask' ? 0.66 : 0.8), lh = bodyH * (shapeKey === 'tall' ? 0.42 : 0.52);
    paintLabel(c, -lw / 2, g.ys + bodyH * 0.18, lw, lh, seed);
    // label wraps around the body: shade its sides
    c.fillStyle = hGrad(c, -w / 2, w / 2, ['rgba(40,20,5,0.45)', 'rgba(40,20,5,0.12)', 'rgba(255,255,255,0.05)', 'rgba(0,0,0,0)', 'rgba(40,20,5,0.15)', 'rgba(40,20,5,0.5)']);
    c.fillRect(-w / 2, g.ys + bodyH * 0.16, w, lh + bodyH * 0.06);

    // specular highlights from the window light
    const sg = c.createLinearGradient(-w * 0.4, 0, -w * 0.22, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.45, 'rgba(255,255,250,0.8)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sg;
    c.fillRect(-w * 0.4, g.ys + h * 0.02, w * 0.18, bodyH * 0.9);
    c.fillStyle = 'rgba(255,255,245,0.3)';
    c.fillRect(w * 0.27, g.ys + h * 0.05, Math.max(1, w * 0.04), bodyH * 0.7);
    c.fillStyle = 'rgba(255,255,245,0.55)';
    c.fillRect(-g.nw * 0.32, g.top + h * 0.1, Math.max(1, w * 0.045), g.nh * 0.8);
    // shoulder glint
    const gx = -w * 0.22, gy = g.ys - h * 0.02;
    const rg = c.createRadialGradient(gx, gy, 0, gx, gy, w * 0.2);
    rg.addColorStop(0, 'rgba(255,255,245,0.75)');
    rg.addColorStop(1, 'rgba(255,255,245,0)');
    c.fillStyle = rg;
    c.fillRect(gx - w * 0.2, gy - w * 0.2, w * 0.4, w * 0.4);
    c.restore();

    // crisp outer edge
    bottlePath(c, w, h, sh);
    c.lineJoin = 'round';
    c.lineWidth = Math.max(0.8, w * 0.018);
    c.strokeStyle = 'rgba(45,25,8,0.55)';
    c.stroke();
    // lip ring on the neck
    c.fillStyle = 'rgba(255,245,225,0.35)';
    c.fillRect(-g.nw / 2, g.top + h * 0.095, g.nw, Math.max(1, h * 0.015));
    paintCap(c, g, w, h, G.cap);
  }

  function paintCrate(c, w, h, count, seed) {
    const rnd = seeded(seed);
    // necks peeking out
    for (let i = 0; i < 4; i++) {
      const x = -w / 2 + (w / 4) * (i + 0.5);
      c.fillStyle = hGrad(c, x - w * 0.05, x + w * 0.05, ['#2b1405', '#7a420f', '#c47a26', '#e2a04a', '#7a420f', '#2b1405']);
      c.fillRect(x - w * 0.045, -h / 2 - h * 0.32, w * 0.09, h * 0.36);
      c.fillStyle = hGrad(c, x - w * 0.05, x + w * 0.05, ['#4f3a14', '#9c7a36', '#e9cd88', '#fbe9b8', '#a8843d', '#4a3511']);
      c.fillRect(x - w * 0.05, -h / 2 - h * 0.36, w * 0.1, h * 0.09);
    }
    const planks = 3;
    for (let i = 0; i < planks; i++) {
      const py = -h / 2 + (h / planks) * i;
      const tone = 0.85 + rnd() * 0.3;
      c.fillStyle = `rgb(${Math.round(150 * tone)},${Math.round(108 * tone)},${Math.round(64 * tone)})`;
      c.fillRect(-w / 2, py, w, h / planks - 1);
      c.strokeStyle = 'rgba(70,40,15,0.25)';
      c.lineWidth = 0.7;
      for (let k = 0; k < 4; k++) {
        const gy = py + 2 + rnd() * (h / planks - 4);
        c.beginPath(); c.moveTo(-w / 2, gy); c.quadraticCurveTo(0, gy + (rnd() - 0.5) * 3, w / 2, gy); c.stroke();
      }
    }
    c.strokeStyle = 'rgba(50,28,10,0.6)';
    c.lineWidth = 1.2;
    c.strokeRect(-w / 2, -h / 2, w, h);
    if (w > 40) {
      c.fillStyle = 'rgba(40,22,8,0.75)';
      c.font = `800 ${h * 0.34}px Georgia, serif`;
      c.textAlign = 'center';
      c.textBaseline = 'middle';
      c.fillText(String(count), 0, 1);
    }
  }

  // Pre-rendered sprite cache: each variant is painted once at its exact on-screen size.
  const Sprites = (() => {
    let cache = new Map();
    const PAD = 6;
    function key(...a) { return a.join('|'); }
    function make(w, h, dpr, paint) {
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((w + PAD * 2) * dpr);
      cv.height = Math.ceil((h + PAD * 2) * dpr * 1.12);
      const c = cv.getContext('2d');
      c.setTransform(dpr, 0, 0, dpr, cv.width / 2, cv.height / 2);
      paint(c);
      return cv;
    }
    function shadow(w, h, dpr, pathFn, blur) {
      const m = blur * 2 + PAD;
      const cv = document.createElement('canvas');
      cv.width = Math.ceil((w + m * 2) * dpr);
      cv.height = Math.ceil((h + m * 2) * dpr);
      const c = cv.getContext('2d');
      const OFF = 4000;
      c.setTransform(dpr, 0, 0, dpr, cv.width / 2 - OFF * dpr, cv.height / 2);
      c.shadowColor = 'rgba(30,16,4,0.55)';
      c.shadowBlur = blur * dpr;
      c.shadowOffsetX = OFF * dpr;
      c.fillStyle = '#000';
      pathFn(c);
      return cv;
    }
    return {
      clear() { cache = new Map(); },
      bottle(shape, gi, w, h, dpr, seed) {
        const k = key('b', shape, gi, Math.round(w), Math.round(h), dpr, seed % 3);
        if (!cache.has(k)) cache.set(k, make(w, h, dpr, c => paintBottle(c, w, h, shape, gi, seed % 3 + gi * 11)));
        return cache.get(k);
      },
      crate(w, h, dpr, count) {
        const k = key('c', Math.round(w), Math.round(h), dpr, count);
        if (!cache.has(k)) cache.set(k, make(w, h, dpr, c => paintCrate(c, w, h, count, 5)));
        return cache.get(k);
      },
      photo(w, h, dpr) {
        const k = key('p', Math.round(w), Math.round(h), dpr);
        if (!cache.has(k)) cache.set(k, make(w, h, dpr, c => { c.imageSmoothingQuality = 'high'; c.drawImage(PHOTO, -w / 2, -h / 2, w, h); }));
        return cache.get(k);
      },
      shadow(kind, shape, w, h, dpr) {
        const k = key('s', kind, shape, Math.round(w), Math.round(h), dpr);
        if (!cache.has(k)) {
          const blur = Math.max(4, w * 0.25);
          cache.set(k, shadow(w, h, dpr, c => {
            if (kind === 'photo') c.drawImage(PHOTO, -w / 2, -h / 2, w, h);
            else { if (kind === 'case') roundRect(c, -w / 2, -h / 2, w, h, 3); else bottlePath(c, w, h, BOTTLE_SHAPES[shape]); c.fill(); }
          }, blur));
        }
        return cache.get(k);
      },
    };
  })();

  function drawSprite(c, cv, dpr) {
    c.drawImage(cv, -cv.width / dpr / 2, -cv.height / dpr / 2, cv.width / dpr, cv.height / dpr);
  }

  // A single bottle for the info sheet
  function drawBottle(c, w, h, shape, gi) {
    if (photoReady()) {
      const pw = h * PHOTO_RATIO;
      c.drawImage(PHOTO, -pw / 2, -h / 2, pw, h);
    } else paintBottle(c, w, h, shape, gi, 1);
  }

  // Sunlit plaster wall and a rough stone ledge.
  // Sunlit plaster wall (screen space, stays put while the camera moves).
  function drawWall(c, W, H, fy) {
    const rnd = seeded(1234);
    let g = c.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#d8c6a4');
    g.addColorStop(0.5, '#bba582');
    g.addColorStop(1, '#857052');
    c.fillStyle = '#b39d7a';
    c.fillRect(0, 0, W, H);
    c.fillStyle = g;
    c.fillRect(0, 0, W, H);
    // mottled plaster
    for (let i = 0; i < 70; i++) {
      const x = rnd() * W, y = rnd() * fy, r = W * (0.04 + rnd() * 0.22);
      const light = rnd() < 0.5;
      const rg = c.createRadialGradient(x, y, 0, x, y, r);
      rg.addColorStop(0, light ? `rgba(250,238,210,${0.05 + rnd() * 0.08})` : `rgba(95,75,48,${0.04 + rnd() * 0.08})`);
      rg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = rg;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // warm glow from the window, upper left
    let rg = c.createRadialGradient(W * 0.12, H * 0.12, 0, W * 0.12, H * 0.12, W * 1.1);
    rg.addColorStop(0, 'rgba(255,228,170,0.45)');
    rg.addColorStop(1, 'rgba(255,228,170,0)');
    c.fillStyle = rg;
    c.fillRect(0, 0, W, H);
    // diagonal shafts of sunlight with window-frame shadows between them
    const ang = 0.62;
    [[-0.1, 0.16], [0.16, 0.1], [0.36, 0.13], [0.62, 0.08]].forEach(([off, bw]) => {
      c.save();
      c.translate(W * off, 0);
      c.rotate(-ang);
      const width = W * bw;
      const lg = c.createLinearGradient(-width / 2, 0, width / 2, 0);
      lg.addColorStop(0, 'rgba(255,236,190,0)');
      lg.addColorStop(0.25, 'rgba(255,236,190,0.26)');
      lg.addColorStop(0.75, 'rgba(255,236,190,0.26)');
      lg.addColorStop(1, 'rgba(255,236,190,0)');
      c.fillStyle = lg;
      c.fillRect(-width / 2, -H, width, H * 3);
      c.restore();
    });
    // deeper shade toward the right
    g = c.createLinearGradient(0, 0, W, 0);
    g.addColorStop(0, 'rgba(40,25,10,0)');
    g.addColorStop(0.6, 'rgba(40,25,10,0.08)');
    g.addColorStop(1, 'rgba(40,25,10,0.38)');
    c.fillStyle = g;
    c.fillRect(0, 0, W, fy);

    // fine film grain
    try {
      const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
    } catch (e) { /* ignore */ }
  }

  // Rough stone ledge as a strip that tiles sideways; top edge at y = 0.
  function drawLedge(c, W, H) {
    const rnd = seeded(77);
    let g;
    // stone ledge: top surface, then the rough front face
    const top = 0, lip = Math.max(16, H * 0.3);
    c.beginPath();
    c.moveTo(0, top);
    for (let x = 0; x <= W; x += 6) c.lineTo(x, top + (rnd() - 0.5) * 2);
    c.lineTo(W, H); c.lineTo(0, H); c.closePath();
    g = c.createLinearGradient(0, 0, 0, lip);
    g.addColorStop(0, '#a69479');
    g.addColorStop(1, '#85745b');
    c.fillStyle = g;
    c.fill();
    // front face, darker, with a chipped upper edge
    c.beginPath();
    c.moveTo(0, top + lip);
    for (let x = 0; x <= W; x += 5) c.lineTo(x, top + lip + (rnd() - 0.5) * 4 + (rnd() < 0.06 ? rnd() * 6 : 0));
    c.lineTo(W, H); c.lineTo(0, H); c.closePath();
    g = c.createLinearGradient(0, top + lip, 0, H);
    g.addColorStop(0, '#5d503e');
    g.addColorStop(1, '#2e261d');
    c.fillStyle = g;
    c.fill();
    // pits and flecks
    for (let i = 0; i < W * 2.2; i++) {
      const x = rnd() * W, y = top + 2 + rnd() * (H - top);
      const onTop = y < top + lip;
      c.fillStyle = rnd() < 0.55 ? `rgba(30,20,10,${(onTop ? 0.1 : 0.18) + rnd() * 0.22})` : `rgba(230,215,185,${0.06 + rnd() * (onTop ? 0.2 : 0.1)})`;
      c.beginPath();
      c.ellipse(x, y, 0.4 + rnd() * 1.3, 0.3 + rnd() * 0.8, rnd() * 3, 0, Math.PI * 2);
      c.fill();
    }
    // soft weathering blotches on the stone
    for (let i = 0; i < 18; i++) {
      const x = rnd() * W, y = top + rnd() * (H - top), r = W * (0.04 + rnd() * 0.1);
      const bg = c.createRadialGradient(x, y, 0, x, y, r);
      bg.addColorStop(0, rnd() < 0.5 ? 'rgba(20,12,4,0.18)' : 'rgba(220,200,165,0.12)');
      bg.addColorStop(1, 'rgba(0,0,0,0)');
      c.fillStyle = bg;
      c.fillRect(x - r, y - r, r * 2, r * 2);
    }
    // highlight on the ledge lip
    c.fillStyle = 'rgba(255,240,205,0.25)';
    c.fillRect(0, top, W, 1.5);

    try {
      const img = c.getImageData(0, 0, c.canvas.width, c.canvas.height);
      const d = img.data;
      for (let i = 0; i < d.length; i += 4) {
        const n = (Math.random() - 0.5) * 16;
        d[i] += n; d[i + 1] += n; d[i + 2] += n;
      }
      c.putImageData(img, 0, 0);
    } catch (e) { /* ignore */ }
  }

  function drawVignette(c, W, H) {
    const rg = c.createRadialGradient(W * 0.45, H * 0.45, Math.min(W, H) * 0.35, W * 0.5, H * 0.5, Math.max(W, H) * 0.8);
    rg.addColorStop(0, 'rgba(20,12,4,0)');
    rg.addColorStop(1, 'rgba(20,12,4,0.42)');
    c.fillStyle = rg;
    c.fillRect(0, 0, W, H);
  }

  // Container photos for the liquid view, loaded the first time they're needed.
  const ART = new Map();
  function artImage(art, onload) {
    if (!ART.has(art.src)) {
      const im = new Image();
      im.onload = onload;
      im.src = art.src;
      ART.set(art.src, im);
    }
    const im = ART.get(art.src);
    return im.complete && im.naturalWidth ? im : null;
  }

  // One container at (x, y, w, h), holding `frac` of its volume.
  function drawContainer(c, img, art, x, y, w, h, frac) {
    // a tiny amount still shows as a visible film
    const shown = frac > 0 ? Math.max(frac, 0.025) : 0;
    const lvl = y + h * (art.bottom - (art.bottom - art.top) * shown);
    if (art.quad) {
      const d = Math.min(1, shown), q = art.quad;
      const P = ([px, py]) => [x + px * w, y + py * h];
      const surf = q.floor.map((f, i) => { const r = q.rim[i]; return P([f[0] + (r[0] - f[0]) * d, f[1] + (r[1] - f[1]) * d]); });
      c.drawImage(img, x, y, w, h);
      c.save();
      c.beginPath();
      q.rim.map(P).forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, px, py));
      c.closePath();
      c.clip();
      const g = c.createLinearGradient(0, surf[0][1], 0, surf[2][1]);
      g.addColorStop(0, '#7a3c0a'); g.addColorStop(0.55, '#b8691c'); g.addColorStop(1, '#d99036');
      c.globalAlpha = 0.55 + 0.4 * Math.min(1, d * 8);
      c.fillStyle = g;
      c.beginPath();
      surf.forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, px, py));
      c.closePath();
      c.fill();
      c.globalAlpha = 0.5;
      c.strokeStyle = 'rgba(255,220,150,0.7)';
      c.lineWidth = Math.max(1, w * 0.003);
      c.stroke();
      c.restore();
    } else if (art.basin) {
      const b = art.basin, d = Math.min(1, shown);
      const cx = x + b.cx * w, rx = b.rx * w, ry = b.ry * h;
      const sy = y + (b.cy + b.depth * (1 - d)) * h;
      const k = 0.93 + 0.07 * d;
      c.drawImage(img, x, y, w, h);
      c.save();
      c.beginPath();
      c.ellipse(cx, y + b.cy * h, rx, ry, 0, 0, Math.PI * 2);
      c.clip();
      const g = c.createRadialGradient(cx, sy, 0, cx, sy, rx * k);
      g.addColorStop(0, '#d18a30'); g.addColorStop(0.7, '#a55a16'); g.addColorStop(1, '#6e3608');
      // a thin layer is see-through; it gets richer as it deepens
      c.globalAlpha = 0.55 + 0.4 * Math.min(1, d * 8);
      c.fillStyle = g;
      c.beginPath();
      c.ellipse(cx, sy, rx * k, ry * k, 0, 0, Math.PI * 2);
      c.fill();
      c.globalAlpha = 0.5;
      c.strokeStyle = 'rgba(255,220,150,0.7)';
      c.lineWidth = Math.max(1, w * 0.004);
      c.stroke();
      c.restore();
    } else if (art.clear) {
      c.drawImage(img, x, y, w, h);
      c.save();
      c.beginPath();
      art.poly.forEach(([px, py], i) => (i ? c.lineTo : c.moveTo).call(c, x + px * w, y + py * h));
      c.closePath();
      c.clip();
      const g = c.createLinearGradient(x, 0, x + w, 0);
      g.addColorStop(0, '#4a2104'); g.addColorStop(0.22, '#9a5212'); g.addColorStop(0.5, '#de9535'); g.addColorStop(0.78, '#9a5212'); g.addColorStop(1, '#4a2104');
      c.globalAlpha = 0.97;
      c.fillStyle = g;
      c.fillRect(x, lvl, w, h);
      c.globalAlpha = 1;
      c.fillStyle = 'rgba(255,220,150,0.55)';
      c.beginPath();
      c.ellipse(x + w / 2, lvl, w * 0.42, Math.max(1, h * 0.025), 0, 0, Math.PI * 2);
      c.fill();
      c.restore();
      // the glass again, faintly, so its reflections sit on top of the whiskey
      c.globalAlpha = 0.22;
      c.drawImage(img, x, y, w, h);
      c.globalAlpha = 1;
    } else if (frac >= 0.999) {
      c.drawImage(img, x, y, w, h);
    } else {
      // solid container: faded above the level, full colour below, amber line at the level
      c.globalAlpha = 0.5;
      c.drawImage(img, x, y, w, h);
      c.globalAlpha = 1;
      c.save();
      c.beginPath();
      c.rect(x - 2, lvl, w + 4, y + h - lvl + 2);
      c.clip();
      c.drawImage(img, x, y, w, h);
      c.restore();
      c.fillStyle = '#e8a547';
      c.fillRect(x - w * 0.06, lvl - 1, w * 1.12, 2.5);
    }
  }

  // Lay out as many containers as the whiskey fills, last one partly full, stacked on the ledge.
  function drawContainers(c, W, H, fy, img, art, ratio) {
    const n = ratio >= 1 ? Math.ceil(ratio - 1e-9) : 1;
    const shown = Math.min(n, 1500);
    const lastFrac = ratio >= 1 ? (ratio - Math.floor(ratio + 1e-9)) || 1 : ratio;
    const aspect = img.naturalWidth / img.naturalHeight;
    const areaW = W * 0.9, areaH = fy - H * 0.38, gapK = 0.06;
    let best = { h: 0, rows: 1, cols: 1 };
    for (let rows = 1; rows <= shown; rows++) {
      const cols = Math.ceil(shown / rows);
      const h = Math.min(areaH / rows, areaW / (cols * aspect * (1 + gapK)));
      if (h > best.h) best = { h, rows, cols };
      if (areaH / rows < best.h) break;
    }
    const h = Math.min(best.h, fy - H * 0.42), w = h * aspect, gap = w * gapK;
    c.save();
    c.shadowColor = 'rgba(30,16,4,0.45)';
    c.shadowBlur = Math.max(4, w * 0.12);
    c.shadowOffsetX = Math.max(2, w * 0.08);
    c.shadowOffsetY = 2;
    let i = 0;
    for (let r = 0; r < best.rows && i < shown; r++) {
      const inRow = Math.min(best.cols, shown - i);
      const rowW = inRow * w + (inRow - 1) * gap;
      const y = fy - (r + 1) * h;
      for (let k = 0; k < inRow; k++, i++) {
        const x = W / 2 - rowW / 2 + k * (w + gap);
        drawContainer(c, img, art, x, y, w, h, i === shown - 1 ? lastFrac : 1);
      }
    }
    c.restore();
  }

  // A big glass jar on the ledge, filled to pct, for the liquid view.
  function drawJar(c, W, H, fy, pct) {
    const jh = Math.max(60, fy - H * 0.5), jw = Math.min(W * 0.5, 220, jh * 0.85);
    const x = W / 2 - jw / 2, y = fy - jh, r = jw * 0.12;
    // cast shadow
    c.save();
    c.shadowColor = 'rgba(30,16,4,0.5)';
    c.shadowBlur = 24;
    c.shadowOffsetX = LIGHT.x * 2.5;
    c.shadowOffsetY = 4;
    c.fillStyle = 'rgba(255,255,255,0.01)';
    roundRect(c, x, y, jw, jh, r);
    c.fill();
    c.restore();
    c.save();
    roundRect(c, x, y, jw, jh, r);
    c.clip();
    c.fillStyle = 'rgba(255,248,232,0.16)';
    c.fillRect(x, y, jw, jh);
    const lt = y + jh * 0.06 + (jh * 0.92) * (1 - pct);
    c.fillStyle = hGrad(c, x, x + jw, GLASSES[0].liquid);
    c.fillRect(x, lt, jw, jh);
    const cg = c.createRadialGradient(x + jw * 0.55, y + jh * 0.85, 0, x + jw * 0.55, y + jh * 0.85, jw * 0.6);
    cg.addColorStop(0, 'rgba(255,210,120,0.5)');
    cg.addColorStop(1, 'rgba(255,210,120,0)');
    c.fillStyle = cg;
    c.fillRect(x, lt, jw, jh);
    c.fillStyle = 'rgba(255,226,160,0.7)';
    c.beginPath(); c.ellipse(W / 2, lt, jw / 2, jw * 0.05, 0, 0, Math.PI * 2); c.fill();
    // glass thickness, speculars
    roundRect(c, x, y, jw, jh, r);
    c.lineWidth = jw * 0.06;
    c.strokeStyle = 'rgba(60,35,10,0.35)';
    c.stroke();
    const sg = c.createLinearGradient(x + jw * 0.08, 0, x + jw * 0.2, 0);
    sg.addColorStop(0, 'rgba(255,255,255,0)');
    sg.addColorStop(0.5, 'rgba(255,255,250,0.75)');
    sg.addColorStop(1, 'rgba(255,255,255,0)');
    c.fillStyle = sg;
    c.fillRect(x + jw * 0.08, y + jh * 0.08, jw * 0.12, jh * 0.84);
    c.fillStyle = 'rgba(255,255,250,0.3)';
    c.fillRect(x + jw * 0.84, y + jh * 0.12, jw * 0.03, jh * 0.7);
    c.restore();
    roundRect(c, x, y, jw, jh, r);
    c.lineWidth = 1.2;
    c.strokeStyle = 'rgba(45,25,8,0.5)';
    c.stroke();
    // rim
    c.strokeStyle = 'rgba(255,248,230,0.6)';
    c.lineWidth = 1.5;
    c.beginPath(); c.ellipse(W / 2, y + 2, jw / 2 - 2, jw * 0.045, 0, 0, Math.PI * 2); c.stroke();
  }

  /* =========================================================
     The pile (Matter.js physics)
     Bottles keep one size. As the pile grows the world grows
     with it; the camera follows the top of the pile, and the
     viewer can zoom out to see all of it.
     ========================================================= */
  const Pile = (() => {
    const M = window.Matter;
    const BASE_W = 38, BASE_H = 100, MAX_LOOSE = 300, CASE_SIZE = 12, FLOOR = 0.8, SCALE = 1.25;
    let engine, runner, canvas, ctx, mouse, W = 0, H = 0, floorY = 0, dpr = 1, walls = [], items = [], gen = 0;
    let running = false, lastClink = 0, scale = SCALE, built = false, down = null, view = 'bottles', liquid = null, liquidCv = null, liquidKey = '';
    let wallCv = null, ledgeCv = null, vigCv = null;
    // world size and camera
    let worldW = 0, worldFloor = 0, mound = 0, shrink = 0, zMin = 1, zoom = 1, zoomTarget = 1, snap = true;
    const cam = { x: 0, y: 0 }, peak = { x: 0, y: 0 };
    let pinch = null;

    const dist = t => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY);

    function init(c) {
      canvas = c;
      ctx = canvas.getContext('2d');
      engine = M.Engine.create({ enableSleeping: true });
      engine.gravity.y = 1.1;
      runner = M.Runner.create();
      mouse = M.Mouse.create(canvas);
      ['mousewheel', 'DOMMouseScroll', 'wheel'].forEach(ev => canvas.removeEventListener(ev, mouse.mousewheel));
      const mc = M.MouseConstraint.create(engine, { mouse, constraint: { stiffness: 0.15, damping: 0.1, render: { visible: false } } });
      M.Composite.add(engine.world, mc);
      M.Events.on(engine, 'collisionStart', onCollide);

      canvas.addEventListener('pointerdown', e => { down = { x: e.clientX, y: e.clientY, t: Date.now() }; });
      canvas.addEventListener('pointerup', e => {
        if (!down || view !== 'bottles' || pinch) { down = null; return; }
        const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
        if (moved < 8 && Date.now() - down.t < 400) {
          const r = canvas.getBoundingClientRect();
          const pt = { x: (e.clientX - r.left) / zoom + cam.x, y: (e.clientY - r.top) / zoom + cam.y };
          const hits = M.Query.point(items.map(i => i.body), pt);
          if (hits.length) {
            const it = items.find(i => i.body === hits[hits.length - 1]);
            if (it) onTapItem(it);
          }
        }
        down = null;
      });
      // two-finger pinch zooms between close-up and the whole pile
      canvas.addEventListener('touchstart', e => { if (e.touches.length === 2) pinch = { d: dist(e.touches), z: zoomTarget }; }, { passive: true });
      canvas.addEventListener('touchmove', e => {
        if (pinch && e.touches.length === 2) { zoomTarget = clamp(pinch.z * dist(e.touches) / pinch.d, zMin, 1); updateZoomBtn(); }
      }, { passive: true });
      canvas.addEventListener('touchend', e => { if (e.touches.length < 2) setTimeout(() => { pinch = null; }, 50); }, { passive: true });
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

    function offscreen(w, h, paint) {
      const cv = document.createElement('canvas');
      cv.width = Math.max(1, Math.round(w * dpr));
      cv.height = Math.max(1, Math.round(h * dpr));
      const c = cv.getContext('2d');
      c.scale(dpr, dpr);
      paint(c);
      return cv;
    }

    function measure() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2.5);
      W = r.width; H = r.height;
      floorY = Math.round(H * FLOOR);
      canvas.width = Math.round(W * dpr);
      canvas.height = Math.round(H * dpr);
      canvas.pixelRatio = dpr;
      Sprites.clear();
      if (W > 10 && H > 10) {
        wallCv = offscreen(W, H, c => drawWall(c, W, H, floorY));
        ledgeCv = offscreen(W, H - floorY, c => drawLedge(c, W, H - floorY));
        vigCv = offscreen(W, H, c => drawVignette(c, W, H));
      }
    }

    function makeWalls() {
      M.Composite.remove(engine.world, walls);
      const t = 400, tall = worldFloor * 6 + H * 4, opts = { isStatic: true, friction: 0.9, restitution: 0.1 };
      walls = [
        M.Bodies.rectangle(worldW / 2, worldFloor + t / 2, worldW * 3, t, opts),
        M.Bodies.rectangle(-t / 2, worldFloor - tall / 2, t, tall, opts),
        M.Bodies.rectangle(worldW + t / 2, worldFloor - tall / 2, t, tall, opts),
      ];
      M.Composite.add(engine.world, walls);
    }

    function unitLook(u) {
      const isCase = u.kind === 'case';
      const day = u.days[u.days.length - 1];
      const hash = Math.imul(day.day + 7, 2654435761) >>> 0;
      let shape = SHAPE_KEYS[hash % SHAPE_KEYS.length];
      const roll = (hash >>> 5) % 10;
      const gi = roll < 7 ? roll % 3 : roll === 7 || roll === 8 ? 3 : 4;
      if (gi === 3 && shape === 'square') shape = 'tall';
      const kind = isCase ? 'case' : photoReady() ? 'photo' : 'bottle';
      const [dw, dh] = isCase ? [3.4, 0.62] : kind === 'photo' ? [(1.05 * BASE_H * PHOTO_RATIO) / BASE_W, 1.05] : BOTTLE_SHAPES[shape].dims;
      return { kind, shape, gi, hash, w: BASE_W * dw * scale, h: BASE_H * dh * scale };
    }

    // list: [{ date, day, n, covers, isNew }] oldest first
    function build(list, { animateAll = true } = {}) {
      gen++;
      const myGen = gen;
      measure();
      if (W < 10 || H < 10) return;
      M.Composite.remove(engine.world, items.map(i => i.body));
      items = [];

      // pack the oldest bottles into crates of 12 once the pile is huge
      const units = [];
      if (list.length > MAX_LOOSE) {
        const caseable = list.length - (CASE_SIZE + (list.length % CASE_SIZE));
        for (let i = 0; i < caseable; i += CASE_SIZE) units.push({ kind: 'case', days: list.slice(i, i + CASE_SIZE) });
        list.slice(caseable).forEach(d => units.push({ kind: 'bottle', days: [d] }));
      } else {
        list.forEach(d => units.push({ kind: 'bottle', days: [d] }));
      }
      units.forEach(u => { u.look = unitLook(u); });

      // size the world so the pile fits as a mound: lying bottles, rows narrowing by SLOPE bottle-lengths
      const bl = unitLook({ kind: 'bottle', days: [{ day: 1 }] });
      const area = units.reduce((a, u) => a + (u.kind === 'case' ? u.look.w * u.look.h : bl.w * bl.h) * 1.15, 0);
      // the close-up shows a small pile whole; the world only grows once the pile outgrows the view
      const grow = Math.sqrt(area / (W * floorY * 0.25));
      worldW = grow > 1.3 ? W * grow : W;
      mound = worldW * 0.92;
      // how much narrower each row is than the one below, so the rows hold every bottle
      shrink = clamp((mound * mound * bl.w) / (2 * area), bl.h * 0.3, bl.h * 2.5);
      const k = worldW / W;
      worldFloor = floorY * k;
      zMin = 1 / k;
      zoom = zoomTarget = 1;
      snap = true;
      makeWalls();

      const fresh = units.filter(u => u.days.some(d => d.isNew));
      const old = units.filter(u => !u.days.some(d => d.isNew));
      // a small pile drops in on first open; a big one is laid down and only the top few fall
      const dropOld = animateAll ? (old.length <= 30 ? old.length : 10) : 0;
      const placed = old.slice(0, old.length - dropOld);
      const falling = old.slice(old.length - dropOld);
      placeMound(placed);
      if (!placed.length) { peak.x = worldW / 2; peak.y = worldFloor; }

      const stagger = falling.length ? clamp(1600 / falling.length, 30, 110) : 0;
      falling.forEach((u, i) => setTimeout(() => myGen === gen && drop(u, false), 150 + i * stagger));
      const freshStart = falling.length ? 150 + falling.length * stagger + 600 : 500;
      fresh.forEach((u, i) => setTimeout(() => {
        if (myGen !== gen) return;
        drop(u, true);
        if (navigator.vibrate) navigator.vibrate(18);
        const d = u.days[u.days.length - 1];
        toast(`Bottle ${d.n} just landed on the pile`);
      }, freshStart + i * 650));
      built = true;
      updateZoomBtn();
    }

    // lay bottles on their sides in rows, crates at the bottom, narrowing toward the top
    function placeMound(units) {
      if (!units.length) return;
      const sorted = units.filter(u => u.kind === 'case').concat(units.filter(u => u.kind !== 'case'));
      const rnd = seeded(sorted.length * 31 + 7);
      const step = sorted.find(u => u.kind !== 'case')?.look.h || sorted[0].look.w;
      const base = mound;
      let row = 0, used = 0, rowH = 0, y = worldFloor, rowW = base;
      let rowItems = [];
      const flush = () => {
        // centre each row on the pile
        const shift = (rowW - used) / 2;
        rowItems.forEach(p => add(p.u, { x: p.x + shift, y: y - rowH / 2, angle: p.angle }));
        y -= rowH * 0.97;
        row++;
        rowW = Math.max(step * 1.05, base - row * shrink);
        used = 0; rowH = 0; rowItems = [];
      };
      for (const u of sorted) {
        const lying = u.kind !== 'case';
        const fw = (lying ? u.look.h : u.look.w) * 1.04, fh = lying ? u.look.w : u.look.h;
        if (used > 0 && used + fw > rowW) flush();
        rowItems.push({ u, x: worldW / 2 - rowW / 2 + used + fw / 2, angle: lying ? (rnd() < 0.5 ? 1 : -1) * Math.PI / 2 + (rnd() - 0.5) * 0.2 : (rnd() - 0.5) * 0.06 });
        used += fw;
        rowH = Math.max(rowH, fh);
      }
      if (rowItems.length) flush();
      const top = items.reduce((m, it) => (it.body.bounds.min.y < m.body.bounds.min.y ? it : m), items[0]);
      peak.x = top.body.position.x;
      peak.y = top.body.bounds.min.y;
    }

    // create a body; `at` places it (geometric centre), otherwise it falls in from the top of the view
    function add(u, at, isFresh) {
      const { kind, shape, gi, hash, w, h } = u.look;
      let x, y, angle;
      if (at) ({ x, y, angle } = at);
      else {
        const Vw = W / zoom;
        const spread = (Math.random() + Math.random() + Math.random() - 1.5) / 1.5;
        x = clamp(peak.x + spread * Math.min(Vw, mound || W) * 0.32, w / 2 + 6, worldW - w / 2 - 6);
        y = cam.y - h - Math.random() * 60;
        angle = (Math.random() - 0.5) * (kind === 'case' ? 0.4 : 1.6);
      }
      const opts = { restitution: 0.15, friction: 0.6, frictionStatic: 0.9, frictionAir: 0.004, density: kind === 'case' ? 0.004 : 0.002 };
      let body, off = { x: 0, y: 0 };
      if (kind === 'photo') {
        // compound outline that follows the photo: square body, shoulders, neck
        body = M.Body.create({
          ...opts,
          parts: [
            M.Bodies.rectangle(x, y + h * 0.17, w * 0.97, h * 0.66, { chamfer: { radius: w * 0.1 } }),
            M.Bodies.rectangle(x, y - h * 0.16, w * 0.62, h * 0.07),
            M.Bodies.rectangle(x, y - h * 0.34, w * 0.42, h * 0.3, { chamfer: { radius: w * 0.06 } }),
          ],
        });
        off = { x: x - body.position.x, y: y - body.position.y };
      } else {
        body = M.Bodies.rectangle(x, y, w, h, { ...opts, chamfer: { radius: kind === 'case' ? 3 : [w * 0.3, w * 0.3, w * 0.12, w * 0.12] } });
      }
      M.Body.setAngle(body, angle);
      // keep the picture's centre where we asked for it after rotating around the centre of mass
      const ca = Math.cos(angle), sa = Math.sin(angle);
      M.Body.setPosition(body, { x: x - (off.x * ca - off.y * sa), y: y - (off.x * sa + off.y * ca) });
      if (at) M.Sleeping.set(body, false);
      else {
        M.Body.setVelocity(body, { x: (Math.random() - 0.5) * 2, y: isFresh ? 4 : 2 });
        M.Body.setAngularVelocity(body, (Math.random() - 0.5) * 0.15);
      }
      items.push({ body, w, h, kind, off, days: u.days, shape, gi, seed: hash, glowUntil: isFresh ? performance.now() + 4000 : 0 });
      M.Composite.add(engine.world, body);
    }

    function drop(u, isFresh) { add(u, null, isFresh); }

    function updateCamera() {
      const k = snap ? 1 : 0.12;
      zoom += (zoomTarget - zoom) * k;
      if (Math.abs(zoomTarget - zoom) < 0.001) zoom = zoomTarget;
      // track the top of the settled pile
      let best = null;
      for (const it of items) {
        const b = it.body;
        if (b.speed > 2.5) continue;
        if (!best || b.bounds.min.y < best.bounds.min.y) best = b;
      }
      if (best) {
        const f = snap ? 1 : 0.06;
        peak.x += (best.position.x - peak.x) * f;
        peak.y += (best.bounds.min.y - peak.y) * f;
      }
      const Vw = W / zoom, Vh = H / zoom;
      const t = zMin < 0.999 ? clamp((1 - zoom) / (1 - zMin), 0, 1) : 0;
      // close-up: the top of the pile sits about a third of the way down; zoomed out: the whole pile
      const fx = peak.x, fyc = peak.y + Vh * 0.12;
      const wx = worldW / 2, wyc = worldFloor - FLOOR * Vh + Vh / 2;
      const cx = fx + (wx - fx) * t, cy = fyc + (wyc - fyc) * t;
      let x = cx - Vw / 2, y = cy - Vh / 2;
      x = Vw >= worldW ? (worldW - Vw) / 2 : clamp(x, 0, worldW - Vw);
      y = Math.min(y, worldFloor - FLOOR * Vh);
      const m = snap ? 1 : 0.1;
      cam.x += (x - cam.x) * m;
      cam.y += (y - cam.y) * m;
      snap = false;
      mouse.scale.x = mouse.scale.y = 1 / zoom;
      mouse.offset.x = cam.x;
      mouse.offset.y = cam.y;
    }

    function drawLedgeAt(y, z, offX) {
      if (!ledgeCv) return;
      if (y > H) return;
      // tile sideways with the zoom; stretch down to the bottom so there's never a gap under the ledge
      const tw = W * z, th = Math.max((H - floorY) * z, H - y);
      let x0 = -(((offX % tw) + tw) % tw);
      for (let x = x0; x < W; x += tw) ctx.drawImage(ledgeCv, x, y, tw + 0.5, th);
    }

    function frame() {
      if (!running) return;
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      if (wallCv) ctx.drawImage(wallCv, 0, 0);
      else ctx.clearRect(0, 0, canvas.width, canvas.height);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (view === 'liquid') {
        drawLedgeAt(floorY, 1, 0);
        drawLiquid();
        if (vigCv) ctx.drawImage(vigCv, 0, 0, W, H);
        requestAnimationFrame(frame);
        return;
      }
      updateCamera();
      drawLedgeAt((worldFloor - cam.y) * zoom, zoom, cam.x * zoom);

      ctx.setTransform(dpr * zoom, 0, 0, dpr * zoom, -cam.x * zoom * dpr, -cam.y * zoom * dpr);
      const Vw = W / zoom, Vh = H / zoom, pad = 120;
      const visible = b => b.bounds.max.x > cam.x - pad && b.bounds.min.x < cam.x + Vw + pad && b.bounds.max.y > cam.y - pad && b.bounds.min.y < cam.y + Vh + pad;
      // contact shadow under the heap
      if (items.length) {
        const rw = Math.max(mound, W * 0.84) * 0.55;
        const rg = ctx.createRadialGradient(worldW / 2, worldFloor, 0, worldW / 2, worldFloor, rw);
        rg.addColorStop(0, 'rgba(25,14,4,0.45)');
        rg.addColorStop(1, 'rgba(25,14,4,0)');
        ctx.save();
        ctx.translate(0, worldFloor);
        ctx.scale(1, 0.12);
        ctx.translate(0, -worldFloor);
        ctx.fillStyle = rg;
        ctx.fillRect(worldW / 2 - rw, worldFloor - rw, rw * 2, rw * 2);
        ctx.restore();
      }
      const now = performance.now();
      // shadow pass: one consistent light direction, whatever the bottle's rotation
      for (const it of items) {
        const b = it.body;
        if (!visible(b)) continue;
        const lift = clamp((worldFloor - b.position.y) / (H * 1.5), 0, 1);
        ctx.save();
        ctx.globalAlpha = 1 - lift * 0.5;
        ctx.translate(b.position.x + LIGHT.x * scale, b.position.y + LIGHT.y * scale);
        ctx.rotate(b.angle);
        ctx.translate(it.off.x, it.off.y);
        drawSprite(ctx, Sprites.shadow(it.kind, it.shape, it.w, it.h, dpr), dpr);
        ctx.restore();
      }
      for (const it of items) {
        const b = it.body;
        if (!visible(b)) continue;
        ctx.save();
        ctx.translate(b.position.x, b.position.y);
        ctx.rotate(b.angle);
        ctx.translate(it.off.x, it.off.y);
        const sp = it.kind === 'case' ? Sprites.crate(it.w, it.h, dpr, it.days.length)
          : it.kind === 'photo' ? Sprites.photo(it.w, it.h, dpr)
          : Sprites.bottle(it.shape, it.gi, it.w, it.h, dpr, it.seed);
        if (it.glowUntil > now) {
          ctx.shadowColor = `rgba(255,214,140,${(it.glowUntil - now) / 4000})`;
          ctx.shadowBlur = 26;
        }
        drawSprite(ctx, sp, dpr);
        ctx.restore();
      }
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      if (vigCv) ctx.drawImage(vigCv, 0, 0, W, H);
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
    function setView(v, spec = null) { view = v; liquid = spec; updateZoomBtn(); }

    // the liquid scene is static, so it's rendered once per selection and reused every frame
    function drawLiquid() {
      if (!liquid) return;
      const { pick, ratio } = liquid;
      const img = pick.art ? artImage(pick.art, () => { liquidKey = ''; }) : null;
      const key = [pick.id, ratio.toFixed(4), W, H, dpr, !!img].join('|');
      if (key !== liquidKey) {
        liquidCv = offscreen(W, H, c => {
          if (img) drawContainers(c, W, H, floorY, img, pick.art, ratio);
          else drawJar(c, W, H, floorY, Math.min(1, ratio));
        });
        liquidKey = key;
      }
      ctx.drawImage(liquidCv, 0, 0, W, H);
    }
    function toggleZoom() { zoomTarget = zoomTarget < 0.999 ? 1 : zMin; updateZoomBtn(); }
    const zoomInfo = () => ({ canZoom: zMin < 0.95 && view === 'bottles', out: zoomTarget < 0.999 });
    const size = () => ({ W, H });
    return { init, build, start, stop, size, setView, toggleZoom, zoomInfo, isBuilt: () => built };
  })();

  function updateZoomBtn() {
    const btn = document.getElementById('zoomBtn');
    if (!btn || typeof Pile === 'undefined') return;
    const z = Pile.zoomInfo();
    btn.hidden = !z.canZoom;
    btn.querySelector('span').textContent = z.out ? 'Back to the top' : 'See the whole pile';
    btn.classList.toggle('out', z.out);
  }

  /* =========================================================
     Today screen
     ========================================================= */
  let pileView = 'bottles';
  let currentTab = 'today';
  let pileDirty = false;

  function pileList(c) {
    const startNew = Math.min(state.seenBottles, c.bottles);
    return c.bottleList.map((b, i) => ({ date: b.date, covers: b.covers, n: i + 1, day: daysBetween(state.settings.startDate, b.date) + 1, isNew: i >= startNew }));
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
    $('#subline').textContent = c.streak === 0 ? 'Day one starts now.' : 'One day at a time.';
    $('#captionMain').textContent = `${int(c.bottles)} ${plural(c.bottles, 'bottle')} you didn't drink · next one in ${c.nextBottleIn} ${plural(c.nextBottleIn, 'day')}`;
    $('#qsMoney').textContent = money(c.money);
    $('#qsVolume').textContent = volumeText(c, c.liters >= 100 ? 0 : 2);
    $('#basisText').textContent = `Based on ${s.sizeMl} mL at $${s.price} per bottle`;
    const next = MILESTONES.find(m => m > c.streak) || c.streak + 365;
    $('#msLabel').textContent = `Next milestone: ${milestoneName(next)}`;
    $('#msCount').innerHTML = `${int(c.streak)} <span class="muted">/ ${int(next)}</span>`;
    $('#msBar').style.width = `${(c.streak / next) * 100}%`;
    $('#checkinLabel').textContent = state.journal[c.today] ? 'Update today\'s check-in' : 'Check in for today';
    if (pileView === 'liquid') renderLiquid();
  }

  let liquidPick = null;   // container the viewer tapped; null = the next one to fill

  function liquidCompare(liters, l) {
    const r = liters / l.L;
    const n = r >= 100 ? int(r) : r.toFixed(1).replace(/\.0$/, '');
    if (r >= 1) return { big: `${n} ${r === 1 ? l.one : l.many}`, pct: 1 };
    const pct = r * 100;
    const p = pct < 1 ? String(Number(pct.toPrecision(2))) : pct < 10 ? pct.toFixed(1) : Math.round(pct);
    return { big: `${p}% of ${/^[aeiouAEIOU]/.test(l.one) ? 'an' : 'a'} ${l.one}`, pct: r };
  }

  function renderLiquid() {
    const c = calc();
    const auto = LIQUIDS.find(l => l.L > c.liters) || LIQUIDS[LIQUIDS.length - 1];
    const pick = LIQUIDS.find(l => l.id === liquidPick) || auto;
    const cmp = liquidCompare(c.liters, pick);
    Pile.setView('liquid', { pick, ratio: c.liters / pick.L });
    $('#liquidView').innerHTML = `
      <div class="big">${cmp.big}</div>
      <div class="sub">${volumeText(c)} of whiskey${pick.note ? ` · ${pick.note} ${pick.one}` : ''}</div>
      <div class="liquid-list" role="tablist" aria-label="Compare to">${LIQUIDS.map(l => `<button type="button" class="${l === pick ? 'on' : ''} ${c.liters >= l.L ? 'done' : ''}" data-action="liquidPick" data-id="${l.id}">${l.one}</button>`).join('')}</div>`;
    const on = $('#liquidView .liquid-list .on');
    if (on) on.scrollIntoView({ block: 'nearest', inline: 'center' });
  }

  function setPileView(v) {
    pileView = v;
    $$('.seg button').forEach(b => b.classList.toggle('on', b.dataset.view === v));
    $('#liquidView').hidden = v !== 'liquid';
    if (v === 'bottles') Pile.setView('bottles');
    renderToday();
  }

  function onTapItem(it) {
    if (it.kind === 'case') {
      const a = it.days[0], b = it.days[it.days.length - 1];
      openSheet(`<h2>A case of ${it.days.length}</h2><p class="sheet-sub">Bottles ${a.n}–${b.n}, days ${a.day}–${b.day} · ${fmtDate(a.date, { month: 'short', day: 'numeric' })} to ${fmtDate(b.date)}</p>
        <div class="list">${it.days.flatMap(d => d.covers).filter(x => state.journal[x]?.text).map(entryItem).join('') || '<div class="empty">No journal entries in this case.</div>'}</div>`);
      return;
    }
    const d = it.days[0];
    const covers = d.covers || [d.date];
    const notes = covers.filter(x => state.journal[x]);
    const drinks = Math.round(state.settings.sizeMl * state.settings.abv / 100 * 0.789 / 14);
    const range = covers.length > 1 ? `${fmtDate(covers[0], { month: 'short', day: 'numeric' })} – ${fmtDate(covers[covers.length - 1], { month: 'short', day: 'numeric' })}` : fmtDay(d.date);
    openSheet(`
      <div class="bottle-card"><canvas id="bottleMini" width="92" height="184"></canvas>
        <div><h2>Bottle ${d.n}</h2><p class="sheet-sub">Earned on day ${d.day} · ${range}</p>
        <p class="small muted" style="margin-top:6px">${money(state.settings.price)} kept · ${drinks} drinks skipped</p></div></div>
      ${notes.length ? `<div class="list">${notes.map(entryItem).join('')}</div>` : `<div class="empty">Nothing written for these days yet.</div>`}
      <button class="btn primary block" style="margin-top:12px" data-action="editEntry" data-date="${d.date}">${state.journal[d.date] ? 'Edit' : 'Write about'} day ${d.day}</button>`);
    const c = $('#bottleMini').getContext('2d');
    c.translate(46, 94);
    drawBottle(c, 52, 140, it.shape, it.gi);
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
    const opts = [7, 14, 30, 60, 90, 180, 365, 730, 1095].filter(d => d > c.soberDays);

    $('#screen-progress').innerHTML = `
      <h1 class="page-title">Progress</h1>
      <div class="card hero">
        <div class="big num">${int(c.streak)}</div>
        <div class="lbl">${plural(c.streak, 'day')} sober${c.streak !== c.span ? ' this streak' : ''}</div>
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
        <div class="stat"><div class="k">Standard drinks</div><div class="v num">${int(c.stdDrinks)}</div><div class="d">~${Math.round(c.stdDrinks / Math.max(c.soberDays, 1))} a day skipped</div></div>
        <div class="stat"><div class="k">Shots</div><div class="v num">${int((c.liters * 1000) / SHOT_ML)}</div><div class="d">1.5 oz (44 mL) each · ~${Math.round((c.liters * 1000) / SHOT_ML / Math.max(c.soberDays, 1))} a day</div></div>
        <div class="stat wide"><div class="k">Calories</div><div class="v num">${compact(c.calories)}</div><div class="d">≈ ${c.fatLb.toFixed(1)} lb of fat</div></div>
        <div class="stat wide"><div class="k">Undoing the drinking years</div><div class="v num">${(oldPct * 100).toFixed(1)}%</div>
          <div class="bar"><i style="width:${oldPct * 100}%"></i></div>
          <div class="d" style="margin-top:6px">${int(c.bottles)} of ~${int(c.oldBottles)} bottles from 3 years of drinking</div></div>
      </div>

      <div class="section-title">Saving for</div>
      ${goal ? `<div class="card"><div style="display:flex;justify-content:space-between;align-items:baseline"><b>${esc(s.goalName || 'My goal')}</b><span class="muted small num">${money(c.money)} / ${money(s.goalAmount)}</span></div>
          <div class="bar" style="height:12px"><i style="width:${goalPct * 100}%"></i></div>
          <p class="small muted" style="margin-top:8px">${goalPct >= 1 ? 'You did it. Every dollar came from bottles you didn\'t buy. 🎉' : `About ${Math.ceil((s.goalAmount - c.money) / Math.max(s.price, 1)) * c.dpb - (c.dpb - c.nextBottleIn)} more sober days to go.`}</p>
          <button class="link small" style="margin-top:8px" data-action="editGoal">Change goal</button></div>`
        : `<button class="card" style="width:100%;text-align:left" data-action="editGoal"><b>Pick something to save for</b><p class="small muted" style="margin-top:4px">A trip, a guitar, a car payment. Every bottle you don't buy goes toward it.</p></button>`}

      <div class="section-title">Milestones</div>
      <div class="badges">${MILESTONES.map(m => `<div class="badge ${c.streak >= m ? 'got' : m === nextMs ? 'next' : ''}"><b>${m % 365 === 0 ? m / 365 : m}</b><span>${m % 365 === 0 ? plural(m / 365, 'year') : plural(m, 'day')}</span></div>`).join('')}</div>

      <div class="section-title">Your body is healing</div>
      <div class="card">
        <div class="timeline">${TIMELINE.map((t, i) => `<div class="tl ${i < nowIdx ? 'done' : i === nowIdx ? 'now' : ''}"><div class="when">${t.when}${i === nowIdx ? ' · you are here' : ''}</div><h3>${t.title}</h3><p>${t.text}</p></div>`).join('')}</div>
        <p class="note">General information, not medical advice. Everyone heals differently, so check in with a doctor about your own health.</p>
      </div>`;
    if (openId) $('#' + openId).open = true;
  }

  /* =========================================================
     More screen
     ========================================================= */
  function renderMore(openId) {
    const c = calc();
    const s = state.settings;
    const letters = state.letters.slice().sort((a, b) => a.unlockDay - b.unlockDay);
    const opts = [7, 14, 30, 60, 90, 180, 365, 730, 1095].filter(d => d > c.soberDays);
    $('#screen-more').innerHTML = `
      <h1 class="page-title">More</h1>
      <details class="group" id="d-letters">
        <summary><span class="ico">✉️</span><span class="t"><b>Letters to future you</b><span>${letters.length ? `${letters.filter(l => c.soberDays >= l.unlockDay).length} opened · ${letters.filter(l => c.soberDays < l.unlockDay).length} sealed` : 'Seal one now, open it at a milestone'}</span></span></summary>
        <div class="body">
          <div class="list" style="margin-top:0">${letters.map(l => {
            const open = c.soberDays >= l.unlockDay;
            return `<button class="item letter ${open ? 'open' : ''}" data-action="openLetter" data-id="${l.id}"><span class="env">${open ? '📬' : '🔒'}</span><span class="t"><b>${esc(l.title || 'Letter')}</b><span class="tiny faint">${open ? `Opened on day ${l.unlockDay}` : `Opens on day ${l.unlockDay} · ${l.unlockDay - c.soberDays} days to go`}</span></span></button>`;
          }).join('')}</div>
          ${opts.length ? `<div style="margin-top:12px">
            <label class="field" style="margin-top:0"><span>Title</span><input id="letterTitle" placeholder="To me, at 90 days"></label>
            <label class="field"><span>Letter</span><textarea id="letterBody" placeholder="What do you want to tell yourself when you get there?"></textarea></label>
            <label class="field"><span>Open on sober day</span><select id="letterDay">${opts.map(d => `<option value="${d}" ${d === 90 ? 'selected' : ''}>day ${d}</option>`).join('')}</select></label>
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

      <button class="menu-btn" data-action="settings"><span class="ico">⚙️</span><span class="t"><b>Settings</b><span>Start date, bottle, price, backups</span></span></button>
      <p class="note" style="text-align:center;margin-top:24px">Sober Pile · version ${APP_VERSION}</p>`;
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
    const grid = [1, 2, 3, 4, 5].map(v => `<line x1="${padL}" x2="${W - padR}" y1="${ys(v)}" y2="${ys(v)}" stroke="#e2d9ca"/><text x="${padL - 6}" y="${ys(v) + 4}" text-anchor="end" font-size="10" fill="#9a8f82">${v}</text>`).join('');
    const lbl = [0, 14, 29].map(i => `<text x="${xs(i)}" y="${H - 4}" text-anchor="${i === 0 ? 'start' : i === 29 ? 'end' : 'middle'}" font-size="10" fill="#9a8f82">${fmtDate(addDays(end, i - 29), { month: 'short', day: 'numeric' })}</text>`).join('');
    return `<svg class="chart" viewBox="0 0 ${W} ${H}" role="img" aria-label="Mood and sleep over the last 30 days">${grid}${lbl}
      <path d="${s.d}" fill="none" stroke="#b9792c" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><g fill="#b9792c">${s.pts}</g>
      <path d="${m.d}" fill="none" stroke="#5b6a3c" stroke-width="2.2" stroke-linejoin="round" stroke-linecap="round"/><g fill="#5b6a3c">${m.pts}</g></svg>
      <div class="legend"><span><i style="background:#5b6a3c"></i>Mood</span><span><i style="background:#b9792c"></i>Sleep quality</span></div>`;
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
      <button class="btn ghost block" style="margin-top:8px;color:var(--olive-dark)" data-action="pickPastDay">+ Add an entry for another day</button>`;
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
        <label class="field"><span>Days per bottle</span><input type="number" inputmode="numeric" min="1" max="30" step="1" data-setting="daysPerBottle" value="${s.daysPerBottle}"></label>
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
    if (tab === 'more') renderMore();
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
    zoomPile: () => Pile.toggleZoom(),
    liquidPick: el => { liquidPick = el.dataset.id; renderLiquid(); },
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
      save(); renderMore('d-letters'); toast('Sealed. See you there.');
    },
    openLetter: el => {
      const l = state.letters.find(x => x.id === el.dataset.id);
      const c = calc();
      if (!l) return;
      if (c.soberDays < l.unlockDay) {
        openSheet(`<h2>🔒 Still sealed</h2><p class="sheet-sub">Written ${fmtDate(l.created)}. Opens on sober day ${l.unlockDay}, ${l.unlockDay - c.soberDays} days from now.</p>
          <button class="btn ghost danger block" style="margin-top:16px" data-action="delLetter" data-id="${l.id}">Delete letter</button>`);
      } else {
        openSheet(`<h2>${esc(l.title || 'A letter from you')}</h2><p class="sheet-sub">Written on ${fmtDate(l.created)}, opened on day ${l.unlockDay}</p>
          <p style="margin-top:16px;white-space:pre-wrap;font-size:18px;line-height:1.55">${esc(l.body)}</p>
          <button class="btn ghost danger block" style="margin-top:16px" data-action="delLetter" data-id="${l.id}">Delete letter</button>`);
      }
    },
    delLetter: el => { if (!confirm('Delete this letter?')) return; state.letters = state.letters.filter(l => l.id !== el.dataset.id); save(); closeSheet(); renderMore('d-letters'); },
    addWin: () => {
      const v = $('#winText').value.trim();
      if (!v) return;
      state.wins.push({ ts: Date.now(), text: v });
      save(); renderMore('d-wins'); toast('Nice. That\'s time well spent.');
    },
    delWin: el => { state.wins.splice(Number(el.dataset.i), 1); save(); renderMore('d-wins'); },
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
    if (['price', 'abv', 'hoursPerDay', 'sizeMl', 'daysPerBottle'].includes(key)) v = parseFloat(v) || 0;
    if (key === 'startDate' && (!v || v > todayStr())) { el.value = state.settings.startDate; return; }
    state.settings[key] = typeof v === 'string' ? v.trim() : v;
    if (key === 'startDate') state.seenBottles = 0;
    if (key === 'daysPerBottle' && v < 1) { el.value = state.settings.daysPerBottle; return; }
    save();
    renderToday();
    if (key === 'daysPerBottle') state.seenBottles = 0;
    if (key === 'startDate' || key === 'sizeMl' || key === 'daysPerBottle') rebuildPile(true);
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
  let booted = false;
  function boot() {
    if (booted) return;
    booted = true;
    Pile.init($('#pileCanvas'));
    showTab('today');
  }
  if (photoReady()) boot();
  else { PHOTO.onload = boot; PHOTO.onerror = boot; setTimeout(boot, 2500); }

  if ('serviceWorker' in navigator && location.protocol !== 'file:') {
    // Check for a new version every time the app comes to the front, and reload once when it lands.
    const hadController = !!navigator.serviceWorker.controller;
    let reloading = false;
    navigator.serviceWorker.addEventListener('controllerchange', () => {
      if (!hadController || reloading) return;
      reloading = true;
      location.reload();
    });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(reg => {
      document.addEventListener('visibilitychange', () => { if (!document.hidden) reg.update().catch(() => {}); });
    }).catch(() => {});
  }
})();
