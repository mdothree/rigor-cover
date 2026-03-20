import { initPaywall, gate, showPricingModal, renderUsageMeter } from "./services/paywallUI.js";
import { validators, guardSubmit } from "./utils/validate.js";
import { apiFetch } from "./config/env.js";
import { toast } from "./utils/toast.js";
import { authService } from "./services/authService.js";
import { firestoreService } from "./services/firestoreService.js";

let currentUser = null;

authService.onAuthChanged(user => {
  currentUser = user;
  const navLoginEl = document.getElementById("nav-login");
  if (navLoginEl) navLoginEl.textContent = user ? "Sign Out" : "Sign In";
  document.getElementById("nav-signup")?.classList.toggle("nav-signup-hidden", !!user);
  if (user) { loadHistory(); document.getElementById("history-section").classList.remove("hidden"); }
});

// Auth modal wiring
const authModal = document.getElementById("auth-modal");
document.getElementById("nav-login").addEventListener("click", e => {
  e.preventDefault();
  currentUser ? authService.signOut() : (authModal.classList.remove("hidden"));
});
document.getElementById("nav-signup").addEventListener("click", e => { e.preventDefault(); authModal.classList.remove("hidden"); });
document.getElementById("modal-close").addEventListener("click", () => authModal.classList.add("hidden"));
authModal.addEventListener("click", e => { if (e.target === authModal) authModal.classList.add("hidden"); });

document.querySelectorAll(".tab-btn").forEach(btn => {
  btn.addEventListener("click", () => {
    document.querySelectorAll(".tab-btn").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    document.querySelectorAll(".tab-content").forEach(t => t.classList.add("hidden"));
    document.getElementById(`tab-${btn.dataset.tab}`).classList.remove("hidden");
  });
});

document.getElementById("btn-login").addEventListener("click", async () => {
  try {
    await authService.signIn(document.getElementById("login-email").value, document.getElementById("login-password").value);
    authModal.classList.add("hidden");
  } catch(e) { document.getElementById("auth-error").textContent = e.message; document.getElementById("auth-error").classList.remove("hidden"); }
});

document.getElementById("btn-signup").addEventListener("click", async () => {
  try {
    await authService.signUp(document.getElementById("signup-email").value, document.getElementById("signup-password").value, document.getElementById("signup-name").value);
    authModal.classList.add("hidden");
  } catch(e) { document.getElementById("auth-error").textContent = e.message; document.getElementById("auth-error").classList.remove("hidden"); }
});

// Generate
document.getElementById("btn-generate").addEventListener("click", generate);

async function generate() {
  const resume = document.getElementById("resume-text").value.trim();
  const jd = document.getElementById("job-desc").value.trim();
  const tone = document.querySelector('input[name="tone"]:checked').value;
  const company = document.getElementById("company-name").value;
  const manager = document.getElementById("hiring-manager").value;

  if (!resume || !jd) return toast.warning("Please provide both resume and job description.");

  const btnText = document.querySelector(".btn-text");
  const btnLoader = document.querySelector(".btn-loader");
  btnText.classList.add("hidden"); btnLoader.classList.remove("hidden");
  document.getElementById("btn-generate").disabled = true;

  try {
    const res = await apiFetch("/api/cover-letter", { resume, jobDescription: jd, tone, companyName: company, hiringManager: manager });
    if (!res.ok) throw new Error("API error");
    const data = await res.json();
    document.getElementById("cover-letter-output").innerText = data.coverLetter || "Cover letter content goes here...";
    document.getElementById("result-panel").classList.remove("hidden");
    document.getElementById("result-panel").scrollIntoView({ behavior: "smooth" });
  } catch(e) {
    toast.error("Generation failed: ");
  } finally {
    btnText.classList.remove("hidden"); btnLoader.classList.add("hidden");
    document.getElementById("btn-generate").disabled = false;
  }
}

document.getElementById("btn-regenerate")?.addEventListener("click", generate);

document.getElementById("btn-copy")?.addEventListener("click", () => {
  const text = document.getElementById("cover-letter-output").innerText;
  navigator.clipboard.writeText(text).then(() => toast.success("Copied to clipboard!"));
});

document.getElementById("btn-save")?.addEventListener("click", async () => {
  if (!currentUser) { authModal.classList.remove("hidden"); return; }
  const text = document.getElementById("cover-letter-output").innerText;
  const jd = document.getElementById("job-desc").value;
  await saveDoc(currentUser.uid, { content: text, jobSnippet: jd.slice(0, 80), createdAt: new Date() });
  loadHistory();
  toast.success("Saved!");
});

async function saveDoc(userId, data) {
  const { db } = await import("./config/firebase.js");
  const { collection, addDoc, serverTimestamp } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  await addDoc(collection(db, "cover-letters"), { userId, ...data, createdAt: serverTimestamp() });
}

async function loadHistory() {
  if (!currentUser) return;
  const { db } = await import("./config/firebase.js");
  const { collection, query, where, orderBy, getDocs } = await import("https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js");
  const q = query(collection(db, "cover-letters"), where("userId", "==", currentUser.uid), orderBy("createdAt", "desc"));
  const snap = await getDocs(q);
  const grid = document.getElementById("history-grid");
  const items = snap.docs.map(d => ({ id: d.id, ...d.data() }));
  grid.innerHTML = items.length ? items.map(i => `
    <div class="history-card" data-content="${encodeURIComponent(i.content || '')}">
      <div class="history-title">${i.jobSnippet || "Cover Letter"}...</div>
      <div class="history-date">${i.createdAt?.toDate?.().toLocaleDateString?.() || "Recently"}</div>
    </div>`).join("") : "<p style='color:var(--gray-400)'>No saved cover letters yet.</p>";
  document.querySelectorAll(".history-card").forEach(card => {
    card.addEventListener("click", () => {
      document.getElementById("cover-letter-output").innerText = decodeURIComponent(card.dataset.content);
      document.getElementById("result-panel").classList.remove("hidden");
    });
  });
}
