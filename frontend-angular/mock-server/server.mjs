import { createServer } from 'node:http';
import { deflateSync, crc32 } from 'node:zlib';
import { WebSocketServer } from 'ws';

const PORT = 3000;
const RAW_DETECTION_INTERVAL_MS = 800;
const TRACK_INTERVAL_MS = 200;
const IMU_INTERVAL_MS = 200;
const PREVIEW_INTERVAL_MS = 500;
const DEV_TOKEN = 'dev-pavois-token';

// Pistes simulées autour des caméras ci-dessous.
const ORIGIN_LAT = 48.82603;
const ORIGIN_LNG = 2.36605;
const ORIGIN_ALT = 35.0;

// Équivalent de la configuration stockée par le backend (PUT /cameras/:id/position).
const cameras = [
  { id: 'cam0', lat: 48.82608, lon: 2.3659, alt: 58.524, headingDeg: 249.0, fovDeg: 69.0 },
  { id: 'cam1', lat: 48.8260968, lon: 2.3658928, alt: 58.524, headingDeg: 249.0, fovDeg: 69.0 },
];

const server = createServer(handleHttpRequest);
const wss = new WebSocketServer({ server });
server.listen(PORT, () => {
  console.log(`Mock server listening on http://localhost:${PORT} (WebSocket + PUT /cameras/:id/position)`);
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
  res.setHeader('Access-Control-Allow-Methods', 'GET, PUT, OPTIONS');
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

  const match = req.url?.match(/^\/cameras\/([^/]+)\/position$/);
  if (req.method !== 'PUT' || !match) {
    sendJson(res, 404, { message: `Cannot ${req.method} ${req.url}` });
    return;
  }

  let body = '';
  req.on('data', (chunk) => (body += chunk));
  req.on('end', () => {
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

function randomRawDetection() {
  frameIndex += 1;
  return {
    type: 'raw_detection',
    cameraId: 'cam0',
    frameIndex,
    timestamp: Date.now(),
    x: Math.round((300 + Math.random() * 600) * 100) / 100,
    y: Math.round((200 + Math.random() * 400) * 100) / 100,
    size: Math.round(500 + Math.random() * 3000),
    confidence: Math.round((0.7 + Math.random() * 0.3) * 1000) / 1000,
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

function simulatedImu(cameraId, headingBase) {
  const t = Date.now() / 1000;
  return {
    cameraId,
    headingDeg: headingBase + Math.sin(t) * 8,
    elevationDeg: Math.sin(t * 1.3) * 3,
    rollDeg: Math.cos(t * 0.9) * 2,
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

wss.on('connection', (socket) => {
  console.log('Client connected');
  socket.send(JSON.stringify({ event: 'camera_positions', data: cameras }));

  const rawInterval = setInterval(() => {
    socket.send(JSON.stringify({ event: 'raw_detection', data: randomRawDetection() }));
  }, RAW_DETECTION_INTERVAL_MS);

  const trackInterval = setInterval(() => {
    socket.send(JSON.stringify({ event: 'track_update', data: simulatedTrackUpdate() }));
  }, TRACK_INTERVAL_MS);

  const imuInterval = setInterval(() => {
    socket.send(JSON.stringify({
      event: 'imu_update',
      data: simulatedImu('cam0', cameras[0].headingDeg),
    }));
    socket.send(JSON.stringify({
      event: 'imu_update',
      data: simulatedImu('cam1', cameras[1].headingDeg),
    }));
    socket.send(JSON.stringify({
      event: 'imu_update',
      data: simulatedImu('pi-inconnu', 42),
    }));
  }, IMU_INTERVAL_MS);

  let previewTick = 0;
  const previewInterval = setInterval(() => {
    previewTick += 1;
    socket.send(JSON.stringify({
      event: 'camera_preview',
      data: simulatedPreview('cam0', previewTick),
    }));
    socket.send(JSON.stringify({
      event: 'camera_preview',
      data: simulatedPreview('cam1', previewTick + 8),
    }));
    socket.send(JSON.stringify({
      event: 'camera_preview',
      data: simulatedPreview('pi-inconnu', previewTick + 16),
    }));
    socket.send(JSON.stringify({
      event: 'camera_preview',
      data: simulatedPreview('preview-orpheline', previewTick + 24),
    }));
  }, PREVIEW_INTERVAL_MS);

  socket.on('close', () => {
    clearInterval(rawInterval);
    clearInterval(trackInterval);
    clearInterval(imuInterval);
    clearInterval(previewInterval);
    console.log('Client disconnected');
  });
});
