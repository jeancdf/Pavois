#!/usr/bin/env bash
# Replay a recorded three-camera session through the whole Pavois stack.
#
# Stands up, on this machine, what the bench does on the Pi rig:
#
#   3 x pavois_detect   one per camera, each replaying that camera's recorded
#                       frames on their ORIGINAL capture clock, exactly as a Pi
#                       would -- one camera per process, so each emits raw
#                       observations and the VPS does the cross-camera fusion
#   vps                 NestJS: UDP 41234 in, WebSocket 3002 out, preview JPEGs
#   frontend-angular    ng serve on 4200, showing the live map, the tracks and
#                       the camera preview video
#
# Nothing here touches the Pis and nothing is deployed. It is a separate
# harness: it reads the repo, builds into its own work directory, and every
# process it starts is killed when it exits.
#
# Usage:
#   scripts/pavois_replay_bench.sh --recording /path/to/rec-YYYYmmdd-HHMMSSZ-auto
#
# The recording directory is what pi/camstream + the session capture produce:
#   <cam>.mp4 or <cam>.mjpeg   the video
#   <cam>.meta.txt             one FrameWallClock=<unix_ns> per frame
#   <cam>.imu.log              "epoch yaw pitch roll" at 20 Hz (optional)
#
# First run extracts the replay frames (a few minutes, several GB) into the
# work directory and reuses them afterwards.

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
CAMERAS=(jean tanel walid)

RECORDING=""
WORK_DIR="${PAVOIS_BENCH_WORK:-$HOME/.cache/pavois/replay-bench}"
FROM_S=120          # start this many seconds into the common window
DURATION_S=0        # 0 = to the end of the overlap
WIDTH=640
HEIGHT=360
FOV_DEG=41.0        # OV5647 in its 1080p crop mode, scaled to 16:9
SKIP_FRONTEND=0
# Everything is local, so the preview follows the camera. The detector skips a
# frame when it comes sooner than 1/fps after the last one sent, and 30 fps
# frames jitter around 33.3 ms, so a cap of exactly 30 drops every other one.
PREVIEW_FPS=60
declare -A POSE_OVERRIDE=()
KEEP_FRAMES=0

# Rail geometry: 1 m rig, adjacent baseline 3/7 m. These positions go with the
# pose offsets fitted further down for the recording. The real rail is the other
# way round, tanel - jean - walid seen from behind (vps/src/bench/rail-bench.ts).
declare -A RAIL_X=( [jean]=0.0 [tanel]=0.4286 [walid]=-0.4286 )

die() { printf '\n[bench] ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[bench] %s\n' "$*"; }

usage() {
  sed -n '2,30p' "${BASH_SOURCE[0]}" | sed 's/^# \{0,1\}//'
  exit 0
}

while [ $# -gt 0 ]; do
  case "$1" in
    --recording)   RECORDING="${2:?}"; shift 2 ;;
    --work-dir)    WORK_DIR="${2:?}"; shift 2 ;;
    --from)        FROM_S="${2:?}"; shift 2 ;;
    --duration)    DURATION_S="${2:?}"; shift 2 ;;
    --width)       WIDTH="${2:?}"; shift 2 ;;
    --height)      HEIGHT="${2:?}"; shift 2 ;;
    --fov)         FOV_DEG="${2:?}"; shift 2 ;;
    --skip-frontend) SKIP_FRONTEND=1; shift ;;
    --preview-fps) PREVIEW_FPS="${2:?}"; shift 2 ;;
    # --pose jean=heading,elevation,roll : use a fitted optical-axis pose for
    # that camera instead of its IMU median plus the built-in offsets.
    --pose)        POSE_OVERRIDE["${2%%=*}"]="${2#*=}"; shift 2 ;;
    --keep-frames) KEEP_FRAMES=1; shift ;;
    -h|--help)     usage ;;
    *)             die "unknown argument: $1 (try --help)" ;;
  esac
done

[ -n "$RECORDING" ] || die "--recording is required (try --help)"
[ -d "$RECORDING" ] || die "recording directory not found: $RECORDING"
RECORDING="$(cd "$RECORDING" && pwd)"

# ---------------------------------------------------------------- preflight --
log "checking prerequisites"
for tool in cmake ffmpeg node npm python3; do
  command -v "$tool" >/dev/null || die "missing required tool: $tool"
done

for cam in "${CAMERAS[@]}"; do
  [ -f "$RECORDING/$cam.meta.txt" ] || die "missing $cam.meta.txt in $RECORDING"
  [ -f "$RECORDING/$cam.mp4" ] || [ -f "$RECORDING/$cam.mjpeg" ] \
    || die "missing $cam.mp4 or $cam.mjpeg in $RECORDING"
done

mkdir -p "$WORK_DIR"
FRAMES_DIR="$WORK_DIR/frames"
RUN_DIR="$WORK_DIR/run"
rm -rf "$RUN_DIR"; mkdir -p "$RUN_DIR" "$FRAMES_DIR"
log "work directory: $WORK_DIR"

PIDS=()
# Each service is started inside a subshell, so $! is the subshell rather than
# the node/detector process underneath it. Signalling only that PID leaves the
# real server running and the port bound, so signal the whole process GROUP.
# `set -m` puts every background job in its own group, and negating the PID
# addresses that group.
set -m
cleanup() {
  local rc=$?
  trap - EXIT INT TERM
  printf '\n[bench] shutting down\n'
  for sig in TERM KILL; do
    for pid in "${PIDS[@]:-}"; do
      [ -n "$pid" ] || continue
      kill -"$sig" -- "-$pid" 2>/dev/null || kill -"$sig" "$pid" 2>/dev/null || true
    done
    [ "$sig" = TERM ] && sleep 3
  done
  exit $rc
}
trap cleanup EXIT INT TERM

# ------------------------------------------------------- build the detector --
log "building pavois_detect"
cmake -S "$REPO_ROOT/pavois++" -B "$WORK_DIR/build" -DCMAKE_BUILD_TYPE=Release >/dev/null
cmake --build "$WORK_DIR/build" --parallel "$(nproc)" --target pavois_detect >/dev/null
DETECT="$WORK_DIR/build/pavois_detect"
[ -x "$DETECT" ] || die "pavois_detect did not build"

# ------------------------------------------------- work out the time window --
# Every camera has its own first/last frame time. The usable window is the
# intersection, so all three really are showing the same moment.
log "resolving the common time window"
WINDOW_JSON="$RUN_DIR/window.json"
python3 - "$RECORDING" "$FROM_S" "$DURATION_S" "$WINDOW_JSON" "${CAMERAS[@]}" <<'PY'
import json, pathlib, sys
rec, from_s, dur_s, out = sys.argv[1], float(sys.argv[2]), float(sys.argv[3]), sys.argv[4]
cams = sys.argv[5:]
ts = {}
for c in cams:
    ts[c] = [int(l.split('=', 1)[1])
             for l in (pathlib.Path(rec) / f"{c}.meta.txt").read_text().splitlines()
             if l.startswith("FrameWallClock=")]
    if not ts[c]:
        raise SystemExit(f"{c}.meta.txt has no FrameWallClock lines")
start = max(v[0] for v in ts.values())
end = min(v[-1] for v in ts.values())
t0 = start + int(from_s * 1e9)
t1 = end if dur_s <= 0 else min(end, t0 + int(dur_s * 1e9))
if t1 <= t0:
    raise SystemExit(f"empty window: --from {from_s}s is past the end of the overlap "
                     f"({(end-start)/1e9:.1f}s of common footage)")
plan = {"overlap_s": (end - start) / 1e9, "window_s": (t1 - t0) / 1e9, "cams": {}}
for c in cams:
    idx = [i for i, t in enumerate(ts[c]) if t0 <= t <= t1]
    plan["cams"][c] = {"start": idx[0], "count": len(idx),
                       "first_us": ts[c][idx[0]] // 1000,
                       "timestamps": [t // 1000 for t in ts[c][idx[0]:idx[0] + len(idx)]]}
pathlib.Path(out).write_text(json.dumps(plan))
print(f"[bench] common footage {plan['overlap_s']:.1f}s, replaying {plan['window_s']:.1f}s")
for c in cams:
    print(f"[bench]   {c}: {plan['cams'][c]['count']} frames from index {plan['cams'][c]['start']}")
PY

# --------------------------------------------------- extract (cached) frames --
# Cache key covers everything that changes the pixels, so a different window or
# resolution does not silently reuse the wrong frames.
CACHE_KEY="$(printf '%s|%s|%s|%s|%s' "$RECORDING" "$FROM_S" "$DURATION_S" "$WIDTH" "$HEIGHT" | md5sum | cut -c1-12)"
CACHE_DIR="$FRAMES_DIR/$CACHE_KEY"
if [ -f "$CACHE_DIR/.complete" ]; then
  log "reusing cached frames ($CACHE_DIR)"
else
  log "extracting replay frames -- first run for this window, this takes a few minutes"
  rm -rf "$CACHE_DIR"
  for cam in "${CAMERAS[@]}"; do
    dst="$CACHE_DIR/$cam"; mkdir -p "$dst"
    start=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['cams'][sys.argv[2]]['start'])" "$WINDOW_JSON" "$cam")
    count=$(python3 -c "import json,sys;print(json.load(open(sys.argv[1]))['cams'][sys.argv[2]]['count'])" "$WINDOW_JSON" "$cam")
    if [ -f "$RECORDING/$cam.mp4" ]; then input=(-i "$RECORDING/$cam.mp4")
    else input=(-f mjpeg -i "$RECORDING/$cam.mjpeg"); fi
    log "  $cam: $count frames"
    ffmpeg -nostdin -loglevel error -y "${input[@]}" \
      -vf "select='gte(n\,$start)',scale=$WIDTH:$HEIGHT,format=gray" \
      -vsync 0 -frames:v "$count" -f image2 "$dst/%06d.pgm"
    echo 30 > "$dst/fps.txt"
  done
  # Timestamps last: ReplaySource refuses a timestamps.txt whose length does not
  # match the frame count, which is exactly the mistake worth catching here.
  python3 - "$WINDOW_JSON" "$CACHE_DIR" "${CAMERAS[@]}" <<'PY'
import json, pathlib, sys
plan = json.load(open(sys.argv[1])); root = pathlib.Path(sys.argv[2])
for c in sys.argv[3:]:
    d = root / c
    n = len(list(d.glob("*.pgm")))
    want = plan["cams"][c]["timestamps"]
    if n != len(want):
        raise SystemExit(f"{c}: extracted {n} frames but planned {len(want)}")
    (d / "timestamps.txt").write_text("\n".join(str(t) for t in want) + "\n")
PY
  touch "$CACHE_DIR/.complete"
  log "frames cached at $CACHE_DIR"
fi

# --------------------------------------------------------- camera attitudes --
# Each node's own BNO08x median over the window, PLUS a per-camera offset.
#
# The offsets are needed because the BNO08x measures its own housing, not the
# optical axis, and the offset differs per unit (pi/README.md says so). Taken
# raw, the three measured yaws (45 / 60 / 92 deg) cannot all be optical axes --
# three cameras 0.43 m apart with a 41 deg field of view cannot all see the same
# drone at once if they point 47 deg apart -- and triangulating from them puts
# the target behind a camera or sitting on the lens.
#
# These offsets were fitted from this recording: the values that make the three
# rays actually meet, with the scale pinned by the operator's observation that
# the drone stays 1-2 m from the rig. They put every solution 0.9-1.3 m out,
# in front of all three cameras. They are an empirical fix for the replay, NOT
# a calibration: the residual reprojection error is ~6 px median because the
# centroid of a quadcopter's silhouette is not the same physical point from
# three different angles. Run pavois_imu_calib on the rig for a real one.
declare -A HEADING_OFFSET=( [jean]=0.0   [tanel]=-39.31 [walid]=-42.50 )
declare -A ELEVATION_OFFSET=( [jean]=0.0 [tanel]=9.12   [walid]=-12.47 )
declare -A HEADING ELEVATION ROLL
for cam in "${CAMERAS[@]}"; do
  if [ -f "$RECORDING/$cam.imu.log" ]; then
    read -r h e r <<<"$(python3 - "$RECORDING/$cam.imu.log" "$WINDOW_JSON" "$cam" <<'PY'
import json, pathlib, statistics, sys
rows = [l.split() for l in pathlib.Path(sys.argv[1]).read_text().splitlines()]
rows = [[float(x) for x in r] for r in rows if len(r) == 4]
plan = json.load(open(sys.argv[2]))["cams"][sys.argv[3]]
lo = plan["first_us"] / 1e6
hi = lo + 10 ** 9
sel = [r for r in rows if r[0] >= lo] or rows
print(f"{statistics.median(r[1] for r in sel):.2f} "
      f"{-statistics.median(r[2] for r in sel):.2f} "
      f"{statistics.median(r[3] for r in sel):.2f}")
PY
)"
    HEADING[$cam]=$(python3 -c "print(f'{$h + ${HEADING_OFFSET[$cam]}:.2f}')")
    ELEVATION[$cam]=$(python3 -c "print(f'{$e + ${ELEVATION_OFFSET[$cam]}:.2f}')")
    ROLL[$cam]=$r
  else
    HEADING[$cam]=0.0; ELEVATION[$cam]=20.0; ROLL[$cam]=0.0
  fi
  if [ -n "${POSE_OVERRIDE[$cam]:-}" ]; then
    IFS=, read -r h e r <<<"${POSE_OVERRIDE[$cam]}"
    HEADING[$cam]=$h; ELEVATION[$cam]=$e; ROLL[$cam]=$r
  fi
done

# -------------------------------------------------------------- vps backend --
export UDP_HMAC_SECRET="${UDP_HMAC_SECRET:-pavois-replay-bench-secret}"

# The backend refuses the tokens published in .env.example (dev-pavois-token and
# friends) and fails at boot rather than start with bypassable auth, so the bench
# mints a real one. Kept in the work directory so the browser's stored session
# keeps working across runs and you only paste it once.
TOKEN_FILE="$WORK_DIR/ws_token"
if [ ! -s "$TOKEN_FILE" ]; then
  (umask 077; head -c 24 /dev/urandom | od -An -tx1 | tr -d ' \n' > "$TOKEN_FILE")
fi
WS_TOKEN="$(cat "$TOKEN_FILE")"

if [ ! -d "$REPO_ROOT/vps/node_modules" ]; then
  log "installing vps dependencies (first run)"
  (cd "$REPO_ROOT/vps" && npm install --no-audit --no-fund) >"$RUN_DIR/vps-install.log" 2>&1 \
    || { tail -20 "$RUN_DIR/vps-install.log"; die "vps npm install failed, see $RUN_DIR/vps-install.log"; }
fi

# Build explicitly rather than leaning on `nest start`. nest-cli deletes dist/
# on every build while tsc keeps an incremental tsbuildinfo, so a stale
# tsbuildinfo makes the compiler believe dist/ is already current and emit
# nothing -- `nest start` then dies on a missing dist/main.
log "building vps"
rm -f "$REPO_ROOT/vps/tsconfig.build.tsbuildinfo"
(cd "$REPO_ROOT/vps" && npm run build) >"$RUN_DIR/vps-build.log" 2>&1 \
  || { tail -25 "$RUN_DIR/vps-build.log"; die "vps build failed, see $RUN_DIR/vps-build.log"; }
[ -f "$REPO_ROOT/vps/dist/main.js" ] || die "vps build produced no dist/main.js"

log "starting vps (UDP 41234, WebSocket/HTTP 3002)"
(
  cd "$REPO_ROOT/vps"
  UDP_PORT=41234 UDP_HOST=127.0.0.1 PORT=3002 \
  WS_AUTH_TOKEN="$WS_TOKEN" \
  UDP_HMAC_SECRET="$UDP_HMAC_SECRET" \
  ALLOWED_ORIGINS="http://localhost:4200" \
  CLASSIFICATION_ENABLED=false \
  PREVIEW_MIN_INTERVAL_MS=0 \
  FUSION_MIN_RANGE_M=0.5 \
  FUSION_MAX_RANGE_M=3 \
  node dist/main >"$RUN_DIR/vps.log" 2>&1
) &
PIDS+=($!)

log "waiting for the vps to come up"
for i in $(seq 1 90); do
  if (exec 3<>/dev/tcp/127.0.0.1/3002) 2>/dev/null; then exec 3<&- 3>&-; break; fi
  if ! kill -0 "${PIDS[-1]}" 2>/dev/null; then
    tail -25 "$RUN_DIR/vps.log"; die "vps exited during startup, see $RUN_DIR/vps.log"
  fi
  sleep 2
  [ "$i" = 90 ] && { tail -25 "$RUN_DIR/vps.log"; die "vps did not open port 3002"; }
done
log "vps is up"

# ------------------------------------------- align the vps to the rail rig --
# The vps triangulates from each camera's STORED GPS position, not from the rail
# pose the detector sends (that only feeds the rail debug view). Its defaults put
# jean and tanel 1 m apart and walid 4 m away, which is not this rig: three
# cameras on a 1 m rail with 0.4286 m between neighbours. With the wrong baseline
# the bearings cannot agree and fusion rejects nearly every frame with
# "no subset passed parallax/residual gates".
#
# So push the rail layout in as GPS, around whatever origin the vps already holds
# for the first camera. The rail runs east-west, matching RAIL_X.
log "aligning the vps camera positions with the rail geometry"
if ! python3 "$REPO_ROOT/scripts/lib/pavois_bench_align_cameras.py" "$WS_TOKEN" "${CAMERAS[*]}" \
      "${RAIL_X[jean]} ${RAIL_X[tanel]} ${RAIL_X[walid]}"; then
  log "WARNING: could not set camera positions; fusion geometry may be wrong"
fi

# ---------------------------------------------------------------- frontend --
if [ "$SKIP_FRONTEND" = 0 ]; then
  # The Angular CLI refuses to run on Node < 22, while the vps is happy on 20.
  # Rather than force one version on the whole machine, find a new enough Node
  # just for `ng serve` and leave everything else on whatever is default.
  FE_NODE_BIN=""
  node_major() { "$1" --version 2>/dev/null | sed 's/^v//' | cut -d. -f1; }
  if [ "$(node_major node)" -ge 22 ] 2>/dev/null; then
    FE_NODE_BIN="$(dirname "$(command -v node)")"
  else
    while IFS= read -r candidate; do
      [ -x "$candidate/node" ] || continue
      if [ "$(node_major "$candidate/node")" -ge 22 ] 2>/dev/null; then FE_NODE_BIN="$candidate"; fi
    done < <(find "$HOME/.nvm/versions/node" -maxdepth 2 -type d -name bin 2>/dev/null | sort -V)
  fi
  if [ -z "$FE_NODE_BIN" ]; then
    log "WARNING: the Angular CLI needs Node >= 22 and none was found."
    log "         Skipping the frontend; the vps and detectors still run."
    log "         Install one (nvm install 22) and re-run to get the UI."
    SKIP_FRONTEND=1
  else
    log "frontend will use node $("$FE_NODE_BIN/node" --version) from $FE_NODE_BIN"
  fi
fi

if [ "$SKIP_FRONTEND" = 0 ]; then
  if [ ! -d "$REPO_ROOT/frontend-angular/node_modules" ]; then
    log "installing frontend dependencies (first run)"
    (cd "$REPO_ROOT/frontend-angular" && PATH="$FE_NODE_BIN:$PATH" npm install --no-audit --no-fund) >"$RUN_DIR/fe-install.log" 2>&1 \
      || { tail -20 "$RUN_DIR/fe-install.log"; die "frontend npm install failed, see $RUN_DIR/fe-install.log"; }
  fi
  # The repo's proxy.conf.json forwards /api only. The dev build derives its
  # WebSocket URL from the page origin, so /ws needs forwarding too or the map
  # never receives a track. Generated here rather than edited in the repo.
  cat > "$RUN_DIR/proxy.conf.json" <<JSON
{
  "/api": { "target": "http://localhost:3002", "secure": false, "pathRewrite": { "^/api": "" } },
  "/ws":  { "target": "http://localhost:3002", "secure": false, "ws": true, "pathRewrite": { "^/ws": "" } }
}
JSON
  log "starting frontend (ng serve on 4200)"
  (
    cd "$REPO_ROOT/frontend-angular"
    PATH="$FE_NODE_BIN:$PATH" npx ng serve --configuration=development --port 4200 \
      --proxy-config "$RUN_DIR/proxy.conf.json" >"$RUN_DIR/frontend.log" 2>&1
  ) &
  PIDS+=($!)
fi

# --------------------------------------------------------------- detectors --
# One process per camera, as on the rig. With a single enabled camera each
# process emits raw observations and the VPS performs the cross-camera fusion.
# One shared wall-clock origin for all three replays. Each process otherwise
# paces from its own open(), so the few hundred ms between launches becomes a
# permanent offset between their recorded clocks -- measured at 1.6 s, against a
# 20 ms fusion window, which means the VPS almost never sees two cameras at the
# same instant and reports "need >= 2 observations". The lead time covers
# process startup so nobody starts already behind.
REPLAY_ANCHOR_US=$(( ($(date +%s) + 6) * 1000000 ))
log "starting ${#CAMERAS[@]} detector processes (shared replay start in 6 s)"
for cam in "${CAMERAS[@]}"; do
  conf="$RUN_DIR/$cam.conf"
  cat > "$conf" <<CONF
# Generated by scripts/pavois_replay_bench.sh -- one camera, as on a Pi.
frames=-1
replay_loop=true
replay_realtime=true
replay_anchor_us=$REPLAY_ANCHOR_US
processing_threads=2
observation_log=$RUN_DIR/obs

output_host=127.0.0.1
output_port=41234

# This rig works at 1-2 m indoors, so anything outside that band is a bad
# intersection rather than a target. Without the floor a degenerate solution
# lands on the lens and shows up on the map stuck to the camera.
fusion_min_range_m=0.5
fusion_max_range_m=3.0

preview.enabled=true
preview.host=127.0.0.1
preview.http_port=3002
preview.http_path=/api/preview
preview.fps=$PREVIEW_FPS
preview.width=320

classification.enabled=false
imu.enabled=false

camera.0.id=$cam
camera.0.device=$CACHE_DIR/$cam
camera.0.enabled=true
camera.0.width=$WIDTH
camera.0.height=$HEIGHT
camera.0.fov_deg=$FOV_DEG
camera.0.x=${RAIL_X[$cam]}
camera.0.y=0.0
camera.0.z=0.0
camera.0.heading_deg=${HEADING[$cam]}
camera.0.elevation_deg=${ELEVATION[$cam]}
camera.0.roll_deg=${ROLL[$cam]}
camera.0.rail_pose_enabled=true
camera.0.rail_x=${RAIL_X[$cam]}
camera.0.rail_y=0.0
camera.0.rail_z=0.0
camera.0.rail_heading_deg=${HEADING[$cam]}
camera.0.rail_elevation_deg=${ELEVATION[$cam]}
camera.0.rail_roll_deg=${ROLL[$cam]}
CONF
  UDP_HMAC_SECRET="$UDP_HMAC_SECRET" \
    "$DETECT" --config "$conf" >"$RUN_DIR/$cam.tracks.txt" 2>"$RUN_DIR/$cam.log" &
  PIDS+=($!)
  log "  $cam replaying (heading ${HEADING[$cam]}, elevation ${ELEVATION[$cam]})"
done

cat <<BANNER

  ============================================================
   Pavois replay bench is running
  ============================================================
   frontend .......... http://localhost:4200
   vps ............... http://localhost:3002   UDP 41234
   detectors ......... ${CAMERAS[*]}  (looping the recording)
   logs .............. $RUN_DIR

   LOG IN with this token (the field is pre-filled with the
   repo's placeholder, which the backend rejects on purpose):

       $WS_TOKEN

   The browser remembers it, so this is a first-run step only.

   The footage is replayed on its recorded clock, so the three
   cameras stay in step and the VPS can fuse them.

   NOTE: camera headings come from each node's BNO08x, which
   measures its housing rather than the optical axis. Bearings
   are indicative; run pavois_imu_calib on the rig before
   trusting the fused 3D position.

   Ctrl-C to stop everything.
  ============================================================

BANNER

[ "$KEEP_FRAMES" = 1 ] || true
wait
