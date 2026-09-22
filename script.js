const SERVER_URL = window.location.protocol.startsWith("http")
  ? window.location.origin
  : "http://localhost:8000";

const loginScreen = document.getElementById("login-screen");
const adminScreen = document.getElementById("admin-screen");
const setupScreen = document.getElementById("setup-screen");
const chatScreen = document.getElementById("chat-screen");

const loginUsername = document.getElementById("login-username");
const loginPassword = document.getElementById("login-password");
const loginBtn = document.getElementById("login-btn");
const loginError = document.getElementById("login-error");

const adminPanelBtn = document.getElementById("admin-panel-btn");
const logoutBtn = document.getElementById("logout-btn");
const adminToAppBtn = document.getElementById("admin-to-app-btn");
const adminLogoutBtn = document.getElementById("admin-logout-btn");
const addUserBtn = document.getElementById("add-user-btn");
const newUsername = document.getElementById("new-username");
const newPassword = document.getElementById("new-password");
const userList = document.getElementById("user-list");
const adminError = document.getElementById("admin-error");
const adminSuccess = document.getElementById("admin-success");

const setupError = document.getElementById("setup-error");
const boardInput = document.getElementById("board");
const classInput = document.getElementById("class_1");
const subjectInput = document.getElementById("subject");
const startBtn = document.getElementById("start-btn");
const welcomeUser = document.getElementById("welcome-user");
const historyList = document.getElementById("history-list");
const downloadAllBtns = document.querySelectorAll(".download-all-btn");
const downloadAllSetupBtn = document.getElementById("download-all-btn");

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
  chatSubtitle.textContent = `${chat.board} · Class ${chat.class_1} · ${chat.subject}`;
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
      meta.textContent = [chat.board, chat.class_1 ? `Class ${chat.class_1}` : "", when]
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

async function downloadAllChats(btn) {
  const originalLabel = btn.textContent;
  btn.disabled = true;
  btn.textContent = "Preparing PDF...";

  try {
    const token = getToken();

    if (!token) {
      throw new Error("Login required. Please sign in again.");
    }

    const res = await fetch(`${SERVER_URL}/chats/export`, {
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
        `Cannot connect to ${SERVER_URL}/chats/export. ` +
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
    throw new Error(data.error || "Request failed.");
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
    currentUser = { username: data.username, role: data.role };
    loginPassword.value = "";
    updateAdminButton();

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

async function loadUsers() {
  adminError.textContent = "";
  adminSuccess.textContent = "";
  userList.innerHTML = "";

  try {
    const data = await apiFetch("/admin/users");
    if (!data.users.length) {
      const li = document.createElement("li");
      li.className = "empty-item";
      li.textContent = "No approved users yet.";
      userList.appendChild(li);
      return;
    }

    data.users.forEach((user) => {
      const li = document.createElement("li");
      li.className = "user-item";

      const name = document.createElement("span");
      name.textContent = user.username;

      const removeBtn = document.createElement("button");
      removeBtn.className = "remove-btn";
      removeBtn.textContent = "Remove";
      removeBtn.addEventListener("click", () => removeUser(user.username));

      li.appendChild(name);
      li.appendChild(removeBtn);
      userList.appendChild(li);
    });
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

function formatBotMessage(text) {
  let html = escapeHtml(String(text || ""));

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
      body: JSON.stringify({ board, class_1, subject }),
    });

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
  } catch (err) {
    if (err.message.includes("Login required")) {
      await logout();
      loginError.textContent = "Session expired. Please sign in again.";
      return;
    }
    addMessage(`⚠ ${err.message}`, "system");
  } finally {
    sendBtn.disabled = false;
    imageBtn.disabled = false;
    questionInput.disabled = false;
    questionInput.focus();
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
}

loginBtn.addEventListener("click", login);
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
downloadAllBtns.forEach((btn) => btn.addEventListener("click", () => downloadAllChats(btn)));
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

checkAuth();
