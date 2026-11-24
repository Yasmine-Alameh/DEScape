"""
Django settings for CipherBreak EDU.

Local demonstration defaults. For hosting (see deploy/PYTHONANYWHERE.md) set
DJANGO_DEBUG=0; DJANGO_SECRET_KEY and DJANGO_ALLOWED_HOSTS are optional.
"""
import importlib.util
import os
import secrets
from pathlib import Path

BASE_DIR = Path(__file__).resolve().parent.parent

DEBUG = os.environ.get("DJANGO_DEBUG", "1") == "1"


def _secret_key():
    env = os.environ.get("DJANGO_SECRET_KEY")
    if env:
        return env
    # No environment variable: generate a random key once and keep it in a file that is
    # never shipped in the zip or committed (works locally and on PythonAnywhere).
    path = BASE_DIR / ".dev_secret_key"
    if not path.exists():
        path.write_text(secrets.token_urlsafe(50))
    return path.read_text().strip()


SECRET_KEY = _secret_key()
ALLOWED_HOSTS = os.environ.get("DJANGO_ALLOWED_HOSTS", "localhost,127.0.0.1,testserver,.onrender.com,.pythonanywhere.com").split(",")

INSTALLED_APPS = [
    "django.contrib.admin",
    "django.contrib.auth",
    "django.contrib.contenttypes",
    "django.contrib.sessions",
    "django.contrib.messages",
    "django.contrib.staticfiles",
    "accounts",
    "game",
    "lab",
]

MIDDLEWARE = [
    "django.middleware.security.SecurityMiddleware",
    # WhiteNoise (only if installed, e.g. on PythonAnywhere) serves CSS/JS/images when DEBUG is off.
    *(["whitenoise.middleware.WhiteNoiseMiddleware"] if importlib.util.find_spec("whitenoise") else []),
    "django.contrib.sessions.middleware.SessionMiddleware",
    "django.middleware.common.CommonMiddleware",
    "django.middleware.csrf.CsrfViewMiddleware",
    "django.contrib.auth.middleware.AuthenticationMiddleware",
    "django.contrib.messages.middleware.MessageMiddleware",
    "django.middleware.clickjacking.XFrameOptionsMiddleware",
]

ROOT_URLCONF = "cipherbreak.urls"

TEMPLATES = [
    {
        "BACKEND": "django.template.backends.django.DjangoTemplates",
        "DIRS": [BASE_DIR / "templates"],
        "APP_DIRS": True,
        "OPTIONS": {
            "context_processors": [
                "django.template.context_processors.request",
                "django.contrib.auth.context_processors.auth",
                "django.contrib.messages.context_processors.messages",
                "game.context_processors.asset_version",
            ],
        },
    },
]

WSGI_APPLICATION = "cipherbreak.wsgi.application"

DATABASES = {
    "default": {
        "ENGINE": "django.db.backends.sqlite3",
        "NAME": BASE_DIR / "db.sqlite3",
        # Concurrent game requests: wait for locks instead of failing, use WAL journaling.
        # WAL journaling is turned off on hosts whose disk is a network filesystem (PythonAnywhere),
        # where SQLite's WAL mode is not supported: set DJANGO_SQLITE_WAL=0 there.
        "OPTIONS": {"timeout": 20, "transaction_mode": "IMMEDIATE",
                    "init_command": ("PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL;"
                                     if os.environ.get("DJANGO_SQLITE_WAL", "1") == "1"
                                     else "PRAGMA journal_mode=DELETE;")},
    }
}

AUTH_PASSWORD_VALIDATORS = [
    {"NAME": "django.contrib.auth.password_validation.UserAttributeSimilarityValidator"},
    {"NAME": "django.contrib.auth.password_validation.MinimumLengthValidator"},
    {"NAME": "django.contrib.auth.password_validation.CommonPasswordValidator"},
    {"NAME": "django.contrib.auth.password_validation.NumericPasswordValidator"},
]

LANGUAGE_CODE = "en-us"
TIME_ZONE = "Asia/Beirut"
USE_I18N = True
USE_TZ = True

STATIC_URL = "static/"
# Hosted on Render (render.yaml): a PostgreSQL database instead of SQLite, because Render's free
# servers wipe their disk on every restart. Locally DATABASE_URL is not set, so SQLite is used.
if os.environ.get("DATABASE_URL"):
    import dj_database_url
    DATABASES = {"default": dj_database_url.parse(os.environ["DATABASE_URL"], conn_max_age=600)}

# Render terminates HTTPS in front of the app; trust its forwarded-protocol header there only.
if os.environ.get("RENDER"):
    SECURE_PROXY_SSL_HEADER = ("HTTP_X_FORWARDED_PROTO", "https")
    CSRF_TRUSTED_ORIGINS = ["https://*.onrender.com"]

STATICFILES_DIRS = [BASE_DIR / "static"]
STATIC_ROOT = BASE_DIR / "staticfiles"  # filled by "manage.py collectstatic" for hosting
DEFAULT_AUTO_FIELD = "django.db.models.BigAutoField"

LOGIN_URL = "login"
LOGIN_REDIRECT_URL = "dashboard"
LOGOUT_REDIRECT_URL = "landing"

# Email: for the local demo, password-reset emails are printed in the terminal running the server.
# For a real deployment set EMAIL_BACKEND/EMAIL_HOST etc. via environment variables.
EMAIL_BACKEND = os.environ.get("DJANGO_EMAIL_BACKEND", "django.core.mail.backends.console.EmailBackend")
DEFAULT_FROM_EMAIL = os.environ.get("DJANGO_DEFAULT_FROM_EMAIL", "CipherBreak EDU <no-reply@cipherbreak.local>")
EMAIL_HOST = os.environ.get("DJANGO_EMAIL_HOST", "localhost")

SESSION_COOKIE_HTTPONLY = True
CSRF_COOKIE_HTTPONLY = False  # the game's fetch() calls read the token from the page
X_FRAME_OPTIONS = "SAMEORIGIN"  # notebook opens in an in-game iframe
if not DEBUG:
    SESSION_COOKIE_SECURE = True
    CSRF_COOKIE_SECURE = True
