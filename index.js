const { default: makeWASocket, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const { Octokit } = require('@octokit/rest');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');
require('dotenv').config();

// ========== CONFIG (Read from Environment Variables) ==========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY;
const SESSION_ID = process.env.SESSION_ID;  // 👈 Key change!
const PHONE_NUMBER = process.env.PHONE_NUMBER;
const PAIRING_CODE = process.env.PAIRING_CODE;

let GIST_ID = process.env.GIST_ID || null;

// ========== GIST MANAGER (Same as before) ==========
class GistSessionManager {
    constructor() {
        this.octokit = new Octokit({ auth: GITHUB_TOKEN });
        this.gistId = GIST_ID;
    }

    async saveSession(userId, sessionData) {
        try {
            const encrypted = CryptoJS.AES.encrypt(
                JSON.stringify(sessionData), 
                ENCRYPTION_KEY
            ).toString();

            const files = {
                [`session_${userId}.json`]: {
                    content: JSON.stringify({
                        userId: userId,
                        encryptedData: encrypted,
                        createdAt: new Date().toISOString()
                    })
                }
            };

            if (this.gistId) {
                await this.octokit.gists.update({
                    gist_id: this.gistId,
                    files: files
                });
            } else {
                const gist = await this.octokit.gists.create({
                    description: 'WhatsApp Bot Sessions',
                    public: false,
                    files: files
                });
                this.gistId = gist.data.id;
                console.log(`✅ Gist ID: ${this.gistId}`);
            }
            return true;
        } catch (error) {
            console.error('Gist save error:', error.message);
            return false;
        }
    }

    async loadSession(userId) {
        try {
            if (!this.gistId) return null;
            const gist = await this.octokit.gists.get({ gist_id: this.gistId });
            const file = gist.data.files[`session_${userId}.json`];
            if (!file) return null;
            const data = JSON.parse(file.content);
            const decrypted = CryptoJS.AES.decrypt(data.encryptedData, ENCRYPTION_KEY);
            return JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
        } catch (error) {
            return null;
        }
    }
}

// ========== MESSAGE HANDLER ==========
async function setupMessageHandler(sock, sessionId) {
    sock.ev.on('messages.upsert', async (m) => {
        const msg = m.messages[0];
        if (!msg.key.fromMe && msg.message?.conversation) {
            const text = msg.message.conversation.toLowerCase();
            const sender = msg.key.remoteJid;
            
            if (text === 'ping') {
                await sock.sendMessage(sender, { text: '🏓 Pong! Bot is alive!' });
            }
            else if (text === 'session') {
                await sock.sendMessage(sender, { 
                    text: `🔑 *Session ID:* \`${sessionId}\`` 
                });
            }
        }
    });
}

// ========== MAIN FUNCTION (Auto-start with env vars) ==========
async function startBot() {
    console.log('🤖 WhatsApp Bot Starting on Koyeb...');
    
    const gistManager = new GistSessionManager();
    
    // Check if we have SESSION_ID in env
    if (SESSION_ID && SESSION_ID !== 'your_session_id_here') {
        console.log(`📂 Loading existing session: ${SESSION_ID}`);
        
        const sessionData = await gistManager.loadSession(SESSION_ID);
        
        if (sessionData) {
            // Create in-memory auth (or temp file - Koyeb allows /tmp write)
            const authPath = '/tmp/auth_info';
            if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
            
            fs.writeFileSync(path.join(authPath, 'creds.json'), sessionData.credentials);
            
            const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
            const { state, saveCreds } = await useMultiFileAuthState(authPath);
            
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('WhatsApp Bot'),
                version: [2, 3000, 1015901307]
            });
            
            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'open') {
                    console.log(`✅ Bot connected! User: ${sock.user.id}`);
                    await setupMessageHandler(sock, SESSION_ID);
                    console.log('🎧 Bot is running...');
                    
                    // Keep alive with periodic ping
                    setInterval(() => {
                        console.log('💓 Heartbeat - Bot alive');
                    }, 300000); // Every 5 minutes
                }
                
                if (connection === 'close') {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log('🔄 Reconnecting...');
                        setTimeout(() => startBot(), 5000);
                    } else {
                        console.log('❌ Session expired! Update SESSION_ID env var.');
                    }
                }
            });
        } else {
            console.log('❌ Invalid SESSION_ID! Check GIST_ID env var.');
        }
    } 
    // New pairing (first time)
    else if (PHONE_NUMBER && PAIRING_CODE) {
        console.log(`📱 Starting new pairing for ${PHONE_NUMBER}...`);
        
        const newSessionId = `SESSION_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const authPath = '/tmp/auth_info';
        
        if (!fs.existsSync(authPath)) fs.mkdirSync(authPath, { recursive: true });
        
        const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
        const { state, saveCreds } = await useMultiFileAuthState(authPath);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('WhatsApp Bot'),
            version: [2, 3000, 1015901307]
        });
        
        sock.ev.on('creds.update', async () => {
            await saveCreds();
            
            const credsFile = fs.readFileSync(path.join(authPath, 'creds.json'), 'utf-8');
            await gistManager.saveSession(newSessionId, {
                credentials: credsFile,
                sessionId: newSessionId,
                phoneNumber: PHONE_NUMBER
            });
            
            console.log(`✅ Session saved to Gist!`);
            console.log(`🔑 SESSION_ID=${newSessionId}`);
            console.log(`💾 Save this in your Koyeb environment variables!`);
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection } = update;
            
            if (connection === 'open') {
                console.log(`✅ Bot connected! User: ${sock.user.id}`);
                console.log(`🆔 New Session ID: ${newSessionId}`);
                await setupMessageHandler(sock, newSessionId);
            }
        });
        
        // Request pairing code
        await new Promise(resolve => setTimeout(resolve, 3000));
        const code = await sock.requestPairingCode(PHONE_NUMBER, PAIRING_CODE);
        console.log(`\n📲 PAIRING CODE: ${code.match(/.{1,4}/g).join('-')}`);
        console.log(`🔗 Enter this in WhatsApp: Settings → Linked Devices\n`);
    }
    else {
        console.log('❌ Missing environment variables!');
        console.log('For new pairing: set PHONE_NUMBER and PAIRING_CODE');
        console.log('For existing session: set SESSION_ID and GIST_ID');
    }
}

// Keep process alive
process.on('SIGINT', () => {
    console.log('👋 Bot stopped');
    process.exit(0);
});

startBot().catch(console.error);
