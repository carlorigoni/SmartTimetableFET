#!/usr/bin/env python3
"""
Eurario - Modulo Autenticazione OAuth Google & Controllo Accessi
Fornisce:
- Verifica Google ID Token (Google Identity Services / OpenID Connect)
- Gestione utenti e whitelist (Approvato, In Attesa, Rifiutato)
- Ruoli: admin, editor, viewer
- Notifiche all'amministratore (In-App + opzionale SMTP Email)
- Gestione sessioni sicure con cookie HTTP-only
100% standard library Python (Zero dipendenze esterne).
"""

import os
import sys
import json
import time
import secrets
import hashlib
import hmac
import smtplib
import ssl
import urllib.request
import urllib.parse
import zoneinfo
from datetime import datetime
from email.message import EmailMessage

# Assicura il fuso orario corretto coerente con l'ora locale del server (default: Europe/Rome)
SERVER_TZ_NAME = os.environ.get("TZ", "Europe/Rome")
try:
    SERVER_TZ = zoneinfo.ZoneInfo(SERVER_TZ_NAME)
except Exception:
    SERVER_TZ = None

def get_local_now() -> datetime:
    """Restituisce la data/ora corrente sincronizzata sul fuso orario locale del server (Europe/Rome)."""
    if SERVER_TZ is not None:
        return datetime.now(SERVER_TZ)
    return datetime.now()

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
AUTH_FILE = os.path.join(DATA_DIR, "auth_config.json")
LOGS_FILE = os.path.join(DATA_DIR, "access_logs.json")
MAX_LOG_ENTRIES = 1500
DEFAULT_ADMIN_EMAIL = os.environ.get("ADMIN_EMAIL", "admin@paperopoli.edu").lower().strip()
DEFAULT_GOOGLE_CLIENT_ID = os.environ.get("GOOGLE_CLIENT_ID", "").strip()
SMTP_ENABLED_ENV = os.environ.get("SMTP_ENABLED", "").lower() in ("1", "true", "yes")
SMTP_USER_ENV = os.environ.get("SMTP_USER", "").strip()
SMTP_PASSWORD_ENV = os.environ.get("SMTP_PASSWORD", "").strip()
SMTP_HOST_ENV = os.environ.get("SMTP_HOST", "smtp.gmail.com").strip()
SMTP_PORT_ENV = int(os.environ.get("SMTP_PORT", "587"))

# --- STRUTTURE PER PROTEZIONE BRUTE-FORCE SU PASSCODE DI EMERGENZA ---
FAILED_EMERGENCY_ATTEMPTS = {}  # ip -> list of float timestamps
EMERGENCY_IP_LOCKOUTS = {}      # ip -> float timestamp di fine blocco
MAX_FAILED_ATTEMPTS = 5
LOCKOUT_DURATION_SECONDS = 900  # 15 minuti di congelamento IP
PBKDF2_ITERATIONS = 600000

class AuthLockoutError(Exception):
    """Sollevata quando un IP viene bloccato per troppi tentativi consecutivi errati."""
    def __init__(self, message, retry_after=900):
        super().__init__(message)
        self.retry_after = retry_after

def hash_emergency_passcode(passcode: str, salt: str = None) -> str:
    """Deriva un hash PBKDF2-HMAC-SHA256 con 600.000 iterazioni e salt casuale crittografico (NIST/OWASP)."""
    if not passcode:
        raise ValueError("Passcode non valido")
    if not salt:
        salt = secrets.token_hex(16)
    derived = hashlib.pbkdf2_hmac(
        "sha256",
        passcode.encode("utf-8"),
        bytes.fromhex(salt),
        PBKDF2_ITERATIONS
    ).hex()
    return f"pbkdf2:sha256:{PBKDF2_ITERATIONS}${salt}${derived}"

def verify_emergency_passcode(passcode: str, stored_hash: str) -> bool:
    """Verifica a tempo costante (hmac.compare_digest) per scongiurare qualsiasi attacco di temporizzazione."""
    if not stored_hash or not passcode:
        return False
    # Supporto trasparente per migrazione da stringhe in chiaro legacy
    if not stored_hash.startswith("pbkdf2:"):
        return hmac.compare_digest(passcode, stored_hash)
    try:
        parts = stored_hash.split("$")
        if len(parts) != 3:
            return False
        alg_iter, salt_hex, expected_hex = parts
        _, _, iters = alg_iter.split(":")
        calculated_hex = hashlib.pbkdf2_hmac(
            "sha256",
            passcode.encode("utf-8"),
            bytes.fromhex(salt_hex),
            int(iters)
        ).hex()
        return hmac.compare_digest(calculated_hex, expected_hex)
    except Exception:
        return False


class AuthManager:
    def __init__(self):
        self.sessions = {}  # token -> {email, created_at, expires_at, is_passcode_auth, active_school_id}
        self.config = {
            "admin_email": DEFAULT_ADMIN_EMAIL,
            "superadmins": [DEFAULT_ADMIN_EMAIL],
            "school_memberships": {},  # email -> { school_id: { role, status, added_at } }
            "google_client_id": DEFAULT_GOOGLE_CLIENT_ID,
            "emergency_passcode": hash_emergency_passcode(os.environ.get("ADMIN_PASSCODE", "admin2026")),
            "must_change_passcode": True,
            "smtp": {
                "enabled": SMTP_ENABLED_ENV,
                "host": SMTP_HOST_ENV,
                "port": SMTP_PORT_ENV,
                "user": SMTP_USER_ENV,
                "password": SMTP_PASSWORD_ENV,
                "notify_to": DEFAULT_ADMIN_EMAIL
            },
            "users": {
                DEFAULT_ADMIN_EMAIL: {
                    "email": DEFAULT_ADMIN_EMAIL,
                    "name": "Amministratore",
                    "picture": "",
                    "role": "admin",
                    "status": "approved",
                    "created_at": get_local_now().isoformat(),
                    "approved_at": get_local_now().isoformat(),
                    "last_login": None
                }
            }
        }
        self._load()

    def _load(self):
        os.makedirs(DATA_DIR, exist_ok=True)
        if os.path.exists(AUTH_FILE):
            try:
                with open(AUTH_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, dict):
                        # Merge configuration
                        self.config["admin_email"] = data.get("admin_email", self.config["admin_email"]).lower().strip()
                        self.config["superadmins"] = [s.lower().strip() for s in data.get("superadmins", [self.config["admin_email"]])]
                        if self.config["admin_email"] not in self.config["superadmins"]:
                            self.config["superadmins"].append(self.config["admin_email"])
                        self.config["school_memberships"] = data.get("school_memberships", {})
                        self.config["google_client_id"] = data.get("google_client_id", self.config["google_client_id"]).strip()
                        stored_pass = data.get("emergency_passcode", self.config["emergency_passcode"])
                        must_change = data.get("must_change_passcode", None)
                        # Migrazione trasparente: se in chiaro, esegui hash PBKDF2 e forza cambio se default
                        if not stored_pass.startswith("pbkdf2:"):
                            is_default = (stored_pass == "admin2026" or stored_pass == os.environ.get("ADMIN_PASSCODE", "admin2026"))
                            if is_default or must_change is None:
                                must_change = is_default
                            self.config["emergency_passcode"] = hash_emergency_passcode(stored_pass)
                            self.config["must_change_passcode"] = bool(must_change)
                            self._save()
                        else:
                            self.config["emergency_passcode"] = stored_pass
                            if must_change is None:
                                must_change = verify_emergency_passcode("admin2026", stored_pass)
                            self.config["must_change_passcode"] = bool(must_change)
                        self.config["smtp"] = {**self.config["smtp"], **data.get("smtp", {})}
                        # Override con variabili d'ambiente se presenti
                        if SMTP_USER_ENV:
                            self.config["smtp"]["user"] = SMTP_USER_ENV
                        if SMTP_PASSWORD_ENV:
                            self.config["smtp"]["password"] = SMTP_PASSWORD_ENV
                        if SMTP_ENABLED_ENV:
                            self.config["smtp"]["enabled"] = True
                        users = data.get("users", {})
                        # Assicura che l'admin esista sempre e sia approvato
                        admin = self.config["admin_email"]
                        if admin not in users:
                            users[admin] = {
                                "email": admin,
                                "name": "Amministratore",
                                "picture": "",
                                "role": "admin",
                                "status": "approved",
                                "created_at": get_local_now().isoformat(),
                                "approved_at": get_local_now().isoformat(),
                                "last_login": None
                            }
                        else:
                            users[admin]["role"] = "admin"
                            users[admin]["status"] = "approved"
                        self.config["users"] = users
            except Exception as e:
                print(f"[AUTH] Avviso: errore nel caricamento di {AUTH_FILE}: {e}")
        else:
            self._save()

    def _save(self):
        try:
            os.makedirs(DATA_DIR, exist_ok=True)
            temp_file = AUTH_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(self.config, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, AUTH_FILE)
        except Exception as e:
            print(f"[AUTH] Errore nel salvataggio di {AUTH_FILE}: {e}")

    # --- ACCESS LOGGING (AUDIT TRAIL) ---

    def log_access(self, event, email, role, status, ip=None, user_agent=None, details=""):
        try:
            now_str = get_local_now().strftime("%Y-%m-%d %H:%M:%S")
            entry = {
                "timestamp": now_str,
                "event": str(event),
                "email": str(email or "-"),
                "role": str(role or "-"),
                "status": str(status),  # "SUCCESS", "FAILED", "DENIED", "INFO"
                "ip": str(ip or "-"),
                "user_agent": str(user_agent or "-")[:120],
                "details": str(details or "")
            }
            logs = self._load_logs()
            logs.append(entry)
            if len(logs) > MAX_LOG_ENTRIES:
                logs = logs[-MAX_LOG_ENTRIES:]
            self._save_logs(logs)
        except Exception as e:
            print(f"[AUTH LOG] Errore registrazione log: {e}")

    def _load_logs(self):
        if os.path.exists(LOGS_FILE):
            try:
                with open(LOGS_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
                    if isinstance(data, list):
                        return data
            except Exception:
                pass
        return []

    def _save_logs(self, logs):
        try:
            temp_file = LOGS_FILE + ".tmp"
            with open(temp_file, "w", encoding="utf-8") as f:
                json.dump(logs, f, indent=2, ensure_ascii=False)
            os.replace(temp_file, LOGS_FILE)
        except Exception as e:
            print(f"[AUTH LOG] Errore salvataggio {LOGS_FILE}: {e}")

    def get_access_logs(self, limit=250):
        logs = self._load_logs()
        return list(reversed(logs[-limit:]))

    def clear_access_logs(self, admin_email=None, ip=None):
        self._save_logs([])
        self.log_access("LOGS_CLEARED", admin_email or "admin", "admin", "INFO", ip, "-", "Registro accessi azzerato dall'amministratore")
        return True

    # --- SESSION MANAGEMENT & ROLES ---

    def is_superadmin(self, email, is_passcode_auth=False):
        """Restituisce True se l'utente ha privilegi globali di SuperAdmin della piattaforma."""
        if is_passcode_auth:
            return True
        clean = (email or "").lower().strip()
        if not clean:
            return False
        admin_clean = self.config.get("admin_email", "").lower().strip()
        if clean == admin_clean:
            return True
        superadmins = [s.lower().strip() for s in self.config.get("superadmins", [])]
        return clean in superadmins

    def is_school_admin(self, email, school_id, is_passcode_auth=False):
        """
        Restituisce True se l'utente è amministratore per la specifica scuola:
        - Il SuperAdmin globale ha poteri di amministrazione su qualsiasi scuola.
        - L'owner/creatore della scuola in schools.json è amministratore della sua scuola.
        - Un utente con membership per la scuola con ruolo 'admin' o 'owner' ed approvato.
        """
        if self.is_superadmin(email, is_passcode_auth):
            return True
        clean = (email or "").lower().strip()
        if not clean or not school_id or school_id in ("none", "-"):
            return False
        self._load()
        try:
            from webapp.schools import school_manager
            sch = school_manager.get_school(school_id)
            if sch and sch.get("owner_email", "").lower().strip() == clean:
                return True
        except Exception:
            pass
        mem = self.config.get("school_memberships", {}).get(clean, {}).get(school_id, {})
        if mem and mem.get("role") in ("admin", "owner") and mem.get("status") == "approved":
            return True
        return False

    def get_user_school_role(self, email, school_id, is_passcode_auth=False):
        """Restituisce il ruolo dell'utente per la specifica scuola ('admin', 'editor', 'viewer')."""
        if self.is_superadmin(email, is_passcode_auth):
            return "admin"
        clean = (email or "").lower().strip()
        if not clean or not school_id:
            return "viewer"
        self._load()
        try:
            from webapp.schools import school_manager
            sch = school_manager.get_school(school_id)
            if sch and sch.get("owner_email", "").lower().strip() == clean:
                return "admin"
        except Exception:
            pass
        mem = self.config.get("school_memberships", {}).get(clean, {}).get(school_id, {})
        role = mem.get("role")
        if role in ("admin", "owner"):
            return "admin"
        elif role == "editor":
            return "editor"
        elif role == "viewer":
            return "viewer"
        return self.config.get("users", {}).get(clean, {}).get("role", "viewer")

    def create_session(self, email, is_passcode_auth=False, active_school_id=None):
        token = secrets.token_urlsafe(32)
        now = time.time()
        clean = (email or "").lower().strip()
        if not active_school_id:
            if self.is_superadmin(clean, is_passcode_auth):
                active_school_id = "default"
            else:
                mems = list(self.config.get("school_memberships", {}).get(clean, {}).keys())
                if mems:
                    active_school_id = mems[0]
                else:
                    active_school_id = "none"
        self.sessions[token] = {
            "email": clean,
            "is_passcode_auth": bool(is_passcode_auth),
            "active_school_id": str(active_school_id or "default").strip(),
            "created_at": now,
            "expires_at": now + (86400 * 30)  # 30 giorni
        }
        return token

    def get_user_by_session(self, token):
        if not token or token not in self.sessions:
            return None
        sess = self.sessions[token]
        if time.time() > sess.get("expires_at", 0):
            del self.sessions[token]
            return None
        email = sess.get("email")
        self._load()
        user = self.config["users"].get(email)
        if not user:
            # Fallback se autenticato via passcode ma record utente non presente
            user = {
                "email": email,
                "name": "Super Amministratore",
                "role": "admin",
                "status": "approved",
                "picture": "",
                "created_at": get_local_now().isoformat()
            }
        u = dict(user)
        is_passcode = bool(sess.get("is_passcode_auth", False))
        active_sid = sess.get("active_school_id", "default")
        u["is_superadmin"] = self.is_superadmin(email, is_passcode)
        u["active_school_id"] = active_sid
        u["is_school_admin"] = self.is_school_admin(email, active_sid, is_passcode)
        u["school_role"] = self.get_user_school_role(email, active_sid, is_passcode)
        # Se è school admin o superadmin, il ruolo effettivo di sessione per le operazioni è admin
        if u["is_school_admin"] or u["is_superadmin"]:
            u["role"] = "admin"
        else:
            u["role"] = u["school_role"]
        return u

    def set_session_school(self, token, school_id):
        if token and token in self.sessions:
            self.sessions[token]["active_school_id"] = str(school_id or "default").strip()
            return True
        return False

    def get_user_memberships(self, email):
        self._load()
        clean = (email or "").lower().strip()
        return self.config.get("school_memberships", {}).get(clean, {})

    def add_user_to_school(self, email, school_id, role="editor", status="approved"):
        self._load()
        clean = (email or "").lower().strip()
        if not clean or not school_id:
            return
        mems = self.config.setdefault("school_memberships", {})
        user_mems = mems.setdefault(clean, {})
        user_mems[school_id] = {
            "role": role,
            "status": status,
            "added_at": get_local_now().isoformat()
        }
        self._save()

    def remove_user_from_school(self, email, school_id):
        self._load()
        clean = (email or "").lower().strip()
        mems = self.config.setdefault("school_memberships", {})
        if clean in mems and school_id in mems[clean]:
            del mems[clean][school_id]
            self._save()

    def destroy_session(self, token, ip=None, user_agent=None):
        if token in self.sessions:
            email = self.sessions[token].get("email")
            u = self.config["users"].get(email, {})
            self.log_access("LOGOUT", email, u.get("role", "-"), "SUCCESS", ip, user_agent, "Disconnessione utente (Logout)")
            del self.sessions[token]

    # --- GOOGLE TOKEN VERIFICATION ---

    def verify_google_id_token(self, id_token):
        """
        Verifica crittograficamente l'ID token tramite endpoint ufficiale Google.
        """
        if not id_token or not isinstance(id_token, str):
            raise ValueError("Token ID mancante o formato non valido")

        url = f"https://oauth2.googleapis.com/tokeninfo?id_token={urllib.parse.quote(id_token.strip())}"
        req = urllib.request.Request(
            url,
            headers={"User-Agent": "Eurario-Auth/1.0"}
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Impossibile verificare il token con Google: {e}")

        # Controlli di sicurezza
        email = data.get("email", "").lower().strip()
        if not email:
            raise ValueError("Il token Google non contiene un indirizzo email")

        verified = data.get("email_verified")
        if verified not in (True, "true", "True", 1):
            raise ValueError("L'email Google non risulta verificata")

        expected_aud = self.config.get("google_client_id", "").strip()
        if expected_aud and data.get("aud") != expected_aud:
            # Se è impostato un client ID, deve coincidere
            raise ValueError("Il Client ID del token non coincide con quello configurato per Eurario")

        return {
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture", ""),
            "sub": data.get("sub", "")
        }

    def verify_google_access_token(self, access_token):
        """
        Verifica un Google OAuth2 Access Token richiedendo i dati utente a Google userinfo.
        Fornisce fallback ideale per il flusso prompt='select_account' se il popup FedCM è bloccato.
        """
        if not access_token or not isinstance(access_token, str):
            raise ValueError("Access token Google mancante o non valido")

        url = "https://www.googleapis.com/oauth2/v3/userinfo"
        req = urllib.request.Request(
            url,
            headers={
                "User-Agent": "Eurario-Auth/1.0",
                "Authorization": f"Bearer {access_token.strip()}"
            }
        )
        try:
            with urllib.request.urlopen(req, timeout=10) as resp:
                data = json.loads(resp.read().decode("utf-8"))
        except Exception as e:
            raise ValueError(f"Impossibile verificare l'access token con Google: {e}")

        email = data.get("email", "").lower().strip()
        if not email:
            raise ValueError("I dati profilo Google non contengono un indirizzo email")

        verified = data.get("email_verified")
        if verified not in (True, "true", "True", 1):
            raise ValueError("L'indirizzo email Google non risulta verificato")

        return {
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture", ""),
            "sub": data.get("sub", "")
        }

    # --- LOGIN & REQUEST ACCESS WORKFLOW ---

    def handle_google_login(self, id_token=None, access_token=None, ip=None, user_agent=None):
        """
        Autentica un utente tramite Google ID Token oppure OAuth2 Access Token.
        Se l'utente non esiste, registra la richiesta con stato 'pending'.
        Se è l'admin, lo approva automaticamente.
        """
        try:
            if access_token:
                user_info = self.verify_google_access_token(access_token)
            elif id_token:
                user_info = self.verify_google_id_token(id_token)
            else:
                raise ValueError("Nessun token Google (ID token o access token) fornito")
        except Exception as e:
            self.log_access("GOOGLE_LOGIN_FAIL", "-", "anonymous", "FAILED", ip, user_agent, f"Token Google non valido o errore: {e}")
            raise

        email = user_info["email"]
        now_iso = get_local_now().isoformat()

        is_admin = (email == self.config["admin_email"].lower().strip())
        is_new_request = False

        if email not in self.config["users"]:
            # Nuovo utente che richiede l'accesso
            status = "approved" if is_admin else "pending"
            role = "admin" if is_admin else "editor"
            self.config["users"][email] = {
                "email": email,
                "name": user_info["name"],
                "picture": user_info["picture"],
                "role": role,
                "status": status,
                "created_at": now_iso,
                "approved_at": now_iso if status == "approved" else None,
                "last_login": now_iso if status == "approved" else None
            }
            is_new_request = not is_admin
            self._save()
        else:
            # Utente già registrato: aggiorna nome/foto se cambiati
            u = self.config["users"][email]
            if user_info["picture"]:
                u["picture"] = user_info["picture"]
            if user_info["name"] and user_info["name"] != email:
                u["name"] = user_info["name"]
            if is_admin:
                u["status"] = "approved"
                u["role"] = "admin"
            elif u.get("status") == "rejected":
                # L'UTENTE ERA STATO REVOCATO / RIFIUTATO IN PASSATO:
                # Il nuovo tentativo di accesso riattiva lo stato 'pending',
                # aggiorna la data di richiesta e notifica l'amministratore!
                u["status"] = "pending"
                u["created_at"] = now_iso
                u["approved_at"] = None
                u["was_previously_rejected"] = True
                is_new_request = True
            elif u.get("status") == "approved":
                u["last_login"] = now_iso
            self._save()

        user = dict(self.config["users"][email])

        # Se è una nuova richiesta da un utente terzo, invia notifica email se configurata
        if is_new_request:
            self._notify_admin_email(user)

        session_token = None
        if user["status"] == "approved":
            session_token = self.create_session(email)
            self.log_access("LOGIN_SUCCESS", email, user["role"], "SUCCESS", ip, user_agent, f"Accesso Google OAuth riuscito ({user['role']})")
        elif user["status"] == "pending":
            self.log_access("LOGIN_PENDING", email, "pending", "DENIED", ip, user_agent, "Richiesta di accesso registrata: in attesa di approvazione")
        elif user["status"] == "rejected":
            self.log_access("LOGIN_REJECTED", email, "rejected", "DENIED", ip, user_agent, "Accesso bloccato: account revocato o non autorizzato")

        return {
            "session_token": session_token,
            "user": user,
            "is_new_request": is_new_request
        }

    def handle_emergency_login(self, passcode, ip=None, user_agent=None):
        """
        Accesso di emergenza / fallback locale con passcode amministratore.
        Implementa:
        1. Controllo lockout IP (max 5 errori in 15 min -> blocco 15 min).
        2. Tarpit esponenziale progressivo (1s, 2s, 4s, 8s) per rallentare bot.
        3. Verifica crittografica PBKDF2-HMAC-SHA256 con confronto a tempo costante.
        4. Segnalazione obbligatoria 'must_change_passcode' al primo accesso con password predefinita.
        """
        now = time.time()
        client_ip = (ip or "127.0.0.1").strip()

        # Pulizia vecchi tentativi (> 15 min)
        if client_ip in FAILED_EMERGENCY_ATTEMPTS:
            FAILED_EMERGENCY_ATTEMPTS[client_ip] = [
                t for t in FAILED_EMERGENCY_ATTEMPTS[client_ip]
                if now - t < LOCKOUT_DURATION_SECONDS
            ]
            if not FAILED_EMERGENCY_ATTEMPTS[client_ip]:
                del FAILED_EMERGENCY_ATTEMPTS[client_ip]

        # 1. Verifica se l'IP è attualmente bloccato
        lockout_until = EMERGENCY_IP_LOCKOUTS.get(client_ip, 0)
        if now < lockout_until:
            remaining = int(lockout_until - now)
            self.log_access("EMERGENCY_LOGIN_BLOCKED", "admin", "anonymous", "DENIED", client_ip, user_agent, f"Accesso respinto: IP bloccato per brute-force ({remaining}s rimanenti)")
            raise AuthLockoutError(f"Accesso di emergenza temporaneamente bloccato per troppi tentativi falliti. Riprova tra {remaining} secondi.", retry_after=remaining)

        # 2. Tarpit: ritardo progressivo in base agli errori consecutivi
        recent_fails = len(FAILED_EMERGENCY_ATTEMPTS.get(client_ip, []))
        if recent_fails > 0:
            delay = min(8.0, 1.0 * (2 ** (recent_fails - 1)))
            time.sleep(delay)

        # 3. Verifica crittografica passcode
        self._load()
        stored_hash = self.config.get("emergency_passcode", "")
        if not passcode or not verify_emergency_passcode(passcode, stored_hash):
            if client_ip not in FAILED_EMERGENCY_ATTEMPTS:
                FAILED_EMERGENCY_ATTEMPTS[client_ip] = []
            FAILED_EMERGENCY_ATTEMPTS[client_ip].append(now)
            current_count = len(FAILED_EMERGENCY_ATTEMPTS[client_ip])

            if current_count >= MAX_FAILED_ATTEMPTS:
                EMERGENCY_IP_LOCKOUTS[client_ip] = now + LOCKOUT_DURATION_SECONDS
                self.log_access("SECURITY_ALERT_BRUTEFORCE", "admin", "anonymous", "BLOCKED", client_ip, user_agent, f"Attacco a forza bruta rilevato: IP {client_ip} congelato per {LOCKOUT_DURATION_SECONDS // 60} minuti.")
                self._notify_admin_security_alert(client_ip, user_agent)
                raise AuthLockoutError(f"Troppi tentativi errati: accesso di emergenza bloccato per {LOCKOUT_DURATION_SECONDS // 60} minuti.", retry_after=LOCKOUT_DURATION_SECONDS)

            remaining = MAX_FAILED_ATTEMPTS - current_count
            self.log_access("EMERGENCY_LOGIN_FAIL", "admin", "anonymous", "FAILED", client_ip, user_agent, f"Tentativo fallito con passcode master ({remaining} tentativi rimasti)")
            raise ValueError(f"Passcode di emergenza errato. Tentativi rimasti prima del blocco temporaneo: {remaining}")

        # Accesso riuscito: reset contatori fallimenti per questo IP
        FAILED_EMERGENCY_ATTEMPTS.pop(client_ip, None)
        EMERGENCY_IP_LOCKOUTS.pop(client_ip, None)

        admin_email = self.config["admin_email"]
        session_token = self.create_session(admin_email, is_passcode_auth=True)
        user = dict(self.config["users"].get(admin_email, {
            "email": admin_email,
            "name": "Super Amministratore",
            "role": "admin",
            "status": "approved"
        }))
        user["is_superadmin"] = True
        user["active_school_id"] = "default"
        user["last_login"] = get_local_now().isoformat()
        if admin_email in self.config["users"]:
            self.config["users"][admin_email]["last_login"] = user["last_login"]
            self._save()
        self.log_access("EMERGENCY_LOGIN", admin_email, "admin", "SUCCESS", client_ip, user_agent, "Accesso riuscito con passcode master")

        must_change = self.config.get("must_change_passcode", False)
        return {
            "session_token": session_token,
            "user": user,
            "must_change_passcode": must_change
        }

    def change_emergency_passcode(self, old_passcode, new_passcode, ip=None, user_agent=None):
        """
        Modifica sicura del passcode master di emergenza.
        Valida complessità minima (minimo 8 caratteri, diverso da admin2026).
        """
        self._load()
        stored_hash = self.config.get("emergency_passcode", "")

        # Se fornito il vecchio passcode, verifichiamo la sua validità
        if old_passcode:
            if not verify_emergency_passcode(old_passcode, stored_hash):
                self.log_access("CHANGE_PASSCODE_FAIL", "admin", "admin", "FAILED", ip, user_agent, "Fallita modifica passcode: vecchio passcode errato")
                raise ValueError("Il passcode attuale inserito non è corretto")

        clean_new = (new_passcode or "").strip()
        if len(clean_new) < 8:
            raise ValueError("Il nuovo passcode deve contenere almeno 8 caratteri")
        if clean_new.lower() in ("admin2026", "password", "12345678", "admin", "eurario"):
            raise ValueError("Il passcode scelto è troppo semplice o corrisponde al default di fabbrica. Scegli una passphrase più sicura.")
        if old_passcode and clean_new == old_passcode:
            raise ValueError("Il nuovo passcode deve essere diverso dal precedente")

        self.config["emergency_passcode"] = hash_emergency_passcode(clean_new)
        self.config["must_change_passcode"] = False
        self._save()

        admin_email = self.config.get("admin_email", "admin")
        self.log_access("EMERGENCY_PASSCODE_CHANGED", admin_email, "admin", "SUCCESS", ip, user_agent, "Passcode master aggiornato e protetto con hash PBKDF2")
        return True

    def handle_access_request(self, email, name=None, ip=None, user_agent=None):
        """
        Registra una richiesta di accesso esplicita da parte di un nuovo utente o docente
        (ad es. inserendo nome ed email Google nel modulo di richiesta sblocco).
        Se non presente, lo registra con stato 'pending' e allerta l'amministratore.
        """
        clean_email = (email or "").lower().strip()
        if not clean_email or "@" not in clean_email or "." not in clean_email.split("@")[-1]:
            raise ValueError("Indirizzo email non valido")

        clean_name = (name or "").strip() or clean_email.split("@")[0]
        self._load()

        is_admin = (clean_email == self.config["admin_email"].lower().strip())
        now_iso = get_local_now().isoformat()

        if clean_email not in self.config["users"]:
            status = "approved" if is_admin else "pending"
            role = "admin" if is_admin else "editor"
            self.config["users"][clean_email] = {
                "email": clean_email,
                "name": clean_name,
                "picture": "",
                "role": role,
                "status": status,
                "created_at": now_iso,
                "approved_at": now_iso if status == "approved" else None,
                "last_login": None
            }
            self._save()
            user = dict(self.config["users"][clean_email])
            if not is_admin:
                self._notify_admin_email(user)
            self.log_access("REQUEST_ACCESS", clean_email, role, "INFO", ip, user_agent, f"Richiesta abilitazione inviata per {clean_name}")
            return {
                "ok": True,
                "status": status,
                "user": user,
                "is_new_request": True,
                "message": "Richiesta inviata all'amministratore con successo."
            }
        else:
            user = self.config["users"][clean_email]
            if clean_name and (user.get("name") == clean_email.split("@")[0] or not user.get("name")):
                user["name"] = clean_name

            # Se l'utente era stato revocato/rifiutato in passato, o sollecita l'accesso:
            if user.get("status") == "rejected":
                user["status"] = "pending"
                user["created_at"] = now_iso
                user["approved_at"] = None
                user["was_previously_rejected"] = True
                self._save()
                if not is_admin:
                    self._notify_admin_email(user)
                self.log_access("REQUEST_ACCESS_RENEW", clean_email, user.get("role", "editor"), "INFO", ip, user_agent, f"Richiesta di riabilitazione accesso per utente precedentemente revocato ({clean_name})")
                return {
                    "ok": True,
                    "status": "pending",
                    "user": user,
                    "is_new_request": True,
                    "message": "Richiesta di riabilitazione inviata all'amministratore con successo."
                }
            elif user.get("status") == "pending":
                user["created_at"] = now_iso
                self._save()
                if not is_admin:
                    self._notify_admin_email(user)
                self.log_access("REQUEST_ACCESS_REPEAT", clean_email, user.get("role", "editor"), "INFO", ip, user_agent, f"Sollecito richiesta accesso per {clean_name}")
                return {
                    "ok": True,
                    "status": "pending",
                    "user": user,
                    "is_new_request": True,
                    "message": "Richiesta rinnovata: in attesa di autorizzazione da parte dell'amministratore."
                }
            else:
                self._save()
                self.log_access("REQUEST_ACCESS_APPROVED", clean_email, user.get("role", "editor"), "INFO", ip, user_agent, f"Richiesta accesso da account già autorizzato ({clean_name})")
                return {
                    "ok": True,
                    "status": "approved",
                    "user": user,
                    "is_new_request": False,
                    "message": f"Account già registrato con stato: {user.get('status')}"
                }

    # --- USER APPROVAL / REJECTION ACTIONS ---

    def list_users(self, school_id=None, requesting_user=None):
        """
        Restituisce la lista degli utenti visibili all'utente richiedente:
        - Se richiedente è SuperAdmin e school_id è None:
            restituisce la console globale con tutti gli utenti della piattaforma + config.
        - Se school_id è specificato o se il richiedente è un Amministratore di Scuola:
            restituisce SOLO gli utenti associati a quella specifica scuola.
            REGOLA FONDAMENTALE: IL SUPERADMIN NON COMPARE MAI nella lista degli utenti di una scuola!
            Il ruolo visualizzato per ciascun utente è il ruolo specifico per QUELLA scuola.
        """
        self._load()
        is_super = False
        req_email = None
        if requesting_user:
            req_email = (requesting_user.get("email") or "").lower().strip()
            is_passcode = bool(requesting_user.get("is_passcode_auth", False))
            is_super = self.is_superadmin(req_email, is_passcode)

        super_emails = set(s.lower().strip() for s in self.config.get("superadmins", []))
        super_emails.add(self.config.get("admin_email", "").lower().strip())

        # Se non è SuperAdmin e non è specificata school_id, isola sulla scuola attiva
        if not is_super and not school_id and requesting_user:
            school_id = requesting_user.get("active_school_id")

        mems = self.config.get("school_memberships", {})
        users_dict = self.config.get("users", {})

        # Vista Scuola (School Admin o filtro scuola)
        if school_id and school_id not in ("none", "-"):
            from webapp.schools import school_manager
            sch = school_manager.get_school(school_id)
            sch_owner = (sch.get("owner_email") or "").lower().strip() if sch else ""

            candidate_emails = set()
            for em, sm_dict in mems.items():
                if school_id in sm_dict:
                    candidate_emails.add(em)
            if sch_owner:
                candidate_emails.add(sch_owner)

            school_users = []
            for em in candidate_emails:
                # REGOLA TASSATIVA: il SuperAdmin NON compare MAI nella lista degli utenti gestiti della scuola
                if em in super_emails:
                    continue

                u_base = users_dict.get(em, {
                    "email": em,
                    "name": em.split("@")[0].title(),
                    "picture": "",
                    "status": "approved",
                    "created_at": None,
                    "last_login": None
                })
                u_copy = dict(u_base)

                # Ruolo specifico nella scuola
                mem_info = mems.get(em, {}).get(school_id, {})
                if em == sch_owner:
                    sch_role = "admin"
                    status = "approved"
                elif mem_info:
                    sch_role = mem_info.get("role", "editor")
                    if sch_role == "owner":
                        sch_role = "admin"
                    status = mem_info.get("status", "approved")
                else:
                    sch_role = u_base.get("role", "editor")
                    status = u_base.get("status", "approved")

                u_copy["role"] = sch_role
                u_copy["status"] = status
                u_copy["school_id"] = school_id
                u_copy["is_school_owner"] = (em == sch_owner)
                school_users.append(u_copy)

            school_users.sort(key=lambda u: (
                0 if u.get("is_school_owner") else (1 if u.get("role") == "admin" else 2),
                0 if u.get("status") == "pending" else 1,
                u.get("name") or u.get("email")
            ))

            return {
                "is_school_view": True,
                "school_id": school_id,
                "school_name": sch.get("name") if sch else school_id,
                "users": school_users,
                "pending_count": sum(1 for u in school_users if u.get("status") == "pending"),
                "is_superadmin": is_super
            }

        # Vista Globale SuperAdmin
        from webapp.schools import school_manager
        users_list = []
        for em, u in users_dict.items():
            u_copy = dict(u)
            u_copy["is_superadmin"] = (em in super_emails)

            # Dettaglio ricco di tutte le scuole associate all'utente e del relativo ruolo
            user_mems_list = []
            for sid, m_data in mems.get(em, {}).items():
                sch = school_manager.get_school(sid)
                sch_name = sch.get("name") if sch else sid
                is_owner = bool(sch and (sch.get("owner_email") or "").lower().strip() == em)
                role = "admin" if is_owner else m_data.get("role", "viewer")
                user_mems_list.append({
                    "school_id": sid,
                    "school_name": sch_name,
                    "role": role,
                    "status": m_data.get("status", "approved"),
                    "is_owner": is_owner
                })
            # Se è owner di una scuola che non è ancora esplicitamente in mems
            for sid, sch in school_manager.schools.items():
                if (sch.get("owner_email") or "").lower().strip() == em:
                    if not any(m["school_id"] == sid for m in user_mems_list):
                        user_mems_list.append({
                            "school_id": sid,
                            "school_name": sch.get("name", sid),
                            "role": "admin",
                            "status": "approved",
                            "is_owner": True
                        })
            u_copy["school_memberships"] = user_mems_list
            u_copy["schools"] = [m["school_id"] for m in user_mems_list]
            users_list.append(u_copy)

        users_list.sort(key=lambda u: (
            0 if u.get("status") == "pending" else 1,
            0 if u.get("is_superadmin") else 1,
            u.get("created_at") or ""
        ), reverse=False)

        return {
            "is_school_view": False,
            "admin_email": self.config["admin_email"],
            "google_client_id": self.config["google_client_id"],
            "pending_count": sum(1 for u in users_list if u.get("status") == "pending"),
            "users": users_list,
            "is_superadmin": True,
            "config": {
                "smtp": {
                    "enabled": self.config["smtp"].get("enabled", False),
                    "host": self.config["smtp"].get("host", "smtp.gmail.com"),
                    "port": self.config["smtp"].get("port", 587),
                    "user": self.config["smtp"].get("user", ""),
                    "password": self.config["smtp"].get("password", ""),
                    "notify_to": self.config["smtp"].get("notify_to", self.config["admin_email"])
                },
                "emergency_passcode": "••••••••" if self.config.get("emergency_passcode") else "",
                "must_change_passcode": self.config.get("must_change_passcode", False)
            }
        }

    def send_test_email(self):
        self._load()
        smtp = self.config.get("smtp", {})
        to_email = smtp.get("notify_to") or self.config["admin_email"]
        host = smtp.get("host", "smtp.gmail.com")
        port = int(smtp.get("port", 587))
        user_smtp = (smtp.get("user") or "").strip()
        pwd = (smtp.get("password") or "").strip()

        if not host or not user_smtp or not pwd:
            raise ValueError("Configurazione incompleta: specifica Server SMTP, Utente/Email mittente e Password applicazione Google.")

        msg = EmailMessage()
        msg["Subject"] = "✅ [Eurario] Test Notifica Email Riuscito!"
        msg["From"] = user_smtp
        msg["To"] = to_email

        body = f"""Ciao Carlo,

Questo messaggio conferma che il server SMTP ({host}:{port}) è configurato correttamente.

D'ora in poi riceverai automaticamente un'email di avviso ogni volta che un nuovo utente o docente effettuerà il login con Google richiedendo l'accesso a Eurario.

---
Eurario Automated Security Notification
"""
        msg.set_content(body)

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=12) as server:
            server.starttls(context=context)
            server.login(user_smtp, pwd)
            server.send_message(msg)

        print(f"[AUTH EMAIL] Email di test inviata con successo a {to_email}")
        return True

    def approve_user(self, email, role="editor", admin_email=None, ip=None, target_school="default"):
        self._load()
        email = (email or "").lower().strip()
        if email not in self.config["users"]:
            raise ValueError("Utente non trovato")

        u = self.config["users"][email]
        u["status"] = "approved"
        if role in ("admin", "editor", "viewer"):
            u["role"] = role
        u["approved_at"] = get_local_now().isoformat()

        if target_school == "new_school":
            u["can_define_school"] = True
            mems = self.config.setdefault("school_memberships", {})
            if email in mems and "default" in mems[email]:
                del mems[email]["default"]
            log_detail = f"Utente approvato ({role}) con autorizzazione a definire una nuova scuola autonoma da {admin_email or 'admin'}"
        elif target_school and target_school != "default":
            u["can_define_school"] = False
            mems = self.config.setdefault("school_memberships", {})
            user_mems = mems.setdefault(email, {})
            user_mems[target_school] = {
                "role": role,
                "status": "approved",
                "added_at": get_local_now().isoformat()
            }
            log_detail = f"Utente approvato ({role}) e assegnato alla scuola '{target_school}' da {admin_email or 'admin'}"
        else:
            u["can_define_school"] = False
            mems = self.config.setdefault("school_memberships", {})
            user_mems = mems.setdefault(email, {})
            user_mems["default"] = {
                "role": role,
                "status": "approved",
                "added_at": get_local_now().isoformat()
            }
            log_detail = f"Utente approvato ({role}) per la scuola principale da {admin_email or 'admin'}"

        self._save()
        self.log_access("USER_APPROVED", email, role, "SUCCESS", ip, "-", log_detail)
        return u

    def reject_user(self, email, admin_email=None, ip=None):
        self._load()
        email = (email or "").lower().strip()
        if email == self.config["admin_email"]:
            raise ValueError("Impossibile rifiutare l'amministratore principale")
        if email not in self.config["users"]:
            raise ValueError("Utente non trovato")

        u = self.config["users"][email]
        u["status"] = "rejected"
        self._save()
        self.log_access("USER_REJECTED", email, "-", "SUCCESS", ip, "-", f"Richiesta utente rifiutata da {admin_email or 'admin'}")
        return u

    def revoke_user(self, email, admin_email=None, ip=None):
        self._load()
        email = (email or "").lower().strip()
        if email == self.config["admin_email"]:
            raise ValueError("Impossibile revocare l'amministratore principale")
        if email in self.config["users"]:
            u = self.config["users"][email]
            u["status"] = "rejected"
            # Invalida eventuali sessioni attive
            for tok, s in list(self.sessions.items()):
                if s.get("email") == email:
                    del self.sessions[tok]
            self._save()
            self.log_access("USER_REVOKED", email, "-", "SUCCESS", ip, "-", f"Autorizzazione utente revocata da {admin_email or 'admin'}")
            return u
        raise ValueError("Utente non trovato")

    def delete_user(self, email, admin_email=None, ip=None):
        self._load()
        email = (email or "").lower().strip()
        if email == self.config["admin_email"]:
            raise ValueError("Impossibile eliminare l'amministratore principale")
        if email in self.config["users"]:
            del self.config["users"][email]
            if "school_memberships" in self.config and email in self.config["school_memberships"]:
                del self.config["school_memberships"][email]
            for tok, s in list(self.sessions.items()):
                if s.get("email") == email:
                    del self.sessions[tok]
            self._save()
            self.log_access("USER_DELETED", email, "-", "SUCCESS", ip, "-", f"Account eliminato da {admin_email or 'admin'}")
            return True
        return False

    def update_user_role(self, email, role, admin_email=None, ip=None):
        """
        Consente all'amministratore di modificare il ruolo di un utente (admin, editor, viewer)
        anche dopo la sua definizione iniziale.
        """
        self._load()
        email = (email or "").lower().strip()
        if email not in self.config["users"]:
            raise ValueError("Utente non trovato")
        if role not in ("admin", "editor", "viewer"):
            raise ValueError("Ruolo non valido")
        if email == self.config["admin_email"] and role != "admin":
            raise ValueError("Impossibile modificare il ruolo dell'Amministratore Principale")

        u = self.config["users"][email]
        old_role = u.get("role", "viewer")
        u["role"] = role

        # Aggiorna anche le membership di scuola associate
        mems = self.config.setdefault("school_memberships", {})
        if email in mems:
            for sid in mems[email]:
                mems[email][sid]["role"] = role

        # Aggiorna sessioni attive dell'utente
        for tok, s in list(self.sessions.items()):
            if s.get("email") == email:
                s["role"] = role

        self._save()
        self.log_access("ROLE_CHANGED", email, role, "SUCCESS", ip, "-", f"Ruolo modificato da '{old_role}' a '{role}' da {admin_email or 'admin'}")
        return u

    def add_user_to_school_by_admin(self, email, school_id, role="editor", name="", admin_email=None, ip=None):
        """
        Consente all'amministratore di scuola (o SuperAdmin) di aggiungere un nuovo utente/docente alla propria scuola.
        Se l'utente non ha mai effettuato il login prima, viene pre-autorizzato in modo che al primo accesso Google
        trovi già la scuola e i permessi pronti.
        """
        self._load()
        email = (email or "").lower().strip()
        if not email or "@" not in email:
            raise ValueError("Indirizzo email Google non valido")
        if not school_id or school_id in ("none", "-"):
            raise ValueError("ID scuola non valido")
        if role not in ("admin", "editor", "viewer"):
            raise ValueError("Ruolo non valido (seleziona admin, editor o viewer)")

        if email == self.config["admin_email"] or email in [s.lower() for s in self.config.get("superadmins", [])]:
            raise ValueError("Il SuperAdmin della piattaforma ha già accesso globale e non necessita di essere aggiunto alle singole scuole")

        now_iso = get_local_now().isoformat()

        # Se l'utente non esiste ancora nel registro utenti, crea profilo pre-approvato
        if email not in self.config["users"]:
            self.config["users"][email] = {
                "email": email,
                "name": (name or email.split("@")[0].title()).strip(),
                "picture": "",
                "role": role,
                "status": "approved",
                "created_at": now_iso,
                "approved_at": now_iso,
                "last_login": None
            }
        else:
            u = self.config["users"][email]
            if name and (not u.get("name") or u.get("name") == email):
                u["name"] = name.strip()
            # Se era in attesa, approvalo
            if u.get("status") == "pending":
                u["status"] = "approved"
                u["approved_at"] = now_iso

        # Aggiungi/aggiorna la membership specifica per la scuola
        mems = self.config.setdefault("school_memberships", {})
        user_mems = mems.setdefault(email, {})
        user_mems[school_id] = {
            "role": role,
            "status": "approved",
            "added_at": now_iso
        }

        self._save()
        self.log_access("USER_ADDED_TO_SCHOOL", email, role, "SUCCESS", ip, "-", f"Aggiunto alla scuola '{school_id}' con ruolo '{role}' da {admin_email or 'admin'}")
        return {
            "email": email,
            "name": self.config["users"][email].get("name", email),
            "role": role,
            "status": "approved",
            "school_id": school_id
        }

    def update_user_school_role(self, email, school_id, role, admin_email=None, ip=None):
        """
        Consente all'amministratore di scuola (o SuperAdmin) di modificare il ruolo di un utente per una specifica scuola.
        Protegge il SuperAdmin e il creatore originario della scuola.
        """
        self._load()
        email = (email or "").lower().strip()
        if not email or not school_id:
            raise ValueError("Parametri mancanti")
        if role not in ("admin", "editor", "viewer"):
            raise ValueError("Ruolo non valido")

        super_emails = set(s.lower().strip() for s in self.config.get("superadmins", []))
        super_emails.add(self.config.get("admin_email", "").lower().strip())
        if email in super_emails:
            raise ValueError("Impossibile modificare il ruolo del SuperAdmin")

        from webapp.schools import school_manager
        sch = school_manager.get_school(school_id)
        sch_owner = (sch.get("owner_email") or "").lower().strip() if sch else ""

        if sch_owner and email == sch_owner and role != "admin":
            is_super = self.is_superadmin(admin_email)
            if not is_super:
                raise ValueError("Solo il SuperAdmin della piattaforma può modificare il ruolo del creatore dell'istituto")

        mems = self.config.setdefault("school_memberships", {})
        user_mems = mems.setdefault(email, {})
        old_role = user_mems.get(school_id, {}).get("role", "viewer")
        user_mems[school_id] = {
            "role": role,
            "status": "approved",
            "updated_at": get_local_now().isoformat()
        }

        # Aggiorna sessioni attive dell'utente per questa scuola
        for tok, s in list(self.sessions.items()):
            if s.get("email") == email and s.get("active_school_id") == school_id:
                s["role"] = role

        self._save()
        self.log_access("SCHOOL_ROLE_CHANGED", email, role, "SUCCESS", ip, "-", f"Ruolo nella scuola '{school_id}' modificato da '{old_role}' a '{role}' da {admin_email or 'admin'}")
        return user_mems[school_id]

    def remove_user_from_school_by_admin(self, email, school_id, admin_email=None, ip=None):
        """
        Rimuove l'accesso di un utente a una specifica scuola (senza cancellare l'account globale se appartiene ad altre scuole).
        """
        self._load()
        email = (email or "").lower().strip()
        if not email or not school_id:
            raise ValueError("Parametri mancanti")

        super_emails = set(s.lower().strip() for s in self.config.get("superadmins", []))
        super_emails.add(self.config.get("admin_email", "").lower().strip())
        if email in super_emails:
            raise ValueError("Impossibile rimuovere il SuperAdmin")

        from webapp.schools import school_manager
        sch = school_manager.get_school(school_id)
        sch_owner = (sch.get("owner_email") or "").lower().strip() if sch else ""

        if sch_owner and email == sch_owner:
            if not self.is_superadmin(admin_email):
                raise ValueError("Solo il SuperAdmin della piattaforma può rimuovere il creatore dell'istituto")

        mems = self.config.setdefault("school_memberships", {})
        if email in mems and school_id in mems[email]:
            del mems[email][school_id]

        # Se l'utente era connesso a questa scuola, scollega la scuola attiva
        for tok, s in list(self.sessions.items()):
            if s.get("email") == email and s.get("active_school_id") == school_id:
                s["active_school_id"] = "none"

        self._save()
        self.log_access("USER_REMOVED_FROM_SCHOOL", email, "-", "SUCCESS", ip, "-", f"Accesso alla scuola '{school_id}' revocato da {admin_email or 'admin'}")
        return True

    def reopen_user(self, email, admin_email=None, ip=None):
        """
        Consente all'amministratore di riaprire/riabilitare un utente precedentemente revocato
        o rifiutato, rimettendolo subito nella scheda 'Richieste in Attesa'.
        """
        self._load()
        email = (email or "").lower().strip()
        if email not in self.config["users"]:
            raise ValueError("Utente non trovato")
        u = self.config["users"][email]
        u["status"] = "pending"
        u["created_at"] = get_local_now().isoformat()
        u["approved_at"] = None
        u["was_previously_rejected"] = True
        self._save()
        self.log_access("USER_REOPENED", email, u.get("role", "editor"), "SUCCESS", ip, "-", f"Utente rimesso in attesa di sblocco da {admin_email or 'admin'}")
        return u

    def update_config(self, new_cfg):
        if "google_client_id" in new_cfg:
            self.config["google_client_id"] = str(new_cfg["google_client_id"]).strip()
        if "emergency_passcode" in new_cfg and new_cfg["emergency_passcode"]:
            raw_p = str(new_cfg["emergency_passcode"]).strip()
            if raw_p and raw_p != "••••••••":
                if len(raw_p) < 8:
                    raise ValueError("Il nuovo passcode master deve contenere almeno 8 caratteri")
                self.config["emergency_passcode"] = hash_emergency_passcode(raw_p)
                self.config["must_change_passcode"] = False
        if "smtp" in new_cfg and isinstance(new_cfg["smtp"], dict):
            self.config["smtp"].update(new_cfg["smtp"])
        self._save()
        return {
            "google_client_id": self.config["google_client_id"],
            "admin_email": self.config["admin_email"],
            "must_change_passcode": self.config.get("must_change_passcode", False),
            "smtp_enabled": self.config["smtp"].get("enabled", False)
        }

    # --- EMAIL NOTIFICATION (SMTP) ---

    def _notify_admin_security_alert(self, client_ip, user_agent):
        """Invia un'email di allerta critica all'amministratore in caso di attacco a forza bruta rilevato."""
        smtp = self.config.get("smtp", {})
        if not smtp.get("enabled"):
            return

        to_email = smtp.get("notify_to") or self.config["admin_email"]
        host = smtp.get("host", "smtp.gmail.com")
        port = int(smtp.get("port", 587))
        user_smtp = smtp.get("user")
        pwd = smtp.get("password")

        if not host or not user_smtp or not pwd:
            return

        msg = EmailMessage()
        msg["Subject"] = "🚨 [Eurario Sicurezza] Rilevato potenziale attacco Brute-Force: IP congelato"
        msg["From"] = user_smtp
        msg["To"] = to_email

        now_str = get_local_now().strftime("%d/%m/%Y %H:%M:%S")
        body = f"""ATTENZIONE: Notifica di Sicurezza Eurario

È stato rilevato e bloccato un tentativo ripetuto di violazione del passcode master di emergenza:

- Indirizzo IP: {client_ip}
- User Agent: {user_agent or 'Non specificato'}
- Data e Ora: {now_str}
- Provvedimento: Indirizzo IP congelato per 15 minuti (HTTP 429 Too Many Requests).

Se non sei stato tu, verifica gli accessi al server e assicurati di aver sostituito il passcode predefinito con una password complessa.

---
Eurario Automated Intrusion Prevention System
"""
        msg.set_content(body)
        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.starttls(context=context)
                server.login(user_smtp, pwd)
                server.send_message(msg)
        except Exception as e:
            print(f"[AUTH SECURITY ALERT ERROR]: {e}", file=sys.stderr)

    def _notify_admin_email(self, user):
        smtp = self.config.get("smtp", {})
        if not smtp.get("enabled"):
            return

        to_email = smtp.get("notify_to") or self.config["admin_email"]
        host = smtp.get("host", "smtp.gmail.com")
        port = int(smtp.get("port", 587))
        user_smtp = smtp.get("user")
        pwd = smtp.get("password")

        if not host or not user_smtp or not pwd:
            return

        msg = EmailMessage()
        msg["Subject"] = f"🔔 [Eurario] Richiesta di accesso da {user.get('name')}"
        msg["From"] = user_smtp
        msg["To"] = to_email

        body = f"""Ciao Carlo,

Un nuovo utente ha richiesto l'accesso alla piattaforma Eurario:

- Nome: {user.get('name')}
- Email Google: {user.get('email')}
- Data richiesta: {user.get('created_at')}

Per sbloccare o rifiutare l'accesso, apri Eurario e clicca su "Gestione Accessi" nella barra superiore:
http://<IP-DEL-NAS>:8000

---
Eurario Automated Security Notification
"""
        msg.set_content(body)

        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.starttls(context=context)
                server.login(user_smtp, pwd)
                server.send_message(msg)
            print(f"[AUTH] Email di notifica inviata con successo a {to_email}")
        except Exception as e:
            print(f"[AUTH] Avviso: invio email fallito: {e}")

    def notify_admin_new_school(self, school, user):
        """Invia email di notifica all'amministratore quando viene creata/registrata una nuova scuola."""
        smtp = self.config.get("smtp", {})
        if not smtp.get("enabled"):
            return

        to_email = smtp.get("notify_to") or self.config["admin_email"]
        host = smtp.get("host", "smtp.gmail.com")
        port = int(smtp.get("port", 587))
        user_smtp = (smtp.get("user") or "").strip()
        pwd = (smtp.get("password") or "").strip()

        if not host or not user_smtp or not pwd:
            return

        msg = EmailMessage()
        sch_name = school.get("name") or "Nuovo Istituto"
        msg["Subject"] = f"🏫 [Eurario] Nuovo Istituto Registrato: {sch_name}"
        msg["From"] = user_smtp
        msg["To"] = to_email

        body = f"""Ciao Carlo,

È stato registrato un nuovo Istituto Scolastico sulla piattaforma Eurario:

• Nome Istituto: {sch_name}
• Città / Comune: {school.get('city') or 'Non specificato'}
• Nazione: {school.get('country') or 'Italia'}
• Codice Meccanografico: {school.get('meccanografico') or 'Non presente'}
• Referente / Proprietario: {user.get('name') or user.get('email')} ({user.get('email')})
• Note / Recapiti: {school.get('notes') or 'Nessuna nota'}
• Stato iniziale: In Prova (Trial)
• Data registrazione: {school.get('created_at')}

L'istituto è stato creato in Modalità di Prova con il solutore FET attivo. Puoi gestirlo o approvarlo dalla Console SuperAdmin di Eurario.

---
Eurario Automated Multi-School Notification System
"""
        msg.set_content(body)

        try:
            context = ssl.create_default_context()
            with smtplib.SMTP(host, port, timeout=10) as server:
                server.starttls(context=context)
                server.login(user_smtp, pwd)
                server.send_message(msg)
            print(f"[AUTH] Email notifica nuovo istituto inviata con successo a {to_email}")
        except Exception as e:
            print(f"[AUTH] Avviso: invio email nuovo istituto fallito: {e}")


auth_manager = AuthManager()
