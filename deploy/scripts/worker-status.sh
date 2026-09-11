#!/usr/bin/env bash
#
# Estado del worker de background. SOLO LECTURA: no construye, arranca, detiene,
# recrea ni modifica contenedores, y nunca imprime valores del env file.
#
# Uso:
#   bash deploy/scripts/worker-status.sh [ruta/al/env]
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_dir}/../.." && pwd -P)"
compose_file="${repository_root}/deploy/docker-compose.backend.yml"
env_file="${1:-${repository_root}/deploy/.env.production}"

for command in docker curl awk; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Worker status refused: required command '${command}' is unavailable" >&2
    exit 1
  }
done

test -f "${env_file}" || {
  echo "Worker status refused: env file not found: ${env_file}" >&2
  exit 1
}

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")

echo "== backend-worker: estado =="
"${compose[@]}" ps backend-worker

echo
echo "== backend-worker: procesos del contenedor =="
"${compose[@]}" top backend-worker 2>/dev/null || echo "(sin contenedor en ejecución)"

echo
echo "== backend-worker: últimas líneas de log =="
"${compose[@]}" logs --tail=40 --no-log-prefix backend-worker 2>&1 || true

backend_port="$(awk -F= '$1 == "BACKEND_HOST_PORT" {
  value = substr($0, index($0, "=") + 1)
  gsub(/^[[:space:]"\047]+|[[:space:]"\047]+$/, "", value)
  print value
  exit
}' "${env_file}")"

echo
echo "== API readiness (el liveness del contenedor backend sigue siendo /health) =="
if [[ -n "${backend_port}" ]]; then
  if curl --fail --silent --show-error --max-time 5 \
      "http://127.0.0.1:${backend_port}/health/ready" >/dev/null; then
    echo "GET /health/ready -> 200 (API y PostgreSQL disponibles)"
  else
    echo "readiness check failed: el API o PostgreSQL no responden" >&2
  fi
else
  echo "BACKEND_HOST_PORT no está definido en ${env_file}; se omite la readiness." >&2
fi

echo
echo "La superficie de jobs por negocio requiere sesión autenticada:"
echo "  GET  /businesses/:businessId/jobs                (owner/admin/operator)"
echo "  POST /businesses/:businessId/jobs/:jobId/retry   (owner/admin)"
