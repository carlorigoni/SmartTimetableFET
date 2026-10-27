"""
FET Engine - Parser, Serializer e Generatore di viste orario per FET 7.12.0.
100% Compatibile con il formato XML ufficiale di FET e con i file di configurazione generati dallo script.
"""

import os
import re
import copy
from collections import defaultdict
import xml.etree.ElementTree as ET
from xml.sax.saxutils import escape as xml_escape, unescape as xml_unescape


SOLO_100_CONSTRAINTS = {
    "STUDENTS_MAX_RIENTRI",
    "TEACHERS_MAX_RIENTRI",
    "STUDENTS_MIN_HOURS_DAY",
    "CLASSE_DOCENTE_PRIME_ULTIME",
    "TEACHERS_MAX_GAPS_DAY",
    "TEACHERS_MAX_GAPS_WEEK",
    "TEACHERS_MAX_GAPS_WEEK_DISP",
    "TEACHERS_MAX_GAPS_DAY_DISP",
    "TEACHERS_MAX_GAPS_WEEK_ITIN",
    "TEACHERS_MAX_BUILDING_CHANGES_DAY",
    "TEACHERS_MAX_BUILDING_CHANGES_WEEK",
    "TEACHERS_MIN_GAPS_BUILDING_CHANGES",
    "TEACHERS_MIN_HOURS_DAY",
    "DISPOSIZIONE_MIN_PER_ORA"
}

DEFAULT_CONSTRAINTS = {
    # --- VINCOLI DOCENTI ---
    "TEACHERS_MAX_GAPS_DAY": {
        "active": True,
        "val": 1,
        "weight": 100,
        "name": "Docenti: Max ore buche al giorno",
        "category": "Docenti",
        "desc": "Numero massimo di ore libere tra le lezioni nella stessa giornata per i docenti."
    },
    "TEACHERS_MAX_GAPS_WEEK": {
        "active": True,
        "val": 1,
        "weight": 100,
        "name": "Docenti: Max ore buche a settimana",
        "category": "Docenti",
        "desc": "Numero massimo totale di ore buche settimanali per ciascun docente."
    },
    "TEACHERS_MAX_GAPS_DAY_DISP": {
        "active": False,
        "val": 1,
        "weight": 100,
        "name": "Docenti con D: Max ore buche al giorno",
        "category": "Docenti",
        "desc": "Limite ore buche giornaliere per docenti con ore a disposizione teoriche."
    },
    "TEACHERS_MAX_GAPS_WEEK_DISP": {
        "active": False,
        "val": 4,
        "weight": 100,
        "name": "Docenti con D: Max ore buche a settimana",
        "category": "Docenti",
        "desc": "Limite ore buche settimanali per docenti con ore a disposizione teoriche."
    },
    "TEACHERS_MAX_GAPS_WEEK_ITIN": {
        "active": False,
        "val": 3,
        "weight": 100,
        "name": "Docenti Itineranti: Max ore buche a settimana",
        "category": "Docenti",
        "desc": "Limite ore buche settimanali per docenti con cattedre su più plessi."
    },
    "TEACHERS_MAX_RIENTRI": {
        "active": True,
        "val": 1,
        "weight": 100,
        "name": "Docenti: Max rientri pomeridiani",
        "category": "Docenti",
        "desc": "Massimo numero di pomeriggi (ore 7 e 8) a settimana per docente."
    },
    "TEACHERS_MAX_HOURS_DAY": {
        "active": False,
        "val": 6,
        "weight": 100,
        "name": "Docenti: Max ore di lezione al giorno",
        "category": "Docenti",
        "desc": "Carico massimo giornaliero di ore di insegnamento per ciascun docente."
    },
    "TEACHERS_MIN_HOURS_DAY": {
        "active": False,
        "val": 2,
        "weight": 100,
        "name": "Docenti: Minimo ore al giorno",
        "category": "Docenti",
        "desc": "Minimo ore di servizio nei giorni di presenza a scuola (i giorni liberi restano a 0)."
    },
    "CLASSE_DOCENTE_PRIME_ULTIME": {
        "active": False,
        "val": 50,
        "weight": 100,
        "name": "Stessa classe e docente: Max % prime/ultime ore",
        "category": "Docenti",
        "desc": "Al massimo questa % delle ore settimanali alle prime o ultime ore della classe (es. 50 = metà)."
    },
    "DISPOSIZIONE_MIN_PER_ORA": {
        "active": False,
        "val": 1,
        "weight": 100,
        "name": "Disposizioni: Almeno N docenti per ora",
        "category": "Docenti",
        "desc": "Garantisce una riserva costante di docenti a disposizione per supplenze in ogni slot."
    },

    # --- VINCOLI CLASSI ---
    "STUDENTS_MAX_GAPS_DAY": {
        "active": True,
        "val": 0,
        "weight": 100,
        "name": "Classi: Max ore buche al giorno",
        "category": "Classi",
        "desc": "Le classi non devono avere ore buche tra le lezioni: orario compatto continuo."
    },
    "STUDENTS_MAX_GAPS_WEEK": {
        "active": True,
        "val": 0,
        "weight": 100,
        "name": "Classi: Max ore buche a settimana",
        "category": "Classi",
        "desc": "Nessuna ora buca nell'intera settimana scolastica per gli studenti."
    },
    "STUDENTS_MAX_RIENTRI": {
        "active": True,
        "val": 1,
        "weight": 100,
        "name": "Classi: Max rientri pomeridiani",
        "category": "Classi",
        "desc": "Massimo numero di pomeriggi (ore 7 e 8) a settimana per classe."
    },
    "STUDENTS_EARLY_BEGIN": {
        "active": True,
        "val": 0,
        "weight": 100,
        "name": "Classi: Ingressi alla 2ª ora",
        "category": "Classi",
        "desc": "0 = Tutte le classi entrano sempre alla 1ª ora della mattina (nessun ingresso tardivo)."
    },
    "STUDENTS_MAX_HOURS_DAY": {
        "active": False,
        "val": 7,
        "weight": 100,
        "name": "Classi: Max ore al giorno",
        "category": "Classi",
        "desc": "Limite assoluto al monte ore giornaliero per le classi."
    },
    "STUDENTS_MIN_HOURS_DAY": {
        "active": False,
        "val": 6,
        "weight": 100,
        "name": "Classi: Minimo ore al giorno",
        "category": "Classi",
        "desc": "Es. 6 = nessuna classe esce prima della 6ª ora (si adatta per classi con meno ore)."
    },

    # --- VINCOLI SPOSTAMENTI & PLESSI ---
    "TEACHERS_MAX_BUILDING_CHANGES_DAY": {
        "active": False,
        "val": 1,
        "weight": 100,
        "name": "Docenti: Max cambi plesso al giorno",
        "category": "Spostamenti",
        "desc": "Massimo numero di spostamenti tra Centrale e Succursale nello stesso giorno."
    },
    "TEACHERS_MIN_GAPS_BUILDING_CHANGES": {
        "active": True,
        "val": 1,
        "weight": 100,
        "name": "Docenti: Ore libere per cambio plesso",
        "category": "Spostamenti",
        "desc": "Almeno 1 ora libera tra due lezioni in plessi diversi per consentire lo spostamento."
    },
    "TEACHERS_MAX_BUILDING_CHANGES_WEEK": {
        "active": False,
        "val": 3,
        "weight": 100,
        "name": "Docenti: Max cambi plesso a settimana",
        "category": "Spostamenti",
        "desc": "Massimo numero complessivo di spostamenti tra plessi nell'arco della settimana."
    }
}

DEFAULT_PARAMETERS = {
    "Nome istituto": 'Liceo Classico e Scientifico Statale "Scuola di Atene"',
    "Commenti": "Orario configurato con Eurario Suite FET",
    "Nome file .fet": "ParametriOrario",
    "Versione FET dichiarata": "7.12.0",
    "Crea aula per classi senza aula (SI/NO)": "SI",
    "Peso aula classe %": 100,
    "Nomi ore in FET con orario (SI/NO)": "SI",
    "Le classi non cambiano plesso durante la giornata (SI/NO)": "SI",
    "Aule di appoggio automatiche (SI/NO)": "SI",
    "Intervalli come righe dell'orario FET (SI/NO)": "SI",
    "Min ore/giorno docenti: conta anche le ore a disposizione (SI/NO)": "NO",
    "Ore cattedra completa": 18,
    "Cattedra completa: giorni minimi di presenza": 5,
    "Aule libere di riserva in ogni ora (Centrale)": 0,
    "Docenti: ore preferite nel giorno (PRIME/ULTIME/INDIFFERENTE)": "INDIFFERENTE",
    "Docenti: distribuzione nella settimana (COMPATTA/INDIFFERENTE)": "INDIFFERENTE",
    "Peso delle preferenze dei docenti %": 60,
    "Docenti 'con D' per i limiti di ore buche: almeno N ore a disposizione": 3,
    "Ore a disposizione: tutte dopo FET (SI/NO)": "NO",
    "Peso delle preferenze delle materie %": 70
}

PARAM_HELP = {
    "Nome istituto": "Nome della scuola: compare nell'intestazione delle stampe di FET.",
    "Commenti": "Testo libero salvato nel file .fet (visibile in FET, Dati > Informazioni istituto).",
    "Nome file .fet": "Nome base del file esportato per FET CLI.",
    "Versione FET dichiarata": "Numero di versione scritto nel file (7.12.0 evita il messaggio di conversione all'apertura).",
    "Crea aula per classi senza aula (SI/NO)": "SI: per ogni classe senza aula crea 'Aula <classe>' nel suo plesso, fondamentale per i vincoli di plesso.",
    "Peso aula classe %": "Percentuale di rigidità (100 = sempre) affinché la classe svolga le lezioni nella sua aula base.",
    "Le classi non cambiano plesso durante la giornata (SI/NO)": "SI: le classi restano nello stesso plesso tutto il giorno; si spostano solo i docenti.",
    "Intervalli come righe dell'orario FET (SI/NO)": "SI: gli intervalli sono righe dell'orario FET (pausa per tutti) evitando che i blocchi scavalchino la ricreazione.",
    "Min ore/giorno docenti: conta anche le ore a disposizione (SI/NO)": "NO: contano solo le ore di lezione per raggiungere il minimo giornaliero.",
    "Ore cattedra completa": "Numero di ore oltre il quale un docente è considerato a cattedra completa (default 18).",
    "Cattedra completa: giorni minimi di presenza": "Giorni minimi a scuola per i docenti a cattedra completa (default 5).",
    "Aule libere di riserva in ogni ora (Centrale)": "Numero di aule della Centrale lasciate libere in ogni ora per emergenze o supplenze.",
    "Docenti: ore preferite nel giorno (PRIME/ULTIME/INDIFFERENTE)": "Preferenza globale docenti per collocare lezioni nelle prime o ultime ore.",
    "Docenti: distribuzione nella settimana (COMPATTA/INDIFFERENTE)": "COMPATTA: concentra le ore in giorni consecutivi (utile per spezzoni).",
    "Peso delle preferenze dei docenti %": "Grado di rispetto delle preferenze docenti da parte del solutore FET (default 60%).",
    "Docenti 'con D' per i limiti di ore buche: almeno N ore a disposizione": "Soglia minima di ore a disposizione per attivare i limiti più ampi di ore buche (default 3).",
    "Ore a disposizione: tutte dopo FET (SI/NO)": "SI: le ore a disposizione vengono collocate dopo la risoluzione delle lezioni.",
    "Peso delle preferenze delle materie %": "Grado di rispetto delle ore preferite per le materie (default 70%).",
    "Aule di appoggio automatiche (SI/NO)": "SI: consente a classi in trasferta di utilizzare aule libere dell'altro plesso come appoggio.",
    "Nomi ore in FET con orario (SI/NO)": "SI: include l'orario di inizio e fine nelle etichette orarie delle lezioni."
}

DEFAULT_DAY_HOURS = {
    "Lun": 6,
    "Mar": 8,
    "Mer": 6,
    "Gio": 6,
    "Ven": 8,
    "Sab": 0
}


def clean_text(s):
    if s is None:
        return ""
    return str(s).strip()


def natural_class_sort_key(name):
    """
    Ordinamento per classi scolastiche per sezione / anno di corso:
    Tutte le classi della sezione A (1A, 2A, 3A, 4A, 5A), poi sezione B (2B...), poi C (1C, 2C... 5C), D, ecc.
    Gestisce classi semplici ('1A'), gruppi ('4A FRA', '3AM') e unioni ('1C+1D').
    """
    s = str(name).strip()
    if not s or s.startswith("["):
        return ("ZZZ", 999, "", s.upper())
    first = s.split("+")[0].strip()
    m = re.match(r"^(\d+)\s*([A-Za-z])(.*)$", first)
    if m:
        try:
            yr = int(m.group(1))
            sec = m.group(2).upper()
            sub = m.group(3).strip().upper()
            return (sec, yr, sub, s.upper())
        except ValueError:
            pass
    return ("ZZZ", 999, "", s.upper())


def get_grouped_activities(activities):
    """
    Raggruppa le sotto-attività frammentate FET in Cattedre/Insegnamenti aggregate.
    Esempio: 3 sotto-attività da 1h per Maretto in 1F diventano 1 riga:
    - Docente: Maretto Anna
    - Classe: 1F
    - Materia: Lingua e Cultura Straniera (Spagnolo)
    - Ore/Settimana: 3 h
    - Blocchi: 1+1+1
    - Sotto-attività FET: #461, #462, #463
    """
    groups = defaultdict(list)
    for a in activities:
        subj = (a.get("subject") or "").strip()
        # Esclude la voce 'Disposizione' dalle cattedre didattiche
        if subj.lower().startswith("disposiz"):
            continue
        teachers_key = "+".join(sorted(a.get("teachers", []))) or "[Nessun docente]"
        students_key = "+".join(sorted(a.get("students", []))) or "[Nessuna classe]"
        subject_name = subj or "[Nessuna materia]"
        key = (students_key, teachers_key, subject_name)
        groups[key].append(a)

    result = []
    for (st_key, tc_key, subj), act_list in groups.items():
        total_hours = sum(a.get("duration", 1) for a in act_list)
        blocks = "+".join(str(a.get("duration", 1)) for a in act_list)
        sub_ids = [str(a.get("id")) for a in act_list]
        is_active = any(a.get("active", True) for a in act_list)
        seen_parts = set()
        clean_parts = []
        for a in act_list:
            c = (a.get("comments") or "").strip()
            if not c:
                continue
            for part in c.split("|"):
                part_clean = part.strip()
                if part_clean and part_clean not in seen_parts:
                    seen_parts.add(part_clean)
                    clean_parts.append(part_clean)
        # Esclude etichette interne grezze 'Riga \d+' (numero riga dell'organico excel originario)
        real_parts = [p for p in clean_parts if not re.match(r"^riga\s+\d+$", p, re.IGNORECASE)]
        comments = " | ".join(real_parts)
        rooms = sorted(list(set(a.get("room") for a in act_list if a.get("room"))))
        rooms_display = ", ".join(rooms) if rooms else ""

        result.append({
            "id": f"grp_{sub_ids[0]}",
            "students": st_key.split("+") if st_key != "[Nessuna classe]" else [],
            "students_display": st_key,
            "teachers": tc_key.split("+") if tc_key != "[Nessun docente]" else [],
            "teachers_display": tc_key,
            "subject": subj,
            "total_hours": total_hours,
            "blocks": blocks,
            "rooms": rooms,
            "rooms_display": rooms_display,
            "sub_activity_ids": sub_ids,
            "active": is_active,
            "comments": comments,
            "count": len(act_list)
        })

    # Ordina per classe (Sezione/Anno: 1A, 2A, 3A... 5A, 1B...), poi per materia, poi per docente
    result.sort(key=lambda x: (
        natural_class_sort_key(x["students_display"]),
        x["subject"],
        x["teachers_display"]
    ))
    return result


def parse_fet_xml(content_or_path):
    """
    Effettua il parsing completo di un file .fet (sia input di parametri che output risolto).
    Ritorna un dizionario con tutte le entità, i vincoli e le assegnazioni orarie.
    """
    if os.path.exists(content_or_path) and os.path.isfile(content_or_path):
        tree = ET.parse(content_or_path)
        root = tree.getroot()
    else:
        root = ET.fromstring(content_or_path)

    data = {
        "institution": clean_text(root.findtext("Institution_Name", "")),
        "comments": clean_text(root.findtext("Comments", "")),
        "days": [],
        "hours": [],
        "teachers": [],
        "subjects": [],
        "activity_tags": [],
        "buildings": [],
        "rooms": [],
        "classes": [],
        "groups": [],
        "activities": [],
        "break_times": [],
        "constraints": copy.deepcopy(DEFAULT_CONSTRAINTS),
        "day_hours_limit": copy.deepcopy(DEFAULT_DAY_HOURS),
        "teacher_availability": {},
        "class_availability": {},
        "extra_time_constraints": [],
        "extra_space_constraints": [],
        "timetable": {},      # act_id -> { day, hour, room }
        "has_timetable": False
    }

    # Giorni
    for d in root.findall(".//Days_List/Day"):
        name = clean_text(d.findtext("Name"))
        if name:
            data["days"].append(name)

    # Ore
    for h in root.findall(".//Hours_List/Hour"):
        name = clean_text(h.findtext("Name"))
        if name:
            data["hours"].append(name)

    # Docenti
    for t in root.findall(".//Teachers_List/Teacher"):
        name = clean_text(t.findtext("Name"))
        if name:
            raw_comm = clean_text(t.findtext("Comments", ""))
            target_h = 18
            custom_disp = None
            if raw_comm:
                m_th = re.search(r"target_hours:(\d+)", raw_comm)
                if m_th:
                    target_h = int(m_th.group(1))
                m_cd = re.search(r"custom_disp:(\d+)", raw_comm)
                if m_cd:
                    custom_disp = int(m_cd.group(1))
            t_data = {
                "name": name,
                "comments": raw_comm,
                "target_hours": target_h
            }
            if custom_disp is not None:
                t_data["custom_disp_hours"] = custom_disp
            data["teachers"].append(t_data)

    # Materie
    for s in root.findall(".//Subjects_List/Subject"):
        name = clean_text(s.findtext("Name"))
        if name:
            data["subjects"].append({
                "name": name,
                "comments": clean_text(s.findtext("Comments", ""))
            })

    # Activity Tags
    for at in root.findall(".//Activity_Tags_List/Activity_Tag"):
        name = clean_text(at.findtext("Name"))
        if name and name not in data["activity_tags"]:
            data["activity_tags"].append(name)

    # Plessi
    for b in root.findall(".//Buildings_List/Building"):
        name = clean_text(b.findtext("Name"))
        if name:
            data["buildings"].append(name)

    # Aule
    for r in root.findall(".//Rooms_List/Room"):
        name = clean_text(r.findtext("Name"))
        if name:
            if name.lower().startswith("palestra"):
                if not any(x.get("name", "").lower() == "palestra" for x in data["rooms"]):
                    data["rooms"].append({
                        "name": "Palestra",
                        "building": clean_text(r.findtext("Building", "")) or "Centrale",
                        "capacity": 57,
                        "room_type": "gym",
                        "max_concurrent": 3,
                        "comments": "Impianto sportivo Sede Centrale - Capienza max 57 persone (2 o 3 classi contemporanee)"
                    })
                continue
            data["rooms"].append({
                "name": name,
                "building": clean_text(r.findtext("Building", "")),
                "capacity": int(clean_text(r.findtext("Capacity", "30")) or 30),
                "comments": clean_text(r.findtext("Comments", ""))
            })

    # Classi e Gruppi
    for y in root.findall(".//Students_List/Year"):
        c_name = clean_text(y.findtext("Name"))
        if c_name:
            stud_cnt = int(clean_text(y.findtext("Number_of_Students", "0")) or 0)
            data["classes"].append({
                "name": c_name,
                "students": stud_cnt,
                "comments": clean_text(y.findtext("Comments", ""))
            })

            for g in y.findall("Group"):
                g_name = clean_text(g.findtext("Name"))
                if g_name:
                    g_stud = int(clean_text(g.findtext("Number_of_Students", "0")) or 0)
                    data["groups"].append({
                        "name": g_name,
                        "class_name": c_name,
                        "students": g_stud
                    })

    # Attività
    for a in root.findall(".//Activities_List/Activity"):
        aid = clean_text(a.findtext("Id"))
        if aid:
            t_list = [clean_text(t.text) for t in a.findall("Teacher") if clean_text(t.text)]
            s_list = [clean_text(s.text) for s in a.findall("Students") if clean_text(s.text)]
            subj = clean_text(a.findtext("Subject", ""))
            dur = int(clean_text(a.findtext("Duration", "1")) or 1)
            tot_dur = int(clean_text(a.findtext("Total_Duration", str(dur))) or dur)
            group_id = clean_text(a.findtext("Activity_Group_Id", aid)) or aid
            act_tag = clean_text(a.findtext("Activity_Tag", ""))
            active = clean_text(a.findtext("Active", "true")).lower() == "true"
            comments = clean_text(a.findtext("Comments", ""))

            data["activities"].append({
                "id": aid,
                "teachers": t_list,
                "students": s_list,
                "subject": subj,
                "duration": dur,
                "total_duration": tot_dur,
                "group_id": group_id,
                "activity_tag": act_tag,
                "active": active,
                "comments": comments
            })

    # Pause Istituto e Intervalli (ConstraintBreakTimes)
    for bt in root.findall(".//Time_Constraints_List/ConstraintBreakTimes/Break_Time"):
        sd = clean_text(bt.findtext("Day"))
        sh = clean_text(bt.findtext("Hour"))
        if sd and sh:
            slot_key = f"{sd}|{sh}"
            if slot_key not in data["break_times"]:
                data["break_times"].append(slot_key)

    # Indisponibilità Docenti (ConstraintTeacherNotAvailableTimes)
    for c in root.findall(".//Time_Constraints_List/ConstraintTeacherNotAvailableTimes"):
        t_name = clean_text(c.findtext("Teacher"))
        if t_name:
            if t_name not in data["teacher_availability"]:
                data["teacher_availability"][t_name] = []
            for slot in c.findall("Not_Available_Time"):
                sd = clean_text(slot.findtext("Day"))
                sh = clean_text(slot.findtext("Hour"))
                if sd and sh:
                    slot_key = f"{sd}|{sh}"
                    if slot_key not in data["teacher_availability"][t_name]:
                        data["teacher_availability"][t_name].append(slot_key)

    # Indisponibilità Classi (ConstraintStudentsSetNotAvailableTimes)
    for c in root.findall(".//Time_Constraints_List/ConstraintStudentsSetNotAvailableTimes"):
        c_name = clean_text(c.findtext("Students"))
        if c_name:
            if c_name not in data["class_availability"]:
                data["class_availability"][c_name] = []
            for slot in c.findall("Not_Available_Time"):
                sd = clean_text(slot.findtext("Day"))
                sh = clean_text(slot.findtext("Hour"))
                if sd and sh:
                    slot_key = f"{sd}|{sh}"
                    if slot_key not in data["class_availability"][c_name]:
                        data["class_availability"][c_name].append(slot_key)

    # Vincoli di Tempo Istituzionali
    t_cons = root.find(".//Time_Constraints_List")
    if t_cons is not None:
        c_stud_gap_day = t_cons.find("ConstraintStudentsMaxGapsPerDay")
        if c_stud_gap_day is not None:
            data["constraints"]["STUDENTS_MAX_GAPS_DAY"]["val"] = int(clean_text(c_stud_gap_day.findtext("Max_Gaps", "0")) or 0)
            data["constraints"]["STUDENTS_MAX_GAPS_DAY"]["active"] = clean_text(c_stud_gap_day.findtext("Active", "true")).lower() == "true"

        c_stud_gap_week = t_cons.find("ConstraintStudentsMaxGapsPerWeek")
        if c_stud_gap_week is not None:
            data["constraints"]["STUDENTS_MAX_GAPS_WEEK"]["val"] = int(clean_text(c_stud_gap_week.findtext("Max_Gaps", "0")) or 0)
            data["constraints"]["STUDENTS_MAX_GAPS_WEEK"]["active"] = clean_text(c_stud_gap_week.findtext("Active", "true")).lower() == "true"

        c_early = t_cons.find("ConstraintStudentsEarlyMaxBeginningsAtSecondHour")
        if c_early is not None:
            data["constraints"]["STUDENTS_EARLY_BEGIN"]["val"] = int(clean_text(c_early.findtext("Max_Beginnings_At_Second_Hour", "0")) or 0)
            data["constraints"]["STUDENTS_EARLY_BEGIN"]["active"] = clean_text(c_early.findtext("Active", "true")).lower() == "true"

        c_t_hours = t_cons.find("ConstraintTeachersMaxHoursDaily")
        if c_t_hours is not None:
            data["constraints"]["TEACHERS_MAX_HOURS_DAY"]["val"] = int(clean_text(c_t_hours.findtext("Maximum_Hours_Daily", "6")) or 6)
            data["constraints"]["TEACHERS_MAX_HOURS_DAY"]["active"] = clean_text(c_t_hours.findtext("Active", "true")).lower() == "true"

        # Campione per docenti gaps
        c_t_gap_day = t_cons.find("ConstraintTeacherMaxGapsPerDay")
        if c_t_gap_day is not None:
            data["constraints"]["TEACHERS_MAX_GAPS_DAY"]["val"] = int(clean_text(c_t_gap_day.findtext("Max_Gaps", "1")) or 1)

        c_t_gap_week = t_cons.find("ConstraintTeacherMaxGapsPerWeek")
        if c_t_gap_week is not None:
            data["constraints"]["TEACHERS_MAX_GAPS_WEEK"]["val"] = int(clean_text(c_t_gap_week.findtext("Max_Gaps", "1")) or 1)

        # Cattura vincoli temporali avanzati non mappati direttamente su slider
        known_time_tags = {
            "ConstraintBasicCompulsoryTime",
            "ConstraintBreakTimes",
            "ConstraintTeacherNotAvailableTimes",
            "ConstraintStudentsSetNotAvailableTimes",
            "ConstraintTeacherMaxGapsPerDay",
            "ConstraintTeacherMaxGapsPerWeek",
            "ConstraintStudentsMaxGapsPerDay",
            "ConstraintStudentsMaxGapsPerWeek",
            "ConstraintStudentsEarlyMaxBeginningsAtSecondHour",
            "ConstraintTeachersMaxHoursDaily",
            "ConstraintActivityPreferredStartingTime"
        }
        for elem in t_cons:
            if elem.tag not in known_time_tags:
                data["extra_time_constraints"].append({
                    "tag": elem.tag,
                    "xml": ET.tostring(elem, encoding="utf-8").decode("utf-8").strip()
                })

    # Vincoli di Spazio Istituzionali
    s_cons = root.find(".//Space_Constraints_List")
    if s_cons is not None:
        c_bld_day = s_cons.find("ConstraintTeachersMaxBuildingChangesPerDay")
        if c_bld_day is not None:
            data["constraints"]["TEACHERS_MAX_BUILDING_CHANGES_DAY"]["val"] = int(clean_text(c_bld_day.findtext("Max_Building_Changes", "1")) or 1)
            data["constraints"]["TEACHERS_MAX_BUILDING_CHANGES_DAY"]["active"] = clean_text(c_bld_day.findtext("Active", "true")).lower() == "true"

        c_bld_gap = s_cons.find("ConstraintTeachersMinGapsBetweenBuildingChanges")
        if c_bld_gap is not None:
            data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["val"] = int(clean_text(c_bld_gap.findtext("Min_Gaps", "1")) or 1)
            data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["active"] = clean_text(c_bld_gap.findtext("Active", "true")).lower() == "true"

        c_bld_week = s_cons.find("ConstraintTeachersMaxBuildingChangesPerWeek")
        if c_bld_week is not None:
            data["constraints"]["TEACHERS_MAX_BUILDING_CHANGES_WEEK"]["val"] = int(clean_text(c_bld_week.findtext("Max_Building_Changes", "3")) or 3)
            data["constraints"]["TEACHERS_MAX_BUILDING_CHANGES_WEEK"]["active"] = clean_text(c_bld_week.findtext("Active", "true")).lower() == "true"

        known_space_tags = {
            "ConstraintBasicCompulsorySpace",
            "ConstraintTeachersMaxBuildingChangesPerDay",
            "ConstraintTeachersMinGapsBetweenBuildingChanges",
            "ConstraintTeachersMaxBuildingChangesPerWeek",
            "ConstraintActivityPreferredRoom"
        }
        for elem in s_cons:
            if elem.tag not in known_space_tags:
                data["extra_space_constraints"].append({
                    "tag": elem.tag,
                    "xml": ET.tostring(elem, encoding="utf-8").decode("utf-8").strip()
                })

    # Assegnazioni Orarie Risolte (ConstraintActivityPreferredStartingTime & Room)
    for c in root.findall(".//Time_Constraints_List/ConstraintActivityPreferredStartingTime"):
        aid = clean_text(c.findtext("Activity_Id"))
        p_day = clean_text(c.findtext("Preferred_Day") or c.findtext("Day"))
        p_hour = clean_text(c.findtext("Preferred_Hour") or c.findtext("Hour"))
        if aid and p_day and p_hour:
            if aid not in data["timetable"]:
                data["timetable"][aid] = {}
            data["timetable"][aid]["day"] = p_day
            data["timetable"][aid]["hour"] = p_hour
            data["has_timetable"] = True

    for c in root.findall(".//Space_Constraints_List/ConstraintActivityPreferredRoom"):
        aid = clean_text(c.findtext("Activity_Id"))
        room = clean_text(c.findtext("Room"))
        if aid and room:
            if aid not in data["timetable"]:
                data["timetable"][aid] = {}
            data["timetable"][aid]["room"] = "Palestra" if room.lower().startswith("palestra") else room

    return data


def build_timetable_views(data):
    """
    Costruisce le matrici dell'orario per Docente, Classe e Aula.
    Calcola anche la statistica delle ore buche e dei cambi di plesso.
    """
    acts_map = {str(a["id"]): a for a in data.get("activities", [])}
    timetable = data.get("timetable", {})
    days = data.get("days", [])
    hours = data.get("hours", [])
    rooms_map = {r["name"]: r.get("building", "") for r in data.get("rooms", [])}
    teacher_aliases = {t["name"]: t.get("short_name", t["name"]) for t in data.get("teachers", [])}
    locked_set = set(str(x) for x in data.get("locked_activities", []))

    # Strutture vuote
    by_teacher = {t["name"]: {d: {h: [] for h in hours} for d in days} for t in data.get("teachers", [])}
    by_class = {c["name"]: {d: {h: [] for h in hours} for d in days} for c in data.get("classes", [])}
    by_room = {r["name"]: {d: {h: [] for h in hours} for d in days} for r in data.get("rooms", [])}

    # Popolamento
    for aid, placement in timetable.items():
        is_companion = False
        act = acts_map.get(str(aid))
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

        is_disp = (act.get("subject") or "").strip().lower().startswith("disposiz")
        item = {
            "activity_id": aid,
            "subject": act.get("subject", ""),
            "custom_desc": act.get("custom_desc", ""),
            "is_disposizione": is_disp,
            "teachers": act.get("teachers", []),
            "teachers_short": [teacher_aliases.get(tn, tn) for tn in act.get("teachers", [])],
            "students": act.get("students", []),
            "room": room,
            "building": rooms_map.get(room, ""),
            "duration": act.get("duration", 1),
            "locked": str(aid) in locked_set
        }

        # Determinazione delle ore occupate (espansione per durata > 1)
        if (act.get("subject") or "").strip().lower().startswith("disposiz"):
            dur = 1
        else:
            dur = 2 if (act.get("duration") == 3 and not is_companion) else act.get("duration", 1)
        num_hours = [h for h in hours if not h.startswith("INT")]
        occupied_slot_hours = [p_hour]
        if dur > 1 and p_hour in num_hours:
            p_idx = num_hours.index(p_hour)
            occupied_slot_hours = num_hours[p_idx : p_idx + dur]

        for h_slot in occupied_slot_hours:
            if h_slot not in hours:
                continue
            # Vista Docente
            for t in act.get("teachers", []):
                if t in by_teacher:
                    by_teacher[t][p_day][h_slot].append(item)

            # Vista Classe
            for s in act.get("students", []):
                if s in by_class:
                    by_class[s][p_day][h_slot].append(item)

            # Vista Aula
            if room and room in by_room:
                by_room[room][p_day][h_slot].append(item)

    # Calcolo Statistiche Ore Buche e Trasferimenti Plessi per i Docenti
    teacher_stats = {}
    for t in data.get("teachers", []):
        tname = t["name"]
        total_lessons = 0
        teaching_lessons = 0
        disp_lessons = 0
        total_gaps = 0
        total_transfers = 0
        gaps_by_day = {}
        transfers_by_day = {}

        for d in days:
            occupied_hours = []
            buildings_seq = []
            for h in hours:
                slots = by_teacher[tname][d][h]
                if slots:
                    occupied_hours.append(h)
                    bld = slots[0].get("building", "")
                    if bld:
                        buildings_seq.append(bld)
                    for item in slots:
                        subj_s = (item.get("subject") or "").strip().lower()
                        comments_s = (item.get("comments") or "").strip()
                        if subj_s.startswith("disposiz") or comments_s.startswith("FET_DISPOSIZIONE"):
                            disp_lessons += 1
                        else:
                            teaching_lessons += 1

            # Conteggio ore buche
            if len(occupied_hours) >= 2:
                idx_first = hours.index(occupied_hours[0])
                idx_last = hours.index(occupied_hours[-1])
                day_gaps = 0
                for i in range(idx_first, idx_last + 1):
                    h_curr = hours[i]
                    if not by_teacher[tname][d][h_curr] and not h_curr.startswith("INT"):
                        day_gaps += 1
                total_gaps += day_gaps
                gaps_by_day[d] = day_gaps
            else:
                gaps_by_day[d] = 0

            # Conteggio cambi plesso
            day_transfers = 0
            for i in range(1, len(buildings_seq)):
                if buildings_seq[i] != buildings_seq[i - 1]:
                    day_transfers += 1
            total_transfers += day_transfers
            transfers_by_day[d] = day_transfers
            total_lessons += len(occupied_hours)

        target_h = t.get("target_hours", 18)
        custom_disp_h = t.get("custom_disp_hours")
        teacher_stats[tname] = {
            "total_lessons": total_lessons,
            "teaching_lessons": teaching_lessons,
            "disp_lessons": disp_lessons,
            "target_hours": target_h,
            "custom_disp_hours": custom_disp_h,
            "total_gaps": total_gaps,
            "gaps_by_day": gaps_by_day,
            "total_transfers": total_transfers,
            "transfers_by_day": transfers_by_day
        }

    return {
        "has_timetable": bool(timetable),
        "total_placed": len(timetable),
        "days": days,
        "hours": hours,
        "by_teacher": by_teacher,
        "by_class": by_class,
        "by_room": by_room,
        "teacher_stats": teacher_stats,
        "locked_count": len(locked_set & set(timetable.keys()))
    }


def generate_fet_xml(data, include_timetable=False, exclude_disposizioni=True):
    """
    Genera un file .fet XML valido al 100% per FET 7.12.0 a partire dal dizionario interno.
    Include tutti i vincoli orari istituzionali, le pause e le disponibilità configurate.
    Garantisce il rispetto rigoroso dell'ordine sequenziale dei tag richiesto dal parser C++ di FET.
    Se include_timetable=False, non blocca l'orario precedente consentendo a FET di generare un nuovo orario da zero.
    Se exclude_disposizioni=True, esclude le ore a disposizione dal calcolo FET: verranno collocate
    post-calcolo per coprire i buchi e all'inizio della giornata.
    """
    lines = ['<?xml version="1.0" encoding="UTF-8"?>', '<fet version="7.10.5">']
    lines.append(f'  <Institution_Name>{xml_escape(data.get("institution", "Istituto Scolastico"))}</Institution_Name>')
    lines.append(f'  <Comments>{xml_escape(data.get("comments", "Generato da Eurario Web"))}</Comments>')

    # 1. Giorni (esporta solo i giorni con ore di lezione > 0; se un giorno come Sabato è configurato a 0h resta nella webapp ma non inserito nel calendario attivo FET per evitare contraddizioni logiche)
    day_limits = data.get("day_hours_limit", {})
    active_days = [d for d in data.get("days", []) if day_limits.get(d, 6) > 0]
    if not active_days:
        active_days = data.get("days", [])

    # Attività didattiche effettivamente esportate nel file FET (esclude ore a disposizione se richiesto)
    emitted_activities = [
        a for a in data.get("activities", [])
        if not (exclude_disposizioni and (a.get("subject") or "").strip().lower().startswith("disposiz"))
    ]
    emitted_act_ids = {str(a["id"]) for a in emitted_activities}

    lines.append('  <Days_List>')
    lines.append(f'    <Number_of_Days>{len(active_days)}</Number_of_Days>')
    for d in active_days:
        lines.append('    <Day>')
        lines.append(f'      <Name>{xml_escape(d)}</Name>')
        lines.append('    </Day>')
    lines.append('  </Days_List>')

    # 2. Ore
    lines.append('  <Hours_List>')
    lines.append(f'    <Number_of_Hours>{len(data.get("hours", []))}</Number_of_Hours>')
    for h in data.get("hours", []):
        lines.append('    <Hour>')
        lines.append(f'      <Name>{xml_escape(h)}</Name>')
        lines.append('    </Hour>')
    lines.append('  </Hours_List>')

    # 3. Materie (include sia materie definite che eventuali materie presenti nelle attività)
    known_subjects = {}
    for s in data.get("subjects", []):
        if s.get("name"):
            s_name = s["name"].strip()
            if exclude_disposizioni and s_name.lower().startswith("disposiz"):
                continue
            known_subjects[s_name] = s.get("comments", "")
    for a in data.get("activities", []):
        s_act = a.get("subject", "").strip()
        if exclude_disposizioni and s_act.lower().startswith("disposiz"):
            continue
        if s_act and s_act not in known_subjects:
            known_subjects[s_act] = ""

    lines.append('  <Subjects_List>')
    for s_name, s_comm in sorted(known_subjects.items(), key=lambda x: x[0].lower()):
        lines.append('    <Subject>')
        lines.append(f'      <Name>{xml_escape(s_name)}</Name>')
        if s_comm:
            lines.append(f'      <Comments>{xml_escape(s_comm)}</Comments>')
        lines.append('    </Subject>')
    lines.append('  </Subjects_List>')

    # 4. Activity Tags
    lines.append('  <Activity_Tags_List>')
    for at in data.get("activity_tags", []):
        lines.append('    <Activity_Tag>')
        lines.append(f'      <Name>{xml_escape(at)}</Name>')
        lines.append('      <Printable>false</Printable>')
        lines.append('      <Comments></Comments>')
        lines.append('    </Activity_Tag>')
    lines.append('  </Activity_Tags_List>')

    # 5. Docenti (include sia docenti definiti che eventuali docenti presenti nelle attività)
    known_teachers = {}
    for t in data.get("teachers", []):
        if t.get("name"):
            known_teachers[t["name"]] = t.get("comments", "")
    for a in data.get("activities", []):
        if exclude_disposizioni and (a.get("subject") or "").strip().lower().startswith("disposiz"):
            continue
        for t_act in a.get("teachers", []):
            t_act = t_act.strip()
            if t_act and t_act not in known_teachers:
                known_teachers[t_act] = ""

    lines.append('  <Teachers_List>')
    teacher_obj_map = {t.get("name"): t for t in data.get("teachers", [])}
    for t_name, t_comm in sorted(known_teachers.items(), key=lambda x: x[0].lower()):
        lines.append('    <Teacher>')
        lines.append(f'      <Name>{xml_escape(t_name)}</Name>')
        t_obj = teacher_obj_map.get(t_name, {})
        comm_tokens = []
        if t_comm:
            comm_tokens.append(t_comm)
        if t_obj.get("target_hours") and t_obj.get("target_hours") != 18:
            if not any("target_hours" in tok for tok in comm_tokens):
                comm_tokens.append(f'target_hours:{t_obj["target_hours"]}')
        if t_obj.get("custom_disp_hours") is not None:
            if not any("custom_disp" in tok for tok in comm_tokens):
                comm_tokens.append(f'custom_disp:{t_obj["custom_disp_hours"]}')
        merged_comm = " | ".join(comm_tokens)
        if merged_comm:
            lines.append(f'      <Comments>{xml_escape(merged_comm)}</Comments>')
        lines.append('    </Teacher>')
    lines.append('  </Teachers_List>')

    # 6. Classi e Gruppi
    lines.append('  <Students_List>')
    for c in data.get("classes", []):
        lines.append('    <Year>')
        lines.append(f'      <Name>{xml_escape(c["name"])}</Name>')
        lines.append(f'      <Number_of_Students>{c.get("students", 0)}</Number_of_Students>')
        lines.append('      <Comments></Comments>')
        c_groups = [g for g in data.get("groups", []) if g.get("class_name") == c["name"]]
        for g in c_groups:
            lines.append('      <Group>')
            lines.append(f'        <Name>{xml_escape(g["name"])}</Name>')
            lines.append(f'        <Number_of_Students>{g.get("students", 0)}</Number_of_Students>')
            lines.append('        <Comments></Comments>')
            lines.append('      </Group>')
        lines.append('    </Year>')
    lines.append('  </Students_List>')

    # 7. Attività (Rigorosa sequenza tag FET: Teacher, Subject, Activity_Tag, Students, Duration, Total_Duration, Id, Group_Id, Active, Comments)
    lines.append('  <Activities_List>')
    grouped_3h_pairs = []
    companion_room_constraints = []

    for a in emitted_activities:
        aid = str(a["id"])
        dur = a.get("duration", 1)
        tot_dur = a.get("total_duration", dur)
        active_str = "true" if a.get("active", True) else "false"
        comments_str = xml_escape(a.get("comments", ""))
        gid = a.get("group_id", a["id"])
        room = a.get("room", "")

        if dur == 3:
            comp_id = f"90000{aid}"
            grouped_3h_pairs.append((aid, comp_id))

            # Sotto-attività primaria (2h)
            lines.append('    <Activity>')
            for t in a.get("teachers", []):
                lines.append(f'      <Teacher>{xml_escape(t)}</Teacher>')
            lines.append(f'      <Subject>{xml_escape(a.get("subject", ""))}</Subject>')
            if a.get("activity_tag"):
                lines.append(f'      <Activity_Tag>{xml_escape(a["activity_tag"])}</Activity_Tag>')
            for s in a.get("students", []):
                lines.append(f'      <Students>{xml_escape(s)}</Students>')
            lines.append('      <Duration>2</Duration>')
            lines.append(f'      <Total_Duration>{tot_dur}</Total_Duration>')
            lines.append(f'      <Id>{aid}</Id>')
            lines.append(f'      <Activity_Group_Id>{gid}</Activity_Group_Id>')
            lines.append(f'      <Active>{active_str}</Active>')
            lines.append(f'      <Comments>{comments_str}</Comments>')
            lines.append('    </Activity>')

            # Sotto-attività compagna (1h)
            lines.append('    <Activity>')
            for t in a.get("teachers", []):
                lines.append(f'      <Teacher>{xml_escape(t)}</Teacher>')
            lines.append(f'      <Subject>{xml_escape(a.get("subject", ""))}</Subject>')
            if a.get("activity_tag"):
                lines.append(f'      <Activity_Tag>{xml_escape(a["activity_tag"])}</Activity_Tag>')
            for s in a.get("students", []):
                lines.append(f'      <Students>{xml_escape(s)}</Students>')
            lines.append('      <Duration>1</Duration>')
            lines.append(f'      <Total_Duration>{tot_dur}</Total_Duration>')
            lines.append(f'      <Id>{comp_id}</Id>')
            lines.append(f'      <Activity_Group_Id>{gid}</Activity_Group_Id>')
            lines.append(f'      <Active>{active_str}</Active>')
            lines.append(f'      <Comments>{comments_str}</Comments>')
            lines.append('    </Activity>')

            if room:
                companion_room_constraints.append((comp_id, room))
        else:
            lines.append('    <Activity>')
            for t in a.get("teachers", []):
                lines.append(f'      <Teacher>{xml_escape(t)}</Teacher>')
            lines.append(f'      <Subject>{xml_escape(a.get("subject", ""))}</Subject>')
            if a.get("activity_tag"):
                lines.append(f'      <Activity_Tag>{xml_escape(a["activity_tag"])}</Activity_Tag>')
            for s in a.get("students", []):
                lines.append(f'      <Students>{xml_escape(s)}</Students>')
            lines.append(f'      <Duration>{dur}</Duration>')
            lines.append(f'      <Total_Duration>{tot_dur}</Total_Duration>')
            lines.append(f'      <Id>{aid}</Id>')
            lines.append(f'      <Activity_Group_Id>{gid}</Activity_Group_Id>')
            lines.append(f'      <Active>{active_str}</Active>')
            lines.append(f'      <Comments>{comments_str}</Comments>')
            lines.append('    </Activity>')
    lines.append('  </Activities_List>')

    # 8. Plessi
    lines.append('  <Buildings_List>')
    for b in data.get("buildings", []):
        b_name = b["name"] if isinstance(b, dict) else str(b)
        lines.append('    <Building>')
        lines.append(f'      <Name>{xml_escape(b_name)}</Name>')
        lines.append('    </Building>')
    lines.append('  </Buildings_List>')

    # 9. Aule
    lines.append('  <Rooms_List>')
    valid_blds = [b["name"] if isinstance(b, dict) else str(b) for b in data.get("buildings", [])]
    fallback_bld = valid_blds[0] if valid_blds else "Centrale"

    gym_emitted = False
    for r in data.get("rooms", []):
        r_name = r["name"]
        r_bld = r.get("building") or fallback_bld
        if r_bld not in valid_blds:
            r_bld = fallback_bld

        if r_name.lower().startswith("palestra") or "gym" in r_name.lower() or r.get("room_type") == "gym":
            if not gym_emitted:
                gym_bld = r_bld
                # Emette internamente i 3 moduli per gestire la contemporaneità di 2 o 3 classi fino a 57 persone
                lines.append('    <Room>')
                lines.append('      <Name>Palestra-1</Name>')
                lines.append(f'      <Building>{xml_escape(gym_bld)}</Building>')
                lines.append('      <Capacity>29</Capacity>')
                lines.append('      <Comments>Modulo interno 1/3 (Capienza max totale impianto 57)</Comments>')
                lines.append('    </Room>')
                lines.append('    <Room>')
                lines.append('      <Name>Palestra-2</Name>')
                lines.append(f'      <Building>{xml_escape(gym_bld)}</Building>')
                lines.append('      <Capacity>29</Capacity>')
                lines.append('      <Comments>Modulo interno 2/3 (Capienza max totale impianto 57)</Comments>')
                lines.append('    </Room>')
                lines.append('    <Room>')
                lines.append('      <Name>Palestra-3</Name>')
                lines.append(f'      <Building>{xml_escape(gym_bld)}</Building>')
                lines.append('      <Capacity>18</Capacity>')
                lines.append('      <Comments>Modulo interno 3/3 per terza classe piccola (Capienza max totale impianto 57)</Comments>')
                lines.append('    </Room>')
                gym_emitted = True
            continue
        lines.append('    <Room>')
        lines.append(f'      <Name>{xml_escape(r_name)}</Name>')
        lines.append(f'      <Building>{xml_escape(r_bld)}</Building>')
        lines.append(f'      <Capacity>{r.get("capacity", 30)}</Capacity>')
        if r.get("comments"):
            lines.append(f'      <Comments>{xml_escape(r["comments"])}</Comments>')
        lines.append('    </Room>')
    lines.append('  </Rooms_List>')

    # Vincoli di tempo
    lines.append('  <Time_Constraints_List>')
    lines.append('    <ConstraintBasicCompulsoryTime>')
    lines.append('      <Weight_Percentage>100</Weight_Percentage>')
    lines.append('      <Active>true</Active>')
    lines.append('      <Comments></Comments>')
    lines.append('    </ConstraintBasicCompulsoryTime>')

    # Pause Istituto e Intervalli (ConstraintBreakTimes) filtrate per giorni attivi
    break_times = [bt for bt in data.get("break_times", []) if bt.split("|")[0] in active_days]
    if break_times:
        lines.append('    <ConstraintBreakTimes>')
        lines.append('      <Weight_Percentage>100</Weight_Percentage>')
        lines.append(f'      <Number_of_Break_Times>{len(break_times)}</Number_of_Break_Times>')
        for bt in break_times:
            if "|" in bt:
                sd, sh = bt.split("|", 1)
                lines.append('      <Break_Time>')
                lines.append(f'        <Day>{xml_escape(sd)}</Day>')
                lines.append(f'        <Hour>{xml_escape(sh)}</Hour>')
                lines.append('      </Break_Time>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintBreakTimes>')

    # Indisponibilità docenti
    teachers_by_name = {t.get("name", ""): t for t in data.get("teachers", []) if t.get("name")}
    for t_name, slots in data.get("teacher_availability", {}).items():
        t_obj = teachers_by_name.get(t_name, {})
        merged_slots = set(slots)
        if t_obj.get("free_day_strict") and t_obj.get("free_day_1"):
            fd = t_obj["free_day_1"]
            if fd in active_days:
                lim = int(data.get("day_hours_limit", {}).get(fd, 6))
                for h in data.get("hours", []):
                    if h.isdigit() and int(h) <= lim:
                        merged_slots.add(f"{fd}|{h}")

        act_slots = [sl for sl in sorted(list(merged_slots)) if sl.split("|")[0] in active_days]
        if act_slots:
            lines.append('    <ConstraintTeacherNotAvailableTimes>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(t_name)}</Teacher>')
            lines.append(f'      <Number_of_Not_Available_Times>{len(act_slots)}</Number_of_Not_Available_Times>')
            for sl in act_slots:
                if "|" in sl:
                    sd, sh = sl.split("|", 1)
                    lines.append('      <Not_Available_Time>')
                    lines.append(f'        <Day>{xml_escape(sd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(sh)}</Hour>')
                    lines.append('      </Not_Available_Time>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintTeacherNotAvailableTimes>')

    # Indisponibilità classi
    for c_name, slots in data.get("class_availability", {}).items():
        act_slots = [sl for sl in slots if sl.split("|")[0] in active_days]
        if act_slots:
            lines.append('    <ConstraintStudentsSetNotAvailableTimes>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Students>{xml_escape(c_name)}</Students>')
            lines.append(f'      <Number_of_Not_Available_Times>{len(act_slots)}</Number_of_Not_Available_Times>')
            for sl in act_slots:
                if "|" in sl:
                    sd, sh = sl.split("|", 1)
                    lines.append('      <Not_Available_Time>')
                    lines.append(f'        <Day>{xml_escape(sd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(sh)}</Hour>')
                    lines.append('      </Not_Available_Time>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintStudentsSetNotAvailableTimes>')

    # Vincolo giorni minimi tra sotto-attività della stessa cattedra (ConstraintMinDaysBetweenActivities)
    # Generato dinamicamente per garantire perfetta corrispondenza con le sotto-attività e blocchi correnti
    act_by_cattedra = defaultdict(list)
    for a in emitted_activities:
        if not a.get("active", True):
            continue
        subj = a.get("subject", "")
        # Esclude ore a disposizione dal vincolo di spaziatura giorni
        if subj.lower().startswith("disposiz"):
            continue
        gid = a.get("group_id")
        if gid:
            act_by_cattedra[f"gid_{gid}"].append(str(a["id"]))
        else:
            t_key = "+".join(sorted(a.get("teachers", [])))
            s_key = "+".join(sorted(a.get("students", [])))
            act_by_cattedra[f"{t_key}_{s_key}_{subj}"].append(str(a["id"]))

    acts_by_id = {str(a["id"]): a for a in emitted_activities}
    teachers_dict = {t["name"]: t for t in data.get("teachers", []) if t.get("name")}

    for k, ids in act_by_cattedra.items():
        if len(ids) > 1:
            eff_max_days_list = []
            for aid in ids:
                act_obj = acts_by_id.get(aid)
                if act_obj:
                    for tn in act_obj.get("teachers", []):
                        t_obj = teachers_dict.get(tn)
                        if t_obj and t_obj.get("max_days") is not None:
                            try:
                                eff_max_days_list.append(int(t_obj["max_days"]))
                            except (ValueError, TypeError):
                                pass

            min_days_limit = min(eff_max_days_list) if eff_max_days_list else len(active_days)
            # Se il numero di sotto-attività supera i giorni disponibili per il docente o per la settimana,
            # usiamo un peso del 95% (come documentato e raccomandato da FET) per permettere a più attività
            # di condividere lo stesso giorno senza fallire la validazione pre-computazionale.
            weight = 95 if len(ids) > min_days_limit else 100

            lines.append('    <ConstraintMinDaysBetweenActivities>')
            lines.append(f'      <Weight_Percentage>{weight}</Weight_Percentage>')
            lines.append('      <Consecutive_If_Same_Day>true</Consecutive_If_Same_Day>')
            lines.append(f'      <Number_of_Activities>{len(ids)}</Number_of_Activities>')
            for aid in ids:
                lines.append(f'      <Activity_Id>{aid}</Activity_Id>')
            lines.append('      <MinDays>1</MinDays>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintMinDaysBetweenActivities>')

    # Vincoli extra gruppo 1 (prima di TeacherMaxGapsPerDay)
    extra_tc = data.get("extra_time_constraints", [])
    grp1_tags = {
        "ConstraintTeacherMaxDaysPerWeek",
        "ConstraintTeacherMinDaysPerWeek",
        "ConstraintTeacherMinHoursDaily",
        "ConstraintActivitiesOccupyMaxTimeSlotsFromSelection",
        "ConstraintActivitiesOccupyMinTimeSlotsFromSelection",
        "ConstraintActivitiesPreferredTimeSlots"
    }

    # Mappa impostazioni giorni dai profili docenti (prioritarie rispetto a extra_tc)
    teacher_custom_max = {}
    teacher_custom_min = {}
    for t in data.get("teachers", []):
        tname = t.get("name", "")
        if not tname:
            continue
        if t.get("max_days") is not None:
            try:
                teacher_custom_max[tname] = int(t["max_days"])
            except (ValueError, TypeError):
                pass
        if t.get("min_days") is not None:
            try:
                teacher_custom_min[tname] = int(t["min_days"])
            except (ValueError, TypeError):
                pass

    emitted_max_days_teachers = set()
    emitted_min_days_teachers = set()

    for item in extra_tc:
        tag = item.get("tag")
        if tag not in grp1_tags:
            continue
        xml_str = item.get("xml", "")

        # Se il docente ha un'impostazione diretta nel profilo, la useremo in seguito
        if tag == "ConstraintTeacherMaxDaysPerWeek":
            m_t = re.search(r"<Teacher>(.*?)</Teacher>", xml_str)
            if m_t and m_t.group(1) in teacher_custom_max:
                continue
            if m_t:
                emitted_max_days_teachers.add(m_t.group(1))
        elif tag == "ConstraintTeacherMinDaysPerWeek":
            m_t = re.search(r"<Teacher>(.*?)</Teacher>", xml_str)
            if m_t and m_t.group(1) in teacher_custom_min:
                continue
            if m_t:
                emitted_min_days_teachers.add(m_t.group(1))
        # Se il vincolo contiene riferimenti ad Activity_Id, verifica che appartengano alle attività emesse in FET
        act_matches = re.findall(r"<Activity_Id>(\d+)</Activity_Id>", xml_str)
        if any(aid not in emitted_act_ids for aid in act_matches):
            continue

        lines.append("    " + xml_str.replace("\n", "\n    "))

    # Emetti i vincoli impostati nei profili dei docenti
    for tname, md_val in teacher_custom_max.items():
        if 1 <= md_val <= len(active_days) and tname not in emitted_max_days_teachers:
            lines.append('    <ConstraintTeacherMaxDaysPerWeek>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
            lines.append(f'      <Max_Days_Per_Week>{md_val}</Max_Days_Per_Week>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments>giorni massimi configurati nel profilo docente</Comments>')
            lines.append('    </ConstraintTeacherMaxDaysPerWeek>')
            emitted_max_days_teachers.add(tname)

    for tname, mind_val in teacher_custom_min.items():
        if 1 <= mind_val <= len(active_days) and tname not in emitted_min_days_teachers:
            lines.append('    <ConstraintTeacherMinDaysPerWeek>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
            lines.append(f'      <Minimum_Days_Per_Week>{mind_val}</Minimum_Days_Per_Week>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments>giorni minimi configurati nel profilo docente</Comments>')
            lines.append('    </ConstraintTeacherMinDaysPerWeek>')
            emitted_min_days_teachers.add(tname)

    # Preferenze e Vincoli Orari Avanzati Docenti
    for t in data.get("teachers", []):
        tname = t.get("name", "")
        if not tname:
            continue

        # 1. Fascia Oraria Preferita (Prime / Ultime / Bilanciato)
        pref_shift = (t.get("pref_shift") or "none").lower()
        if pref_shift in ("prime", "ultime", "bilanciato"):
            weight = int(t.get("pref_shift_weight") or 85)
            pref_slots = []
            for d in active_days:
                lim = int(data.get("day_hours_limit", {}).get(d, 6))
                dh = [h for h in data.get("hours", []) if h.isdigit() and int(h) <= lim]
                if not dh:
                    continue
                if pref_shift == "prime":
                    chosen = dh[:min(4, len(dh))]
                elif pref_shift == "ultime":
                    chosen = dh[max(0, len(dh)-4):]
                elif pref_shift == "bilanciato":
                    chosen = [h for h in dh if 2 <= int(h) <= 5]
                    if not chosen:
                        chosen = dh
                for ch in chosen:
                    pref_slots.append((d, ch))

            if pref_slots:
                lines.append('    <ConstraintActivitiesPreferredTimeSlots>')
                lines.append(f'      <Weight_Percentage>{weight}</Weight_Percentage>')
                lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
                lines.append('      <Students></Students>')
                lines.append('      <Subject></Subject>')
                lines.append('      <Activity_Tag></Activity_Tag>')
                lines.append('      <Duration></Duration>')
                lines.append(f'      <Number_of_Preferred_Time_Slots>{len(pref_slots)}</Number_of_Preferred_Time_Slots>')
                for pd, ph in pref_slots:
                    lines.append('      <Preferred_Time_Slot>')
                    lines.append(f'        <Day>{xml_escape(pd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(ph)}</Hour>')
                    lines.append('      </Preferred_Time_Slot>')
                lines.append('      <Active>true</Active>')
                lines.append(f'      <Comments>{xml_escape(tname)}: preferenza fascia {pref_shift} ({weight}%)</Comments>')
                lines.append('    </ConstraintActivitiesPreferredTimeSlots>')

        # 2. Giorno Libero Settimanale Desiderato (Soft, se non tassativo)
        fd1 = t.get("free_day_1")
        fd2 = t.get("free_day_2")
        is_strict = bool(t.get("free_day_strict", False))
        if fd1 and fd1 in active_days and not is_strict:
            non_fd_slots = []
            for d in active_days:
                if d == fd1:
                    continue
                lim = int(data.get("day_hours_limit", {}).get(d, 6))
                for h in data.get("hours", []):
                    if h.isdigit() and int(h) <= lim:
                        non_fd_slots.append((d, h))
            if non_fd_slots:
                lines.append('    <ConstraintActivitiesPreferredTimeSlots>')
                lines.append('      <Weight_Percentage>85</Weight_Percentage>')
                lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
                lines.append('      <Students></Students>')
                lines.append('      <Subject></Subject>')
                lines.append('      <Activity_Tag></Activity_Tag>')
                lines.append('      <Duration></Duration>')
                lines.append(f'      <Number_of_Preferred_Time_Slots>{len(non_fd_slots)}</Number_of_Preferred_Time_Slots>')
                for pd, ph in non_fd_slots:
                    lines.append('      <Preferred_Time_Slot>')
                    lines.append(f'        <Day>{xml_escape(pd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(ph)}</Hour>')
                    lines.append('      </Preferred_Time_Slot>')
                lines.append('      <Active>true</Active>')
                lines.append(f'      <Comments>{xml_escape(tname)}: giorno libero desiderato {fd1} (85%)</Comments>')
                lines.append('    </ConstraintActivitiesPreferredTimeSlots>')

        if fd2 and fd2 in active_days and not is_strict:
            non_fd2_slots = []
            for d in active_days:
                if d == fd2:
                    continue
                lim = int(data.get("day_hours_limit", {}).get(d, 6))
                for h in data.get("hours", []):
                    if h.isdigit() and int(h) <= lim:
                        non_fd2_slots.append((d, h))
            if non_fd2_slots:
                lines.append('    <ConstraintActivitiesPreferredTimeSlots>')
                lines.append('      <Weight_Percentage>70</Weight_Percentage>')
                lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
                lines.append('      <Students></Students>')
                lines.append('      <Subject></Subject>')
                lines.append('      <Activity_Tag></Activity_Tag>')
                lines.append('      <Duration></Duration>')
                lines.append(f'      <Number_of_Preferred_Time_Slots>{len(non_fd2_slots)}</Number_of_Preferred_Time_Slots>')
                for pd, ph in non_fd2_slots:
                    lines.append('      <Preferred_Time_Slot>')
                    lines.append(f'        <Day>{xml_escape(pd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(ph)}</Hour>')
                    lines.append('      </Preferred_Time_Slot>')
                lines.append('      <Active>true</Active>')
                lines.append(f'      <Comments>{xml_escape(tname)}: seconda scelta giorno libero {fd2} (70%)</Comments>')
                lines.append('    </ConstraintActivitiesPreferredTimeSlots>')

        # 3. Permanenza massima a scuola giornaliera (ConstraintTeacherMaxSpanPerDay)
        max_span = t.get("max_span")
        if max_span and int(max_span) > 0:
            lines.append('    <ConstraintTeacherMaxSpanPerDay>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
            lines.append(f'      <Max_Span>{int(max_span)}</Max_Span>')
            lines.append('      <Active>true</Active>')
            lines.append(f'      <Comments>{xml_escape(tname)}: permanenza massima {max_span} ore</Comments>')
            lines.append('    </ConstraintTeacherMaxSpanPerDay>')

        # 4. Massimo ore di lezione al giorno per questo docente
        max_dl = t.get("max_daily_lessons")
        if max_dl and int(max_dl) > 0:
            lines.append('    <ConstraintTeacherMaxHoursDaily>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
            lines.append(f'      <Maximum_Hours_Daily>{int(max_dl)}</Maximum_Hours_Daily>')
            lines.append('      <Active>true</Active>')
            lines.append(f'      <Comments>{xml_escape(tname)}: max ore lezione al giorno {max_dl}</Comments>')
            lines.append('    </ConstraintTeacherMaxHoursDaily>')

        # 5. Minimo ore di lezione nei giorni di presenza (ConstraintTeacherMinHoursDaily)
        min_dl = t.get("min_daily_lessons")
        if min_dl and int(min_dl) > 0:
            lines.append('    <ConstraintTeacherMinHoursDaily>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(tname)}</Teacher>')
            lines.append(f'      <Minimum_Hours_Daily>{int(min_dl)}</Minimum_Hours_Daily>')
            lines.append('      <Allow_Empty_Days>true</Allow_Empty_Days>')
            lines.append('      <Active>true</Active>')
            lines.append(f'      <Comments>{xml_escape(tname)}: min ore lezione nei giorni di presenza {min_dl}</Comments>')
            lines.append('    </ConstraintTeacherMinHoursDaily>')

    # Preferenze orarie materie (no_rientri e pref_hours: PRIME / ULTIME)
    existing_pref_subjects = set()
    for item in extra_tc:
        if item.get("tag") == "ConstraintActivitiesPreferredTimeSlots":
            m_sub = re.search(r"<Subject>(.*?)</Subject>", item.get("xml", ""))
            if m_sub:
                existing_pref_subjects.add(m_sub.group(1))

    subj_pref_weight = data.get("parameters", {}).get("Peso delle preferenze delle materie %", 70)
    for s in data.get("subjects", []):
        s_name = s.get("name", "")
        if s_name in existing_pref_subjects:
            continue
        # Mai nei rientri (ore 7 e 8 di Mar e Ven)
        if s.get("no_rientri"):
            morning_slots = []
            for d in active_days:
                lim = int(data.get("day_hours_limit", {}).get(d, 6))
                for h in data.get("hours", []):
                    if h.isdigit() and int(h) <= 6 and int(h) <= lim:
                        morning_slots.append((d, h))
            if morning_slots:
                lines.append('    <ConstraintActivitiesPreferredTimeSlots>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append('      <Teacher></Teacher>')
                lines.append('      <Students></Students>')
                lines.append(f'      <Subject>{xml_escape(s_name)}</Subject>')
                lines.append('      <Activity_Tag></Activity_Tag>')
                lines.append('      <Duration></Duration>')
                lines.append(f'      <Number_of_Preferred_Time_Slots>{len(morning_slots)}</Number_of_Preferred_Time_Slots>')
                for md, mh in morning_slots:
                    lines.append('      <Preferred_Time_Slot>')
                    lines.append(f'        <Day>{xml_escape(md)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(mh)}</Hour>')
                    lines.append('      </Preferred_Time_Slot>')
                lines.append('      <Active>true</Active>')
                lines.append(f'      <Comments>{xml_escape(s_name)}: mai nei rientri pomeridiani</Comments>')
                lines.append('    </ConstraintActivitiesPreferredTimeSlots>')

        # Ore preferite (PRIME / ULTIME)
        pref_h = (s.get("pref_hours") or "").upper()
        if pref_h in ("PRIME", "ULTIME"):
            pref_slots = []
            for d in active_days:
                lim = int(data.get("day_hours_limit", {}).get(d, 6))
                dh = [h for h in data.get("hours", []) if h.isdigit() and int(h) <= lim]
                chosen = dh[:min(4, len(dh))] if pref_h == "PRIME" else dh[max(0, len(dh)-4):]
                for ch in chosen:
                    pref_slots.append((d, ch))
            if pref_slots:
                lines.append('    <ConstraintActivitiesPreferredTimeSlots>')
                lines.append(f'      <Weight_Percentage>{subj_pref_weight}</Weight_Percentage>')
                lines.append('      <Teacher></Teacher>')
                lines.append('      <Students></Students>')
                lines.append(f'      <Subject>{xml_escape(s_name)}</Subject>')
                lines.append('      <Activity_Tag></Activity_Tag>')
                lines.append('      <Duration></Duration>')
                lines.append(f'      <Number_of_Preferred_Time_Slots>{len(pref_slots)}</Number_of_Preferred_Time_Slots>')
                for pd, ph in pref_slots:
                    lines.append('      <Preferred_Time_Slot>')
                    lines.append(f'        <Day>{xml_escape(pd)}</Day>')
                    lines.append(f'        <Hour>{xml_escape(ph)}</Hour>')
                    lines.append('      </Preferred_Time_Slot>')
                lines.append('      <Active>true</Active>')
                lines.append(f'      <Comments>{xml_escape(s_name)}: preferisce le {pref_h.lower()} ore</Comments>')
                lines.append('    </ConstraintActivitiesPreferredTimeSlots>')

    # Vincoli Istituzionali
    constraints = data.get("constraints", {})

    # Docenti: Ore buche al giorno e a settimana (per docente)
    c_t_g_d = constraints.get("TEACHERS_MAX_GAPS_DAY", {})
    if c_t_g_d.get("active", True):
        for t in data.get("teachers", []):
            max_gaps = t.get("max_gaps_per_day") if t.get("max_gaps_per_day") is not None else c_t_g_d.get("val", 1)
            lines.append('    <ConstraintTeacherMaxGapsPerDay>')
            lines.append(f'      <Weight_Percentage>{c_t_g_d.get("weight", 100)}</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(t["name"])}</Teacher>')
            lines.append(f'      <Max_Gaps>{max_gaps}</Max_Gaps>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintTeacherMaxGapsPerDay>')

    # Vincoli extra gruppo 2 (tra TeacherMaxGapsPerDay e TeacherMaxGapsPerWeek)
    grp2_tags = {
        "ConstraintStudentsSetMinHoursDaily",
        "ConstraintStudentsSetIntervalMaxDaysPerWeek",
        "ConstraintTeacherIntervalMaxDaysPerWeek"
    }
    for item in extra_tc:
        if item.get("tag") in grp2_tags:
            lines.append("    " + item.get("xml", "").replace("\n", "\n    "))

    c_t_g_w = constraints.get("TEACHERS_MAX_GAPS_WEEK", {})
    if c_t_g_w.get("active", True):
        for t in data.get("teachers", []):
            lines.append('    <ConstraintTeacherMaxGapsPerWeek>')
            lines.append(f'      <Weight_Percentage>{c_t_g_w.get("weight", 100)}</Weight_Percentage>')
            lines.append(f'      <Teacher>{xml_escape(t["name"])}</Teacher>')
            lines.append(f'      <Max_Gaps>{c_t_g_w.get("val", 1)}</Max_Gaps>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintTeacherMaxGapsPerWeek>')

    # Classi: Max ore buche al giorno
    c_s_g_d = constraints.get("STUDENTS_MAX_GAPS_DAY", {})
    if c_s_g_d.get("active", True):
        lines.append('    <ConstraintStudentsMaxGapsPerDay>')
        lines.append(f'      <Weight_Percentage>{c_s_g_d.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Max_Gaps>{c_s_g_d.get("val", 0)}</Max_Gaps>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintStudentsMaxGapsPerDay>')

    # Classi: Max ore buche a settimana
    c_s_g_w = constraints.get("STUDENTS_MAX_GAPS_WEEK", {})
    if c_s_g_w.get("active", True):
        lines.append('    <ConstraintStudentsMaxGapsPerWeek>')
        lines.append(f'      <Weight_Percentage>{c_s_g_w.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Max_Gaps>{c_s_g_w.get("val", 0)}</Max_Gaps>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintStudentsMaxGapsPerWeek>')

    # Classi: Ingressi alla 2ª ora
    c_early = constraints.get("STUDENTS_EARLY_BEGIN", {})
    if c_early.get("active", True):
        lines.append('    <ConstraintStudentsEarlyMaxBeginningsAtSecondHour>')
        lines.append(f'      <Weight_Percentage>{c_early.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Max_Beginnings_At_Second_Hour>{c_early.get("val", 0)}</Max_Beginnings_At_Second_Hour>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintStudentsEarlyMaxBeginningsAtSecondHour>')

    # Docenti: Max ore al giorno
    c_t_h = constraints.get("TEACHERS_MAX_HOURS_DAY", {})
    if c_t_h.get("active", False):
        lines.append('    <ConstraintTeachersMaxHoursDaily>')
        lines.append(f'      <Weight_Percentage>{c_t_h.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Maximum_Hours_Daily>{c_t_h.get("val", 6)}</Maximum_Hours_Daily>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintTeachersMaxHoursDaily>')

    # Vincoli extra gruppo 3 (dopo TeachersMaxHoursDaily)
    grp3_handled = grp1_tags | grp2_tags | {"ConstraintMinDaysBetweenActivities"}
    for item in extra_tc:
        if item.get("tag") not in grp3_handled:
            lines.append("    " + item.get("xml", "").replace("\n", "\n    "))

    # Vincoli di raggruppamento per blocchi da 3 ore (2h + 1h nello stesso giorno e consecutivi)
    for p_id, c_id in grouped_3h_pairs:
        lines.append('    <ConstraintActivitiesSameStartingDay>')
        lines.append('      <Weight_Percentage>100</Weight_Percentage>')
        lines.append('      <Number_of_Activities>2</Number_of_Activities>')
        lines.append(f'      <Activity_Id>{p_id}</Activity_Id>')
        lines.append(f'      <Activity_Id>{c_id}</Activity_Id>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments>Raggruppamento blocco 3h nello stesso giorno</Comments>')
        lines.append('    </ConstraintActivitiesSameStartingDay>')
        lines.append('    <ConstraintTwoActivitiesGrouped>')
        lines.append('      <Weight_Percentage>100</Weight_Percentage>')
        lines.append(f'      <First_Activity_Id>{p_id}</First_Activity_Id>')
        lines.append(f'      <Second_Activity_Id>{c_id}</Second_Activity_Id>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments>Raggruppamento blocco 3h consecutive</Comments>')
        lines.append('    </ConstraintTwoActivitiesGrouped>')

    # Se richiesto include_timetable o presenti attività bloccate, aggiunge i vincoli bloccati solo alla fine
    locked_set = set(str(x) for x in data.get("locked_activities", []))
    acts_map_for_lock = {str(a["id"]): a for a in data.get("activities", [])}

    for aid, pl in data.get("timetable", {}).items():
        aid_str = str(aid)
        if pl.get("day") and pl.get("hour") and pl["day"] in active_days:
            if include_timetable or aid_str in locked_set:
                act = acts_map_for_lock.get(aid_str)
                # Non vincolare in FET le attività di disposizione se exclude_disposizioni è True (vengono assegnate post-calcolo)
                if exclude_disposizioni and act and (act.get("subject") or "").strip().lower().startswith("disposiz"):
                    continue
                lines.append('    <ConstraintActivityPreferredStartingTime>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{aid}</Activity_Id>')
                lines.append(f'      <Preferred_Day>{xml_escape(pl["day"])}</Preferred_Day>')
                lines.append(f'      <Preferred_Hour>{xml_escape(pl["hour"])}</Preferred_Hour>')
                lines.append('      <Permanently_Locked>true</Permanently_Locked>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments>Bloccato da utente</Comments>')
                lines.append('    </ConstraintActivityPreferredStartingTime>')

    lines.append('  </Time_Constraints_List>')

    # Vincoli di spazio
    lines.append('  <Space_Constraints_List>')
    lines.append('    <ConstraintBasicCompulsorySpace>')
    lines.append('      <Weight_Percentage>100</Weight_Percentage>')
    lines.append('      <Active>true</Active>')
    lines.append('      <Comments></Comments>')
    lines.append('    </ConstraintBasicCompulsorySpace>')

    # Spostamenti Docenti
    c_b_day = constraints.get("TEACHERS_MAX_BUILDING_CHANGES_DAY", {})
    if c_b_day.get("active", False):
        lines.append('    <ConstraintTeachersMaxBuildingChangesPerDay>')
        lines.append(f'      <Weight_Percentage>{c_b_day.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Max_Building_Changes_Per_Day>{c_b_day.get("val", 1)}</Max_Building_Changes_Per_Day>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintTeachersMaxBuildingChangesPerDay>')

    c_b_gap = constraints.get("TEACHERS_MIN_GAPS_BUILDING_CHANGES", {})
    if c_b_gap.get("active", True):
        lines.append('    <ConstraintTeachersMinGapsBetweenBuildingChanges>')
        lines.append(f'      <Weight_Percentage>{c_b_gap.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Min_Gaps_Between_Building_Changes>{c_b_gap.get("val", 1)}</Min_Gaps_Between_Building_Changes>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintTeachersMinGapsBetweenBuildingChanges>')

    c_b_week = constraints.get("TEACHERS_MAX_BUILDING_CHANGES_WEEK", {})
    if c_b_week.get("active", False):
        lines.append('    <ConstraintTeachersMaxBuildingChangesPerWeek>')
        lines.append(f'      <Weight_Percentage>{c_b_week.get("weight", 100)}</Weight_Percentage>')
        lines.append(f'      <Max_Building_Changes_Per_Week>{c_b_week.get("val", 3)}</Max_Building_Changes_Per_Week>')
        lines.append('      <Active>true</Active>')
        lines.append('      <Comments></Comments>')
        lines.append('    </ConstraintTeachersMaxBuildingChangesPerWeek>')

    valid_rooms = {r["name"] if isinstance(r, dict) else str(r) for r in data.get("rooms", [])}
    has_gym = any("palestra" in r.lower() for r in valid_rooms)
    gym_rooms = ["Palestra-1", "Palestra-2", "Palestra-3"] if has_gym else []
    info_rooms = sorted([r for r in valid_rooms if "info" in r.lower()])

    assigned_act_pref_rooms = set()

    # Vincoli speciali dinamici per palestre e laboratori di informatica
    for a in emitted_activities:
        aid = str(a["id"])
        subj = (a.get("subject") or "").lower()
        if "motori" in subj or "sport" in subj:
            if gym_rooms:
                lines.append('    <ConstraintActivityPreferredRooms>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{aid}</Activity_Id>')
                lines.append(f'      <Number_of_Preferred_Rooms>{len(gym_rooms)}</Number_of_Preferred_Rooms>')
                for r in gym_rooms:
                    lines.append(f'      <Preferred_Room>{xml_escape(r)}</Preferred_Room>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments></Comments>')
                lines.append('    </ConstraintActivityPreferredRooms>')
                assigned_act_pref_rooms.add(aid)
        elif "informatic" in subj:
            if info_rooms:
                lines.append('    <ConstraintActivityPreferredRooms>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{aid}</Activity_Id>')
                lines.append(f'      <Number_of_Preferred_Rooms>{len(info_rooms)}</Number_of_Preferred_Rooms>')
                for r in info_rooms:
                    lines.append(f'      <Preferred_Room>{xml_escape(r)}</Preferred_Room>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments></Comments>')
                lines.append('    </ConstraintActivityPreferredRooms>')
                assigned_act_pref_rooms.add(aid)

    for pair_aid, comp_id in grouped_3h_pairs:
        act_parent = acts_by_id.get(pair_aid)
        if act_parent:
            subj = (act_parent.get("subject") or "").lower()
            if ("motori" in subj or "sport" in subj) and gym_rooms:
                lines.append('    <ConstraintActivityPreferredRooms>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{comp_id}</Activity_Id>')
                lines.append(f'      <Number_of_Preferred_Rooms>{len(gym_rooms)}</Number_of_Preferred_Rooms>')
                for r in gym_rooms:
                    lines.append(f'      <Preferred_Room>{xml_escape(r)}</Preferred_Room>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments></Comments>')
                lines.append('    </ConstraintActivityPreferredRooms>')
                assigned_act_pref_rooms.add(comp_id)
            elif "informatic" in subj and info_rooms:
                lines.append('    <ConstraintActivityPreferredRooms>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{comp_id}</Activity_Id>')
                lines.append(f'      <Number_of_Preferred_Rooms>{len(info_rooms)}</Number_of_Preferred_Rooms>')
                for r in info_rooms:
                    lines.append(f'      <Preferred_Room>{xml_escape(r)}</Preferred_Room>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments></Comments>')
                lines.append('    </ConstraintActivityPreferredRooms>')
                assigned_act_pref_rooms.add(comp_id)

    succursale_classes = {"1C", "2C", "3C", "4C", "5C", "3D", "4D", "5D", "3L", "4L", "5L"}
    for item in data.get("extra_space_constraints", []):
        xml_str = item.get("xml", "")
        # Se il vincolo contiene riferimenti ad Activity_Id, verifica che appartengano alle attività emesse in FET
        act_matches = re.findall(r"<Activity_Id>(\d+)</Activity_Id>", xml_str)
        if any(aid not in emitted_act_ids for aid in act_matches):
            continue

        tag = item.get("tag", "")
        # Ignora vecchi ConstraintActivityPreferredRooms obsoleti o già gestiti dinamicamente
        if tag == "ConstraintActivityPreferredRooms":
            if any(aid in assigned_act_pref_rooms for aid in act_matches):
                continue
            # Se il vincolo assegna palestre o aule info ma l'attività non è né motoria né informatica, ignora
            pref_rooms = re.findall(r"<Preferred_Room>(.*?)</Preferred_Room>", xml_str)
            if any("palestra" in pr.lower() or "info" in pr.lower() for pr in pref_rooms):
                continue
            valid_prefs = [pr for pr in pref_rooms if pr in valid_rooms]
            if not valid_prefs:
                continue
            if len(valid_prefs) < len(pref_rooms):
                xml_str = re.sub(r"<Number_of_Preferred_Rooms>\d+</Number_of_Preferred_Rooms>", f"<Number_of_Preferred_Rooms>{len(valid_prefs)}</Number_of_Preferred_Rooms>", xml_str)
                xml_str = re.sub(r"\s*<Preferred_Room>.*?</Preferred_Room>", "", xml_str)
                rooms_tags = "".join(f"\n      <Preferred_Room>{pr}</Preferred_Room>" for pr in valid_prefs)
                xml_str = xml_str.replace("</Number_of_Preferred_Rooms>", f"</Number_of_Preferred_Rooms>{rooms_tags}")
        elif tag == "ConstraintStudentsSetMaxBuildingChangesPerDay":
            # Le classi della Succursale devono potersi recare in Centrale per Scienze Motorie (Palestra)
            m_st = re.search(r"<Students>(.*?)</Students>", xml_str)
            m_ch = re.search(r"<Max_Building_Changes_Per_Day>(\d+)</Max_Building_Changes_Per_Day>", xml_str)
            if m_st and m_st.group(1) in succursale_classes and m_ch and int(m_ch.group(1)) == 0:
                continue
        elif tag in ("ConstraintActivityPreferredRoom", "ConstraintStudentsSetHomeRoom"):
            m_r = re.search(r"<Room>(.*?)</Room>", xml_str)
            if m_r and m_r.group(1) not in valid_rooms:
                if m_r.group(1) == "Aula 2L" and "Aula 41" in valid_rooms:
                    xml_str = xml_str.replace("<Room>Aula 2L</Room>", "<Room>Aula 41</Room>")
                else:
                    continue

        lines.append("    " + xml_str.replace("\n", "\n    "))

    # Vincoli aula base classe (ConstraintStudentsSetHomeRoom)
    home_weight = data.get("parameters", {}).get("Peso aula classe %", 100)
    existing_homerooms = set()
    for sc in data.get("extra_space_constraints", []):
        if sc.get("tag") == "ConstraintStudentsSetHomeRoom":
            m_cl = re.search(r"<Students>(.*?)</Students>", sc.get("xml", ""))
            if m_cl:
                existing_homerooms.add(m_cl.group(1))

    for c in data.get("classes", []):
        broom = c.get("base_room")
        if broom and c["name"] not in existing_homerooms:
            lines.append('    <ConstraintStudentsSetHomeRoom>')
            lines.append(f'      <Weight_Percentage>{home_weight}</Weight_Percentage>')
            lines.append(f'      <Students>{xml_escape(c["name"])}</Students>')
            lines.append(f'      <Room>{xml_escape(broom)}</Room>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintStudentsSetHomeRoom>')

    timetable_acts = set(data.get("timetable", {}).keys()) if include_timetable else set()
    for a in emitted_activities:
        if a.get("room") and str(a["id"]) not in timetable_acts:
            lines.append('    <ConstraintActivityPreferredRoom>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Activity_Id>{a["id"]}</Activity_Id>')
            lines.append(f'      <Room>{xml_escape(a["room"])}</Room>')
            lines.append('      <Permanently_Locked>true</Permanently_Locked>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintActivityPreferredRoom>')

    for c_aid, c_room in companion_room_constraints:
        if c_room and c_aid not in timetable_acts:
            lines.append('    <ConstraintActivityPreferredRoom>')
            lines.append('      <Weight_Percentage>100</Weight_Percentage>')
            lines.append(f'      <Activity_Id>{c_aid}</Activity_Id>')
            lines.append(f'      <Room>{xml_escape(c_room)}</Room>')
            lines.append('      <Permanently_Locked>true</Permanently_Locked>')
            lines.append('      <Active>true</Active>')
            lines.append('      <Comments></Comments>')
            lines.append('    </ConstraintActivityPreferredRoom>')

    if include_timetable or (locked_set & emitted_act_ids):
        for aid, pl in data.get("timetable", {}).items():
            aid_str = str(aid)
            if aid_str in emitted_act_ids and (include_timetable or aid_str in locked_set) and pl.get("room"):
                lines.append('    <ConstraintActivityPreferredRoom>')
                lines.append('      <Weight_Percentage>100</Weight_Percentage>')
                lines.append(f'      <Activity_Id>{aid}</Activity_Id>')
                lines.append(f'      <Room>{xml_escape(pl["room"])}</Room>')
                lines.append('      <Permanently_Locked>true</Permanently_Locked>')
                lines.append('      <Active>true</Active>')
                lines.append('      <Comments>Bloccato da utente</Comments>')
                lines.append('    </ConstraintActivityPreferredRoom>')
    lines.append('  </Space_Constraints_List>')

    lines.append('</fet>')
    return "\n".join(lines)
