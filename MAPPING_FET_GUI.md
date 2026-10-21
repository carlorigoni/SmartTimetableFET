# Guida di Corrispondenza: Google Sheet (Configura FET) ➔ Interfaccia Grafica di FET

Questo documento descrive in dettaglio la corrispondenza tra ogni parametro, colonna e vincolo configurato nel foglio Google (**Configuratore FET / `Configura FET.gs`**) e la rispettiva schermata, menu o vincolo nell'interfaccia grafica ufficiale del programma **FET** (*Free Evolutionary Timetabling* - [lalescu.ro/liviu/fet](https://lalescu.ro/liviu/fet/)).

I percorsi dell'interfaccia grafica sono indicati sia in **Italiano** (lingua predefinita in Italia) sia con il riferimento **Inglese** e il corrispondente **Tag XML** generato nel file `.fet`.

---

## 1. Dati Istituzionali, Giorni e Ore (Tab *Parametri*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Nome istituto** | `<Institution_Name>` | `Dati > Informazioni istituto > Nome istituto`<br>*(Data > Institution Information > Institution Name)* | Compare nell'intestazione di tutte le stampe e orari esportati. |
| **Commenti** | `<Comments>` | `Dati > Informazioni istituto > Commenti`<br>*(Data > Institution Information > Comments)* | Testo informativo libero salvato nel file. |
| **Giorni** *(colonna Giorni)* | `<Days_List> > <Day>` | `Dati > Giorni e ore > Giorni della settimana`<br>*(Data > Days and Hours > Days per week)* | Elenco ordinato dei giorni (es. Lun, Mar, Mer, Gio, Ven). |
| **Ore** *(colonna Ore)* | `<Hours_List> > <Hour>` | `Dati > Giorni e ore > Ore del giorno`<br>*(Data > Days and Hours > Hours per day)* | Nomi delle ore (es. 1, 2, ... o `1 (08:00-09:00)` se abilitato il parametro dei nomi con orario). |
| **Intervallo = SI** | `<ConstraintBreakTimes>` | `Dati > Vincoli di tempo > Varie > Orari di pausa`<br>*(Data > Time Constraints > Miscellaneous > Break times)* | Crea uno slot di pausa obbligatorio per l'intero istituto: nessuna lezione può essere collocata qui. |
| **Ore al giorno** *(monte ore giornaliero)* | `<ConstraintBreakTimes>` | `Dati > Vincoli di tempo > Varie > Orari di pausa`<br>*(Data > Time Constraints > Miscellaneous > Break times)* | Tutte le ore successive al monte ore del giorno diventano slot di pausa (Break Times) per tutti. |

---

## 2. Plessi ed Edifici (Tab *Plessi*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Plesso** | `<Buildings_List> > <Building>` | `Dati > Spazio > Edifici`<br>*(Data > Space > Buildings)* | FET chiama i plessi scolastici **"Edifici"** (*Buildings*). Servono per vincolare i trasferimenti di docenti e classi. |
| **Note** | `<Comments>` (in Building) | Finestra modifica Edificio: campo **Commenti** | Informativo. |

---

## 3. Aule e Spazi (Tab *Aule*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Aula** | `<Rooms_List> > <Room>` | `Dati > Spazio > Aule`<br>*(Data > Space > Rooms)* | Nome univoco dell'aula o laboratorio (es. INFO1, Palestra, Aula 1A). |
| **Plesso** | `<Building>` (in Room) | `Dati > Spazio > Aule > [Modifica Aula] > Edificio` | Assegna l'aula all'edificio/plesso di appartenenza. |
| **Capienza** *(singola classe)* | `<Capacity>` (in Room) | `Dati > Spazio > Aule > [Modifica Aula] > Capacità` | Numero massimo di studenti ammessi nell'aula. |
| **Classi contemporanee > 1** *(es. Palestra)* | Moduli aula + `<ConstraintActivitiesMaxTotalNumberOfStudentsInSelectedTimeSlots>` | `Dati > Vincoli di tempo > Attività > Numero massimo totale di studenti per un insieme di attività in fasce orarie selezionate` | Per la palestra a più classi, lo script crea aule modulo (`Palestra_1`, `Palestra_2`...) e applica un vincolo aggregato sulla somma alunni. |
| **Aula di appoggio** | Logica script per `<ConstraintActivityPreferredRooms>` | `Dati > Vincoli di spazio > Attività > Un insieme di aule preferite per un'attività` | Definisce se l'aula può ospitare classi della Succursale in trasferta in Centrale. |

---

## 4. Materie (Tab *Materie*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Materia** | `<Subjects_List> > <Subject>` | `Dati > Materie`<br>*(Data > Subjects)* | Elenco delle materie d'insegnamento. |
| **Aule predefinite** | `<ConstraintActivityPreferredRoom(s)>` | `Dati > Vincoli di spazio > Attività > Un'aula (o insieme di aule) preferita per un'attività` | Assegna automaticamente l'aula/laboratorio a tutte le attività della materia. |
| **Ore preferite** *(PRIME / ULTIME)* | `<ConstraintActivitiesPreferredTimeSlots>` | `Dati > Vincoli di tempo > Attività > Orari preferiti per un insieme di attività` | Vincolo soft (con peso configurabile) per posizionare la materia nelle prime 4 ore o nelle ultime della mattina. |
| **Mai nei rientri** | `<ConstraintActivitiesPreferredTimeSlots>` | `Dati > Vincoli di tempo > Attività > Orari preferiti per un insieme di attività` | Seleziona tutte le ore del mattino e impone che la materia non vada nelle ore pomeridiane/rientri. |
| **In compresenza con** | Pre-elaborazione script | `Dati > Attività` *(compresenza docente teorico + ITP)* | Lo script fonde l'attività in un'unica attività con più docenti. |

---

## 5. Docenti (Tab *Docenti*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Docente** | `<Teachers_List> > <Teacher>` | `Dati > Docenti`<br>*(Data > Teachers)* | Anagrafica docente. |
| **Ore cattedra** | `<Target_Number_of_Hours>` | `Dati > Docenti > [Modifica Docente] > Numero target di ore` | Ore settimanali totali previste. |
| **Max giorni/settimana** | `<ConstraintTeacherMaxDaysPerWeek>` | `Dati > Vincoli di tempo > Docenti > Numero massimo di giorni a settimana per un docente` | Limita i giorni di servizio settimanale (es. 4 = almeno un giorno libero). |
| **Min giorni/settimana** | `<ConstraintTeacherMinDaysPerWeek>` | `Dati > Vincoli di tempo > Docenti > Numero minimo di giorni a settimana per un docente` | Impone la presenza minima (es. 5 per cattedre complete). |
| **Giorno libero tra** | Combinazione di:<br>`<ConstraintTeacherMaxDaysPerWeek>` +<br>`<ConstraintActivitiesOccupyMinTimeSlotsFromSelection>` | `Dati > Vincoli di tempo > Attività > Un insieme di attività occupa un numero minimo di fasce orarie da una selezione` | Garantisce che tra i giorni indicati (es. Mer, Ven) il docente sia presente in uno e libero nell'altro. |
| **Max ore/giorno** | `<ConstraintTeacherMaxHoursDaily>` | `Dati > Vincoli di tempo > Docenti > Ore massime giornaliere per un docente` | Massimo numero di ore di lezione in una singola giornata. |
| **Min ore/giorno** | `<ConstraintTeacherMinHoursDaily>` o `<ConstraintTeacherActivityTagMinHoursDaily>` | `Dati > Vincoli di tempo > Docenti > Ore minime giornaliere per un docente` | Minimo ore giornaliere nei giorni di presenza (`Allow_Empty_Days = true`). |
| **Max cambi plesso/giorno** | `<ConstraintTeacherMaxBuildingChangesPerDay>` | `Dati > Vincoli di spazio > Docenti > Numero massimo di cambi di edificio al giorno per un docente` | Limite trasferimenti giornalieri tra plessi diversi. |
| **Max cambi plesso/settimana** | `<ConstraintTeacherMaxBuildingChangesPerWeek>` | `Dati > Vincoli di spazio > Docenti > Numero massimo di cambi di edificio a settimana per un docente` | Limite trasferimenti settimanali totali. |
| **Min ore tra cambi plesso** | `<ConstraintTeacherMinGapsBetweenBuildingChanges>` | `Dati > Vincoli di spazio > Docenti > Intervallo minimo (in ore) tra cambi di edificio per un docente` | Ore buche necessarie tra una lezione in un plesso e la successiva nell'altro. |
| **Ore preferite** *(PRIME / ULTIME)* | `<ConstraintActivitiesPreferredTimeSlots>` | `Dati > Vincoli di tempo > Attività > Orari preferiti per un insieme di attività` | Preferenza morbida per collocare le attività del docente all'inizio o alla fine della giornata. |
| **Settimana = COMPATTA** | `<ConstraintMaxDaysBetweenActivities>` | `Dati > Vincoli di tempo > Attività > Numero massimo di giorni tra un insieme di attività` | Compatta le attività del docente nel minor numero di giorni consecutivi. |
| **Ore a disposizione** *(in FET)* | Attività con Subject `"Disposizione"` + vincoli di raggruppamento | `Dati > Attività` + `Vincoli di tempo > Attività > Due attività sono raggruppate` | Attività di sola presenza del docente, collocate attaccate alle sue lezioni. |
| **D fisse / libere dopo FET** | *Nessun tag FET* (Elaborazione post-FET) | Gestito dallo script nel tab **Orario** | Vengono collocate dallo script dopo la risoluzione di FET, per non appesantire l'algoritmo di calcolo. |

---

## 6. Classi e Gruppi (Tab *Classi* e *Gruppi*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Classe** | `<Students_List> > <Year>` | `Dati > Studenti > Anni`<br>*(Data > Students > Years)* | In FET ogni classe dell'istituto corrisponde a un **"Anno"** (*Year*). |
| **Gruppo** | `<Year> > <Group>` | `Dati > Studenti > Gruppi`<br>*(Data > Students > Groups)* | Suddivisione della classe per lingue o articolazioni (es. 4A SPA / 4A FRA). |
| **N. alunni** | `<Number_of_Students>` | `Dati > Studenti > [Modifica Anno/Gruppo] > Numero di studenti` | Utilizzato da FET per verificare la capienza delle aule e della palestra. |
| **Aula classe** | `<ConstraintStudentsSetHomeRoom>` | `Dati > Vincoli di spazio > Studenti > Aula base per un insieme di studenti` | Imposta l'aula fissa di riferimento della classe (*Home Room*). |
| **Ore al giorno** *(per classe)* | `<ConstraintStudentsSetNotAvailableTimes>` | `Dati > Vincoli di tempo > Studenti > Orari non disponibili per un insieme di studenti` | Se una classe ha meno ore (es. 6 ore nei giorni da 7/8), le ore finali vengono marcate come non disponibili. |

---

## 7. Attività Didattiche (Tab *Attivita*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Attività completa** | `<Activities_List> > <Activity>` | `Dati > Attività`<br>*(Data > Activities)* | Rappresenta ogni singolo blocco di insegnamento (Docente + Classe/Gruppo + Materia). |
| **Blocchi** *(es. 2+1+1)* | Divisione in sub-attività (`Duration`, `Total_Duration`, `Activity_Group_Id`) | `Dati > Attività > [Aggiungi/Modifica] > Durata / Dividi in N sotto-attività` | Genera N record attività collegati dallo stesso `Activity_Group_Id`. |
| **Min giorni tra blocchi** | `<ConstraintMinDaysBetweenActivities>` | `Dati > Vincoli di tempo > Attività > Numero minimo di giorni tra un insieme di attività` | Impone che le lezioni della stessa materia si tengano in giorni differenti (`Consecutive_If_Same_Day = true`). |
| **Aule / Peso aule %** | `<ConstraintActivityPreferredRoom(s)>` | `Dati > Vincoli di spazio > Attività > Un'aula (o insieme di aule) preferita per un'attività` | Assegna l'aula o l'elenco di aule ammissibili a quella specifica attività. |
| **Max ore al giorno** *(colonna M)* | `<ConstraintStudentsSetActivityTagMaxHoursDaily>` | `Dati > Vincoli di tempo > Studenti > Un insieme di studenti con un'etichetta attività ha un numero massimo di ore giornaliere` | Evita che lezioni accorpate della stessa materia superino un tetto giornaliero (es. max 2 ore al giorno). |
| **Tag** | `<Activity_Tag>` | `Dati > Etichette attività`<br>*(Data > Activity Tags)* | Etichette ausiliarie associate alla lezione. |

---

## 8. Indisponibilità (Tab *Indisp_Docenti* e *Indisp_Classi*)

| Parametro / Colonna Sheet | Tag XML FET | Percorso Interfaccia FET (GUI) | Note e Funzionamento |
| :--- | :--- | :--- | :--- |
| **Slot non disponibili (Peso 100%)** | `<ConstraintTeacherNotAvailableTimes>` / `<ConstraintStudentsSetNotAvailableTimes>` | `Dati > Vincoli di tempo > Docenti (o Studenti) > Orari non disponibili per un docente (o insieme di studenti)` | Finestra con la griglia settimanale dove gli slot segnati con **X** diventano rossi (non disponibili). |
| **Slot non graditi (Peso < 100%)** | `<ConstraintActivitiesPreferredTimeSlots>` | `Dati > Vincoli di tempo > Attività > Orari preferiti per un insieme di attività` | Trasforma gli slot liberi in "orari preferiti" con la percentuale di peso indicata (vincolo morbido). |

---

## 9. Tab Vincoli (Vincoli Globali di Istituto)

Questa tabella mostra il mapping diretto di ogni codice presente nel foglio **Vincoli**:

| Codice Vincolo Sheet | Tag XML FET Corrispondente | Percorso Esatto nel Menu FET (GUI) |
| :--- | :--- | :--- |
| `TEACHERS_MAX_GAPS_DAY` | `<ConstraintTeachersMaxGapsPerDay>` *(o per singolo docente)* | `Dati > Vincoli di tempo > Docenti > Numero massimo di ore buche al giorno per tutti i docenti` |
| `TEACHERS_MAX_GAPS_DAY_DISP` | `<ConstraintTeacherMaxGapsPerDay>` | `Dati > Vincoli di tempo > Docenti > Numero massimo di ore buche al giorno per un docente` *(generato per i soli docenti con ore a disposizione)* |
| `TEACHERS_MAX_GAPS_WEEK` | `<ConstraintTeachersMaxGapsPerWeek>` *(o per singolo docente)* | `Dati > Vincoli di tempo > Docenti > Numero massimo di ore buche a settimana per tutti i docenti` |
| `TEACHERS_MAX_GAPS_WEEK_DISP` | `<ConstraintTeacherMaxGapsPerWeek>` | `Dati > Vincoli di tempo > Docenti > Numero massimo di ore buche a settimana per un docente` *(generato per i docenti con ore a disposizione)* |
| `TEACHERS_MAX_GAPS_WEEK_ITIN` | `<ConstraintTeacherMaxGapsPerWeek>` | `Dati > Vincoli di tempo > Docenti > Numero massimo di ore buche a settimana per un docente` *(generato per i docenti itineranti tra più plessi)* |
| `STUDENTS_MAX_GAPS_DAY` | `<ConstraintStudentsMaxGapsPerDay>` | `Dati > Vincoli di tempo > Studenti > Numero massimo di ore buche al giorno per tutti gli studenti` |
| `STUDENTS_MAX_GAPS_WEEK` | `<ConstraintStudentsMaxGapsPerWeek>` | `Dati > Vincoli di tempo > Studenti > Numero massimo di ore buche a settimana per tutti gli studenti` |
| `STUDENTS_MIN_HOURS_DAY` | `<ConstraintStudentsSetMinHoursDaily>` | `Dati > Vincoli di tempo > Studenti > Ore minime giornaliere per un insieme di studenti` *(impedisce uscite anticipate)* |
| `STUDENTS_MAX_RIENTRI` | `<ConstraintStudentsSetIntervalMaxDaysPerWeek>` | `Dati > Vincoli di tempo > Studenti > Un intervallo di ore ha un numero massimo di giorni a settimana per un insieme di studenti` |
| `TEACHERS_MAX_RIENTRI` | `<ConstraintTeacherIntervalMaxDaysPerWeek>` | `Dati > Vincoli di tempo > Docenti > Un intervallo di ore ha un numero massimo di giorni a settimana per un docente` |
| `STUDENTS_EARLY_BEGIN` | `<ConstraintStudentsEarlyMaxBeginningsAtSecondHour>` | `Dati > Vincoli di tempo > Studenti > Numero massimo di inizi anticipati alla seconda ora per tutti gli studenti` |
| `TEACHERS_MAX_HOURS_DAY` | `<ConstraintTeachersMaxHoursDaily>` | `Dati > Vincoli di tempo > Docenti > Ore massime giornaliere per tutti i docenti` |
| `STUDENTS_MAX_HOURS_DAY` | `<ConstraintStudentsMaxHoursDaily>` | `Dati > Vincoli di tempo > Studenti > Ore massime giornaliere per tutti gli studenti` |
| `TEACHERS_MIN_HOURS_DAY` | `<ConstraintTeacherMinHoursDaily>` | `Dati > Vincoli di tempo > Docenti > Ore minime giornaliere per un docente` *(applicato a tutti i docenti)* |
| `TEACHERS_MAX_BUILDING_CHANGES_DAY` | `<ConstraintTeachersMaxBuildingChangesPerDay>` | `Dati > Vincoli di spazio > Docenti > Numero massimo di cambi di edificio al giorno per tutti i docenti` |
| `TEACHERS_MAX_BUILDING_CHANGES_WEEK` | `<ConstraintTeachersMaxBuildingChangesPerWeek>` | `Dati > Vincoli di spazio > Docenti > Numero massimo di cambi di edificio a settimana per tutti i docenti` |
| `TEACHERS_MIN_GAPS_BUILDING_CHANGES` | `<ConstraintTeachersMinGapsBetweenBuildingChanges>` | `Dati > Vincoli di spazio > Docenti > Intervallo minimo (in ore) tra cambi di edificio per tutti i docenti` |
| `CLASSE_DOCENTE_PRIME_ULTIME` | `<ConstraintActivitiesOccupyMaxTimeSlotsFromSelection>` | `Dati > Vincoli di tempo > Attività > Un insieme di attività occupa un numero massimo di fasce orarie da una selezione` |
| `DISPOSIZIONE_MIN_PER_ORA` | `<ConstraintActivitiesMinSimultaneousInSelectedTimeSlots>` | `Dati > Vincoli di tempo > Attività > Numero minimo di attività contemporanee in fasce orarie selezionate` |

---

## 10. Parametri di Automazione Speciali dello Script

Alcune opzioni nel foglio **Parametri** non corrispondono a un singolo interruttore in FET, ma implementano **logiche algoritmiche complesse** che generano combinazioni multiple di vincoli:

1. **"Le classi non cambiano plesso durante la giornata (SI/NO)"**:
   - In FET non esiste una funzione "blocca la classe nell'altro plesso per l'intera giornata".
   - Lo script implementa questa regola analizzando le lezioni speciali (palestra/laboratori in Centrale per classi della Succursale) e forzando l'assegnazione di un pool di **aule di appoggio** per tutte le lezioni teoriche della classe in quel giorno.
2. **"Aule libere di riserva in ogni ora (Centrale)"**:
   - Genera attività fittizie bloccate (`ConstraintActivityPreferredStartingTime` con `Permanently_Locked = true`) che occupano aule a rotazione forzando FET a lasciarne libere per le emergenze.
3. **"Intervalli come righe dell'orario FET"**:
   - Inserisce gli intervalli come vere e proprie ore della giornata marcate con `<ConstraintBreakTimes>`. Se un'attività didattica dura 3 ore a cavallo della ricreazione, lo script la divide automaticamente in due attività consecutive unite dal vincolo `<ConstraintTwoActivitiesGrouped>`.
4. **"Ore a disposizione: tutte dopo FET"**:
   - Rimuove completamente le attività di disposizione dal motore FET (velocizzando enormemente la ricerca dell'orario) ed esegue un algoritmo di post-processing per collocarle in modo bilanciato sulle ore buche e a inizio/fine giornata nel tab *Orario*.
