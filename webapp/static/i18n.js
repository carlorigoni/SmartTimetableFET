/**
 * SmartTimetable - Internationalization (i18n) Engine
 * Supporto multilingua nativo (Italiano / English) con rilevamento automatico
 * del browser, persistenza su localStorage e commutazione istantanea senza reload.
 */

(function (window) {
  'use strict';

  const I18N_DICTIONARY = {
    it: {
      app: {
        title: "SmartTimetable",
        subtitle: "FET 7.12.0 Suite",
        loading: "Caricamento in corso...",
        error: "Si è verificato un errore",
        network_error: "Errore di connessione al server"
      },
      nav: {
        dashboard: "Dashboard",
        dashboard_title: "Dashboard Riassuntiva",
        timetable: "Orario Risolto",
        timetable_title: "Orario Settimanale Risolto",
        solver: "Compilatore FET",
        solver_title: "Compilatore Algoritmo Euristico FET",
        diagnostics: "Diagnostica & Advisor",
        diagnostics_title: "Pre-Validatore e Advisor Intelligente dei Vincoli",
        reports_group: "Report & Stampe",
        print_classes: "Orario per Classe (PDF)",
        print_classes_desc: "Stampa A4 orizzontale con articolazioni e intervalli",
        print_teachers: "Tabellone Docenti (A3)",
        print_teachers_desc: "Tabellone orizzontale completo con bande verticali (A3/PDF)",
        anagrafiche_group: "Anagrafiche & Cattedre",
        teachers: "Docenti",
        teachers_title: "Gestione Docenti",
        teachers_desc: "Organico docenti, cattedre e ore di insegnamento",
        classes: "Classi & Gruppi",
        classes_title: "Gestione Classi & Gruppi",
        classes_desc: "Sezioni, articolazioni orarie e gruppi studenti",
        subjects: "Materie",
        subjects_title: "Gestione Materie",
        subjects_desc: "Discipline scolastiche, codici e carichi orari",
        rooms: "Plessi & Aule",
        rooms_title: "Gestione Plessi & Aule",
        rooms_desc: "Sedi dell'istituto, aule ordinarie e laboratori",
        activities: "Attività / Cattedre",
        activities_title: "Attività & Cattedre",
        activities_desc: "Insegnamenti, compresenze e cattedre FET",
        accorpamenti: "Accorpamenti",
        accorpamenti_title: "Gestione Accorpamenti Macro-Materie",
        accorpamenti_desc: "Macro-materie (es. Italiano, Latino, Storia e Geo)",
        vincoli_group: "Vincoli & Regole",
        block_rules: "Regole Blocchi & Sezioni",
        block_rules_title: "Regole Suddivisione Blocchi & Indirizzi Sezioni",
        block_rules_desc: "Suddivisione blocchi orari e indirizzi sezioni",
        availability: "Indisponibilità Griglia",
        availability_title: "Griglia Indisponibilità",
        availability_desc: "Desiderata docenti, palestre e giorni liberi",
        constraints: "Vincoli Orario",
        constraints_title: "Vincoli Algoritmo FET",
        constraints_desc: "Pesi percentuali, ore continuative e buchi FET",
        system_group: "Sistema & Configurazione",
        parameters: "Parametri Istituto",
        parameters_title: "Parametri Istituto & Calendario",
        parameters_desc: "Campanelle, sabati, pause e calendario scolastico",
        snapshots: "Backup & Snapshot",
        snapshots_title: "Backup, File & Punti di Ripristino (Snapshot)",
        snapshots_desc: "Punti di ripristino, import/export FET e JSON",
        access_mgmt: "Gestione Accessi",
        access_mgmt_title: "Gestione Accessi & Utenti",
        access_mgmt_desc: "Ruoli, permessi e approvazione utenti Google OAuth",
        about: "Info & Crediti",
        about_title: "Info & Crediti",
        about_desc: "Versione FET 7.12, crediti e conformità GDPR",
        back: "Indietro",
        back_to: "Torna a"
      },
      theme: {
        auto: "Automatico (Sistema)",
        light: "Tema Chiaro",
        dark: "Tema Scuro",
        title: "Aspetto e Tema"
      },
      lang: {
        it: "Italiano",
        en: "English",
        choose: "Seleziona Lingua"
      },
      constraints: {
        header_title: "⚡ Regole e Vincoli Rigidi di Calcolo FET",
        subtitle_desc: "Regole matematiche applicate al solutore FET per compattare l'orario, azzerare le ore buche e gestire i trasferimenti tra plessi",
        all: "Tutti i Vincoli",
        teachers: "👨‍🏫 Vincoli Docenti",
        classes: "🎓 Vincoli Classi & Studenti",
        changes: "🏢 Spostamenti & Plessi",
        active: "Attivo",
        inactive: "Disattivo",
        param: "Parametro:",
        weight: "Peso:",
        rigid_badge: "🔒 100% (Rigido)",
        saved_status: "Salvato in tempo reale",
        saving_status: "Salvataggio in corso...",
        error_status: "Errore salvataggio",
        active_count: "{active} vincoli attivi su {total}"
      },
      solver: {
        title: "Compilatore Euristico FET",
        desc: "Generatore orario basato sull'algoritmo genetico C++ di Liviu Lalescu",
        start_btn: "⚡ Avvia Compilazione Orario",
        stop_btn: "🛑 Interrompi Compilazione",
        timelimit_label: "Tempo limite di calcolo:",
        timelimit_nolimit: "Nessun limite (Fino a completamento)",
        timelimit_1m: "1 Minuto (Test rapido)",
        timelimit_5m: "5 Minuti (Consigliato)",
        timelimit_15m: "15 Minuti (Approfondito)",
        timelimit_60m: "1 Ora (Risoluzione complessa)",
        status_idle: "Pronto per la compilazione",
        status_running: "Compilazione in corso con motore FET nativo...",
        status_success: "🎉 Orario generato con successo al 100%!",
        status_stopped: "Compilazione interrotta dall'utente.",
        status_timeout: "Tempo limite raggiunto prima del completamento.",
        placed_activities: "Attività collocate:",
        total_activities: "Attività totali:",
        current_time: "Tempo trascorso:",
        view_timetable_btn: "🗓️ Visualizza Orario Generato",
        view_diagnostics_btn: "🔍 Analizza Conflitti con Advisor"
      },
      timetable: {
        title: "Orario Settimanale Risolto",
        view_classes: "Per Classe",
        view_teachers: "Per Docente",
        view_rooms: "Per Aula/Plesso",
        select_class: "Seleziona Classe:",
        select_teacher: "Seleziona Docente:",
        select_room: "Seleziona Aula:",
        print_btn: "🖨️ Stampa Vista Corrente",
        export_btn: "📥 Esporta",
        locked_badge: "🔒 Bloccata",
        disposizione_badge: "D",
        legend_lesson: "Lezione Ordinaria",
        legend_lab: "Laboratorio / Aula Specifica",
        legend_gym: "Scienze Motorie (Palestra)",
        legend_disp: "Ore a Disposizione (D)"
      },
      modals: {
        print_classes: {
          title: "Stampa Orario per Classe (Procedura 9)",
          info_box: "Genera il fascicolo completo o l'orario di singole classi in formato A4 Orizzontale (1 classe per pagina). Supporta nativamente la fusione delle classi articolate (es. 3A con 3AM/3AR) e gli intervalli scolastici.",
          valid_from: "📅 Valido a partire da:",
          color_mode: "🎨 Modalità Colore:",
          color_full: "🌈 A Colori (Sfondi pastello per materia)",
          color_bw: "⚫ Bianco e Nero (Toner save / fotocopie)",
          cell_content: "📝 Contenuto delle celle:",
          content_both: "Materia e Docente (Consigliato)",
          content_subject: "Solo Materia",
          content_teacher: "Solo Docente",
          include_subgroups: "Includi rami articolati (3AM, 3AR...)",
          select_classes: "🎓 Selezione Classi da Stampare:",
          all_classes: "Tutte le classi",
          filter_all: "Tutte",
          filter_1: "Prime",
          filter_2: "Seconde",
          filter_3: "Terze",
          filter_4: "Quarte",
          filter_5: "Quinte",
          filter_none: "Nessuna",
          search_placeholder: "🔍 Cerca classe...",
          cancel_btn: "Annulla",
          submit_btn: "🖨️ Apri Anteprima & Stampa PDF"
        },
        print_teachers: {
          title: "Tabellone Docenti A3 (Procedura 12)",
          info_box: "Genera il Tabellone Generale Completo di tutti i docenti dell'istituto in formato A3 Orizzontale (o A4 compatto). Include bande verticali alternate per giorno ed eliminazione automatica delle ore vuote in coda.",
          valid_from: "📅 Valido a partire dal:",
          paper_size: "📐 Formato Carta:",
          paper_a3: "📄 A3 Orizzontale (Consigliato per collegio / bacheca)",
          paper_a4: "📑 A4 Orizzontale (Compatto ad alta densità)",
          show_rooms: "Mostra Aula nelle celle di lezione",
          show_rooms_hint: "(lasciare disattivato per far stare perfettamente i dati nelle caselle)",
          highlight_disp: "Evidenzia Ore a Disposizione (\"D\" in giallo)",
          optimization_notice: "⚡ Ottimizzazione ore in coda attiva: le colonne orarie non utilizzate dall'intero istituto vengono escluse per massimizzare la larghezza delle lezioni senza sprecare spazio.",
          cancel_btn: "Annulla",
          download_docx: "📥 Scarica Documento (.docx Google Docs)",
          submit_btn: "🖨️ Stampa / Anteprima A3"
        },
        about: {
          title: "SmartTimetable FET Suite",
          subtitle: "Configurazione, Vincoli & Compilatore Orario FET 7.12.0",
          stable_release: "Release Stabile",
          check_updates: "🚀 Verifica Aggiornamenti",
          engine: "Engine: FET 7.12.0 Nativo",
          author_section: "Ideazione & Architettura",
          author_role: "Autore, Architetto del Software e Maintainer del progetto SmartTimetable.",
          author_sub: "Progettazione funzionale, adattamento alla scuola italiana, modello vincoli cattedre/disposizioni e integrazione procedurale.",
          mentor_section: "Mentore dell'Orario & Guida Metodologica",
          mentor_desc: "Mentore dell'Orario e guida metodologica per l'equilibratura dei carichi orari docenti, la gestione dei vincoli e delle articolazioni cattedre nella scuola secondaria italiana.",
          engine_section: "Motore Euristico di Calcolo",
          engine_desc: "Solutore euristico ad altissima efficienza per orari scolastici complessi, ideato e sviluppato da Liviu Lalescu con il contributo della comunità internazionale FET (licenza GNU GPL v2/v3).",
          engine_site: "🌐 Sito ufficiale FET Free Software",
          ai_section: "AI Engineering & Pair Programming",
          ai_desc: "Advanced Agentic Coding: ingegnerizzazione full-stack, interfaccia Google Classroom Material 3, Relaxation Engine diagnostico per i vincoli, parser Microsoft Word (.docx) e containerizzazione multi-arch.",
          gdpr_title: "Conformità GDPR (Reg. UE 2016/679) & Privacy by Design",
          gdpr_desc: "SmartTimetable opera esclusivamente on-premise all'interno della rete locale dell'Istituto, oppure su macchina virtuale (VM) o VPS controllata. Nessun dato dell'orario o anagrafico viene trasmesso a server cloud terzi.",
          close_btn: "Chiudi"
        },
        updates: {
          title: "Aggiornamento SmartTimetable",
          subtitle: "Verifica immagini Docker Hub & Release Ufficiali",
          checking_title: "Verifica aggiornamenti in corso...",
          checking_desc: "Confronto tra la versione locale e il repository su Docker Hub.",
          current_ver: "Versione Corrente",
          current_tag: "In esecuzione sul server",
          remote_ver: "Ultima su Docker Hub",
          remote_checking: "Verifica in corso...",
          guide_title: "🛠️ Come Applicare l'Aggiornamento",
          guide_watchtower: "1. Aggiornamento Automatico con Watchtower:",
          guide_watchtower_desc: "Se il server ha il container containrrr/watchtower configurato, l'immagine verrà aggiornata automaticamente all'orario impostato.",
          guide_manual: "2. Aggiornamento Manuale Immediato:",
          guide_manual_desc: "Per aggiornare subito da terminale sul server o VPS, esegui nella cartella del progetto:",
          copy_btn: "📋 Copia",
          hint_security: "💡 Sicurezza Dati: Tutti i dati, i vincoli e gli orari generati risiedono nei volumi persistenti e non vengono sovrascritti.",
          last_check: "Ultimo controllo:",
          check_now_btn: "🔄 Ricontrolla Ora",
          close_btn: "Chiudi"
        }
      },
      demo: {
        restore_paperopoli: "Carica Demo Paperopoli (Italiano)",
        restore_duckburg: "Load Duckburg Demo (English)",
        paperopoli_desc: "Liceo & Tecnico Pico De Paperis con Paperino, Archimede e Paperone",
        duckburg_desc: "Ludwig Von Drake High School with Donald Duck, Gyro Gearloose & Scrooge McDuck",
        confirm_load: "Vuoi davvero caricare questo database dimostrativo? I dati attuali verranno archiviati in uno snapshot di sicurezza.",
        success_toast: "Database dimostrativo caricato con successo!"
      },
      teachers: {
        title: "Docenti & Cattedre",
        add_btn: "➕ Nuovo Docente",
        import_btn: "📥 Importa da Docx/Excel",
        search_placeholder: "🔍 Cerca docente o CDC...",
        th_name: "Docente (Nome Completo)",
        th_short: "Nome Breve (Stampa)",
        th_cdc: "CDC",
        th_hours: "Cattedra & Ore",
        th_days: "Giorni Min-Max",
        th_subjects: "Discipline Insegnate",
        th_classes: "Classi Assegnate",
        th_notes: "Note",
        th_actions: "Azioni Rapide",
        add_modal_title: "Aggiungi Nuovo Docente",
        edit_modal_title: "Modifica Parametri Docente",
        btn_add_cattedra: "➕ Cattedra",
        btn_view_cattedre: "📚 Cattedre",
        btn_avail: "📅 Indisponibilità"
      },
      block_rules: {
        title: "Regole Suddivisione Blocchi Orari & Indirizzi Sezioni",
        standard_badge: "Standard",
        exceptions_badge: "Eccezioni",
        no_exceptions_badge: "0 Eccezioni",
        intro_desc: "La suddivisione dei blocchi orari (es. <code>2+1</code>, <code>1+1+1</code>, <code>2+2</code>, <code>2</code>) è gestita con il <b>principio delle eccezioni</b>: ciascuna cattedra riceve automaticamente la formula di default prestabilita per la specifica materia, per l'indirizzo (<b>Liceo</b>, <b>Tecnico</b> o <b>Professionale</b>, determinato dalla <i>sezione</i>) e per il ciclo (<b>Biennio</b> 1-2 o <b>Triennio</b> 3-5). La suddivisione si specifica <b>solo ed esclusivamente se diversa</b> dal default.",
        add_rule_btn: "➕ Nuova Regola di Default",
        view_cattedre_btn: "👥 Vai a Vista Cattedre",
        reset_all_btn: "↩️ Ripristina Tutte ai Default Didattici",
        sec1_title: "🏷️ 1. Indirizzo di Studio per Sezione (Liceo / Tecnico / Professionale)",
        sec1_hint: "Valido per tutte le classi da 1 a 5 con la stessa lettera di sezione",
        sec1_desc: "L'indirizzo di studio è determinato <b>esclusivamente in base alla sezione</b>. Clicca sui pulsanti sotto per cambiare l'indirizzo assegnato a ciascuna sezione dell'istituto:",
        section_label: "Sezione",
        classes_count: "{n} classi",
        track_liceo: "🎓 Liceo",
        track_tecnico: "⚙️ Tecnico",
        track_prof: "🏥 Prof.",
        sec2_title: "📐 2. Regole di Default del Sistema ({n} Regole Didattiche)",
        sec2_desc: "Queste formule vengono applicate automaticamente a qualsiasi cattedra in assenza di eccezioni esplicite.",
        search_placeholder: "🔍 Cerca materia o percorso...",
        new_rule_btn: "+ Nuova Regola",
        th_subject: "Materia / Disciplina",
        th_track: "Indirizzo",
        th_period: "Periodo",
        th_hours: "Ore",
        th_default_formula: "Formula Default",
        th_actions: "Azioni",
        any: "Qualsiasi",
        all_tracks: "TUTTI",
        all_periods: "TUTTI",
        sec3_title: "⚡ 3. Riepilogo Eccezioni Attive nel Progetto ({n})",
        sec3_desc: "Cattedre la cui suddivisione blocchi differisce intenzionalmente dalla formula standard di default stabilita sopra.",
        no_exceptions_msg: "✅ <b>Nessuna eccezione attiva:</b> tutte le <b>{total}</b> cattedre seguono perfettamente le formule standard di default previste per materia, indirizzo e biennio/triennio!",
        th_class: "Classe",
        th_teachers: "Docenti",
        th_applied_blocks: "Suddivisione Applicata",
        th_std_formula: "Formula Standard",
        reset_default_btn: "↩️ Ripristina Default",
        edit_btn: "✏️ Modifica"
      },
      accorpamenti: {
        title: "Gestione Accorpamenti Macro-Materie",
        active_badge: "{n} Attive",
        pending_badge: "{n} Da Accorpare",
        desc: "Quando lo stesso docente insegna più materie complementari sulla stessa classe (es. <i>Italiano</i>, <i>Latino</i> e <i>Storia e Geografia</i>), l'accorpamento in una <b>macro-materia aggregata</b> (7 o 10 ore complessive) permette al motore FET di suddividere il carico didattico con formule bilanciate (es. <code>2+2+2+1</code> o <code>2+1+2+1+2+1+1</code>), evitando frammentazioni in singole ore sparse o sovraccarichi giornalieri per gli studenti.",
        new_rule_btn: "➕ Nuova Regola",
        manual_merge_btn: "⚡ Accorpa Manualmente",
        go_activities_btn: "📝 Vai a Tutte le Cattedre",
        rules_title: "📋 Regole Macro-Materia Riconosciute nel Sistema ({n}):",
        search_placeholder: "🔍 Cerca docente, classe o materia...",
        filter_all: "Tutte",
        filter_active: "🟢 Solo Attive",
        filter_pending: "⚡ Da Accorpare",
        reversible_note: "Tutte le modifiche e disaccorpamenti sono <b>immediati e reversibili al 100%</b>.",
        th_teacher: "👨‍🏫 Docente Titolare",
        th_class: "🎓 Classe",
        th_subject: "📚 Macro-Materia / Materia Composta",
        th_hours: "⏱️ Ore Tot.",
        th_blocks: "🧩 Blocchi Orari FET",
        th_actions: "Azioni"
      },
      constraints_dict: {
        TEACHERS_MAX_GAPS_DAY: {
          name: "Massimo Ore Buche Giornaliere Docenti",
          desc: "Numero massimo di ore libere tra le lezioni nella stessa giornata per i docenti.",
          category: "Docenti"
        },
        TEACHERS_MAX_GAPS_WEEK: {
          name: "Massimo Ore Buche Settimanali Docenti",
          desc: "Numero massimo totale di ore buche settimanali per ciascun docente.",
          category: "Docenti"
        },
        TEACHERS_MAX_GAPS_DAY_DISP: {
          name: "Ore Buche Giornaliere con Disposizioni",
          desc: "Limite ore buche giornaliere per docenti con ore a disposizione teoriche.",
          category: "Docenti"
        },
        TEACHERS_MAX_GAPS_WEEK_DISP: {
          name: "Ore Buche Settimanali con Disposizioni",
          desc: "Limite ore buche settimanali per docenti con ore a disposizione teoriche.",
          category: "Docenti"
        },
        TEACHERS_MAX_GAPS_WEEK_ITIN: {
          name: "Ore Buche Settimanali Docenti Itineranti",
          desc: "Limite ore buche settimanali per docenti con cattedre su più plessi.",
          category: "Docenti"
        },
        TEACHERS_MAX_RIENTRI: {
          name: "Massimo Rientri Pomeridiani Docenti",
          desc: "Massimo numero di pomeriggi (ore 7 e 8) a settimana per docente.",
          category: "Docenti"
        },
        TEACHERS_MAX_HOURS_DAY: {
          name: "Massimo Ore Giornaliere Docenti",
          desc: "Carico massimo giornaliero di ore di insegnamento per ciascun docente.",
          category: "Docenti"
        },
        TEACHERS_MIN_HOURS_DAY: {
          name: "Minimo Ore nei Giorni di Presenza Docenti",
          desc: "Minimo ore di servizio nei giorni di presenza a scuola (i giorni liberi restano a 0).",
          category: "Docenti"
        },
        CLASSE_DOCENTE_PRIME_ULTIME: {
          name: "Max Ore Prime/Ultime Classe per Docente",
          desc: "Al massimo questa % delle ore settimanali alle prime o ultime ore della classe (es. 50 = metà).",
          category: "Docenti"
        },
        DISPOSIZIONE_MIN_PER_ORA: {
          name: "Copertura Minima Supplenze per Ora",
          desc: "Garantisce almeno N docenti a disposizione in contemporanea per ogni ora di lezione.",
          category: "Docenti"
        },
        STUDENTS_MAX_GAPS_DAY: {
          name: "Zero Ore Buche Giornaliere per le Classi",
          desc: "Le classi non devono avere ore buche tra le lezioni: orario compatto continuo.",
          category: "Classi"
        },
        STUDENTS_MAX_GAPS_WEEK: {
          name: "Zero Ore Buche Settimanali per le Classi",
          desc: "Nessuna ora buca nell'intera settimana scolastica per gli studenti.",
          category: "Classi"
        },
        STUDENTS_MAX_RIENTRI: {
          name: "Massimo Rientri Pomeridiani Classi",
          desc: "Massimo numero di pomeriggi (ore 7 e 8) a settimana per classe.",
          category: "Classi"
        },
        STUDENTS_EARLY_BEGIN: {
          name: "Ingresso Obbligatorio alla 1ª Ora",
          desc: "0 = Tutte le classi entrano sempre alla 1ª ora della mattina (nessun ingresso tardivo).",
          category: "Classi"
        },
        STUDENTS_MAX_HOURS_DAY: {
          name: "Massimo Ore Giornaliere Studenti",
          desc: "Limite assoluto al monte ore giornaliero per le classi.",
          category: "Classi"
        },
        STUDENTS_MIN_HOURS_DAY: {
          name: "Minimo Ore Giornaliere Studenti",
          desc: "Minimo ore giornaliere di lezione per le classi nei giorni attivi.",
          category: "Classi"
        },
        TEACHERS_MAX_BUILDING_CHANGES_DAY: {
          name: "Massimo Spostamenti Giornalieri tra Sedi",
          desc: "Massimo numero di spostamenti tra Centrale e Succursale nello stesso giorno.",
          category: "Spostamenti"
        },
        TEACHERS_MIN_GAPS_BUILDING_CHANGES: {
          name: "Tempo Minimo di Trasferimento tra Sedi",
          desc: "Almeno 1 ora libera tra due lezioni in plessi diversi per consentire lo spostamento.",
          category: "Spostamenti"
        },
        TEACHERS_MAX_BUILDING_CHANGES_WEEK: {
          name: "Massimo Spostamenti Settimanali tra Sedi",
          desc: "Limite al numero totale di cambi sede nella settimana per docente.",
          category: "Spostamenti"
        }
      },
      classes: {
        title: "Classi & Gruppi Studenti",
        add_btn: "➕ Nuova Classe",
        sync_seed_btn: "🔄 Sincronizza Gruppi da Excel",
        search_placeholder: "🔍 Cerca classe...",
        th_class: "Classe",
        th_room: "Aula Base",
        th_students: "N. Studenti",
        th_track: "Indirizzo / Percorso",
        th_groups: "Articolazioni / Gruppi",
        th_notes: "Note",
        th_actions: "Azioni Rapide"
      },
      subjects: {
        title: "Materie & Discipline",
        add_btn: "➕ Nuova Materia",
        search_placeholder: "🔍 Cerca materia o codice...",
        th_code: "Codice",
        th_name: "Nome Materia",
        th_dept: "Dipartimento",
        th_hours: "Ore Totali",
        th_actions: "Azioni"
      },
      rooms: {
        title: "Plessi & Aule",
        add_btn: "➕ Nuova Aula",
        add_building_btn: "🏫 Nuovo Plesso",
        search_placeholder: "🔍 Cerca aula o plesso...",
        th_room: "Spazio / Aula",
        th_building: "Plesso / Sede",
        th_capacity: "Capienza",
        th_lab: "Tipologia",
        th_actions: "Azioni"
      },
      activities: {
        title: "Attività & Cattedre",
        view_cattedre: "👥 Vista Cattedre",
        view_raw: "📋 Dettaglio FET",
        filter_all: "Tutte",
        filter_exceptions: "⚡ Solo Eccezioni",
        new_cattedra_btn: "➕ Nuova Cattedra",
        accorpamenti_btn: "🔗 Accorpamenti Macro-Materie",
        block_rules_btn: "📐 Regole Blocchi & Sezioni",
        reset_defaults_btn: "↩️ Ripristina Default Didattici",
        th_class_group: "Classe / Gruppo",
        th_subject: "Materia / Disciplina",
        th_teachers: "Docenti (Compresenze)",
        th_room: "Spazio / Aula",
        th_hours_week: "Ore/Sett.",
        th_blocks: "Suddivisione",
        th_sub_activities: "Sotto-attività FET",
        th_status: "Stato",
        th_actions: "Azioni"
      },
      availability: {
        title: "Indisponibilità & Desiderata",
        view_single: "📅 Calendario Singolo",
        view_matrix: "📊 Matrice Completa Excel",
        filter_teachers: "👨‍🏫 Docenti",
        filter_classes: "🎓 Classi",
        save_matrix_btn: "💾 Salva Modifiche Matrice",
        legend_avail: "Disponibile",
        legend_unavail: "Non Disponibile",
        legend_break: "Pausa / Chiuso",
        legend_pref: "Fascia Preferita",
        free_day_label: "Giorno Libero",
        pref_shift_label: "Preferenza Fascia Oraria"
      },
      diagnostics: {
        title: "Diagnostica & Advisor Vincoli",
        run_scan: "🔄 Riesegui Scansione",
        open_solver: "⚡ Apri Compilatore FET",
        feasibility_index: "Indice di Fattibilità",
        critical_conflicts: "Conflitti Bloccanti",
        warnings_count: "Avvisi e Colli di Bottiglia",
        status_ok: "✅ Progetto Pronto per la Risoluzione FET",
        status_warn: "⚠️ Rilevati Potenziali Colli di Bottiglia",
        status_err: "⛔ Rilevati Conflitti Matematici Bloccanti",
        tab_all: "Tutti i Problemi",
        tab_critical: "Critici (Bloccanti)",
        tab_warning: "Avvisi",
        tab_info: "Info & Statistiche",
        root_cause: "Causa Radice Identificata",
        recommendations: "Raccomandazioni di Risoluzione"
      },
      parameters: {
        title: "Parametri Istituto & Calendario",
        save_btn: "💾 Salva Parametri",
        school_name: "Denominazione Istituto Scolastico",
        days_per_week: "Giorni di Lezione Settimanali",
        periods_per_day: "Ore / Fasce Orarie Giornaliere",
        break_times: "Intervalli & Pause Didattiche"
      },
      snapshots: {
        title: "Backup & Snapshot del Progetto",
        new_snapshot_btn: "📸 Crea Nuovo Snapshot",
        import_fet_btn: "📥 Importa File FET (.fet)",
        export_fet_btn: "📤 Esporta File FET (.fet)",
        export_json_btn: "💾 Esporta Backup Completo (JSON)",
        reset_btn: "🧹 Ripristina / Azzera Progetto",
        th_name: "Nome Snapshot",
        th_date: "Data e Ora",
        th_desc: "Descrizione / Note",
        th_actions: "Azioni"
      },
      common: {
        save: "Salva",
        saving: "Salvataggio...",
        cancel: "Annulla",
        delete: "Elimina",
        edit: "Modifica",
        confirm: "Conferma",
        close: "Chiudi",
        add: "Aggiungi",
        search: "Cerca...",
        yes: "Sì",
        no: "No",
        all: "Tutti",
        none: "Nessuno",
        actions: "Azioni",
        status: "Stato",
        details: "Dettagli",
        version: "Versione",
        last_update: "Ultimo aggiornamento",
        refresh: "Aggiorna",
        copy: "Copia",
        clear: "Pulisci",
        preview_print: "Anteprima & Stampa",
        role_admin: "Amministratore",
        role_editor: "Docente / Redattore",
        role_viewer: "Sola Lettura",
        days: {
          mon: "Lunedì",
          tue: "Martedì",
          wed: "Mercoledì",
          thu: "Giovedì",
          fri: "Venerdì",
          sat: "Sabato"
        },
        short_days: {
          mon: "Lun",
          tue: "Mar",
          wed: "Mer",
          thu: "Gio",
          fri: "Ven",
          sat: "Sab"
        }
      }
    },

    en: {
      app: {
        title: "SmartTimetable",
        subtitle: "FET 7.12.0 Suite",
        loading: "Loading, please wait...",
        error: "An error occurred",
        network_error: "Connection error with server"
      },
      nav: {
        dashboard: "Dashboard",
        dashboard_title: "Summary Dashboard",
        timetable: "Solved Timetable",
        timetable_title: "Solved Weekly Timetable",
        solver: "FET Compiler",
        solver_title: "FET Heuristic Algorithm Compiler",
        diagnostics: "Diagnostics & Advisor",
        diagnostics_title: "Pre-Validator & Intelligent Constraint Advisor",
        reports_group: "Reports & Printing",
        print_classes: "Class Timetable (PDF)",
        print_classes_desc: "A4 landscape printout with splits and intervals",
        print_teachers: "Teacher Master Board (A3)",
        print_teachers_desc: "Full horizontal teacher master grid with vertical bands (A3/PDF)",
        anagrafiche_group: "School Records & Roles",
        teachers: "Faculty & Teachers",
        teachers_title: "Faculty Staff & Teachers Management",
        teachers_desc: "Faculty staff, teaching assignments and weekly hours",
        classes: "Classes & Groups",
        classes_title: "Classes & Student Groups Management",
        classes_desc: "Grade sections, schedule tracks and student groups",
        subjects: "Subjects & Courses",
        subjects_title: "Subjects & Academic Disciplines",
        subjects_desc: "Academic disciplines, course codes and weekly workloads",
        rooms: "Campuses & Rooms",
        rooms_title: "Buildings, Rooms & Labs Management",
        rooms_desc: "School buildings, lecture rooms and laboratories",
        activities: "Activities / Classes",
        activities_title: "Teaching Activities & Assignments",
        activities_desc: "Course activities, co-teaching and FET assignments",
        accorpamenti: "Course Merges",
        accorpamenti_title: "Macro-Subjects & Merged Courses",
        accorpamenti_desc: "Integrated macro-subjects (e.g. English Literature & History)",
        vincoli_group: "Rules & Constraints",
        block_rules: "Block & Track Rules",
        block_rules_title: "Block Hour Distribution & Section Rules",
        block_rules_desc: "Course hour block splits and section tracks",
        availability: "Grid Availability",
        availability_title: "Unavailability & Preferences Grid",
        availability_desc: "Teacher preferences, gym slots and free days",
        constraints: "Timetable Constraints",
        constraints_title: "FET Algorithm Rules & Constraints",
        constraints_desc: "Percentage weights, continuous hours and FET gap hours",
        system_group: "System & Configuration",
        parameters: "Institution Parameters",
        parameters_title: "Institution Parameters & School Calendar",
        parameters_desc: "School bells, weekend schedule, breaks and calendar",
        snapshots: "Backup & Snapshots",
        snapshots_title: "Backup, Files & Restore Points (Snapshots)",
        snapshots_desc: "Restore points, FET and JSON imports/exports",
        access_mgmt: "Access Management",
        access_mgmt_title: "Access Management & Permissions",
        access_mgmt_desc: "Roles, permissions and Google OAuth user approval",
        about: "Info & Credits",
        about_title: "Info & Credits",
        about_desc: "FET 7.12 version, authors, credits and GDPR compliance",
        back: "Back",
        back_to: "Back to"
      },
      theme: {
        auto: "Automatic (System)",
        light: "Light Theme",
        dark: "Dark Theme",
        title: "Appearance & Theme"
      },
      lang: {
        it: "Italiano",
        en: "English",
        choose: "Choose Language"
      },
      constraints: {
        header_title: "⚡ Strict FET Calculation Rules & Constraints",
        subtitle_desc: "Mathematical rules applied to the FET solver to compact schedules, eliminate gap hours and manage campus transfers",
        all: "All Constraints",
        teachers: "👨‍🏫 Faculty Constraints",
        classes: "🎓 Student & Class Constraints",
        changes: "🏢 Campus Transfers",
        active: "Active",
        inactive: "Disabled",
        param: "Parameter:",
        weight: "Weight:",
        rigid_badge: "🔒 100% (Strict)",
        saved_status: "Saved in real-time",
        saving_status: "Saving changes...",
        error_status: "Save error",
        active_count: "{active} active constraints out of {total}"
      },
      solver: {
        title: "FET Heuristic Compiler",
        desc: "Timetable engine powered by Liviu Lalescu's native C++ genetic algorithm",
        start_btn: "⚡ Start Timetable Solve",
        stop_btn: "🛑 Stop Computation",
        timelimit_label: "Computation time limit:",
        timelimit_nolimit: "No limit (Run until complete)",
        timelimit_1m: "1 Minute (Quick test)",
        timelimit_5m: "5 Minutes (Recommended)",
        timelimit_15m: "15 Minutes (Deep search)",
        timelimit_60m: "1 Hour (Complex scheduling)",
        status_idle: "Ready for computation",
        status_running: "Compiling schedule with native FET engine...",
        status_success: "🎉 Timetable 100% successfully generated!",
        status_stopped: "Computation stopped by user.",
        status_timeout: "Time limit reached before completion.",
        placed_activities: "Placed activities:",
        total_activities: "Total activities:",
        current_time: "Elapsed time:",
        view_timetable_btn: "🗓️ View Generated Timetable",
        view_diagnostics_btn: "🔍 Analyze Conflicts with Advisor"
      },
      timetable: {
        title: "Solved Weekly Timetable",
        view_classes: "By Class",
        view_teachers: "By Teacher",
        view_rooms: "By Room/Campus",
        select_class: "Select Class:",
        select_teacher: "Select Teacher:",
        select_room: "Select Room:",
        print_btn: "🖨️ Print Current View",
        export_btn: "📥 Export",
        locked_badge: "🔒 Locked",
        disposizione_badge: "D",
        legend_lesson: "Regular Lecture",
        legend_lab: "Specialized Lab",
        legend_gym: "Physical Education (Gym)",
        legend_disp: "Substitute / On-Duty Hour (D)"
      },
      modals: {
        print_classes: {
          title: "Class Timetable Print (Procedure 9)",
          info_box: "Generate the complete booklet or individual class schedules in A4 Landscape format (1 class per page). Fully supports class track splits (e.g. 3A with 3AM/3AR) and school break intervals.",
          valid_from: "📅 Valid from:",
          color_mode: "🎨 Color Mode:",
          color_full: "🌈 Full Color (Pastel subject backgrounds)",
          color_bw: "⚫ Black & White (Toner save / photocopies)",
          cell_content: "📝 Cell Content:",
          content_both: "Subject & Teacher (Recommended)",
          content_subject: "Subject Only",
          content_teacher: "Teacher Only",
          include_subgroups: "Include track splits (3AM, 3AR...)",
          select_classes: "🎓 Select Classes to Print:",
          all_classes: "All classes",
          filter_all: "All",
          filter_1: "1st Grade",
          filter_2: "2nd Grade",
          filter_3: "3rd Grade",
          filter_4: "4th Grade",
          filter_5: "5th Grade",
          filter_none: "None",
          search_placeholder: "🔍 Search class...",
          cancel_btn: "Cancel",
          submit_btn: "🖨️ Open Preview & Print PDF"
        },
        print_teachers: {
          title: "Teacher Master Board A3 (Procedure 12)",
          info_box: "Generate the full institute master grid of all teachers in A3 Landscape format (or compact A4). Includes alternating day bands and automatic trimming of trailing empty periods.",
          valid_from: "📅 Valid from:",
          paper_size: "📐 Paper Format:",
          paper_a3: "📄 A3 Landscape (Recommended for staff room / notice board)",
          paper_a4: "📑 A4 Landscape (High-density compact)",
          show_rooms: "Show Room in lesson cells",
          show_rooms_hint: "(keep unchecked for optimal cell fitting)",
          highlight_disp: "Highlight On-Duty Hours (\"D\" in yellow)",
          optimization_notice: "⚡ Trailing hour optimization active: unused timetable columns across the entire institute are trimmed to maximize column width.",
          cancel_btn: "Cancel",
          download_docx: "📥 Download Doc (.docx Google Docs)",
          submit_btn: "🖨️ Print / Preview A3"
        },
        about: {
          title: "SmartTimetable FET Suite",
          subtitle: "Configuration, Constraints & Timetable Compiler FET 7.12.0",
          stable_release: "Stable Release",
          check_updates: "🚀 Check for Updates",
          engine: "Engine: Native FET 7.12.0",
          author_section: "Design & Architecture",
          author_role: "Author, Software Architect and Maintainer of SmartTimetable.",
          author_sub: "Functional design, Italian school adaptation, teaching chair/on-duty constraint model and procedural integration.",
          mentor_section: "Timetable Mentor & Methodological Guidance",
          mentor_desc: "Timetable mentor and methodological advisor for balancing teacher workloads, constraints and course split management in secondary education.",
          engine_section: "Heuristic Computation Engine",
          engine_desc: "High-efficiency heuristic engine for complex educational timetabling, designed and developed by Liviu Lalescu with contributions from the international FET community (GNU GPL v2/v3).",
          engine_site: "🌐 Official FET Free Software Website",
          ai_section: "AI Engineering & Pair Programming",
          ai_desc: "Advanced Agentic Coding: full-stack architecture, Google Classroom Material 3 UI, diagnostic Relaxation Engine for constraints, Microsoft Word (.docx) parser, and multi-architecture containers.",
          gdpr_title: "GDPR Compliance (EU Reg. 2016/679) & Privacy by Design",
          gdpr_desc: "SmartTimetable runs exclusively on-premise inside the school's local network or on a dedicated virtual machine/VPS. No schedule or staff personal data is transmitted to third-party cloud servers.",
          close_btn: "Close"
        },
        updates: {
          title: "SmartTimetable Updates",
          subtitle: "Verify Docker Hub images & Official Releases",
          checking_title: "Checking for updates...",
          checking_desc: "Comparing local instance with the Docker Hub image repository.",
          current_ver: "Current Version",
          current_tag: "Running on this server",
          remote_ver: "Latest on Docker Hub",
          remote_checking: "Checking...",
          guide_title: "🛠️ How to Apply Updates",
          guide_watchtower: "1. Automatic Updates via Watchtower:",
          guide_watchtower_desc: "If your server has containrrr/watchtower configured, the container image will update automatically at the scheduled time.",
          guide_manual: "2. Immediate Manual Update:",
          guide_manual_desc: "To update immediately via terminal on your server or VPS, run:",
          copy_btn: "📋 Copy",
          hint_security: "💡 Data Safety: All database records, constraints and generated timetables reside in persistent volumes and are never overwritten.",
          last_check: "Last checked:",
          check_now_btn: "🔄 Check Now",
          close_btn: "Close"
        }
      },
      demo: {
        restore_paperopoli: "Carica Demo Paperopoli (Italiano)",
        restore_duckburg: "Load Duckburg Demo (English)",
        paperopoli_desc: "Liceo & Tecnico Pico De Paperis with Donald Duck, Gyro Gearloose & Scrooge McDuck",
        duckburg_desc: "Ludwig Von Drake High School with Donald Duck, Gyro Gearloose & Scrooge McDuck",
        confirm_load: "Are you sure you want to load this demonstration database? Current project data will be safely archived in a backup snapshot.",
        success_toast: "Demonstration database loaded successfully!"
      },
      teachers: {
        title: "Faculty & Teaching Staff",
        add_btn: "➕ Add Teacher",
        import_btn: "📥 Import from Docx/Excel",
        search_placeholder: "🔍 Search faculty or department...",
        th_name: "Faculty Member (Full Name)",
        th_short: "Short Name (Print)",
        th_cdc: "Dept/Code",
        th_hours: "Assignment & Hours",
        th_days: "Min-Max Days",
        th_subjects: "Assigned Subjects",
        th_classes: "Assigned Classes",
        th_notes: "Notes",
        th_actions: "Quick Actions",
        add_modal_title: "Add New Faculty Member",
        edit_modal_title: "Edit Faculty Parameters",
        btn_add_cattedra: "➕ Assignment",
        btn_view_cattedre: "📚 Assignments",
        btn_avail: "📅 Availability"
      },
      block_rules: {
        title: "Hour Block Distribution & Section Track Rules",
        standard_badge: "Standard",
        exceptions_badge: "Exceptions",
        no_exceptions_badge: "0 Exceptions",
        intro_desc: "Course hour block distributions (e.g. <code>2+1</code>, <code>1+1+1</code>, <code>2+2</code>, <code>2</code>) follow an <b>exception-based approach</b>: every chair automatically receives the preset default formula for its subject, study track (<b>Academic High School</b>, <b>Technical</b> or <b>Vocational</b>, determined by <i>section</i>) and cycle (<b>Lower Secondary</b> 1-2 or <b>Upper Secondary</b> 3-5). A custom split is only specified if <b>different from the default</b>.",
        add_rule_btn: "➕ New Default Rule",
        view_cattedre_btn: "👥 Go to Teaching Assignments",
        reset_all_btn: "↩️ Reset All to Educational Defaults",
        sec1_title: "🏷️ 1. Study Track by Section (Academic / Technical / Vocational)",
        sec1_hint: "Valid for all grades 1 to 5 with the same section letter",
        sec1_desc: "The curriculum track is determined <b>exclusively by section</b>. Click the buttons below to change the curriculum track assigned to each section of the school:",
        section_label: "Section",
        classes_count: "{n} classes",
        track_liceo: "🎓 Academic",
        track_tecnico: "⚙️ Technical",
        track_prof: "🏥 Vocational",
        sec2_title: "📐 2. System Default Rules ({n} Curriculum Rules)",
        sec2_desc: "These formulas are automatically applied to any chair in the absence of explicit exceptions.",
        search_placeholder: "🔍 Search subject or track...",
        new_rule_btn: "+ New Rule",
        th_subject: "Subject / Course",
        th_track: "Study Track",
        th_period: "Cycle / Period",
        th_hours: "Hours",
        th_default_formula: "Default Formula",
        th_actions: "Actions",
        any: "Any",
        all_tracks: "ALL",
        all_periods: "ALL",
        sec3_title: "⚡ 3. Active Custom Exceptions in Project ({n})",
        sec3_desc: "Teaching assignments whose block distribution intentionally differs from the standard default formula above.",
        no_exceptions_msg: "✅ <b>No active exceptions:</b> all <b>{total}</b> teaching assignments perfectly follow standard default formulas for subject, track, and grade level!",
        th_class: "Class",
        th_teachers: "Faculty",
        th_applied_blocks: "Applied Split",
        th_std_formula: "Standard Formula",
        reset_default_btn: "↩️ Reset to Default",
        edit_btn: "✏️ Edit"
      },
      accorpamenti: {
        title: "Macro-Subject Merges Management",
        active_badge: "{n} Active",
        pending_badge: "{n} Pending Merge",
        desc: "When the same teacher instructs multiple complementary subjects in the same class (e.g. <i>Italian</i>, <i>Latin</i>, and <i>History & Geography</i>), merging them into an <b>aggregated macro-subject</b> (7 or 10 total hours) enables FET to distribute teaching load with balanced formulas (e.g. <code>2+2+2+1</code>), preventing fragmented single periods and student overload.",
        new_rule_btn: "➕ New Rule",
        manual_merge_btn: "⚡ Merge Manually",
        go_activities_btn: "📝 Go to All Chairs",
        rules_title: "📋 Recognized Macro-Subject Rules in System ({n}):",
        search_placeholder: "🔍 Search faculty, class or subject...",
        filter_all: "All",
        filter_active: "🟢 Active Only",
        filter_pending: "⚡ Pending Merge",
        reversible_note: "All mergers and unmergers are <b>instant and 100% reversible</b>.",
        th_teacher: "👨‍🏫 Faculty Member",
        th_class: "🎓 Class",
        th_subject: "📚 Macro-Subject / Merged Course",
        th_hours: "⏱️ Total Hours",
        th_blocks: "🧩 FET Hour Blocks",
        th_actions: "Actions"
      },
      constraints_dict: {
        TEACHERS_MAX_GAPS_DAY: {
          name: "Teachers Max Daily Gap Hours",
          desc: "Maximum number of free gap hours between lessons on the same day for teachers.",
          category: "Teachers"
        },
        TEACHERS_MAX_GAPS_WEEK: {
          name: "Teachers Max Weekly Gap Hours",
          desc: "Maximum total number of free gap hours per week for each teacher.",
          category: "Teachers"
        },
        TEACHERS_MAX_GAPS_DAY_DISP: {
          name: "Daily Gaps with On-Duty Hours",
          desc: "Daily gap hour limit for teachers with theoretical on-duty hours.",
          category: "Teachers"
        },
        TEACHERS_MAX_GAPS_WEEK_DISP: {
          name: "Weekly Gaps with On-Duty Hours",
          desc: "Weekly gap hour limit for teachers with theoretical on-duty hours.",
          category: "Teachers"
        },
        TEACHERS_MAX_GAPS_WEEK_ITIN: {
          name: "Weekly Gaps for Multi-Campus Teachers",
          desc: "Weekly gap limit for teachers with classes on multiple campuses.",
          category: "Teachers"
        },
        TEACHERS_MAX_RIENTRI: {
          name: "Teachers Max Afternoon Return Days",
          desc: "Maximum number of afternoon sessions (periods 7 and 8) per week per teacher.",
          category: "Teachers"
        },
        TEACHERS_MAX_HOURS_DAY: {
          name: "Teachers Max Daily Teaching Hours",
          desc: "Maximum daily teaching workload per teacher.",
          category: "Teachers"
        },
        TEACHERS_MIN_HOURS_DAY: {
          name: "Teachers Min Hours on Working Days",
          desc: "Minimum duty hours on days present at school (free days remain at 0).",
          category: "Teachers"
        },
        CLASSE_DOCENTE_PRIME_ULTIME: {
          name: "Max Early/Late Hours in Class per Teacher",
          desc: "At most this percentage of weekly hours placed in early or late class slots (e.g. 50 = half).",
          category: "Teachers"
        },
        DISPOSIZIONE_MIN_PER_ORA: {
          name: "Minimum On-Duty Coverage per Period",
          desc: "Guarantees at least N on-duty teachers available simultaneously each teaching period for substitutions.",
          category: "Teachers"
        },
        STUDENTS_MAX_GAPS_DAY: {
          name: "Zero Daily Gap Hours for Students",
          desc: "Classes must have no gaps between lessons: continuous compact timetable.",
          category: "Classes"
        },
        STUDENTS_MAX_GAPS_WEEK: {
          name: "Zero Weekly Gap Hours for Students",
          desc: "Zero gap hours during the entire school week for students.",
          category: "Classes"
        },
        STUDENTS_MAX_RIENTRI: {
          name: "Students Max Afternoon Return Days",
          desc: "Maximum number of afternoon sessions (periods 7 and 8) per week per class.",
          category: "Classes"
        },
        STUDENTS_EARLY_BEGIN: {
          name: "Mandatory Entry at Period 1",
          desc: "0 = All classes enter at period 1 every morning (no late arrivals permitted).",
          category: "Classes"
        },
        STUDENTS_MAX_HOURS_DAY: {
          name: "Students Max Daily Hours",
          desc: "Absolute daily hour limit for student classes.",
          category: "Classes"
        },
        STUDENTS_MIN_HOURS_DAY: {
          name: "Students Min Daily Hours",
          desc: "Minimum daily class hours for students on active school days.",
          category: "Classes"
        },
        TEACHERS_MAX_BUILDING_CHANGES_DAY: {
          name: "Max Daily Campus Transfers per Teacher",
          desc: "Maximum number of campus transfers between Main and Branch on the same day.",
          category: "Transfers / Campuses"
        },
        TEACHERS_MIN_GAPS_BUILDING_CHANGES: {
          name: "Min Travel Gap Between Campus Transfers",
          desc: "At least 1 free period between lessons on different campuses to allow travel time.",
          category: "Transfers / Campuses"
        },
        TEACHERS_MAX_BUILDING_CHANGES_WEEK: {
          name: "Max Weekly Campus Transfers per Teacher",
          desc: "Weekly cap on total campus transfers per teacher across the entire school week.",
          category: "Transfers / Campuses"
        }
      },
      classes: {
        title: "Classes & Student Groups",
        add_btn: "➕ Add Class",
        sync_seed_btn: "🔄 Sync Groups from Excel",
        search_placeholder: "🔍 Search class or grade...",
        th_class: "Class",
        th_room: "Home Room",
        th_students: "Students",
        th_track: "Curriculum Track",
        th_groups: "Subgroups & Splits",
        th_notes: "Notes",
        th_actions: "Quick Actions"
      },
      subjects: {
        title: "Subjects & Disciplines",
        add_btn: "➕ Add Subject",
        search_placeholder: "🔍 Search subject or code...",
        th_code: "Code",
        th_name: "Subject Name",
        th_dept: "Department",
        th_hours: "Total Hours",
        th_actions: "Actions"
      },
      rooms: {
        title: "Campuses & Rooms",
        add_btn: "➕ Add Room",
        add_building_btn: "🏫 Add Campus",
        search_placeholder: "🔍 Search room or campus...",
        th_room: "Space / Room",
        th_building: "Campus / Building",
        th_capacity: "Capacity",
        th_lab: "Type",
        th_actions: "Actions"
      },
      activities: {
        title: "Course Activities & Assignments",
        view_cattedre: "👥 Course Assignments",
        view_raw: "📋 Raw FET Detail",
        filter_all: "All",
        filter_exceptions: "⚡ Exceptions Only",
        new_cattedra_btn: "➕ New Assignment",
        accorpamenti_btn: "🔗 Merge Macro-Courses",
        block_rules_btn: "📐 Block & Section Rules",
        reset_defaults_btn: "↩️ Reset to Standard Defaults",
        th_class_group: "Class / Group",
        th_subject: "Subject / Discipline",
        th_teachers: "Faculty (Co-Teaching)",
        th_room: "Space / Room",
        th_hours_week: "Hours/Wk",
        th_blocks: "Split Blocks",
        th_sub_activities: "FET Sub-Activities",
        th_status: "Status",
        th_actions: "Actions"
      },
      availability: {
        title: "Availability & Preferences",
        view_single: "📅 Single Calendar",
        view_matrix: "📊 Full Excel Matrix",
        filter_teachers: "👨‍🏫 Faculty",
        filter_classes: "🎓 Classes",
        save_matrix_btn: "💾 Save Matrix Changes",
        legend_avail: "Available",
        legend_unavail: "Unavailable",
        legend_break: "Break / Closed",
        legend_pref: "Preferred Slot",
        free_day_label: "Free Day",
        pref_shift_label: "Time Slot Preference"
      },
      diagnostics: {
        title: "Pre-Flight Diagnostics & Advisor",
        run_scan: "🔄 Re-run Scan",
        open_solver: "⚡ Open FET Compiler",
        feasibility_index: "Feasibility Score",
        critical_conflicts: "Blocking Conflicts",
        warnings_count: "Warnings & Bottlenecks",
        status_ok: "✅ Project Ready for FET Resolution",
        status_warn: "⚠️ Potential Bottlenecks Detected",
        status_err: "⛔ Blocking Mathematical Deadlocks Detected",
        tab_all: "All Issues",
        tab_critical: "Critical (Blocking)",
        tab_warning: "Warnings",
        tab_info: "Info & Statistics",
        root_cause: "Identified Root Cause",
        recommendations: "Resolution Recommendations"
      },
      parameters: {
        title: "School Parameters & Calendar",
        save_btn: "💾 Save Parameters",
        school_name: "School / Institution Name",
        days_per_week: "Weekly Teaching Days",
        periods_per_day: "Periods / Time Slots per Day",
        break_times: "Recesses & School Breaks"
      },
      snapshots: {
        title: "Project Backups & Snapshots",
        new_snapshot_btn: "📸 Create New Snapshot",
        import_fet_btn: "📥 Import FET File (.fet)",
        export_fet_btn: "📤 Export FET File (.fet)",
        export_json_btn: "💾 Export Full JSON Backup",
        reset_btn: "🧹 Reset / Empty Project",
        th_name: "Snapshot Name",
        th_date: "Timestamp",
        th_desc: "Description / Notes",
        th_actions: "Actions"
      },
      common: {
        save: "Save",
        saving: "Saving...",
        cancel: "Cancel",
        delete: "Delete",
        edit: "Edit",
        confirm: "Confirm",
        close: "Close",
        add: "Add",
        search: "Search...",
        yes: "Yes",
        no: "No",
        all: "All",
        none: "None",
        actions: "Actions",
        status: "Status",
        details: "Details",
        version: "Version",
        last_update: "Last updated",
        refresh: "Refresh",
        copy: "Copy",
        clear: "Clear",
        preview_print: "Preview & Print",
        role_admin: "Administrator",
        role_editor: "Faculty / Editor",
        role_viewer: "Read Only",
        days: {
          mon: "Monday",
          tue: "Tuesday",
          wed: "Wednesday",
          thu: "Thursday",
          fri: "Friday",
          sat: "Saturday"
        },
        short_days: {
          mon: "Mon",
          tue: "Tue",
          wed: "Wed",
          thu: "Thu",
          fri: "Fri",
          sat: "Sat"
        }
      }
    }
  };

  function detectLanguage() {
    const saved = localStorage.getItem('app_lang');
    if (saved && (saved === 'it' || saved === 'en')) {
      return saved;
    }
    const navLang = (navigator.language || (navigator.languages && navigator.languages[0]) || 'it').toLowerCase();
    return navLang.startsWith('it') ? 'it' : 'en';
  }

  let currentLanguage = detectLanguage();

  function t(path, fallback = '') {
    const keys = path.split('.');
    let cur = I18N_DICTIONARY[currentLanguage] || I18N_DICTIONARY['it'];
    for (const k of keys) {
      if (!cur || cur[k] === undefined) {
        // Fallback su dizionario italiano se manca in inglese o viceversa
        let fallbackCur = I18N_DICTIONARY['it'];
        for (const fb of keys) {
          if (!fallbackCur || fallbackCur[fb] === undefined) {
            return fallback || path;
          }
          fallbackCur = fallbackCur[fb];
        }
        return typeof fallbackCur === 'string' ? fallbackCur : (fallback || path);
      }
      cur = cur[k];
    }
    return typeof cur === 'string' ? cur : (fallback || path);
  }

  function setLanguage(lang, reRenderCallback) {
    if (lang !== 'it' && lang !== 'en') return;
    currentLanguage = lang;
    try {
      localStorage.setItem('app_lang', lang);
    } catch (e) {}

    document.documentElement.setAttribute('lang', lang);

    // Aggiorna indicatore topbar
    updateLangUI();

    // Aggiorna tutti gli elementi HTML con data-i18n
    applyStaticTranslations();

    if (typeof reRenderCallback === 'function') {
      reRenderCallback(lang);
    }
  }

  function getLanguage() {
    return currentLanguage;
  }

  function updateLangUI() {
    const flagEl = document.getElementById('currentLangFlag');
    const codeEl = document.getElementById('currentLangCode');
    const checkIt = document.getElementById('langCheck-it');
    const checkEn = document.getElementById('langCheck-en');

    if (flagEl) flagEl.innerText = currentLanguage === 'en' ? '🇬🇧' : '🇮🇹';
    if (codeEl) codeEl.innerText = currentLanguage === 'en' ? 'ENG' : 'ITA';
    if (checkIt) checkIt.style.display = currentLanguage === 'it' ? 'inline-block' : 'none';
    if (checkEn) checkEn.style.display = currentLanguage === 'en' ? 'inline-block' : 'none';
  }

  function applyStaticTranslations(root = document) {
    const scope = root || document;
    scope.querySelectorAll('[data-i18n]').forEach(el => {
      const key = el.getAttribute('data-i18n');
      if (key) {
        const translated = t(key);
        if (el.tagName === 'INPUT' && el.getAttribute('placeholder')) {
          el.setAttribute('placeholder', translated);
        } else {
          el.innerText = translated;
        }
      }
    });

    scope.querySelectorAll('[data-i18n-placeholder]').forEach(el => {
      const key = el.getAttribute('data-i18n-placeholder');
      if (key) {
        el.setAttribute('placeholder', t(key));
      }
    });

    scope.querySelectorAll('[data-i18n-title]').forEach(el => {
      const key = el.getAttribute('data-i18n-title');
      if (key) {
        el.setAttribute('title', t(key));
      }
    });

    scope.querySelectorAll('[data-i18n-tooltip]').forEach(el => {
      const key = el.getAttribute('data-i18n-tooltip');
      if (key) {
        el.setAttribute('data-tooltip', t(key));
      }
    });
  }

  // --- THEME MANAGEMENT (Dark, Light, Auto) ---
  function detectTheme() {
    return localStorage.getItem('app_theme') || 'auto';
  }

  function getEffectiveTheme(themeChoice) {
    if (themeChoice === 'dark') return 'dark';
    if (themeChoice === 'light') return 'light';
    // 'auto': chiedi al sistema operativo
    return window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
  }

  function applyTheme(themeChoice, persist = true) {
    const effective = getEffectiveTheme(themeChoice);
    document.documentElement.setAttribute('data-theme', effective);
    document.documentElement.setAttribute('data-theme-setting', themeChoice);

    if (persist) {
      try {
        localStorage.setItem('app_theme', themeChoice);
      } catch (e) {}
    }

    updateThemeUI(themeChoice, effective);
  }

  function updateThemeUI(themeChoice, effective) {
    const iconEl = document.getElementById('currentThemeIcon');
    if (iconEl) {
      if (themeChoice === 'auto') {
        iconEl.innerText = effective === 'dark' ? '💻' : '💻';
      } else if (themeChoice === 'dark') {
        iconEl.innerText = '🌙';
      } else {
        iconEl.innerText = '☀️';
      }
    }

    ['auto', 'light', 'dark'].forEach(th => {
      const chk = document.getElementById('themeCheck-' + th);
      if (chk) {
        chk.style.display = (themeChoice === th) ? 'inline-block' : 'none';
      }
    });
  }

  // Ascolta cambi tema sistema operativo
  if (window.matchMedia) {
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => {
      const currentSetting = detectTheme();
      if (currentSetting === 'auto') {
        applyTheme('auto', false);
      }
    });
  }

  // Esponi globalmente
  window.I18N = {
    t,
    setLanguage,
    getLanguage,
    updateLangUI,
    applyStaticTranslations,
    applyTheme,
    detectTheme,
    getEffectiveTheme
  };

})(window);
