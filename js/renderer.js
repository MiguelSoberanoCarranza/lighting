// Motor WebGL: dibuja cada superficie como un cuadrilátero con corrección de
// perspectiva (homografía), igual que el "corner pin" de MadMapper/Resolume.

const VS = `
attribute vec2 a_pos;
varying vec2 v_pos;
void main() {
  v_pos = a_pos;
  gl_Position = vec4(a_pos.x * 2.0 - 1.0, 1.0 - a_pos.y * 2.0, 0.0, 1.0);
}`;

const FS = `
precision highp float;
varying vec2 v_pos;
uniform mat3 u_inv;
uniform sampler2D u_tex;
uniform int u_mode;
uniform vec3 u_c1;
uniform vec3 u_c2;
uniform float u_time;
uniform float u_opacity;
uniform float u_feather;

vec3 hsv2rgb(vec3 c) {
  vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
  vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
  return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
}
float hash(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }

void main() {
  vec3 h = u_inv * vec3(v_pos, 1.0);
  vec2 uv = h.xy / h.z;
  if (h.z <= 0.0 || uv.x < 0.0 || uv.x > 1.0 || uv.y < 0.0 || uv.y > 1.0) discard;
  float t = u_time;
  vec4 col = vec4(u_c1, 1.0);

  if (u_mode == 0) {                       // imagen / video / texto / cámara
    col = texture2D(u_tex, uv);
  } else if (u_mode == 1) {                // color sólido
    col = vec4(u_c1, 1.0);
  } else if (u_mode == 2) {                // arcoíris
    col = vec4(hsv2rgb(vec3(fract(uv.x * 0.8 + uv.y * 0.2 - t * 0.15), 0.9, 1.0)), 1.0);
  } else if (u_mode == 3) {                // franjas en movimiento
    float s = step(0.5, fract(uv.x * 6.0 - t * 0.6));
    col = vec4(mix(u_c1, u_c2, s), 1.0);
  } else if (u_mode == 4) {                // pulso (respiración)
    float p = 0.5 + 0.5 * sin(t * 2.5);
    col = vec4(mix(u_c2 * 0.05, u_c1, p * p), 1.0);
  } else if (u_mode == 5) {                // rejilla de prueba para alinear
    vec2 g = abs(fract(uv * 8.0) - 0.5);
    float l = step(0.46, max(g.x, g.y));
    float b = step(0.985, max(abs(uv.x - 0.5), abs(uv.y - 0.5)) * 2.0);
    float d = step(abs(uv.x - uv.y), 0.004) + step(abs(uv.x + uv.y - 1.0), 0.004);
    float c = step(length(uv - 0.5), 0.02);
    col = vec4(mix(vec3(0.06), u_c1, clamp(l + b + d + c, 0.0, 1.0)), 1.0);
  } else if (u_mode == 6) {                // barrido de degradado
    float s = 0.5 + 0.5 * sin((uv.x + uv.y) * 6.2831 - t * 2.0);
    col = vec4(mix(u_c1, u_c2, s), 1.0);
  } else if (u_mode == 7) {                // escáner (línea que recorre)
    float x = fract(t * 0.35);
    float d = abs(uv.x - x);
    float glow = exp(-d * 40.0) + 0.6 * exp(-abs(uv.x - fract(x + 0.5)) * 40.0);
    col = vec4(u_c1 * glow + u_c2 * 0.03, 1.0);
  } else if (u_mode == 8) {                // destellos
    vec2 cell = floor(uv * 24.0);
    float r = hash(cell);
    float tw = pow(max(0.0, sin(t * (1.0 + r * 3.0) + r * 40.0)), 24.0);
    vec2 f = fract(uv * 24.0) - 0.5;
    float star = tw * smoothstep(0.35, 0.0, length(f));
    col = vec4(mix(u_c2 * 0.08, u_c1, star), 1.0);
  } else if (u_mode == 9) {                // plasma
    float v = sin(uv.x * 10.0 + t) + sin((uv.y * 10.0 + t) * 0.7)
            + sin((uv.x * 10.0 + uv.y * 10.0 + t) * 0.5)
            + sin(length(uv * 10.0 - 5.0) * 1.5 - t);
    col = vec4(hsv2rgb(vec3(v * 0.125 + t * 0.05, 0.85, 1.0)), 1.0);
  } else if (u_mode == 10) {               // ondas desde el centro
    float r = length(uv - 0.5);
    float s = 0.5 + 0.5 * sin(r * 40.0 - t * 4.0);
    col = vec4(mix(u_c2 * 0.1, u_c1, s * s), 1.0);
  } else if (u_mode == 11) {               // bordes de neón (contorno de la pieza)
    float e = min(min(uv.x, 1.0 - uv.x), min(uv.y, 1.0 - uv.y));
    float glow = smoothstep(0.06, 0.0, e);
    float run = 0.5 + 0.5 * sin((uv.x - uv.y) * 12.0 - t * 4.0);
    col = vec4(mix(u_c1, u_c2, run) * glow, 1.0);
  }

  float f = 1.0;
  if (u_feather > 0.0) {
    f = smoothstep(0.0, u_feather, uv.x) * smoothstep(0.0, u_feather, 1.0 - uv.x)
      * smoothstep(0.0, u_feather, uv.y) * smoothstep(0.0, u_feather, 1.0 - uv.y);
  }
  gl_FragColor = vec4(col.rgb, col.a * u_opacity * f);
}`;

// Homografía que lleva el cuadrado unitario (0,0)(1,0)(1,1)(0,1) a los 4 puntos.
export function squareToQuad(p) {
  const [[x0, y0], [x1, y1], [x2, y2], [x3, y3]] = p;
  const dx1 = x1 - x2, dx2 = x3 - x2, dx3 = x0 - x1 + x2 - x3;
  const dy1 = y1 - y2, dy2 = y3 - y2, dy3 = y0 - y1 + y2 - y3;
  let g = 0, h = 0;
  const det = dx1 * dy2 - dx2 * dy1;
  if ((dx3 !== 0 || dy3 !== 0) && Math.abs(det) > 1e-12) {
    g = (dx3 * dy2 - dx2 * dy3) / det;
    h = (dx1 * dy3 - dx3 * dy1) / det;
  }
  return [
    x1 - x0 + g * x1, x3 - x0 + h * x3, x0,
    y1 - y0 + g * y1, y3 - y0 + h * y3, y0,
    g, h, 1,
  ];
}

export function invert3(m) {
  const [a, b, c, d, e, f, g, h, i] = m;
  const A = e * i - f * h, B = -(d * i - f * g), C = d * h - e * g;
  const det = a * A + b * B + c * C;
  if (Math.abs(det) < 1e-12) return null;
  const k = 1 / det;
  return [
    A * k, -(b * i - c * h) * k, (b * f - c * e) * k,
    B * k, (a * i - c * g) * k, -(a * f - c * d) * k,
    C * k, -(a * h - b * g) * k, (a * e - b * d) * k,
  ];
}

function hexToRgb(hex) {
  const n = parseInt((hex || '#ffffff').slice(1), 16);
  return [((n >> 16) & 255) / 255, ((n >> 8) & 255) / 255, (n & 255) / 255];
}

function isReady(el) {
  if (!el) return false;
  if (el instanceof HTMLVideoElement) return el.readyState >= 2 && el.videoWidth > 0;
  if (el instanceof HTMLImageElement) return el.complete && el.naturalWidth > 0;
  return true; // canvas
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    const gl = canvas.getContext('webgl', { alpha: false, antialias: true, premultipliedAlpha: false });
    if (!gl) throw new Error('WebGL no disponible');
    this.gl = gl;
    const prog = gl.createProgram();
    for (const [type, src] of [[gl.VERTEX_SHADER, VS], [gl.FRAGMENT_SHADER, FS]]) {
      const s = gl.createShader(type);
      gl.shaderSource(s, src);
      gl.compileShader(s);
      if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(s));
      gl.attachShader(prog, s);
    }
    gl.linkProgram(prog);
    if (!gl.getProgramParameter(prog, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(prog));
    gl.useProgram(prog);
    this.u = {};
    for (const n of ['u_inv', 'u_tex', 'u_mode', 'u_c1', 'u_c2', 'u_time', 'u_opacity', 'u_feather']) {
      this.u[n] = gl.getUniformLocation(prog, n);
    }
    this.buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
    const loc = gl.getAttribLocation(prog, 'a_pos');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);
    gl.uniform1i(this.u.u_tex, 0);
    this.tex = new Map();
    this.frame = 0;
  }

  resize(w, h) {
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
    }
    this.gl.viewport(0, 0, w, h);
  }

  // Devuelve una textura lista para `el`, o null si todavía no carga.
  texture(key, el) {
    const gl = this.gl;
    let e = this.tex.get(key);
    if (!e) {
      const t = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, t);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      e = { t, el: null, uploaded: -1 };
      this.tex.set(key, e);
    }
    if (e.el !== el) { e.el = el; e.uploaded = -1; }
    if (!isReady(el)) return e.uploaded >= 0 ? e.t : null;
    const dynamic = el instanceof HTMLVideoElement;
    gl.bindTexture(gl.TEXTURE_2D, e.t);
    if (e.uploaded < 0 || (dynamic && e.uploaded !== this.frame)) {
      try {
        gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, el);
        e.uploaded = this.frame;
      } catch (err) {
        return null;
      }
    }
    return e.t;
  }

  dropTexture(key) {
    const e = this.tex.get(key);
    if (e) { this.gl.deleteTexture(e.t); this.tex.delete(key); }
  }

  // items: [{ pts, mode, texKey, el, c1, c2, time, opacity, feather }]
  draw(items) {
    const gl = this.gl;
    this.frame++;
    gl.clearColor(0, 0, 0, 1);
    gl.clear(gl.COLOR_BUFFER_BIT);
    for (const it of items) {
      const inv = invert3(squareToQuad(it.pts));
      if (!inv) continue;
      let mode = it.mode;
      if (mode === 0) {
        const t = this.texture(it.texKey, it.el);
        if (!t) { mode = 1; it.c1 = '#0d0d12'; }
        else { gl.activeTexture(gl.TEXTURE0); gl.bindTexture(gl.TEXTURE_2D, t); }
      }
      // mat3 en GLSL es column-major
      gl.uniformMatrix3fv(this.u.u_inv, false, [inv[0], inv[3], inv[6], inv[1], inv[4], inv[7], inv[2], inv[5], inv[8]]);
      gl.uniform1i(this.u.u_mode, mode);
      gl.uniform3fv(this.u.u_c1, hexToRgb(it.c1));
      gl.uniform3fv(this.u.u_c2, hexToRgb(it.c2));
      gl.uniform1f(this.u.u_time, it.time);
      gl.uniform1f(this.u.u_opacity, it.opacity);
      gl.uniform1f(this.u.u_feather, it.feather);
      const [p0, p1, p2, p3] = it.pts;
      gl.bindBuffer(gl.ARRAY_BUFFER, this.buf);
      gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([...p0, ...p1, ...p2, ...p0, ...p2, ...p3]), gl.DYNAMIC_DRAW);
      gl.drawArrays(gl.TRIANGLES, 0, 6);
    }
  }
}
