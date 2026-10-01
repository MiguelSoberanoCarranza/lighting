# Proyéctalo · projection mapping desde tu celular

App web (PWA) para hacer **projection mapping / video mapping**: conectas un proyector,
ajustas las 4 esquinas de cada superficie sobre un objeto real (pared, caja, fachada,
escenario…) y le proyectas **videos, fotos, texto, cámara en vivo o efectos de luz**.
Todo se controla desde el celular. No hay que instalar nada: se abre en el navegador.

## Cómo se usa

### Opción A: solo el celular
1. Conecta el celular al proyector (USB‑C→HDMI, Lightning→HDMI, Chromecast/Miracast o AirPlay).
2. Abre la app, toca **＋ Superficie** y arrastra las esquinas hasta que coincidan con el objeto.
   La **Rejilla de prueba** ayuda a alinear.
3. En **Contenido** elige un video/foto, un efecto, texto o color.
4. Toca **Show**: se ocultan los controles y queda solo la proyección.

### Opción B: laptop/PC/Smart TV en el proyector + celular como control remoto
1. En el equipo conectado al proyector abre la app → **Conectar** → **Este equipo es el PROYECTOR**.
   Aparece un código de 6 dígitos y un QR.
2. En el celular escanea el QR (o escribe el código y toca **Controlar**).
3. Todo lo que mapees en el celular aparece en vivo en la pared; los videos y fotos
   se envían solos al proyector (WebRTC, de equipo a equipo).

El enlace usa el servidor público de PeerJS solo para que los equipos se encuentren, así
que ambos necesitan internet en ese momento. Para una red sin internet puedes levantar
tu propio [peerjs-server](https://github.com/peers/peerjs-server) y configurarlo con
`localStorage.setItem('proyectalo.server', '{"host":"192.168.1.10","port":9000,"path":"/","secure":false}')`.

## Funciones
- Corner‑pin con corrección de perspectiva real (homografía en WebGL), varias superficies/capas.
- Fuentes: video (en loop, con audio opcional), foto, texto, color, cámara en vivo.
- 10 efectos de luz generativos: arcoíris, franjas, pulso, barrido, escáner, destellos,
  plasma, ondas, bordes neón y rejilla de prueba (colores y velocidad ajustables).
- Ajuste fino con flechas (mantener presionado repite) y modo precisión 🎯 (×0.2).
- Opacidad, bordes suaves (feather), voltear, duplicar, pantalla completa, orden de capas,
  máscaras (superficie negra encima).
- Guarda solo: el mapeo en `localStorage` y los archivos en IndexedDB. Exportar/importar mapeo (JSON).
- Instalable como app (PWA, pantalla completa). En iPhone: Compartir → *Agregar a inicio*.
- Teclado (laptop): flechas = mover (Shift ×10), Supr = borrar, S = show, Esc = salir.

## Publicarla / correrla
Es un sitio estático, sin build.

- **GitHub Pages**: el workflow `.github/workflows/pages.yml` publica al hacer push a `main`.
  Actívalo en *Settings → Pages → Source: GitHub Actions*. Queda en
  `https://<usuario>.github.io/lighting/` (con HTTPS, necesario para cámara y app instalable).
- **Local**: `python3 -m http.server 8080` en esta carpeta y abre `http://localhost:8080`.

## Investigación: apps de este tipo (2026)

| App | Plataforma | Mapear desde el celular | Precio aprox. | Notas |
|---|---|---|---|---|
| **Lazy Lighting** | iPhone, iPad, Android | Sí, todo en el celular | Freemium | 100+ visuales, audio/MIDI, sin computadora. La más parecida a lo que buscas. |
| **SurfaBeam** | iOS, Android, Windows, Mac | Sí | Freemium / Pro | Mismo motor en celular y PC; bueno para pruebas rápidas y proyectos chicos. |
| **ProMapper** | iPhone, iPad | Sí | Ver tienda | Mapping "pro" en iOS. |
| **Optoma Projection Mapper** | Android | Sí | Ver tienda | Sencilla, pensada para proyectores Optoma pero funciona con otros. |
| **HeavyM** | Windows, Mac (+ app HeavyM Remote) | Solo control remoto (OSC) | ~US$219 | Muy fácil, plantillas y efectos; el mapeo vive en la computadora. |
| **MadMapper** | Windows, Mac | No (control vía OSC/MIDI) | Licencia/renta | Estándar profesional; también controla luces DMX/LED. |
| **Resolume Arena** | Windows, Mac | No | ~€799 | VJ + mapping de nivel festival. |
| **TouchDesigner** | Windows, Mac | No | Gratis no comercial | Programación visual, ilimitado pero curva alta. |
| **DIL Studio / DilMap** | Corre en el proyector | Celular como control | — | El celular es solo el control remoto. |
| **VPT 8, MapMap** | Windows/Mac/Linux | No | Gratis (open source) | Alternativas gratuitas de escritorio. |

**Conclusión:** para algo rápido y totalmente desde el celular, *Lazy Lighting* y *SurfaBeam*
son las referencias; para shows profesionales, *MadMapper* o *Resolume*. **Proyéctalo** cubre
el caso “celular + proyector” sin instalar nada, gratis, y agrega el modo de control remoto
(proyector en una laptop/TV y el celular como control), que en las apps comerciales suele
requerir la versión de escritorio.

Fuentes: [Lazy Lighting](https://lazylighting.com/en),
[SurfaBeam – mejores apps 2026](https://www.surfabeam.com/blogs/best-projection-mapping-apps-2026),
[SurfaBeam en Google Play](https://play.google.com/store/apps/details?id=com.secundumreality.surfabeam),
[ProMapper (App Store)](https://apps.apple.com/us/app/pro-mapper-projection-mapping/id6756812601),
[FindMyProjector – 6 mejores apps](https://findmyprojector.com/guides/best-projection-mapping-software-apps),
[HoloMapper – comparativa 2026](https://holomapperstudio.com/blogs/best-projection-mapping-software-2026/),
[Content Mavericks – software 2026](https://contentmavericks.com/best-projection-mappping-software/).

## Estructura
```
index.html          interfaz
css/style.css       estilos (mobile first, tema oscuro)
js/app.js           estado, edición táctil, paneles, modo show, conexión
js/renderer.js      WebGL: warp de perspectiva + efectos de luz (shaders)
js/store.js         archivos en IndexedDB
js/link.js          enlace celular ↔ proyector (WebRTC con PeerJS)
vendor/             peerjs 1.5.4 y qrcode-generator 1.4.4 (MIT), incluidos sin CDN
sw.js               offline (red primero, caché de respaldo)
```

## Ideas siguientes
Máscaras con forma libre (más de 4 puntos), mallas/warp curvo, sincronizar con música
(micrófono), listas de reproducción/escenas con temporizador, y salida DMX para luces reales.
