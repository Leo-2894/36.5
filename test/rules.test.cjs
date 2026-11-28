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

test('AI saves its last action for recovery when the next blizzard would be fatal', () => {
  const { match } = start();
  match.turn = 2;
  match.finishTurn();
  match.p1.temp = 33;
  match.p2.temp = 26.5;
  match.p2.actionsUsed = 1;
  match.p2.hand = ['ice-pack', 'roasted-chestnuts', 'mint-candy', 'tylenol'].map(card);
  const best = chooseCard(match);
  assert.equal(match.p2.hand[best].id, 'roasted-chestnuts');
  assert.equal(match.p2.temp, 26.5);
  assert.equal(match.blizzardCount, 0);
  match.stage(best);
  match.confirm();
  assert.equal(match.p2.temp, 26);
  assert.equal(match.gameOver, false);
});

test('AI still takes a guaranteed win before the blizzard', () => {
  const { match } = start();
  match.turn = 2;
  match.finishTurn();
  match.p1.temp = 27;
  match.p2.temp = 26.5;
  match.p2.actionsUsed = 1;
  match.p2.hand = ['ice-pack', 'roasted-chestnuts', 'water-gun', 'hot-air-blower'].map(card);
  assert.equal(chooseCard(match), 0);
});

test('both players start with the same 80-card pool and four distinct cards', () => {
  const { match } = start();
  assert.equal(cards.length, 32);
  assert.equal(card('torn-coat'), undefined);
  assert.equal(card('clothing-damage').status, '옷 파손');
  assert.equal(cards.filter(item => item.type === '체온 상승').reduce((total, item) => total + item.copies, 0), 24);
  for (const player of match.players) {
    assert.equal(player.temp, 36.5);
    assert.equal(player.deck.length, 76);
    assert.equal(new Set(player.hand.map(item => item.id)).size, 4);
  }
});

test('the reduced water gun deck replaces the same one copy for both players', () => {
  for (const [roll, waterGunCopies] of [[0.249, 1], [0.25, 2]]) {
    const { match } = start('P1', () => roll);
    for (const { deck, hand } of match.players) {
      const pool = [...deck, ...hand];
      assert.equal(pool.length, 80);
      assert.equal(pool.filter(card => card.id === 'water-gun').length, waterGunCopies);
      assert.equal(pool.filter(card => card.id === 'iced-americano').length, 4 - waterGunCopies);
    }
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

test('Ice Bucket applies shorter frostbite to its user', () => {
  const { match } = start();
  play(match, 'ice-bucket');
  assert.equal(match.p1.statuses.find(status => status.name === '동상').remaining, 1);
  assert.equal(match.p2.statuses.find(status => status.name === '동상').remaining, 2);
});

test('refreshing a status preserves its expiry or extends it without stacking', () => {
  const { match } = start();
  match.applyStatus(match.p2, '몸살', 2);
  match.applyStatus(match.p2, '몸살', 1);
  const fever = () => match.p2.statuses.find(status => status.name === '몸살');
  assert.equal(match.p2.statuses.filter(status => status.name === '몸살').length, 1);
  assert.equal(fever().remaining, 2);
  match.finishTurn();
  match.finishTurn();
  assert.equal(fever().remaining, 1);
  match.applyStatus(match.p2, '몸살', 2);
  assert.equal(fever().remaining, 2);
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

test('swap moves the new card to the top of the deck until the next draw', () => {
  const { match, events } = start();
  match.p1.hand = [card('swap'), card('steamed-bun'), card('mint-candy'), card('heat-pack')];
  match.p1.deck = ['mint-candy', 'ice-pack', 'ice-bottle', 'half-and-half', 'hot-chocolate', 'udon', 'tylenol', 'cooling-spray'].map(card);
  match.p1.temp = 37.5;
  const otherCards = match.p1.hand.slice(1);
  const reorderedDeck = ['cooling-spray', 'mint-candy', 'ice-bottle', 'half-and-half', 'hot-chocolate', 'udon', 'tylenol', 'ice-pack'].map(card);
  assert.equal(match.canSwap(match.p1), true);
  assert.equal(match.stage(0), true);
  assert.equal(match.preview(match.p1).id, 'ice-pack');
  match.confirm();
  assert.deepEqual(match.p1.hand, [null, ...otherCards]);
  assert.deepEqual(match.p1.discard, [card('swap')]);
  assert.deepEqual(match.p1.deck, reorderedDeck);
  assert.equal(events.some(event => event.type === 'draw'), false);
  assert.equal(match.p1.actionsUsed, 0);
  const event = events.find(item => item.type === 'swap');
  assert.equal(event.previousCard, 'ice-pack');
  assert.equal(event.replacementCard, 'cooling-spray');
  assert.equal(match.preview(match.p1).id, 'cooling-spray');
  assert.equal(match.stage(2), true);
  assert.equal(match.cancel(), true);
  assert.equal(match.preview(match.p1).id, 'cooling-spray');
  assert.equal(match.stage(1), true);
  assert.equal(match.preview(match.p1).id, 'cooling-spray');
  match.confirm();
  assert.equal(match.p1.hand[1].id, 'cooling-spray');
  assert.deepEqual(match.p1.deck, reorderedDeck.slice(1));
  const draws = events.filter(event => event.type === 'draw');
  assert.equal(draws.length, 1);
  assert.equal(draws[0].fromSwap, true);
  assert.equal(match.preview(match.p1).id, 'ice-bottle');
});

test('swap can promote a card already ahead of the previous candidate without changing the other cards', () => {
  const { match } = start();
  const owner = match.p1;
  owner.hand = ['swap', 'mint-candy', 'fan', 'ice-cream'].map(card);
  owner.deck = ['mint-candy', 'ice-bottle', 'water-gun', 'hot-chocolate'].map(card);
  assert.equal(match.preview(owner).id, 'ice-bottle');
  assert.equal(match.stage(0), true);
  match.confirm();
  assert.deepEqual(owner.deck.map(c => c.id), ['mint-candy', 'water-gun', 'hot-chocolate', 'ice-bottle']);
  assert.equal(match.preview(owner).id, 'mint-candy');
  assert.equal(match.stage(2), true);
  match.confirm();
  assert.equal(owner.hand[2].id, 'mint-candy');
  assert.deepEqual(owner.deck.map(c => c.id), ['water-gun', 'hot-chocolate', 'ice-bottle']);
});

test('a staged swap preserves the visible candidate and passing delivers the reservation at next turn refill', () => {
  const { match, events } = start('P2');
  const owner = match.p2;
  owner.hand = ['swap', 'steamed-bun', 'tylenol', 'heat-pack'].map(card);
  owner.deck = ['hot-chocolate', 'ice-bucket', 'shaved-ice'].map(card);
  assert.equal(match.preview(owner).id, 'hot-chocolate');
  match.stage(0);
  assert.equal(match.preview(owner).id, 'hot-chocolate');
  match.cancel();
  assert.equal(match.preview(owner).id, 'hot-chocolate');
  assert.deepEqual(owner.discard, []);
  match.stage(0);
  match.confirm();
  assert.equal(match.preview(owner).id, 'shaved-ice');
  match.finishTurn();
  assert.equal(match.preview(owner).id, 'shaved-ice');
  assert.equal(owner.hand[0], null);
  match.finishTurn();
  assert.equal(owner.hand[0].id, 'shaved-ice');
  assert.equal(match.preview(owner).id, 'ice-bucket');
  assert.equal(events.filter(e => e.type === 'draw' && e.fromSwap).length, 1);
});

test('swap stays in hand when the deck has no eligible alternative', () => {
  const { match } = start();
  match.p1.hand = [card('swap'), card('clothes'), card('mint-candy'), card('heat-pack')];
  match.p1.deck = ['ice-pack', 'ice-pack', 'ice-bucket', 'hot-air-blower', 'roasted-chestnuts', 'cup-noodles'].map(card);
  match.applyStatus(match.p1, '회복 제한', 1);
  const deckBefore = [...match.p1.deck];
  assert.equal(match.canSwap(match.p1), false);
  assert.match(legalCard(match.p1, card('swap')), /조건에 맞는 교체 카드/);
  assert.equal(match.stage(0), false);
  assert.equal(match.p1.hand[0].id, 'swap');
  assert.deepEqual(match.p1.deck, deckBefore);
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

test('the second player gets extra direct cooling only on their opening turn', () => {
  for (const starter of ['P1', 'P2']) {
    const { match } = start(starter);
    const first = match.currentPlayer;
    const second = match.opponentOf(first);
    play(match, 'mint-candy');
    assert.equal(second.temp, 35);
    match.finishTurn();
    play(match, 'mint-candy');
    assert.equal(first.temp, 33);
    play(match, 'hot-chocolate');
    assert.equal(second.temp, 36.5);
    assert.equal(second.statuses.some(status => status.name === '후공 보너스'), false);
    match.finishTurn();
    play(match, 'mint-candy');
    assert.equal(first.temp, 31.5);
  }
});

test('gamble cards use the advertised 25% outcome thresholds', () => {
  const effects = [
    ['half-and-half', [[0, -4], [0, -2], [0, 1], [0, 3]]],
    ['iced-americano', [[0, -3], [0, -2], [0, -1], [0, 0]]],
    ['hot-air-blower', [[0, 0], [1, 0], [2, 0], [4, 0]]],
  ];
  for (const [id, outcomes] of effects) {
    for (const [index, expected] of outcomes.entries()) {
      const { match } = start();
      match.random = () => index / 4;
      match.p1.temp = match.p2.temp = 30;
      play(match, id);
      assert.deepEqual(match.players.map(player => player.temp - 30), expected, id);
      if (id === 'hot-air-blower') {
        assert.equal(match.p1.statuses.some(status => status.name === '옷 파손'), index === 0);
      }
    }
  }
});

test('water gun has a 50% chance to cool either target by the same amount', () => {
  for (const [roll, expected] of [[0.499, [31.5, 36.5]], [0.5, [36.5, 31.5]]]) {
    const { match } = start();
    match.finishTurn();
    match.random = () => roll;
    play(match, 'water-gun');
    assert.deepEqual(match.players.map(player => player.temp), expected);
  }
});

test('temperature modifiers add within the 25% and 50% steps', () => {
  const status = (...names) => names.map(name => ({ name }));
  const cooling = (...names) => temperatureDelta({ statuses: status(...names) }, -4);
  const warming = (temp, ...names) => temperatureDelta({ temp, statuses: status(...names) }, 4);

  assert.equal(cooling('보온'), -3);
  assert.equal(cooling('옷 파손'), -5);
  assert.equal(cooling('보온', '옷 파손'), -4);
  assert.equal(cooling('보온', '몸살'), -5);
  assert.equal(cooling('옷 파손', '몸살'), -6);
  assert.equal(warming(36.5, '몸살'), 3);
  assert.equal(warming(36.5, '동상', '몸살'), 2);
  assert.equal(warming(38.5, '동상', '몸살'), 2);
});

test('clothes cuts incoming cooling by 25% and still lasts for two owner turns', () => {
  const { match } = start();
  play(match, 'clothes');
  assert.equal(temperatureDelta(match.p1, -4), -3);
  assert.equal(blizzardDamage(match.p1), 4);
  match.finishTurn();
  match.finishTurn();
  assert.equal(match.p1.statuses.find(s => s.name === '보온').remaining, 2);
  match.finishTurn();
  match.finishTurn();
  assert.equal(match.p1.statuses.find(s => s.name === '보온').remaining, 1);
  match.finishTurn();
  assert.equal(temperatureDelta(match.p1, -4), -4);
});

test('blizzard cadence, temperature scaling, caps and simultaneous result', () => {
  const { match, events } = start();
  assert.deepEqual([25, 26, 32, 36.5, 38, 40].map(temp => blizzardDamage({ temp, statuses: [] })), [1.5, 1.5, 3.5, 5, 5.5, 5.5]);
  assert.equal(blizzardDamage({ temp: 26, statuses: [{ name: '보온' }] }), 1.5);
  assert.equal(blizzardDamage({ temp: 38, statuses: [{ name: '몸살' }] }), 5.5);
  match.applyStatus(match.p1, '옷 파손', 2);
  assert.equal(temperatureDelta(match.p1, -1), -1.5);
  match.applyStatus(match.p1, '몸살', 2);
  assert.equal(temperatureDelta(match.p1, -2), -3);
  match.p1.statuses = [];
  match.p1.temp = match.p2.temp = 26.5;
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

