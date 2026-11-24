"""Regenerate static/js/icons.js from static/icons/*.svg (Lucide, ISC licence).
Run from the project root:  python tools/build_icons_js.py"""
import json
import re
from pathlib import Path

root = Path(__file__).resolve().parent.parent
icons = {}
for p in sorted((root / "static" / "icons").glob("*.svg")):
    m = re.search(r"<svg[^>]*>(.*)</svg>", p.read_text(), re.S)
    icons[p.stem] = " ".join(m.group(1).split())
body = ",\n".join(f"{json.dumps(k)}: {json.dumps(v)}" for k, v in icons.items())
js = ('/* Generated from static/icons/*.svg (Lucide, ISC licence). CB.icon(name) returns an inline SVG line icon. */\n'
      "(function () {\n  const I = {\n" + body + "\n};\n"
      "  window.CB = window.CB || {};\n"
      '  window.CB.icon = (name, cls) => `<svg class="ic ${cls || ""}" viewBox="0 0 24 24" fill="none" stroke="currentColor" '
      'stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false">${I[name] || ""}</svg>`;\n'
      "})();\n")
(root / "static" / "js" / "icons.js").write_text(js)
print(len(icons), "icons")
