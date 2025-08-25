// signaling-server.js — tiny WS relay for SDP/ICE (no media)
// Run: node signaling-server.js
import { WebSocketServer } from 'ws';
const wss = new WebSocketServer({ port: 8787 });
const rooms = new Map(); // roomId -> Set(ws)

function join(ws, room){
  if (!rooms.has(room)) rooms.set(room, new Set());
  rooms.get(room).add(ws);
  ws.room = room;
}

wss.on('connection', ws => {
  ws.on('message', raw => {
    try {
      const msg = JSON.parse(raw.toString());
      if (msg.type === 'join' && msg.room){ join(ws, msg.room); return; }
      if (!ws.room) return;
      const peers = rooms.get(ws.room) || new Set();
      for (const peer of peers){ if (peer !== ws && peer.readyState === 1) peer.send(JSON.stringify(msg)); }
    } catch (e) {}
  });
  ws.on('close', () => {
    if (ws.room && rooms.has(ws.room)) rooms.get(ws.room).delete(ws);
  });
});
console.log('WS relay on ws://0.0.0.0:8787');
