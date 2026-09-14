#!/usr/bin/env bash
# Run after setup_pi.sh, only for a BNO08x on I2C bus 1, address 0x4a.
set -euo pipefail
[[ $EUID -eq 0 ]] || { echo "Run as root" >&2; exit 1; }
repo_dir=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
apt-get update
apt-get install -y python3-venv python3-dev swig liblgpio-dev i2c-tools
usermod -aG i2c pavois
raspi-config nonint do_i2c 0
python3 -m venv /opt/pavois/imu-venv
/opt/pavois/imu-venv/bin/pip install adafruit-circuitpython-bno08x==1.3.3 adafruit-extended-bus==1.0.2
install -m 0644 "$repo_dir/scripts/bno08x_bridge.py" /opt/pavois/bno08x_bridge.py
install -m 0755 "$repo_dir/scripts/pavois_imu_calib.py" /opt/pavois/pavois_imu_calib.py
install -m 0755 "$repo_dir/scripts/pavois_imu_calib.py" /opt/pavois/bin/calib.py
install -m 0644 "$repo_dir/pavois++/deploy/pavois-imu.service" /etc/systemd/system/pavois-imu.service
cp -a /etc/pavois/pavois.conf "/etc/pavois/pavois.conf.before-bno08x-$(date +%s)"
sed -i '/^imu.enabled=/d; /^imu.kind=/d; /^imu.file=/d; /^imu.heading_sign=/d' \
  /etc/pavois/pavois.conf
cat >> /etc/pavois/pavois.conf <<'EOF'

imu.enabled=true
imu.kind=file
imu.file=/run/pavois-imu/orientation
# BNO08x quaternion yaw is mathematical (counter-clockwise); Pavois headings
# are compass bearings (clockwise).
imu.heading_sign=-1.0
EOF
systemctl daemon-reload
systemctl enable --now pavois-imu.service
systemctl restart pavois.service
