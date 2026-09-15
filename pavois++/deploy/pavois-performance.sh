#!/usr/bin/env bash
# Root-only, idempotent Pi performance setup executed by systemd before Pavois.
set -euo pipefail

changed=0
for policy in /sys/devices/system/cpu/cpufreq/policy*; do
  [[ -d $policy ]] || continue
  governor_file="$policy/scaling_governor"
  [[ -w $governor_file ]] || continue
  if grep -qw performance "$policy/scaling_available_governors" 2>/dev/null; then
    printf '%s\n' performance > "$governor_file"
    changed=$((changed + 1))
  fi
done

temperature=unknown
if [[ -r /sys/class/thermal/thermal_zone0/temp ]]; then
  read -r temperature < /sys/class/thermal/thermal_zone0/temp || true
fi
throttled=unavailable
if command -v vcgencmd >/dev/null 2>&1; then
  throttled=$(vcgencmd get_throttled 2>/dev/null || true)
fi
echo "Pavois performance: policies=$changed temp_mC=$temperature $throttled"
