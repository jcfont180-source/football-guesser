/* Football Guesser: plain JS, no build step. Data comes from data.js (window.MOMENTS_DATA). */
(function () {
  'use strict';

  // ---------- data ----------
  const DATA = window.MOMENTS_DATA || { moments: [] };
  const ALL = DATA.moments;
  const POOL = ALL.filter(m => m.image);            // only moments with a picture are playable
  const ROUNDS = 5;
  const MIN_YEAR = 1950, MAX_YEAR = 2026;
  const MAX_ROUND = 3000;
  const HINT_COST = 0.2;
  const ZOOM = 2.3;                                 // zoom factor beyond "fill the frame"

  const norm = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/&/g, ' and ').replace(/[^a-z0-9]+/g, ' ').trim();
  const fold = s => String(s || '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();
  const byName = (a, b) => a.localeCompare(b, 'en', { sensitivity: 'base' });

  const TEAMS = [...new Set(ALL.flatMap(m => [m.team1, m.team2]))].sort(byName);
  const COMPS = [...new Set(ALL.map(m => m.competition))].sort(byName);
  const COMP_TYPE = {};
  ALL.forEach(m => { COMP_TYPE[m.competition] = m.competition_type; });

  // Common nicknames. Only aliases whose target exists in the data are kept.
  const TEAM_ALIASES = build({
    'Manchester United': ['man utd', 'man united', 'man u', 'mufc'],
    'Manchester City': ['man city', 'mcfc'],
    'Paris Saint-Germain': ['psg', 'paris sg', 'paris'],
    'Inter Milan': ['inter', 'internazionale', 'fc internazionale'],
    'AC Milan': ['milan'],
    'Queens Park Rangers': ['qpr'],
    'United States': ['usa', 'us', 'usmnt', 'uswnt', 'united states of america'],
    'Soviet Union': ['ussr', 'cccp'],
    'Netherlands': ['holland', 'the netherlands'],
    'Bayern Munich': ['bayern', 'fc bayern', 'bayern munchen', 'fc bayern munchen'],
    'Barcelona': ['barca', 'fc barcelona'],
    'Atlético Madrid': ['atleti', 'atletico', 'atletico de madrid'],
    'Juventus': ['juve'],
    'Bayer Leverkusen': ['leverkusen'],
    'Real Madrid': ['real'],
    'Boca Juniors': ['boca'],
    'River Plate': ['river'],
    'Crystal Palace': ['palace'],
    'Leicester City': ['leicester'],
    'Liverpool': ['lfc'],
  }, TEAMS);
  const COMP_ALIASES = build({
    'FIFA World Cup': ['world cup', 'wc', 'mundial'],
    "FIFA Women's World Cup": ['womens world cup', 'women s world cup', 'wwc'],
    'UEFA Champions League': ['champions league', 'ucl', 'cl'],
    'European Cup': ['european champion clubs cup'],
    'UEFA European Championship': ['euro', 'euros', 'european championship', 'european championships'],
    'Premier League': ['premier league', 'epl', 'prem', 'english premier league'],
    'La Liga': ['liga', 'laliga', 'primera division'],
    'International friendly': ['friendly', 'friendlies'],
    'Copa América': ['copa america'],
    'Copa Libertadores': ['libertadores'],
    'World Cup qualifying (CONMEBOL)': ['world cup qualifying', 'world cup qualifier', 'world cup qualifiers', 'wc qualifier', 'qualifier', 'qualifying'],
    'Football League First Division': ['first division', 'old first division', 'division one', 'english first division'],
  }, COMPS);

  function build(map, names) {
    const out = {};
    for (const [target, list] of Object.entries(map)) {
      if (!names.includes(target)) continue;
      list.forEach(a => { out[norm(a)] = target; });
    }
    return out;
  }
  function resolve(input, names, aliases) {
    const n = norm(input);
    if (!n) return null;
    return names.find(x => norm(x) === n) || aliases[n] || null;
  }
  const resolveTeam = s => resolve(s, TEAMS, TEAM_ALIASES);
  const resolveComp = s => resolve(s, COMPS, COMP_ALIASES);

  // ---------- scoring ----------
  // Smooth decay: 1000 exact, ~700 one year off, ~300 three off, 0 at ten or more.
  const K = 0.352, P = 1.098, FLOOR = Math.exp(-K * Math.pow(10, P));
  function seasonPoints(guess, answer) {
    const d = Math.abs(guess - answer);
    if (d >= 10) return 0;
    return Math.round(1000 * (Math.exp(-K * Math.pow(d, P)) - FLOOR) / (1 - FLOOR));
  }
  function teamPoints(g1, g2, m) {
    const left = [m.team1, m.team2];
    const marks = [g1, g2].map(g => {
      const t = resolveTeam(g);
      const i = t ? left.indexOf(t) : -1;
      if (i === -1) return false;
      left.splice(i, 1);                           // each real team can only be matched once
      return true;
    });
    return { pts: marks.filter(Boolean).length * 500, marks };
  }
  function compPoints(g, m) {
    const c = resolveComp(g);
    if (c === m.competition) return { pts: 1000, kind: 'exact' };
    if (c && COMP_TYPE[c] === m.competition_type) return { pts: 400, kind: 'type' };
    return { pts: 0, kind: 'none' };
  }
  function scoreRound(m, guess, hints) {
    const season = seasonPoints(guess.year, m.season_end_year);
    const teams = teamPoints(guess.team1, guess.team2, m);
    const comp = compPoints(guess.comp, m);
    const raw = season + teams.pts + comp.pts;
    const used = (hints.zoom ? 1 : 0) + (hints.decade ? 1 : 0);
    const total = Math.round(raw * (1 - HINT_COST * used));
    return {
      id: m.id, guess, hints: { ...hints },
      season, teams: teams.pts, teamMarks: teams.marks, comp: comp.pts, compKind: comp.kind,
      raw, penalty: raw - total, total,
    };
  }

  // ---------- seeded randomness (daily challenge, zoom focus) ----------
  function hash(str) {
    let h = 1779033703 ^ str.length;
    for (let i = 0; i < str.length; i++) {
      h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
      h = (h << 13) | (h >>> 19);
    }
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    return (h ^= h >>> 16) >>> 0;
  }
  function rng(seed) {
    let a = seed >>> 0;
    return function () {
      a = (a + 0x6D2B79F5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function shuffle(arr, rand) {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rand() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  function dailyPicks(date) {
    const ids = POOL.map(m => m.id).sort();
    return shuffle(ids, rng(hash('football-guesser|daily|' + date))).slice(0, ROUNDS);
  }
  function todayStr(d = new Date()) {
    const p = n => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
  }

  // ---------- storage (optional; the game works without it) ----------
  const store = {
    get(k, fallback) {
      try { const v = localStorage.getItem('fg.' + k); return v == null ? fallback : JSON.parse(v); }
      catch (e) { return fallback; }
    },
    set(k, v) { try { localStorage.setItem('fg.' + k, JSON.stringify(v)); } catch (e) { /* ignore */ } },
  };

  // ---------- helpers ----------
  const $ = id => document.getElementById(id);
  const fmt = n => Math.round(n).toLocaleString('en-US');
  const byId = Object.fromEntries(ALL.map(m => [m.id, m]));
  const seasonLabel = y => `${y - 1}–${String(y).slice(2)}`;
  const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
  const reduceMotion = window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches;

  function fmtDate(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
    if (!m) return iso || '';
    return new Date(+m[1], +m[2] - 1, +m[3]).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
  }
  function countUp(el, to, dur = 700) {
    const from = Number(el.dataset.v || 0);
    el.dataset.v = to;
    if (reduceMotion || from === to) { el.textContent = fmt(to); return; }
    const t0 = performance.now();
    const step = () => {
      if (Number(el.dataset.v) !== to) return;            // a newer count-up took over
      const k = clamp((performance.now() - t0) / dur, 0, 1);
      el.textContent = fmt(from + (to - from) * (1 - Math.pow(1 - k, 3)));
      if (k < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
    setTimeout(() => { if (Number(el.dataset.v) === to) el.textContent = fmt(to); }, dur + 100);
  }
  function show(name) {
    document.querySelectorAll('.screen').forEach(s => s.classList.toggle('is-active', s.id === 'screen-' + name));
    window.scrollTo(0, 0);
  }
  let toastTimer;
  function toast(msg) {
    const t = $('toast');
    t.textContent = msg;
    t.classList.add('is-on');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(() => t.classList.remove('is-on'), 2200);
  }

  // ---------- autocomplete ----------
  function setupAutocomplete(wrap, options, resolver, next) {
    const input = wrap.querySelector('input');
    const list = document.createElement('ul');
    const listId = input.id + '-list';
    list.className = 'ac-list';
    list.id = listId;
    list.hidden = true;
    list.setAttribute('role', 'listbox');
    wrap.appendChild(list);
    input.setAttribute('role', 'combobox');
    input.setAttribute('aria-autocomplete', 'list');
    input.setAttribute('aria-controls', listId);
    input.setAttribute('aria-expanded', 'false');

    let items = [], active = -1;

    function open(flag) {
      list.hidden = !flag;
      input.setAttribute('aria-expanded', String(flag));
    }
    function render() {
      const q = fold(input.value.trim());
      const nq = norm(input.value);
      let res = options.filter(o => !q || fold(o).includes(q) || norm(o).includes(nq));
      const rank = o => { const f = fold(o); return f.startsWith(q) ? 0 : f.includes(' ' + q) ? 1 : 2; };
      res.sort((a, b) => rank(a) - rank(b) || byName(a, b));
      const alias = resolver(input.value);
      if (alias && !res.includes(alias)) res.unshift(alias);
      if (res.length === 1 && res[0] === input.value) res = [];
      items = res;
      active = q && res.length ? 0 : -1;
      list.innerHTML = '';
      res.forEach((o, i) => {
        const li = document.createElement('li');
        li.setAttribute('role', 'option');
        li.id = `${listId}-${i}`;
        const at = q ? fold(o).indexOf(q) : -1;
        if (at >= 0) {
          li.append(o.slice(0, at));
          const mk = document.createElement('mark');
          mk.textContent = o.slice(at, at + q.length);
          li.append(mk, o.slice(at + q.length));
        } else li.textContent = o;
        li.addEventListener('pointerdown', e => { e.preventDefault(); choose(o); });
        list.appendChild(li);
      });
      highlight();
      open(res.length > 0 && document.activeElement === input);
    }
    function highlight() {
      [...list.children].forEach((li, i) => {
        li.classList.toggle('is-active', i === active);
        li.setAttribute('aria-selected', String(i === active));
      });
      if (active >= 0) {
        input.setAttribute('aria-activedescendant', `${listId}-${active}`);
        list.children[active].scrollIntoView({ block: 'nearest' });
      } else input.removeAttribute('aria-activedescendant');
    }
    function choose(o) {
      input.value = o;
      markKnown();
      open(false);
      if (next) {
        const n = next();
        if (n) n.focus(); else input.blur();
      }
    }
    function markKnown() { input.classList.toggle('is-known', !!resolver(input.value)); }

    input.addEventListener('input', () => { markKnown(); render(); });
    input.addEventListener('focus', render);
    input.addEventListener('blur', () => setTimeout(() => open(false), 100));
    input.addEventListener('keydown', e => {
      if (list.hidden) {
        if (e.key === 'ArrowDown') { render(); e.preventDefault(); }
        // Enter in the team boxes moves on instead of submitting; Enter in the last box submits.
        const n = e.key === 'Enter' && next && next();
        if (n) { e.preventDefault(); n.focus(); }
        return;
      }
      if (e.key === 'ArrowDown') { active = (active + 1) % items.length; highlight(); e.preventDefault(); }
      else if (e.key === 'ArrowUp') { active = (active - 1 + items.length) % items.length; highlight(); e.preventDefault(); }
      else if (e.key === 'Enter') { if (active >= 0) { choose(items[active]); e.preventDefault(); } }
      else if (e.key === 'Escape') { open(false); e.preventDefault(); }
      else if (e.key === 'Tab' && active >= 0 && input.value.trim() && !resolver(input.value)) { input.value = items[active]; markKnown(); open(false); }
    });
    return { reset() { input.value = ''; markKnown(); open(false); } };
  }

  // ---------- game state ----------
  let game = null;
  // game = { mode, date, ids, results, idx, hints:{zoom,decade}, phase, counted }

  const el = {
    img: $('photo-img'), bg: $('photo-bg'), photo: $('photo'),
    season: $('season'), seasonOut: $('season-out'), seasonSub: $('season-sub'),
    team1: $('team1'), team2: $('team2'), comp: $('comp'),
    hintZoom: $('hint-zoom'), hintDecade: $('hint-decade'),
    chipZoom: $('chip-zoom'), chipDecade: $('chip-decade'), band: $('decade-band'),
    form: $('guess-form'), reveal: $('reveal'), worth: $('worth'),
  };

  const acs = [
    setupAutocomplete(el.team1.parentElement, TEAMS, resolveTeam, () => el.team2),
    setupAutocomplete(el.team2.parentElement, TEAMS, resolveTeam, () => el.comp),
    setupAutocomplete(el.comp.parentElement, COMPS, resolveComp, () => null),
  ];

  function dailyKey(date) { return 'daily.' + date; }
  function saveDaily() {
    if (!game || game.mode !== 'daily') return;
    store.set(dailyKey(game.date), {
      ids: game.ids, results: game.results, counted: game.counted,
      current: game.phase === 'guess' ? { id: game.ids[game.idx], hints: game.hints } : null,
    });
  }

  function startDaily() {
    const date = todayStr();
    const saved = store.get(dailyKey(date), null);
    const validSaved = saved && Array.isArray(saved.ids) && saved.ids.length === ROUNDS && saved.ids.every(id => byId[id] && byId[id].image);
    game = {
      mode: 'daily', date,
      ids: validSaved ? saved.ids : dailyPicks(date),
      results: validSaved ? saved.results || [] : [],
      counted: validSaved ? !!saved.counted : false,
      idx: 0, hints: { zoom: false, decade: false }, phase: 'guess',
    };
    game.idx = game.results.length;
    if (game.idx >= ROUNDS) { showEnd(); return; }
    if (validSaved && saved.current && saved.current.id === game.ids[game.idx]) game.hints = { ...saved.current.hints };
    show('game');
    renderRound();
  }

  function startEndless() {
    const poolIds = POOL.map(m => m.id);
    let deck = store.get('deck', []).filter(id => poolIds.includes(id));
    if (deck.length < ROUNDS) {
      const fresh = shuffle(poolIds.filter(id => !deck.includes(id)), Math.random);
      deck = deck.concat(fresh);
    }
    const ids = deck.slice(0, ROUNDS);
    store.set('deck', deck.slice(ROUNDS));
    game = { mode: 'endless', date: todayStr(), ids, results: [], counted: false, idx: 0, hints: { zoom: false, decade: false }, phase: 'guess' };
    show('game');
    renderRound();
  }

  function current() { return byId[game.ids[game.idx]]; }
  function totalSoFar() { return game.results.reduce((s, r) => s + r.total, 0); }

  function renderDots() {
    const ol = $('round-dots');
    ol.innerHTML = '';
    for (let i = 0; i < ROUNDS; i++) {
      const li = document.createElement('li');
      const r = game.results[i];
      if (r) li.className = r.total >= 2000 ? 's-great' : r.total >= 1000 ? 's-ok' : 's-bad';
      else if (i === game.idx) li.className = 'is-current';
      li.title = `Round ${i + 1}` + (r ? `: ${fmt(r.total)}` : '');
      ol.appendChild(li);
    }
  }

  function setSeason(v) {
    v = clamp(Math.round(v), MIN_YEAR, MAX_YEAR);
    el.season.value = v;
    el.seasonOut.textContent = seasonLabel(v);
    el.seasonSub.textContent = `or the year ${v}`;
    el.season.style.setProperty('--fill', ((v - MIN_YEAR) / (MAX_YEAR - MIN_YEAR) * 100) + '%');
  }

  function renderRound() {
    const m = current();
    game.phase = 'guess';
    $('mode-pill').textContent = game.mode === 'daily' ? 'Daily' : 'Endless';
    $('photo-round').textContent = `Round ${game.idx + 1} / ${ROUNDS}`;
    countUp($('total-score'), totalSoFar(), 400);
    renderDots();

    el.form.hidden = false;
    el.reveal.hidden = true;
    acs.forEach(a => a.reset());
    setSeason(1988);
    el.hintZoom.disabled = false; el.hintZoom.classList.remove('is-used');
    el.hintDecade.disabled = false; el.hintDecade.classList.remove('is-used');
    el.chipZoom.hidden = false;
    el.chipDecade.hidden = true;
    el.band.hidden = true;

    loadPhoto(m);
    if (game.hints.decade) applyDecade(false);
    if (game.hints.zoom) { el.hintZoom.disabled = true; el.hintZoom.classList.add('is-used'); el.chipZoom.hidden = true; }
    updateWorth();
    saveDaily();

    const nextId = game.ids[game.idx + 1];
    if (nextId) { const pre = new Image(); pre.src = byId[nextId].image; }
  }

  let photoToken = 0;
  function loadPhoto(m) {
    const token = ++photoToken;
    el.img.classList.remove('is-ready', 'is-animating');
    el.img.style.transform = '';
    el.bg.style.backgroundImage = `url("${m.image}")`;
    el.img.onload = () => {
      if (token !== photoToken) return;
      applyZoom();
      requestAnimationFrame(() => el.img.classList.add('is-ready'));
    };
    el.img.onerror = () => { el.img.alt = 'Photo could not be loaded'; el.img.classList.add('is-ready'); };
    el.img.src = m.image;
    if (el.img.complete && el.img.naturalWidth) el.img.onload();
  }

  function zoomTransform(m) {
    const cw = el.photo.clientWidth, ch = el.photo.clientHeight;
    const nw = el.img.naturalWidth, nh = el.img.naturalHeight;
    if (!cw || !ch || !nw || !nh) return 'none';
    const fit = Math.min(cw / nw, ch / nh);
    const iw = nw * fit, ih = nh * fit, ox = (cw - iw) / 2, oy = (ch - ih) / 2;
    const s = Math.max(cw / iw, ch / ih) * ZOOM;          // always fills the frame, then zooms in further
    const ww = cw / s, wh = ch / s;
    const r = rng(hash('zoom|' + m.id));                   // same crop for everyone
    const cx = clamp(ox + (0.3 + 0.4 * r()) * iw, ox + ww / 2, ox + iw - ww / 2);
    const cy = clamp(oy + (0.3 + 0.4 * r()) * ih, oy + wh / 2, oy + ih - wh / 2);
    return `translate(${cw / 2 - s * cx}px, ${ch / 2 - s * cy}px) scale(${s})`;
  }
  function applyZoom() {
    const zoomed = game && game.phase === 'guess' && !game.hints.zoom;
    el.img.style.transform = zoomed ? zoomTransform(current()) : 'none';
  }
  function zoomOut() {
    el.img.classList.add('is-animating');
    el.img.style.transform = 'none';
    el.chipZoom.hidden = true;
  }

  function multiplier() { return 1 - HINT_COST * ((game.hints.zoom ? 1 : 0) + (game.hints.decade ? 1 : 0)); }
  function updateWorth() { el.worth.textContent = `· worth up to ${fmt(MAX_ROUND * multiplier())}`; }

  function applyDecade(moveSlider) {
    const dec = Math.floor(current().season_end_year / 10) * 10;
    const a = Math.max(dec, MIN_YEAR), b = Math.min(dec + 9, MAX_YEAR);
    el.chipDecade.textContent = `📅 The ${dec}s`;
    el.chipDecade.hidden = false;
    const span = MAX_YEAR - MIN_YEAR;
    el.band.style.left = `calc(15px + (100% - 30px) * ${(a - MIN_YEAR) / span} - 8px)`;
    el.band.style.width = `calc((100% - 30px) * ${(b - a) / span} + 16px)`;
    el.band.hidden = false;
    el.hintDecade.disabled = true;
    el.hintDecade.classList.add('is-used');
    const v = +el.season.value;
    if (moveSlider && (v < a || v > b)) setSeason(Math.min(b, a + 5));
  }

  el.hintZoom.addEventListener('click', () => {
    if (game.hints.zoom || game.phase !== 'guess') return;
    game.hints.zoom = true;
    zoomOut();
    el.hintZoom.disabled = true;
    el.hintZoom.classList.add('is-used');
    updateWorth();
    saveDaily();
  });
  el.hintDecade.addEventListener('click', () => {
    if (game.hints.decade || game.phase !== 'guess') return;
    game.hints.decade = true;
    applyDecade(true);
    updateWorth();
    saveDaily();
  });
  el.season.addEventListener('input', () => setSeason(+el.season.value));

  el.form.addEventListener('submit', e => {
    e.preventDefault();
    if (game.phase !== 'guess') return;
    const m = current();
    const result = scoreRound(m, {
      year: +el.season.value, team1: el.team1.value.trim(), team2: el.team2.value.trim(), comp: el.comp.value.trim(),
    }, game.hints);
    game.results.push(result);
    game.phase = 'reveal';
    if (!game.hints.zoom) zoomOut();
    renderReveal(m, result);
    saveDaily();
  });

  function bdRow(ico, label, answer, guessNode, pts, max, cls) {
    const li = document.createElement('li');
    li.innerHTML = `<span class="bd-ico"></span><div class="bd-main"><div class="bd-label"></div><div class="bd-answer"></div><div class="bd-guess"></div></div><span class="bd-pts"></span>`;
    li.querySelector('.bd-ico').textContent = ico;
    li.querySelector('.bd-label').textContent = label;
    li.querySelector('.bd-answer').textContent = answer;
    li.querySelector('.bd-guess').append(...guessNode);
    const p = li.querySelector('.bd-pts');
    p.textContent = cls === 'neg' ? `−${fmt(pts)}` : fmt(pts);
    p.classList.add(cls || (pts >= max ? 'full' : pts > 0 ? 'part' : 'zero'));
    if (max) {
      const bar = document.createElement('div');
      bar.className = 'bd-bar';
      const i = document.createElement('i');
      if (pts < max) i.className = 'part';
      bar.appendChild(i);
      li.appendChild(bar);
      requestAnimationFrame(() => requestAnimationFrame(() => { i.style.width = (pts / max * 100) + '%'; }));
    }
    return li;
  }
  function span(text, cls) { const s = document.createElement('span'); s.textContent = text; if (cls) s.className = cls; return s; }

  function renderReveal(m, r) {
    el.form.hidden = true;
    el.reveal.hidden = false;
    $('r-total').dataset.v = 0;
    countUp($('r-total'), r.total, 900);
    countUp($('total-score'), totalSoFar(), 900);
    renderDots();

    const ul = $('breakdown');
    ul.innerHTML = '';
    const d = Math.abs(r.guess.year - m.season_end_year);
    ul.appendChild(bdRow('📅', 'Season', m.season, [
      'You: ', span(seasonLabel(r.guess.year) + (d === 0 ? ' · spot on!' : ` · ${d} year${d > 1 ? 's' : ''} off`), d === 0 ? 'ok' : r.season > 0 ? 'part' : 'no'),
    ], r.season, 1000));

    const tg = ['You: '];
    [r.guess.team1, r.guess.team2].forEach((g, i) => {
      if (i) tg.push(' · ');
      tg.push(span(g || '—', r.teamMarks[i] ? 'ok' : 'no'));
    });
    ul.appendChild(bdRow('👕', 'Teams', `${m.team1} vs ${m.team2}`, tg, r.teams, 1000));

    ul.appendChild(bdRow('🏆', 'Competition', m.competition, [
      'You: ', span(r.guess.comp || '—', r.compKind === 'exact' ? 'ok' : r.compKind === 'type' ? 'part' : 'no'),
      r.compKind === 'type' ? ' · right kind of competition' : '',
    ], r.comp, 1000));

    if (r.penalty > 0) {
      const used = [r.hints.zoom && 'Zoom out', r.hints.decade && 'Reveal decade'].filter(Boolean);
      ul.appendChild(bdRow('💡', 'Hints', used.join(' + '), [`−${used.length * 20}% of ${fmt(r.raw)}`], r.penalty, 0, 'neg'));
    }

    $('m-title').textContent = m.title;
    $('m-score').textContent = m.score;
    $('m-comp').textContent = [m.competition, m.stage].filter(Boolean).join(' · ');
    $('m-date').textContent = fmtDate(m.date);
    $('m-venue').textContent = m.venue;
    $('m-story').textContent = m.story;
    $('btn-next').textContent = game.idx + 1 >= ROUNDS ? 'See final score' : 'Next round';

    if (r.total === MAX_ROUND) confetti(90);
    if (window.innerWidth <= 860) $('screen-game').scrollIntoView({ behavior: reduceMotion ? 'auto' : 'smooth', block: 'start' });
  }

  $('btn-next').addEventListener('click', nextRound);
  document.addEventListener('keydown', e => {
    if (e.key === 'Enter' && game && game.phase === 'reveal' && $('screen-game').classList.contains('is-active') && !/INPUT|BUTTON/.test(document.activeElement.tagName)) {
      e.preventDefault();
      nextRound();
    }
  });
  function nextRound() {
    if (!game || game.phase !== 'reveal') return;
    game.idx++;
    game.hints = { zoom: false, decade: false };
    if (game.idx >= ROUNDS) { showEnd(); return; }
    window.scrollTo(0, 0);
    renderRound();
  }

  // ---------- end screen ----------
  function squares(r) {
    const sq = (pts, full) => pts >= full ? '🟩' : pts > 0 ? '🟨' : '⬛';
    return sq(r.season, 1000) + sq(r.teams, 1000) + sq(r.comp, 1000);
  }
  function hintMarks(r) { return (r.hints.zoom ? '🔍' : '') + (r.hints.decade ? '📅' : ''); }
  function verdict(total) {
    const f = total / (MAX_ROUND * ROUNDS);
    if (f >= 0.85) return 'World class! 🌟';
    if (f >= 0.7) return "Ballon d'Or contender 🏆";
    if (f >= 0.55) return 'First-team regular 💪';
    if (f >= 0.4) return 'Solid squad player 👍';
    if (f >= 0.25) return 'Warming the bench 🪑';
    return 'Back to the academy 📚';
  }
  function shareText(g) {
    const total = g.results.reduce((s, r) => s + r.total, 0);
    const head = g.mode === 'daily' ? `⚽ Football Guesser · Daily ${g.date}` : '⚽ Football Guesser · Endless';
    const lines = g.results.map((r, i) => `${i + 1}. ${squares(r)}${hintMarks(r) ? ' ' + hintMarks(r) : ''} ${fmt(r.total)}`);
    return `${head}\n${fmt(total)} / ${fmt(MAX_ROUND * ROUNDS)}\n\n${lines.join('\n')}\n\n🟩 spot on · 🟨 close · ⬛ miss  (season · teams · competition)`;
  }

  function showEnd() {
    game.phase = 'end';
    const total = totalSoFar();
    let best = store.get('best', 0);
    let isNew = false;
    if (!game.counted) {
      isNew = total > best;
      if (isNew) { best = total; store.set('best', best); }
      store.set('played', store.get('played', 0) + 1);
      game.counted = true;
      saveDaily();
    }

    $('end-kicker').textContent = game.mode === 'daily' ? `Daily challenge · ${fmtDate(game.date)}` : 'Endless';
    $('end-total').dataset.v = 0;
    show('end');
    countUp($('end-total'), total, 1200);
    $('end-verdict').textContent = verdict(total);
    const bestEl = $('end-best');
    bestEl.innerHTML = '';
    if (isNew) bestEl.appendChild(span('🎉 New personal best!', 'new-best'));
    else bestEl.textContent = `Personal best: ${fmt(best)}`;

    const ol = $('end-rounds');
    ol.innerHTML = '';
    game.results.forEach(r => {
      const m = byId[r.id];
      const li = document.createElement('li');
      li.innerHTML = '<img alt=""><div><div class="er-title"></div><div class="er-squares"></div></div><span class="er-pts"></span>';
      li.querySelector('img').src = m.image;
      li.querySelector('.er-title').textContent = m.title;
      li.querySelector('.er-squares').textContent = squares(r) + (hintMarks(r) ? '  ' + hintMarks(r) : '');
      li.querySelector('.er-pts').textContent = fmt(r.total);
      ol.appendChild(li);
    });
    $('share-preview').textContent = shareText(game);
    $('btn-again').textContent = game.mode === 'daily' ? 'Play endless' : 'Play again';
    if (isNew && total > 0) setTimeout(() => confetti(160), 400);
  }

  async function copyText(text) {
    try {
      if (navigator.clipboard && window.isSecureContext) {
        const timeout = new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500));
        await Promise.race([navigator.clipboard.writeText(text), timeout]);
        return true;
      }
    } catch (e) { /* fall through */ }
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.setAttribute('readonly', '');
    ta.style.cssText = 'position:fixed;top:0;left:0;opacity:0;';
    document.body.appendChild(ta);
    ta.select();
    ta.setSelectionRange(0, text.length);
    let ok = false;
    try { ok = document.execCommand('copy'); } catch (e) { ok = false; }
    ta.remove();
    return ok;
  }
  $('btn-copy').addEventListener('click', async () => {
    const ok = await copyText(shareText(game));
    toast(ok ? '📋 Result copied!' : 'Could not copy. Select the text above instead.');
  });
  $('btn-again').addEventListener('click', startEndless);
  $('btn-end-home').addEventListener('click', goHome);

  // ---------- home ----------
  function goHome() {
    if (game && game.mode === 'endless' && game.phase !== 'end' && game.results.length > 0 &&
        !confirm('Leave this game? Your progress in this endless game will be lost.')) return;
    renderHome();
    show('home');
  }
  $('btn-home').addEventListener('click', goHome);
  $('btn-daily').addEventListener('click', startDaily);
  $('btn-endless').addEventListener('click', startEndless);

  function renderHome() {
    const date = todayStr();
    $('daily-date').textContent = new Date().toLocaleDateString('en-GB', { weekday: 'short', day: 'numeric', month: 'short' });
    const saved = store.get(dailyKey(date), null);
    const card = $('btn-daily');
    const done = saved && saved.results && saved.results.length >= ROUNDS;
    card.classList.toggle('is-done', !!done);
    if (done) {
      const t = saved.results.reduce((s, r) => s + r.total, 0);
      $('daily-desc').textContent = `Done! You scored ${fmt(t)}. New moments tomorrow.`;
      $('daily-cta').textContent = 'View result';
    } else if (saved && saved.results && saved.results.length) {
      $('daily-desc').textContent = `In progress: ${saved.results.length} of ${ROUNDS} rounds played.`;
      $('daily-cta').textContent = 'Resume';
    } else {
      $('daily-desc').textContent = '5 moments · the same for everyone today';
      $('daily-cta').textContent = 'Play';
    }
    const best = store.get('best', 0);
    $('stat-best').textContent = best ? fmt(best) : '–';
    $('stat-played').textContent = fmt(store.get('played', 0));
    $('stat-pool').textContent = POOL.length;
  }

  // ---------- confetti ----------
  function confetti(n) {
    if (reduceMotion) return;
    const c = $('confetti'), ctx = c.getContext('2d');
    const dpr = window.devicePixelRatio || 1;
    c.width = innerWidth * dpr; c.height = innerHeight * dpr;
    ctx.scale(dpr, dpr);
    const colors = ['#c8f53b', '#ffd23f', '#ffffff', '#ff6b5e', '#4fd1c5'];
    const parts = Array.from({ length: n }, () => ({
      x: innerWidth / 2 + (Math.random() - 0.5) * 120, y: innerHeight * 0.35,
      vx: (Math.random() - 0.5) * 14, vy: -Math.random() * 14 - 4,
      w: 6 + Math.random() * 6, h: 8 + Math.random() * 8, r: Math.random() * 6, vr: (Math.random() - 0.5) * 0.4,
      c: colors[(Math.random() * colors.length) | 0],
    }));
    const t0 = performance.now();
    (function frame(t) {
      ctx.clearRect(0, 0, innerWidth, innerHeight);
      parts.forEach(p => {
        p.vy += 0.35; p.vx *= 0.99; p.x += p.vx; p.y += p.vy; p.r += p.vr;
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.r);
        ctx.fillStyle = p.c; ctx.fillRect(-p.w / 2, -p.h / 2, p.w, p.h); ctx.restore();
      });
      if (t - t0 < 3200) requestAnimationFrame(frame);
      else ctx.clearRect(0, 0, innerWidth, innerHeight);
    })(t0);
  }

  window.addEventListener('resize', () => {
    if (game && game.phase === 'guess' && !game.hints.zoom && el.img.naturalWidth) {
      el.img.classList.remove('is-animating');
      applyZoom();
    }
  });

  // Hooks for automated tests (harmless in normal play).
  window.FG = {
    seasonPoints, teamPoints, compPoints, scoreRound, dailyPicks, resolveTeam, resolveComp, shareText, seasonLabel,
    POOL, TEAMS, COMPS, todayStr, state: () => game,
  };

  renderHome();
})();
