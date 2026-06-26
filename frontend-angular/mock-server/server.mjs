import { WebSocketServer } from 'ws';

const PORT = 3000;
const CAMERA_ID = 'cam0';
const EMIT_INTERVAL_MS = 800;

const wss = new WebSocketServer({ port: PORT });
console.log(`Mock WebSocket server (raw_detection) listening on ws://localhost:${PORT}`);

let frameIndex = 0;

function randomDetection() {
  frameIndex += 1;
  return {
    type: 'raw_detection',
    cameraId: CAMERA_ID,
    frameIndex,
    timestamp: Date.now(),
    x: Math.round((300 + Math.random() * 600) * 100) / 100,
    y: Math.round((200 + Math.random() * 400) * 100) / 100,
    size: Math.round(500 + Math.random() * 3000),
    confidence: Math.round((0.7 + Math.random() * 0.3) * 1000) / 1000,
  };
}

wss.on('connection', (socket) => {
  console.log('Client connected');

  const interval = setInterval(() => {
    socket.send(JSON.stringify({ event: 'raw_detection', data: randomDetection() }));
  }, EMIT_INTERVAL_MS);

  socket.on('close', () => {
    clearInterval(interval);
    console.log('Client disconnected');
  });
});
