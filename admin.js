const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');

const app  = express();
const PORT = process.env.ADMIN_PORT || 3001;

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'legalsegura2024';

const CONFIG_PATH  = path.join(__dirname, 'media-config.json');
const VIDEOS_DIR   = path.join(__dirname, 'videos');
const MANUALES_DIR = path.join(__dirname, 'manuales');

[VIDEOS_DIR, MANUALES_DIR].forEach(d => { if (!fs.existsSync(d)) fs.mkdirSync(d); });

function storageFor(tipo) {
    return multer.diskStorage({
        destination: (req, file, cb) => cb(null, tipo === 'video' ? VIDEOS_DIR : MANUALES_DIR),
        filename:    (req, file, cb) => cb(null, Date.now() + '_' + file.originalname)
    });
}

const uploadVideo  = multer({ storage: storageFor('video')  });
const uploadManual = multer({ storage: storageFor('manual') });

app.use(express.json());
app.use(express.urlencoded({ extended: true }));

function auth(req, res, next) {
    const b64 = (req.headers.authorization || '').replace('Basic ', '');
    if (!b64) return res.set('WWW-Authenticate','Basic realm="Admin"').status(401).send('No autorizado');
    const [u, p] = Buffer.from(b64, 'base64').toString().split(':');
    if (u === ADMIN_USER && p === ADMIN_PASS) return next();
    return res.set('WWW-Authenticate','Basic realm="Admin"').status(401).send('Credenciales incorrectas');
}

function leerConfig()     { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function guardarConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }

app.get('/',           auth, (req, res) => res.sendFile(path.join(__dirname, 'admin.html')));
app.get('/api/config', auth, (req, res) => res.json(leerConfig()));

// ── Agregar producto nuevo ───────────────────────────────────
app.post('/api/producto/nuevo', auth, (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, msg: 'Falta el nombre' });
    const cfg = leerConfig();
    const nuevoId = String(Math.max(0, ...Object.keys(cfg.productos).map(Number)) + 1);
    cfg.productos[nuevoId] = { nombre, videos: [], manuales: [] };
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Producto "${nombre}" creado`, id: nuevoId });
});

// ── Eliminar producto ────────────────────────────────────────
app.delete('/api/producto/:id', auth, (req, res) => {
    const cfg = leerConfig();
    if (!cfg.productos[req.params.id]) return res.status(404).json({ ok: false, msg: 'No existe' });
    const nombre = cfg.productos[req.params.id].nombre;
    delete cfg.productos[req.params.id];
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Producto "${nombre}" eliminado` });
});

// ── Agregar video por URL ────────────────────────────────────
app.post('/api/video/url', auth, (req, res) => {
    const { productoId, nombre, url } = req.body;
    if (!productoId || !nombre || !url) return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].videos.push({ nombre, ruta: url });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video "${nombre}" agregado` });
});

// ── Subir video desde archivo ────────────────────────────────
app.post('/api/video/subir', auth, uploadVideo.single('archivo'), (req, res) => {
    const { productoId, nombre } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, msg: 'No se recibió archivo' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].videos.push({ nombre: nombre || req.file.originalname, ruta: `./videos/${req.file.filename}` });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video subido: ${req.file.filename}` });
});

// ── Eliminar video ───────────────────────────────────────────
app.delete('/api/video/:productoId/:index', auth, (req, res) => {
    const cfg = leerConfig();
    const p = cfg.productos[req.params.productoId];
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= p.videos.length) return res.status(400).json({ ok: false, msg: 'Índice inválido' });
    const eliminado = p.videos.splice(idx, 1);
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video "${eliminado[0].nombre}" eliminado` });
});

// ── Agregar manual por URL ───────────────────────────────────
app.post('/api/manual/url', auth, (req, res) => {
    const { productoId, nombre, url } = req.body;
    if (!productoId || !nombre || !url) return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].manuales.push({ nombre, ruta: url });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual "${nombre}" agregado` });
});

// ── Subir manual desde archivo ───────────────────────────────
app.post('/api/manual/subir', auth, uploadManual.single('archivo'), (req, res) => {
    const { productoId, nombre } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, msg: 'No se recibió archivo' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].manuales.push({ nombre: nombre || req.file.originalname, ruta: `./manuales/${req.file.filename}` });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual subido: ${req.file.filename}` });
});

// ── Eliminar manual ──────────────────────────────────────────
app.delete('/api/manual/:productoId/:index', auth, (req, res) => {
    const cfg = leerConfig();
    const p = cfg.productos[req.params.productoId];
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= p.manuales.length) return res.status(400).json({ ok: false, msg: 'Índice inválido' });
    const eliminado = p.manuales.splice(idx, 1);
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual "${eliminado[0].nombre}" eliminado` });
});

app.listen(PORT, () => console.log(`🛠️  Admin panel corriendo en puerto ${PORT}`));
module.exports = app;