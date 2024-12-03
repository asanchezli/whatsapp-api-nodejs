const express = require('express');
const { default: makeWASocket, DisconnectReason, useMultiFileAuthState } = require('@whiskeysockets/baileys');
const QRCode = require('qrcode');
const pino = require('pino');

const app = express();
app.use(express.json());
const port = process.env.PORT || 3000;

let sock = null;
let qrCodeDataURL = null;
let connectionStatus = 'disconnected';

// HTML para mostrar el código QR
const getQRHTML = (qrCode) => `
<!DOCTYPE html>
<html>
<head>
    <title>WhatsApp QR Code</title>
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <style>
        body { display: flex; flex-direction: column; align-items: center; font-family: Arial; }
        img { max-width: 300px; margin: 20px; }
        .status { padding: 10px; margin: 10px; }
    </style>
</head>
<body>
    <h1>Escanea el código QR con WhatsApp</h1>
    <div class="status">Estado: ${connectionStatus}</div>
    ${qrCode ? `<img src="${qrCode}" alt="QR Code"/>` : 'Generando QR...'}
    <p>Una vez escaneado, este QR ya no será válido.</p>
</body>
</html>
`;

async function connectToWhatsApp() {
    const { state, saveCreds } = await useMultiFileAuthState('auth_data');
    
    sock = makeWASocket({
        printQRInTerminal: true,
        auth: state,
        logger: pino({ level: 'silent' })
    });

    sock.ev.on('connection.update', async (update) => {
        const { connection, lastDisconnect, qr } = update;
        connectionStatus = connection;

        if(qr) {
            try {
                qrCodeDataURL = await QRCode.toDataURL(qr);
            } catch (err) {
                console.error('Error al generar QR:', err);
            }
        }

        if(connection === 'close') {
            const shouldReconnect = lastDisconnect?.error?.output?.statusCode !== DisconnectReason.loggedOut;
            if(shouldReconnect) {
                connectToWhatsApp();
            }
        } else if(connection === 'open') {
            console.log('¡Conectado a WhatsApp!');
            qrCodeDataURL = null;
        }
    });

    sock.ev.on('creds.update', saveCreds);
}

// Rutas
app.get('/', (req, res) => {
    res.send(getQRHTML(qrCodeDataURL));
});

// Enviar mensaje
app.post('/send-message', async (req, res) => {
    if(!sock?.user) {
        return res.status(503).json({ error: 'WhatsApp no está conectado' });
    }

    const { number, message } = req.body;
    
    try {
        const jid = number.includes('@') ? number : `${number}@s.whatsapp.net`;
        await sock.sendMessage(jid, { text: message });
        res.json({ success: true, message: 'Mensaje enviado' });
    } catch (error) {
        res.status(500).json({ error: error.message });
    }
});

// Estado
app.get('/status', (req, res) => {
    res.json({
        status: connectionStatus,
        connected: !!sock?.user,
        user: sock?.user || null
    });
});

// Iniciar servidor
app.listen(port, () => {
    console.log(`Servidor iniciado en puerto ${port}`);
    connectToWhatsApp();
});
