#!/usr/bin/env python3
"""
Eurario - Modulo Gestione Istituti Multi-Scuola (Multi-Tenancy)
Gestisce:
- Registro Istituti Scolastici (scuole registrate, in prova, attive, sospese)
- Partizionamento dati per scuola (webapp/data/tenants/<school_id>/)
- Ciclo di vita: Creazione in prova (Trial) -> Approvazione Tecnica del SuperAdmin -> Attivazione
- Retrocompatibilità totale con la scuola predefinita ('default')
100% standard library Python (Zero dipendenze esterne).
"""

import os
import re
import json
import shutil
import threading
from datetime import datetime

BASE_DIR = os.path.dirname(os.path.abspath(__file__))
DATA_DIR = os.path.join(BASE_DIR, "data")
TENANTS_DIR = os.path.join(DATA_DIR, "tenants")
SCHOOLS_FILE = os.path.join(DATA_DIR, "schools.json")

def sanitize_slug(text):
    """Genera uno slug pulito e valido per il filesystem a partire dal nome dell'istituto."""
    s = (text or "").lower().strip()
    s = re.sub(r"[^\w\s-]", "", s)
    s = re.sub(r"[\s_-]+", "-", s).strip("-")
    return s[:40] or "scuola"


class SchoolManager:
    def __init__(self):
        self.lock = threading.RLock()
        self.schools = {}
        os.makedirs(DATA_DIR, exist_ok=True)
        os.makedirs(TENANTS_DIR, exist_ok=True)
        self._load()

    def _load(self):
        with self.lock:
            if os.path.exists(SCHOOLS_FILE):
                try:
                    with open(SCHOOLS_FILE, "r", encoding="utf-8") as f:
                        data = json.load(f)
                        if isinstance(data, dict):
                            self.schools = data
                        elif isinstance(data, list):
                            self.schools = {s["id"]: s for s in data if isinstance(s, dict) and "id" in s}
                except Exception as e:
                    print(f"[SCHOOLS] Errore lettura {SCHOOLS_FILE}: {e}")

            # Assicura che la scuola principale 'default' esista sempre nel registro
            if "default" not in self.schools:
                # Prova a leggere il nome reale dal current_project.json esistente
                inst_name = "Liceo & Tecnico \"Pico De Paperis\""
                proj_file = os.path.join(DATA_DIR, "current_project.json")
                if os.path.exists(proj_file):
                    try:
                        with open(proj_file, "r", encoding="utf-8") as pf:
                            pj = json.load(pf)
                            if pj.get("institution"):
                                inst_name = pj["institution"]
                    except Exception:
                        pass

                self.schools["default"] = {
                    "id": "default",
                    "name": inst_name,
                    "city": "Sede Principale",
                    "country": "Italia",
                    "school_year": "2026/2027",
                    "meccanografico": "PDIS017007",
                    "status": "active",
                    "owner_email": "admin@paperopoli.edu",
                    "created_at": datetime.now().isoformat(),
                    "approved_at": datetime.now().isoformat(),
                    "approved_by": "system",
                    "notes": "Istituto Principale Predefinito",
                    "is_default": True
                }
                self._save()
            elif "default" in self.schools and not self.schools["default"].get("meccanografico"):
                self.schools["default"]["meccanografico"] = "PDIS017007"
                self._save()

    def _save(self):
        with self.lock:
            try:
                os.makedirs(DATA_DIR, exist_ok=True)
                temp = SCHOOLS_FILE + ".tmp"
                with open(temp, "w", encoding="utf-8") as f:
                    json.dump(self.schools, f, indent=2, ensure_ascii=False)
                os.replace(temp, SCHOOLS_FILE)
            except Exception as e:
                print(f"[SCHOOLS] Errore salvataggio {SCHOOLS_FILE}: {e}")

    def get_school(self, school_id):
        with self.lock:
            return self.schools.get(school_id)

    def list_all_schools(self):
        """Restituisce l'elenco completo di tutte le scuole per la console SuperAdmin."""
        with self.lock:
            out = []
            for sid, s in self.schools.items():
                item = dict(s)
                item["tenant_dir_exists"] = (sid == "default") or os.path.exists(os.path.join(TENANTS_DIR, sid))
                out.append(item)
            out.sort(key=lambda x: (0 if x["id"] == "default" else 1, x.get("name", "").lower()))
            return out

    def list_schools_for_user(self, user_email, is_superadmin=False, memberships=None, can_define_school=False):
        """Restituisce le scuole accessibili dall'utente specificato."""
        with self.lock:
            if is_superadmin:
                return self.list_all_schools()

            user_email_clean = (user_email or "").strip().lower()
            memberships = memberships or {}
            user_mems = memberships.get(user_email_clean, {})

            out = []
            for sid, s in self.schools.items():
                owner_clean = (s.get("owner_email") or "").strip().lower()
                is_owner = (owner_clean == user_email_clean and bool(user_email_clean))
                is_member = (sid in user_mems and user_mems[sid].get("status") == "approved")

                if is_owner or is_member:
                    item = dict(s)
                    role = "owner" if is_owner else (user_mems.get(sid, {}).get("role", "viewer") if is_member else "viewer")
                    item["user_role"] = role
                    out.append(item)
                elif sid == "default":
                    has_other_schools = any((s2.get("owner_email") or "").strip().lower() == user_email_clean for s2 in self.schools.values()) or bool(user_mems)
                    if not can_define_school and not has_other_schools:
                        item = dict(s)
                        item["user_role"] = "editor"
                        out.append(item)

            out.sort(key=lambda x: (0 if x["id"] == "default" else 1, x.get("name", "").lower()))
            return out

    def create_school(self, name, city="", country="Italia", school_year="", owner_email="", notes="", meccanografico="", contact_email=""):
        """
        Crea un nuovo Istituto in stato 'trial' (Modalità di Prova).
        Genera la cartella isolata tenant e inizializza il database dedicato.
        Effettua il controllo di unicità del Codice Meccanografico per l'Italia.
        """
        with self.lock:
            clean_name = (name or "").strip()
            if not clean_name:
                raise ValueError("Il nome dell'Istituto è obbligatorio.")

            clean_country = (country or "Italia").strip()
            clean_mecc = (meccanografico or "").strip().upper()
            clean_contact = (contact_email or "").strip().lower()

            # Controllo unicità Codice Meccanografico per scuole in Italia
            if clean_country.lower() in ("italia", "italy") and clean_mecc:
                for sid, s in self.schools.items():
                    s_country = (s.get("country") or "Italia").strip().lower()
                    if s_country in ("italia", "italy"):
                        s_mecc = (s.get("meccanografico") or "").strip().upper()
                        if s_mecc and s_mecc == clean_mecc:
                            raise ValueError(f"Il codice meccanografico '{clean_mecc}' è già associato all'istituto '{s.get('name')}'. Ogni scuola deve avere un codice univoco.")

            base_slug = sanitize_slug(clean_name)
            slug = base_slug
            idx = 1
            while slug in self.schools or (slug != "default" and os.path.exists(os.path.join(TENANTS_DIR, slug))):
                idx += 1
                slug = f"{base_slug}-{idx}"

            school_obj = {
                "id": slug,
                "name": clean_name,
                "city": (city or "").strip(),
                "country": clean_country,
                "school_year": (school_year or "").strip(),
                "meccanografico": clean_mecc,
                "contact_email": clean_contact,
                "status": "trial",  # 'trial' = in prova con filigrana | 'active' = approvata dal superadmin
                "owner_email": (owner_email or "").strip().lower(),
                "created_at": datetime.now().isoformat(),
                "approved_at": None,
                "approved_by": None,
                "notes": (notes or "").strip(),
                "is_default": False,
                "smtp": {
                    "enabled": False,
                    "host": "smtp.gmail.com",
                    "port": 587,
                    "user": "",
                    "password": "",
                    "notify_to": clean_contact or (owner_email or "").strip().lower()
                }
            }

            # Crea la cartella tenant dedicata
            tenant_path = os.path.join(TENANTS_DIR, slug)
            os.makedirs(tenant_path, exist_ok=True)
            os.makedirs(os.path.join(tenant_path, "snapshots"), exist_ok=True)

            self.schools[slug] = school_obj
            self._save()
            return school_obj

    def update_school_info(self, school_id, **kwargs):
        """Aggiorna i metadati anagrafici di una scuola nel registro centralizzato con controllo unicità."""
        with self.lock:
            if school_id not in self.schools:
                return None
            s = self.schools[school_id]

            new_country = (kwargs.get("country") if "country" in kwargs and kwargs["country"] is not None else s.get("country", "Italia")).strip()
            new_mecc = (str(kwargs["meccanografico"]).strip().upper() if "meccanografico" in kwargs and kwargs["meccanografico"] is not None else s.get("meccanografico", "").strip().upper())

            # Se si aggiorna o mantiene il codice meccanografico in Italia, verifica unicità escludendo se stessa
            if "meccanografico" in kwargs and new_country.lower() in ("italia", "italy") and new_mecc:
                for sid, s2 in self.schools.items():
                    if sid != school_id:
                        s2_country = (s2.get("country") or "Italia").strip().lower()
                        if s2_country in ("italia", "italy"):
                            s2_mecc = (s2.get("meccanografico") or "").strip().upper()
                            if s2_mecc and s2_mecc == new_mecc:
                                raise ValueError(f"Il codice meccanografico '{new_mecc}' è già associato all'istituto '{s2.get('name')}'.")

            for k in ("name", "city", "country", "school_year", "meccanografico", "notes", "contact_email", "smtp"):
                if k in kwargs and kwargs[k] is not None:
                    if k == "meccanografico":
                        s[k] = str(kwargs[k]).strip().upper()
                    elif k == "contact_email":
                        s[k] = str(kwargs[k]).strip().lower()
                    elif k == "smtp":
                        if isinstance(kwargs[k], dict):
                            cur_smtp = s.setdefault("smtp", {})
                            cur_smtp.update(kwargs[k])
                    else:
                        s[k] = str(kwargs[k]).strip()
            self._save()
            return s

    def send_school_test_email(self, school_id, admin_email=None):
        """Invia un'email di test usando la configurazione SMTP specifica della scuola."""
        s = self.get_school(school_id)
        if not s:
            raise ValueError(f"Istituto '{school_id}' non trovato.")
        smtp_cfg = s.get("smtp", {})
        if not smtp_cfg or not smtp_cfg.get("enabled"):
            raise ValueError("L'invio email SMTP per questo istituto non è abilitato.")
        
        host = (smtp_cfg.get("host") or "").strip()
        port = int(smtp_cfg.get("port") or 587)
        user = (smtp_cfg.get("user") or "").strip()
        pwd = (smtp_cfg.get("password") or "").strip()
        to_email = (smtp_cfg.get("notify_to") or s.get("contact_email") or admin_email or "").strip()

        if not host or not user or not pwd or not to_email:
            raise ValueError("Configurazione incompleta: specifica Server SMTP, Utente/Mittente, Password e Destinatario notifiche.")

        from email.message import EmailMessage
        import ssl
        import smtplib

        sch_name = s.get("name", "Istituto Scolastico")
        msg = EmailMessage()
        msg["Subject"] = f"✅ [{sch_name}] Test Configurazione SMTP Riuscito!"
        msg["From"] = user
        msg["To"] = to_email

        body = f"""Gentile Referente / Amministratore di {sch_name},

Questo messaggio conferma che il server SMTP ({host}:{port}) per l'istituto '{sch_name}' è configurato e funzionante con successo.

D'ora in poi le notifiche relative all'orario, agli accessi docenti e ai report di questo istituto potranno essere recapitate tramite questo canale ufficiale.

---
Eurario FET Suite & Timetable Management
"""
        msg.set_content(body)

        context = ssl.create_default_context()
        with smtplib.SMTP(host, port, timeout=12) as server:
            server.starttls(context=context)
            server.login(user, pwd)
            server.send_message(msg)

        return True

    def approve_school(self, school_id, admin_email=""):
        """Approva formalmente la scuola, sbloccando le stampe ufficiali ad alta risoluzione."""
        with self.lock:
            if school_id not in self.schools:
                raise ValueError("Istituto non trovato.")
            s = self.schools[school_id]
            s["status"] = "active"
            s["approved_at"] = datetime.now().isoformat()
            s["approved_by"] = admin_email or "superadmin"
            self._save()
            return s

    def suspend_school(self, school_id, admin_email=""):
        with self.lock:
            if school_id not in self.schools:
                raise ValueError("Istituto non trovato.")
            if school_id == "default":
                raise ValueError("Impossibile sospendere l'istituto predefinito.")
            s = self.schools[school_id]
            s["status"] = "suspended"
            s["suspended_at"] = datetime.now().isoformat()
            s["suspended_by"] = admin_email or "superadmin"
            self._save()
            return s

    def reactivate_school(self, school_id, admin_email=""):
        with self.lock:
            if school_id not in self.schools:
                raise ValueError("Istituto non trovato.")
            s = self.schools[school_id]
            s["status"] = "active"
            s["reactivated_at"] = datetime.now().isoformat()
            self._save()
            return s

    def delete_school(self, school_id):
        with self.lock:
            if school_id not in self.schools:
                raise ValueError("Istituto non trovato.")
            if school_id == "default":
                raise ValueError("Impossibile eliminare l'istituto predefinito di sistema.")

            # Rimuovi cartella tenant
            tenant_path = os.path.join(TENANTS_DIR, school_id)
            if os.path.exists(tenant_path):
                shutil.rmtree(tenant_path, ignore_errors=True)

            del self.schools[school_id]
            self._save()
            return True

    def update_school(self, school_id, updates):
        with self.lock:
            if school_id not in self.schools:
                raise ValueError("Istituto non trovato.")
            s = self.schools[school_id]
            for k in ("name", "city", "country", "school_year", "notes"):
                if k in updates and updates[k] is not None:
                    s[k] = str(updates[k]).strip()
            self._save()
            return s


school_manager = SchoolManager()
