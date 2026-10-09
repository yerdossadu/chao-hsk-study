// «Письмо» → «Прописные»: from the printed character to a living handwritten form.
// Look → trace the handwritten sample → copy it without the sample → «Пауза Мейли» → write from memory → compare.
// Ported from the «Дистракт игра» prototype (cursive.html). Samples are the handwritten fonts Liu Jian Mao Cao (草书)
// and Long Cang (SIL OFL 1.1; subsets built by tools/build_cursive_fonts.py, licences next to this file).
// Joins and stroke order cannot be recovered from a font outline, so nothing here is scored automatically:
// the learner's own lines stay on the paper, and the learner compares them with the sample and judges.
(function () {
  'use strict';
  const KEY = 'chao_cursive_practice', STYLE_KEY = 'chao_cursive_style', SESSION = 600, REST = 8;
  const STYLES = [['ChaoLiuCursive', 'cursive-liujianmaocao.woff', '草书 · сокращённый и связный'], ['ChaoLongCang', 'cursive-longcang.woff', 'Более разборчивый рукописный']];
  const THEMES = [
    { title: 'Рукописный 扌', tip: 'Сравните компактную левую часть 扌 и направление правой части. Замечайте соединения в образце; не добавляйте их ко всем штрихам подряд.',
      items: [{ glyph: '托', pinyin: 'tuō', translation: 'поддерживать; поручать' }, { glyph: '扬', pinyin: 'yáng', translation: 'поднимать; распространять' },
              { glyph: '找', pinyin: 'zhǎo', translation: 'искать' }, { glyph: '把', pinyin: 'bǎ', translation: 'держать' }] },
    { title: 'Рукописный 讠', tip: 'У рукописного 讠 меняются очертания и интервалы. Сначала обведите форму, затем попробуйте воспроизвести её без подложки.',
      items: [{ glyph: '说', pinyin: 'shuō', translation: 'говорить' }, { glyph: '语', pinyin: 'yǔ', translation: 'язык; речь' },
              { glyph: '认', pinyin: 'rèn', translation: 'узнавать; признавать' }, { glyph: '谢', pinyin: 'xiè', translation: 'благодарить' }] },
    { title: 'Рукописный 心', tip: 'Рассмотрите сокращённое движение в нижней части. Сохраняйте силуэт всего знака и свободное пространство между его частями.',
      items: [{ glyph: '想', pinyin: 'xiǎng', translation: 'думать; хотеть' }, { glyph: '感', pinyin: 'gǎn', translation: 'чувствовать' },
              { glyph: '意', pinyin: 'yì', translation: 'мысль; смысл' }, { glyph: '念', pinyin: 'niàn', translation: 'думать о; вспоминать' }] }
  ];
  const LESSON_TIP = 'Иероглифы этого урока в рукописной форме. Сравните их с печатными: что сокращено, где появились соединения.';
  const STEPS = [['order', 'Порядок черт'], ['observe', 'Рассмотреть'], ['trace', 'Обвести'], ['copy', 'Переписать'], ['rest', 'Пауза Мейли'], ['memory', 'По памяти'], ['compare', 'Оценить']];
  const BEAT = 1.1;
  const TEXT = {
    order: ['Порядок черт', 'Рукописная форма прописывается черта за чертой, светящаяся точка ведёт по ней в направлении письма. Порядок тот же, что у печатного знака, — черты лишь сокращаются и соединяются. Рядом — печатный знак.', 'Дальше: сравнить формы'],
    observe: ['Сравните две формы', 'На поле — рукописная форма, над ним — печатный знак. Рассмотрите сокращения и соединения.', 'Начать обводку'],
    trace: ['Обводка образца', 'Обведите бледный рукописный образец в своём темпе. Поднимайте перо там, где это нужно.', 'Писать без подложки'],
    copy: ['Копирование без подложки', 'Перепишите форму с образца в ряду выше в пустую клетку. Линии остаются вашими — эталон их не подменяет.', 'Пауза → по памяти'],
    rest: ['Пауза Мейли', 'Касайтесь только светящейся фигуры. Короткое отвлечение — и через 8 секунд вы напишете знак по памяти.', ''],
    memory: ['Письмо по памяти', 'Напишите изученную рукописную форму без образца. Подсказка покажет его на 2,5 секунды, но попытка засчитается как с помощью.', 'Сравнить с образцом'],
    compare: ['Сравнение · самооценка', 'Наложите образец и сравните силуэт, пропорции и соединения. Оценка — ваша, не автоматическая.', 'Получилось · дальше'],
    end: ['Сессия завершена', '10 минут практики прошли. Отдохните перед следующей сессией.', 'Новая сессия']
  };

  // The fonts are loaded only when the learner first opens this mode.
  let fonts = null;
  const loadFonts = () => fonts || (fonts = Promise.all(STYLES.map(([family, file]) => new FontFace(family, `url(/hanzi/${file})`).load().then(f => document.fonts.add(f))))
    .then(() => true, () => { fonts = null; return false; }));
  const loadPractice = () => { try { const v = JSON.parse(localStorage.getItem(KEY) || '{}'); return v && typeof v === 'object' && !Array.isArray(v) ? v : {}; } catch { return {}; } };
  const savePractice = r => { try { localStorage.setItem(KEY, JSON.stringify(r)); } catch { /* private window: the session still works */ } };
  const dist = (a, b) => Math.hypot(a.x - b.x, a.y - b.y);

  // Quadratic smoothing keeps corners legible and never invents connections between strokes.
  function smooth(points) {
    if (points.length < 3) return points;
    const out = [points[0]];
    for (let i = 1; i < points.length - 1; i++) {
      const a = out[out.length - 1], b = points[i], c = { x: (b.x + points[i + 1].x) / 2, y: (b.y + points[i + 1].y) / 2, pressure: b.pressure };
      for (let j = 1; j <= 4; j++) { const t = j / 4; out.push({ x: (1 - t) ** 2 * a.x + 2 * (1 - t) * t * b.x + t * t * c.x, y: (1 - t) ** 2 * a.y + 2 * (1 - t) * t * b.y + t * t * c.y, pressure: b.pressure }); }
    }
    out.push(points[points.length - 1]);
    return out;
  }

  function mount(root, opts = {}) {
    root.classList.add('hw', 'hc');
    root.innerHTML = `
      <div class="hw-top"><div class="hw-steps">${STEPS.map(([k, t], i) => `<span data-hc-step="${k}">${i + 1} · ${t}</span>`).join('')}</div><span class="hw-timer" title="Сессия — 10 минут">10:00</span></div>
      <div class="hc-bar"><div class="hc-sets" aria-label="Наборы прописи"></div>
        <select class="hc-style" aria-label="Почерк образца">${STYLES.map(([f, , t]) => `<option value="${f}">${t}</option>`).join('')}</select></div>
      <p class="hc-tip"></p>
      <div class="hc-samples" aria-label="Образцы иероглифов"></div>
      <div class="hc-word"><span class="hc-print chinese-sans"></span><span class="hc-gloss"><span class="hw-py chinese-sans"></span><span class="hw-tr"></span></span><button type="button" class="hw-say" title="Послушать">🔊</button><em>печатный → рукописный</em></div>
      <div class="hc-pad"><canvas aria-label="Тетрадь для рукописного письма"></canvas></div>
      <div class="hw-text"><strong class="hw-title"></strong><p class="hw-instr"></p></div>
      <div class="hw-actions"><button type="button" class="hc-undo">↶ Отменить</button><button type="button" class="hc-clear">Очистить</button><button type="button" class="hw-hint"></button><button type="button" class="hc-retry">Ещё потренируюсь</button><button type="button" class="hw-primary"></button></div>
      <div class="hw-status"></div>`;
    const $ = s => root.querySelector(s), canvas = $('canvas'), ctx = canvas.getContext('2d');
    let lesson = [], setKey = 'theme0', index = 0, phase = 'observe', ready = false, failed = false, w = 400, h = 300, size = 220;
    let style = STYLES[0][0], practice = loadPractice(), strokes = [], draft = [], pointer = null, overlay = false, hintUntil = 0, assisted = false;
    let used = 0, started = false, finished = false, restTime = 0, restTarget = 0, last = performance.now(), colors = null, colorsAt = 0;
    // Stroke order comes from the printed stroke data (Make Me a Hanzi): a font outline has no order.
    let strokeMap = null, orderTime = 0;
    window.HanziWrite?.loadStrokes().then(m => { strokeMap = m; if (phase === 'observe' && !strokes.length && !finished) setPhase(start()); });
    const data = () => strokeMap && strokeMap.get(item().glyph);
    const start = () => data() ? 'order' : 'observe';
    try { const s = localStorage.getItem(STYLE_KEY); if (STYLES.some(([f]) => f === s)) style = s; } catch { /* default style */ }
    $('.hc-style').value = style;

    const sets = () => [...(lesson.length ? [{ key: 'lesson', title: 'Этот урок', tip: LESSON_TIP, items: lesson }] : []), ...THEMES.map((t, i) => ({ key: 'theme' + i, ...t }))];
    const set = () => sets().find(s => s.key === setKey) || sets()[0];
    const item = () => set().items[Math.min(index, set().items.length - 1)];
    const writing = () => ['trace', 'copy', 'memory'].includes(phase);
    const box = () => ({ x: (w - size) / 2, y: (h - size) / 2 });
    // Colours follow the platform theme (light / dark).
    function palette() {
      const now = performance.now();
      if (colors && now - colorsAt < 500) return colors;
      const s = getComputedStyle(root), v = (n, f) => (s.getPropertyValue(n) || '').trim() || f;
      colorsAt = now;
      return colors = { ink: v('--ink-black', '#272F2B'), teal: v('--hsk5-teal', '#1F5F61'), border: v('--hsk5-border', '#CBD9D9'), gold: v('--tea-gold', '#B87333'), gray: v('--ink-gray', '#55514B'), paper: v('--paper-white', '#FFFEFA') };
    }

    function choose(key, i = 0) { if (finished) return; setKey = key; index = i; setPhase(start()); }
    function setPhase(next) {
      phase = next; pointer = null; draft = []; overlay = false; hintUntil = 0; orderTime = 0;
      if (writing()) strokes = [];
      if (next === 'order' || next === 'observe') { strokes = []; assisted = false; }
      if (next === 'rest') { restTime = 0; restTarget = Math.floor(Math.random() * 3); }
      ui();
    }
    function build() {
      const hide = phase === 'rest' || phase === 'memory';
      $('.hc-sets').replaceChildren(...sets().map(s => {
        const b = document.createElement('button');
        b.type = 'button'; b.textContent = s.title; b.className = 'hc-set' + (s.key === set().key ? ' active' : ''); b.disabled = hide;
        b.onclick = () => choose(s.key);
        return b;
      }));
      $('.hc-tip').textContent = set().tip;
      $('.hc-samples').replaceChildren(...set().items.map((c, i) => {
        const b = document.createElement('button'), hand = document.createElement('span'), print = document.createElement('span'), py = document.createElement('small');
        b.type = 'button'; b.className = 'hc-sample' + (i === index ? ' active' : ''); b.disabled = hide; b.setAttribute('aria-label', 'Практиковать ' + c.glyph);
        hand.className = 'hc-script'; hand.lang = 'zh'; hand.textContent = c.glyph; hand.style.fontFamily = style;
        print.className = 'hc-print-small chinese-sans'; print.lang = 'zh'; print.textContent = c.glyph;
        py.textContent = c.pinyin || '';
        b.append(hand, print, py);
        b.onclick = () => choose(set().key, i);
        return b;
      }));
      for (const el of [$('.hc-sets'), $('.hc-tip'), $('.hc-samples')]) el.classList.toggle('concealed', hide);
      $('.hc-samples .active')?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    }
    function ui() {
      build();
      const c = item(), t = TEXT[finished ? 'end' : phase], show = !finished && phase !== 'rest' && phase !== 'memory';
      $('.hc-word').classList.toggle('concealed', !show);
      $('.hc-print').textContent = show ? c.glyph : '';
      $('.hw-py').textContent = show ? (c.word && c.word !== c.glyph ? `${c.pinyin || ''} · ${c.word} ${c.wordPy || ''}` : c.pinyin || '') : '';
      $('.hw-tr').textContent = show ? c.translation || c.wordTr || '' : '';
      $('.hw-title').textContent = t[0];
      $('.hw-instr').textContent = failed ? 'Рукописный шрифт не загрузился. Проверьте соединение и откройте вкладку ещё раз.' : t[1];
      const primary = $('.hw-primary');
      primary.textContent = t[2];
      primary.hidden = !finished && phase === 'rest';
      primary.disabled = !finished && (!ready || (writing() && !strokes.length));
      $('.hc-undo').hidden = $('.hc-clear').hidden = finished || !writing();
      $('.hw-hint').hidden = finished || !['memory', 'compare'].includes(phase);
      $('.hw-hint').textContent = phase === 'memory' ? 'Подсказка на 2,5 с' : overlay ? 'Скрыть образец' : 'Наложить образец';
      $('.hc-retry').hidden = finished || phase !== 'compare';
      root.querySelectorAll('[data-hc-step]').forEach(el => el.classList.toggle('active', !finished && el.dataset.hcStep === phase));
      const p = practice[c.glyph];
      $('.hw-status').textContent = p ? `${c.glyph}: попыток ${p.attempts} · самостоятельно «получилось» ${p.selfPassed}` : 'Прогресс хранится в этом браузере · оценка — по вашему сравнению';
    }
    function record(passed) {
      const g = item().glyph, p = practice[g] || { attempts: 0, selfPassed: 0 }, own = passed && !assisted;
      p.attempts++; if (own) p.selfPassed++;
      practice[g] = p; savePractice(practice);
      opts.onResult?.(g, own);
    }
    function endSession() {
      finished = true; pointer = null; draft = []; ui();
      root.dispatchEvent(new CustomEvent('distractorcomplete', { bubbles: true }));
      window.onDistractorComplete?.();
    }

    // ---- drawing (the learner's lines are kept in 0..1 coordinates of the writing square) ----
    function template(color, alpha, c = { x: box().x + size / 2, y: box().y + size / 2 }, s = size) {
      const g = item().glyph;
      ctx.save(); ctx.font = `${s * 1.24}px ${style}`;
      const m = ctx.measureText(g), inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const fit = Math.min(s * .88 / (inkW || 1), s * .88 / (inkH || 1));
      ctx.globalAlpha = alpha; ctx.fillStyle = color; ctx.translate(c.x, c.y); ctx.scale(fit, fit);
      ctx.fillText(g, -inkW / 2 + m.actualBoundingBoxLeft, inkH / 2 - m.actualBoundingBoxDescent);
      ctx.restore();
    }
    function ink(s, color) {
      const b = box(), p = smooth(s);
      ctx.strokeStyle = color; ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      for (let i = 1; i < p.length; i++) {
        ctx.lineWidth = (1.4 + (p[i].pressure ?? .5) * 3) * size / 230;
        ctx.beginPath(); ctx.moveTo(b.x + p[i - 1].x * size, b.y + p[i - 1].y * size); ctx.lineTo(b.x + p[i].x * size, b.y + p[i].y * size); ctx.stroke();
      }
    }
    function grid(k) {
      const { x, y } = box();
      ctx.strokeStyle = k.border; ctx.lineWidth = 1; ctx.strokeRect(x, y, size, size);
      ctx.setLineDash([4, 7]); ctx.beginPath();
      ctx.moveTo(x + size / 2, y); ctx.lineTo(x + size / 2, y + size); ctx.moveTo(x, y + size / 2); ctx.lineTo(x + size, y + size / 2);
      ctx.moveTo(x, y); ctx.lineTo(x + size, y + size); ctx.moveTo(x + size, y); ctx.lineTo(x, y + size); ctx.stroke(); ctx.setLineDash([]);
    }
    // «Порядок черт» on the handwritten form itself. A font outline has no stroke order, so the order of the printed
    // stroke data is carried over: the printed centre lines are fitted onto the handwritten ink, and every ink pixel
    // belongs to the nearest point of a centre line (which stroke, how far along it). The handwritten form then
    // fills in stroke by stroke, a glowing dot running over its own ink. Joins go with the stroke they lie nearest.
    let reveal = null;
    function revealOf(d) {
      const S = Math.round(size), key = `${item().glyph}|${style}|${S}`;
      if (reveal && reveal.key === key) return reveal;
      const off = document.createElement('canvas'); off.width = off.height = S;
      const o = off.getContext('2d'), g = item().glyph;
      o.font = `${S * 1.24}px ${style}`;
      const m = o.measureText(g), inkW = m.actualBoundingBoxLeft + m.actualBoundingBoxRight, inkH = m.actualBoundingBoxAscent + m.actualBoundingBoxDescent;
      const fit = Math.min(S * .88 / (inkW || 1), S * .88 / (inkH || 1));
      o.translate(S / 2, S / 2); o.scale(fit, fit); o.fillStyle = '#000';
      o.fillText(g, -inkW / 2 + m.actualBoundingBoxLeft, inkH / 2 - m.actualBoundingBoxDescent);
      const alpha = o.getImageData(0, 0, S, S).data, ink = [];
      let x0 = S, y0 = S, x1 = 0, y1 = 0;
      for (let p = 0; p < S * S; p++) if (alpha[p * 4 + 3] > 60) { const x = p % S, y = (p / S) | 0; ink.push(p); if (x < x0) x0 = x; if (x > x1) x1 = x; if (y < y0) y0 = y; if (y > y1) y1 = y; }
      // the printed centre lines, stretched onto the box of the handwritten ink
      const lines = d.medians.map(l => l.map(([x, y]) => [x, 900 - y]));
      const all = lines.flat(), mx0 = Math.min(...all.map(p => p[0])), mx1 = Math.max(...all.map(p => p[0])), my0 = Math.min(...all.map(p => p[1])), my1 = Math.max(...all.map(p => p[1]));
      const sx = (x1 - x0) / ((mx1 - mx0) || 1), sy = (y1 - y0) / ((my1 - my0) || 1);
      const samples = [];   // [x, y, stroke, t]
      lines.forEach((l, j) => {
        const pts = l.map(([x, y]) => [x0 + (x - mx0) * sx, y0 + (y - my0) * sy]), lens = [0];
        for (let q = 1; q < pts.length; q++) lens.push(lens[q - 1] + Math.hypot(pts[q][0] - pts[q - 1][0], pts[q][1] - pts[q - 1][1]));
        const total = lens[lens.length - 1] || 1;
        samples.push([pts[0][0], pts[0][1], j, 0]);
        for (let q = 1; q < pts.length; q++) {
          const seg = lens[q] - lens[q - 1], steps = Math.max(1, Math.ceil(seg / 2));
          for (let r = 1; r <= steps; r++) { const f = r / steps; samples.push([pts[q - 1][0] + (pts[q][0] - pts[q - 1][0]) * f, pts[q - 1][1] + (pts[q][1] - pts[q - 1][1]) * f, j, (lens[q - 1] + seg * f) / total]); }
        }
      });
      const stroke = new Int16Array(ink.length), along = new Float32Array(ink.length);
      const BINS = 16, n = lines.length, sumX = new Float32Array(n * BINS), sumY = new Float32Array(n * BINS), cnt = new Uint32Array(n * BINS);
      ink.forEach((p, a) => {
        const x = p % S, y = (p / S) | 0;
        let best = Infinity, bj = 0, bt = 0;
        for (const s of samples) { const dd = (s[0] - x) ** 2 + (s[1] - y) ** 2; if (dd < best) { best = dd; bj = s[2]; bt = s[3]; } }
        stroke[a] = bj; along[a] = bt;
        const bin = bj * BINS + Math.min(BINS - 1, (bt * BINS) | 0); sumX[bin] += x; sumY[bin] += y; cnt[bin]++;
      });
      // where the dot is on each stroke: the middle of that stroke's ink at that point of its way
      const track = Array.from({ length: n }, (_, j) => Array.from({ length: BINS }, (_, b) => cnt[j * BINS + b] ? [sumX[j * BINS + b] / cnt[j * BINS + b], sumY[j * BINS + b] / cnt[j * BINS + b]] : null).filter(Boolean));
      const out = document.createElement('canvas'); out.width = out.height = S;
      return reveal = { key, S, ink, stroke, along, track, out, octx: out.getContext('2d'), img: null };
    }
    const rgb = c => { const m = /^#?([0-9a-f]{6})/i.exec(String(c).trim()); const v = m ? parseInt(m[1], 16) : 0x1F5F61; return [v >> 16 & 255, v >> 8 & 255, v & 255]; };
    function order(k, dt) {
      const d = data(), b = box();
      if (!d) return;
      orderTime += dt;
      const n = d.medians.length, i = Math.floor(orderTime / BEAT) % n, t = (orderTime % BEAT) / BEAT;
      const r = revealOf(d), [tr, tg, tb] = rgb(k.teal), [gr, gg, gb] = rgb(k.border);
      if (!r.img) r.img = r.octx.createImageData(r.S, r.S);
      const px = r.img.data;
      for (let a = 0; a < r.ink.length; a++) {
        const p = r.ink[a] * 4, done = r.stroke[a] < i || (r.stroke[a] === i && r.along[a] <= t);
        px[p] = done ? tr : gr; px[p + 1] = done ? tg : gg; px[p + 2] = done ? tb : gb; px[p + 3] = done ? 235 : 150;
      }
      r.octx.putImageData(r.img, 0, 0);
      ctx.drawImage(r.out, b.x, b.y, size, size);
      const way = r.track[i];
      if (way && way.length) {
        const f = t * (way.length - 1), q = Math.min(way.length - 2, Math.floor(f)), e = way.length > 1 ? f - q : 0;
        const at = way.length > 1 ? [way[q][0] + (way[q + 1][0] - way[q][0]) * e, way[q][1] + (way[q + 1][1] - way[q][1]) * e] : way[0];
        const hx = b.x + at[0] * size / r.S, hy = b.y + at[1] * size / r.S;
        ctx.fillStyle = k.gold; ctx.shadowColor = k.gold; ctx.shadowBlur = 14; ctx.beginPath(); ctx.arc(hx, hy, 6, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      }
      ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = k.gray; ctx.textAlign = 'center';
      ctx.fillText(`черта ${i + 1} из ${n}`, b.x + size / 2, Math.min(h - 4, b.y + size + 14));
      // beside it, where the field is wide enough, the printed form for comparison
      const side = (w - size) / 2, s = Math.min(side - 24, size * .62);
      if (s >= 60) {
        const at = { x: b.x + size + side / 2, y: b.y + size / 2 };
        ctx.save(); ctx.translate(at.x - s / 2, at.y - s / 2); ctx.scale(s / 1024, s / 1024);
        d.paths.forEach((p, j) => { ctx.fillStyle = j < i ? k.teal : k.border; ctx.globalAlpha = j <= i ? .9 : .5; ctx.save(); ctx.translate(0, 900); ctx.scale(1, -1); ctx.fill(new Path2D(p)); ctx.restore(); });
        ctx.restore();
        ctx.fillStyle = k.gray; ctx.fillText('печатный', at.x, at.y + s / 2 + 16);
      }
      ctx.textAlign = 'start';
    }
    const visible = () => root.offsetParent !== null && !document.hidden;
    function frame(now) {
      requestAnimationFrame(frame);
      const dt = Math.min(.1, (now - last) / 1000); last = now;
      if (!visible()) { pointer = null; draft = []; return; }   // a hidden tab or the other mode pauses the session
      if (started && !finished) {
        used += dt;
        const remain = Math.max(0, SESSION - used);
        $('.hw-timer').textContent = `${String(Math.floor(remain / 60)).padStart(2, '0')}:${String(Math.floor(remain % 60)).padStart(2, '0')}`;
        if (!remain) endSession();
      }
      ctx.clearRect(0, 0, w, h);
      if (!ready) return;
      const k = palette();
      if (finished) { ctx.font = '56px serif'; ctx.textAlign = 'center'; ctx.fillStyle = k.teal; ctx.fillText('◎', w / 2, h / 2 + 18); ctx.textAlign = 'start'; return; }
      if (phase === 'rest') {
        restTime += dt;
        for (let i = 0; i < 3; i++) {
          const x = w * (i + 1) / 4, y = h * .44, on = i === restTarget;
          ctx.fillStyle = on ? k.gold : k.border;
          if (on) { ctx.shadowColor = k.gold; ctx.shadowBlur = 16; }
          ctx.beginPath();
          if (i === 0) ctx.arc(x, y, 25, 0, Math.PI * 2);
          if (i === 1) ctx.rect(x - 22, y - 22, 44, 44);
          if (i === 2) { ctx.moveTo(x, y - 28); ctx.lineTo(x + 27, y + 23); ctx.lineTo(x - 27, y + 23); ctx.closePath(); }
          ctx.fill(); ctx.shadowBlur = 0;
        }
        ctx.beginPath(); ctx.strokeStyle = k.teal; ctx.lineWidth = 3; ctx.arc(w / 2, h * .8, 18, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.min(1, restTime / REST)); ctx.stroke();
        if (restTime >= REST) setPhase('memory');
        return;
      }
      grid(k);
      if (phase === 'order') { order(k, dt); return; }
      if (phase === 'observe') template(k.ink, .9);
      if (phase === 'trace' || (phase === 'memory' && now < hintUntil)) template(k.ink, .18);
      const b = box();
      ctx.save(); ctx.beginPath(); ctx.rect(b.x, b.y, size, size); ctx.clip();
      for (const s of strokes) ink(s, k.ink);
      ink(draft, k.ink);
      if (phase === 'compare' && overlay) template(k.gold, .5);
      ctx.restore();
    }
    function resize() {
      const r = canvas.getBoundingClientRect();
      if (!r.width || !r.height) return;
      w = r.width; h = r.height; size = Math.min(w * .72, h * .82, 260);
      canvas.width = Math.round(w * devicePixelRatio); canvas.height = Math.round(h * devicePixelRatio);
      ctx.setTransform(devicePixelRatio, 0, 0, devicePixelRatio, 0, 0);
      pointer = null; draft = [];
    }
    new ResizeObserver(resize).observe(canvas);

    // ---- input ----
    function at(e) {
      const r = canvas.getBoundingClientRect(), b = box();
      return { x: (e.clientX - r.left - b.x) / size, y: (e.clientY - r.top - b.y) / size, px: e.clientX - r.left, py: e.clientY - r.top, pressure: e.pointerType === 'pen' ? Math.max(.15, e.pressure) : .5 };
    }
    canvas.addEventListener('pointerdown', e => {
      if (!ready || finished || pointer !== null) return;
      const p = at(e);
      if (phase === 'rest') { if (dist({ x: p.px, y: p.py }, { x: w * (restTarget + 1) / 4, y: h * .44 }) < 36) { navigator.vibrate?.(20); restTarget = (restTarget + 1 + Math.floor(Math.random() * 2)) % 3; } return; }
      if (!writing() || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1) return;
      pointer = e.pointerId; draft = [p];
      try { canvas.setPointerCapture(e.pointerId); } catch { /* the stroke still works inside the canvas */ }
    });
    canvas.addEventListener('pointermove', e => {
      if (e.pointerId !== pointer) return;
      const p = at(e);
      if (draft.length < 2000 && dist(draft[draft.length - 1], p) * size > .5) draft.push(p);
    });
    canvas.addEventListener('pointerup', e => {
      if (e.pointerId !== pointer) return;
      draft.push(at(e));
      if (draft.some(p => dist(p, draft[0]) * size > 1)) strokes.push(draft);
      pointer = null; draft = []; ui();
    });
    canvas.addEventListener('pointercancel', () => { pointer = null; draft = []; });

    $('.hc-style').onchange = e => {
      style = e.target.value;
      try { localStorage.setItem(STYLE_KEY, style); } catch { /* default next time */ }
      if (!finished) setPhase(start());
    };
    $('.hc-undo').onclick = () => { strokes.pop(); ui(); };
    $('.hc-clear').onclick = () => { strokes = []; ui(); };
    $('.hw-hint').onclick = () => {
      if (phase === 'memory') { assisted = true; hintUntil = performance.now() + 2500; }
      else { overlay = !overlay; ui(); }
    };
    $('.hc-retry').onclick = () => { record(false); setPhase(start()); };
    $('.hw-primary').onclick = () => {
      if (finished) { finished = false; started = false; used = 0; $('.hw-timer').textContent = '10:00'; setPhase(start()); return; }
      if (!ready) return;
      started = true;
      if (phase === 'order') setPhase('observe');
      else if (phase === 'observe') setPhase('trace');
      else if (phase === 'trace') setPhase('copy');
      else if (phase === 'copy') setPhase('rest');
      else if (phase === 'memory') setPhase('compare');
      else if (phase === 'compare') { record(true); index = (index + 1) % set().items.length; setPhase(start()); }
    };
    $('.hw-say').onclick = () => { const c = item(); if (c) opts.speak?.(c.word || c.glyph, $('.hw-say')); };

    ui();
    loadFonts().then(ok => { ready = ok; failed = !ok; resize(); ui(); });
    requestAnimationFrame(frame);

    return {
      // A new lesson: its characters become the «Этот урок» set (the theme sets stay).
      setChars(chars) {
        const next = chars.map(c => ({ glyph: c.glyph, pinyin: c.pinyin || '', translation: c.translation || '', word: c.word, wordPy: c.wordPy, wordTr: c.wordTr }));
        if (next.map(c => c.glyph).join('') === lesson.map(c => c.glyph).join('')) return;
        lesson = next; practice = loadPractice();
        if (lesson.length && (setKey === 'lesson' || !started)) { setKey = 'lesson'; index = 0; }
        if (!finished) setPhase(start()); else ui();
      }
    };
  }

  window.HanziCursive = { mount };
})();
