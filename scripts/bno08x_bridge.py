#!/usr/bin/env python3
"""Read a BNO08x on I2C and atomically publish Euler angles for the C++ reader."""
import math
import os
from pathlib import Path
import time
from adafruit_extended_bus import ExtendedI2C
from adafruit_bno08x import BNO_REPORT_ROTATION_VECTOR
from adafruit_bno08x.i2c import BNO08X_I2C

output = Path("/run/pavois-imu/orientation")
try:
    sensor = BNO08X_I2C(ExtendedI2C(1), address=0x4a)
    sensor.enable_feature(BNO_REPORT_ROTATION_VECTOR, report_interval=100000)
    print("BNO08x connected on I2C bus 1, address 0x4a", flush=True)
    last_valid = time.monotonic()
    while True:
        time.sleep(0.1)
        try:
            x, y, z, w = sensor.quaternion
        except (OSError, KeyError) as error:
            # Discard a corrupt I2C report without resetting the sensor fusion.
            output.unlink(missing_ok=True)
            if time.monotonic() - last_valid > 5:
                raise RuntimeError("IMU transport failed for five seconds") from error
            continue
        norm = math.sqrt(x*x + y*y + z*z + w*w)
        if not math.isfinite(norm) or norm < 0.5:
            if time.monotonic() - last_valid > 5:
                raise ValueError("No valid sensor quaternion for five seconds")
            continue
        last_valid = time.monotonic()
        x, y, z, w = (v/norm for v in (x, y, z, w))
        yaw = math.degrees(math.atan2(2*(w*z+x*y), 1-2*(y*y+z*z))) % 360
        pitch = math.degrees(math.asin(max(-1, min(1, 2*(w*y-z*x)))))
        roll = math.degrees(math.atan2(2*(w*x+y*z), 1-2*(x*x+y*y)))
        temporary = output.with_suffix(".tmp")
        temporary.write_text(f"{yaw:.5f} {pitch:.5f} {roll:.5f}\n")
        os.replace(temporary, output)
finally:
    output.unlink(missing_ok=True)
