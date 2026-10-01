// Formas que se pueden mapear. Cada superficie guarda `shape` y sus puntos
// `pts` (normalizados 0..1 respecto a la pantalla del proyector).
import { squareToQuad } from './renderer.js';

export const SHAPES = {
  quad: { name: 'Cuadrado', icon: '▢' },
  circle: { name: 'Círculo', icon: '◯' },
  poly: { name: 'Contorno', icon: '✎' },
  cube: { name: 'Cubo', icon: '⬡' },
  box: { name: 'Caja', icon: '⧈' },
};

// Plantillas en el cuadrado unitario.
//  cubo: A arriba, B arriba-der, C abajo-der, D abajo, E abajo-izq, F arriba-izq, G centro
//  caja: 0-3 marco exterior, 4-7 fondo (vista desde dentro, como un cuarto o un nicho)
const TEMPLATES = {
  quad: [[0, 0], [1, 0], [1, 1], [0, 1]],
  circle: [[0, 0], [1, 0], [1, 1], [0, 1]],
  cube: [[0.5, 0], [1, 0.25], [1, 0.75], [0.5, 1], [0, 0.75], [0, 0.25], [0.5, 0.5]],
  box: [[0, 0], [1, 0], [1, 1], [0, 1], [0.3, 0.3], [0.7, 0.3], [0.7, 0.7], [0.3, 0.7]],
};

export const shapeOf = s => (SHAPES[s.shape] ? s.shape : 'quad');

function bbox(pts) {
  const xs = pts.map(p => p[0]), ys = pts.map(p => p[1]);
  return [Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys)];
}

// Coloca la forma dentro del rectángulo [x0, y0, x1, y1].
export function placeShape(shape, rect, current) {
  let unit = TEMPLATES[shape];
  if (!unit) {
    // contorno libre: conserva su dibujo, solo lo reescala
    const [bx0, by0, bx1, by1] = bbox(current);
    const w = bx1 - bx0 || 1, h = by1 - by0 || 1;
    unit = current.map(([x, y]) => [(x - bx0) / w, (y - by0) / h]);
  }
  const [x0, y0, x1, y1] = rect;
  return unit.map(([u, v]) => [x0 + u * (x1 - x0), y0 + v * (y1 - y0)]);
}

// Caras a dibujar: cada una es un cuadrilátero con su brillo (sombreado 3D).
export function facesOf(s) {
  const p = s.pts;
  const shade = s.shade !== false;
  const g = v => (shade ? v : 1);
  switch (shapeOf(s)) {
    case 'cube':
      return [
        { pts: [p[5], p[0], p[1], p[6]], gain: 1 },        // tapa
        { pts: [p[5], p[6], p[3], p[4]], gain: g(0.75) },  // lado izquierdo
        { pts: [p[6], p[1], p[2], p[3]], gain: g(0.55) },  // lado derecho
      ];
    case 'box':
      return [
        { pts: [p[4], p[5], p[6], p[7]], gain: g(0.55) },  // fondo
        { pts: [p[0], p[1], p[5], p[4]], gain: g(0.85) },  // techo
        { pts: [p[5], p[1], p[2], p[6]], gain: g(0.7) },   // derecha
        { pts: [p[7], p[6], p[2], p[3]], gain: 1 },        // piso
        { pts: [p[0], p[4], p[7], p[3]], gain: g(0.7) },   // izquierda
      ];
    case 'poly': {
      const [x0, y0, x1, y1] = bbox(p);
      return [{ pts: [[x0, y0], [x1, y0], [x1, y1], [x0, y1]], gain: 1 }];
    }
    default:
      return [{ pts: p, gain: 1 }];
  }
}

// Contorno exterior (para tocar/seleccionar la superficie).
export function hullOf(s) {
  const sh = shapeOf(s);
  if (sh === 'cube') return s.pts.slice(0, 6);
  if (sh === 'box') return s.pts.slice(0, 4);
  return s.pts;
}

// Líneas que se dibujan en modo edición.
export function outlinesOf(s) {
  const sh = shapeOf(s);
  if (sh === 'circle') {
    const m = squareToQuad(s.pts);
    const ring = [];
    for (let i = 0; i < 48; i++) {
      const a = (i / 48) * Math.PI * 2;
      const u = 0.5 + 0.5 * Math.cos(a), v = 0.5 + 0.5 * Math.sin(a);
      const w = m[6] * u + m[7] * v + 1;
      ring.push([(m[0] * u + m[1] * v + m[2]) / w, (m[3] * u + m[4] * v + m[5]) / w]);
    }
    return [s.pts, ring];
  }
  if (sh === 'cube' || sh === 'box') return facesOf(s).map(f => f.pts);
  return [s.pts];
}

export function pointInPoly(px, py, pts) {
  let inside = false;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    const [xi, yi] = pts[i], [xj, yj] = pts[j];
    if ((yi > py) !== (yj > py) && px < ((xj - xi) * (py - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

// Ramer–Douglas–Peucker: reduce el trazo a mano a pocos puntos editables.
export function simplify(pts, eps) {
  if (pts.length < 3) return pts;
  const [a, b] = [pts[0], pts[pts.length - 1]];
  const dx = b[0] - a[0], dy = b[1] - a[1];
  const len = Math.hypot(dx, dy) || 1;
  let idx = 0, max = 0;
  for (let i = 1; i < pts.length - 1; i++) {
    const d = Math.abs(dy * pts[i][0] - dx * pts[i][1] + b[0] * a[1] - b[1] * a[0]) / len;
    if (d > max) { max = d; idx = i; }
  }
  if (max <= eps) return [a, b];
  return [...simplify(pts.slice(0, idx + 1), eps).slice(0, -1), ...simplify(pts.slice(idx), eps)];
}
