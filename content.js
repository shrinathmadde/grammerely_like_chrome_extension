// content.js

let lastEditableEl = null;   // the field we targeted
let savedRange = null;       // for contenteditable
let savedInputSel = null;    // for <textarea>/<input>

console.log("[WH] content loaded on", location.href);

chrome.runtime.onMessage.addListener((msg) => {
  if (msg?.type === "WH_IMPROVE_SELECTION") {
    console.log("[WH] got message");
    alert("Content script received message"); // proof it works
  }
});


// Inject styles once
(function injectStyles() {
  if (document.getElementById("wh-ui-css")) return;
  const link = document.createElement("link");
  link.id = "wh-ui-css";
  link.rel = "stylesheet";
  link.href = chrome.runtime.getURL("ui.css");
  document.documentElement.appendChild(link);
})();

let currentTarget = null;

// Track focus on inputs/textareas/contenteditable
function isEditable(el) {
  if (!el) return false;
  const editableTags = new Set(["TEXTAREA", "INPUT"]);
  if (editableTags.has(el.tagName) && (!el.type || el.type === "text" || el.type === "search" || el.type === "email" || el.type === "url")) return true;
  if (el.isContentEditable) return true;
  return false;
}

document.addEventListener("focusin", (e) => {
  currentTarget = isEditable(e.target) ? e.target : null;
}, true);
document.addEventListener("blur", (e) => {
  if (e.target === currentTarget) currentTarget = null;
}, true);

// Context menu entry triggers this
chrome.runtime.onMessage.addListener(async (msg) => {
  if (msg?.type === "WH_IMPROVE_SELECTION") {
    const text = getSelectionOrSentence();
    if (!text) return toast("Select some text or put the caret in a sentence.");
    requestSuggestion(text);
  }
});

// Inline “lightbulb” on selection (optional UX sugar)
let selTimeout = null;
document.addEventListener("mouseup", () => {
  clearTimeout(selTimeout);
  selTimeout = setTimeout(() => {
    const text = window.getSelection()?.toString().trim();
    if (text && text.length >= 3) showBubbleAtSelection(text);
  }, 80);
});

function getSelectionOrSentence() {
  const sel = window.getSelection();
  if (sel && String(sel).trim()) return String(sel).trim();

  // If no selection, take the sentence at the caret in the focused editable
  const el = currentTarget || document.activeElement;
  if (!isEditable(el)) return "";
  const text = getText(el);
  const caret = getCaretIndex(el);
  if (caret == null) return "";

  const start = text.lastIndexOf(".", caret - 1) + 1;
  let end = text.indexOf(".", caret);
  end = end === -1 ? text.length : end + 1;
  return text.slice(start, end).trim();
}

function getText(el) {
  return el.isContentEditable ? el.innerText : el.value ?? "";
}

function setText(el, newText, replaceRange) {
  if (el.isContentEditable) {
    if (replaceRange) {
      const { start, end } = replaceRange;
      const current = el.innerText;
      el.innerText = current.slice(0, start) + newText + current.slice(end);
    } else {
      el.innerText = newText;
    }
  } else {
    if (replaceRange) {
      const { start, end } = replaceRange;
      const v = el.value || "";
      el.value = v.slice(0, start) + newText + v.slice(end);
    } else {
      el.value = newText;
    }
  }
}

function getCaretIndex(el) {
  if (el.isContentEditable) {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return null;
    const range = sel.getRangeAt(0).cloneRange();
    const pre = range.cloneRange();
    pre.selectNodeContents(el);
    pre.setEnd(range.endContainer, range.endOffset);
    return pre.toString().length;
  } else {
    return el.selectionStart ?? null;
  }
}

// --- Suggestion bubble ------------------------------------------------------
let bubbleEl = null;

function showBubbleAtSelection(text) {
  const rect = getSelectionRect();
  if (!rect) return;
  
  const target = currentTarget || document.activeElement;
  if (isEditable(target)) {
    lastEditableEl = target;

    const sel = window.getSelection();
    savedRange = (sel && sel.rangeCount) ? sel.getRangeAt(0).cloneRange() : null;

    if (!target.isContentEditable && "selectionStart" in target) {
      savedInputSel = { start: target.selectionStart ?? 0, end: target.selectionEnd ?? 0 };
    } else {
      savedInputSel = null;
    }
  }
  if (!bubbleEl) {
    bubbleEl = document.createElement("div");
    bubbleEl.className = "wh-bubble";
    bubbleEl.innerHTML = `
      <button class="wh-btn" id="wh-improve">Improve</button>
      <span class="wh-status" id="wh-status"></span>
      <div class="wh-suggestion" id="wh-suggestion" style="display:none"></div>
      <div class="wh-actions" id="wh-actions" style="display:none">
        <button class="wh-btn" id="wh-apply">Apply</button>
        <button class="wh-btn outline" id="wh-copy">Copy</button>
      </div>
    `;
    document.body.appendChild(bubbleEl);

    bubbleEl.querySelector("#wh-improve").addEventListener("click", () => {
      requestSuggestion(text);
    });
    bubbleEl.querySelector("#wh-apply").addEventListener("click", () => applySuggestion());
    bubbleEl.querySelector("#wh-copy").addEventListener("click", () => copySuggestion());
  }
  bubbleEl.style.top = `${rect.bottom + 6 + window.scrollY}px`;
  bubbleEl.style.left = `${rect.left + window.scrollX}px`;
  bubbleEl.dataset.range = JSON.stringify(getEditableRangeForSelection());
  bubbleEl.style.display = "block";
  setStatus("");
  setSuggestion("");
}

function hideBubble() {
  if (bubbleEl) bubbleEl.style.display = "none";
}

function getSelectionRect() {
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const r = sel.getRangeAt(0).getBoundingClientRect();
  if (!r || (r.x === 0 && r.y === 0 && r.width === 0 && r.height === 0)) return null;
  return r;
}

function getEditableRangeForSelection() {
  // Compute indices relative to currentTarget text so we can replace only the selected part
  const el = currentTarget || document.activeElement;
  if (!isEditable(el)) return null;
  const sel = window.getSelection();
  if (!sel || sel.rangeCount === 0) return null;
  const selected = String(sel);
  const base = getText(el);
  const caretEnd = getCaretIndex(el);
  if (selected && base) {
    // naive approach: find the first occurrence before caret end
    const idx = base.lastIndexOf(selected, caretEnd ?? base.length);
    if (idx !== -1) return { start: idx, end: idx + selected.length };
  }
  return null;
}

async function requestSuggestion(text) {
  setStatus("Thinking…");
  setSuggestion("");
  try {
    const { tone = "neutral", lang = "" } = await chrome.storage.sync.get({ tone: "neutral", lang: "" });
    const resp = await chrome.runtime.sendMessage({
      type: "WH_REQUEST_SUGGESTION",
      payload: { text, tone, lang }
    });
    if (!resp?.ok) throw new Error(resp?.error || "Unknown error");
    setSuggestion(resp.suggestion);
  } catch (e) {
    setStatus(`Error: ${e.message}`);
  }
}

function setStatus(s) {
  if (!bubbleEl) return;
  bubbleEl.querySelector("#wh-status").textContent = s;
}

function setSuggestion(s) {
  if (!bubbleEl) return;
  const sug = bubbleEl.querySelector("#wh-suggestion");
  const actions = bubbleEl.querySelector("#wh-actions");
  if (s) {
    sug.textContent = s;
    sug.style.display = "block";
    actions.style.display = "flex";
    setStatus("");
  } else {
    sug.textContent = "";
    sug.style.display = "none";
    actions.style.display = "none";
  }
}

function emitInput(el) {
  try {
    el.dispatchEvent(new InputEvent("input", { bubbles: true, cancelable: true }));
  } catch {
    el.dispatchEvent(new Event("input", { bubbles: true })); // fallback
  }
  el.dispatchEvent(new Event("change", { bubbles: true }));
}


function applySuggestion() {
  if (!bubbleEl) return;
  const s = bubbleEl.querySelector("#wh-suggestion")?.textContent || "";
  const el = lastEditableEl || currentTarget || document.activeElement;
  if (!s || !isEditable(el)) return;

  if (el.isContentEditable) {
    el.focus({ preventScroll: true });

    if (savedRange) {
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(savedRange);

      // replace the saved range with our suggestion
      savedRange.deleteContents();
      savedRange.insertNode(document.createTextNode(s));
      sel.collapseToEnd();
    } else {
      // fallback if we lost the range
      el.innerText = s;
    }
    emitInput(el); // important for React/ChatGPT
  } else {
    // <textarea>/<input>
    el.focus({ preventScroll: true });

    if (savedInputSel) {
      el.setRangeText(s, savedInputSel.start, savedInputSel.end, "end");
    } else if (el.selectionStart != null) {
      el.setRangeText(s, el.selectionStart, el.selectionEnd, "end");
    } else {
      el.value = s;
    }
    emitInput(el);
  }

  hideBubble();
}


async function copySuggestion() {
  const s = bubbleEl?.querySelector("#wh-suggestion")?.textContent || "";
  if (!s) return;
  await navigator.clipboard.writeText(s).catch(() => {});
  toast("Copied");
}

function toast(msg) {
  const el = document.createElement("div");
  el.className = "wh-toast";
  el.textContent = msg;
  document.body.appendChild(el);
  setTimeout(() => el.remove(), 1400);
}

// Hide bubble when clicking elsewhere
document.addEventListener("mousedown", (e) => {
  if (bubbleEl && !bubbleEl.contains(e.target)) hideBubble();
});
