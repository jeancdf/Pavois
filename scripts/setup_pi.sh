#!/usr/bin/env bash
# One-time installation on the Pi: sudo bash scripts/setup_pi.sh <deploy-user>
set -euo pipefail

if [[ $# -ne 1 || $EUID -ne 0 ]]; then
  echo "Usage: sudo bash scripts/setup_pi.sh <deploy-user>" >&2
  exit 1
fi
deploy_user=$1
if [[ ! $deploy_user =~ ^[a-z_][a-z0-9_-]*$ || $deploy_user == root || $deploy_user == pavois ]]; then
  echo "Use an existing non-root deployment account, different from pavois." >&2
  exit 1
fi
id "$deploy_user" >/dev/null
script_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
repo_dir=$(cd -- "$script_dir/.." && pwd)

apt-get update
apt-get install -y --no-upgrade build-essential cmake git sudo v4l-utils rpicam-apps-lite ffmpeg i2c-tools libssl-dev

if ! getent group pavois >/dev/null; then
  groupadd --system pavois
fi
if ! id pavois >/dev/null 2>&1; then
  useradd --system --gid pavois --no-create-home --home-dir /opt/pavois --shell /usr/sbin/nologin pavois
fi
usermod -aG video pavois
if getent group i2c >/dev/null; then
  usermod -aG i2c pavois
fi
install -d -m 0755 /opt/pavois
install -d -o "$deploy_user" -g pavois -m 0755 /opt/pavois/bin
install -d -o root -g pavois -m 0750 /etc/pavois
# BNO055 offset profile (imu.calib_file). The detector runs as pavois.
install -d -o pavois -g pavois -m 0755 /var/lib/pavois

if [[ ! -e /etc/pavois/pavois.conf ]]; then
  install -o root -g pavois -m 0640 "$repo_dir/pavois++/deploy/pavois.conf.example" /etc/pavois/pavois.conf
  camera_id=$(hostname | tr -cd 'A-Za-z0-9_-')
  sed -i "s/^camera\.0\.id=CHANGE_ME$/camera.0.id=${camera_id:-pi-camera}/" /etc/pavois/pavois.conf
elif ! grep -q '^imu.enabled=' /etc/pavois/pavois.conf; then
  cat >> /etc/pavois/pavois.conf <<'EOF'

imu.enabled=true
imu.kind=auto
imu.i2c_dev=/dev/i2c-1
imu.calib_file=/var/lib/pavois/imu_calib.bin
imu.emit_interval_ms=200
imu.heading_offset_deg=0.0
imu.elevation_offset_deg=0.0
imu.roll_offset_deg=0.0
EOF
fi

if [[ -f /etc/pavois/pavois.conf ]] && ! grep -q '^preview.enabled=' /etc/pavois/pavois.conf; then
  cat >> /etc/pavois/pavois.conf <<'EOF'

preview.enabled=true
preview.fps=2
preview.width=320
preview.quality=55
preview.http_port=8081
preview.http_path=/api/preview
EOF
fi

if [[ -f /etc/pavois/pavois.conf ]] && ! grep -q '^imu.calib_file=' /etc/pavois/pavois.conf; then
  cat >> /etc/pavois/pavois.conf <<'EOF'

# 22-byte BNO055 offsets. Restored in CONFIG mode on every init.
imu.calib_file=/var/lib/pavois/imu_calib.bin
EOF
fi

if [[ -f /etc/pavois/pavois.conf ]] && ! grep -q '^imu.axis_map=' /etc/pavois/pavois.conf; then
  cat >> /etc/pavois/pavois.conf <<'EOF'

# Chip mounting orientation (flat vs. on edge etc). Defaults below are the
# BNO055 power-on values (P1, identity mapping) -- no change until you verify
# this Pi's physical mounting. See the comment block in pavois.conf.example.
imu.axis_map=0x24
imu.axis_sign=0x00
EOF
fi

install -o root -g root -m 0644 "$repo_dir/pavois++/deploy/pavois.service" /etc/systemd/system/pavois.service
install -o root -g root -m 0644 "$repo_dir/pavois++/deploy/60-pavois-i2c.rules" \
  /etc/udev/rules.d/60-pavois-i2c.rules
if command -v udevadm >/dev/null; then
  udevadm control --reload-rules || true
  udevadm trigger --subsystem-match=i2c-dev || true
fi
if command -v raspi-config >/dev/null; then
  raspi-config nonint do_i2c 0 || true
fi

# Only restarting this service requires elevated privileges during deployment.
systemctl_path=$(command -v systemctl)
sudoers_tmp=$(mktemp)
trap 'rm -f -- "$sudoers_tmp"' EXIT
printf '%s ALL=(root) NOPASSWD: %s restart pavois.service\n' "$deploy_user" "$systemctl_path" > "$sudoers_tmp"
visudo -cf "$sudoers_tmp"
install -o root -g root -m 0440 "$sudoers_tmp" /etc/sudoers.d/pavois-deploy

systemctl daemon-reload
# The old HTTP streamer owns the CSI camera. Keep it running until the detector
# starts, but do not let it compete for the camera after the next boot.
if systemctl cat pavois-camstream.service >/dev/null 2>&1; then
  systemctl disable pavois-camstream.service
fi
systemctl enable pavois.service
echo "Setup complete. Edit /etc/pavois/pavois.conf before deploying."
echo "CSI cameras: rpicam-hello --list-cameras"
echo "Deploy as $deploy_user: bash scripts/deploy_pi.sh"
