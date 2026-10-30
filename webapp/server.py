#!/usr/bin/env python3
"""
Eurario - Backend Server & REST API
Basato sulla libreria standard di Python (Zero dipendenze esterne).
Compatibile con macOS (Safari & Chrome), Linux e Windows.
"""

import os
import sys
import re
import io
import copy
import json
import time
import glob
import signal
import shutil
import base64
import mimetypes
import threading
import subprocess
import platform
import urllib.request
import urllib.error
import datetime
from urllib.parse import urlparse, unquote, parse_qs
from http.server import HTTPServer, BaseHTTPRequestHandler
from socketserver import ThreadingMixIn

# Assicura che la root del progetto sia nel PYTHONPATH
BASE_DIR = os.path.dirname(os.path.abspath(__file__))
ROOT_DIR = os.path.dirname(BASE_DIR)
if ROOT_DIR not in sys.path:
    sys.path.insert(0, ROOT_DIR)

from webapp.database import (
    db,
    parse_organico_docx_content,
    get_db,
    set_current_school_id,
    get_current_school_id,
    ConcurrentModificationError,
    set_request_context,
    clear_request_context
)
from webapp.schools import school_manager
from webapp.fet_engine import generate_fet_xml
from webapp.auth import auth_manager, get_local_now, SERVER_TZ_NAME, AuthLockoutError
from webapp.validator import TimetablePreValidator
from webapp.advisor import TimetableAdvisor
from webapp.print_engine import (
    get_print_options_metadata,
    generate_classes_print_html,
    generate_teachers_master_print_html,
    generate_teachers_master_docx,
    generate_organico_template_docx
)
from webapp import updater


def fetch_google_doc_docx_bytes(url):
    """
    Scarica l'export .docx di un documento Google Doc tramite link di condivisione.
    Supporta qualsiasi link Google Doc (anche con /u/0/, /edit, /view, etc.)
    """
    m = re.search(r"/d/([a-zA-Z0-9_-]+)", url)
    if not m:
        raise ValueError("URL di Google Doc non valido. Il link deve contenere l'ID del documento (es. /d/<ID_DOCUMENTO>/...).")
    
    doc_id = m.group(1)
    export_url = f"https://docs.google.com/document/d/{doc_id}/export?format=docx"
    req = urllib.request.Request(
        export_url,
        headers={
            "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36"
        }
    )
    try:
        with urllib.request.urlopen(req, timeout=20) as resp:
            content_type = resp.headers.get("Content-Type", "")
            data = resp.read()
            if b"<html" in data[:500].lower() or "html" in content_type.lower():
                raise ValueError(
                    "Il documento Google Doc sembra privato o protetto da login.\n"
                    "Verifica che la condivisione sia impostata su 'Chiunque abbia il link può visualizzare',\n"
                    "oppure scarica il file in formato .docx sul tuo computer e caricalo direttamente nella web app."
                )
            return data
    except urllib.error.HTTPError as e:
        if e.code in (401, 403, 404):
            raise ValueError(
                f"Errore di accesso al Google Doc (Codice {e.code}).\n"
                "Assicurati che il file esista e che la condivisione sia impostata su 'Chiunque abbia il link può visualizzare',\n"
                "oppure scarica il file in formato .docx sul tuo computer e caricalo qui."
            )
        raise ValueError(f"Errore HTTP durante il download del Google Doc: {e}")
    except Exception as e:
        raise ValueError(f"Impossibile scaricare il Google Doc: {e}")

APP_VERSION = "1.9.27"
FET_VERSION = "7.12.0"
APP_AUTHOR = "Carlo Rigoni"
APP_MENTOR = "Federico Rettore"
APP_CREDITS = "Autore: Carlo Rigoni • Mentore dell'Orario: Federico Rettore • FET Free Software (Liviu Lalescu) • Google DeepMind Antigravity"

HOST = os.environ.get("HOST", "0.0.0.0")
PORT = int(os.environ.get("PORT", "8000"))
STATIC_DIR = os.path.join(BASE_DIR, "static")
DATA_DIR = os.path.join(BASE_DIR, "data")
SOLVER_DIR = os.path.join(DATA_DIR, "solver_run")
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")

# Gestione Multi-Tenant del Solver FET (parallelismo per istituto)
_solver_states = {}
_solver_locks = {}
_solver_registry_lock = threading.RLock()

def get_solver_state(school_id="default"):
    sid = str(school_id or "default").strip() or "default"
    with _solver_registry_lock:
        if sid not in _solver_states:
            _solver_states[sid] = {
                "running": False,
                "process": None,
                "total_activities": 0,
                "placed_activities": 0,
                "percent": 0.0,
                "start_time": 0.0,
                "elapsed": 0.0,
                "logs": [],
                "raw_logs": [],
                "completed": False,
                "success": False,
                "stopped": False,
                "error": None,
                "verbose": True,
                "current_activity": None,
                "bottleneck": None,
                "highest_placed": 0,
                "swap_count": 0,
                "advisor_recommendations": [],
                "advisor_report": None,
                "recent_conflicts": [],
                "started_by": "",
                "school_id": sid
            }
        return _solver_states[sid]

def get_solver_lock(school_id="default"):
    sid = str(school_id or "default").strip() or "default"
    with _solver_registry_lock:
        if sid not in _solver_locks:
            _solver_locks[sid] = threading.RLock()
        return _solver_locks[sid]

def get_solver_dir(school_id="default"):
    sid = str(school_id or "default").strip() or "default"
    if sid == "default":
        sdir = os.path.join(DATA_DIR, "solver_run")
    else:
        sdir = os.path.join(DATA_DIR, "tenants", sid, "solver_run")
    os.makedirs(sdir, exist_ok=True)
    return sdir


def find_fet_cl():
    candidates = [
        os.path.join(ROOT_DIR, "fet-cl"),
        os.path.join(ROOT_DIR, "build", "src", "cl", "fet-cl"),
        "/usr/local/bin/fet-cl",
        "/usr/bin/fet-cl",
        "/opt/homebrew/bin/fet-cl",
        shutil.which("fet-cl")
    ]
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return os.path.abspath(c)
    return None


def get_fet_binary_info():
    """
    Rileva dinamicamente l'architettura su cui è in esecuzione il sistema e per cui
    è stato compilato il binario del solutore fet-cl (es. macOS ARM64, Linux x86_64, Linux ARM64).
    In assenza di informazioni puntuali restituisce una dicitura generica e pulita.
    """
    fet_bin = find_fet_cl()
    sys_arch = platform.machine() or ""
    sys_os = platform.system() or ""
    os_name = "Linux" if sys_os == "Linux" else ("macOS" if sys_os == "Darwin" else sys_os)
    
    bin_arch = None
    if fet_bin and os.path.isfile(fet_bin):
        try:
            res = subprocess.run(["file", fet_bin], capture_output=True, text=True, timeout=3)
            out = res.stdout.lower()
            if "arm64" in out or "aarch64" in out:
                bin_arch = "ARM64"
            elif "x86_64" in out or "x86-64" in out or "x64" in out:
                bin_arch = "x86_64"
            elif "i386" in out or "i686" in out:
                bin_arch = "x86"
        except Exception:
            pass

    if not bin_arch and sys_arch:
        if sys_arch.lower() in ("arm64", "aarch64"):
            bin_arch = "ARM64"
        elif sys_arch.lower() in ("x86_64", "amd64"):
            bin_arch = "x86_64"
        else:
            bin_arch = sys_arch

    arch_parts = []
    if os_name:
        arch_parts.append(os_name)
    if bin_arch:
        arch_parts.append(bin_arch)
    
    arch_label = " ".join(arch_parts).strip()
    
    if arch_label:
        title_label = f"Solver FET CLI {FET_VERSION} ({arch_label})"
    else:
        title_label = f"Solver FET CLI {FET_VERSION}"
        
    return {
        "found": bool(fet_bin),
        "path": fet_bin,
        "os": os_name,
        "arch": bin_arch,
        "arch_label": arch_label or "Standard",
        "title_label": title_label
    }


def kill_fet_process(proc, force=False):
    """
    Termina in modo sicuro e affidabile il processo fet-cl.
    Se force=True esegue immediatamente SIGKILL.
    Altrimenti tenta un SIGTERM grazioso per 0.4s e poi forza SIGKILL.
    """
    if not proc:
        return
    try:
        pid = getattr(proc, "pid", None)
        if pid is None or proc.poll() is not None:
            return
    except Exception:
        return

    if force:
        try:
            proc.kill()
        except Exception:
            pass
        try:
            if pid:
                os.kill(pid, signal.SIGKILL)
        except Exception:
            pass
        return

    # Tentativo grazioso: invia SIGTERM
    try:
        proc.send_signal(signal.SIGTERM)
    except Exception:
        try:
            proc.terminate()
        except Exception:
            pass

    # Attendi fino a 400ms che termini
    for _ in range(4):
        try:
            if proc.poll() is not None:
                return
        except Exception:
            break
        time.sleep(0.1)

    # Escalation obbligatoria a SIGKILL
    try:
        if proc.poll() is None:
            proc.kill()
    except Exception:
        pass
    try:
        if pid and proc.poll() is None:
            os.kill(pid, signal.SIGKILL)
    except Exception:
        pass


class ThreadingHTTPServer(ThreadingMixIn, HTTPServer):
    daemon_threads = True


class EurarioHandler(BaseHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def _send_cors(self):
        origin = self.headers.get("Origin")
        if origin:
            self.send_header("Access-Control-Allow-Origin", origin)
            self.send_header("Access-Control-Allow-Credentials", "true")
            self.send_header("Access-Control-Allow-Methods", "GET, POST, PUT, DELETE, OPTIONS")
            self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Accept, X-Base-Version, X-School-Id")
            self.send_header("Access-Control-Expose-Headers", "X-Data-Version, X-School-Id")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def _json(self, code, data, set_cookie=None, clear_cookie=False, extra_headers=None):
        try:
            if hasattr(db, "data") and isinstance(getattr(db, "data", None), dict):
                cur_ver = db.data.get("data_version")
                if cur_ver is not None:
                    if isinstance(data, dict) and "data_version" not in data:
                        data["data_version"] = cur_ver
                        if "last_modified_by" not in data and "last_modified_by" in db.data:
                            data["last_modified_by"] = db.data.get("last_modified_by")
        except Exception:
            pass

        body = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        try:
            if hasattr(db, "data") and isinstance(getattr(db, "data", None), dict):
                cur_ver = db.data.get("data_version")
                if cur_ver is not None:
                    self.send_header("X-Data-Version", str(cur_ver))
        except Exception:
            pass
        if extra_headers:
            for hname, hval in extra_headers:
                self.send_header(hname, hval)
        if set_cookie:
            self.send_header("Set-Cookie", f"eurario_session={set_cookie}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000")
        elif clear_cookie:
            self.send_header("Set-Cookie", "eurario_session=; Path=/; Expires=Thu, 01 Jan 1970 00:00:00 GMT; Max-Age=0; HttpOnly; SameSite=Lax")
        self._send_cors()
        self.end_headers()
        self.wfile.write(body)
        try:
            self.wfile.flush()
        except Exception:
            pass

    def _get_session_token(self):
        cookie_header = self.headers.get("Cookie", "")
        if "eurario_session=" in cookie_header:
            for part in cookie_header.split(";"):
                part = part.strip()
                if part.startswith("eurario_session="):
                    return part.split("eurario_session=")[1].strip()
        auth_hdr = self.headers.get("Authorization", "")
        if auth_hdr.startswith("Bearer "):
            return auth_hdr[7:].strip()
        return None

    def _get_current_user(self):
        token = self._get_session_token()
        if not token:
            return None
        return auth_manager.get_user_by_session(token)

    def _require_auth(self):
        user = self._get_current_user()
        if not user:
            self._json(401, {"error": "Autenticazione richiesta", "code": "AUTH_REQUIRED"})
            return None
        if user.get("status") != "approved":
            self._json(403, {
                "error": "Accesso in attesa di autorizzazione da parte dell'amministratore",
                "code": "AUTH_PENDING",
                "user": user
            })
            return None
        return user

    def _require_admin(self):
        user = self._require_auth()
        if not user:
            return None
        sid = self._resolve_school_id()
        is_passcode = bool(user.get("is_passcode_auth", False))
        if auth_manager.is_superadmin(user.get("email"), is_passcode):
            return user
        if sid and auth_manager.is_school_admin(user.get("email"), sid, is_passcode):
            return user
        self._json(403, {"error": "Operazione riservata all'amministratore dell'istituto", "code": "FORBIDDEN"})
        return None

    def _require_superadmin(self):
        user = self._require_auth()
        if not user:
            return None
        if not user.get("is_superadmin"):
            self._json(403, {"error": "Operazione riservata al SuperAdmin di Eurario", "code": "SUPERADMIN_REQUIRED"})
            return None
        return user

    def _resolve_school_id(self, query=None):
        # 1. Header esplicito X-School-Id
        hdr = self.headers.get("X-School-Id")
        if hdr and school_manager.get_school(hdr):
            return hdr.strip()
        # 2. Query param ?school_id=
        if query and query.get("school_id"):
            q_sid = query["school_id"][0].strip()
            if school_manager.get_school(q_sid):
                return q_sid
        # 3. Cookie esplicito eurario_active_school (per persistenza attiva su tutti i client)
        cookie_header = self.headers.get("Cookie", "")
        if "eurario_active_school=" in cookie_header:
            for part in cookie_header.split(";"):
                part = part.strip()
                if part.startswith("eurario_active_school="):
                    c_sid = part.split("eurario_active_school=")[1].strip()
                    if c_sid and school_manager.get_school(c_sid):
                        return c_sid
        # 4. Sessione utente loggato
        user = self._get_current_user()
        if user:
            if user.get("is_superadmin"):
                if user.get("active_school_id") and school_manager.get_school(user["active_school_id"]):
                    return str(user["active_school_id"]).strip()
                return "default"
            # Utente normale: determina le scuole accessibili
            email = user.get("email")
            mems = {email: auth_manager.get_user_memberships(email)} if email else None
            can_def = bool(user.get("can_define_school"))
            user_schools = school_manager.list_schools_for_user(email, is_superadmin=False, memberships=mems, can_define_school=can_def)
            if not user_schools:
                return None
            if user.get("active_school_id") and any(s["id"] == user["active_school_id"] for s in user_schools):
                return str(user["active_school_id"]).strip()
            return user_schools[0]["id"]
        # 5. Fallback predefinito (per connessioni locali/script)
        return "default"

    def _setup_request_school(self, query=None):
        sid = self._resolve_school_id(query=query)
        set_current_school_id(sid or "none")
        return sid

    def _is_current_school_trial(self):
        sid = get_current_school_id()
        sch = school_manager.get_school(sid)
        return (sch.get("status") == "trial") if sch else False

    def _read_json(self):
        try:
            cl = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(cl).decode("utf-8")
            return json.loads(body)
        except Exception as e:
            return None

    def _get_client_ip(self):
        xff = self.headers.get("X-Forwarded-For")
        if xff:
            return xff.split(",")[0].strip()
        x_real_ip = self.headers.get("X-Real-IP")
        if x_real_ip:
            return x_real_ip.strip()
        return self.client_address[0] if (self.client_address and len(self.client_address) > 0) else "127.0.0.1"

    def _get_user_agent(self):
        ua = self.headers.get("User-Agent") or "-"
        return ua[:120]

    def _get_request_lang(self, query=None):
        raw_lang = query.get("lang", [None])[0] if query else None
        if not raw_lang:
            cookie_header = self.headers.get("Cookie", "")
            for part in cookie_header.split(";"):
                if "=" in part:
                    k, v = part.strip().split("=", 1)
                    if k.strip() == "app_lang":
                        raw_lang = v.strip()
                        break
        if not raw_lang:
            accept_lang = (self.headers.get("Accept-Language") or "").lower()
            if accept_lang.startswith("en"):
                raw_lang = "en"
        return "en" if str(raw_lang or "").strip().lower() in ("en", "eng", "english") else "it"

    def _serve_file(self, file_path, content_type=None, attachment_name=None):
        if not os.path.exists(file_path):
            self.send_error(404, "File non trovato")
            return
        if not content_type:
            ext = os.path.splitext(file_path)[1].lower()
            if ext == ".svg":
                content_type = "image/svg+xml"
            elif ext == ".ico":
                content_type = "image/x-icon"
            elif ext == ".png":
                content_type = "image/png"
            elif ext == ".css":
                content_type = "text/css; charset=utf-8"
            elif ext == ".js":
                content_type = "application/javascript; charset=utf-8"
            elif ext == ".json":
                content_type = "application/json; charset=utf-8"
            else:
                content_type, _ = mimetypes.guess_type(file_path)
                content_type = content_type or "application/octet-stream"

        with open(file_path, "rb") as f:
            content = f.read()

        self.send_response(200)
        self.send_header("Content-Type", content_type)
        basename = os.path.basename(file_path).lower()
        if basename.startswith("favicon") or "eurario" in basename:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        elif file_path.endswith((".ico", ".png", ".svg", ".jpg", ".jpeg", ".webp", ".woff", ".woff2")):
            self.send_header("Cache-Control", "public, max-age=86400")
        else:
            self.send_header("Cache-Control", "no-cache, must-revalidate")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
        self.send_header("Content-Length", str(len(content)))
        if attachment_name:
            self.send_header("Content-Disposition", f'attachment; filename="{attachment_name}"')
        self._send_cors()
        self.end_headers()
        self.wfile.write(content)

    def do_GET(self):
        try:
            self._handle_GET()
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                self._json(500, {
                    "error": str(e),
                    "message": f"Errore interno del server: {e}"
                })
            except Exception:
                pass
        finally:
            clear_request_context()

    def _handle_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        self._setup_request_school(query)

        # --- STATIC FILES ---
        if path == "/" or path == "/index.html":
            self._serve_file(os.path.join(STATIC_DIR, "index.html"), "text/html; charset=utf-8")
            return
        
        # Gestione generica file statici in STATIC_DIR (css, js, favicon ico/svg/png, apple-touch-icon)
        clean_path = path.lstrip("/")
        if clean_path.startswith("static/"):
            clean_path = clean_path[len("static/"):]
        target_static_file = os.path.abspath(os.path.join(STATIC_DIR, clean_path))
        if os.path.commonpath([target_static_file, os.path.abspath(STATIC_DIR)]) == os.path.abspath(STATIC_DIR) and os.path.isfile(target_static_file):
            self._serve_file(target_static_file)
            return

        # --- PUBLIC & AUTH API ---
        if path == "/api/health":
            self._json(200, {"status": "ok", "version": APP_VERSION})
            return
        elif path == "/api/info":
            fet_info = get_fet_binary_info()
            self._json(200, {
                "app_name": "Eurario FET Suite",
                "version": APP_VERSION,
                "fet_version": FET_VERSION,
                "fet_found": fet_info["found"],
                "fet_arch": fet_info["arch_label"],
                "fet_title": fet_info["title_label"],
                "author": APP_AUTHOR,
                "mentor": APP_MENTOR,
                "credits": APP_CREDITS,
                "deployment": "on-premise or controlled vm/vps (self-hosted by installer)",
                "gdpr_mode": "on-premise or controlled vm/vps (self-hosted by installer)"
            })
            return
        elif path == "/api/version/check":
            force = "force" in query and query["force"][0] in ("1", "true")
            update_info = updater.check_for_updates(APP_VERSION, force=force)
            self._json(200, update_info)
            return
        elif path == "/api/auth/config":
            self._json(200, {
                "google_client_id": auth_manager.config.get("google_client_id", ""),
                "admin_email": auth_manager.config.get("admin_email", "admin@scuolaatene.edu.it")
            })
            return
        elif path == "/api/auth/me":
            user = self._get_current_user()
            if user:
                pending_count = auth_manager.list_users()["pending_count"] if user.get("role") == "admin" else 0
                active_sid = get_current_school_id()
                curr_school = school_manager.get_school(active_sid) or school_manager.get_school("default")
                self._json(200, {
                    "authenticated": True,
                    "user": user,
                    "pending_count": pending_count,
                    "current_school": curr_school
                })
            else:
                self._json(200, {
                    "authenticated": False,
                    "google_client_id": auth_manager.config.get("google_client_id", "")
                })
            return

        elif path == "/api/schools/my":
            user = self._get_current_user()
            is_super = bool(user and user.get("is_superadmin"))
            email = user.get("email") if user else None
            can_def = bool(user and user.get("can_define_school"))
            mems = {email: auth_manager.get_user_memberships(email)} if email else None
            schools = school_manager.list_schools_for_user(email, is_superadmin=is_super, memberships=mems, can_define_school=can_def)
            active_sid = get_current_school_id()
            if schools and not is_super and not any(s["id"] == active_sid for s in schools):
                active_sid = schools[0]["id"]
                set_current_school_id(active_sid)
            curr_school = school_manager.get_school(active_sid) if (schools or is_super) else None
            self._json(200, {
                "schools": schools,
                "current_school": curr_school,
                "active_school_id": active_sid if curr_school else None,
                "is_superadmin": is_super,
                "can_define_school": can_def
            })
            return

        elif path == "/api/schools/current":
            active_sid = get_current_school_id()
            if not active_sid or active_sid == "none":
                self._json(200, None)
                return
            curr_school = school_manager.get_school(active_sid)
            self._json(200, curr_school)
            return

        elif path == "/api/admin_contact_info":
            active_sid = get_current_school_id()
            curr_school = school_manager.get_school(active_sid) if active_sid and active_sid != "none" else None
            admin_email = auth_manager.config.get("admin_email", "admin@scuolaatene.edu.it")
            owner_email = (curr_school.get("owner_email") or admin_email) if curr_school else admin_email
            school_name = (curr_school.get("name") or "Istituto Scolastico") if curr_school else "Eurario FET Suite"
            self._json(200, {
                "admin_email": admin_email,
                "owner_email": owner_email,
                "school_name": school_name,
                "contact_email": owner_email or admin_email
            })
            return

        elif path == "/api/superadmin/schools":
            user = self._require_superadmin()
            if not user:
                return
            schools = school_manager.list_all_schools()
            self._json(200, {"schools": schools, "count": len(schools)})
            return

        elif path == "/api/auth/users":
            admin = self._require_admin()
            if not admin:
                return
            is_passcode = bool(admin.get("is_passcode_auth", False))
            is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
            requested_sid = query.get("school_id", [None])[0]
            if not is_super:
                # Amministratore di scuola: isolamento assoluto sulla propria scuola
                requested_sid = self._resolve_school_id(query)
            users_res = auth_manager.list_users(school_id=requested_sid, requesting_user=admin)
            if is_super:
                users_res["available_schools"] = school_manager.list_all_schools()
            self._json(200, users_res)
            return
        elif path == "/api/auth/access_logs":
            if not self._require_admin():
                return
            limit = int(query.get("limit", [250])[0])
            self._json(200, {
                "ok": True,
                "logs": auth_manager.get_access_logs(limit=limit)
            })
            return

        # Docker healthcheck local bypass (127.0.0.1)
        if path == "/api/summary" and self.client_address[0] in ("127.0.0.1", "::1", "localhost"):
            sum_data = db.get_summary()
            sum_data["app_version"] = APP_VERSION
            sum_data["fet_version"] = FET_VERSION
            fet_info = get_fet_binary_info()
            sum_data["fet_arch"] = fet_info["arch_label"]
            sum_data["fet_title"] = fet_info["title_label"]
            sum_data["author"] = APP_AUTHOR
            self._json(200, sum_data)
            return

        # --- REPORT & STAMPE UFFICIALI (Procedura 9 & 12) ---
        if path == "/api/print/options":
            self._json(200, get_print_options_metadata(db.get_all()))
            return

        elif path == "/api/print/classes":
            raw_classes = query.get("classes", ["all"])[0]
            if raw_classes == "all":
                classes_param = "all"
            else:
                classes_param = [c.strip() for c in raw_classes.split(",") if c.strip()]
            req_lang = self._get_request_lang(query)
            options = {
                "validity_date": query.get("validity_date", [""])[0],
                "color_mode": query.get("color_mode", ["color"])[0],
                "content_mode": query.get("content_mode", ["materia_docente"])[0],
                "show_rooms": query.get("show_rooms", ["1"])[0] in ("1", "true", "yes"),
                "include_subgroups": query.get("include_subgroups", ["1"])[0] in ("1", "true", "yes"),
                "classes": classes_param,
                "lang": req_lang,
                "is_trial": self._is_current_school_trial()
            }
            html_content = generate_classes_print_html(db.get_all(), options)
            html_bytes = html_content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_bytes)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self._send_cors()
            self.end_headers()
            self.wfile.write(html_bytes)
            return

        elif path == "/api/print/teachers":
            req_lang = self._get_request_lang(query)
            options = {
                "validity_date": query.get("validity_date", [""])[0],
                "paper_size": query.get("paper_size", ["A3"])[0],
                "show_rooms": query.get("show_rooms", ["0"])[0] in ("1", "true", "yes"),
                "highlight_disp": query.get("highlight_disp", ["1"])[0] in ("1", "true", "yes"),
                "lang": req_lang,
                "is_trial": self._is_current_school_trial()
            }
            html_content = generate_teachers_master_print_html(db.get_all(), options)
            html_bytes = html_content.encode("utf-8")
            self.send_response(200)
            self.send_header("Content-Type", "text/html; charset=utf-8")
            self.send_header("Content-Length", str(len(html_bytes)))
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self._send_cors()
            self.end_headers()
            self.wfile.write(html_bytes)
            return

        elif path == "/api/print/teachers/docx":
            req_lang = self._get_request_lang(query)
            options = {
                "validity_date": query.get("validity_date", [""])[0],
                "paper_size": query.get("paper_size", ["A3"])[0],
                "show_rooms": query.get("show_rooms", ["0"])[0] in ("1", "true", "yes"),
                "highlight_disp": query.get("highlight_disp", ["1"])[0] in ("1", "true", "yes"),
                "lang": req_lang,
                "is_trial": self._is_current_school_trial()
            }
            docx_bytes = generate_teachers_master_docx(db.get_all(), options)
            date_clean = (options["validity_date"] or "bozza").replace("/", "-")
            prefix = "Faculty_Timetable" if options["lang"] == "en" else "Orario_Docenti"
            filename = f"{prefix}_{date_clean}.docx"
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Length", str(len(docx_bytes)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self.send_header("Cache-Control", "no-cache, no-store, must-revalidate, max-age=0")
            self.send_header("Pragma", "no-cache")
            self.send_header("Expires", "0")
            self._send_cors()
            self.end_headers()
            self.wfile.write(docx_bytes)
            return

        elif path == "/api/organico/template_docx":
            use_current = query.get("current", ["0"])[0] in ("1", "true", "yes")
            req_lang = "en" if query.get("lang", ["it"])[0].lower() in ("en", "eng", "english") else "it"
            data_to_use = db.get_all() if use_current else None
            docx_bytes = generate_organico_template_docx(data_to_use, lang=req_lang)
            if req_lang == "en":
                filename = "Current_School_Organico.docx" if use_current else "Eurario_Faculty_Organico_Template.docx"
            else:
                filename = "Organico_Scuola_Attuale.docx" if use_current else "Modello_Organico_Eurario.docx"
            self.send_response(200)
            self.send_header("Content-Type", "application/vnd.openxmlformats-officedocument.wordprocessingml.document")
            self.send_header("Content-Length", str(len(docx_bytes)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self._send_cors()
            self.end_headers()
            self.wfile.write(docx_bytes)
            return

        elif path == "/api/teachers/align_cattedre/template_csv":
            use_current = query.get("current", ["0"])[0] in ("1", "true", "yes")
            import io, csv
            out = io.StringIO()
            writer = csv.writer(out)
            writer.writerow(["Classe di Concorso", "Docente", "Classi", "Ore", "Tipo di Cattedra", "Orario su giorni"])
            if use_current:
                teachers = db.get_teachers()
                for t in teachers:
                    raw_type = t.get("contract_type", "intera")
                    if raw_type == "part_time":
                        type_str = "PART TIME"
                    elif raw_type == "coe" or t.get("is_coe"):
                        type_str = "COE"
                    elif raw_type == "spezzone":
                        type_str = "SPEZZONE"
                    else:
                        type_str = "INTERA" if t.get("target_hours", 18) >= 18 else ""
                    writer.writerow([
                        t.get("cdc", ""),
                        t.get("name", ""),
                        t.get("comments", ""),
                        t.get("target_hours", 18),
                        type_str,
                        t.get("max_days", "") or ""
                    ])
            else:
                writer.writerow(["A011 - Discipline Letterarie e Latino", "Baston Michela", "1C(4) Italiano - 1C(3) Latino - 1C(3) Storia - 3D(4) Italiano", 14, "PART TIME", 4])
                writer.writerow(["A015 - Discipline Sanitarie", "Di Zane Alessia", "3G(4) - 4G(4)", 8, "COE", ""])
                writer.writerow(["A021 - Geografia", "Funaro Pascale", "2B(3) - 1F(3) - 2F(3) - 1G(2) - 1H(2)", 13, "SPEZZONE", ""])
                writer.writerow(["A026 - Matematica", "Rigoni Carlo", "2L(4) - 3G(3) - 3H(3) - POT(8)", 18, "", ""])

            csv_bytes = out.getvalue().encode("utf-8")
            filename = "Docenti_Cattedre_Attuali.csv" if use_current else "Modello_Allineamento_Cattedre.csv"
            self.send_response(200)
            self.send_header("Content-Type", "text/csv; charset=utf-8")
            self.send_header("Content-Length", str(len(csv_bytes)))
            self.send_header("Content-Disposition", f'attachment; filename="{filename}"')
            self._send_cors()
            self.end_headers()
            self.wfile.write(csv_bytes)
            return

        # Tutti gli altri endpoint /api/ richiedono autenticazione
        if path.startswith("/api/"):
            if not self._require_auth():
                return

        # --- REST API ---
        if path == "/api/summary":
            sid = get_current_school_id()
            if not sid or sid == "none":
                fet_info = get_fet_binary_info()
                self._json(200, {
                    "institution": "",
                    "teachers_count": 0,
                    "classes_count": 0,
                    "subjects_count": 0,
                    "rooms_count": 0,
                    "activities_count": 0,
                    "app_version": APP_VERSION,
                    "fet_version": FET_VERSION,
                    "fet_arch": fet_info["arch_label"],
                    "fet_title": fet_info["title_label"],
                    "author": APP_AUTHOR
                })
                return
            sum_data = db.get_summary()
            sum_data["app_version"] = APP_VERSION
            sum_data["fet_version"] = FET_VERSION
            fet_info = get_fet_binary_info()
            sum_data["fet_arch"] = fet_info["arch_label"]
            sum_data["fet_title"] = fet_info["title_label"]
            sum_data["author"] = APP_AUTHOR
            self._json(200, sum_data)

        elif path == "/api/teachers":
            self._json(200, db.get_teachers())

        elif path == "/api/classes":
            self._json(200, db.get_classes())

        elif path == "/api/groups":
            self._json(200, db.get_groups())

        elif path == "/api/subjects":
            self._json(200, db.get_subjects())

        elif path == "/api/rooms":
            self._json(200, db.get_rooms())

        elif path == "/api/activities":
            self._json(200, db.get_activities())

        elif path == "/api/activities/grouped":
            self._json(200, db.get_grouped_activities())

        elif path == "/api/accorpamenti/candidates":
            self._json(200, db.get_accorpamenti_candidates())

        elif path == "/api/settings":
            st = db.get_settings()
            sid = get_current_school_id()
            if sid and sid != "none":
                sch = school_manager.get_school(sid)
                if sch:
                    st["school_id"] = sch.get("id")
                    st["city"] = sch.get("city", "")
                    st["country"] = sch.get("country", "Italia")
                    st["notes"] = sch.get("notes", "")
                    st["contact_email"] = sch.get("contact_email", "") or st.get("contact_email", "")
                    if not st.get("meccanografico"):
                        st["meccanografico"] = sch.get("meccanografico", "")
                    if not st.get("institution"):
                        st["institution"] = sch.get("name", "")
            self._json(200, st)

        elif path == "/api/schools/smtp":
            admin = self._require_admin()
            if not admin:
                return
            is_passcode = bool(admin.get("is_passcode_auth", False))
            is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
            sid = query.get("school_id", [None])[0] or self._resolve_school_id(query)
            if not is_super:
                sid = self._resolve_school_id(query)
            sch = school_manager.get_school(sid)
            if not sch:
                self._json(404, {"error": "Istituto non trovato"})
                return
            smtp_cfg = dict(sch.get("smtp", {}))
            has_pwd = bool(smtp_cfg.get("password"))
            smtp_cfg["password"] = "******" if has_pwd else ""
            smtp_cfg["has_password"] = has_pwd
            self._json(200, {
                "ok": True,
                "school_id": sid,
                "school_name": sch.get("name"),
                "contact_email": sch.get("contact_email", ""),
                "smtp": smtp_cfg
            })
            return

        elif path == "/api/sections/percorsi":
            self._json(200, db.get_section_percorsi())

        elif path == "/api/blocks/rules":
            self._json(200, {
                "rules": db.get_block_rules(),
                "section_percorsi": db.get_section_percorsi()["section_percorsi"]
            })

        elif path == "/api/blocks/default_for_cattedra":
            subj = query.get("subject", [""])[0]
            cls_name = query.get("class_name", [""])[0]
            try:
                th = int(query.get("total_hours", [1])[0])
            except Exception:
                th = 1
            sec, perc, period = db.get_class_percorso_and_period(cls_name)
            def_b = db.get_default_blocks(subj, cls_name, th)
            self._json(200, {
                "default_blocks": def_b,
                "section": sec,
                "percorso": perc,
                "period": period
            })

        elif path == "/api/availability":
            self._json(200, db.get_availability())

        elif path == "/api/timetable/views":
            self._json(200, db.get_timetable_views())

        elif path == "/api/solve/status":
            target_sid = get_current_school_id()
            solver_state = get_solver_state(target_sid)
            with get_solver_lock(target_sid):
                data = {
                    "running": solver_state["running"],
                    "started_by": solver_state.get("started_by", ""),
                    "school_id": target_sid,
                    "placed": solver_state["placed_activities"],
                    "total": solver_state["total_activities"],
                    "percent": solver_state["percent"],
                    "elapsed": solver_state["elapsed"],
                    "logs": solver_state["logs"][-150:],
                    "raw_logs": solver_state.get("raw_logs", [])[-150:],
                    "completed": solver_state["completed"],
                    "success": solver_state["success"],
                    "stopped": solver_state["stopped"],
                    "current_activity": solver_state.get("current_activity"),
                    "bottleneck": solver_state.get("bottleneck"),
                    "highest_placed": solver_state.get("highest_placed", 0),
                    "swap_count": solver_state.get("swap_count", 0),
                    "advisor_recommendations": solver_state.get("advisor_recommendations", []),
                    "advisor_report": solver_state.get("advisor_report")
                }
            self._json(200, data)

        elif path == "/api/validator/report":
            validator = TimetablePreValidator(db.get_all())
            report = validator.validate()
            self._json(200, report)

        elif path == "/api/advisor/analyze":
            lang = query.get("lang", ["it"])[0]
            target_sid = get_current_school_id()
            solver_state = get_solver_state(target_sid)
            solver_dir = get_solver_dir(target_sid)
            advisor_report = TimetableAdvisor.analyze_bottlenecks(db.get_all(), solver_dir=solver_dir, solver_state=solver_state, lang=lang)
            self._json(200, advisor_report)

        elif path == "/api/export/fet":
            try:
                with_tt = query.get("with_timetable", ["0"])[0].lower() in ("1", "true", "yes")
                xml_str = generate_fet_xml(db.get_all(), include_timetable=with_tt)
                xml_bytes = xml_str.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/xml; charset=utf-8")
                self.send_header("Content-Disposition", 'attachment; filename="ParametriOrario.fet"')
                self.send_header("Content-Length", str(len(xml_bytes)))
                self._send_cors()
                self.end_headers()
                self.wfile.write(xml_bytes)
            except Exception as e:
                import traceback
                traceback.print_exc()
                self._json(500, {"error": f"Errore durante la generazione del file FET: {str(e)}"})

        elif path == "/api/export/timetable":
            try:
                xml_full = generate_fet_xml(db.get_all(), include_timetable=True, exclude_disposizioni=False)
                xml_bytes = xml_full.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/xml; charset=utf-8")
                self.send_header("Content-Length", str(len(xml_bytes)))
                self.send_header("Content-Disposition", 'attachment; filename="Orario_Risolto_data_and_timetable.fet"')
                self.send_header("Connection", "close")
                self._send_cors()
                self.end_headers()
                self.wfile.write(xml_bytes)
                return
            except Exception as e:
                solved_path = os.path.join(DATA_DIR, "solved_timetable.fet")
                if not os.path.exists(solved_path):
                    demo_solved = os.path.join(DATA_DIR, "demo_solved_timetable.fet")
                    if os.path.exists(demo_solved):
                        try:
                            shutil.copyfile(demo_solved, solved_path)
                        except Exception:
                            pass
                if os.path.exists(solved_path):
                    self._serve_file(solved_path, "application/xml; charset=utf-8", "Orario_Risolto_data_and_timetable.fet")
                else:
                    self._json(404, {"error": "Nessun orario risolto ancora calcolato o salvato."})

        elif path == "/api/snapshots":
            self._json(200, {
                "current_config_name": db.data.get("config_name", "Configurazione Corrente"),
                "snapshots": db.get_snapshots()
            })

        elif path.startswith("/api/snapshots/") and path.endswith("/download"):
            parts = path.split("/")
            sid = parts[3]
            content = db.get_snapshot_content(sid)
            if content:
                c_bytes = content.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "application/json; charset=utf-8")
                self.send_header("Content-Disposition", f'attachment; filename="{sid}.json"')
                self.send_header("Content-Length", str(len(c_bytes)))
                self._send_cors()
                self.end_headers()
                self.wfile.write(c_bytes)
            else:
                self._json(404, {"error": "Snapshot non trovato"})

        elif path.startswith("/api/snapshots/") and path.endswith("/download_fet"):
            parts = path.split("/")
            sid = parts[3]
            fet_path = os.path.join(db.snapshots_dir, f"{sid}.fet")
            if os.path.exists(fet_path):
                self._serve_file(fet_path, "application/xml; charset=utf-8", f"{sid}.fet")
            else:
                self._json(404, {"error": "File FET non presente per questo snapshot"})

        else:
            self._json(404, {"error": "Endpoint non trovato"})

    def do_POST(self):
        try:
            parsed = urlparse(self.path)
            path = parsed.path
            query = parse_qs(parsed.query)
            self._setup_request_school(query)
            body = self._read_json()

            user = self._get_current_user()
            # Gli endpoint non legati a mutazioni di dati del progetto non devono ereditare controlli OCC (X-Base-Version)
            is_non_data = path.startswith("/api/schools/") or path.startswith("/api/auth/") or path.startswith("/api/version/")
            base_ver = None if is_non_data else (self.headers.get("X-Base-Version") or (body.get("base_version") if isinstance(body, dict) else None))
            user_email = user.get("email") if isinstance(user, dict) else None
            set_request_context(user_email=user_email, expected_version=base_ver)

            self._dispatch_POST(path, query, body, user)
        except ConcurrentModificationError as e:
            try:
                self._json(409, {
                    "error": "concurrent_modification_conflict",
                    "message": f"I dati sono stati modificati da un altro utente ({e.last_modified_by}). Ricarica per sincronizzare.",
                    "server_version": e.current_version,
                    "last_modified_by": e.last_modified_by,
                    "last_modified": e.last_modified
                })
            except Exception:
                pass
        except Exception as e:
            import traceback
            traceback.print_exc()
            try:
                self._json(500, {
                    "error": str(e),
                    "message": f"Errore interno del server: {e}"
                })
            except Exception:
                pass
        finally:
            clear_request_context()

    def _dispatch_POST(self, path, query, body, user):
        # --- AUTH POST ENDPOINTS ---
        client_ip = self._get_client_ip()
        client_ua = self._get_user_agent()

        if path == "/api/auth/google":
            if not body or (not body.get("credential") and not body.get("access_token")):
                self._json(400, {"error": "Credenziale Google mancante"})
                return
            try:
                res = auth_manager.handle_google_login(
                    id_token=body.get("credential"),
                    access_token=body.get("access_token"),
                    ip=client_ip,
                    user_agent=client_ua
                )
                tok = res.get("session_token")
                self._json(200, {
                    "ok": True,
                    "user": res["user"],
                    "is_new_request": res.get("is_new_request", False)
                }, set_cookie=tok if tok else None)
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/request-access":
            if not body or not body.get("email"):
                self._json(400, {"error": "Indirizzo email obbligatorio per richiedere l'abilitazione"})
                return
            try:
                res = auth_manager.handle_access_request(
                    email=body.get("email"),
                    name=body.get("name"),
                    ip=client_ip,
                    user_agent=client_ua
                )
                self._json(200, res)
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/emergency":
            if not body or not body.get("passcode"):
                self._json(400, {"error": "Passcode mancante"})
                return
            try:
                res = auth_manager.handle_emergency_login(body["passcode"], ip=client_ip, user_agent=client_ua)
                self._json(200, {
                    "ok": True,
                    "user": res["user"],
                    "must_change_passcode": res.get("must_change_passcode", False)
                }, set_cookie=res["session_token"])
            except AuthLockoutError as e:
                self._json(429, {
                    "error": str(e),
                    "locked": True,
                    "retry_after": getattr(e, "retry_after", 900)
                })
            except Exception as e:
                self._json(401, {"error": str(e)})
            return

        elif path == "/api/auth/emergency/change-passcode":
            if not body or not body.get("new_passcode"):
                self._json(400, {"error": "Nuovo passcode mancante"})
                return
            user = self._require_admin()
            if not user:
                return
            old_p = body.get("old_passcode", "")
            new_p = body.get("new_passcode", "")
            try:
                auth_manager.change_emergency_passcode(old_p, new_p, ip=client_ip, user_agent=client_ua)
                self._json(200, {"ok": True, "message": "Passcode di emergenza aggiornato con successo"})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/logout":
            tok = self._get_session_token()
            if tok:
                auth_manager.destroy_session(tok, ip=client_ip, user_agent=client_ua)
            self._json(200, {"ok": True}, clear_cookie=True)
            return

        elif path == "/api/auth/users/approve":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                email = body["email"]
                role = body.get("role", "editor")
                target_school = body.get("target_school", "default")
                u = auth_manager.approve_user(
                    email,
                    role=role,
                    admin_email=admin.get("email"),
                    ip=client_ip,
                    target_school=target_school
                )
                self._json(200, {"ok": True, "user": u})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/reject":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                u = auth_manager.reject_user(body["email"], admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": True, "user": u})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/revoke":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                u = auth_manager.revoke_user(body["email"], admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": True, "user": u})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/delete":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                ok = auth_manager.delete_user(body["email"], admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": ok})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/reopen":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                u = auth_manager.reopen_user(body["email"], admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": True, "user": u})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/update_role":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email") or not body.get("role"):
                self._json(400, {"error": "Email e ruolo mancanti"})
                return
            try:
                is_passcode = bool(admin.get("is_passcode_auth", False))
                is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
                sid = body.get("school_id") or self._resolve_school_id()
                if not is_super:
                    sid = self._resolve_school_id()
                if sid and sid not in ("none", "-"):
                    res = auth_manager.update_user_school_role(body["email"], sid, body["role"], admin_email=admin.get("email"), ip=client_ip)
                else:
                    res = auth_manager.update_user_role(body["email"], body["role"], admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": True, "user": res})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/add_to_school":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email Google mancante"})
                return
            try:
                is_passcode = bool(admin.get("is_passcode_auth", False))
                is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
                sid = body.get("school_id") or self._resolve_school_id()
                if not is_super:
                    sid = self._resolve_school_id()
                if not sid or sid in ("none", "-"):
                    self._json(400, {"error": "Nessun istituto attivo selezionato"})
                    return
                role = body.get("role", "editor")
                name = body.get("name", "")
                res = auth_manager.add_user_to_school_by_admin(body["email"], sid, role=role, name=name, admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": True, "user": res})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/users/remove_from_school":
            admin = self._require_admin()
            if not admin:
                return
            if not body or not body.get("email"):
                self._json(400, {"error": "Email mancante"})
                return
            try:
                is_passcode = bool(admin.get("is_passcode_auth", False))
                is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
                sid = body.get("school_id") or self._resolve_school_id()
                if not is_super:
                    sid = self._resolve_school_id()
                if not sid or sid in ("none", "-"):
                    self._json(400, {"error": "Nessun istituto attivo selezionato"})
                    return
                ok = auth_manager.remove_user_from_school_by_admin(body["email"], sid, admin_email=admin.get("email"), ip=client_ip)
                self._json(200, {"ok": ok})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/access_logs/clear":
            if not self._require_superadmin():
                return
            auth_manager.clear_access_logs(admin_email=admin.get("email") if 'admin' in locals() else None, ip=client_ip)
            self._json(200, {"ok": True, "message": "Registro accessi azzerato con successo"})
            return

        elif path == "/api/auth/config":
            if not self._require_superadmin():
                return
            try:
                cfg = auth_manager.update_config(body or {})
                self._json(200, {"ok": True, "config": cfg})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/auth/smtp/test":
            if not self._require_admin():
                return
            try:
                auth_manager.send_test_email()
                self._json(200, {"ok": True, "message": "Email di test inviata con successo!"})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/schools/smtp":
            admin = self._require_admin()
            if not admin:
                return
            is_passcode = bool(admin.get("is_passcode_auth", False))
            is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
            sid = (body or {}).get("school_id") or self._resolve_school_id()
            if not is_super:
                sid = self._resolve_school_id()
            sch = school_manager.get_school(sid)
            if not sch:
                self._json(404, {"error": "Istituto non trovato"})
                return
            smtp_in = (body or {}).get("smtp", {})
            cur_smtp = sch.get("smtp", {})
            pwd = smtp_in.get("password")
            if pwd == "******" or not pwd:
                pwd = cur_smtp.get("password", "")
            smtp_save = {
                "enabled": bool(smtp_in.get("enabled", False)),
                "host": str(smtp_in.get("host", "smtp.gmail.com")).strip(),
                "port": int(smtp_in.get("port") or 587),
                "user": str(smtp_in.get("user", "")).strip(),
                "password": pwd,
                "notify_to": str(smtp_in.get("notify_to", "")).strip()
            }
            updates = {"smtp": smtp_save}
            if "contact_email" in body:
                updates["contact_email"] = str(body["contact_email"]).strip().lower()
            school_manager.update_school_info(sid, **updates)
            self._json(200, {"ok": True, "message": "Configurazione SMTP e contatto istituto salvati con successo!"})
            return

        elif path == "/api/schools/smtp/test":
            admin = self._require_admin()
            if not admin:
                return
            is_passcode = bool(admin.get("is_passcode_auth", False))
            is_super = auth_manager.is_superadmin(admin.get("email"), is_passcode)
            sid = (body or {}).get("school_id") or self._resolve_school_id()
            if not is_super:
                sid = self._resolve_school_id()
            try:
                school_manager.send_school_test_email(sid, admin_email=admin.get("email"))
                self._json(200, {"ok": True, "message": "Email di test inviata con successo usando l'SMTP dell'istituto!"})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        # --- MULTI-SCUOLA (TENANTS) & SUPERADMIN API ---
        elif path == "/api/schools/switch":
            if not body or not body.get("school_id"):
                self._json(400, {"error": "Parametro school_id mancante"})
                return
            target_sid = str(body["school_id"]).strip()
            target_school = school_manager.get_school(target_sid)
            if not target_school:
                self._json(404, {"error": "Istituto non trovato"})
                return
            tok = self._get_session_token()
            if tok:
                auth_manager.set_session_school(tok, target_sid)
            set_current_school_id(target_sid)
            # Pre-carica e isola in modo sicuro l'istanza Database per la scuola selezionata
            try:
                get_db(target_sid)
            except Exception as e_db:
                print(f"[SWITCH] Avviso pre-warming database istituto {target_sid}: {e_db}")
            extra_headers = [
                ("Set-Cookie", f"eurario_active_school={target_sid}; Path=/; Max-Age=31536000; SameSite=Lax")
            ]
            self._json(200, {
                "success": True,
                "active_school_id": target_sid,
                "school": target_school
            }, extra_headers=extra_headers)
            return

        elif path == "/api/schools/create":
            user = self._require_auth()
            if not user:
                return
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome dell'Istituto obbligatorio"})
                return
            try:
                name = body.get("name")
                city = body.get("city", "")
                country = body.get("country", "Italia")
                school_year = body.get("school_year", "")
                notes = body.get("notes", "")
                meccanografico = body.get("meccanografico", "").strip().upper()
                new_sch = school_manager.create_school(
                    name=name,
                    city=city,
                    country=country,
                    school_year=school_year,
                    owner_email=user["email"],
                    notes=notes,
                    meccanografico=meccanografico
                )
                auth_manager.add_user_to_school(user["email"], new_sch["id"], role="owner", status="approved")
                tok = self._get_session_token()
                if tok:
                    auth_manager.set_session_school(tok, new_sch["id"])
                set_current_school_id(new_sch["id"])
                new_db = get_db(new_sch["id"])
                new_db.data["institution"] = new_sch["name"]
                if meccanografico:
                    new_db.data["meccanografico"] = meccanografico
                new_db.save()

                # Notifica email automatica all'amministratore via SMTP
                try:
                    auth_manager.notify_admin_new_school(new_sch, user)
                except Exception as ne:
                    print(f"[SCHOOLS] Avviso: errore notifica email admin: {ne}")

                self._json(200, {
                    "success": True,
                    "school": new_sch,
                    "message": "Istituto registrato con successo in Modalità di Prova."
                })
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/schools/create_demo":
            user = self._require_auth()
            if not user:
                return
            try:
                lang = (body or {}).get("lang", "it")
                is_en = (lang == "en")
                name = 'School of Athens Classical & Scientific High School' if is_en else 'Liceo Classico e Scientifico Statale "Scuola di Atene"'
                city = "Athens" if is_en else "Atene"
                country = "Greece" if is_en else "Italia"
                notes = "Scuola di esempio precaricata con orario completo e vincoli FET." if not is_en else "Preloaded sample school with complete timetable and FET constraints."
                meccanografico = ""

                new_sch = school_manager.create_school(
                    name=name,
                    city=city,
                    country=country,
                    owner_email=user["email"],
                    notes=notes,
                    meccanografico=meccanografico
                )
                auth_manager.add_user_to_school(user["email"], new_sch["id"], role="owner", status="approved")
                tok = self._get_session_token()
                if tok:
                    auth_manager.set_session_school(tok, new_sch["id"])
                set_current_school_id(new_sch["id"])
                new_db = get_db(new_sch["id"])
                new_db.load_demo(lang=lang)
                new_db.save()

                try:
                    auth_manager.notify_admin_new_school(new_sch, user)
                except Exception as ne:
                    print(f"[DEMO_SCHOOL] Avviso: errore notifica email admin: {ne}")

                self._json(200, {
                    "success": True,
                    "school": new_sch,
                    "message": "Scuola di esempio caricata con successo!" if not is_en else "Demo school loaded successfully!"
                })
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/superadmin/schools/approve":
            user = self._require_superadmin()
            if not user:
                return
            if not body or not body.get("school_id"):
                self._json(400, {"error": "ID istituto mancante"})
                return
            try:
                res = school_manager.approve_school(body["school_id"], admin_email=user["email"])
                self._json(200, {"success": True, "school": res})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/superadmin/schools/suspend":
            user = self._require_superadmin()
            if not user:
                return
            if not body or not body.get("school_id"):
                self._json(400, {"error": "ID istituto mancante"})
                return
            try:
                res = school_manager.suspend_school(body["school_id"], admin_email=user["email"])
                self._json(200, {"success": True, "school": res})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/superadmin/schools/reactivate":
            user = self._require_superadmin()
            if not user:
                return
            if not body or not body.get("school_id"):
                self._json(400, {"error": "ID istituto mancante"})
                return
            try:
                res = school_manager.reactivate_school(body["school_id"], admin_email=user["email"])
                self._json(200, {"success": True, "school": res})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/superadmin/schools/delete":
            user = self._require_superadmin()
            if not user:
                return
            if not body or not body.get("school_id"):
                self._json(400, {"error": "ID istituto mancante"})
                return
            try:
                ok = school_manager.delete_school(body["school_id"])
                self._json(200, {"success": ok})
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        # Tutti gli altri POST richiedono autorizzazione
        if not self._require_auth():
            return

        if path == "/api/teachers":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome docente mancante"})
                return
            ok = db.add_teacher(
                name=body["name"],
                comments=body.get("comments", ""),
                cdc=body.get("cdc", ""),
                target_hours=body.get("target_hours", 18),
                max_days=body.get("max_days", 5),
                min_days=body.get("min_days", 4),
                contract_type=body.get("contract_type", "intera"),
                short_name=body.get("short_name", ""),
                is_coe=body.get("is_coe", False)
            )
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/teachers/update":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome docente mancante"})
                return
            ok = db.update_teacher(body["name"], body)
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/teachers/align_cattedre/analyze":
            if not body:
                self._json(400, {"success": False, "error": "Nessun dato fornito per l'analisi", "message": "Nessun dato fornito per l'analisi"})
                return
            try:
                text_content = body.get("text")
                file_b64 = body.get("file_base64")
                filename = body.get("filename", "")
                file_bytes = None
                if file_b64:
                    import base64
                    if "," in file_b64:
                        file_b64 = file_b64.split(",", 1)[1]
                    file_bytes = base64.b64decode(file_b64)

                res = db.analyze_cattedre_alignment(text=text_content, file_bytes=file_bytes, filename=filename)
                if not res.get("success") and not res.get("message"):
                    res["message"] = res.get("error", "Analisi della tabella cattedre non riuscita")
                self._json(200 if res.get("success") else 400, res)
            except Exception as e:
                import traceback
                traceback.print_exc()
                err_msg = str(e).strip() or type(e).__name__
                self._json(500, {"success": False, "error": err_msg, "message": err_msg})

        elif path == "/api/teachers/align_cattedre/apply":
            if not body:
                self._json(400, {"success": False, "error": "Nessun dato di aggiornamento fornito", "message": "Nessun dato di aggiornamento fornito"})
                return
            try:
                updates = body.get("updates", [])
                create_snap = body.get("create_snapshot", True)
                snap_name = body.get("snapshot_name")
                update_cdc = body.get("update_cdc", False)
                res = db.apply_cattedre_alignment(
                    updates_to_apply=updates,
                    create_snapshot=create_snap,
                    snapshot_name=snap_name,
                    update_cdc=update_cdc
                )
                if not res.get("success") and not res.get("message"):
                    res["message"] = res.get("error", "Impossibile applicare le modifiche alle cattedre")
                self._json(200 if res.get("success") else 400, res)
            except Exception as e:
                import traceback
                traceback.print_exc()
                err_msg = str(e).strip() or type(e).__name__
                self._json(500, {"success": False, "error": err_msg, "message": err_msg})

        elif path.startswith("/api/teachers/") and not path.startswith("/api/teachers/align_cattedre"):
            name = unquote(path[len("/api/teachers/"):])
            ok = db.update_teacher(name, body or {})
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/classes":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome classe mancante"})
                return
            ok = db.add_class(body["name"], body.get("students", 25), body.get("comments", ""))
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/groups":
            if not body or not body.get("name") or not body.get("class_name"):
                self._json(400, {"error": "Nome gruppo o classe mancante"})
                return
            ok = db.add_group(body["class_name"], body["name"], body.get("students", 0), body.get("comments", ""))
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/groups/update":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome gruppo mancante"})
                return
            ok = db.update_group(body["name"], body)
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/cattedre":
            if not body or not body.get("subject") or not body.get("total_hours"):
                self._json(400, {"error": "Dati cattedra incompleti"})
                return
            res = db.save_cattedra(
                teachers=body.get("teachers", []),
                students=body.get("students", []),
                subject=body.get("subject", ""),
                total_hours=body.get("total_hours", 1),
                blocks_str=body.get("blocks", ""),
                room=body.get("room", ""),
                active=body.get("active", True),
                comments=body.get("comments", ""),
                teacher_subjects=body.get("teacher_subjects", None)
            )
            self._json(200, {"success": True, "cattedra": res})

        elif path == "/api/cattedre/update":
            if not body or "sub_ids" not in body:
                self._json(400, {"error": "Parametri non validi"})
                return
            res = db.update_cattedra(
                old_sub_ids=body["sub_ids"],
                teachers=body.get("teachers", []),
                students=body.get("students", []),
                subject=body.get("subject", ""),
                total_hours=body.get("total_hours", 1),
                blocks_str=body.get("blocks", "2+1"),
                room=body.get("room", ""),
                active=body.get("active", True),
                comments=body.get("comments", ""),
                teacher_subjects=body.get("teacher_subjects", None)
            )
            if res:
                self._json(200, {"success": True, "cattedra": res})
            else:
                self._json(400, {"error": "Impossibile aggiornare la cattedra"})

        elif path == "/api/cattedre/update_blocks":
            if not body or "sub_ids" not in body or "blocks" not in body:
                self._json(400, {"error": "Parametri non validi"})
                return
            res = db.update_cattedra_blocks(body["sub_ids"], body["blocks"])
            if res:
                self._json(200, {"success": True, "cattedra": res})
            else:
                self._json(400, {"error": "Impossibile aggiornare i blocchi"})

        elif path == "/api/cattedre/delete":
            if not body or "sub_ids" not in body:
                self._json(400, {"error": "Lista ID mancante"})
                return
            ok = db.delete_cattedra(body["sub_ids"])
            self._json(200, {"success": ok})

        elif path == "/api/cattedre/reset_default_blocks":
            if not body or "sub_ids" not in body:
                self._json(400, {"error": "Parametri non validi"})
                return
            res = db.reset_cattedra_to_default_blocks(body["sub_ids"])
            if res:
                self._json(200, {"success": True, "cattedra": res})
            else:
                self._json(400, {"error": "Impossibile ripristinare i blocchi di default"})

        elif path == "/api/cattedre/reset_all_to_default":
            res = db.reset_all_cattedre_to_default_blocks()
            self._json(200, res)

        elif path == "/api/contact_admin":
            if not body or not body.get("message"):
                self._json(400, {"error": "Il messaggio non può essere vuoto"})
                return
            sender_name = body.get("sender_name", "").strip() or "Utente Eurario"
            sender_email = body.get("sender_email", "").strip()
            subject = body.get("subject", "").strip() or "Messaggio all'Amministratore"
            message = body.get("message", "").strip()

            # Salva il messaggio nel database
            saved_msg = db.add_admin_message(sender_name, sender_email, subject, message)

            # Registra nel log accessi
            ip = self.client_address[0] if self.client_address else "127.0.0.1"
            auth_manager.log_access("CONTACT_ADMIN", sender_email or "anonymous", "user", "INFO", ip, "-", f"Messaggio all'amministratore: {subject}")

            # Notifica email automatica all'amministratore via SMTP se configurato
            smtp_cfg = auth_manager.config.get("smtp", {})
            if smtp_cfg.get("enabled") and smtp_cfg.get("notify_to"):
                try:
                    active_sid = get_current_school_id()
                    curr_sch = school_manager.get_school(active_sid) if active_sid and active_sid != "none" else None
                    sch_name = curr_sch.get("name", "Istituto") if curr_sch else "Eurario"
                    email_body = f"""Nuovo messaggio per l'amministratore di {sch_name}:

Da: {sender_name} <{sender_email or 'Nessuna email specificata'}>
Oggetto: {subject}
Data: {datetime.now().strftime('%d/%m/%Y %H:%M')}

Testo del messaggio:
--------------------------------------------------
{message}
--------------------------------------------------
Questo messaggio è stato inviato dalla piattaforma Eurario.
"""
                    send_smtp_email(
                        smtp_cfg,
                        recipient=smtp_cfg["notify_to"],
                        subject=f"[Eurario - {sch_name}] {subject}",
                        body=email_body
                    )
                except Exception as ex:
                    print(f"[CONTACT_ADMIN] Invio email SMTP fallito: {ex}")

            self._json(200, {
                "success": True,
                "message": "Messaggio inviato all'amministratore con successo!",
                "msg_id": saved_msg.get("id")
            })

        elif path == "/api/sections/percorsi":
            if not body:
                self._json(400, {"error": "Dati mancanti"})
                return
            mapping = body.get("section_percorsi") or body
            updated = db.set_section_percorsi(mapping)
            self._json(200, {"success": True, "data": updated})

        elif path == "/api/blocks/rules":
            if not body:
                self._json(400, {"error": "Dati regola mancanti"})
                return
            rule_data = body.get("rule") if isinstance(body, dict) and "rule" in body else body
            if not rule_data or not isinstance(rule_data, dict) or not rule_data.get("subject"):
                self._json(400, {"error": "Dati regola non validi o materia mancante"})
                return
            saved = db.save_block_rule(rule_data)
            self._json(200, {"success": True, "rule": saved})

        elif path == "/api/blocks/rules/delete":
            if not body or "id" not in body:
                self._json(400, {"error": "ID regola mancante"})
                return
            ok = db.delete_block_rule(body["id"])
            self._json(200, {"success": ok})

        elif path == "/api/subjects":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome materia mancante"})
                return
            ok = db.add_subject(
                name=body["name"],
                comments=body.get("comments", ""),
                cdc=body.get("cdc", ""),
                no_rientri=body.get("no_rientri", False),
                pref_hours=body.get("pref_hours", "INDIFFERENTE"),
                short_name=body.get("short_name", "")
            )
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/subjects/update":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome materia mancante"})
                return
            merge = bool(body.get("merge", False))
            res = db.update_subject(body["name"], body, merge=merge)
            if isinstance(res, dict) and res.get("error") == "subject_exists":
                self._json(409, {"error": "subject_exists", "message": res.get("message", "Materia già esistente")})
                return
            if isinstance(res, dict) and res.get("ok"):
                self._json(200, res)
                return
            self._json(200 if res else 400, {"success": bool(res)})
            return

        elif path == "/api/subjects/merge":
            if not body or not body.get("source_subject") or not body.get("target_subject"):
                self._json(400, {"error": "Parametri source_subject e target_subject obbligatori"})
                return
            res = db.merge_subjects(body["source_subject"], body["target_subject"])
            if isinstance(res, dict) and res.get("ok"):
                self._json(200, res)
            else:
                self._json(400, res if isinstance(res, dict) else {"error": "Impossibile unificare le materie"})
            return

        elif path == "/api/rooms":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome aula mancante"})
                return
            ok = db.add_room(
                name=body["name"],
                building=body.get("building", "Centrale"),
                capacity=body.get("capacity", 30),
                room_type=body.get("room_type", "standard"),
                is_lab_or_gym=body.get("is_lab_or_gym", False),
                comments=body.get("comments", "")
            )
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/rooms/update":
            if not body:
                self._json(400, {"error": "Dati mancanti"})
                return
            old_name = body.get("old_name") or body.get("name")
            ok = db.update_room(old_name, body)
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/classes/update":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome classe mancante"})
                return
            ok = db.update_class(body["name"], body)
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/classes/import_students":
            if not body:
                self._json(400, {"error": "Nessun dato fornito per l'importazione"})
                return

            action = body.get("action")
            if action == "from_seed":
                res = db.import_class_students_from_seed()
                self._json(200 if res.get("success") else 400, res)
                return

            items = body.get("items")
            text = body.get("text")
            if not items and text:
                items = []
                for line in text.strip().splitlines():
                    line = line.strip()
                    if not line or line.startswith("#"):
                        continue
                    parts = re.split(r"[;\t,]+", line)
                    if len(parts) >= 2:
                        name = parts[0].strip()
                        num_m = re.search(r"\d+", parts[1])
                        if name and num_m:
                            items.append({"name": name, "students": int(num_m.group(0))})
                    else:
                        m = re.match(r"^(\d+[a-zA-Z]+(?:\s+[a-zA-Z]+)?)\s+(\d+)$", line)
                        if m:
                            items.append({"name": m.group(1).strip(), "students": int(m.group(2))})

            if items:
                count = db.update_class_students_batch(items)
                self._json(200, {
                    "success": True,
                    "updated_count": count,
                    "total_students": sum(c.get("students", 0) for c in db.data.get("classes", []))
                })
            else:
                self._json(400, {"error": "Nessun dato valido estratto. Formato atteso: 'Classe;Numero' oppure '1A 25'"})

        elif path == "/api/buildings":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome plesso mancante"})
                return
            ok = db.add_building(
                name=body["name"],
                short_code=body.get("short_code", "C"),
                comments=body.get("comments", "")
            )
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/buildings/update":
            if not body or not body.get("old_name"):
                self._json(400, {"error": "Nome plesso mancante"})
                return
            ok = db.update_building(
                old_name=body["old_name"],
                new_name=body.get("name") or body["old_name"],
                short_code=body.get("short_code", "C"),
                comments=body.get("comments", "")
            )
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/accorpamenti/rules":
            if not body or not body.get("name") or not body.get("components"):
                self._json(400, {"error": "Nome regola e almeno due materie componenti richiesti"})
                return
            try:
                rule = db.add_accorpamenti_rule(body["name"], body["components"])
                self._json(200, {"success": True, "rule": rule})
            except Exception as e:
                self._json(400, {"error": str(e)})

        elif path == "/api/accorpamenti/apply":
            if not body:
                self._json(400, {"error": "Dati accorpamento mancanti"})
                return

            macro_subject = body.get("macro_subject")
            comp_ids = body.get("component_activity_ids") or []
            teachers = body.get("teachers", [])
            students = body.get("students", [])
            blocks = body.get("blocks", "")

            # Supporto se invocato con { teacher, class_name, rule_id }
            if (not macro_subject or not comp_ids) and body.get("teacher") and body.get("class_name"):
                t_target = body.get("teacher")
                c_target = body.get("class_name")
                r_target = body.get("rule_id")
                cands = db.get_accorpamenti_candidates().get("candidates", [])
                match = next((c for c in cands if not c.get("is_merged") and c.get("teacher") == t_target and c.get("class_name") == c_target and (not r_target or c.get("rule_id") == r_target)), None)
                if match:
                    macro_subject = match.get("rule_name")
                    comp_ids = match.get("sub_activity_ids", [])
                    teachers = match.get("teachers", [t_target])
                    students = match.get("students", [c_target])
                    blocks = match.get("blocks", "")

            if not macro_subject or not comp_ids:
                self._json(400, {"error": "Attività o materia dell'accorpamento non specificate"})
                return

            res = db.apply_accorpamento(
                teachers=teachers,
                students=students,
                macro_subject=macro_subject,
                component_ids=comp_ids,
                blocks_str=blocks
            )
            self._json(200, {"success": True, "cattedra": res})

        elif path == "/api/accorpamenti/revert":
            if not body:
                self._json(400, {"error": "Dati mancanti"})
                return
            gid = body.get("group_id")
            if not gid and body.get("teacher") and body.get("class_name"):
                t_target = body.get("teacher")
                c_target = body.get("class_name")
                cands = db.get_accorpamenti_candidates().get("candidates", [])
                match = next((c for c in cands if c.get("is_merged") and c.get("teacher") == t_target and c.get("class_name") == c_target), None)
                if match and match.get("sub_activity_ids"):
                    gid = match["sub_activity_ids"][0]
            if not gid:
                self._json(400, {"error": "ID cattedra accorpata mancante"})
                return
            ok = db.revert_accorpamento(gid)
            self._json(200 if ok else 400, {"success": ok})

        elif path in ("/api/activities", "/api/activities/update"):
            if not body:
                self._json(400, {"error": "Dati attività mancanti"})
                return
            saved = db.save_activity(body)
            self._json(200, {"success": True, "activity": saved})

        elif path == "/api/availability":
            if not body or "mode" not in body or "entity" not in body or "slots" not in body:
                self._json(400, {"error": "Parametri non validi"})
                return
            if body["mode"] == "teacher":
                db.set_teacher_availability(body["entity"], body["slots"])
            else:
                db.set_class_availability(body["entity"], body["slots"])
            self._json(200, {"success": True})

        elif path == "/api/availability/preset_liceo":
            target = body.get("class_name") if body else None
            db.apply_liceo_preset(target)
            self._json(200, {"success": True})

        elif path == "/api/settings":
            if not body:
                self._json(400, {"error": "Parametri non validi"})
                return
            try:
                sid = get_current_school_id()
                sch_updates = {}
                if "institution" in body:
                    sch_updates["name"] = body["institution"]
                if "city" in body:
                    sch_updates["city"] = body["city"]
                if "country" in body:
                    sch_updates["country"] = body["country"]
                if "meccanografico" in body:
                    sch_updates["meccanografico"] = body["meccanografico"]
                if "notes" in body:
                    sch_updates["notes"] = body["notes"]
                if "contact_email" in body:
                    sch_updates["contact_email"] = body["contact_email"]

                if sch_updates and sid and sid != "none":
                    school_manager.update_school_info(sid, **sch_updates)

                db.save_settings(body)
                self._json(200, {
                    "success": True,
                    "data_version": db.data.get("data_version", 1),
                    "last_modified": db.data.get("last_modified")
                })
            except Exception as e:
                self._json(400, {"error": str(e)})
            return

        elif path == "/api/import/fet":
            if not body or not body.get("xml"):
                self._json(400, {"error": "Contenuto XML mancante"})
                return
            try:
                db.import_fet_xml(body["xml"])
                self._json(200, {"success": True})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif path == "/api/solve":
            timelimit = int(body.get("timelimit", 3600)) if body else 3600
            verbose = bool(body.get("verbose", True)) if body else True
            self._trigger_solve(timelimit, verbose=verbose)

        elif path == "/api/solve/stop":
            force = bool(body.get("force", False)) if body else False
            target_sid = get_current_school_id()
            solver_state = get_solver_state(target_sid)
            solver_lock = get_solver_lock(target_sid)
            with solver_lock:
                proc = solver_state.get("process")
                if solver_state["running"] and proc:
                    solver_state["stopped"] = True
                    solver_state["logs"].append("🛑 Richiesta di interruzione inviata a fet-cl. Arresto in corso...")
                    def _async_stopper(p, f_flag, sid=target_sid):
                        kill_fet_process(p, force=f_flag)
                        s_lock = get_solver_lock(sid)
                        s_state = get_solver_state(sid)
                        with s_lock:
                            s_state["running"] = False
                            s_state["completed"] = True
                            s_state["logs"].append("⏹ Compilatore fet-cl arrestato con successo. Processo terminato.")
                    threading.Thread(target=_async_stopper, args=(proc, force), daemon=True).start()
                    self._json(200, {"status": "stopping", "stopped": True})
                else:
                    self._json(200, {"status": "not_running", "stopped": False})

        elif path == "/api/advisor/analyze":
            lang = (body or {}).get("lang", "it")
            target_sid = get_current_school_id()
            solver_state = get_solver_state(target_sid)
            solver_dir = get_solver_dir(target_sid)
            adv_res = TimetableAdvisor.analyze_bottlenecks(db.get_all(), solver_dir=solver_dir, solver_state=solver_state, lang=lang)
            self._json(200, adv_res)

        elif path == "/api/advisor/apply_relax":
            if not body:
                self._json(400, {"error": "Dati mancanti"})
                return
            try:
                action_type = body.get("action_type")
                payload = body.get("payload", {})
                restart = bool(body.get("restart_solver", False))
                timelimit = int(body.get("timelimit", 3600))
                verbose = bool(body.get("verbose", True))
                lang = body.get("lang", "it")

                new_data, msg = TimetableAdvisor.apply_relaxation(db.data, action_type, payload, lang=lang)
                with db.lock:
                    db.data = new_data
                    db.save()
                try:
                    db.create_snapshot(f"Advisor: {msg}", "Modifica applicata automaticamente dai suggerimenti dell'Advisor")
                except Exception as e_snap:
                    print("[ADVISOR SNAPSHOT WARNING]", e_snap)

                restarted = False
                if restart:
                    with solver_lock:
                        old_proc = solver_state.get("process")
                        if old_proc and old_proc.poll() is None:
                            kill_fet_process(old_proc, force=True)
                    time.sleep(0.15)
                    self._trigger_solve(timelimit, verbose=verbose, respond=False)
                    restarted = True

                self._json(200, {"status": "ok", "message": msg, "restarted": restarted})
            except Exception as e:
                print("[ADVISOR ERROR]", e)
                self._json(500, {"error": str(e), "message": str(e)})

        elif path == "/api/project/reset_empty":
            inst_name = body.get("institution", "Nuovo Istituto Scolastico") if body else "Nuovo Istituto Scolastico"
            db.reset_empty(inst_name)
            self._json(200, {"success": True, "message": "Progetto azzerato con successo a foglio bianco."})

        elif path == "/api/project/load_demo":
            try:
                lang = (body or {}).get("lang", "it")
                db.load_demo(lang=lang)
                msg = "Demo 'School of Athens' loaded successfully!" if lang == "en" else "Demo 'Scuola di Atene' caricata con successo!"
                self._json(200, {"success": True, "message": msg})
            except Exception as e:
                self._json(500, {"success": False, "error": str(e)})

        elif path == "/api/version/upgrade":
            has_google_auth = bool(auth_manager.config.get("google_client_id"))
            if has_google_auth:
                admin = self._require_admin()
                if not admin:
                    return
            elif user and user.get("role") not in ("admin", "owner") and not user.get("is_superadmin"):
                self._json(403, {"error": "Permesso negato: solo gli amministratori possono avviare l'aggiornamento del server."})
                return

            res = updater.apply_update()
            status_code = 200 if res.get("success") else 500
            self._json(status_code, res)
            return

        elif path == "/api/snapshots":
            if not body:
                self._json(400, {"error": "Dati mancanti"})
                return
            snap = db.create_snapshot(body.get("name", ""), body.get("description", ""))
            self._json(200, {"success": True, "snapshot": snap})

        elif path == "/api/snapshots/rename_current":
            if not body or not body.get("name"):
                self._json(400, {"error": "Nome mancante"})
                return
            new_n = db.rename_current_config(body["name"])
            self._json(200, {"success": True, "name": new_n})

        elif path == "/api/snapshots/rename":
            if not body or not body.get("id"):
                self._json(400, {"error": "ID snapshot mancante"})
                return
            ok = db.rename_snapshot(body["id"], body.get("name", ""), body.get("description"))
            self._json(200 if ok else 400, {"success": ok})

        elif path == "/api/snapshots/restore":
            if not body or not body.get("id"):
                self._json(400, {"error": "ID snapshot mancante"})
                return
            ok = db.restore_snapshot(body["id"])
            if ok:
                self._json(200, {"success": True, "summary": db.get_summary()})
            else:
                self._json(400, {"error": "Impossibile ripristinare lo snapshot"})

        elif path == "/api/snapshots/upload":
            if not body or not body.get("content"):
                self._json(400, {"error": "Contenuto del file mancante"})
                return
            try:
                snap = db.import_snapshot_from_content(body["content"], body.get("filename", ""))
                self._json(200, {"success": True, "snapshot": snap})
            except Exception as e:
                self._json(400, {"error": str(e)})

        elif path == "/api/organico/analyze":
            if not body:
                self._json(400, {"error": "Nessun dato fornito per l'analisi"})
                return
            try:
                docx_bytes = None
                if body.get("google_doc_url"):
                    docx_bytes = fetch_google_doc_docx_bytes(body["google_doc_url"])
                elif body.get("docx_base64"):
                    b64_str = body["docx_base64"]
                    if "," in b64_str:
                        b64_str = b64_str.split(",", 1)[1]
                    docx_bytes = base64.b64decode(b64_str)
                elif body.get("filepath") and os.path.isfile(body["filepath"]):
                    with open(body["filepath"], "rb") as f:
                        docx_bytes = f.read()
                else:
                    self._json(400, {"error": "Fornire un file Word (.docx) o un link Google Doc valido."})
                    return

                parsed_teachers = parse_organico_docx_content(docx_bytes)
                diff_data = db.compare_organico_with_db(parsed_teachers)
                self._json(200, {
                    "success": True,
                    "total_parsed": len(parsed_teachers),
                    "summary": diff_data.get("summary", {}),
                    "added": diff_data.get("added", []),
                    "modified": diff_data.get("modified", []),
                    "removed": diff_data.get("removed", []),
                    "unchanged": diff_data.get("unchanged", []),
                    "diff": diff_data
                })
            except Exception as e:
                self._json(400, {"error": str(e)})

        elif path == "/api/organico/apply":
            if not body:
                self._json(400, {"error": "Nessun dato di aggiornamento fornito"})
                return
            try:
                if body.get("create_snapshot", True):
                    snap_name = body.get("snapshot_name") or f"Pre-Aggiornamento Organico - {get_local_now().strftime('%d/%m/%Y %H:%M')}"
                    db.create_snapshot(snap_name, "Snapshot di sicurezza generato automaticamente prima dell'applicazione dell'organico.")

                res = db.apply_organico_update(
                    apply_added=body.get("apply_added", []),
                    apply_modified=body.get("apply_modified", []),
                    apply_removed=body.get("apply_removed", []),
                    sync_activities=body.get("sync_activities", False)
                )
                self._json(200, {"success": True, "result": res, "summary": db.get_summary()})
            except Exception as e:
                self._json(500, {"error": str(e)})

        elif path == "/api/timetable/place_disposizioni":
            try:
                res = db.place_disposizioni_in_timetable()
                self._json(200, res)
            except Exception as e:
                self._json(500, {"success": False, "error": str(e), "message": str(e)})

        elif path == "/api/timetable/toggle_lock":
            if not body or "activity_id" not in body:
                self._json(400, {"error": "activity_id mancante"})
                return
            res = db.toggle_activity_lock(body["activity_id"], body.get("locked"))
            self._json(200 if res.get("success") else 400, res)

        elif path == "/api/timetable/lock_class":
            if not body or "class_name" not in body:
                self._json(400, {"error": "class_name mancante"})
                return
            res = db.lock_class_activities(body["class_name"], body.get("locked", True))
            self._json(200 if res.get("success") else 400, res)

        elif path == "/api/timetable/unlock_all":
            res = db.unlock_all_activities()
            self._json(200, res)

        elif path == "/api/timetable/move_activity":
            if not body or "activity_id" not in body or "day" not in body or "hour" not in body:
                self._json(400, {"error": "Parametri mancanti: activity_id, day, hour"})
                return
            res = db.move_timetable_activity(body["activity_id"], body["day"], body["hour"], body.get("room"))
            self._json(200 if res.get("success") else 400, res)

        elif path == "/api/timetable/update_activity_desc":
            if not body or "activity_id" not in body:
                self._json(400, {"error": "Parametri mancanti: activity_id"})
                return
            res = db.update_activity_custom_desc(body["activity_id"], body.get("custom_desc", ""))
            self._json(200 if res.get("success") else 400, res)

        else:
            self._json(404, {"error": "Endpoint non trovato"})

    def do_DELETE(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        self._setup_request_school(query)

        user = self._require_auth()
        if not user:
            return

        base_ver = self.headers.get("X-Base-Version")
        user_email = user.get("email") if isinstance(user, dict) else None
        set_request_context(user_email=user_email, expected_version=base_ver)

        try:
            if path.startswith("/api/accorpamenti/rules/"):
                rid = unquote(path[len("/api/accorpamenti/rules/"):])
                ok = db.delete_accorpamenti_rule(rid)
                self._json(200 if ok else 404, {"success": ok, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/snapshots/"):
                sid = unquote(path[len("/api/snapshots/"):])
                ok = db.delete_snapshot(sid)
                self._json(200 if ok else 404, {"success": ok})

            elif path.startswith("/api/teachers/"):
                name = unquote(path[len("/api/teachers/"):])
                db.delete_teacher(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/classes/"):
                name = unquote(path[len("/api/classes/"):])
                db.delete_class(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/groups/"):
                name = unquote(path[len("/api/groups/"):])
                db.delete_group(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/subjects/"):
                name = unquote(path[len("/api/subjects/"):])
                db.delete_subject(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/rooms/"):
                name = unquote(path[len("/api/rooms/"):])
                db.delete_room(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/buildings/"):
                name = unquote(path[len("/api/buildings/"):])
                db.delete_building(name)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            elif path.startswith("/api/activities/"):
                aid = unquote(path[len("/api/activities/"):])
                db.delete_activity(aid)
                self._json(200, {"success": True, "data_version": db.data.get("data_version", 1)})

            else:
                self._json(404, {"error": "Endpoint non trovato"})
        except ConcurrentModificationError as e:
            self._json(409, {
                "error": "concurrent_modification_conflict",
                "message": f"I dati sono stati modificati da un altro utente ({e.last_modified_by}). Ricarica per sincronizzare.",
                "server_version": e.current_version,
                "last_modified_by": e.last_modified_by,
                "last_modified": e.last_modified
            })
        finally:
            clear_request_context()

    def do_PUT(self):
        parsed = urlparse(self.path)
        path = parsed.path
        query = parse_qs(parsed.query)
        self._setup_request_school(query)
        body = self._read_json()

        user = self._require_auth()
        if not user:
            return

        base_ver = self.headers.get("X-Base-Version") or (body.get("base_version") if isinstance(body, dict) else None)
        user_email = user.get("email") if isinstance(user, dict) else None
        set_request_context(user_email=user_email, expected_version=base_ver)

        try:
            if path.startswith("/api/teachers/"):
                name = unquote(path[len("/api/teachers/"):])
                ok = db.update_teacher(name, body or {})
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/classes/"):
                name = unquote(path[len("/api/classes/"):])
                ok = db.update_class(name, body or {})
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/groups/"):
                name = unquote(path[len("/api/groups/"):])
                ok = db.update_group(name, body or {})
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/subjects/"):
                name = unquote(path[len("/api/subjects/"):])
                ok = db.update_subject(name, body or {})
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/buildings/"):
                name = unquote(path[len("/api/buildings/"):])
                b = body or {}
                ok = db.update_building(name, b.get("name", name), b.get("short_code", "C"), b.get("comments", ""))
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/rooms/"):
                name = unquote(path[len("/api/rooms/"):])
                ok = db.update_room(name, body or {})
                self._json(200 if ok else 400, {"success": ok, "data_version": db.data.get("data_version", 1)})
            elif path.startswith("/api/activities/"):
                aid = unquote(path[len("/api/activities/"):])
                if body:
                    body["id"] = aid
                    saved = db.save_activity(body)
                    self._json(200, {"success": True, "activity": saved, "data_version": db.data.get("data_version", 1)})
                else:
                    self._json(400, {"error": "Dati mancanti"})
            elif path == "/api/timetable/place_disposizioni":
                res = db.place_disposizioni_in_timetable()
                self._json(200, res)
            else:
                self._json(404, {"error": "Endpoint non trovato"})
        except ConcurrentModificationError as e:
            self._json(409, {
                "error": "concurrent_modification_conflict",
                "message": f"I dati sono stati modificati da un altro utente ({e.last_modified_by}). Ricarica per sincronizzare.",
                "server_version": e.current_version,
                "last_modified_by": e.last_modified_by,
                "last_modified": e.last_modified
            })
        finally:
            clear_request_context()

    def _trigger_solve(self, timelimit, verbose=True, respond=True):
        fet_bin = find_fet_cl()
        if not fet_bin:
            if respond:
                self._json(500, {"error": "Binario 'fet-cl' non trovato sul server."})
            return False, "Binario 'fet-cl' non trovato sul server."

        target_sid = get_current_school_id()
        solver_state = get_solver_state(target_sid)
        solver_lock = get_solver_lock(target_sid)
        solver_dir = get_solver_dir(target_sid)

        user = self._get_current_user()
        user_email = user.get("email") if user else "utente"

        # Verifica se un calcolo è già in corso per questo istituto (stessa scuola)
        with solver_lock:
            old_proc = solver_state.get("process")
            if solver_state.get("running") and old_proc and old_proc.poll() is None:
                starter = solver_state.get("started_by") or "un altro utente"
                msg = f"Il calcolo dell'orario per questo istituto è già in corso (avviato da {starter}). Puoi seguire l'avanzamento in tempo reale dalla dashboard."
                if respond:
                    self._json(409, {
                        "error": "solver_already_running",
                        "message": msg,
                        "started_by": starter,
                        "school_id": target_sid,
                        "start_time": solver_state.get("start_time")
                    })
                return False, msg

            if old_proc and old_proc.poll() is None:
                kill_fet_process(old_proc, force=True)

        target_db = get_db(target_sid)
        all_data = target_db.get_all()
        xml_content = generate_fet_xml(all_data, include_timetable=False)
        input_file = os.path.join(solver_dir, "input_run.fet")
        output_dir = os.path.join(solver_dir, "output")

        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)
        os.makedirs(output_dir, exist_ok=True)

        with open(input_file, "w", encoding="utf-8") as f:
            f.write(xml_content)

        import re
        total_act = len(re.findall(r"<Activity>", xml_content, re.IGNORECASE))

        cmd = [
            fet_bin,
            f"--inputfile={input_file}",
            f"--outputdir={output_dir}",
            f"--timelimitseconds={timelimit}",
            f"--verbose={'true' if verbose else 'false'}"
        ]

        # Mappa attività per arricchimento log stile Desktop (ID -> {subject, teachers, students})
        acts_map = {str(a.get("id")): a for a in all_data.get("activities", [])}

        # Rileva attività bloccate dall'utente
        locked_set = set(str(x) for x in all_data.get("locked_activities", []))
        locked_acts = []
        for aid in locked_set:
            pl = all_data.get("timetable", {}).get(aid)
            act = acts_map.get(aid)
            if pl and act and not (act.get("subject") or "").strip().lower().startswith("disposiz"):
                d = pl.get("day", "")
                h = pl.get("hour", "")
                subj = act.get("subject", "")
                tch = ", ".join(act.get("teachers", []))
                cls_s = ", ".join(act.get("students", []))
                locked_acts.append({
                    "id": aid,
                    "desc": f"{subj} | {tch} ({cls_s}) -> {d} {h}ª ora",
                    "day": d,
                    "hour": h
                })

        # Preserva l'orario precedente valido per proteggerlo da interruzioni o timeout del solver
        backup_timetable = copy.deepcopy(target_db.data.get("timetable", {}))
        backup_has_timetable = bool(target_db.data.get("has_timetable", False) and len(backup_timetable) > 0)

        with solver_lock:
            if solver_state["running"] and solver_state["process"]:
                kill_fet_process(solver_state["process"], force=True)

            fet_env = dict(os.environ)
            fet_env["TZ"] = SERVER_TZ_NAME
            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1,
                    env=fet_env
                )
            except Exception as e:
                if respond:
                    self._json(500, {"error": f"Errore avvio fet-cl: {str(e)}"})
                return False, f"Errore avvio fet-cl: {str(e)}"

            solver_state["running"] = True
            solver_state["process"] = proc
            solver_state["started_by"] = user_email
            solver_state["school_id"] = target_sid
            solver_state["total_activities"] = total_act
            solver_state["placed_activities"] = 0
            solver_state["highest_placed"] = 0
            solver_state["swap_count"] = 0
            solver_state["percent"] = 0.0
            solver_state["start_time"] = time.time()
            solver_state["elapsed"] = 0.0
            
            now_ts = get_local_now().strftime("[%H:%M:%S]")
            init_logs = [
                f"{now_ts} 🚀 Avvio di fet-cl 7.12.0 su {total_act} attività (Modalità: {'Verbosa (Stile Desktop)' if verbose else 'Standard'})...",
                f"{now_ts} 📁 Cartella output: {output_dir}"
            ]
            if locked_acts:
                lbl = "1 attività fissata/bloccata" if len(locked_acts) == 1 else f"{len(locked_acts)} attività fissate/bloccate"
                init_logs.append(f"{now_ts} 🔒 {lbl} dall'utente (preservata permanentemente nel calcolo):")
                for la in locked_acts[:8]:
                    init_logs.append(f"{now_ts}    • #{la['id']} {la['desc']}")
                if len(locked_acts) > 8:
                    init_logs.append(f"{now_ts}    ... e altre {len(locked_acts) - 8} attività.")
            solver_state["logs"] = init_logs
            solver_state["raw_logs"] = [f"$ {' '.join(cmd)}"]
            solver_state["completed"] = False
            solver_state["success"] = False
            solver_state["stopped"] = False
            solver_state["current_activity"] = None
            solver_state["bottleneck"] = None
            solver_state["advisor_recommendations"] = []
            solver_state["advisor_report"] = None
            solver_state["recent_conflicts"] = []
            solver_state["verbose"] = verbose

        def log_solver_msg(msg):
            ts = get_local_now().strftime("[%H:%M:%S]")
            line = f"{ts} {msg}"
            with solver_lock:
                solver_state["logs"].append(line)
                if len(solver_state["logs"]) > 350:
                    solver_state["logs"] = solver_state["logs"][-350:]

        # Monitor thread
        def monitor_worker():
            file_open_logged = False
            last_advisor_check = 0
            last_heartbeat_time = time.time()
            while True:
                with solver_lock:
                    if not solver_state["running"]:
                        break

                    # 1. Controllo riepilogo da file_open.log appena generato
                    if not file_open_logged:
                        fo_files = glob.glob(os.path.join(output_dir, "**", "file_open.log"), recursive=True)
                        if fo_files and os.path.exists(fo_files[0]):
                            try:
                                with open(fo_files[0], "r", encoding="utf-8", errors="ignore") as fof:
                                    fo_text = fof.read()
                                added_items = re.findall(r"Added\s+(\d+\s+[\w\s]+)", fo_text)
                                if added_items:
                                    file_open_logged = True
                                    log_solver_msg(
                                        f"📋 Validazione input completata: {', '.join(added_items[:6])}"
                                    )
                            except Exception:
                                pass

                    # 2. Controllo record di attività collocate (highest stage)
                    sim_dirs = glob.glob(os.path.join(output_dir, "**"), recursive=True)
                    for d in sim_dirs:
                        m_file = os.path.join(d, "highest_number_of_activities.txt")
                        if not os.path.exists(m_file):
                            m_file = os.path.join(d, "max_placed_activities.txt")
                        if os.path.exists(m_file):
                            try:
                                with open(m_file, "r") as f:
                                    lines = [line.strip() for line in f if line.strip()]
                                    if lines:
                                        last_l = lines[-1]
                                        val = 0
                                        m_val = re.search(r"reached\s+(\d+)\s+activities", last_l)
                                        if m_val:
                                            val = int(m_val.group(1))
                                        elif last_l.isdigit():
                                            val = int(last_l)
                                        
                                        if val > solver_state["highest_placed"]:
                                            solver_state["highest_placed"] = val
                                            solver_state["placed_activities"] = max(solver_state["placed_activities"], val)
                                            if solver_state["total_activities"] > 0:
                                                solver_state["percent"] = round((solver_state["placed_activities"] / solver_state["total_activities"]) * 100, 1)
                                            log_solver_msg(
                                                f"⭐ [Record] Raggiunte {val} / {solver_state['total_activities']} attività collocate ({solver_state['percent']}%)"
                                            )
                            except Exception:
                                pass

                    solver_state["elapsed"] = round(time.time() - solver_state["start_time"], 1)

                    ret = proc.poll()
                    if ret is not None:
                        solver_state["running"] = False
                        solver_state["current_activity"] = None

                        candidates = glob.glob(os.path.join(output_dir, "**", "*_data_and_timetable.fet"), recursive=True)
                        if candidates:
                            solver_state["success"] = True
                            solver_state["percent"] = 100.0
                            solver_state["placed_activities"] = solver_state["total_activities"]
                            log_solver_msg(f"🎉 FET terminato con successo! File generato: {os.path.basename(candidates[0])}")
                            try:
                                with open(candidates[0], "r", encoding="utf-8", errors="ignore") as rf:
                                    target_db.save_solved_timetable_xml(rf.read())
                                log_solver_msg("Orario salvato e matrici visuali aggiornate!")
                                solver_state["has_timetable"] = True
                                if locked_acts:
                                    new_tt = target_db.data.get("timetable", {})
                                    verified = sum(1 for la in locked_acts if new_tt.get(la["id"], {}).get("day") == la["day"] and new_tt.get(la["id"], {}).get("hour") == la["hour"])
                                    log_solver_msg(f"🔒 Verifica ore fissate: {verified}/{len(locked_acts)} attività preservate al 100% nelle posizioni richieste!")
                                    for la in locked_acts:
                                        log_solver_msg(f"   ✔ #{la['id']} {la['desc']}")
                            except Exception as e:
                                log_solver_msg(f"Errore caricamento orario: {e}")
                        else:
                            # 1. Controllo errori / avvisi da errors.txt
                            err_files = glob.glob(os.path.join(output_dir, "**", "errors.txt"), recursive=True)
                            if err_files and os.path.exists(err_files[0]):
                                try:
                                    with open(err_files[0], "r", encoding="utf-8", errors="ignore") as ef:
                                        err_text = ef.read().strip()
                                    if err_text:
                                        log_solver_msg("=" * 65)
                                        log_solver_msg("⚠️ DIAGNOSTICA ERRORI / AVVISI SEGNALATI DA FET:")
                                        for eline in err_text.splitlines()[:20]:
                                            st = eline.strip()
                                            if st and not any(st.startswith(p) for p in ("Button", "Default", "Escape", "Pressing")):
                                                log_solver_msg(f"  {st}")
                                        log_solver_msg("=" * 65)
                                        solver_state["error"] = err_text
                                except Exception as e:
                                    log_solver_msg(f"Errore lettura errors.txt: {e}")

                            # 2. Diagnostica collo di bottiglia (difficult_activities.txt)
                            diff_files = glob.glob(os.path.join(output_dir, "**", "difficult_activities.txt"), recursive=True)
                            if diff_files and os.path.exists(diff_files[0]):
                                try:
                                    with open(diff_files[0], "r", encoding="utf-8", errors="ignore") as df:
                                        d_text = df.read()
                                    m_bot = re.search(r"Id:\s*(\d+)\s*\((.*?)\)", d_text)
                                    if m_bot:
                                        bot_id = m_bot.group(1)
                                        bot_desc = m_bot.group(2).strip()
                                        if "|" in bot_desc:
                                            parts = [p.strip() for p in bot_desc.split("|")]
                                            seen_b = set()
                                            uniq_b = []
                                            for p in parts:
                                                if p and p not in seen_b:
                                                    seen_b.add(p)
                                                    uniq_b.append(p)
                                            bot_desc = " | ".join(uniq_b)
                                        if len(bot_desc) > 160:
                                            bot_desc = bot_desc[:160] + "..."
                                        solver_state["bottleneck"] = {
                                            "id": bot_id,
                                            "description": bot_desc
                                        }
                                        log_solver_msg("=" * 65)
                                        log_solver_msg("🔍 DIAGNOSTICA FET DESKTOP — ATTIVITÀ COLLO DI BOTTIGLIA:")
                                        log_solver_msg(f"👉 Attività critica: #{bot_id} — {bot_desc}")
                                        log_solver_msg("💡 Suggerimento: verifica i vincoli orari/giorni per questo docente o classe.")
                                        log_solver_msg("=" * 65)
                                except Exception as e:
                                    log_solver_msg(f"Errore lettura diagnostica: {e}")

                            highest_candidates = glob.glob(os.path.join(output_dir, "**", "*highest*", "*.fet"), recursive=True)
                            if highest_candidates:
                                log_solver_msg(f"📁 Orario parziale (Highest Stage) salvato in: {os.path.basename(highest_candidates[0])}")

                            if solver_state["stopped"]:
                                log_solver_msg("⏹ Calcolo interrotto su richiesta dell'utente.")
                            else:
                                log_solver_msg(f"⏱️ FET terminato (codice {ret}). Nessun orario completo generato.")

                            # Garantisce la preservazione integrale dell'orario precedente senza scompaginare il sistema
                            if backup_has_timetable and backup_timetable:
                                with db.lock:
                                    db.data["timetable"] = backup_timetable
                                    db.data["has_timetable"] = True
                                    db._save_to_disk(db.data)
                                log_solver_msg("=" * 65)
                                log_solver_msg(f"🛡️ PROTEZIONE ORARIO: il calcolo non è terminato. L'orario precedente ({len(backup_timetable)} attività collocate) è stato mantenuto attivo e inalterato nel sistema.")
                                log_solver_msg("=" * 65)
                                solver_state["has_timetable"] = True
                            else:
                                solver_state["has_timetable"] = False

                            # Genera raccomandazioni dell'Advisor Intelligente in caso di soluzione incompleta
                            try:
                                adv_res = TimetableAdvisor.analyze_bottlenecks(db.get_all(), solver_dir=output_dir, solver_state=solver_state)
                                solver_state["advisor_report"] = adv_res
                                solver_state["advisor_recommendations"] = adv_res.get("recommendations", [])
                                if adv_res.get("root_cause_summary"):
                                    log_solver_msg("=" * 65)
                                    log_solver_msg("🎯 DIAGNOSI CAUSA RADICE DELL'ADVISOR INTELLIGENTE:")
                                    log_solver_msg(f"👉 {adv_res['root_cause_summary']}")
                                    log_solver_msg("=" * 65)
                                if adv_res.get("recommendations"):
                                    log_solver_msg(f"💡 Disponibili {len(adv_res['recommendations'])} opzioni di allentamento (Relax Search) applicabili in 1 click.")
                            except Exception:
                                pass
                        solver_state["completed"] = True
                        break

                    # Monitoraggio periodico colli di bottiglia durante l'elaborazione (se prolungata o molti swap)
                    now_t = time.time()
                    if (now_t - last_advisor_check > 8) and (solver_state["swap_count"] > 1200 or solver_state["elapsed"] > 20):
                        last_advisor_check = now_t
                        try:
                            adv_res = TimetableAdvisor.analyze_bottlenecks(db.get_all(), solver_dir=output_dir, solver_state=solver_state)
                            solver_state["advisor_report"] = adv_res
                            solver_state["advisor_recommendations"] = adv_res.get("recommendations", [])
                        except Exception:
                            pass

                    # Heartbeat periodico visivo ogni 3s per garantire avanzamento continuo anche nei cicli euristici intensi
                    if (now_t - last_heartbeat_time >= 3.0):
                        last_heartbeat_time = now_t
                        h_placed = solver_state.get("highest_placed", 0)
                        swaps = solver_state.get("swap_count", 0)
                        pct = solver_state.get("percent", 0.0)
                        el_sec = int(solver_state.get("elapsed", 0.0))
                        m_el, s_el = divmod(el_sec, 60)
                        time_str = f"{m_el:02d}:{s_el:02d}"
                        log_solver_msg(f"🔄 [Ricerca attiva] Stadio: {h_placed}/{total_act} ({pct}%) • Tempo: {time_str} • Scambi/Permutazioni: {swaps:,}")

                time.sleep(0.5)

        def stream_worker():
            try:
                pending_try_act = None
                last_stage = 0
                last_emit_time = 0

                for raw_line in iter(proc.stdout.readline, ''):
                    if not raw_line:
                        break
                    line = raw_line.strip()
                    if not line:
                        continue

                    now = time.time()
                    with solver_lock:
                        if len(solver_state["raw_logs"]) > 300:
                            solver_state["raw_logs"] = solver_state["raw_logs"][-300:]
                        solver_state["raw_logs"].append(line)

                    # Rileva passaggi di pre-elaborazione iniziale di FET per dare riscontro immediato
                    if "Processing internally the activities" in line:
                        log_solver_msg("📋 Elaborazione e verifica interna delle attività didattiche...")
                        continue
                    elif "Processing internally the time constraints" in line:
                        log_solver_msg("📋 Verifica vincoli temporali e disponibilità orarie...")
                        continue
                    elif "Processing internally the space constraints" in line:
                        log_solver_msg("📋 Verifica vincoli di spazio, aule e laboratori...")
                        continue
                    elif "Precomputing ... please wait" in line:
                        log_solver_msg("🔍 Precalcolo matrici di compatibilità e permutazioni...")
                        continue
                    elif "The order of activities" in line:
                        log_solver_msg("⚡ Ordine euristico attività stabilito.")
                        continue
                    elif line.startswith("Error:") or line.startswith("Fatal:"):
                        log_solver_msg(f"❌ {line}")
                        continue

                    # 1. "Trying to place activity number added_act==121"
                    m_try = re.search(r'Trying to place activity number added_act==(\d+)', line)
                    if m_try:
                        pending_try_act = int(m_try.group(1))
                        continue

                    # 2. "with id==278, from nInternalActivities==1263"
                    m_id = re.search(r'with id==(\d+)', line)
                    if m_id and pending_try_act is not None:
                        act_id = m_id.group(1)
                        stage_num = pending_try_act
                        pending_try_act = None

                        act = acts_map.get(act_id, {})
                        subj = act.get("subject", "N/D")
                        teachers = ", ".join(act.get("teachers", [])) or "Nessun docente"
                        classes = ", ".join(act.get("students", [])) or "N/D"

                        with solver_lock:
                            solver_state["current_activity"] = {
                                "id": act_id,
                                "subject": subj,
                                "teachers": teachers,
                                "classes": classes,
                                "stage": stage_num
                            }
                        if stage_num != last_stage or (now - last_emit_time > 0.25):
                            last_stage = stage_num
                            last_emit_time = now
                            log_solver_msg(
                                f"▶ [{stage_num}/{total_act}] Collocamento #{act_id}: {subj} | {teachers} ({classes})"
                            )
                        continue

                    # 3. Conflitti
                    m_confl = re.search(r'Confl activity id:(\d+).*?room of this activity:(.*)', line)
                    if m_confl:
                        cid = m_confl.group(1)
                        croom = m_confl.group(2).strip()
                        cact = acts_map.get(cid, {})
                        csubj = cact.get("subject", "N/D")
                        cclass = ", ".join(cact.get("students", []))
                        with solver_lock:
                            solver_state["swap_count"] += 1
                            r_conf = solver_state.setdefault("recent_conflicts", [])
                            r_conf.append(cid)
                            if len(r_conf) > 60:
                                solver_state["recent_conflicts"] = r_conf[-60:]
                        if now - last_emit_time > 0.35:
                            last_emit_time = now
                            log_solver_msg(
                                f"   ↳ ⚠️ Conflitto con #{cid} ({csubj} - {cclass}) su {croom} -> Scambio ricorsivo"
                            )
                        continue

                    # 4. Swap ricorsivo
                    m_warn = re.search(r'Warning - explored removal: id==(\d+).*?times==(\d+)', line)
                    if m_warn:
                        wid = m_warn.group(1)
                        wtimes = m_warn.group(2)
                        if now - last_emit_time > 0.45:
                            last_emit_time = now
                            log_solver_msg(
                                f"   ↳ 🔄 Rimozione ricorsiva #{wid} (profondità swap: {wtimes})"
                            )
                        continue

                    # 5. Generazione avviata / completata / timeout
                    if "Starting timetable generation" in line:
                        log_solver_msg("🚀 Avvio motore euristico di FET a scambio ricorsivo...")
                    elif "Time exceeded" in line:
                        log_solver_msg("⏱️ Tempo massimo raggiunto (Time exceeded).")
                    elif "Simulation successful" in line:
                        log_solver_msg("🎉 Soluzione completa trovata al 100%!")

                proc.stdout.close()
            except Exception as e:
                log_solver_msg(f"Errore lettura stream: {e}")

        threading.Thread(target=monitor_worker, daemon=True).start()
        threading.Thread(target=stream_worker, daemon=True).start()

        if respond:
            self._json(200, {"status": "started", "total_activities": total_act})
        return True, total_act

    def log_message(self, format, *args):
        # Disabilita log verbosi
        pass


def main():
    fet_info = get_fet_binary_info()
    fet_bin = fet_info["path"]
    print("=" * 70)
    print(f"  Eurario Web App - Suite Completa FET {FET_VERSION} (v{APP_VERSION})")
    print(f"  Autore: {APP_AUTHOR} • Mentore dell'Orario: {APP_MENTOR}")
    print(f"  AI Pair Programming: Google DeepMind Antigravity • Solver: FET Free Software")
    print("=" * 70)
    print(f"  • Host e Porta:       http://{HOST}:{PORT}")
    print(f"  • fet-cl solver:      {fet_bin or 'NON TROVATO'} [{fet_info['arch_label']}]")
    print(f"  • Database attivo:    {DATA_DIR}/current_project.json")
    print(f"  • Privacy & GDPR:     On-Premise / VM / VPS controllata (Titolare: Istituto)")
    print("=" * 70)
    print(f"  Server pronto. Apri Safari o Chrome su: http://localhost:{PORT}\n")

    server = ThreadingHTTPServer((HOST, PORT), EurarioHandler)

    def handle_shutdown(signum, frame):
        print(f"\nRicevuto segnale {signum}, arresto ordinato del server...")
        threading.Thread(target=server.shutdown).start()

    signal.signal(signal.SIGTERM, handle_shutdown)
    signal.signal(signal.SIGINT, handle_shutdown)

    try:
        server.serve_forever()
    except Exception:
        pass
    finally:
        server.server_close()
        print("Eurario Server arrestato con successo.")


if __name__ == "__main__":
    main()
