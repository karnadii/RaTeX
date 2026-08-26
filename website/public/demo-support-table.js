/** WASM entry: flat /platforms/web for /demo/ & /zh/ when base unset; else legacy subdirectory heuristic (see gallery.js). */
function ratexWasmModuleUrl() {
  var g = typeof globalThis !== "undefined" ? globalThis : window;
  function getSiteDirUrl() {
    var u = new URL(location.href);
    var path = u.pathname;
    if (!path.endsWith("/")) {
      var last = path.split("/").pop() || "";
      if (last.indexOf(".") !== -1) {
        path = path.replace(/\/[^/]+$/, "/");
      } else {
        path = path + "/";
      }
    }
    u.pathname = path || "/";
    return u;
  }
  if (typeof g.__RATES_WASM_IMPORT_URL__ === "string" && g.__RATES_WASM_IMPORT_URL__.length > 0) {
    return g.__RATES_WASM_IMPORT_URL__;
  }
  var configured = typeof g.__RATEX_SITE_BASE__ === "string" ? g.__RATEX_SITE_BASE__ : "";
  if (configured.length > 0) {
    var b = configured.endsWith("/") ? configured : configured + "/";
    return new URL("platforms/web/pkg/ratex_wasm.js", new URL(b, location.origin)).href;
  }
  var path = location.pathname || "";
  if (path.indexOf("/website/") !== -1) {
    return new URL("../platforms/web/pkg/ratex_wasm.js", location.href).href;
  }
  if (path.startsWith("/RaTeX/") || path === "/RaTeX") {
    return new URL("platforms/web/pkg/ratex_wasm.js", new URL("/RaTeX/", location.origin)).href;
  }
  if (location.protocol === "file:") {
    return new URL("platforms/web/pkg/ratex_wasm.js", getSiteDirUrl()).href;
  }
  if (/^\/demo(\/|$)/.test(path) || /^\/zh(\/|$)/.test(path)) {
    return new URL("/platforms/web/pkg/ratex_wasm.js", location.origin).href;
  }
  return new URL("platforms/web/pkg/ratex_wasm.js", getSiteDirUrl()).href;
}

const GOLDEN_REPORT = globalThis.__RATEX_GOLDEN_REPORT__;
if (!GOLDEN_REPORT || !Array.isArray(GOLDEN_REPORT.cases)) {
  throw new Error("Golden report was not embedded by the support-table page");
}
const REPORT_CASES = GOLDEN_REPORT.cases;
const FORMULAS = REPORT_CASES.map((record) => record.formula);
const SCORES_BY_INDEX = new Map(
  REPORT_CASES.filter((record) => typeof record.score === "number").map((record) => [record.index, record.score]),
);

// ── score → tier ──
function tier(s) {
  if (s === null) return 'nodata';
  if (s >= 0.9) return 'great';
  if (s >= 0.8) return 'high8';
  if (s >= 0.6) return 'good';
  if (s >= 0.4) return 'ok';
  if (s >= 0.3) return 'low';
  return 'bad';
}
function tierClass(t) {
  const map = {
    great: 'bg-emerald-50 text-emerald-800 border border-emerald-200',
    high8: 'bg-teal-50 text-teal-900 border border-teal-200',
    good: 'bg-lime-50 text-lime-900 border border-lime-200',
    ok: 'bg-amber-50 text-amber-900 border border-amber-200',
    low: 'bg-orange-50 text-orange-900 border border-orange-200',
    bad: 'bg-red-50 text-red-800 border border-red-200',
    err: 'bg-red-50 text-red-800 border border-red-200',
    nodata: 'bg-zinc-100 text-zinc-500 border border-dashed border-zinc-300',
  };
  return map[t] || map.nodata;
}
function tierLabel(t) {
  return { great:'Great', high8:'Strong', good:'Good', ok:'Fair',
           low:'Low', bad:'Poor', nodata:'—', err:'Error' }[t];
}

// ── counters ──
let total = FORMULAS.length;
let rendered = 0;    // WASM render done
let wasmOk = 0, wasmErr = 0;

function counterTier(score) {
  if (score === null) return 'low';
  if (score < 0.3) return 'low';
  if (score >= 0.9) return 'great';
  if (score >= 0.8) return 'high8';
  if (score >= 0.5) return 'mid-hi';
  return 'mid-lo';
}

function refreshHero() {
  const byTier = { great: 0, high8: 0, 'mid-hi': 0, 'mid-lo': 0, low: 0 };
  let scoreSum = 0, scoreN = 0;
  for (let i = 1; i <= total; i++) {
    const s = SCORES_BY_INDEX.get(i) ?? null;
    if (s !== null) { scoreSum += s; scoreN++; }
    byTier[counterTier(s)]++;
  }
  document.getElementById('cnt-great').textContent = byTier.great;
  document.getElementById('cnt-high8').textContent = byTier.high8;
  document.getElementById('cnt-mid-lo').textContent = byTier['mid-lo'];
  document.getElementById('cnt-mid-hi').textContent = byTier['mid-hi'];
  document.getElementById('cnt-low').textContent   = byTier.low;
  document.getElementById('cnt-avg').textContent   = scoreN ? (scoreSum/scoreN).toFixed(2) : '—';
  document.getElementById('b-great').textContent   = byTier.great;
  document.getElementById('b-high8').textContent   = byTier.high8;
  document.getElementById('b-mid-lo').textContent  = byTier['mid-lo'];
  document.getElementById('b-mid-hi').textContent  = byTier['mid-hi'];
  document.getElementById('b-low').textContent     = byTier.low;
}

function updateProgress() {
  const pct = rendered / total * 100;
  document.getElementById('pfill').style.width = pct + '%';
  document.getElementById('pcount').textContent = rendered + ' / ' + total + ' live renders done';
  if (rendered >= total) {
    document.getElementById('plabel').textContent = 'Done';
    document.getElementById('tstatus').textContent =
      wasmOk + ' rendered, ' + wasmErr + ' errors';
  }
}

// ── font id → CSS font declaration ──
function fontIdToCss(fontId, sizePx) {
  switch (fontId) {
    case "AMS-Regular":         return `${sizePx}px KaTeX_AMS`;
    case "Caligraphic-Regular": return `${sizePx}px KaTeX_Caligraphic`;
    case "Fraktur-Regular":     return `${sizePx}px KaTeX_Fraktur`;
    case "Fraktur-Bold":        return `bold ${sizePx}px KaTeX_Fraktur`;
    case "Main-Bold":           return `bold ${sizePx}px KaTeX_Main`;
    case "Main-BoldItalic":     return `italic bold ${sizePx}px KaTeX_Main`;
    case "Main-Italic":         return `italic ${sizePx}px KaTeX_Main`;
    case "Main-Regular":        return `${sizePx}px KaTeX_Main`;
    case "Math-BoldItalic":     return `italic bold ${sizePx}px KaTeX_Math`;
    case "Math-Italic":         return `italic ${sizePx}px KaTeX_Math`;
    case "SansSerif-Bold":      return `bold ${sizePx}px KaTeX_SansSerif`;
    case "SansSerif-Italic":    return `italic ${sizePx}px KaTeX_SansSerif`;
    case "SansSerif-Regular":   return `${sizePx}px KaTeX_SansSerif`;
    case "Script-Regular":      return `${sizePx}px KaTeX_Script`;
    case "Size1-Regular":       return `${sizePx}px KaTeX_Size1`;
    case "Size2-Regular":       return `${sizePx}px KaTeX_Size2`;
    case "Size3-Regular":       return `${sizePx}px KaTeX_Size3`;
    case "Size4-Regular":       return `${sizePx}px KaTeX_Size4`;
    case "Typewriter-Regular":  return `${sizePx}px KaTeX_Typewriter`;
    default:                    return `${sizePx}px KaTeX_Main`;
  }
}

// ── draw RaTeX ──
function drawDisplayList(dl, canvas, em, pad) {
  const dpr = window.devicePixelRatio || 1;
  const totalH = dl.height + dl.depth;
  const cssW = Math.max(1, Math.ceil(dl.width * em + 2 * pad));
  const cssH = Math.max(1, Math.ceil(totalH * em + 2 * pad));
  canvas.width  = cssW * dpr;
  canvas.height = cssH * dpr;
  canvas.style.width  = cssW + 'px';
  canvas.style.height = cssH + 'px';
  const ctx = canvas.getContext('2d');
  ctx.scale(dpr, dpr);
  ctx.clearRect(0, 0, cssW, cssH);
  ctx.save(); ctx.translate(pad, pad);
  for (const item of dl.items) {
    const c = item.color;
    const rgb = `rgb(${c.r*255|0},${c.g*255|0},${c.b*255|0})`;
    if (item.type === 'Line') {
      ctx.fillStyle = rgb;
      ctx.fillRect(item.x*em, item.y*em - item.thickness*em/2,
                   item.width*em, Math.max(0.5, item.thickness*em));
    } else if (item.type === 'Rect') {
      ctx.fillStyle = rgb;
      ctx.fillRect(item.x*em, item.y*em, item.width*em, item.height*em);
    } else if (item.type === 'Path') {
      const ox = item.x*em, oy = item.y*em;
      ctx.beginPath();
      for (const cmd of item.commands) {
        if      (cmd.type === 'MoveTo') ctx.moveTo(ox+cmd.x*em, oy+cmd.y*em);
        else if (cmd.type === 'LineTo') ctx.lineTo(ox+cmd.x*em, oy+cmd.y*em);
        else if (cmd.type === 'CubicTo')
          ctx.bezierCurveTo(ox+cmd.x1*em,oy+cmd.y1*em, ox+cmd.x2*em,oy+cmd.y2*em, ox+cmd.x*em,oy+cmd.y*em);
        else if (cmd.type === 'QuadTo')
          ctx.quadraticCurveTo(ox+cmd.x1*em,oy+cmd.y1*em, ox+cmd.x*em,oy+cmd.y*em);
        else if (cmd.type === 'Close') ctx.closePath();
      }
      ctx.fillStyle = rgb;
      if (item.fill) ctx.fill(); else ctx.stroke();
    } else if (item.type === 'GlyphPath') {
      const sz = (item.scale || 1) * em;
      ctx.save();
      ctx.translate(item.x*em, item.y*em);
      ctx.font = fontIdToCss(item.font, sz);
      ctx.textBaseline = 'alphabetic'; ctx.textAlign = 'left';
      ctx.fillStyle = rgb;
      ctx.fillText(String.fromCodePoint(item.char_code), 0, 0);
      ctx.restore();
    }
  }
  ctx.restore();
}

// ── WASM & font state ──
let renderLatex = null, wasmReady = false, fontsReady = false;
const pendingQueue = [];

function tryFlushPending() {
  if (!wasmReady || !fontsReady) return;
  let meta;
  while ((meta = pendingQueue.shift())) {
    if (meta.done) continue;
    doRender(meta);
  }
}

function doRender(meta) {
  if (meta.done) return;
  meta.done = true;
  const { latex, ratexCell, scoreEl } = meta;
  const scoreVal = SCORES_BY_INDEX.get(meta.idx + 1) ?? null;
  try {
    const json = renderLatex(latex);
    const dl   = JSON.parse(json);
    const canvas = document.createElement('canvas');
    canvas.className = 'max-w-full h-auto';
    drawDisplayList(dl, canvas, 20, 3);
    ratexCell.innerHTML = '';
    ratexCell.appendChild(canvas);
    wasmOk++;
  } catch(e) {
    const msg = String(e).replace(/^.*?Error:\s*/,'').slice(0, 100);
    ratexCell.innerHTML =
      '<span class="text-xs text-red-600 font-mono break-words max-w-[12rem]" title="' +
      String(e).replace(/"/g,'&quot;') +
      '">' +
      msg +
      '</span>';
    // If WASM errors but the report has a score, the score already shows the quality.
    wasmErr++;
  }
  // Update score badge to show actual score (was already set from golden, just update color)
  // The score badge was already rendered from the versioned report.
  rendered++;
  updateProgress();
}

// ── Build table ──
function buildTable() {
  const tbody = document.getElementById('tbody');
  const frag  = document.createDocumentFragment();
  const observer = new IntersectionObserver(entries => {
    entries.forEach(e => {
      if (!e.isIntersecting) return;
      const meta = e.target._meta;
      if (meta && !meta.done) {
        if (wasmReady && fontsReady) doRender(meta);
        else pendingQueue.push(meta);
      }
      observer.unobserve(e.target);
    });
  }, { rootMargin: '300px' });

  FORMULAS.forEach((latex, idx) => {
    const score = SCORES_BY_INDEX.get(idx + 1) ?? null;
    const t     = tier(score);
    const tr = document.createElement('tr');
    tr.className = 'border-b border-outline/40 bg-white hover:bg-surface/90 transition-colors';
    tr.dataset.tier = counterTier(score);
    tr.dataset.q   = latex.toLowerCase();

    // index
    const tdI = document.createElement('td');
    tdI.className =
      'td-idx w-10 px-2 py-2 text-right text-xs text-on-surface-variant tabular-nums align-top';
    tdI.textContent = idx + 1;
    tr.appendChild(tdI);

    // source
    const tdS = document.createElement('td');
    tdS.className =
      'td-source hidden md:table-cell max-w-[min(240px,28vw)] px-3 py-2 font-mono text-[11px] text-on-surface-variant break-all align-top';
    tdS.textContent = latex;
    tr.appendChild(tdS);

    // KaTeX
    const tdK = document.createElement('td');
    tdK.className = 'td-katex min-w-0 align-middle';
    const kc = document.createElement('div');
    kc.className =
      'katex-cell flex items-center overflow-x-auto overflow-y-visible min-h-[28px] text-[16.53px] text-zinc-900';
    try {
      // displayMode: true — required for AMS environments (align, equation, gather, …)
      // and matches tools/golden_compare/generate_reference.mjs (golden PNG reference).
      kc.innerHTML = katex.renderToString(latex, {
        throwOnError: false, displayMode: true, trust: true, strict: false
      });
    } catch(e) {
      kc.innerHTML = '<span class="text-xs text-red-600">KaTeX error</span>';
    }
    tdK.appendChild(kc); tr.appendChild(tdK);

    // RaTeX
    const tdR = document.createElement('td');
    tdR.className = 'td-ratex min-w-0 align-middle';
    const rc = document.createElement('div');
    rc.className = 'ratex-cell flex items-center min-h-[28px] max-w-full';
    rc.innerHTML = '<span class="text-xs text-on-surface-variant italic">loading…</span>';
    tdR.appendChild(rc); tr.appendChild(tdR);

    // Score (from golden, pre-computed offline)
    const tdSc = document.createElement('td');
    tdSc.className = 'td-score w-[100px] sm:w-[110px] px-2 text-center align-middle';
    const badge = document.createElement('div');
    badge.className =
      'inline-flex flex-col items-center gap-0.5 px-2 py-1.5 rounded-md text-xs font-semibold min-w-[56px] text-center ' +
      tierClass(t);
    if (score !== null) {
      badge.innerHTML =
        score.toFixed(2) +
        '<span class="block text-[9px] font-normal opacity-75 leading-tight">' +
        tierLabel(t) +
        '</span>';
    } else {
      badge.innerHTML =
        'no data<span class="block text-[9px] font-normal opacity-75 leading-tight">not built</span>';
    }
    tdSc.appendChild(badge); tr.appendChild(tdSc);

    const meta = { idx, latex, ratexCell: rc, scoreEl: badge, done: false };
    tr._meta = meta;
    frag.appendChild(tr);
    observer.observe(tr);
  });

  tbody.appendChild(frag);
  refreshHero();
  applyFilter();
  document.getElementById('tstatus').textContent = FORMULAS.length + ' formulas, rendering lazily…';
}

// ── Filter / Search ──
let curFilter = 'all', curQ = '';
function applyFilter() {
  let vis = 0;
  for (const tr of document.getElementById('tbody').children) {
    const matchQ = !curQ || tr.dataset.q.includes(curQ);
    const matchF = curFilter === 'all' ||
      (curFilter === 'great' && tr.dataset.tier === 'great') ||
      (curFilter === 'high8' && tr.dataset.tier === 'high8') ||
      (curFilter === 'mid-hi'&& tr.dataset.tier === 'mid-hi')||
      (curFilter === 'mid-lo'&& tr.dataset.tier === 'mid-lo')||
      (curFilter === 'low'   && tr.dataset.tier === 'low');
    const show = matchQ && matchF;
    tr.classList.toggle('hidden', !show);
    if (show) vis++;
  }
  document.getElementById('b-all').textContent = FORMULAS.length;
  document.getElementById('tstatus').textContent = vis + ' formula' + (vis!==1?'s':'') + ' shown';
}
function filterBtnClass(isActive) {
  return isActive
    ? 'filter-btn rounded-full border border-primary bg-primary px-3 py-1.5 text-xs font-medium text-on-primary shadow-sm transition-colors'
    : 'filter-btn rounded-full border border-outline/60 bg-white px-3 py-1.5 text-xs text-on-surface-variant hover:border-primary/30 transition-colors';
}
document.querySelectorAll('.filter-btn').forEach((btn) =>
  btn.addEventListener('click', () => {
    document.querySelectorAll('.filter-btn').forEach((b) => {
      b.className = filterBtnClass(b === btn);
    });
    curFilter = btn.dataset.filter;
    applyFilter();
  }),
);
document.getElementById('search').addEventListener('input', e => {
  curQ = e.target.value.trim().toLowerCase();
  applyFilter();
});

// ── Boot ──
// Both katex.min.js and mhchem.min.js are defer-loaded in DOM order.
// katex fires its load event before mhchem has executed, so \ce / \pu macros
// are not yet registered at that point. Wait for both before building the table.
let _katexReady = false, _mhchemReady = false;
function _tryBoot() {
  if (_katexReady && _mhchemReady) {
    buildTable();
    loadFontsAndWasm();
  }
}
document.getElementById('katex-script').addEventListener('load', () => { _katexReady = true; _tryBoot(); });
document.getElementById('mhchem-script').addEventListener('load', () => { _mhchemReady = true; _tryBoot(); });

async function loadFontsAndWasm() {
  // Pre-load fonts so canvas renders use KaTeX glyphs, not fallback serif
  try {
    document.getElementById('plabel').textContent = 'Loading fonts…';
    await Promise.all([
      document.fonts.load('20px KaTeX_Main'),
      document.fonts.load('italic 20px KaTeX_Main'),
      document.fonts.load('bold 20px KaTeX_Main'),
      document.fonts.load('italic bold 20px KaTeX_Main'),
      document.fonts.load('italic 20px KaTeX_Math'),
      document.fonts.load('italic bold 20px KaTeX_Math'),
      document.fonts.load('20px KaTeX_AMS'),
      document.fonts.load('20px KaTeX_Caligraphic'),
      document.fonts.load('20px KaTeX_Fraktur'),
      document.fonts.load('bold 20px KaTeX_Fraktur'),
      document.fonts.load('20px KaTeX_SansSerif'),
      document.fonts.load('italic 20px KaTeX_SansSerif'),
      document.fonts.load('bold 20px KaTeX_SansSerif'),
      document.fonts.load('20px KaTeX_Script'),
      document.fonts.load('20px KaTeX_Typewriter'),
      document.fonts.load('20px KaTeX_Size1'),
      document.fonts.load('20px KaTeX_Size2'),
      document.fonts.load('20px KaTeX_Size3'),
      document.fonts.load('20px KaTeX_Size4'),
    ]);
  } catch(e) { console.warn('Font pre-load partial:', e); }
  fontsReady = true;

  try {
    document.getElementById('plabel').textContent = 'Loading WASM…';
    const mod = await import(ratexWasmModuleUrl());
    await mod.default();
    renderLatex = mod.renderLatex;
    wasmReady = true;
    document.getElementById('plabel').textContent = 'Rendering…';
    tryFlushPending();
  } catch(e) {
    document.getElementById('plabel').textContent = 'WASM load failed: ' + e;
  }
}
