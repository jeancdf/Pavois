import { WebSocketServer } from 'ws';

const PORT = 3000;
const RAW_DETECTION_INTERVAL_MS = 800;
const TRACK_INTERVAL_MS = 200;

// Centré sur la position GPS réelle de cam0 (cf. src/app/config/cameras.config.ts).
const ORIGIN_LAT = 48.82603;
const ORIGIN_LNG = 2.36605;
const ORIGIN_ALT = 35.0;

const wss = new WebSocketServer({ port: PORT });
console.log(`Mock WebSocket server listening on ws://localhost:${PORT}`);

let frameIndex = 0;
let tick = 0;

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

// Petit déplacement simulé autour de l'origine, exprimé directement en degrés
// GPS (mêmes unités que le vrai backend) — ~0.0001° ≈ 10 m.
function simulatedTrackUpdate() {
  tick += 1;
  const t = tick / 10;
  return {
    type: 'track_update',
    trackId: 'obj0',
    lat: ORIGIN_LAT + 0.00015 * Math.sin(t * 0.3),
    lng: ORIGIN_LNG + 0.00015 * Math.cos(t * 0.3),
    alt: ORIGIN_ALT,
    timestamp: Date.now(),
  };
}

wss.on('connection', (socket) => {
  console.log('Client connected');

  const rawInterval = setInterval(() => {
    socket.send(JSON.stringify({ event: 'raw_detection', data: randomRawDetection() }));
  }, RAW_DETECTION_INTERVAL_MS);

  const trackInterval = setInterval(() => {
    socket.send(JSON.stringify({ event: 'track_update', data: simulatedTrackUpdate() }));
  }, TRACK_INTERVAL_MS);

  socket.on('close', () => {
    clearInterval(rawInterval);
    clearInterval(trackInterval);
    console.log('Client disconnected');
  });
});
