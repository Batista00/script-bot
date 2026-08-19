#!/usr/bin/env bash
set -Eeuo pipefail
umask 077

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
repository_root="$(cd -- "${script_dir}/../.." && pwd -P)"
compose_file="${repository_root}/deploy/docker-compose.backend.yml"
env_file="${1:-${repository_root}/deploy/.env.production}"

: "${BACKUP_DESTINATION:?Set BACKUP_DESTINATION to a protected directory outside the repository}"
test -f "${env_file}" || {
  echo "Backup refused: env file not found: ${env_file}" >&2
  exit 1
}

mkdir -p -- "${BACKUP_DESTINATION}"
backup_directory="$(cd -- "${BACKUP_DESTINATION}" && pwd -P)"
case "${backup_directory}/" in
  "${repository_root}/"*)
    echo "Backup refused: BACKUP_DESTINATION must be outside the repository" >&2
    exit 1
    ;;
esac
timestamp="$(date -u +%Y%m%dT%H%M%SZ)"
final_file="${backup_directory}/bot_whatsapp_${timestamp}.dump"
temporary_file="${final_file}.partial"
trap 'rm -f -- "${temporary_file}"' EXIT

docker compose \
  --env-file "${env_file}" \
  -f "${compose_file}" \
  exec -T backend-postgres \
  sh -c 'exec pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' \
  > "${temporary_file}"

test -s "${temporary_file}" || {
  echo "Backup failed: pg_dump produced an empty file" >&2
  exit 1
}
mv -- "${temporary_file}" "${final_file}"
trap - EXIT
echo "Backup created: ${final_file}"
