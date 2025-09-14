// Simple router receiving requests from content.js and returning model output
chrome.runtime.onInstalled.addListener(() => {
  chrome.contextMenus.create({
    id: "writer-helper-improve",
    title: "Improve writing (LLM)",
    contexts: ["selection", "editable"]
  });
});

// background.js
function isInjectable(url) {
  try {
    const p = new URL(url).protocol;
    // Allowed: http, https, (file if user enabled)
    return p === "http:" || p === "https:" || p === "file:";
  } catch { return false; }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId !== "writer-helper-improve" || !tab?.id || !isInjectable(tab.url)) {
    console.warn("Not injectable:", tab?.url);
    return;
  }
  await safeSend(tab.id, { type: "WH_IMPROVE_SELECTION" });
});


async function safeSend(tabId, message) {
  try {
    await chrome.tabs.sendMessage(tabId, message);
  } catch (e) {
    // Receiving end missing → inject and retry
    await chrome.scripting.executeScript({
      target: { tabId, allFrames: true },
      files: ["content.js"]
    });
    await chrome.tabs.sendMessage(tabId, message);
  }
}


chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg?.type === "WH_REQUEST_SUGGESTION") {
    (async () => {
      try {
        const suggestion = await getSuggestion(msg.payload);
        sendResponse({ ok: true, suggestion });
      } catch (e) {
        sendResponse({ ok: false, error: e?.message || String(e) });
      }
    })();
    return true; // async
  }
});

// --- Swap this section to use another provider -----------------------------
// async function getSuggestion({ text, tone, lang }) {
//   const { apiKey, model } = await chrome.storage.sync.get({ apiKey: "", model: "gpt-4o-mini" });
//   if (!apiKey) throw new Error("No API key set. Open the extension popup to add one.");

//   // OpenAI Chat Completions-style request (adjust for your provider)
//   const system = `You are a writing assistant. Improve clarity, grammar, and style.
// - Keep the user's original meaning.
// - Return ONLY the corrected text, no commentary.
// - Use the requested tone if provided.
// - Language for output: ${lang || "same as input"}.`;

//   const res = await fetch("https://api.openai.com/v1/chat/completions", {
//     method: "POST",
//     headers: {
//       "Authorization": `Bearer ${apiKey}`,
//       "Content-Type": "application/json"
//     },
//     body: JSON.stringify({
//       model,
//       messages: [
//         { role: "system", content: system },
//         { role: "user", content: text }
//       ],
//       temperature: 0.2
//     })
//   });

//   if (!res.ok) {
//     const detail = await res.text().catch(() => "");
//     throw new Error(`LLM error ${res.status}: ${detail.slice(0, 200)}`);
//   }
//   const data = await res.json();
//   const out = data.choices?.[0]?.message?.content?.trim();
//   if (!out) throw new Error("Empty response from model");
//   return out;
// }

// --- TEST MODE: no API call, just echo input -------------------------------
// background.js – test mode
async function getSuggestion({ text }) {
  await new Promise(r => setTimeout(r, 150));
  return `✅ FIXED: ${text.toUpperCase()}`; // obvious proof the pipe works
}

