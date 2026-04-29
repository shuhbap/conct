const axios = require("axios");

const GIST_ID = "2363d4e727b565fb0f759d7e7d5b8ad8";
const TOKEN = "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";
const FILE_NAME = "session.json";

async function loadFromGist() {
  try {
    const res = await axios.get(`https://api.github.com/gists/${GIST_ID}`);
    const content = res.data.files[FILE_NAME].content;
    return JSON.parse(content || "{}");
  } catch (e) {
    return {};
  }
}

async function saveToGist(data) {
  await axios.patch(
    `https://api.github.com/gists/${GIST_ID}`,
    {
      files: {
        [FILE_NAME]: {
          content: JSON.stringify(data, null, 2)
        }
      }
    },
    {
      headers: {
        Authorization: `token ${TOKEN}`
      }
    }
  );
}

module.exports = { loadFromGist, saveToGist };
