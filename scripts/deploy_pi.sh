#!/usr/bin/env bash
# Run as the deployment account on the target Pi, after setup_pi.sh.
set -euo pipefail

script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/.." && pwd)
install_dir=/opt/pavois/bin
build_jobs=${PI_BUILD_JOBS:-2}

if [[ ! $build_jobs =~ ^[1-9][0-9]*$ ]]; then
  echo "PI_BUILD_JOBS must be a positive integer." >&2
  exit 1
fi
if [[ ! -d $install_dir || ! -w $install_dir ]]; then
  echo "Run sudo bash scripts/setup_pi.sh <deploy-user> on this Pi first." >&2
  exit 1
fi

# An independent build directory avoids stale CMake state between releases.
build_dir=$(mktemp -d /tmp/pavois-build.XXXXXX)
staged_binary=
previous_binary=
cleanup() {
  rm -rf -- "$build_dir"
  if [[ -n $staged_binary ]]; then
    rm -f -- "$staged_binary"
  fi
  if [[ -n $previous_binary ]]; then
    rm -f -- "$previous_binary"
  fi
}
trap cleanup EXIT

rollback_binary() {
  if [[ -n $previous_binary && -f $previous_binary ]]; then
    echo "New detector failed its service check; restoring previous binary." >&2
    mv -f -- "$previous_binary" "$install_dir/pavois_detect"
    previous_binary=
    sudo -n systemctl restart pavois.service || true
  fi
}
trap rollback_binary ERR

cmake -S "$repo_dir/pavois++" -B "$build_dir" -DCMAKE_BUILD_TYPE=Release
cmake --build "$build_dir" --target pavois_detect --parallel "$build_jobs"

# Replace the executable atomically after compilation; preserve per-Pi config.
staged_binary=$(mktemp "$install_dir/.pavois_detect.XXXXXX")
install -m 0755 "$build_dir/pavois_detect" "$staged_binary"
if [[ -f $install_dir/pavois_detect ]]; then
  previous_binary=$(mktemp "$install_dir/.pavois_detect.previous.XXXXXX")
  cp -p -- "$install_dir/pavois_detect" "$previous_binary"
fi
mv -f -- "$staged_binary" "$install_dir/pavois_detect"
staged_binary=

# Keep the field calibration helper in sync with the deployed revision. The
# deployment account owns /opt/pavois/bin, so this needs no additional sudo.
install -m 0755 "$repo_dir/scripts/pavois_imu_calib.py" "$install_dir/calib.py"
install -m 0755 "$repo_dir/scripts/pavois_camera_calib.py" "$install_dir/camera-calib.py"

# Units require root and are installed by setup_pi.sh. Refresh them when this
# runner has broader passwordless sudo; older field runners safely continue
# with binary-level CPU affinity until setup_pi.sh is run once again.
if sudo -n install -o root -g root -m 0755 \
    "$repo_dir/pavois++/deploy/pavois-performance.sh" \
    /usr/local/sbin/pavois-performance 2>/dev/null && \
   sudo -n install -o root -g root -m 0644 \
    "$repo_dir/pavois++/deploy/pavois-performance.service" \
    /etc/systemd/system/pavois-performance.service 2>/dev/null && \
   sudo -n install -o root -g root -m 0644 \
    "$repo_dir/pavois++/deploy/pavois.service" \
    /etc/systemd/system/pavois.service 2>/dev/null; then
  sudo -n systemctl daemon-reload
  sudo -n systemctl enable --now pavois-performance.service
else
  echo "Performance unit unchanged (run setup_pi.sh once to install it)."
fi

if ! sudo -n systemctl restart pavois.service; then
  rollback_binary
  exit 1
fi

# A live systemd unit does not prove that its camera is delivering frames.
sleep 3
if ! systemctl is-active --quiet pavois.service; then
  rollback_binary
  exit 1
fi
if [[ -n $previous_binary ]]; then
  rm -f -- "$previous_binary"
  previous_binary=
fi
echo "Pavois binary deployed; pavois.service is active."
journalctl -u pavois.service -n 20 --no-pager || true
echo "Check camera output: sudo journalctl -u pavois.service -n 50 --no-pager"
