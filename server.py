"""
Simple backend for the board/class/subject chat tutor.

- Uses Python's built-in http.server (NO Flask, NO Django).
- Reads the Gemini API key and admin credentials from .env.
- Login required; only admin-approved users can access the app.
- Serves index.html, script.js, and style.css from the same port.

Run with:  python server.py
Then open http://localhost:8000 in your browser.
"""

import base64
import hashlib
import json
import mimetypes
import os
import re
import secrets
import uuid
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, HTTPServer
from pathlib import Path
from urllib.parse import parse_qs, urlparse

from dotenv import load_dotenv
from langchain_google_genai import ChatGoogleGenerativeAI
from langchain_core.prompts import PromptTemplate
from langchain_core.messages import HumanMessage, AIMessage, SystemMessage

try:
    from pdf_export import build_chats_pdf
except ImportError:  # reportlab not installed - PDF download disabled, rest of app still works
    build_chats_pdf = None


BASE_DIR = Path(__file__).resolve().parent
USERS_FILE = BASE_DIR / "users.json"
HISTORY_DIR = BASE_DIR / "history"

load_dotenv()
API_KEY = os.getenv("GEMINI_API_KEY")


ADMIN_USERNAME = os.getenv("ADMIN_USERNAME", "admin")
ADMIN_PASSWORD = os.getenv("ADMIN_PASSWORD", "changeme")

# Default per-user token allowance. Admin can reset a user's usage back to 0
# from the Admin Panel once they've used up this allowance.
DEFAULT_TOKEN_LIMIT = 1_000_000

STATUS_PENDING = "pending"
STATUS_APPROVED = "approved"

MODE_CONCEPT = "concept"
MODE_EXAM = "exam"
VALID_MODES = {MODE_CONCEPT, MODE_EXAM}

if not API_KEY:
    raise RuntimeError(
        "GEMINI_API_KEY not found.\n"
        "1) Copy .env.example to .env\n"
        "2) Put your real key in .env as GEMINI_API_KEY=your_key_here\n"
        "The .env file is not shared or uploaded anywhere."
    )

llm = ChatGoogleGenerativeAI(model="gemini-3.6-flash", google_api_key=API_KEY)

ALLOWED_IMAGE_TYPES = {"image/jpeg", "image/png", "image/webp", "image/gif"}
MAX_IMAGE_BYTES = 4 * 1024 * 1024

# Shared instructions that apply no matter which mode the student picked.
BASE_PROMPT_TEMPLATE = PromptTemplate.from_template(
    "You are an expert for {board} class {class_1} {subject} and you have the "
    "capability to explain concepts in an easy and concise way, simple, student-friendly language "
    "in simple English with a fun example."
    "User should ask study related question only."
    "If User asks any question outside the given parameter, say you can ask study related question only."
    "The student may upload an image (homework, textbook page, diagram, worksheet, or handwritten notes). "
    "Read the image carefully and answer based on what is in the image plus the student's question, "
    "using the same teaching approach as text questions."
    "🚫 Avoids inappropriate or unsafe content"
    "💡 Encourages curiosity and independent thinking"
    "⚠️ Never use LaTeX syntax or math delimiters ($, $$, \\(, \\), \\[, \\], \\text{{}}, \\frac{{}}, etc.) "
    "because this chat cannot render them. Write chemical equations, formulas, and math directly as "
    "plain text using Unicode characters instead, e.g. 'CuO(s) + H₂(g) → Cu(s) + H₂O(l)', 'x²', 'H₂SO₄'."
)

# Branch-specific instructions, appended on top of the base prompt depending
# on whether the student chose "Concept Understanding" or "Exam Preparation".
CONCEPT_PROMPT_ADDITION = (
    " Right now the student is in CONCEPT UNDERSTANDING mode, so your goal is to build a deep, "
    "intuitive understanding of the topic rather than to drill for exams."
    "🧠 Break the concept down step-by-step from first principles"
    "❓ Ask guiding questions before revealing the full explanation"
    "🎯 Use everyday analogies and fun, relatable examples"
    "🔄 Check understanding by asking the student to explain it back or try a mini example"
    "📚 Connect the concept to the bigger picture of the chapter/subject"
    "💬 Prefer clarity and intuition over memorized definitions"
)

EXAM_PROMPT_ADDITION = (
    " Right now the student is in EXAM PREPARATION mode, so your goal is to help them perform well "
    "in tests and exams for this board, class, and subject."
    "📝 Create practice questions, quizzes, and flashcards in the style typically asked in exams"
    "🎯 Point out frequently asked questions, important topics, and marks-weightage where relevant"
    "🧭 Teach exam-answer structure: what to write for full marks, keywords examiners look for, and time management tips"
    "🔄 Correct mistakes precisely and explain why an answer would lose marks"
    "📋 Offer short revision notes/summaries and memory tricks (mnemonics) when useful"
    "⏱️ Keep answers exam-focused: without simply giving away full answers, help the student reach the exam-ready answer"
)


def build_system_prompt(board, class_1, subject, mode):
    """Build the system prompt text for a chat, branching on the chosen mode."""
    base = str(BASE_PROMPT_TEMPLATE.invoke({"board": board, "class_1": class_1, "subject": subject}))
    addition = EXAM_PROMPT_ADDITION if mode == MODE_EXAM else CONCEPT_PROMPT_ADDITION
    return base + addition

# Per-user conversation state keyed by username.
conversations = {}

# Active sessions: token -> {username, role}
sessions = {}


def hash_password(password):
    return hashlib.sha256(password.encode("utf-8")).hexdigest()


def _normalize_user(user):
    """Fill in defaults for fields that may be missing from older users.json entries."""
    user.setdefault("status", STATUS_APPROVED)
    user.setdefault("token_limit", DEFAULT_TOKEN_LIMIT)
    user.setdefault("tokens_used", 0)
    user.setdefault("created_at", now_iso())
    return user


def load_users():
    if not USERS_FILE.exists():
        save_users([])
        return []
    with open(USERS_FILE, encoding="utf-8") as f:
        data = json.load(f)
    return [_normalize_user(u) for u in data.get("users", [])]


def save_users(users):
    with open(USERS_FILE, "w", encoding="utf-8") as f:
        json.dump({"users": users}, f, indent=2)


def find_user(username):
    username = username.strip().lower()
    for user in load_users():
        if user["username"].lower() == username:
            return user
    return None


def update_user(username, **fields):
    """Update one user's record in users.json and return the updated record, or None."""
    username = (username or "").strip().lower()
    users = load_users()
    updated = None
    for user in users:
        if user["username"].lower() == username:
            user.update(fields)
            updated = user
            break
    if updated is not None:
        save_users(users)
    return updated


def create_pending_user(username, password):
    users = load_users()
    users.append({
        "username": username,
        "password_hash": hash_password(password),
        "status": STATUS_PENDING,
        "token_limit": DEFAULT_TOKEN_LIMIT,
        "tokens_used": 0,
        "created_at": now_iso(),
    })
    save_users(users)


def approve_user(username):
    return update_user(username, status=STATUS_APPROVED)


def reset_user_tokens(username):
    return update_user(username, tokens_used=0)


def add_user_tokens(username, amount):
    if amount <= 0:
        return
    user = find_user(username)
    if not user:
        return
    update_user(username, tokens_used=user.get("tokens_used", 0) + amount)


def usage_payload(username, role):
    """Return {tokens_used, token_limit, tokens_remaining, percent_used, percent_remaining}
    for a regular user, or None for admin (admin has no token limit)."""
    if role == "admin":
        return None
    user = find_user(username)
    if not user:
        return None
    limit = max(1, user.get("token_limit", DEFAULT_TOKEN_LIMIT))
    used = min(user.get("tokens_used", 0), limit)
    percent_used = round((used / limit) * 100, 1)
    return {
        "tokens_used": used,
        "token_limit": limit,
        "tokens_remaining": limit - used,
        "percent_used": percent_used,
        "percent_remaining": round(100 - percent_used, 1),
    }


def authenticate(username, password):
    username = (username or "").strip()
    password = password or ""

    if not username or not password:
        return None, None

    if username == ADMIN_USERNAME and password == ADMIN_PASSWORD:
        return {"username": username, "role": "admin"}, None

    user = find_user(username)
    if not user or user["password_hash"] != hash_password(password):
        return None, None

    if user.get("status") != STATUS_APPROVED:
        return None, "Your account is awaiting admin approval. Please check back later."

    return {"username": user["username"], "role": "user"}, None


def create_session(user):
    token = secrets.token_hex(32)
    sessions[token] = {"username": user["username"], "role": user["role"]}
    return token


def get_session_from_headers(handler):
    auth = handler.headers.get("Authorization", "")
    if auth.startswith("Bearer "):
        token = auth[7:].strip()
        return sessions.get(token), token
    return None, None


def now_iso():
    return datetime.now(timezone.utc).isoformat()


def safe_username(username):
    cleaned = re.sub(r"[^a-zA-Z0-9._-]", "_", (username or "").strip())
    return cleaned[:64] or "user"


def history_path(username):
    HISTORY_DIR.mkdir(exist_ok=True)
    return HISTORY_DIR / f"{safe_username(username)}.json"


def load_user_chats(username):
    path = history_path(username)
    if not path.exists():
        return []
    try:
        with open(path, encoding="utf-8") as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return []
    chats = data.get("chats", [])
    return chats if isinstance(chats, list) else []


def save_user_chats(username, chats):
    path = history_path(username)
    with open(path, "w", encoding="utf-8") as f:
        json.dump({"chats": chats}, f, indent=2)


def upsert_saved_chat(username, chat):
    chats = load_user_chats(username)
    updated = False
    for index, existing in enumerate(chats):
        if existing.get("id") == chat["id"]:
            chats[index] = chat
            updated = True
            break
    if not updated:
        chats.append(chat)
    save_user_chats(username, chats)


def find_saved_chat(username, chat_id):
    for chat in load_user_chats(username):
        if chat.get("id") == chat_id:
            return chat
    return None


def delete_saved_chat(username, chat_id):
    chats = load_user_chats(username)
    updated = [chat for chat in chats if chat.get("id") != chat_id]
    if len(updated) == len(chats):
        return False
    save_user_chats(username, updated)
    return True


def delete_user_history(username):
    path = history_path(username)
    if path.exists():
        path.unlink()


def chat_summary(chat):
    return {
        "id": chat.get("id"),
        "board": chat.get("board", ""),
        "class_1": chat.get("class_1", ""),
        "subject": chat.get("subject", ""),
        "mode": chat.get("mode") or MODE_CONCEPT,
        "created_at": chat.get("created_at", ""),
        "updated_at": chat.get("updated_at", ""),
        "preview": chat.get("preview") or "New chat",
        "message_count": len(chat.get("messages") or []),
    }


def public_chat(chat):
    messages = []
    for item in chat.get("messages") or []:
        messages.append({
            "role": item.get("role"),
            "text": item.get("text") or "",
            "image": item.get("image"),
        })
    summary = chat_summary(chat)
    summary["messages"] = messages
    return summary


def persist_active_chat(username, conversation):
    if not conversation or not conversation.get("id"):
        return
    first_user = next(
        (item for item in conversation.get("transcript") or [] if item.get("role") == "user"),
        None,
    )
    preview = "New chat"
    if first_user and first_user.get("text"):
        preview = first_user["text"].strip()
        if len(preview) > 80:
            preview = preview[:77] + "..."

    chat = {
        "id": conversation["id"],
        "board": conversation.get("board", ""),
        "class_1": conversation.get("class_1", ""),
        "subject": conversation.get("subject", ""),
        "mode": conversation.get("mode") or MODE_CONCEPT,
        "created_at": conversation.get("created_at") or now_iso(),
        "updated_at": now_iso(),
        "preview": preview,
        "messages": conversation.get("transcript") or [],
    }
    conversation["created_at"] = chat["created_at"]
    upsert_saved_chat(username, chat)


def build_langchain_messages(chat):
    system_text = build_system_prompt(
        chat.get("board") or "",
        chat.get("class_1") or "",
        chat.get("subject") or "",
        chat.get("mode") or MODE_CONCEPT,
    )
    messages = [SystemMessage(content=system_text)]
    for item in chat.get("messages") or []:
        role = item.get("role")
        text = (item.get("text") or "").strip()
        image = item.get("image")
        if role == "user":
            if image:
                content, error = build_image_content(text, image, "")
                if error:
                    messages.append(HumanMessage(content=text or "Help me with this image."))
                else:
                    messages.append(HumanMessage(content=content))
            elif text:
                messages.append(HumanMessage(content=text))
        elif role == "bot" and text:
            messages.append(AIMessage(content=text))
    return messages


def build_image_content(question, image_data, image_type):
    if image_data.startswith("data:") and "," in image_data:
        header, image_data = image_data.split(",", 1)
        header = header.lower()
        if not image_type and ";" in header:
            image_type = header[5:].split(";")[0]

    image_type = (image_type or "").strip().lower()
    if image_type not in ALLOWED_IMAGE_TYPES:
        return None, "Please upload a JPEG, PNG, WEBP, or GIF image."

    try:
        raw = image_data.encode("ascii")
        padding = (-len(raw)) % 4
        decoded = base64.b64decode(raw + b"=" * padding)
    except Exception:
        return None, "The uploaded image could not be read. Try another file."

    if not decoded:
        return None, "The uploaded image is empty."
    if len(decoded) > MAX_IMAGE_BYTES:
        return None, "Image is too large. Please upload a file under 4 MB."

    prompt = question or (
        "Look at this uploaded study image and help me with it. "
        "Read any text, diagrams, or questions in the image. "
        "Explain it using my board, class, and subject, and guide me step by step "
        "instead of only giving the final answer."
    )
    data_url = f"data:{image_type};base64,{image_data}"
    return [
        {"type": "text", "text": prompt},
        {"type": "image_url", "image_url": {"url": data_url}},
    ], None


class Handler(BaseHTTPRequestHandler):
    def _set_json_headers(self, status=200):
        self.send_response(status)
        self.send_header("Content-Type", "application/json")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, DELETE, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization")
        self.end_headers()

    def _respond_json(self, status, payload):
        self._set_json_headers(status)
        self.wfile.write(json.dumps(payload).encode("utf-8"))

    def _read_json(self):
        length = int(self.headers.get("Content-Length", 0))
        raw_body = self.rfile.read(length) if length else b"{}"
        try:
            return json.loads(raw_body or b"{}")
        except json.JSONDecodeError:
            return None

    def _require_auth(self, admin_only=False):
        session, _ = get_session_from_headers(self)
        if not session:
            self._respond_json(401, {"error": "Login required."})
            return None
        if admin_only and session["role"] != "admin":
            self._respond_json(403, {"error": "Admin access required."})
            return None
        return session

    def do_OPTIONS(self):
        self._set_json_headers()

    def do_GET(self):
        path = urlparse(self.path).path

        if path == "/auth/check":
            session, _ = get_session_from_headers(self)
            if not session:
                self._respond_json(401, {"error": "Not logged in."})
                return
            self._respond_json(200, {
                "username": session["username"],
                "role": session["role"],
                "usage": usage_payload(session["username"], session["role"]),
            })
            return

        if path == "/admin/users":
            session = self._require_auth(admin_only=True)
            if not session:
                return
            users = [{
                "username": u["username"],
                "status": u.get("status", STATUS_APPROVED),
                "token_limit": u.get("token_limit", DEFAULT_TOKEN_LIMIT),
                "tokens_used": u.get("tokens_used", 0),
                "created_at": u.get("created_at", ""),
            } for u in load_users()]
            self._respond_json(200, {"users": users})
            return

        if path == "/chats":
            self._handle_list_chats()
            return

        if path == "/chats/export":
            query = parse_qs(urlparse(self.path).query)
            chat_id = (query.get("id") or [None])[0]
            self._handle_export_chats(chat_id)
            return

        self._serve_static(path)

    def do_POST(self):
        path = urlparse(self.path).path
        data = self._read_json()
        if data is None:
            self._respond_json(400, {"error": "Invalid JSON in request body."})
            return

        if path == "/login":
            self._handle_login(data)
        elif path == "/signup":
            self._handle_signup(data)
        elif path == "/logout":
            self._handle_logout()
        elif path == "/init":
            self._handle_init(data)
        elif path == "/chat":
            self._handle_chat(data)
        elif path == "/chats/resume":
            self._handle_resume_chat(data)
        elif path == "/admin/users":
            self._handle_add_user(data)
        elif path == "/admin/users/approve":
            self._handle_approve_user(data)
        elif path == "/admin/users/reset-tokens":
            self._handle_reset_tokens(data)
        else:
            self._respond_json(404, {"error": "Unknown endpoint."})

    def do_DELETE(self):
        path = urlparse(self.path).path
        if path == "/chats":
            self._handle_delete_chat()
            return

        if path != "/admin/users":
            self._respond_json(404, {"error": "Unknown endpoint."})
            return

        session = self._require_auth(admin_only=True)
        if not session:
            return

        data = self._read_json()
        if data is None:
            self._respond_json(400, {"error": "Invalid JSON in request body."})
            return

        username = (data.get("username") or "").strip()
        if not username:
            self._respond_json(400, {"error": "Username is required."})
            return

        if username.lower() == ADMIN_USERNAME.lower():
            self._respond_json(400, {"error": "Cannot remove the admin account."})
            return

        users = load_users()
        updated = [u for u in users if u["username"].lower() != username.lower()]
        if len(updated) == len(users):
            self._respond_json(404, {"error": "User not found."})
            return

        save_users(updated)
        conversations.pop(username, None)
        delete_user_history(username)
        self._respond_json(200, {"status": "ok"})

    def _handle_login(self, data):
        user, error = authenticate(data.get("username"), data.get("password"))
        if not user:
            self._respond_json(401, {"error": error or "Invalid username or password, or access not granted."})
            return

        token = create_session(user)
        self._respond_json(200, {
            "token": token,
            "username": user["username"],
            "role": user["role"],
            "usage": usage_payload(user["username"], user["role"]),
        })

    def _handle_logout(self):
        _, token = get_session_from_headers(self)
        if token and token in sessions:
            del sessions[token]
        self._respond_json(200, {"status": "ok"})

    def _handle_add_user(self, data):
        session = self._require_auth(admin_only=True)
        if not session:
            return

        username = (data.get("username") or "").strip()
        password = (data.get("password") or "").strip()

        if not username or not password:
            self._respond_json(400, {"error": "Username and password are required."})
            return

        if username.lower() == ADMIN_USERNAME.lower():
            self._respond_json(400, {"error": "Cannot add a user with the admin username."})
            return

        if find_user(username):
            self._respond_json(409, {"error": "User already exists."})
            return

        users = load_users()
        users.append({
            "username": username,
            "password_hash": hash_password(password),
            "status": STATUS_APPROVED,
            "token_limit": DEFAULT_TOKEN_LIMIT,
            "tokens_used": 0,
            "created_at": now_iso(),
        })
        save_users(users)
        self._respond_json(200, {"status": "ok", "username": username})

    def _handle_signup(self, data):
        username = (data.get("username") or "").strip()
        password = (data.get("password") or "").strip()

        if not username or not password:
            self._respond_json(400, {"error": "Username and password are required."})
            return

        if len(password) < 4:
            self._respond_json(400, {"error": "Password must be at least 4 characters."})
            return

        if username.lower() == ADMIN_USERNAME.lower():
            self._respond_json(400, {"error": "That username is not available."})
            return

        if find_user(username):
            self._respond_json(409, {"error": "That username is already taken or awaiting approval."})
            return

        create_pending_user(username, password)
        self._respond_json(200, {
            "status": "pending",
            "message": "Your sign-up request has been sent to the admin for approval. You'll be able to log in once approved.",
        })

    def _handle_approve_user(self, data):
        session = self._require_auth(admin_only=True)
        if not session:
            return

        username = (data.get("username") or "").strip()
        if not username:
            self._respond_json(400, {"error": "Username is required."})
            return

        user = approve_user(username)
        if not user:
            self._respond_json(404, {"error": "User not found."})
            return

        self._respond_json(200, {"status": "ok", "username": user["username"]})

    def _handle_reset_tokens(self, data):
        session = self._require_auth(admin_only=True)
        if not session:
            return

        username = (data.get("username") or "").strip()
        if not username:
            self._respond_json(400, {"error": "Username is required."})
            return

        user = reset_user_tokens(username)
        if not user:
            self._respond_json(404, {"error": "User not found."})
            return

        self._respond_json(200, {"status": "ok", "username": user["username"], "tokens_used": user["tokens_used"]})

    def _handle_init(self, data):
        session = self._require_auth()
        if not session:
            return

        board = (data.get("board") or "").strip()
        class_1 = (data.get("class_1") or "").strip()
        subject = (data.get("subject") or "").strip()
        mode = (data.get("mode") or "").strip().lower()

        if not (board and class_1 and subject):
            self._respond_json(400, {"error": "board, class_1 and subject are all required."})
            return

        if mode not in VALID_MODES:
            self._respond_json(400, {"error": "Please choose whether you want Exam Preparation or Concept Understanding."})
            return

        sys_msg = SystemMessage(content=build_system_prompt(board, class_1, subject, mode))
        created = now_iso()

        username = session["username"]
        conversations[username] = {
            "id": uuid.uuid4().hex,
            "board": board,
            "class_1": class_1,
            "subject": subject,
            "mode": mode,
            "created_at": created,
            "messages": [sys_msg],
            "transcript": [],
        }
        persist_active_chat(username, conversations[username])

        self._respond_json(200, {
            "status": "ok",
            "id": conversations[username]["id"],
            "board": board,
            "class_1": class_1,
            "subject": subject,
            "mode": mode,
            "created_at": created,
            "usage": usage_payload(username, session["role"]),
        })

    def _handle_chat(self, data):
        session = self._require_auth()
        if not session:
            return

        username = session["username"]
        conversation = conversations.get(username)
        if not conversation or not conversation.get("messages"):
            self._respond_json(400, {"error": "Session not initialized. Call /init first."})
            return

        if session["role"] != "admin":
            user = find_user(username)
            if user and user.get("tokens_used", 0) >= user.get("token_limit", DEFAULT_TOKEN_LIMIT):
                self._respond_json(402, {
                    "error": "PAYMENT_REQUIRED",
                    "message": (
                        "You've used up your free token allowance for Study Buddy. "
                        "Please contact the admin to top up your access or arrange additional payment."
                    ),
                    "usage": usage_payload(username, session["role"]),
                })
                return

        question = (data.get("question") or "").strip()
        image = data.get("image") or {}
        image_data = (image.get("data") or "").strip() if isinstance(image, dict) else ""
        image_type = (image.get("type") or "").strip().lower() if isinstance(image, dict) else ""

        if not question and not image_data:
            self._respond_json(400, {"error": "Question is empty. Type a question or upload an image."})
            return

        if image_data:
            human_content, image_error = build_image_content(question, image_data, image_type)
            if image_error:
                self._respond_json(400, {"error": image_error})
                return
            conversation["messages"].append(HumanMessage(content=human_content))
            user_text = question or "Help me with this image."
            image_url = human_content[1]["image_url"]["url"]
            conversation.setdefault("transcript", []).append({
                "role": "user",
                "text": user_text,
                "image": image_url,
            })
        else:
            conversation["messages"].append(HumanMessage(content=question))
            conversation.setdefault("transcript", []).append({
                "role": "user",
                "text": question,
                "image": None,
            })

        try:
            ai_message = llm.invoke(conversation["messages"])
        except Exception as exc:
            conversation["messages"].pop()
            conversation["transcript"].pop()
            self._respond_json(500, {"error": f"LLM call failed: {exc}"})
            return

        answer_text = self._message_text(ai_message)
        conversation["messages"].append(AIMessage(content=answer_text))
        conversation["transcript"].append({
            "role": "bot",
            "text": answer_text,
            "image": None,
        })
        persist_active_chat(username, conversation)

        if session["role"] != "admin":
            add_user_tokens(username, self._extract_token_count(ai_message, question, answer_text))

        self._respond_json(200, {
            "answer": answer_text,
            "usage": usage_payload(username, session["role"]),
        })

    def _extract_token_count(self, ai_message, question, answer_text):
        """Prefer the real usage reported by Gemini; fall back to a rough estimate."""
        usage = getattr(ai_message, "usage_metadata", None)
        if isinstance(usage, dict) and usage.get("total_tokens"):
            return int(usage["total_tokens"])

        response_metadata = getattr(ai_message, "response_metadata", None) or {}
        usage_meta = response_metadata.get("usage_metadata") if isinstance(response_metadata, dict) else None
        if isinstance(usage_meta, dict):
            total = usage_meta.get("total_token_count") or usage_meta.get("total_tokens")
            if total:
                return int(total)

        # Rough fallback estimate: ~4 characters per token.
        return max(1, (len(question or "") + len(answer_text or "")) // 4)

    def _handle_list_chats(self):
        session = self._require_auth()
        if not session:
            return

        chats = [chat_summary(chat) for chat in load_user_chats(session["username"])]
        chats.sort(key=lambda item: item.get("updated_at") or "", reverse=True)
        self._respond_json(200, {"chats": chats})

    def _handle_export_chats(self, chat_id=None):
        session = self._require_auth()
        if not session:
            return

        if build_chats_pdf is None:
            self._respond_json(500, {
                "error": "PDF export is not set up on the server. Run: pip install reportlab"
            })
            return

        username = session["username"]
        chats = [c for c in load_user_chats(username) if c.get("messages")]

        if chat_id:
            # Download-this-chat button: only export the one chat the user is viewing.
            chats = [c for c in chats if c.get("id") == chat_id]
            if not chats:
                self._respond_json(404, {"error": "Chat not found."})
                return
        elif not chats:
            self._respond_json(404, {"error": "No saved chats to download yet."})
            return

        chats.sort(key=lambda c: c.get("created_at") or "")

        try:
            pdf_bytes = build_chats_pdf(username, chats)
        except Exception as exc:
            self._respond_json(500, {"error": f"Could not create the PDF: {exc}"})
            return

        if chat_id:
            subject = safe_username(chats[0].get("subject") or "chat")
            filename = f"study-buddy-{subject}-{datetime.now().strftime('%Y-%m-%d')}.pdf"
        else:
            filename = f"study-buddy-chats-{safe_username(username)}-{datetime.now().strftime('%Y-%m-%d')}.pdf"
        self.send_response(200)
        self.send_header("Content-Type", "application/pdf")
        self.send_header("Content-Length", str(len(pdf_bytes)))
        self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
        self.send_header("Cache-Control", "no-store")
        self.end_headers()
        self.wfile.write(pdf_bytes)

    def _handle_resume_chat(self, data):
        session = self._require_auth()
        if not session:
            return

        chat_id = (data.get("id") or "").strip()
        if not chat_id:
            self._respond_json(400, {"error": "Chat id is required."})
            return

        username = session["username"]
        chat = find_saved_chat(username, chat_id)
        if not chat:
            self._respond_json(404, {"error": "Chat not found."})
            return

        conversations[username] = {
            "id": chat["id"],
            "board": chat.get("board", ""),
            "class_1": chat.get("class_1", ""),
            "subject": chat.get("subject", ""),
            "mode": chat.get("mode") or MODE_CONCEPT,
            "created_at": chat.get("created_at") or now_iso(),
            "messages": build_langchain_messages(chat),
            "transcript": list(chat.get("messages") or []),
        }
        self._respond_json(200, public_chat(chat))

    def _handle_delete_chat(self):
        session = self._require_auth()
        if not session:
            return

        data = self._read_json()
        if data is None:
            self._respond_json(400, {"error": "Invalid JSON in request body."})
            return

        chat_id = (data.get("id") or "").strip()
        if not chat_id:
            self._respond_json(400, {"error": "Chat id is required."})
            return

        username = session["username"]
        if not delete_saved_chat(username, chat_id):
            self._respond_json(404, {"error": "Chat not found."})
            return

        active = conversations.get(username)
        if active and active.get("id") == chat_id:
            conversations.pop(username, None)

        self._respond_json(200, {"status": "ok"})

    def _message_text(self, ai_message):
        if isinstance(ai_message, str):
            return ai_message
        content = getattr(ai_message, "content", None)
        if isinstance(content, str):
            return content
        if isinstance(content, list):
            parts = []
            for part in content:
                if isinstance(part, str):
                    parts.append(part)
                elif isinstance(part, dict) and part.get("text"):
                    parts.append(part["text"])
            return "\n".join(p for p in parts if p).strip() or str(ai_message)
        return str(ai_message)

    def _serve_static(self, path):
        if path == "/":
            path = "/index.html"

        safe_path = path.lstrip("/")
        file_path = (BASE_DIR / safe_path).resolve()

        if not str(file_path).startswith(str(BASE_DIR)):
            self.send_error(403)
            return

        blocked = {USERS_FILE.resolve(), Path(os.getenv("DOTENV_PATH") or BASE_DIR / ".env").resolve()}
        if file_path in blocked or HISTORY_DIR.resolve() in file_path.parents or file_path == HISTORY_DIR.resolve():
            self.send_error(403)
            return

        if not file_path.is_file():
            self.send_error(404)
            return

        content_type, _ = mimetypes.guess_type(str(file_path))
        content_type = content_type or "application/octet-stream"

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        self.end_headers()
        with open(file_path, "rb") as f:
            self.wfile.write(f.read())

    def log_message(self, format, *args):
        print("[server]", format % args)


def run():
    port = int(os.environ.get("PORT", 8000))
    host = "0.0.0.0"
    server = HTTPServer((host, port), Handler)
    print(f"Server running on {host}:{port}  (Ctrl+C to stop)")
    print(f"Admin login: {ADMIN_USERNAME} / (password from environment)")
    server.serve_forever()


if __name__ == "__main__":
    run()