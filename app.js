'use strict';

(() => {
  // ---------------------------------------------------------------------------
  // Constants and helpers
  // ---------------------------------------------------------------------------
  const STORE_KEY = 'sigma.data.v1';
  const TIMER_KEY = 'sigma.timer.v1';
  const SYNC_KEY = 'sigma.sync.v1';
  const DATA_FILE = 'sigma-timer-data.json';
  const GITHUB_API = 'https://api.github.com';
  const RING_C = 615.75; // 2 * PI * 98

  const DEFAULT_CLASSES = [
    { id: 'stat330', name: 'Stat 330', color: '#2F6FE0' },
    { id: 'stat340', name: 'Stat 340', color: '#6E4FD8' },
    { id: 'stat344', name: 'Stat 344', color: '#C0661A' },
    { id: 'stat346', name: 'Stat 346', color: '#11806F' }
  ];
  const PALETTE = ['#2F6FE0', '#6E4FD8', '#C0661A', '#11806F', '#B4235A', '#4D7C0F', '#0E7490', '#7C2D12'];
  const BREAK_COLOR = '#3A3F48';
  const MAX_CLASSES = 8;

  const HEX = /^#[0-9a-fA-F]{6}$/;
  const ID = /^[A-Za-z0-9_-]{1,40}$/;
  const GH_OWNER = /^[A-Za-z0-9](?:[A-Za-z0-9-]{0,38})$/;
  const GH_REPO = /^[A-Za-z0-9._-]{1,100}$/;
  const GH_TOKEN = /^[A-Za-z0-9_]{20,255}$/;
  const DATE_ONLY = /^\d{4}-\d{2}-\d{2}$/;

  const $ = (sel) => document.querySelector(sel);
  const now = () => Date.now();

  function uid() {
    const bytes = new Uint8Array(8);
    crypto.getRandomValues(bytes);
    return Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join('');
  }

  function readJSON(key) {
    try {
      const raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : null;
    } catch (_) {
      return null;
    }
  }

  function writeJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
      return true;
    } catch (_) {
      return false;
    }
  }

  function clampInt(v, min, max, fallback) {
    const n = Math.round(Number(v));
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function clampNum(v, min, max, fallback) {
    const n = Number(v);
    return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback;
  }

  function cleanStr(v, max) {
    return typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, max) : '';
  }

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text !== undefined) node.textContent = text;
    return node;
  }

  // Builds a small line icon without using innerHTML.
  function svgIcon(size, paths) {
    const NS = 'http://www.w3.org/2000/svg';
    const svg = document.createElementNS(NS, 'svg');
    const attrs = {
      width: size, height: size, viewBox: '0 0 24 24', fill: 'none', stroke: 'currentColor',
      'stroke-width': 2, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', 'aria-hidden': 'true'
    };
    for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, String(v));
    for (const d of paths) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      svg.append(p);
    }
    return svg;
  }

  function setColor(node, prop, color) {
    node.style.setProperty(prop, HEX.test(color) ? color : '#5F6570');
  }

  function tint(hex, amount) {
    // Mix a color with white for a soft background.
    if (!HEX.test(hex)) return '#EEF0F3';
    const n = parseInt(hex.slice(1), 16);
    const mix = (c) => Math.round(c + (255 - c) * amount);
    const r = mix((n >> 16) & 255), g = mix((n >> 8) & 255), b = mix(n & 255);
    return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
  }

  function fmtClock(ms) {
    const total = Math.max(0, Math.ceil(ms / 1000));
    const m = Math.floor(total / 60);
    const s = total % 60;
    return `${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}`;
  }

  function fmtMin(minutes) {
    const m = Math.round(minutes);
    if (m < 60) return `${m} min`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h} h ${r} min` : `${h} h`;
  }

  function fmtShort(minutes) {
    const m = Math.round(minutes);
    if (m < 60) return `${m}m`;
    const h = Math.floor(m / 60);
    const r = m % 60;
    return r ? `${h}h ${r}m` : `${h}h`;
  }

  function dayKey(ms) {
    const d = new Date(ms);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  }

  function startOfDay(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
  }

  function startOfWeek(ms) {
    // Weeks start on Monday.
    const d = new Date(startOfDay(ms));
    const offset = (d.getDay() + 6) % 7;
    d.setDate(d.getDate() - offset);
    return d.getTime();
  }

  function addDays(ms, n) {
    const d = new Date(ms);
    d.setDate(d.getDate() + n);
    return d.getTime();
  }

  let toastTimer = null;
  function toast(message) {
    const t = $('#toast');
    t.textContent = message;
    t.hidden = false;
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => { t.hidden = true; }, 3200);
  }

  // ---------------------------------------------------------------------------
  // Data model
  // ---------------------------------------------------------------------------
  function defaultData() {
    return {
      version: 1,
      settings: {
        work: 25,
        short: 5,
        long: 20,
        cycle: 4,
        goal: 8,
        sound: true,
        keepAwake: true,
        classes: DEFAULT_CLASSES.map((c) => ({ ...c, archived: false })),
        updatedAt: 0
      },
      sessions: [],
      exams: [],
      deleted: []
    };
  }

  // Everything loaded from storage or GitHub passes through here, so bad or
  // unexpected values can never reach the screen or the styles.
  function sanitizeData(input) {
    const out = defaultData();
    if (!input || typeof input !== 'object') return out;

    const s = input.settings && typeof input.settings === 'object' ? input.settings : {};
    out.settings.work = clampInt(s.work, 1, 180, 25);
    out.settings.short = clampInt(s.short, 1, 60, 5);
    out.settings.long = clampInt(s.long, 1, 120, 20);
    out.settings.cycle = clampInt(s.cycle, 2, 12, 4);
    out.settings.goal = clampInt(s.goal, 1, 40, 8);
    out.settings.sound = s.sound !== false;
    out.settings.keepAwake = s.keepAwake !== false;
    out.settings.updatedAt = clampNum(s.updatedAt, 0, 8.64e15, 0);

    if (Array.isArray(s.classes)) {
      const seen = new Set();
      const classes = [];
      for (const c of s.classes.slice(0, 50)) {
        if (!c || typeof c !== 'object' || !ID.test(c.id) || seen.has(c.id)) continue;
        seen.add(c.id);
        classes.push({
          id: c.id,
          name: cleanStr(c.name, 24).trim() || 'Class',
          color: HEX.test(c.color) ? c.color : '#5F6570',
          archived: c.archived === true
        });
      }
      if (classes.some((c) => !c.archived)) out.settings.classes = classes;
    }

    if (Array.isArray(input.sessions)) {
      out.sessions = input.sessions
        .filter((x) => x && typeof x === 'object' && ID.test(x.id))
        .slice(-20000)
        .map((x) => ({
          id: x.id,
          type: x.type === 'exam' ? 'exam' : 'homework',
          classId: ID.test(x.classId) ? x.classId : '',
          note: cleanStr(x.note, 60),
          start: clampNum(x.start, 0, 8.64e15, 0),
          minutes: Math.round(clampNum(x.minutes, 0, 1440, 0) * 100) / 100,
          examId: ID.test(x.examId) ? x.examId : '',
          topicId: ID.test(x.topicId) ? x.topicId : '',
          updatedAt: clampNum(x.updatedAt, 0, 8.64e15, 0)
        }));
    }

    if (Array.isArray(input.exams)) {
      out.exams = input.exams
        .filter((e) => e && typeof e === 'object' && ID.test(e.id))
        .slice(0, 300)
        .map((e) => ({
          id: e.id,
          classId: ID.test(e.classId) ? e.classId : '',
          name: cleanStr(e.name, 40).trim() || 'Exam',
          date: typeof e.date === 'string' && DATE_ONLY.test(e.date) ? e.date : dayKey(now()),
          topics: Array.isArray(e.topics)
            ? e.topics
              .filter((t) => t && typeof t === 'object' && ID.test(t.id))
              .slice(0, 100)
              .map((t) => ({
                id: t.id,
                name: cleanStr(t.name, 40).trim() || 'Topic',
                reviews: Array.isArray(t.reviews)
                  ? [...new Set(t.reviews.filter((r) => typeof r === 'string' && DATE_ONLY.test(r)))].sort().slice(-400)
                  : []
              }))
            : [],
          updatedAt: clampNum(e.updatedAt, 0, 8.64e15, 0)
        }));
    }

    if (Array.isArray(input.deleted)) {
      out.deleted = input.deleted.filter((id) => typeof id === 'string' && ID.test(id)).slice(-20000);
    }
    return out;
  }

  function mergeData(local, remote) {
    if (!remote) return local;
    const out = defaultData();
    out.settings = remote.settings.updatedAt > local.settings.updatedAt ? remote.settings : local.settings;

    const deleted = new Set([...local.deleted, ...remote.deleted]);
    out.deleted = [...deleted].sort();

    const byId = new Map();
    for (const s of [...remote.sessions, ...local.sessions]) {
      if (deleted.has(s.id)) continue;
      const existing = byId.get(s.id);
      if (!existing || s.updatedAt > existing.updatedAt) byId.set(s.id, s);
    }
    out.sessions = [...byId.values()].sort((a, b) => a.start - b.start || (a.id < b.id ? -1 : 1));

    const examsById = new Map();
    for (const e of [...remote.exams, ...local.exams]) {
      if (deleted.has(e.id)) continue;
      const existing = examsById.get(e.id);
      if (!existing || e.updatedAt > existing.updatedAt) examsById.set(e.id, e);
    }
    out.exams = [...examsById.values()].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : (a.id < b.id ? -1 : 1)));
    return out;
  }

  let data = sanitizeData(readJSON(STORE_KEY));

  function saveData() {
    if (!writeJSON(STORE_KEY, data)) toast('Could not save on this phone. Storage may be full.');
    scheduleSync();
  }

  function touchSettings() {
    data.settings.updatedAt = now();
    saveData();
  }

  function activeClasses() {
    return data.settings.classes.filter((c) => !c.archived);
  }

  function classById(id) {
    return data.settings.classes.find((c) => c.id === id) || null;
  }

  // ---------------------------------------------------------------------------
  // Exams and spacing
  // ---------------------------------------------------------------------------
  // Based on Cepeda et al. (2008): the best gap between reviews was about
  // 20 to 40 percent of the time left until the test, so each review schedules
  // the next one at 30 percent of the days remaining (at least 1 day).
  const SPACING = 0.3;

  function parseDay(key) {
    const [y, m, d] = key.split('-').map(Number);
    return new Date(y, m - 1, d).getTime();
  }

  function daysBetween(a, b) {
    return Math.round((b - a) / 86400000);
  }

  function findExam(id) {
    return id ? data.exams.find((e) => e.id === id) || null : null;
  }

  function findTopic(examId, topicId) {
    const exam = findExam(examId);
    if (!exam) return null;
    const topic = exam.topics.find((t) => t.id === topicId);
    return topic ? { exam, topic } : null;
  }

  function upcomingExams() {
    const today = startOfDay(now());
    return data.exams.filter((e) => parseDay(e.date) >= today);
  }

  function pastExams() {
    const today = startOfDay(now());
    return data.exams.filter((e) => parseDay(e.date) < today).reverse();
  }

  function topicSchedule(exam, topic) {
    const today = startOfDay(now());
    const examDay = parseDay(exam.date);
    if (!topic.reviews.length) return { status: 'new', next: today, last: 0 };
    const last = parseDay(topic.reviews[topic.reviews.length - 1]);
    const gap = Math.max(1, Math.round(daysBetween(last, examDay) * SPACING));
    const next = Math.min(addDays(last, gap), examDay);
    if (last >= today) return { status: 'done', next: Math.max(next, addDays(today, 1)), last };
    return { status: next <= today ? 'due' : 'later', next, last };
  }

  // ---------------------------------------------------------------------------
  // Timer
  // ---------------------------------------------------------------------------
  // phase: 'work' | 'short' | 'long'
  // ended: the phase reached zero and is waiting for the next tap
  // done: work sessions finished in the current cycle
  function defaultTimer() {
    const ms = data.settings.work * 60000;
    return {
      phase: 'work',
      running: false,
      ended: false,
      endAt: 0,
      remaining: ms,
      planned: ms,
      done: 0,
      type: 'homework',
      classId: (activeClasses()[0] || {}).id || '',
      note: '',
      workStart: 0,
      lastId: '',
      extendId: '',
      examId: '',
      topicId: '',
      lastReview: null
    };
  }

  function loadTimer() {
    const raw = readJSON(TIMER_KEY);
    const t = defaultTimer();
    if (!raw || typeof raw !== 'object') return t;
    t.phase = ['work', 'short', 'long'].includes(raw.phase) ? raw.phase : 'work';
    t.running = raw.running === true;
    t.ended = raw.ended === true;
    t.endAt = clampNum(raw.endAt, 0, 8.64e15, 0);
    t.planned = clampNum(raw.planned, 1000, 1440 * 60000, t.planned);
    t.remaining = clampNum(raw.remaining, 0, t.planned, t.planned);
    t.done = clampInt(raw.done, 0, 100, 0);
    t.type = raw.type === 'exam' ? 'exam' : 'homework';
    t.classId = ID.test(raw.classId) && classById(raw.classId) ? raw.classId : t.classId;
    t.note = cleanStr(raw.note, 60);
    t.workStart = clampNum(raw.workStart, 0, 8.64e15, 0);
    t.lastId = ID.test(raw.lastId) ? raw.lastId : '';
    t.extendId = ID.test(raw.extendId) ? raw.extendId : '';
    t.examId = ID.test(raw.examId) ? raw.examId : '';
    t.topicId = ID.test(raw.topicId) ? raw.topicId : '';
    const lr = raw.lastReview;
    t.lastReview = lr && typeof lr === 'object' && ID.test(lr.examId) && ID.test(lr.topicId) && DATE_ONLY.test(lr.day)
      ? { examId: lr.examId, topicId: lr.topicId, day: lr.day, added: lr.added === true }
      : null;
    if (t.running && !t.endAt) t.running = false;
    return t;
  }

  let timer = loadTimer();

  function saveTimer() {
    writeJSON(TIMER_KEY, timer);
  }

  function phaseMs(phase) {
    const s = data.settings;
    return (phase === 'work' ? s.work : phase === 'short' ? s.short : s.long) * 60000;
  }

  function remainingNow() {
    return timer.running ? Math.max(0, timer.endAt - now()) : timer.remaining;
  }

  function isIdleWork() {
    return timer.phase === 'work' && !timer.running && !timer.ended && !timer.extendId && timer.remaining === timer.planned;
  }

  function startTimer() {
    if (timer.ended || timer.running) return;
    unlockAudio();
    if (timer.phase === 'work' && !timer.extendId && !timer.workStart) timer.workStart = now();
    timer.endAt = now() + timer.remaining;
    timer.running = true;
    saveTimer();
    requestWake();
    renderTimer();
  }

  function pauseTimer() {
    if (!timer.running) return;
    timer.remaining = Math.max(0, timer.endAt - now());
    timer.running = false;
    saveTimer();
    releaseWake();
    renderTimer();
  }

  function finishPhase() {
    timer.running = false;
    timer.remaining = 0;
    timer.ended = true;

    if (timer.phase === 'work') {
      const minutes = Math.round((timer.planned / 60000) * 100) / 100;
      const existing = timer.extendId ? data.sessions.find((s) => s.id === timer.extendId) : null;
      if (existing) {
        existing.minutes = Math.round((existing.minutes + minutes) * 100) / 100;
        existing.updatedAt = now();
        timer.lastId = existing.id;
      } else {
        const session = {
          id: uid(),
          type: timer.type,
          classId: timer.classId,
          note: timer.note.trim(),
          start: timer.workStart || now() - timer.planned,
          minutes,
          examId: '',
          topicId: '',
          updatedAt: now()
        };
        // An exam study session on a topic counts as a review of that topic.
        const found = timer.type === 'exam' ? findTopic(timer.examId, timer.topicId) : null;
        if (found && found.exam.classId === timer.classId) {
          session.examId = found.exam.id;
          session.topicId = found.topic.id;
          const day = dayKey(now());
          const added = !found.topic.reviews.includes(day);
          if (added) {
            found.topic.reviews.push(day);
            found.topic.reviews.sort();
            found.exam.updatedAt = now();
          }
          timer.lastReview = { examId: found.exam.id, topicId: found.topic.id, day, added };
        } else {
          timer.lastReview = null;
        }
        data.sessions.push(session);
        timer.lastId = session.id;
        timer.done += 1;
      }
      timer.extendId = '';
      timer.workStart = 0;
      saveData();
    }

    saveTimer();
    releaseWake();
    chime();
    renderAll();
  }

  function startBreak() {
    const isLong = timer.done > 0 && timer.done % data.settings.cycle === 0;
    timer.phase = isLong ? 'long' : 'short';
    timer.planned = phaseMs(timer.phase);
    timer.remaining = timer.planned;
    timer.ended = false;
    timer.lastId = '';
    startTimer();
  }

  function nextWork(autoStart) {
    if (timer.done >= data.settings.cycle) timer.done = 0;
    timer.phase = 'work';
    timer.planned = phaseMs('work');
    timer.remaining = timer.planned;
    timer.ended = false;
    timer.running = false;
    timer.lastId = '';
    timer.extendId = '';
    timer.workStart = 0;
    timer.lastReview = null;
    saveTimer();
    if (autoStart) startTimer();
    else renderTimer();
  }

  function addFive() {
    const add = 5 * 60000;
    if (timer.ended && timer.phase === 'work' && timer.lastId) {
      // Keep going on the session that just ended.
      timer.extendId = timer.lastId;
      timer.planned = add;
      timer.remaining = add;
      timer.ended = false;
      startTimer();
      return;
    }
    if (timer.ended) return;
    timer.planned += add;
    if (timer.running) timer.endAt += add;
    else timer.remaining += add;
    saveTimer();
    renderTimer();
  }

  function onMain() {
    if (timer.ended) {
      if (timer.phase === 'work') startBreak();
      else nextWork(true);
      return;
    }
    if (timer.running) pauseTimer();
    else startTimer();
  }

  function onReset() {
    releaseWake();
    if (timer.phase === 'work' && timer.extendId) {
      // Stop the extra time without counting it.
      timer.running = false;
      timer.ended = true;
      timer.lastId = timer.extendId;
      timer.extendId = '';
      timer.remaining = 0;
      saveTimer();
      renderTimer();
      return;
    }
    if (timer.phase === 'work' && !timer.ended) {
      timer.running = false;
      timer.planned = phaseMs('work');
      timer.remaining = timer.planned;
      timer.workStart = 0;
      saveTimer();
      renderTimer();
      return;
    }
    // Skip the break (or the waiting screen) and line up the next session.
    nextWork(false);
  }

  function tick() {
    if (timer.running && now() >= timer.endAt) finishPhase();
    else renderTime();
  }

  // ---------------------------------------------------------------------------
  // Sound and screen
  // ---------------------------------------------------------------------------
  let audioCtx = null;
  function unlockAudio() {
    try {
      if (!audioCtx) {
        const AC = window.AudioContext || window.webkitAudioContext;
        if (AC) audioCtx = new AC();
      }
      if (audioCtx && audioCtx.state === 'suspended') audioCtx.resume();
    } catch (_) { /* sound is optional */ }
  }

  function chime() {
    if (navigator.vibrate) {
      try { navigator.vibrate([200, 100, 200]); } catch (_) { /* optional */ }
    }
    if (!data.settings.sound || !audioCtx) return;
    try {
      const t0 = audioCtx.currentTime + 0.05;
      [660, 880, 1320].forEach((freq, i) => {
        const start = t0 + i * 0.22;
        const osc = audioCtx.createOscillator();
        const gain = audioCtx.createGain();
        osc.type = 'sine';
        osc.frequency.value = freq;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(0.35, start + 0.02);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7);
        osc.connect(gain);
        gain.connect(audioCtx.destination);
        osc.start(start);
        osc.stop(start + 0.75);
      });
    } catch (_) { /* optional */ }
  }

  let wakeLock = null;
  async function requestWake() {
    if (!data.settings.keepAwake || wakeLock || !('wakeLock' in navigator)) return;
    try {
      wakeLock = await navigator.wakeLock.request('screen');
      wakeLock.addEventListener('release', () => { wakeLock = null; });
    } catch (_) {
      wakeLock = null;
    }
  }

  function releaseWake() {
    if (!wakeLock) return;
    try { wakeLock.release(); } catch (_) { /* already released */ }
    wakeLock = null;
  }

  // ---------------------------------------------------------------------------
  // GitHub sync
  // ---------------------------------------------------------------------------
  function loadSync() {
    const raw = readJSON(SYNC_KEY) || {};
    return {
      owner: typeof raw.owner === 'string' && GH_OWNER.test(raw.owner) ? raw.owner : '',
      repo: typeof raw.repo === 'string' && GH_REPO.test(raw.repo) ? raw.repo : '',
      token: typeof raw.token === 'string' && GH_TOKEN.test(raw.token) ? raw.token : '',
      expires: typeof raw.expires === 'string' && DATE_ONLY.test(raw.expires) ? raw.expires : '',
      lastSync: clampNum(raw.lastSync, 0, 8.64e15, 0),
      lastError: cleanStr(raw.lastError, 200)
    };
  }

  let sync = loadSync();
  let syncing = false;
  let syncQueued = false;
  let syncTimer = null;

  function saveSync() {
    writeJSON(SYNC_KEY, sync);
  }

  function isConnected() {
    return Boolean(sync.owner && sync.repo && sync.token);
  }

  function scheduleSync(delay = 2500) {
    if (!isConnected()) return;
    clearTimeout(syncTimer);
    syncTimer = setTimeout(() => { syncNow(); }, delay);
  }

  function repoPath() {
    return `/repos/${encodeURIComponent(sync.owner)}/${encodeURIComponent(sync.repo)}`;
  }

  async function ghFetch(path, options = {}) {
    const headers = {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${sync.token}`,
      'X-GitHub-Api-Version': '2022-11-28'
    };
    if (options.body) headers['Content-Type'] = 'application/json';
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 15000);
    try {
      return await fetch(GITHUB_API + path, {
        method: options.method || 'GET',
        body: options.body,
        headers,
        cache: 'no-store',
        credentials: 'omit',
        referrerPolicy: 'no-referrer',
        redirect: 'error',
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
  }

  function authError(status) {
    if (status === 401) return new Error('GitHub did not accept the token. It may be expired or mistyped.');
    if (status === 403) return new Error('The token does not have permission for this repo, or GitHub is limiting requests. Try again later.');
    if (status === 404) return new Error('Repo not found. Check the username and repo name, and that the token can access it.');
    return new Error(`GitHub returned an error (${status}).`);
  }

  function b64encode(text) {
    const bytes = new TextEncoder().encode(text);
    let bin = '';
    for (let i = 0; i < bytes.length; i += 0x8000) {
      bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000));
    }
    return btoa(bin);
  }

  function b64decode(b64) {
    const bin = atob(String(b64).replace(/\s/g, ''));
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return new TextDecoder().decode(bytes);
  }

  async function checkRepoPrivate() {
    const res = await ghFetch(repoPath());
    if (!res.ok) throw authError(res.status);
    const info = await res.json();
    if (info.private !== true) {
      throw new Error('This repo is public. Make it private in GitHub before syncing, so your data stays private.');
    }
  }

  async function getRemote() {
    const res = await ghFetch(`${repoPath()}/contents/${DATA_FILE}`);
    if (res.status === 404) return { data: null, sha: '' };
    if (!res.ok) throw authError(res.status);
    const body = await res.json();
    if (!body || body.type !== 'file' || typeof body.content !== 'string') {
      throw new Error('The data file in the repo could not be read.');
    }
    let parsed;
    try {
      parsed = JSON.parse(b64decode(body.content));
    } catch (_) {
      throw new Error('The data file in the repo is damaged. Rename or delete it in GitHub to start fresh.');
    }
    return { data: sanitizeData(parsed), sha: typeof body.sha === 'string' ? body.sha : '' };
  }

  async function putRemote(text, sha) {
    const payload = { message: 'Update study data', content: b64encode(text) };
    if (sha) payload.sha = sha;
    const res = await ghFetch(`${repoPath()}/contents/${DATA_FILE}`, {
      method: 'PUT',
      body: JSON.stringify(payload)
    });
    if (res.status === 409 || res.status === 422) return false; // changed elsewhere, retry
    if (!res.ok) throw authError(res.status);
    return true;
  }

  async function syncNow(opts = {}) {
    if (!isConnected()) return false;
    if (syncing) { syncQueued = true; return false; }
    if (!navigator.onLine) {
      setSyncStatus('Offline. Your data is safe on this phone and will sync when you are back online.', '');
      return false;
    }
    syncing = true;
    setSyncStatus('Syncing...', '');
    try {
      await checkRepoPrivate();
      for (let attempt = 0; attempt < 3; attempt++) {
        const remote = await getRemote();
        const merged = mergeData(data, remote.data);
        const text = JSON.stringify(merged);
        if (!remote.data || text !== JSON.stringify(remote.data)) {
          const ok = await putRemote(text, remote.sha);
          if (!ok) continue;
        }
        // Keep anything that changed on this phone while the sync was running.
        data = mergeData(data, merged);
        writeJSON(STORE_KEY, data);
        if (JSON.stringify(data) !== text) syncQueued = true;
        sync.lastSync = now();
        sync.lastError = '';
        saveSync();
        if (!classById(timer.classId) || classById(timer.classId).archived) {
          timer.classId = (activeClasses()[0] || {}).id || '';
          saveTimer();
        }
        renderAll();
        if (opts.announce) toast('Synced with GitHub');
        return true;
      }
      throw new Error('GitHub kept reporting a conflict. Try Sync now again in a moment.');
    } catch (err) {
      const msg = err && err.name === 'AbortError'
        ? 'GitHub took too long to respond. Will try again later.'
        : (err instanceof TypeError ? 'Could not reach GitHub. Check your connection.' : String((err && err.message) || err));
      sync.lastError = cleanStr(msg, 200);
      saveSync();
      renderSyncStatus();
      if (opts.announce) toast('Sync failed');
      return false;
    } finally {
      syncing = false;
      if (syncQueued) {
        syncQueued = false;
        scheduleSync(1000);
      }
    }
  }

  function tokenDaysLeft() {
    if (!sync.expires) return null;
    const [y, m, d] = sync.expires.split('-').map(Number);
    const end = new Date(y, m - 1, d).getTime();
    return Math.round((end - startOfDay(now())) / 86400000);
  }

  // ---------------------------------------------------------------------------
  // Rendering: timer screen
  // ---------------------------------------------------------------------------
  function currentColor() {
    if (timer.phase !== 'work') return BREAK_COLOR;
    const c = classById(timer.classId);
    return c ? c.color : '#5F6570';
  }

  function renderTime() {
    const left = timer.ended ? 0 : remainingNow();
    $('#time').textContent = fmtClock(left);
    const frac = timer.planned > 0 ? left / timer.planned : 0;
    $('#ring-progress').style.strokeDashoffset = String(RING_C * (1 - Math.min(1, Math.max(0, frac))));
    $('#ring-progress').style.opacity = left > 0 ? '1' : '0';
  }

  function renderTimer() {
    const color = currentColor();
    document.documentElement.style.setProperty('--c', color);
    const activeClass = classById(timer.classId);
    document.documentElement.style.setProperty('--c-soft', tint(activeClass ? activeClass.color : '#5F6570', 0.9));

    // Session type
    document.querySelectorAll('.segmented button').forEach((b) => {
      b.setAttribute('aria-pressed', String(b.dataset.type === timer.type));
    });

    // Class picker
    const picker = $('#class-picker');
    picker.replaceChildren();
    const classes = activeClasses();
    picker.style.gridTemplateColumns = `repeat(${Math.min(4, Math.max(1, classes.length))}, minmax(0, 1fr))`;
    for (const c of classes) {
      const btn = el('button', 'class-btn');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(c.id === timer.classId));
      setColor(btn, '--cc', c.color);
      btn.style.setProperty('--cs', tint(c.color, 0.9));
      btn.append(el('span', 'dash'), document.createTextNode(c.name));
      btn.addEventListener('click', () => {
        timer.classId = c.id;
        const found = findTopic(timer.examId, timer.topicId);
        if (!found || found.exam.classId !== c.id) {
          timer.examId = '';
          timer.topicId = '';
        }
        saveTimer();
        renderTimer();
      });
      picker.append(btn);
    }

    const note = $('#note');
    if (document.activeElement !== note) note.value = timer.note;
    renderTopicPicker();

    // Labels
    const s = data.settings;
    let label;
    let hint;
    if (timer.phase === 'work') {
      if (timer.ended) {
        label = 'Session complete';
        const isLong = timer.done > 0 && timer.done % s.cycle === 0;
        hint = `Nice work. Start your ${isLong ? `${s.long} min long` : `${s.short} min`} break, or add 5 minutes.`;
      } else if (timer.extendId) {
        label = 'Extra time';
        hint = 'Finishing up. This time is added to the session you just did.';
      } else {
        label = `Session ${(timer.done % s.cycle) + 1} of ${s.cycle}`;
        const nextIsLong = (timer.done % s.cycle) + 1 === s.cycle;
        hint = nextIsLong
          ? `Next up a ${s.long} min long break`
          : `Next up a ${s.short} min break, long break after session ${s.cycle}`;
      }
    } else {
      const name = timer.phase === 'long' ? 'Long break' : 'Short break';
      if (timer.ended) {
        label = 'Break is over';
        hint = 'Ready when you are. Tap play to start the next session.';
      } else {
        label = name;
        hint = 'Step away from the screen. Stand up, stretch, get some water.';
      }
    }
    $('#phase-label').textContent = label;
    $('#hint').textContent = hint;
    renderReviewNote();

    // Buttons
    const main = $('#btn-main');
    main.classList.toggle('is-running', timer.running);
    let mainLabel = timer.running ? 'Pause' : 'Start';
    if (timer.ended) mainLabel = timer.phase === 'work' ? 'Start break' : 'Start next session';
    main.setAttribute('aria-label', mainLabel);

    const reset = $('#btn-reset');
    const resetLabel = timer.phase === 'work' && !timer.ended ? (timer.extendId ? 'Stop extra time' : 'Reset timer') : 'Skip break';
    reset.setAttribute('aria-label', resetLabel);
    reset.disabled = isIdleWork();

    const plus = $('#btn-plus');
    plus.disabled = timer.ended && !(timer.phase === 'work' && timer.lastId);

    // Banner for sync problems
    const banner = $('#banner');
    const days = tokenDaysLeft();
    let bannerText = '';
    if (isConnected() && days !== null && days < 0) bannerText = 'Your GitHub token has expired, so syncing is paused. Make a new one and paste it in Settings.';
    else if (isConnected() && days !== null && days <= 7) bannerText = `Your GitHub token expires in ${days} day${days === 1 ? '' : 's'}. Make a new one soon and paste it in Settings.`;
    banner.textContent = bannerText;
    banner.hidden = !bannerText;
    $('#settings-dot').hidden = !(bannerText || (isConnected() && sync.lastError));

    renderTime();
    renderGoal();
  }

  function sessionsOn(dayStart) {
    const end = addDays(dayStart, 1);
    return data.sessions.filter((x) => x.start >= dayStart && x.start < end);
  }

  function streakDays() {
    const days = new Set(data.sessions.map((x) => dayKey(x.start)));
    let cursor = startOfDay(now());
    if (!days.has(dayKey(cursor))) cursor = addDays(cursor, -1);
    let count = 0;
    while (days.has(dayKey(cursor))) {
      count += 1;
      cursor = addDays(cursor, -1);
    }
    return count;
  }

  function renderGoal() {
    const today = sessionsOn(startOfDay(now())).length;
    const goal = data.settings.goal;
    $('#goal-label').textContent = `${today} of ${goal} sessions`;
    $('#goal-fill').style.width = `${Math.min(100, (today / goal) * 100)}%`;
    const streak = streakDays();
    $('#streak-label').textContent = `${streak} day streak`;
  }

  // ---------------------------------------------------------------------------
  // Rendering: stats
  // ---------------------------------------------------------------------------
  let weekOffset = 0;

  function renderStats() {
    const todayStart = startOfDay(now());
    const todayMin = sessionsOn(todayStart).reduce((a, x) => a + x.minutes, 0);
    const weekStart = addDays(startOfWeek(now()), weekOffset * 7);
    const weekEnd = addDays(weekStart, 7);
    const weekSessions = data.sessions.filter((x) => x.start >= weekStart && x.start < weekEnd);
    const weekMin = weekSessions.reduce((a, x) => a + x.minutes, 0);

    const thisWeekStart = startOfWeek(now());
    const thisWeekMin = data.sessions
      .filter((x) => x.start >= thisWeekStart && x.start < addDays(thisWeekStart, 7))
      .reduce((a, x) => a + x.minutes, 0);
    $('#stat-today').textContent = fmtShort(todayMin);
    $('#stat-week').textContent = fmtShort(thisWeekMin);
    $('#stat-streak').textContent = String(streakDays());

    // Week label
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    $('#week-label').textContent = weekOffset === 0
      ? `This week, ${fmtMin(weekMin)}`
      : `${fmt.format(weekStart)} to ${fmt.format(addDays(weekStart, 6))}, ${fmtMin(weekMin)}`;
    $('#week-next').disabled = weekOffset >= 0;
    const earliest = data.sessions.length ? startOfWeek(data.sessions[0].start) : startOfWeek(now());
    $('#week-prev').disabled = weekStart <= earliest;

    // Day bars
    const bars = $('#day-bars');
    bars.replaceChildren();
    const dayNames = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];
    const perDay = dayNames.map((_, i) => {
      const list = sessionsOn(addDays(weekStart, i));
      const hw = list.filter((x) => x.type === 'homework').reduce((a, x) => a + x.minutes, 0);
      const ex = list.filter((x) => x.type === 'exam').reduce((a, x) => a + x.minutes, 0);
      return { hw, ex, total: hw + ex };
    });
    const max = Math.max(60, ...perDay.map((d) => d.total));
    const summary = [];
    perDay.forEach((d, i) => {
      const col = el('div', 'day-col');
      if (addDays(weekStart, i) === todayStart) col.classList.add('today');
      const val = el('span', 'day-val', d.total > 0 ? String(Math.round(d.total)) : '');
      const bar = el('div', 'day-bar');
      if (d.total <= 0) {
        bar.classList.add('zero');
      } else {
        // Exam study stacks on top of homework.
        const ex = el('div', 'seg-ex');
        ex.style.height = `${(d.ex / max) * 100}px`;
        const hw = el('div', 'seg-hw');
        hw.style.height = `${(d.hw / max) * 100}px`;
        bar.append(ex, hw);
      }
      col.append(val, bar, el('span', 'day-name', dayNames[i]));
      bars.append(col);
      summary.push(`${dayNames[i]} ${Math.round(d.hw)} minutes homework and ${Math.round(d.ex)} minutes exam study`);
    });
    bars.setAttribute('aria-label', `Minutes studied each day. ${summary.join(', ')}`);

    // Class bars
    const classBars = $('#class-bars');
    classBars.replaceChildren();
    const rows = data.settings.classes
      .map((c) => {
        const own = weekSessions.filter((x) => x.classId === c.id);
        const hw = own.filter((x) => x.type === 'homework').reduce((a, x) => a + x.minutes, 0);
        const ex = own.filter((x) => x.type === 'exam').reduce((a, x) => a + x.minutes, 0);
        return { c, hw, ex, total: hw + ex };
      })
      .filter((r) => !r.c.archived || r.total > 0);
    const other = weekSessions.filter((x) => !classById(x.classId));
    if (other.length) {
      const hw = other.filter((x) => x.type === 'homework').reduce((a, x) => a + x.minutes, 0);
      const ex = other.filter((x) => x.type === 'exam').reduce((a, x) => a + x.minutes, 0);
      rows.push({ c: { name: 'Other', color: '#5F6570' }, hw, ex, total: hw + ex });
    }
    const maxClass = Math.max(1, ...rows.map((r) => r.total));
    for (const r of rows) {
      const row = el('div', 'cb-row');
      setColor(row, '--cc', r.c.color);
      const head = el('div', 'cb-head');
      head.append(el('span', 'cb-name', r.c.name), el('span', 'cb-total', fmtMin(r.total)));
      const track = el('div', 'cb-track');
      const hwBar = el('div', 'cb-hw');
      hwBar.style.width = `${(r.hw / maxClass) * 100}%`;
      const exBar = el('div', 'cb-ex');
      exBar.style.width = `${(r.ex / maxClass) * 100}%`;
      track.append(hwBar, exBar);
      const split = el('span', 'cb-split', `Homework ${fmtMin(r.hw)}, exam study ${fmtMin(r.ex)}`);
      row.append(head, track, split);
      classBars.append(row);
    }

    // Recent sessions
    const list = $('#recent');
    list.replaceChildren();
    const recent = data.sessions.slice(-15).reverse();
    if (!recent.length) {
      list.append(el('li', 'empty-row', 'No sessions yet. Finish your first one and it will show up here.'));
    }
    const when = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
    for (const x of recent) {
      const c = classById(x.classId);
      const li = el('li');
      setColor(li, '--cc', c ? c.color : '#5F6570');
      const main = el('div', 'r-main');
      main.append(
        el('span', 'r-title', `${c ? c.name : 'Other'}, ${x.type === 'exam' ? 'Exam Study' : 'Homework'}`),
        el('span', 'r-sub', [
          (findTopic(x.examId, x.topicId) || {}).topic ? findTopic(x.examId, x.topicId).topic.name : '',
          x.note,
          when.format(x.start)
        ].filter(Boolean).join(', '))
      );
      const del = el('button', 'r-del');
      del.type = 'button';
      del.setAttribute('aria-label', 'Delete this session');
      del.append(svgIcon(18, ['M3 6h18', 'M8 6V4h8v2', 'M19 6l-1 14H6L5 6']));
      del.addEventListener('click', () => {
        if (!confirm('Delete this session from your stats?')) return;
        data.sessions = data.sessions.filter((s) => s.id !== x.id);
        if (!data.deleted.includes(x.id)) data.deleted.push(x.id);
        if (timer.lastId === x.id) timer.lastId = '';
        saveTimer();
        saveData();
        renderAll();
      });
      li.append(el('span', 'dash'), main, el('span', 'r-min', fmtMin(x.minutes)), del);
      list.append(li);
    }
  }

  // ---------------------------------------------------------------------------
  // Rendering: settings
  // ---------------------------------------------------------------------------
  const numberFields = [
    ['#set-work', 'work', 1, 180],
    ['#set-short', 'short', 1, 60],
    ['#set-long', 'long', 1, 120],
    ['#set-cycle', 'cycle', 2, 12],
    ['#set-goal', 'goal', 1, 40]
  ];

  function renderSettings() {
    for (const [sel, key] of numberFields) {
      const input = $(sel);
      if (document.activeElement !== input) input.value = String(data.settings[key]);
    }
    $('#set-sound').checked = data.settings.sound;
    $('#set-awake').checked = data.settings.keepAwake;

    const list = $('#class-list');
    if (!list.contains(document.activeElement)) {
      list.replaceChildren();
      const classes = activeClasses();
      for (const c of classes) {
        const li = el('li');
        setColor(li, '--cc', c.color);
        const input = el('input');
        input.type = 'text';
        input.maxLength = 24;
        input.value = c.name;
        input.setAttribute('aria-label', `Class name for ${c.name}`);
        input.addEventListener('change', () => {
          const name = cleanStr(input.value, 24).trim();
          if (!name) { input.value = c.name; return; }
          c.name = name;
          touchSettings();
          renderTimer();
        });
        const remove = el('button', 'remove');
        remove.type = 'button';
        remove.setAttribute('aria-label', `Remove ${c.name}`);
        remove.disabled = classes.length <= 1;
        remove.append(svgIcon(18, ['M18 6L6 18', 'M6 6l12 12']));
        remove.addEventListener('click', () => {
          if (!confirm(`Remove ${c.name}? Past sessions for it stay in your stats.`)) return;
          c.archived = true;
          if (timer.classId === c.id) {
            timer.classId = (activeClasses()[0] || {}).id || '';
            saveTimer();
          }
          touchSettings();
          renderAll();
        });
        li.append(el('span', 'dot'), input, remove);
        list.append(li);
      }
      $('#add-class').disabled = classes.length >= MAX_CLASSES;
    }

    const owner = $('#sync-owner');
    const repo = $('#sync-repo');
    const expires = $('#sync-expires');
    if (document.activeElement !== owner) owner.value = sync.owner;
    if (document.activeElement !== repo) repo.value = sync.repo;
    if (document.activeElement !== expires) expires.value = sync.expires;
    const token = $('#sync-token');
    if (document.activeElement !== token) {
      token.value = '';
      token.placeholder = sync.token ? 'Saved on this phone (hidden)' : 'Paste once, it stays hidden';
    }
    $('#sync-now').disabled = !isConnected();
    $('#sync-disconnect').hidden = !sync.token;
    renderSyncStatus();
  }

  function setSyncStatus(text, kind) {
    const node = $('#sync-status');
    node.textContent = text;
    node.className = `sync-status ${kind || ''}`.trim();
  }

  function renderSyncStatus() {
    if (syncing) return;
    if (!isConnected()) {
      setSyncStatus('Not connected. Your data is only on this phone.', '');
      return;
    }
    if (sync.lastError) {
      setSyncStatus(sync.lastError, 'err');
      return;
    }
    const parts = [];
    if (sync.lastSync) {
      const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
      parts.push(`Last synced ${fmt.format(sync.lastSync)}.`);
    } else {
      parts.push('Connected.');
    }
    const days = tokenDaysLeft();
    if (days !== null) {
      if (days < 0) parts.push('Token has expired.');
      else parts.push(`Token expires in ${days} day${days === 1 ? '' : 's'}.`);
    }
    setSyncStatus(parts.join(' '), days !== null && days <= 7 ? 'err' : 'ok');
  }

  // ---------------------------------------------------------------------------
  // Navigation
  // ---------------------------------------------------------------------------
  // ---------------------------------------------------------------------------
  // Rendering: topic picker and review note on the timer
  // ---------------------------------------------------------------------------
  function renderTopicPicker() {
    const field = $('#topic-field');
    field.hidden = timer.type !== 'exam';
    $('#view-timer').classList.toggle('exam-mode', !field.hidden);
    if (field.hidden) return;
    const select = $('#topic');
    if (document.activeElement === select) return;
    select.replaceChildren();
    const none = el('option', '', 'No topic');
    none.value = '';
    select.append(none);
    const exams = upcomingExams().filter((e) => e.classId === timer.classId && e.topics.length);
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    for (const exam of exams) {
      const group = document.createElement('optgroup');
      group.label = `${exam.name}, ${fmt.format(parseDay(exam.date))}`;
      for (const t of exam.topics) {
        const opt = el('option', '', t.name);
        opt.value = `${exam.id}|${t.id}`;
        group.append(opt);
      }
      select.append(group);
    }
    const found = findTopic(timer.examId, timer.topicId);
    select.value = found && found.exam.classId === timer.classId ? `${found.exam.id}|${found.topic.id}` : '';
    $('#topic-help').hidden = exams.length > 0;
  }

  function renderReviewNote() {
    const box = $('#review-note');
    const lr = timer.lastReview;
    const found = lr ? findTopic(lr.examId, lr.topicId) : null;
    if (!found || !timer.ended || timer.phase !== 'work') {
      box.hidden = true;
      return;
    }
    const sched = topicSchedule(found.exam, found.topic);
    const fmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    const nextText = sched.next >= parseDay(found.exam.date) ? 'on exam day' : fmt.format(sched.next);
    $('#review-text').textContent = lr.added
      ? `${found.topic.name} reviewed. Next review ${nextText}.`
      : `${found.topic.name} was already reviewed today. Next review ${nextText}.`;
    $('#undo-review').hidden = !lr.added;
    box.hidden = false;
  }

  function undoReview() {
    const lr = timer.lastReview;
    const found = lr ? findTopic(lr.examId, lr.topicId) : null;
    if (found && lr.added) {
      found.topic.reviews = found.topic.reviews.filter((d) => d !== lr.day);
      found.exam.updatedAt = now();
      const session = data.sessions.find((x) => x.id === timer.lastId);
      if (session) {
        session.examId = '';
        session.topicId = '';
        session.updatedAt = now();
      }
      saveData();
      toast(`Review of ${found.topic.name} undone`);
    }
    timer.lastReview = null;
    saveTimer();
    renderAll();
  }

  // ---------------------------------------------------------------------------
  // Rendering: exams tab
  // ---------------------------------------------------------------------------
  function relativeDays(ms) {
    const d = daysBetween(ms, startOfDay(now()));
    if (d <= 0) return 'today';
    if (d === 1) return 'yesterday';
    return `${d} days ago`;
  }

  function startTopic(exam, topic) {
    timer.type = 'exam';
    if (classById(exam.classId)) timer.classId = exam.classId;
    timer.examId = exam.id;
    timer.topicId = topic.id;
    saveTimer();
    showTab('timer');
    renderTimer();
    toast(timer.running ? `Topic set to ${topic.name}` : `Ready to study ${topic.name}. Tap play to start.`);
  }

  function renderExams() {
    const today = startOfDay(now());
    const upcoming = upcomingExams();

    // Review today
    const due = [];
    const fresh = [];
    for (const exam of upcoming) {
      for (const topic of exam.topics) {
        const sched = topicSchedule(exam, topic);
        if (sched.status === 'due') due.push({ exam, topic, sched });
        else if (sched.status === 'new') fresh.push({ exam, topic, sched });
      }
    }
    due.sort((a, b) => a.sched.next - b.sched.next || (a.exam.date < b.exam.date ? -1 : 1));
    const items = [...due, ...fresh];
    $('#review-count').textContent = items.length ? `${items.length} topic${items.length === 1 ? '' : 's'}` : '';

    const list = $('#review-list');
    list.replaceChildren();
    if (!items.length) {
      list.append(el('li', 'empty-row', upcoming.length
        ? 'All caught up. Nothing is due for review today.'
        : 'Add an exam and its topics, and the topics to study each day will show up here.'));
    }
    for (const { exam, topic, sched } of items) {
      const c = classById(exam.classId);
      const li = el('li');
      setColor(li, '--cc', c ? c.color : '#5F6570');
      const main = el('div', 'r-main');
      const status = sched.status === 'new' ? 'not started yet' : `last reviewed ${relativeDays(sched.last)}`;
      main.append(
        el('span', 'r-title', topic.name),
        el('span', 'r-sub', `${c ? c.name : 'Other'} ${exam.name}, ${status}`)
      );
      const start = el('button', 'start-pill', 'Start');
      start.type = 'button';
      start.setAttribute('aria-label', `Start studying ${topic.name}`);
      start.style.setProperty('--cs', tint(c ? c.color : '#5F6570', 0.88));
      start.addEventListener('click', () => startTopic(exam, topic));
      li.append(el('span', 'dash'), main, start);
      list.append(li);
    }

    // Upcoming exams
    const wrap = $('#exam-list');
    wrap.replaceChildren();
    if (!upcoming.length) {
      const empty = el('div', 'card empty-small');
      empty.append(el('p', 'muted', 'No upcoming exams yet. Tap Add exam to set one up with its date and topics.'));
      wrap.append(empty);
    }
    const dateFmt = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'short', day: 'numeric' });
    for (const exam of upcoming) {
      const c = classById(exam.classId);
      const card = el('button', 'exam-card');
      card.type = 'button';
      card.setAttribute('aria-label', `Edit ${c ? c.name : ''} ${exam.name}`);
      setColor(card, '--cc', c ? c.color : '#5F6570');
      const days = daysBetween(today, parseDay(exam.date));
      const reviewed = exam.topics.filter((t) => t.reviews.length).length;

      const top = el('div', 'exam-top');
      const left = el('div', 'exam-left');
      left.append(
        el('span', 'exam-class', c ? c.name : 'Other'),
        el('span', 'exam-name', exam.name),
        el('span', 'exam-date', dateFmt.format(parseDay(exam.date)))
      );
      const right = el('div', 'exam-right');
      if (days === 0) right.append(el('span', 'exam-days', 'Today'));
      else {
        right.append(el('span', 'exam-days', String(days)), el('span', 'exam-days-label', days === 1 ? 'day away' : 'days away'));
      }
      top.append(left, right);

      const bar = el('div', 'bar');
      const fill = el('div', 'bar-fill exam-fill');
      fill.style.width = `${exam.topics.length ? (reviewed / exam.topics.length) * 100 : 0}%`;
      bar.append(fill);
      const caption = exam.topics.length
        ? `${reviewed} of ${exam.topics.length} topics reviewed at least once`
        : 'No topics yet. Tap to add some.';
      card.append(top, bar, el('span', 'exam-caption', caption));
      card.addEventListener('click', () => openEditor(exam.id));
      wrap.append(card);
    }

    // Past exams
    const past = pastExams();
    $('#past-wrap').hidden = !past.length;
    const pastList = $('#past-list');
    pastList.replaceChildren();
    const shortFmt = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
    for (const exam of past) {
      const c = classById(exam.classId);
      const li = el('li');
      setColor(li, '--cc', c ? c.color : '#5F6570');
      const main = el('div', 'r-main');
      main.append(
        el('span', 'r-title', `${c ? c.name : 'Other'} ${exam.name}`),
        el('span', 'r-sub', shortFmt.format(parseDay(exam.date)))
      );
      const edit = el('button', 'r-del');
      edit.type = 'button';
      edit.setAttribute('aria-label', `Edit or delete ${exam.name}`);
      edit.append(svgIcon(18, ['M12 20h9', 'M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z']));
      edit.addEventListener('click', () => openEditor(exam.id));
      li.append(el('span', 'dash'), main, edit);
      pastList.append(li);
    }
  }

  // ---------------------------------------------------------------------------
  // Exam editor
  // ---------------------------------------------------------------------------
  let editor = null;

  function openEditor(examId) {
    const exam = findExam(examId);
    const classes = activeClasses();
    editor = exam
      ? {
        id: exam.id,
        classId: exam.classId,
        name: exam.name,
        date: exam.date,
        topics: exam.topics.map((t) => ({ id: t.id, name: t.name, reviews: [...t.reviews] }))
      }
      : {
        id: '',
        classId: classById(timer.classId) && !classById(timer.classId).archived ? timer.classId : (classes[0] || {}).id || '',
        name: '',
        date: '',
        topics: []
      };
    $('#editor-title').textContent = exam ? 'Edit exam' : 'New exam';
    $('#editor-name').value = editor.name;
    $('#editor-date').value = editor.date;
    $('#editor-topic-new').value = '';
    $('#editor-delete').hidden = !exam;
    $('#editor-error').textContent = '';
    renderEditor();
    $('#exam-editor').hidden = false;
    document.body.classList.add('sheet-open');
    $('#editor-name').focus({ preventScroll: true });
  }

  function closeEditor() {
    editor = null;
    $('#exam-editor').hidden = true;
    document.body.classList.remove('sheet-open');
  }

  function renderEditor() {
    if (!editor) return;
    const picker = $('#editor-class');
    picker.replaceChildren();
    const classes = data.settings.classes.filter((c) => !c.archived || c.id === editor.classId);
    picker.style.gridTemplateColumns = `repeat(${Math.min(4, Math.max(1, classes.length))}, minmax(0, 1fr))`;
    for (const c of classes) {
      const btn = el('button', 'class-btn');
      btn.type = 'button';
      btn.setAttribute('aria-pressed', String(c.id === editor.classId));
      setColor(btn, '--cc', c.color);
      btn.style.setProperty('--cs', tint(c.color, 0.9));
      btn.append(el('span', 'dash'), document.createTextNode(c.name));
      btn.addEventListener('click', () => {
        editor.classId = c.id;
        renderEditor();
      });
      picker.append(btn);
    }

    const list = $('#editor-topics');
    list.replaceChildren();
    if (!editor.topics.length) list.append(el('li', 'empty-row', 'No topics yet. Add each chapter or unit the exam covers.'));
    editor.topics.forEach((t, i) => {
      const li = el('li');
      const input = el('input');
      input.type = 'text';
      input.maxLength = 40;
      input.value = t.name;
      input.setAttribute('aria-label', `Topic ${i + 1}`);
      input.addEventListener('input', () => { t.name = cleanStr(input.value, 40); });
      const remove = el('button', 'remove');
      remove.type = 'button';
      remove.setAttribute('aria-label', `Remove ${t.name || 'topic'}`);
      remove.append(svgIcon(18, ['M18 6L6 18', 'M6 6l12 12']));
      remove.addEventListener('click', () => {
        if (t.reviews.length && !confirm(`Remove ${t.name}? Its review history goes with it.`)) return;
        editor.topics.splice(i, 1);
        renderEditor();
      });
      li.append(input, remove);
      list.append(li);
    });
    $('#editor-topic-add').disabled = editor.topics.length >= 100;
  }

  function addEditorTopic() {
    if (!editor) return;
    const input = $('#editor-topic-new');
    const names = cleanStr(input.value, 400).split(',').map((n) => n.trim().slice(0, 40)).filter(Boolean);
    if (!names.length) { input.focus(); return; }
    for (const name of names) {
      if (editor.topics.length >= 100) break;
      editor.topics.push({ id: `t${uid()}`, name, reviews: [] });
    }
    input.value = '';
    renderEditor();
    input.focus();
  }

  function saveEditor() {
    if (!editor) return;
    // Pick up a topic typed but not added yet.
    if ($('#editor-topic-new').value.trim()) addEditorTopic();
    const err = $('#editor-error');
    if (!classById(editor.classId)) { err.textContent = 'Pick a class for this exam.'; return; }
    if (!DATE_ONLY.test(editor.date)) { err.textContent = 'Pick the exam date.'; return; }
    const name = cleanStr(editor.name, 40).trim() || 'Exam';
    const topics = editor.topics
      .map((t) => ({ id: t.id, name: cleanStr(t.name, 40).trim(), reviews: t.reviews }))
      .filter((t) => t.name);

    const existing = findExam(editor.id);
    if (existing) {
      existing.classId = editor.classId;
      existing.name = name;
      existing.date = editor.date;
      existing.topics = topics;
      existing.updatedAt = now();
    } else {
      data.exams.push({ id: `e${uid()}`, classId: editor.classId, name, date: editor.date, topics, updatedAt: now() });
    }
    data.exams.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
    if (timer.examId && !findTopic(timer.examId, timer.topicId)) {
      timer.examId = '';
      timer.topicId = '';
      saveTimer();
    }
    saveData();
    closeEditor();
    renderAll();
    toast(existing ? 'Exam updated' : 'Exam added');
  }

  function deleteEditorExam() {
    const exam = editor ? findExam(editor.id) : null;
    if (!exam) return;
    if (!confirm(`Delete ${exam.name}? Your study sessions stay in Stats.`)) return;
    data.exams = data.exams.filter((e) => e.id !== exam.id);
    if (!data.deleted.includes(exam.id)) data.deleted.push(exam.id);
    if (timer.examId === exam.id) {
      timer.examId = '';
      timer.topicId = '';
      saveTimer();
    }
    if (timer.lastReview && timer.lastReview.examId === exam.id) timer.lastReview = null;
    saveData();
    closeEditor();
    renderAll();
    toast('Exam deleted');
  }

  let currentTab = 'timer';

  function showTab(name) {
    currentTab = name;
    for (const tab of ['timer', 'exams', 'stats', 'settings']) {
      $(`#view-${tab}`).hidden = tab !== name;
    }
    document.querySelectorAll('.tab').forEach((b) => {
      if (b.dataset.tab === name) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    if (name === 'stats') renderStats();
    if (name === 'exams') renderExams();
    if (name === 'settings') renderSettings();
    window.scrollTo(0, 0);
  }

  function renderAll() {
    renderTimer();
    if (currentTab === 'stats') renderStats();
    if (currentTab === 'exams') renderExams();
    if (currentTab === 'settings') renderSettings();
  }

  // ---------------------------------------------------------------------------
  // Events
  // ---------------------------------------------------------------------------
  function bind() {
    document.querySelectorAll('.tab').forEach((b) => {
      b.addEventListener('click', () => showTab(b.dataset.tab));
    });

    document.querySelectorAll('.segmented button').forEach((b) => {
      b.addEventListener('click', () => {
        timer.type = b.dataset.type === 'exam' ? 'exam' : 'homework';
        saveTimer();
        renderTimer();
      });
    });

    $('#note').addEventListener('input', (e) => {
      timer.note = cleanStr(e.target.value, 60);
      saveTimer();
    });

    $('#btn-main').addEventListener('click', onMain);
    $('#btn-reset').addEventListener('click', onReset);
    $('#btn-plus').addEventListener('click', addFive);

    $('#topic').addEventListener('change', (e) => {
      const [examId, topicId] = String(e.target.value).split('|');
      const found = findTopic(examId, topicId);
      timer.examId = found ? found.exam.id : '';
      timer.topicId = found ? found.topic.id : '';
      saveTimer();
    });
    $('#undo-review').addEventListener('click', undoReview);

    $('#add-exam').addEventListener('click', () => openEditor(null));
    $('#editor-cancel').addEventListener('click', closeEditor);
    $('#editor-save').addEventListener('click', saveEditor);
    $('#editor-delete').addEventListener('click', deleteEditorExam);
    $('#editor-topic-add').addEventListener('click', addEditorTopic);
    $('#editor-topic-new').addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); addEditorTopic(); }
    });
    $('#editor-name').addEventListener('input', (e) => { editor.name = cleanStr(e.target.value, 40); });
    $('#editor-date').addEventListener('change', (e) => { editor.date = DATE_ONLY.test(e.target.value) ? e.target.value : ''; });
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && editor) closeEditor();
    });

    $('#week-prev').addEventListener('click', () => { weekOffset -= 1; renderStats(); });
    $('#week-next').addEventListener('click', () => { if (weekOffset < 0) weekOffset += 1; renderStats(); });

    for (const [sel, key, min, max] of numberFields) {
      $(sel).addEventListener('change', (e) => {
        const value = clampInt(e.target.value, min, max, data.settings[key]);
        e.target.value = String(value);
        if (value === data.settings[key]) return;
        data.settings[key] = value;
        touchSettings();
        if (key === 'work' && isIdleWork()) {
          timer.planned = phaseMs('work');
          timer.remaining = timer.planned;
          saveTimer();
        }
        renderTimer();
      });
    }

    $('#set-sound').addEventListener('change', (e) => {
      data.settings.sound = e.target.checked;
      if (e.target.checked) unlockAudio();
      touchSettings();
    });
    $('#set-awake').addEventListener('change', (e) => {
      data.settings.keepAwake = e.target.checked;
      if (!e.target.checked) releaseWake();
      else if (timer.running) requestWake();
      touchSettings();
    });

    $('#add-class').addEventListener('click', () => {
      const classes = activeClasses();
      if (classes.length >= MAX_CLASSES) return;
      const used = new Set(classes.map((c) => c.color));
      const color = PALETTE.find((p) => !used.has(p)) || PALETTE[classes.length % PALETTE.length];
      data.settings.classes.push({ id: `c${uid()}`, name: 'New class', color, archived: false });
      touchSettings();
      renderAll();
      const inputs = document.querySelectorAll('#class-list input');
      const last = inputs[inputs.length - 1];
      if (last) { last.focus(); last.select(); }
    });

    $('#sync-connect').addEventListener('click', async () => {
      const owner = $('#sync-owner').value.trim();
      const repo = $('#sync-repo').value.trim();
      const tokenInput = $('#sync-token');
      const token = tokenInput.value.trim() || sync.token;
      const expires = $('#sync-expires').value;

      if (!GH_OWNER.test(owner)) { setSyncStatus('Enter your GitHub username.', 'err'); return; }
      if (!GH_REPO.test(repo)) { setSyncStatus('Enter the name of your private data repo.', 'err'); return; }
      if (!GH_TOKEN.test(token)) { setSyncStatus('That does not look like a GitHub token. Paste the whole thing.', 'err'); return; }

      sync.owner = owner;
      sync.repo = repo;
      sync.token = token;
      sync.expires = DATE_ONLY.test(expires) ? expires : '';
      sync.lastError = '';
      saveSync();
      tokenInput.value = '';
      tokenInput.blur();

      const btn = $('#sync-connect');
      btn.disabled = true;
      const ok = await syncNow({ announce: true });
      btn.disabled = false;
      renderSettings();
      renderTimer();
      if (ok) setSyncStatus('Connected and synced. From now on this happens automatically.', 'ok');
    });

    $('#sync-expires').addEventListener('change', (e) => {
      sync.expires = DATE_ONLY.test(e.target.value) ? e.target.value : '';
      saveSync();
      renderSyncStatus();
      renderTimer();
    });

    $('#sync-now').addEventListener('click', () => { syncNow({ announce: true }); });

    $('#sync-disconnect').addEventListener('click', () => {
      if (!confirm('Remove the token from this phone? Your data stays here and in your GitHub repo.')) return;
      sync.token = '';
      sync.lastError = '';
      saveSync();
      renderSettings();
      renderTimer();
    });

    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') {
        tick();
        if (timer.running) requestWake();
        renderAll();
        scheduleSync(800);
      }
    });
    window.addEventListener('online', () => scheduleSync(500));
    window.addEventListener('pagehide', () => saveTimer());
  }

  // ---------------------------------------------------------------------------
  // Start up
  // ---------------------------------------------------------------------------
  function init() {
    // Refuse to run inside another site's frame, so no page can trick taps on it.
    if (window.top !== window.self) {
      document.body.replaceChildren(el('p', 'muted center', 'Open Sigma Timer directly from its own address.'));
      return;
    }
    if (!classById(timer.classId) || classById(timer.classId).archived) {
      timer.classId = (activeClasses()[0] || {}).id || '';
    }
    bind();
    renderTimer();
    // Catch up if a session ended while the app was closed.
    if (timer.running && now() >= timer.endAt) finishPhase();
    else if (timer.running) requestWake();
    setInterval(tick, 500);
    scheduleSync(1200);

    if ('serviceWorker' in navigator && location.protocol === 'https:') {
      // When an update installs, reload once so the new version shows right away.
      const hadController = Boolean(navigator.serviceWorker.controller);
      let reloaded = false;
      navigator.serviceWorker.addEventListener('controllerchange', () => {
        if (!hadController || reloaded) return;
        reloaded = true;
        saveTimer();
        location.reload();
      });
      navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' })
        .then((reg) => reg.update())
        .catch(() => { /* offline support is optional */ });
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
