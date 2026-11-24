#!/bin/bash
# DEScape: one-command setup on PythonAnywhere.
# Run it in a PythonAnywhere Bash console, from your home folder:
#     bash DEScape/deploy/setup_pythonanywhere.sh
# Safe to run again after uploading a newer zip (your players' accounts are kept).
set -e

PY=python3.12
APP_DIR="$(cd "$(dirname "$0")/.." && pwd)"
cd "$APP_DIR"

echo "== 1/5  Checking Python 3.12"
command -v $PY >/dev/null || { echo "ERROR: $PY not found. Tell Claude."; exit 1; }

echo "== 2/5  Installing Django and WhiteNoise (takes about a minute)"
$PY -m pip install --user --quiet "Django>=5.2,<7" "whitenoise>=6.6"

export DJANGO_DEBUG=0 DJANGO_SQLITE_WAL=0

echo "== 3/5  Creating / updating the database"
$PY manage.py migrate --noinput

echo "== 4/5  Collecting CSS, JavaScript and images"
$PY manage.py collectstatic --noinput --clear >/dev/null

echo "== 5/5  Writing the web app configuration (WSGI file)"
WSGI_FILES=(/var/www/*_wsgi.py)
if [ ! -e "${WSGI_FILES[0]}" ]; then
  echo "ERROR: no web app found. Create it first on the Web tab (Manual configuration, Python 3.12), then run this again."
  exit 1
fi
if [ ${#WSGI_FILES[@]} -ne 1 ]; then
  echo "ERROR: more than one web app found (${WSGI_FILES[*]}). Tell Claude."
  exit 1
fi
cat > "${WSGI_FILES[0]}" <<WSGI
# Written by DEScape/deploy/setup_pythonanywhere.sh
import os
import sys

path = "$APP_DIR"
if path not in sys.path:
    sys.path.insert(0, path)

os.environ["DJANGO_SETTINGS_MODULE"] = "cipherbreak.settings"
os.environ["DJANGO_DEBUG"] = "0"
os.environ["DJANGO_SQLITE_WAL"] = "0"

from django.core.wsgi import get_wsgi_application
application = get_wsgi_application()
WSGI

SITE="$(basename "${WSGI_FILES[0]}" _wsgi.py | sed 's/_/./g')"
echo
echo "ALL DONE. Now go to the Web tab, press the green Reload button, then open:"
echo "    https://$SITE"
