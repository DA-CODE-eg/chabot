console.log("Servidor Node funcionando");
const { Client, LocalAuth, MessageMedia } = require('whatsapp-web.js');
const qrcode = require('qrcode-terminal');
const Groq = require("groq-sdk");

require('dotenv').config();

// Leer config de medios dinámicamente
function getMedia() {
    return JSON.parse(require('fs').readFileSync('./media-config.json', 'utf8'));
}

const client = new Client({
    authStrategy: new LocalAuth({
        clientId: process.env.SESSION_NAME
    }),
    puppeteer: {
        protocolTimeout: 120000,
        headless: true,
        executablePath: process.env.PUPPETEER_EXECUTABLE_PATH || null,
        args: [
            '--no-sandbox',
            '--disable-setuid-sandbox',
            '--disable-dev-shm-usage',
            '--disable-accelerated-2d-canvas',
            '--no-first-run',
            '--no-zygote',
            '--disable-gpu',
            '--disable-extensions',
            '--disable-background-networking',
            '--disable-default-apps',
            '--disable-sync',
            '--no-default-browser-check',
            '--single-process'
        ]
    }
});

// Control de estado por usuario
const userState = {};
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

client.on('qr', qr => {
    console.log("📱 Escanea este QR con tu WhatsApp:");
    qrcode.generate(qr, { small: true });
});

client.on('loading_screen', (percent, message) => {
    console.log(`⏳ Cargando WhatsApp Web: ${percent}% - ${message}`);
});

client.on('authenticated', () => {
    console.log('✅ Autenticación exitosa');
});

client.on('auth_failure', (msg) => {
    console.error('❌ Error de autenticación:', msg);
});

client.on('disconnected', (reason) => {
    console.log('⚠️ Cliente desconectado:', reason);
    client.initialize();
});

client.on('ready', () => {
    console.log("🤖 Chatbot conectado correctamente.");
});

client.on('message', async msg => {
    const text = msg.body.toLowerCase().trim();
    const user = msg.from;

    // ---------------------------------------------------------------
    // 🔥 DETECTAR COMPROBANTE (SOLO IMAGEN)
    // ---------------------------------------------------------------
    if (
        userState[user]?.step === "waiting_comprobante" &&
        msg.hasMedia &&
        msg.type === "image"
    ) {
        msg.reply(
            "📄 Hemos recibido tu comprobante de pago correctamente.\n\n" +
            "Para activar tu servicio de *Correo Electrónico Certificado*, por favor diligencia el siguiente formulario:\n\n" +
            "📝 FORMULARIO:\n" +
            "👉 https://docs.google.com/forms/d/e/1FAIpQLSfKZog9bdN4pt0EMLc1ec7nbsPrINX6MdTEcfKvKcbPH-qm6g/viewform\n\n" +
            "⏱️ Una vez lo completes, tu servicio será activado lo antes posible."
        );
        userState[user] = null;
        return;
    }

    if (userState[user]?.step === "waiting_comprobante" && !msg.hasMedia) {
        msg.reply(
            "📸 Por favor envía una *imagen* de tu comprobante de pago para continuar.\n\n" +
            "Si deseas cancelar, escribe *hola* para volver al menú principal."
        );
        return;
    }

    // ---------------------------------------------------------------
    // RESPUESTA AUTOMÁTICA A "GRACIAS"
    // ---------------------------------------------------------------
    if (text.includes("gracias")) {
        msg.reply("¡Gracias por contactarnos! Si necesitas algo más, estaremos atentos. ¡Feliz día!");
        return;
    }

    // ---------------------------------------------------------------
    // 0. SALUDOS → MENÚ INICIAL
    // ---------------------------------------------------------------
    if (
        text.includes("hola") ||
        text.includes("buenos dias") ||
        text.includes("buenos días") ||
        text.includes("buenas tardes") ||
        text.includes("buenas noches") ||
        text.includes("menu") ||
        text.includes("menú") ||
        text.includes("inicio")
    ) {
        userState[user] = { step: "initial_menu" };

        msg.reply(
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

    // ---------------------------------------------------------------
    // 1. PROCESAR MENÚ INICIAL
    // ---------------------------------------------------------------
    if (userState[user]?.step === "initial_menu") {

        if (text === "1") {
            userState[user].step = "dudas_menu";
            msg.reply(
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
            msg.reply(
                "🛒 *Compra de productos*\n\n" +
                "Selecciona el producto que deseas comprar:\n\n" +
                "1️⃣ Correo Electrónico Certificado\n" +
                "2️⃣ Firma Electrónica Certificada\n" +
                "3️⃣ Firma Digital\n" +
                "4️⃣ Firma Electrónica\n"
            );
            return;
        }

        if (text === "3") {
            userState[user].step = "info_menu";
            msg.reply(
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
            msg.reply(
                "👨‍💼 *Contacto con asesor*\n\n" +
                "Tu solicitud ha sido registrada correctamente.\n\n" +
                "En breve uno de nuestros asesores continuará la atención por este mismo chat.\n\n" +
                "Gracias por elegir *Legal Segura*."
            );
            return;
        }

        const respuestaIA = await responderIA(msg.body);
        await msg.reply(respuestaIA + "\n\n_Escribe *hola* para ver el menú principal._");
        return;
    }

    // ---------------------------------------------------------------
    // 2. DUDAS → EXPLICACIÓN + VIDEO O MANUAL
    // ---------------------------------------------------------------
    if (userState[user]?.step === "dudas_menu" && ["1","2","3","4","5"].includes(text)) {

        userState[user].option = text;
        userState[user].step = "dudas_video";

        if (text === "1") {
            msg.reply(
                "📬 *Correo Electrónico Certificado*\n\n" +
                "Este servicio cuenta con plena validez jurídica y permite certificar el envío, la recepción y el contenido de los mensajes electrónicos, garantizando su integridad, autenticidad y trazabilidad conforme a la normativa vigente.\n\n" +
                "Si lo deseas, podemos enviarte un video explicativo paso a paso o el manual del producto para que conozcas su funcionamiento en detalle.\n\n" +
                "Por favor indícanos tu preferencia:\n" +
                "1️⃣ Video explicativo\n" +
                "2️⃣ Manual del producto"
            );
        }

        if (text === "2") {
            msg.reply(
                "✍️ *Firma Electrónica Certificada*\n\n" +
                "Permite firmar documentos digitalmente con validez jurídica.\n\n" +
                "Por favor indícanos tu preferencia:\n" +
                "1️⃣ Video explicativo\n" +
                "2️⃣ Manual del producto"
            );
        }

        if (text === "3") {
            msg.reply(
                "🔐 *Firma Digital*\n\n" +
                "Firma respaldada por un certificado digital emitido por una entidad certificadora.\n\n" +
                "Por favor indícanos tu preferencia:\n" +
                "1️⃣ Video explicativo\n" +
                "2️⃣ Manual del producto"
            );
        }

        if (text === "4") {
            msg.reply(
                "📱 *App Tools*\n\n" +
                "Aplicación diseñada para la revisión de certificados de forma rápida y segura, permitiendo a los usuarios verificar la información, hacer seguimiento al estado de los envíos y consultar los soportes generados.\n\n" +
                "Por favor indícanos tu preferencia:\n" +
                "1️⃣ Video explicativo\n" +
                "2️⃣ Manual del producto"
            );
        }

        if (text === "5") {
            msg.reply(
                "✍️ *Firma Electrónica (Firma Plus)*\n\n" +
                "Permite firmar desde cualquier lugar y dispositivo con mecanismos de autenticación como código OTP, selfie y firma manuscrita digital. Tiene plena validez jurídica.\n\n" +
                "Por favor indícanos tu preferencia:\n" +
                "1️⃣ Video explicativo\n" +
                "2️⃣ Manual del producto"
            );
        }

        return;
    }

    // ---------------------------------------------------------------
    // ENVÍO DE VIDEO O MANUAL
    // ---------------------------------------------------------------
    if (userState[user]?.step === "dudas_video") {

        const option = userState[user].option;

        if (text === "1") {
            const cfg = getMedia();
            let videoPath = cfg.productos[option]?.video || null;

            if (videoPath) {
                const media = MessageMedia.fromFilePath(videoPath);
                await msg.reply("📹 Enviando video explicativo...");
                await msg.reply(media);
            }
            userState[user] = null;
            return;
        }

        if (text === "2") {
            const cfg = getMedia();
            let manualPath = cfg.productos[option]?.manual || null;

            if (manualPath) {
                const manual = MessageMedia.fromFilePath(manualPath);
                await msg.reply("📄 Enviando manual del producto...");
                await msg.reply(manual);
            }
            userState[user] = null;
            return;
        }
    }

    // ---------------------------------------------------------------
    // 3. COMPRA DE PRODUCTOS → PRECIOS Y DETALLES
    // ---------------------------------------------------------------
    if (userState[user]?.step === "purchase_menu") {

        if (text === "1") {
            userState[user] = { step: "waiting_comprobante" };
            msg.reply(
                "📬 *PRECIOS PAQUETES CORREO ELECTRÓNICO CERTIFICADO – 2026*\n\n" +
                "5 correos electrónicos = *$13.700 COP* IVA incluido\n" +
                "10 correos electrónicos = *$21.000 COP* IVA incluido\n" +
                "20 correos electrónicos = *$40.000 COP* IVA incluido\n" +
                "50 correos electrónicos = *$79.000 COP* IVA incluido\n" +
                "80 correos electrónicos = *$125.000 COP* IVA incluido\n" +
                "100 correos electrónicos = *$150.000 COP* IVA incluido\n" +
                "200 correos electrónicos = *$240.000 COP* IVA incluido\n" +
                "500 correos electrónicos = *$525.000 COP* IVA incluido\n\n" +
                "💳 *Métodos de pago:*\n" +
                "• Banco Caja Social – Cuenta corriente 2100-441-3030\n" +
                "• NEQUI: 315 5050906\n" +
                "• DAVIPLATA: 315 5050906\n" +
                "A nombre de Legal Segura S.A.S – NIT 901.474.747-5\n\n" +
                "📩 Enviar comprobante a: contacto@legalsegura.com\n" +
                "⚠️ Para factura electrónica, pagar por Caja Social.\n\n" +
                "📸 Después de pagar, envía aquí tu comprobante (imagen)."
            );
            return;
        }

        if (text === "2") {
            userState[user] = { step: "waiting_comprobante" };
            msg.reply(
                "✍️ *FIRMA ELECTRÓNICA CERTIFICADA*\n\n" +
                "💼 *Planes disponibles:*\n" +
                "• 1 año = *$120.000 + IVA*\n" +
                "• 2 años = *$180.000 + IVA*\n\n" +
                "💳 *Métodos de pago:*\n" +
                "• Banco Caja Social – Cuenta corriente 2100-441-3030\n" +
                "• NEQUI: 315 5050906\n" +
                "• DAVIPLATA: 315 5050906\n" +
                "A nombre de Legal Segura S.A.S – NIT 901.474.747-5\n\n" +
                "📸 Después de pagar, envía aquí tu comprobante (imagen)."
            );
            return;
        }

        if (text === "3") {
            userState[user] = { step: "waiting_comprobante" };
            msg.reply(
                "🔐 *FIRMA DIGITAL*\n\n" +
                "💼 *Planes disponibles:*\n\n" +
                "🖥️ Token Virtual\n" +
                "• 1 año = *$160.000 + IVA*\n" +
                "• 2 años = *$220.000 + IVA*\n\n" +
                "🔑 Token Físico\n" +
                "• 1 año = *$220.000 + IVA*\n" +
                "• 2 años = *$265.000 + IVA*\n\n" +
                "💳 *Métodos de pago:*\n" +
                "• Banco Caja Social – Cuenta corriente 2100-441-3030\n" +
                "• NEQUI: 315 5050906\n" +
                "• DAVIPLATA: 315 5050906\n" +
                "A nombre de Legal Segura S.A.S – NIT 901.474.747-5\n\n" +
                "📸 Después de pagar, envía aquí tu comprobante (imagen)."
            );
            return;
        }

        if (text === "4") {
            userState[user] = { step: "waiting_comprobante" };
            msg.reply(
                "✍️ *FIRMA ELECTRÓNICA*\n\n" +
                "💼 *Planes disponibles:*\n" +
                "• 1 año = *$120.000 + IVA*\n" +
                "• 2 años = *$180.000 + IVA*\n\n" +
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

    // ---------------------------------------------------------------
    // 4. INFORMACIÓN GENERAL
    // ---------------------------------------------------------------
    if (userState[user]?.step === "info_menu") {

        if (text === "1") {
            msg.reply(
                "📬 *Correo Electrónico Certificado*\n\n" +
                "Es un servicio que garantiza la entrega, recepción y trazabilidad de un mensaje de datos con validez jurídica. Funciona como el equivalente digital del correo físico, aplicando la equivalencia funcional establecida en la Ley 527 de 1999. Permite demostrar cuándo se envió, cuándo fue recibido y por quién, gracias al acuse de recibo. Es un medio seguro para comunicaciones formales con fuerza probatoria.\n\n" +
                "🔹 Escribe *hola* para volver al menú principal\n" +
                "🔹 O escribe *gracias* para finalizar"
            );
            userState[user] = null;
            return;
        }

        if (text === "2") {
            msg.reply(
                "✍️ *Firma Electrónica Certificada*\n\n" +
                "Incluye métodos como contraseñas, códigos, biometría o claves, que permiten identificar a una persona en un entorno digital. Su validez está regulada por el Decreto 2364 de 2012 y es aceptada siempre que sea confiable y apropiada para el fin del mensaje. Tiene plena validez jurídica si cumple los criterios de autenticidad e integridad establecidos por la norma.\n\n" +
                "🔹 Escribe *hola* para volver al menú principal\n" +
                "🔹 O escribe *gracias* para finalizar"
            );
            userState[user] = null;
            return;
        }

        if (text === "3") {
            msg.reply(
                "🔐 *Firma Digital*\n\n" +
                "Es un método criptográfico que vincula de manera única al firmante con un mensaje de datos, asegurando autenticidad, integridad y no repudio. Solo puede ser emitida y validada mediante entidades de certificación autorizadas, cumpliendo los atributos definidos en la Ley 527 de 1999. Tiene la misma validez jurídica que una firma manuscrita.\n\n" +
                "🔹 Escribe *hola* para volver al menú principal\n" +
                "🔹 O escribe *gracias* para finalizar"
            );
            userState[user] = null;
            return;
        }

        if (text === "4") {
            msg.reply(
                "✍️ *Firma Electrónica (Firma Plus)*\n\n" +
                "Permite firmar documentos digitales en línea, garantizando la identidad del firmante, la integridad del documento y el no repudio. Los usuarios pueden firmar desde cualquier lugar y dispositivo, utilizando OTP por SMS o correo, validación de identidad, selfie y firma manuscrita digital. Cuenta con plena validez jurídica conforme a la Ley 527 de 1999 y el Decreto 2364 de 2012.\n\n" +
                "🔹 Escribe *hola* para volver al menú principal\n" +
                "🔹 O escribe *gracias* para finalizar"
            );
            userState[user] = null;
            return;
        }
    }

    // ---------------------------------------------------------------
    // ✅ IA GROQ: RESPONDE PREGUNTAS FUERA DEL MENÚ
    // ---------------------------------------------------------------
    const respuestaIA = await responderIA(msg.body);
    await msg.reply(respuestaIA + "\n\n_💡 Escribe *hola* si deseas ver el menú de opciones._");
});

console.log("🚀 Iniciando cliente...");
client.initialize().catch(err => console.error("❌ Error al inicializar:", err));