"""
Database e Gestore dello Stato per SmartTimetable.
Persiste i dati su JSON/SQLite e mantiene la compatibilità bidirezionale con FET.
"""

import os
import re
import io
import json
import copy
import shutil
import zipfile
import threading
import xml.etree.ElementTree as ET
from collections import defaultdict
from webapp.fet_engine import (
    parse_fet_xml,
    build_timetable_views,
    generate_fet_xml,
    get_grouped_activities,
    natural_class_sort_key,
    DEFAULT_CONSTRAINTS,
    DEFAULT_DAY_HOURS,
    DEFAULT_PARAMETERS,
    PARAM_HELP,
    SOLO_100_CONSTRAINTS
)

DATA_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "data")
PROJECT_FILE = os.path.join(DATA_DIR, "current_project.json")
SOLVED_FILE = os.path.join(DATA_DIR, "solved_timetable.fet")
SNAPSHOTS_DIR = os.path.join(DATA_DIR, "snapshots")



def compute_short_name(name):
    """
    Calcola il nome breve standard in lettere MAIUSCOLE formato da COGNOME N. (o COGNOME N.N. per più nomi).
    Gestisce correttamente i prefissi italiani dei cognomi composti (De, Di, Da, Dalla, Del, Al, ecc.).
    es.
      'Rigoni Carlo' -> 'RIGONI C.'
      'Dalla Riva Andrea' -> 'DALLA RIVA A.'
      'De Bartolomeis Enrico' -> 'DE BARTOLOMEIS E.'
      'Al Naber Amir' -> 'AL NABER A.'
      'Righetto Maria Giovanna' -> 'RIGHETTO M.G.'
      'A046_Residuo' -> 'A046_RESIDUO'
    """
    n = (name or "").strip()
    if not n:
        return ""
    if "_" in n:
        return n.upper()

    prefixes = {
        "DA", "DE", "DI", "DEL", "DELLA", "DELLE", "DALLE",
        "DEI", "DEGLI", "DAL", "DALLA", "LA", "LO", "LE", "LI",
        "VAN", "VON", "AL", "EL", "SAN", "SANTA"
    }
    parts = n.split()
    if len(parts) == 1:
        return parts[0].upper()

    i = 0
    cogn = [parts[0]]
    while i < len(parts) - 1 and parts[i].upper() in prefixes:
        i += 1
        cogn.append(parts[i])

    nomi = parts[i + 1:]
    if not nomi:
        return " ".join(cogn).upper()

    iniziali = "".join(f"{nm[0].upper()}." for nm in nomi if nm)
    return f'{" ".join(cogn).upper()} {iniziali}'.strip()


ACCORPAMENTI_DEFAULT_RULES = [
    {
        "id": "ita_lat_sto_geo",
        "name": "Italiano Latino Storia e Geografia",
        "components": ["Italiano", "Latino", "Storia e Geografia"],
        "active": True
    },
    {
        "id": "ita_lat",
        "name": "Italiano Latino",
        "components": ["Italiano", "Latino"],
        "active": True
    },
    {
        "id": "ita_sto_geo",
        "name": "Italiano Storia e Geografia",
        "components": ["Italiano", "Storia e Geografia"],
        "active": True
    },
    {
        "id": "dir_econ",
        "name": "Diritto ed Economia Politica",
        "components": ["Diritto", "Economia Politica"],
        "active": True
    },
    {
        "id": "dir_rel_int",
        "name": "Diritto e Relazioni Internazionali",
        "components": ["Diritto", "Relazioni Internazionali"],
        "active": True
    }
]

# Configurazione predefinita degli Indirizzi scolastici per Sezione
DEFAULT_SECTION_PERCORSI = {
    "A": "tecnico",
    "B": "tecnico",
    "C": "liceo",
    "D": "liceo",
    "E": "tecnico",
    "F": "tecnico",
    "G": "professionale",
    "H": "professionale",
    "L": "liceo"
}

def compute_fallback_blocks(total_hours, subject=""):
    th = int(total_hours)
    subj_low = (subject or "").lower()
    if th <= 1:
        return "1"
    if "disposiz" in subj_low:
        return "+".join(["1"] * th)
    if th == 2:
        if any(k in subj_low for k in ("motori", "sport", "informatic", "lab")):
            return "2"
        return "1+1"
    if th == 3:
        if any(k in subj_low for k in ("lingua", "stranier", "inglese", "francese", "spagnolo", "tedesco")):
            return "1+1+1"
        return "2+1"
    if th == 4:
        if any(k in subj_low for k in ("metodologie", "tecniche", "amministrativ")):
            return "2+2"
        return "2+1+1"
    if th == 5:
        return "2+2+1"
    if th == 6:
        return "2+2+1+1"
    if th == 7:
        if any(k in subj_low for k in ("matematica e fisica", "fisica")):
            return "2+2+1+1+1"
        return "2+2+2+1"
    if th == 8:
        return "2+2+2+2"
    if th == 10:
        return "2+2+2+2+2"
    parts = []
    rem = th
    while rem >= 2:
        parts.append(2)
        rem -= 2
    if rem == 1:
        parts.append(1)
    return "+".join(map(str, parts))

# Regole di Default della Suddivisione dei Blocchi Orari (per materia, percorso e periodo)
DEFAULT_BLOCK_RULES = [
    # Scienze Motorie (Palestra): sempre 2 ore consecutive (modulo intero palestra)
    {"id": "rule_sm_all", "subject": "Scienze Motorie e Sportive II Grado", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "2"},
    
    # Scienze e Tecnologie Informatiche (Laboratorio Info): sempre 2 ore consecutive
    {"id": "rule_info_all", "subject": "Scienze e Tecnologie Informatiche", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "2"},
    
    # Religione Cattolica: sempre 1 ora
    {"id": "rule_rel_all", "subject": "Religione", "percorso": "tutti", "period": "tutti", "total_hours": 1, "blocks": "1"},

    # Lingue Straniere: 3 ore distribuite 1+1+1 per efficacia didattica
    {"id": "rule_eng_all", "subject": "Lingua e Cultura Straniera (Inglese)", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "1+1+1"},
    {"id": "rule_fra_all", "subject": "Lingua e Cultura Straniera (Francese)", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "1+1+1"},
    {"id": "rule_ted_all", "subject": "Lingua e Cultura Straniera (Tedesco)", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "1+1+1"},
    {"id": "rule_spa_3h", "subject": "Lingua e Cultura Straniera (Spagnolo)", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "1+1+1"},
    {"id": "rule_spa_2h", "subject": "Lingua e Cultura Straniera (Spagnolo)", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},

    # Disegno e Storia dell'Arte: 2 ore -> 1+1
    {"id": "rule_arte_all", "subject": "Disegno Storia Arte Istituto II Grado", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},

    # Diritto: 2 ore -> 1+1
    {"id": "rule_dir_all", "subject": "Diritto", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},

    # Discipline Letterarie (Italiano/Storia/Geo): 6 ore -> 2+2+1+1, 4 ore -> 2+1+1
    {"id": "rule_lett_6h", "subject": "Discipline Letterarie Istituti II Grado", "percorso": "tutti", "period": "tutti", "total_hours": 6, "blocks": "2+2+1+1"},
    {"id": "rule_lett_4h", "subject": "Discipline Letterarie Istituti II Grado", "percorso": "tutti", "period": "tutti", "total_hours": 4, "blocks": "2+1+1"},

    # Matematica e Fisica (Liceo Triennio): 7 ore -> 2+2+1+1+1
    {"id": "rule_matfis_7h", "subject": "Matematica e Fisica", "percorso": "liceo", "period": "triennio", "total_hours": 7, "blocks": "2+2+1+1+1"},

    # Matematica Liceo e Professionale: 5 ore -> 2+2+1, 4 ore -> 2+1+1, 3 ore -> 2+1
    {"id": "rule_mat_lic_5h", "subject": "Matematica", "percorso": "liceo", "period": "biennio", "total_hours": 5, "blocks": "2+2+1"},
    {"id": "rule_mat_lic_4h", "subject": "Matematica", "percorso": "liceo", "period": "biennio", "total_hours": 4, "blocks": "2+1+1"},
    {"id": "rule_mat_prof_4h", "subject": "Matematica", "percorso": "professionale", "period": "biennio", "total_hours": 4, "blocks": "2+1+1"},
    {"id": "rule_mat_prof_tri", "subject": "Matematica", "percorso": "professionale", "period": "triennio", "total_hours": 3, "blocks": "2+1"},
    
    # Scienze Matematiche Applicate (Tecnico): 4h -> 2+1+1, 3h -> 2+1
    {"id": "rule_sma_tec_4h", "subject": "Scienze Matematiche Applicate", "percorso": "tecnico", "period": "biennio", "total_hours": 4, "blocks": "2+1+1"},
    {"id": "rule_sma_tec_3h", "subject": "Scienze Matematiche Applicate", "percorso": "tecnico", "period": "triennio", "total_hours": 3, "blocks": "2+1"},

    # Scienze Naturali, Chimica e Biologia
    {"id": "rule_scienze_5h", "subject": "Scienze Naturali, Chimica e Biologia", "percorso": "tutti", "period": "tutti", "total_hours": 5, "blocks": "2+2+1"},
    {"id": "rule_scienze_4h", "subject": "Scienze Naturali, Chimica e Biologia", "percorso": "tutti", "period": "tutti", "total_hours": 4, "blocks": "2+1+1"},
    {"id": "rule_scienze_3h", "subject": "Scienze Naturali, Chimica e Biologia", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "2+1"},
    {"id": "rule_scienze_2h", "subject": "Scienze Naturali, Chimica e Biologia", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},
    {"id": "rule_scienze_1h", "subject": "Scienze Naturali, Chimica e Biologia", "percorso": "tutti", "period": "tutti", "total_hours": 1, "blocks": "1"},

    # Geografia: 3 ore -> 2+1, 2 ore -> 1+1
    {"id": "rule_geo_3h", "subject": "Geografia", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "2+1"},
    {"id": "rule_geo_2h", "subject": "Geografia", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},

    # Storia e Geografia: 3 ore -> 2+1
    {"id": "rule_storiageo_3h", "subject": "Storia e Geografia", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "2+1"},

    # Filosofia e Scienze Umane: 4h -> 2+1+1, 3h -> 2+1, 2h -> 1+1, 1h -> 1
    {"id": "rule_filoumane_4h", "subject": "Filosofia e Scienze Umane", "percorso": "tutti", "period": "triennio", "total_hours": 4, "blocks": "2+1+1"},
    {"id": "rule_filoumane_3h", "subject": "Filosofia e Scienze Umane", "percorso": "tutti", "period": "tutti", "total_hours": 3, "blocks": "2+1"},
    {"id": "rule_filoumane_2h", "subject": "Filosofia e Scienze Umane", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},
    {"id": "rule_filoumane_1h", "subject": "Filosofia e Scienze Umane", "percorso": "tutti", "period": "tutti", "total_hours": 1, "blocks": "1"},

    # Filosofia e Storia: 5 ore -> 2+2+1, 4 ore -> 2+1+1
    {"id": "rule_filostoria_5h", "subject": "Filosofia e Storia", "percorso": "liceo", "period": "triennio", "total_hours": 5, "blocks": "2+2+1"},
    {"id": "rule_filostoria_4h", "subject": "Filosofia e Storia", "percorso": "liceo", "period": "triennio", "total_hours": 4, "blocks": "2+1+1"},

    # Metodologie Operative (Professionale): 4h -> 2+2, 3h -> 2+1
    {"id": "rule_metop_4h", "subject": "Metodologie Operative", "percorso": "professionale", "period": "tutti", "total_hours": 4, "blocks": "2+2"},
    {"id": "rule_metop_3h", "subject": "Metodologie Operative", "percorso": "professionale", "period": "tutti", "total_hours": 3, "blocks": "2+1"},

    # Discipline Sanitarie (Professionale): 4h -> 2+1+1
    {"id": "rule_san_4h", "subject": "Discipline Sanitarie", "percorso": "professionale", "period": "triennio", "total_hours": 4, "blocks": "2+1+1"},
    
    # Legislazione Sanitaria (Professionale): 4h -> 2+1+1
    {"id": "rule_legsan_4h", "subject": "Legislazione Sanitaria", "percorso": "professionale", "period": "triennio", "total_hours": 4, "blocks": "2+1+1"},

    # Tecniche Amministrative: 4h -> 2+2, 3 ore -> 2+1
    {"id": "rule_tecnamm_4h", "subject": "Tecniche Amministrative", "percorso": "professionale", "period": "triennio", "total_hours": 4, "blocks": "2+2"},
    {"id": "rule_tecnamm_3h", "subject": "Tecniche Amministrative", "percorso": "professionale", "period": "triennio", "total_hours": 3, "blocks": "2+1"},

    # Diritto ed Economia Politica (Tecnico Triennio): 6 ore -> 2+2+1+1, 5h -> 2+2+1
    {"id": "rule_dirittopol_6h", "subject": "Diritto ed Economia Politica", "percorso": "tecnico", "period": "triennio", "total_hours": 6, "blocks": "2+2+1+1"},
    {"id": "rule_dirittopol_5h", "subject": "Diritto ed Economia Politica", "percorso": "tecnico", "period": "triennio", "total_hours": 5, "blocks": "2+2+1"},

    # Diritto e Relazioni Internazionali: 5 ore -> 2+2+1, 4 ore -> 2+1+1
    {"id": "rule_dir_rel_5h", "subject": "Diritto e Relazioni Internazionali", "percorso": "tecnico", "period": "triennio", "total_hours": 5, "blocks": "2+2+1"},
    {"id": "rule_dir_rel_4h", "subject": "Diritto e Relazioni Internazionali", "percorso": "tecnico", "period": "triennio", "total_hours": 4, "blocks": "2+1+1"},

    # Scienze Economiche - Aziendali:
    {"id": "rule_az_tec_8h", "subject": "Scienze Economiche - Aziendali", "percorso": "tecnico", "period": "triennio", "total_hours": 8, "blocks": "2+2+2+2"},
    {"id": "rule_az_tec_7h", "subject": "Scienze Economiche - Aziendali", "percorso": "tecnico", "period": "triennio", "total_hours": 7, "blocks": "2+2+2+1"},
    {"id": "rule_az_tec_6h", "subject": "Scienze Economiche - Aziendali", "percorso": "tecnico", "period": "triennio", "total_hours": 6, "blocks": "2+2+1+1"},
    {"id": "rule_az_tec_5h", "subject": "Scienze Economiche - Aziendali", "percorso": "tecnico", "period": "triennio", "total_hours": 5, "blocks": "2+2+1"},
    {"id": "rule_az_tec_2h", "subject": "Scienze Economiche - Aziendali", "percorso": "tecnico", "period": "biennio", "total_hours": 2, "blocks": "1+1"},

    # Italiano (singolo): 4h -> 2+1+1
    {"id": "rule_ita_4h", "subject": "Italiano", "percorso": "tutti", "period": "tutti", "total_hours": 4, "blocks": "2+1+1"},

    # Fisica: 2h -> 1+1
    {"id": "rule_fis_2h", "subject": "Fisica", "percorso": "tutti", "period": "tutti", "total_hours": 2, "blocks": "1+1"},

    # Macro-Materie Accorpate:
    {"id": "rule_mac_10h", "subject": "Italiano Latino Storia e Geografia", "percorso": "tutti", "period": "tutti", "total_hours": 10, "blocks": "2+2+2+2+2"},
    {"id": "rule_mac_7h_a", "subject": "Italiano Storia e Geografia", "percorso": "tutti", "period": "tutti", "total_hours": 7, "blocks": "2+2+2+1"},
    {"id": "rule_mac_7h_b", "subject": "Italiano e Latino", "percorso": "tutti", "period": "tutti", "total_hours": 7, "blocks": "2+2+2+1"}
]


class Database:
    def __init__(self):
        self.lock = threading.RLock()
        os.makedirs(DATA_DIR, exist_ok=True)
        self.data = self._init_data()

    def _init_data(self):
        data = None
        seed_data_dir = os.path.join(os.path.dirname(os.path.abspath(__file__)), "seed_data")
        seed_proj = os.path.join(seed_data_dir, "current_project.json")
        seed_solved_file = os.path.join(seed_data_dir, "solved_timetable.fet")
        demo_proj = os.path.join(DATA_DIR, "demo_paperopoli.json")
        demo_solved_file = os.path.join(DATA_DIR, "demo_solved_timetable.fet")

        if not os.path.exists(PROJECT_FILE):
            if os.path.exists(seed_proj):
                try:
                    shutil.copyfile(seed_proj, PROJECT_FILE)
                    if os.path.exists(seed_solved_file) and not os.path.exists(SOLVED_FILE):
                        shutil.copyfile(seed_solved_file, SOLVED_FILE)
                except Exception as e:
                    print("Notice: cannot copy seed_data:", e)
            elif os.path.exists(demo_proj):
                try:
                    shutil.copyfile(demo_proj, PROJECT_FILE)
                    if os.path.exists(demo_solved_file) and not os.path.exists(SOLVED_FILE):
                        shutil.copyfile(demo_solved_file, SOLVED_FILE)
                except Exception as e:
                    print("Notice: cannot copy demo_paperopoli:", e)

        if os.path.exists(PROJECT_FILE):
            try:
                with open(PROJECT_FILE, "r", encoding="utf-8") as f:
                    data = json.load(f)
            except Exception:
                pass

        if not data:
            if os.path.exists(demo_proj):
                with open(demo_proj, "r", encoding="utf-8") as f:
                    data = json.load(f)
            else:
                data = {
                    "institution": 'Liceo & Tecnico "Pico De Paperis" - Paperopoli',
                    "comments": "Configurazione orario",
                    "days": ["Lun", "Mar", "Mer", "Gio", "Ven"],
                    "hours": ["1", "2", "INT1", "3", "4", "INT2", "5", "6", "7", "8"],
                    "teachers": [],
                    "subjects": [],
                    "buildings": [
                        {"name": "Centrale", "short_code": "C", "comments": "Sede Centrale"},
                        {"name": "Succursale", "short_code": "S", "comments": "Succursale"}
                    ],
                    "rooms": [],
                    "classes": [],
                    "groups": [],
                    "activities": [],
                    "constraints": copy.deepcopy(DEFAULT_CONSTRAINTS),
                    "parameters": copy.deepcopy(DEFAULT_PARAMETERS),
                    "accorpamenti_rules": copy.deepcopy(ACCORPAMENTI_DEFAULT_RULES),
                    "day_hours_limit": copy.deepcopy(DEFAULT_DAY_HOURS),
                    "break_times": [],
                    "teacher_availability": {},
                    "class_availability": {},
                    "timetable": {},
                    "has_timetable": False
                }

        # Assicura le chiavi predefinite
        if "constraints" not in data or not data["constraints"]:
            data["constraints"] = copy.deepcopy(DEFAULT_CONSTRAINTS)
        else:
            for ck, cv in DEFAULT_CONSTRAINTS.items():
                if ck not in data["constraints"]:
                    data["constraints"][ck] = copy.deepcopy(cv)

        if "parameters" not in data or not data["parameters"]:
            data["parameters"] = copy.deepcopy(DEFAULT_PARAMETERS)
        else:
            for pk, pv in DEFAULT_PARAMETERS.items():
                if pk not in data["parameters"]:
                    data["parameters"][pk] = pv

        if "accorpamenti_rules" not in data:
            data["accorpamenti_rules"] = copy.deepcopy(ACCORPAMENTI_DEFAULT_RULES)

        if "day_hours_limit" not in data or not data["day_hours_limit"]:
            data["day_hours_limit"] = copy.deepcopy(DEFAULT_DAY_HOURS)
        if "break_times" not in data:
            data["break_times"] = []

        if "section_percorsi" not in data or not data["section_percorsi"]:
            data["section_percorsi"] = copy.deepcopy(DEFAULT_SECTION_PERCORSI)
        if "block_rules" not in data or not data["block_rules"]:
            data["block_rules"] = copy.deepcopy(DEFAULT_BLOCK_RULES)
        else:
            existing_ids = {r.get("id") for r in data["block_rules"] if r.get("id")}
            for r in DEFAULT_BLOCK_RULES:
                if r.get("id") not in existing_ids:
                    data["block_rules"].append(copy.deepcopy(r))

        # Normalizza edifici (sedi/plessi)
        norm_b = []
        for b in data.get("buildings", ["Centrale", "Succursale"]):
            if isinstance(b, dict):
                norm_b.append({
                    "name": b.get("name", "").strip(),
                    "short_code": b.get("short_code", b.get("name", "")[:1].upper()).strip(),
                    "comments": b.get("comments", "").strip()
                })
            elif isinstance(b, str) and b.strip():
                name = b.strip()
                code = "C" if "cent" in name.lower() else ("S" if "succ" in name.lower() else name[:1].upper())
                norm_b.append({"name": name, "short_code": code, "comments": ""})
        data["buildings"] = norm_b or [
            {"name": "Centrale", "short_code": "C", "comments": "Sede Centrale"},
            {"name": "Succursale", "short_code": "S", "comments": "Succursale"}
        ]

        # Applica indisponibilità liceo (le sezioni C, D, L non hanno MAI la 7ª e l'8ª ora)
        liceo_secs = ["C", "D", "L"]
        for c in data.get("classes", []):
            cname = c["name"]
            if any(cname.endswith(sec) for sec in liceo_secs):
                cur = set(data["class_availability"].get(cname, []))
                cur.add("Mar|7")
                cur.add("Mar|8")
                cur.add("Ven|7")
                cur.add("Ven|8")
                data["class_availability"][cname] = sorted(list(cur))

        # Assicura che tutte le classi e docenti abbiano una chiave di disponibilità
        for c in data.get("classes", []):
            if c["name"] not in data["class_availability"]:
                data["class_availability"][c["name"]] = []
        for t in data.get("teachers", []):
            if t["name"] not in data["teacher_availability"]:
                data["teacher_availability"][t["name"]] = []
            if "short_name" not in t or not t["short_name"]:
                t["short_name"] = compute_short_name(t["name"])

        # Ordina classi naturalmente
        if "classes" in data:
            data["classes"].sort(key=lambda c: natural_class_sort_key(c["name"]))

        # Assicura cartella snapshots e file orario risolto
        os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
        if not os.path.exists(SOLVED_FILE) and os.path.exists(seed_solved_file):
            try:
                shutil.copyfile(seed_solved_file, SOLVED_FILE)
            except Exception:
                pass

        # Se esiste SOLVED_FILE ma l'orario non è presente nel dizionario, caricalo
        if os.path.exists(SOLVED_FILE) and (not data.get("has_timetable") or not data.get("timetable")):
            try:
                solved_parsed = parse_fet_xml(SOLVED_FILE)
                if solved_parsed.get("timetable"):
                    data["timetable"] = solved_parsed["timetable"]
                    data["has_timetable"] = True
            except Exception:
                pass

        if "config_name" not in data or not data["config_name"]:
            data["config_name"] = "Configurazione Corrente"

        # Se non esistono ancora snapshot, crea lo snapshot baseline iniziale
        existing_snaps = [f for f in os.listdir(SNAPSHOTS_DIR) if f.endswith(".json")]
        if not existing_snaps:
            try:
                import datetime
                now = datetime.datetime.now()
                sid = "snap_baseline_initial"
                stats = {
                    "teachers_count": len(data.get("teachers", [])),
                    "classes_count": len(data.get("classes", [])),
                    "activities_count": len(data.get("activities", [])),
                    "rooms_count": len(data.get("rooms", [])),
                    "has_timetable": bool(data.get("has_timetable", False) and len(data.get("timetable", {})) > 0)
                }
                record = {
                    "id": sid,
                    "name": "Configurazione Base Iniziale",
                    "description": "Baseline iniziale dell'istituto con tutti i parametri e orario di riferimento",
                    "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                    "has_timetable": stats["has_timetable"],
                    "stats": stats,
                    "data": copy.deepcopy(data)
                }
                with open(os.path.join(SNAPSHOTS_DIR, f"{sid}.json"), "w", encoding="utf-8") as sf:
                    json.dump(record, sf, ensure_ascii=False, indent=2)
                if os.path.exists(SOLVED_FILE):
                    import shutil
                    shutil.copyfile(SOLVED_FILE, os.path.join(SNAPSHOTS_DIR, f"{sid}.fet"))
            except Exception as e:
                print("Errore creazione snapshot baseline:", e)

        self._save_to_disk(data)
        return data

    def _save_to_disk(self, data):
        try:
            with open(PROJECT_FILE, "w", encoding="utf-8") as f:
                json.dump(data, f, ensure_ascii=False, indent=2)
        except Exception as e:
            print("Errore salvataggio project.json:", e)

    def get_all(self):
        with self.lock:
            return self.data

    def get_summary(self):
        with self.lock:
            d = self.data
            total_hours = sum(
                a.get("duration", 1) for a in d.get("activities", [])
                if a.get("active", True) and not (a.get("subject") or "").strip().lower().startswith("disposiz")
            )
            placed = len(d.get("timetable", {})) if d.get("has_timetable") else 0
            grouped_acts = get_grouped_activities(d.get("activities", []))

            # Statistiche cattedre, ore target e ore a disposizione D
            t_hours = {}
            for a in d.get("activities", []):
                if (a.get("subject") or "").strip().lower().startswith("disposiz"):
                    continue
                dur = a.get("duration", 1)
                for t in a.get("teachers", []):
                    t_hours[t] = t_hours.get(t, 0) + dur

            tot_target = 0
            tot_disp = 0
            disp_teachers = 0
            intera_teachers = 0
            coe_teachers = 0
            spezzone_teachers = 0
            pt_teachers = 0

            for t in d.get("teachers", []):
                tname = t["name"]
                tar = t.get("target_hours", 18)
                lez = t_hours.get(tname, 0)
                disp = max(0, tar - lez)
                tot_target += tar
                tot_disp += disp
                if disp > 0:
                    disp_teachers += 1
                ctype = t.get("contract_type")
                if not ctype:
                    ctype = "coe" if t.get("is_coe") else ("part_time" if tar < 18 else "intera")
                elif ctype == "standard":
                    ctype = "intera"
                if ctype == "coe":
                    coe_teachers += 1
                elif ctype == "spezzone":
                    spezzone_teachers += 1
                elif ctype == "part_time":
                    pt_teachers += 1
                else:
                    intera_teachers += 1

            return {
                "institution": d.get("institution", ""),
                "teachers_count": len(d.get("teachers", [])),
                "classes_count": len(d.get("classes", [])),
                "subjects_count": len(d.get("subjects", [])),
                "rooms_count": len(d.get("rooms", [])),
                "buildings_count": len(d.get("buildings", [])),
                "activities_count": len(d.get("activities", [])),
                "cattedre_count": len(grouped_acts),
                "total_weekly_hours": total_hours,
                "total_target_hours": tot_target,
                "total_disp_hours": tot_disp,
                "disp_teachers_count": disp_teachers,
                "intera_teachers_count": intera_teachers,
                "coe_teachers_count": coe_teachers,
                "spezzone_teachers_count": spezzone_teachers,
                "part_time_teachers_count": pt_teachers,
                "days": d.get("days", []),
                "hours": d.get("hours", []),
                "break_times": d.get("break_times", []),
                "has_timetable": d.get("has_timetable", False),
                "placed_activities": placed,
                "locked_activities_count": len(set(d.get("locked_activities", [])) & set(d.get("timetable", {}).keys()))
            }

    def update_config(self, institution, comments, days, hours):
        with self.lock:
            self.data["institution"] = institution
            self.data["comments"] = comments
            self.data["days"] = days
            self.data["hours"] = hours
            self._save_to_disk(self.data)
            return True

    def reset_empty(self, institution="Nuovo Istituto Scolastico"):
        with self.lock:
            days = ["Lun", "Mar", "Mer", "Gio", "Ven"]
            hours = ["1", "2", "INT1", "3", "4", "INT2", "5", "6", "7", "8"]
            break_times = [f"{d}|INT1" for d in days] + [f"{d}|INT2" for d in days]
            self.data = {
                "institution": institution,
                "comments": "Progetto orario pulito",
                "days": days,
                "hours": hours,
                "day_hours_limit": {d: 6 for d in days},
                "break_times": break_times,
                "classes": [],
                "teachers": [],
                "subjects": [],
                "rooms": [],
                "buildings": [{"name": "Centrale"}, {"name": "Succursale"}],
                "activities": [],
                "teacher_availability": {},
                "class_availability": {},
                "constraints": copy.deepcopy(DEFAULT_CONSTRAINTS),
                "extra_time_constraints": [],
                "extra_space_constraints": [],
                "locked_activities": [],
                "timetable": {},
                "block_rules": []
            }
            self._save_to_disk(self.data)
            if os.path.exists(SOLVED_FILE):
                try:
                    os.remove(SOLVED_FILE)
                except Exception:
                    pass
            self.create_snapshot("Reset: Foglio Bianco", "Progetto azzerato a struttura vuota pronto per una nuova scuola.")
            return True

    def load_demo(self):
        demo_path = os.path.join(DATA_DIR, "demo_paperopoli.json")
        demo_fet = os.path.join(DATA_DIR, "demo_solved_timetable.fet")
        if not os.path.exists(demo_path):
            raise FileNotFoundError("File demo_paperopoli.json non trovato.")
        with self.lock:
            with open(demo_path, "r", encoding="utf-8") as f:
                self.data = json.load(f)
            self._save_to_disk(self.data)
            if os.path.exists(demo_fet):
                try:
                    shutil.copyfile(demo_fet, SOLVED_FILE)
                except Exception as e:
                    print("Could not copy demo solved timetable:", e)
            self.create_snapshot("Ripristino Demo Paperopoli", "Caricato database dimostrativo Liceo & Tecnico Paperopoli.")
            return True

    # --- IMPOSTAZIONI & VINCOLI ---
    def get_settings(self):
        with self.lock:
            return {
                "institution": self.data.get("institution", ""),
                "comments": self.data.get("comments", ""),
                "days": self.data.get("days", []),
                "hours": self.data.get("hours", []),
                "day_hours_limit": self.data.get("day_hours_limit", copy.deepcopy(DEFAULT_DAY_HOURS)),
                "break_times": self.data.get("break_times", []),
                "constraints": self.data.get("constraints", copy.deepcopy(DEFAULT_CONSTRAINTS)),
                "parameters": self.data.get("parameters", copy.deepcopy(DEFAULT_PARAMETERS)),
                "param_help": PARAM_HELP,
                "solo_100": list(SOLO_100_CONSTRAINTS)
            }

    def save_settings(self, settings):
        with self.lock:
            if "institution" in settings:
                self.data["institution"] = settings["institution"]
            if "comments" in settings:
                self.data["comments"] = settings["comments"]
            if "days" in settings and settings["days"]:
                self.data["days"] = settings["days"]
            if "hours" in settings and settings["hours"]:
                self.data["hours"] = settings["hours"]
            if "parameters" in settings:
                if "parameters" not in self.data:
                    self.data["parameters"] = copy.deepcopy(DEFAULT_PARAMETERS)
                self.data["parameters"].update(settings["parameters"])
            if "day_hours_limit" in settings:
                self.data["day_hours_limit"] = settings["day_hours_limit"]
                hours = self.data.get("hours", ["1", "2", "INT1", "3", "4", "INT2", "5", "6", "INT3", "7", "8"])
                days = self.data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven", "Sab"])
                new_breaks = []
                for d in days:
                    lim = int(self.data["day_hours_limit"].get(d, 6 if d != "Sab" else 0))
                    for h in hours:
                        if "int" in h.lower():
                            new_breaks.append(f"{d}|{h}")
                        elif h.isdigit():
                            if int(h) > lim or lim == 0:
                                new_breaks.append(f"{d}|{h}")
                        else:
                            if lim == 0:
                                new_breaks.append(f"{d}|{h}")
                self.data["break_times"] = new_breaks

            if "constraints" in settings:
                for k, v in settings["constraints"].items():
                    if k in self.data["constraints"]:
                        self.data["constraints"][k].update(v)
                    else:
                        self.data["constraints"][k] = v
            if "break_times" in settings:
                self.data["break_times"] = settings["break_times"]

            self._save_to_disk(self.data)
            return True

    # --- DOCENTI ---
    def get_teachers(self):
        with self.lock:
            t_stats = {}
            for a in self.data.get("activities", []):
                dur = a.get("duration", 1)
                subj = (a.get("subject") or "").strip()
                is_disp = subj.lower().startswith("disposiz")
                for t in a.get("teachers", []):
                    if t not in t_stats:
                        t_stats[t] = {"lesson_hours": 0, "disp_hours": 0, "hours": 0, "classes": set(), "subjects": set(), "cattedre": set()}
                    if is_disp:
                        t_stats[t]["disp_hours"] += dur
                    else:
                        t_stats[t]["lesson_hours"] += dur
                    t_stats[t]["hours"] += dur
                    if subj:
                        t_stats[t]["subjects"].add(subj)
                    for s in a.get("students", []):
                        t_stats[t]["classes"].add(s)
                    gid = a.get("group_id") or a.get("id")
                    t_stats[t]["cattedre"].add(gid)

            result = []
            for t in sorted(self.data.get("teachers", []), key=lambda x: x["name"].lower()):
                t_copy = copy.deepcopy(t)
                st = t_stats.get(t["name"], {"lesson_hours": 0, "disp_hours": 0, "hours": 0, "classes": set(), "subjects": set(), "cattedre": set()})
                t_copy["lesson_hours"] = st["lesson_hours"]
                t_copy["disp_hours"] = st["disp_hours"]
                t_copy["total_hours"] = st["hours"]
                t_copy["cattedre_count"] = len(st["cattedre"])
                t_copy["classes"] = sorted(list(st["classes"]), key=natural_class_sort_key)
                t_copy["subjects"] = sorted(list(st["subjects"]))
                t_copy["cdc"] = t.get("cdc", "")

                target = t.get("target_hours", 18)
                t_copy["target_hours"] = target
                # Conteggio cattedra completa: lezioni + disposizioni raggiungono o superano il target
                t_copy["is_complete"] = (st["hours"] >= target)
                t_copy["d_hours"] = st["disp_hours"]

                # Nome breve per stampe (COGNOME N.)
                t_copy["short_name"] = (t.get("short_name") or "").strip().upper() or compute_short_name(t["name"])

                # Tipologia Cattedra: intera, coe, spezzone, part_time
                ctype = t.get("contract_type")
                if not ctype:
                    if t.get("is_coe"):
                        ctype = "coe"
                    elif target < 18:
                        ctype = "spezzone"
                    else:
                        ctype = "intera"
                elif ctype == "standard":
                    ctype = "intera"
                t_copy["contract_type"] = ctype
                t_copy["is_coe"] = (ctype == "coe")
                t_copy["is_spezzone"] = (ctype == "spezzone")
                t_copy["is_part_time"] = (ctype == "part_time")
                t_copy["is_intera"] = (ctype in ("intera", "standard"))

                t_copy["max_days"] = t.get("max_days", 5)
                t_copy["min_days"] = t.get("min_days", 4)

                # Preferenze orarie & Desiderata
                t_copy["pref_shift"] = t.get("pref_shift", "none")
                t_copy["pref_shift_weight"] = t.get("pref_shift_weight", 85)
                t_copy["free_day_1"] = t.get("free_day_1", "")
                t_copy["free_day_2"] = t.get("free_day_2", "")
                t_copy["free_day_strict"] = bool(t.get("free_day_strict", False))
                t_copy["max_span"] = t.get("max_span", None)
                t_copy["max_daily_lessons"] = t.get("max_daily_lessons", None)
                t_copy["min_daily_lessons"] = t.get("min_daily_lessons", None)
                t_copy["max_gaps_per_day"] = t.get("max_gaps_per_day", None)

                result.append(t_copy)
            return result

    def add_teacher(self, name, comments="", cdc="", target_hours=18, max_days=5, min_days=4, contract_type="intera", short_name="", is_coe=False):
        with self.lock:
            name = name.strip()
            if not any(t["name"].lower() == name.lower() for t in self.data["teachers"]):
                tar = int(target_hours or 18)
                if contract_type:
                    ctype = contract_type
                elif is_coe:
                    ctype = "coe"
                elif tar < 18:
                    ctype = "spezzone"
                else:
                    ctype = "intera"
                if ctype == "standard":
                    ctype = "intera"
                sn = (short_name or "").strip().upper() or compute_short_name(name)
                self.data["teachers"].append({
                    "name": name,
                    "short_name": sn,
                    "comments": comments,
                    "cdc": (cdc or "").strip(),
                    "target_hours": tar,
                    "max_days": int(max_days or 5),
                    "min_days": int(min_days or 4),
                    "contract_type": ctype,
                    "is_coe": bool(ctype == "coe")
                })
                self.data["teachers"].sort(key=lambda t: t["name"].lower())
                self.data["teacher_availability"][name] = []
                self._save_to_disk(self.data)
                return True
            return False

    def update_teacher(self, name, teacher_data):
        with self.lock:
            for t in self.data.get("teachers", []):
                if t["name"].lower() == name.lower():
                    if "new_name" in teacher_data and teacher_data["new_name"].strip():
                        new_name = teacher_data["new_name"].strip()
                        if new_name != t["name"]:
                            old_name = t["name"]
                            avail = self.data.get("teacher_availability", {}).pop(old_name, [])
                            self.data["teacher_availability"][new_name] = avail
                            for a in self.data.get("activities", []):
                                if old_name in a.get("teachers", []):
                                    a["teachers"] = [new_name if x == old_name else x for x in a["teachers"]]
                            t["name"] = new_name
                            self.data["teachers"].sort(key=lambda x: x["name"].upper())
                    if "short_name" in teacher_data:
                        sn = teacher_data["short_name"].strip().upper()
                        t["short_name"] = sn or compute_short_name(t["name"])
                    if "comments" in teacher_data:
                        t["comments"] = teacher_data["comments"]
                    if "cdc" in teacher_data:
                        t["cdc"] = teacher_data["cdc"].strip()
                    if "target_hours" in teacher_data:
                        t["target_hours"] = int(teacher_data["target_hours"] or 18)
                    if "max_days" in teacher_data:
                        t["max_days"] = int(teacher_data["max_days"] or 5)
                    if "min_days" in teacher_data:
                        t["min_days"] = int(teacher_data["min_days"] or 4)
                    if "contract_type" in teacher_data:
                        ctype = teacher_data["contract_type"]
                        if ctype == "standard":
                            ctype = "intera"
                        t["contract_type"] = ctype
                        t["is_coe"] = (ctype == "coe")
                    elif "is_coe" in teacher_data:
                        is_coe = bool(teacher_data["is_coe"])
                        t["is_coe"] = is_coe
                        t["contract_type"] = "coe" if is_coe else ("part_time" if t.get("target_hours", 18) < 18 else "intera")

                    # Campi Preferenze & Desiderata Orario
                    if "pref_shift" in teacher_data:
                        t["pref_shift"] = (teacher_data["pref_shift"] or "none").lower()
                    if "pref_shift_weight" in teacher_data:
                        t["pref_shift_weight"] = int(teacher_data["pref_shift_weight"] or 85)
                    if "free_day_1" in teacher_data:
                        t["free_day_1"] = (teacher_data["free_day_1"] or "").strip()
                    if "free_day_2" in teacher_data:
                        t["free_day_2"] = (teacher_data["free_day_2"] or "").strip()
                    if "free_day_strict" in teacher_data:
                        t["free_day_strict"] = bool(teacher_data["free_day_strict"])
                    if "max_span" in teacher_data:
                        val = teacher_data["max_span"]
                        t["max_span"] = int(val) if val not in (None, "", "null") else None
                    if "max_daily_lessons" in teacher_data:
                        val = teacher_data["max_daily_lessons"]
                        t["max_daily_lessons"] = int(val) if val not in (None, "", "null") else None
                    if "min_daily_lessons" in teacher_data:
                        val = teacher_data["min_daily_lessons"]
                        t["min_daily_lessons"] = int(val) if val not in (None, "", "null") else None
                    if "max_gaps_per_day" in teacher_data:
                        val = teacher_data["max_gaps_per_day"]
                        t["max_gaps_per_day"] = int(val) if val not in (None, "", "null") else None

                    # Se free_day_strict è true e free_day_1 è impostato, sincronizza le indisponibilità
                    if t.get("free_day_strict") and t.get("free_day_1"):
                        fd = t["free_day_1"]
                        cur_avail = set(self.data.get("teacher_availability", {}).get(t["name"], []))
                        for h in self.data.get("hours", []):
                            if not h.upper().startswith("INT"):
                                cur_avail.add(f"{fd}|{h}")
                        self.data["teacher_availability"][t["name"]] = sorted(list(cur_avail))

                    self._save_to_disk(self.data)
                    return True
            return False

    def delete_teacher(self, name):
        with self.lock:
            self.data["teachers"] = [t for t in self.data["teachers"] if t["name"] != name]
            self.data["teacher_availability"].pop(name, None)
            self._save_to_disk(self.data)
            return True

    # --- CLASSI ---
    def get_classes(self):
        with self.lock:
            c_stats = {}
            for a in self.data.get("activities", []):
                dur = a.get("duration", 1)
                gid = a.get("group_id") or a.get("id")
                for s in a.get("students", []):
                    if s not in c_stats:
                        c_stats[s] = {"hours": 0, "cattedre": set()}
                    c_stats[s]["hours"] += dur
                    c_stats[s]["cattedre"].add(gid)

            result = []
            for c in sorted(self.data.get("classes", []), key=lambda x: natural_class_sort_key(x["name"])):
                c_copy = copy.deepcopy(c)
                st = c_stats.get(c["name"], {"hours": 0, "cattedre": set()})
                c_copy["total_hours"] = st["hours"]
                c_copy["cattedre_count"] = len(st["cattedre"])
                if "base_room" not in c_copy:
                    c_copy["base_room"] = f"Aula {c['name']}"
                if "building" not in c_copy:
                    matching_room = next((r for r in self.data.get("rooms", []) if r["name"] == c_copy["base_room"]), None)
                    c_copy["building"] = matching_room["building"] if matching_room else ("Succursale" if c["name"].endswith(("A", "B")) else "Centrale")
                result.append(c_copy)
            return result

    def add_class(self, name, students=25, comments="", base_room="", building=""):
        with self.lock:
            name = name.strip()
            if not any(c["name"].lower() == name.lower() for c in self.data["classes"]):
                bld = building.strip() or ("Succursale" if name.endswith(("A", "B")) else "Centrale")
                broom = base_room.strip() or f"Aula {name}"
                self.data["classes"].append({
                    "name": name,
                    "students": int(students or 25),
                    "building": bld,
                    "base_room": broom,
                    "comments": comments
                })
                self.data["classes"].sort(key=lambda c: natural_class_sort_key(c["name"]))
                self.data["class_availability"][name] = []
                self._save_to_disk(self.data)
                return True
            return False

    def update_class(self, name, class_data):
        with self.lock:
            for c in self.data.get("classes", []):
                if c["name"] == name:
                    if "students" in class_data:
                        c["students"] = int(class_data["students"] or 25)
                    if "building" in class_data:
                        c["building"] = class_data["building"].strip()
                    if "base_room" in class_data:
                        c["base_room"] = class_data["base_room"].strip()
                    if "comments" in class_data:
                        c["comments"] = class_data["comments"]
                    if "new_name" in class_data and class_data["new_name"].strip():
                        new_name = class_data["new_name"].strip()
                        if new_name != c["name"]:
                            old_name = c["name"]
                            avail = self.data.get("class_availability", {}).pop(old_name, [])
                            self.data["class_availability"][new_name] = avail
                            for a in self.data.get("activities", []):
                                if old_name in a.get("students", []):
                                    a["students"] = [new_name if x == old_name else x for x in a["students"]]
                            for g in self.data.get("groups", []):
                                if g.get("class_name") == old_name:
                                    g["class_name"] = new_name
                            c["name"] = new_name
                    self.data["classes"].sort(key=lambda x: natural_class_sort_key(x["name"]))
                    self._save_to_disk(self.data)
                    return True
            return False

    def delete_class(self, name):
        with self.lock:
            self.data["classes"] = [c for c in self.data["classes"] if c["name"] != name]
            self.data["class_availability"].pop(name, None)
            self._save_to_disk(self.data)
            return True

    def import_class_students_from_seed(self):
        """
        Importa o ripristina il numero di alunni per classe e gruppo
        direttamente dal file seed (originato dal foglio Excel/Google Sheet Parametri Orario).
        """
        seed_input = os.path.join(DATA_DIR, "demo_solved_timetable.fet")
        if not os.path.exists(seed_input):
            seed_input = os.path.join(DATA_DIR, "solved_timetable.fet")
        if not os.path.exists(seed_input):
            return {"success": False, "error": "File seed ParametriOrario non trovato"}
        with self.lock:
            try:
                seed_data = parse_fet_xml(seed_input)
                cls_map = {c["name"]: c.get("students", 0) for c in seed_data.get("classes", [])}
                grp_map = {g["name"]: g.get("students", 0) for g in seed_data.get("groups", [])}

                updated_classes = 0
                for c in self.data.get("classes", []):
                    if c["name"] in cls_map:
                        c["students"] = cls_map[c["name"]]
                        updated_classes += 1

                updated_groups = 0
                for g in self.data.get("groups", []):
                    if g["name"] in grp_map:
                        g["students"] = grp_map[g["name"]]
                        updated_groups += 1

                self._save_to_disk(self.data)
                return {
                    "success": True,
                    "updated_classes": updated_classes,
                    "updated_groups": updated_groups,
                    "total_students": sum(c.get("students", 0) for c in self.data.get("classes", []))
                }
            except Exception as e:
                return {"success": False, "error": str(e)}

    def update_class_students_batch(self, items):
        """
        Aggiorna il numero di studenti per una lista di classi o gruppi.
        items può essere una lista di dict [{"name": "1A", "students": 25}, ...] o un dict.
        """
        with self.lock:
            if isinstance(items, dict):
                items = [{"name": k, "students": v} for k, v in items.items()]
            c_map = {c["name"].strip().upper(): c for c in self.data.get("classes", [])}
            g_map = {g["name"].strip().upper(): g for g in self.data.get("groups", [])}
            updated_count = 0
            for item in items:
                name = str(item.get("name", "")).strip().upper()
                try:
                    num = int(item.get("students", 0))
                except (ValueError, TypeError):
                    continue
                if name in c_map:
                    c_map[name]["students"] = num
                    updated_count += 1
                elif name in g_map:
                    g_map[name]["students"] = num
                    updated_count += 1
            self._save_to_disk(self.data)
            return updated_count

    # --- GRUPPI ARTICOLATI (Tab Gruppi Excel) ---
    def get_groups(self):
        with self.lock:
            # Calcola ore per gruppo
            g_hours = {}
            for a in self.data.get("activities", []):
                dur = a.get("duration", 1)
                for s in a.get("students", []):
                    g_hours[s] = g_hours.get(s, 0) + dur

            res = []
            for g in self.data.get("groups", []):
                g_copy = copy.deepcopy(g)
                g_copy["total_hours"] = g_hours.get(g["name"], 0)
                res.append(g_copy)
            return sorted(res, key=lambda g: (natural_class_sort_key(g.get("class_name", "")), g.get("name", "")))

    def add_group(self, class_name, name, students=0, comments=""):
        with self.lock:
            name = name.strip()
            class_name = class_name.strip()
            if "groups" not in self.data:
                self.data["groups"] = []
            if not any(g["name"].lower() == name.lower() for g in self.data["groups"]):
                self.data["groups"].append({
                    "name": name,
                    "class_name": class_name,
                    "students": int(students or 0),
                    "comments": comments
                })
                self.data["groups"].sort(key=lambda g: (natural_class_sort_key(g.get("class_name", "")), g.get("name", "")))
                self._save_to_disk(self.data)
                return True
            return False

    def update_group(self, name, group_data):
        with self.lock:
            for g in self.data.get("groups", []):
                if g["name"].lower() == name.lower():
                    if "class_name" in group_data:
                        g["class_name"] = group_data["class_name"].strip()
                    if "students" in group_data:
                        g["students"] = int(group_data["students"] or 0)
                    if "comments" in group_data:
                        g["comments"] = group_data["comments"]
                    if "new_name" in group_data and group_data["new_name"].strip():
                        new_name = group_data["new_name"].strip()
                        if new_name != g["name"]:
                            old_name = g["name"]
                            for a in self.data.get("activities", []):
                                if old_name in a.get("students", []):
                                    a["students"] = [new_name if x == old_name else x for x in a["students"]]
                            g["name"] = new_name
                    self.data["groups"].sort(key=lambda x: (natural_class_sort_key(x.get("class_name", "")), x.get("name", "")))
                    self._save_to_disk(self.data)
                    return True
            return False

    def delete_group(self, name):
        with self.lock:
            self.data["groups"] = [g for g in self.data.get("groups", []) if g["name"] != name]
            self._save_to_disk(self.data)
            return True

    # --- MATERIE ---
    def get_subjects(self):
        with self.lock:
            s_stats = {}
            for a in self.data.get("activities", []):
                subj = (a.get("subject") or "").strip()
                if not subj or subj.lower().startswith("disposiz"):
                    continue
                dur = a.get("duration", 1)
                if subj not in s_stats:
                    s_stats[subj] = {"hours": 0, "classes": set(), "teachers": set(), "cattedre": set()}
                s_stats[subj]["hours"] += dur
                for t in a.get("teachers", []):
                    s_stats[subj]["teachers"].add(t)
                for s in a.get("students", []):
                    s_stats[subj]["classes"].add(s)
                gid = a.get("group_id") or a.get("id")
                s_stats[subj]["cattedre"].add(gid)

            result = []
            for s in sorted(self.data.get("subjects", []), key=lambda x: x["name"].lower()):
                if s.get("name", "").strip().lower().startswith("disposiz"):
                    continue
                s_copy = copy.deepcopy(s)
                st = s_stats.get(s["name"], {"hours": 0, "classes": set(), "teachers": set(), "cattedre": set()})
                s_copy["total_hours"] = st["hours"]
                s_copy["cattedre_count"] = len(st["cattedre"])
                s_copy["classes"] = sorted(list(st["classes"]), key=natural_class_sort_key)
                s_copy["teachers"] = sorted(list(st["teachers"]))
                s_copy["no_rientri"] = bool(s.get("no_rientri", False))
                s_copy["pref_hours"] = s.get("pref_hours", "INDIFFERENTE")
                s_copy["cdc"] = s.get("cdc", "")
                result.append(s_copy)
            return result

    def add_subject(self, name, comments="", cdc="", no_rientri=False, pref_hours="INDIFFERENTE"):
        with self.lock:
            name = name.strip()
            if not any(s["name"].lower() == name.lower() for s in self.data["subjects"]):
                self.data["subjects"].append({
                    "name": name,
                    "cdc": (cdc or "").strip(),
                    "comments": comments,
                    "no_rientri": bool(no_rientri),
                    "pref_hours": (pref_hours or "INDIFFERENTE").strip().upper()
                })
                self.data["subjects"].sort(key=lambda s: s["name"].lower())
                self._save_to_disk(self.data)
                return True
            return False

    def update_subject(self, name, subject_data):
        with self.lock:
            for s in self.data.get("subjects", []):
                if s["name"].lower() == name.lower():
                    if "cdc" in subject_data:
                        s["cdc"] = subject_data["cdc"].strip()
                    if "comments" in subject_data:
                        s["comments"] = subject_data["comments"]
                    if "no_rientri" in subject_data:
                        s["no_rientri"] = bool(subject_data["no_rientri"])
                    if "pref_hours" in subject_data:
                        s["pref_hours"] = (subject_data["pref_hours"] or "INDIFFERENTE").strip().upper()
                    if "new_name" in subject_data and subject_data["new_name"].strip():
                        new_name = subject_data["new_name"].strip()
                        if new_name != s["name"]:
                            old_name = s["name"]
                            for a in self.data.get("activities", []):
                                if a.get("subject") == old_name:
                                    a["subject"] = new_name
                            s["name"] = new_name
                    self.data["subjects"].sort(key=lambda x: x["name"].lower())
                    self._save_to_disk(self.data)
                    return True
            return False

    def delete_subject(self, name):
        with self.lock:
            self.data["subjects"] = [s for s in self.data["subjects"] if s["name"] != name]
            self._save_to_disk(self.data)
            return True

    # --- AULE & PLESSI ---
    def get_rooms(self):
        with self.lock:
            class_by_room = {}
            for c in self.data.get("classes", []):
                broom = c.get("base_room") or f"Aula {c['name']}"
                class_by_room.setdefault(broom, []).append(c)

            rooms_res = []
            for r in self.data.get("rooms", []):
                r_copy = copy.deepcopy(r)
                nl = r["name"].lower()
                comm = (r.get("comments") or "").lower()
                if "room_type" not in r_copy:
                    if "palestra" in nl or "palestra" in comm or "sport" in nl or "sport" in comm:
                        r_copy["room_type"] = "gym"
                        r_copy["is_lab_or_gym"] = True
                    elif "lab" in nl or "lab" in comm or "info" in nl or "info" in comm or "scienz" in nl or "chim" in nl or "fisic" in nl or "lingue" in nl:
                        r_copy["room_type"] = "lab"
                        r_copy["is_lab_or_gym"] = True
                    else:
                        r_copy["room_type"] = "standard"
                        r_copy["is_lab_or_gym"] = False
                if "is_lab_or_gym" not in r_copy:
                    r_copy["is_lab_or_gym"] = r_copy.get("room_type") in ("lab", "gym")

                assigned = class_by_room.get(r["name"], [])
                r_copy["assigned_classes"] = [c["name"] for c in sorted(assigned, key=lambda x: natural_class_sort_key(x["name"]))]
                r_copy["assigned_class_students"] = sum(c.get("students", 25) for c in assigned)
                rooms_res.append(r_copy)

            rooms_res.sort(key=lambda r: (r.get("building", ""), r.get("room_type", ""), r.get("name", "")))

            # Formatta buildings con conteggi aggregati
            b_list = []
            for b in self.data.get("buildings", []):
                b_name = b["name"] if isinstance(b, dict) else str(b)
                b_code = b.get("short_code", b_name[:1].upper()) if isinstance(b, dict) else b_name[:1].upper()
                b_comm = b.get("comments", "") if isinstance(b, dict) else ""
                r_cnt = sum(1 for r in self.data.get("rooms", []) if r.get("building") == b_name)
                c_cnt = sum(1 for c in self.data.get("classes", []) if c.get("building") == b_name)
                b_list.append({
                    "name": b_name,
                    "short_code": b_code,
                    "comments": b_comm,
                    "rooms_count": r_cnt,
                    "classes_count": c_cnt
                })

            return {
                "rooms": rooms_res,
                "buildings": b_list
            }

    def add_room(self, name, building="Centrale", capacity=30, room_type="standard", is_lab_or_gym=False, comments=""):
        with self.lock:
            name = name.strip()
            building = building.strip() or "Centrale"
            if not any(r["name"].lower() == name.lower() for r in self.data["rooms"]):
                rtype = room_type or ("gym" if "palestra" in name.lower() else ("lab" if "lab" in name.lower() or "info" in name.lower() else "standard"))
                is_lab_gym = bool(is_lab_or_gym or rtype in ("lab", "gym"))
                self.data["rooms"].append({
                    "name": name,
                    "building": building,
                    "capacity": int(capacity or 30),
                    "room_type": rtype,
                    "is_lab_or_gym": is_lab_gym,
                    "comments": comments
                })
                # Assicura presenza del building
                bld_names = [b["name"] if isinstance(b, dict) else str(b) for b in self.data.get("buildings", [])]
                if building and building not in bld_names:
                    self.data.setdefault("buildings", []).append({
                        "name": building,
                        "short_code": building[:1].upper(),
                        "comments": ""
                    })
                self._save_to_disk(self.data)
                return True
            return False

    def update_room(self, old_name, room_data):
        with self.lock:
            for r in self.data.get("rooms", []):
                if r["name"] == old_name:
                    new_name = room_data.get("name", old_name).strip()
                    new_bld = room_data.get("building", r.get("building", "Centrale")).strip()
                    new_cap = int(room_data.get("capacity", r.get("capacity", 30)) or 30)
                    rtype = room_data.get("room_type", r.get("room_type", "standard"))
                    is_lab_gym = bool(room_data.get("is_lab_or_gym", rtype in ("lab", "gym")))
                    comments = room_data.get("comments", r.get("comments", ""))

                    r["name"] = new_name
                    r["building"] = new_bld
                    r["capacity"] = new_cap
                    r["room_type"] = rtype
                    r["is_lab_or_gym"] = is_lab_gym
                    r["comments"] = comments

                    bld_names = [b["name"] if isinstance(b, dict) else str(b) for b in self.data.get("buildings", [])]
                    if new_bld and new_bld not in bld_names:
                        self.data.setdefault("buildings", []).append({
                            "name": new_bld,
                            "short_code": new_bld[:1].upper(),
                            "comments": ""
                        })

                    # Se il nome è cambiato, aggiorna i riferimenti in classi e timetable
                    if old_name != new_name:
                        for c in self.data.get("classes", []):
                            if c.get("base_room") == old_name:
                                c["base_room"] = new_name
                        for aid, pl in self.data.get("timetable", {}).items():
                            if pl.get("room") == old_name:
                                pl["room"] = new_name

                    self._save_to_disk(self.data)
                    return True
            return False

    def delete_room(self, name):
        with self.lock:
            self.data["rooms"] = [r for r in self.data["rooms"] if r["name"] != name]
            self._save_to_disk(self.data)
            return True

    def add_building(self, name, short_code="C", comments=""):
        with self.lock:
            name = name.strip()
            short_code = (short_code or name[:1]).strip().upper()
            if not name:
                return False
            for b in self.data.get("buildings", []):
                bn = b["name"] if isinstance(b, dict) else str(b)
                if bn.lower() == name.lower():
                    return False
            self.data.setdefault("buildings", []).append({
                "name": name,
                "short_code": short_code,
                "comments": comments
            })
            self._save_to_disk(self.data)
            return True

    def update_building(self, old_name, new_name, short_code="C", comments=""):
        with self.lock:
            old_name = old_name.strip()
            new_name = new_name.strip() or old_name
            short_code = (short_code or new_name[:1]).strip().upper()
            found = False
            for b in self.data.get("buildings", []):
                bn = b["name"] if isinstance(b, dict) else str(b)
                if bn.lower() == old_name.lower():
                    if isinstance(b, dict):
                        b["name"] = new_name
                        b["short_code"] = short_code
                        b["comments"] = comments
                    else:
                        idx = self.data["buildings"].index(b)
                        self.data["buildings"][idx] = {
                            "name": new_name,
                            "short_code": short_code,
                            "comments": comments
                        }
                    found = True
                    break
            if not found:
                return False

            if old_name != new_name:
                for r in self.data.get("rooms", []):
                    if r.get("building") == old_name:
                        r["building"] = new_name
                for c in self.data.get("classes", []):
                    if c.get("building") == old_name:
                        c["building"] = new_name

            self._save_to_disk(self.data)
            return True

    def delete_building(self, name):
        with self.lock:
            name = name.strip()
            self.data["buildings"] = [
                b for b in self.data.get("buildings", [])
                if (b["name"] if isinstance(b, dict) else str(b)).lower() != name.lower()
            ]
            self._save_to_disk(self.data)
            return True

    # --- INDIRIZZI PERCORSI (SEZIONI) & REGOLE BLOCCHI ORARI ---
    def get_section_for_class(self, class_or_group_name):
        name = (class_or_group_name or "").strip()
        m = re.match(r"^([0-9]+)([A-Za-z]+)", name)
        if m:
            sec_full = m.group(2).upper()
            return sec_full[0]
        return ""

    def get_class_percorso_and_period(self, class_or_group_name):
        name = (class_or_group_name or "").strip()
        m = re.match(r"^([0-9]+)([A-Za-z]+)", name)
        if m:
            y = int(m.group(1))
            sec_letter = m.group(2).upper()[0]
            percorso_map = self.data.get("section_percorsi", DEFAULT_SECTION_PERCORSI)
            perc = percorso_map.get(sec_letter, "tecnico")
            period = "biennio" if y <= 2 else "triennio"
            return sec_letter, perc, period
        return "", "tecnico", "biennio"

    def get_section_percorsi(self):
        with self.lock:
            mapping = dict(self.data.get("section_percorsi", DEFAULT_SECTION_PERCORSI))
            all_classes = self.data.get("classes", [])
            sec_classes = defaultdict(list)
            for c in all_classes:
                cname = c.get("name", "")
                m = re.match(r"^([0-9]+)([A-Za-z]+)", cname)
                if m:
                    sec_letter = m.group(2).upper()[0]
                    sec_classes[sec_letter].append(cname)

            sections_list = []
            for sec in sorted(sec_classes.keys()):
                perc = mapping.get(sec, "tecnico")
                sections_list.append({
                    "section": sec,
                    "percorso": perc,
                    "classes_count": len(sec_classes[sec]),
                    "classes": sorted(sec_classes[sec], key=natural_class_sort_key)
                })

            return {
                "section_percorsi": mapping,
                "sections": sections_list
            }

    def set_section_percorsi(self, new_mapping):
        with self.lock:
            cur = self.data.get("section_percorsi", {})
            cur.update(new_mapping)
            self.data["section_percorsi"] = cur
            self._save_to_disk(self.data)
            return self.get_section_percorsi()

    def get_block_rules(self):
        with self.lock:
            return self.data.get("block_rules", DEFAULT_BLOCK_RULES)

    def save_block_rule(self, rule):
        with self.lock:
            rules = self.data.get("block_rules", [])
            r_id = rule.get("id") or f"rule_{int(time.time()*1000)}"
            rule["id"] = r_id
            idx = next((i for i, r in enumerate(rules) if r.get("id") == r_id), -1)
            if idx >= 0:
                rules[idx] = rule
            else:
                rules.append(rule)
            self.data["block_rules"] = rules
            self._save_to_disk(self.data)
            return rule

    def delete_block_rule(self, rule_id):
        with self.lock:
            rules = self.data.get("block_rules", [])
            self.data["block_rules"] = [r for r in rules if r.get("id") != rule_id]
            self._save_to_disk(self.data)
            return True

    def get_teacher_effective_max_days(self, teacher_name):
        """
        Calcola il numero massimo effettivo di giorni lavorativi per un docente,
        considerando sia max_days configurato che i giorni con disponibilità oraria.
        """
        t = next((x for x in self.data.get("teachers", []) if x.get("name") == teacher_name), None)
        days = self.data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven"])
        active_days = [d for d in days if d != "Sab"]
        if not t:
            return len(active_days)

        md = t.get("max_days")
        unavail = set(self.data.get("teacher_availability", {}).get(teacher_name, []))

        # Conta quanti giorni hanno almeno uno slot libero
        avail_days = 0
        for d in active_days:
            lim = int(self.data.get("day_hours_limit", {}).get(d, 6))
            free_slots = sum(1 for h in range(1, lim + 1) if f"{d}|{h}" not in unavail)
            if free_slots > 0:
                avail_days += 1

        if md is not None and int(md) > 0:
            return min(int(md), avail_days)
        return avail_days

    def partition_hours_for_days(self, total_hours, max_days):
        """
        Partiziona un monte ore didattico in blocchi equilibrati compatibili con i vincoli della scuola e del docente.
        Distribuisce le ore in modo omogeneo su un numero di giorni pari a max_days.
        Esempi:
        - 10h su 4 giorni -> 3+3+2+2
        - 10h su 5 giorni -> 2+2+2+2+2
        - 7h su 4 giorni  -> 2+2+2+1
        - 6h su 3 giorni  -> 2+2+2
        - 4h su 2 giorni  -> 2+2
        """
        th = int(total_hours)
        md = max(1, int(max_days))
        if md >= th:
            return "+".join(["1"] * th)
        base = th // md
        rem = th % md
        parts = [base + 1] * rem + [base] * (md - rem)
        return "+".join(map(str, parts))

    def check_cattedra_feasibility(self, teachers, students, subject, total_hours, blocks_str):
        """
        Verifica la fattibilità della suddivisione in blocchi per una cattedra
        rispetto ai vincoli del docente (giorni massimi, disponibilità) e della classe.
        """
        # Disposizioni non sono cattedre di lezione frontale e non richiedono suddivisione in blocchi
        if (subject or "").strip().lower().startswith("disposiz"):
            return {
                "is_feasible": True,
                "warnings": [],
                "suggested_blocks": ""
            }

        th = int(total_hours)
        blocks = [int(p) for p in str(blocks_str).replace(",", "+").split("+") if p.strip().isdigit()]
        num_blocks = len(blocks)
        warnings = []
        is_feasible = True
        suggested_blocks = ""

        # Verifica se ci sono blocchi con durata > 3 (blocchi da 3h sono ammessi tramite sub-attività raggruppate)
        invalid_blocks = [b for b in blocks if b > 3]
        if invalid_blocks:
            is_feasible = False
            suggested_blocks = self.partition_hours_for_days(th, len(self.data.get("days", [])))
            warnings.append(
                f"I blocchi con durata > 3 ore ({', '.join(map(str, invalid_blocks))}) non sono consentiti. "
                f"Suddivisione consigliata: {suggested_blocks}."
            )

        if isinstance(teachers, str):
            teachers = [t.strip() for t in teachers.split("+") if t.strip()]

        for tname in (teachers or []):
            if not tname or tname == "[Nessun docente]":
                continue
            eff_max_days = self.get_teacher_effective_max_days(tname)
            if num_blocks > eff_max_days:
                suggested_blocks = self.partition_hours_for_days(th, eff_max_days)
                is_feasible = False
                warnings.append(
                    f"Il docente {tname} ha un limite di {eff_max_days} giorni a settimana. "
                    f"Con {num_blocks} blocchi ({blocks_str}), la suddivisione consigliata è {suggested_blocks}."
                )

        return {
            "is_feasible": is_feasible,
            "warnings": warnings,
            "suggested_blocks": suggested_blocks
        }

    def get_default_blocks(self, subject, class_or_group_name, total_hours, teacher_names=None):
        sec_letter, perc, period = self.get_class_percorso_and_period(class_or_group_name)
        th = int(total_hours)
        rules = self.data.get("block_rules", DEFAULT_BLOCK_RULES)

        cand = []
        for r in rules:
            r_subj = r.get("subject", "").strip()
            r_perc = r.get("percorso", "tutti").strip().lower()
            r_per = r.get("period", "tutti").strip().lower()
            r_th = int(r.get("total_hours", 0))

            subj_match = (r_subj == subject or r_subj == "*")
            perc_match = (r_perc == perc or r_perc == "tutti")
            per_match = (r_per == period or r_per == "tutti")
            th_match = (r_th == th or r_th == 0)

            if subj_match and perc_match and per_match and th_match:
                score = 0
                if r_subj == subject: score += 100
                if r_perc == perc: score += 50
                if r_per == period: score += 30
                if r_th == th: score += 20
                cand.append((score, r.get("blocks", "")))

        if cand:
            cand.sort(key=lambda x: x[0], reverse=True)
            std_blocks = cand[0][1]
        else:
            std_blocks = compute_fallback_blocks(th, subject)

        # Controllo di fattibilità rispetto ai giorni massimi del docente
        if teacher_names:
            if isinstance(teacher_names, str):
                teacher_names = [t.strip() for t in teacher_names.split("+") if t.strip()]
            t_max_days_list = [self.get_teacher_effective_max_days(tn) for tn in teacher_names if tn and tn != "[Nessun docente]"]
            if t_max_days_list:
                min_t_max_days = min(t_max_days_list)
                num_blocks = len([p for p in std_blocks.split("+") if p.strip().isdigit()])
                if num_blocks > min_t_max_days and min_t_max_days > 0:
                    return self.partition_hours_for_days(th, min_t_max_days)

        return std_blocks

    # --- ATTIVITÀ & CATTEDRE ---
    def get_activities(self, include_disposizioni=False):
        with self.lock:
            acts = self.data.get("activities", [])
            if not include_disposizioni:
                acts = [a for a in acts if not (a.get("subject") or "").strip().lower().startswith("disposiz")]
            return sorted(acts, key=lambda a: (
                natural_class_sort_key((a.get("students", [""])[0] if a.get("students") else "")),
                a.get("subject", ""),
                (a.get("teachers", [""])[0] if a.get("teachers") else "")
            ))

    def get_grouped_activities(self):
        with self.lock:
            grouped = get_grouped_activities(self.data.get("activities", []))
            for g in grouped:
                first_st = g["students"][0] if g["students"] else ""
                sec, perc, period = self.get_class_percorso_and_period(first_st)
                def_b = self.get_default_blocks(g["subject"], first_st, g["total_hours"], g["teachers"])
                g["section"] = sec
                g["percorso"] = perc
                g["period"] = period
                g["default_blocks"] = def_b
                g["is_exception"] = (g["blocks"] != def_b)

                # Controllo fattibilità vincoli docente e classe
                feas = self.check_cattedra_feasibility(
                    g["teachers"], g["students"], g["subject"], g["total_hours"], g["blocks"]
                )
                g["is_feasible"] = feas["is_feasible"]
                g["feasibility_warnings"] = feas["warnings"]
                g["suggested_blocks"] = feas["suggested_blocks"]

            grouped.sort(key=lambda g: (
                natural_class_sort_key(g.get("students_display", "")),
                g.get("subject", ""),
                g.get("teachers_display", "")
            ))
            return grouped

    def save_cattedra(self, teachers, students, subject, total_hours, blocks_str="default", room="", active=True, comments=""):
        """
        Crea o aggiorna un'intera cattedra/insegnamento, generando automaticamente
        le sotto-attività atomiche FET collegate dallo stesso group_id.
        Se blocks_str è vuoto o 'default', applica la suddivisione stabilita per materia, percorso e periodo.
        Se viene specificata una suddivisione diversa, la registra come ECCEZIONE personalizzata.
        """
        with self.lock:
            acts = self.data["activities"]
            
            # Normalizzazione liste
            if isinstance(teachers, str):
                teachers = [t.strip() for t in teachers.split("+") if t.strip()]
            if isinstance(students, str):
                students = [s.strip() for s in students.split("+") if s.strip()]

            total_hours = int(total_hours)
            first_st = students[0] if students else ""
            default_b = self.get_default_blocks(subject, first_st, total_hours, teachers)

            is_custom = False
            durations = []
            req_blocks = (blocks_str or "").strip()

            if req_blocks and req_blocks.lower() != "default":
                for part in req_blocks.replace(",", "+").split("+"):
                    part = part.strip()
                    if part.isdigit() and int(part) > 0:
                        durations.append(int(part))
                if durations and sum(durations) == total_hours:
                    blocks_canonical = "+".join(map(str, durations))
                    is_custom = (blocks_canonical != default_b)
                else:
                    durations = []

            if not durations or sum(durations) != total_hours:
                # Applica il default stabilito per materia, percorso e periodo
                durations = []
                for part in default_b.split("+"):
                    if part.strip().isdigit() and int(part.strip()) > 0:
                        durations.append(int(part.strip()))
                if not durations or sum(durations) != total_hours:
                    fb = compute_fallback_blocks(total_hours, subject)
                    durations = [int(p) for p in fb.split("+") if p.isdigit()]
                is_custom = False

            # Genera ID progressivo e group_id condiviso
            max_id = max([int(a["id"]) for a in acts if str(a["id"]).isdigit()] or [0])
            group_id = str(max_id + 1)

            created_sub_acts = []
            canonical_blocks = "+".join(map(str, durations))
            for d in durations:
                max_id += 1
                sub_act = {
                    "id": str(max_id),
                    "teachers": teachers,
                    "students": students,
                    "subject": subject,
                    "duration": d,
                    "group_id": group_id,
                    "room": (room or "").strip(),
                    "active": bool(active),
                    "comments": comments,
                    "is_custom_blocks": is_custom,
                    "custom_blocks": canonical_blocks if is_custom else ""
                }
                acts.append(sub_act)
                created_sub_acts.append(sub_act)

            self._save_to_disk(self.data)
            return {
                "group_id": group_id,
                "created_count": len(created_sub_acts),
                "total_hours": total_hours,
                "blocks": canonical_blocks,
                "default_blocks": default_b,
                "is_exception": is_custom,
                "sub_activities": created_sub_acts
            }

    def update_cattedra(self, old_sub_ids, teachers, students, subject, total_hours, blocks_str="default", room="", active=True, comments=""):
        with self.lock:
            id_set = set(str(x) for x in old_sub_ids)
            old_acts = [a for a in self.data["activities"] if str(a["id"]) in id_set]
            if not old_acts:
                return None

            # Rimuove le vecchie sotto-attività e le relative assegnazioni orario
            self.data["activities"] = [a for a in self.data["activities"] if str(a["id"]) not in id_set]
            for aid in id_set:
                self.data["timetable"].pop(aid, None)

            # Salva con le nuove impostazioni
            return self.save_cattedra(
                teachers=teachers,
                students=students,
                subject=subject,
                total_hours=total_hours,
                blocks_str=blocks_str,
                room=room,
                active=active,
                comments=comments
            )

    def update_cattedra_blocks(self, old_sub_ids, new_blocks_str):
        with self.lock:
            id_set = set(str(x) for x in old_sub_ids)
            old_acts = [a for a in self.data["activities"] if str(a["id"]) in id_set]
            if not old_acts:
                return None

            sample = old_acts[0]
            teachers = sample.get("teachers", [])
            students = sample.get("students", [])
            subject = sample.get("subject", "")
            room = sample.get("room", "")
            active = sample.get("active", True)
            comments = sample.get("comments", "")
            total_hours = sum(a.get("duration", 1) for a in old_acts)

            # Rimuove le vecchie sotto-attività
            self.data["activities"] = [a for a in self.data["activities"] if str(a["id"]) not in id_set]
            for aid in id_set:
                self.data["timetable"].pop(aid, None)

            # Ricrea con i nuovi blocchi
            return self.save_cattedra(
                teachers=teachers,
                students=students,
                subject=subject,
                total_hours=total_hours,
                blocks_str=new_blocks_str,
                room=room,
                active=active,
                comments=comments
            )

    def reset_cattedra_to_default_blocks(self, old_sub_ids):
        with self.lock:
            id_set = set(str(x) for x in old_sub_ids)
            old_acts = [a for a in self.data["activities"] if str(a["id"]) in id_set]
            if not old_acts:
                return None
            sample = old_acts[0]
            first_st = sample.get("students", [""])[0] if sample.get("students") else ""
            teachers = sample.get("teachers", [])
            total_hours = sum(a.get("duration", 1) for a in old_acts)
            def_blocks = self.get_default_blocks(sample.get("subject", ""), first_st, total_hours, teachers)
            return self.update_cattedra_blocks(old_sub_ids, def_blocks)

    def reset_all_cattedre_to_default_blocks(self):
        """
        Cancella tutte le suddivisioni puntuali / eccezioni per tutte le cattedre.
        Rigenera tutte le sotto-attività FET in base alla regola di default
        stabilita per materia, percorso (liceo/tecnico/professionale) e periodo (biennio/triennio).
        Rimuove anche vincoli obsoleti ConstraintMinDaysBetweenActivities in extra_time_constraints.
        """
        with self.lock:
            old_acts = self.data.get("activities", [])
            grouped = get_grouped_activities(old_acts)

            # Rimuove vincoli obsoleti ConstraintMinDaysBetweenActivities da extra_time_constraints
            etc = self.data.get("extra_time_constraints", [])
            self.data["extra_time_constraints"] = [
                x for x in etc if x.get("tag") != "ConstraintMinDaysBetweenActivities"
            ]

            # Aggiorna block_rules con le regole predefinite
            self.data["block_rules"] = copy.deepcopy(DEFAULT_BLOCK_RULES)

            new_acts = []
            max_id = 0

            for grp in grouped:
                teachers = grp.get("teachers", [])
                students = grp.get("students", [])
                subject = grp.get("subject", "")
                total_hours = int(grp.get("total_hours", 0))
                room = grp.get("room", "")
                active = grp.get("active", True)
                comments = grp.get("comments", "")

                first_st = students[0] if students else ""
                def_blocks = self.get_default_blocks(subject, first_st, total_hours, teachers)

                durations = []
                for p in def_blocks.split("+"):
                    p = p.strip()
                    if p.isdigit() and int(p) > 0:
                        durations.append(int(p))

                if not durations or sum(durations) != total_hours:
                    fb = compute_fallback_blocks(total_hours, subject)
                    durations = [int(p) for p in fb.split("+") if p.isdigit()]

                group_id = str(max_id + 1)
                canonical_blocks = "+".join(map(str, durations))
                for d in durations:
                    max_id += 1
                    sub_act = {
                        "id": str(max_id),
                        "teachers": teachers,
                        "students": students,
                        "subject": subject,
                        "duration": d,
                        "group_id": group_id,
                        "room": room,
                        "active": bool(active),
                        "comments": comments,
                        "is_custom_blocks": False,
                        "custom_blocks": ""
                    }
                    new_acts.append(sub_act)

            self.data["activities"] = new_acts
            self.data["timetable"] = {}
            self.data["has_timetable"] = False

            # Rimuove vincoli di spazio che fanno riferimento ad Activity_Id non più validi
            valid_ids = {str(a["id"]) for a in new_acts}
            esc = self.data.get("extra_space_constraints", [])
            for sc in esc:
                if sc.get("tag") == "ConstraintActivityPreferredRooms":
                    continue
                xml_s = sc.get("xml", "")
                m = re.search(r"<Activity_Id>(\d+)</Activity_Id>", xml_s)
                if m:
                    continue
                clean_esc.append(sc)
            self.data["extra_space_constraints"] = clean_esc

            self._save_to_disk(self.data)
            return {
                "success": True,
                "cattedre_count": len(grouped),
                "activities_count": len(new_acts)
            }

    def delete_cattedra(self, sub_activity_ids):
        """
        Elimina tutte le sotto-attività associate a una cattedra.
        """
        with self.lock:
            id_set = set(str(x) for x in sub_activity_ids)
            self.data["activities"] = [a for a in self.data["activities"] if str(a["id"]) not in id_set]
            for aid in id_set:
                self.data["timetable"].pop(aid, None)
            self._save_to_disk(self.data)
            return True

    def save_activity(self, act_data):
        with self.lock:
            aid = str(act_data.get("id", ""))
            acts = self.data["activities"]

            # Normalizzazione campi
            if isinstance(act_data.get("teachers"), str):
                act_data["teachers"] = [t.strip() for t in act_data["teachers"].split("+") if t.strip()]
            if isinstance(act_data.get("students"), str):
                act_data["students"] = [s.strip() for s in act_data["students"].split("+") if s.strip()]
            if "duration" in act_data:
                act_data["duration"] = int(act_data["duration"] or 1)
            if "active" in act_data:
                act_data["active"] = bool(act_data["active"])
            if "room" in act_data:
                act_data["room"] = (act_data["room"] or "").strip()

            if not aid:
                max_id = max([int(a["id"]) for a in acts if str(a["id"]).isdigit()] or [0])
                aid = str(max_id + 1)
                act_data["id"] = aid
                acts.append(act_data)
            else:
                for idx, a in enumerate(acts):
                    if str(a["id"]) == aid:
                        if "group_id" not in act_data and "group_id" in a:
                            act_data["group_id"] = a["group_id"]
                        acts[idx] = act_data
                        break
                else:
                    acts.append(act_data)
            self._save_to_disk(self.data)
            return act_data

    def delete_activity(self, aid):
        with self.lock:
            aid = str(aid)
            self.data["activities"] = [a for a in self.data["activities"] if str(a["id"]) != aid]
            self.data["timetable"].pop(aid, None)
            self._save_to_disk(self.data)
            return True

    # --- INDISPONIBILITÀ ---
    def get_availability(self):
        with self.lock:
            # Assicura chiavi complete
            for c in self.data.get("classes", []):
                if c["name"] not in self.data["class_availability"]:
                    self.data["class_availability"][c["name"]] = []
            for t in self.data.get("teachers", []):
                if t["name"] not in self.data["teacher_availability"]:
                    self.data["teacher_availability"][t["name"]] = []

            liceo_secs = ["C", "D", "L"]
            liceo_classes = [c["name"] for c in self.data.get("classes", []) if any(c["name"].endswith(sec) for sec in liceo_secs)]

            return {
                "teachers": self.data.get("teacher_availability", {}),
                "classes": self.data.get("class_availability", {}),
                "break_times": self.data.get("break_times", []),
                "days": self.data.get("days", []),
                "hours": self.data.get("hours", []),
                "day_hours_limit": self.data.get("day_hours_limit", copy.deepcopy(DEFAULT_DAY_HOURS)),
                "liceo_classes": sorted(liceo_classes, key=natural_class_sort_key),
                "all_classes": sorted([c["name"] for c in self.data.get("classes", [])], key=natural_class_sort_key),
                "all_teachers": sorted([t["name"] for t in self.data.get("teachers", [])], key=lambda x: x.lower())
            }

    def set_teacher_availability(self, teacher_name, slots):
        with self.lock:
            self.data["teacher_availability"][teacher_name] = slots
            self._save_to_disk(self.data)
            return True

    def set_class_availability(self, class_name, slots):
        with self.lock:
            self.data["class_availability"][class_name] = slots
            self._save_to_disk(self.data)
            return True

    def apply_liceo_preset(self, class_name=None):
        """
        Applica il vincolo orario Liceo (max 6 ore, nessuna 7ª o 8ª ora).
        """
        with self.lock:
            targets = [class_name] if class_name else [c["name"] for c in self.data.get("classes", []) if any(c["name"].endswith(sec) for sec in ["C", "D", "L"])]
            for c in targets:
                cur = set(self.data["class_availability"].get(c, []))
                cur.add("Mar|7")
                cur.add("Mar|8")
                cur.add("Ven|7")
                cur.add("Ven|8")
                if c in ["1C", "1D", "1L"]:
                    cur.add("Mar|6")
                    cur.add("Gio|6")
                elif c in ["2C", "2D", "2L"]:
                    cur.add("Ven|6")
                    cur.add("Gio|6")
                self.data["class_availability"][c] = sorted(list(cur))
            self._save_to_disk(self.data)
            return True

    # --- TIMETABLE ---
    def get_timetable_views(self):
        with self.lock:
            return build_timetable_views(self.data)

    def toggle_activity_lock(self, aid, locked=None):
        with self.lock:
            aid = str(aid)
            tt = self.data.get("timetable", {})
            if aid not in tt:
                return {"success": False, "error": "Attività non presente nell'orario"}
            locked_set = set(str(x) for x in self.data.get("locked_activities", []))
            if locked is None:
                if aid in locked_set:
                    locked_set.remove(aid)
                    is_locked = False
                else:
                    locked_set.add(aid)
                    is_locked = True
            elif locked:
                locked_set.add(aid)
                is_locked = True
            else:
                locked_set.discard(aid)
                is_locked = False
            self.data["locked_activities"] = sorted(list(locked_set))
            self._save_to_disk(self.data)
            return {"success": True, "activity_id": aid, "locked": is_locked, "total_locked": len(locked_set)}

    def lock_class_activities(self, class_name, locked=True):
        with self.lock:
            locked_set = set(str(x) for x in self.data.get("locked_activities", []))
            tt = self.data.get("timetable", {})
            modified_count = 0
            for a in self.data.get("activities", []):
                if class_name in a.get("students", []):
                    aid = str(a["id"])
                    if aid in tt:
                        if locked:
                            if aid not in locked_set:
                                locked_set.add(aid)
                                modified_count += 1
                        else:
                            if aid in locked_set:
                                locked_set.discard(aid)
                                modified_count += 1
            self.data["locked_activities"] = sorted(list(locked_set))
            self._save_to_disk(self.data)
            return {"success": True, "class_name": class_name, "locked": locked, "modified": modified_count, "total_locked": len(locked_set)}

    def unlock_all_activities(self):
        with self.lock:
            count = len(self.data.get("locked_activities", []))
            self.data["locked_activities"] = []
            self._save_to_disk(self.data)
            return {"success": True, "unlocked_count": count}

    def move_timetable_activity(self, activity_id, new_day, new_hour, new_room=None):
        """
        Sposta manualmente un'attività o disposizione nell'orario risolto (ad es. tramite drag & drop).
        """
        with self.lock:
            tt = self.data.get("timetable", {})
            aid = str(activity_id)
            if aid not in tt:
                tt[aid] = {}
            tt[aid]["day"] = new_day
            tt[aid]["hour"] = str(new_hour)
            if new_room is not None:
                tt[aid]["room"] = new_room
            self.data["timetable"] = tt
            self.data["has_timetable"] = True
            self._save_to_disk(self.data)
            return {"success": True, "activity_id": aid, "day": new_day, "hour": str(new_hour)}

    def update_activity_custom_desc(self, activity_id, custom_desc):
        """
        Aggiorna la descrizione personalizzata di un'attività (es. 'Lab' per un'ora di disposizione).
        """
        with self.lock:
            aid = str(activity_id)
            found = False
            for a in self.data.get("activities", []):
                if str(a.get("id")) == aid:
                    a["custom_desc"] = (custom_desc or "").strip()
                    found = True
                    break
            if found:
                self._save_to_disk(self.data)
                return {"success": True, "activity_id": aid, "custom_desc": (custom_desc or "").strip()}
            return {"success": False, "error": f"Attività #{aid} non trovata"}

    def import_fet_xml(self, xml_content):
        with self.lock:
            parsed = parse_fet_xml(xml_content)
            self.data = parsed
            self._save_to_disk(self.data)
            return True

    def place_disposizioni_in_timetable(self):
        """
        Assegna le ore a disposizione dei docenti nell'orario post-calcolo FET.
        Viene eseguito solo alla fine, dopo che FET ha calcolato l'orario delle lezioni reali.
        
        Criteri didattici e gestionali:
        1. Coprire prioritariamente i buchi orari del docente (ore vuote tra lezioni reali della giornata).
        2. Collocarle tendenzialmente all'inizio della giornata (1ª ora strategica per supplenze) e NON alla fine.
        3. Distribuirle uniformemente nella settimana (evitando di accumulare più disposizioni sullo stesso giorno).
        4. Rispettare rigorosamente max_hours_daily, max_days, day_hours_limit e le indisponibilità del docente.
        5. Idempotenza: rimuove prima le eventuali disposizioni precedenti per un ricalcolo pulito e deterministico.
        """
        with self.lock:
            timetable = self.data.get("timetable", {})
            if not timetable:
                return {"success": False, "placed_count": 0, "message": "Nessun orario presente"}

            acts = self.data.get("activities", [])
            
            # Assicura che ogni attività di disposizione sia rigorosamente di 1 ora
            new_acts = []
            acts_modified = False
            next_id = max((int(a["id"]) for a in acts if str(a["id"]).isdigit()), default=1000) + 1
            for a in acts:
                if (a.get("subject") or "").strip().lower().startswith("disposiz") and (a.get("duration", 1) or 1) > 1:
                    dur = int(a.get("duration", 1))
                    a["duration"] = 1
                    a["total_hours"] = 1
                    new_acts.append(a)
                    for _ in range(1, dur):
                        extra = copy.deepcopy(a)
                        extra["id"] = str(next_id)
                        next_id += 1
                        extra["duration"] = 1
                        extra["total_hours"] = 1
                        new_acts.append(extra)
                    acts_modified = True
                else:
                    new_acts.append(a)

            if acts_modified:
                self.data["activities"] = new_acts
                acts = new_acts

            acts_map = {str(a["id"]): a for a in acts}

            # Filtra le attività di disposizione
            disp_acts = [a for a in acts if (a.get("subject") or "").strip().lower().startswith("disposiz")]
            if not disp_acts:
                return {"success": True, "placed_count": 0, "message": "Nessuna attività di disposizione trovata"}

            # Pulisci le posizioni precedenti delle disposizioni per garantire idempotenza totale
            for a in disp_acts:
                timetable.pop(str(a["id"]), None)

            # Raggruppa disposizioni per docente
            teachers_disp = defaultdict(list)
            for a in disp_acts:
                for t in a.get("teachers", []):
                    teachers_disp[t].append(a)

            days = self.data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven"])
            active_days = [d for d in days if d != "Sab"]
            day_limits = {d: int(self.data.get("day_hours_limit", {}).get(d, 6)) for d in active_days}
            teacher_objs = {t["name"]: t for t in self.data.get("teachers", [])}
            teacher_unavail = self.data.get("teacher_availability", {})

            # Tracciamento globale per distribuire le supplenze nell'istituto
            global_disp = defaultdict(int)
            placed_count = 0
            details = []

            for tname, t_acts in sorted(teachers_disp.items()):
                t_obj = teacher_objs.get(tname, {})
                unavail = set(teacher_unavail.get(tname, []))
                max_daily = t_obj.get("max_hours_daily", 5)
                max_days = t_obj.get("max_days") or len(active_days)
                min_days = t_obj.get("min_days", 1)

                # Mappa le lezioni reali del docente (escluse disposizioni), espandendo per la durata reale
                lesson_hours = defaultdict(set)
                for aid, pl in timetable.items():
                    act = acts_map.get(str(aid))
                    if act and tname in act.get("teachers", []):
                        if not (act.get("subject") or "").strip().lower().startswith("disposiz"):
                            p_day = pl.get("day")
                            p_hour = pl.get("hour")
                            dur = int(act.get("duration", 1) or 1)
                            if p_day in active_days and p_hour and p_hour.isdigit():
                                h_start = int(p_hour)
                                for h_offset in range(dur):
                                    lesson_hours[p_day].add(h_start + h_offset)

                disp_hours = defaultdict(set)
                rem_acts = list(t_acts)

                def get_occ(d):
                    return lesson_hours[d] | disp_hours[d]

                # --- FASE 1: COPERTURA DEI BUCHI TRA LEZIONI REALI ---
                while rem_acts:
                    hole_cands = []
                    for d in active_days:
                        L = lesson_hours[d]
                        if len(L) >= 2:
                            min_l, max_l = min(L), max(L)
                            occ = get_occ(d)
                            if len(occ) >= max_daily:
                                continue
                            for h in range(min_l + 1, max_l):
                                if h not in occ and f"{d}|{h}" not in unavail and h <= day_limits[d]:
                                    is_isolated = (h - 1 in occ) and (h + 1 in occ)
                                    score = 2500 + (500 if is_isolated else 0)
                                    # Penalizza accumulo di disposizioni sullo stesso giorno
                                    score -= len(disp_hours[d]) * 500
                                    # Preferenza per ore antimeridiane
                                    score += (7 - h) * 15
                                    # Bilanciamento istituto
                                    score -= global_disp[(d, h)] * 5
                                    hole_cands.append((score, d, h, "buco"))

                    if not hole_cands:
                        break

                    hole_cands.sort(key=lambda x: x[0], reverse=True)
                    best = hole_cands[0]
                    act = rem_acts.pop(0)
                    aid_str = str(act["id"])
                    timetable[aid_str] = {
                        "day": best[1],
                        "hour": str(best[2]),
                        "room": ""
                    }
                    disp_hours[best[1]].add(best[2])
                    global_disp[(best[1], best[2])] += 1
                    placed_count += 1
                    details.append({
                        "teacher": tname,
                        "day": best[1],
                        "hour": str(best[2]),
                        "category": best[3]
                    })

                # --- FASE 2: INIZIO GIORNATA E DISTRIBUZIONE NELLA SETTIMANA ---
                while rem_acts:
                    cands = []
                    curr_working_days = sum(1 for d in active_days if len(get_occ(d)) > 0)

                    for d in active_days:
                        occ = get_occ(d)
                        if not occ or len(occ) >= max_daily:
                            continue
                        min_h, max_h = min(occ), max(occ)
                        for h in range(1, day_limits[d] + 1):
                            if h in occ or f"{d}|{h}" in unavail:
                                continue

                            score = 0
                            cat = "generale"
                            if h == min_h - 1:
                                if h == 1:
                                    score = 1200
                                    cat = "inizio_1ora_adiacente"
                                else:
                                    score = 1000 - (h - 1) * 50
                                    cat = "inizio_adiacente"
                            elif h < min_h:
                                if h == 1:
                                    score = 750
                                    cat = "inizio_1ora"
                                else:
                                    score = 500 - (min_h - h) * 80
                                    cat = "inizio_non_adiacente"
                            elif h == max_h + 1:
                                if h <= 2:
                                    score = 800
                                    cat = "seguente_mattina_presto"
                                elif h == 3:
                                    score = 600
                                    cat = "seguente_meta_mattina"
                                elif h == 4:
                                    score = 300
                                    cat = "seguente_mezzogiorno"
                                else:
                                    score = -1200 - (h - 4) * 200
                                    cat = "fine_giornata"
                            elif h > max_h + 1:
                                score = -2500 - (h - max_h) * 200
                                cat = "dopo_fine_non_adiacente"

                            # Penalità forte per più disposizioni nello stesso giorno
                            score -= len(disp_hours[d]) * 900
                            # Bilanciamento carico settimanale del docente
                            score += (5 - len(occ)) * 40
                            # Preferenza ore mattutine
                            score += (7 - h) * 15
                            # Bilanciamento d'istituto per supplenze
                            score -= global_disp[(d, h)] * 5
                            cands.append((score, d, h, cat))

                    # Se non ci sono slot idonei su giorni lavorativi e il docente ha giorni disponibili
                    if not cands or (max(c[0] for c in cands) < 300 and curr_working_days < max_days):
                        for d in active_days:
                            occ = get_occ(d)
                            if occ or curr_working_days >= max_days:
                                continue
                            for h in range(1, min(3, day_limits[d] + 1)):
                                if f"{d}|{h}" in unavail:
                                    continue
                                score = 750 if h == 1 else 500
                                score -= global_disp[(d, h)] * 5
                                cands.append((score, d, h, "giorno_libero_1ora"))

                    if not cands:
                        # Fallback per saturazione vincoli
                        for d in active_days:
                            occ = get_occ(d)
                            if len(occ) >= max_daily:
                                continue
                            for h in range(1, day_limits[d] + 1):
                                if h not in occ and f"{d}|{h}" not in unavail:
                                    cands.append((0, d, h, "fallback"))

                    if not cands:
                        break

                    cands.sort(key=lambda x: x[0], reverse=True)
                    best = cands[0]
                    act = rem_acts.pop(0)
                    aid_str = str(act["id"])
                    timetable[aid_str] = {
                        "day": best[1],
                        "hour": str(best[2]),
                        "room": ""
                    }
                    disp_hours[best[1]].add(best[2])
                    global_disp[(best[1], best[2])] += 1
                    placed_count += 1
                    details.append({
                        "teacher": tname,
                        "day": best[1],
                        "hour": str(best[2]),
                        "category": best[3]
                    })

            self.data["timetable"] = timetable
            self.data["has_timetable"] = True
            self._save_to_disk(self.data)
            return {
                "success": True,
                "placed_count": placed_count,
                "total_disp_acts": len(disp_acts),
                "details": details
            }

    def save_solved_timetable_xml(self, xml_content):
        with self.lock:
            parsed = parse_fet_xml(xml_content)
            self.data["timetable"] = parsed.get("timetable", {})
            self.data["has_timetable"] = True
            # Colloca automaticamente le ore a disposizione post-calcolo
            self.place_disposizioni_in_timetable()
            self._save_to_disk(self.data)
            try:
                with open(SOLVED_FILE, "w", encoding="utf-8") as f:
                    f.write(xml_content)
            except Exception:
                pass
    # --- ACCORPAMENTI MACRO-MATERIE ---
    def get_accorpamenti_candidates(self):
        """
        Rileva automaticamente le cattedre suscettibili di accorpamento in macro-materie.
        Ad esempio se lo stesso docente insegna Italiano, Latino e Storia e Geografia alla stessa classe.
        """
        with self.lock:
            rules = self.data.get("accorpamenti_rules", copy.deepcopy(ACCORPAMENTI_DEFAULT_RULES))
            activities = self.data.get("activities", [])

            # 1. Riconosci macro-materie già presenti e attive nel progetto
            macro_names = {r["name"]: r for r in rules}
            macro_names["Italiano e Latino"] = {"id": "ita_lat", "name": "Italiano e Latino", "components": ["Italiano", "Latino"]}
            macro_names["Filosofia e Storia"] = {"id": "fil_sto", "name": "Filosofia e Storia", "components": ["Filosofia", "Storia"]}
            macro_names["Diritto ed Economia Politica"] = {"id": "dir_eco", "name": "Diritto ed Economia Politica", "components": ["Diritto", "Economia Politica"]}

            existing_merged = []
            grouped_active_macros = defaultdict(list)
            for a in activities:
                if not a.get("active", True):
                    continue
                s = a.get("subject", "")
                if s in macro_names:
                    t = tuple(sorted(a.get("teachers", [])))
                    st = tuple(sorted(a.get("students", [])))
                    grouped_active_macros[(t, st, s)].append(a)

            for (t, st, s), acts in grouped_active_macros.items():
                durations = [str(a.get("duration", 1)) for a in acts]
                tot_h = sum(a.get("duration", 1) for a in acts)
                rule_info = macro_names.get(s, {})
                existing_merged.append({
                    "is_merged": True,
                    "teacher": t[0] if t else "-",
                    "teachers": list(t),
                    "class_name": "+".join(st) if st else "-",
                    "students": list(st),
                    "subject": s,
                    "rule_id": rule_info.get("id", "custom"),
                    "rule_name": s,
                    "total_hours": tot_h,
                    "blocks": "+".join(durations),
                    "sub_activity_ids": [str(a["id"]) for a in acts],
                    "components": [{"subject": c, "hours": 0} for c in rule_info.get("components", [s])]
                })

            # Ordina le macro-materie attive per classe naturale poi docente
            existing_merged.sort(key=lambda x: (natural_class_sort_key(x["class_name"]), x["teacher"]))

            # 2. Candidati con materie singole non ancora accorpate
            by_tc = defaultdict(list)
            for a in activities:
                if not a.get("active", True):
                    continue
                if a.get("subject", "") in macro_names:
                    continue
                ts = tuple(sorted(a.get("teachers", [])))
                ss = tuple(sorted(a.get("students", [])))
                if ts and ss:
                    by_tc[(ts, ss)].append(a)

            unmerged_candidates = []
            for (teachers, students), acts in by_tc.items():
                subject_map = defaultdict(list)
                for a in acts:
                    if a.get("subject"):
                        subject_map[a["subject"]].append(a)

                for rule in rules:
                    if not rule.get("active", True):
                        continue
                    comps = rule.get("components", [])
                    if all(c in subject_map for c in comps):
                        comp_acts = []
                        comp_details = []
                        for c in comps:
                            comp_acts.extend(subject_map[c])
                            h = sum(x.get("duration", 1) for x in subject_map[c])
                            comp_details.append({"subject": c, "hours": h})
                        tot_hours = sum(a.get("duration", 1) for a in comp_acts)
                        unmerged_candidates.append({
                            "is_merged": False,
                            "teacher": teachers[0] if teachers else "-",
                            "teachers": list(teachers),
                            "class_name": "+".join(students) if students else "-",
                            "students": list(students),
                            "rule_id": rule.get("id"),
                            "rule_name": rule.get("name"),
                            "total_hours": tot_hours,
                            "components": comp_details,
                            "sub_activity_ids": [str(a["id"]) for a in comp_acts]
                        })

            all_candidates = existing_merged + unmerged_candidates

            return {
                "rules": rules,
                "candidates": all_candidates
            }

    def apply_accorpamento(self, teachers, students, macro_subject, component_ids, blocks_str=""):
        with self.lock:
            comp_set = set(str(x) for x in component_ids)
            tot_h = 0
            for a in self.data.get("activities", []):
                if str(a["id"]) in comp_set:
                    a["active"] = False
                    a["comments"] = f"Accorpata in {macro_subject} | {a.get('comments', '')}"
                    tot_h += a.get("duration", 1)

            if not blocks_str:
                if tot_h == 9:
                    blocks_str = "2+2+2+2+1"
                elif tot_h == 8:
                    blocks_str = "2+2+2+2"
                elif tot_h == 7:
                    blocks_str = "2+2+2+1"
                elif tot_h == 6:
                    blocks_str = "2+2+2"
                elif tot_h == 5:
                    blocks_str = "2+2+1"
                elif tot_h == 4:
                    blocks_str = "2+2"
                elif tot_h == 3:
                    blocks_str = "2+1"
                else:
                    blocks_str = str(tot_h)

            if not any(s["name"] == macro_subject for s in self.data.get("subjects", [])):
                self.data.setdefault("subjects", []).append({
                    "name": macro_subject,
                    "comments": "Materia accorpata da aggregazione",
                    "no_rientri": False,
                    "pref_hours": "INDIFFERENTE"
                })

            res = self.save_cattedra(
                teachers=teachers,
                students=students,
                subject=macro_subject,
                total_hours=tot_h,
                blocks_str=blocks_str,
                comments=f"Macro-materia accorpata da attività: {','.join(sorted(comp_set))}"
            )
            return res

    def revert_accorpamento(self, macro_activity_group_id):
        with self.lock:
            acts = self.data.get("activities", [])
            gid = str(macro_activity_group_id)
            macro_acts = [a for a in acts if str(a.get("group_id")) == gid or str(a.get("id")) == gid]
            if not macro_acts:
                return False

            macro_ids = {str(a["id"]) for a in macro_acts}
            comp_ids = set()
            for ma in macro_acts:
                comm = ma.get("comments", "")
                if "Macro-materia accorpata da attività:" in comm:
                    parts = comm.split("Macro-materia accorpata da attività:")[1].split("|")[0].strip()
                    for p in parts.split(","):
                        if p.strip():
                            comp_ids.add(p.strip())

            self.data["activities"] = [a for a in acts if str(a["id"]) not in macro_ids]
            for aid in macro_ids:
                self.data.get("timetable", {}).pop(aid, None)

            for a in self.data.get("activities", []):
                if str(a["id"]) in comp_ids:
                    a["active"] = True
                    comm = a.get("comments", "")
                    if "Accorpata in " in comm:
                        a["comments"] = comm.split("|")[-1].strip()

            self._save_to_disk(self.data)
            return True

    def add_accorpamenti_rule(self, name, components):
        """
        Aggiunge o aggiorna una regola di accorpamento macro-materia.
        """
        with self.lock:
            if "accorpamenti_rules" not in self.data:
                self.data["accorpamenti_rules"] = copy.deepcopy(ACCORPAMENTI_DEFAULT_RULES)
            r_name = (name or "").strip()
            clean_comps = [c.strip() for c in components if c and c.strip()]
            if not r_name or len(clean_comps) < 2:
                raise ValueError("Nome regola e almeno 2 materie componenti sono obbligatori.")
            
            rid = "rule_" + re.sub(r'[^a-zA-Z0-9]+', '_', r_name.lower()).strip('_')
            new_rule = {
                "id": rid,
                "name": r_name,
                "components": clean_comps,
                "active": True
            }
            # Sostituisci se esiste già con stesso ID o nome
            self.data["accorpamenti_rules"] = [
                r for r in self.data["accorpamenti_rules"]
                if r.get("id") != rid and r.get("name", "").lower() != r_name.lower()
            ]
            self.data["accorpamenti_rules"].append(new_rule)
            self._save_to_disk(self.data)
            return new_rule

    def delete_accorpamenti_rule(self, rule_id):
        """
        Elimina una regola di accorpamento macro-materia.
        """
        with self.lock:
            if "accorpamenti_rules" not in self.data:
                self.data["accorpamenti_rules"] = copy.deepcopy(ACCORPAMENTI_DEFAULT_RULES)
            self.data["accorpamenti_rules"] = [
                r for r in self.data["accorpamenti_rules"]
                if r.get("id") != rule_id and r.get("name") != rule_id
            ]
            self._save_to_disk(self.data)
            return True

    # --- GESTIONE VERSIONI, SNAPSHOT E ROLLBACK ---
    def get_snapshots(self):
        """
        Ritorna l'elenco di tutte le configurazioni e snapshot salvati, ordinati dal più recente.
        """
        os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
        items = []
        for fname in os.listdir(SNAPSHOTS_DIR):
            if fname.endswith(".json") and not fname.startswith("."):
                fpath = os.path.join(SNAPSHOTS_DIR, fname)
                try:
                    with open(fpath, "r", encoding="utf-8") as f:
                        meta = json.load(f)
                    sid = meta.get("id") or os.path.splitext(fname)[0]
                    items.append({
                        "id": sid,
                        "name": meta.get("name", "Senza nome"),
                        "description": meta.get("description", ""),
                        "created_at": meta.get("created_at", ""),
                        "has_timetable": bool(meta.get("has_timetable", False)),
                        "stats": meta.get("stats", {}),
                        "filename": fname
                    })
                except Exception:
                    pass
        items.sort(key=lambda x: x.get("created_at", ""), reverse=True)
        return items

    def create_snapshot(self, name, description=""):
        """
        Salva l'intero stato corrente (parametri, vincoli, disponibilità, attività e orario)
        in un file snapshot persistente nel database interno.
        """
        with self.lock:
            os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
            import datetime
            now = datetime.datetime.now()
            sid = f"snap_{now.strftime('%Y%m%d_%H%M%S')}"
            snap_name = (name or "").strip() or f"Configurazione del {now.strftime('%d/%m/%Y %H:%M')}"
            
            stats = {
                "teachers_count": len(self.data.get("teachers", [])),
                "classes_count": len(self.data.get("classes", [])),
                "activities_count": len(self.data.get("activities", [])),
                "rooms_count": len(self.data.get("rooms", [])),
                "has_timetable": bool(self.data.get("has_timetable", False) and len(self.data.get("timetable", {})) > 0)
            }
            
            record = {
                "id": sid,
                "name": snap_name,
                "description": (description or "").strip(),
                "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                "has_timetable": stats["has_timetable"],
                "stats": stats,
                "data": copy.deepcopy(self.data)
            }
            
            jpath = os.path.join(SNAPSHOTS_DIR, f"{sid}.json")
            with open(jpath, "w", encoding="utf-8") as f:
                json.dump(record, f, ensure_ascii=False, indent=2)
                
            if os.path.exists(SOLVED_FILE):
                try:
                    import shutil
                    shutil.copyfile(SOLVED_FILE, os.path.join(SNAPSHOTS_DIR, f"{sid}.fet"))
                except Exception:
                    pass
                    
            return {
                "id": sid,
                "name": snap_name,
                "description": record["description"],
                "created_at": record["created_at"],
                "has_timetable": record["has_timetable"],
                "stats": stats
            }

    def rename_current_config(self, name):
        """
        Rinomina la configurazione attiva corrente.
        """
        with self.lock:
            new_n = (name or "").strip() or "Configurazione Corrente"
            self.data["config_name"] = new_n
            self._save_to_disk(self.data)
            return new_n

    def rename_snapshot(self, snapshot_id, new_name, new_description=None):
        """
        Rinomina uno snapshot salvato o ne modifica la descrizione.
        """
        with self.lock:
            jpath = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.json")
            if not os.path.exists(jpath):
                return False
            try:
                with open(jpath, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                meta["name"] = (new_name or "").strip() or meta.get("name", "Snapshot")
                if new_description is not None:
                    meta["description"] = new_description.strip()
                with open(jpath, "w", encoding="utf-8") as f:
                    json.dump(meta, f, ensure_ascii=False, indent=2)
                return True
            except Exception:
                return False

    def restore_snapshot(self, snapshot_id):
        """
        Esegue il rollback / ripristino di uno snapshot come configurazione attiva corrente.
        """
        with self.lock:
            jpath = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.json")
            if not os.path.exists(jpath):
                return False
            try:
                with open(jpath, "r", encoding="utf-8") as f:
                    meta = json.load(f)
                data_to_restore = meta.get("data")
                if not data_to_restore:
                    return False
                
                self.data = copy.deepcopy(data_to_restore)
                self.data["config_name"] = meta.get("name", "Configurazione Ripristinata")
                self._save_to_disk(self.data)
                
                snap_fet = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.fet")
                if os.path.exists(snap_fet):
                    try:
                        import shutil
                        shutil.copyfile(snap_fet, SOLVED_FILE)
                    except Exception:
                        pass
                return True
            except Exception as e:
                print("Errore restore_snapshot:", e)
                return False

    def delete_snapshot(self, snapshot_id):
        """
        Elimina uno snapshot e il relativo file .fet dall'archivio.
        """
        with self.lock:
            jpath = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.json")
            fpath = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.fet")
            ok = False
            if os.path.exists(jpath):
                try:
                    os.remove(jpath)
                    ok = True
                except Exception:
                    pass
            if os.path.exists(fpath):
                try:
                    os.remove(fpath)
                except Exception:
                    pass
            return ok

    def get_snapshot_content(self, snapshot_id):
        """
        Ritorna il contenuto JSON completo di uno snapshot per il download.
        """
        jpath = os.path.join(SNAPSHOTS_DIR, f"{snapshot_id}.json")
        if os.path.exists(jpath):
            with open(jpath, "r", encoding="utf-8") as f:
                return f.read()
        return None

    def import_snapshot_from_content(self, content_str, filename=""):
        """
        Importa uno snapshot da un file JSON o FET caricato da computer.
        """
        with self.lock:
            os.makedirs(SNAPSHOTS_DIR, exist_ok=True)
            import datetime
            now = datetime.datetime.now()
            sid = f"snap_imp_{now.strftime('%Y%m%d_%H%M%S')}"
            clean_name = os.path.splitext(os.path.basename(filename))[0] if filename else f"Import_{now.strftime('%d%m_%H%M')}"
            
            if content_str.strip().startswith("{"):
                try:
                    parsed = json.loads(content_str)
                    raw_data = parsed.get("data") if ("data" in parsed and "stats" in parsed) else parsed
                    snap_name = parsed.get("name", clean_name)
                    desc = parsed.get("description", f"Importato da file {filename}")
                    
                    stats = {
                        "teachers_count": len(raw_data.get("teachers", [])),
                        "classes_count": len(raw_data.get("classes", [])),
                        "activities_count": len(raw_data.get("activities", [])),
                        "rooms_count": len(raw_data.get("rooms", [])),
                        "has_timetable": bool(raw_data.get("has_timetable", False) and len(raw_data.get("timetable", {})) > 0)
                    }
                    record = {
                        "id": sid,
                        "name": snap_name,
                        "description": desc,
                        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                        "has_timetable": stats["has_timetable"],
                        "stats": stats,
                        "data": raw_data
                    }
                    jpath = os.path.join(SNAPSHOTS_DIR, f"{sid}.json")
                    with open(jpath, "w", encoding="utf-8") as f:
                        json.dump(record, f, ensure_ascii=False, indent=2)
                    return record
                except Exception as e:
                    raise ValueError(f"File JSON non valido: {e}")
            else:
                try:
                    parsed_fet = parse_fet_xml(content_str)
                    stats = {
                        "teachers_count": len(parsed_fet.get("teachers", [])),
                        "classes_count": len(parsed_fet.get("classes", [])),
                        "activities_count": len(parsed_fet.get("activities", [])),
                        "rooms_count": len(parsed_fet.get("rooms", [])),
                        "has_timetable": bool(len(parsed_fet.get("timetable", {})) > 0)
                    }
                    record = {
                        "id": sid,
                        "name": clean_name,
                        "description": f"Importato da file FET {filename}",
                        "created_at": now.strftime("%Y-%m-%d %H:%M:%S"),
                        "has_timetable": stats["has_timetable"],
                        "stats": stats,
                        "data": parsed_fet
                    }
                    jpath = os.path.join(SNAPSHOTS_DIR, f"{sid}.json")
                    with open(jpath, "w", encoding="utf-8") as f:
                        json.dump(record, f, ensure_ascii=False, indent=2)
                    with open(os.path.join(SNAPSHOTS_DIR, f"{sid}.fet"), "w", encoding="utf-8") as ff:
                        ff.write(content_str)
                    return record
                except Exception as e:
                    raise ValueError(f"File FET XML non valido: {e}")

    # --- AGGIORNAMENTO ORGANICO DA FILE WORD (.docx) O GOOGLE DOCS ---
    def compare_organico_with_db(self, parsed_teachers):
        with self.lock:
            db_teachers = {t["name"].lower(): t for t in self.get_teachers()}
            
            db_activities_by_teacher = defaultdict(list)
            for a in self.data.get("activities", []):
                for t in a.get("teachers", []):
                    db_activities_by_teacher[t.lower()].append(a)

            added = []
            modified = []
            unchanged = []
            removed = []

            parsed_names_lower = set()

            for pt in parsed_teachers:
                name = pt["name"]
                name_low = name.lower()
                parsed_names_lower.add(name_low)

                if name_low not in db_teachers:
                    added.append(pt)
                else:
                    cur = db_teachers[name_low]
                    diffs = []
                    
                    # Confronto CDC
                    p_cdc = pt.get("cdc", "").strip()
                    c_cdc = cur.get("cdc", "").strip()
                    p_code = p_cdc.split("-")[0].strip() if "-" in p_cdc else p_cdc
                    c_code = c_cdc.split("-")[0].strip() if "-" in c_cdc else c_cdc
                    if p_code and c_code:
                        if p_code.upper() != c_code.upper():
                            diffs.append({
                                "field": "cdc",
                                "label": "Classe di Concorso",
                                "old": c_cdc,
                                "new": p_cdc
                            })
                    elif p_cdc and not c_cdc:
                        diffs.append({
                            "field": "cdc",
                            "label": "Classe di Concorso",
                            "old": "Non specificata",
                            "new": p_cdc
                        })

                    # Confronto Ore Target
                    if int(cur.get("target_hours", 18)) != int(pt.get("target_hours", 18)):
                        diffs.append({
                            "field": "target_hours",
                            "label": "Ore Cattedra Contrattuali",
                            "old": f"{cur.get('target_hours', 18)}h",
                            "new": f"{pt['target_hours']}h"
                        })

                    # Confronto Contratto (Intera / COE / Spezzone / Part-time)
                    cur_ctype = cur.get("contract_type") or ("coe" if cur.get("is_coe") else ("spezzone" if cur.get("target_hours", 18) < 18 else "intera"))
                    if cur_ctype == "standard":
                        cur_ctype = "intera"
                    new_ctype = pt.get("contract_type") or "intera"
                    if new_ctype == "standard":
                        new_ctype = "intera"
                    if cur_ctype != new_ctype:
                        diffs.append({
                            "field": "contract_type",
                            "label": "Tipologia Cattedra",
                            "old": cur_ctype,
                            "new": new_ctype
                        })

                    # Confronto Classi / Insegnamenti
                    cur_acts = db_activities_by_teacher.get(name_low, [])
                    cur_classes_set = set()
                    for a in cur_acts:
                        for s in a.get("students", []):
                            cur_classes_set.add(s)
                    
                    docx_classes_set = set(
                        a["target"] for a in pt.get("assignments", []) 
                        if a.get("target") and not a.get("target") in ("POT", "DISP", "RESIDUO", "COE")
                    )

                    if cur_classes_set != docx_classes_set:
                        added_cls = docx_classes_set - cur_classes_set
                        rem_cls = cur_classes_set - docx_classes_set
                        desc_parts = []
                        if added_cls: desc_parts.append(f"Nuove classi: {', '.join(sorted(added_cls))}")
                        if rem_cls: desc_parts.append(f"Classi rimosse: {', '.join(sorted(rem_cls))}")
                        diffs.append({
                            "field": "classes",
                            "label": "Classi Assegnate",
                            "old": ", ".join(sorted(cur_classes_set)) or "Nessuna",
                            "new": pt.get("classi_raw", "") or ", ".join(sorted(docx_classes_set)),
                            "detail": "; ".join(desc_parts)
                        })

                    if diffs:
                        modified.append({
                            "name": cur["name"],
                            "docente_new": pt,
                            "current": cur,
                            "diffs": diffs,
                            "diff_map": {d["field"]: d for d in diffs}
                        })
                    else:
                        unchanged.append(pt)

            for name_low, cur in db_teachers.items():
                if name_low not in parsed_names_lower:
                    cur_acts = db_activities_by_teacher.get(name_low, [])
                    cur_classes = set()
                    tot_assigned_h = 0
                    for a in cur_acts:
                        tot_assigned_h += a.get("duration", 1)
                        for s in a.get("students", []):
                            cur_classes.add(s)
                    removed.append({
                        "name": cur["name"],
                        "cdc": cur.get("cdc", ""),
                        "target_hours": cur.get("target_hours", 18),
                        "assigned_hours": tot_assigned_h,
                        "classes": list(cur_classes)
                    })

            unchanged_names = [p["name"] if isinstance(p, dict) else str(p) for p in unchanged]
            return {
                "summary": {
                    "total_docx": len(parsed_teachers),
                    "total_db": len(db_teachers),
                    "added_count": len(added),
                    "modified_count": len(modified),
                    "removed_count": len(removed),
                    "unchanged_count": len(unchanged_names)
                },
                "added": added,
                "modified": modified,
                "removed": removed,
                "unchanged": unchanged_names,
                "diff": {
                    "added": added,
                    "modified": modified,
                    "removed": removed,
                    "unchanged": unchanged_names
                }
            }

    def resolve_subject_name(self, subject_candidate="", cdc_candidate=""):
        """
        Risolve il nome canonico della materia presente nel database partendo da un testo
        estratto dall'organico o da una classe di concorso.
        """
        subjects = self.data.get("subjects", [])
        if not subjects:
            return subject_candidate or cdc_candidate or "Materia"

        cand = (subject_candidate or "").strip()
        cdc = (cdc_candidate or "").strip()

        # 1. Match esatto per nome materia
        if cand:
            for s in subjects:
                if s["name"].lower() == cand.lower():
                    return s["name"]

        # 2. Match per CDC (es. 'AS2A', 'A027', ecc.)
        if cdc:
            cdc_code = cdc.split("-")[0].strip().upper()
            for s in subjects:
                s_cdc = s.get("cdc", "").strip().upper()
                if s_cdc and (s_cdc == cdc_code or cdc_code in s_cdc or s_cdc in cdc_code):
                    return s["name"]

        # 3. Match parziale sul nome (rimuovendo eventuale prefisso CDC tipo 'AS2A - ')
        search_target = cand or cdc
        if search_target:
            st_clean = re.sub(r"^[A-Z0-9]+\s*-\s*", "", search_target, flags=re.IGNORECASE).strip().lower()
            for s in subjects:
                if s["name"].lower() == st_clean or st_clean in s["name"].lower() or s["name"].lower() in st_clean:
                    return s["name"]

        return cand or cdc or "Materia"

    def apply_organico_update(self, apply_added=None, apply_modified=None, apply_removed=None, sync_activities=False):
        with self.lock:
            apply_added = apply_added or []
            apply_modified = apply_modified or []
            apply_removed = apply_removed or []

            # Costruisci mappa di appartenenza gruppo -> classe genitore (e viceversa)
            # es: {'4A FRA': '4A', '4A SPA': '4A', '5A FRA': '5A', '5A SPA': '5A', '4E TED': '4E', ...}
            group_to_class = {}
            class_to_groups = {}
            for g in self.data.get("groups", []):
                g_name = g.get("name", "").strip().upper()
                c_name = g.get("class_name", "").strip().upper()
                if g_name and c_name:
                    group_to_class[g_name] = c_name
                    class_to_groups.setdefault(c_name, set()).add(g_name)

            def get_teacher_covered_classes(teacher_name):
                t_lower = teacher_name.lower().strip()
                covered = set()
                for a in self.data.get("activities", []):
                    if t_lower in [t.lower().strip() for t in a.get("teachers", [])]:
                        for s in a.get("students", []):
                            s_up = s.strip().upper()
                            covered.add(s_up)
                            # Se l'attività è assegnata a un gruppo/articolazione linguistica, copre anche la classe genitore
                            if s_up in group_to_class:
                                covered.add(group_to_class[s_up])
                return covered

            # 1. Aggiungi nuovi docenti
            for doc in apply_added:
                name = doc.get("name", "").strip()
                if not name:
                    continue
                cdc = doc.get("cdc", "").strip()
                target_h = int(doc.get("target_hours", 18))
                ctype = doc.get("contract_type", "intera")
                if ctype == "standard":
                    ctype = "intera"
                is_coe = (ctype == "coe")
                self.add_teacher(
                    name=name,
                    cdc=cdc,
                    target_hours=target_h,
                    contract_type=ctype,
                    is_coe=is_coe,
                    comments=f"Importato da Aggiornamento Organico: {doc.get('classi_raw', '')}"
                )
                if sync_activities and doc.get("assignments"):
                    teacher_covered = get_teacher_covered_classes(name)
                    for a_item in doc["assignments"]:
                        target = a_item.get("target", "").upper().strip()
                        if target in ("POT", "DISP", "RESIDUO", "COE") or not target:
                            continue
                        # Controlla se la classe o un suo gruppo è già coperto
                        is_covered = (target in teacher_covered)
                        if not is_covered and target in class_to_groups:
                            if any(grp in teacher_covered for grp in class_to_groups[target]):
                                is_covered = True
                        if not is_covered:
                            h = a_item.get("hours", 0)
                            if h > 0:
                                subj = self.resolve_subject_name(a_item.get("subject"), doc.get("cdc"))
                                self.save_cattedra(
                                    teachers=[name],
                                    students=[target],
                                    subject=subj,
                                    total_hours=h,
                                    comments="Generata da Aggiornamento Organico"
                                )
                                teacher_covered.add(target)

            # 2. Aggiorna docenti modificati
            cattedre_added_modified = 0
            for item in apply_modified:
                name = item.get("name", "").strip()
                new_data = item.get("docente_new") if isinstance(item, dict) and "docente_new" in item else item
                if not name or not new_data:
                    continue
                update_fields = {}
                if "cdc" in new_data:
                    update_fields["cdc"] = new_data["cdc"]
                if "target_hours" in new_data:
                    update_fields["target_hours"] = int(new_data["target_hours"])
                if "contract_type" in new_data:
                    update_fields["contract_type"] = new_data["contract_type"]
                    update_fields["is_coe"] = (new_data["contract_type"] == "coe")
                self.update_teacher(name, update_fields)

                # Opzione A: Sincronizzazione Additiva Intelligente per docenti modificati
                if sync_activities and new_data.get("assignments"):
                    teacher_covered = get_teacher_covered_classes(name)
                    for a_item in new_data["assignments"]:
                        target = a_item.get("target", "").upper().strip()
                        if target in ("POT", "DISP", "RESIDUO", "COE") or not target:
                            continue
                        # Controlla se la classe o un suo gruppo è già coperto
                        is_covered = (target in teacher_covered)
                        if not is_covered and target in class_to_groups:
                            if any(grp in teacher_covered for grp in class_to_groups[target]):
                                is_covered = True
                        if not is_covered:
                            h = a_item.get("hours", 0)
                            if h > 0:
                                subj = self.resolve_subject_name(a_item.get("subject"), new_data.get("cdc"))
                                self.save_cattedra(
                                    teachers=[name],
                                    students=[target],
                                    subject=subj,
                                    total_hours=h,
                                    comments="Aggiunta da Sincronizzazione Additiva Organico"
                                )
                                teacher_covered.add(target)
                                cattedre_added_modified += 1

            # 3. Rimuovi docenti confermati
            for item in apply_removed:
                name = item.get("name") if isinstance(item, dict) else str(item)
                name = name.strip() if name else ""
                if name:
                    self.delete_teacher(name)

            self._save_to_disk(self.data)
            return True


def parse_organico_docx_content(content_bytes_or_path):
    """
    Estrae e analizza la tabella organico da un file Word (.docx) o bytes.
    Struttura standard con colonne: [Classe di Concorso, Docente, Classi, Ore].
    """
    if isinstance(content_bytes_or_path, (bytes, bytearray)):
        z = zipfile.ZipFile(io.BytesIO(content_bytes_or_path))
    else:
        z = zipfile.ZipFile(content_bytes_or_path)

    with z:
        xml_content = z.read("word/document.xml")

    root = ET.fromstring(xml_content)
    namespaces = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
    tables = root.findall(".//w:tbl", namespaces)
    target_table = None
    for tbl in tables:
        rows = tbl.findall(".//w:tr", namespaces)
        if len(rows) > 5:
            target_table = tbl
            break

    if target_table is None:
        raise ValueError("Nessuna tabella con organico trovata nel documento Word.")

    rows = target_table.findall(".//w:tr", namespaces)
    teachers = []
    current_cdc = ""

    for r_idx, row in enumerate(rows):
        cells = row.findall(".//w:tc", namespaces)
        texts = [" ".join(c.itertext()).strip() for c in cells]
        if len(texts) < 4:
            continue
        cdc_raw, doc_raw, classi_raw, ore_raw = texts[0], texts[1], texts[2], texts[3]
        if r_idx == 0 and "Docente" in doc_raw:
            continue
        if cdc_raw:
            current_cdc = cdc_raw.strip()
        doc_name = doc_raw.strip()
        if not doc_name or doc_name.lower() in ("docente", "residuo"):
            continue

        m_ore = re.search(r"\d+", ore_raw)
        tot_ore = int(m_ore.group()) if m_ore else 18

        c_parts = [p.strip() for p in classi_raw.split("-") if p.strip()]
        assignments = []
        for cp in c_parts:
            m = re.match(r"^([0-9][A-Za-z]+|\bPOT\b|\bDISP\b|\bRESIDUO\b|\bCOE\b)\s*\((\d+)\)\s*(.*)$", cp, re.IGNORECASE)
            if m:
                assignments.append({
                    "target": m.group(1).upper(),
                    "hours": int(m.group(2)),
                    "subject": m.group(3).strip(),
                    "raw": cp
                })
            else:
                assignments.append({
                    "target": cp,
                    "hours": 0,
                    "subject": "",
                    "raw": cp
                })

        low_raw = classi_raw.lower()
        is_coe = "coe" in low_raw or "c.o.e." in low_raw
        is_pt = "part time" in low_raw or "part-time" in low_raw or "p.t." in low_raw
        is_spezz = "spezz" in low_raw
        if is_coe:
            contract_type = "coe"
        elif is_pt:
            contract_type = "part_time"
        elif is_spezz:
            contract_type = "spezzone"
        elif tot_ore < 18:
            contract_type = "spezzone"
        else:
            contract_type = "intera"

        teachers.append({
            "name": doc_name,
            "cdc": current_cdc,
            "target_hours": tot_ore,
            "contract_type": contract_type,
            "classi_raw": classi_raw,
            "assignments": assignments
        })

    return teachers


db = Database()
