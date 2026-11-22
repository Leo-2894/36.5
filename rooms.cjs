"use strict";

const { randomBytes, randomInt } = require("node:crypto");
const { Match, SETTINGS, hasStatus } = require("./rules.js");

const codeAlphabet = "23456789ABCDEFGHJKLMNPQRSTUVWXYZ";
const codePattern = /^[2-9A-HJ-NP-Z]{6}$/;
const sideNames = ["P1", "P2"];
const maxRooms = 128;
const waitLifetime = 30 * 60_000;
const matchLifetime = 2 * 60 * 60_000;
const resultLifetime = 15 * 60_000;

class RoomError extends Error {
  constructor(status, code) {
    super(code);
    this.status = status;
    this.code = code;
  }
}

class Rooms {
  constructor({ now = () => performance.now(), schedule = setTimeout, unschedule = clearTimeout, random } = {}) {
    this.items = new Map();
    this.now = now;
    this.schedule = schedule;
    this.unschedule = unschedule;
    this.random = random ?? (() => randomInt(2 ** 32) / 2 ** 32);
  }

  clearTimer(room) {
    this.unschedule(room.timer);
    room.timer = null;
    room.deadline = null;
  }

  drop(room) {
    this.clearTimer(room);
    this.items.delete(room.code);
    this.notify(room);
  }

  sweep() {
    const now = this.now();
    for (const room of this.items.values()) {
      if (room.expiresAt <= now) this.drop(room);
    }
  }

  close() {
    for (const room of this.items.values()) this.drop(room);
  }

  create() {
    this.sweep();
    if (this.items.size >= maxRooms) throw new RoomError(503, "SERVER_FULL");
    let code;
    do {
      code = Array.from({ length: 6 }, () => codeAlphabet[randomInt(codeAlphabet.length)]).join("");
    } while (this.items.has(code));
    const token = randomBytes(24).toString("base64url");
    const room = {
      code, tokens: [token], match: null, version: 1, log: [],
      eventId: 0, timer: null, deadline: null, expiresAt: this.now() + waitLifetime, listeners: new Map(),
    };
    this.items.set(code, room);
    return { token, state: this.snapshot(room, "P1") };
  }

  find(code) {
    const room = codePattern.test(code) && this.items.get(code);
    if (room && room.expiresAt > this.now()) return room;
    if (room) this.drop(room);
    throw new RoomError(404, "ROOM_MISSING");
  }

  join(code) {
    const room = this.find(code);
    if (room.tokens.length === 2) throw new RoomError(409, "ROOM_FULL");
    const token = randomBytes(24).toString("base64url");
    room.tokens.push(token);
    room.expiresAt = this.now() + matchLifetime;
    room.match = new Match({ aiPlayer: null, random: this.random, onEvent: event => this.record(room, event) });
    room.match.start();
    this.commit(room, true);
    return { token, state: this.snapshot(room, "P2") };
  }

  authorize(code, token) {
    const room = this.find(code);
    const index = token ? room.tokens.indexOf(token) : -1;
    if (index === -1) throw new RoomError(401, "UNAUTHORIZED");
    return { room, side: sideNames[index] };
  }

  read(code, token, after, eventId = 0) {
    const { room, side } = this.authorize(code, token);
    this.expireAction(room);
    return room.version === after ? null : this.snapshot(room, side, eventId);
  }

  async watch(code, token, after, eventId, signal) {
    const state = this.read(code, token, after, eventId);
    if (state || signal.aborted) return state;
    const { room, side } = this.authorize(code, token);
    if (room.match?.gameOver || room.listeners.has(side)) return null;
    await new Promise(resolve => {
      const complete = () => {
        this.unschedule(timer);
        room.listeners.delete(side);
        signal.removeEventListener("abort", complete);
        resolve();
      };
      const timer = this.schedule(complete, 4500);
      timer?.unref?.();
      room.listeners.set(side, complete);
      signal.addEventListener("abort", complete, { once: true });
    });
    return signal.aborted ? null : this.read(code, token, after, eventId);
  }

  notify(room) {
    for (const complete of room.listeners.values()) complete();
  }

  leave(code, token) {
    const { room, side } = this.authorize(code, token);
    if (!room.match) this.drop(room);
    else if (room.match.forfeit(side === "P1" ? room.match.p1 : room.match.p2)) this.commit(room);
  }

  action(code, token, command, eventId = 0) {
    const { room, side } = this.authorize(code, token);
    this.expireAction(room);
    const match = room.match;
    if (!match || match.gameOver) throw new RoomError(409, "MATCH_UNAVAILABLE");
    if (command.version !== room.version) throw new RoomError(409, "STALE_ACTION");
    if (match.current !== side) throw new RoomError(409, "OPPONENT_TURN");

    let changed;
    switch (command.type) {
      case "stage":
        changed = match.stage(command.index);
        break;
      case "cancel":
        changed = match.cancel();
        break;
      case "confirm":
        changed = match.confirm();
        break;
      case "pass":
        if (!match.currentPlayer.pending) {
          this.record(room, { type: "pass", player: match.currentPlayer });
          changed = match.finishTurn();
        }
        break;
    }
    if (!changed) throw new RoomError(409, "INVALID_ACTION");
    this.commit(room, command.type === "confirm" || command.type === "pass");
    return this.snapshot(room, side, eventId);
  }

  expireAction(room) {
    if (room.deadline === null || this.now() < room.deadline) return;
    room.match.timeOut();
    this.commit(room, true);
  }

  commit(room, resetClock = false) {
    room.version++;
    if (room.match.gameOver) {
      this.clearTimer(room);
      room.expiresAt = this.now() + resultLifetime;
    } else if (resetClock) {
      this.clearTimer(room);
      const delay = SETTINGS.secondsPerAction * 1000;
      room.deadline = this.now() + delay;
      this.armClock(room);
    }
    this.notify(room);
  }

  armClock(room) {
      const deadline = room.deadline;
      room.timer = this.schedule(() => {
        if (room.deadline !== deadline) return;
        if (this.now() < deadline) this.armClock(room);
        else this.expireAction(room);
      }, Math.max(1, Math.ceil(deadline - this.now())));
    room.timer?.unref?.();
  }

  record(room, event) {
    const { type, player, card, status, ...details } = event;
    const entry = { ...details, type, id: ++room.eventId };
    if (player) entry.player = { name: player.name, temp: player.temp };
    if (card) entry.card = card.id;
    if (status) entry.status = { name: status.name, remaining: status.remaining };
    room.log.push(entry);
    if (room.log.length > 120) room.log.shift();
  }

  snapshot(room, side, eventId = 0) {
    const state = { code: room.code, side, version: room.version, phase: "waiting" };
    const match = room.match;
    if (!match) return state;

    return {
      ...state,
      phase: match.gameOver ? "finished" : "playing",
      turn: match.turn, blizzardCount: match.blizzardCount, current: match.current,
      starter: match.starter, winner: match.winner,
      remainingMs: room.deadline === null ? null : Math.max(0, room.deadline - this.now()),
      players: match.players.map(player => {
        const own = player.name === side;
        return {
          name: player.name, temp: player.temp, actionsUsed: player.actionsUsed,
          deckCount: player.deck.length, discardCount: player.discard.length,
          statuses: player.statuses.map(({ name, remaining }) => ({ name, remaining })),
          usedThisTurn: player.usedThisTurn.map(card => card.id),
          ...(own && {
            hand: player.hand.map(card => card?.id ?? null),
            pending: player.pending && { index: player.pending.index, card: player.pending.card.id },
            preview: hasStatus(player, "실명") ? null : match.preview(player)?.id ?? null,
          }),
        };
      }),
      events: eventId === room.eventId ? [] : room.log.filter(event => event.id > eventId &&
        ((event.type !== "draw" && event.type !== "swap") || event.player?.name === side)),
    };
  }
}

module.exports = { Rooms, RoomError, codePattern };

