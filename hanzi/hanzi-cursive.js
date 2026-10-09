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
    order: ['Порядок черт', 'Крупно — рукописная форма. Рядом на печатном знаке светящаяся точка показывает, в какой последовательности и в каком направлении пишутся черты. В прописи порядок тот же — черты лишь сокращаются и соединяются.', 'Дальше: сравнить формы'],
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
    // «Порядок черт»: the handwritten form large in the writing square (not animated for now: a font has no stroke
    // order); beside it, small, the printed form, its strokes filled in one by one, a glowing dot running along the current one.
    function order(k, dt) {
      const d = data(), main = box();
      if (!d) return;
      template(k.ink, .9);
      ctx.font = '12px system-ui, sans-serif'; ctx.fillStyle = k.gray; ctx.textAlign = 'center';
      ctx.fillText('пропись', main.x + size / 2, Math.min(h - 4, main.y + size + 14));
      const side = (w - size) / 2, sz = Math.min(side - 24, size * .5);
      if (sz < 50) { ctx.textAlign = 'start'; return; }
      const b = { x: main.x + size + side / 2 - sz / 2, y: main.y + size / 2 - sz / 2 };
      orderTime += dt;
      const n = d.medians.length, i = Math.floor(orderTime / BEAT) % n, t = (orderTime % BEAT) / BEAT;
      const pt = ([x, y]) => ({ x: b.x + x / 1024 * sz, y: b.y + (900 - y) / 1024 * sz });
      ctx.save(); ctx.translate(b.x, b.y); ctx.scale(sz / 1024, -sz / 1024); ctx.translate(0, -900);
      d.paths.forEach((p, j) => { ctx.fillStyle = j < i ? k.teal : k.border; ctx.globalAlpha = j < i ? .85 : .5; ctx.fill(new Path2D(p)); });
      ctx.restore();
      const m = d.medians[i].map(pt), lens = [0];
      for (let j = 1; j < m.length; j++) lens.push(lens[j - 1] + dist(m[j - 1], m[j]));
      const goal = lens[lens.length - 1] * t, path = [m[0]];
      let head = m[0];
      for (let j = 1; j < m.length; j++) {
        if (lens[j] <= goal) { path.push(m[j]); head = m[j]; continue; }
        const f = (goal - lens[j - 1]) / ((lens[j] - lens[j - 1]) || 1);
        head = { x: m[j - 1].x + (m[j].x - m[j - 1].x) * f, y: m[j - 1].y + (m[j].y - m[j - 1].y) * f }; path.push(head); break;
      }
      ctx.strokeStyle = k.gold; ctx.lineWidth = Math.max(3, sz * .03); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
      ctx.beginPath(); path.forEach((p, j) => j ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)); ctx.stroke();
      ctx.fillStyle = k.gold; ctx.shadowColor = k.gold; ctx.shadowBlur = 10; ctx.beginPath(); ctx.arc(head.x, head.y, 4, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = k.gray; ctx.fillText(`печатный · черта ${i + 1} из ${n}`, b.x + sz / 2, b.y + sz + 16);
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
