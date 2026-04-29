const axios = require("axios");

const GIST_ID = "YOUR_GIST_ID";
const TOKEN = "YOUR_GITHUB_TOKEN";
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
