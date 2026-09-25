#!/usr/bin/env python3
"""Point the vps at this rig's real geometry.

The vps triangulates from each camera's stored GPS position. Its built-in
defaults describe the field deployment, not the 1 m rail used for a replay
bench, so the bearings can never agree and fusion rejects almost every frame.
Rewrite the three positions from the rail offsets, around the origin the vps
already holds for the first camera.
"""
import json
import math
import sys
import urllib.error
import urllib.request

BASE = "http://127.0.0.1:3002"


def request(method, path, token, payload=None):
    body = None if payload is None else json.dumps(payload).encode()
    req = urllib.request.Request(
        BASE + path,
        data=body,
        method=method,
        headers={"Authorization": "Bearer " + token,
                 "Content-Type": "application/json"},
    )
    with urllib.request.urlopen(req, timeout=10) as fh:
        raw = fh.read()
    return json.loads(raw) if raw else None


def main():
    token = sys.argv[1]
    cams = sys.argv[2].split()
    xs = [float(v) for v in sys.argv[3].split()]

    known = {c["id"]: c for c in request("GET", "/cameras", token)}
    origin = known.get(cams[0])
    if origin is None:
        raise SystemExit(f"the vps does not know a camera called {cams[0]}")
    lat0, lon0, alt0 = origin["lat"], origin["lon"], origin["alt"]
    m_per_deg_lon = 111320.0 * math.cos(math.radians(lat0))

    for cam, x in zip(cams, xs):
        lon = lon0 + x / m_per_deg_lon
        request("PUT", f"/cameras/{cam}/position", token,
                {"lat": lat0, "lon": lon, "alt": alt0})
        print(f"[bench]   {cam}: rail x={x:+.4f} m -> lat {lat0:.7f} lon {lon:.7f}")


if __name__ == "__main__":
    try:
        main()
    except urllib.error.HTTPError as exc:
        raise SystemExit(f"vps refused the position update: {exc.code} {exc.reason}")
