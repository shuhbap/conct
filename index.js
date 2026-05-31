const { default: makeWASocket, Browsers, DisconnectReason } = require('@whiskeysockets/baileys');
const { useMultiFileAuthState } = require('@whiskeysockets/baileys');
const { Octokit } = require('@octokit/rest');
const CryptoJS = require('crypto-js');
const fs = require('fs');
const path = require('path');
const readline = require('readline');
require('dotenv').config();

// ========== CONFIGURATION ==========
const GITHUB_TOKEN = process.env.GITHUB_TOKEN;
const ENCRYPTION_KEY = process.env.ENCRYPTION_KEY || 'MyDefaultKey123!';
let GIST_ID = process.env.GIST_ID || null;

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

const question = (text) => new Promise((resolve) => rl.question(text, resolve));

// ========== GIST MANAGER CLASS ==========
class GistSessionManager {
    constructor() {
        if (!GITHUB_TOKEN) {
            console.error('❌ GITHUB_TOKEN not found in .env file!');
            process.exit(1);
        }
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
                        createdAt: new Date().toISOString(),
                        version: '1.0'
                    })
                }
            };

            if (this.gistId) {
                await this.octokit.gists.update({
                    gist_id: this.gistId,
                    files: files,
                    description: `WhatsApp Bot Sessions - ${new Date().toLocaleString()}`
                });
                console.log(`✅ Session updated in Gist: ${this.gistId}`);
            } else {
                const gist = await this.octokit.gists.create({
                    description: 'WhatsApp Bot Authentication Sessions',
                    public: false,
                    files: files
                });
                this.gistId = gist.data.id;
                console.log(`✅ New Gist created: https://gist.github.com/${this.gistId}`);
                
                // Save Gist ID to .env for next time
                fs.appendFileSync('.env', `\nGIST_ID=${this.gistId}`);
            }
            return true;
        } catch (error) {
            console.error('❌ Gist save error:', error.message);
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
            const sessionData = JSON.parse(decrypted.toString(CryptoJS.enc.Utf8));
            
            return sessionData;
        } catch (error) {
            console.error('❌ Gist load error:', error.message);
            return null;
        }
    }

    async getAllSessions() {
        try {
            if (!this.gistId) return [];
            
            const gist = await this.octokit.gists.get({ gist_id: this.gistId });
            const sessions = [];
            
            for (const [filename, content] of Object.entries(gist.data.files)) {
                if (filename.startsWith('session_')) {
                    const userId = filename.replace('session_', '').replace('.json', '');
                    const data = JSON.parse(content.content);
                    sessions.push({
                        userId: userId,
                        createdAt: data.createdAt
                    });
                }
            }
            return sessions;
        } catch (error) {
            return [];
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
                await sock.sendMessage(sender, { text: '🏓 Pong! Bot is active!' });
            }
            else if (text === 'session') {
                await sock.sendMessage(sender, { 
                    text: `🔑 *Your Session ID:*\n\`${sessionId}\`\n\n📌 Save this ID to login later!` 
                });
            }
            else if (text === 'help') {
                await sock.sendMessage(sender, {
                    text: `📱 *Available Commands:*\n\nping - Check bot status\nsession - Get your session ID\nhelp - Show this menu`
                });
            }
        }
    });
}

// ========== MAIN FUNCTION ==========
async function startBot() {
    const gistManager = new GistSessionManager();
    
    console.log('\n🤖 WhatsApp Bot with Gist Session Storage\n');
    console.log('═'.repeat(50));
    console.log('1. 🔐 New Pairing (Save to Gist)');
    console.log('2. 🔓 Load Existing Session');
    console.log('3. 📋 List All Sessions');
    console.log('═'.repeat(50));
    
    const choice = await question('\nSelect option (1/2/3): ');
    
    // Option 3: List sessions
    if (choice === '3') {
        const sessions = await gistManager.getAllSessions();
        if (sessions.length === 0) {
            console.log('\n📭 No sessions found in Gist');
        } else {
            console.log('\n📋 Sessions stored in Gist:');
            sessions.forEach((session, i) => {
                console.log(`   ${i+1}. ${session.userId} (${session.createdAt})`);
            });
        }
        process.exit(0);
    }
    
    // Option 2: Load existing session
    if (choice === '2') {
        const sessionId = await question('\n🔑 Enter your Session ID: ');
        
        console.log('\n⏳ Loading session from Gist...');
        const sessionData = await gistManager.loadSession(sessionId);
        
        if (sessionData) {
            const authPath = path.join(__dirname, 'restored_sessions', sessionId);
            if (!fs.existsSync(authPath)) {
                fs.mkdirSync(authPath, { recursive: true });
            }
            
            fs.writeFileSync(path.join(authPath, 'creds.json'), sessionData.credentials);
            
            const { state, saveCreds } = await useMultiFileAuthState(authPath);
            const sock = makeWASocket({
                auth: state,
                printQRInTerminal: false,
                browser: Browsers.ubuntu('WhatsApp Bot')
            });
            
            sock.ev.on('creds.update', saveCreds);
            
            sock.ev.on('connection.update', async (update) => {
                const { connection, lastDisconnect } = update;
                
                if (connection === 'open') {
                    console.log('\n✅ Session restored successfully!');
                    console.log(`📱 Logged in as: ${sock.user.id}`);
                    console.log('\n🎧 Bot is listening for messages...\n');
                    await setupMessageHandler(sock, sessionId);
                }
                
                if (connection === 'close') {
                    if (lastDisconnect?.error?.output?.statusCode !== 401) {
                        console.log('🔄 Reconnecting...');
                        startBot();
                    } else {
                        console.log('❌ Session expired! Please pair again.');
                        process.exit(0);
                    }
                }
            });
        } else {
            console.log('\n❌ Invalid Session ID!');
            process.exit(1);
        }
        return;
    }
    
    // Option 1: New pairing
    if (choice === '1') {
        const phoneNumber = await question('\n📱 Enter phone number (with country code, no +):\n> ');
        const customCode = await question('\n🔑 Enter 8-char custom code (e.g., MYCODE123):\n> ');
        
        if (customCode.length !== 8) {
            console.log('\n❌ Custom code must be exactly 8 characters!');
            process.exit(1);
        }
        
        const sessionId = `SESSION_${Date.now()}_${Math.random().toString(36).substr(2, 8)}`;
        const tempAuthPath = path.join(__dirname, 'temp_sessions', sessionId);
        
        if (!fs.existsSync(tempAuthPath)) {
            fs.mkdirSync(tempAuthPath, { recursive: true });
        }
        
        const { state, saveCreds } = await useMultiFileAuthState(tempAuthPath);
        
        const sock = makeWASocket({
            auth: state,
            printQRInTerminal: false,
            browser: Browsers.ubuntu('WhatsApp Bot'),
            version: [2, 3000, 1015901307]
        });
        
        sock.ev.on('creds.update', async () => {
            await saveCreds();
            
            try {
                const credsFile = fs.readFileSync(path.join(tempAuthPath, 'creds.json'), 'utf-8');
                await gistManager.saveSession(sessionId, {
                    credentials: credsFile,
                    sessionId: sessionId,
                    phoneNumber: phoneNumber,
                    createdAt: new Date().toISOString()
                });
                
                // Send Session ID to WhatsApp
                if (sock.user) {
                    await sock.sendMessage(`${phoneNumber}@s.whatsapp.net`, {
                        text: `✅ *Session Created Successfully!*\n\n🔑 *Your Session ID:*\n\`${sessionId}\`\n\n📌 *Save this ID!*\nUse it next time to login without pairing.\n\n🔄 To restore: Run bot and choose option 2\n\n⚠️ Keep this ID private!`
                    });
                    console.log('\n✅ Session ID sent to your WhatsApp!');
                }
            } catch (error) {
                console.error('Failed to save to Gist:', error.message);
            }
        });
        
        sock.ev.on('connection.update', async (update) => {
            const { connection, lastDisconnect } = update;
            
            if (connection === 'open') {
                console.log('\n✅ Bot connected successfully!');
                console.log(`📱 Logged in as: ${sock.user.id}`);
                console.log(`🆔 Session ID: ${sessionId}`);
                console.log(`💾 Saved to GitHub Gist`);
                console.log('\n🎧 Bot is running! Send "ping" to test.\n');
                await setupMessageHandler(sock, sessionId);
            }
            
            if (connection === 'close') {
                if (lastDisconnect?.error?.output?.statusCode !== 401) {
                    console.log('🔄 Reconnecting...');
                } else {
                    console.log('❌ Connection closed.');
                }
            }
        });
        
        if (!sock.authState.creds.registered) {
            const code = await sock.requestPairingCode(phoneNumber, customCode);
            console.log('\n' + '═'.repeat(50));
            console.log(`📲 *PAIRING CODE:* ${code.match(/.{1,4}/g).join('-')}`);
            console.log('═'.repeat(50));
            console.log('🔗 Link this code in WhatsApp:');
            console.log('   Settings → Linked Devices → Link a Device\n');
        }
    }
}

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('\n\n👋 Bot stopped.');
    process.exit(0);
});

// Start the bot
startBot().catch(console.error);
