#!/usr/bin/env bash
# Bring the HELM dev stack up after a box restart (idempotent). Postgres :5444, STT :8178, API :4000, companion :3000.
set -uo pipefail
cd "$(dirname "$0")/.."
PGD=/workspace/helm-pgdata
PGBIN=/usr/lib/postgresql/17/bin
[ -x $PGBIN/pg_ctl ] || { sudo apt-get update -q >/dev/null && sudo DEBIAN_FRONTEND=noninteractive apt-get install -y -q postgresql-17 >/dev/null; sudo pg_ctlcluster 17 main stop 2>/dev/null; }
# Snapshots drop empty dirs; Postgres needs them.
for d in pg_notify pg_replslot pg_tblspc pg_twophase pg_snapshots pg_commit_ts pg_dynshmem pg_serial pg_stat_tmp pg_stat pg_logical/snapshots pg_logical/mappings pg_wal/archive_status pg_wal/summaries; do mkdir -p $PGD/$d; done
$PGBIN/pg_isready -h 127.0.0.1 -p 5444 -q || $PGBIN/pg_ctl -D $PGD -l /workspace/helm-pgdata.log -o "-p 5444 -k /tmp" start
[ -x /workspace/helm-stt/venv/bin/python ] || bash services/stt/setup.sh
curl -sf localhost:8178/health >/dev/null || (nohup /workspace/helm-stt/venv/bin/python services/stt/server.py > /tmp/helm-stt.log 2>&1 &)
curl -sf localhost:4000/health >/dev/null || (set -a; . ./.env; set +a; nohup npx tsx apps/api/src/server.ts > /tmp/helm-api.log 2>&1 &)
curl -sf -o /dev/null localhost:3000/ || (cd apps/companion && nohup npx next dev -p 3000 > /tmp/helm-companion.log 2>&1 &)
sleep 8
for u in localhost:8178/health localhost:4000/health localhost:3000/; do printf "%-24s %s\n" "$u" "$(curl -s -o /dev/null -w '%{http_code}' $u)"; done
