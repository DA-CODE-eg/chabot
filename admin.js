const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');
const QRCode  = require('qrcode');

const router = express.Router();

const ADMIN_USER    = process.env.ADMIN_USER    || 'admin';
const ADMIN_PASS    = process.env.ADMIN_PASS    || 'legalsegura2024';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'legal2024ultrasecreto';
const TOKEN_COOKIE  = "lsadmin";

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

router.use(express.json());
router.use(express.urlencoded({ extended: true }));

function checkSession(req, res, next) {
    const tok = req.cookies?.[TOKEN_COOKIE];
    if (!tok) return res.redirect('/login.html');
    try {
        const [u, _h] = Buffer.from(tok, 'base64').toString().split('|');
        const hash = crypto.createHmac('sha256', COOKIE_SECRET).update(u + ADMIN_PASS).digest('hex');
        if (u === ADMIN_USER && _h === hash) return next();
        throw Error('bad');
    } catch { return res.redirect('/login.html'); }
}

router.post('/api/login', (req, res) => {
    const {user, pass} = req.body||{};
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        const hash = crypto.createHmac('sha256', COOKIE_SECRET).update(user+pass).digest('hex');
        res.cookie(TOKEN_COOKIE, Buffer.from(user+"|"+hash).toString('base64'),
            {httpOnly:true, maxAge:1000*3600*24*7, path:'/'}).send("ok");
    } else res.status(401).send("fail");
});

router.post('/api/logout', (req, res) => {
    res.clearCookie(TOKEN_COOKIE, {path:'/'});
    res.send("logout");
});

router.get('/', checkSession, (req, res) => res.sendFile(path.join(__dirname,'admin.html')));
router.use(checkSession);

function leerConfig()     { return JSON.parse(fs.readFileSync(CONFIG_PATH, 'utf8')); }
function guardarConfig(c) { fs.writeFileSync(CONFIG_PATH, JSON.stringify(c, null, 2)); }

router.get('/api/config', (req, res) => res.json(leerConfig()));

router.post('/api/producto/nuevo', (req, res) => {
    const { nombre } = req.body;
    if (!nombre) return res.status(400).json({ ok: false, msg: 'Falta el nombre' });
    const cfg = leerConfig();
    const nuevoId = String(Math.max(0, ...Object.keys(cfg.productos).map(Number)) + 1);
    cfg.productos[nuevoId] = { nombre, videos: [], manuales: [] };
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Producto "${nombre}" creado`, id: nuevoId });
});

router.delete('/api/producto/:id', (req, res) => {
    const cfg = leerConfig();
    if (!cfg.productos[req.params.id]) return res.status(404).json({ ok: false, msg: 'No existe' });
    const nombre = cfg.productos[req.params.id].nombre;
    delete cfg.productos[req.params.id];
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Producto "${nombre}" eliminado` });
});

router.post('/api/video/url', (req, res) => {
    const { productoId, nombre, url } = req.body;
    if (!productoId || !nombre || !url) return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].videos.push({ nombre, ruta: url });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video "${nombre}" agregado` });
});

router.post('/api/video/subir', uploadVideo.single('archivo'), (req, res) => {
    const { productoId, nombre } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, msg: 'No se recibió archivo' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].videos.push({ nombre: nombre || req.file.originalname, ruta: `./videos/${req.file.filename}` });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video subido: ${req.file.filename}` });
});

router.delete('/api/video/:productoId/:index', (req, res) => {
    const cfg = leerConfig();
    const p = cfg.productos[req.params.productoId];
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= p.videos.length) return res.status(400).json({ ok: false, msg: 'Índice inválido' });
    const eliminado = p.videos.splice(idx, 1);
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Video "${eliminado[0].nombre}" eliminado` });
});

router.post('/api/manual/url', (req, res) => {
    const { productoId, nombre, url } = req.body;
    if (!productoId || !nombre || !url) return res.status(400).json({ ok: false, msg: 'Faltan datos' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].manuales.push({ nombre, ruta: url });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual "${nombre}" agregado` });
});

router.post('/api/manual/subir', uploadManual.single('archivo'), (req, res) => {
    const { productoId, nombre } = req.body;
    if (!req.file) return res.status(400).json({ ok: false, msg: 'No se recibió archivo' });
    const cfg = leerConfig();
    if (!cfg.productos[productoId]) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    cfg.productos[productoId].manuales.push({ nombre: nombre || req.file.originalname, ruta: `./manuales/${req.file.filename}` });
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual subido: ${req.file.filename}` });
});

router.delete('/api/manual/:productoId/:index', (req, res) => {
    const cfg = leerConfig();
    const p = cfg.productos[req.params.productoId];
    if (!p) return res.status(404).json({ ok: false, msg: 'Producto no existe' });
    const idx = parseInt(req.params.index);
    if (idx < 0 || idx >= p.manuales.length) return res.status(400).json({ ok: false, msg: 'Índice inválido' });
    const eliminado = p.manuales.splice(idx, 1);
    guardarConfig(cfg);
    res.json({ ok: true, msg: `Manual "${eliminado[0].nombre}" eliminado` });
});

// ── WhatsApp via Baileys (global.waState desde index.js) ──

router.get('/api/wa/status', (req, res) => {
    const wa = global.waState || {};
    res.json({ ready: wa.ready || false, qr: !!(wa.qr), number: wa.number || null });
});

router.get('/api/wa/qr', async (req, res) => {
    const wa = global.waState || {};
    if (!wa.qr) return res.status(404).json({ ok: false, msg: "No hay QR disponible." });
    try {
        const svg = await QRCode.toString(wa.qr, { type: 'svg' });
        res.type('svg').send(svg);
    } catch (e) {
        res.status(500).json({ ok: false, msg: 'Error generando QR.' });
    }
});

router.post('/api/wa/logout', async (req, res) => {
    try {
        const wa = global.waState || {};
        if (wa.logout) await wa.logout();
        res.json({ ok: true, msg: "Sesión cerrada. Se generará un nuevo QR en breve." });
    } catch(e) {
        res.status(500).json({ ok: false, msg: "Error cerrando sesión: " + e.message });
    }
});

// Borrar sesión completa y forzar QR nuevo
router.post('/api/wa/reset', async (req, res) => {
    try {
        const authDir = require('path').join(__dirname, 'baileys_auth');
        if (require('fs').existsSync(authDir)) {
            require('fs').rmSync(authDir, { recursive: true, force: true });
        }
        res.json({ ok: true, msg: "Sesión borrada. El servidor generará QR nuevo en ~10 segundos." });
    } catch(e) {
        res.status(500).json({ ok: false, msg: "Error: " + e.message });
    }
});

module.exports = router;