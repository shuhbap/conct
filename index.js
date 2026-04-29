const { default: makeWASocket, useMultiFileAuthState } = require("@whiskeysockets/baileys");
const { getSession, setSession } = require("./database");
const config = require("./config");

async function startBot() {
  const { state, saveCreds } = await useMultiFileAuthState("auth");

  const sock = makeWASocket({
    auth: state,
    printQRInTerminal: true
  });

  sock.ev.on("creds.update", saveCreds);

  sock.ev.on("messages.upsert", async ({ messages }) => {
    const msg = messages[0];
    if (!msg.message) return;

    const id = msg.key.remoteJid;

    // save session to gist
    await setSession(id, msg.message);

    console.log("Message saved to Gist DB ✔");
  });
}

startBot();
