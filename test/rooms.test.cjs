"use strict";

const assert = require("node:assert/strict");
const { test } = require("node:test");
const { Rooms } = require("../rooms.cjs");
const { cards, SETTINGS } = require("../rules.js");

function setUp(random = () => 0.9) {
  let now = 0;
  const jobs = new Map();
  let nextId = 0;
  const rooms = new Rooms({
    now: () => now, random,
    schedule(fn, delay) {
      jobs.set(++nextId, { fn, at: now + delay });
      return nextId;
    },
    unschedule: id => jobs.delete(id),
  });
  const host = rooms.create();
  const code = host.state.code;
  const tick = ms => {
    now += ms;
    for (const [id, timer] of jobs) {
      if (timer.at <= now) {
        jobs.delete(id);
        timer.fn();
      }
    }
  };
  const read = (client, after) => rooms.read(code, client.token, after);
  const action = (client, type, detail = {}, version = read(client).actionVersion) => rooms.action(code, client.token, { type, version, ...detail });
  const ready = (client, value = true, lobbyId = read(client).lobbyId) => action(client, "ready", { ready: value, lobbyId });
  const start = (guest = rooms.join(code)) => {
    const lobby = read(host).lobbyId;
    ready(host, true, lobby);
    ready(guest, true, lobby);
    return guest;
  };
  return { rooms, host, code, tick, read, action, ready, start };
}

test("both clients observe the storm before the next action clock starts", () => {
  const { rooms, code, host, tick, read, action, start } = setUp();
  const guest = start();
  for (let i = 0; i < 5; i++) action(i % 2 ? host : guest, "pass");
  assert.equal(read(host).turn, 2);
  assert.equal(read(host).storm, null);
  const startingTemps = [36.5, 36.5];
  assert.deepEqual(read(guest).players.map(player => player.temp), startingTemps);
  action(host, "pass");
  assert.equal(read(host).storm, "approaching");
  assert.equal(read(guest).blizzardCount, 0);
  assert.throws(() => action(guest, "pass"), { code: "MATCH_UNAVAILABLE" });
  tick(1499);
  assert.deepEqual(read(guest).players.map(player => player.temp), startingTemps);
  tick(1);
  assert.equal(read(guest).storm, "active");
  assert.equal(read(host).blizzardCount, 1);
  assert.deepEqual(read(host).stormDamage, { P1: 5, P2: 5 });
  assert.deepEqual(read(host).players.map(player => player.temp), [31.5, 31.5]);
  assert.throws(() => action(guest, "pass"), { code: "MATCH_UNAVAILABLE" });
  tick(1499);
  assert.equal(read(host).storm, "active");
  tick(1);
  assert.equal(read(guest).storm, null);
  assert.equal(read(guest).remainingMs, 15000);
  assert.equal(read(guest).stormDamage, null);
  rooms.close();
});

test("one invitation seats two players and starts exactly once when both are ready", () => {
  const { rooms, host, code, read, ready, action } = setUp();
  assert.match(code, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(host.state.phase, "waiting");
  assert.throws(() => rooms.join("AAAAA1"), { code: "ROOM_MISSING" });
  const guest = rooms.join(code);
  assert.notEqual(host.token, guest.token);
  assert.equal(guest.state.side, "P2");
  assert.equal(guest.state.phase, "lobby");
  assert.deepEqual(guest.state.ready, [false, false]);
  assert.equal(rooms.find(code).deadline, null);
  assert.throws(() => action(guest, "pass"), { code: "MATCH_UNAVAILABLE" });
  const lobbyId = guest.state.lobbyId;
  assert.deepEqual(ready(host, true, lobbyId).ready, [true, false]);
  assert.equal(read(guest).phase, "lobby");
  assert.deepEqual(ready(host, false, lobbyId).ready, [false, false]);
  ready(host, true, lobbyId);
  ready(guest, true, lobbyId);
  ready(guest, true, lobbyId);
  const shared = read(host);
  assert.equal(shared.events.filter(event => event.type === "start").length, 1);
  assert.equal(shared.remainingMs, 15000);
  assert.equal(shared.phase, "playing");
  assert.equal(shared.current, "P2");
  assert.equal(shared.starter, read(guest).starter);
  assert.deepEqual(shared.players[0].statuses, [{ name: "후공 보너스", remaining: 1 }]);
  assert.deepEqual(shared.players[1].statuses, []);
  assert.equal(shared.version, read(guest).version);
  assert.equal(read(host, shared.version), null);
  assert.throws(() => rooms.join(code), { code: "ROOM_FULL" });
  assert.throws(() => rooms.read(code, "bad-token"), { code: "UNAUTHORIZED" });
});

test("an opponent receives no hand, pending placement, preview, draw or deck order", () => {
  const { rooms, host, code, read, action, start } = setUp();
  const guest = start();
  const live = rooms.items.get(code).match;
  live.p2.hand[0] = cards.find(card => card.id === "ice-pack");

  for (const [client, ownIndex] of [[host, 0], [guest, 1]]) {
    const { players } = read(client);
    assert.equal(players[ownIndex].hand.length, 4);
    const opponent = players[1 - ownIndex];
    for (const key of ["hand", "pending", "preview", "deck", "discard"]) assert.equal(Object.hasOwn(opponent, key), false);
  }

  assert.equal(action(guest, "stage", { index: 0 }).players[1].pending.card, "ice-pack");
  assert.equal(read(host).players[0].temp, 36.5);
  assert.equal(Object.hasOwn(read(host).players[1], "pending"), false);
  assert.equal(read(host).events.some(event => event.card === "ice-pack"), false);

  action(guest, "confirm");
  const hostView = read(host);
  assert.equal(hostView.players[0].temp, 33);
  assert.deepEqual(hostView.players[1].usedThisTurn, ["ice-pack"]);
  assert.equal(hostView.events.some(event => event.type === "draw"), false);
  assert.equal(read(guest).events.some(event => event.type === "draw"), true);
});

test("a guest's swapped preview survives a fresh snapshot until their next draw", () => {
  const { rooms, host, code, read, action, start } = setUp();
  const guest = start();
  const player = rooms.items.get(code).match.p2;
  const byId = id => cards.find(card => card.id === id);
  player.hand = ["swap", "mint-candy", "fan", "ice-cream"].map(byId);
  player.deck = ["ice-bottle", "water-gun", "shaved-ice"].map(byId);
  action(guest, "stage", { index: 0 });
  const swapped = action(guest, "confirm");
  assert.equal(swapped.players[1].preview, "shaved-ice");
  assert.equal(swapped.players[1].hand[0], null);
  assert.deepEqual(player.deck.map(card => card.id), ["shaved-ice", "water-gun", "ice-bottle"]);
  assert.equal(swapped.events.some(e => e.type === "draw"), false);
  assert.equal(read(guest).players[1].preview, "shaved-ice");
  const opponent = read(host);
  assert.equal(Object.hasOwn(opponent.players[1], "preview"), false);
  assert.equal(opponent.events.some(e => e.type === "swap"), false);
  action(guest, "stage", { index: 1 });
  const drawn = action(guest, "confirm");
  assert.equal(drawn.players[1].hand[1], "shaved-ice");
  assert.equal(drawn.players[1].preview, "water-gun");
  assert.deepEqual(player.deck.map(card => card.id), ["water-gun", "ice-bottle"]);
  assert.equal(drawn.events.find(e => e.type === "draw").fromSwap, true);
  assert.equal(read(host).events.some(e => e.type === "draw"), false);
});

test("the host cannot control the guest turn or replay stale action revisions", () => {
  const { rooms, host, code, read, action, start } = setUp();
  const guest = start();
  assert.throws(() => action(host, "pass"), { code: "OPPONENT_TURN" });
  const prior = read(guest).actionVersion;
  const live = rooms.items.get(code).match;
  live.p2.hand[0] = cards.find(card => card.id === "ice-pack");
  action(guest, "stage", { index: 0 }, prior);
  assert.throws(() => action(guest, "confirm", {}, prior), { code: "STALE_ACTION" });
  assert.throws(() => action(guest, "pass"), { code: "INVALID_ACTION" });
  action(guest, "cancel");
  assert.equal(read(guest).players[1].pending, null);
  action(guest, "pass");
  assert.equal(read(host).current, "P1");
});

test("staging leaves the timer intact and expiry confirms on the server", () => {
  const { rooms, host, code, tick, read, action, start } = setUp();
  const guest = start();
  rooms.items.get(code).match.p2.hand[0] = cards.find(card => card.id === "ice-pack");
  const actionMs = SETTINGS.secondsPerAction * 1000;
  tick(actionMs - 500);
  const staged = action(guest, "stage", { index: 0 });
  assert.equal(staged.remainingMs, 500);
  tick(499);
  assert.equal(read(host).players[0].temp, 36.5);
  tick(1);
  const after = read(host);
  assert.equal(after.players[0].temp, 33);
  assert.equal(after.remainingMs, actionMs);
  assert.equal(after.events.find(event => event.type === "timeout").card, "ice-pack");
  assert.throws(() => action(guest, "confirm", {}, staged.actionVersion), { code: "STALE_ACTION" });
});

test("leaving a waiting room closes it and leaving a live game awards a forfeit win", () => {
  const waiting = setUp();
  waiting.rooms.leave(waiting.code, waiting.host.token);
  assert.throws(() => waiting.rooms.join(waiting.code), { code: "ROOM_MISSING" });
  const { rooms, host, code, read, start } = setUp();
  const guest = start();
  rooms.leave(code, guest.token);
  const result = read(host);
  assert.equal(result.phase, "finished");
  assert.equal(result.winner, "P1");
  assert.equal(result.remainingMs, null);
  assert.equal(result.events.at(-1).forfeited, "P2");
});

test("room watchers wake on updates, keep private events hidden and expire when idle", async () => {
  const { rooms, host, code, read, action, tick, start } = setUp();
  const signal = new AbortController().signal;
  const waiting = rooms.watch(code, host.token, host.state.version, 0, signal);
  const guest = rooms.join(code);
  assert.equal((await waiting).phase, "lobby");
  start(guest);
  const initial = read(host);
  const cursor = initial.events.at(-1).id;
  const watching = rooms.watch(code, host.token, initial.version, cursor, signal);
  rooms.items.get(code).match.p2.hand[0] = cards.find(card => card.id === "ice-pack");
  action(guest, "stage", { index: 0 });
  const staged = await watching;
  assert.deepEqual(staged.events, []);
  assert.equal(Object.hasOwn(staged.players[1], "pending"), false);

  const confirmed = rooms.watch(code, host.token, staged.version, cursor, signal);
  action(guest, "confirm");
  const update = await confirmed;
  assert.equal(update.players[0].temp, 33);
  assert.ok(update.events.some(event => event.card === "ice-pack"));
  assert.ok(update.events.every(event => event.id > cursor && event.type !== "draw"));
  assert.equal(read(host).version, update.version);

  const idle = rooms.watch(code, host.token, update.version, cursor, signal);
  assert.equal(await rooms.watch(code, host.token, update.version, cursor, signal), null);
  tick(4500);
  assert.equal(await idle, null);
});

test("a guest can leave before ready, and their replacement starts with fresh ready states", () => {
  const { rooms, host, code, read, ready } = setUp();
  const guest = rooms.join(code);
  const lobbyId = guest.state.lobbyId;
  ready(host);
  rooms.leave(code, guest.token);
  assert.equal(read(host).phase, "waiting");
  assert.deepEqual(read(host).ready, [false, false]);
  assert.throws(() => read(guest), { code: "UNAUTHORIZED" });
  const next = rooms.join(code);
  assert.notEqual(next.state.lobbyId, lobbyId);
  assert.throws(() => ready(host, true, lobbyId), { code: "STALE_ACTION" });
  assert.deepEqual(ready(next).ready, [false, true]);
  assert.equal(read(host).phase, "lobby");
});

test("emotes are rate limited and do not invalidate card actions or reset the clock", () => {
  const { rooms, host, code, read, action, start, tick } = setUp();
  const guest = start();
  const game = rooms.find(code).match;
  game.p2.hand[0] = cards.find(card => card.id === "ice-pack");
  const before = action(guest, "stage", { index: 0 });
  tick(500);
  const emitted = action(host, "emote", { emote: "wave" });
  assert.equal(emitted.actionVersion, before.actionVersion);
  assert.equal(emitted.remainingMs, before.remainingMs - 500);
  assert.deepEqual(read(guest).events.at(-1), { id: emitted.events.at(-1).id, type: "emote", from: "P1", emote: "wave" });
  assert.throws(() => action(host, "emote", { emote: "nice" }), { code: "EMOTE_COOLDOWN" });
  assert.throws(() => action(guest, "emote", { emote: "custom" }), { code: "INVALID_ACTION" });
  action(guest, "confirm", {}, before.actionVersion);
  assert.equal(read(host).players[0].temp, 33);
  tick(1200);
  assert.equal(action(host, "emote", { emote: "laugh" }).events.at(-1).emote, "laugh");
  assert.equal(action(guest, "emote", { emote: "dislike" }).events.at(-1).emote, "dislike");
});

test("leaving or canceling a long poll releases the room's listener", async () => {
  const { rooms, host, code } = setUp();
  const controller = new AbortController();
  const watch = rooms.watch(code, host.token, host.state.version, 0, controller.signal);
  controller.abort();
  assert.equal(await watch, null);
  assert.equal(rooms.items.get(code).listeners.size, 0);
  const waiting = rooms.watch(code, host.token, host.state.version, 0, new AbortController().signal);
  const dropped = assert.rejects(waiting, { code: "ROOM_MISSING" });
  rooms.leave(code, host.token);
  await dropped;
});
