import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { validators, guardSubmit } from "./utils/validate.js";
import { authService } from "./services/authService.js";
import { saveDoc, getUserDocs, tsToString } from "./services/firestoreService.js";
import {
  initAuthModal, wireAuthNav, openAuthModal, escapeHtml,
  showToolError, clearToolError, copyToClipboard
} from "./utils/helpers.js";

// Server-side limits in api/cover-letter/handler.js (resume 3000, job description 2000 chars).
const RESUME_LIMIT = 3000;
const JD_LIMIT = 2000;
const COLLECTION = "cover-letters";

let currentUser = null;
let historyItems = [];

const output = document.getElementById("cover-letter-output");
const resultPanel = document.getElementById("result-panel");
const placeholderNote = document.getElementById("placeholder-note");
const resumeInput = document.getElementById("resume-text");
const jdInput = document.getElementById("job-desc");

authService.onAuthChanged(user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  const history = document.getElementById("history-section");
  if (user) { history.classList.remove("hidden"); loadHistory(); }
  else history.classList.add("hidden");
});

// Auth modal + nav wiring (shared helpers)
initAuthModal(authService);
wireAuthNav(authService, () => currentUser);

// ─── Character counters (honest truncation notice) ────────────────────────────
function updateCounter(textarea, noteId, limit, label) {
  const note = document.getElementById(noteId);
  if (!note) return;
  const n = textarea.value.trim().length;
  note.textContent = n > limit
    ? `${n.toLocaleString()} characters. Only the first ${limit.toLocaleString()} characters of your ${label} will be used.`
    : `${n.toLocaleString()} / ${limit.toLocaleString()} characters used`;
  note.classList.toggle("input-note-warn", n > limit);
}
const updateResume = () => updateCounter(resumeInput, "resume-count", RESUME_LIMIT, "resume");
const updateJd = () => updateCounter(jdInput, "jd-count", JD_LIMIT, "job description");
resumeInput.addEventListener("input", updateResume);
jdInput.addEventListener("input", updateJd);
updateResume(); updateJd();

// ─── Placeholder warning ──────────────────────────────────────────────────────
// The prompt asks the model for a "signature placeholder", so letters usually end
// with things like "[Your Name]". Warn the user before they copy/send it.
function findPlaceholders(text) {
  return [...new Set((text.match(/\[[^\]\n]{1,60}\]/g) || []))];
}
function updatePlaceholderNote() {
  const found = findPlaceholders(output.innerText || "");
  if (!found.length) { placeholderNote.classList.add("hidden"); return; }
  placeholderNote.textContent = `Before you send this letter, replace the placeholder${found.length > 1 ? "s" : ""}: ${found.slice(0, 5).join(", ")}`;
  placeholderNote.classList.remove("hidden");
}
output.addEventListener("input", updatePlaceholderNote);

function showLetter(text) {
  output.innerText = text;
  resultPanel.classList.remove("hidden");
  updatePlaceholderNote();
}

// ─── Generate ─────────────────────────────────────────────────────────────────
document.getElementById("btn-generate").addEventListener("click", generate);

function setBusy(busy) {
  const btn = document.getElementById("btn-generate");
  btn.querySelector(".btn-text").classList.toggle("hidden", busy);
  btn.querySelector(".btn-loader").classList.toggle("hidden", !busy);
  btn.disabled = busy;
  const regen = document.getElementById("btn-regenerate");
  if (regen) regen.disabled = busy;
}

async function generate() {
  const resume = resumeInput.value.trim();
  const jd = jdInput.value.trim();
  const tone = document.querySelector('input[name="tone"]:checked')?.value || "professional";
  const company = document.getElementById("company-name").value.trim();
  const manager = document.getElementById("hiring-manager").value.trim();

  // Inline + toast message on empty/too-short input (RIGOR-EMPTY-INPUT-VALIDATION).
  if (!guardSubmit([
    { id: "resume-text", rules: [validators.required, validators.minWords(30)], label: "Resume" },
    { id: "job-desc", rules: [validators.required, validators.minWords(10)], label: "Job description" }
  ], toast)) return;

  // /api/cover-letter requires a signed-in user (requireAuth); say so up front.
  if (!currentUser) {
    toast.info("Sign in or create a free account to generate a cover letter.");
    openAuthModal("login");
    return;
  }

  clearToolError();
  setBusy(true);
  try {
    const data = await apiFetch("/api/cover-letter", { resume, jobDescription: jd, tone, companyName: company, hiringManager: manager });
    const letter = typeof data?.coverLetter === "string" ? data.coverLetter.trim() : "";
    if (!letter) throw new Error("The server returned an empty cover letter. Please try again.");
    showLetter(letter);
    resultPanel.scrollIntoView({ behavior: "smooth" });
  } catch (e) {
    showToolError(e, generate);
  } finally {
    setBusy(false);
  }
}

document.getElementById("btn-regenerate")?.addEventListener("click", () => {
  if (!confirm("Replace the current letter (including any edits) with a new one?")) return;
  generate();
});

document.getElementById("btn-copy")?.addEventListener("click", async () => {
  const text = output.innerText.trim();
  if (!text) return;
  const ok = await copyToClipboard(text);
  if (ok === false) return toast.error("Couldn't copy. Select the text and copy it manually.");
  toast.success(findPlaceholders(text).length ? "Copied. Remember to replace the bracketed placeholders." : "Copied to clipboard!");
});

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if (!currentUser) { openAuthModal("login"); return; }
  const text = output.innerText.trim();
  if (!text) return;
  try {
    await saveDoc(COLLECTION, currentUser.uid, { content: text, jobSnippet: jdInput.value.trim().slice(0, 80) });
    toast.success("Saved!");
    loadHistory();
  } catch (e) {
    toast.error(`Couldn't save: ${e?.message || "unknown error"}`);
  }
});

async function loadHistory() {
  if (!currentUser) return;
  const grid = document.getElementById("history-grid");
  try {
    historyItems = await getUserDocs(COLLECTION, currentUser.uid, { limitTo: 20 });
  } catch (e) {
    grid.innerHTML = `<p class="empty-note">Couldn't load saved letters: ${escapeHtml(e?.message || "unknown error")}</p>`;
    return;
  }
  grid.innerHTML = historyItems.length ? historyItems.map((i, idx) => {
    const snippet = i.jobSnippet || "Cover Letter";
    return `
    <div class="history-card" data-idx="${idx}" role="button" tabindex="0">
      <div class="history-title">${escapeHtml(snippet)}${snippet.length >= 80 ? "…" : ""}</div>
      <div class="history-date">${escapeHtml(tsToString(i.createdAt) || "Recently")}</div>
    </div>`;
  }).join("") : `<p class="empty-note">No saved cover letters yet.</p>`;
  grid.querySelectorAll(".history-card").forEach(card => {
    const open = () => {
      showLetter(historyItems[Number(card.dataset.idx)]?.content || "");
      resultPanel.scrollIntoView({ behavior: "smooth" });
    };
    card.addEventListener("click", open);
    card.addEventListener("keydown", e => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); open(); } });
  });
}

// ─── Service worker (moved from an inline <script> so a strict CSP doesn't block it) ──
if ("serviceWorker" in navigator) {
  window.addEventListener("load", () => {
    navigator.serviceWorker.register("/sw.js").catch(() => {});
  });
}
