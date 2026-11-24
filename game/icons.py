"""Line icons (Lucide, ISC licence: static/icons/LICENSE-lucide.txt) used instead of emojis.

The SVG files live in static/icons/. ``svg(name)`` returns inline SVG markup that inherits the
text colour (stroke="currentColor"), so icons match buttons, headings and badges."""
import re
from functools import lru_cache
from pathlib import Path

from django.conf import settings
from django.utils.safestring import mark_safe

ICON_DIR = Path(settings.BASE_DIR) / "static" / "icons"


@lru_cache(maxsize=None)
def inner(name):
    """The drawing elements of one icon (everything inside <svg>)."""
    path = ICON_DIR / f"{name}.svg"
    if not path.exists():
        return ""
    text = path.read_text(encoding="utf8")
    body = re.search(r"<svg[^>]*>(.*)</svg>", text, re.S)
    return re.sub(r"\s+", " ", body.group(1)).strip() if body else ""


def svg(name, cls=""):
    return mark_safe(
        f'<svg class="ic {cls}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" '
        f'stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">{inner(name)}</svg>')


def all_icons():
    return {p.stem: inner(p.stem) for p in sorted(ICON_DIR.glob("*.svg"))}
