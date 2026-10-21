#!/usr/bin/env python3
"""
FET Bridge 7.12.0 - Server locale per la compilazione automatizzata con FET CLI (fet-cl)
e interfaccia web ottimizzata per Safari e macOS.

Avvio:
    python3 fet_bridge.py

Porta di default: 8765
Dashboard web Safari: http://127.0.0.1:8765
"""

import os
import sys
import json
import time
import signal
import shutil
import glob
import subprocess
import threading
from datetime import datetime
from http.server import HTTPServer, BaseHTTPRequestHandler
from urllib.parse import urlparse

PORT = 8765
PROJECT_DIR = os.path.dirname(os.path.abspath(__file__))
WORK_DIR = os.path.join(PROJECT_DIR, "fet_workspace")
DOWNLOADS_DIR = os.path.expanduser("~/Downloads")

# Stato globale del processo di calcolo
state = {
    "running": False,
    "process": None,
    "input_file": None,
    "output_dir": None,
    "total_activities": 0,
    "placed_activities": 0,
    "percent": 0.0,
    "start_time": 0.0,
    "elapsed_seconds": 0.0,
    "logs": [],
    "completed": False,
    "success": False,
    "stopped": False,
    "error": None,
    "result_file": None,
    "result_downloads_copy": None
}

state_lock = threading.Lock()


def find_fet_cl():
    """Cerca il binario fet-cl nel sistema o nella cartella del progetto."""
    candidates = [
        os.path.join(PROJECT_DIR, "fet-cl"),
        os.path.join(PROJECT_DIR, "build", "src", "cl", "fet-cl"),
        "/usr/local/bin/fet-cl",
        "/opt/homebrew/bin/fet-cl",
        shutil.which("fet-cl")
    ]
    for c in candidates:
        if c and os.path.isfile(c) and os.access(c, os.X_OK):
            return os.path.abspath(c)
    return None


def count_activities_in_xml(xml_content):
    """Conta le attività definite nel file XML per stimare il totale."""
    import re
    matches = re.findall(r"<Activity>", xml_content, re.IGNORECASE)
    return len(matches)


def find_latest_fet_file():
    """Cerca il file .fet più recente in ~/Downloads e nella cartella del progetto."""
    dirs = [DOWNLOADS_DIR, PROJECT_DIR, WORK_DIR]
    candidates = []
    for d in dirs:
        if os.path.exists(d):
            for pat in ["ParametriOrario*.fet", "*.fet"]:
                for f in glob.glob(os.path.join(d, pat)):
                    # Escludi file già risolti _timetable.fet
                    if not f.endswith("_data_and_timetable.fet") and os.path.isfile(f):
                        try:
                            mtime = os.path.getmtime(f)
                            candidates.append((mtime, f))
                        except Exception:
                            pass
    if not candidates:
        return None
    candidates.sort(key=lambda x: x[0], reverse=True)
    mtime, fpath = candidates[0]
    return {
        "path": fpath,
        "filename": os.path.basename(fpath),
        "size_kb": round(os.path.getsize(fpath) / 1024, 1),
        "mtime": mtime,
        "time_str": datetime.fromtimestamp(mtime).strftime("%d/%m/%Y %H:%M:%S")
    }


def monitor_fet_process(proc, out_dir, total_activities):
    """Thread in background che monitora il progresso di fet-cl."""
    global state
    while True:
        with state_lock:
            if not state["running"]:
                break

            # Cerca il file con il numero più alto di attività collocate generato da FET
            sim_dirs = glob.glob(os.path.join(out_dir, "**"), recursive=True)
            for d in sim_dirs:
                m_file = os.path.join(d, "highest_number_of_activities.txt")
                if os.path.exists(m_file):
                    try:
                        with open(m_file, "r") as f:
                            lines = [line.strip() for line in f if line.strip()]
                            if lines:
                                val = int(lines[-1])
                                state["placed_activities"] = max(state["placed_activities"], val)
                                if state["total_activities"] > 0:
                                    state["percent"] = round((state["placed_activities"] / state["total_activities"]) * 100, 1)
                    except Exception:
                        pass

            state["elapsed_seconds"] = round(time.time() - state["start_time"], 1)

            # Controlla se il processo è terminato
            ret = proc.poll()
            if ret is not None:
                state["running"] = False
                state["completed"] = True
                
                # Cerca il file timetable generato
                candidates = glob.glob(os.path.join(out_dir, "**", "*_data_and_timetable.fet"), recursive=True)
                if not candidates:
                    candidates = glob.glob(os.path.join(out_dir, "*_data_and_timetable.fet"))

                if candidates:
                    state["result_file"] = candidates[0]
                    state["success"] = True
                    state["percent"] = 100.0
                    state["placed_activities"] = state["total_activities"]
                    base_name = os.path.basename(candidates[0])
                    state["logs"].append(f"FET terminato con successo! File generato: {base_name}")

                    # Copia automatica in ~/Downloads per comodità dell'utente Safari
                    try:
                        dest_down = os.path.join(DOWNLOADS_DIR, base_name)
                        shutil.copy2(candidates[0], dest_down)
                        state["result_downloads_copy"] = dest_down
                        state["logs"].append(f"Copiato automaticamente in: {dest_down}")
                    except Exception:
                        pass
                else:
                    if state["stopped"]:
                        state["logs"].append("Calcolo interrotto su richiesta dell'utente.")
                    else:
                        state["logs"].append(f"FET terminato (codice {ret}). Nessun orario completo generato.")
                break

        time.sleep(0.5)


HTML_DASHBOARD = """<!DOCTYPE html>
<html lang="it">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>FET 7.12.0 - Console Locale di Risoluzione Orario (Safari)</title>
<style>
  :root {
    --primary: #1a73e8; --primary-hover: #1557b0;
    --danger: #d93025; --danger-hover: #b3261e;
    --success: #188038; --warn: #b06000;
    --bg: #f8f9fa; --card: #ffffff; --border: #dadce0;
    --text: #202124; --muted: #5f6368;
  }
  * { box-sizing: border-box; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
    background: var(--bg); color: var(--text); margin: 0; padding: 24px 16px; line-height: 1.5;
  }
  .container { max-width: 840px; margin: 0 auto; }
  .header {
    display: flex; align-items: center; justify-content: space-between;
    border-bottom: 2px solid var(--border); padding-bottom: 14px; margin-bottom: 20px;
  }
  .header h1 { font-size: 20px; margin: 0; font-weight: 600; display: flex; align-items: center; gap: 8px; }
  .badges { display: flex; gap: 8px; flex-wrap: wrap; }
  .badge { padding: 4px 10px; border-radius: 12px; font-size: 12px; font-weight: 500; display: inline-flex; align-items: center; gap: 4px; }
  .badge.ok { background: #e6f4ea; color: var(--success); }
  .badge.warn { background: #fef7e0; color: var(--warn); }
  .badge.err { background: #fce8e6; color: var(--danger); }
  .card {
    background: var(--card); border: 1px solid var(--border); border-radius: 8px;
    padding: 20px; margin-bottom: 18px; box-shadow: 0 1px 3px rgba(0,0,0,0.05);
  }
  .card-title { font-size: 15px; font-weight: 600; margin-top: 0; margin-bottom: 12px; display: flex; justify-content: space-between; align-items: center; }
  .btn {
    display: inline-flex; align-items: center; gap: 6px; font-size: 13px; font-weight: 500;
    padding: 9px 18px; border-radius: 6px; border: none; cursor: pointer; text-decoration: none;
    transition: background 0.15s ease;
  }
  .btn-primary { background: var(--primary); color: #fff; }
  .btn-primary:hover { background: var(--primary-hover); }
  .btn-primary:disabled { background: #dadce0; color: #80868b; cursor: not-allowed; }
  .btn-danger { background: var(--danger); color: #fff; }
  .btn-danger:hover { background: var(--danger-hover); }
  .btn-danger:disabled { background: #dadce0; color: #80868b; cursor: not-allowed; }
  .btn-success { background: var(--success); color: #fff; }
  .btn-success:hover { background: #137333; }
  .btn-sec { background: #fff; border: 1px solid var(--border); color: var(--text); }
  .btn-sec:hover { background: #f1f3f4; }
  .bar-bg { height: 16px; background: #e8eaed; border-radius: 8px; overflow: hidden; margin: 12px 0 8px; }
  .fill { height: 100%; width: 0%; background: var(--primary); transition: width 0.3s ease; }
  .fill.ok { background: var(--success); }
  .fill.warn { background: #f9ab00; }
  .fill.err { background: var(--danger); }
  .meta { display: flex; justify-content: space-between; font-size: 13px; color: var(--muted); margin-bottom: 12px; font-weight: 500; }
  .console {
    background: #1e1e1e; color: #d4d4d4; font-family: ui-monospace, Menlo, Monaco, Consolas, monospace;
    font-size: 12px; height: 210px; overflow-y: auto; padding: 10px 12px; border-radius: 6px;
    border: 1px solid #333; white-space: pre-wrap; word-break: break-all;
  }
  .actions { display: flex; gap: 10px; align-items: center; margin-top: 14px; flex-wrap: wrap; }
  .drop-zone {
    border: 2px dashed #b0c4de; border-radius: 8px; padding: 22px; text-align: center;
    color: var(--muted); cursor: pointer; background: #fbfcfe; transition: border-color 0.2s, background 0.2s;
  }
  .drop-zone:hover { border-color: var(--primary); background: #f0f7ff; }
  .auto-box {
    background: #e8f0fe; border: 1px solid #c2e7ff; border-radius: 8px; padding: 14px 16px;
    margin-bottom: 14px; display: flex; align-items: center; justify-content: space-between; gap: 12px;
  }
  .instructions { font-size: 12px; color: var(--muted); background: #f1f3f4; padding: 12px; border-radius: 6px; margin-top: 14px; }
  .instructions ol { margin: 6px 0 0 18px; padding: 0; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1><span>⚡</span> FET 7.12.0 - Console Locale per Safari</h1>
    <div class="badges">
      <div id="bridgeBadge" class="badge ok">● Bridge Attivo (127.0.0.1:8765)</div>
      <div id="fetBadge" class="badge warn">● fet-cl: verifica...</div>
    </div>
  </div>

  <div id="cardAutoFile" class="card" style="display:none;">
    <div class="card-title">File recente rilevato in Download</div>
    <div class="auto-box">
      <div>
        <div style="font-weight: 600; color: #0b57d0;" id="autoFileName">ParametriOrario.fet</div>
        <div style="font-size: 12px; color: #5f6368;" id="autoFileMeta">Rilevato nella cartella Download del Mac</div>
      </div>
      <button class="btn btn-primary" onclick="avviaAutoFile()">▶ Compila questo file con FET</button>
    </div>
  </div>

  <div class="card" id="cardFileSelect">
    <div class="card-title">Seleziona o trascina il file .fet</div>
    <div id="dropZone" class="drop-zone" onclick="document.getElementById('fileInput').click()" ondragover="event.preventDefault(); this.style.borderColor='#1a73e8';" ondragleave="this.style.borderColor='#b0c4de';" ondrop="handleDrop(event)">
      <div style="font-size: 26px; margin-bottom: 4px;">📁</div>
      <div><b>Trascina qui il file .fet</b> (scaricato dal Foglio Google) oppure <u>clicca per selezionarlo dal Mac</u></div>
      <input type="file" id="fileInput" accept=".fet,.xml" style="display:none" onchange="handleFile(this.files[0])">
      <div id="selectedFileName" style="margin-top: 8px; font-weight: bold; color: var(--primary);"></div>
    </div>
    <div class="actions">
      <button id="btnAvviaFile" class="btn btn-primary" onclick="avviaFileSelezionato()" disabled>▶ Avvia Compilazione Orario (FET 7.12.0)</button>
      <span id="fileStatusLabel" style="font-size: 12px; color: var(--muted);"></span>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Stato Risoluzione Orario</div>
    <div id="statusDesc" style="font-size:13px; margin-bottom:8px;">In attesa di avvio compilazione...</div>
    
    <div class="bar-bg"><div id="progFill" class="fill"></div></div>
    <div class="meta">
      <span id="progLabel">0 / 0 attività collocate (0%)</span>
      <span id="timerLabel">Tempo trascorso: 00:00</span>
    </div>

    <div class="actions">
      <button id="btnStop" class="btn btn-danger" onclick="stopCalc()" disabled>⏹ Interrompi Calcolo</button>
      <a id="btnDownload" href="/download" class="btn btn-success" style="display:none;" download>📥 Scarica Orario Risolto (.fet)</a>
      <span id="downloadNote" style="font-size: 12px; color: #188038; display:none;">(Il file è stato anche salvato in automatico nella cartella <b>Download</b> del tuo Mac!)</span>
    </div>
  </div>

  <div class="card">
    <div class="card-title">Log in tempo reale di FET 7.12.0</div>
    <div id="logConsole" class="console">In attesa dell'esecuzione di fet-cl...</div>
  </div>

  <div class="card">
    <div class="card-title">Come integrare con Google Sheets in Safari</div>
    <div class="instructions">
      <b>Flusso semplice in 3 passi per Safari:</b>
      <ol>
        <li>Nel Foglio Google, usa <b>FET v2.02 &gt; 7. Genera file per FET (.fet)</b> e scaricalo.</li>
        <li>Qui su Safari, clicca <b>&quot;Compila questo file con FET&quot;</b> (lo rileva da solo!) oppure trascinalo nel riquadro tratteggiato.</li>
        <li>A risoluzione ultimata (100%), torna nel Foglio Google e clicca su <b>FET v2.02 &gt; 9. Crea orario docenti</b>: tutti i 6 fogli di report verranno compilati in automatico!</li>
      </ol>
    </div>
  </div>
</div>

<script>
var timerInterval = null, pollInterval = null;
var startTime = null;
var selectedContent = null, selectedName = null;
var autoFilePath = null;
var LF = String.fromCharCode(10);

function handleDrop(e) {
  e.preventDefault();
  e.currentTarget.style.borderColor = '#b0c4de';
  if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
    handleFile(e.dataTransfer.files[0]);
  }
}

function handleFile(file) {
  if (!file) return;
  selectedName = file.name;
  document.getElementById("selectedFileName").innerText = "File pronto: " + file.name + " (" + Math.round(file.size / 1024) + " KB)";
  var reader = new FileReader();
  reader.onload = function(e) {
    selectedContent = e.target.result;
    document.getElementById("btnAvviaFile").disabled = false;
    document.getElementById("fileStatusLabel").innerText = "File caricato in memoria. Clicca Avvia.";
  };
  reader.readAsText(file, "UTF-8");
}

function avviaFileSelezionato() {
  if (!selectedContent) return;
  document.getElementById("btnAvviaFile").disabled = true;
  document.getElementById("statusDesc").innerHTML = "<b>Invio file a fet-cl 7.12.0...</b>";
  fetch("/solve", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ xml: selectedContent, filename: selectedName, timelimit: 7200 })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.status === "started") {
      document.getElementById("statusDesc").innerHTML = "<b>Compilazione avviata con successo!</b>";
    } else {
      alert("Errore avvio FET: " + (d.error || JSON.stringify(d)));
      document.getElementById("btnAvviaFile").disabled = false;
    }
  })
  .catch(function(err){
    alert("Errore comunicazione: " + err.message);
    document.getElementById("btnAvviaFile").disabled = false;
  });
}

function avviaAutoFile() {
  if (!autoFilePath) return;
  document.getElementById("statusDesc").innerHTML = "<b>Avvio compilazione del file rilevato...</b>";
  fetch("/solve_auto", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ path: autoFilePath })
  })
  .then(function(r){ return r.json(); })
  .then(function(d){
    if (d.status === "started") {
      document.getElementById("statusDesc").innerHTML = "<b>Compilazione avviata con successo!</b>";
    } else {
      alert("Errore avvio: " + (d.error || JSON.stringify(d)));
    }
  });
}

function scanDownloads() {
  fetch("/scan_downloads")
    .then(function(r){ return r.json(); })
    .then(function(d){
      if (d.found) {
        autoFilePath = d.path;
        document.getElementById("autoFileName").innerText = d.filename + " (" + d.size_kb + " KB)";
        document.getElementById("autoFileMeta").innerText = "Generato il " + d.time_str + " (" + d.path + ")";
        document.getElementById("cardAutoFile").style.display = "block";
      }
    })
    .catch(function(e){});
}

function poll() {
  fetch("/status")
    .then(function(r){ return r.json(); })
    .then(function(s){
      var pct = s.percent || 0;
      var fill = document.getElementById("progFill");
      fill.style.width = pct + "%";
      document.getElementById("progLabel").innerText = s.placed + " / " + s.total + " attività collocate (" + pct + "%)";

      if (s.running) {
        document.getElementById("btnStop").disabled = false;
        document.getElementById("btnDownload").style.display = "none";
        document.getElementById("downloadNote").style.display = "none";
        fill.className = "fill";
        document.getElementById("statusDesc").innerHTML = "<b>Compilazione in corso con fet-cl 7.12.0...</b>";
        if (!startTime && s.elapsed) startTime = Date.now() - (s.elapsed * 1000);
      } else if (s.completed) {
        document.getElementById("btnStop").disabled = true;
        if (s.success) {
          fill.className = "fill ok";
          document.getElementById("statusDesc").innerHTML = "<b style='color:#188038;'>🎉 Orario risolto al 100%! Compilazione completata con successo!</b>";
          document.getElementById("btnDownload").style.display = "inline-flex";
          document.getElementById("downloadNote").style.display = "inline-block";
        } else if (s.stopped) {
          fill.className = "fill warn";
          document.getElementById("statusDesc").innerHTML = "<b style='color:#b06000;'>⚠️ Calcolo interrotto dall'utente.</b>";
          if (s.has_result) {
            document.getElementById("btnDownload").style.display = "inline-flex";
            document.getElementById("downloadNote").style.display = "inline-block";
          }
        } else {
          fill.className = "fill err";
          document.getElementById("statusDesc").innerHTML = "<b style='color:#d93025;'>❌ Compilazione fallita o vincoli troppo stretti.</b>";
        }
      }

      if (s.logs && s.logs.length > 0) {
        var c = document.getElementById("logConsole");
        c.innerText = s.logs.join(LF);
        c.scrollTop = c.scrollHeight;
      }

      if (s.elapsed) {
        var sec = Math.floor(s.elapsed);
        var m = Math.floor(sec / 60);
        var remSec = sec % 60;
        document.getElementById("timerLabel").innerText = "Tempo trascorso: " + (m < 10 ? "0" + m : m) + ":" + (remSec < 10 ? "0" + remSec : remSec);
      }
    })
    .catch(function(e){});
}

function checkInit() {
  fetch("/ping")
    .then(function(r){ return r.json(); })
    .then(function(d){
      var fetBadge = document.getElementById("fetBadge");
      if (d.fet_cl_found) {
        fetBadge.className = "badge ok";
        fetBadge.innerText = "● fet-cl 7.12.0 rilevato (Apple Silicon)";
      } else {
        fetBadge.className = "badge err";
        fetBadge.innerText = "● fet-cl non trovato";
      }
    });
}

function stopCalc() {
  if (confirm("Vuoi davvero interrompere il calcolo di fet-cl?")) {
    document.getElementById("btnStop").disabled = true;
    fetch("/stop", { method: "POST" });
  }
}

checkInit();
scanDownloads();
setInterval(poll, 700);
setInterval(scanDownloads, 4000);
poll();
</script>
</body>
</html>
"""


class FETRequestHandler(BaseHTTPRequestHandler):
    def _send_cors_headers(self):
        origin = self.headers.get("Origin") or "*"
        self.send_header("Access-Control-Allow-Origin", origin)
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type, Authorization, X-Requested-With, Access-Control-Request-Private-Network")
        self.send_header("Access-Control-Allow-Private-Network", "true")
        self.send_header("Access-Control-Allow-Credentials", "true")

    def do_OPTIONS(self):
        self.send_response(204)
        self._send_cors_headers()
        self.send_header("Content-Length", "0")
        self.end_headers()

    def do_GET(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/":
            accept = self.headers.get("Accept", "")
            if "text/html" in accept or "*/*" in accept:
                html_bytes = HTML_DASHBOARD.encode("utf-8")
                self.send_response(200)
                self.send_header("Content-Type", "text/html; charset=utf-8")
                self.send_header("Content-Length", str(len(html_bytes)))
                self._send_cors_headers()
                self.end_headers()
                self.wfile.write(html_bytes)
                return

        if path == "/" or path == "/ping":
            fet_bin = find_fet_cl()
            data = {
                "status": "ok",
                "message": "FET Bridge è attivo e pronto per la compilazione!",
                "version": "1.0",
                "fet_cl_found": fet_bin is not None,
                "fet_path": fet_bin or "NON TROVATO"
            }
            self._send_json(200, data)

        elif path == "/scan_downloads":
            latest = find_latest_fet_file()
            if latest:
                self._send_json(200, {
                    "found": True,
                    "filename": latest["filename"],
                    "path": latest["path"],
                    "size_kb": latest["size_kb"],
                    "time_str": latest["time_str"]
                })
            else:
                self._send_json(200, {"found": False})

        elif path == "/status":
            with state_lock:
                data = {
                    "running": state["running"],
                    "placed": state["placed_activities"],
                    "total": state["total_activities"],
                    "percent": state["percent"],
                    "elapsed": state["elapsed_seconds"],
                    "logs": state["logs"][-25:],
                    "completed": state["completed"],
                    "success": state["success"],
                    "stopped": state["stopped"],
                    "error": state["error"],
                    "has_result": state["result_file"] is not None and os.path.exists(state["result_file"]),
                    "downloads_copy": state.get("result_downloads_copy")
                }
            self._send_json(200, data)

        elif path == "/result":
            with state_lock:
                res_file = state.get("result_file")
            
            if res_file and os.path.exists(res_file):
                try:
                    with open(res_file, "r", encoding="utf-8", errors="ignore") as f:
                        xml_data = f.read()
                    data = {
                        "filename": os.path.basename(res_file),
                        "xml": xml_data
                    }
                    self._send_json(200, data)
                except Exception as e:
                    self._send_json(500, {"error": f"Errore lettura file orario: {str(e)}"})
            else:
                self._send_json(404, {"error": "Nessun file orario disponibile."})

        elif path == "/download":
            with state_lock:
                res_file = state.get("result_file")

            if res_file and os.path.exists(res_file):
                try:
                    with open(res_file, "rb") as f:
                        content = f.read()
                    self.send_response(200)
                    self.send_header("Content-Type", "application/octet-stream")
                    self.send_header("Content-Disposition", f'attachment; filename="{os.path.basename(res_file)}"')
                    self.send_header("Content-Length", str(len(content)))
                    self._send_cors_headers()
                    self.end_headers()
                    self.wfile.write(content)
                except Exception as e:
                    self._send_json(500, {"error": f"Errore download file: {str(e)}"})
            else:
                self._send_json(404, {"error": "Nessun orario risolto pronto per il download."})

        else:
            self._send_json(404, {"error": "Endpoint non trovato"})

    def do_POST(self):
        parsed = urlparse(self.path)
        path = parsed.path

        if path == "/solve":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                req = json.loads(body)
                xml_content = req.get("xml", "")
                filename = req.get("filename", "ParametriOrario.fet")
                timelimit = int(req.get("timelimit", 7200))
            except Exception as e:
                self._send_json(400, {"error": f"Payload non valido: {str(e)}"})
                return

            self._start_solver(xml_content, filename, timelimit)

        elif path == "/solve_auto":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length).decode("utf-8")
                req = json.loads(body)
                fpath = req.get("path")
                if not fpath or not os.path.exists(fpath):
                    self._send_json(400, {"error": "File non trovato."})
                    return
                with open(fpath, "r", encoding="utf-8", errors="ignore") as f:
                    xml_content = f.read()
                filename = os.path.basename(fpath)
            except Exception as e:
                self._send_json(400, {"error": f"Errore lettura file: {str(e)}"})
                return

            self._start_solver(xml_content, filename, 7200)

        elif path == "/stop":
            with state_lock:
                if state["running"] and state["process"]:
                    state["stopped"] = True
                    state["logs"].append("Invio segnale di interruzione pulita a fet-cl...")
                    try:
                        state["process"].send_signal(signal.SIGINT)
                    except Exception:
                        try:
                            state["process"].terminate()
                        except Exception:
                            pass
                    self._send_json(200, {"status": "stopping"})
                else:
                    self._send_json(200, {"status": "not_running"})

        else:
            self._send_json(404, {"error": "Endpoint non trovato"})

    def _start_solver(self, xml_content, filename, timelimit):
        fet_bin = find_fet_cl()
        if not fet_bin:
            self._send_json(400, {
                "error": "Binario 'fet-cl' non trovato. Assicurati che fet-cl sia presente nella cartella del progetto."
            })
            return

        if not xml_content.strip():
            self._send_json(400, {"error": "Contenuto XML vuoto."})
            return

        os.makedirs(WORK_DIR, exist_ok=True)
        input_path = os.path.join(WORK_DIR, filename)
        output_dir = os.path.join(WORK_DIR, "output")
        
        if os.path.exists(output_dir):
            shutil.rmtree(output_dir, ignore_errors=True)
        os.makedirs(output_dir, exist_ok=True)

        with open(input_path, "w", encoding="utf-8") as f:
            f.write(xml_content)

        total_act = count_activities_in_xml(xml_content)

        cmd = [
            fet_bin,
            f"--inputfile={input_path}",
            f"--outputdir={output_dir}",
            f"--timelimitseconds={timelimit}"
        ]

        with state_lock:
            if state["running"] and state["process"]:
                try:
                    state["process"].terminate()
                except Exception:
                    pass

            try:
                proc = subprocess.Popen(
                    cmd,
                    stdout=subprocess.PIPE,
                    stderr=subprocess.STDOUT,
                    text=True,
                    bufsize=1
                )
            except Exception as e:
                self._send_json(500, {"error": f"Impossibile avviare fet-cl: {str(e)}"})
                return

            state["running"] = True
            state["process"] = proc
            state["input_file"] = input_path
            state["output_dir"] = output_dir
            state["total_activities"] = total_act
            state["placed_activities"] = 0
            state["percent"] = 0.0
            state["start_time"] = time.time()
            state["elapsed_seconds"] = 0.0
            state["logs"] = [f"Avvio di fet-cl 7.12.0 su {filename}...", f"Attività totali da collocare: {total_act}"]
            state["completed"] = False
            state["success"] = False
            state["stopped"] = False
            state["error"] = None
            state["result_file"] = None
            state["result_downloads_copy"] = None

        t_mon = threading.Thread(target=monitor_fet_process, args=(proc, output_dir, total_act), daemon=True)
        t_mon.start()

        t_out = threading.Thread(target=self._stream_stdout, args=(proc,), daemon=True)
        t_out.start()

        self._send_json(200, {
            "status": "started",
            "activities": total_act,
            "input_file": filename
        })

    def _stream_stdout(self, proc):
        """Legge le righe di stdout emesse da fet-cl e le aggiunge ai log."""
        try:
            for line in iter(proc.stdout.readline, ''):
                if not line:
                    break
                clean_line = line.strip()
                if clean_line:
                    with state_lock:
                        state["logs"].append(clean_line)
                        if len(state["logs"]) > 100:
                            state["logs"] = state["logs"][-100:]
            proc.stdout.close()
        except Exception:
            pass

    def _send_json(self, code, data):
        body = json.dumps(data).encode("utf-8")
        self.send_response(code)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Content-Length", str(len(body)))
        self._send_cors_headers()
        self.end_headers()
        self.wfile.write(body)

    def log_message(self, format, *args):
        now = datetime.now().strftime("%H:%M:%S")
        sys.stderr.write(f"[{now}] {format % args}\n")
        sys.stderr.flush()


def main():
    fet_bin = find_fet_cl()
    print("=" * 65)
    print("  FET Bridge 7.12.0 - Server locale per compilazione orario")
    print("=" * 65)
    print(f"  • Console Web Safari: http://127.0.0.1:{PORT}")
    print(f"  • Cartella Progetto:  {PROJECT_DIR}")
    print(f"  • Cartella Download:  {DOWNLOADS_DIR}")
    if fet_bin:
        print(f"  • fet-cl:             TROVATO -> {fet_bin}")
    else:
        print("  • fet-cl:             NON TROVATO nel PATH o nella cartella locale.")
    print("=" * 65)
    print("  In ascolto delle richieste...")
    print("  Premi Ctrl+C per arrestare il bridge.\n")

    server = HTTPServer(("127.0.0.1", PORT), FETRequestHandler)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        print("\nArresto di FET Bridge...")
        with state_lock:
            if state["running"] and state["process"]:
                state["process"].terminate()
        server.server_close()
        print("Bridge arrestato.")


if __name__ == "__main__":
    main()
