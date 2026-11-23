'use strict';

const express = require('express');
const http = require('node:http');
const crypto = require('node:crypto');
const path = require('node:path');
const { Server } = require('socket.io');
const animals = require('./data/animals.json');

const app = express();
const server = http.createServer(app);
const io = new Server(server, { maxHttpBufferSize: 10_000 });
const PORT = Number(process.env.PORT) || 3000;
const roomCodes = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const byId = new Map(animals.map((animal) => [animal.id, animal]));
const rooms = new Map();

app.disable('x-powered-by');
app.use(express.static(path.join(__dirname, 'public'), { maxAge: '1h' }));
app.get('/api/health', (_req, res) => res.json({ ok: true, rooms: rooms.size }));
app.get('/api/animals', (_req, res) => res.json(
  animals.map(({ id, name, emoji, group }) => ({ id, name, emoji, group }))
    .sort((a, b) => a.name.localeCompare(b.name, 'hr'))
));

function makeCode() {
  let code;
  do {
    code = Array.from(crypto.randomBytes(6), (n) => roomCodes[n % roomCodes.length]).join('');
  } while (rooms.has(code));
  return code;
}

function cleanName(input) {
  return typeof input === 'string'
    ? input.replace(/[\u0000-\u001f\u007f]/g, '').trim().replace(/\s+/g, ' ').slice(0, 24)
    : '';
}
function reply(ack, result) {
  if (typeof ack === 'function') ack(result);
}
function getMembership(socket) {
  const room = rooms.get(socket.data.roomCode);
  const player = room?.players.find((p) => p.id === socket.data.playerId);
  if (!room || !player || player.socketId !== socket.id) return null;
  return { room, player };
}
function addLog(room, entry) {
  room.messages.push({ id: crypto.randomUUID(), at: Date.now(), ...entry });
  if (room.messages.length > 100) room.messages.shift();
  room.touchedAt = Date.now();
}
function viewFor(room, me) {
  return {
    code: room.code,
    round: room.round,
    phase: room.phase,
    me: { id: me.id, name: me.name, animal: me.animalId ? byId.get(me.animalId) : null },
    players: room.players.map((p) => ({
      id: p.id,
      name: p.name,
      connected: Boolean(p.socketId),
      picked: Boolean(p.animalId),
      score: p.score,
      ...(room.phase === 'finished' && p.animalId
        ? { revealedAnimal: byId.get(p.animalId).name }
        : {})
    })),
    winnerId: room.phase === 'finished' ? room.winnerId : null,
    messages: room.messages
  };
}
function broadcast(room) {
  room.touchedAt = Date.now();
  for (const player of room.players) {
    if (player.socketId) io.to(player.socketId).emit('room:state', viewFor(room, player));
  }
}
function resetRound(room, text = 'Nova runda! Odaberite nove životinje.') {
  room.round += 1;
  room.phase = 'choosing';
  room.winnerId = null;
  room.messages = [];
  for (const p of room.players) p.animalId = null;
  addLog(room, { kind: 'system', text });
}
function detach(socket, removing = false) {
  const membership = getMembership(socket);
  if (!membership) return;
  const { room, player } = membership;
  socket.leave(room.code);
  socket.data.roomCode = undefined;
  socket.data.playerId = undefined;
  if (removing) {
    room.players = room.players.filter((p) => p !== player);
    if (room.players.length === 0) {
      rooms.delete(room.code);
      return;
    }
    resetRound(room, `${player.name} je napustio/la sobu. Čeka se novi igrač.`);
  } else {
    player.socketId = null;
    addLog(room, { kind: 'system', text: `${player.name} je izgubio/la vezu. Može se vratiti istim linkom.` });
  }
  broadcast(room);
}

io.on('connection', (socket) => {
  socket.on('room:create', (payload, ack) => {
    if (getMembership(socket)) return reply(ack, { ok: false, error: 'Već si u sobi.' });
    const name = cleanName(payload?.name);
    if (name.length < 2) return reply(ack, { ok: false, error: 'Upiši ime (najmanje 2 znaka).' });
    const code = makeCode();
    const token = crypto.randomBytes(24).toString('hex');
    const player = { id: crypto.randomUUID(), name, token, socketId: socket.id, animalId: null, score: 0 };
    const room = { code, players: [player], round: 1, phase: 'choosing', winnerId: null, messages: [], touchedAt: Date.now() };
    rooms.set(code, room);
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    addLog(room, { kind: 'system', text: `${name} je napravio/la sobu. Pozovi drugog igrača!` });
    reply(ack, { ok: true, code, token });
    broadcast(room);
  });

  socket.on('room:join', (payload, ack) => {
    if (getMembership(socket)) return reply(ack, { ok: false, error: 'Već si u sobi.' });
    const code = typeof payload?.code === 'string' ? payload.code.trim().toUpperCase() : '';
    const name = cleanName(payload?.name);
    const room = rooms.get(code);
    if (!room) return reply(ack, { ok: false, error: 'Ta soba ne postoji ili je istekla. Provjeri kod.' });
    if (name.length < 2) return reply(ack, { ok: false, error: 'Upiši ime (najmanje 2 znaka).' });
    let player = room.players.find((p) => p.token === payload?.token);
    let token;
    if (player) {
      if (player.socketId && player.socketId !== socket.id) {
        const oldSocket = io.sockets.sockets.get(player.socketId);
        if (oldSocket) {
          oldSocket.data.roomCode = undefined;
          oldSocket.data.playerId = undefined;
          oldSocket.emit('room:replaced');
          oldSocket.disconnect(true);
        }
      }
      player.socketId = socket.id;
      player.name = name;
      token = player.token;
      addLog(room, { kind: 'system', text: `${name} se ponovno povezao/la.` });
    } else {
      if (room.players.length >= 2) return reply(ack, { ok: false, error: 'Soba je puna (najviše 2 igrača).' });
      token = crypto.randomBytes(24).toString('hex');
      player = { id: crypto.randomUUID(), name, token, socketId: socket.id, animalId: null, score: 0 };
      room.players.push(player);
      addLog(room, { kind: 'system', text: `${name} se pridružio/la sobi. Igra može početi!` });
    }
    socket.join(code);
    socket.data.roomCode = code;
    socket.data.playerId = player.id;
    reply(ack, { ok: true, code, token });
    broadcast(room);
  });

  socket.on('player:choose', (payload, ack) => {
    const m = getMembership(socket);
    if (!m) return reply(ack, { ok: false, error: 'Nisi u sobi.' });
    const { room, player } = m;
    if (room.phase !== 'choosing') return reply(ack, { ok: false, error: 'Odabir je za ovu rundu završen.' });
    if (player.animalId) return reply(ack, { ok: false, error: 'Već si odabrao/la životinju.' });
    if (!byId.has(payload?.animalId)) return reply(ack, { ok: false, error: 'Odaberi životinju s popisa.' });
    player.animalId = payload.animalId;
    addLog(room, { kind: 'system', text: `${player.name} je potajno odabrao/la životinju. 🔒` });
    if (room.players.length === 2 && room.players.every((p) => p.animalId)) {
      room.phase = 'playing';
      addLog(room, { kind: 'system', text: 'Oboje ste spremni! Pitajte i pogađajte. 🥳' });
    }
    reply(ack, { ok: true });
    broadcast(room);
  });

  socket.on('message:send', (payload, ack) => {
    const m = getMembership(socket);
    if (!m) return reply(ack, { ok: false, error: 'Nisi u sobi.' });
    const text = typeof payload?.text === 'string'
      ? payload.text.replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 250)
      : '';
    if (!text) return reply(ack, { ok: false, error: 'Poruka ne može biti prazna.' });
    if (Date.now() - (socket.data.lastMessageAt || 0) < 500) {
      return reply(ack, { ok: false, error: 'Malo pričekaj prije sljedeće poruke.' });
    }
    socket.data.lastMessageAt = Date.now();
    addLog(m.room, { kind: 'chat', text, playerId: m.player.id, sender: m.player.name });
    reply(ack, { ok: true });
    broadcast(m.room);
  });

  socket.on('guess:submit', (payload, ack) => {
    const m = getMembership(socket);
    if (!m) return reply(ack, { ok: false, error: 'Nisi u sobi.' });
    const { room, player } = m;
    const other = room.players.find((p) => p.id !== player.id);
    if (room.phase !== 'playing' || !other?.animalId || !other.socketId) {
      return reply(ack, { ok: false, error: 'Pričekaj da oboje budete spremni i povezani.' });
    }
    const animal = byId.get(payload?.animalId);
    if (!animal) return reply(ack, { ok: false, error: 'Odaberi životinju s popisa.' });
    const correct = other.animalId === animal.id;
    if (correct) {
      room.phase = 'finished';
      room.winnerId = player.id;
      player.score++;
      addLog(room, { kind: 'win', text: `${player.name} je pogodio/la: ${animal.name}! 🎉`, playerId: player.id });
    } else {
      addLog(room, { kind: 'guess', text: `${player.name} pogađa „${animal.name}”, ali nije točno.`, playerId: player.id });
    }
    reply(ack, { ok: true, correct });
    broadcast(room);
  });

  socket.on('round:restart', (_payload, ack) => {
    const m = getMembership(socket);
    if (!m) return reply(ack, { ok: false, error: 'Nisi u sobi.' });
    if (m.room.phase !== 'finished') return reply(ack, { ok: false, error: 'Završi ovu rundu prije nove.' });
    resetRound(m.room);
    reply(ack, { ok: true });
    broadcast(m.room);
  });

  socket.on('room:leave', (_payload, ack) => {
    if (!getMembership(socket)) return reply(ack, { ok: false, error: 'Nisi u sobi.' });
    detach(socket, true);
    reply(ack, { ok: true });
  });
  socket.on('disconnect', () => detach(socket));
});

// Privremene sobe: nakon 30 min bez povezanih igrača brišu se iz memorije.
const sweep = setInterval(() => {
  const now = Date.now();
  for (const [code, room] of rooms) {
    if (room.players.every((p) => !p.socketId) && now - room.touchedAt > 30 * 60 * 1000) rooms.delete(code);
  }
}, 60_000);
sweep.unref();

if (require.main === module) server.listen(PORT, '0.0.0.0', () => {
  console.log(`Pogodi životinju: http://localhost:${PORT}`);
});

module.exports = { app, server, io, rooms, animals };
