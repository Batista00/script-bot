#!/usr/bin/env bash
set -Eeuo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_dir}/../.." && pwd -P)"
compose_file="${repository_root}/deploy/docker-compose.backend.yml"
env_file="${1:-${repository_root}/deploy/.env.production}"

for command in node docker curl awk; do
  command -v "${command}" >/dev/null 2>&1 || {
    echo "Deployment refused: required command '${command}' is unavailable" >&2
    exit 1
  }
done

test -f "${env_file}" || {
  echo "Deployment refused: env file not found: ${env_file}" >&2
  exit 1
}

node "${repository_root}/deploy/scripts/preflight.mjs" --env-file "${env_file}"

compose=(docker compose --env-file "${env_file}" -f "${compose_file}")
"${compose[@]}" config --quiet
"${compose[@]}" build backend
"${compose[@]}" up -d

backend_port="$(awk -F= '$1 == "BACKEND_HOST_PORT" {
  value = substr($0, index($0, "=") + 1)
  gsub(/^[[:space:]"\047]+|[[:space:]"\047]+$/, "", value)
  print value
  exit
}' "${env_file}")"
health_url="http://127.0.0.1:${backend_port}/health"

for ((attempt = 1; attempt <= 30; attempt += 1)); do
  if curl --fail --silent --show-error --max-time 5 "${health_url}" >/dev/null; then
    echo "Deployment healthcheck passed"
    exit 0
  fi
  if [[ "${attempt}" -eq 30 ]]; then
    echo "Deployment healthcheck failed; inspect container status and safe backend logs" >&2
    "${compose[@]}" ps
    exit 1
  fi
  sleep 2
done
