console.log("Servidor Node funcionando");

require('dotenv').config();

const { default: makeWASocket, useMultiFileAuthState, DisconnectReason, fetchLatestBaileysVersion } = require('@whiskeysockets/baileys');
const { Boom } = require('@hapi/boom');
const fs = require('fs');
const path = require('path');
const Groq = require("groq-sdk");
const express = require('express');
const cookieParser = require('cookie-parser');
const pino = require('pino');

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cookieParser());
app.use(express.static(__dirname));

// ── Estado global del bot (accesible desde admin.js) ──
let waSocket = null;
let waQR = null;
let waReady = false;
let waNumber = null;
let waPairingCode = null;
let waPairingNumber = null;

global.waState = {
    get socket() { return waSocket; },
    get qr() { return waQR; },
    get ready() { return waReady; },
    get number() { return waNumber; },
    get pairingCode() { return waPairingCode; },
    get pairingNumber() { return waPairingNumber; },
    logout: async () => {
        const AUTH_DIR = './baileys_auth';
        if (waSocket) { try { await waSocket.logout(); } catch(e){} }
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        waReady = false; waQR = null; waNumber = null; waPairingCode = null; waPairingNumber = null;
    },
    requestPairing: async (numero) => {
        const AUTH_DIR = './baileys_auth';
        if (waSocket) { try { waSocket.end(); } catch(e){} waSocket = null; }
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        waPairingNumber = numero.replace(/\D/g, '');
        waPairingCode = null;
        global._forzarPairing = true;
        waReady = false; waQR = null; waNumber = null;
        console.log('🔗 Iniciando pairing para:', waPairingNumber);
        await startBot();
    },
    startQR: async () => {
        const AUTH_DIR = './baileys_auth';
        if (waSocket) { try { waSocket.end(); } catch(e){} waSocket = null; }
        if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
        waPairingNumber = null; waPairingCode = null;
        waReady = false; waQR = null; waNumber = null;
        await startBot();
    }
};

// ── Leer config de medios ──
function getMedia() {
    return JSON.parse(fs.readFileSync('./media-config.json', 'utf8'));
}

// ── Groq IA ──
const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

async function responderIA(textoUsuario) {
    const contexto = `
Eres el asistente virtual de Legal Segura S.A.S, una empresa colombiana especializada en servicios de certificación digital.

Productos que ofrece la empresa:
- Correo Electrónico Certificado: garantiza envío, recepción y trazabilidad con validez jurídica (Ley 527 de 1999).
- Firma Electrónica Certificada: basada en contraseñas, códigos o biometría (Decreto 2364 de 2012).
- Firma Digital: método criptográfico con certificado de entidad autorizada, validez igual a firma manuscrita.
- Firma Electrónica (Firma Plus): firma desde cualquier dispositivo con OTP, selfie y firma manuscrita digital.
- App Tools: aplicación para revisar y hacer seguimiento de certificados emitidos.

Información de contacto:
- Email: contacto@legalsegura.com.co
- NIT: 901.474.747-5
- Pagos: Banco Caja Social cuenta 2100-441-3030, NEQUI/DAVIPLATA: 315 5050906

Instrucciones:
- Responde siempre en español, de forma amable y profesional.
- Si la pregunta es sobre precios o compra, indica que escriba "hola" para ver el menú de opciones.
- Si la pregunta no tiene relación con Legal Segura ni servicios legales/digitales, responde brevemente que solo puedes ayudar con temas relacionados a la empresa.
- Sé conciso. Máximo 3-6 líneas por respuesta.
    `;
    try {
        const response = await groq.chat.completions.create({
            model: "llama-3.3-70b-versatile",
            messages: [
                { role: "system", content: contexto },
                { role: "user", content: textoUsuario }
            ],
            max_tokens: 300,
            temperature: 0.7
        });
        return response.choices[0].message.content;
    } catch (error) {
        console.error("Error Groq:", error.message);
        return "⚠️ En este momento no puedo responder. Escribe *hola* para ver el menú principal o contáctanos en contacto@legalsegura.com";
    }
}

// ── Estado por usuario ──
const userState = {};

// ── Enviar texto ──
async function sendMsg(jid, text) {
    if (!waSocket || !waReady) return;
    await waSocket.sendMessage(jid, { text });
}

// ── Enviar archivo ──
function getMimeFromPath(filePath) {
    const ext = path.extname(filePath).toLowerCase();
    if (['.mp4', '.mov', '.avi'].includes(ext)) return 'video/mp4';
    if (ext === '.pdf') return 'application/pdf';
    return 'application/octet-stream';
}

async function sendFile(jid, filePath, fileName) {
    if (!waSocket || !waReady) return;
    if (filePath.startsWith('http')) {
        await waSocket.sendMessage(jid, { text: fileName + ':\n' + filePath });
    } else {
        const buffer = fs.readFileSync(filePath);
        const mime = getMimeFromPath(filePath);
        if (mime.includes('video')) {
            await waSocket.sendMessage(jid, { video: buffer, caption: fileName });
        } else if (mime.includes('pdf')) {
            await waSocket.sendMessage(jid, { document: buffer, mimetype: 'application/pdf', fileName });
        } else {
            await waSocket.sendMessage(jid, { document: buffer, fileName });
        }
    }
}

// ── Lógica de mensajes ──
async function handleMessage(jid, body, hasMedia, mediaType) {
    const text = (body || '').toLowerCase().trim();
    const user = jid;

    // Comprobante de pago
    if (userState[user]?.step === "waiting_comprobante" && hasMedia && mediaType === "image") {
        await sendMsg(user,
            "📄 Hemos recibido tu comprobante de pago correctamente.\n\n" +
            "Para activar tu servicio, por favor diligencia el siguiente formulario:\n\n" +
            "📝 FORMULARIO:\n" +
            "👉 https://docs.google.com/forms/d/e/1FAIpQLSfKZog9bdN4pt0EMLc1ec7nbsPrINX6MdTEcfKvKcbPH-qm6g/viewform\n\n" +
            "⏱️ Una vez lo completes, tu servicio será activado lo antes posible."
        );
        userState[user] = null;
        return;
    }

    if (userState[user]?.step === "waiting_comprobante" && !hasMedia) {
        await sendMsg(user,
            "📸 Por favor envía una *imagen* de tu comprobante de pago para continuar.\n\n" +
            "Si deseas cancelar, escribe *hola* para volver al menú principal."
        );
        return;
    }

    // Gracias
    if (text.includes("gracias")) {
        await sendMsg(user, "¡Gracias por contactarnos! Si necesitas algo más, estaremos atentos. ¡Feliz día!");
        return;
    }

    // Saludo → menú
    if (
        text.includes("hola") || text.includes("buenos dias") || text.includes("buenos días") ||
        text.includes("buenas tardes") || text.includes("buenas noches") ||
        text.includes("menu") || text.includes("menú") || text.includes("inicio")
    ) {
        userState[user] = { step: "initial_menu" };
        await sendMsg(user,
            "👋 Hola, bienvenido a *Legal Segura*.\n\n" +
            "¿Qué deseas hacer?\n\n" +
            "1️⃣ Dudas sobre funcionamiento del producto\n" +
            "2️⃣ Compra de productos\n" +
            "3️⃣ Información de productos\n" +
            "4️⃣ Contactar con un asesor\n\n" +
            "👉 Escribe *1*, *2*, *3* o *4*"
        );
        return;
    }

    // Menú inicial
    if (userState[user]?.step === "initial_menu") {
        if (text === "1") {
            userState[user].step = "dudas_menu";
            await sendMsg(user,
                "📝 ¿Sobre qué producto tienes dudas?\n\n" +
                "1️⃣ Correo Electrónico Certificado\n" +
                "2️⃣ Firma Electrónica Certificada\n" +
                "3️⃣ Firma Digital\n" +
                "4️⃣ App Tools\n" +
                "5️⃣ Firma Electrónica (Firma Plus)\n\n" +
                "👉 Responde con 1, 2, 3, 4 o 5"
            );
            return;
        }
        if (text === "2") {
            userState[user].step = "purchase_menu";
            await sendMsg(user,
                "🛒 *Compra de productos*\n\n" +
                "Selecciona el producto que deseas comprar:\n\n" +
                "1️⃣ Correo Electrónico Certificado\n" +
                "2️⃣ Firma Electrónica Certificada\n" +
                "3️⃣ Firma Digital\n" +
                "4️⃣ Firma Electrónica"
            );
            return;
        }
        if (text === "3") {
            userState[user].step = "info_menu";
            await sendMsg(user,
                "📘 ¿Sobre qué servicio deseas información?\n\n" +
                "1️⃣ Correo Electrónico Certificado\n" +
                "2️⃣ Firma Electrónica Certificada\n" +
                "3️⃣ Firma Digital\n" +
                "4️⃣ Firma Electrónica"
            );
            return;
        }
        if (text === "4") {
            userState[user] = null;
            await sendMsg(user,
                "👨‍💼 *Contacto con asesor*\n\n" +
                "Tu solicitud ha sido registrada correctamente.\n\n" +
                "En breve uno de nuestros asesores continuará la atención por este mismo chat.\n\n" +
                "Gracias por elegir *Legal Segura*."
            );
            return;
        }
        const ia = await responderIA(body);
        await sendMsg(user, ia + "\n\n_Escribe *hola* para ver el menú principal._");
        return;
    }

    // Dudas → producto
    if (userState[user]?.step === "dudas_menu" && ["1","2","3","4","5"].includes(text)) {
        userState[user].option = text;
        userState[user].step = "dudas_video";
        const desc = {
            "1": "📬 *Correo Electrónico Certificado*\n\nEste servicio cuenta con plena validez jurídica y permite certificar el envío, la recepción y el contenido de los mensajes electrónicos.",
            "2": "✍️ *Firma Electrónica Certificada*\n\nPermite firmar documentos digitalmente con validez jurídica.",
            "3": "🔐 *Firma Digital*\n\nFirma respaldada por un certificado digital emitido por una entidad certificadora.",
            "4": "📱 *App Tools*\n\nAplicación diseñada para la revisión de certificados de forma rápida y segura.",
            "5": "✍️ *Firma Electrónica (Firma Plus)*\n\nPermite firmar desde cualquier lugar con OTP, selfie y firma manuscrita digital."
        };
        await sendMsg(user, desc[text] + "\n\nPor favor indícanos tu preferencia:\n1️⃣ Video explicativo\n2️⃣ Manual del producto");
        return;
    }

    // Envío video o manual
    if (userState[user]?.step === "dudas_video") {
        const option = userState[user].option;
        const cfg = getMedia();
        const producto = cfg.productos[option];
        if (text === "1") {
            const videos = producto?.videos || [];
            if (videos.length > 0) {
                await sendMsg(user, "📹 Enviando video explicativo...");
                await sendFile(user, videos[0].ruta, videos[0].nombre).catch(() =>
                    sendMsg(user, "⚠️ No se pudo enviar el video. Contacta a soporte.")
                );
            } else {
                await sendMsg(user, "⚠️ No hay video disponible para este producto aún.");
            }
            userState[user] = null;
            return;
        }
        if (text === "2") {
            const manuales = producto?.manuales || [];
            if (manuales.length > 0) {
                await sendMsg(user, "📄 Enviando manual del producto...");
                await sendFile(user, manuales[0].ruta, manuales[0].nombre).catch(() =>
                    sendMsg(user, "⚠️ No se pudo enviar el manual. Contacta a soporte.")
                );
            } else {
                await sendMsg(user, "⚠️ No hay manual disponible para este producto aún.");
            }
            userState[user] = null;
            return;
        }
    }

    // Compra
    if (userState[user]?.step === "purchase_menu") {
        const precios = {
            "1": "📬 *CORREO ELECTRÓNICO CERTIFICADO – 2026*\n\n5 correos = *$13.700 COP* IVA incluido\n10 correos = *$21.000 COP* IVA incluido\n20 correos = *$40.000 COP* IVA incluido\n50 correos = *$79.000 COP* IVA incluido\n100 correos = *$150.000 COP* IVA incluido\n200 correos = *$240.000 COP* IVA incluido\n500 correos = *$525.000 COP* IVA incluido",
            "2": "✍️ *FIRMA ELECTRÓNICA CERTIFICADA*\n\n• 1 año = *$120.000 + IVA*\n• 2 años = *$180.000 + IVA*",
            "3": "🔐 *FIRMA DIGITAL*\n\n🖥️ Token Virtual\n• 1 año = *$160.000 + IVA*\n• 2 años = *$220.000 + IVA*\n\n🔑 Token Físico\n• 1 año = *$220.000 + IVA*\n• 2 años = *$265.000 + IVA*",
            "4": "✍️ *FIRMA ELECTRÓNICA*\n\n• 1 año = *$120.000 + IVA*\n• 2 años = *$180.000 + IVA*"
        };
        if (precios[text]) {
            userState[user] = { step: "waiting_comprobante" };
            await sendMsg(user,
                precios[text] + "\n\n" +
                "💳 *Métodos de pago:*\n" +
                "• Banco Caja Social – Cuenta corriente 2100-441-3030\n" +
                "• NEQUI: 315 5050906\n" +
                "• DAVIPLATA: 315 5050906\n" +
                "A nombre de Legal Segura S.A.S – NIT 901.474.747-5\n\n" +
                "📸 Después de pagar, envía aquí tu comprobante (imagen)."
            );
            return;
        }
    }

    // Info general
    if (userState[user]?.step === "info_menu") {
        const infos = {
            "1": "📬 *Correo Electrónico Certificado*\n\nGarantiza la entrega, recepción y trazabilidad de un mensaje de datos con validez jurídica conforme a la Ley 527 de 1999.",
            "2": "✍️ *Firma Electrónica Certificada*\n\nIncluye contraseñas, códigos, biometría o claves. Regulada por el Decreto 2364 de 2012.",
            "3": "🔐 *Firma Digital*\n\nMétodo criptográfico con validez jurídica igual a firma manuscrita. Emitida por entidades certificadoras autorizadas.",
            "4": "✍️ *Firma Electrónica (Firma Plus)*\n\nFirma desde cualquier lugar con OTP, selfie y firma manuscrita digital. Validez jurídica plena."
        };
        if (infos[text]) {
            await sendMsg(user, infos[text] + "\n\n🔹 Escribe *hola* para volver al menú principal");
            userState[user] = null;
            return;
        }
    }

    // IA Groq
    const ia = await responderIA(body);
    await sendMsg(user, ia + "\n\n_💡 Escribe *hola* si deseas ver el menú de opciones._");
}

// ── Iniciar bot Baileys ──
async function startBot() {
    const AUTH_DIR = './baileys_auth';

    // Limpiar sesión vacía/corrupta antes de iniciar
    if (fs.existsSync(AUTH_DIR)) {
        const files = fs.readdirSync(AUTH_DIR);
        const isEmpty = files.length === 0 || files.every(f => {
            try { return fs.statSync(path.join(AUTH_DIR, f)).size === 0; } catch { return true; }
        });
        if (isEmpty) {
            fs.rmSync(AUTH_DIR, { recursive: true, force: true });
            console.log('🧹 Sesión vacía limpiada al inicio');
        }
    }

    const { state, saveCreds } = await useMultiFileAuthState(AUTH_DIR);
    const { version } = await fetchLatestBaileysVersion();
    console.log('📦 Versión WA Web:', version.join('.'));

    waSocket = makeWASocket({
        auth: state,
        version,
        printQRInTerminal: false,
        logger: pino({ level: 'silent' }),
        browser: ['Legal Segura Bot', 'Chrome', '120.0.0'],
        keepAliveIntervalMs: 9000,
    });

    waSocket.ev.on('creds.update', saveCreds);

    waSocket.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        if (qr) {
            if (waPairingNumber && !waPairingCode) {
                try {
                    console.log('📲 Solicitando pairing code para:', waPairingNumber);
                    const code = await waSocket.requestPairingCode(waPairingNumber);
                    waPairingCode = code?.match(/.{1,4}/g)?.join('-') || code;
                    console.log('✅ Código listo:', waPairingCode);
                } catch(e) {
                    console.error('❌ Error pidiendo código:', e.message);
                    waPairingCode = 'ERROR: ' + e.message;
                }
            } else if (!waPairingNumber) {
                waQR = qr;
            }
        }
        if (connection === 'close') {
            waReady = false; waQR = null; waNumber = null;
            const code = lastDisconnect?.error?.output?.statusCode;
            console.log('⚠️ Desconectado, código:', code);

            if (code === 405 || code === 401 || code === 403 || code === DisconnectReason.loggedOut) {
                console.log('🗑️ Sesión rechazada — borrando...');
                try {
                    if (fs.existsSync(AUTH_DIR)) fs.rmSync(AUTH_DIR, { recursive: true, force: true });
                } catch(e) {}
                if (waPairingNumber) {
                    waPairingCode = null;
                    console.log('🛑 Modo pairing — esperando acción desde el admin (no reinicia solo)');
                    return;
                }
                setTimeout(startBot, 8000);
            } else {
                if (waPairingNumber) {
                    waPairingCode = null;
                    console.log('🔄 Reconectando para nuevo código en 5s...');
                    setTimeout(startBot, 5000);
                } else {
                    console.log('🔄 Reconectando en 8s...');
                    setTimeout(startBot, 8000);
                }
            }
        }
        if (connection === 'open') {
            waReady = true; waQR = null;
            waNumber = waSocket.user?.id || null;
            console.log('🤖 Bot conectado:', waNumber);
        }
    });

    waSocket.ev.on('messages.upsert', async ({ messages, type }) => {
        if (type !== 'notify') return;
        for (const msg of messages) {
            if (msg.key.fromMe) continue;
            if (!msg.message) continue;
            const jid = msg.key.remoteJid;
            if (jid.endsWith('@g.us')) continue;
            const body =
                msg.message?.conversation ||
                msg.message?.extendedTextMessage?.text ||
                msg.message?.imageMessage?.caption ||
                msg.message?.videoMessage?.caption || '';
            const hasMedia = !!(msg.message?.imageMessage || msg.message?.videoMessage || msg.message?.documentMessage);
            const mediaType = msg.message?.imageMessage ? 'image' : 'other';
            await handleMessage(jid, body, hasMedia, mediaType);
        }
    });
}

// ── Montar admin ──
app.use('/admin', require('./admin'));
app.listen(PORT, () => console.log(`🌐 Servidor web corriendo en puerto ${PORT}`));

console.log('🚀 Bot listo — esperando acción desde el admin para conectar WhatsApp.');

process.on('uncaughtException', err => console.error('❌ uncaughtException:', err.message));
process.on('unhandledRejection', err => console.error('❌ unhandledRejection:', err?.message || err));