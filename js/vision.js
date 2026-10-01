// Visión por computadora ligera (sin librerías): detectar el área iluminada por
// el proyector en una foto, encontrar formas de objetos y enderezar la foto.
import { squareToQuad, invert3 } from './renderer.js';
import { pointInPoly, simplifyClosed } from './shapes.js';

const DIRS = [[1, 0], [1, 1], [0, 1], [-1, 1], [-1, 0], [-1, -1], [0, -1], [1, -1]];

export function applyH(m, x, y) {
  const w = m[6] * x + m[7] * y + m[8];
  return [(m[0] * x + m[1] * y + m[2]) / w, (m[3] * x + m[4] * y + m[5]) / w];
}

export async function loadImage(file) {
  const url = URL.createObjectURL(file);
  try {
    const img = new Image();
    img.src = url;
    await img.decode();
    return img;
  } finally {
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}

export function toCanvas(img, maxDim) {
  const k = Math.min(1, maxDim / Math.max(img.naturalWidth || img.width, img.naturalHeight || img.height));
  const c = document.createElement('canvas');
  c.width = Math.max(1, Math.round((img.naturalWidth || img.width) * k));
  c.height = Math.max(1, Math.round((img.naturalHeight || img.height) * k));
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  return c;
}

// Imagen de trabajo: gris suavizado + color, a baja resolución.
export function prepare(canvas) {
  const { width: w, height: h } = canvas;
  const d = canvas.getContext('2d').getImageData(0, 0, w, h).data;
  const rgb = new Float32Array(w * h * 3);
  for (let i = 0; i < w * h; i++) {
    rgb[i * 3] = d[i * 4]; rgb[i * 3 + 1] = d[i * 4 + 1]; rgb[i * 3 + 2] = d[i * 4 + 2];
  }
  const blurred = blurRGB(blurRGB(rgb, w, h), w, h);
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++) gray[i] = 0.299 * blurred[i * 3] + 0.587 * blurred[i * 3 + 1] + 0.114 * blurred[i * 3 + 2];
  return { w, h, rgb: blurred, gray };
}

function blurRGB(src, w, h) {
  const out = new Float32Array(src.length);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      let r = 0, g = 0, b = 0, n = 0;
      for (let dy = -1; dy <= 1; dy++) {
        const yy = y + dy;
        if (yy < 0 || yy >= h) continue;
        for (let dx = -1; dx <= 1; dx++) {
          const xx = x + dx;
          if (xx < 0 || xx >= w) continue;
          const j = (yy * w + xx) * 3;
          r += src[j]; g += src[j + 1]; b += src[j + 2]; n++;
        }
      }
      const i = (y * w + x) * 3;
      out[i] = r / n; out[i + 1] = g / n; out[i + 2] = b / n;
    }
  }
  return out;
}

function otsu(values) {
  const hist = new Float64Array(256);
  for (const v of values) hist[Math.max(0, Math.min(255, v | 0))]++;
  const total = values.length;
  let sum = 0;
  for (let i = 0; i < 256; i++) sum += i * hist[i];
  let sumB = 0, wB = 0, best = 0, thr = 128;
  for (let t = 0; t < 256; t++) {
    wB += hist[t];
    if (!wB) continue;
    const wF = total - wB;
    if (!wF) break;
    sumB += t * hist[t];
    const mB = sumB / wB, mF = (sum - sumB) / wF;
    const between = wB * wF * (mB - mF) ** 2;
    if (between > best) { best = between; thr = t; }
  }
  return thr;
}

// Etiqueta componentes conexos (4-vecinos) de los píxeles donde ok[i] es true.
function components(ok, w, h) {
  const labels = new Int32Array(w * h).fill(-1);
  const comps = [];
  const stack = new Int32Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!ok[i] || labels[i] >= 0) continue;
    const id = comps.length;
    let sp = 0, area = 0, touches = false;
    stack[sp++] = i;
    labels[i] = id;
    while (sp) {
      const p = stack[--sp];
      area++;
      const x = p % w, y = (p / w) | 0;
      if (x === 0 || y === 0 || x === w - 1 || y === h - 1) touches = true;
      const nb = [x > 0 ? p - 1 : -1, x < w - 1 ? p + 1 : -1, y > 0 ? p - w : -1, y < h - 1 ? p + w : -1];
      for (const q of nb) {
        if (q < 0) continue;
        if (!ok[q]) { if (ok.outside && ok.outside[q]) touches = true; continue; }
        if (labels[q] < 0) { labels[q] = id; stack[sp++] = q; }
      }
    }
    comps.push({ id, area, touches });
  }
  return { labels, comps };
}

// Sigue el borde exterior de un componente (Moore) y lo devuelve como polígono.
function trace(labels, w, h, id) {
  let start = -1;
  for (let i = 0; i < labels.length; i++) if (labels[i] === id) { start = i; break; }
  if (start < 0) return [];
  const inside = (x, y) => x >= 0 && y >= 0 && x < w && y < h && labels[y * w + x] === id;
  let cx = start % w, cy = (start / w) | 0;
  const sx = cx, sy = cy;
  let bx = cx - 1, by = cy;               // vecino de fondo (a la izquierda del primer píxel)
  const sbx = bx, sby = by;
  const pts = [[cx, cy]];
  for (let guard = 0; guard < 40000; guard++) {
    let k = DIRS.findIndex(([dx, dy]) => cx + dx === bx && cy + dy === by);
    let found = false;
    for (let s = 1; s <= 8; s++) {
      const j = (k + s) % 8;
      const nx = cx + DIRS[j][0], ny = cy + DIRS[j][1];
      if (inside(nx, ny)) {
        const pj = (j + 7) % 8;
        bx = cx + DIRS[pj][0]; by = cy + DIRS[pj][1];
        cx = nx; cy = ny;
        found = true;
        break;
      }
    }
    if (!found) break;                      // píxel aislado
    if (cx === sx && cy === sy && bx === sbx && by === sby) break;
    if (cx === sx && cy === sy && pts.length > 2) break;
    pts.push([cx, cy]);
  }
  return pts;
}

function polyArea(p) {
  let a = 0;
  for (let i = 0; i < p.length; i++) {
    const [x1, y1] = p[i], [x2, y2] = p[(i + 1) % p.length];
    a += x1 * y2 - x2 * y1;
  }
  return a / 2;
}

function toShape(labels, img, id, grow = 0) {
  let raw = trace(labels, img.w, img.h, id);
  if (raw.length < 8) return null;
  if (grow) {
    // los bordes detectados se "comen" ~2 px de la forma: se recuperan desde el centro
    const cx = raw.reduce((a, q) => a + q[0], 0) / raw.length, cy = raw.reduce((a, q) => a + q[1], 0) / raw.length;
    raw = raw.map(([x, y]) => {
      const d = Math.hypot(x - cx, y - cy) || 1;
      return [x + ((x - cx) / d) * grow, y + ((y - cy) / d) * grow];
    });
  }
  const eps = Math.max(1.2, Math.hypot(img.w, img.h) * 0.006);
  const pts = simplifyClosed(raw, eps);
  if (pts.length < 3) return null;
  return pts.map(([x, y]) => [(x + 0.5) / img.w, (y + 0.5) / img.h]);
}

// Área iluminada: región brillante más grande → sus 4 esquinas extremas.
export function detectProjectedQuad(img) {
  const { w, h, gray } = img;
  const thr = otsu(gray);
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) ok[i] = gray[i] > thr ? 1 : 0;
  const { labels, comps } = components(ok, w, h);
  const big = comps.sort((a, b) => b.area - a.area)[0];
  if (!big || big.area < w * h * 0.08) return null;
  let tl = [0, 0, Infinity], br = [0, 0, -Infinity], tr = [0, 0, -Infinity], bl = [0, 0, Infinity];
  for (let i = 0; i < w * h; i++) {
    if (labels[i] !== big.id) continue;
    const x = i % w, y = (i / w) | 0;
    if (x + y < tl[2]) tl = [x, y, x + y];
    if (x + y > br[2]) br = [x, y, x + y];
    if (x - y > tr[2]) tr = [x, y, x - y];
    if (x - y < bl[2]) bl = [x, y, x - y];
  }
  return [tl, tr, br, bl].map(([x, y]) => [(x + 0.5) / w, (y + 0.5) / h]);
}

function quadMask(img, quad) {
  const { w, h } = img;
  const q = quad.map(([x, y]) => [x * w, y * h]);
  const m = new Uint8Array(w * h);
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) m[y * w + x] = pointInPoly(x + 0.5, y + 0.5, q) ? 1 : 0;
  return m;
}

// Formas: bordes (Sobel) → regiones cerradas dentro del área proyectada.
// sensitivity 0..1: más alto = más bordes = más formas pequeñas.
export function detectShapes(img, quad, sensitivity = 0.5) {
  const { w, h, gray } = img;
  const mask = quadMask(img, quad);
  const mag = new Float32Array(w * h);
  const samples = [];
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const gx = -gray[i - w - 1] - 2 * gray[i - 1] - gray[i + w - 1] + gray[i - w + 1] + 2 * gray[i + 1] + gray[i + w + 1];
      const gy = -gray[i - w - 1] - 2 * gray[i - w] - gray[i - w + 1] + gray[i + w - 1] + 2 * gray[i + w] + gray[i + w + 1];
      mag[i] = Math.hypot(gx, gy);
      if (mask[i]) samples.push(mag[i]);
    }
  }
  if (!samples.length) return [];
  samples.sort((a, b) => a - b);
  const edgeFrac = 0.05 + sensitivity * 0.2;
  const thr = Math.max(40, samples[Math.floor(samples.length * (1 - edgeFrac))]);
  const edge = new Uint8Array(w * h);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      if (mag[i] <= thr) continue;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) edge[i + dy * w + dx] = 1;
    }
  }
  const ok = new Uint8Array(w * h);
  const outside = new Uint8Array(w * h);
  let maskArea = 0;
  for (let i = 0; i < w * h; i++) {
    ok[i] = mask[i] && !edge[i] ? 1 : 0;
    outside[i] = mask[i] ? 0 : 1;
    maskArea += mask[i];
  }
  ok.outside = outside;
  const { labels, comps } = components(ok, w, h);
  const keep = comps
    .filter(c => !c.touches && c.area > maskArea * 0.002 && c.area < maskArea * 0.6)
    .sort((a, b) => b.area - a.area)
    .slice(0, 16);
  const shapes = [];
  for (const c of keep) {
    const pts = toShape(labels, img, c.id, 2);
    if (pts) shapes.push({ pts, area: Math.abs(polyArea(pts)) });
  }
  return shapes;
}

// Varita mágica: región de color parecido alrededor del punto tocado.
export function magicWand(img, quad, px, py, tolerance = 28) {
  const { w, h, rgb } = img;
  const mask = quadMask(img, quad);
  const sx = Math.min(w - 1, Math.max(0, Math.round(px * w))), sy = Math.min(h - 1, Math.max(0, Math.round(py * h)));
  const s = (sy * w + sx) * 3;
  const [r0, g0, b0] = [rgb[s], rgb[s + 1], rgb[s + 2]];
  const ok = new Uint8Array(w * h);
  for (let i = 0; i < w * h; i++) {
    if (!mask[i]) continue;
    const d = Math.hypot(rgb[i * 3] - r0, rgb[i * 3 + 1] - g0, rgb[i * 3 + 2] - b0);
    ok[i] = d < tolerance * 2.2 ? 1 : 0;
  }
  const { labels } = components(ok, w, h);
  const id = labels[sy * w + sx];
  if (id < 0) return null;
  const pts = toShape(labels, img, id);
  return pts ? { pts, area: Math.abs(polyArea(pts)) } : null;
}

// Endereza la foto: lo que hay dentro de `quad` ocupa todo el lienzo de salida.
export function warpToRect(srcCanvas, quad, outW, outH) {
  const sw = srcCanvas.width, sh = srcCanvas.height;
  const src = srcCanvas.getContext('2d').getImageData(0, 0, sw, sh).data;
  const out = document.createElement('canvas');
  out.width = outW; out.height = outH;
  const g = out.getContext('2d');
  const od = g.createImageData(outW, outH);
  const m = squareToQuad(quad);
  for (let y = 0; y < outH; y++) {
    for (let x = 0; x < outW; x++) {
      const [u, v] = applyH(m, (x + 0.5) / outW, (y + 0.5) / outH);
      const ix = Math.floor(u * sw), iy = Math.floor(v * sh);
      const o = (y * outW + x) * 4;
      if (ix < 0 || iy < 0 || ix >= sw || iy >= sh) { od.data[o + 3] = 255; continue; }
      const i = (iy * sw + ix) * 4;
      od.data[o] = src[i]; od.data[o + 1] = src[i + 1]; od.data[o + 2] = src[i + 2]; od.data[o + 3] = 255;
    }
  }
  g.putImageData(od, 0, 0);
  return out;
}

// Pasa puntos de la foto a coordenadas del proyector.
export function photoToProjector(quad, pts) {
  const inv = invert3(squareToQuad(quad));
  if (!inv) return pts;
  return pts.map(([x, y]) => applyH(inv, x, y).map(v => Math.min(1.3, Math.max(-0.3, v))));
}
