const express = require('express');
const multer  = require('multer');
const fs      = require('fs');
const path    = require('path');
const crypto  = require('crypto');

const router = express.Router();

const ADMIN_USER = process.env.ADMIN_USER || 'admin';
const ADMIN_PASS = process.env.ADMIN_PASS || 'legalsegura2024';
const COOKIE_SECRET = process.env.COOKIE_SECRET || 'legal2024ultrasecreto';
const TOKEN_COOKIE = "lsadmin";

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

// Middleware de auth por cookie, no Basic Auth
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

// Login API
router.post('/api/login', (req, res) => {
    const {user, pass} = req.body||{};
    if (user === ADMIN_USER && pass === ADMIN_PASS) {
        const hash = crypto.createHmac('sha256', COOKIE_SECRET).update(user+pass).digest('hex');
        res.cookie(TOKEN_COOKIE, Buffer.from(user+"|"+hash).toString('base64'), {httpOnly:true, maxAge:1000*3600*24*7, path:'/'}).send("ok");
    } else res.status(401).send("fail");
});

// Logout API
router.post('/api/logout', (req, res) => {
    res.clearCookie(TOKEN_COOKIE, {path:'/'});
    res.send("logout");
});

// Sirve el panel si está logueado
router.get('/', checkSession, (req, res) => res.sendFile(path.join(__dirname,'admin.html')));

// El resto de rutas API protegidas
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

// --- Vinculación WhatsApp --- //
const { Client, LocalAuth } = require('whatsapp-web.js');
const QRCode = require('qrcode');

let qrData = null;
let waReady = false;
let waNumber = null;

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.SESSION_NAME || 'default',
        dataPath: './.wwebjs_auth'
    }),
    puppeteer: {
        headless: true,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage'
        ]
    }
});

// Evento: QR generado
client.on('qr', qr => {
    qrData = qr;
    waReady = false;
});

// Evento: Autenticado
client.on('ready', async () => {
    waReady = true;
    qrData = null;
    waNumber = (await client.getMe())?.id?._serialized || null;
});

// Evento: Desconectado
client.on('disconnected', () => {
    waReady = false;
    waNumber = null;
    qrData = null;
});

client.initialize();

// --- API para el Panel --- //

// Estado de vinculación
router.get('/api/wa/status', (req, res) => {
    res.json({
        ready: waReady,
        qr: !!qrData,
        number: waNumber
    });
});

// Obtener QR como imagen
router.get('/api/wa/qr', async (req, res) => {
    if (!qrData) return res.status(404).json({ ok: false, msg: "No hay QR disponible." });
    try {
        const svg = await QRCode.toString(qrData, { type: 'svg' });
        res.type('svg').send(svg);
    } catch (e) {
        res.status(500).json({ ok: false, msg: 'Error generando QR.' });
    }
});

// Desvincular/cerrar sesión
router.post('/api/wa/logout', async (req, res) => {
    try {
        await client.logout();
        waReady = false;
        qrData = null;
        waNumber = null;
        res.json({ ok: true, msg: "Sesión cerrada. Se generará un nuevo QR." });
    } catch(e) {
        res.status(500).json({ ok: false, msg: "Error cerrando sesión." });
    }
});

module.exports = router;