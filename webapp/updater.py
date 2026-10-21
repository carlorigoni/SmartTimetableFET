"""
SmartTimetable - Modulo Update Checker (Docker Hub & GitHub)
Verifica in background e su richiesta la presenza di versioni aggiornate dell'applicazione.
Opera in totale sicurezza e resilienza: in ambienti isolati o privi di connessione (air-gapped)
non blocca il server né genera eccezioni bloccanti.
"""

import time
import re
import json
import ssl
import urllib.request

CACHE_TTL = 300  # 5 minuti di cache per evitare richieste eccessive
_update_cache = {
    "timestamp": 0,
    "data": None
}


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
        return _update_cache["data"]

    result = {
        "current_version": current_version,
        "remote_version": current_version,
        "update_available": False,
        "docker_hub_tag": "latest",
        "docker_hub_image": "carlorigoni/smarttimetablefet",
        "docker_hub_last_updated": None,
        "checked_at": time.strftime("%Y-%m-%d %H:%M:%S"),
        "message": "SmartTimetable è aggiornato all'ultima versione.",
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
        gh_url = "https://raw.githubusercontent.com/carlorigoni/SmartTimetableFET/main/webapp/server.py"
        req = urllib.request.Request(gh_url, headers={"User-Agent": f"SmartTimetable-Updater/{current_version}"})
        with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
            content = resp.read().decode("utf-8", errors="ignore")
            m = re.search(r'APP_VERSION\s*=\s*[\"\']([^\"\']+)[\"\']', content)
            if m:
                remote_found_version = m.group(1).strip()
    except Exception as e:
        result["error"] = str(e)

    # 2. Controllo metadati ultimo push su Docker Hub
    try:
        dh_url = "https://hub.docker.com/v2/repositories/carlorigoni/smarttimetablefet/tags?page_size=5"
        req = urllib.request.Request(dh_url, headers={"User-Agent": f"SmartTimetable-Updater/{current_version}"})
        with urllib.request.urlopen(req, context=ctx, timeout=4) as resp:
            data = json.loads(resp.read().decode("utf-8", errors="ignore"))
            results = data.get("results", [])
            for r in results:
                if r.get("name") == "latest":
                    result["docker_hub_last_updated"] = r.get("last_updated") or r.get("tag_last_pushed")
                    break
    except Exception:
        pass

    if remote_found_version:
        result["remote_version"] = remote_found_version
        if parse_semver(remote_found_version) > parse_semver(current_version):
            result["update_available"] = True
            result["message"] = f"Nuova versione v{remote_found_version} disponibile su Docker Hub!"
        else:
            result["update_available"] = False
            result["message"] = "SmartTimetable è aggiornato all'ultima versione disponibile."

    _update_cache["timestamp"] = now
    _update_cache["data"] = result
    return result
