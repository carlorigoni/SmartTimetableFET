"""
Modulo webapp/print_engine.py
==============================
Motore di esportazione e stampa ad alta risoluzione (PDF / Web Print)
per SmartTimetable Suite.

Implementa ed evolve le due procedure ufficiali storiche:
- Procedura 9: Orario per Classe (PDF / Stampa - A4 orizzontale per classe)
- Procedura 12: Orario Docenti (Tabellone Completo Docenti in A3 / Stampa)

Caratteristiche avanzate:
1. Supporto nativo classi articolate (es. 3A con rami 3AM / 3AR; 4A con 4A FRA / 4A SPA):
   - Nella classe madre unifica e mostra gli slot articolati con etichetta figlia e docenti.
   - Nelle classi figlie eredita le lezioni comuni della madre e aggiunge quelle specifiche.
2. Palette cromatica coerente e armoniosa:
   - Sfondi pastello ad alta leggibilità con bordi coordinati per materia.
   - Modalità Bianco & Nero professionale per risparmio toner / fotocopie.
3. Ottimizzazione delle ore in coda:
   - Rilevamento automatico e rimozione delle colonne orarie non utilizzate per giorno (es. Lun/Mer/Gio a 6 ore, Mar/Ven a 8 ore).
4. Formattazione vettoriale per stampa:
   - Regole CSS @page e print-color-adjust conformi per esportazione diretta in PDF da qualsiasi browser (Chrome, Edge, Safari, Firefox).
"""

import re
import html
import io
import zipfile
from datetime import datetime, timedelta
from collections import defaultdict
from webapp.fet_engine import natural_class_sort_key

# =====================================================================
# COSTANTI E TABELLA ORARIA DELL'ISTITUTO
# =====================================================================

ORARIO_ORE = {
    1: {"inizio": "07:55", "fine": "08:55", "label": "1ª ora"},
    2: {"inizio": "08:55", "fine": "09:50", "label": "2ª ora"},
    3: {"inizio": "10:00", "fine": "10:55", "label": "3ª ora"},
    4: {"inizio": "10:55", "fine": "11:50", "label": "4ª ora"},
    5: {"inizio": "12:05", "fine": "13:00", "label": "5ª ora"},
    6: {"inizio": "13:00", "fine": "13:50", "label": "6ª ora"},
    7: {"inizio": "14:00", "fine": "14:55", "label": "7ª ora"},
    8: {"inizio": "14:55", "fine": "15:45", "label": "8ª ora"},
}

INTERVALLI_DOPO_ORA = {
    2: {"inizio": "09:50", "fine": "10:00", "durata": "10 min", "label": "1° Intervallo"},
    4: {"inizio": "11:50", "fine": "12:05", "durata": "15 min", "label": "2° Intervallo"},
    6: {"inizio": "13:50", "fine": "14:00", "durata": "10 min", "label": "3° Intervallo (Pomeridiano)"},
}

GIORNI_DEFAULT = [
    {"id": "Lun", "nome": "Lunedì"},
    {"id": "Mar", "nome": "Martedì"},
    {"id": "Mer", "nome": "Mercoledì"},
    {"id": "Gio", "nome": "Giovedì"},
    {"id": "Ven", "nome": "Venerdì"},
]

def get_day_name(d: str, lang: str = "it", full: bool = True) -> str:
    clean = (d or "").strip().lower()
    is_en = str(lang).strip().lower() in ("en", "eng", "english")
    if is_en:
        if clean.startswith("lun") or clean.startswith("mon"):
            return "Monday" if full else "Mon"
        if clean.startswith("mar") or clean.startswith("tue"):
            return "Tuesday" if full else "Tue"
        if clean.startswith("mer") or clean.startswith("wed"):
            return "Wednesday" if full else "Wed"
        if clean.startswith("gio") or clean.startswith("thu"):
            return "Thursday" if full else "Thu"
        if clean.startswith("ven") or clean.startswith("fri"):
            return "Friday" if full else "Fri"
        if clean.startswith("sab") or clean.startswith("sat"):
            return "Saturday" if full else "Sat"
        if clean.startswith("dom") or clean.startswith("sun"):
            return "Sunday" if full else "Sun"
        return d
    else:
        if clean.startswith("lun") or clean.startswith("mon"):
            return "Lunedì" if full else "Lun"
        if clean.startswith("mar") or clean.startswith("tue"):
            return "Martedì" if full else "Mar"
        if clean.startswith("mer") or clean.startswith("wed"):
            return "Mercoledì" if full else "Mer"
        if clean.startswith("gio") or clean.startswith("thu"):
            return "Giovedì" if full else "Gio"
        if clean.startswith("ven") or clean.startswith("fri"):
            return "Venerdì" if full else "Ven"
        if clean.startswith("sab") or clean.startswith("sat"):
            return "Sabato" if full else "Sab"
        if clean.startswith("dom") or clean.startswith("sun"):
            return "Domenica" if full else "Dom"
        return d

def get_intervallo_info(h: int, lang: str = "it") -> dict:
    info = INTERVALLI_DOPO_ORA.get(h)
    if not info:
        return {}
    res = dict(info)
    is_en = str(lang).strip().lower() in ("en", "eng", "english")
    if is_en:
        if h == 2:
            res["label"] = "1st Recess"
        elif h == 4:
            res["label"] = "2nd Recess"
        elif h == 6:
            res["label"] = "3rd Recess (Afternoon)"
        else:
            res["label"] = f"Recess {h}"
    return res


# Dizionario completo di traduzione materie scolastiche Italiano -> Inglese
SUBJECT_TRANSLATIONS_EN = {
    # Materie e Classi di Concorso Specifiche del Progetto
    "discipline letterarie istituti ii grado": "Literature & History",
    "discipline letterarie": "Literature & History",
    "disegno storia arte istituto ii grado": "Drawing & Art History",
    "disegno e storia dell'arte": "Drawing & Art History",
    "disegno storia dell'arte": "Drawing & Art History",
    "italiano latino storia e geografia": "Italian, Latin, History & Geo",
    "italiano storia e geografia": "Italian, History & Geography",
    "italiano e latino": "Italian & Latin",
    "lingua e letteratura italiana": "Italian Language & Literature",
    "lingua e cultura straniera (inglese)": "English Language & Culture",
    "lingua e cultura straniera (francese)": "French Language & Culture",
    "lingua e cultura straniera (spagnolo)": "Spanish Language & Culture",
    "lingua e cultura straniera (tedesco)": "German Language & Culture",
    "scienze economiche - aziendali": "Business Economics",
    "scienze economiche aziendali": "Business Economics",
    "scienze matematiche applicate": "Applied Mathematics",
    "scienze motorie e sportive ii grado": "Physical Education & Sports",
    "scienze motorie e sportive": "Physical Education & Sports",
    "scienze motorie": "Physical Education",
    "scienze naturali, chimica e biologia": "Natural Sciences, Chemistry & Biology",
    "scienze naturali chimica e biologia": "Natural Sciences, Chemistry & Biology",
    "scienze della terra e biologia": "Earth Sciences & Biology",
    "scienze e tecnologie informatiche": "Computer Science & Technologies",
    "diritto e relazioni internazionali": "Law & Int. Relations",
    "diritto ed economia politica": "Law & Political Economy",
    "diritto ed economia": "Law & Economics",
    "filosofia e scienze umane": "Philosophy & Human Sciences",
    "filosofia e storia": "Philosophy & History",
    "storia e filosofia": "History & Philosophy",
    "storia e geografia": "History & Geography",
    "matematica e fisica": "Mathematics & Physics",
    "discipline sanitarie": "Health Sciences",
    "legislazione sanitaria": "Health Legislation",
    "metodologie operative": "Operational Methodologies",
    "tecniche amministrative": "Administrative Techniques",
    "tecniche amministrative ed economia aziendale": "Business Economics & Admin",

    # Materie Canoniche Singole
    "italiano": "Italian",
    "latino": "Latin",
    "greco": "Ancient Greek",
    "storia": "History",
    "geografia": "Geography",
    "geostoria": "Geo-History",
    "filosofia": "Philosophy",
    "scienze umane": "Human Sciences",
    "pedagogia": "Pedagogy",
    "psicologia": "Psychology",
    "antropologia": "Anthropology",
    "sociologia": "Sociology",

    # Lingue Straniere
    "inglese": "English",
    "lingua inglese": "English Language",
    "lingua e cultura inglese": "English Language & Culture",
    "francese": "French",
    "lingua francese": "French Language",
    "lingua e cultura francese": "French Language & Culture",
    "spagnolo": "Spanish",
    "lingua spagnola": "Spanish Language",
    "lingua e cultura spagnola": "Spanish Language & Culture",
    "tedesco": "German",
    "lingua tedesca": "German Language",
    "lingua e cultura tedesca": "German Language & Culture",
    "russo": "Russian",
    "cinese": "Chinese",
    "conversazione": "Language Conversation",
    "conversazione in lingua straniera": "Foreign Language Conversation",

    # Matematica, Fisica e Informatica
    "matematica": "Mathematics",
    "fisica": "Physics",
    "informatica": "Computer Science",
    "tecnologie informatiche": "Information Technologies",
    "scienze e tecnologie applicate": "Applied Science & Tech",
    "tecnologie e tecniche di rappresentazione grafica": "Graphic Representation Tech",
    "disegno tecnico": "Technical Drawing",
    "disegno": "Drawing",
    "storia dell'arte": "Art History",
    "arte e immagine": "Art & Image",

    # Scienze Naturali, Chimica, Biologia
    "scienze": "Sciences",
    "scienze naturali": "Natural Sciences",
    "scienze della terra": "Earth Sciences",
    "biologia": "Biology",
    "chimica": "Chemistry",
    "scienze integrate": "Integrated Sciences",
    "scienze integrate (chimica)": "Integrated Sciences (Chemistry)",
    "scienze integrate (fisica)": "Integrated Sciences (Physics)",
    "scienze integrate (scienze della terra e biologia)": "Integrated Sciences (Earth & Bio)",
    "microbiologia": "Microbiology",
    "igiene": "Hygiene & Health",

    # Giuridico-Economiche
    "diritto": "Law",
    "economia politica": "Political Economy",
    "economia aziendale": "Business Economics",
    "relazioni internazionali": "International Relations",
    "scienze economico-aziendali": "Business Economics",
    "finanza": "Public Finance",

    # Scienze Motorie e Religione
    "educazione fisica": "Physical Education",
    "religione": "Religion",
    "religione cattolica": "Catholic Religion",
    "irc": "Catholic Religious Education",
    "materia alternativa": "Alternative Activity",
    "attività alternativa": "Alternative Activity",
    "studio assistito": "Supervised Study",

    # Discipline Tecniche e Professionali
    "meccanica": "Mechanics",
    "meccanica e macchine": "Mechanics & Machines",
    "robotica": "Robotics",
    "elettronica": "Electronics",
    "elettronica ed elettrotecnica": "Electronics & Electrical Eng.",
    "elettrotecnica": "Electrical Engineering",
    "telecomunicazioni": "Telecommunications",
    "sistemi e reti": "Systems & Networks",
    "tecnologie chimiche": "Chemical Technologies",
    "biotecnologie": "Biotechnology",
    "costruzioni ambiente e territorio": "Construction & Environment",
    "topografia": "Topography",

    # Disposizioni e Attività Istituzionali
    "disposizione": "On-Duty / Available",
    "disposizioni": "On-Duty / Available",
    "potenziamento": "Enhancement / Support",
    "ricevimento": "Office Hours",
    "coordinamento": "Class Coordination",
    "supplenza": "Substitute Duty",
}

def get_subject_display_name(subj: str, lang: str = "it") -> str:
    """
    Restituisce il nome della materia. Come da richiesta tassativa dell'utente:
    NON tradurre i nomi delle materie scolastiche (es. Matematica, Diritto, Filosofia, ecc. devono rimanere nei loro nomi originali),
    ma tradurre solo le voci di servizio come 'Disposizione' ('On-Duty').
    """
    if not subj:
        return ""
    is_en = str(lang).strip().lower() in ("en", "eng", "english")
    if not is_en:
        return subj
    s_clean = subj.strip()
    s_lower = s_clean.lower()
    if s_lower.startswith("disposiz"):
        return "On-Duty"
    return subj


# Palette storica 32 colori saturi per il bordo delle materie
PALETTE_COLORI_MATERIE = [
    "C92626", "AD5A28", "C9A026", "9CAD28", "77C926", "39AD28", "26C94F", "28AD7B",
    "26C9C9", "287BAD", "264FC9", "3928AD", "7726C9", "9C28AD", "C926A0", "AD285A",
    "821616", "723917", "826716", "667217", "4C8216", "227217", "168231", "177250",
    "168282", "175072", "163182", "221772", "4C1682", "661772", "821667", "721739"
]


# =====================================================================
# FUNZIONI DI UTILITÀ: COLORI, DATE, TESTO
# =====================================================================

def escape(s):
    if s is None:
        return ""
    return html.escape(str(s))

def get_default_validity_date():
    today = datetime.now()
    days_ahead = (7 - today.weekday()) % 7
    if days_ahead == 0:
        days_ahead = 7
    next_monday = today + timedelta(days=days_ahead)
    return next_monday.strftime("%d/%m/%Y")

def hex_to_pastel(hex_str, factor=0.74):
    """Genera sfondo pastello ad altissima leggibilità da un colore esadecimale."""
    clean_hex = hex_str.lstrip("#").upper()
    if len(clean_hex) != 6:
        clean_hex = "4A5568"
    try:
        r = int(clean_hex[0:2], 16)
        g = int(clean_hex[2:4], 16)
        b = int(clean_hex[4:6], 16)
    except ValueError:
        r, g, b = 74, 85, 104

    bg_r = round(r * (1 - factor) + 255 * factor)
    bg_g = round(g * (1 - factor) + 255 * factor)
    bg_b = round(b * (1 - factor) + 255 * factor)
    bg_hex = f"#{bg_r:02X}{bg_g:02X}{bg_b:02X}"
    border_hex = f"#{clean_hex}"
    return bg_hex, border_hex

def normalize_subject_base(subj):
    """
    Riconduce materie con laboratori o varianti alla stessa famiglia
    (es. 'Laboratorio di Scienze' e 'Scienze Naturali' o 'Informatica').
    """
    if not subj:
        return ""
    s = subj.strip()
    s = re.sub(r"^laboratorio\s+(di\s+)?", "", s, flags=re.I)
    return s.strip().upper()

def build_subject_color_map(subjects):
    """
    Assegna stabilmente un colore della palette a ciascuna famiglia di materia.
    """
    unique_bases = sorted(list(set(normalize_subject_base(s) for s in subjects if s)))
    color_map = {}
    for idx, base in enumerate(unique_bases):
        palette_hex = PALETTE_COLORI_MATERIE[idx % len(PALETTE_COLORI_MATERIE)]
        bg, border = hex_to_pastel(palette_hex)
        color_map[base] = {
            "hex": palette_hex,
            "bg": bg,
            "border": border
        }
    return color_map

def class_sort_key(c):
    """
    Ordinamento naturale classi scolastiche italiane:
    Tutte le 'A' ordinate per anno (1A, 2A, 3A, 3AM, 3AR, 4A, 4A FRA...),
    poi 'B', 'C', ecc.
    """
    c_str = str(c).strip()
    m = re.match(r"^(\d+)\s*([A-Za-z]+)?(.*)$", c_str)
    if m:
        num = int(m.group(1))
        sec = m.group(2) or ""
        rest = m.group(3) or ""
        prim_sec = sec[0].upper() if sec else "Z"
        sub_sec = sec[1:].upper() if len(sec) > 1 else ""
        return (prim_sec, num, sub_sec, rest)
    return ("ZZ", 999, c_str, "")


# =====================================================================
# RISOLUZIONE DELLE CLASSI ARTICOLATE E MATRICI ORARIE
# =====================================================================

def analyze_articulated_classes(all_classes, activities):
    """
    Rileva le classi madri e figlie (es. madre 3A -> figlie 3AM, 3AR; madre 4A -> 4A FRA, 4A SPA).
    Restituisce:
    - mothers: dict madre -> list figlie
    - daughter_to_mother: dict figlia -> madre
    - daughter_labels: dict figlia -> etichetta breve (es. '3AM' -> 'M', '4A FRA' -> 'FRA')
    """
    all_groups = set(str(c).strip() for c in all_classes)
    for a in activities:
        for s in a.get("students", []):
            if s:
                all_groups.add(str(s).strip())

    mothers = {}
    daughter_to_mother = {}
    daughter_labels = {}

    for g in sorted(all_groups, key=class_sort_key):
        # Una classe è madre se esistono almeno 2 gruppi che iniziano con g e non sono g
        daughters = [d for d in all_groups if d != g and d.startswith(g)]
        if len(daughters) >= 2:
            mothers[g] = sorted(daughters, key=class_sort_key)
            for d in daughters:
                daughter_to_mother[d] = g
                label = d[len(g):].strip()
                if not label:
                    label = d
                daughter_labels[d] = label

    return mothers, daughter_to_mother, daughter_labels


def build_unified_class_timetables(data):
    """
    Costruisce l'orario settimanale completo per ciascuna classe,
    espandendo le classi articolate e le durate multiple.
    """
    timetable = data.get("timetable", {})
    acts_map = {str(a["id"]): a for a in data.get("activities", [])}
    days = data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven"])
    hours = [h for h in data.get("hours", []) if not h.startswith("INT")]
    teacher_aliases = {t["name"]: t.get("short_name", t["name"]) for t in data.get("teachers", [])}

    base_classes = [c["name"] for c in data.get("classes", [])]
    activities = data.get("activities", [])
    mothers, daughter_to_mother, daughter_labels = analyze_articulated_classes(base_classes, activities)

    # Raccolta di tutti i gruppi partecipanti
    all_groups_set = set(base_classes)
    for d_list in mothers.values():
        all_groups_set.update(d_list)
    for a in activities:
        for s in a.get("students", []):
            if s:
                all_groups_set.add(str(s).strip())

    all_classes_sorted = sorted(list(all_groups_set), key=class_sort_key)

    # 1. Raccolta lezioni grezze per gruppo
    raw_by_group = {c: {d: {h: [] for h in hours} for d in days} for c in all_classes_sorted}

    for aid, placement in timetable.items():
        act = acts_map.get(str(aid))
        is_companion = False
        if not act and str(aid).startswith("90000"):
            orig_id = str(aid)[5:]
            orig_act = acts_map.get(orig_id)
            if orig_act:
                act = orig_act.copy()
                act["duration"] = 1
                is_companion = True
        if not act:
            continue

        p_day = placement.get("day")
        p_hour = placement.get("hour")
        room = placement.get("room", "")

        if p_day not in days or p_hour not in hours:
            continue

        teachers = act.get("teachers", [])
        teachers_short = [teacher_aliases.get(tn, tn) for tn in teachers]
        subject = act.get("subject", "")

        dur = 2 if (act.get("duration") == 3 and not is_companion) else act.get("duration", 1)
        if subject.strip().lower().startswith("disposiz"):
            dur = 1

        occupied_hours = [p_hour]
        if dur > 1 and p_hour in hours:
            idx = hours.index(p_hour)
            occupied_hours = hours[idx : idx + dur]

        for h_occ in occupied_hours:
            if h_occ not in hours:
                continue
            item = {
                "activity_id": aid,
                "subject": subject,
                "teachers": teachers,
                "teachers_short": teachers_short,
                "room": room,
                "students": act.get("students", []),
                "duration": dur
            }
            for s in act.get("students", []):
                s_clean = str(s).strip()
                if s_clean in raw_by_group:
                    raw_by_group[s_clean][p_day][h_occ].append(item)

    # 2. Risoluzione classi articolate:
    # - La classe madre riceve lezioni unificate; dove non ne ha, riceve gli slot articolati dalle figlie
    # - Le classi figlie ereditano le lezioni comuni della madre
    unified_by_class = {c: {d: {h: [] for h in hours} for d in days} for c in all_classes_sorted}

    for c in all_classes_sorted:
        for d in days:
            for h in hours:
                items = raw_by_group[c][d][h]
                if items:
                    unified_by_class[c][d][h] = list(items)

    # Eredità per figlie e fusione per madri
    for mother, daughters in mothers.items():
        if mother not in unified_by_class:
            continue
        for d in days:
            for h in hours:
                mother_lessons = raw_by_group[mother][d][h]
                if mother_lessons:
                    # Le figlie ereditano le lezioni della madre
                    for daughter in daughters:
                        if daughter in unified_by_class:
                            if not unified_by_class[daughter][d][h]:
                                unified_by_class[daughter][d][h] = list(mother_lessons)
                else:
                    # La madre controlla se le figlie hanno lezioni articolate in questo slot
                    articulated_items = []
                    for daughter in daughters:
                        d_lessons = raw_by_group.get(daughter, {}).get(d, {}).get(h, [])
                        for l in d_lessons:
                            item_copy = dict(l)
                            item_copy["is_articulated"] = True
                            item_copy["daughter_name"] = daughter
                            item_copy["daughter_label"] = daughter_labels.get(daughter, daughter)
                            articulated_items.append(item_copy)
                    if articulated_items:
                        unified_by_class[mother][d][h] = articulated_items

    # Calcolo dell'ora massima globale e per classe
    class_max_hour = {}
    global_max_hour = 6
    for c in all_classes_sorted:
        max_h = 1
        for d in days:
            for h in hours:
                if unified_by_class[c][d][h] and h.isdigit():
                    h_int = int(h)
                    if h_int > max_h:
                        max_h = h_int
        class_max_hour[c] = max(6, max_h)
        if max_h > global_max_hour:
            global_max_hour = max_h

    return {
        "timetables": unified_by_class,
        "classes": all_classes_sorted,
        "mothers": mothers,
        "daughter_to_mother": daughter_to_mother,
        "daughter_labels": daughter_labels,
        "class_max_hour": class_max_hour,
        "global_max_hour": global_max_hour,
        "days": days,
        "hours": hours
    }


# =====================================================================
# PROCEDURA 9: GENERATORE ORARIO PER CLASSE (PDF / STAMPA A4 LANDSCAPE)
# =====================================================================

def generate_classes_print_html(data, options=None):
    """
    Genera il documento HTML pronto per la stampa o esportazione in PDF (A4 Landscape)
    dell'orario per classe (Procedura 9), con LAYOUT FISSO identico per tutte le pagine
    (sempre 8 ore con i 3 intervalli) e abbondante margine inferiore.
    """
    options = options or {}
    validity_date = options.get("validity_date") or get_default_validity_date()
    color_mode = options.get("color_mode", "color") # 'color' | 'bw'
    content_mode = options.get("content_mode", "materia_docente") # 'materia_docente' | 'materia' | 'docente'
    show_rooms = bool(options.get("show_rooms", True))
    include_subgroups = bool(options.get("include_subgroups", True))
    selected_classes = options.get("classes") # list or None = all
    raw_lang = options.get("lang", "it") if options else "it"
    is_en = str(raw_lang).strip().lower() in ("en", "eng", "english")
    lang = "en" if is_en else "it"

    institution = data.get("institution", 'Liceo & Tecnico "Pico De Paperis" - Paperopoli')
    subjects_list = [s["name"] for s in data.get("subjects", [])]
    color_map = build_subject_color_map(subjects_list)

    parsed = build_unified_class_timetables(data)
    all_classes = parsed["classes"]
    timetables = parsed["timetables"]
    days = parsed["days"]

    # Filtro classi da stampare
    classes_to_print = []
    for c in all_classes:
        is_sub = c in parsed["daughter_to_mother"]
        if is_sub and not include_subgroups:
            continue
        if selected_classes and selected_classes != "all":
            if isinstance(selected_classes, str):
                sel_list = [s.strip() for s in selected_classes.split(",") if s.strip()]
            else:
                sel_list = selected_classes
            if c not in sel_list:
                continue
        classes_to_print.append(c)

    if not classes_to_print:
        classes_to_print = all_classes

    # Giorni completi con etichetta
    giorni_info = []
    for d in days:
        giorni_info.append({"id": d, "nome": get_day_name(d, lang=lang, full=True)})

    # Struttura fissa: SEMPRE 8 ore e 3 intervalli su ogni classe per garantire uniformità perfetta
    FIXED_MAX_HOURS = 8

    # Inizio generazione HTML
    html_out = []
    html_out.append(f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{'Class Timetable' if lang == 'en' else 'Orario per Classe'} &mdash; {escape(institution)}</title>
<style>
  @page {{
    size: landscape;
    size: A4 landscape;
    margin: 8mm 10mm 16mm 10mm;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  html, body {{
    margin: 0;
    padding: 0;
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    color: #111827;
    background-color: #f1f5f9;
    font-size: 11px;
  }}

  /* Toolbar navigazione / anteprima a schermo */
  .no-print {{
    background: #0f172a;
    color: #fff;
    padding: 8px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 1000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.25);
  }}
  .no-print h2 {{
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .btn-toolbar {{
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
    transition: background 0.15s;
  }}
  .btn-toolbar:hover {{ background: #1d4ed8; }}
  .btn-toolbar-sec {{
    background: #475569;
    color: #fff;
    margin-right: 8px;
  }}
  .btn-toolbar-sec:hover {{ background: #334155; }}

  /* Struttura orizzontale A4 Landscape */
  .booklet {{
    display: flex;
    flex-direction: column;
    align-items: center;
    padding: 18px 0;
    gap: 20px;
  }}
  .sheet-page {{
    width: 277mm;
    min-height: 184mm;
    background: #ffffff;
    box-shadow: 0 4px 18px rgba(0,0,0,0.12), 0 1px 3px rgba(0,0,0,0.06);
    border: 1px solid #cbd5e1;
    border-radius: 4px;
    padding: 8mm 10mm 12mm 10mm;
    box-sizing: border-box;
    display: flex;
    flex-direction: column;
    justify-content: flex-start;
    gap: 4px;
    position: relative;
  }}

  /* Intestazione pagina con classe a sinistra e istituto/validità a destra */
  .header-box {{
    display: flex;
    justify-content: space-between;
    align-items: flex-end;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 3px;
    margin-bottom: 5px;
    width: 100%;
  }}
  .header-left h1 {{
    margin: 0;
    font-size: 20px;
    font-weight: 800;
    color: #0f172a;
    letter-spacing: -0.02em;
    display: flex;
    align-items: baseline;
    gap: 8px;
    line-height: 1.1;
  }}
  .header-left .sub-tag {{
    font-size: 13px;
    font-weight: 600;
    color: #475569;
  }}
  .header-right {{
    text-align: right;
    line-height: 1.25;
  }}
  .header-right .inst-name {{
    font-size: 12px;
    font-weight: 800;
    color: #0f172a;
  }}
  .header-right .val-date {{
    font-size: 11px;
    color: #334155;
    font-weight: 500;
  }}

  /* Tabella Griglia Orario */
  table.grid {{
    width: 100%;
    border-collapse: separate;
    border-spacing: 0;
    table-layout: fixed;
    margin: 0;
  }}
  table.grid th, table.grid td {{
    border: 1px solid #cbd5e1;
    padding: 1px 2px;
    vertical-align: middle;
    text-align: center;
  }}
  table.grid th {{
    background-color: #f1f5f9;
    color: #0f172a;
    font-weight: 800;
    font-size: 12px;
    height: 24px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
  }}
  table.grid th.col-ora {{
    width: 55px;
  }}

  /* Colonna Ora & Orari Campana */
  .col-ora-cell {{
    background: #f8fafc;
    width: 55px;
    padding: 1px !important;
  }}
  .ora-num {{
    font-weight: 800;
    font-size: 11.5px;
    color: #0f172a;
    line-height: 1.1;
  }}
  .ora-time {{
    font-size: 9px;
    color: #64748b;
    font-weight: 600;
    margin-top: 1px;
  }}

  /* Righe Intervallo a dimensione fissa */
  tr.intervallo-row td {{
    background: #f8fafc !important;
    border-top: 1px dashed #94a3b8;
    border-bottom: 1px dashed #94a3b8;
    padding: 0 4px !important;
    height: 12px;
    font-size: 8.5px;
    font-weight: 600;
    color: #475569;
    letter-spacing: 0.03em;
  }}

  /* Cella Lezione a dimensione calibrata anti-sbordamento */
  td.col-lesson-cell {{
    height: 56px;
    padding: 1px 2px !important;
  }}
  .cell-content {{
    width: 100%;
    height: 54px;
    min-height: 54px;
    max-height: 54px;
    border-radius: 3px;
    padding: 2px 4px;
    display: flex;
    flex-direction: column;
    justify-content: center;
    align-items: center;
    text-align: center;
    box-sizing: border-box;
    overflow: hidden;
  }}
  .riga-materia {{
    font-weight: 700;
    font-size: 10.5px;
    line-height: 1.25;
    color: #0f172a;
    width: 100%;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: break-word;
    text-align: center;
  }}
  .riga-docente {{
    font-size: 9.5px;
    font-weight: 600;
    color: #334155;
    margin-top: 2px;
    width: 100%;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: break-word;
    text-align: center;
  }}

  /* Slot Articolato */
  .articulated-box {{
    width: 100%;
    height: 100%;
    display: flex;
    flex-direction: column;
    justify-content: space-evenly;
    gap: 1px;
  }}
  .articulated-item {{
    background: rgba(255,255,255,0.7);
    border: 1px solid rgba(0,0,0,0.12);
    border-radius: 2px;
    padding: 1px 3px;
    font-size: 8.5px;
    line-height: 1.15;
    white-space: normal;
    word-break: break-word;
    overflow-wrap: break-word;
    width: 100%;
    text-align: center;
  }}
  .articulated-tag {{
    font-weight: 800;
    color: #1e40af;
    margin-right: 2px;
  }}

  /* Cella Libera a dimensione fissa */
  .cell-libero {{
    color: #94a3b8;
    font-size: 13px;
    background-color: #fafafa;
    border: 1px dashed #e2e8f0;
    border-radius: 3px;
    height: 54px;
    min-height: 54px;
    display: flex;
    align-items: center;
    justify-content: center;
  }}

  /* Stili di stampa (@media print) */
  @media print {{
    @page {{
      size: landscape;
      size: A4 landscape;
      margin: 8mm 10mm 14mm 10mm;
    }}
    html, body {{
      width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }}
    .no-print {{
      display: none !important;
    }}
    .booklet {{
      display: block !important;
      padding: 0 !important;
      margin: 0 !important;
      gap: 0 !important;
    }}
    .sheet-page {{
      width: 100% !important;
      height: auto !important;
      min-height: unset !important;
      max-height: none !important;
      aspect-ratio: unset !important;
      box-shadow: none !important;
      border: none !important;
      border-radius: 0 !important;
      padding: 0 !important;
      margin: 0 !important;
      page-break-after: always !important;
      break-after: page !important;
      page-break-inside: avoid !important;
      break-inside: avoid !important;
      overflow: visible !important;
      display: block !important;
    }}
    .sheet-page:last-child {{
      page-break-after: auto !important;
      break-after: auto !important;
    }}
  }}
</style>
<script>
function closePrintView() {{
  try {{
    window.close();
  }} catch (e) {{}}
  setTimeout(function() {{
    if (window.opener && !window.opener.closed) {{
      try {{ window.close(); }} catch(e) {{}}
    }} else if (window.history.length > 1) {{
      window.history.back();
    }} else {{
      window.location.href = '/';
    }}
  }}, 120);
}}

function switchPrintLang(newLang) {{
  document.cookie = "app_lang=" + newLang + "; path=/; max-age=31536000; SameSite=Lax";
  try {{ localStorage.setItem('app_lang', newLang); }} catch(e){{}}
  const url = new URL(window.location.href);
  url.searchParams.set('lang', newLang);
  window.location.href = url.toString();
}}
</script>
</head>
<body>

<div class="no-print">
  <h2>{'🖨️ Print Class Timetable' if is_en else '🖨️ Stampa Orario per Classe'} &mdash; {len(classes_to_print)} {'Classes (A4 Landscape)' if is_en else 'Classi (A4 Orizzontale)'}</h2>
  <div style="display:flex;align-items:center;gap:6px;">
    <div style="display:inline-flex;border:1px solid #475569;border-radius:4px;overflow:hidden;margin-right:6px;">
      <button class="btn-toolbar" style="padding:4px 8px;font-size:11px;background:{'#2563eb' if not is_en else '#334155'};border-radius:0;" onclick="switchPrintLang('it')" title="Visualizza in Italiano">🇮🇹 ITA</button>
      <button class="btn-toolbar" style="padding:4px 8px;font-size:11px;background:{'#2563eb' if is_en else '#334155'};border-radius:0;" onclick="switchPrintLang('en')" title="Switch to English">🇬🇧 ENG</button>
    </div>
    <button class="btn-toolbar btn-toolbar-sec" onclick="closePrintView()">{'✕ Close' if is_en else '✕ Chiudi'}</button>
    <button class="btn-toolbar" onclick="window.print()">{'🖨️ Print / Save as PDF' if is_en else '🖨️ Stampa / Salva in PDF'}</button>
  </div>
</div>

<div class="booklet">
""")

    # Generazione singole pagine per classe (TUTTE con lo stesso layout fisso di 8 ore)
    for page_idx, classe in enumerate(classes_to_print):
        tt_c = timetables.get(classe, {})

        # Dicitura sottotitolo (se articolata)
        sub_desc = ""
        if classe in parsed["mothers"]:
            figlie_str = ", ".join(parsed["mothers"][classe])
            sub_desc = f"(Articulated: {figlie_str})" if lang == "en" else f"(Articolata: {figlie_str})"
        elif classe in parsed["daughter_to_mother"]:
            madre = parsed["daughter_to_mother"][classe]
            sub_desc = f"(Subgroup of {madre})" if lang == "en" else f"(Sottogruppo di {madre})"

        class_title_prefix = 'Class' if lang == 'en' else 'Classe'
        effective_lbl = 'Effective from:' if lang == 'en' else 'Valido a partire da:'
        period_lbl = 'Period' if lang == 'en' else 'Ora'

        html_out.append(f"""
  <div class="sheet-page">
    <div class="header-box">
      <div class="header-left">
        <h1>{class_title_prefix} {escape(classe)} <span class="sub-tag">{escape(sub_desc)}</span></h1>
      </div>
      <div class="header-right">
        <div class="inst-name">{escape(institution)}</div>
        <div class="val-date">{effective_lbl} <b>{escape(validity_date)}</b></div>
      </div>
    </div>

    <table class="grid">
      <thead>
        <tr>
          <th class="col-ora">{period_lbl}</th>
""")
        for g in giorni_info:
            html_out.append(f"          <th>{escape(g['nome'])}</th>\n")
        html_out.append("        </tr>\n      </thead>\n      <tbody>\n")

        # SEMPRE 8 ore fisse con 3 intervalli
        for h_int in range(1, FIXED_MAX_HOURS + 1):
            h_str = str(h_int)
            orario = ORARIO_ORE.get(h_int, {"inizio": "", "fine": ""})
            hour_display = f"Period {h_int}" if lang == "en" else f"{h_int}ª ora"

            html_out.append(f"""        <tr>
          <td class="col-ora col-ora-cell">
            <div class="ora-num">{hour_display}</div>
            <div class="ora-time">{orario['inizio']}-{orario['fine']}</div>
          </td>
""")
            for g in giorni_info:
                g_id = g["id"]
                lessons = tt_c.get(g_id, {}).get(h_str, [])

                if not lessons:
                    html_out.append('          <td class="col-lesson-cell"><div class="cell-libero">&mdash;</div></td>\n')
                elif any(l.get("is_articulated") for l in lessons):
                    # Slot articolato (divisione gruppi, es. Francese / Spagnolo o Meccanica / Robotica)
                    items_html = []
                    for l in lessons:
                        tag = l.get("daughter_label") or l.get("daughter_name", "")
                        subj = l.get("subject", "")
                        subj_disp = get_subject_display_name(subj, lang)
                        teachers_str = ", ".join(l.get("teachers_short", []))
                        items_html.append(f"""
                          <div class="articulated-item">
                            <span class="articulated-tag">{escape(tag)}:</span>
                            <b>{escape(subj_disp)}</b>
                            <span style="color:#475569;">({escape(teachers_str)})</span>
                          </div>
                        """)
                    box_bg = "#f1f5f9" if color_mode != "color" else "#eff6ff"
                    box_bdr = "#94a3b8" if color_mode != "color" else "#93c5fd"
                    html_out.append(f"""          <td class="col-lesson-cell">
            <div class="cell-content" style="background-color:{box_bg};border:1.5px solid {box_bdr};">
              <div class="articulated-box">
                {''.join(items_html)}
              </div>
            </div>
          </td>\n""")
                else:
                    # Lezione normale o in co-docenza
                    l = lessons[0]
                    subj = l.get("subject", "")
                    subj_disp = get_subject_display_name(subj, lang)
                    teachers_str = " / ".join(l.get("teachers_short", []))

                    base = normalize_subject_base(subj)
                    col_info = color_map.get(base, {"bg": "#ffffff", "border": "#64748b"})

                    if color_mode == "color":
                        cell_bg = col_info["bg"]
                        cell_border = col_info["border"]
                    else:
                        cell_bg = "#ffffff"
                        cell_border = "#475569"

                    content_parts = []
                    if content_mode in ("materia_docente", "materia"):
                        content_parts.append(f'<div class="riga-materia" title="{escape(subj_disp)}">{escape(subj_disp)}</div>')
                    if content_mode in ("materia_docente", "docente"):
                        content_parts.append(f'<div class="riga-docente" title="{escape(teachers_str)}">{escape(teachers_str)}</div>')

                    html_out.append(f"""          <td class="col-lesson-cell">
            <div class="cell-content" style="background-color:{cell_bg};border:1.5px solid {cell_border};">
              {''.join(content_parts)}
            </div>
          </td>\n""")

            html_out.append("        </tr>\n")

            # Inserimento intervallo (1°, 2° o 3°)
            if h_int in INTERVALLI_DOPO_ORA and h_int < FIXED_MAX_HOURS:
                intervallo = get_intervallo_info(h_int, lang=lang)
                html_out.append(f"""        <tr class="intervallo-row">
          <td></td>
          <td colspan="{len(giorni_info)}">
            &bull; {escape(intervallo['label'])} ({intervallo['inizio']} &ndash; {intervallo['fine']}) &bull;
          </td>
        </tr>\n""")

        html_out.append("""      </tbody>
    </table>
  </div>
""")

    html_out.append("""</div>
</body>
</html>""")

    return "".join(html_out)


def xml_escape(s):
    """Esegue l'escape per XML compatibile con OpenXML / WordprocessingML."""
    return str(s).replace("&", "&amp;").replace("<", "&lt;").replace(">", "&gt;").replace('"', "&quot;").replace("'", "&apos;")


def generate_teachers_master_print_html(data, options=None):
    """
    Genera il Tabellone Generale dell'Orario Docenti (Procedura 12) in formato A3 Orizzontale.
    Include bande verticali alternate per giorno, compattazione dinamica delle ore vuote
    in coda, evidenziazione delle Disposizioni ("D") e statistiche ore totali.
    Garantisce che tutte le informazioni stiano perfettamente dentro le caselle
    con font scalato e larghezza fissa per colonna.
    """
    options = options or {}
    validity_date = options.get("validity_date") or get_default_validity_date()
    paper_size = options.get("paper_size", "A3") # 'A3' | 'A4'
    show_rooms = bool(options.get("show_rooms", False))
    highlight_disp = bool(options.get("highlight_disp", True))
    raw_lang = options.get("lang", "it") if options else "it"
    is_en = str(raw_lang).strip().lower() in ("en", "eng", "english")
    lang = "en" if is_en else "it"

    institution = data.get("institution", 'Liceo & Tecnico "Pico De Paperis" - Paperopoli')
    days = data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven"])
    hours = [h for h in data.get("hours", []) if not h.startswith("INT")]

    # Calcolo viste docenti
    from webapp.fet_engine import build_timetable_views
    views = build_timetable_views(data)
    by_teacher = views["by_teacher"]
    teacher_stats = views["teacher_stats"]

    # Docenti ordinati alfabeticamente
    sorted_teachers = sorted(list(by_teacher.keys()))

    # Determinazione delle ore massime EFFETTIVAMENTE usate per ciascun giorno
    # (Trimming ore di coda vuote, es. Lunedì/Mercoledì/Giovedì max 6, Martedì/Venerdì max 8)
    day_max_hour = {}

    for d in days:
        max_h = 1
        for t in sorted_teachers:
            for h in hours:
                if by_teacher[t][d].get(h) and h.isdigit():
                    h_int = int(h)
                    if h_int > max_h:
                        max_h = h_int
        day_max_hour[d] = max_h

    # Struttura giorni attivi con relative ore
    active_days = []
    total_hour_columns = 0
    for idx, d in enumerate(days):
        max_h = day_max_hour[d]
        active_hours = [str(h_i) for h_i in range(1, max_h + 1)]
        total_hour_columns += len(active_hours)
        active_days.append({
            "id": d,
            "nome": get_day_name(d, lang=lang, full=True),
            "hours": active_hours,
            "is_alt": (idx % 2 == 1)
        })

    # Calcolo lunghezza massima testo classe per scalare la dimensione font
    max_class_len = 0
    for t in sorted_teachers:
        for d in active_days:
            d_id = d["id"]
            for h_str in d["hours"]:
                slots = by_teacher[t][d_id].get(h_str, [])
                if slots:
                    item = slots[0]
                    subj = item.get("subject", "")
                    if "disposiz" in subj.lower():
                        custom_desc = (item.get("custom_desc") or "").strip()
                        max_class_len = max(max_class_len, len(custom_desc) if custom_desc else 1)
                    else:
                        cls_text = "/".join(item.get("students", []))
                        max_class_len = max(max_class_len, len(cls_text))

    is_a3 = (paper_size.upper() == "A3")
    css_page_size = "A3 landscape" if is_a3 else "A4 landscape"

    # Riduzione dinamica del font per non andare mai a capo e stare dentro le celle
    if is_a3:
        if max_class_len <= 3:
            body_font_size = "7.5pt"
        elif max_class_len <= 5:
            body_font_size = "7pt"
        else:
            body_font_size = "6.2pt"
        cell_min_height = "18px"
    else:
        if max_class_len <= 3:
            body_font_size = "6pt"
        elif max_class_len <= 5:
            body_font_size = "5.5pt"
        else:
            body_font_size = "5pt"
        cell_min_height = "14px"

    # Larghezze percentuali esatte per la griglia
    teacher_pct = 13.5
    tot_pct = 2.5
    rem_pct = 100.0 - teacher_pct - tot_pct
    hour_pct = rem_pct / total_hour_columns if total_hour_columns else 2.5

    html_out = []
    html_out.append(f"""<!DOCTYPE html>
<html lang="{lang}">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>{'Faculty Master Timetable' if lang == 'en' else 'Tabellone Generale Orario Docenti'} ({paper_size}) &mdash; {escape(institution)}</title>
<style>
  @page {{
    size: landscape;
    size: {css_page_size};
    margin: 6mm 8mm 12mm 8mm;
  }}
  * {{
    box-sizing: border-box;
    -webkit-print-color-adjust: exact !important;
    print-color-adjust: exact !important;
  }}
  body {{
    margin: 0;
    padding: 0;
    font-family: Arial, "Helvetica Neue", Helvetica, sans-serif;
    color: #0f172a;
    background-color: #f8fafc;
    font-size: {body_font_size};
  }}

  /* Toolbar navigazione / anteprima a schermo */
  .no-print {{
    background: #0f172a;
    color: #fff;
    padding: 8px 18px;
    display: flex;
    justify-content: space-between;
    align-items: center;
    position: sticky;
    top: 0;
    z-index: 1000;
    box-shadow: 0 2px 10px rgba(0,0,0,0.3);
  }}
  .no-print h2 {{
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    display: flex;
    align-items: center;
    gap: 8px;
  }}
  .btn-toolbar {{
    background: #2563eb;
    color: #fff;
    border: none;
    padding: 6px 14px;
    border-radius: 4px;
    font-weight: 600;
    font-size: 12px;
    cursor: pointer;
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }}
  .btn-toolbar:hover {{ background: #1d4ed8; }}
  .btn-toolbar-sec {{
    background: #475569;
    color: #fff;
    margin-right: 6px;
  }}
  .btn-toolbar-sec:hover {{ background: #334155; }}
  .btn-toolbar-accent {{
    background: #059669;
    color: #fff;
    margin-right: 6px;
  }}
  .btn-toolbar-accent:hover {{ background: #047857; }}

  /* Contenitore e Tabella Generale */
  .master-wrap {{
    padding: 6px 8px;
    background: #fff;
  }}
  .header-banner {{
    display: flex;
    justify-content: space-between;
    align-items: center;
    border-bottom: 2px solid #0f172a;
    padding-bottom: 3px;
    margin-bottom: 4px;
  }}
  .header-banner h1 {{
    margin: 0;
    font-size: 15px;
    font-weight: 800;
    color: #0f172a;
  }}
  .header-banner .meta {{
    font-size: 10.5px;
    color: #334155;
    font-weight: 600;
  }}

  table.master-grid {{
    width: 100%;
    border-collapse: collapse;
    table-layout: fixed;
  }}
  table.master-grid thead {{
    display: table-header-group;
  }}
  table.master-grid th, table.master-grid td {{
    border: 1px solid #cbd5e1;
    padding: 0 1px !important;
    text-align: center;
    vertical-align: middle;
    height: {cell_min_height};
    max-height: {cell_min_height};
    box-sizing: border-box;
    overflow: hidden;
  }}

  /* Intestazione Colonne e Giorni */
  th.th-teacher {{
    background-color: #0f172a !important;
    color: #ffffff !important;
    font-weight: 700;
    text-align: left;
    padding-left: 5px !important;
    font-size: 9px;
  }}
  th.th-day {{
    color: #0f172a;
    font-weight: 800;
    font-size: 10px;
    text-transform: uppercase;
    letter-spacing: 0.03em;
    background-color: #e2e8f0;
  }}
  th.th-hour {{
    font-weight: 700;
    font-size: 8.5px;
    color: #334155;
    background-color: #f1f5f9;
  }}
  th.th-tot {{
    background-color: #1e293b !important;
    color: #ffffff !important;
    font-size: 8.5px;
  }}

  /* Bande verticali alternate per giorno */
  .day-band-light {{ background-color: #ffffff; }}
  .day-band-alt {{ background-color: #f1f5f9; }}
  .day-boundary {{ border-right: 2px solid #0f172a !important; }}

  /* Riga Docente */
  td.td-teacher-name {{
    text-align: left !important;
    padding-left: 5px !important;
    font-weight: 700;
    font-size: 8px;
    color: #0f172a;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    background-color: #f8fafc;
  }}

  /* Cella Lezione Docente ad alta densità */
  td.td-lesson-cell {{
    font-size: {body_font_size};
    font-weight: 500;
    line-height: 1.05;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: clip;
  }}
  .cell-cls {{
    display: inline-block;
    max-width: 100%;
    overflow: hidden;
    text-overflow: clip;
    white-space: nowrap;
    font-size: {body_font_size};
    color: #0f172a;
    font-weight: 500;
  }}
  .badge-disp {{
    display: inline-block;
    background-color: #fef3c7;
    color: #92400e;
    font-weight: 700;
    border-radius: 2px;
    padding: 0 3px;
    font-size: {body_font_size};
    line-height: 1.1;
  }}
  .badge-coteach {{
    font-size: 6px;
    color: #2563eb;
    vertical-align: super;
    margin-left: 1px;
    font-weight: 700;
  }}
  td.td-tot {{
    font-weight: 800;
    font-size: 8.5px;
    color: #0f172a;
    background-color: #f8fafc;
  }}

  /* Stili di stampa */
  @media print {{
    @page {{
      size: landscape;
      size: {css_page_size};
      margin: 6mm 8mm 12mm 8mm;
    }}
    html, body {{
      width: 100% !important;
      height: auto !important;
      margin: 0 !important;
      padding: 0 !important;
      background: #fff !important;
      -webkit-print-color-adjust: exact !important;
      print-color-adjust: exact !important;
    }}
    .no-print {{
      display: none !important;
    }}
    .master-wrap {{
      padding: 0 !important;
      margin: 0 !important;
    }}
    table.master-grid thead {{
      display: table-header-group !important;
    }}
    table.master-grid tr {{
      page-break-inside: avoid !important;
      break-inside: avoid !important;
    }}
  }}
</style>
<script>
function closePrintView() {{
  try {{
    window.close();
  }} catch (e) {{}}
  setTimeout(function() {{
    if (window.opener && !window.opener.closed) {{
      try {{ window.close(); }} catch(e) {{}}
    }} else if (window.history.length > 1) {{
      window.history.back();
    }} else {{
      window.location.href = '/';
    }}
  }}, 120);
}}

function downloadDocx() {{
  const url = '/api/print/teachers/docx' + window.location.search;
  window.location.href = url;
}}

function switchPrintLang(newLang) {{
  document.cookie = "app_lang=" + newLang + "; path=/; max-age=31536000; SameSite=Lax";
  try {{ localStorage.setItem('app_lang', newLang); }} catch(e){{}}
  const url = new URL(window.location.href);
  url.searchParams.set('lang', newLang);
  window.location.href = url.toString();
}}

function copyTableForGoogleDocs() {{
  const table = document.getElementById('masterTeacherTable');
  if (!table) return;
  const range = document.createRange();
  range.selectNode(table);
  window.getSelection().removeAllRanges();
  window.getSelection().addRange(range);
  try {{
    const ok = document.execCommand('copy');
    window.getSelection().removeAllRanges();
    if (ok) {{
      const msgOk = "{'Faculty master timetable copied to clipboard!\\n\\nGoogle Docs will now open in a new tab: press Paste (Cmd+V or Ctrl+V) to insert the timetable.' if is_en else 'Tabellone copiato negli appunti!\\n\\nOra si aprirà Google Documenti in una nuova scheda: premi Incolla (Cmd+V o Ctrl+V) per inserire il tabellone completo.'}";
      alert(msgOk);
      window.open('https://docs.new', '_blank');
    }} else {{
      const msgErr = "{'Please select the table and press Cmd+C to copy.' if is_en else 'Seleziona la tabella e premi Cmd+C per copiarla.'}";
      alert(msgErr);
    }}
  }} catch(e) {{
    const msgErr = "{'Please select the table and press Cmd+C to copy.' if is_en else 'Seleziona la tabella e premi Cmd+C per copiarla.'}";
    alert(msgErr);
  }}
}}
</script>
</head>
<body>

<div class="no-print">
  <h2>{'📄 Faculty Master Timetable' if is_en else '📄 Tabellone Generale Orario Docenti'} &mdash; {'Format' if is_en else 'Formato'} {paper_size} ({len(sorted_teachers)} {'Teachers' if is_en else 'Docenti'})</h2>
  <div style="display:flex;gap:6px;align-items:center;">
    <div style="display:inline-flex;border:1px solid #475569;border-radius:4px;overflow:hidden;margin-right:6px;">
      <button class="btn-toolbar" style="padding:4px 8px;font-size:11px;background:{'#2563eb' if not is_en else '#334155'};border-radius:0;" onclick="switchPrintLang('it')" title="Visualizza in Italiano">🇮🇹 ITA</button>
      <button class="btn-toolbar" style="padding:4px 8px;font-size:11px;background:{'#2563eb' if is_en else '#334155'};border-radius:0;" onclick="switchPrintLang('en')" title="Switch to English">🇬🇧 ENG</button>
    </div>
    <button class="btn-toolbar btn-toolbar-sec" onclick="closePrintView()">{'✕ Close' if is_en else '✕ Chiudi'}</button>
    <button class="btn-toolbar btn-toolbar-accent" onclick="copyTableForGoogleDocs()">{'📋 Copy for Google Docs' if is_en else '📋 Copia per Google Docs'}</button>
    <button class="btn-toolbar btn-toolbar-sec" onclick="downloadDocx()">{'📥 Download .docx (Google Docs)' if is_en else '📥 Scarica .docx (Google Docs)'}</button>
    <button class="btn-toolbar" onclick="window.print()">{'🖨️ Print / Save as PDF' if is_en else '🖨️ Stampa / Salva in PDF'}</button>
  </div>
</div>

<div class="master-wrap">
  <div class="header-banner">
    <h1>{escape(institution)} &mdash; {'Faculty Master Timetable' if lang == 'en' else 'Tabellone Orario Docenti'}</h1>
    <div class="meta">
      {'Effective from:' if lang == 'en' else 'Valido a partire dal:'} <b>{escape(validity_date)}</b> &bull; {'Total Teachers:' if lang == 'en' else 'Totale Docenti:'} <b>{len(sorted_teachers)}</b>
    </div>
  </div>

  <table id="masterTeacherTable" class="master-grid">
    <colgroup>
      <col style="width:{teacher_pct}%;">
""")

    for d in active_days:
        for _ in d["hours"]:
            html_out.append(f'      <col style="width:{hour_pct:.3f}%;">\n')
    html_out.append(f"""      <col style="width:{tot_pct}%;">
    </colgroup>
    <thead>
      <!-- Riga 1: Nome Giorno Unito -->
      <tr>
        <th class="th-teacher" rowspan="2">{'Teacher' if lang == 'en' else 'Docente'}</th>
""")

    for d in active_days:
        num_cols = len(d["hours"])
        alt_class = "day-band-alt" if d["is_alt"] else "day-band-light"
        html_out.append(f'        <th class="th-day {alt_class} day-boundary" colspan="{num_cols}">{escape(d["nome"])}</th>\n')

    html_out.append(f'        <th class="th-tot" rowspan="2">{"Total H." if lang == "en" else "Ore Tot."}</th>\n      </tr>\n      <!-- Riga 2: Numeri Ore -->\n      <tr>\n')

    for d in active_days:
        for idx_h, h_str in enumerate(d["hours"]):
            is_last_hour = (idx_h == len(d["hours"]) - 1)
            bdr_class = "day-boundary" if is_last_hour else ""
            alt_class = "day-band-alt" if d["is_alt"] else "day-band-light"
            hour_th = f"P{h_str}" if lang == "en" else f"{h_str}ª"
            html_out.append(f'        <th class="th-hour {alt_class} {bdr_class}">{hour_th}</th>\n')

    html_out.append('      </tr>\n    </thead>\n    <tbody>\n')

    # Righe docenti
    for t in sorted_teachers:
        st = teacher_stats.get(t, {})
        tot_lessons = st.get("total_lessons", 0)

        html_out.append(f"""      <tr>
        <td class="td-teacher-name" title="{escape(t)}">{escape(t)}</td>
""")
        for d in active_days:
            d_id = d["id"]
            alt_class = "day-band-alt" if d["is_alt"] else "day-band-light"

            for idx_h, h_str in enumerate(d["hours"]):
                is_last_hour = (idx_h == len(d["hours"]) - 1)
                bdr_class = "day-boundary" if is_last_hour else ""
                slots = by_teacher[t][d_id].get(h_str, [])

                if not slots:
                    html_out.append(f'        <td class="td-lesson-cell {alt_class} {bdr_class}"></td>\n')
                else:
                    item = slots[0]
                    subj = item.get("subject", "")
                    students = item.get("students", [])
                    room = item.get("room", "")
                    has_coteach = len(item.get("teachers", [])) > 1

                    if "disposiz" in subj.lower():
                        custom_desc = (item.get("custom_desc") or "").strip()
                        disp_text = custom_desc if custom_desc else ("OD" if lang == "en" else "D")
                        disp_title = (f"Duty Period: {custom_desc}" if custom_desc else "Duty / On-call Period") if lang == "en" else (f"Ora a Disposizione: {custom_desc}" if custom_desc else "Ora a Disposizione")
                        cell_content = f'<span class="badge-disp" title="{escape(disp_title)}">{escape(disp_text)}</span>'
                    else:
                        classes_str = "/".join(students)
                        coteach_mark = f'<span class="badge-coteach" title="{"Co-teaching" if lang == "en" else "Co-docenza"}">*</span>' if has_coteach else ""
                        if show_rooms and room:
                            room_clean = room.replace("Aula ", "").replace("Lab ", "L.").strip()
                            cell_content = f'<span class="cell-cls" title="{escape(classes_str)} - {escape(room)}">{escape(classes_str)}<small style="font-size:5.5pt;color:#64748b;display:block;">{escape(room_clean)}</small>{coteach_mark}</span>'
                        else:
                            cell_content = f'<span class="cell-cls" title="{escape(classes_str)}">{escape(classes_str)}{coteach_mark}</span>'

                    html_out.append(f'        <td class="td-lesson-cell {alt_class} {bdr_class}">{cell_content}</td>\n')

        html_out.append(f"""        <td class="td-tot">{tot_lessons}</td>
      </tr>
""")

    html_out.append("""    </tbody>
  </table>
</div>

</body>
</html>""")

    return "".join(html_out)


# =====================================================================
# PROCEDURA 12: GENERATORE DOCUMENTO GOOGLE DOCS / WORD (.DOCX A3)
# =====================================================================

def generate_teachers_master_docx(data, options=None):
    """
    Genera il Documento Ufficiale Orario Docenti (Procedura 12) in formato .docx
    compatibile al 100% con Google Documenti (Google Docs) e Microsoft Word.
    - Layout: A3 Orizzontale (Landscape).
    - Margine superiore ridotto al minimo (6mm).
    - Intestazione giorni unita su tutte le colonne orarie (gridSpan).
    - Ripetizione automatica intestazione su ogni pagina (tblHeader).
    - Protezione contro righe spezzate su salti pagina (cantSplit).
    - Bande verticali alternate per giorno.
    - Font ridotto quanto serve così le classi stanno dentro la cella su riga singola.
    - Evidenziazione ore a Disposizione ("D").
    """
    options = options or {}
    validity_date = options.get("validity_date") or get_default_validity_date()
    show_rooms = bool(options.get("show_rooms", False))
    highlight_disp = bool(options.get("highlight_disp", True))
    raw_lang = options.get("lang", "it") if options else "it"
    is_en = str(raw_lang).strip().lower() in ("en", "eng", "english")
    lang = "en" if is_en else "it"

    institution = data.get("institution", 'Liceo & Tecnico "Pico De Paperis" - Paperopoli')
    days = data.get("days", ["Lun", "Mar", "Mer", "Gio", "Ven"])
    hours = [h for h in data.get("hours", []) if not h.startswith("INT")]

    # Calcolo viste docenti
    from webapp.fet_engine import build_timetable_views
    views = build_timetable_views(data)
    by_teacher = views["by_teacher"]
    teacher_stats = views["teacher_stats"]

    sorted_teachers = sorted(list(by_teacher.keys()))

    # Calcolo ore massime per giorno
    active_days = []
    for idx_d, d in enumerate(days):
        max_h = 0
        for t in sorted_teachers:
            for h in hours:
                if by_teacher[t][d].get(h) and h.isdigit():
                    max_h = max(max_h, int(h))
        if max_h > 0:
            active_days.append({
                "id": d,
                "nome": get_day_name(d, lang=lang, full=True),
                "hours": [str(i) for i in range(1, max_h + 1)],
                "is_alt": (idx_d % 2 == 1)
            })

    tot_active_hours = sum(len(d["hours"]) for d in active_days) or 1

    # Dimensionamento colonne A3 Landscape (totale stampabile = 22903 dxa = 404mm)
    total_printable = 22903
    teacher_w = 3200
    tot_w = 800
    hour_w = int((total_printable - teacher_w - tot_w) / tot_active_hours)

    xml_parts = []
    doc_title = f"{institution} — {'Faculty Master Timetable' if lang == 'en' else 'Tabellone Orario Docenti'} ({'Effective from' if lang == 'en' else 'Valido dal'} {validity_date})"
    xml_parts.append(f"""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:jc w:val="left"/>
        <w:spacing w:before="0" w:after="80"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="22"/>
          <w:color w:val="0F172A"/>
        </w:rPr>
        <w:t>{xml_escape(doc_title)}</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="0" w:type="auto"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>
          <w:left w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>
          <w:bottom w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>
          <w:right w:val="single" w:sz="4" w:space="0" w:color="94A3B8"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
        </w:tblBorders>
        <w:tblCellMar>
          <w:top w:w="20" w:type="dxa"/>
          <w:left w:w="25" w:type="dxa"/>
          <w:bottom w:w="20" w:type="dxa"/>
          <w:right w:w="25" w:type="dxa"/>
        </w:tblCellMar>
      </w:tblPr>
""")

    # Grid delle colonne
    xml_parts.append("      <w:tblGrid>\n")
    xml_parts.append(f'        <w:gridCol w:w="{teacher_w}"/>\n')
    for d in active_days:
        for _ in d["hours"]:
            xml_parts.append(f'        <w:gridCol w:w="{hour_w}"/>\n')
    xml_parts.append(f'        <w:gridCol w:w="{tot_w}"/>\n')
    xml_parts.append("      </w:tblGrid>\n")

    # Riga 1 Intestazione (Nomi dei Giorni Uniti con w:gridSpan)
    xml_parts.append("      <w:tr>\n        <w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>\n")
    th_teacher_text = "TEACHER" if lang == "en" else "DOCENTE"
    xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{teacher_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="0F172A"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="15"/></w:rPr><w:t>{th_teacher_text}</w:t></w:r></w:p></w:tc>\n')

    for d in active_days:
        d_span = len(d["hours"])
        d_w = hour_w * d_span
        d_name = xml_escape(d["nome"].upper())
        xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{d_w}" w:type="dxa"/><w:gridSpan w:val="{d_span}"/><w:shd w:val="clear" w:color="auto" w:fill="E2E8F0"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="15"/></w:rPr><w:t>{d_name}</w:t></w:r></w:p></w:tc>\n')

    xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{tot_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="1E293B"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="20" w:after="20"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="FFFFFF"/><w:sz w:val="14"/></w:rPr><w:t>TOT</w:t></w:r></w:p></w:tc>\n')
    xml_parts.append("      </w:tr>\n")

    # Riga 2 Intestazione (Numeri Ore 1ª, 2ª...)
    xml_parts.append("      <w:tr>\n        <w:trPr><w:tblHeader/><w:cantSplit/></w:trPr>\n")
    xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{teacher_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="1E293B"/><w:vAlign w:val="center"/></w:tcPr><w:p/></w:tc>\n')
    for d in active_days:
        h_bg = "F1F5F9" if d["is_alt"] else "FFFFFF"
        for h in d["hours"]:
            hour_th = f"P{h}" if lang == "en" else f"{h}ª"
            xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{hour_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="{h_bg}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="334155"/><w:sz w:val="13"/></w:rPr><w:t>{hour_th}</w:t></w:r></w:p></w:tc>\n')

    th_hours_label = "Hours" if lang == "en" else "Ore"
    xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{tot_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="334155"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:color w:val="FFFFFF"/><w:sz w:val="12"/></w:rPr><w:t>{th_hours_label}</w:t></w:r></w:p></w:tc>\n')
    xml_parts.append("      </w:tr>\n")

    # Righe Docenti
    for t in sorted_teachers:
        st = teacher_stats.get(t, {})
        tot_lessons = st.get("total_lessons", 0)
        xml_parts.append("      <w:tr>\n        <w:trPr><w:cantSplit/><w:trHeight w:val=\"260\" w:hRule=\"atLeast\"/></w:trPr>\n")
        t_name = xml_escape(t)
        xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{teacher_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="left"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="14"/></w:rPr><w:t>{t_name}</w:t></w:r></w:p></w:tc>\n')

        for d in active_days:
            d_id = d["id"]
            col_bg = "F8FAFC" if d["is_alt"] else "FFFFFF"
            for h in d["hours"]:
                slots = by_teacher[t][d_id].get(h, [])
                if not slots:
                    xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{hour_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="{col_bg}"/><w:vAlign w:val="center"/></w:tcPr><w:p/></w:tc>\n')
                else:
                    it = slots[0]
                    subj = it.get("subject", "")
                    students = it.get("students", [])
                    if "disposiz" in subj.lower():
                        custom_desc = (it.get("custom_desc") or "").strip()
                        disp_text = xml_escape(custom_desc if custom_desc else ("OD" if lang == "en" else "D"))
                        xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{hour_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="FEF3C7"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="92400E"/><w:sz w:val="13"/></w:rPr><w:t>{disp_text}</w:t></w:r></w:p></w:tc>\n')
                    else:
                        classes_str = xml_escape("/".join(students))
                        xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{hour_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="{col_bg}"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:color w:val="0F172A"/><w:sz w:val="13"/></w:rPr><w:t>{classes_str}</w:t></w:r></w:p></w:tc>\n')

        xml_parts.append(f'        <w:tc><w:tcPr><w:tcW w:w="{tot_w}" w:type="dxa"/><w:shd w:val="clear" w:color="auto" w:fill="F8FAFC"/><w:vAlign w:val="center"/></w:tcPr><w:p><w:pPr><w:jc w:val="center"/><w:spacing w:before="10" w:after="10"/></w:pPr><w:r><w:rPr><w:b/><w:color w:val="0F172A"/><w:sz w:val="13"/></w:rPr><w:t>{tot_lessons}</w:t></w:r></w:p></w:tc>\n')
        xml_parts.append("      </w:tr>\n")

    xml_parts.append("""    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="23811" w:h="16838" w:orient="landscape"/>
      <w:pgMar w:top="340" w:right="454" w:bottom="454" w:left="454"/>
    </w:sectPr>
  </w:body>
</w:document>""")

    full_xml = "".join(xml_parts)

    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""")
        z.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""")
        z.writestr("word/document.xml", full_xml)

    return buf.getvalue()



# =====================================================================
# API DI METADATI PER OPZIONI MODALI FRONTEND
# =====================================================================

def get_print_options_metadata(data):
    """
    Restituisce i metadati necessari per popolare i modali di stampa
    (lista classi ordinate, docenti, validità predefinita).
    """
    parsed = build_unified_class_timetables(data)
    teachers = sorted([t["name"] for t in data.get("teachers", [])])

    classes_meta = []
    for c in parsed["classes"]:
        is_sub = c in parsed["daughter_to_mother"]
        mother = parsed["daughter_to_mother"].get(c, "")
        classes_meta.append({
            "name": c,
            "is_subgroup": is_sub,
            "mother": mother,
            "is_mother": c in parsed["mothers"]
        })

    return {
        "institution": data.get("institution", 'Liceo & Tecnico "Pico De Paperis" - Paperopoli'),
        "default_validity_date": get_default_validity_date(),
        "classes": classes_meta,
        "teachers": teachers,
        "has_timetable": bool(data.get("timetable"))
    }


# =====================================================================
# MODELLO ORGANICO DOCENTI IN FORMATO WORD (.DOCX)
# =====================================================================

def generate_organico_template_docx(data=None, lang="it"):
    """
    Genera un file Word (.docx) contenente la tabella organico formattata nello standard
    atteso dal parser di SmartTimetable (4 colonne: CdC, Docente, Cattedra/Classi, Ore).
    Può esportare l'organico attuale presente nel database o il template d'esempio.
    Supporta pienamente la localizzazione in lingua (Italiano / Inglese).
    """
    is_en = (lang == "en")
    institution = 'Liceo & Tecnico "Pico De Paperis" - Modello Organico Docenti' if not is_en else 'High School & Technical Institute - Faculty Organico Model'
    teachers_rows = []

    if data and data.get("teachers"):
        institution = data.get("institution", institution)
        # Raggruppa attività per docente
        t_acts = defaultdict(list)
        for a in data.get("activities", []):
            dur = a.get("duration", 1)
            subj = a.get("subject", "")
            studs = a.get("students", [])
            for t in a.get("teachers", []):
                if studs:
                    for s in studs:
                        t_acts[t].append((s, dur, subj))
                else:
                    t_acts[t].append(("", dur, subj))

        for t in sorted(data.get("teachers", []), key=lambda x: (x.get("cdc", ""), x.get("name", ""))):
            tname = t.get("name", "")
            cdc = t.get("cdc", "A000")
            th = t.get("target_hours", 18)

            # Raggruppa ore per classe/materia
            cls_hours = defaultdict(int)
            total_act_hours = 0
            has_explicit_disp = False
            for s, dur, subj in t_acts.get(tname, []):
                cls_hours[(s, subj)] += dur
                total_act_hours += dur
                if (subj or "").lower().startswith("disposiz") or (s or "").upper() == "DISP":
                    has_explicit_disp = True

            # Se il docente ha target_hours > ore insegnamento e non ha ancora l'attività di disposizione esplicita
            if not has_explicit_disp and th > total_act_hours:
                disp_diff = th - total_act_hours
                cls_hours[("", "Disposizione")] += disp_diff

            parts = []
            for (s, subj), h in sorted(cls_hours.items(), key=lambda x: natural_class_sort_key(x[0][0]) if x[0][0] else ("ZZZ", 999, "", str(x[0][1]).upper())):
                if not s:
                    if (subj or "").lower().startswith("disposiz"):
                        parts.append(f"DISP ({h})")
                    elif (subj or "").lower().startswith("potenz"):
                        parts.append(f"POT ({h})")
                    else:
                        parts.append(f"{subj} ({h})".strip())
                else:
                    parts.append(f"{s} ({h}) {subj}".strip())

            classi_str = " - ".join(parts) or t.get("comments", "Cattedra da assegnare")
            teachers_rows.append({
                "cdc": cdc,
                "name": tname,
                "classi": classi_str,
                "hours": str(th)
            })

    if not teachers_rows:
        if is_en:
            teachers_rows = [
                {"cdc": "A012 - Literature & Humanities", "name": "Gastone Paperone", "classi": "1A (4) Literature - 2A (4) Literature - 3A (4) Literature - 4A (3) Literature - 5A (3) Literature", "hours": "18"},
                {"cdc": "A012 - Literature & Humanities", "name": "Paperina", "classi": "1B (4) Literature - 2B (4) Literature - 3B (4) Literature - 4B (3) Literature - 5B (3) Literature", "hours": "18"},
                {"cdc": "A019 - History & Philosophy", "name": "Pico De Paperis", "classi": "1A (2) History - 2A (2) History - 3A (4) Philosophy - 4A (5) Philosophy - 5A (5) Philosophy", "hours": "18"},
                {"cdc": "A026 - Mathematics & Physics", "name": "Dinamite Bla", "classi": "1A (4) Math - 2A (4) Math - 3A (4) Math - 4A (3) Math - 5A (3) Math", "hours": "18"},
                {"cdc": "A026 - Mathematics & Physics", "name": "Archimede Pitagorico", "classi": "1B (4) Math - 2B (4) Math - 3A (3) Physics - 4A (3) Physics - 5A (4) Physics", "hours": "18"},
                {"cdc": "A024 - Foreign Languages (English)", "name": "Battista", "classi": "1A (3) English - 2A (3) English - 3A (3) English - 4A (3) English - 5A (3) English - POT (3)", "hours": "18"},
                {"cdc": "A046 - Law & Economics", "name": "Paperon de' Paperoni", "classi": "1A (3) Law - 2A (3) Law - 3A (4) Economics - 4A (4) Economics - 5A (4) Finance", "hours": "18"},
                {"cdc": "A048 - Physical Education", "name": "Paperino Paolino", "classi": "1A (2) PE - 2A (2) PE - 3A (2) PE - 4A (2) PE - 5A (2) PE - POT (8)", "hours": "18"},
                {"cdc": "A050 - Natural Sciences", "name": "Nonna Papera", "classi": "1A (4) Science - 2A (4) Science - 3A (4) Botany - 4A (3) Biology - 5A (3) Chemistry", "hours": "18"}
            ]
        else:
            # Esempio completo con evidenza di più docenti per la stessa CdC (senza ripetere la CdC)
            teachers_rows = [
                # Gruppo A012: 2 docenti sulla stessa CdC (il secondo docente ha la cella CdC vuota)
                {"cdc": "A012 - Discipline Letterarie", "name": "Gastone Paperone", "classi": "1A (4) Italiano - 2A (4) Italiano - 3A (4) Italiano - 4A (3) Italiano - 5A (3) Italiano", "hours": "18"},
                {"cdc": "A012 - Discipline Letterarie", "name": "Paperina", "classi": "1B (4) Italiano - 2B (4) Italiano - 3B (4) Italiano - 4B (3) Italiano - 5B (3) Italiano", "hours": "18"},
                
                # Gruppo A019: 1 docente
                {"cdc": "A019 - Storia e Filosofia", "name": "Pico De Paperis", "classi": "1A (2) Storia - 2A (2) Storia - 3A (4) Filosofia - 4A (5) Filosofia - 5A (5) Filosofia", "hours": "18"},
                
                # Gruppo A026: 2 docenti sulla stessa CdC (il secondo docente ha la cella CdC vuota)
                {"cdc": "A026 - Matematica e Fisica", "name": "Dinamite Bla", "classi": "1A (4) Matematica - 2A (4) Matematica - 3A (4) Matematica - 4A (3) Matematica - 5A (3) Matematica", "hours": "18"},
                {"cdc": "A026 - Matematica e Fisica", "name": "Archimede Pitagorico", "classi": "1B (4) Matematica - 2B (4) Matematica - 3A (3) Fisica - 4A (3) Fisica - 5A (4) Fisica", "hours": "18"},
                
                # Altri docenti
                {"cdc": "A024 - Lingua Inglese", "name": "Battista", "classi": "1A (3) Inglese - 2A (3) Inglese - 3A (3) Inglese - 4A (3) Inglese - 5A (3) Inglese - POT (3)", "hours": "18"},
                {"cdc": "A046 - Economia e Diritto", "name": "Paperon de' Paperoni", "classi": "1A (3) Diritto - 2A (3) Diritto - 3A (4) Economia - 4A (4) Economia - 5A (4) Finanza", "hours": "18"},
                {"cdc": "A048 - Scienze Motorie", "name": "Paperino Paolino", "classi": "1A (2) Motoria - 2A (2) Motoria - 3A (2) Motoria - 4A (2) Motoria - 5A (2) Motoria - POT (8)", "hours": "18"},
                {"cdc": "A050 - Scienze Naturali", "name": "Nonna Papera", "classi": "1A (4) Scienze - 2A (4) Scienze - 3A (4) Botanica - 4A (3) Biologia - 5A (3) Chimica", "hours": "18"}
            ]

    # Generazione OpenXML A4 Portrait
    doc_header_title = "OFFICIAL FACULTY ORGANICO & TEACHING ASSIGNMENTS MODEL" if is_en else "MODELLO UFFICIALE ORGANICO DOCENTI E ASSEGNAZIONE CATTEDRE"
    doc_instructions = (
        "INSTRUCTIONS: Fill in the table keeping the 4 columns. For multiple teachers belonging to the same Teaching Certificate (CdC), "
        "specify the CdC only on the first row of the group and leave the 'Teaching Certificate' cell EMPTY for subsequent teachers of the same subject area "
        "(as shown in the example for A012 and A026); the system inherits it automatically. In the 'Classes & Teaching Assignments' column, indicate each class "
        "followed by hours in parentheses, separated by hyphens (e.g. 1A (4) Literature - 2A (4) Literature). Enhancement hours POT (hours) and on-call/duty DISP (hours) "
        "are also supported."
    ) if is_en else (
        "ISTRUZIONI: Compilare la tabella rispettando le 4 colonne. Per più docenti appartenenti alla stessa Classe di Concorso (CdC), "
        "indicare la CdC solo sulla prima riga del gruppo e lasciare VUOTA la cella 'Classe di Concorso' per i docenti successivi della stessa cattedra "
        "(come illustrato nell'esempio per A012 e A026); il sistema la eredita automaticamente. Nella colonna 'Classi e Cattedra' indicare ciascuna classe "
        "seguita dalle ore tra parentesi, separate da trattino (es. 1A (4) Italiano - 2A (4) Italiano). Sono supportate anche ore di potenziamento POT (ore) "
        "e a disposizione DISP (ore)."
    )
    th_col_cdc = "Teaching Certificate (CdC)" if is_en else "Classe di Concorso"
    th_col_teacher = "Teacher" if is_en else "Docente"
    th_col_classes = "Classes & Teaching Assignments" if is_en else "Classi e Cattedra"
    th_col_hours = "Hours" if is_en else "Ore"

    xml_parts = []
    xml_parts.append("""<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main">
  <w:body>
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:before="0" w:after="80"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="26"/>
          <w:color w:val="0F172A"/>
        </w:rPr>
        <w:t>""" + xml_escape(institution) + """</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:jc w:val="center"/>
        <w:spacing w:before="0" w:after="240"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:b/>
          <w:sz w:val="22"/>
          <w:color w:val="1E40AF"/>
        </w:rPr>
        <w:t>""" + xml_escape(doc_header_title) + """</w:t>
      </w:r>
    </w:p>
    <w:p>
      <w:pPr>
        <w:jc w:val="left"/>
        <w:spacing w:before="0" w:after="160"/>
      </w:pPr>
      <w:r>
        <w:rPr>
          <w:i/>
          <w:sz w:val="18"/>
          <w:color w:val="475569"/>
        </w:rPr>
        <w:t>""" + xml_escape(doc_instructions) + """</w:t>
      </w:r>
    </w:p>
    <w:tbl>
      <w:tblPr>
        <w:tblW w:w="9600" w:type="dxa"/>
        <w:tblBorders>
          <w:top w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:left w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:bottom w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:right w:val="single" w:sz="6" w:space="0" w:color="94A3B8"/>
          <w:insideH w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
          <w:insideV w:val="single" w:sz="4" w:space="0" w:color="CBD5E1"/>
        </w:tblBorders>
      </w:tblPr>
      <w:tblGrid>
        <w:gridCol w:w="2200"/>
        <w:gridCol w:w="2600"/>
        <w:gridCol w:w="4000"/>
        <w:gridCol w:w="800"/>
      </w:tblGrid>
      <w:tr>
        <w:trPr>
          <w:tblHeader/>
          <w:cantSplit/>
        </w:trPr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2200" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="FFFFFF"/></w:rPr><w:t>""" + xml_escape(th_col_cdc) + """</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2600" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="FFFFFF"/></w:rPr><w:t>""" + xml_escape(th_col_teacher) + """</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4000" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="FFFFFF"/></w:rPr><w:t>""" + xml_escape(th_col_classes) + """</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="800" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="1E3A8A"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="FFFFFF"/></w:rPr><w:t>""" + xml_escape(th_col_hours) + """</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
""")

    curr_cdc = ""
    for r_idx, row in enumerate(teachers_rows):
        is_alt = (r_idx % 2 == 1)
        fill_color = "F8FAFC" if is_alt else "FFFFFF"
        show_cdc = row["cdc"] if row["cdc"] != curr_cdc else ""
        curr_cdc = row["cdc"]

        xml_parts.append(f"""
      <w:tr>
        <w:trPr><w:cantSplit/></w:trPr>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2200" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:b/><w:sz w:val="17"/><w:color w:val="334155"/></w:rPr><w:t>{xml_escape(show_cdc)}</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="2600" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr><w:t>{xml_escape(row['name'])}</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="4000" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/>
          </w:tcPr>
          <w:p><w:r><w:rPr><w:sz w:val="17"/><w:color w:val="1E293B"/></w:rPr><w:t>{xml_escape(row['classi'])}</w:t></w:r></w:p>
        </w:tc>
        <w:tc>
          <w:tcPr>
            <w:tcW w:w="800" w:type="dxa"/>
            <w:shd w:val="clear" w:color="auto" w:fill="{fill_color}"/>
          </w:tcPr>
          <w:p><w:pPr><w:jc w:val="center"/></w:pPr><w:r><w:rPr><w:b/><w:sz w:val="18"/><w:color w:val="0F172A"/></w:rPr><w:t>{xml_escape(row['hours'])}</w:t></w:r></w:p>
        </w:tc>
      </w:tr>
""")

    xml_parts.append("""
    </w:tbl>
    <w:sectPr>
      <w:pgSz w:w="11906" w:h="16838" w:orient="portrait"/>
      <w:pgMar w:top="1134" w:right="1134" w:bottom="1134" w:left="1134" w:header="0" w:footer="0" w:gutter="0"/>
    </w:sectPr>
  </w:body>
</w:document>""")

    full_xml = "".join(xml_parts)
    buf = io.BytesIO()
    with zipfile.ZipFile(buf, "w", compression=zipfile.ZIP_DEFLATED) as z:
        z.writestr("[Content_Types].xml", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>
</Types>""")
        z.writestr("_rels/.rels", """<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>""")
        z.writestr("word/document.xml", full_xml)

    return buf.getvalue()

