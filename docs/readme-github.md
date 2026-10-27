---
title: README Ufficiale GitHub
description: Documento README ufficiale del repository open source carlorigoni/eurario su GitHub.
---

# 🎓 Eurario — Repository Ufficiale GitHub

[![Docker Hub](https://img.shields.io/badge/docker%20hub-carlorigoni%2Feurario%3Alatest-blue?logo=docker)](https://hub.docker.com/r/carlorigoni/eurario)
[![FET Solver](https://img.shields.io/badge/FET%20engine-C%2B%2B%20native-orange.svg)](https://lalescu.ro/liviu/fet/)
[![License: AGPL v3](https://img.shields.io/badge/License-AGPLv3-green.svg)](https://www.gnu.org/licenses/agpl-3.0)

> 🔗 **Repository GitHub:** [github.com/carlorigoni/eurario](https://github.com/carlorigoni/eurario)

Applicazione web moderna, performante e intuitiva per la progettazione, ottimizzazione e pubblicazione dell'orario scolastico negli Istituti Superiori italiani, integrata con il solutore open source ad alte prestazioni **FET (Free Timetabling Software)**.

Zero dipendenze esterne Python, interfaccia reattiva in stile Google Classroom / Material 3 e immagine container multi-architettura pronta all'uso su Docker Hub.

---

## 🌟 Caratteristiche Principali

- **Solutore FET Integrato**:
  - Compilazione orario automatica in tempo reale con visualizzazione live dello stream del solutore e rilevamento colli di bottiglia (*bottleneck activities*).
  - Supporto al salvataggio e ripristino istantaneo dello stadio più avanzato (*highest stage*) in caso di arresto manuale o timeout.
- **Sistema di Blocco Orario (Locking)**:
  - Possibilità di bloccare intere classi o singole ore nella griglia oraria con vincoli FET permanenti al 100% (`ConstraintActivityPreferredStartingTime` e `ConstraintActivityPreferredRoom`), preservando fedelmente le collocazioni desiderate nei ricalcoli successivi.
- **Gestione Completa dell'Istituto**:
  - **Docenti**: orari di cattedra, tipologia contratto (intere, COE, spezzone, part-time), ore buche, massimo ore giornaliere, preferenze orarie e giorni liberi.
  - **Classi e Gruppi**: articolazioni per lingua straniera (es. Francese, Spagnolo, Tedesco), suddivisioni biennio/triennio per indirizzo di studio.
  - **Aule e Spazi Specialistici**: aule base, palestre condivise con gestione capienza contemporanea automatica, laboratori specialistici.
  - **Macro-Materie e Accorpamenti**: unione intelligente di cattedre affini (es. *Italiano Latino Storia e Geografia*) per un bilanciamento didattico ottimale.
  - **Disposizioni Intelligenti**: collocazione automatica delle ore a disposizione senza buchi e senza sovrapposizioni a lezioni pluri-orarie.
- **Sincronizzazione Organico e Modello Word (.docx)**:
  - Download diretto del **Modello Word (.docx)** pre-formattato per l'organico docenti o esportazione istantanea dell'organico attuale della scuola in Word.
  - Sincronizzazione automatica da file Word (.docx) o Google Docs con anteprima differenziale e conferma selettiva.
- **Dataset Demo & Reset a Foglio Bianco**:
  - Include un istituto didattico completo e funzionante (*Liceo Classico e Scientifico Statale "Scuola di Atene"*, docenti storici, classi, laboratori, palestra e orario già risolto al 100% in FET) per esplorare subito tutte le funzionalità senza panico da "foglio vuoto".
  - Possibilità di azzerare completamente il database creando un istituto pulito a foglio bianco per iniziare la propria scuola.
- **Architettura Leggera**:
  - **Zero librerie Python esterne** (utilizza esclusivamente i moduli standard di Python 3).

---

## 🐳 Immagine Ufficiale Docker Hub

L'applicazione è pubblicata come container pre-compilato con Linux Ubuntu, Python 3 e il solutore nativo C++ FET su **Docker Hub**:

👉 **Docker Hub Repository:** [`carlorigoni/eurario`](https://hub.docker.com/r/carlorigoni/eurario)

Non è necessario installare compiler C++, Qt o librerie grafiche: l'immagine include tutto il necessario pronto per il deploy immediato.

---

## 🚀 Avvio Rapido con Docker Compose

```yaml
version: '3.8'

services:
  eurario:
    container_name: eurario
    image: carlorigoni/eurario:latest
    restart: unless-stopped
    ports:
      - "8000:8000"
    volumes:
      - ./data:/app/data
    environment:
      - PORT=8000
      - PYTHONUNBUFFERED=1
```

Avvia il container:
```bash
docker compose up -d
```

L'applicazione risponde su:
👉 **`http://localhost:8000`**

---

## 🛠️ Sviluppo Locale (Senza Docker)

```bash
git clone https://github.com/carlorigoni/eurario.git
cd eurario

# Avvia l'applicazione direttamente con Python nativo
python3 -m webapp.server
```

Apri `http://localhost:8000` nel browser.

---

## 👥 Crediti & Ringraziamenti

- **Ideazione, Architettura & Sviluppo Full-Stack:** [Carlo Rigoni](https://github.com/carlorigoni)
- **Mentore dell'Orario & Guida Metodologica:** Federico Rettore
- **Motore Solutore FET:** Liviu Lalescu e Volker Dirr ([Sito Ufficiale FET](https://lalescu.ro/liviu/fet/))

---

## 📜 Licenza

Eurario è software libero rilasciato sotto i termini della licenza **GNU Affero General Public License v3.0 (AGPLv3)**.
