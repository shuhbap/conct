const { loadFromGist, saveToGist } = require("./gistDB");

async function getSession(id) {
  const db = await loadFromGist();
  return db[id] || null;
}

async function setSession(id, session) {
  const db = await loadFromGist();

  db[id] = session;

  await saveToGist(db);
}

async function deleteSession(id) {
  const db = await loadFromGist();

  delete db[id];

  await saveToGist(db);
}

module.exports = {
  getSession,
  setSession,
  deleteSession
};
