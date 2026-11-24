#!/usr/bin/env bash
# sim.sh <action>... : send inputs to the Even Hub simulator (up|down|click|double_click|shot:<name>|wait:<s>)
port=${SIM_PORT:-9898}; dir=${SIM_OUT:-evidence/g2-trade-flow}
for a in "$@"; do
  case $a in
    shot:*) bash "$(dirname "$0")/sim-shot.sh" "$dir/${a#shot:}" ;;
    wait:*) sleep "${a#wait:}" ;;
    *) curl -sf -X POST "localhost:$port/api/input" -H 'Content-Type: application/json' -d "{\"action\":\"$a\"}" >/dev/null; sleep 0.6 ;;
  esac
done
