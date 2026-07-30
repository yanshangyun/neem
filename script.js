const THEMES = [
  { color: '#FFFFFF', bg: '#7BC69C'},
  { color: '#292929', bg: '#9CE5BC'},
  { color: '#7BC69C', bg: '#FFFFFF'},
  { color: '#F8F8F8', bg: '#292929'},
  { color: '#292929', bg: '#F8F8F8'},
  { color: '#f8f8f8', bg: '#3d5dff'}
];
let themeIdx = 0;

function applyTheme(t) {
  document.documentElement.style.setProperty('--color', t.color);
  document.documentElement.style.setProperty('--color-bg', t.bg);
  document.documentElement.style.background = t.bg;
  document.body.style.background = t.bg;
  document.getElementById('favicon').href =
    'data:image/svg+xml,' + encodeURIComponent(`<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><circle cx="50" cy="50" r="50" fill="${t.bg}"/></svg>`);
}

applyTheme(THEMES[themeIdx]);

const PAD = 24;
const PAD_MOB = 10;
const BREAKPOINT = 600;
const DURATION = 700;
const DURATION_MOB = 1200;
const STAGGER = 90;
const EASING = 'cubic-bezier(0.5, 0, 0.08, 1)';
const H_FRAC = 0.14;
const LETTER_PAD = 0.18;
const SCALE_MIN = 0.3;
const SCALE_MAX = 3.0;
const GAPS = [2, 2, -7];
const ASSETS = ['assets/n.svg', 'assets/e-1.svg', 'assets/e-2.svg', 'assets/m.svg'];

const WISHLIST_IDX = 0; // 'n' stays and becomes the box
const OTHER_IDX = [0, 1, 2, 3].filter(i => i !== WISHLIST_IDX); // the 3 letters that vanish/reappear
const WISHLIST_CONVERGE_MS = 650;
const WISHLIST_EXPAND_MS = 550;
const WISHLIST_CONTENT_MS = 300; // keep in sync with the CSS opacity transition below
const WISHLIST_GLYPH_FADE_SPEED = 3; // glyphs fade out/in this much faster than the box converges

const RATIOS = [173/180, 187/184, 187/184, 267/180];
const RATIO_SUM = RATIOS.reduce((s, r) => s + r, 0);

const sceneEl = document.getElementById('scene');
const gs = ['g-n','g-e1','g-e2','g-m'].map(id => document.getElementById(id));
const rs = ['r-n','r-e1','r-e2','r-m'].map(id => document.getElementById(id));
const imgs = ['img-n','img-e1','img-e2','img-m'].map(id => document.getElementById(id));

const lineSets = ['s1','s2','s3'].map(s => ({
  tl: document.getElementById(`${s}-tl`),
  tr: document.getElementById(`${s}-tr`),
  bl: document.getElementById(`${s}-bl`),
  br: document.getElementById(`${s}-br`),
}));

//nav elements — each is independently positioned
const navCircleEl = document.getElementById('nav-circle');
const navLinkEl = document.getElementById('nav-link');
const navSizeEl = document.getElementById('nav-size');
const navSentinelEl = document.getElementById('nav-sentinel');
const navEls = [navCircleEl, navLinkEl, navSizeEl];
let navAnims = [null, null, null];
let navHasInitOffset = false;

const wishlistBoxEl = document.getElementById('wishlist-box');
const wishlistCloseEl = document.getElementById('wishlist-close');
const wishlistCatcherEl = document.getElementById('wishlist-catcher');
const wishlistLogoEl = document.getElementById('img-logo');
let wishlistOpen = false;
let wishlistBusy = false;
let wishlistSnapshot = null;
let introTimeoutId = null;

let fracs = [0.5, 0.5, 0.5, 0.5];
let fracsX = [0.5, 0.5, 0.5, 0.5]; //centre-x as fraction of viewport width
let scales = [1, 1, 1, 1];
let anims = [null, null, null, null];
let rafId = null;
let hasClicked = false;
let autoPlaying = true;
let skipClick = false;
let dragging = null;

function isMobile() { return window.innerWidth < BREAKPOINT; }
function pad() { return isMobile() ? PAD_MOB : PAD; }
function duration() { return isMobile() ? DURATION_MOB : DURATION; }

function letterH() {
  const byH = window.innerHeight * H_FRAC;
  if (!isMobile()) return byH;
  const byW = (window.innerWidth - 2 * PAD_MOB) / RATIO_SUM;
  return Math.min(byH, byW);
}

function letterWs() { const h = letterH(); return RATIOS.map(r => h * r); }

function sizeLetter(i, h) {
  const hi = h * scales[i], wi = h * RATIOS[i] * scales[i];
  rs[i].setAttribute('width', wi);
  rs[i].setAttribute('height', hi);
  const p = hi * LETTER_PAD;
  imgs[i].setAttribute('x', p);
  imgs[i].setAttribute('y', p);
  imgs[i].setAttribute('width', wi - p * 2);
  imgs[i].setAttribute('height', hi - p * 2);
  return { wi, hi };
}

function applySize() {
  const h = letterH();
  rs.forEach((r, i) => sizeLetter(i, h));
}

function setBox(i, x, y, w, h) {
  setPos(gs[i], x, y);
  rs[i].setAttribute('width', w);
  rs[i].setAttribute('height', h);
  const p = h * LETTER_PAD;
  imgs[i].setAttribute('x', p);
  imgs[i].setAttribute('y', p);
  imgs[i].setAttribute('width', Math.max(0, w - p * 2));
  imgs[i].setAttribute('height', Math.max(0, h - p * 2));
}

// hover/drag colour-swap: rect and glyph trade fills so the letter reads as "inverted"
function setGlyphFill(idx, rectFill, glyphFill) {
  rs[idx].style.fill = rectFill;
  const path = imgs[idx].querySelector('path');
  if (path) path.style.fill = glyphFill;
}

function lerp(a, b, t) { return a + (b - a) * t; }

// matches CSS cubic-bezier(x1,y1,x2,y2) semantics for driving a JS-side tween
function cubicBezier(x1, y1, x2, y2) {
  const A = (a1, a2) => 1 - 3 * a2 + 3 * a1;
  const B = (a1, a2) => 3 * a2 - 6 * a1;
  const C = a1 => 3 * a1;
  const calc = (t, a1, a2) => ((A(a1, a2) * t + B(a1, a2)) * t + C(a1)) * t;
  const slope = (t, a1, a2) => 3 * A(a1, a2) * t * t + 2 * B(a1, a2) * t + C(a1);
  function tForX(x) {
    let t = x;
    for (let i = 0; i < 4; i++) {
      const s = slope(t, x1, x2);
      if (s === 0) return t;
      t -= (calc(t, x1, x2) - x) / s;
    }
    return t;
  }
  return t => calc(tForX(t), y1, y2);
}

const WISHLIST_EASING = cubicBezier(0.7, 0, 0.07, 1);

// runs `indices` on the same per-letter stagger as shuffleAll (delay = i * STAGGER);
// onFrame receives a { [index]: easedProgress } map each frame
function tweenStagger(duration, indices, onFrame) {
  return new Promise(resolve => {
    const start = performance.now();
    function frame(now) {
      const elapsed = now - start;
      const progress = {};
      let allDone = true;
      indices.forEach(i => {
        const local = Math.min(1, Math.max(0, (elapsed - i * STAGGER) / duration));
        if (local < 1) allDone = false;
        progress[i] = WISHLIST_EASING(local);
      });
      onFrame(progress);
      if (!allDone) requestAnimationFrame(frame); else resolve();
    }
    requestAnimationFrame(frame);
  });
}

function xCentered(i) {
  const vw = window.innerWidth, ws = letterWs();
  const h = letterH(), p = h * LETTER_PAD;
  const glyphWs = ws.map(w => w - 2 * p);
  const total = glyphWs.reduce((s, w) => s + w, 0) + GAPS.reduce((s, g) => s + g, 0);
  let x = (vw - total) / 2 - p;
  for (let j = 0; j < i; j++) x += glyphWs[j] + GAPS[j];
  return x;
}

function yCentered() { return (window.innerHeight - letterH()) / 2; }

function xScattered(i) {
  const p = pad(), vw = window.innerWidth, h = letterH();
  const ws = RATIOS.map((r, j) => h * r * scales[j]);
  const used = ws.reduce((s, w) => s + w, 0);
  const spacing = (vw - 2 * p - used) / 3;
  let x = p;
  for (let j = 0; j < i; j++) x += ws[j] + spacing;
  return x;
}

function yFromFrac(f) {
  const p = pad();
  return p + f * (window.innerHeight - 2 * p - letterH());
}

//store each letter's centre as a fraction of the viewport (scale-aware).
//stored fracs survive resize with scales intact.
function storeFrac(i, x, y) {
  const vw = window.innerWidth, vh = window.innerHeight, h = letterH(), s = scales[i];
  const w = h * RATIOS[i] * s;
  fracsX[i] = (x + w / 2) / vw;
  fracs[i] = (y + h * s / 2) / vh; //centre-y as fraction of viewport height
}

function xFromFracX(i, fx) {
  const vw = window.innerWidth, h = letterH(), w = h * RATIOS[i] * scales[i];
  return fx * vw - w / 2;
}

function yFromFracY(i, fy) {
  const vh = window.innerHeight, h = letterH(), s = scales[i];
  return fy * vh - h * s / 2;
}

function setPos(el, x, y) { el.style.transform = `translate(${x}px, ${y}px)`; }

function commitAnim(anim) {
  if (!anim) return;
  anim.commitStyles();
  anim.cancel();
}

function syncLines() {
  const boxes = rs.map(r => r.getBoundingClientRect());
  [[0,1],[1,2],[2,3]].forEach(([ai, bi], si) => {
    const a = boxes[ai], b = boxes[bi], s = lineSets[si];
    s.tl.setAttribute('x1', a.left); s.tl.setAttribute('y1', a.top);
    s.tl.setAttribute('x2', b.left); s.tl.setAttribute('y2', b.top);
    s.tr.setAttribute('x1', a.right); s.tr.setAttribute('y1', a.top);
    s.tr.setAttribute('x2', b.right); s.tr.setAttribute('y2', b.top);
    s.bl.setAttribute('x1', a.left); s.bl.setAttribute('y1', a.bottom);
    s.bl.setAttribute('x2', b.left); s.bl.setAttribute('y2', b.bottom);
    s.br.setAttribute('x1', a.right); s.br.setAttribute('y1', a.bottom);
    s.br.setAttribute('x2', b.right); s.br.setAttribute('y2', b.bottom);
  });
}

function stopLoop() {
  if (rafId !== null) { cancelAnimationFrame(rafId); rafId = null; }
}

function loopSync() { syncLines(); rafId = requestAnimationFrame(loopSync); }

function showDecoration() {
  rs.forEach(r => { r.style.stroke = 'var(--color)'; });
  lineSets.forEach(s => ['tl','tr','bl','br'].forEach(k => { s[k].style.stroke = 'var(--color)'; }));
}

function hideDecoration() {
  rs.forEach(r => { r.style.stroke = 'none'; });
  lineSets.forEach(s => ['tl','tr','bl','br'].forEach(k => { s[k].style.stroke = 'none'; }));
}

//── wishlist box ─────────────────────────────────────────────────────────

function wishlistChipSize() {
  return Math.max(48, Math.min(120, letterH() * 0.8));
}

// the shared centred square all 4 letters converge to before the box expands/collapses
function computeChip() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const size = wishlistChipSize();
  return { x: vw / 2 - size / 2, y: vh / 2 - size / 2, w: size, h: size };
}

function measureWishlistHeight(w) {
  const prevCssText = wishlistBoxEl.style.cssText;
  wishlistBoxEl.style.cssText = `position:fixed; left:0; top:0; visibility:hidden; display:block; width:${w}px; height:auto;`;
  const h = wishlistBoxEl.scrollHeight;
  wishlistBoxEl.style.cssText = prevCssText;
  return h;
}

function wishlistBoxRect() {
  const vw = window.innerWidth, vh = window.innerHeight;
  const w = Math.min(480, vw - 64);
  const h = Math.min(measureWishlistHeight(w), vh - 64);
  return { x: (vw - w) / 2, y: (vh - h) / 2, w, h };
}

function positionWishlistBox({ x, y, w, h }) {
  wishlistBoxEl.style.transform = `translate(${x}px, ${y}px)`;
  wishlistBoxEl.style.width = `${w}px`;
  wishlistBoxEl.style.height = `${h}px`;
}

async function openWishlist() {
  if (wishlistOpen || wishlistBusy) return;
  wishlistBusy = true;

  if (dragging) {
    setGlyphFill(dragging.idx, '', '');
    document.body.style.cursor = '';
    dragging = null;
  }
  anims.forEach((a, i) => { commitAnim(a); anims[i] = null; });
  stopLoop();
  if (introTimeoutId !== null) { clearTimeout(introTimeoutId); introTimeoutId = null; }
  if (hasClicked) autoPlaying = false;
  gs.forEach(g => { g.style.pointerEvents = 'none'; });
  sceneEl.classList.add('locked'); // suppress hover fill-swap for the duration

  const boxes = rs.map(r => r.getBoundingClientRect());
  wishlistSnapshot = {
    boxes: boxes.map(b => ({ x: b.left, y: b.top, w: b.width, h: b.height })),
    strokeOn: rs[0].style.stroke === 'var(--color)',
  };

  const chip = computeChip();

  showDecoration();

  await tweenStagger(WISHLIST_CONVERGE_MS, [0, 1, 2, 3], progress => {
    gs.forEach((g, i) => {
      const p = progress[i];
      const from = wishlistSnapshot.boxes[i];
      setBox(i, lerp(from.x, chip.x, p), lerp(from.y, chip.y, p), lerp(from.w, chip.w, p), lerp(from.h, chip.h, p));
      imgs[i].style.opacity = String(Math.max(0, 1 - p * WISHLIST_GLYPH_FADE_SPEED));
    });
    lineSets.forEach((s, si) => {
      const avg = (progress[si] + progress[si + 1]) / 2;
      ['tl','tr','bl','br'].forEach(k => { s[k].style.opacity = String(1 - avg); });
    });
    syncLines();
  });
  lineSets.forEach(s => ['tl','tr','bl','br'].forEach(k => { s[k].style.stroke = 'none'; s[k].style.opacity = ''; }));

  OTHER_IDX.forEach(i => { gs[i].style.display = 'none'; });

  const target = wishlistBoxRect();
  rs[WISHLIST_IDX].style.fill = 'var(--color)';
  rs[WISHLIST_IDX].style.fillOpacity = '0';
  await tweenStagger(WISHLIST_EXPAND_MS, [WISHLIST_IDX], progress => {
    const p = progress[WISHLIST_IDX];
    setBox(WISHLIST_IDX, lerp(chip.x, target.x, p), lerp(chip.y, target.y, p), lerp(chip.w, target.w, p), lerp(chip.h, target.h, p));
    rs[WISHLIST_IDX].style.fillOpacity = String(p);
  });

  positionWishlistBox(target);
  wishlistBoxEl.classList.add('active');
  wishlistCatcherEl.classList.add('active');
  await new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
  wishlistBoxEl.classList.add('content-visible');
  await new Promise(r => setTimeout(r, WISHLIST_CONTENT_MS));

  wishlistOpen = true;
  wishlistBusy = false;
}

async function closeWishlist() {
  if (!wishlistOpen || wishlistBusy) return;
  wishlistBusy = true;
  wishlistOpen = false;

  wishlistBoxEl.classList.remove('content-visible');
  await new Promise(r => setTimeout(r, WISHLIST_CONTENT_MS));
  wishlistBoxEl.classList.remove('active');
  wishlistCatcherEl.classList.remove('active');

  const chip = computeChip();
  const boxNow = wishlistBoxRect();

  await tweenStagger(WISHLIST_EXPAND_MS, [WISHLIST_IDX], progress => {
    const p = progress[WISHLIST_IDX];
    setBox(WISHLIST_IDX, lerp(boxNow.x, chip.x, p), lerp(boxNow.y, chip.y, p), lerp(boxNow.w, chip.w, p), lerp(boxNow.h, chip.h, p));
    rs[WISHLIST_IDX].style.fillOpacity = String(1 - p);
  });
  rs[WISHLIST_IDX].style.fill = 'none';
  rs[WISHLIST_IDX].style.fillOpacity = '';

  OTHER_IDX.forEach(i => {
    gs[i].style.display = '';
    setBox(i, chip.x, chip.y, chip.w, chip.h);
  });

  showDecoration();
  await tweenStagger(WISHLIST_CONVERGE_MS, [0, 1, 2, 3], progress => {
    gs.forEach((g, i) => {
      const p = progress[i];
      const to = wishlistSnapshot.boxes[i];
      setBox(i, lerp(chip.x, to.x, p), lerp(chip.y, to.y, p), lerp(chip.w, to.w, p), lerp(chip.h, to.h, p));
      imgs[i].style.opacity = String(Math.min(1, p * WISHLIST_GLYPH_FADE_SPEED));
    });
    lineSets.forEach((s, si) => {
      const avg = (progress[si] + progress[si + 1]) / 2;
      ['tl','tr','bl','br'].forEach(k => { s[k].style.opacity = String(avg); });
    });
    syncLines();
  });
  imgs.forEach(img => { img.style.opacity = ''; });
  lineSets.forEach(s => ['tl','tr','bl','br'].forEach(k => { s[k].style.opacity = ''; }));
  gs.forEach(g => { g.style.pointerEvents = ''; });
  sceneEl.classList.remove('locked');

  if (!wishlistSnapshot.strokeOn) hideDecoration();

  wishlistSnapshot = null;
  wishlistBusy = false;

  if (!hasClicked) shuffleAll();
}

//── nav helpers ──────────────────────────────────────────────────────────

//compute where each nav element lands in its final resting position.
//all three share the same y, vertically centred within a virtual nav bar
//whose height equals the link's rendered height.
function navFinalPos(idx, navTopY, navH) {
  const el = navEls[idx];
  const vw = window.innerWidth;
  const y = navTopY + (navH - el.offsetHeight) / 2;
  if (idx === 0) return { x: 16, y };
  if (idx === 1) return { x: Math.round((vw - el.offsetWidth) / 2), y };
  return { x: vw - 16 - el.offsetWidth, y };
}

// shared geometry behind navFinalPos — measured once per positioning pass, not once per element
function navBarGeometry() {
  const navH = navLinkEl.offsetHeight;
  return { navH, navTopY: navSentinelEl.getBoundingClientRect().top - navH };
}

//called after letters load (and on resize).
//desktop pre-shuffle: group all three centred below the letter block.
//desktop post-shuffle / mobile: place each at its final position.
function positionNavElements() {
  if (isMobile()) {
    navHasInitOffset = false;
    //size is display:none on mobile; only position circle + link
    const { navTopY, navH } = navBarGeometry();
    [0, 1].forEach(i => {
      const pos = navFinalPos(i, navTopY, navH);
      setPos(navEls[i], pos.x, pos.y);
    });
    return;
  }

  if (hasClicked) {
    navHasInitOffset = false;
    const { navTopY, navH } = navBarGeometry();
    navEls.forEach((el, i) => {
      const pos = navFinalPos(i, navTopY, navH);
      setPos(el, pos.x, pos.y);
    });
    return;
  }

  //desktop initial state: group centred just below the neem letters
  const startY = yCentered() + letterH() + 8;
  const vw = window.innerWidth;
  navEls.forEach(el => {
    setPos(el, Math.round((vw - el.offsetWidth) / 2), startY);
  });
  navHasInitOffset = true;
}

//── letter loading ───────────────────────────────────────────────────────

async function loadLetters() {
  await Promise.all(ASSETS.map(async (src, i) => {
    const res = await fetch(src);
    const text = await res.text();
    const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
    const svg = doc.querySelector('svg');
    const path = doc.querySelector('path');
    path.setAttribute('stroke-width', '12');
    imgs[i].setAttribute('viewBox', svg.getAttribute('viewBox'));
    imgs[i].appendChild(document.importNode(path, true));
  }));

  applySize();
  hideDecoration();
  gs.forEach((g, i) => setPos(g, xCentered(i), yCentered()));
  syncLines();
}

async function loadLogo() {
  const res = await fetch('assets/neem-logo.svg');
  const text = await res.text();
  const doc = new DOMParser().parseFromString(text, 'image/svg+xml');
  const svg = doc.querySelector('svg');
  wishlistLogoEl.setAttribute('viewBox', svg.getAttribute('viewBox'));
  doc.querySelectorAll('path').forEach(path => {
    wishlistLogoEl.appendChild(document.importNode(path, true));
  });
}

loadLetters().then(() => { positionNavElements(); introTimeoutId = setTimeout(shuffleAll, 2000); });
loadLogo();

//── shuffle ──────────────────────────────────────────────────────────────

function shuffleAll() {
  anims.forEach((a, i) => { commitAnim(a); anims[i] = null; });
  stopLoop();
  applySize();
  showDecoration();
  hasClicked = true;
  sceneEl.classList.remove('locked');

  fracs = fracs.map(() => Math.random());

  let done = 0;
  gs.forEach((g, i) => {
    const box = rs[i].getBoundingClientRect();
    const from = { x: box.left, y: box.top };
    const to = { x: xScattered(i), y: yFromFrac(fracs[i]) };
    storeFrac(i, to.x, to.y); //track target as proportional position
    anims[i] = g.animate([
      { transform: `translate(${from.x}px, ${from.y}px)` },
      { transform: `translate(${to.x}px, ${to.y}px)` },
    ], { duration: duration(), easing: EASING, fill: 'forwards', delay: i * STAGGER });
    anims[i].onfinish = () => {
      commitAnim(anims[i]); anims[i] = null;
      if (++done === gs.length) { stopLoop(); syncLines(); autoPlaying = false; }
    };
  });

  //fly each nav element from its grouped start to its final corner
  if (navHasInitOffset) {
    navHasInitOffset = false;
    const dur = duration();
    const { navTopY, navH } = navBarGeometry();
    navEls.forEach((el, i) => {
      if (navAnims[i]) { navAnims[i].cancel(); navAnims[i] = null; }
      const rect = el.getBoundingClientRect();
      const to = navFinalPos(i, navTopY, navH);
      navAnims[i] = el.animate([
        { transform: `translate(${rect.left}px, ${rect.top}px)` },
        { transform: `translate(${to.x}px, ${to.y}px)` },
      ], { duration: dur, easing: EASING, fill: 'forwards' });
      navAnims[i].onfinish = () => {
        commitAnim(navAnims[i]);
        navAnims[i] = null;
      };
    });
  }

  loopSync();
}

//── event listeners ──────────────────────────────────────────────────────

navCircleEl.addEventListener('click', e => {
  e.stopPropagation();
  themeIdx = (themeIdx + 1) % THEMES.length;
  applyTheme(THEMES[themeIdx]);
});

navLinkEl.addEventListener('click', e => {
  e.preventDefault();
  e.stopPropagation();
  openWishlist();
});

wishlistCloseEl.addEventListener('click', e => {
  e.stopPropagation();
  closeWishlist();
});

wishlistCatcherEl.addEventListener('click', e => {
  e.stopPropagation();
  closeWishlist();
});

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && wishlistOpen) closeWishlist();
});

gs.forEach((g, i) => {
  function startDrag(clientX, clientY) {
    if (autoPlaying || wishlistOpen || wishlistBusy) return;
    commitAnim(anims[i]);
    anims[i] = null;
    const box = rs[i].getBoundingClientRect();
    dragging = { idx: i, ox: clientX - box.left, oy: clientY - box.top, moved: false };
    setGlyphFill(i, 'var(--color)', 'var(--color-bg)');
    if (hasClicked && rafId === null) loopSync();
  }

  g.addEventListener('mousedown', e => {
    if (e.button !== 0) return;
    e.stopPropagation();
    startDrag(e.clientX, e.clientY);
    document.body.style.cursor = 'grabbing';
  });

  g.addEventListener('touchstart', e => {
    const touch = e.touches[0];
    startDrag(touch.clientX, touch.clientY);
  }, { passive: true });

  g.addEventListener('wheel', e => {
    if (!hasClicked || wishlistOpen || wishlistBusy) return;
    e.preventDefault();
    if (anims[i]) { commitAnim(anims[i]); anims[i] = null; }
    if (anims.every(a => a === null)) stopLoop();
    const box = rs[i].getBoundingClientRect();
    const cy = box.top + box.height / 2;
    scales[i] = Math.max(SCALE_MIN, Math.min(SCALE_MAX, scales[i] * Math.pow(2, -e.deltaY / 500)));
    const { wi: newW, hi: newH } = sizeLetter(i, letterH());
    const newX = box.left + box.width / 2 - newW / 2;
    setPos(gs[i], newX, cy - newH / 2);
    storeFrac(i, newX, cy - newH / 2);
    syncLines();
  }, { passive: false });
});

document.addEventListener('mousemove', e => {
  if (!dragging) return;
  dragging.moved = true;
  setPos(gs[dragging.idx], e.clientX - dragging.ox, e.clientY - dragging.oy);
});

function finishDrag(resetCursor) {
  if (!dragging) return;
  const { idx, moved } = dragging;
  dragging = null;
  setGlyphFill(idx, '', '');
  if (resetCursor) document.body.style.cursor = '';
  if (moved) {
    const box = rs[idx].getBoundingClientRect();
    storeFrac(idx, box.left, box.top);
    skipClick = true;
    setTimeout(() => { skipClick = false; }, 400);
    if (anims.every(a => a === null)) { stopLoop(); syncLines(); }
  }
}

document.addEventListener('mouseup', () => finishDrag(true));

document.addEventListener('touchmove', e => {
  if (!dragging) return;
  e.preventDefault();
  dragging.moved = true;
  const t = e.touches[0];
  setPos(gs[dragging.idx], t.clientX - dragging.ox, t.clientY - dragging.oy);
}, { passive: false });

document.addEventListener('touchend', () => finishDrag(false));

document.addEventListener('click', () => {
  if (skipClick || autoPlaying || wishlistOpen || wishlistBusy) return;
  shuffleAll();
});

//── size display ─────────────────────────────────────────────────────────

function updateSize() { navSizeEl.textContent = `${window.innerWidth} × ${window.innerHeight}`; }
updateSize();

//── resize ───────────────────────────────────────────────────────────────

window.addEventListener('resize', () => {
  updateSize();
  navAnims.forEach((a, i) => { if (a) { a.cancel(); navAnims[i] = null; } });
  positionNavElements();
  if (wishlistBusy) return;
  if (wishlistOpen) {
    const target = wishlistBoxRect();
    setBox(WISHLIST_IDX, target.x, target.y, target.w, target.h);
    positionWishlistBox(target);
    return;
  }
  anims.forEach((a, i) => { if (a) { a.cancel(); anims[i] = null; } });
  stopLoop();
  applySize();
  if (hasClicked) {
    gs.forEach((g, i) => setPos(g, xFromFracX(i, fracsX[i]), yFromFracY(i, fracs[i])));
  } else {
    gs.forEach((g, i) => setPos(g, xCentered(i), yCentered()));
  }
  syncLines();
});
