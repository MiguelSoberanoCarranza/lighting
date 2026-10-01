// Conexión celular <-> proyector por WebRTC (PeerJS).
// El dispositivo conectado al proyector "hospeda" con un código de 6 dígitos;
// el celular se une con ese código y manda el mapeo en tiempo real.

const PREFIX = 'proyectalo-v1-';

function loadScript(src) {
  return new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = src;
    s.onload = res;
    s.onerror = () => rej(new Error('No se pudo cargar ' + src));
    document.head.appendChild(s);
  });
}

// Servidor de enlace: por defecto el público de PeerJS. Para usar uno propio
// (p. ej. en una red sin internet) guarda en localStorage 'proyectalo.server'
// algo como {"host":"192.168.1.10","port":9000,"path":"/","secure":false}.
function peerOptions() {
  try { return JSON.parse(localStorage.getItem('proyectalo.server')) || {}; } catch { return {}; }
}

async function ensurePeer() {
  if (!window.Peer) await loadScript('vendor/peerjs.min.js');
}

export class Link {
  constructor({ onMessage, onStatus }) {
    this.onMessage = onMessage;
    this.onStatus = onStatus;
    this.peer = null;
    this.conn = null;
  }

  get connected() { return !!(this.conn && this.conn.open); }

  async host(code) {
    await ensurePeer();
    this.close();
    this.onStatus('starting');
    const peer = new window.Peer(PREFIX + code, peerOptions());
    this.peer = peer;
    peer.on('open', () => this.onStatus('waiting'));
    peer.on('connection', c => {
      if (this.conn) this.conn.close();
      this.attach(c);
    });
    peer.on('disconnected', () => { if (!peer.destroyed) peer.reconnect(); });
    peer.on('error', e => this.onStatus('error', e.type));
  }

  async join(code) {
    await ensurePeer();
    this.close();
    this.onStatus('starting');
    const peer = new window.Peer(peerOptions());
    this.peer = peer;
    peer.on('open', () => {
      this.attach(peer.connect(PREFIX + code, { reliable: true }));
    });
    peer.on('error', e => this.onStatus('error', e.type));
  }

  attach(c) {
    this.conn = c;
    c.on('open', () => this.onStatus('connected'));
    c.on('data', d => this.onMessage(d));
    c.on('close', () => { if (this.conn === c) { this.conn = null; this.onStatus('closed'); } });
    c.on('error', () => this.onStatus('error', 'connection'));
  }

  send(msg) {
    if (this.connected) this.conn.send(msg);
  }

  close() {
    if (this.conn) { try { this.conn.close(); } catch { /* nada */ } }
    if (this.peer) { try { this.peer.destroy(); } catch { /* nada */ } }
    this.conn = null;
    this.peer = null;
  }
}
