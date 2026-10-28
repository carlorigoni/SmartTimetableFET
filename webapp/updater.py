"""
Eurario - Modulo Update Checker & Auto-Updater (Docker Hub & GitHub)
Verifica in background e su richiesta la presenza di versioni aggiornate dell'applicazione,
e permette agli amministratori autorizzati di innescare l'aggiornamento automatico del server.
Opera in totale sicurezza e resilienza: in ambienti isolati o privi di connessione (air-gapped)
non blocca il server né genera eccezioni bloccanti.
"""

import os
import re
import time
import json
import ssl
import shutil
import socket
import subprocess
import http.client
import urllib.request

CACHE_TTL = 300  # 5 minuti di cache per evitare richieste eccessive
_update_cache = {
    "timestamp": 0,
    "data": None
}


class UnixSocketConnection(http.client.HTTPConnection):
    """Client HTTP nativo standard library su socket UNIX locale (per Docker Engine API)."""
    def __init__(self, socket_path, timeout=60):
        super().__init__("localhost", timeout=timeout)
        self.socket_path = socket_path

    def connect(self):
        self.sock = socket.socket(socket.AF_UNIX, socket.SOCK_STREAM)
        self.sock.settimeout(self.timeout)
        self.sock.connect(self.socket_path)


def parse_semver(v_str):
    if not v_str:
        return (0, 0, 0)
    cleaned = v_str.strip().lstrip("v")
    parts = []
    for p in cleaned.split("."):
        digits = re.match(r"^(\d+)", p)
        if digits:
            parts.append(int(digits.group(1)))
        else:
            parts.append(0)
    while len(parts) < 3:
        parts.append(0)
    return tuple(parts[:3])


def check_for_updates(current_version, force=False):
    now = time.time()
    if not force and _update_cache["data"] and (now - _update_cache["timestamp"] < CACHE_TTL):
        cached = dict(_update_cache["data"])
        cached["current_version"] = current_version
        if parse_semver(cached.get("remote_version")) > parse_semver(current_version):
            cached["update_available"] = True
        else:
            cached["update_available"] = False
        return cached

    result = {
        "current_version": current_version,
        "remote_version": current_version,
        "update_available": False,
        "docker_hub_tag": "latest",
        "docker_hub_image": "carlorigoni/eurario",
        "docker_hub_last_updated": None,
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "message": "Eurario è aggiornato all'ultima versione.",
        "error": None
    }

    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except Exception:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    remote_found_version = None

    # 1. Controllo versione su GitHub raw (fonte immediata del repository upstream)
    try:
        gh_url = "https://raw.githubusercontent.com/carlorigoni/eurario/main/webapp/server.py"
        req = urllib.request.Request(gh_url, headers={"User-Agent": f"Eurario-Updater/{current_version}"})
        with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            m = re.search(r'APP_VERSION\s*=\s*[\"\']([^\"\']+)[\"\']', content)
            if m:
                remote_found_version = m.group(1).strip()
    except Exception as e:
        result["error"] = str(e)

    # 2. Controllo metadati ultimo push e tag su Docker Hub
    try:
        dh_url = "https://hub.docker.com/v2/repositories/carlorigoni/eurario/tags?page_size=10"
        req = urllib.request.Request(dh_url, headers={"User-Agent": f"Eurario-Updater/{current_version}"})
        with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            results = data.get("results", [])
            latest_dh_ver = None
            for r in results:
                tname = r.get("name", "")
                if tname == "latest":
                    result["docker_hub_last_updated"] = r.get("last_updated") or r.get("tag_last_pushed")
                elif re.match(r"^v?\d+\.\d+\.\d+$", tname):
                    v_clean = tname.lstrip("v")
                    if not latest_dh_ver or parse_semver(v_clean) > parse_semver(latest_dh_ver):
                        latest_dh_ver = v_clean
            if latest_dh_ver and (not remote_found_version or parse_semver(latest_dh_ver) > parse_semver(remote_found_version)):
                remote_found_version = latest_dh_ver
    except Exception:
        pass

    if remote_found_version:
        result["remote_version"] = remote_found_version
        if parse_semver(remote_found_version) > parse_semver(current_version):
            result["update_available"] = True
            result["message"] = f"Nuova versione v{remote_found_version} disponibile su Docker Hub!"
        else:
            result["update_available"] = False
            result["message"] = "Eurario è aggiornato all'ultima versione disponibile."

    _update_cache["timestamp"] = now
    _update_cache["data"] = result
    return result


def apply_in_place_github_update():
    """
    Scarica l'archivio dell'ultima versione da GitHub e aggiorna i file dell'applicazione
    direttamente in-place (preservando rigorosamente webapp/data/), riavviando il processo
    Python in modo trasparente e autonomo senza dipendere da Watchtower o Docker socket.
    """
    import io
    import sys
    import tarfile
    import threading

    app_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    # Non eseguire l'in-place tarball update se siamo in un ambiente di sviluppo Git locale attivo
    if os.path.isdir(os.path.join(app_dir, ".git")):
        raise RuntimeError("Ambiente di sviluppo locale Git rilevato: usa git pull.")

    tar_url = "https://codeload.github.com/carlorigoni/eurario/tar.gz/refs/heads/main"
    ctx = ssl.create_default_context()
    try:
        import certifi
        ctx.load_verify_locations(certifi.where())
    except Exception:
        ctx.check_hostname = False
        ctx.verify_mode = ssl.CERT_NONE

    req = urllib.request.Request(
        tar_url,
        headers={"User-Agent": "Eurario-Live-Updater/1.0"}
    )

    with urllib.request.urlopen(req, context=ctx, timeout=30) as resp:
        tar_bytes = resp.read()

    with tarfile.open(fileobj=io.BytesIO(tar_bytes), mode="r:gz") as tar:
        members = tar.getmembers()
        # Trova il prefisso radice (es. 'eurario-main/')
        prefix = ""
        for m in members:
            if m.name.endswith("/webapp") or "/webapp/" in m.name:
                prefix = m.name.split("/webapp")[0] + "/"
                break

        if not prefix:
            raise ValueError("Struttura archivio non riconosciuta (cartella webapp mancante).")

        updated_files = 0
        for m in members:
            if not m.name.startswith(prefix):
                continue
            rel_path = m.name[len(prefix):]
            if not rel_path:
                continue

            # PROTEZIONE ASSOLUTA: NON toccare MAI la cartella dei dati persistenti
            if rel_path.startswith("webapp/data/") or rel_path == "webapp/data":
                continue

            if rel_path == "README.md":
                dest_file = os.path.join(app_dir, "README.md")
                f = tar.extractfile(m)
                if f:
                    with open(dest_file, "wb") as out:
                        out.write(f.read())
                continue

            if not rel_path.startswith("webapp/"):
                continue

            dest_path = os.path.join(app_dir, rel_path)
            if m.isdir():
                os.makedirs(dest_path, exist_ok=True)
            elif m.isfile():
                os.makedirs(os.path.dirname(dest_path), exist_ok=True)
                f = tar.extractfile(m)
                if f:
                    content = f.read()
                    tmp_dest = f"{dest_path}.tmp.{os.getpid()}"
                    with open(tmp_dest, "wb") as out:
                        out.write(content)
                    os.replace(tmp_dest, dest_path)
                    updated_files += 1

    # Invalida cache interna degli aggiornamenti
    _update_cache["timestamp"] = 0
    _update_cache["data"] = None

    # Pianifica il riavvio del processo Python dopo 1.2 secondi per consentire l'invio della risposta HTTP al client
    def _delayed_restart():
        time.sleep(1.2)
        try:
            python_bin = sys.executable
            script = os.path.abspath(sys.argv[0])
            args = [python_bin, script] + sys.argv[1:]
            print(f"[LIVE-UPDATER] Riavvio processo in corso con {args}...")
            os.execv(python_bin, args)
        except Exception as e_restart:
            print(f"[LIVE-UPDATER] Errore execv: {e_restart}, uscita processo per riavvio container...")
            os._exit(0)

    t = threading.Thread(target=_delayed_restart, daemon=True)
    t.start()

    return {
        "success": True,
        "method": "in_place_live_update",
        "updated_files": updated_files,
        "message": "Aggiornamento completato con successo! Il server si sta riavviando con la nuova versione..."
    }


def apply_update():
    """
    Innesca l'aggiornamento automatico dell'applicazione Eurario sul server.
    Supporta in cascata:
    1. Live In-Place Update da GitHub (per Docker container)
    2. Watchtower HTTP API (deploy in container Docker con container Watchtower attivo)
    3. Socket Docker UNIX (/var/run/docker.sock)
    4. Docker Compose CLI su host (docker compose pull && docker compose up -d)
    5. Git pull (se esegue da repository locale con .git)
    6. Script hook personalizzato (scripts/update.sh o update.sh)
    """
    root_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    errors = []

    # 1. Tentativo prioritario: Live In-Place Update da GitHub (per container Docker)
    try:
        live_res = apply_in_place_github_update()
        if live_res and live_res.get("success"):
            return live_res
    except Exception as e:
        errors.append(f"Live In-Place: {e}")

    # 2. Tentativo tramite Watchtower HTTP API (container Docker)
    watchtower_url = os.environ.get("WATCHTOWER_API_URL") or "http://eurario_watchtower:8080/v1/update"
    token = os.environ.get("WATCHTOWER_TOKEN", "eurario-update-token")
    candidate_urls = [
        watchtower_url,
        "http://eurario_watchtower:8080/v1/update",
        "http://watchtower:8080/v1/update",
        "http://localhost:8080/v1/update",
        "http://127.0.0.1:8080/v1/update"
    ]
    seen_urls = set()
    for url in candidate_urls:
        if not url or url in seen_urls:
            continue
        seen_urls.add(url)
        try:
            req = urllib.request.Request(
                url,
                data=b"",
                headers={"Authorization": f"Bearer {token}", "User-Agent": "Eurario-Web-Updater"},
                method="POST"
            )
            with urllib.request.urlopen(req, timeout=15) as resp:
                if resp.status in (200, 202, 204):
                    return {
                        "success": True,
                        "method": "watchtower",
                        "message": "Aggiornamento innescato con successo tramite Watchtower. Il container sta scaricando la nuova versione e si riavvierà a breve."
                    }
        except Exception as e:
            errors.append(f"Watchtower ({url}): {e}")

    # 2. Tentativo tramite Docker Unix Socket (/var/run/docker.sock)
    docker_sock = "/var/run/docker.sock"
    if os.path.exists(docker_sock):
        try:
            conn = UnixSocketConnection(docker_sock, timeout=60)
            conn.request("POST", "/images/create?fromImage=carlorigoni%2Feurario&tag=latest")
            resp = conn.getresponse()
            resp.read()
            conn.close()

            # Riavvia watchtower se presente per forzare la ricreazione del container eurario
            try:
                conn_wt = UnixSocketConnection(docker_sock, timeout=10)
                conn_wt.request("POST", "/containers/eurario_watchtower/restart")
                r_wt = conn_wt.getresponse()
                r_wt.read()
                conn_wt.close()
            except Exception:
                pass

            return {
                "success": True,
                "method": "docker_socket",
                "message": "Nuova immagine scaricata da Docker Hub e riavvio container pianificato."
            }
        except Exception as e:
            errors.append(f"Docker Socket: {e}")

    # 3. Tentativo tramite Docker Compose CLI su host
    docker_bin = shutil.which("docker")
    compose_file_exists = os.path.exists(os.path.join(root_dir, "docker-compose.yml")) or os.path.exists("docker-compose.yml")
    if docker_bin and compose_file_exists:
        try:
            pull_proc = subprocess.run([docker_bin, "compose", "pull"], cwd=root_dir, capture_output=True, text=True, timeout=120)
            if pull_proc.returncode == 0:
                subprocess.Popen([docker_bin, "compose", "up", "-d"], cwd=root_dir)
                return {
                    "success": True,
                    "method": "docker_compose_cli",
                    "output": pull_proc.stdout.strip(),
                    "message": "Nuova versione scaricata con successo e container in riavvio con i dati persistenti intatti."
                }
            else:
                errors.append(f"Docker compose pull fallito: {pull_proc.stderr.strip() or pull_proc.stdout.strip()}")
        except Exception as e:
            errors.append(f"Docker compose CLI: {e}")

    # 4. Tentativo tramite Git Pull (per server o installazioni da repository Git)
    git_dir = os.path.join(root_dir, ".git")
    git_bin = shutil.which("git")
    if git_bin and os.path.isdir(git_dir):
        try:
            subprocess.run([git_bin, "fetch", "origin", "main"], cwd=root_dir, capture_output=True, text=True, timeout=20)
            pull_res = subprocess.run([git_bin, "pull", "origin", "main"], cwd=root_dir, capture_output=True, text=True, timeout=30)
            if pull_res.returncode == 0:
                # Invalida cache interna degli aggiornamenti
                _update_cache["timestamp"] = 0
                _update_cache["data"] = None
                return {
                    "success": True,
                    "method": "git_pull",
                    "output": pull_res.stdout.strip(),
                    "message": "Codice aggiornato con successo dal repository Git. Ricarica la pagina per caricare la nuova versione."
                }
            else:
                errors.append(f"Git pull fallito: {pull_res.stderr.strip() or pull_res.stdout.strip()}")
        except Exception as e:
            errors.append(f"Git pull: {e}")

    # 5. Tentativo tramite Script Hook (scripts/update.sh o update.sh)
    custom_scripts = [
        os.path.join(root_dir, "scripts", "update.sh"),
        os.path.join(root_dir, "update.sh")
    ]
    for s_path in custom_scripts:
        if os.path.isfile(s_path) and os.access(s_path, os.X_OK):
            try:
                s_res = subprocess.run([s_path], cwd=root_dir, capture_output=True, text=True, timeout=120)
                if s_res.returncode == 0:
                    return {
                        "success": True,
                        "method": "custom_script",
                        "output": s_res.stdout.strip(),
                        "message": "Script di aggiornamento eseguito con successo."
                    }
                else:
                    errors.append(f"Script {s_path} fallito con codice {s_res.returncode}: {s_res.stderr.strip()}")
            except Exception as e:
                errors.append(f"Script {s_path}: {e}")

    # Se nessuna strategia automatica è stata eseguibile
    err_detail = " | ".join(errors) if errors else "Nessun provider di aggiornamento (Watchtower, Docker Socket o Git) disponibile."
    return {
        "success": False,
        "error": f"Impossibile completare l'aggiornamento automatico in background ({err_detail}). È possibile procedere manualmente da terminale sul server con il comando: docker compose pull && docker compose up -d"
    }
