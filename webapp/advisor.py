"""
SmartTimetable - Modulo Advisor Intelligente e Relaxation Engine (v1.3.6)
Analizza sia in FASE PREVENTIVA (prima del lancio) sia in FASE DI COMPILAZIONE (durante/dopo FET)
i conflitti matematici, i colli di bottiglia, le locked activities e i cicli di deadlock ricorsivo.
Fornisce diagnosi "Causa Radice" (Root Cause Analysis) e una scala progressiva di raccomandazioni
(Livello 1: Rilassamento Morbido, Livello 2: Flessibilità Mirata, Livello 3: Intervento Strutturale)
applicabili all'istante in 1 click.
"""

from typing import Dict, List, Any, Optional, Tuple, Set
import os
import glob
import re
from collections import Counter
from webapp.validator import TimetablePreValidator


class TimetableAdvisor:
    """
    Consulente algoritmico intelligente per l'orario scolastico e FET Solver.
    Supporta:
    1. Diagnostica preventiva pre-volo (cattedre impossibili, conflitti ore fissate, co-docenze, capienza)
    2. Deep parsing dell'output di FET (difficult_activities, max_placed_activities, initial_order)
    3. Root Cause Analysis (individuazione del docente pivot, classe pivot o vincolo bloccante)
    4. Relaxation Ladder (scala di allentamento a 3 livelli applicabile in 1 click)
    """

    @classmethod
    def analyze_bottlenecks(
        cls,
        data: Dict[str, Any],
        solver_dir: Optional[str] = None,
        solver_state: Optional[Dict[str, Any]] = None
    ) -> Dict[str, Any]:
        """
        Analizza lo stato del progetto e l'eventuale output del risolutore FET per produrre
        un report diagnostico completo con spiegazione della causa radice e raccomandazioni a 3 livelli.
        """
        recommendations: List[Dict[str, Any]] = []
        bottleneck_entities: List[Dict[str, Any]] = []

        # 1. Validazione statica preventiva
        validator = TimetablePreValidator(data)
        v_report = validator.validate()

        acts_map = {str(a["id"]): a for a in data.get("activities", [])}
        constraints = data.get("constraints", {})
        t_avail = data.get("teacher_availability", {})
        c_avail = data.get("class_availability", {})
        locked_set = set(str(x) for x in data.get("locked_activities", []))
        teachers_list = data.get("teachers", [])

        critical_teachers = Counter()
        critical_classes = Counter()
        critical_subjects = Counter()
        critical_activities_chain: List[Dict[str, Any]] = []
        critical_activity_id: Optional[str] = None
        critical_activity_desc: Optional[str] = None
        max_placed_info: Optional[Dict[str, Any]] = None
        is_solver_phase = False
        root_cause_type: Optional[str] = None
        root_cause_summary: Optional[str] = None

        # 2. Deep Parsing da output FET (se cartella solver presente)
        if solver_dir and os.path.exists(solver_dir):
            # A. Parsing difficult_activities.txt
            diff_files = glob.glob(os.path.join(solver_dir, "**", "difficult_activities.txt"), recursive=True)
            if diff_files and os.path.exists(diff_files[0]):
                is_solver_phase = True
                try:
                    with open(diff_files[0], "r", encoding="utf-8", errors="ignore") as df:
                        d_text = df.read()

                    # Estrai attività principale segnalata come probabile causa
                    m_bot = re.search(r"Id:\s*(\d+)\s*\((.*?)\)", d_text)
                    if m_bot:
                        critical_activity_id = m_bot.group(1)
                        critical_activity_desc = m_bot.group(2).strip()
                        act_obj = acts_map.get(critical_activity_id)
                        if act_obj:
                            for t in act_obj.get("teachers", []):
                                critical_teachers[t] += 8
                            for s in act_obj.get("students", []):
                                critical_classes[s] += 8
                            subj = act_obj.get("subject", "")
                            if subj:
                                critical_subjects[subj] += 8

                    # Estrai la catena delle attività collocate che hanno portato all'inconsistenza
                    chain_matches = re.findall(r"No:\s*\d+,\s*Id:\s*(\d+)\s*\((.*?)\)", d_text)
                    # Le ultime 25 attività sono le più determinanti per l'inconsistenza
                    recent_chain = chain_matches[-25:] if len(chain_matches) > 25 else chain_matches
                    for aid, adesc in recent_chain:
                        act_item = acts_map.get(aid, {})
                        tchs = act_item.get("teachers", [])
                        studs = act_item.get("students", [])
                        sbj = act_item.get("subject", "")
                        is_lck = aid in locked_set

                        critical_activities_chain.append({
                            "id": aid,
                            "desc": adesc.strip(),
                            "teachers": tchs,
                            "classes": studs,
                            "subject": sbj,
                            "locked": is_lck
                        })

                        weight = 3 if is_lck else 1
                        for t in tchs:
                            critical_teachers[t] += weight
                        for s in studs:
                            critical_classes[s] += weight
                        if sbj:
                            critical_subjects[sbj] += weight

                except Exception:
                    pass

            # B. Parsing max_placed_activities.txt e initial_order.txt
            max_placed_files = glob.glob(os.path.join(solver_dir, "**", "max_placed_activities.txt"), recursive=True)
            init_order_files = glob.glob(os.path.join(solver_dir, "**", "initial_order.txt"), recursive=True)
            if max_placed_files and os.path.exists(max_placed_files[0]) and init_order_files and os.path.exists(init_order_files[0]):
                try:
                    with open(max_placed_files[0], "r", encoding="utf-8", errors="ignore") as mf:
                        m_lines = [l.strip() for l in mf.readlines() if l.strip()]
                    last_m = m_lines[-1] if m_lines else ""
                    m_p = re.search(r"reached\s*(\d+)\s*activities", last_m)
                    if m_p:
                        placed_n = int(m_p.group(1))
                        next_n = placed_n + 1
                        # Cerca next_n in initial_order.txt
                        with open(init_order_files[0], "r", encoding="utf-8", errors="ignore") as inf:
                            in_text = inf.read()
                        m_order = re.search(rf"No:\s*{next_n},\s*Id:\s*(\d+).*?Teachers:\s*(.*?),.*?Subject:\s*(.*?),.*?Students:\s*(.*?)(?:,|\n|$)", in_text)
                        if m_order:
                            next_id = m_order.group(1)
                            next_teachers = [t.strip() for t in m_order.group(2).split(",") if t.strip()]
                            next_subj = m_order.group(3).strip()
                            next_classes = [c.strip() for c in m_order.group(4).split(",") if c.strip()]

                            max_placed_info = {
                                "highest_placed": placed_n,
                                "next_activity_num": next_n,
                                "next_activity_id": next_id,
                                "teachers": next_teachers,
                                "subject": next_subj,
                                "classes": next_classes
                            }
                            # Incrementa il punteggio critico
                            for t in next_teachers:
                                critical_teachers[t] += 6
                            for s in next_classes:
                                critical_classes[s] += 6
                            if not critical_activity_id:
                                critical_activity_id = next_id
                                critical_activity_desc = f"{', '.join(next_teachers)} - {next_subj} - {', '.join(next_classes)}"
                except Exception:
                    pass

        # 3. Considera eventuale stato live dal solver
        if solver_state:
            if solver_state.get("bottleneck"):
                is_solver_phase = True
                b_info = solver_state["bottleneck"]
                bot_id = str(b_info.get("id", ""))
                if bot_id and bot_id in acts_map:
                    critical_activity_id = bot_id
                    act_obj = acts_map[bot_id]
                    for t in act_obj.get("teachers", []):
                        critical_teachers[t] += 10
                    for s in act_obj.get("students", []):
                        critical_classes[s] += 10
            # Aggiungi recent_conflicts dallo stream se presenti
            for cid in solver_state.get("recent_conflicts", [])[-20:]:
                c_act = acts_map.get(str(cid))
                if c_act:
                    for t in c_act.get("teachers", []):
                        critical_teachers[t] += 2
                    for s in c_act.get("students", []):
                        critical_classes[s] += 2

        # 4. Arricchisci con issues del Pre-Validatore
        for iss in v_report.get("issues", []):
            sev = iss.get("severity", "info")
            weight = 10 if sev == "critical" else (4 if sev == "warning" else 1)
            for ent in iss.get("entities", []):
                if ent.get("type") == "teacher":
                    critical_teachers[ent["name"]] += weight
                elif ent.get("type") == "class":
                    critical_classes[ent["name"]] += weight

        # 5. ROOT CAUSE ANALYSIS (Identificazione della Causa Radice)
        top_teacher_tuple = critical_teachers.most_common(1)
        top_class_tuple = critical_classes.most_common(1)
        top_subject_tuple = critical_subjects.most_common(1)

        pivot_teacher = top_teacher_tuple[0][0] if top_teacher_tuple and top_teacher_tuple[0][1] >= 4 else None
        pivot_class = top_class_tuple[0][0] if top_class_tuple and top_class_tuple[0][1] >= 4 else None
        pivot_subject = top_subject_tuple[0][0] if top_subject_tuple and top_subject_tuple[0][1] >= 4 else None

        # Ricerca ore fissate nella catena critica
        locked_in_chain = [a for a in critical_activities_chain if a["locked"]]

        if is_solver_phase:
            if locked_in_chain:
                root_cause_type = "LOCKED_ACTIVITY_CLASH"
                l_act = locked_in_chain[0]
                root_cause_summary = (
                    f"Lo stallo di FET è alimentato dall'attività fissata #{l_act['id']} "
                    f"({l_act.get('subject')} con {', '.join(l_act.get('teachers', []))}). "
                    f"Essendo bloccata in una specifica posizione, impedisce all'algoritmo di scambiare le ore per far spazio alle attività rimaste."
                )
            elif pivot_teacher and pivot_class:
                root_cause_type = "TEACHER_CLASS_BOTTLENECK"
                root_cause_summary = (
                    f"Collo di bottiglia principale: intersezione oraria tra il docente '{pivot_teacher}' "
                    f"e la classe '{pivot_class}'. I vincoli o le indisponibilità di entrambi lasciano pochissimi slot compatibili."
                )
            elif pivot_teacher:
                root_cause_type = "TEACHER_TIGHT_SLOTS"
                root_cause_summary = (
                    f"Il docente '{pivot_teacher}' risulta presente nella maggior parte dei conflitti di scambio. "
                    f"Le sue indisponibilità o il giorno libero riducono eccessivamente i gradi di libertà per completare la cattedra."
                )
            elif pivot_class:
                root_cause_type = "CLASS_CONGESTION"
                root_cause_summary = (
                    f"La classe '{pivot_class}' ha un calendario iper-vincolato che non riesce ad accogliere "
                    f"le combinazioni dei docenti assegnati negli slot rimasti."
                )
            elif pivot_subject and any(w in pivot_subject.lower() for w in ["motori", "sport", "informatic"]):
                root_cause_type = "ROOM_CAPACITY"
                root_cause_summary = (
                    f"La materia '{pivot_subject}' richiede spazi specifici a capienza limitata (Palestra / Laboratorio) "
                    f"che risultano saturi o in collisione nelle giornate richieste."
                )
            else:
                root_cause_type = "GLOBAL_CONSTRAINTS_DEADLOCK"
                root_cause_summary = (
                    "L'algoritmo FET ha raggiunto un deadlock nei cicli di ricollocamento ricorsivo. "
                    "I vincoli globali su ore buche e intervallo cambio plesso impediscono combinazioni alternative."
                )
        else:
            # Fase preventiva
            if v_report.get("critical_count", 0) > 0:
                root_cause_type = "PREVENTIVE_CRITICAL_CONFLICTS"
                root_cause_summary = (
                    f"Rilevati {v_report['critical_count']} conflitti matematici bloccanti. "
                    "FET non potrà trovare alcuna soluzione valida finché non verranno risolti questi vincoli."
                )
            elif v_report.get("warning_count", 0) > 0:
                root_cause_type = "PREVENTIVE_WARNINGS"
                root_cause_summary = (
                    f"Rilevati {v_report['warning_count']} potenziali colli di bottiglia (margini stretti o vincoli rigidi). "
                    "Rilassare preventivamente questi elementi assicura una compilazione immediata al 100%."
                )
            else:
                root_cause_type = "READY"
                root_cause_summary = "Progetto matematicamente bilanciato. Nessun conflitto o collo di bottiglia rilevato."

        # =========================================================================
        # COSTRUZIONE DELLA RELAXATION LADDER (Raccomandazioni a 3 Livelli)
        # =========================================================================

        # -------------------------------------------------------------------------
        # LIVELLO 1: RILASSAMENTO MORBIDO GLOBALE (Zero o Minimo Impatto Didattico)
        # -------------------------------------------------------------------------
        c_gaps_day = constraints.get("TEACHERS_MAX_GAPS_DAY", {})
        curr_gaps_day = int(c_gaps_day.get("val", 1))
        is_gaps_day_active = c_gaps_day.get("active", True)

        c_gaps_week = constraints.get("TEACHERS_MAX_GAPS_WEEK", {})
        curr_gaps_week = int(c_gaps_week.get("val", 1))
        is_gaps_week_active = c_gaps_week.get("active", True)

        c_bld_gap = constraints.get("TEACHERS_MIN_GAPS_BUILDING_CHANGES", {})
        curr_bld_gap = int(c_bld_gap.get("val", 1))
        is_bld_active = c_bld_gap.get("active", True)

        needs_level1 = (is_gaps_day_active and curr_gaps_day <= 1) or (is_gaps_week_active and curr_gaps_week <= 2) or (is_bld_active and curr_bld_gap > 0)

        # Azione Combo Livello 1: Applica tutto il Livello 1 in 1 click!
        if needs_level1:
            recommendations.append({
                "id": "relax_combo_level1",
                "level": 1,
                "level_label": "Livello 1: Rilassamento Morbido",
                "title": "⚡ Applica Pacchetto Rilassamento Morbido (Buche + Plessi)",
                "description": (
                    "Aumenta la tolleranza delle ore buche giornaliere (a 2h) e settimanali (a 3h) "
                    "e azzera l'intervallo obbligatorio tra plessi. Sblocca istantaneamente decine di "
                    "permutazioni orarie senza alterare cattedre o preferenze docenti."
                ),
                "impact": "ALTO",
                "badge": "Consigliato Subito",
                "badge_color": "ok",
                "action_type": "relax_level1_all",
                "action_payload": {
                    "gaps_day": max(2, curr_gaps_day + 1),
                    "gaps_week": max(3, curr_gaps_week + 1),
                    "building_gap": 0
                },
                "button_text": "Applica Tutto il Livello 1",
                "is_combo": True,
                "auto_applicable": True
            })

        # Raccomandazione 1A: Buche Giornaliere
        if is_gaps_day_active and curr_gaps_day <= 1:
            recommendations.append({
                "id": "relax_teacher_gaps_day",
                "level": 1,
                "level_label": "Livello 1: Rilassamento Morbido",
                "title": f"Aumenta Max Ore Buche Giornaliere Docenti (da {curr_gaps_day} a {curr_gaps_day + 1})",
                "description": (
                    f"Il vincolo impone max {curr_gaps_day} ora buca al giorno. "
                    f"Portare la tolleranza a {curr_gaps_day + 1} ore buche aumenta del 400% le combinazioni di scambio per FET."
                ),
                "impact": "ALTO",
                "badge": "Morbido",
                "badge_color": "ok",
                "action_type": "relax_teacher_gaps_day",
                "action_payload": {"new_val": curr_gaps_day + 1},
                "button_text": f"Allenta a {curr_gaps_day + 1} ora buca",
                "auto_applicable": True
            })

        # Raccomandazione 1B: Buche Settimanali
        if is_gaps_week_active and curr_gaps_week <= 2:
            recommendations.append({
                "id": "relax_teacher_gaps_week",
                "level": 1,
                "level_label": "Livello 1: Rilassamento Morbido",
                "title": f"Aumenta Max Ore Buche Settimanali Docenti (da {curr_gaps_week} a {curr_gaps_week + 1})",
                "description": (
                    f"Il limite è fissato a sole {curr_gaps_week} ore buche settimanali. "
                    "Un lieve allentamento permette di distribuire le lezioni senza cadere in cicli di scambio infiniti."
                ),
                "impact": "MEDIO",
                "badge": "Morbido",
                "badge_color": "info",
                "action_type": "relax_teacher_gaps_week",
                "action_payload": {"new_val": curr_gaps_week + 1},
                "button_text": f"Allenta a {curr_gaps_week + 1} ore/settimana",
                "auto_applicable": True
            })

        # Raccomandazione 1C: Intervallo Cambio Plesso
        if is_bld_active and curr_bld_gap > 0:
            recommendations.append({
                "id": "relax_building_gaps",
                "level": 1,
                "level_label": "Livello 1: Rilassamento Morbido",
                "title": "Azzera Temporaneamente il Gap Cambio Plesso (da 1 a 0 ore)",
                "description": (
                    f"Attualmente è imposta {curr_bld_gap} ora libera obbligatoria tra lezioni in Centrale e Succursale. "
                    "Azzerare il gap permette a FET di collocare le lezioni consecutive per i docenti itineranti."
                ),
                "impact": "MEDIO",
                "badge": "Plessi",
                "badge_color": "info",
                "action_type": "relax_building_gaps",
                "action_payload": {"new_val": 0},
                "button_text": "Azzera Gap Cambio Plesso",
                "auto_applicable": True
            })

        # -------------------------------------------------------------------------
        # LIVELLO 2: FLESSIBILITÀ MIRATA DOCENTI & CLASSI (Basso Impatto Didattico)
        # -------------------------------------------------------------------------
        # A. Conflitto con Ore Fissate vs Indisponibilità (sia preventivo che solver)
        for iss in v_report.get("issues", []):
            iid = iss.get("id", "")
            if iid.startswith("locked_teacher_unavail_"):
                # Esempio id: locked_teacher_unavail_{aid}_{t}_{slot_key}
                parts = iid.split("_")
                aid = parts[3]
                tname = parts[4]
                slot_key = "_".join(parts[5:])
                recommendations.append({
                    "id": f"fix_locked_unavail_{aid}_{tname}",
                    "level": 2,
                    "level_label": "Livello 2: Flessibilità Mirata",
                    "title": f"Rimuovi Indisponibilità Confliggente: {tname} ({slot_key.replace('|', ' ore ')})",
                    "description": (
                        f"L'attività fissata #{aid} è bloccata nello slot {slot_key.replace('|', ' ')}, "
                        f"ma il docente {tname} risulta non disponibile in tale orario. "
                        "Rimuovere l'indisponibilità sana all'istante il conflitto matematico bloccante."
                    ),
                    "impact": "CRITICO",
                    "badge": "Conflitto Diretto",
                    "badge_color": "err",
                    "action_type": "remove_single_unavailability",
                    "action_payload": {"teacher": tname, "slot": slot_key},
                    "button_text": f"Sblocca slot per {tname.split()[0]}",
                    "auto_applicable": True
                })

        # B. Docenti a Margine Zero / Negativo (Pigeonhole o Margine <= 2)
        teachers_dict = {t["name"]: t for t in teachers_list}
        top_critical_teachers = critical_teachers.most_common(4)
        for tname, score in top_critical_teachers:
            unavail_slots = t_avail.get(tname, [])
            if not unavail_slots:
                continue

            # Analisi intelligente delle indisponibilità: identifica le ore non da giorno libero
            # Un giorno intero con 5 o 6 ore indisponibili è verosimilmente il giorno libero
            day_counts = Counter(s.split("|")[0] for s in unavail_slots)
            free_day = next((d for d, cnt in day_counts.items() if cnt >= 5), None)

            # Slot periferici candidati alla rimozione (prime/ultime ore nei giorni di lezione)
            candidate_slots = [s for s in unavail_slots if not (free_day and s.startswith(free_day))]
            if not candidate_slots:
                candidate_slots = unavail_slots[:2]

            slots_to_free = candidate_slots[:2]
            slot_names_str = ", ".join(s.replace("|", " ") for s in slots_to_free)

            recommendations.append({
                "id": f"relax_unavail_{tname}",
                "level": 2,
                "level_label": "Livello 2: Flessibilità Mirata",
                "title": f"Apri 2 Ore di Disponibilità per: {tname}",
                "description": (
                    f"Il docente {tname} ha un punteggio critico elevato ({score}) ed ha {len(unavail_slots)} ore "
                    f"di indisponibilità impostate. Sbloccare 2 slot ({slot_names_str}) "
                    "consente all'algoritmo di collocare la sua cattedra senza conflitti a catena."
                ),
                "impact": "ALTO",
                "badge": "Docente Pivot",
                "badge_color": "warn",
                "action_type": "relax_teacher_unavailability",
                "action_payload": {"teacher": tname, "slots_to_remove": slots_to_free},
                "button_text": f"Apri 2 ore di {tname.split()[0]}",
                "auto_applicable": True
            })

        # C. Vincolo Giorni Minimi Docente Irraggiungibile o Eccessivo
        for iss in v_report.get("issues", []):
            if iss.get("id", "").startswith("teacher_min_days_"):
                ent_name = iss.get("entities", [{}])[0].get("name")
                if ent_name:
                    t_obj = teachers_dict.get(ent_name, {})
                    curr_min = t_obj.get("min_days", 5)
                    recommendations.append({
                        "id": f"relax_min_days_{ent_name}",
                        "level": 2,
                        "level_label": "Livello 2: Flessibilità Mirata",
                        "title": f"Riduci Minimo Giorni di Presenza per: {ent_name}",
                        "description": (
                            f"Il docente {ent_name} ha un vincolo di minimo {curr_min} giorni di presenza, "
                            "incompatibile con la disponibilità reale o con il monte ore assegnato. "
                            "Portare il vincolo a un valore compatibile risolve il blocco."
                        ),
                        "impact": "ALTO",
                        "badge": "Min Giorni",
                        "badge_color": "warn",
                        "action_type": "relax_min_days",
                        "action_payload": {"teacher": ent_name, "new_val": max(1, int(curr_min) - 1)},
                        "button_text": f"Riduci Min Giorni ({curr_min} → {max(1, int(curr_min) - 1)})",
                        "auto_applicable": True
                    })

        # D. Co-docenze Critiche
        for iss in v_report.get("issues", []):
            if iss.get("category") == "coteaching" and iss.get("severity") in ("critical", "warning"):
                aid = iss.get("id", "").split("_")[-1]
                tchs = [e["name"] for e in iss.get("entities", []) if e.get("type") == "teacher"]
                studs = [e["name"] for e in iss.get("entities", []) if e.get("type") == "class"]
                if len(tchs) >= 2:
                    t_more_unavail = max(tchs, key=lambda t: len(t_avail.get(t, [])))
                    recommendations.append({
                        "id": f"fix_coteaching_{aid}",
                        "level": 2,
                        "level_label": "Livello 2: Flessibilità Mirata",
                        "title": f"Sblocca Co-docenza Attività #{aid} ({tchs[0]} + {tchs[1]})",
                        "description": (
                            f"L'attività di compresenza su {', '.join(studs)} non trova slot coincidenti a sufficienza. "
                            f"Il docente {t_more_unavail} ha {len(t_avail.get(t_more_unavail, []))} ore di indisponibilità. "
                            "Aprire 2 slot garantisce la necessaria sovrapposizione."
                        ),
                        "impact": "ALTO",
                        "badge": "Co-docenza",
                        "badge_color": "warn",
                        "action_type": "relax_teacher_unavailability",
                        "action_payload": {"teacher": t_more_unavail, "slots_to_remove": t_avail.get(t_more_unavail, [])[:2]},
                        "button_text": f"Apri slot per {t_more_unavail.split()[0]}",
                        "auto_applicable": True
                    })

        # -------------------------------------------------------------------------
        # LIVELLO 3: INTERVENTO STRUTTURALE SUI BLOCCHI UTENTE (Ore Fissate)
        # -------------------------------------------------------------------------
        # Se c'è un'attività fissata critica o coinvolta nella catena di swap
        if critical_activity_id and critical_activity_id in locked_set:
            recommendations.append({
                "id": f"unlock_critical_act_{critical_activity_id}",
                "level": 3,
                "level_label": "Livello 3: Sblocco Vincoli Fissi",
                "title": f"Sblocca Attività Fissata #{critical_activity_id} (Punto di Rottura FET)",
                "description": (
                    f"L'attività critica #{critical_activity_id} ({critical_activity_desc or ''}) è bloccata "
                    "in posizione fissa dall'utente ed è stata identificata come il perno del deadlock. "
                    "Sbloccarla consente all'algoritmo di riallocarla liberamente e completare l'orario."
                ),
                "impact": "CRITICO",
                "badge": "Ora Fissata",
                "badge_color": "err",
                "action_type": "unlock_activity",
                "action_payload": {"activity_id": critical_activity_id},
                "button_text": f"Sblocca Attività #{critical_activity_id}",
                "auto_applicable": True
            })

        for lact in locked_in_chain[:3]:
            if lact["id"] != critical_activity_id:
                recommendations.append({
                    "id": f"unlock_chain_act_{lact['id']}",
                    "level": 3,
                    "level_label": "Livello 3: Sblocco Vincoli Fissi",
                    "title": f"Sblocca Attività #{lact['id']} ({lact.get('subject')})",
                    "description": (
                        f"L'attività #{lact['id']} ({', '.join(lact.get('teachers', []))} su {', '.join(lact.get('classes', []))}) "
                        "è bloccata e fa parte del ciclo di swap ricorsivo che ostacola la convergenza."
                    ),
                    "impact": "MEDIO",
                    "badge": "Ora Fissata",
                    "badge_color": "warn",
                    "action_type": "unlock_activity",
                    "action_payload": {"activity_id": lact["id"]},
                    "button_text": f"Sblocca #{lact['id']}",
                    "auto_applicable": True
                })

        # Se ci sono collisioni tra ore fissate
        for iss in v_report.get("issues", []):
            if iss.get("id", "").startswith("locked_") and "clash" in iss.get("id", ""):
                ent_acts = [e["id"] for e in iss.get("entities", []) if e.get("type") == "activity"]
                if len(ent_acts) >= 2:
                    recommendations.append({
                        "id": f"resolve_clash_{ent_acts[0]}_{ent_acts[1]}",
                        "level": 3,
                        "level_label": "Livello 3: Sblocco Vincoli Fissi",
                        "title": f"Risolvi Conflitto Sovrapposizione: #{ent_acts[0]} vs #{ent_acts[1]}",
                        "description": (
                            f"Due attività fissate ({' e '.join('#' + a for a in ent_acts[:2])}) sono state posizionate "
                            "nello stesso identico orario per la stessa entità. Sbloccarne una rimuove il blocco."
                        ),
                        "impact": "CRITICO",
                        "badge": "Doppia Assegnazione",
                        "badge_color": "err",
                        "action_type": "unlock_activity",
                        "action_payload": {"activity_id": ent_acts[1]},
                        "button_text": f"Sblocca #{ent_acts[1]}",
                        "auto_applicable": True
                    })

        # Entità collo di bottiglia formattate per la UI
        for tname, sc in critical_teachers.most_common(6):
            bottleneck_entities.append({
                "type": "teacher",
                "name": tname,
                "score": sc,
                "unavail_count": len(t_avail.get(tname, []))
            })
        for cname, sc in critical_classes.most_common(6):
            bottleneck_entities.append({
                "type": "class",
                "name": cname,
                "score": sc
            })

        return {
            "is_solver_phase": is_solver_phase,
            "has_bottlenecks": len(recommendations) > 0 or critical_activity_id is not None,
            "root_cause_type": root_cause_type,
            "root_cause_summary": root_cause_summary,
            "pivot_teacher": pivot_teacher,
            "pivot_class": pivot_class,
            "pivot_subject": pivot_subject,
            "critical_activity": {
                "id": critical_activity_id,
                "description": critical_activity_desc
            } if critical_activity_id else None,
            "max_placed_info": max_placed_info,
            "critical_activities_chain": critical_activities_chain[:15],
            "bottleneck_entities": bottleneck_entities,
            "recommendations": recommendations,
            "recommendations_by_level": {
                "level1": [r for r in recommendations if r.get("level") == 1],
                "level2": [r for r in recommendations if r.get("level") == 2],
                "level3": [r for r in recommendations if r.get("level") == 3]
            },
            "health_score": v_report.get("health_score", 100),
            "status": v_report.get("status", "PRONTO")
        }

    @classmethod
    def apply_relaxation(
        cls,
        data: Dict[str, Any],
        action_type: str,
        payload: Dict[str, Any]
    ) -> Tuple[Dict[str, Any], str]:
        """
        Applica la modifica richiesta al dizionario dei dati del progetto e restituisce
        il messaggio descrittivo dell'azione svolta.
        """
        msg = "Nessuna azione eseguita."

        if action_type == "relax_teacher_gaps_day":
            new_val = int(payload.get("new_val", 2))
            if "constraints" not in data:
                data["constraints"] = {}
            if "TEACHERS_MAX_GAPS_DAY" not in data["constraints"]:
                data["constraints"]["TEACHERS_MAX_GAPS_DAY"] = {
                    "active": True, "val": new_val, "weight": 100,
                    "name": "Docenti: Max ore buche al giorno", "category": "Docenti",
                    "desc": "Numero massimo di ore libere tra le lezioni nella stessa giornata per i docenti."
                }
            else:
                data["constraints"]["TEACHERS_MAX_GAPS_DAY"]["val"] = new_val
                data["constraints"]["TEACHERS_MAX_GAPS_DAY"]["active"] = True
            msg = f"Vincolo Max Ore Buche Giornaliere Docenti impostato con successo a {new_val}."

        elif action_type == "relax_teacher_gaps_week":
            new_val = int(payload.get("new_val", 3))
            if "constraints" not in data:
                data["constraints"] = {}
            if "TEACHERS_MAX_GAPS_WEEK" not in data["constraints"]:
                data["constraints"]["TEACHERS_MAX_GAPS_WEEK"] = {
                    "active": True, "val": new_val, "weight": 100,
                    "name": "Docenti: Max ore buche a settimana", "category": "Docenti",
                    "desc": "Numero massimo totale di ore buche settimanali per ciascun docente."
                }
            else:
                data["constraints"]["TEACHERS_MAX_GAPS_WEEK"]["val"] = new_val
                data["constraints"]["TEACHERS_MAX_GAPS_WEEK"]["active"] = True
            msg = f"Vincolo Max Ore Buche Settimanali Docenti impostato con successo a {new_val}."

        elif action_type == "relax_building_gaps":
            new_val = int(payload.get("new_val", 0))
            if "constraints" not in data:
                data["constraints"] = {}
            if "TEACHERS_MIN_GAPS_BUILDING_CHANGES" not in data["constraints"]:
                data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"] = {
                    "active": new_val > 0, "val": new_val, "weight": 100,
                    "name": "Docenti: Min intervallo cambio plesso", "category": "Spostamenti",
                    "desc": "Ore buche minime obbligatorie tra lezioni in plessi diversi."
                }
            else:
                data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["val"] = new_val
                data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["active"] = (new_val > 0)
            msg = f"Vincolo Intervallo Cambio Plesso aggiornato a {new_val} ore (attivo: {new_val > 0})."

        elif action_type == "relax_level1_all":
            # Applica in un solo passaggio Buche Giorno + Buche Settimana + Gap Plesso
            gaps_d = int(payload.get("gaps_day", 2))
            gaps_w = int(payload.get("gaps_week", 3))
            bld_g = int(payload.get("building_gap", 0))

            if "constraints" not in data:
                data["constraints"] = {}

            if "TEACHERS_MAX_GAPS_DAY" in data["constraints"]:
                data["constraints"]["TEACHERS_MAX_GAPS_DAY"]["val"] = gaps_d
                data["constraints"]["TEACHERS_MAX_GAPS_DAY"]["active"] = True
            if "TEACHERS_MAX_GAPS_WEEK" in data["constraints"]:
                data["constraints"]["TEACHERS_MAX_GAPS_WEEK"]["val"] = gaps_w
                data["constraints"]["TEACHERS_MAX_GAPS_WEEK"]["active"] = True
            if "TEACHERS_MIN_GAPS_BUILDING_CHANGES" in data["constraints"]:
                data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["val"] = bld_g
                data["constraints"]["TEACHERS_MIN_GAPS_BUILDING_CHANGES"]["active"] = (bld_g > 0)

            msg = f"Pacchetto Livello 1 applicato con successo: Buche giorno={gaps_d}, Buche settimana={gaps_w}, Gap plessi={bld_g}."

        elif action_type == "relax_teacher_unavailability":
            teacher = payload.get("teacher")
            slots_to_remove = set(payload.get("slots_to_remove", []))
            if teacher and "teacher_availability" in data:
                curr = data["teacher_availability"].get(teacher, [])
                new_list = [s for s in curr if s not in slots_to_remove]
                data["teacher_availability"][teacher] = new_list
                removed_count = len(curr) - len(new_list)
                msg = f"Rimosse con successo {removed_count} ore di indisponibilità per il docente {teacher}."

        elif action_type == "remove_single_unavailability":
            teacher = payload.get("teacher")
            slot = payload.get("slot")
            if teacher and slot and "teacher_availability" in data:
                curr = data["teacher_availability"].get(teacher, [])
                if slot in curr:
                    curr.remove(slot)
                    data["teacher_availability"][teacher] = curr
                    msg = f"Slot {slot.replace('|', ' ')} rimosso dalle indisponibilità di {teacher}."
                else:
                    msg = f"Slot {slot} non presente nelle indisponibilità di {teacher}."

        elif action_type == "relax_min_days":
            teacher = payload.get("teacher")
            new_val = int(payload.get("new_val", 4))
            # Aggiorna profilo docente
            for t in data.get("teachers", []):
                if t.get("name") == teacher:
                    t["min_days"] = new_val
            # Aggiorna anche extra_time_constraints se presente
            for item in data.get("extra_time_constraints", []):
                if item.get("tag") == "ConstraintTeacherMinDaysPerWeek":
                    xml_str = item.get("xml", "")
                    if f"<Teacher>{teacher}</Teacher>" in xml_str:
                        item["xml"] = re.sub(
                            r"<Minimum_Days_Per_Week>\d+</Minimum_Days_Per_Week>",
                            f"<Minimum_Days_Per_Week>{new_val}</Minimum_Days_Per_Week>",
                            xml_str
                        )
            msg = f"Vincolo Min Giorni di Presenza per {teacher} aggiornato a {new_val} giorni."

        elif action_type == "unlock_activity":
            act_id = str(payload.get("activity_id"))
            locked_list = [str(x) for x in data.get("locked_activities", [])]
            if act_id in locked_list:
                locked_list.remove(act_id)
                data["locked_activities"] = locked_list
                msg = f"Attività #{act_id} sbloccata con successo dalle posizioni fisse."

        elif action_type == "unlock_multiple_activities":
            act_ids = set(str(x) for x in payload.get("activity_ids", []))
            locked_list = [str(x) for x in data.get("locked_activities", []) if str(x) not in act_ids]
            data["locked_activities"] = locked_list
            msg = f"Sbloccate con successo {len(act_ids)} attività fisse."

        return data, msg
