"use strict";

const GameRules = (() => {
  const SETTINGS = Object.freeze({
    startTemp: 36.5,
    openingCounterDamage: 1.5,
    openingProtection: 0.5,
    lossTemp: 25,
    overheatTemp: 40,
    overheatedTemp: 39.5,
    reducedHealingTemp: 38.5,
    handSize: 4,
    actions: 2,
    secondsPerAction: 15,
    blizzardInterval: 3,
    stormDuration: 3000,
    stormImpactDelay: 1500,
    minBlizzardDamage: 1,
    maxBlizzardDamage: 5,
    blizzardMinAt: 26,
    blizzardMaxAt: 38,
    insulation: 0.25,
    tornClothes: 0.25,
    feverDamage: 0.5,
    feverHealing: 0.25,
    frostbiteHealing: 0.5,
    reducedHealing: 0.5,
    maxDamageMultiplier: 1.5,
    minHealingMultiplier: 0.5,
  });

  const emotes = Object.freeze(["wave", "nice", "cold", "fire", "laugh", "dislike"]);

  const cards = [
    { id: "hot-chocolate", name: "핫초코", type: "체온 상승", target: "self", temp: 1.5 },
    { id: "roasted-chestnuts", name: "군밤", type: "체온 상승", target: "self", temp: 1.5 },
    { id: "sweet-potato", name: "군고구마", type: "체온 상승", target: "self", temp: 2 },
    { id: "fish-shaped-bun", name: "붕어빵", type: "체온 상승", target: "self", temp: 2 },
    { id: "steamed-bun", name: "호빵", type: "체온 상승", target: "self", temp: 2 },
    { id: "cup-noodles", name: "컵라면", type: "체온 상승", target: "self", temp: 3 },
    { id: "udon", name: "우동", type: "체온 상승", target: "self", temp: 3 },
    { id: "fish-cake-soup", name: "어묵탕", type: "체온 상승", target: "self", temp: 3 },
    { id: "mint-candy", name: "박하사탕", type: "체온 저하", target: "opponent", temp: -1.5 },
    { id: "fan", name: "부채", type: "체온 저하", target: "opponent", temp: -1.5 },
    { id: "ice-cream", name: "아이스크림", type: "체온 저하", target: "opponent", temp: -2 },
    { id: "handheld-fan", name: "손선풍기", type: "체온 저하", target: "opponent", temp: -2 },
    { id: "smoothie", name: "스무디", type: "체온 저하", target: "opponent", temp: -2 },
    { id: "shaved-ice", name: "빙수", type: "체온 저하", target: "opponent", temp: -3 },
    { id: "cooling-spray", name: "쿨링 스프레이", type: "체온 저하", target: "opponent", temp: -3 },
    { id: "ice-pack", name: "아이스팩", type: "체온 저하", target: "opponent", temp: -3.5, copies: 2 },
    { id: "half-and-half", name: "반반팩", type: "복불복", target: "opponent", outcomes: [-4, -2, 1, 3], copies: 3, desc: "상대 체온 -4, -2, +1, +3°C 중 하나 (각 25%)" },
    { id: "iced-americano", name: "아이스 아메리카노", type: "복불복", target: "opponent", outcomes: [-3, -2, -1, 0], copies: 2, desc: "상대 체온 -3, -2, -1, 0°C 중 하나 (각 25%)" },
    { id: "water-gun", name: "러시안 물총", type: "복불복", target: "random", temp: -5, copies: 2, desc: "자신과 상대 중 한 명의 체온 -5°C (각 50%, 후공 보너스 제외)" },
    { id: "hot-air-blower", name: "열풍기", type: "복불복", target: "self", outcomes: [0, 1, 2, 4], status: "옷 파손", turns: 2, chance: 0.25, copies: 2, desc: "자신 체온 0, +1, +2, +4°C 중 하나 (각 25%) · 옷 파손 2턴 (25%)" },
    { id: "ice-bottle", name: "얼음 유리병", type: "자폭", target: "both", temp: -2, copies: 2, desc: "양쪽 체온 -2°C" },
    { id: "ice-bucket", name: "아이스 버킷", type: "자폭", target: "both", status: "동상", turns: 1, copies: 2, desc: "양쪽에게 동상 1턴" },
    { id: "heat-pack", name: "핫팩", type: "효과", target: "self", status: "핫팩", periodic: 1, turns: 3, copies: 2, desc: "다음 내 차례부터 3회, 차례 시작 시 +1°C" },
    { id: "clothes", name: "옷", type: "효과", target: "self", status: "보온", turns: 2, desc: "2턴 동안 받는 체온 저하 25% 감소" },
    { id: "tylenol", name: "타이레놀", type: "효과", target: "self", removeDebuff: true, desc: "자신에게 걸린 가장 오래된 디버프 제거" },
    { id: "electric-fan", name: "선풍기", type: "효과", target: "opponent", status: "선풍기", periodic: -1, turns: 3, copies: 2, desc: "다음 상대 차례부터 3회, 차례 시작 시 -1°C" },
    { id: "frostbite-patch", name: "파스", type: "효과", target: "opponent", status: "동상", turns: 1, desc: "상대에게 동상 1턴" },
    { id: "clothing-damage", name: "옷 파손 아이템", type: "효과", target: "opponent", status: "옷 파손", turns: 2, desc: "상대에게 옷 파손 2턴" },
    { id: "swap", name: "교체 카드", type: "스페셜", target: "self", free: true, copies: 1, desc: "행동 소모 없이 다음 카드를 교체합니다. 새 후보는 덱 맨 앞에 남고, 사용한 손패 칸은 다른 카드로 보충합니다. 자폭·복불복·교체 카드와 즉시 회복량이 1.5°C 이하이거나 과열을 일으키거나 현재 사용할 수 없는 카드는 교체 후보에서 제외합니다." },
    { id: "turn-control", name: "상대 턴 통제 카드", type: "스페셜", target: "opponent", status: "행동 제한", turns: 1, copies: 1, desc: "상대의 다음 차례 행동 횟수 2회 → 1회" },
    { id: "recovery-lock", name: "회복 제한 카드", type: "스페셜", target: "opponent", status: "회복 제한", turns: 1, copies: 1, desc: "상대의 다음 차례에 회복 카드 사용 불가" },
    { id: "fever", name: "강화 디버프 카드", type: "스페셜", target: "opponent", status: "몸살", turns: 1, copies: 1, desc: "상대에게 몸살 1턴" },
  ].map(card => Object.freeze({
    copies: 3,
    desc: card.target === "self" ? "자신 체온 +" + card.temp + "°C" : "상대 체온 " + card.temp + "°C",
    ...card,
    outcomes: card.outcomes && Object.freeze(card.outcomes),
  }));
  const deckTemplate = cards.flatMap(card => Array(card.copies).fill(card));
  const reducedWaterGunDeck = [...deckTemplate];
  // Roll once for the match so both players always have the same card pool.
  reducedWaterGunDeck[deckTemplate.findIndex(card => card.id === "water-gun")] =
    cards.find(card => card.id === "iced-americano");
  const debuffs = new Set(["옷 파손", "동상", "몸살", "실명", "행동 제한", "회복 제한", "선풍기"]);
  const buffs = new Set(["보온", "핫팩", "후공 보호", "후공 보너스"]);

  const isDebuff = name => debuffs.has(name);
  const isBuff = name => buffs.has(name);
  const hasStatus = (player, name) => player.statuses.some(status => status.name === name);
  const maxActions = player => hasStatus(player, "행동 제한") ? 1 : SETTINGS.actions;
  const heals = card => card.target === "self" && (card.temp > 0 || card.outcomes?.some(amount => amount > 0) || card.periodic > 0);
  const alwaysUsable = card => card && !heals(card) && !card.removeDebuff;
  const half = amount => Math.sign(amount) * Math.round(Math.abs(amount) * 2) / 2;
  const stormPhaseMs = phase => phase === "approaching" ? SETTINGS.stormImpactDelay : SETTINGS.stormDuration - SETTINGS.stormImpactDelay;

  function shuffle(items, random) {
    const deck = [...items];
    for (let index = deck.length - 1; index > 0; index--) {
      const pick = Math.floor(random() * (index + 1));
      [deck[index], deck[pick]] = [deck[pick], deck[index]];
    }
    return deck;
  }

  function legalCard(player, card) {
    if (!card) return "이 손패 칸은 비어 있습니다.";
    if (hasStatus(player, "회복 제한") && heals(card)) return "회복 제한 상태라 회복 효과 카드를 사용할 수 없습니다.";
    if (card.removeDebuff && !player.statuses.some(status => isDebuff(status.name))) {
      return "제거할 디버프가 없어 사용할 수 없습니다.";
    }
    if (card.id === "swap" && (player.swapAvailable === false ||
      (player.deck && swapCandidates(player, player.hand.indexOf(card)).replacement === undefined))) {
      return "조건에 맞는 교체 카드가 없습니다.";
    }
    if (!card.free && player.actionsUsed >= maxActions(player)) return "이번 차례의 행동 횟수를 모두 사용했습니다.";
    return "";
  }

  function drawCandidate(player, slot, eligible) {
    const names = new Set();
    let hasUsableCard = false;
    for (let index = 0; index < player.hand.length; index++) {
      const card = player.hand[index];
      if (index === slot || !card) continue;
      names.add(card.id);
      if (alwaysUsable(card)) hasUsableCard = true;
    }
    for (const card of player.usedThisTurn) names.add(card.id);
    if (player.pending) names.add(player.pending.card.id);

    let best;
    let priority = 4;
    for (let index = 0; index < player.deck.length; index++) {
      const card = player.deck[index];
      if (eligible && !eligible(card, index)) continue;
      const rank = Number(names.has(card.id)) + (hasUsableCard || alwaysUsable(card) ? 0 : 2);
      if (rank === 0) return index;
      if (rank < priority) {
        best = index;
        priority = rank;
      }
    }
    return best;
  }

  function nextDrawIndex(player, slot) {
    return player.nextDrawReserved ? 0 : drawCandidate(player, slot);
  }

  function swapCandidates(player, slot) {
    const previous = nextDrawIndex(player, player.hand.indexOf(null));
    if (previous === undefined) return { previous, replacement: undefined };
    const skipped = player.deck[previous];
    const replacement = drawCandidate(player, slot, card => {
      if (card.id === skipped.id || card.id === "swap" || card.type === "자폭" || card.type === "복불복") return false;
      if (card.target === "self" && card.temp > 0) {
        const gain = temperatureDelta(player, card.temp);
        if (gain <= 1.5 || player.temp + gain >= SETTINGS.overheatTemp) return false;
      }
      return !legalCard(player, card);
    });
    return { previous, replacement };
  }

  function expireStatuses(player) {
    for (const status of player.statuses) {
      if (status.firstTurn <= player.turnsTaken) status.remaining--;
    }
    player.statuses = player.statuses.filter(status => status.remaining > 0);
  }

  function temperatureDelta(player, amount) {
    let factor = 1;
    if (amount < 0) {
      if (hasStatus(player, "보온")) factor -= SETTINGS.insulation;
      if (hasStatus(player, "후공 보호")) factor -= SETTINGS.openingProtection;
      if (hasStatus(player, "옷 파손")) factor += SETTINGS.tornClothes;
      if (hasStatus(player, "몸살")) factor += SETTINGS.feverDamage;
      factor = Math.min(factor, SETTINGS.maxDamageMultiplier);
    }
    if (amount > 0) {
      if (hasStatus(player, "동상")) factor -= SETTINGS.frostbiteHealing;
      if (hasStatus(player, "몸살")) factor -= SETTINGS.feverHealing;
      if (player.temp >= SETTINGS.reducedHealingTemp) factor -= SETTINGS.reducedHealing;
      factor = Math.max(factor, SETTINGS.minHealingMultiplier);
    }
    return half(amount * factor);
  }

  function blizzardDamage(player) {
    const { minBlizzardDamage, maxBlizzardDamage, blizzardMinAt, blizzardMaxAt } = SETTINGS;
    const progress = Math.min(1, Math.max(0, (player.temp - blizzardMinAt) / (blizzardMaxAt - blizzardMinAt)));
    const baseDamage = half(minBlizzardDamage + progress * (maxBlizzardDamage - minBlizzardDamage));
    const actual = -temperatureDelta(player, -baseDamage);
    return Math.min(maxBlizzardDamage, Math.max(minBlizzardDamage, actual));
  }

  function cardTemperature(user, target, amount) {
    return amount < 0 && user !== target && hasStatus(user, "후공 보너스")
      ? amount - SETTINGS.openingCounterDamage
      : amount;
  }

  class Match {
    constructor({ random = Math.random, onEvent = () => {}, starter, aiPlayer = "P2", timedStorms = false } = {}) {
      this.timedStorms = timedStorms;
      this.storm = null;
      this.stormDamage = null;
      this.random = random;
      this.onEvent = onEvent;
      this.starter = starter ?? (random() < 0.5 ? "P1" : "P2");
      const deck = random() < 0.25 ? reducedWaterGunDeck : deckTemplate;
      this.players = ["P1", "P2"].map(name => ({
        name, isAI: name === aiPlayer,
        temp: SETTINGS.startTemp,
        deck: shuffle(deck, random),
        discard: [], hand: Array(SETTINGS.handSize).fill(null), nextDrawReserved: false, handExchangeUsed: false, statuses: [],
        turnsTaken: 0, actionsUsed: 0, usedThisTurn: [], pending: null,
      }));
      this.turn = 0;
      this.blizzardCount = 0;
      this.activeIndex = this.starter === "P1" ? 0 : 1;
      this.winner = null;

      for (const player of this.players) {
        for (const index of player.hand.keys()) this.drawInto(player, index);
      }
    }

    get p1() { return this.players[0]; }
    get p2() { return this.players[1]; }
    get currentPlayer() { return this.players[this.activeIndex]; }
    get current() { return this.currentPlayer.name; }
    get gameOver() { return this.winner !== null; }
    opponentOf(player) { return player === this.p1 ? this.p2 : this.p1; }

    emit(type, detail = {}) {
      this.onEvent({ type, ...detail });
    }

    start() {
      if (this.players.some(player => player.turnsTaken > 0)) return;
      this.emit("start", { player: this.currentPlayer });
      const second = this.opponentOf(this.currentPlayer);
      this.applyStatus(second, "후공 보호", 1);
      this.applyStatus(second, "후공 보너스", 1);
      this.beginTurn();
    }

    beginTurn() {
      const player = this.currentPlayer;
      player.statuses = player.statuses.filter(status => status.name !== "후공 보호");
      player.turnsTaken++;
      player.actionsUsed = 0;
      player.usedThisTurn = [];
      for (const [slot, card] of player.hand.entries()) {
        if (!card) this.drawInto(player, slot);
      }
      for (const status of player.statuses) {
        if (status.periodic && status.firstTurn <= player.turnsTaken) {
          this.changeTemp(player, status.periodic, status.name);
        }
      }
      this.checkResult();
      if (!this.gameOver) this.emit("turn", { player });
    }

    finishTurn() {
      const player = this.currentPlayer;
      if (this.gameOver || this.storm || player.pending || player.turnsTaken === 0) return false;

      expireStatuses(player);
      this.activeIndex = 1 - this.activeIndex;
      if (this.current === this.starter) {
        this.turn++;
        for (const side of this.players) side.usedThisTurn = [];
        this.emit("round", { turn: this.turn });
        if (this.turn % SETTINGS.blizzardInterval === 0) {
          if (this.timedStorms) {
            this.storm = "approaching";
            this.emit("stormStart");
            return true;
          }
          this.blizzard();
        }
      }
      if (!this.gameOver) this.beginTurn();
      return true;
    }

    recycle(player) {
      if (player.deck.length === 0 && player.discard.length > 0) {
        player.deck = shuffle(player.discard, this.random);
        player.discard = [];
        this.emit("recycle", { player });
      }
    }

    drawInto(player, slot) {
      this.recycle(player);
      return this.deal(player, slot, nextDrawIndex(player, slot));
    }

    deal(player, slot, index) {
      const fromSwap = player.nextDrawReserved && index === 0;
      const card = index === undefined ? null : player.deck.splice(index, 1)[0];
      player.hand[slot] = card;
      if (fromSwap) player.nextDrawReserved = false;
      if (card && player.turnsTaken) this.emit("draw", { player, card, index: slot, fromSwap });
      return card;
    }

    canSwap(player) {
      const slot = player.hand.findIndex(card => card?.id === "swap");
      return slot !== -1 && swapCandidates(player, slot).replacement !== undefined;
    }

    preview(player) {
      const slot = player.pending && player.pending.card.id !== "swap" ? player.pending.index : player.hand.indexOf(null);
      return player.deck[nextDrawIndex(player, slot)] ?? null;
    }

    exchangeHand(index) {
      const player = this.currentPlayer;
      const outgoing = player.hand[index];
      if (this.gameOver || this.storm || !player.turnsTaken || player.pending || player.handExchangeUsed ||
          !Number.isInteger(index) || !outgoing || hasStatus(player, "실명")) return false;
      const next = nextDrawIndex(player, player.hand.indexOf(null));
      const incoming = player.deck[next];
      if (!incoming || incoming.id === outgoing.id) return false;
      player.handExchangeUsed = true;
      player.deck.push(outgoing);
      this.deal(player, index, next);
      this.emit("handExchange", { player });
      return true;
    }

    playableIndices(player = this.currentPlayer) {
      if (this.gameOver || this.storm || player.turnsTaken === 0) return [];
      return player.hand.flatMap((card, index) => legalCard(player, card) ? [] : [index]);
    }

    stage(index) {
      const player = this.currentPlayer;
      if (this.gameOver || this.storm || player.turnsTaken === 0 || player.pending || !Number.isInteger(index)) return false;
      const card = player.hand[index];
      if (legalCard(player, card)) return false;
      player.pending = { index, card };
      return true;
    }

    cancel() {
      const player = this.currentPlayer;
      if (this.gameOver || !player.pending) return false;
      player.pending = null;
      return true;
    }

    confirm() {
      const player = this.currentPlayer;
      if (this.gameOver || !player.pending) return null;
      const { card, index } = player.pending;
      const swap = card.id === "swap" ? swapCandidates(player, index) : null;
      if (swap && swap.replacement === undefined) return null;
      player.pending = null;
      player.hand[index] = null;
      player.usedThisTurn.push(card);
      if (!card.free) player.actionsUsed++;
      this.emit("card", { player, card });
      this.applyCard(player, card);
      if (swap) {
        const replacementIndex = swap.previous < swap.replacement ? swap.replacement - 1 : swap.replacement;
        const [previous] = player.deck.splice(swap.previous, 1);
        const [replacement] = player.deck.splice(replacementIndex, 1);
        player.deck.unshift(replacement);
        player.deck.push(previous);
        player.nextDrawReserved = true;
        this.emit("swap", { player, exchanged: true, previousCard: previous.id, replacementCard: replacement.id });
        // Leave the new preview and the card sent to the back in the deck.
        const refill = drawCandidate(player, index, (_card, position) => position > 0 && position < player.deck.length - 1);
        if (refill !== undefined) this.deal(player, index, refill);
      } else {
        this.drawInto(player, index);
      }
      player.discard.push(card);
      this.recycle(player);
      this.checkResult();

      if (!this.gameOver && player.actionsUsed >= maxActions(player)) this.finishTurn();
      return { player, card, index };
    }

    timeOut() {
      const player = this.currentPlayer;
      if (this.gameOver || this.storm || player.isAI) return;
      if (!player.pending) {
        const playable = this.playableIndices();
        const actions = playable.filter(index => !player.hand[index].free);
        const choices = actions.length ? actions : playable;
        if (!choices.length) {
          this.emit("timeoutPass", { player });
          this.finishTurn();
          return;
        }
        this.stage(choices[Math.floor(this.random() * choices.length)]);
      }
      this.emit("timeout", { player, card: player.pending.card });
      this.confirm();
    }

    applyStatus(player, name, duration, periodic = 0) {
      let status = player.statuses.find(item => item.name === name);
      const firstTurn = player.turnsTaken + 1;
      if (status) {
        // A refreshed effect retains its old expiry if that expiry is later.
        const expires = Math.max(status.firstTurn + status.remaining - 1, firstTurn + duration - 1);
        status.firstTurn = firstTurn;
        status.remaining = expires - firstTurn + 1;
      } else {
        status = { name, remaining: duration, firstTurn, periodic };
        player.statuses.push(status);
      }
      this.emit("status", { player, status });
    }

    changeTemp(player, amount, reason) {
      this.applyTemperatureDelta(player, temperatureDelta(player, amount), reason);
    }

    applyTemperatureDelta(player, delta, reason) {
      const before = player.temp;
      const next = before + delta;
      const overheated = next >= SETTINGS.overheatTemp;
      player.temp = overheated ? SETTINGS.overheatedTemp : next;
      this.emit("temperature", { player, delta: player.temp - before, reason });
      if (overheated) {
        this.emit("overheat", { player });
        this.applyStatus(player, "몸살", 2);
        this.applyStatus(player, "실명", 2);
      }
    }

    applyCard(user, card) {
      const opponent = this.opponentOf(user);
      if (card.target === "random") {
        const target = this.random() < 0.5 ? opponent : user;
        this.emit("waterGun", { player: target, caster: user.name });
        this.changeTemp(target, card.temp, card.name);
        return;
      }

      const targets = card.target === "both" ? this.players : [card.target === "self" ? user : opponent];
      const amount = card.outcomes
        ? card.outcomes[Math.floor(this.random() * card.outcomes.length)]
        : card.temp;

      for (const player of targets) {
        if (card.removeDebuff) {
          const index = player.statuses.findIndex(status => isDebuff(status.name));
          if (index !== -1) {
            const [removed] = player.statuses.splice(index, 1);
            this.emit("cure", { player, status: removed });
          }
        }
        if (amount !== undefined) this.changeTemp(player, cardTemperature(user, player, amount), card.name);
        if (card.status && (card.chance === undefined || this.random() < card.chance)) {
          const duration = player === user ? card.selfTurns ?? card.turns : card.turns;
          this.applyStatus(player, card.status, duration, card.periodic);
        }
      }
    }

    advanceStorm() {
      if (this.gameOver || !this.storm) return;
      if (this.storm === "approaching") {
        this.storm = "active";
        this.blizzard();
        return;
      }
      this.storm = null;
      this.stormDamage = null;
      this.checkResult();
      if (!this.gameOver) this.beginTurn();
    }

    blizzard() {
      const damage = Object.fromEntries(this.players.map(player => [player.name, blizzardDamage(player)]));
      if (this.storm) this.stormDamage = damage;
      this.emit("blizzard", { count: ++this.blizzardCount, damage });
      for (const player of this.players) this.applyTemperatureDelta(player, -damage[player.name], "Blizzard");
      if (!this.storm) this.checkResult();
    }

    checkResult() {
      if (this.gameOver) return;
      const both = this.players.every(player => player.temp <= SETTINGS.lossTemp);
      if (!both && this.players.every(player => player.temp > SETTINGS.lossTemp)) return;
      this.winner = this.p1.temp === this.p2.temp ? "DRAW" : this.p1.temp > this.p2.temp ? "P1" : "P2";
      this.emit("result", { winner: this.winner, both });
    }

    forfeit(player) {
      if (this.gameOver || !this.players.includes(player)) return false;
      player.pending = null;
      this.currentPlayer.pending = null;
      this.winner = this.opponentOf(player).name;
      this.emit("result", { winner: this.winner, both: false, forfeited: player.name });
      return true;
    }
  }

  function scoreCard(match, player, card) {
    const opponent = match.opponentOf(player);
    const roundsUntilBlizzard = SETTINGS.blizzardInterval - match.turn % SETTINGS.blizzardInterval;
    const urgent = player.temp <= 31 ? 1.65 : player.temp <= 34 ? 1.15 : 0.72;

    function scoreTemperature(target, amount) {
      const delta = temperatureDelta(target, amount);
      const next = target.temp + delta;
      if (next <= SETTINGS.lossTemp) return target === player ? -100 : 105;
      if (target === opponent) return -delta * (opponent.temp <= 31 ? 4.2 : 2.65);
      if (next >= SETTINGS.overheatTemp) return -6;
      return delta > 0
        ? Math.min(delta, Math.max(0, SETTINGS.reducedHealingTemp - target.temp)) * 3.1 * urgent
        : delta * urgent * 3;
    }

    if (card.free) return 8;
    if (card.target === "random") return (scoreTemperature(player, card.temp) + scoreTemperature(opponent, card.temp)) / 2;
    if (card.id === "ice-bottle") {
      const selfAfter = player.temp + temperatureDelta(player, card.temp);
      const rivalAfter = opponent.temp + temperatureDelta(opponent, cardTemperature(player, opponent, card.temp));
      if (selfAfter <= SETTINGS.lossTemp && rivalAfter <= SETTINGS.lossTemp) {
        return selfAfter > rivalAfter ? 110 : selfAfter < rivalAfter ? -105 : 2;
      }
    }
    if (card.removeDebuff) {
      const first = player.statuses.find(status => isDebuff(status.name));
      const value = { "행동 제한": 9, "몸살": 9, "선풍기": 5, "옷 파손": 5, "동상": 4, "회복 제한": 5, "실명": 0.5 };
      return value[first?.name] ?? 0;
    }

    const targets = card.target === "both" ? match.players : [card.target === "self" ? player : opponent];
    let score = 0;
    for (const target of targets) {
      if (card.outcomes) {
        for (const amount of card.outcomes) {
          score += scoreTemperature(target, cardTemperature(player, target, amount)) / card.outcomes.length;
        }
      } else if (card.temp !== undefined) {
        score += scoreTemperature(target, cardTemperature(player, target, card.temp));
      }
      if (card.status) {
        const values = {
          "보온": (4 + 2 * urgent + (roundsUntilBlizzard <= 2 ? 1.5 : 0)) * SETTINGS.insulation / 0.5,
          "동상": target.temp <= 33 ? 5 : 2.5,
          "옷 파손": 4.5,
          "핫팩": player.temp <= 34 ? 6.5 : 2,
          "선풍기": opponent.temp <= 30 ? 7 : 5.5,
          "몸살": 8,
          "행동 제한": 8,
          "회복 제한": opponent.temp <= 33 ? 7 : 3.5,
        };
        const existing = target.statuses.find(status => status.name === card.status);
        const duration = target === player ? card.selfTurns ?? card.turns : card.turns;
        const marginal = Math.max(0, duration - (existing?.remaining ?? 0)) / card.turns;
        const helpful = card.status === "보온" || card.status === "핫팩";
        const direction = (target === player) === helpful ? 1 : -1;
        score += (values[card.status] ?? 0) * marginal * direction * (card.chance ?? 1);
      }
    }
    return score;
  }

  function blizzardLossRisk(match, player, card) {
    // Preview the same effects as the real turn without drawing or advancing RNG.
    const count = card?.target === "random" ? 2 : card?.outcomes?.length ?? 1;
    const statusOptions = card?.chance === undefined ? [[0.5, 1]] :
      [[0, card.chance], [1, 1 - card.chance]];
    let risk = 0;
    for (let outcome = 0; outcome < count; outcome++) {
      for (const [statusRoll, weight] of statusOptions) {
        const roll = (outcome + 0.5) / count;
        let needsTemperatureRoll = Boolean(card?.outcomes || card?.target === "random");
        const preview = Object.assign(Object.create(Match.prototype), {
          players: match.players.map(side => ({
            ...side, statuses: side.statuses.map(status => ({ ...status })),
          })),
          activeIndex: match.activeIndex,
          blizzardCount: match.blizzardCount,
          winner: null,
          onEvent() {},
          random() {
            if (!needsTemperatureRoll) return statusRoll;
            needsTemperatureRoll = false;
            return roll;
          },
        });
        if (card) preview.applyCard(preview.currentPlayer, card);
        preview.checkResult();
        if (!preview.gameOver) {
          expireStatuses(preview.currentPlayer);
          preview.blizzard();
        }
        if (preview.winner === match.opponentOf(player).name) risk += weight / count;
      }
    }
    return risk;
  }

  function chooseCard(match, player = match.currentPlayer) {
    let best = -1;
    let highest = -0.75; // Passing is preferable to a likely self-inflicted loss.
    const indices = match.playableIndices(player);
    const scores = [];
    for (const index of indices) {
      const score = scoreCard(match, player, player.hand[index]) + match.random() * 0.3;
      scores[index] = score;
      if (score > highest) {
        best = index;
        highest = score;
      }
    }
    const blizzardNext = player === match.currentPlayer && player.name !== match.starter &&
      (match.turn + 1) % SETTINGS.blizzardInterval === 0;
    const finalAction = player.actionsUsed + 1 >= maxActions(player);
    const selected = player.hand[best];
    const selfDamage = selected?.target === "both" || selected?.target === "random" ? selected.temp ?? 0 : 0;
    const maxSelfDamage = half(-selfDamage * SETTINGS.maxDamageMultiplier);
    if (!blizzardNext || (best !== -1 && (!finalAction || player.hand[best].free)) ||
        player.temp - maxSelfDamage - SETTINGS.maxBlizzardDamage > SETTINGS.lossTemp) return best;

    let risk = blizzardLossRisk(match, player, player.hand[best]);
    if (risk === 0) return best;
    const passRisk = best === -1 ? risk : blizzardLossRisk(match, player);
    if (passRisk < risk) {
      best = -1;
      highest = -0.75;
      risk = passRisk;
    }
    for (const index of indices) {
      if (index === best || player.hand[index].free) continue;
      const candidateRisk = blizzardLossRisk(match, player, player.hand[index]);
      if (candidateRisk < risk - 1e-9 || (Math.abs(candidateRisk - risk) < 1e-9 && scores[index] > highest)) {
        best = index;
        risk = candidateRisk;
        highest = scores[index];
      }
    }
    return best;
  }

  function chooseHandExchange(match) {
    const player = match.currentPlayer;
    if (player.handExchangeUsed || hasStatus(player, "실명")) return -1;
    const incoming = match.preview(player);
    if (!incoming || legalCard(player, incoming)) return -1;
    const value = scoreCard(match, player, incoming);
    let slot = -1;
    let improvement = 6;
    for (const [index, card] of player.hand.entries()) {
      if (!card || card.id === incoming.id || card.free) continue;
      const difference = value - (legalCard(player, card) ? 0 : scoreCard(match, player, card));
      if (difference > improvement) {
        improvement = difference;
        slot = index;
      }
    }
    return slot;
  }

  return { SETTINGS, emotes, cards: Object.freeze(cards), Match, maxActions, hasStatus, isDebuff, isBuff,
    legalCard, temperatureDelta, blizzardDamage, stormPhaseMs, chooseCard, chooseHandExchange, scoreCard };
})();

if (typeof module === "object" && module.exports) module.exports = GameRules;

