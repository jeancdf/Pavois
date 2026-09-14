import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { WebSocketServer } from 'ws';

const PORT = 3000;
const RAW_DETECTION_INTERVAL_MS = 800;
const TRACK_INTERVAL_MS = 200;
const IMU_INTERVAL_MS = 200;
const PREVIEW_INTERVAL_MS = 500;
const FUSE_INTERVAL_MS = 200;
const STATS_INTERVAL_MS = 1000;
const DEV_TOKEN = 'dev-pavois-token';
const MOCK_MODE = (process.env.MOCK_MODE || 'demo').trim().toLowerCase();
const IS_TERRAIN = MOCK_MODE === 'terrain';

// Pistes du mode demo uniquement — absentes en production.
const ORIGIN_LAT = 48.82603;
const ORIGIN_LNG = 2.36605;
const ORIGIN_ALT = 35.0;

const DEMO_CAMERAS = [
  { id: 'cam0', lat: 48.82608, lon: 2.3659, alt: 58.524, headingDeg: 249.0, fovDeg: 69.0, rangeM: 60 },
  { id: 'cam1', lat: 48.8260968, lon: 2.3658928, alt: 58.524, headingDeg: 249.0, fovDeg: 69.0, rangeM: 60 },
];

// IDs et poses du parc réel (vps/src/cameras.service.ts).
const TERRAIN_CAMERAS = [
  { id: 'jean', lat: 48.826132, lon: 2.365856, alt: 58.524, headingDeg: 164, fovDeg: 65, rangeM: 60 },
  { id: 'tanel', lat: 48.826134, lon: 2.365869, alt: 58.524, headingDeg: 164, fovDeg: 65, rangeM: 60 },
  { id: 'walid', lat: 48.826098, lon: 2.365877, alt: 58.524, headingDeg: 344, fovDeg: 65, rangeM: 60 },
];

const cameras = IS_TERRAIN ? TERRAIN_CAMERAS : DEMO_CAMERAS;
const RAIL_BASELINE_M = 3 / 7;
let railBench = null;

function mockRailBench(rangeM = 2.5) {
  return {
    active: true,
    rigWidthMm: 1000,
    rangeM,
    targetSizeM: 0.2,
    hoverM: 0.4,
    headingDeg: 0,
    elevationDeg: 20,
    cameras: [
      { id: 'tanel', x: -RAIL_BASELINE_M, y: 0, z: 0, headingDeg: 0, elevationDeg: 20, rollDeg: 0 },
      { id: 'jean', x: 0, y: 0, z: 0, headingDeg: 0, elevationDeg: 20, rollDeg: 0 },
      { id: 'walid', x: RAIL_BASELINE_M, y: 0, z: 0, headingDeg: 0, elevationDeg: 20, rollDeg: 0 },
    ],
    expected: { x: 0, y: rangeM, z: 0.4 },
  };
}

function readBody(req) {
  return new Promise((resolve) => {
    let body = '';
    req.on('data', (chunk) => (body += chunk));
    req.on('end', () => resolve(body));
  });
}

const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
server.listen(PORT, () => {
  const profile = IS_TERRAIN
    ? 'terrain = production (att + raw, pas de piste)'
    : 'demo = playground UI (pistes simulées)';
  console.log(
    `Mock server on http://localhost:${PORT} mode=${MOCK_MODE} (${profile})`,
  );
});

let frameIndex = 0;
let tick = 0;

function sendJson(res, status, body) {
  res.writeHead(status, { 'Content-Type': 'application/json' });
  res.end(JSON.stringify(body));
}

function broadcast(event, data) {
  const payload = JSON.stringify({ event, data });
  wss.clients.forEach((client) => {
    if (client.readyState === client.OPEN) client.send(payload);
  });
}

function handleHttpRequest(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, POST, DELETE, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  if (req.method === 'OPTIONS') {
    res.writeHead(204).end();
    return;
  }

  const urlPath = req.url?.split('?')[0] ?? '';
  if (req.method === 'GET' && urlPath === '/auth/verify') {
    const token = req.headers.authorization?.startsWith('Bearer ')
      ? req.headers.authorization.slice('Bearer '.length)
      : '';
    if (token === DEV_TOKEN) {
      sendJson(res, 200, { ok: true });
    } else {
      sendJson(res, 401, { message: 'Unauthorized' });
    }
    return;
  }

  if (urlPath === '/bench/rail') {
    if (req.method === 'GET') {
      sendJson(res, 200, { active: railBench !== null, bench: railBench });
      return;
    }
    if (req.method === 'DELETE') {
      railBench = null;
      broadcast('rail_bench', { active: false, bench: null });
      sendJson(res, 200, { active: false, bench: null });
      return;
    }
    if (req.method === 'POST') {
      readBody(req).then((raw) => {
        let rangeM = 2.5;
        try {
          const parsed = JSON.parse(raw || '{}');
          if (Number.isFinite(parsed.rangeM)) rangeM = parsed.rangeM;
        } catch {
          rangeM = 2.5;
        }
        railBench = mockRailBench(rangeM);
        broadcast('rail_bench', { active: true, bench: railBench });
        sendJson(res, 201, railBench);
      });
      return;
    }
  }

  const match = req.url?.match(/^\/cameras\/([^/]+)\/position$/);
  if (req.method !== 'PUT' || !match) {
    sendJson(res, 404, { message: `Cannot ${req.method} ${req.url}` });
    return;
  }

  readBody(req).then((body) => {
    const camera = cameras.find((cam) => cam.id === decodeURIComponent(match[1]));
    if (!camera) {
      sendJson(res, 404, { message: `Caméra inconnue : ${match[1]}` });
      return;
    }

    let position = null;
    try {
      position = JSON.parse(body);
    } catch {
      // position reste nulle : rejetée ci-dessous
    }
    const { lat, lon, alt } = position ?? {};
    if (![lat, lon, alt].every(Number.isFinite) || Math.abs(lat) > 90 || Math.abs(lon) > 180) {
      sendJson(res, 400, { message: 'Position invalide' });
      return;
    }

    Object.assign(camera, { lat, lon, alt });
    broadcast('camera_positions', cameras);
    sendJson(res, 200, camera);
  });
}

function randomRawDetection(camera) {
  frameIndex += 1;
  return {
    type: 'raw_detection',
    cameraId: camera.id,
    frameIndex,
    timestamp: Date.now(),
    x: Math.round((300 + Math.random() * 600) * 100) / 100,
    y: Math.round((200 + Math.random() * 400) * 100) / 100,
    size: Math.round(500 + Math.random() * 3000),
    confidence: Math.round((0.7 + Math.random() * 0.3) * 1000) / 1000,
    headingDeg: camera.headingDeg,
    elevationDeg: 0,
    rollDeg: 0,
  };
}

const CLASSIFICATIONS = ['drone', 'airplane', 'bird', 'other'];
// Classification fixe par piste pour que le mock soit cohérent
const trackClassifications = { obj0: 'drone', obj1: 'bird' };

function simulatedTrackUpdate() {
  tick += 1;
  const t = tick / 10;
  // Deux pistes simulées sur des trajectoires circulaires distinctes
  const tracks = [
    {
      trackId: 'obj0',
      lat: ORIGIN_LAT + 0.00015 * Math.sin(t * 0.3),
      lng: ORIGIN_LNG + 0.00015 * Math.cos(t * 0.3),
      alt: ORIGIN_ALT,
      classification: trackClassifications['obj0'],
    },
    {
      trackId: 'obj1',
      lat: ORIGIN_LAT + 0.0003 * Math.sin(t * 0.15 + 1),
      lng: ORIGIN_LNG + 0.0003 * Math.cos(t * 0.15 + 1),
      alt: ORIGIN_ALT + 10,
      classification: trackClassifications['obj1'],
    },
  ];
  const track = tracks[tick % 2];
  return { type: 'track_update', timestamp: Date.now(), ...track };
}

function simulatedImu(cameraId, headingBase, calibration, valid = true) {
  const t = Date.now() / 1000;
  return {
    cameraId,
    headingDeg: headingBase + Math.sin(t) * 8,
    elevationDeg: Math.sin(t * 1.3) * 3,
    rollDeg: Math.cos(t * 0.9) * 2,
    calibration,
    valid,
    timestamp: Date.now(),
  };
}

function pngChunk(type, data) {
  const typeBuf = Buffer.from(type);
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length, 0);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuf, data])), 0);
  return Buffer.concat([len, typeBuf, data, crc]);
}

function grayPng(width, height, pixels) {
  const raw = Buffer.alloc((width + 1) * height);
  for (let y = 0; y < height; y += 1) {
    raw[y * (width + 1)] = 0;
    pixels.copy(raw, y * (width + 1) + 1, y * width, (y + 1) * width);
  }
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  return Buffer.concat([
    sig,
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', deflateSync(raw)),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

function simulatedPreview(cameraId, tickValue) {
  const width = 160;
  const height = 90;
  const pixels = Buffer.alloc(width * height);
  const bar = Math.floor((tickValue * 7) % width);
  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const stripe = ((x + y + tickValue) & 16) ? 40 : 18;
      pixels[y * width + x] = x === bar ? 220 : stripe;
    }
  }
  return {
    cameraId,
    mime: 'image/png',
    jpegBase64: grayPng(width, height, pixels).toString('base64'),
    timestamp: Date.now(),
  };
}

function simulatedFuseUpdate() {
  const t = Date.now() / 1000;
  const range = railBench?.rangeM ?? 2.5;
  const point = {
    x: Math.sin(t) * 0.08,
    y: range + Math.sin(t * 0.7) * 0.12,
    z: 0.4 + Math.cos(t * 0.5) * 0.05,
  };
  return {
    type: 'fuse_update',
    lastFuse: {
      ok: true,
      rejectReason: null,
      residualM: 0.04,
      parallaxDeg: 10.2,
      confidence: 0.86,
      cameras: ['jean', 'tanel', 'walid'],
      point,
    },
    tracks: [
      {
        objectId: 1,
        timestampUs: Date.now() * 1000,
        x: point.x,
        y: point.y,
        z: point.z,
        confidence: 0.86,
        cameras: ['jean', 'tanel', 'walid'],
        classification: 'drone',
      },
    ],
  };
}

function simulatedStats(cameraId, fps) {
  return {
    type: 'camera_stats',
    cameraId,
    fps,
    frameIndex: frameIndex,
    timestamp: Date.now(),
  };
}

function startRailSim(socket, timers) {
  timers.push(setInterval(() => {
    sendEvent(socket, 'fuse_update', simulatedFuseUpdate());
  }, FUSE_INTERVAL_MS));
  timers.push(setInterval(() => {
    sendEvent(socket, 'camera_stats', simulatedStats('jean', 18.4));
    sendEvent(socket, 'camera_stats', simulatedStats('tanel', 10.1));
    sendEvent(socket, 'camera_stats', simulatedStats('walid', 9.6));
  }, STATS_INTERVAL_MS));
}

function startDemoStream(socket, timers) {
  timers.push(setInterval(() => {
    sendEvent(socket, 'raw_detection', randomRawDetection(cameras[0]));
  }, RAW_DETECTION_INTERVAL_MS));

  timers.push(setInterval(() => {
    sendEvent(socket, 'track_update', simulatedTrackUpdate());
  }, TRACK_INTERVAL_MS));

  timers.push(setInterval(() => {
    sendEvent(socket, 'imu_update', simulatedImu(
      'cam0', cameras[0].headingDeg,
      { sys: null, gyro: null, accel: null, mag: 3 },
    ));
    sendEvent(socket, 'imu_update', simulatedImu(
      'cam1', cameras[1].headingDeg,
      { sys: 2, gyro: 3, accel: 3, mag: 1 },
    ));
    sendEvent(socket, 'imu_update', simulatedImu('pi-inconnu', 42, null, false));
  }, IMU_INTERVAL_MS));

  let previewTick = 0;
  timers.push(setInterval(() => {
    previewTick += 1;
    sendEvent(socket, 'camera_preview', simulatedPreview('cam0', previewTick));
    sendEvent(socket, 'camera_preview', simulatedPreview('cam1', previewTick + 8));
    sendEvent(socket, 'camera_preview', simulatedPreview('pi-inconnu', previewTick + 16));
    sendEvent(socket, 'camera_preview', simulatedPreview('preview-orpheline', previewTick + 24));
  }, PREVIEW_INTERVAL_MS));
  startRailSim(socket, timers);
}

function startTerrainStream(socket, timers) {
  // Profil Pi réel : att + raw. Pas de track_update (la fusion est sur le VPS).
  const rawCams = [cameras[0], cameras[2]];
  timers.push(setInterval(() => {
    const cam = rawCams[frameIndex % rawCams.length];
    sendEvent(socket, 'raw_detection', randomRawDetection(cam));
  }, RAW_DETECTION_INTERVAL_MS));

  timers.push(setInterval(() => {
    for (const cam of cameras) {
      sendEvent(socket, 'imu_update', simulatedImu(
        cam.id, cam.headingDeg,
        { sys: null, gyro: null, accel: null, mag: 3 },
      ));
    }
  }, IMU_INTERVAL_MS));
  startRailSim(socket, timers);
}

wss.on('connection', (socket) => {
  console.log(`Client connected (mode=${MOCK_MODE})`);
  sendEvent(socket, 'camera_positions', cameras);
  if (railBench) {
    sendEvent(socket, 'rail_bench', { active: true, bench: railBench });
  }
  const timers = [];
  if (IS_TERRAIN) {
    startTerrainStream(socket, timers);
  } else {
    startDemoStream(socket, timers);
  }

  socket.on('close', () => {
    for (const timer of timers) {
      clearInterval(timer);
    }
    console.log('Client disconnected');
  });
});
