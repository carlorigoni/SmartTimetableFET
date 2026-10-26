"""
Eurario - Modulo Pre-Validatore dei Vincoli (Fase 2)
Esegue controlli statici matematici e algebrici (Pigeonhole principle, saturazione spazi,
disponibilità incrociate, cambi plesso e ore bloccate) prima del lancio di FET.
"""

from typing import Dict, List, Any, Set, Tuple
import re


class TimetablePreValidator:
    """
    Motore di validazione statica preventiva per orari scolastici.
    Identifica conflitti bloccanti (che renderebbero impossibile la generazione FET)
    e colli di bottiglia ad alto rischio di stallo.
    """

    def __init__(self, data: Dict[str, Any]):
        self.data = data
        self.days = data.get("days", [])
        self.hours = data.get("hours", [])
        self.break_times = set(data.get("break_times", []))
        self.day_hours_limit = data.get("day_hours_limit", {})
        self.teachers = data.get("teachers", [])
        self.classes = data.get("classes", [])
        self.rooms = data.get("rooms", [])
        self.activities = data.get("activities", [])
        self.t_avail = data.get("teacher_availability", {})
        self.c_avail = data.get("class_availability", {})
        self.constraints = data.get("constraints", {})
        self.extra_tc = data.get("extra_time_constraints", [])
        self.extra_sc = data.get("extra_space_constraints", [])
        self.locked_activities = set(str(x) for x in data.get("locked_activities", []))
        self.timetable = data.get("timetable", {})

        # Calcola gli slot di insegnamento effettivi (esclusi INT e pause)
        self.teaching_slots: List[str] = []
        self.slots_by_day: Dict[str, List[str]] = {d: [] for d in self.days}
        for d in self.days:
            lim = int(self.day_hours_limit.get(d, 8))
            for h in self.hours:
                if h.startswith("INT"):
                    continue
                if h.isdigit() and int(h) > lim:
                    continue
                slot = f"{d}|{h}"
                if slot not in self.break_times:
                    self.teaching_slots.append(slot)
                    self.slots_by_day[d].append(slot)

        self.total_slots = len(self.teaching_slots)

    def validate(self) -> Dict[str, Any]:
        """
        Esegue la suite completa di controlli e restituisce il report di diagnosi.
        """
        issues: List[Dict[str, Any]] = []

        # 1. Controlli Cattedre e Capacità Docenti
        issues.extend(self._validate_teachers())

        # 2. Controlli Classi e Calendario
        issues.extend(self._validate_classes())

        # 3. Saturazione Spazi (Palestre, Laboratori Info, Aule)
        room_saturations, room_issues = self._validate_rooms()
        issues.extend(room_issues)

        # 4. Co-docenze e Compresenze
        issues.extend(self._validate_coteaching())

        # 5. Attività Bloccate (Locked Activities)
        issues.extend(self._validate_locked_activities())

        # 6. Spostamento tra Plessi / Sedi
        issues.extend(self._validate_building_switches())

        # Calcolo Metriche e Health Score
        critical_count = sum(1 for i in issues if i["severity"] == "critical")
        warning_count = sum(1 for i in issues if i["severity"] == "warning")
        info_count = sum(1 for i in issues if i["severity"] == "info")

        # Health score: 100 base
        if critical_count > 0:
            score = max(0, min(45, round(100 - (critical_count * 25) - (warning_count * 0.5))))
            status = "BLOCCANTE"
            status_color = "err"
        elif warning_count > 0:
            score = max(55, min(95, round(100 - (warning_count * 0.5) - (info_count * 0.1))))
            status = "ATTENZIONE" if warning_count > 15 else "BUONO"
            status_color = "warn"
        else:
            score = 100
            status = "PRONTO"
            status_color = "ok"

        # Conteggi sintetici
        teachers_with_issues = len(set(
            ent["name"] for iss in issues for ent in iss.get("entities", []) if ent.get("type") == "teacher"
        ))
        classes_with_issues = len(set(
            ent["name"] for iss in issues for ent in iss.get("entities", []) if ent.get("type") == "class"
        ))

        return {
            "health_score": score,
            "status": status,
            "status_color": status_color,
            "critical_count": critical_count,
            "warning_count": warning_count,
            "info_count": info_count,
            "total_issues": len(issues),
            "issues": issues,
            "summary_metrics": {
                "total_institute_slots": self.total_slots,
                "total_teachers": len(self.teachers),
                "teachers_with_issues": teachers_with_issues,
                "total_classes": len(self.classes),
                "classes_with_issues": classes_with_issues,
                "total_rooms": len(self.rooms),
                "room_saturations": room_saturations,
                "locked_activities_count": len(self.locked_activities)
            }
        }

    def _validate_teachers(self) -> List[Dict[str, Any]]:
        issues = []
        teacher_hours: Dict[str, int] = {}
        teacher_acts_count: Dict[str, int] = {}

        for a in self.activities:
            if not a.get("active", True):
                continue
            dur = a.get("duration", 1)
            for t in a.get("teachers", []):
                teacher_hours[t] = teacher_hours.get(t, 0) + dur
                teacher_acts_count[t] = teacher_acts_count.get(t, 0) + 1

        # Limite ore giornaliere istituzionale
        max_daily_default = 6
        c_max_h = self.constraints.get("TEACHERS_MAX_HOURS_DAY", {})
        if c_max_h.get("active", False):
            max_daily_default = int(c_max_h.get("val", 6))

        # Estrai vincoli Min Giorni e Max Giorni per docente
        teacher_min_days: Dict[str, int] = {}
        teacher_max_days: Dict[str, int] = {}
        for item in self.extra_tc:
            if item.get("tag") == "ConstraintTeacherMinDaysPerWeek":
                xml = item.get("xml", "")
                m_t = re.search(r"<Teacher>(.*?)</Teacher>", xml)
                m_d = re.search(r"<Minimum_Days_Per_Week>(\d+)</Minimum_Days_Per_Week>", xml)
                if m_t and m_d:
                    teacher_min_days[m_t.group(1)] = int(m_d.group(1))
            elif item.get("tag") == "ConstraintTeacherMaxDaysPerWeek":
                xml = item.get("xml", "")
                m_t = re.search(r"<Teacher>(.*?)</Teacher>", xml)
                m_d = re.search(r"<Max_Days_Per_Week>(\d+)</Max_Days_Per_Week>", xml)
                if m_t and m_d:
                    teacher_max_days[m_t.group(1)] = int(m_d.group(1))

        for t in self.teachers:
            tname = t.get("name", "")
            # Priorità alle impostazioni dirette nel profilo docente se presenti
            if t.get("min_days") is not None:
                try:
                    teacher_min_days[tname] = int(t["min_days"])
                except (ValueError, TypeError):
                    pass
            if t.get("max_days") is not None:
                try:
                    teacher_max_days[tname] = int(t["max_days"])
                except (ValueError, TypeError):
                    pass

            target = t.get("target_hours", 18)
            assigned = teacher_hours.get(tname, 0)
            unavail = set(self.t_avail.get(tname, []))

            # Calcolo slot aperti per il docente
            avail_slots = [s for s in self.teaching_slots if s not in unavail]
            avail_count = len(avail_slots)

            # Giorni con almeno 1 slot disponibile
            avail_days = set(s.split("|")[0] for s in avail_slots)
            avail_days_count = len(avail_days)

            # --- A. CHECK BLOCCANTE: PIGEONHOLE (Ore assegnate > Slot disponibili) ---
            if assigned > avail_count:
                issues.append({
                    "id": f"teacher_pigeonhole_{tname}",
                    "category": "teachers",
                    "severity": "critical",
                    "title": f"Cattedra Impossibile: {tname}",
                    "description": (
                        f"Il docente ha {assigned} ore di lezione assegnate, ma solo {avail_count} slot "
                        f"disponibili nel calendario (indisponibilità: {len(unavail)} ore). "
                        f"È matematicamente impossibile collocare tutte le lezioni!"
                    ),
                    "entities": [{"type": "teacher", "id": tname, "name": tname}],
                    "recommendation": f"Rimuovi almeno {assigned - avail_count} ore di indisponibilità nella griglia del docente.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": tname}}
                })

            # --- B. CHECK BLOCCANTE: CAPACITÀ GIORNALIERA (assigned > giorni_disponibili * max_daily) ---
            elif assigned > (avail_days_count * max_daily_default):
                max_possible = avail_days_count * max_daily_default
                issues.append({
                    "id": f"teacher_daily_overflow_{tname}",
                    "category": "teachers",
                    "severity": "critical",
                    "title": f"Superamento Limite Giornaliero: {tname}",
                    "description": (
                        f"Il docente ha {assigned} ore su {avail_days_count} giorni disponibili. "
                        f"Con il vincolo di max {max_daily_default} ore al giorno, può svolgere al massimo "
                        f"{max_possible} ore. Mancano {assigned - max_possible} ore di capienza!"
                    ),
                    "entities": [{"type": "teacher", "id": tname, "name": tname}],
                    "recommendation": f"Aumenta i giorni di presenza o eleva il limite di ore giornaliere per il docente.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": tname}}
                })

            # --- C. CHECK MINIMO E MASSIMO GIORNI PER WEEK ---
            min_days = teacher_min_days.get(tname)
            max_days = teacher_max_days.get(tname)
            if min_days is not None and max_days is not None and min_days > max_days:
                issues.append({
                    "id": f"teacher_min_gt_max_days_{tname}",
                    "category": "teachers",
                    "severity": "critical",
                    "title": f"Minimo Giorni Superiore al Massimo: {tname}",
                    "description": (
                        f"Configurazione contraddittoria: richiesto minimo {min_days} giorni ma massimo {max_days} giorni. "
                        "FET andrà in errore bloccante immediato."
                    ),
                    "entities": [{"type": "teacher", "id": tname, "name": tname}],
                    "recommendation": f"Riallinea i giorni: imposta min_days <= max_days per il docente.",
                    "quick_action": {"type": "navigate", "target": "constraints", "payload": {"teacher": tname}}
                })

            if min_days is not None:
                if min_days > avail_days_count:
                    issues.append({
                        "id": f"teacher_min_days_unreachable_{tname}",
                        "category": "teachers",
                        "severity": "critical",
                        "title": f"Minimo Giorni Irraggiungibile: {tname}",
                        "description": (
                            f"È richiesto un minimo di {min_days} giorni di presenza, ma il docente "
                            f"ha disponibilità solo in {avail_days_count} giorni settimanali."
                        ),
                        "entities": [{"type": "teacher", "id": tname, "name": tname}],
                        "recommendation": f"Riduci il vincolo di presenza minima a {avail_days_count} giorni o apri disponibilità.",
                        "quick_action": {"type": "navigate", "target": "constraints", "payload": {"teacher": tname}}
                    })
                elif min_days > assigned and assigned > 0:
                    issues.append({
                        "id": f"teacher_min_days_gt_hours_{tname}",
                        "category": "teachers",
                        "severity": "warning",
                        "title": f"Minimo Giorni Superiore alle Ore: {tname}",
                        "description": (
                            f"Il vincolo richiede almeno {min_days} giorni di presenza, ma il docente ha "
                            f"soltanto {assigned} ore assegnate (impossibile fare almeno 1 ora al giorno)."
                        ),
                        "entities": [{"type": "teacher", "id": tname, "name": tname}],
                        "recommendation": f"Porta il minimo di giorni a {assigned} o meno.",
                        "quick_action": {"type": "navigate", "target": "constraints", "payload": {"teacher": tname}}
                    })

            # --- D. CHECK DISCREPANZA MONTE ORE TARGET vs ASSEGNATE ---
            if assigned != target:
                diff = assigned - target
                issues.append({
                    "id": f"teacher_target_diff_{tname}",
                    "category": "teachers",
                    "severity": "warning" if abs(diff) > 2 else "info",
                    "title": f"Discrepanza Ore Cattedra: {tname}",
                    "description": (
                        f"Ore contrattuali target: {target}h. Ore effettivamente assegnate da attività: {assigned}h "
                        f"({'+' if diff > 0 else ''}{diff}h rispetto al target)."
                    ),
                    "entities": [{"type": "teacher", "id": tname, "name": tname}],
                    "recommendation": "Verifica le cattedre e le attività assegnate nella sezione Docenti.",
                    "quick_action": {"type": "navigate", "target": "teachers", "payload": {"teacher": tname}}
                })

            # --- E. CHECK MARGINE TROPPO STRETTO (COLLO DI BOTTIGLIA) ---
            if assigned > 0 and assigned <= avail_count and (avail_count - assigned <= 2):
                margin = avail_count - assigned
                issues.append({
                    "id": f"teacher_tight_margin_{tname}",
                    "category": "teachers",
                    "severity": "warning",
                    "title": f"Flessibilità Oraria Minima: {tname}",
                    "description": (
                        f"Il docente ha {assigned} ore assegnate su {avail_count} slot aperti. "
                        f"Margine residuo di soli {margin} slot liberi in tutta la settimana. "
                        f"Elevato rischio di conflitti durante la generazione dell'orario."
                    ),
                    "entities": [{"type": "teacher", "id": tname, "name": tname}],
                    "recommendation": "Se il risolutore stalla, sblocca 1 o 2 ore di disponibilità aggiuntive.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": tname}}
                })

        return issues

    def _validate_classes(self) -> List[Dict[str, Any]]:
        issues = []
        class_hours: Dict[str, int] = {}

        for a in self.activities:
            if not a.get("active", True):
                continue
            dur = a.get("duration", 1)
            for s in a.get("students", []):
                class_hours[s] = class_hours.get(s, 0) + dur

        for c in self.classes:
            cname = c.get("name", "")
            ch = class_hours.get(cname, 0)
            unavail = set(self.c_avail.get(cname, []))
            avail_slots = [s for s in self.teaching_slots if s not in unavail]
            avail_count = len(avail_slots)

            # Se la classe è articolata in gruppi (es. 3A con 3AM e 3AR),
            # consideriamo la somma ore comune + gruppo massimo
            subgroups = [g for g in class_hours.keys() if g.startswith(cname) and g != cname]
            max_subgroup_h = max([class_hours[g] for g in subgroups], default=0)
            effective_class_hours = ch + max_subgroup_h

            # --- A. CHECK BLOCCANTE: Ore Classe > Slot Disponibili ---
            if effective_class_hours > avail_count:
                issues.append({
                    "id": f"class_overflow_{cname}",
                    "category": "classes",
                    "severity": "critical",
                    "title": f"Monte Ore Eccessivo per Classe {cname}",
                    "description": (
                        f"La classe {cname} richiede {effective_class_hours} ore settimanali "
                        f"({'comuni ' + str(ch) + 'h + ' + str(max_subgroup_h) + 'h articolate' if max_subgroup_h else ''}), "
                        f"ma ha soltanto {avail_count} slot orari aperti nel calendario scolastico. "
                        f"FET non potrà mai completare l'orario!"
                    ),
                    "entities": [{"type": "class", "id": cname, "name": cname}],
                    "recommendation": f"Riduci le indisponibilità della classe {cname} o riallinea il piano di studi.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"class": cname}}
                })

            # --- B. CHECK MARGINE ZERO (Saturazione 100%) ---
            elif effective_class_hours == avail_count and effective_class_hours > 0:
                issues.append({
                    "id": f"class_zero_margin_{cname}",
                    "category": "classes",
                    "severity": "info",
                    "title": f"Saturazione Completa (100%): Classe {cname}",
                    "description": (
                        f"La classe {cname} occupa esattamente tutti i {avail_count} slot aperti. "
                        f"Ogni singola ora libera è vincolata e tutti i docenti devono combinarsi senza alcuna tolleranza."
                    ),
                    "entities": [{"type": "class", "id": cname, "name": cname}],
                    "recommendation": "Nessuna azione richiesta a meno di deadlock nei docenti di questa classe.",
                    "quick_action": {"type": "navigate", "target": "classes", "payload": {"class": cname}}
                })

        return issues

    def _validate_rooms(self) -> Tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
        """
        Calcola la saturazione per tipologia di spazio:
        - Palestre (scienze motorie/sport)
        - Laboratori Informatica
        - Aule con vincoli specifici
        """
        issues: List[Dict[str, Any]] = []
        saturations: List[Dict[str, Any]] = []

        valid_rooms = {r["name"] for r in self.rooms}

        # 1. Analisi Palestre
        gym_rooms = [r for r in self.rooms if r.get("room_type") == "gym" or "palestra" in r.get("name", "").lower()]
        if gym_rooms:
            motori_acts = [
                a for a in self.activities
                if a.get("active", True) and ("motori" in (a.get("subject") or "").lower() or "sport" in (a.get("subject") or "").lower())
            ]
            total_motori_hours = sum(a.get("duration", 1) for a in motori_acts)
            # Calcola la capacità totale considerando la contemporaneità (fino a 3 classi per la Palestra da 57 posti)
            total_gym_slots = sum(r.get("max_concurrent", 3 if r.get("capacity", 0) >= 50 else 1) * self.total_slots for r in gym_rooms)
            pct_gym = round((total_motori_hours / total_gym_slots) * 100, 1) if total_gym_slots > 0 else 0

            status = "ok"
            if pct_gym > 100:
                status = "danger"
                issues.append({
                    "id": "gym_overbooked",
                    "category": "rooms",
                    "severity": "critical",
                    "title": "Sovraccarico Bloccante Palestra",
                    "description": (
                        f"Richieste {total_motori_hours} ore di Scienze Motorie a fronte di una capienza "
                        f"massima di {total_gym_slots} ore-classe ({total_gym_slots // self.total_slots} classi contemporanee × {self.total_slots} slot). "
                        f"Saturazione al {pct_gym}% (> 100%)."
                    ),
                    "entities": [{"type": "room", "id": r.get("name", ""), "name": r.get("name", "")} for r in gym_rooms],
                    "recommendation": "Riduci le ore di attività motoria o estendi gli slot settimanali.",
                    "quick_action": {"type": "navigate", "target": "rooms", "payload": {}}
                })
            elif pct_gym >= 85:
                status = "warn"
                issues.append({
                    "id": "gym_high_saturation",
                    "category": "rooms",
                    "severity": "warning",
                    "title": "Elevata Saturazione Palestra",
                    "description": (
                        f"La Palestra è satura all' {pct_gym}% ({total_motori_hours}/{total_gym_slots} ore-classe). "
                        f"La combinazione con i vincoli orari delle classi potrebbe causare colli di bottiglia."
                    ),
                    "entities": [{"type": "room", "id": r.get("name", ""), "name": r.get("name", "")} for r in gym_rooms],
                    "recommendation": "Monitora la compilazione FET; se stalla su scienze motorie, allenta i vincoli di giornata.",
                    "quick_action": {"type": "navigate", "target": "rooms", "payload": {}}
                })

            saturations.append({
                "room": "Palestra (Centrale - Max 57 alunni, 2-3 classi)",
                "type": "palestra",
                "assigned_hours": total_motori_hours,
                "capacity_slots": total_gym_slots,
                "pct": pct_gym,
                "status": status
            })

        # 2. Analisi Laboratori Informatica
        info_rooms = sorted([r for r in valid_rooms if "info" in r.lower()])
        if info_rooms:
            info_acts = [
                a for a in self.activities
                if a.get("active", True) and "informatic" in (a.get("subject") or "").lower()
            ]
            total_info_hours = sum(a.get("duration", 1) for a in info_acts)
            info_capacity = len(info_rooms) * self.total_slots
            pct_info = round((total_info_hours / info_capacity) * 100, 1) if info_capacity > 0 else 0

            status = "ok"
            if pct_info > 100:
                status = "danger"
                issues.append({
                    "id": "info_overbooked",
                    "category": "rooms",
                    "severity": "critical",
                    "title": "Sovraccarico Bloccante Laboratori Informatica",
                    "description": (
                        f"Richieste {total_info_hours} ore di Informatica a fronte di una capienza di {info_capacity} ore "
                        f"({len(info_rooms)} laboratori × {self.total_slots} slot). Saturazione: {pct_info}%."
                    ),
                    "entities": [{"type": "room", "id": r, "name": r} for r in info_rooms],
                    "recommendation": "Aggiungi un'ulteriore aula informatizzata o svincola alcune ore verso le aule base.",
                    "quick_action": {"type": "navigate", "target": "rooms", "payload": {}}
                })
            elif pct_info >= 85:
                status = "warn"
                issues.append({
                    "id": "info_high_saturation",
                    "category": "rooms",
                    "severity": "warning",
                    "title": "Elevata Saturazione Lab. Informatica",
                    "description": (
                        f"I {len(info_rooms)} laboratori di informatica hanno saturazione dell' {pct_info}% "
                        f"({total_info_hours}/{info_capacity} ore)."
                    ),
                    "entities": [{"type": "room", "id": r, "name": r} for r in info_rooms],
                    "recommendation": "Verifica che non vi siano troppe classi con informatica negli stessi giorni.",
                    "quick_action": {"type": "navigate", "target": "rooms", "payload": {}}
                })

            saturations.append({
                "room": f"Lab. Informatica ({len(info_rooms)} spazi)",
                "type": "info",
                "assigned_hours": total_info_hours,
                "capacity_slots": info_capacity,
                "pct": pct_info,
                "status": status
            })

        return saturations, issues

    def _validate_coteaching(self) -> List[Dict[str, Any]]:
        """
        Verifica le attività in co-docenza (2 o più docenti sulla stessa attività):
        Interseca le disponibilità dei docenti e della classe per assicurare che esista
        un numero sufficiente di slot comuni.
        """
        issues = []
        teaching_slots_set = set(self.teaching_slots)

        for a in self.activities:
            if not a.get("active", True):
                continue
            tchs = a.get("teachers", [])
            if len(tchs) < 2:
                continue

            aid = str(a.get("id"))
            dur = a.get("duration", 1)
            subj = a.get("subject", "")
            studs = a.get("students", [])

            # Intersezione disponibilità docenti
            common = set(teaching_slots_set)
            for t in tchs:
                unavail = set(self.t_avail.get(t, []))
                common = common - unavail

            # Intersezione disponibilità classe
            for s in studs:
                c_unavail = set(self.c_avail.get(s, []))
                common = common - c_unavail

            common_count = len(common)

            if common_count < dur:
                issues.append({
                    "id": f"coteaching_no_common_slots_{aid}",
                    "category": "coteaching",
                    "severity": "critical",
                    "title": f"Co-docenza Senza Slot Comuni: Attività #{aid}",
                    "description": (
                        f"L'attività #{aid} ({subj} su {', '.join(studs)}) richiede {dur}h con "
                        f"{len(tchs)} docenti ({', '.join(tchs)}), ma l'intersezione delle disponibilità "
                        f"è di soli {common_count} slot comuni. Impossibile da svolgere in compresenza!"
                    ),
                    "entities": [
                        {"type": "activity", "id": aid, "name": f"#{aid} {subj}"},
                        *[{"type": "teacher", "id": t, "name": t} for t in tchs],
                        *[{"type": "class", "id": c, "name": c} for c in studs]
                    ],
                    "recommendation": "Rimuovi le indisponibilità coincidenti per i docenti in compresenza.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": tchs[0]}}
                })
            elif common_count <= dur + 2:
                issues.append({
                    "id": f"coteaching_tight_{aid}",
                    "category": "coteaching",
                    "severity": "warning",
                    "title": f"Co-docenza a Flessibilità Minima: Attività #{aid}",
                    "description": (
                        f"L'attività #{aid} ({subj} su {', '.join(studs)}) con {', '.join(tchs)} "
                        f"ha solo {common_count} slot orari liberi coincidenti per {dur}h di lezione."
                    ),
                    "entities": [
                        {"type": "activity", "id": aid, "name": f"#{aid} {subj}"},
                        *[{"type": "teacher", "id": t, "name": t} for t in tchs]
                    ],
                    "recommendation": "Valuta di concedere più ore aperte ai docenti coinvolti.",
                    "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": tchs[0]}}
                })

        return issues

    def _validate_locked_activities(self) -> List[Dict[str, Any]]:
        """
        Verifica che le ore fissate dall'utente (locked_activities) non generino collisioni
        dirette su docente, classe o aula, e non cadano su ore di pausa o indisponibili.
        """
        issues = []
        if not self.locked_activities:
            return issues

        acts_map = {str(a["id"]): a for a in self.activities}
        placed_teachers: Dict[str, str] = {}  # "tname|day|hour" -> aid
        placed_classes: Dict[str, str] = {}   # "cname|day|hour" -> aid
        placed_rooms: Dict[str, str] = {}     # "room|day|hour" -> aid

        for aid in self.locked_activities:
            pl = self.timetable.get(aid)
            act = acts_map.get(aid)
            if not pl or not act:
                continue

            # Non considerare le disposizioni
            if (act.get("subject") or "").strip().lower().startswith("disposiz"):
                continue

            day = pl.get("day", "")
            hour = pl.get("hour", "")
            room = pl.get("room", "")
            dur = act.get("duration", 1)

            # Slot orari occupati
            num_hours = [h for h in self.hours if not h.startswith("INT")]
            occupied_hours = [hour]
            if dur > 1 and hour in num_hours:
                idx = num_hours.index(hour)
                occupied_hours = num_hours[idx : idx + dur]

            for h_slot in occupied_hours:
                slot_key = f"{day}|{h_slot}"

                # 1. Verifica pausa
                if slot_key in self.break_times or h_slot.startswith("INT"):
                    issues.append({
                        "id": f"locked_on_break_{aid}_{slot_key}",
                        "category": "locks",
                        "severity": "critical",
                        "title": f"Attività Fissata in Pausa/Intervallo: #{aid}",
                        "description": (
                            f"L'attività fissata #{aid} ({act.get('subject')}) è posizionata a {day} {h_slot}ª ora, "
                            f"che è configurata come intervallo o orario chiuso d'istituto."
                        ),
                        "entities": [{"type": "activity", "id": aid, "name": f"#{aid} {act.get('subject')}"}],
                        "recommendation": "Sposta o sblocca l'attività dalla vista orario.",
                        "quick_action": {"type": "navigate", "target": "timetable", "payload": {"activity": aid}}
                    })

                # 2. Collisioni Docente
                for t in act.get("teachers", []):
                    t_unavail = set(self.t_avail.get(t, []))
                    if slot_key in t_unavail:
                        issues.append({
                            "id": f"locked_teacher_unavail_{aid}_{t}_{slot_key}",
                            "category": "locks",
                            "severity": "critical",
                            "title": f"Ora Fissata su Docente Indisponibile: #{aid}",
                            "description": (
                                f"L'attività #{aid} è bloccata a {day} {h_slot}ª ora per il docente {t}, "
                                f"ma il docente risulta INDISPONIBILE in tale slot!"
                            ),
                            "entities": [
                                {"type": "activity", "id": aid, "name": f"#{aid} {act.get('subject')}"},
                                {"type": "teacher", "id": t, "name": t}
                            ],
                            "recommendation": f"Rimuovi l'indisponibilità di {t} in {day} {h_slot}ª ora o sblocca l'attività.",
                            "quick_action": {"type": "navigate", "target": "availability", "payload": {"teacher": t}}
                        })

                    t_key = f"{t}|{slot_key}"
                    if t_key in placed_teachers:
                        other_id = placed_teachers[t_key]
                        issues.append({
                            "id": f"locked_teacher_clash_{aid}_{other_id}",
                            "category": "locks",
                            "severity": "critical",
                            "title": f"Conflitto Docente su Ore Fissate: {t}",
                            "description": (
                                f"Il docente {t} ha due attività fissate nello stesso identico orario ({day} {h_slot}ª ora): "
                                f"#{aid} e #{other_id}."
                            ),
                            "entities": [
                                {"type": "teacher", "id": t, "name": t},
                                {"type": "activity", "id": aid, "name": f"#{aid}"},
                                {"type": "activity", "id": other_id, "name": f"#{other_id}"}
                            ],
                            "recommendation": "Sblocca una delle due attività sovrapposte.",
                            "quick_action": {"type": "navigate", "target": "timetable", "payload": {}}
                        })
                    else:
                        placed_teachers[t_key] = aid

                # 3. Collisioni Classe
                for s in act.get("students", []):
                    c_key = f"{s}|{slot_key}"
                    if c_key in placed_classes:
                        other_id = placed_classes[c_key]
                        issues.append({
                            "id": f"locked_class_clash_{aid}_{other_id}",
                            "category": "locks",
                            "severity": "critical",
                            "title": f"Conflitto Classe su Ore Fissate: {s}",
                            "description": (
                                f"La classe {s} ha due attività bloccate contemporaneamente a {day} {h_slot}ª ora: "
                                f"#{aid} e #{other_id}."
                            ),
                            "entities": [
                                {"type": "class", "id": s, "name": s},
                                {"type": "activity", "id": aid, "name": f"#{aid}"},
                                {"type": "activity", "id": other_id, "name": f"#{other_id}"}
                            ],
                            "recommendation": "Sblocca o sposta una delle lezioni in conflitto.",
                            "quick_action": {"type": "navigate", "target": "timetable", "payload": {}}
                        })
                    else:
                        placed_classes[c_key] = aid

                # 4. Collisioni Aula
                if room:
                    r_key = f"{room}|{slot_key}"
                    if r_key in placed_rooms:
                        other_id = placed_rooms[r_key]
                        issues.append({
                            "id": f"locked_room_clash_{aid}_{other_id}",
                            "category": "locks",
                            "severity": "critical",
                            "title": f"Doppia Assegnazione Aula Fissata: {room}",
                            "description": (
                                f"L'aula {room} è occupata contemporaneamente a {day} {h_slot}ª ora dalle attività fissate "
                                f"#{aid} e #{other_id}."
                            ),
                            "entities": [
                                {"type": "room", "id": room, "name": room},
                                {"type": "activity", "id": aid, "name": f"#{aid}"}
                            ],
                            "recommendation": "Assegna una diversa aula a una delle due attività.",
                            "quick_action": {"type": "navigate", "target": "rooms", "payload": {}}
                        })
                    else:
                        placed_rooms[r_key] = aid

        return issues

    def _validate_building_switches(self) -> List[Dict[str, Any]]:
        """
        Verifica i docenti itineranti tra più plessi (es. Centrale e Succursale).
        Identifica situazioni con vincolo di gap cambio plesso attivo su giornate sature.
        """
        issues = []
        succursale_classes = {"1C", "2C", "3C", "4C", "5C", "3D", "4D", "5D", "3L", "4L", "5L"}

        teacher_buildings: Dict[str, Set[str]] = {}
        for a in self.activities:
            if not a.get("active", True):
                continue
            tchs = a.get("teachers", [])
            studs = a.get("students", [])
            blds = set()
            for s in studs:
                if s in succursale_classes:
                    blds.add("Succursale")
                else:
                    blds.add("Centrale")
            for t in tchs:
                if t not in teacher_buildings:
                    teacher_buildings[t] = set()
                teacher_buildings[t].update(blds)

        itineranti = [t for t, blds in teacher_buildings.items() if len(blds) > 1]
        c_bld_gap = self.constraints.get("TEACHERS_MIN_GAPS_BUILDING_CHANGES", {})
        gap_val = int(c_bld_gap.get("val", 1)) if c_bld_gap.get("active", True) else 0

        if itineranti and gap_val > 0:
            issues.append({
                "id": "multi_building_itinerant_summary",
                "category": "buildings",
                "severity": "info",
                "title": f"Docenti su Più Plessi ({len(itineranti)} Docenti Itineranti)",
                "description": (
                    f"Ci sono {len(itineranti)} docenti che insegnano sia in Centrale che in Succursale. "
                    f"Il vincolo 'Minimo Ore Buche per Cambio Plesso' è attivo con valore {gap_val} ora. "
                    f"FET inserirà automaticamente un'ora libera cuscinetto tra le lezioni in sedi diverse."
                ),
                "entities": [{"type": "teacher", "id": t, "name": t} for t in itineranti[:8]],
                "recommendation": "Se il risolutore incontra difficoltà su docenti con orario compatto, valuta di portare il gap a 0.",
                "quick_action": {"type": "navigate", "target": "constraints", "payload": {}}
            })

        return issues
