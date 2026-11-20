'use strict';

const assert = require('node:assert/strict');
const { test } = require('node:test');
const { Match, cards, maxActions, legalCard, temperatureDelta, blizzardDamage, chooseCard } = require('../rules.js');
const card = id => cards.find(item => item.id === id);

function start(starter = 'P1', random = () => 0.42) {
  const events = [];
  const match = new Match({ starter, random, onEvent: event => events.push(event) });
  match.start();
  return { match, events };
}

function play(match, id) {
  match.currentPlayer.hand[0] = card(id);
  assert.equal(match.stage(0), true);
  return match.confirm();
}

test('both players start with the same 80-card pool and four distinct cards', () => {
  const { match } = start();
  assert.equal(cards.length, 32);
  assert.equal(cards.filter(item => item.type === '체온 상승').reduce((total, item) => total + item.copies, 0), 24);
  for (const player of match.players) {
    assert.equal(player.temp, 36.5);
    assert.equal(player.deck.length, 76);
    assert.equal(new Set(player.hand.map(item => item.id)).size, 4);
  }
});

test('placement is reversible, confirmation uses exactly one action and refills the previewed card', () => {
  const { match } = start();
  const { p1, p2 } = match;
  p1.hand[1] = card('ice-pack');
  assert.equal(match.stage(-1), false);
  assert.equal(match.stage(1.5), false);
  assert.equal(match.stage(1), true);
  const preview = match.preview(p1);
  assert.equal(match.finishTurn(), false);
  assert.equal(match.stage(2), false);
  assert.equal(p2.temp, 36.5);
  assert.equal(match.cancel(), true);
  assert.equal(p1.hand[1].id, 'ice-pack');
  assert.equal(match.stage(1), true);
  match.confirm();
  assert.equal(p2.temp, 33);
  assert.equal(p1.actionsUsed, 1);
  assert.equal(p1.hand[1], preview);
  assert.equal(p1.discard[0].id, 'ice-pack');
  assert.equal(match.confirm(), null);
});

test('a second-player action limit survives the round boundary until the target plays', () => {
  for (const starter of ['P1', 'P2']) {
    const { match } = start(starter);
    match.finishTurn();
    assert.notEqual(match.current, starter);
    play(match, 'turn-control');
    match.finishTurn();
    assert.equal(match.turn, 1);
    assert.equal(match.current, starter);
    assert.equal(maxActions(match.currentPlayer), 1);
    play(match, 'mint-candy');
    assert.notEqual(match.current, starter);
    assert.equal(maxActions(match.opponentOf(match.currentPlayer)), 2);
  }
});

test('Heat Pack and Electric Fan each trigger on three target turns', () => {
  for (const starter of ['P1', 'P2']) {
    for (const [id, name, target] of [['heat-pack', '핫팩', 'self'], ['electric-fan', '선풍기', 'opponent']]) {
      const { match, events } = start(starter);
      const owner = match.currentPlayer;
      const affected = target === 'self' ? owner : match.opponentOf(owner);
      play(match, id);
      assert.equal(events.filter(event => event.reason === name).length, 0);
      for (let turn = 0; turn < 8 && !match.gameOver; turn++) match.finishTurn();
      const ticks = events.filter(event => event.type === 'temperature' && event.reason === name);
      assert.equal(ticks.length, 3);
      assert.ok(ticks.every(event => event.player === affected && event.delta === (target === 'self' ? 1 : -1)));
    }
  }
});

test('refreshing a status preserves its expiry or extends it without stacking', () => {
  const { match } = start();
  match.applyStatus(match.p2, '몸살', 2);
  match.applyStatus(match.p2, '몸살', 1);
  assert.equal(match.p2.statuses.length, 1);
  assert.equal(match.p2.statuses[0].remaining, 2);
  match.finishTurn();
  match.finishTurn();
  assert.equal(match.p2.statuses[0].remaining, 1);
  match.applyStatus(match.p2, '몸살', 2);
  assert.equal(match.p2.statuses[0].remaining, 2);
});

test('recovery lock covers heating cards, the heater and Heat Pack, and cleansing removes the oldest debuff', () => {
  const { match } = start();
  match.applyStatus(match.p1, '동상', 2);
  match.applyStatus(match.p1, '회복 제한', 1);
  for (const id of ['hot-chocolate', 'hot-air-blower', 'heat-pack']) {
    assert.match(legalCard(match.p1, card(id)), /회복 제한/);
  }
  assert.equal(legalCard(match.p1, card('swap')), '');
  play(match, 'tylenol');
  assert.deepEqual(match.p1.statuses.map(status => status.name), ['회복 제한']);
});

test('expiry confirms the selected card, chooses a legal unselected card, or passes a blocked hand', () => {
  const { match, events } = start();
  match.p1.hand = [card('mint-candy'), card('hot-air-blower'), card('hot-chocolate'), card('tylenol')];
  match.stage(0);
  match.timeOut();
  assert.equal(match.p2.temp, 35);
  assert.equal(match.p1.pending, null);
  assert.equal(match.p1.actionsUsed, 1);
  match.p1.hand = [card('shaved-ice'), card('udon'), card('heat-pack'), card('hot-chocolate')];
  match.applyStatus(match.p1, '회복 제한', 1);
  match.timeOut();
  assert.equal(match.current, 'P2');
  assert.equal(events.filter(event => event.type === 'timeout').length, 2);

  const blocked = start().match;
  blocked.p1.hand = [card('heat-pack'), card('hot-air-blower'), card('udon'), card('hot-chocolate')];
  blocked.applyStatus(blocked.p1, '회복 제한', 1);
  blocked.timeOut();
  assert.equal(blocked.current, 'P2');
  assert.equal(blocked.p1.actionsUsed, 0);
});

test('swap moves the actual draw candidate to the bottom, draws a different card, and costs no action', () => {
  const { match } = start();
  match.p1.hand = [card('swap'), card('steamed-bun'), card('mint-candy'), card('heat-pack')];
  match.p1.deck = [card('mint-candy'), card('ice-pack'), card('cooling-spray')];
  assert.equal(match.stage(0), true);
  assert.equal(match.preview(match.p1).id, 'ice-pack');
  match.confirm();
  assert.equal(match.p1.hand[0].id, 'cooling-spray');
  assert.equal(match.p1.deck.at(-1).id, 'ice-pack');
  assert.equal(match.p1.actionsUsed, 0);
});

test('refill avoids an all-conditional hand even when the only playable option is a duplicate', () => {
  const { match } = start();
  match.p1.hand = [card('mint-candy'), card('steamed-bun'), card('udon'), card('tylenol')];
  match.p1.deck = [card('hot-chocolate'), card('mint-candy')];
  match.stage(0);
  assert.equal(match.preview(match.p1).id, 'mint-candy');
  match.confirm();
  assert.equal(match.p1.hand[0].id, 'mint-candy');
});

test('blizzard cadence, cap, simultaneous result and symmetric rounding', () => {
  const { match, events } = start();
  assert.deepEqual(Array.from({ length: 6 }, (_, i) => blizzardDamage(i + 1)), [2, 3, 4, 5, 5, 5]);
  match.applyStatus(match.p1, '옷 파손', 2);
  assert.equal(temperatureDelta(match.p1, -1), -1.5);
  match.applyStatus(match.p1, '몸살', 2);
  assert.equal(temperatureDelta(match.p1, -2), -3.5);
  match.p1.statuses = [];
  match.p1.temp = match.p2.temp = 27;
  for (let turn = 0; turn < 6; turn++) match.finishTurn();
  assert.equal(match.turn, 3);
  assert.equal(match.blizzardCount, 1);
  assert.equal(match.p1.temp, 25);
  assert.equal(match.p2.temp, 25);
  assert.equal(match.winner, 'DRAW');
  assert.equal(events.filter(event => event.type === 'result').length, 1);
});

test('overheat reports the resulting temperature, and AI avoids a lethal self-hit', () => {
  const { match, events } = start('P2');
  match.p2.temp = 39;
  play(match, 'udon');
  assert.equal(match.p2.temp, 39.5);
  assert.ok(events.some(event => event.type === 'temperature' && event.delta === 0.5));
  assert.deepEqual(match.p2.statuses.map(status => status.name), ['몸살', '실명']);
  match.p2.temp = 25.5;
  match.p1.temp = 36.5;
  match.p2.hand = [card('ice-bottle'), card('ice-pack'), card('water-gun'), card('udon')];
  assert.equal(chooseCard(match), 3);
});

