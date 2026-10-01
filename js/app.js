import { Renderer } from './renderer.js';
import * as store from './store.js';
import { Link } from './link.js';

// ---------- constantes ----------
const EFFECTS = [
  { id: 'grid', name: 'Rejilla de prueba', mode: 5, icon: '▦' },
  { id: 'rainbow', name: 'Arcoíris', mode: 2, icon: '🌈' },
  { id: 'stripes', name: 'Franjas', mode: 3, icon: '▥' },
  { id: 'pulse', name: 'Pulso', mode: 4, icon: '💓' },
  { id: 'sweep', name: 'Barrido', mode: 6, icon: '〰️' },
  { id: 'scan', name: 'Escáner', mode: 7, icon: '⇆' },
  { id: 'sparkle', name: 'Destellos', mode: 8, icon: '✨' },
  { id: 'plasma', name: 'Plasma', mode: 9, icon: '🫧' },
  { id: 'rings', name: 'Ondas', mode: 10, icon: '◎' },
  { id: 'neon', name: 'Bordes neón', mode: 11, icon: '⬚' },
];
const EFFECT_BY_ID = Object.fromEntries(EFFECTS.map(e => [e.id, e]));
const HANDLE_PX = 26;
const SAVE_KEY = 'proyectalo.state.v1';

// ---------- utilidades ----------
const $ = s => document.querySelector(s);
const uid = () => Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);
const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function toast(msg, ms = 2200) {
  const t = $('#toast');
  t.textContent = msg;
  t.classList.add('on');
  clearTimeout(toast.h);
  toast.h = setTimeout(() => t.classList.remove('on'), ms);
}

// ---------- estado ----------
function newSurface(n) {
  const m = 0.18 + (n % 4) * 0.05;
  return {
    id: uid(), name: 'Superficie ' + (n + 1),
    pts: [[m, m], [1 - m, m], [1 - m, 1 - m], [m, 1 - m]],
    src: { kind: 'effect', effect: 'grid' },
    color: '#ffffff', color2: '#ff2d95',
    opacity: 1, feather: 0, speed: 1, visible: true,
    text: 'HOLA', audio: false,
  };
}

function defaultState() {
  return { surfaces: [newSurface(0)], media: [], counter: 1 };
}

function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(SAVE_KEY));
    if (s && Array.isArray(s.surfaces)) return s;
  } catch { /* nada */ }
  return null;
}

let state = loadState() || defaultState();
let sel = state.surfaces[0]?.id ?? null;
let selCorner = -1;
let role = 'local';          // local | output | remote
let showMode = false;
let precision = false;
let sheet = null;            // panel abierto
let outAspect = null;        // remoto: aspecto de la pantalla del proyector
let remoteUI = { editing: true, sel: null, corner: -1 }; // salida: lo que hace el celular
let knownMedia = new Set();
const pendingNeed = new Set();

const selected = () => state.surfaces.find(s => s.id === sel) || null;

let saveTimer = 0;
let sendQueued = false;
function changed({ ui = false } = {}) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* lleno */ }
  }, 300);
  if (role === 'remote' && !sendQueued) {
    sendQueued = true;
    setTimeout(() => { sendQueued = false; sendState(); }, 33);
  }
  if (ui) renderSheet();
}

// ---------- medios en tiempo de ejecución ----------
const runtime = new Map(); // mediaId -> { status, el, kind }

function mediaEl(id) {
  let e = runtime.get(id);
  if (e) return e;
  e = { status: 'loading', el: null, kind: null };
  runtime.set(id, e);
  store.getMedia(id).then(rec => {
    if (!rec) { e.status = 'missing'; return; }
    const url = URL.createObjectURL(rec.blob);
    if (rec.mime.startsWith('video')) {
      const v = document.createElement('video');
      v.src = url; v.loop = true; v.muted = true; v.playsInline = true; v.autoplay = true;
      v.setAttribute('playsinline', '');
      v.play().catch(() => { /* se reintenta al tocar la pantalla */ });
      e.el = v; e.kind = 'video';
    } else {
      const img = new Image();
      img.src = url;
      e.el = img; e.kind = 'image';
    }
    e.status = 'ready';
  }).catch(() => { e.status = 'missing'; });
  return e;
}

function forgetMedia(id) {
  const e = runtime.get(id);
  if (e?.el) { e.el.pause?.(); URL.revokeObjectURL(e.el.src); }
  runtime.delete(id);
  renderer.dropTexture('m:' + id);
}

let camera = null;
function cameraEl() {
  if (!camera) {
    const v = document.createElement('video');
    v.muted = true; v.playsInline = true; v.setAttribute('playsinline', '');
    camera = { el: v, status: 'loading' };
    navigator.mediaDevices?.getUserMedia({ video: { facingMode: 'environment' }, audio: false })
      .then(stream => { v.srcObject = stream; v.play(); camera.status = 'ready'; })
      .catch(() => { camera.status = 'error'; toast('No se pudo abrir la cámara'); });
  }
  return camera.el;
}

const textCanvases = new Map(); // surfaceId -> { key, canvas }
function textCanvas(s) {
  const key = s.text + '|' + s.color;
  let e = textCanvases.get(s.id);
  if (e && e.key === key) return e.canvas;
  const c = document.createElement('canvas');
  c.width = 1024; c.height = 512;
  const g = c.getContext('2d');
  const lines = String(s.text || ' ').split('\n');
  let size = 400 / lines.length;
  g.font = `800 ${size}px system-ui, sans-serif`;
  const widest = Math.max(...lines.map(l => g.measureText(l).width), 1);
  size = Math.min(size, size * 960 / widest);
  g.font = `800 ${size}px system-ui, sans-serif`;
  g.fillStyle = s.color;
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  lines.forEach((l, i) => g.fillText(l, 512, 256 + (i - (lines.length - 1) / 2) * size * 1.1));
  textCanvases.set(s.id, { key, canvas: c });
  return c;
}

// ---------- render ----------
const glCanvas = $('#gl');
const ovCanvas = $('#overlay');
const ov = ovCanvas.getContext('2d');
const stage = $('#stage');
let renderer;
try {
  renderer = new Renderer(glCanvas);
} catch (err) {
  document.body.innerHTML = '<p style="padding:24px;color:#fff">Tu navegador no soporta WebGL: ' + esc(err.message) + '</p>';
  throw err;
}

let W = 1, H = 1, DPR = 1;
function layout() {
  const vw = window.innerWidth, vh = window.innerHeight;
  let w = vw, h = vh, x = 0, y = 0;
  if (role === 'remote' && outAspect && !showMode) {
    const bar = $('#bar').offsetHeight + 12;
    const top = 56;
    const availH = vh - bar - top;
    w = vw - 16; h = w / outAspect;
    if (h > availH) { h = availH; w = h * outAspect; }
    x = (vw - w) / 2; y = top + (availH - h) / 2;
  }
  Object.assign(stage.style, { left: x + 'px', top: y + 'px', width: w + 'px', height: h + 'px' });
  stage.classList.toggle('framed', role === 'remote' && !!outAspect && !showMode);
  DPR = Math.min(window.devicePixelRatio || 1, 2);
  W = w; H = h;
  renderer.resize(Math.round(w * DPR), Math.round(h * DPR));
  ovCanvas.width = Math.round(w * DPR);
  ovCanvas.height = Math.round(h * DPR);
  if (role === 'output') link.send({ t: 'aspect', aspect: vw / vh });
}
window.addEventListener('resize', layout);

function itemFor(s, time) {
  const base = { pts: s.pts, c1: s.color, c2: s.color2, time: time * s.speed, opacity: s.opacity, feather: s.feather };
  const src = s.src || {};
  if (src.kind === 'color') return { ...base, mode: 1 };
  if (src.kind === 'effect') return { ...base, mode: (EFFECT_BY_ID[src.effect] || EFFECTS[0]).mode };
  if (src.kind === 'text') return { ...base, mode: 0, texKey: 't:' + s.id, el: textCanvas(s) };
  if (src.kind === 'camera') return { ...base, mode: 0, texKey: 'cam', el: cameraEl() };
  if (src.kind === 'media') {
    const e = mediaEl(src.mediaId);
    if (e.kind === 'video') {
      const wantSound = s.audio && role !== 'remote';
      if (e.el.muted === wantSound) e.el.muted = !wantSound;
    }
    return { ...base, mode: 0, texKey: 'm:' + src.mediaId, el: e.el };
  }
  return { ...base, mode: 1 };
}

function overlayVisible() {
  if (role === 'output') return link.connected && remoteUI.editing;
  return !showMode;
}

function drawOverlay() {
  ov.setTransform(DPR, 0, 0, DPR, 0, 0);
  ov.clearRect(0, 0, W, H);
  if (!overlayVisible()) return;
  const curSel = role === 'output' ? remoteUI.sel : sel;
  const curCorner = role === 'output' ? remoteUI.corner : selCorner;
  for (const s of state.surfaces) {
    if (!s.visible) continue;
    const isSel = s.id === curSel;
    const p = s.pts.map(([x, y]) => [x * W, y * H]);
    ov.beginPath();
    p.forEach(([x, y], i) => (i ? ov.lineTo(x, y) : ov.moveTo(x, y)));
    ov.closePath();
    ov.lineWidth = isSel ? 2 : 1;
    ov.strokeStyle = isSel ? '#00e5ff' : 'rgba(255,255,255,.45)';
    ov.setLineDash(isSel ? [] : [6, 6]);
    ov.stroke();
    ov.setLineDash([]);
    if (!isSel) continue;
    p.forEach(([x, y], i) => {
      ov.beginPath();
      ov.arc(x, y, HANDLE_PX * 0.55, 0, Math.PI * 2);
      ov.fillStyle = i === curCorner ? '#ff2d95' : 'rgba(0,229,255,.25)';
      ov.fill();
      ov.lineWidth = 2;
      ov.strokeStyle = i === curCorner ? '#fff' : '#00e5ff';
      ov.stroke();
      // cruz de precisión en el punto exacto
      ov.beginPath();
      ov.moveTo(x - 6, y); ov.lineTo(x + 6, y);
      ov.moveTo(x, y - 6); ov.lineTo(x, y + 6);
      ov.strokeStyle = '#fff';
      ov.lineWidth = 1;
      ov.stroke();
    });
    const cx = p.reduce((a, q) => a + q[0], 0) / 4, cy = p.reduce((a, q) => a + q[1], 0) / 4;
    ov.font = '600 12px system-ui, sans-serif';
    ov.textAlign = 'center';
    ov.fillStyle = 'rgba(0,0,0,.6)';
    const tw = ov.measureText(s.name).width + 12;
    ov.fillRect(cx - tw / 2, cy - 10, tw, 20);
    ov.fillStyle = '#fff';
    ov.fillText(s.name, cx, cy + 4);
  }
}

const t0 = performance.now();
function frame(now) {
  requestAnimationFrame(frame);
  const time = (now - t0) / 1000;
  renderer.draw(state.surfaces.filter(s => s.visible).map(s => itemFor(s, time)));
  drawOverlay();
}

// ---------- interacción (arrastrar esquinas / mover superficie) ----------
function pointInQuad(px, py, pts) {
  let inside = false;
  for (let i = 0, j = 3; i < 4; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

let drag = null;
function canEdit() { return role !== 'output' && !showMode; }

ovCanvas.addEventListener('pointerdown', ev => {
  if (!canEdit()) return;
  const r = ovCanvas.getBoundingClientRect();
  const x = ev.clientX - r.left, y = ev.clientY - r.top;
  const cur = selected();
  let target = null;
  if (cur && cur.visible) {
    let best = -1, bestD = HANDLE_PX * 1.4;
    cur.pts.forEach(([px, py], i) => {
      const d = Math.hypot(px * W - x, py * H - y);
      if (d < bestD) { bestD = d; best = i; }
    });
    if (best >= 0) target = { s: cur, corner: best };
  }
  if (!target) {
    for (let i = state.surfaces.length - 1; i >= 0; i--) {
      const s = state.surfaces[i];
      if (s.visible && pointInQuad(x / W, y / H, s.pts)) { target = { s, corner: -1 }; break; }
    }
  }
  if (!target) {
    sel = null; selCorner = -1;
    changed({ ui: true });
    return;
  }
  sel = target.s.id;
  selCorner = target.corner;
  drag = { id: ev.pointerId, x, y, start: target.s.pts.map(p => [...p]), s: target.s, corner: target.corner };
  ovCanvas.setPointerCapture(ev.pointerId);
  changed({ ui: true });
});

ovCanvas.addEventListener('pointermove', ev => {
  if (!drag || ev.pointerId !== drag.id) return;
  const r = ovCanvas.getBoundingClientRect();
  const k = precision ? 0.2 : 1;
  const dx = ((ev.clientX - r.left - drag.x) / W) * k;
  const dy = ((ev.clientY - r.top - drag.y) / H) * k;
  const s = drag.s;
  if (drag.corner >= 0) {
    const [sx, sy] = drag.start[drag.corner];
    s.pts[drag.corner] = [clamp(sx + dx, -0.5, 1.5), clamp(sy + dy, -0.5, 1.5)];
  } else {
    s.pts = drag.start.map(([sx, sy]) => [sx + dx, sy + dy]);
  }
  changed();
});

const endDrag = ev => { if (drag && ev.pointerId === drag.id) drag = null; };
ovCanvas.addEventListener('pointerup', endDrag);
ovCanvas.addEventListener('pointercancel', endDrag);

function nudge(dx, dy) {
  const s = selected();
  if (!s) return;
  const step = (precision ? 0.25 : 1) / Math.max(W, H) * 2;
  if (selCorner >= 0) s.pts[selCorner] = [s.pts[selCorner][0] + dx * step, s.pts[selCorner][1] + dy * step];
  else s.pts = s.pts.map(([x, y]) => [x + dx * step, y + dy * step]);
  changed();
}

// botones de ajuste fino con repetición al mantener presionado
document.querySelectorAll('#nudge [data-d]').forEach(b => {
  const [dx, dy] = b.dataset.d.split(',').map(Number);
  let t1 = 0, t2 = 0;
  const stop = () => { clearTimeout(t1); clearInterval(t2); };
  b.addEventListener('pointerdown', e => {
    e.preventDefault();
    nudge(dx, dy);
    t1 = setTimeout(() => { t2 = setInterval(() => nudge(dx, dy), 40); }, 350);
  });
  b.addEventListener('pointerup', stop);
  b.addEventListener('pointerleave', stop);
  b.addEventListener('pointercancel', stop);
});
$('#nudge-corner').addEventListener('click', () => {
  if (!selected()) return;
  selCorner = selCorner >= 3 ? -1 : selCorner + 1;
  changed({ ui: true });
});
$('#precision').addEventListener('click', () => {
  precision = !precision;
  updateChrome();
  toast(precision ? 'Precisión fina activada (movimiento ×0.2)' : 'Precisión normal');
});

window.addEventListener('keydown', e => {
  if (e.target.matches('input, textarea, select')) return;
  const map = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] };
  if (map[e.key] && canEdit()) { e.preventDefault(); const m = e.shiftKey ? 10 : 1; nudge(map[e.key][0] * m, map[e.key][1] * m); }
  else if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit() && selected()) removeSurface(sel);
  else if (e.key === 'Escape' && showMode) setShow(false);
  else if (e.key.toLowerCase() === 's' && role !== 'output') setShow(!showMode);
});

// reintenta reproducir videos tras un toque (políticas de autoplay)
window.addEventListener('pointerdown', () => {
  for (const e of runtime.values()) if (e.kind === 'video' && e.el.paused) e.el.play().catch(() => {});
}, true);

// ---------- acciones ----------
function addSurface() {
  const s = newSurface(state.counter++);
  state.surfaces.push(s);
  sel = s.id; selCorner = -1;
  changed({ ui: true });
  toast('Arrastra las esquinas para ajustarla al objeto');
}

function removeSurface(id) {
  state.surfaces = state.surfaces.filter(s => s.id !== id);
  textCanvases.delete(id);
  renderer.dropTexture('t:' + id);
  if (sel === id) { sel = state.surfaces.at(-1)?.id ?? null; selCorner = -1; }
  changed({ ui: true });
}

function duplicateSurface() {
  const s = selected();
  if (!s) return;
  const c = JSON.parse(JSON.stringify(s));
  c.id = uid();
  c.name = s.name + ' copia';
  c.pts = c.pts.map(([x, y]) => [x + 0.03, y + 0.03]);
  state.surfaces.push(c);
  sel = c.id;
  changed({ ui: true });
}

function moveLayer(id, dir) {
  const i = state.surfaces.findIndex(s => s.id === id);
  const j = i + dir;
  if (i < 0 || j < 0 || j >= state.surfaces.length) return;
  [state.surfaces[i], state.surfaces[j]] = [state.surfaces[j], state.surfaces[i]];
  changed({ ui: true });
}

function setSource(src) {
  const s = selected();
  if (!s) { toast('Primero agrega o selecciona una superficie'); return; }
  s.src = src;
  changed({ ui: true });
}

async function importFiles(files) {
  const s = selected();
  for (const f of files) {
    if (!/^(image|video)\//.test(f.type)) { toast('Formato no soportado: ' + f.name); continue; }
    const id = uid();
    await store.putMedia(id, { blob: f, mime: f.type, name: f.name });
    knownMedia.add(id);
    state.media.push({ id, name: f.name, mime: f.type });
    if (s) s.src = { kind: 'media', mediaId: id };
  }
  changed({ ui: true });
}

async function deleteMedia(id) {
  state.media = state.media.filter(m => m.id !== id);
  for (const s of state.surfaces) if (s.src?.mediaId === id) s.src = { kind: 'effect', effect: 'grid' };
  forgetMedia(id);
  await store.delMedia(id);
  changed({ ui: true });
}

function resetCorners() {
  const s = selected();
  if (!s) return;
  s.pts = [[0.2, 0.2], [0.8, 0.2], [0.8, 0.8], [0.2, 0.8]];
  changed();
}

function fullScreenSurface() {
  const s = selected();
  if (!s) return;
  s.pts = [[0, 0], [1, 0], [1, 1], [0, 1]];
  changed();
}

function flip(axis) {
  const s = selected();
  if (!s) return;
  const [a, b, c, d] = s.pts;
  s.pts = axis === 'h' ? [b, a, d, c] : [d, c, b, a];
  changed();
}

// ---------- modo show ----------
function enterFullscreen() {
  const el = document.documentElement;
  (el.requestFullscreen || el.webkitRequestFullscreen)?.call(el)?.catch?.(() => {});
}
function exitFullscreen() {
  if (document.fullscreenElement || document.webkitFullscreenElement) {
    (document.exitFullscreen || document.webkitExitFullscreen)?.call(document)?.catch?.(() => {});
  }
}
let wakeLock = null;
async function keepAwake(on) {
  try {
    if (on && 'wakeLock' in navigator) wakeLock = await navigator.wakeLock.request('screen');
    else if (!on && wakeLock) { await wakeLock.release(); wakeLock = null; }
  } catch { /* nada */ }
}
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && (showMode || role === 'output')) keepAwake(true);
});

function setShow(on) {
  showMode = on;
  closeSheet();
  if (on) {
    if (role === 'local') enterFullscreen();
    keepAwake(true);
    toast(role === 'remote' ? 'Show en el proyector · toca ✕ para volver a editar' : 'Toca la pantalla para salir del show', 2500);
  } else {
    if (role === 'local') exitFullscreen();
    if (role !== 'output') keepAwake(false);
  }
  updateChrome();
  layout();
  if (role === 'remote') sendState();
}

let exitTimer = 0;
stage.addEventListener('pointerdown', () => {
  if (!showMode && role !== 'output') return;
  const b = $('#exit');
  b.classList.add('on');
  clearTimeout(exitTimer);
  exitTimer = setTimeout(() => b.classList.remove('on'), 3000);
});
$('#exit').addEventListener('click', () => {
  if (role === 'output') {
    if (confirm('¿Dejar de ser la pantalla del proyector?')) stopLink();
  } else setShow(false);
});

// ---------- conexión celular <-> proyector ----------
const link = new Link({ onMessage, onStatus });
let linkStatus = 'off';
let hostCode = null;

function onStatus(st, detail) {
  linkStatus = st;
  if (st === 'error') {
    const msg = {
      'peer-unavailable': 'No se encontró ese código. ¿Está abierta la pantalla del proyector?',
      'unavailable-id': 'Ese código está ocupado, generando otro…',
      network: 'Sin conexión al servidor de enlace (requiere internet).',
      'browser-incompatible': 'Este navegador no soporta WebRTC.',
    }[detail] || 'Error de conexión (' + detail + ')';
    toast(msg, 4000);
    if (detail === 'unavailable-id' && role === 'output') {
      hostCode = randomCode();
      try { localStorage.setItem('proyectalo.code', hostCode); } catch { /* nada */ }
      link.host(hostCode);
    }
  }
  if (st === 'connected') {
    toast(role === 'output' ? '📱 Celular conectado' : '✅ Conectado al proyector');
    if (role === 'output') link.send({ t: 'hello', aspect: innerWidth / innerHeight });
  }
  if (st === 'closed') toast('Conexión cerrada', 3000);
  updateChrome();
  renderSheet();
}

async function onMessage(m) {
  if (!m || typeof m !== 'object') return;
  if (role === 'output') {
    if (m.t === 'state') {
      state = m.state;
      remoteUI = m.ui || remoteUI;
      try { localStorage.setItem(SAVE_KEY, JSON.stringify(state)); } catch { /* nada */ }
      const need = [];
      for (const s of state.surfaces) {
        const id = s.src?.kind === 'media' ? s.src.mediaId : null;
        if (id && !knownMedia.has(id) && !pendingNeed.has(id)) { pendingNeed.add(id); need.push(id); }
      }
      if (need.length) link.send({ t: 'need', ids: need });
    } else if (m.t === 'media') {
      const blob = new Blob([m.data], { type: m.mime });
      await store.putMedia(m.id, { blob, mime: m.mime, name: m.name });
      knownMedia.add(m.id);
      pendingNeed.delete(m.id);
      forgetMedia(m.id);
      toast('Recibido: ' + m.name);
    }
  } else if (role === 'remote') {
    if (m.t === 'hello' || m.t === 'aspect') {
      outAspect = m.aspect;
      layout();
      sendState();
    } else if (m.t === 'need') {
      for (const id of m.ids) sendMedia(id);
    }
  }
}

function sendState() {
  if (role !== 'remote') return;
  link.send({ t: 'state', state, ui: { editing: !showMode, sel, corner: selCorner } });
}

async function sendMedia(id) {
  const rec = await store.getMedia(id);
  if (!rec) return;
  toast('Enviando ' + rec.name + ' al proyector…', 4000);
  const data = await rec.blob.arrayBuffer();
  link.send({ t: 'media', id, mime: rec.mime, name: rec.name, data });
}

function randomCode() { return String(Math.floor(100000 + Math.random() * 900000)); }

async function startOutput() {
  role = 'output';
  showMode = false;
  closeSheet();
  hostCode = localStorage.getItem('proyectalo.code') || randomCode();
  try { localStorage.setItem('proyectalo.code', hostCode); } catch { /* nada */ }
  enterFullscreen();
  keepAwake(true);
  updateChrome();
  layout();
  renderOutputCard();
  try { await link.host(hostCode); } catch (e) { toast(e.message, 4000); }
}

async function startRemote(code) {
  code = String(code || '').replace(/\D/g, '');
  if (code.length !== 6) { toast('El código tiene 6 dígitos'); return; }
  role = 'remote';
  try { localStorage.setItem('proyectalo.join', code); } catch { /* nada */ }
  updateChrome();
  try { await link.join(code); } catch (e) { toast(e.message, 4000); }
}

function stopLink() {
  link.close();
  role = 'local';
  linkStatus = 'off';
  outAspect = null;
  showMode = false;
  exitFullscreen();
  keepAwake(false);
  updateChrome();
  layout();
  renderSheet();
}

function joinUrl(code) {
  return location.origin + location.pathname + '?unir=' + code;
}

function renderOutputCard() {
  const card = $('#outcard');
  const show = role === 'output' && !link.connected;
  card.classList.toggle('on', show);
  if (!show || !hostCode) return;
  let qr = '';
  try {
    if (window.qrcode) {
      const q = window.qrcode(0, 'M');
      q.addData(joinUrl(hostCode));
      q.make();
      qr = q.createSvgTag({ cellSize: 5, margin: 2, scalable: true });
    }
  } catch { /* sin QR */ }
  card.innerHTML = `
    <div class="oc-title">Pantalla del proyector</div>
    <div class="oc-qr">${qr}</div>
    <div class="oc-sub">Escanea con tu celular o abre la app y escribe el código:</div>
    <div class="oc-code">${hostCode.slice(0, 3)} ${hostCode.slice(3)}</div>
    <div class="oc-status">${linkStatus === 'waiting' ? 'Esperando al celular…' : linkStatus === 'error' ? 'Error, revisa tu conexión a internet' : 'Iniciando…'}</div>
    <div class="oc-hint">Toca la pantalla para ver el botón de salir</div>`;
}

// ---------- interfaz (barra + paneles) ----------
function updateChrome() {
  document.body.dataset.role = role;
  document.body.classList.toggle('show', showMode);
  const s = selected();
  $('#nudge').classList.toggle('on', canEdit() && !!s && !sheet);
  $('#nudge-corner').textContent = selCorner >= 0 ? 'Esquina ' + (selCorner + 1) : 'Toda';
  $('#precision').classList.toggle('active', precision);
  const chip = $('#chip');
  if (role === 'remote') {
    chip.textContent = link.connected ? '📡 Conectado al proyector' : linkStatus === 'starting' ? '📡 Conectando…' : '📡 Desconectado · toca Conectar';
    chip.className = 'chip on ' + (link.connected ? 'ok' : 'warn');
  } else chip.className = 'chip';
  $('#btn-show').querySelector('span').textContent = showMode ? 'Editar' : 'Show';
  $('#exit').textContent = role === 'output' ? '✕ Salir de modo proyector' : role === 'remote' ? '✕ Volver a editar' : '✕ Salir del show';
  document.querySelectorAll('#bar button[data-sheet]').forEach(b => b.classList.toggle('active', b.dataset.sheet === sheet));
  renderOutputCard();
}

function openSheet(name) {
  sheet = sheet === name ? null : name;
  renderSheet();
}
function closeSheet() { sheet = null; renderSheet(); }

function sourceLabel(s) {
  const src = s.src || {};
  if (src.kind === 'effect') return EFFECT_BY_ID[src.effect]?.name || 'Efecto';
  if (src.kind === 'media') return state.media.find(m => m.id === src.mediaId)?.name || 'Archivo';
  return { color: 'Color', text: 'Texto', camera: 'Cámara' }[src.kind] || '—';
}

function renderSheet() {
  const el = $('#sheet');
  el.classList.toggle('on', !!sheet);
  updateChromeLight();
  if (!sheet) { el.innerHTML = ''; return; }
  const s = selected();
  const needSel = '<p class="muted">Toca una superficie en la pantalla o agrega una con <b>＋ Superficie</b>.</p>';
  let html = '';

  if (sheet === 'content') {
    html = `<h3>Contenido ${s ? '· ' + esc(s.name) : ''}</h3>` + (!s ? needSel : `
      <div class="grid">
        <label class="tile big">📁<span>Foto o video</span><input id="file" type="file" accept="image/*,video/*" multiple hidden></label>
        <button class="tile ${s.src.kind === 'color' ? 'sel' : ''}" data-kind="color">🎨<span>Color sólido</span></button>
        <button class="tile ${s.src.kind === 'text' ? 'sel' : ''}" data-kind="text">🔤<span>Texto</span></button>
        <button class="tile ${s.src.kind === 'camera' ? 'sel' : ''}" data-kind="camera">📷<span>Cámara en vivo</span></button>
      </div>
      <h4>Efectos de luz</h4>
      <div class="grid">${EFFECTS.map(e => `<button class="tile ${s.src.kind === 'effect' && s.src.effect === e.id ? 'sel' : ''}" data-effect="${e.id}">${e.icon}<span>${e.name}</span></button>`).join('')}</div>
      <h4>Tus archivos</h4>
      ${state.media.length ? `<div class="list">${state.media.map(m => `
        <div class="row ${s.src.mediaId === m.id ? 'sel' : ''}">
          <button class="grow" data-media="${m.id}">${m.mime.startsWith('video') ? '🎬' : '🖼️'} ${esc(m.name)}</button>
          <button class="icon" data-delmedia="${m.id}" title="Borrar">🗑</button>
        </div>`).join('')}</div>` : '<p class="muted">Aún no subes archivos.</p>'}
      ${role === 'remote' ? '<p class="muted">Los archivos se envían al proyector automáticamente (videos grandes tardan un poco).</p>' : ''}`);
  }

  if (sheet === 'adjust') {
    html = `<h3>Ajustes ${s ? '· ' + esc(s.name) : ''}</h3>` + (!s ? needSel : `
      <label class="field">Nombre <input id="f-name" value="${esc(s.name)}"></label>
      ${s.src.kind === 'text' ? `<label class="field">Texto <textarea id="f-text" rows="2">${esc(s.text)}</textarea></label>` : ''}
      <div class="two">
        <label class="field">Color 1 <input id="f-color" type="color" value="${s.color}"></label>
        <label class="field">Color 2 <input id="f-color2" type="color" value="${s.color2}"></label>
      </div>
      <label class="field">Opacidad <input id="f-opacity" type="range" min="0" max="1" step="0.01" value="${s.opacity}"></label>
      <label class="field">Bordes suaves <input id="f-feather" type="range" min="0" max="0.3" step="0.005" value="${s.feather}"></label>
      <label class="field">Velocidad del efecto <input id="f-speed" type="range" min="0" max="4" step="0.05" value="${s.speed}"></label>
      ${s.src.kind === 'media' && state.media.find(m => m.id === s.src.mediaId)?.mime.startsWith('video') ? `<label class="check"><input id="f-audio" type="checkbox" ${s.audio ? 'checked' : ''}> Reproducir audio del video</label>` : ''}
      <div class="actions">
        <button data-act="full">⛶ Pantalla completa</button>
        <button data-act="reset">↺ Restablecer</button>
        <button data-act="fliph">⇋ Voltear H</button>
        <button data-act="flipv">⇵ Voltear V</button>
        <button data-act="dup">⧉ Duplicar</button>
        <button data-act="del" class="danger">🗑 Eliminar</button>
      </div>`);
  }

  if (sheet === 'layers') {
    html = `<h3>Capas</h3><p class="muted">La de abajo en la lista se dibuja encima. Usa una superficie de <b>color negro</b> como máscara para tapar luz.</p>
      <div class="list">${state.surfaces.map(x => `
        <div class="row ${x.id === sel ? 'sel' : ''}">
          <button class="icon" data-vis="${x.id}">${x.visible ? '👁' : '🚫'}</button>
          <button class="grow" data-pick="${x.id}"><b>${esc(x.name)}</b><small>${esc(sourceLabel(x))}</small></button>
          <button class="icon" data-up="${x.id}">↑</button>
          <button class="icon" data-down="${x.id}">↓</button>
        </div>`).join('') || '<p class="muted">Sin superficies.</p>'}</div>
      <button class="wide" data-act="add">＋ Agregar superficie</button>`;
  }

  if (sheet === 'connect') {
    const lastJoin = localStorage.getItem('proyectalo.join') || '';
    html = `<h3>Conectar al proyector</h3>
      ${role === 'remote' ? `
        <p>${link.connected ? '✅ Controlando el proyector. Todo lo que mapees aquí se ve en la pared.' : '⏳ ' + (linkStatus === 'starting' ? 'Conectando…' : 'Desconectado')}</p>
        <div class="actions">
          ${!link.connected ? `<button data-act="rejoin">↻ Reintentar</button>` : ''}
          <button data-act="stoplink" class="danger">Desconectar</button>
        </div>` : `
      <div class="opt">
        <b>Opción A · Solo el celular</b>
        <p>Conecta tu celular al proyector (cable USB‑C→HDMI, Lightning→HDMI, Chromecast/Miracast o AirPlay) y usa la app aquí mismo. Presiona <b>Show</b> para ocultar los controles.</p>
      </div>
      <div class="opt">
        <b>Opción B · Laptop/PC/TV en el proyector + celular como control</b>
        <p>1. En el equipo conectado al proyector abre esta app y toca:</p>
        <button class="wide" data-act="host">🖥️ Este equipo es el PROYECTOR</button>
        <p>2. En tu celular escanea el QR o escribe el código:</p>
        <div class="joinrow">
          <input id="code" inputmode="numeric" maxlength="7" placeholder="123 456" value="${esc(lastJoin)}">
          <button data-act="join">📱 Controlar</button>
        </div>
        <p class="muted">Requiere internet en ambos equipos solo para enlazarse (WebRTC).</p>
      </div>`}
      <h4>Proyecto</h4>
      <div class="actions">
        <button data-act="export">⬇ Exportar mapeo</button>
        <label class="btn">⬆ Importar<input id="import" type="file" accept="application/json,.json" hidden></label>
        <button data-act="new" class="danger">Nuevo proyecto</button>
      </div>
      <h4>Consejos rápidos</h4>
      <ul class="tips">
        <li>Empieza con <b>Rejilla de prueba</b>: alinea las 4 esquinas con el objeto real.</li>
        <li>Toca una esquina y usa las flechas ◀▲▶▼ para ajustar al píxel. 🎯 activa precisión fina.</li>
        <li>Cuarto lo más oscuro posible; fondo negro = sin luz.</li>
        <li>Superficie negra encima = máscara para que no se proyecte en algo.</li>
        <li>En iPhone: Compartir → "Agregar a inicio" para pantalla completa.</li>
      </ul>`;
  }

  el.innerHTML = `<div class="grab" data-act="close"></div>` + html;
  bindSheet(el, s);
}

function updateChromeLight() {
  $('#nudge').classList.toggle('on', canEdit() && !!selected() && !sheet);
  $('#nudge-corner').textContent = selCorner >= 0 ? 'Esquina ' + (selCorner + 1) : 'Toda';
  document.querySelectorAll('#bar button[data-sheet]').forEach(b => b.classList.toggle('active', b.dataset.sheet === sheet));
}

function bindSheet(el, s) {
  el.querySelector('#file')?.addEventListener('change', e => importFiles([...e.target.files]));
  el.querySelectorAll('[data-kind]').forEach(b => b.onclick = () => setSource({ kind: b.dataset.kind }));
  el.querySelectorAll('[data-effect]').forEach(b => b.onclick = () => setSource({ kind: 'effect', effect: b.dataset.effect }));
  el.querySelectorAll('[data-media]').forEach(b => b.onclick = () => setSource({ kind: 'media', mediaId: b.dataset.media }));
  el.querySelectorAll('[data-delmedia]').forEach(b => b.onclick = () => { if (confirm('¿Borrar este archivo?')) deleteMedia(b.dataset.delmedia); });
  el.querySelectorAll('[data-pick]').forEach(b => b.onclick = () => { sel = b.dataset.pick; selCorner = -1; changed({ ui: true }); });
  el.querySelectorAll('[data-vis]').forEach(b => b.onclick = () => { const x = state.surfaces.find(q => q.id === b.dataset.vis); x.visible = !x.visible; changed({ ui: true }); });
  el.querySelectorAll('[data-up]').forEach(b => b.onclick = () => moveLayer(b.dataset.up, -1));
  el.querySelectorAll('[data-down]').forEach(b => b.onclick = () => moveLayer(b.dataset.down, 1));

  const bind = (id, key, num) => {
    const i = el.querySelector(id);
    if (!i || !s) return;
    i.addEventListener('input', () => { s[key] = num ? parseFloat(i.value) : i.value; changed(); });
  };
  bind('#f-name', 'name');
  bind('#f-text', 'text');
  bind('#f-color', 'color');
  bind('#f-color2', 'color2');
  bind('#f-opacity', 'opacity', true);
  bind('#f-feather', 'feather', true);
  bind('#f-speed', 'speed', true);
  el.querySelector('#f-audio')?.addEventListener('change', e => { s.audio = e.target.checked; changed(); });

  el.querySelector('#import')?.addEventListener('change', async e => {
    try {
      const data = JSON.parse(await e.target.files[0].text());
      if (!Array.isArray(data.surfaces)) throw new Error();
      state = { media: [], counter: data.surfaces.length + 1, ...data };
      sel = state.surfaces[0]?.id ?? null;
      changed({ ui: true });
      toast('Mapeo importado (los archivos de video/foto se vuelven a subir)');
    } catch { toast('Archivo inválido'); }
  });

  el.querySelectorAll('[data-act]').forEach(b => b.onclick = () => {
    const a = b.dataset.act;
    if (a === 'close') closeSheet();
    else if (a === 'add') addSurface();
    else if (a === 'full') fullScreenSurface();
    else if (a === 'reset') resetCorners();
    else if (a === 'fliph') flip('h');
    else if (a === 'flipv') flip('v');
    else if (a === 'dup') duplicateSurface();
    else if (a === 'del' && s && confirm('¿Eliminar "' + s.name + '"?')) removeSurface(s.id);
    else if (a === 'host') startOutput();
    else if (a === 'join') startRemote(el.querySelector('#code').value);
    else if (a === 'rejoin') startRemote(localStorage.getItem('proyectalo.join'));
    else if (a === 'stoplink') stopLink();
    else if (a === 'export') {
      const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
      const aEl = document.createElement('a');
      aEl.href = URL.createObjectURL(blob);
      aEl.download = 'mapeo.json';
      aEl.click();
    } else if (a === 'new' && confirm('¿Borrar todo y empezar de nuevo?')) {
      state = defaultState();
      sel = state.surfaces[0].id;
      changed({ ui: true });
    }
  });
}

$('#bar').addEventListener('click', e => {
  const b = e.target.closest('button');
  if (!b) return;
  if (b.dataset.sheet) openSheet(b.dataset.sheet);
  else if (b.id === 'btn-add') addSurface();
  else if (b.id === 'btn-show') setShow(!showMode);
});

// ---------- arranque ----------
(async () => {
  knownMedia = await store.mediaIds();
  layout();
  updateChrome();
  requestAnimationFrame(frame);
  const params = new URLSearchParams(location.search);
  const join = params.get('unir');
  if (join) {
    history.replaceState(null, '', location.pathname);
    startRemote(join);
  } else if (!localStorage.getItem('proyectalo.seen')) {
    try { localStorage.setItem('proyectalo.seen', '1'); } catch { /* nada */ }
    openSheet('connect');
  }
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }
})();
