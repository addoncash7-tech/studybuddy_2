"""
Builds a PDF containing all of a user's saved Study Buddy chats.

Requires:  pip install reportlab
(Pillow is installed automatically with reportlab and is used for images.)

Fonts: reportlab's built-in fonts only cover basic Latin characters, so this
module looks for a Unicode TrueType font (so symbols like ->, degrees, pi, sqrt
render correctly). It checks, in order:
  1. a  fonts/  folder next to this file (DejaVuSans.ttf + DejaVuSans-Bold.ttf, ...)
  2. common system fonts on Windows, macOS and Linux
and falls back to Helvetica if none are found. Emoji are not supported by any
of these fonts, so they are removed from the PDF text.
"""

import base64
import io
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from xml.sax.saxutils import escape

from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle
from reportlab.lib.units import cm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    Image,
    KeepTogether,
    PageBreak,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
)

try:
    from PIL import Image as PILImage
except ImportError:  # Pillow missing: chat images are skipped
    PILImage = None

BASE_DIR = Path(__file__).resolve().parent

# (regular, bold, italic, bold-italic) - first complete set found wins.
FONT_SETS = [
    [BASE_DIR / "fonts" / n for n in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf")],
    [Path("C:/Windows/Fonts") / n for n in ("arial.ttf", "arialbd.ttf", "ariali.ttf", "arialbi.ttf")],
    [Path("/System/Library/Fonts/Supplemental") / n for n in ("Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf", "Arial Bold Italic.ttf")],
    [Path("/Library/Fonts") / n for n in ("Arial.ttf", "Arial Bold.ttf", "Arial Italic.ttf", "Arial Bold Italic.ttf")],
    [Path("/usr/share/fonts/truetype/dejavu") / n for n in ("DejaVuSans.ttf", "DejaVuSans-Bold.ttf", "DejaVuSans-Oblique.ttf", "DejaVuSans-BoldOblique.ttf")],
    [Path("/usr/share/fonts/truetype/liberation") / n for n in ("LiberationSans-Regular.ttf", "LiberationSans-Bold.ttf", "LiberationSans-Italic.ttf", "LiberationSans-BoldItalic.ttf")],
]

ACCENT = colors.HexColor("#6c7ae0")
DARK = colors.HexColor("#2b2f66")
MUTED = colors.HexColor("#777777")
CODE_BG = colors.HexColor("#f0f1fa")

_font_cache = {}


def _register_fonts():
    """Return (font_name, glyph_lookup_or_None). Cached after the first call."""
    if _font_cache:
        return _font_cache["name"], _font_cache["glyphs"]

    for paths in FONT_SETS:
        if not all(p.is_file() for p in paths):
            continue
        try:
            names = ("SB-Regular", "SB-Bold", "SB-Italic", "SB-BoldItalic")
            for name, path in zip(names, paths):
                pdfmetrics.registerFont(TTFont(name, str(path)))
            pdfmetrics.registerFontFamily(
                "SB", normal=names[0], bold=names[1], italic=names[2], boldItalic=names[3]
            )
            glyphs = pdfmetrics.getFont(names[0]).face.charToGlyph
            _font_cache.update(name="SB-Regular", glyphs=glyphs)
            return _font_cache["name"], glyphs
        except Exception:
            continue

    _font_cache.update(name="Helvetica", glyphs=None)
    return "Helvetica", None


# Used only when the font cannot draw a character: keeps maths/science readable.
_SUBSTITUTIONS = {
    "\u2192": "->", "\u2190": "<-", "\u2194": "<->", "\u21d2": "=>", "\u21d4": "<=>",
    "\u221a": "sqrt", "\u221e": "inf", "\u2248": "~=", "\u2260": "!=", "\u2264": "<=", "\u2265": ">=",
    "\u2212": "-", "\u2022": "*", "\u2713": "[x]", "\u2714": "[x]", "\u2717": "[ ]", "\u2718": "[ ]",
    "\u03c0": "pi", "\u0394": "Delta", "\u03bb": "lambda", "\u03b1": "alpha", "\u03b2": "beta",
    "\u03b8": "theta", "\u03bc": "mu", "\u03c9": "omega", "\u03a9": "Ohm", "\u2211": "sum",
    "\u2018": "'", "\u2019": "'", "\u201c": '"', "\u201d": '"', "\u2013": "-", "\u2014": "-",
}


def _make_cleaner(glyphs):
    """Return a function that drops/replaces characters the chosen font cannot draw."""
    def can_draw(ch):
        if ord(ch) < 32:
            return False
        if glyphs is not None:
            # reportlab TrueType fonts only handle the Basic Multilingual Plane.
            return ord(ch) <= 0xFFFF and ord(ch) in glyphs
        try:
            ch.encode("cp1252")
            return True
        except UnicodeEncodeError:
            return False

    def substitute(ch):
        if ch in _SUBSTITUTIONS:
            return _SUBSTITUTIONS[ch]
        decomposed = unicodedata.normalize("NFKD", ch)  # e.g. subscript 2 -> 2
        return decomposed if decomposed != ch else ""

    def clean(text):
        text = (text or "").replace("\r\n", "\n").replace("\r", "\n").replace("\t", "    ")
        out = []
        for ch in text:
            if ch == "\n" or can_draw(ch):
                out.append(ch)
            else:
                out.extend(c for c in substitute(ch) if can_draw(c))
        return "".join(out)
    return clean


def _clean_code(text):
    """Code blocks use Courier (Latin-1 range only)."""
    out = []
    for ch in (text or "").replace("\r\n", "\n").replace("\t", "    "):
        try:
            ch.encode("cp1252")
            out.append(ch)
        except UnicodeEncodeError:
            out.append("?")
    return "".join(out)


def _styles(font):
    bold = "SB-Bold" if font == "SB-Regular" else "Helvetica-Bold"
    base = ParagraphStyle("base", fontName=font, fontSize=10, leading=14, textColor=colors.HexColor("#222222"), alignment=TA_LEFT)
    return {
        "title": ParagraphStyle("title", parent=base, fontName=bold, fontSize=22, leading=27, textColor=DARK, spaceAfter=4),
        "subtitle": ParagraphStyle("subtitle", parent=base, fontSize=10, textColor=MUTED, spaceAfter=14),
        "chat_title": ParagraphStyle("chat_title", parent=base, fontName=bold, fontSize=15, leading=19, textColor=DARK, spaceBefore=4, spaceAfter=2),
        "chat_meta": ParagraphStyle("chat_meta", parent=base, fontSize=9, textColor=MUTED, spaceAfter=10),
        "role_user": ParagraphStyle("role_user", parent=base, fontName=bold, fontSize=9, textColor=ACCENT, spaceBefore=8, spaceAfter=2, keepWithNext=1),
        "role_bot": ParagraphStyle("role_bot", parent=base, fontName=bold, fontSize=9, textColor=DARK, spaceBefore=8, spaceAfter=2, keepWithNext=1),
        "body": ParagraphStyle("body", parent=base, spaceAfter=4),
        "h": ParagraphStyle("h", parent=base, fontName=bold, fontSize=11.5, leading=15, textColor=DARK, spaceBefore=4, spaceAfter=3),
        "bullet": ParagraphStyle("bullet", parent=base, leftIndent=16, bulletIndent=4, spaceAfter=2),
        "code": ParagraphStyle("code", parent=base, fontName="Courier", fontSize=8.5, leading=11, backColor=CODE_BG, borderPadding=5, spaceBefore=4, spaceAfter=8, wordWrap="CJK"),
        "note": ParagraphStyle("note", parent=base, fontSize=9, textColor=MUTED),
    }


# ---------------------------------------------------------------- markdown --

def _inline(text, clean):
    """Convert a line of light markdown into reportlab paragraph markup."""
    text = clean(text)
    parts = re.split(r"(`[^`\n]+`)", text)
    out = []
    for part in parts:
        if len(part) > 2 and part.startswith("`") and part.endswith("`"):
            out.append('<font face="Courier" backColor="#eceef8">%s</font>' % escape(_clean_code(part[1:-1])))
            continue
        part = escape(part)
        part = re.sub(r"\*\*(.+?)\*\*", r"<b>\1</b>", part)
        part = re.sub(r"__(.+?)__", r"<b>\1</b>", part)
        part = re.sub(r"(?<![*\w])\*(?!\s)([^*\n]+?)(?<!\s)\*(?![*\w])", r"<i>\1</i>", part)
        out.append(part)
    return "".join(out)


def _paragraph(markup, plain, style, **kwargs):
    """Build a Paragraph; fall back to plain text if the markup is malformed."""
    try:
        return Paragraph(markup, style, **kwargs)
    except Exception:
        return Paragraph(escape(plain), style, **kwargs)


def _markdown_flowables(text, styles, clean):
    flow = []
    para_markup, para_plain = [], []
    code_lines = None

    def flush_para():
        if para_markup:
            flow.append(_paragraph("<br/>".join(para_markup), " ".join(para_plain), styles["body"]))
            para_markup.clear()
            para_plain.clear()

    for raw in (text or "").replace("\r\n", "\n").split("\n"):
        line = raw.rstrip()

        if line.strip().startswith("```"):
            if code_lines is None:
                flush_para()
                code_lines = []
            else:
                body = "<br/>".join(
                    re.sub(r"^ +", lambda m: "&nbsp;" * len(m.group(0)), escape(_clean_code(l)))
                    for l in code_lines
                ) or "&nbsp;"
                flow.append(Paragraph(body, styles["code"]))
                code_lines = None
            continue
        if code_lines is not None:
            code_lines.append(line)
            continue

        if not line.strip():
            flush_para()
            continue

        heading = re.match(r"^\s*#{1,6}\s+(.+)$", line)
        if heading:
            flush_para()
            plain = clean(heading.group(1))
            flow.append(_paragraph("<b>%s</b>" % _inline(heading.group(1), clean), plain, styles["h"]))
            continue

        bullet = re.match(r"^(\s*)[-*\u2022]\s+(.+)$", line)
        numbered = re.match(r"^(\s*)(\d+)[.)]\s+(.+)$", line)
        if bullet or numbered:
            flush_para()
            if bullet:
                indent, marker, content = bullet.group(1), "\u2022", bullet.group(2)
            else:
                indent, marker, content = numbered.group(1), numbered.group(2) + ".", numbered.group(3)
            style = ParagraphStyle(
                "bullet_lvl", parent=styles["bullet"],
                leftIndent=16 + 14 * min(len(indent) // 2, 3),
                bulletIndent=4 + 14 * min(len(indent) // 2, 3),
            )
            flow.append(_paragraph(_inline(content, clean), clean(content), style, bulletText=clean(marker) or "-"))
            continue

        para_markup.append(_inline(line, clean))
        para_plain.append(clean(line))

    if code_lines is not None:  # unclosed fence
        flow.append(Paragraph("<br/>".join(escape(_clean_code(l)) for l in code_lines) or "&nbsp;", styles["code"]))
    flush_para()
    return flow


# ------------------------------------------------------------------ images --

def _image_flowable(data_url, max_width, max_height=7.5 * cm):
    """Turn a data: URL into a scaled reportlab Image (or None on failure)."""
    if not data_url or PILImage is None or "," not in data_url:
        return None
    try:
        raw = base64.b64decode(data_url.split(",", 1)[1] + "===")
        img = PILImage.open(io.BytesIO(raw))
        img.load()
        if img.mode not in ("RGB", "L"):
            background = PILImage.new("RGB", img.size, (255, 255, 255))
            rgba = img.convert("RGBA")
            background.paste(rgba, mask=rgba.split()[3])
            img = background
        buf = io.BytesIO()
        img.save(buf, format="JPEG", quality=85)
        buf.seek(0)
        width, height = img.size
        scale = min(max_width / width, max_height / height, 1.0)
        flowable = Image(buf, width=width * scale, height=height * scale)
        flowable.hAlign = "LEFT"
        return flowable
    except Exception:
        return None


# ---------------------------------------------------------------- document --

def _format_dt(iso):
    if not iso:
        return ""
    try:
        return datetime.fromisoformat(iso).strftime("%d %b %Y, %H:%M UTC")
    except ValueError:
        return ""


def build_chats_pdf(username, chats):
    print("----------------------------------")
    """
    Return PDF bytes for `chats` (a list of saved chat dicts, oldest first).
    Each chat has: board, class_1, subject, created_at, messages[{role,text,image}].
    """
    font, glyphs = _register_fonts()
    clean = _make_cleaner(glyphs)
    styles = _styles(font)

    buffer = io.BytesIO()
    doc = SimpleDocTemplate(
        buffer,
        pagesize=A4,
        leftMargin=2 * cm,
        rightMargin=2 * cm,
        topMargin=2 * cm,
        bottomMargin=2 * cm,
        title="Study Buddy - Chat History",
        author="Study Buddy",
    )
    frame_width = A4[0] - 4 * cm

    def draw_footer(canvas, _doc):
        canvas.saveState()
        canvas.setFont(font, 8)
        canvas.setFillColor(MUTED)
        canvas.drawString(2 * cm, 1.1 * cm, clean("Study Buddy chat history - %s" % username))
        canvas.drawRightString(A4[0] - 2 * cm, 1.1 * cm, "Page %d" % canvas.getPageNumber())
        canvas.restoreState()

    story = [
        Paragraph("Study Buddy - Chat History", styles["title"]),
        Paragraph(
            escape(clean("%s  |  %d chat%s  |  Generated %s" % (
                username, len(chats), "" if len(chats) == 1 else "s",
                datetime.now(timezone.utc).strftime("%d %b %Y, %H:%M UTC"),
            ))),
            styles["subtitle"],
        ),
    ]

    for index, chat in enumerate(chats, start=1):
        if index > 1:
            story.append(PageBreak())

        subject = clean(chat.get("subject") or "Study chat")
        story.append(Paragraph(escape("Chat %d: %s" % (index, subject)), styles["chat_title"]))
        mode_label = {"exam": "Exam Preparation", "concept": "Concept Understanding"}.get(chat.get("mode"), "")
        meta = [
            clean(chat.get("board") or ""),
            "Class %s" % clean(chat["class_1"]) if chat.get("class_1") else "",
            mode_label,
            "Started %s" % _format_dt(chat.get("created_at")) if chat.get("created_at") else "",
        ]
        story.append(Paragraph(escape("  |  ".join(m for m in meta if m)), styles["chat_meta"]))

        for item in chat.get("messages") or []:
            role = item.get("role")
            if role not in ("user", "bot"):
                continue
            label = "You" if role == "user" else "Study Buddy"
            label_flow = Paragraph(label, styles["role_user" if role == "user" else "role_bot"])

            block = [label_flow]
            picture = _image_flowable(item.get("image"), frame_width * 0.6)
            if picture is not None:
                block.append(picture)
                block.append(Spacer(1, 4))
            elif item.get("image"):
                block.append(Paragraph("[image could not be included]", styles["note"]))

            text = item.get("text") or ""
            if role == "bot":
                body = _markdown_flowables(text, styles, clean)
            else:
                cleaned = clean(text)
                body = [
                    _paragraph("<br/>".join(escape(l) for l in cleaned.split("\n")), cleaned, styles["body"])
                ] if cleaned.strip() else []

            # Keep the label with the start of its message (never orphaned).
            if body:
                story.append(KeepTogether(block + body[:1]))
                story.extend(body[1:])
            else:
                story.append(KeepTogether(block))

    doc.build(story, onFirstPage=draw_footer, onLaterPages=draw_footer)
    return buffer.getvalue()
