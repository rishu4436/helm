#!/usr/bin/env bash
# Creates the STT venv OUTSIDE the repo (default /workspace/helm-stt/venv) and pre-downloads the model (public, MIT).
set -euo pipefail
V="${HELM_STT_VENV:-/workspace/helm-stt/venv}"
python3 -m venv "$V"
"$V/bin/pip" install -q -r "$(dirname "$0")/requirements.txt"
"$V/bin/python" -c "from faster_whisper import WhisperModel; WhisperModel('${HELM_STT_MODEL:-base.en}', device='cpu', compute_type='float32')"
echo "ok: $V"
