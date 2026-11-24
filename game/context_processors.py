"""Template context shared by every page."""
from pathlib import Path

from django.conf import settings

_STATIC = Path(settings.BASE_DIR) / "static"


def asset_version(request):
    """Cache-busting token for CSS/JS URLs (?v=...): the newest modification time of any static
    file, so browsers always fetch the current scripts after the project is updated."""
    try:
        v = max(int(p.stat().st_mtime) for p in _STATIC.rglob("*") if p.is_file())
    except ValueError:
        v = 0
    return {"asset_v": v}
