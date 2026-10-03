// «Письмо»: the shape and stroke order of a lesson's characters, remembered by hand — printed and handwritten.
// Look → trace → assemble → the handwritten form (trace it) → «Пауза Мейли» (a short distraction) →
// write the strokes from memory → write the handwritten form from memory → compare.
// Ported from the «Дистракт игра» prototype (Hanzi · память формы + связная пропись). Stroke data: Make Me a Hanzi
// (graphics.txt, Arphic Public License — see ARPHICPL.TXT and HANZI-LICENSE.txt next to this file).
// Strokes are checked as paths (start, direction, shape) by discrete Fréchet distance, not as calligraphy.
// The handwritten samples are the fonts Liu Jian Mao Cao (草书) and Long Cang (SIL OFL 1.1; subsets built by
// tools/build_cursive_fonts.py). Joins cannot be recovered from a font outline, so the handwritten steps are
// not scored: the learner's own lines stay on the paper and the learner compares them with the sample.
(function () {
  'use strict';
  const KEY = 'chao_hanzi_progress', STYLE_KEY = 'chao_cursive_style', SESSION = 600, REST = 8, BEAT = 1.1;
  const DAYS = [0, 1, 3, 7, 14, 30];
  const STYLES = [['ChaoLiuCursive', 'cursive-liujianmaocao.woff', 'Пропись: 草书 · связная'], ['ChaoLongCang', 'cursive-longcang.woff', 'Пропись: разборчивая']];
  let fonts = null;
  const loadFonts = () => fonts || (fonts = Promise.all(STYLES.map(([family, file]) => new FontFace(family, `url(/hanzi/${file})`).load().then(f => document.fonts.add(f))))
    .then(() => true, () => { fonts = null; return false; }));

  // Quadratic smoothing of the learner's handwriting keeps corners legible and never invents joins between strokes.
  function smooth(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = { x: (b.x + points[i + 1].x) / 2, y: (b.y + points[i + 1].y) / 2 };
      for (let j = 1; j <= 4; j++) { const t = j / 4; out.push({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * b.x + t * t * c.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * b.y + t * t * c.y, pressure: b.pressure }); }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  // ---- geometry ----
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);
  function frechet(a, b) {
    if (!a.length || !b.length) return Infinity;
    let prev = new Array(b.length).fill(Infinity);
    for (let i = 0; i < a.length; i++) {
      const row = new Array(b.length);
      for (let j = 0; j < b.length; j++) {
        const d = dist(a[i], b[j]);
        row[j] = i === 0 && j === 0 ? d : Math.max(d, Math.min(i ? prev[j] : Infinity, j ? row[j - 1] : Infinity, i && j ? prev[j - 1] : Infinity));
      }
      prev = row;
    }
    return prev[b.length - 1];
  }
  function resample(points, steps = 32) {
    if (points.length < 2) return points;
    const sums = [0];
    for (let i = 1; i < points.length; i++) sums.push(sums[i - 1] + dist(points[i - 1], points[i]));
    const total = sums[sums.length - 1];
    if (!total) return [points[0]];
    let j = 1;
    return Array.from({ length: steps + 1 }, (_, i) => {
      const d = total * i / steps;
      while (j < sums.length - 1 && sums[j] < d) j++;
      const t = (d - sums[j - 1]) / (sums[j] - sums[j - 1] || 1);
      return { x: points[j - 1].x + (points[j].x - points[j - 1].x) * t, y: points[j - 1].y + (points[j].y - points[j - 1].y) * t };
    });
  }

  // ---- spaced repetition: on your own → 1, 3, 7, 14, 30 days; with a hint → again in a minute ----
  function review(p, passed, now = Date.now()) {
    p = p || { successes: 0, attempts: 0, level: 0, due: 0 };
    const level = passed ? Math.min(p.level + 1, 5) : 0;
    return { successes: p.successes + (passed ? 1 : 0), attempts: p.attempts + 1, level, due: now + (passed ? DAYS[level] * 86400000 : 60000) };
  }
  const loadProgress = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const saveProgress = r => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private window: the session still works */ } };

  let strokes = null;
  const loadStrokes = () => strokes || (strokes = fetch('/hanzi/strokes.json').then(r => r.ok ? r.json() : []).then(list => new Map(list.map(c => [c.glyph, c]))).catch(() => new Map()));

  const STEPS = [['study', 'Посмотреть'], ['trace', 'Провести'], ['assemble', 'Собрать'], ['hand', 'Пропись'], ['rest', 'Пауза Мейли'], ['recall', 'Вспомнить'], ['handRecall', 'Пропись по памяти']];
  const TEXT = {
    study: ['Рассмотрите форму', 'Светящаяся точка показывает порядок и направление черт. Начните, когда будете готовы.'],
    trace: ['Проведите по дорожке', 'Начните с подсвеченной точки и ведите черту целиком. Скорость — любая.'],
    assemble: ['Соберите иероглиф', 'Перетащите черты в рамку. Точки в рамке — середины черт.'],
    hand: ['Рукописная форма', 'Тот же знак, написанный от руки: сравните с печатным — что сокращено, где появились соединения. Обведите бледный образец; линии остаются вашими.'],
    rest: ['Пауза Мейли', 'Касайтесь только светящейся фигуры. Короткое отвлечение не даёт держать иероглиф в голове — через 8 секунд вы вспомните его по-настоящему.'],
    recall: ['Напишите по памяти', 'Черты — в изученном порядке. Образец скрыт; подсказка покажет его на 2,5 секунды, но повторение засчитается как с помощью.'],
    handRecall: ['Пропись по памяти', 'Теперь напишите тот же знак от руки, рукописной формой. Подсказка покажет образец на 2,5 секунды.'],
    end: ['Сессия завершена', 'Прогресс сохранён. Можно начать новую короткую сессию.']
  };
  const INK = ['hand', 'handRecall'];

  function mount(root, opts = {}) {
    root.classList.add('hw');
    root.innerHTML = `
      <div class="hw-top"><div class="hw-steps">${STEPS.map(([k, t], i) => `<span data-hw-step="${k}">${i + 1} · ${t}</span>`).join('')}</div><span class="hw-timer" title="Сессия — 10 минут">10:00</span></div>
      <div class="hw-strip" aria-label="Иероглифы урока"></div>
      <div class="hw-stage"><div class="hw-pad"><canvas aria-label="Поле для изучения и написания иероглифа"></canvas></div>
        <div class="hw-meaning" hidden><button type="button" class="hw-say" title="Послушать">🔊</button><span class="hw-word chinese-serif"></span><span class="hw-py chinese-sans"></span><span class="hw-tr"></span></div></div>
      <div class="hw-text"><strong class="hw-title"></strong><p class="hw-instr"></p></div>
      <div class="hw-actions"><button type="button" class="hw-undo">↶ Отменить</button><button type="button" class="hw-clear">Очистить</button><button type="button" class="hw-hint">Подсказка</button><button type="button" class="hw-primary">Начать</button><button type="button" class="hw-pause" hidden>Пауза</button>
        <select class="hw-style" aria-label="Почерк образца">${STYLES.map(([f, , t]) => `<option value="${f}">${t}</option>`).join('')}</select></div>
      <div class="hw-status"></div>`;
    const $ = s => root.querySelector(s), canvas = $('canvas'), ctx = canvas.getContext('2d');
    let list = [], records = loadProgress(), current = 0, phase = 'study', w = 400, h = 300, size = 220;
    let stroke = 0, phaseTime = 0, last = performance.now(), sessionStart = 0, paused = false, finished = false, assisted = false;
    let trace = [], accepted = [], pieces = [], selected = -1, offset = { x: 0, y: 0 }, hintUntil = 0, flash = 0, flashGood = true, restTarget = 0, colors = null, colorsAt = 0;
    // The handwritten steps: the learner's own lines in 0..1 coordinates of the writing square; they run only once the fonts are in.
    let style = STYLES[0][0], hand = false, ink = [], draft = [], inkPointer = null, overlay = false;
    try { const s = localStorage.getItem(STYLE_KEY); if (STYLES.some(([f]) => f === s)) style = s; } catch { /* default style */ }
    $('.hw-style').value = style;
    loadFonts().then(ok => { hand = ok; ui(); });

    const glyph = () => list[current];
    const center = () => ({ x: w / 2, y: h * .46 });
    const toCanvas = p => ({ x: center().x + (p.x - 50) * size / 100, y: center().y + (p.y - 50) * size / 100 });
    const median = i => glyph().medians[i].map(([x, y]) => ({ x: x / 1024 * 100, y: (900 - y) / 1024 * 100 }));
    const reference = i => resample(median(i).map(toCanvas), 48);
    const midpoint = i => { const p = reference(i); return p[Math.floor(p.length / 2)]; };
    // Colours follow the platform theme (light / dark).
    function palette() {
      const now = performance.now();
      if (colors && now - colorsAt < 500) return colors;
      const s = getComputedStyle(root), v = (n, f) => (s.getPropertyValue(n) || '').trim() || f;
      colorsAt = now;
      return colors = { ink: v('--ink-black', '#272F2B'), teal: v('--hsk5-teal', '#1F5F61'), border: v('--hsk5-border', '#CBD9D9'), gold: v('--tea-gold', '#B87333'), green: v('--success-green', '#2E7D5A'), gray: v('--ink-gray', '#55514B'), paper: v('--paper-white', '#FFFEFA') };
    }

    function strip() {
      const box = $('.hw-strip'), hide = phase === 'rest' || phase === 'recall' || phase === 'handRecall';
      box.replaceChildren();
      box.classList.toggle('concealed', hide);
      list.forEach((c, i) => {
        const p = records[c.glyph], b = document.createElement('button');
        b.type = 'button'; b.className = 'hw-chip' + (i === current ? ' active' : '') + (p && p.level ? ' learned' : '');
        b.textContent = c.glyph;
        if (hand) { const s = document.createElement('span'); s.className = 'hw-chip-hand'; s.style.fontFamily = style; s.textContent = c.glyph; b.append(s); }
        const small = document.createElement('small');
        small.textContent = !p ? 'новый' : p.due <= Date.now() ? 'повторить' : 'ур. ' + p.level;
        b.append(small); b.disabled = hide; b.title = c.word && c.word !== c.glyph ? `${c.glyph} — из слова ${c.word}` : c.glyph;
        b.onclick = () => { if (finished) return; current = i; setPhase('study'); };
        box.append(b);
      });
      const learned = list.filter(c => records[c.glyph] && records[c.glyph].level).length, due = list.filter(c => records[c.glyph] && records[c.glyph].due <= Date.now()).length;
      $('.hw-status').textContent = list.length ? `Вспомнено самостоятельно: ${learned} из ${list.length} · к повторению: ${due}` : '';
    }
    function ui() {
      if (!list.length) return;
      const show = phase === 'study' || phase === 'result', c = glyph();
      $('.hw-meaning').hidden = !show;
      $('.hw-word').textContent = show ? (c.word && c.word !== c.glyph ? c.word : c.glyph) : '';
      $('.hw-py').textContent = show ? (c.word && c.word !== c.glyph ? c.wordPy || c.pinyin || '' : c.pinyin || c.wordPy || '') : '';
      $('.hw-tr').textContent = show ? (c.word && c.word !== c.glyph ? c.wordTr || c.translation || '' : c.translation || c.wordTr || '') : '';
      const t = phase === 'result'
        ? (assisted ? ['Вернёмся к этой форме ещё раз', 'Подсказка помогла. Иероглиф вернётся скоро — для самостоятельного повторения.'] : ['Форма восстановлена', 'Вы вспомнили сами. Следующее повторение назначено по вашему прогрессу.'])
        : TEXT[phase];
      $('.hw-title').textContent = t[0];
      $('.hw-instr').textContent = (phase === 'trace' || phase === 'recall' ? `Черта ${stroke + 1} из ${c.medians.length}. ` : '') + t[1]
        + (phase === 'result' && ink.length ? ' Ваша пропись — на поле: наложите образец и сравните силуэт, пропорции и соединения.' : '');
      const primary = $('.hw-primary'), inked = phase === 'result' && ink.length > 0;
      primary.hidden = ['trace', 'assemble', 'rest', 'recall'].includes(phase);
      primary.textContent = { study: 'Начать', hand: 'Дальше → Пауза Мейли', handRecall: 'Сравнить с образцом', result: 'Следующий иероглиф' }[phase] || 'Новая сессия';
      primary.disabled = INK.includes(phase) && !ink.length;
      $('.hw-hint').hidden = !['trace', 'assemble', 'recall', 'handRecall'].includes(phase) && !inked;
      $('.hw-hint').textContent = inked ? (overlay ? 'Скрыть образец' : 'Наложить образец') : 'Подсказка';
      $('.hw-undo').hidden = $('.hw-clear').hidden = !INK.includes(phase);
      $('.hw-style').hidden = !hand || !(INK.includes(phase) || inked || phase === 'study');
      $('.hw-pause').hidden = !sessionStart || phase === 'end';
      $('.hw-pause').textContent = paused ? 'Продолжить' : 'Пауза';
      root.querySelectorAll('[data-hw-step]').forEach(el => el.classList.toggle('active', el.dataset.hwStep === phase));
      strip();
    }
    function setPhase(next) {
      phase = next; phaseTime = 0; trace = []; selected = -1; hintUntil = 0; draft = []; inkPointer = null; overlay = false;
      if (next === 'study' || INK.includes(next)) ink = [];
      if (next === 'study') { stroke = 0; accepted = []; assisted = false; }
      if (next === 'trace' || next === 'recall') { stroke = 0; accepted = []; }
      if (next === 'assemble') pieces = glyph().medians.map((_, i) => ({ x: w * (i + 1) / (glyph().medians.length + 1), y: h * .88, locked: false }));
      if (next === 'rest') restTarget = Math.floor(Math.random() * 3);
      ui();
    }
    function feedback(ok) { flashGood = ok; flash = ok ? .6 : .4; if (ok) navigator.vibrate?.(20); }
    function nextIndex(exclude) {
      const now = Date.now(), rank = p => !p ? 1 : p.due <= now ? 0 : 2;
      const order = list.map((c, i) => i).filter(i => list[i].glyph !== exclude);
      order.sort((a, b) => { const x = records[list[a].glyph], y = records[list[b].glyph]; return rank(x) - rank(y) || ((x && x.due) || 0) - ((y && y.due) || 0) || a - b; });
      return order.length ? order[0] : current;
    }
    function completeRecall() {
      const passed = !assisted, g = glyph().glyph;
      records[g] = review(records[g], passed); saveProgress(records);
      feedback(true); opts.onResult?.(g, passed);
      setPhase(hand ? 'handRecall' : 'result');
    }
    function endSession() {
      finished = true; paused = false; setPhase('end'); saveProgress(records);
      root.dispatchEvent(new CustomEvent('distractorcomplete', { bubbles: true }));
      window.onDistractorComplete?.();
    }

    // ---- drawing ----
    function line(p, color, width = 8) {
      if (!p.length) return;
      ctx.beginPath(); p.forEach((v, i) => i ? ctx.lineTo(v.x, v.y) : ctx.moveTo(v.x, v.y));
      ctx.strokeStyle = color; ctx.lineWidth = width; ctx.lineCap = 'round'; ctx.lineJoin = 'round'; ctx.stroke();
    }
    function glyphFill(color, alpha = 1) {
      ctx.save(); const c = center();
      ctx.globalAlpha = alpha; ctx.translate(c.x - size / 2, c.y - size / 2); ctx.scale(size / 1024, -size / 1024); ctx.translate(0, -900);
      ctx.fillStyle = color; for (const path of glyph().paths) ctx.fill(new Path2D(path));
      ctx.restore();
    }
    // The handwritten sample, fitted into the writing square.
    function script(color, alpha, c = center(), s = size) {
      const g = glyph().glyph;
      ctx.save(); ctx.font = `${s * 1.24}px ${style}`;
      const m = ctx.measureText(g), inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const fit = Math.min(s * .88 / (inkW || 1), s * .88 / (inkH || 1));
      ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.translate(c.x, c.y); ctx.scale(fit, fit);
      ctx.fillText(g, -inkW / 2 + m.actualBoundingBoxLeft, inkH / 2 - m.actualBoundingBoxDescent);
      ctx.restore();
    }
    function handwriting(s, color) {
      const c = center(), x0 = c.x - size / 2, y0 = c.y - size / 2, p = smooth(s);
      ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < p.length; i++) {
        ctx.lineWidth = (1.4 + (p[i].pressure ?? .5) * 3) * size / 230;
        ctx.beginPath(); ctx.moveTo(x0 + p[i - 1].x * size, y0 + p[i - 1].y * size); ctx.lineTo(x0 + p[i].x * size, y0 + p[i].y * size); ctx.stroke();
      }
    }
    function dot(p, r = 6) { const k = palette(); ctx.fillStyle = k.gold; ctx.shadowColor = k.gold; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(p.x, p.y, r, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0; }
    function grid() {
      const c = center(), s = size, k = palette();
      ctx.strokeStyle = k.border; ctx.lineWidth = 1; ctx.strokeRect(c.x - s / 2, c.y - s / 2, s, s);
      ctx.setLineDash([4, 7]); line([{ x: c.x - s / 2, y: c.y }, { x: c.x + s / 2, y: c.y }], k.border, 1); line([{ x: c.x, y: c.y - s / 2 }, { x: c.x, y: c.y + s / 2 }], k.border, 1); ctx.setLineDash([]);
    }
    const visible = () => root.offsetParent !== null && !document.hidden;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(.1, (now - last) / 1000); last = now;
      if (!visible()) { if (sessionStart && !finished && !paused) { paused = true; trace = []; selected = -1; ui(); } return; }
      if (sessionStart && !finished && !paused) {
        const remain = Math.max(0, SESSION - (now - sessionStart) / 1000);
        $('.hw-timer').textContent = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(Math.floor(remain % 60)).padStart(2, '0')}`;
        if (remain === 0) endSession();
      }
      if (!paused) phaseTime += dt;
      flash = Math.max(0, flash - dt);
      ctx.clearRect(0, 0, w, h);
      if (!list.length) return;
      const k = palette(), c = center(), thick = Math.max(5, size * .026);
      if (INK.includes(phase) || (phase === 'result' && ink.length)) {
        grid();
        if (phase === 'hand' || (phase === 'handRecall' && now < hintUntil)) script(k.ink, .2);
        ctx.save(); ctx.beginPath(); ctx.rect(c.x - size / 2, c.y - size / 2, size, size); ctx.clip();
        for (const s of ink) handwriting(s, k.ink);
        handwriting(draft, k.ink);
        if (phase === 'result' && overlay) script(k.gold, .5);
        ctx.restore();
      } else if (phase === 'study' || phase === 'result') {
        grid(); glyphFill(k.teal, .85);
        // Beside the printed form: the same character handwritten, where the field is wide enough.
        const side = (w - size) / 2, s = Math.min(side - 24, size * .62);
        if (hand && s >= 70) {
          const at = { x: c.x + size / 2 + side / 2, y: c.y };
          script(k.ink, .9, at, s);
          ctx.font = '11px system-ui, sans-serif'; ctx.fillStyle = k.gray; ctx.textAlign = 'center';
          ctx.fillText('пропись', at.x, at.y + s / 2 + 16); ctx.textAlign = 'start';
        }
        if (phase === 'study') { const n = glyph().medians.length, i = Math.floor(phaseTime / BEAT) % n, p = reference(i), t = (phaseTime % BEAT) / BEAT; line(p.slice(0, Math.max(1, Math.floor(t * p.length))), k.gold, 5); dot(p[Math.min(p.length - 1, Math.floor(t * p.length))]); }
      }
      if (phase === 'trace' || phase === 'recall') {
        grid();
        if (phase === 'trace' || now < hintUntil) { glyphFill(k.teal, .16); const p = reference(stroke); line(p, k.border, 5); dot(p[0]); if (phase === 'trace') dot(p[Math.floor(((phaseTime % BEAT) / BEAT) * (p.length - 1))], 4); }
        for (const p of accepted) line(p, k.green, thick);
        line(trace, k.gold, thick);
      }
      if (phase === 'assemble') {
        grid(); if (now < hintUntil) glyphFill(k.teal, .16);
        pieces.forEach((p, i) => {
          const m = midpoint(i);
          if (!p.locked) { ctx.fillStyle = k.gray; ctx.beginPath(); ctx.arc(m.x, m.y, 3, 0, Math.PI * 2); ctx.fill(); }
          line(reference(i).map(v => ({ x: v.x + p.x - m.x, y: v.y + p.y - m.y })), p.locked ? k.green : k.gold, thick);
        });
      }
      if (phase === 'rest') {
        const y = h * .44;
        for (let i = 0; i < 3; i++) {
          const x = w * (i + 1) / 4, on = i === restTarget;
          ctx.fillStyle = on ? k.gold : k.border; ctx.strokeStyle = on ? k.gold : k.border; ctx.lineWidth = 2;
          if (on) { ctx.shadowColor = k.gold; ctx.shadowBlur = 16; }
          ctx.beginPath();
          if (i === 0) ctx.arc(x, y, 25, 0, Math.PI * 2);
          if (i === 1) ctx.rect(x - 22, y - 22, 44, 44);
          if (i === 2) { ctx.moveTo(x, y - 28); ctx.lineTo(x + 27, y + 23); ctx.lineTo(x - 27, y + 23); ctx.closePath(); }
          ctx.fill(); ctx.stroke(); ctx.shadowBlur = 0;
        }
        ctx.beginPath(); ctx.strokeStyle = k.teal; ctx.lineWidth = 3; ctx.arc(c.x, h * .8, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, phaseTime / REST)); ctx.stroke();
        if (phaseTime >= REST && !paused) setPhase('recall');
      }
      if (phase === 'end') { ctx.font = '56px serif'; ctx.textAlign = 'center'; ctx.fillStyle = k.teal; ctx.fillText('◎', c.x, c.y + 18); }
      if (flash > 0) { ctx.globalAlpha = flash; ctx.strokeStyle = flashGood ? k.green : k.gold; ctx.lineWidth = 3; ctx.strokeRect(c.x - size / 2 - 7, c.y - size / 2 - 7, size + 14, size + 14); ctx.globalAlpha = 1; }
      if (paused) { ctx.globalAlpha = .82; ctx.fillStyle = k.paper; ctx.fillRect(0, 0, w, h); ctx.globalAlpha = 1; ctx.fillStyle = k.teal; ctx.font = '28px sans-serif'; ctx.textAlign = 'center'; ctx.fillText('Ⅱ', c.x, c.y); }
    }
    function resize() {
      const oldW = w, oldH = h, r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      inkPointer = null; draft = [];
      w = r.width; h = r.height; size = Math.min(w * .7, h * .7, 290);
      canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      trace = []; selected = -1;
      if (list.length && phase === 'assemble') pieces.forEach((p, i) => { if (p.locked) Object.assign(p, midpoint(i)); else { p.x = p.x / oldW * w; p.y = p.y / oldH * h; } });
      if (list.length && accepted.length) accepted = Array.from({ length: stroke }, (_, i) => reference(i));
    }
    new ResizeObserver(resize).observe(canvas);

    // ---- input ----
    const at = e => { const r = canvas.getBoundingClientRect(); return { x: e.clientX - r.left, y: e.clientY - r.top }; };
    // Handwriting: free lines inside the writing square, with the pen's pressure when there is one.
    const inkAt = e => { const p = at(e), c = center(); return { x: (p.x - c.x) / size + .5, y: (p.y - c.y) / size + .5, pressure: e.pointerType === 'pen' ? Math.max(.15, e.pressure) : .5 }; };
    canvas.addEventListener('pointerdown', e => {
      if (paused || finished || !INK.includes(phase) || inkPointer !== null) return;
      const p = inkAt(e);
      if (p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      inkPointer = e.pointerId; draft = [p];
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the stroke still works inside the canvas */ }
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== inkPointer) return;
      const p = inkAt(e), q = draft[draft.length - 1];
      if (draft.length < 2000 && Math.hypot(p.x - q.x, p.y - q.y) * size > .5) draft.push(p);
    });
    canvas.addEventListener('pointerup', e => {
      if (e.pointerId !== inkPointer) return;
      draft.push(inkAt(e));
      if (draft.some(p => Math.hypot(p.x - draft[0].x, p.y - draft[0].y) * size > 1)) ink.push(draft);
      inkPointer = null; draft = []; ui();
    });
    canvas.addEventListener('pointerdown', e => {
      if (paused || finished || !list.length || INK.includes(phase) || selected >= 0 || trace.length) return;
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the stroke still works inside the canvas */ }
      const p = at(e);
      if (phase === 'trace' || phase === 'recall') trace = [p];
      if (phase === 'assemble') {
        selected = pieces.findLastIndex((b, i) => !b.locked && reference(i).some(v => { const m = midpoint(i); return dist(p, { x: v.x + b.x - m.x, y: v.y + b.y - m.y }) < 18; }));
        if (selected >= 0) offset = { x: p.x - pieces[selected].x, y: p.y - pieces[selected].y };
      }
      if (phase === 'rest' && dist(p, { x: w * (restTarget + 1) / 4, y: h * .44 }) < 36) { feedback(true); restTarget = (restTarget + 1 + Math.floor(Math.random() * 2)) % 3; }
    });
    canvas.addEventListener('pointermove', e => {
      if (paused) return;
      const p = at(e);
      if (trace.length && trace.length < 1500 && dist(trace[trace.length - 1], p) > 1) trace.push(p);
      if (selected >= 0) { pieces[selected].x = p.x - offset.x; pieces[selected].y = p.y - offset.y; }
    });
    canvas.addEventListener('pointerup', e => {
      if (paused) return;
      if ((phase === 'trace' || phase === 'recall') && trace.length) {
        trace.push(at(e));
        const ref = reference(stroke), ok = frechet(resample(trace, 48), ref) < Math.max(13, size * .085);
        feedback(ok);
        if (ok) { accepted.push(ref); stroke++; if (stroke === glyph().medians.length) { if (phase === 'trace') setPhase('assemble'); else completeRecall(); } else ui(); }
        else $('.hw-instr').textContent = 'Ещё раз: проверьте начало, направление и форму черты.';
        trace = [];
      }
      if (phase === 'assemble' && selected >= 0) {
        const b = pieces[selected], m = midpoint(selected);
        if (dist(b, m) < Math.max(15, size * .08)) { Object.assign(b, m); b.locked = true; feedback(true); }
        else { feedback(false); b.x = w * (selected + 1) / (glyph().medians.length + 1); b.y = h * .88; }   // a miss goes back to its place below
        selected = -1;
        if (pieces.every(p => p.locked)) setPhase(hand ? 'hand' : 'rest');
      }
    });
    canvas.addEventListener('pointercancel', () => { trace = []; selected = -1; inkPointer = null; draft = []; });
    $('.hw-primary').onclick = () => {
      if (!list.length) return;
      if (phase === 'end') { finished = false; sessionStart = 0; paused = false; $('.hw-timer').textContent = '10:00'; current = nextIndex(''); setPhase('study'); return; }
      if (!sessionStart) sessionStart = performance.now();
      if (phase === 'study') setPhase('trace');
      else if (phase === 'hand') setPhase('rest');
      else if (phase === 'handRecall') setPhase('result');
      else if (phase === 'result') { current = nextIndex(glyph().glyph); setPhase('study'); }
    };
    $('.hw-hint').onclick = () => {
      if (paused) return;
      if (phase === 'result') { overlay = !overlay; ui(); return; }
      hintUntil = performance.now() + 2500;   // in «Пропись по памяти» it does not touch the repetition already scheduled
      if (phase === 'recall') { assisted = true; $('.hw-instr').textContent = 'Образец появится на 2,5 секунды. Это повторение засчитается как выполненное с подсказкой.'; }
    };
    $('.hw-undo').onclick = () => { ink.pop(); ui(); };
    $('.hw-clear').onclick = () => { ink = []; ui(); };
    $('.hw-style').onchange = e => { style = e.target.value; try { localStorage.setItem(STYLE_KEY, style); } catch { /* default next time */ } ui(); };
    $('.hw-pause').onclick =() => { paused = !paused; if (!paused) last = performance.now(); trace = []; selected = -1; ui(); };
    $('.hw-say').onclick = () => { const c = glyph(); if (c) opts.speak?.(c.word || c.glyph, $('.hw-say')); };
    requestAnimationFrame(frame);

    return {
      // A new lesson: its characters (those with stroke data), progress kept per character across lessons.
      setChars(chars) {
        const same = chars.map(c => c.glyph).join('') === list.map(c => c.glyph).join('');
        if (same && list.length) return;
        list = chars; records = loadProgress(); finished = false; sessionStart = 0; paused = false;
        $('.hw-timer').textContent = '10:00';
        if (!list.length) { root.querySelector('.hw-title').textContent = 'Для иероглифов этого урока пока нет данных о чертах'; root.querySelector('.hw-instr').textContent = ''; $('.hw-meaning').hidden = true; $('.hw-primary').hidden = true; $('.hw-hint').hidden = true; strip(); return; }
        current = nextIndex(''); resize(); setPhase('study');
      }
    };
  }

  window.HanziWrite = { mount, loadStrokes };
})();
