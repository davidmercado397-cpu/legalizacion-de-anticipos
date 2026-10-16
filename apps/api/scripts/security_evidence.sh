#!/usr/bin/env bash
# Regenera la evidencia del expediente de seguridad (docs/security/evidence). Lo corre el CI en cada
# cambio y se puede correr localmente. Falla si aparece un hallazgo que bloquea.
#   ./scripts/security_evidence.sh [carpeta]
set -euo pipefail
OUT=${1:-docs/security/evidence}
PY=${PYTHON:-python}
mkdir -p "$OUT"
date -u +%FT%TZ > "$OUT/generated_at.txt"
git rev-parse HEAD > "$OUT/commit.txt" 2>/dev/null || true

echo "== Vulnerabilidades en dependencias (pip-audit)"
$PY -m pip_audit -r requirements.txt --progress-spinner off -f json -o "$OUT/pip-audit.json"

echo "== Análisis estático de seguridad (bandit)"
$PY -m bandit -c pyproject.toml -r app -q -f json -o "$OUT/bandit.json"

echo "== Arquitectura hexagonal (import-linter)"
lint-imports > "$OUT/import-linter.txt"

echo "== Código sin uso y dependencias (vulture, deptry)"
$PY -m vulture > "$OUT/vulture.txt"
$PY -m deptry . > "$OUT/deptry.txt" 2>&1

echo "== Tipos (mypy)"
$PY -m mypy > "$OUT/mypy.txt"

echo "== Tests (incluye tests/security) con cobertura"
$PY -m pytest -q --cov --cov-report=json:"$OUT/coverage.json" --junitxml="$OUT/tests.xml" > "$OUT/tests.txt"
tail -3 "$OUT/tests.txt"

echo "== SBOM de las dependencias de producción (CycloneDX)"
VENV=$(mktemp -d)
$PY -m venv "$VENV"
"$VENV/bin/pip" install -q -r requirements.txt
$PY -m cyclonedx_py environment "$VENV/bin/python" --of JSON -o "$OUT/sbom.cdx.json"
rm -rf "$VENV"
echo "Evidencia en $OUT"
