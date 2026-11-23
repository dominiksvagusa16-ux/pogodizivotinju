'use strict';

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { io: clientIO } = require('socket.io-client');
const { server, io, animals } = require('../server');

let url;
const clients = [];

before(async () => {
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  url = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  clients.forEach((client) => client.disconnect());
  await new Promise((resolve) => io.close(resolve));
});

async function makeClient() {
  const client = clientIO(url, { transports: ['websocket'], forceNew: true, reconnection: false, autoConnect: false });
  client.current = null;
  client.on('room:state', (newState) => { client.current = newState; });
  clients.push(client);
  await new Promise((resolve, reject) => {
    client.once('connect', resolve);
    client.once('connect_error', reject);
    client.connect();
  });
  return client;
}

function emit(client, event, payload) {
  return new Promise((resolve, reject) => {
    client.timeout(3000).emit(event, payload, (error, response) => {
      if (error) reject(error);
      else resolve(response);
    });
  });
}

function waitFor(client, predicate) {
  if (client.current && predicate(client.current)) return Promise.resolve(client.current);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      client.off('room:state', listener);
      reject(new Error('Timed out waiting for room state'));
    }, 3000);
    function listener(state) {
      if (!predicate(state)) return;
      clearTimeout(timer);
      client.off('room:state', listener);
      resolve(state);
    }
    client.on('room:state', listener);
  });
}

test('baza ima raznolike životinje i provjerene obavezne stupce', () => {
  assert.ok(animals.length >= 130);
  assert.equal(new Set(animals.map((a) => a.id)).size, animals.length);
  for (const a of animals) {
    assert.ok(a.id && a.name && a.emoji && a.group && a.habitat && a.diet);
    assert.ok(Array.isArray(a.facts) && a.facts.length >= 2);
  }
});

test('API daje katalog bez privatnih činjenica', async () => {
  const response = await fetch(`${url}/api/animals`);
  assert.equal(response.status, 200);
  const catalog = await response.json();
  assert.equal(catalog.length, animals.length);
  assert.deepEqual(Object.keys(catalog[0]).sort(), ['emoji', 'group', 'id', 'name']);
});

test('dvoje igrača, skriveni izbor, pogoci, revanš i ponovno spajanje', async () => {
  const player1 = await makeClient();
  const created = await emit(player1, 'room:create', { name: 'Maja' });
  assert.equal(created.ok, true);
  assert.match(created.code, /^[A-Z2-9]{6}$/);
  await waitFor(player1, (s) => s.players.length === 1);

  const player2 = await makeClient();
  const joined = await emit(player2, 'room:join', { code: created.code, name: 'Luka' });
  assert.equal(joined.ok, true);
  await waitFor(player1, (s) => s.players.length === 2);

  const intruder = await makeClient();
  const blocked = await emit(intruder, 'room:join', { code: created.code, name: 'Nepoželjan gost' });
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /puna/);

  assert.equal((await emit(player1, 'player:choose', { animalId: 'lav' })).ok, true);
  assert.equal((await emit(player2, 'player:choose', { animalId: 'panda' })).ok, true);
  const a = await waitFor(player1, (s) => s.phase === 'playing');
  const b = await waitFor(player2, (s) => s.phase === 'playing');
  assert.equal(a.me.animal.id, 'lav');
  assert.equal(b.me.animal.id, 'panda');
  assert.equal(a.players.some((p) => p.revealedAnimal), false);
  assert.equal(b.players.some((p) => p.revealedAnimal), false);
  assert.ok(a.me.animal.facts.length > 0);
  assert.equal(a.messages.some((m) => m.text?.includes('Velika panda')), false);

  const wrong = await emit(player1, 'guess:submit', { animalId: 'tigar' });
  assert.equal(wrong.ok, true);
  assert.equal(wrong.correct, false);
  assert.equal((await emit(player1, 'message:send', { text: 'Živi li u šumi?' })).ok, true);
  await waitFor(player2, (s) => s.messages.some((m) => m.text === 'Živi li u šumi?'));

  const win = await emit(player1, 'guess:submit', { animalId: 'panda' });
  assert.equal(win.correct, true);
  const finished = await waitFor(player2, (s) => s.phase === 'finished');
  assert.equal(finished.players.find((p) => p.name === 'Maja').score, 1);
  assert.ok(finished.players.some((p) => p.revealedAnimal === 'Velika panda'));

  assert.equal((await emit(player2, 'round:restart', {})).ok, true);
  const restarted = await waitFor(player1, (s) => s.round === 2);
  assert.equal(restarted.phase, 'choosing');
  assert.ok(restarted.players.every((p) => !p.picked));
  assert.equal(restarted.players[0].score, 1);

  player2.disconnect();
  await waitFor(player1, (s) => !s.players.find((p) => p.name === 'Luka').connected);
  const player2back = await makeClient();
  const resumed = await emit(player2back, 'room:join', { code: created.code, name: 'Luka', token: joined.token });
  assert.equal(resumed.ok, true);
  const reconnected = await waitFor(player1, (s) => s.players.every((p) => p.connected));
  assert.equal(reconnected.players.length, 2);
});
