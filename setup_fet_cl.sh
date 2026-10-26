#!/bin/bash
# ==============================================================================
# Setup e Compilazione Automatica di fet-cl per macOS
# ==============================================================================

set -e

DIR="$( cd "$( dirname "${BASH_SOURCE[0]}" )" && pwd )"
cd "$DIR"

echo "=================================================================="
echo "  Verifica e Installazione di FET CLI (fet-cl) per macOS"
echo "=================================================================="

# 1. Controlla se fet-cl è già presente
if [ -f "$DIR/fet-cl" ] && [ -x "$DIR/fet-cl" ]; then
    echo "✅ fet-cl è già presente ed eseguibile in: $DIR/fet-cl"
    "$DIR/fet-cl" --version || true
    echo "Tutto pronto! Puoi avviare 'python3 fet_bridge.py'."
    exit 0
fi

if command -v fet-cl >/dev/null 2>&1; then
    BIN_PATH=$(which fet-cl)
    echo "✅ fet-cl è installato nel PATH di sistema: $BIN_PATH"
    fet-cl --version || true
    echo "Tutto pronto! Puoi avviare 'python3 fet_bridge.py'."
    exit 0
fi

echo "⚠️  fet-cl non trovato localmente."
echo ""

# 2. Controlla Homebrew
if ! command -v brew >/dev/null 2>&1; then
    echo "Per compilare nativamente fet-cl su Mac è consigliato Homebrew."
    echo ""
    echo "Passo 1: Installa Homebrew (se non lo hai già) incollando questo comando:"
    echo '  /bin/bash -c "$(curl -fsSL https://raw.githubusercontent.com/Homebrew/install/HEAD/install.sh)"'
    echo ""
    echo "Passo 2: Installa le dipendenze di build (CMake e Qt):"
    echo "  brew install cmake qt"
    echo ""
    echo "Passo 3: Riesegui questo script (./setup_fet_cl.sh) per compilare fet-cl in automatico."
    exit 1
fi

echo "Homebrew rilevato. Verifica dipendenze (cmake, qt)..."
if ! command -v cmake >/dev/null 2>&1; then
    echo "Installazione cmake..."
    brew install cmake
fi

QT_PREFIX=$(brew --prefix qt 2>/dev/null || brew --prefix qt@6 2>/dev/null || true)
if [ -z "$QT_PREFIX" ] || [ ! -d "$QT_PREFIX" ]; then
    echo "Installazione Qt..."
    brew install qt
    QT_PREFIX=$(brew --prefix qt)
fi

echo "Qt trovato in: $QT_PREFIX"

# 3. Download e Compilazione di FET-CL
BUILD_TMP="$DIR/.fet_build_tmp"
rm -rf "$BUILD_TMP"
mkdir -p "$BUILD_TMP"
cd "$BUILD_TMP"

# Rileva automaticamente l'ultima versione ufficiale di FET disponibile a monte
UPSTREAM_VER=$(curl -s https://lalescu.ro/liviu/fet/download/ | grep -oE 'fet-[0-9]+\.[0-9]+\.[0-9]+\.tar\.xz' | head -n 1 | sed 's/fet-//;s/\.tar\.xz//' || true)
FET_VER="${UPSTREAM_VER:-7.12.0}"
echo "Versione FET upstream rilevata: $FET_VER"
echo "Download sorgenti FET $FET_VER..."
curl -L -s -o "fet-$FET_VER.tar.xz" "https://lalescu.ro/liviu/fet/download/fet-$FET_VER.tar.xz"

tar -xf "fet-$FET_VER.tar.xz"
cd "fet-$FET_VER"

echo "Configurazione CMake (COMMAND_LINE_ONLY=ON)..."
cmake -B build -DCOMMAND_LINE_ONLY=ON -DCMAKE_PREFIX_PATH="$QT_PREFIX" -DCMAKE_BUILD_TYPE=Release

echo "Compilazione fet-cl in corso..."
cmake --build build --config Release -j$(sysctl -n hw.ncpu || echo 4)

BIN_FOUND=""
if [ -f "build/src/cl/fet-cl" ]; then
    BIN_FOUND="build/src/cl/fet-cl"
elif [ -f "build/fet-cl" ]; then
    BIN_FOUND="build/fet-cl"
fi

if [ -n "$BIN_FOUND" ]; then
    echo "🔍 Esecuzione Sanity Check di non-regressione sul binario compilato..."
    chmod +x "$BIN_FOUND"
    python3 "$DIR/scripts/check_and_update_fet.py" --sanity-check-only "$BIN_FOUND"
    
    cp "$BIN_FOUND" "$DIR/fet-cl"
    chmod +x "$DIR/fet-cl"
    echo ""
    echo "=================================================================="
    echo "✅ COMPILAZIONE E SANITY CHECK COMPLETATI CON SUCCESSO!"
    echo "   Eseguibile validato salvato in: $DIR/fet-cl"
    echo "=================================================================="
    "$DIR/fet-cl" --version || true
    rm -rf "$BUILD_TMP"
    echo ""
    echo "Ora puoi avviare il bridge con:"
    echo "   python3 fet_bridge.py"
    echo "e usare il comando '8. Compila con FET CLI' direttamente dal foglio Google!"
else
    echo "❌ Errore: file fet-cl non trovato nella cartella di build."
    exit 1
fi
