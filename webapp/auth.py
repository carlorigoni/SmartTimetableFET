#!/usr/bin/env python3
"""
SmartTimetable - Modulo Autenticazione OAuth Google & Controllo Accessi
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
import smtplib
import ssl
import urllib.request
import urllib.parse
from datetime import datetime
from email.message import EmailMessage

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


class AuthManager:
    def __init__(self):
        self.sessions = {}  # token -> {email, created_at, expires_at}
        self.config = {
            "admin_email": DEFAULT_ADMIN_EMAIL,
            "google_client_id": DEFAULT_GOOGLE_CLIENT_ID,
            "emergency_passcode": os.environ.get("ADMIN_PASSCODE", "admin2026"),
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
                    "created_at": datetime.now().isoformat(),
                    "approved_at": datetime.now().isoformat(),
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
                        self.config["google_client_id"] = data.get("google_client_id", self.config["google_client_id"]).strip()
                        self.config["emergency_passcode"] = data.get("emergency_passcode", self.config["emergency_passcode"])
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
                                "created_at": datetime.now().isoformat(),
                                "approved_at": datetime.now().isoformat(),
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
            now_str = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
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

    # --- SESSION MANAGEMENT ---

    def create_session(self, email):
        token = secrets.token_urlsafe(32)
        now = time.time()
        self.sessions[token] = {
            "email": email.lower().strip(),
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
            return None
        return dict(user)

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
            headers={"User-Agent": "SmartTimetable-Auth/1.0"}
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
            raise ValueError("Il Client ID del token non coincide con quello configurato per SmartTimetable")

        return {
            "email": email,
            "name": data.get("name") or email.split("@")[0],
            "picture": data.get("picture", ""),
            "sub": data.get("sub", "")
        }

    # --- LOGIN & REQUEST ACCESS WORKFLOW ---

    def handle_google_login(self, id_token, ip=None, user_agent=None):
        """
        Autentica un utente tramite Google ID Token.
        Se l'utente non esiste, registra la richiesta con stato 'pending'.
        Se è l'admin, lo approva automaticamente.
        """
        try:
            user_info = self.verify_google_id_token(id_token)
        except Exception as e:
            self.log_access("GOOGLE_LOGIN_FAIL", "-", "anonymous", "FAILED", ip, user_agent, f"Token Google non valido o errore: {e}")
            raise

        email = user_info["email"]
        now_iso = datetime.now().isoformat()

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
            if u["status"] == "approved":
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
        """
        configured_pass = self.config.get("emergency_passcode", "admin2026")
        if not passcode or passcode != configured_pass:
            self.log_access("EMERGENCY_LOGIN_FAIL", "admin", "anonymous", "FAILED", ip, user_agent, "Tentativo di accesso con passcode master errato")
            raise ValueError("Passcode di emergenza errato")

        admin_email = self.config["admin_email"]
        session_token = self.create_session(admin_email)
        user = dict(self.config["users"][admin_email])
        user["last_login"] = datetime.now().isoformat()
        self._save()
        self.log_access("EMERGENCY_LOGIN", admin_email, "admin", "SUCCESS", ip, user_agent, "Accesso riuscito con passcode master")
        return {
            "session_token": session_token,
            "user": user
        }

    # --- USER APPROVAL / REJECTION ACTIONS ---

    def list_users(self):
        """
        Restituisce la lista di tutti gli utenti, suddivisi tra approvati e in attesa.
        """
        self._load()
        users_list = list(self.config["users"].values())
        users_list.sort(key=lambda u: (
            0 if u.get("status") == "pending" else 1,
            u.get("created_at") or ""
        ), reverse=False)
        return {
            "admin_email": self.config["admin_email"],
            "google_client_id": self.config["google_client_id"],
            "pending_count": sum(1 for u in users_list if u.get("status") == "pending"),
            "users": users_list,
            "config": {
                "smtp": {
                    "enabled": self.config["smtp"].get("enabled", False),
                    "host": self.config["smtp"].get("host", "smtp.gmail.com"),
                    "port": self.config["smtp"].get("port", 587),
                    "user": self.config["smtp"].get("user", ""),
                    "password": self.config["smtp"].get("password", ""),
                    "notify_to": self.config["smtp"].get("notify_to", self.config["admin_email"])
                },
                "emergency_passcode": self.config.get("emergency_passcode", "admin2026")
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
        msg["Subject"] = "✅ [SmartTimetable] Test Notifica Email Riuscito!"
        msg["From"] = user_smtp
        msg["To"] = to_email

        body = f"""Ciao Carlo,

Questo messaggio conferma che il server SMTP ({host}:{port}) è configurato correttamente.

D'ora in poi riceverai automaticamente un'email di avviso ogni volta che un nuovo utente o docente effettuerà il login con Google richiedendo l'accesso a SmartTimetable.

---
SmartTimetable Automated Security Notification
"""
        msg.set_content(body)

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=12) as server:
            server.starttls(context=context)
            server.login(user_smtp, pwd)
            server.send_message(msg)

        print(f"[AUTH EMAIL] Email di test inviata con successo a {to_email}")
        return True

    def approve_user(self, email, role="editor", admin_email=None, ip=None):
        self._load()
        email = (email or "").lower().strip()
        if email not in self.config["users"]:
            raise ValueError("Utente non trovato")

        u = self.config["users"][email]
        u["status"] = "approved"
        if role in ("admin", "editor", "viewer"):
            u["role"] = role
        u["approved_at"] = datetime.now().isoformat()
        self._save()
        self.log_access("USER_APPROVED", email, role, "SUCCESS", ip, "-", f"Utente approvato con ruolo '{role}' da {admin_email or 'admin'}")
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
            for tok, s in list(self.sessions.items()):
                if s.get("email") == email:
                    del self.sessions[tok]
            self._save()
            self.log_access("USER_DELETED", email, "-", "SUCCESS", ip, "-", f"Account eliminato da {admin_email or 'admin'}")
            return True
        return False

    def update_config(self, new_cfg):
        if "google_client_id" in new_cfg:
            self.config["google_client_id"] = str(new_cfg["google_client_id"]).strip()
        if "emergency_passcode" in new_cfg and new_cfg["emergency_passcode"]:
            self.config["emergency_passcode"] = str(new_cfg["emergency_passcode"]).strip()
        if "smtp" in new_cfg and isinstance(new_cfg["smtp"], dict):
            self.config["smtp"].update(new_cfg["smtp"])
        self._save()
        return {
            "google_client_id": self.config["google_client_id"],
            "admin_email": self.config["admin_email"],
            "smtp_enabled": self.config["smtp"].get("enabled", False)
        }

    # --- EMAIL NOTIFICATION (SMTP) ---

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
        msg["Subject"] = f"🔔 [SmartTimetable] Richiesta di accesso da {user.get('name')}"
        msg["From"] = user_smtp
        msg["To"] = to_email

        body = f"""Ciao Carlo,

Un nuovo utente ha richiesto l'accesso alla piattaforma SmartTimetable:

- Nome: {user.get('name')}
- Email Google: {user.get('email')}
- Data richiesta: {user.get('created_at')}

Per sbloccare o rifiutare l'accesso, apri SmartTimetable e clicca su "Gestione Accessi" nella barra superiore:
http://<IP-DEL-NAS>:8000

---
SmartTimetable Automated Security Notification
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


auth_manager = AuthManager()
