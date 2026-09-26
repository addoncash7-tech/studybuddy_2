const SERVER_URL = window.location.protocol.startsWith("http")
  ? window.location.origin
  : "http://localhost:8000";

const loginScreen = document.getElementById("login-screen");
const signupScreen = document.getElementById("signup-screen");
const adminScreen = document.getElementById("admin-screen");
const setupScreen = document.getElementById("setup-screen");
const chatScreen = document.getElementById("chat-screen");

const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");
const showSignupLink = document.getElementById("show-signup-link");
const showLoginLink = document.getElementById("show-login-link");

const signupUsername = document.getElementById("signup-username");
const signupPassword = document.getElementById("signup-password");
const signupPasswordConfirm = document.getElementById("signup-password-confirm");
const signupBtn = document.getElementById("signup-btn");
const signupError = document.getElementById("signup-error");
const signupSuccess = document.getElementById("signup-success");

const adminPanelBtn = document.getElementById("admin-panel-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminToAppBtn = document.getElementById("admin-to-app-btn");
const adminLogoutBtn = document.getElementById("admin-logout-btn");
const addUserBtn = document.getElementById("add-user-btn");
const newUsername = document.getElementById("new-username");
const newPassword = document.getElementById("new-password");
const userList = document.getElementById("user-list");
const pendingList = document.getElementById("pending-list");
const adminError = document.getElementById("admin-error");
const adminSuccess = document.getElementById("admin-success");

const setupError = document.getElementById("setup-error");
const boardInput = document.getElementById("board");
const classInput = document.getElementById("class_1");
const subjectInput = document.getElementById("subject");
const startBtn = document.getElementById("start-btn");
const welcomeUser = document.getElementById("welcome-user");
const historyList = document.getElementById("history-list");
const downloadAllSetupBtn = document.getElementById("download-all-btn");
const downloadChatBtn = document.getElementById("download-chat-btn");

const usageBarSetup = document.getElementById("usage-bar-setup");
const usageBarFillSetup = document.getElementById("usage-bar-fill-setup");
const usageBarTextSetup = document.getElementById("usage-bar-text-setup");
const usageBarChat = document.getElementById("usage-bar-chat");
const usageBarFillChat = document.getElementById("usage-bar-fill-chat");
const usageBarTextChat = document.getElementById("usage-bar-text-chat");

function formatTokenCount(n) {
  return (n || 0).toLocaleString();
}

function renderUsage(usage) {
  const bars = [
    { bar: usageBarSetup, fill: usageBarFillSetup, text: usageBarTextSetup },
    { bar: usageBarChat, fill: usageBarFillChat, text: usageBarTextChat },
  ];

  // Admins (or a missing usage object) have no token limit - hide the bars.
  if (!usage) {
    bars.forEach(({ bar }) => bar.classList.add("hidden"));
    return;
  }

  const percentUsed = Math.min(100, Math.max(0, usage.percent_used));
  const label = `${formatTokenCount(usage.tokens_used)} / ${formatTokenCount(usage.token_limit)} tokens used · ${usage.percent_remaining}% remaining`;

  bars.forEach(({ bar, fill, text }) => {
    bar.classList.remove("hidden");
    fill.style.width = `${percentUsed}%`;
    fill.classList.toggle("usage-warn", percentUsed >= 75 && percentUsed < 95);
    fill.classList.toggle("usage-critical", percentUsed >= 95);
    text.textContent = label;
  });
}

function getSelectedMode() {
  const checked = document.querySelector('input[name="mode"]:checked');
  return checked ? checked.value : "concept";
}

function modeLabel(mode) {
  return mode === "exam" ? "📝 Exam Preparation" : "🧠 Concept Understanding";
}

const chatSubtitle = document.getElementById("chat-subtitle");
const messagesEl = document.getElementById("messages");
const questionInput = document.getElementById("question-input");
const sendBtn = document.getElementById("send-btn");
const resetBtn = document.getElementById("reset-btn");
const historyBtn = document.getElementById("history-btn");
const imageInput = document.getElementById("image-input");
const imageBtn = document.getElementById("image-btn");
const imagePreview = document.getElementById("image-preview");
const previewThumb = document.getElementById("preview-thumb");
const previewName = document.getElementById("preview-name");
const clearImageBtn = document.getElementById("clear-image-btn");

const MAX_IMAGE_BYTES = 4 * 1024 * 1024;
const ALLOWED_IMAGE_TYPES = ["image/jpeg", "image/png", "image/webp", "image/gif"];

let currentUser = null;
let selectedImage = null;
let currentChatId = null;

function getToken() {
  return sessionStorage.getItem("authToken");
}

function setToken(token) {
  if (token) {
    sessionStorage.setItem("authToken", token);
  } else {
    sessionStorage.removeItem("authToken");
  }
}

function authHeaders(extra = {}) {
  const headers = { ...extra };
  const token = getToken();
  if (token) {
    headers.Authorization = `Bearer ${token}`;
  }
  return headers;
}

function showScreen(screen) {
  loginScreen.classList.add("hidden");
  signupScreen.classList.add("hidden");
  adminScreen.classList.add("hidden");
  setupScreen.classList.add("hidden");
  chatScreen.classList.add("hidden");
  screen.classList.remove("hidden");
}

function updateAdminButton() {
  if (currentUser && currentUser.role === "admin") {
    adminPanelBtn.classList.remove("hidden");
  } else {
    adminPanelBtn.classList.add("hidden");
  }
}

function updateWelcome() {
  if (currentUser && currentUser.username) {
    welcomeUser.textContent = `Signed in as ${currentUser.username}`;
  } else {
    welcomeUser.textContent = "";
  }
  renderUsage(currentUser ? currentUser.usage : null);
}

function formatChatDate(iso) {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleString();
}

function enableChatInput(enabled) {
  questionInput.disabled = !enabled;
  sendBtn.disabled = !enabled;
  imageBtn.disabled = !enabled;
}

function renderChatMessages(chat) {
  messagesEl.innerHTML = "";
  const subject = chat.subject || "this topic";
  addMessage(`You're chatting about ${subject}. Ask a question, upload an image, or type "exit" to stop.`, "system");
  (chat.messages || []).forEach((item) => {
    if (item.role === "user") {
      addMessage(item.text, "user", item.image || null);
    } else if (item.role === "bot") {
      addMessage(item.text, "bot");
    }
  });
}

function openChatScreen(chat) {
  currentChatId = chat.id || null;
  chatSubtitle.textContent = `${chat.board} · Class ${chat.class_1} · ${chat.subject} · ${modeLabel(chat.mode)}`;
  enableChatInput(true);
  clearSelectedImage();
  renderChatMessages(chat);
  showScreen(chatScreen);
  questionInput.focus();
}

async function loadHistory() {
  if (!historyList) return;
  historyList.innerHTML = "";
  updateWelcome();

  try {
    const data = await apiFetch("/chats");
    const chats = data.chats || [];
    if (downloadAllSetupBtn) downloadAllSetupBtn.disabled = !chats.some((c) => c.message_count > 0);
    if (!chats.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No saved sessions yet. Start a new chat to see it here.";
      historyList.appendChild(li);
      return;
    }

    chats.forEach((chat) => {
      const li = document.createElement("li");
      li.className = "history-item";

      const main = document.createElement("div");
      main.className = "history-item-main";

      const title = document.createElement("span");
      title.className = "history-item-title";
      title.textContent = chat.subject || "Study chat";

      const meta = document.createElement("span");
      meta.className = "history-item-meta";
      const when = formatChatDate(chat.updated_at || chat.created_at);
      meta.textContent = [chat.board, chat.class_1 ? `Class ${chat.class_1}` : "", modeLabel(chat.mode), when]
        .filter(Boolean)
        .join(" · ");

      const preview = document.createElement("span");
      preview.className = "history-item-preview";
      preview.textContent = chat.preview || "New chat";

      main.appendChild(title);
      main.appendChild(meta);
      main.appendChild(preview);

      const actions = document.createElement("div");
      actions.className = "history-item-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "open-chat-btn";
      openBtn.textContent = "Open";
      openBtn.addEventListener("click", () => resumeChat(chat.id));

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Delete";
      removeBtn.addEventListener("click", () => deleteChat(chat.id));

      actions.appendChild(openBtn);
      actions.appendChild(removeBtn);
      li.appendChild(main);
      li.appendChild(actions);
      historyList.appendChild(li);
    });
  } catch (err) {
    const li = document.createElement("li");
    li.className = "empty-item";
    li.textContent = err.message;
    historyList.appendChild(li);
  }
}

async function goToApp() {
  updateAdminButton();
  updateWelcome();
  await loadHistory();
  showScreen(setupScreen);
}

async function resumeChat(chatId) {
  try {
    const chat = await apiFetch("/chats/resume", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chatId }),
    });
    boardInput.value = chat.board || "";
    classInput.value = chat.class_1 || "";
    subjectInput.value = chat.subject || "";
    const modeRadio = document.querySelector(`input[name="mode"][value="${chat.mode || "concept"}"]`);
    if (modeRadio) modeRadio.checked = true;
    openChatScreen(chat);
  } catch (err) {
    if (err.message.includes("Login required")) {
      await logout();
      loginError.textContent = "Session expired. Please sign in again.";
      return;
    }
    setupError.textContent = err.message;
  }
}

async function deleteChat(chatId) {
  try {
    await apiFetch("/chats", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: chatId }),
    });
    await loadHistory();
  } catch (err) {
    setupError.textContent = err.message;
  }
}

async function downloadChatsPdf(btn, chatId) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing PDF...";

  const exportUrlForError = chatId
    ? `/chats/export?id=${encodeURIComponent(chatId)}`
    : "/chats/export";

  try {
    const token = getToken();

    if (!token) {
      throw new Error("Login required. Please sign in again.");
    }

    const res = await fetch(`${SERVER_URL}${exportUrlForError}`, {
      method: "GET",
      headers: {
        ...authHeaders(),
        "Accept": "application/pdf",
        "Cache-Control": "no-cache"
      },
      cache: "no-store"
    });

    // Handle server errors
    if (!res.ok) {
      let message = `Could not download the PDF (HTTP ${res.status}).`;
      const contentType = res.headers.get("Content-Type") || "";

      if (contentType.includes("application/json")) {
        const data = await res.json().catch(() => ({}));
        message = data.error || message;
      } else {
        const errorText = await res.text().catch(() => "");
        if (errorText) {
          message = errorText.substring(0, 300);
        }
      }

      if (res.status === 401) {
        await logout();
        loginError.textContent = "Session expired. Please sign in again.";
        return;
      }

      throw new Error(message);
    }

    // Make sure the server actually returned a PDF
    const contentType = res.headers.get("Content-Type") || "";

    if (!contentType.toLowerCase().includes("application/pdf")) {
      const errorText = await res.text().catch(() => "");

      throw new Error(
        errorText
          ? `Server returned an unexpected response: ${errorText.substring(0, 200)}`
          : `Server returned ${
              contentType || "an unknown content type"
            } instead of a PDF.`
      );
    }

    // Read PDF
    const blob = await res.blob();

    if (!blob.size) {
      throw new Error("The server returned an empty PDF.");
    }

    // Get filename from server
    const disposition = res.headers.get("Content-Disposition") || "";
    const match = /filename="?([^";]+)"?/i.exec(disposition);

    const filename = match
      ? match[1]
      : chatId
      ? "study-buddy-chat.pdf"
      : "study-buddy-chats.pdf";

    // Trigger browser download
    const url = URL.createObjectURL(blob);

    const link = document.createElement("a");
    link.href = url;
    link.download = filename;

    document.body.appendChild(link);
    link.click();
    link.remove();

    // Give browser time to start the download
    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 5000);

  } catch (err) {
    let message = err?.message || "Could not download the PDF.";

    // Give a more useful message than the generic browser error
    if (
      message === "Failed to fetch" ||
      message.includes("NetworkError") ||
      message.includes("network error")
    ) {
      message =
        `Cannot connect to ${SERVER_URL}${exportUrlForError}. ` +
        "Please make sure server.py is running and open the app from http://localhost:8000.";
    }

    if (message.includes("Login required")) {
      await logout();
      loginError.textContent = "Session expired. Please sign in again.";
      return;
    }

    if (chatScreen.classList.contains("hidden")) {
      setupError.textContent = message;
    } else {
      addMessage(`⚠ ${message}`, "system");
    }

  } finally {
    btn.disabled = false;
    btn.textContent = originalLabel;
  }
}

async function apiFetch(path, options = {}) {
  const res = await fetch(`${SERVER_URL}${path}`, {
    ...options,
    headers: authHeaders(options.headers || {}),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || data.error || "Request failed.");
    err.status = res.status;
    err.data = data;
    throw err;
  }
  return data;
}

async function checkAuth() {
  const token = getToken();
  if (!token) {
    showScreen(loginScreen);
    return;
  }

  try {
    currentUser = await apiFetch("/auth/check");
    renderUsage(currentUser.usage);
    await goToApp();
  } catch {
    setToken(null);
    currentUser = null;
    showScreen(loginScreen);
  }
}

async function login() {
  const username = loginUsername.value.trim();
  const password = loginPassword.value;

  if (!username || !password) {
    loginError.textContent = "Please enter username and password.";
    return;
  }

  loginError.textContent = "";
  loginBtn.disabled = true;
  loginBtn.textContent = "Signing in...";

  try {
    const data = await fetch(`${SERVER_URL}/login`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Login failed.");
      return body;
    });

    setToken(data.token);
    currentUser = { username: data.username, role: data.role, usage: data.usage || null };
    loginPassword.value = "";
    updateAdminButton();
    renderUsage(currentUser.usage);

    if (data.role === "admin") {
      await loadUsers();
      showScreen(adminScreen);
    } else {
      await goToApp();
    }
  } catch (err) {
    if (err.message === "Failed to fetch") {
      loginError.textContent =
        "Cannot reach the server. Run 'python server.py' in the project folder, then open http://localhost:8000";
    } else {
      loginError.textContent = err.message;
    }
  } finally {
    loginBtn.disabled = false;
    loginBtn.textContent = "Sign In";
  }
}

async function signup() {
  const username = signupUsername.value.trim();
  const password = signupPassword.value;
  const confirm = signupPasswordConfirm.value;

  signupError.textContent = "";
  signupSuccess.textContent = "";

  if (!username || !password || !confirm) {
    signupError.textContent = "Please fill in all fields.";
    return;
  }
  if (password !== confirm) {
    signupError.textContent = "Passwords do not match.";
    return;
  }

  signupBtn.disabled = true;
  signupBtn.textContent = "Requesting...";

  try {
    const data = await fetch(`${SERVER_URL}/signup`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    }).then(async (res) => {
      const body = await res.json();
      if (!res.ok) throw new Error(body.error || "Sign-up failed.");
      return body;
    });

    signupSuccess.textContent = data.message || "Request sent. Please wait for admin approval.";
    signupUsername.value = "";
    signupPassword.value = "";
    signupPasswordConfirm.value = "";
  } catch (err) {
    if (err.message === "Failed to fetch") {
      signupError.textContent = "Cannot reach the server. Run 'python server.py' in the project folder.";
    } else {
      signupError.textContent = err.message;
    }
  } finally {
    signupBtn.disabled = false;
    signupBtn.textContent = "Request Access";
  }
}

async function logout() {
  try {
    await apiFetch("/logout", { method: "POST" });
  } catch {
    // ignore logout errors
  }
  setToken(null);
  currentUser = null;
  resetChat();
  loginUsername.value = "";
  loginPassword.value = "";
  loginError.textContent = "";
  showScreen(loginScreen);
}

function formatTokens(n) {
  return (n || 0).toLocaleString();
}

async function loadUsers() {
  adminError.textContent = "";
  adminSuccess.textContent = "";
  userList.innerHTML = "";
  pendingList.innerHTML = "";

  try {
    const data = await apiFetch("/admin/users");
    const pending = data.users.filter((u) => u.status === "pending");
    const approved = data.users.filter((u) => u.status !== "pending");

    if (!pending.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No pending sign-up requests.";
      pendingList.appendChild(li);
    } else {
      pending.forEach((user) => {
        const li = document.createElement("li");
        li.className = "user-item";

        const name = document.createElement("span");
        name.textContent = user.username;

        const actions = document.createElement("div");
        actions.className = "user-item-actions";

        const approveBtn = document.createElement("button");
        approveBtn.className = "open-chat-btn";
        approveBtn.textContent = "Approve";
        approveBtn.addEventListener("click", () => approveUser(user.username));

        const rejectBtn = document.createElement("button");
        rejectBtn.className = "remove-btn";
        rejectBtn.textContent = "Reject";
        rejectBtn.addEventListener("click", () => removeUser(user.username));

        actions.appendChild(approveBtn);
        actions.appendChild(rejectBtn);
        li.appendChild(name);
        li.appendChild(actions);
        pendingList.appendChild(li);
      });
    }

    if (!approved.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No approved users yet.";
      userList.appendChild(li);
      return;
    }

    approved.forEach((user) => {
      const li = document.createElement("li");
      li.className = "user-item";

      const info = document.createElement("div");
      info.className = "user-item-info";

      const name = document.createElement("span");
      name.className = "user-item-name";
      name.textContent = user.username;

      const tokens = document.createElement("span");
      tokens.className = "user-item-tokens";
      tokens.textContent = `${formatTokens(user.tokens_used)} / ${formatTokens(user.token_limit)} tokens used`;

      info.appendChild(name);
      info.appendChild(tokens);

      const actions = document.createElement("div");
      actions.className = "user-item-actions";

      const resetBtn = document.createElement("button");
      resetBtn.className = "secondary-btn";
      resetBtn.textContent = "Reset Tokens";
      resetBtn.addEventListener("click", () => resetTokens(user.username));

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeUser(user.username));

      actions.appendChild(resetBtn);
      actions.appendChild(removeBtn);
      li.appendChild(info);
      li.appendChild(actions);
      userList.appendChild(li);
    });
  } catch (err) {
    adminError.textContent = err.message;
  }
}

async function approveUser(username) {
  adminError.textContent = "";
  adminSuccess.textContent = "";

  try {
    await apiFetch("/admin/users/approve", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    adminSuccess.textContent = `User "${username}" approved.`;
    await loadUsers();
  } catch (err) {
    adminError.textContent = err.message;
  }
}

async function resetTokens(username) {
  adminError.textContent = "";
  adminSuccess.textContent = "";

  try {
    await apiFetch("/admin/users/reset-tokens", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    adminSuccess.textContent = `Token usage for "${username}" has been reset.`;
    await loadUsers();
  } catch (err) {
    adminError.textContent = err.message;
  }
}

async function addUser() {
  const username = newUsername.value.trim();
  const password = newPassword.value;

  if (!username || !password) {
    adminError.textContent = "Username and password are required.";
    adminSuccess.textContent = "";
    return;
  }

  adminError.textContent = "";
  adminSuccess.textContent = "";
  addUserBtn.disabled = true;
  addUserBtn.textContent = "Adding...";

  try {
    await apiFetch("/admin/users", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    newUsername.value = "";
    newPassword.value = "";
    adminSuccess.textContent = `User "${username}" added.`;
    await loadUsers();
  } catch (err) {
    adminError.textContent = err.message;
  } finally {
    addUserBtn.disabled = false;
    addUserBtn.textContent = "Add User";
  }
}

async function removeUser(username) {
  adminError.textContent = "";
  adminSuccess.textContent = "";

  try {
    await apiFetch("/admin/users", {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username }),
    });
    adminSuccess.textContent = `User "${username}" removed.`;
    await loadUsers();
  } catch (err) {
    adminError.textContent = err.message;
  }
}

function escapeHtml(text) {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

// ---- LaTeX-ish math -> plain, readable text (the model sometimes wraps
// chemistry/math in $$...$$ or \(...\) even though this chat can't render
// LaTeX; convert it to normal text with unicode sub/superscripts instead). ----

const SUBSCRIPT_MAP = {
  "0": "₀", "1": "₁", "2": "₂", "3": "₃", "4": "₄", "5": "₅", "6": "₆", "7": "₇", "8": "₈", "9": "₉",
  "+": "₊", "-": "₋", "=": "₌", "(": "₍", ")": "₎",
  "a": "ₐ", "e": "ₑ", "h": "ₕ", "i": "ᵢ", "j": "ⱼ", "k": "ₖ", "l": "ₗ", "m": "ₘ", "n": "ₙ",
  "o": "ₒ", "p": "ₚ", "r": "ᵣ", "s": "ₛ", "t": "ₜ", "u": "ᵤ", "v": "ᵥ", "x": "ₓ",
};
const SUPERSCRIPT_MAP = {
  "0": "⁰", "1": "¹", "2": "²", "3": "³", "4": "⁴", "5": "⁵", "6": "⁶", "7": "⁷", "8": "⁸", "9": "⁹",
  "+": "⁺", "-": "⁻", "=": "⁼", "(": "⁽", ")": "⁾", "n": "ⁿ", "i": "ⁱ",
};
const LATEX_SYMBOLS = {
  rightarrow: "→", to: "→", longrightarrow: "→", implies: "⇒", Rightarrow: "⇒",
  leftarrow: "←", Leftarrow: "⇐", leftrightarrow: "↔", Leftrightarrow: "⇔",
  rightleftharpoons: "⇌", rightleftarrows: "⇌",
  times: "×", cdot: "·", div: "÷", pm: "±", mp: "∓",
  approx: "≈", neq: "≠", leq: "≤", geq: "≥", le: "≤", ge: "≥", equiv: "≡",
  infty: "∞", circ: "°", degree: "°", partial: "∂", nabla: "∇",
  Delta: "Δ", delta: "δ", alpha: "α", beta: "β", gamma: "γ", Gamma: "Γ",
  theta: "θ", Theta: "Θ", lambda: "λ", Lambda: "Λ", mu: "μ", pi: "π",
  sigma: "σ", Sigma: "Σ", omega: "ω", Omega: "Ω", phi: "φ", Phi: "Φ",
  sum: "∑", prod: "∏", int: "∫", ldots: "…", cdots: "…", dots: "…",
  quad: " ", qquad: "  ",
};

function toSubscript(str) {
  return str.split("").map((c) => SUBSCRIPT_MAP[c.toLowerCase()] || c).join("");
}
function toSuperscript(str) {
  return str.split("").map((c) => SUPERSCRIPT_MAP[c.toLowerCase()] || c).join("");
}

function mathToPlainText(str) {
  let out = str;
  // \text{...}, \mathrm{...}, etc -> just the content
  out = out.replace(/\\(?:text|mathrm|mathbf|mathbb|boldsymbol|textbf|textrm|operatorname)\{([^{}]*)\}/g, "$1");
  // \frac{a}{b} -> (a)/(b)
  out = out.replace(/\\frac\{([^{}]*)\}\{([^{}]*)\}/g, "($1)/($2)");
  // \sqrt{a} -> √(a)
  out = out.replace(/\\sqrt\{([^{}]*)\}/g, "√($1)");
  out = out.replace(/\\sqrt/g, "√");
  out = out.replace(/\\left(?![a-zA-Z])|\\right(?![a-zA-Z])/g, "");
  // known LaTeX commands -> unicode symbol (leave unknown ones untouched)
  out = out.replace(/\\([a-zA-Z]+)/g, (m, name) => (name in LATEX_SYMBOLS ? LATEX_SYMBOLS[name] : m));
  // brace-delimited sub/superscript, e.g. _{2+} or ^{2+}
  out = out.replace(/_\{([^{}]+)\}/g, (_, g) => toSubscript(g));
  out = out.replace(/\^\{([^{}]+)\}/g, (_, g) => toSuperscript(g));
  // bare single-character sub/superscript right after a letter/number, e.g. H_2, x^2
  out = out.replace(/([A-Za-z0-9])_(?!_)([0-9A-Za-z])(?!_)/g, (_, before, c) => before + toSubscript(c));
  out = out.replace(/([A-Za-z0-9)])\^(?!\^)([0-9A-Za-z+\-])/g, (_, before, c) => before + toSuperscript(c));
  // any leftover grouping braces from LaTeX (not code, which is protected before this runs)
  out = out.replace(/[{}]/g, "");
  return out;
}

function protectCodeSpans(text) {
  const store = [];
  const stash = (m) => {
    store.push(m);
    return `\u0002${store.length - 1}\u0002`;
  };
  let out = text.replace(/```[\s\S]*?```/g, stash);
  out = out.replace(/`[^`\n]+`/g, stash);
  return { text: out, store };
}

function restoreCodeSpans(text, store) {
  return text.replace(/\u0002(\d+)\u0002/g, (_, i) => store[Number(i)]);
}

function convertLatexToPlainText(text) {
  let out = text;
  // $$...$$ display math
  out = out.replace(/\$\$([\s\S]*?)\$\$/g, (_, inner) => mathToPlainText(inner));
  // \[...\] display math
  out = out.replace(/\\\[([\s\S]*?)\\\]/g, (_, inner) => mathToPlainText(inner));
  // \(...\) inline math
  out = out.replace(/\\\(([\s\S]*?)\\\)/g, (_, inner) => mathToPlainText(inner));
  // $...$ inline math - only treat as math if it actually looks like LaTeX,
  // so a plain "$5" price isn't touched
  out = out.replace(/\$([^$\n]+?)\$/g, (_, inner) => (/[\\^_]/.test(inner) ? mathToPlainText(inner) : `$${inner}$`));
  // catch any remaining bare LaTeX commands the model left outside $ delimiters
  out = mathToPlainText(out);
  return out;
}

function formatBotMessage(text) {
  const protectedCode = protectCodeSpans(String(text || ""));
  const mathCleaned = convertLatexToPlainText(protectedCode.text);
  const restored = restoreCodeSpans(mathCleaned, protectedCode.store);
  let html = escapeHtml(restored);

  html = html.replace(/```([\s\S]*?)```/g, (_, code) => {
    return `<pre><code>${code.trim()}</code></pre>`;
  });
  html = html.replace(/`([^`\n]+)`/g, "<code>$1</code>");
  html = html.replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>");
  html = html.replace(/__(.+?)__/g, "<strong>$1</strong>");
  html = html.replace(/(^|[^*])\*(?!\s)([^*\n]+?)\*(?!\*)/g, "$1<em>$2</em>");
  html = html.replace(/^###\s+(.+)$/gm, "<h4>$1</h4>");
  html = html.replace(/^##\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^#\s+(.+)$/gm, "<h3>$1</h3>");
  html = html.replace(/^\s*[-*]\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/^\s*\d+\.\s+(.+)$/gm, "<li>$1</li>");
  html = html.replace(/(<li>[\s\S]*?<\/li>)/g, "<ul>$1</ul>");
  html = html.replace(/<\/ul>\s*<ul>/g, "");
  html = html.replace(/\n{2,}/g, "</p><p>");
  html = html.replace(/\n/g, "<br>");
  return `<p>${html}</p>`;
}

function addMessage(text, cls, imageSrc) {
  const div = document.createElement("div");
  div.className = `msg ${cls}`;
  if (imageSrc) {
    const img = document.createElement("img");
    img.className = "msg-image";
    img.src = imageSrc;
    img.alt = "Uploaded study image";
    div.appendChild(img);
  }
  if (cls === "bot") {
    const body = document.createElement("div");
    body.innerHTML = formatBotMessage(text);
    div.appendChild(body);
  } else if (text) {
    const body = document.createElement("div");
    body.textContent = text;
    div.appendChild(body);
  }
  messagesEl.appendChild(div);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function clearSelectedImage() {
  selectedImage = null;
  imageInput.value = "";
  previewThumb.src = "";
  previewName.textContent = "";
  imagePreview.classList.add("hidden");
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(new Error("Could not read the image."));
    reader.readAsDataURL(file);
  });
}

async function handleImageSelected(file) {
  if (!file) return;

  if (!ALLOWED_IMAGE_TYPES.includes(file.type)) {
    addMessage("⚠ Please upload a JPEG, PNG, WEBP, or GIF image.", "system");
    imageInput.value = "";
    return;
  }
  if (file.size > MAX_IMAGE_BYTES) {
    addMessage("⚠ Image is too large. Please choose a file under 4 MB.", "system");
    imageInput.value = "";
    return;
  }

  const dataUrl = await fileToDataUrl(file);
  selectedImage = {
    data: dataUrl,
    type: file.type,
    name: file.name,
  };
  previewThumb.src = dataUrl;
  previewName.textContent = file.name;
  imagePreview.classList.remove("hidden");
  questionInput.focus();
}

async function startChat() {
  const board = boardInput.value.trim();
  const class_1 = classInput.value.trim();
  const subject = subjectInput.value.trim();
  const mode = getSelectedMode();

  if (!board || !class_1 || !subject) {
    setupError.textContent = "Please fill in board, class and subject.";
    return;
  }

  setupError.textContent = "";
  startBtn.disabled = true;
  startBtn.textContent = "Starting...";

  try {
    const data = await apiFetch("/init", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ board, class_1, subject, mode }),
    });

    if (currentUser) currentUser.usage = data.usage || currentUser.usage;
    renderUsage(data.usage);
    openChatScreen(data);
    addMessage(`Saved as a new session in your chat history.`, "system");
  } catch (err) {
    if (err.message.includes("Login required")) {
      await logout();
      loginError.textContent = "Session expired. Please sign in again.";
      return;
    }
    setupError.textContent = `${err.message} (Is server.py running on port 8000?)`;
  } finally {
    startBtn.disabled = false;
    startBtn.textContent = "Start New Chat";
  }
}

async function sendQuestion() {
  const question = questionInput.value.trim();
  const image = selectedImage;

  if (!question && !image) return;

  if (question.toLowerCase() === "exit") {
    addMessage("Chat ended. Open History to review this session, or start a new chat.", "system");
    questionInput.value = "";
    enableChatInput(false);
    clearSelectedImage();
    return;
  }

  addMessage(question || "Help me with this image.", "user", image ? image.data : null);
  questionInput.value = "";
  clearSelectedImage();
  enableChatInput(false);
  let tokenLimitHit = false;

  try {
    const payload = { question };
    if (image) {
      payload.image = { data: image.data, type: image.type };
    }

    const data = await apiFetch("/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    });

    addMessage(data.answer, "bot");
    if (currentUser) currentUser.usage = data.usage || currentUser.usage;
    renderUsage(data.usage);
  } catch (err) {
    if (err.message.includes("Login required")) {
      await logout();
      loginError.textContent = "Session expired. Please sign in again.";
      return;
    }
    if (err.status === 402) {
      addMessage(`🔒 ${err.message}`, "system");
      const usage = err.data && err.data.usage;
      if (currentUser && usage) currentUser.usage = usage;
      renderUsage(usage);
      tokenLimitHit = true;
      return;
    }
    addMessage(`⚠ ${err.message}`, "system");
  } finally {
    if (!tokenLimitHit) {
      enableChatInput(true);
      questionInput.focus();
    }
  }
}

function resetChat(clearForm = true) {
  if (clearForm) {
    boardInput.value = "";
    classInput.value = "";
    subjectInput.value = "";
  }
  questionInput.value = "";
  enableChatInput(true);
  clearSelectedImage();
  messagesEl.innerHTML = "";
  setupError.textContent = "";
  currentChatId = null;
}

loginBtn.addEventListener("click", login);
signupBtn.addEventListener("click", signup);
showSignupLink.addEventListener("click", (e) => {
  e.preventDefault();
  signupError.textContent = "";
  signupSuccess.textContent = "";
  showScreen(signupScreen);
});
showLoginLink.addEventListener("click", (e) => {
  e.preventDefault();
  loginError.textContent = "";
  showScreen(loginScreen);
});
logoutBtn.addEventListener("click", logout);
adminLogoutBtn.addEventListener("click", logout);
adminPanelBtn.addEventListener("click", async () => {
  await loadUsers();
  showScreen(adminScreen);
});
adminToAppBtn.addEventListener("click", goToApp);
addUserBtn.addEventListener("click", addUser);
startBtn.addEventListener("click", startChat);
historyBtn.addEventListener("click", async () => {
  resetChat(false);
  await goToApp();
});
resetBtn.addEventListener("click", async () => {
  resetChat(true);
  await goToApp();
});
sendBtn.addEventListener("click", sendQuestion);
if (downloadAllSetupBtn) {
  downloadAllSetupBtn.addEventListener("click", () => downloadChatsPdf(downloadAllSetupBtn));
}
if (downloadChatBtn) {
  downloadChatBtn.addEventListener("click", () => downloadChatsPdf(downloadChatBtn, currentChatId));
}
imageBtn.addEventListener("click", () => imageInput.click());
clearImageBtn.addEventListener("click", clearSelectedImage);
imageInput.addEventListener("change", async (e) => {
  const file = e.target.files && e.target.files[0];
  try {
    await handleImageSelected(file);
  } catch (err) {
    addMessage(`⚠ ${err.message}`, "system");
    clearSelectedImage();
  }
});

questionInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") sendQuestion();
});
loginPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
loginUsername.addEventListener("keydown", (e) => {
  if (e.key === "Enter") login();
});
boardInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startChat(); });
classInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startChat(); });
subjectInput.addEventListener("keydown", (e) => { if (e.key === "Enter") startChat(); });
newPassword.addEventListener("keydown", (e) => {
  if (e.key === "Enter") addUser();
});
signupPasswordConfirm.addEventListener("keydown", (e) => {
  if (e.key === "Enter") signup();
});

checkAuth();