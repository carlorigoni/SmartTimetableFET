#!/usr/bin/env python3
"""
Eurario - Automated FET Engine Upstream Monitor & Sanity Checker
Verifica la disponibilità di nuove versioni ufficiali del motore FET di Liviu Lalescu,
esegue la compilazione isolata e conduce un Sanity Check a due livelli (Execution & Timetable Solving).
Se il Sanity Check ha successo, aggiorna Dockerfile, server.py e i metadati di versione del progetto.
"""

import os
import sys
import re
import ssl
import shutil
import tarfile
import argparse
import subprocess
import urllib.request
from pathlib import Path

# Percorsi base del repository
SCRIPT_DIR = Path(__file__).resolve().parent
ROOT_DIR = SCRIPT_DIR.parent
SERVER_PY = ROOT_DIR / "webapp" / "server.py"
DOCKERFILE = ROOT_DIR / "Dockerfile"
SEED_TIMETABLE = ROOT_DIR / "webapp" / "seed_data" / "solved_timetable.fet"

FET_DOWNLOAD_URLS = [
    "https://lalescu.ro/liviu/fet/download/",
    "https://www.timetabling.de/download/"
]


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


def get_current_fet_version():
    """Legge la versione di FET attualmente configurata in webapp/server.py."""
    if not SERVER_PY.is_file():
        return "7.12.0"
    content = SERVER_PY.read_text(encoding="utf-8")
    m = re.search(r'FET_VERSION\s*=\s*[\"\']([^\"\']+)[\"\']', content)
    if m:
        return m.group(1).strip()
    return "7.12.0"


def get_upstream_fet_versions():
    """Interroga i repository upstream ufficiali per trovare tutte le versioni disponibili."""
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    versions = []
    for base_url in FET_DOWNLOAD_URLS:
        try:
            req = urllib.request.Request(base_url, headers={"User-Agent": "Eurario-FET-Updater/1.0"})
            with urllib.request.urlopen(req, context=ctx, timeout=8) as resp:
                html = resp.read().decode("utf-8", errors="ignore")
                matches = re.findall(r'fet-(\d+\.\d+\.\d+)\.tar\.(xz|bz2)', html)
                for ver, _ in matches:
                    if ver not in versions:
                        versions.append(ver)
            if versions:
                break
        except Exception as e:
            print(f"⚠️ Avviso: Impossibile interrogare {base_url}: {e}")

    # Ordina semanticamente in ordine decrescente
    versions.sort(key=parse_semver, reverse=True)
    return versions


def run_sanity_check(binary_path, sample_fet_path=None):
    """
    Esegue il Sanity Check sul binario fet-cl:
    1. Verifica chiamata --version (esecuzione base e link librerie Qt6)
    2. Risoluzione di un orario di prova valido (.fet) con output dir temporanea
    """
    binary = Path(binary_path).resolve()
    if not binary.is_file():
        return False, f"Binario non trovato in {binary}"
    if not os.access(binary, os.X_OK):
        try:
            os.chmod(binary, 0o755)
        except Exception as e:
            return False, f"Impossibile rendere eseguibile il file: {e}"

    print(f"🔍 [Sanity Check 1/2] Verifica comando --version su {binary.name}...")
    try:
        res = subprocess.run([str(binary), "--version"], capture_output=True, text=True, timeout=10)
        out = (res.stdout + " " + res.stderr).strip()
        print(f"   Output versione: {out.splitlines()[0] if out else 'Nessun output'}")
        if res.returncode != 0:
            return False, f"--version ha restituito codice di errore {res.returncode}: {out}"
    except Exception as e:
        return False, f"Errore durante l'esecuzione di --version: {e}"

    # Livello 2: Timetable solving test
    if not sample_fet_path or not Path(sample_fet_path).is_file():
        sample_fet_path = SEED_TIMETABLE

    if not sample_fet_path.is_file():
        return True, "Sanity check livello 1 superato (--version). Orario di test non presente, skip livello 2."

    print(f"🔍 [Sanity Check 2/2] Test risoluzione euristica reale su {sample_fet_path.name}...")
    import tempfile
    with tempfile.TemporaryDirectory(prefix="fet_sanity_") as tmp_out:
        cmd = [
            str(binary),
            f"--inputfile={str(sample_fet_path)}",
            f"--outputdir={tmp_out}",
            "--verbose=false"
        ]
        try:
            res = subprocess.run(cmd, capture_output=True, text=True, timeout=25)
            output_text = res.stdout + " " + res.stderr
            if res.returncode != 0:
                return False, f"Risoluzione orario fallita (exit code {res.returncode}): {output_text[:300]}"
            if "Generation successful" not in output_text and not os.listdir(tmp_out):
                return False, f"Il solutore non ha generato output valido: {output_text[:300]}"
            print("   ✅ Risoluzione euristica completata con successo (Exit code 0).")
        except Exception as e:
            return False, f"Eccezione durante il test di generazione: {e}"

    return True, "Sanity Check completo (Esecuzione + Risoluzione) superato al 100%!"


def compile_fet_cl(version, work_dir):
    """Scarica e compila il binario fet-cl dai sorgenti ufficiali."""
    work_path = Path(work_dir).resolve()
    work_path.mkdir(parents=True, exist_ok=True)
    tar_name = f"fet-{version}.tar.xz"
    tar_url = f"https://lalescu.ro/liviu/fet/download/{tar_name}"
    tar_dest = work_path / tar_name

    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    print(f"📥 Download sorgenti da: {tar_url} ...")
    req = urllib.request.Request(tar_url, headers={"User-Agent": "Eurario-FET-Updater/1.0"})
    with urllib.request.urlopen(req, context=ctx, timeout=60) as resp, open(tar_dest, "wb") as f:
        shutil.copyfileobj(resp, f)

    print("📦 Estrazione archivio...")
    with tarfile.open(tar_dest, "r:xz") as tar:
        tar.extractall(path=work_path)

    src_dir = work_path / f"fet-{version}"
    if not src_dir.is_dir():
        # Cerca directory estratta
        candidates = [d for d in work_path.iterdir() if d.is_dir() and "fet" in d.name.lower()]
        if candidates:
            src_dir = candidates[0]
        else:
            raise FileNotFoundError(f"Directory sorgenti fet-{version} non trovata dopo estrazione.")

    build_dir = src_dir / "build"
    build_dir.mkdir(exist_ok=True)

    print("⚙️ Configurazione CMake (COMMAND_LINE_ONLY=ON)...")
    cmake_cmd = [
        "cmake",
        "-B", str(build_dir),
        "-S", str(src_dir),
        "-DCOMMAND_LINE_ONLY=ON",
        "-DCMAKE_BUILD_TYPE=Release"
    ]
    # Se presente variabile d'ambiente o macOS homebrew Qt prefix
    qt_prefix = os.environ.get("CMAKE_PREFIX_PATH")
    if qt_prefix:
        cmake_cmd.append(f"-DCMAKE_PREFIX_PATH={qt_prefix}")

    subprocess.run(cmake_cmd, check=True)

    print("🔨 Compilazione binario fet-cl in corso...")
    nproc = str(os.cpu_count() or 4)
    subprocess.run(["cmake", "--build", str(build_dir), "--config", "Release", "-j", nproc], check=True)

    # Trova il file compilato fet-cl
    possible_bins = list(build_dir.glob("**/fet-cl"))
    if not possible_bins:
        raise FileNotFoundError(f"Compilazione terminata ma binario 'fet-cl' non trovato in {build_dir}")

    compiled_binary = possible_bins[0]
    print(f"✅ Compilazione riuscita: {compiled_binary}")
    return compiled_binary


def update_project_files_to_new_fet(new_fet_version):
    """Aggiorna Dockerfile, server.py, app.js, index.html e README con la nuova versione di FET e incrementa patch version."""
    print(f"📝 Aggiornamento file di progetto a FET {new_fet_version}...")

    # 1. Dockerfile
    if DOCKERFILE.is_file():
        doc_content = DOCKERFILE.read_text(encoding="utf-8")
        doc_content_new = re.sub(r'ARG FET_VER=[0-9\.]+', f'ARG FET_VER={new_fet_version}', doc_content)
        DOCKERFILE.write_text(doc_content_new, encoding="utf-8")
        print("   ✅ Dockerfile aggiornato.")

    # 2. webapp/server.py: aggiorna FET_VERSION e incrementa patch APP_VERSION
    app_ver_new = None
    if SERVER_PY.is_file():
        srv_content = SERVER_PY.read_text(encoding="utf-8")
        # Bump APP_VERSION
        m_app = re.search(r'APP_VERSION\s*=\s*[\"\'](\d+\.\d+)\.(\d+)[\"\']', srv_content)
        if m_app:
            major_minor = m_app.group(1)
            patch = int(m_app.group(2)) + 1
            app_ver_new = f"{major_minor}.{patch}"
            srv_content = re.sub(r'APP_VERSION\s*=\s*[\"\'][0-9\.]+[\"\']', f'APP_VERSION = "{app_ver_new}"', srv_content)
            print(f"   ✅ Versione applicazione avanzata a v{app_ver_new}")

        srv_content = re.sub(r'FET_VERSION\s*=\s*[\"\'][0-9\.]+[\"\']', f'FET_VERSION = "{new_fet_version}"', srv_content)
        SERVER_PY.write_text(srv_content, encoding="utf-8")
        print("   ✅ webapp/server.py aggiornato.")

    # 3. webapp/advisor.py
    advisor_py = ROOT_DIR / "webapp" / "advisor.py"
    if advisor_py.is_file() and app_ver_new:
        adv_content = advisor_py.read_text(encoding="utf-8")
        adv_content = re.sub(r'\(v\d+\.\d+\.\d+\)', f'(v{app_ver_new})', adv_content)
        advisor_py.write_text(adv_content, encoding="utf-8")
        print("   ✅ webapp/advisor.py aggiornato.")

    # 4. webapp/static/app.js
    app_js = ROOT_DIR / "webapp" / "static" / "app.js"
    if app_js.is_file() and app_ver_new:
        js_content = app_js.read_text(encoding="utf-8")
        js_content = re.sub(r"const APP_VERSION = '[\d\.]+';", f"const APP_VERSION = '{app_ver_new}';", js_content)
        app_js.write_text(js_content, encoding="utf-8")
        print("   ✅ webapp/static/app.js aggiornato.")

    # 5. webapp/static/index.html
    index_html = ROOT_DIR / "webapp" / "static" / "index.html"
    if index_html.is_file():
        idx_content = index_html.read_text(encoding="utf-8")
        if app_ver_new:
            idx_content = re.sub(r'\?v=\d+\.\d+\.\d+', f'?v={app_ver_new}', idx_content)
            idx_content = re.sub(r'v\d+\.\d+\.\d+', f'v{app_ver_new}', idx_content)
        idx_content = re.sub(r'FET \d+\.\d+(\.\d+)?', f'FET {new_fet_version}', idx_content)
        index_html.write_text(idx_content, encoding="utf-8")
        print("   ✅ webapp/static/index.html aggiornato.")

    # 6. README.md
    readme_md = ROOT_DIR / "README.md"
    if readme_md.is_file() and app_ver_new:
        rd_content = readme_md.read_text(encoding="utf-8")
        rd_content = re.sub(r'version-\d+\.\d+\.\d+-blue', f'version-{app_ver_new}-blue', rd_content)
        readme_md.write_text(rd_content, encoding="utf-8")
        print("   ✅ README.md aggiornato.")


def main():
    parser = argparse.ArgumentParser(description="Monitor upstream FET e Sanity Check")
    parser.add_argument("--check-only", action="store_true", help="Controlla solo upstream senza compilare")
    parser.add_argument("--force-version", type=str, help="Forza una specifica versione FET per test")
    parser.add_argument("--sanity-check-only", type=str, help="Esegue solo il sanity check su un binario esistente")
    parser.add_argument("--ci", action="store_true", help="Modalità CI/CD GitHub Actions: compila, testa e aggiorna se disponibile")
    args = parser.parse_args()

    # Modalità Sanity Check Standalone
    if args.sanity_check_only:
        ok, msg = run_sanity_check(args.sanity_check_only)
        print(f"Esito Sanity Check: {'SUCCESS' if ok else 'FAILURE'} - {msg}")
        sys.exit(0 if ok else 1)

    current_ver = get_current_fet_version()
    print(f"📌 Versione FET attuale nel progetto: v{current_ver}")

    upstream_versions = get_upstream_fet_versions()
    if not upstream_versions:
        print("❌ Impossibile rilevare le versioni upstream.")
        sys.exit(1)

    latest_upstream = args.force_version or upstream_versions[0]
    print(f"🌐 Ultima versione upstream FET disponibile: v{latest_upstream}")

    update_available = parse_semver(latest_upstream) > parse_semver(current_ver)

    if args.check_only:
        print(f"Stato aggiornamento: {'NUOVA VERSIONE DISPONIBILE' if update_available else 'AGGIORNATO'}")
        sys.exit(0)

    if not update_available and not args.force_version:
        print(f"✅ Il motore FET è già all'ultima versione disponibile ({current_ver}). Nessuna azione richiesta.")
        if "GITHUB_OUTPUT" in os.environ:
            with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                f.write("update_available=false\n")
        sys.exit(0)

    print(f"🚀 Avvio procedura di aggiornamento automatico verso FET {latest_upstream}...")
    import tempfile
    with tempfile.TemporaryDirectory(prefix="fet_ci_build_") as tmp_build:
        try:
            compiled_bin = compile_fet_cl(latest_upstream, tmp_build)
            ok, msg = run_sanity_check(compiled_bin)
            if not ok:
                print(f"❌ SANITY CHECK FALLITO per FET {latest_upstream}: {msg}")
                print("🛑 Aggiornamento ANNULLATO per preservare l'integrità del sistema in produzione.")
                sys.exit(1)

            print(f"🎉 SANITY CHECK SUPERATO CON SUCCESSO: {msg}")
            update_project_files_to_new_fet(latest_upstream)

            # Se siamo su Mac o locale e esiste ./fet-cl, aggiorna anche il binario locale
            local_fet = ROOT_DIR / "fet-cl"
            if local_fet.is_file() and not args.ci:
                shutil.copy2(compiled_bin, local_fet)
                os.chmod(local_fet, 0o755)
                print(f"   ✅ Binario locale aggiornato in {local_fet}")

            if "GITHUB_OUTPUT" in os.environ:
                with open(os.environ["GITHUB_OUTPUT"], "a") as f:
                    f.write("update_available=true\n")
                    f.write(f"fet_version={latest_upstream}\n")

            print(f"🏁 Procedura completata! Motore FET aggiornato a v{latest_upstream}.")
            sys.exit(0)

        except Exception as e:
            print(f"❌ Errore critico durante la procedura: {e}")
            sys.exit(1)


if __name__ == "__main__":
    main()
