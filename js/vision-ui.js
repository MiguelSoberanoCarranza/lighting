// Pantalla de "Detección de formas" y "Fondo de mapeo":
// 1) ajustar las 4 esquinas del área que ilumina el proyector en la foto
// 2) (detección) elegir las formas encontradas o tocar objetos con la varita mágica
import { loadImage, toCanvas, prepare, detectProjectedQuad, detectShapes, magicWand, warpToRect } from './vision.js';
import { pointInPoly } from './shapes.js';

/**
 * @param {object} o
 * @param {File} o.file           foto tomada con la cámara
 * @param {'detect'|'background'} o.mode
 * @param {number} o.aspect       ancho/alto de la pantalla del proyector
 * @param {string} o.areaHint     instrucción para el paso del área
 * @param {(r: {shapes: number[][][], quad: number[][], background: HTMLCanvasElement|null}) => void} o.onDone
 * @param {() => void} o.onClose
 */
export async function openVisionTool({ file, mode, aspect, areaHint, onDone, onClose }) {
  const root = document.createElement('div');
  root.id = 'vision';
  root.innerHTML = `
    <div class="v-head"><b>${mode === 'detect' ? 'Detección de formas' : 'Fondo de mapeo'}</b><small id="v-hint">Procesando foto…</small></div>
    <div class="v-stage"><canvas id="v-canvas"></canvas></div>
    <div class="v-tools" hidden>
      <label>Sensibilidad <input id="v-sens" type="range" min="0" max="1" step="0.05" value="0.5"></label>
      <label class="check"><input id="v-bg" type="checkbox" checked> Usar la foto también como fondo de mapeo</label>
    </div>
    <div class="v-foot"><button id="v-back">Cancelar</button><button id="v-next" class="primary" disabled>Siguiente</button></div>`;
  document.body.appendChild(root);
  const $ = s => root.querySelector(s);
  const canvas = $('#v-canvas');
  const ctx = canvas.getContext('2d');

  let photo, work, quad, step = 'area', candidates = [], dragCorner = -1;
  const close = () => { root.remove(); window.removeEventListener('resize', draw); onClose?.(); };

  try {
    const img = await loadImage(file);
    photo = toCanvas(img, 1600);
    work = prepare(toCanvas(img, 420));
  } catch {
    alert('No se pudo abrir la foto');
    close();
    return;
  }
  const auto = detectProjectedQuad(work);
  quad = auto || [[0.05, 0.05], [0.95, 0.05], [0.95, 0.95], [0.05, 0.95]];

  // ---- dibujo ----
  let fit = { x: 0, y: 0, w: 1, h: 1 };
  function draw() {
    const box = $('.v-stage').getBoundingClientRect();
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = box.width * dpr; canvas.height = box.height * dpr;
    canvas.style.width = box.width + 'px'; canvas.style.height = box.height + 'px';
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const k = Math.min(box.width / photo.width, box.height / photo.height);
    fit = { w: photo.width * k, h: photo.height * k };
    fit.x = (box.width - fit.w) / 2; fit.y = (box.height - fit.h) / 2;
    ctx.clearRect(0, 0, box.width, box.height);
    ctx.drawImage(photo, fit.x, fit.y, fit.w, fit.h);
    const P = ([u, v]) => [fit.x + u * fit.w, fit.y + v * fit.h];
    // oscurecer fuera del área
    ctx.save();
    ctx.beginPath();
    ctx.rect(fit.x, fit.y, fit.w, fit.h);
    quad.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.fillStyle = 'rgba(0,0,0,.55)';
    ctx.fill('evenodd');
    ctx.restore();

    ctx.beginPath();
    quad.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    ctx.closePath();
    ctx.strokeStyle = '#ff2d95';
    ctx.lineWidth = step === 'area' ? 2.5 : 1.5;
    ctx.stroke();

    if (step === 'shapes') {
      for (const c of candidates) {
        ctx.beginPath();
        c.pts.map(P).forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
        ctx.closePath();
        ctx.fillStyle = c.on ? 'rgba(0,229,255,.35)' : 'rgba(255,255,255,.06)';
        ctx.fill();
        ctx.setLineDash(c.on ? [] : [5, 5]);
        ctx.strokeStyle = c.on ? '#00e5ff' : 'rgba(255,255,255,.8)';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.setLineDash([]);
      }
    } else {
      quad.map(P).forEach(([x, y], i) => {
        ctx.beginPath();
        ctx.arc(x, y, 14, 0, Math.PI * 2);
        ctx.fillStyle = i === dragCorner ? '#ff2d95' : 'rgba(255,45,149,.3)';
        ctx.fill();
        ctx.strokeStyle = '#fff';
        ctx.lineWidth = 2;
        ctx.stroke();
        ctx.fillStyle = '#fff';
        ctx.font = '700 11px system-ui';
        ctx.textAlign = 'center';
        ctx.fillText(String(i + 1), x, y + 4);
      });
    }
  }
  window.addEventListener('resize', draw);

  function setStep(s) {
    step = s;
    const hint = $('#v-hint');
    $('.v-tools').hidden = s !== 'shapes';
    $('#v-next').disabled = false;
    if (s === 'area') {
      hint.textContent = areaHint + (auto ? ' (detectado automáticamente, ajústalo si hace falta)' : '');
      $('#v-back').textContent = 'Cancelar';
      $('#v-next').textContent = mode === 'detect' ? 'Buscar formas →' : 'Usar como fondo';
    } else {
      $('#v-back').textContent = '← Área';
      runDetect();
    }
    draw();
  }

  function runDetect() {
    const keep = candidates.filter(c => c.on && c.manual);
    const found = detectShapes(work, quad, parseFloat($('#v-sens').value));
    candidates = [...found.map(c => ({ ...c, on: true })), ...keep];
    updateCount();
  }

  function updateCount() {
    const n = candidates.filter(c => c.on).length;
    $('#v-hint').textContent = candidates.length
      ? `${candidates.length} formas encontradas. Toca una para quitarla o ponerla. Toca otro objeto para seleccionarlo con la varita mágica.`
      : 'No encontré formas claras. Toca cada objeto para seleccionarlo con la varita mágica, o sube la sensibilidad.';
    $('#v-next').textContent = n ? `Agregar ${n} forma${n > 1 ? 's' : ''}` : (mode === 'detect' && $('#v-bg').checked ? 'Solo usar fondo' : 'Agregar');
    $('#v-next').disabled = !n && !$('#v-bg').checked;
    draw();
  }

  // ---- interacción ----
  const toPhoto = ev => {
    const r = canvas.getBoundingClientRect();
    return [(ev.clientX - r.left - fit.x) / fit.w, (ev.clientY - r.top - fit.y) / fit.h];
  };
  canvas.addEventListener('pointerdown', ev => {
    const [u, v] = toPhoto(ev);
    if (step === 'area') {
      let best = -1, bd = 40;
      quad.forEach(([x, y], i) => {
        const d = Math.hypot((x - u) * fit.w, (y - v) * fit.h);
        if (d < bd) { bd = d; best = i; }
      });
      if (best < 0) {
        // tocar lejos de las esquinas mueve la más cercana a ese punto
        best = quad.map(([x, y], i) => [Math.hypot((x - u) * fit.w, (y - v) * fit.h), i]).sort((a, b) => a[0] - b[0])[0][1];
        quad[best] = [u, v];
      }
      dragCorner = best;
      canvas.setPointerCapture(ev.pointerId);
      draw();
      return;
    }
    if (u < 0 || v < 0 || u > 1 || v > 1) return;
    const hit = candidates.filter(c => pointInPoly(u, v, c.pts)).sort((a, b) => a.area - b.area)[0];
    if (hit) hit.on = !hit.on;
    else {
      const c = magicWand(work, quad, u, v);
      let qa = 0;
      quad.forEach(([x1, y1], i) => { const [x2, y2] = quad[(i + 1) % 4]; qa += x1 * y2 - x2 * y1; });
      if (c && c.area < Math.abs(qa / 2) * 0.6) candidates.push({ ...c, on: true, manual: true });
      else if (c) { updateCount(); $('#v-hint').textContent = 'Eso parece el fondo. Toca directamente sobre un objeto.'; return; }
    }
    updateCount();
  });
  canvas.addEventListener('pointermove', ev => {
    if (dragCorner < 0) return;
    const [u, v] = toPhoto(ev);
    quad[dragCorner] = [Math.min(1, Math.max(0, u)), Math.min(1, Math.max(0, v))];
    draw();
  });
  const up = () => { dragCorner = -1; draw(); };
  canvas.addEventListener('pointerup', up);
  canvas.addEventListener('pointercancel', up);
  $('#v-sens').addEventListener('input', runDetect);
  $('#v-bg').addEventListener('change', updateCount);

  $('#v-back').addEventListener('click', () => (step === 'shapes' ? setStep('area') : close()));
  $('#v-next').addEventListener('click', () => {
    if (step === 'area' && mode === 'detect') { setStep('shapes'); return; }
    const wantBg = mode === 'background' || $('#v-bg').checked;
    let background = null;
    if (wantBg) {
      const outW = 1280, outH = Math.round(outW / (aspect || 16 / 9));
      background = warpToRect(photo, quad, outW, Math.max(1, outH));
    }
    const shapes = step === 'shapes' ? candidates.filter(c => c.on).map(c => c.pts) : [];
    close();
    onDone({ shapes, quad: quad.map(p => [...p]), background });
  });

  setStep('area');
}

export function visionHelp(remote) {
  return remote
    ? 'Toma la foto desde atrás o al lado del proyector (mientras más cerca, mejor queda). El proyector se pondrá en blanco para ver el área.'
    : 'Toma la foto desde donde está el proyector, encuadrando la zona donde vas a proyectar. Después ajusta las 4 esquinas a esa zona.';
}
