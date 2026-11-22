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
  const action = (client, type, detail = {}, version = read(client).version) => rooms.action(code, client.token, { type, version, ...detail });
  return { rooms, host, code, tick, read, action };
}

test("both clients observe the storm before the next action clock starts", () => {
  const { rooms, code, host, tick, read, action } = setUp();
  const guest = rooms.join(code);
  for (let i = 0; i < 5; i++) action(i % 2 ? host : guest, "pass");
  assert.equal(read(host).turn, 2);
  assert.equal(read(host).storm, null);
  const startingTemps = [38, 36.5];
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
  assert.deepEqual(read(host).players.map(player => player.temp), [36, 34.5]);
  assert.throws(() => action(guest, "pass"), { code: "MATCH_UNAVAILABLE" });
  tick(1499);
  assert.equal(read(host).storm, "active");
  tick(1);
  assert.equal(read(guest).storm, null);
  assert.equal(read(guest).remainingMs, 15000);
  rooms.close();
});

test("one invitation seats two players and starts their shared match", () => {
  const { rooms, host, code, read } = setUp();
  assert.match(code, /^[2-9A-HJ-NP-Z]{6}$/);
  assert.equal(host.state.phase, "waiting");
  assert.throws(() => rooms.join("AAAAA1"), { code: "ROOM_MISSING" });
  const guest = rooms.join(code);
  assert.notEqual(host.token, guest.token);
  assert.equal(guest.state.side, "P2");
  const shared = read(host);
  assert.equal(shared.phase, "playing");
  assert.equal(shared.current, "P2");
  assert.equal(shared.starter, guest.state.starter);
  assert.equal(shared.version, guest.state.version);
  assert.equal(read(host, shared.version), null);
  assert.throws(() => rooms.join(code), { code: "ROOM_FULL" });
  assert.throws(() => rooms.read(code, "bad-token"), { code: "UNAUTHORIZED" });
});

test("an opponent receives no hand, pending placement, preview, draw or deck order", () => {
  const { rooms, host, code, read, action } = setUp();
  const guest = rooms.join(code);
  const live = rooms.items.get(code).match;
  live.p2.hand[0] = cards.find(card => card.id === "ice-pack");

  for (const [client, ownIndex] of [[host, 0], [guest, 1]]) {
    const { players } = read(client);
    assert.equal(players[ownIndex].hand.length, 4);
    const opponent = players[1 - ownIndex];
    for (const key of ["hand", "pending", "preview", "deck", "discard"]) assert.equal(Object.hasOwn(opponent, key), false);
  }

  assert.equal(action(guest, "stage", { index: 0 }).players[1].pending.card, "ice-pack");
  assert.equal(read(host).players[0].temp, 38);
  assert.equal(Object.hasOwn(read(host).players[1], "pending"), false);
  assert.equal(read(host).events.some(event => event.card === "ice-pack"), false);

  action(guest, "confirm");
  const hostView = read(host);
  assert.equal(hostView.players[0].temp, 34.5);
  assert.deepEqual(hostView.players[1].usedThisTurn, ["ice-pack"]);
  assert.equal(hostView.events.some(event => event.type === "draw"), false);
  assert.equal(read(guest).events.some(event => event.type === "draw"), true);
});

test("the host cannot control the guest turn or replay stale action revisions", () => {
  const { rooms, host, code, read, action } = setUp();
  const guest = rooms.join(code);
  assert.throws(() => action(host, "pass"), { code: "OPPONENT_TURN" });
  const prior = read(guest).version;
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
  const { rooms, host, code, tick, read, action } = setUp();
  const guest = rooms.join(code);
  rooms.items.get(code).match.p2.hand[0] = cards.find(card => card.id === "ice-pack");
  const actionMs = SETTINGS.secondsPerAction * 1000;
  tick(actionMs - 500);
  const staged = action(guest, "stage", { index: 0 });
  assert.equal(staged.remainingMs, 500);
  tick(499);
  assert.equal(read(host).players[0].temp, 38);
  tick(1);
  const after = read(host);
  assert.equal(after.players[0].temp, 34.5);
  assert.equal(after.remainingMs, actionMs);
  assert.equal(after.events.find(event => event.type === "timeout").card, "ice-pack");
  assert.throws(() => action(guest, "confirm", {}, staged.version), { code: "STALE_ACTION" });
});

test("leaving a waiting room closes it and leaving a live game awards a forfeit win", () => {
  const waiting = setUp();
  waiting.rooms.leave(waiting.code, waiting.host.token);
  assert.throws(() => waiting.rooms.join(waiting.code), { code: "ROOM_MISSING" });
  const { rooms, host, code, read } = setUp();
  const guest = rooms.join(code);
  rooms.leave(code, guest.token);
  const result = read(host);
  assert.equal(result.phase, "finished");
  assert.equal(result.winner, "P1");
  assert.equal(result.remainingMs, null);
  assert.equal(result.events.at(-1).forfeited, "P2");
});

test("room watchers wake on updates, keep private events hidden and expire when idle", async () => {
  const { rooms, host, code, read, action, tick } = setUp();
  const signal = new AbortController().signal;
  const waiting = rooms.watch(code, host.token, host.state.version, 0, signal);
  const guest = rooms.join(code);
  const initial = await waiting;
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
  assert.equal(update.players[0].temp, 34.5);
  assert.ok(update.events.some(event => event.card === "ice-pack"));
  assert.ok(update.events.every(event => event.id > cursor && event.type !== "draw"));
  assert.equal(read(host).version, update.version);

  const idle = rooms.watch(code, host.token, update.version, cursor, signal);
  assert.equal(await rooms.watch(code, host.token, update.version, cursor, signal), null);
  tick(4500);
  assert.equal(await idle, null);
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

