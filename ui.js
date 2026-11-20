"use strict";

const { SETTINGS, Match, maxActions, hasStatus, isBuff, isDebuff, legalCard, chooseCard } = GameRules;
const get = id => document.getElementById(id);
const playerPrefix = player => player.name.toLowerCase();
const languages = { ko: "한국어", en: "English", ja: "日本語" };
const dragType = "application/x-36-5-card";
const logEntries = [];
let language = "ko";
let match = null;
let turnTimer = null;
let endingTimer = null;
let deadline = 0;
let drawnSlot = null;
let activeDrag = null;
let bgm = null;
let snowTimer;
let flashTimer;
const shakeTimers = new WeakMap();
let onlineSide = null;
let onlineClock;
let onlineDeadline = null;
let onlineNotice = "";
const cardById = new Map(GameRules.cards.map(card => [card.id, card]));

try {
  const savedLanguage = localStorage.getItem("36.5.language");
  if (Object.hasOwn(languages, savedLanguage)) language = savedLanguage;
} catch {
  // The game also runs from a local HTML file without persistent storage.
}

const textSources = new WeakMap();
const translationPatterns = Object.fromEntries(Object.entries(translations).map(([locale, dictionary]) => {
  const words = Object.keys(dictionary).sort((first, second) => second.length - first.length);
  const pattern = words.map(word => word.replace(/[.*+?^$(){}|[\]\\]/g, "\\$&")).join("|");
  return [locale, new RegExp(pattern, "g")];
}));

function translateText(source) {
  const pattern = translationPatterns[language];
  return pattern ? source.replace(pattern, word => translations[language][word]) : source;
}

function applyLanguageToPage() {
  document.documentElement.lang = language;
  get("langBtn").textContent = languages[language];
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest("#langBtn, script")) continue;
    const original = textSources.get(node) ?? node.nodeValue;
    textSources.set(node, original);
    const translated = translateText(original);
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }
  document.querySelectorAll("[data-aria-label]").forEach(element => {
    element.setAttribute("aria-label", translateText(element.dataset.ariaLabel));
  });
}

function log(message, kind = "notice") {
  const line = document.createElement("div");
  line.className = kind;
  line.textContent = message;
  const box = get("log");
  box.append(line);
  logEntries.push(line);
  if (logEntries.length > 100) logEntries.shift().remove();
  box.scrollTop = box.scrollHeight;
}

function playSound(file, volume) {
  const sound = new Audio("assets/audio/" + file);
  sound.volume = volume;
  sound.play().catch(() => {});
}

function startBgm() {
  if (!bgm) {
    bgm = new Audio("assets/audio/bgm.mp3");
    bgm.loop = true;
    bgm.volume = 0.38;
  }
  bgm.play().catch(() => {});
}

function stopBgm() {
  if (!bgm) return;
  bgm.pause();
  bgm.currentTime = 0;
}

function handleEvent(event) {
  const { type, player, card, status } = event;
  switch (type) {
    case "start":
      log(player.name + " 선공 · 게임 시작", "good");
      break;
    case "turn":
      log(player.name + " 차례");
      break;
    case "round":
      log("인게임 턴 " + event.turn + " 시작");
      break;
    case "card":
      log(player.name + " 카드 사용 · " + card.name);
      if (card.type === "스페셜") showSpecialCardEffect(card.name);
      break;
    case "draw":
      if (!player.isAI) drawnSlot = event.index;
      break;
    case "temperature": {
      const sign = event.delta > 0 ? "+" : "";
      showTempFloat(player, event.delta);
      log(player.name + " · " + event.reason + " · " + sign + event.delta + "°C → " + player.temp + "°C",
        event.delta < 0 ? "danger" : event.delta > 0 ? "good" : "notice");
      break;
    }
    case "status":
      log(player.name + " · " + status.name + " " + status.remaining + "턴");
      showStatusEffect(player, status.name);
      break;
    case "cure":
      log(player.name + " · " + status.name + " 제거", "good");
      showStatusEffect(player, status.name + " 제거", "special");
      break;
    case "overheat":
      screenFlash("overheat");
      showBurst(player, "40°C 과열!", "overheat");
      log(player.name + " · 40°C 과열!", "danger");
      break;
    case "swap":
      log(event.exchanged ? "다음 카드 교체" : "교체할 다음 카드가 부족합니다.");
      break;
    case "waterGun":
      showRussianHit(player);
      break;
    case "timeout":
      log("시간 초과 · 자동 확정 · " + card.name);
      break;
    case "timeoutPass":
      log("시간 초과 · 사용 가능한 카드가 없어 턴을 종료합니다.");
      break;
    case "pass":
      log(player.name + " 차례 종료");
      break;
    case "recycle":
      log(player.name + " · 버림 더미를 섞었습니다.");
      break;
    case "blizzard":
      playSound("blizzard.mp3", 0.9);
      clearTimeout(snowTimer);
      get("snow").classList.add("active");
      snowTimer = setTimeout(() => get("snow").classList.remove("active"), 900);
      log("Blizzard #" + event.count + " · 기본 피해 -" + event.damage + "°C", "danger");
      break;
    case "result": {
      const title = event.winner === "DRAW" ? "무승부" : event.winner + " 승리";
      log(event.forfeited ? event.forfeited + " 기권 · " + title : title, "danger");
      if (!event.forfeited) {
        for (const side of match.players.filter(side => side.temp <= SETTINGS.lossTemp)) {
          showBurst(side, "저체온", "death");
        }
        screenFlash("death");
      }
      triggerEndingSequence(event.winner, event.both, event.forfeited);
      break;
    }
  }
}

function clearTurnTimer() {
  clearTimeout(turnTimer);
  turnTimer = null;
}

function scheduleTurn() {
  clearTurnTimer();
  clearInterval(onlineClock);
  onlineClock = null;
  onlineDeadline = null;
  onlineNotice = "";
  onlineSide = null;
  if (!match || match.gameOver) return;

  const session = match;
  if (session.currentPlayer.isAI) {
    turnTimer = setTimeout(() => {
      if (match !== session || session.gameOver || !session.currentPlayer.isAI) return;
      const index = chooseCard(session);
      if (index === -1) {
        log("AI가 차례를 마쳤습니다.");
        session.finishTurn();
      } else if (session.stage(index)) {
        playSound("card-move.m4a", 0.75);
        render();
        turnTimer = setTimeout(() => {
          if (match !== session) return;
          session.confirm();
          render();
          scheduleTurn();
        }, 400);
        return;
      }
      render();
      scheduleTurn();
    }, 1400);
    return;
  }

  deadline = performance.now() + SETTINGS.secondsPerAction * 1000;
  get("timer").textContent = SETTINGS.secondsPerAction;
  const tick = () => {
    if (match !== session || session.gameOver || session.currentPlayer.isAI) return;
    const remaining = Math.ceil((deadline - performance.now()) / 1000);
    if (remaining <= 0) {
      clearDragVisuals();
      match.timeOut();
      render();
      scheduleTurn();
      return;
    }
    get("timer").textContent = remaining;
    turnTimer = setTimeout(tick, Math.max(1, deadline - performance.now() - (remaining - 1) * 1000));
  };
  turnTimer = setTimeout(tick, 1000);
}

function resetMatch() {
  clearTurnTimer();
  clearTimeout(endingTimer);
  clearTimeout(flashTimer);
  clearTimeout(snowTimer);
  get("snow").classList.remove("active");
  get("screenFlash").className = "screen-flash";
  clearDragVisuals();
  clearResultEffects();
  document.querySelectorAll(".temp-burst, .temp-float, .effect-pop, .russian-hit, .object-effect").forEach(effect => effect.remove());
  document.querySelectorAll(".rh-shake").forEach(panel => panel.classList.remove("rh-shake"));
  hideEndingScene();
  drawnSlot = null;
  match = null;
}

function revealBoard() {
  get("rulesScreen").classList.remove("show");
  get("startMenu").classList.add("hidden");
  document.body.classList.remove("game-not-started");
  document.querySelector(".wrap").classList.add("fullscreen-game");
  get("log").replaceChildren();
  logEntries.length = 0;
  startBgm();
}

function startMatch() {
  resetMatch();
  revealBoard();
  match = new Match({ onEvent: handleEvent });
  match.start();
  render();
  scheduleTurn();
}

function returnToMainMenu() {
  if (onlineSide) Online.leave();
  resetMatch();
  stopBgm();
  document.body.classList.add("game-not-started");
  document.querySelector(".wrap").classList.remove("fullscreen-game");
  get("startMenu").classList.remove("hidden");
  get("startGameBtn").focus();
  applyLanguageToPage();
}

function ownsTurn() {
  return match && !match.gameOver && !match.currentPlayer.isAI && (!onlineSide || match.current === onlineSide);
}

function updateOnlineClock() {
  if (!onlineSide) return;
  get("timer").textContent = onlineDeadline === null ? "–" : Math.max(0, Math.ceil((onlineDeadline - performance.now()) / 1000));
}

function setOnlineNotice(message) {
  onlineNotice = message;
  if (onlineSide && match) renderOnlineTurn();
}

function renderOnlineTurn() {
  const status = get("onlineTurnStatus");
  status.hidden = !onlineSide;
  if (!onlineSide) return;
  status.className = onlineNotice ? "connection-issue" : ownsTurn() ? "local-turn" : "";
  status.textContent = translateText(onlineNotice || (match.gameOver ? "게임 종료" : ownsTurn() ? "내 차례" : "상대 차례"));
}

function receiveOnlineState(state, events, requestMs) {
  if (!onlineSide) {
    resetMatch();
    onlineSide = state.side;
    match = { preview: player => player.nextCard };
    revealBoard();
    onlineClock = setInterval(updateOnlineClock, 150);
  }
  clearDragVisuals();
  const card = id => cardById.get(id) ?? null;
  const players = state.players.map(player => ({
    ...player,
    isAI: false,
    usedThisTurn: player.usedThisTurn.map(card),
    hand: player.hand?.map(card) ?? [],
    pending: player.pending && { index: player.pending.index, card: card(player.pending.card) },
    nextCard: card(player.preview),
  }));
  Object.assign(match, {
    players, currentPlayer: players.find(player => player.name === state.current),
    current: state.current, starter: state.starter, turn: state.turn,
    blizzardCount: state.blizzardCount, gameOver: state.phase === "finished",
  });
  onlineDeadline = state.remainingMs === null ? null : performance.now() + Math.max(0, state.remainingMs - requestMs / 2);
  for (const event of events) handleEvent({ ...event, card: card(event.card) });
  render();
}

async function stageHumanCard(index, keyboard = false) {
  if (!ownsTurn()) return;
  if (onlineSide) {
    clearDragVisuals();
    if (!await Online.action("stage", { index })) return;
    playSound("card-move.m4a", 0.85);
    if (keyboard) get("endBtn").focus();
    return;
  }
  if (!match.stage(index)) return;
  playSound("card-move.m4a", 0.85);
  clearDragVisuals();
  render();
  if (keyboard) get("endBtn").focus();
}

async function confirmOrPass(event) {
  if (!ownsTurn()) return;
  if (onlineSide) {
    const pending = match.currentPlayer.pending;
    if (await Online.action(pending ? "confirm" : "pass") && pending && event.detail === 0 && ownsTurn()) {
      get("hand").querySelector('[data-hand-index="' + pending.index + '"]:not(.disabled)')?.focus();
    }
    return;
  }
  if (match.currentPlayer.pending) {
    const resolved = match.confirm();
    render();
    if (event.detail === 0 && !match.gameOver && !match.currentPlayer.isAI) {
      get("hand").querySelector('[data-hand-index="' + resolved.index + '"]:not(.disabled)')?.focus();
    }
  } else {
    log("P1 차례 종료");
    match.finishTurn();
    render();
  }
  scheduleTurn();
}

async function cancelSelection(event) {
  if (!ownsTurn() || !match.currentPlayer.pending) return;
  const { index } = match.currentPlayer.pending;
  if (onlineSide) {
    if (await Online.action("cancel") && event.detail === 0) get("hand").querySelector('[data-hand-index="' + index + '"]')?.focus();
    return;
  }
  if (match.cancel()) {
    render();
    if (event.detail === 0) get("hand").querySelector('[data-hand-index="' + index + '"]')?.focus();
  }
}

function renderPlayer(player) {
  const prefix = playerPrefix(player);
  const temp = get(prefix + "Temp");
  temp.textContent = player.temp.toFixed(1) + "°C";
  temp.className = "temp" + (player.temp <= 30 ? " danger" : player.temp <= 34 ? " cold" : "");
  const percent = (player.temp - SETTINGS.lossTemp) / (SETTINGS.overheatTemp - SETTINGS.lossTemp) * 100;
  get(prefix + "Bar").style.width = Math.max(0, Math.min(100, percent)) + "%";
  get(prefix + "Deck").textContent = player.deckCount ?? player.deck.length;
  get(prefix + "Discard").textContent = player.discardCount ?? player.discard.length;
  get(prefix + "Badge").textContent = onlineSide ? (player.name === onlineSide ? "내 자리" : "상대 자리") : player.isAI ? "AI" : "플레이어";

  const statuses = get(prefix + "Status");
  const statusLabels = player.statuses.length ? player.statuses.map(status => status.name + " " + status.remaining) : ["상태 없음"];
  statuses.replaceChildren(...statusLabels.map(label => {
    const item = document.createElement("span");
    item.className = "status";
    item.textContent = label;
    return item;
  }));

  const preview = get(prefix + "Next");
  if (player.isAI) preview.textContent = "AI는 비공개";
  else if (onlineSide && player.name !== onlineSide) preview.textContent = "상대 카드 비공개";
  else if (hasStatus(player, "실명")) preview.textContent = "실명 상태: 다음 카드 확인 불가";
  else {
    const card = match.preview(player);
    preview.textContent = card ? card.name + " · " + card.desc : "없음";
  }
}

function renderHand(player) {
  const hand = get("hand");
  hand.replaceChildren();

  if (player.isAI) {
    const waiting = document.createElement("div");
    waiting.className = "mini-card ai-hand-message";
    waiting.textContent = match.gameOver ? "게임 종료" : "AI가 카드를 고르고 있습니다.";
    hand.append(waiting);
    return;
  }

  for (const [index, card] of player.hand.entries()) {
    if (!card) continue;
    const pending = player.pending?.index === index;
    const reason = ownsTurn() ? legalCard(player, card) : "상대 차례";
    const enabled = ownsTurn() && !player.pending && !reason;
    const shell = document.createElement("div");
    shell.className = "card-shell asset-skin";
    shell.dataset.handIndex = index;
    if (drawnSlot === index) shell.classList.add("flip-enter");
    if (!enabled) shell.classList.add("disabled");
    shell.setAttribute("role", "button");
    shell.setAttribute("aria-disabled", String(!enabled));
    shell.tabIndex = enabled ? 0 : -1;
    shell.draggable = enabled;

    if (pending) {
      shell.classList.add("waiting-card");
      shell.dataset.ariaLabel = "카드 대기중";
      shell.innerHTML = '<div class="card-flip"><div class="card-face card-front asset-card-front waiting-front">' +
        '<div class="asset-card-image waiting-asset-card"><div class="asset-card-symbol waiting-symbol">?</div></div>' +
        '</div><div class="card-face card-back">' + createCardBackHTML() + "</div></div>";
    } else {
      shell.dataset.ariaLabel = card.name + " · " + card.desc;
      shell.innerHTML = '<div class="card-flip">' + createAssetCardFaceHTML(card) +
        '<div class="card-face card-back">' + createCardBackHTML() + "</div></div>" + createCardHintHTML(card, reason);
    }

    if (enabled) {
      shell.onclick = () => stageHumanCard(index);
      shell.onkeydown = event => {
        if (event.key !== "Enter" && event.key !== " ") return;
        event.preventDefault();
        stageHumanCard(index, true);
      };
      shell.ondragstart = event => {
        if (!event.dataTransfer) return;
        event.dataTransfer.setData(dragType, String(index));
        event.dataTransfer.effectAllowed = "move";
        activeDrag = { index, session: match, ghost: createDragGhost(shell, event) };
        document.body.classList.add("is-dragging-card");
        get(playerPrefix(player) + "Slot").closest(".slot").classList.add("drop-candidate");
        requestAnimationFrame(() => {
          if (activeDrag?.index === index && shell.isConnected) shell.classList.add("dragging");
        });
      };
      shell.ondragend = () => {
        shell.classList.remove("dragging");
        clearDragVisuals();
      };
    }
    hand.append(shell);
  }
  drawnSlot = null;
}

function renderSlot(player) {
  const slot = get(playerPrefix(player) + "Slot");
  const cards = player.usedThisTurn.map(card => ({ card, pending: false }));
  if (player.pending) cards.push({ card: player.pending.card, pending: true });
  slot.replaceChildren(...cards.map(({ card, pending }) => {
    const tile = document.createElement("div");
    tile.className = "slot-card" + (pending ? " pending" : "");
    tile.textContent = card.name + (pending ? " · 대기" : "");
    if (pending) {
      const detail = document.createElement("small");
      detail.className = "slot-card-detail";
      detail.textContent = card.desc;
      tile.append(detail);
    }
    return tile;
  }));
}

function render() {
  if (!match) return;
  const step = match.turn % SETTINGS.blizzardInterval;
  const gauge = get("blizzardGauge");
  gauge.style.setProperty("--blizzard-progress", (step / SETTINGS.blizzardInterval * 100) + "%");
  gauge.querySelector(".blizzard-label").textContent = "Blizzard " + step + "/" + SETTINGS.blizzardInterval;
  gauge.querySelector(".blizzard-sub").textContent = match.blizzardCount + "회 발동";
  get("turnInfo").textContent = "인게임 턴 " + match.turn + " · " + match.starter + " 선공";

  for (const player of match.players) {
    renderPlayer(player);
    renderSlot(player);
  }

  const player = onlineSide ? match.players.find(side => side.name === onlineSide) : match.currentPlayer;
  const active = ownsTurn();
  const pending = active && player.pending;
  get("actionCount").textContent = player.actionsUsed + " / " + maxActions(player);
  get("handTitle").textContent = match.gameOver ? "게임 종료" : player.name + " 손패";
  get("endBtn").textContent = pending ? "카드 배치 확정" : "턴 종료";
  get("endBtn").disabled = !active;
  get("endBtn").classList.toggle("confirm-ready", Boolean(pending));
  get("cancelBtn").disabled = !pending;
  get("restartBtn").hidden = Boolean(onlineSide);
  get("endingRestartBtn").hidden = Boolean(onlineSide);
  get("mainMenuBtn").textContent = onlineSide && !match.gameOver ? "기권하고 나가기" : "메인화면으로";
  if (!active) get("timer").textContent = "–";
  renderHand(player);
  applyLanguageToPage();
  renderOnlineTurn();
  updateOnlineClock();
  get("log").scrollTop = get("log").scrollHeight;
}

for (const prefix of ["p1", "p2"]) {
  const zone = get(prefix + "Slot").closest(".slot");
  const acceptsDrag = () => ownsTurn() && playerPrefix(match.currentPlayer) === prefix && activeDrag?.session === match;
  zone.ondragover = event => {
    if (!acceptsDrag() || !event.dataTransfer?.types.includes(dragType)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    zone.classList.add("drop-ready");
  };
  zone.ondragleave = () => zone.classList.remove("drop-ready");
  zone.ondrop = event => {
    if (!acceptsDrag() || event.dataTransfer?.getData(dragType) !== String(activeDrag.index)) return;
    event.preventDefault();
    stageHumanCard(activeDrag.index);
  };
}

for (const button of ["startGameBtn", "restartBtn", "endingRestartBtn"]) get(button).onclick = startMatch;
for (const button of ["mainMenuBtn", "endingMainBtn"]) get(button).onclick = returnToMainMenu;
get("endBtn").onclick = confirmOrPass;
get("cancelBtn").onclick = cancelSelection;
get("rulesBtn").onclick = () => {
  get("rulesScreen").classList.add("show");
  get("backToMenuBtn").focus();
};
get("backToMenuBtn").onclick = () => {
  get("rulesScreen").classList.remove("show");
  get("rulesBtn").focus();
};
get("langBtn").onclick = () => {
  const choices = Object.keys(languages);
  language = choices[(choices.indexOf(language) + 1) % choices.length];
  try { localStorage.setItem("36.5.language", language); } catch {}
  applyLanguageToPage();
};
applyLanguageToPage();


function screenFlash(kind) {
  const flash = document.getElementById("screenFlash");
  if (!flash) return;
  flash.className = `screen-flash ${kind}`;
  clearTimeout(flashTimer);
  flashTimer = setTimeout(() => { flash.className = "screen-flash"; }, 1500);
}

function showBurst(player, text, kind) {
  const prefix = playerPrefix(player);
  const tempEl = document.getElementById(prefix + "Temp");
  const panel = tempEl?.closest(".player");
  if (!panel) return;

  const burst = document.createElement("div");
  burst.className = `temp-burst ${kind}`;
  burst.textContent = text;
  panel.appendChild(burst);
  setTimeout(() => burst.remove(), 1400);
}

function showTempFloat(player, delta) {
  const panel = document.getElementById(playerPrefix(player) + "Temp")?.closest(".player");
  if (!panel) return;

  const floatEl = document.createElement("div");
  if (delta === 0) {
    floatEl.className = "temp-float no-change";
    floatEl.textContent = "변화없음";
  } else {
    floatEl.className = `temp-float ${delta > 0 ? "up" : "down"}`;
    const sign = delta > 0 ? "+" : "";
    floatEl.textContent = `${sign}${delta}`;
  }

  panel.appendChild(floatEl);
  setTimeout(() => floatEl.remove(), 1200);
}

function showStatusEffect(player, statusName, kind="") {
  const prefix = playerPrefix(player);
  const tempEl = document.getElementById(prefix + "Temp");
  const panel = tempEl?.closest(".player");
  if (!panel) return;

  const pop = document.createElement("div");
  const effectKind = kind || (isBuff(statusName) ? "buff" : isDebuff(statusName) ? "debuff" : "special");
  pop.className = `effect-pop ${effectKind}`;
  pop.textContent = `${effectKind === "buff" ? "BUFF" : effectKind === "debuff" ? "DEBUFF" : "EFFECT"} · ${statusName}`;
  panel.appendChild(pop);
  setTimeout(() => pop.remove(), 1300);
}


function showRussianHit(player) {
  // 러시안 물총에 당첨된 플레이어 패널에 역동적인 물폭발 연출.
  const prefix = playerPrefix(player);
  const tempEl = document.getElementById(prefix + "Temp");
  const panel = tempEl?.closest(".player");
  if (!panel) return;

  const fx = document.createElement("div");
  fx.className = "russian-hit";
  const N = 12;
  let drops = "";
  for (let i = 0; i < N; i++) {
    const angle = (360 / N) * i + (i % 2 ? 13 : -9);
    const dist = 78 + (i % 3) * 30;
    drops += `<i class="rh-drop" style="--a:${angle}deg; --d:-${dist}px"></i>`;
  }
  fx.innerHTML = `<div class="rh-flash"></div><div class="rh-ring"></div><div class="rh-splash"></div>${drops}`;
  panel.appendChild(fx);

  panel.classList.remove("rh-shake");
  void panel.offsetWidth; // 재생 리셋(연속 발동 대비)
  panel.classList.add("rh-shake");
  clearTimeout(shakeTimers.get(panel));
  shakeTimers.set(panel, setTimeout(() => panel.classList.remove("rh-shake"), 540));
  setTimeout(() => fx.remove(), 950);
}

function showSpecialCardEffect(cardName) {
  const centerPanel = document.querySelector(".center");
  if (!centerPanel) return;

  const typeMap = {
    "교체 카드": "swap",
    "상대 턴 통제 카드": "control",
    "회복 제한 카드": "lock",
    "강화 디버프 카드": "flu"
  };

  const type = typeMap[cardName] || "swap";
  const el = document.createElement("div");
  el.className = `object-effect ${type}`;

  if (type === "swap") {
    el.innerHTML = `<div class="fx-card one"></div><div class="fx-card two"></div>`;
  } else if (type === "control") {
    el.innerHTML = `<div class="fx-chain"></div>`;
  } else if (type === "lock") {
    el.innerHTML = `<div class="fx-lock"></div>`;
  } else if (type === "flu") {
    el.innerHTML = `<div class="fx-sick"></div>`;
  }

  centerPanel.appendChild(el);
  setTimeout(() => el.remove(), 1650);
}


function clearResultEffects() {
  document.querySelectorAll(".player.result-winner, .player.result-loser, .player.result-draw").forEach(el => {
    el.classList.remove("result-winner", "result-loser", "result-draw");
  });
  document.querySelectorAll(".result-announcer").forEach(el => el.remove());
}

function getPlayerPanel(playerName) {
  const id = playerName === "P1" ? "p1Temp" : "p2Temp";
  return document.getElementById(id)?.closest(".player");
}

function triggerEndingSequence(winner, both, forfeited) {
  clearTimeout(endingTimer);
  clearResultEffects();

  if (winner === "P1") {
    getPlayerPanel("P1")?.classList.add("result-winner");
    getPlayerPanel("P2")?.classList.add("result-loser");
    showResultAnnouncer("VICTORY", "P1 승리");
  } else if (winner === "P2") {
    getPlayerPanel("P2")?.classList.add("result-winner");
    getPlayerPanel("P1")?.classList.add("result-loser");
    showResultAnnouncer("VICTORY", "P2 승리");
  } else {
    getPlayerPanel("P1")?.classList.add("result-draw");
    getPlayerPanel("P2")?.classList.add("result-draw");
    showResultAnnouncer("DRAW", "무승부");
  }

  const session = match;
  endingTimer = setTimeout(() => {
    if (match === session) showEndingScene(winner, both, forfeited);
  }, 2500);
}

function showResultAnnouncer(kicker, mainText) {
  const overlay = document.createElement("div");
  overlay.className = "result-announcer" + (kicker === "DRAW" ? " draw" : "");
  overlay.innerHTML = `
    <div class="result-card">
      <div class="result-kicker">${kicker}</div>
      <div class="result-main">${mainText}</div>
    </div>`;
  document.body.appendChild(overlay);
  applyLanguageToPage();
  setTimeout(() => overlay.remove(), 2400);
}

function showEndingScene(winner, both, forfeited) {
  const name = winner === "P1" ? "P2" : "P1";
  get("endingTitle").textContent = winner === "P1" ? "P1이 승리하였습니다!"
    : winner === "P2" ? "P2가 승리하였습니다!" : "무승부입니다!";
  get("endingSub").textContent = forfeited ? forfeited + " 기권"
    : winner === "DRAW" ? "양쪽 모두 같은 체온으로 한계선 아래에 도달했습니다."
    : both ? name + "의 체온이 더 낮았습니다." : name + "가 저체온 상태에 도달했습니다.";
  document.body.classList.add("game-not-started");
  document.querySelector(".wrap").classList.remove("fullscreen-game");
  get("endingScreen").classList.add("show");
  applyLanguageToPage();
  get(onlineSide ? "endingMainBtn" : "endingRestartBtn").focus();
}
function hideEndingScene() {
  document.getElementById("endingScreen")?.classList.remove("show");
}



function getCardAssetClass(card) {
  if (!card) return "asset-special";
  if (card.type === "체온 상승") return "asset-heat";
  if (card.type === "체온 저하") return "asset-cold";
  if (card.type === "복불복") return "asset-risk";
  if (card.type === "효과") return "asset-buff";
  if (card.type === "자폭") return "asset-both";
  if (card.type === "스페셜") return "asset-special";
  return "asset-special";
}

function createAssetCardFaceHTML(card) {
  const visual = `<img class="custom-card-asset" src="assets/cards/${card.id}.png" alt="" draggable="false">`;

  return `
    <div class="card-face card-front asset-card-front">
      <div class="asset-card-image ${getCardAssetClass(card)} has-custom-asset">${visual}</div>
    </div>`;
}

function createCardHintHTML(card, reason) {
  return `<div class="asset-hover-info">
      <div class="asset-hover-name">${card.name}</div>
      <div class="asset-hover-type">${card.type}</div>
      <div class="asset-hover-desc">${card.desc}</div>
      <div class="asset-hover-target">${reason || "클릭하거나 드래그해서 배치"}</div>
    </div>`;
}


function createCardBackHTML() {
  return `
    <div class="corner-ornament corner-1"></div>
    <div class="corner-ornament corner-2"></div>
    <div class="corner-ornament corner-3"></div>
    <div class="corner-ornament corner-4"></div>
    <div class="back-snowflake">✦</div>
    <div class="back-compass"></div>
    <div class="back-hex">
      <div class="mountain-wrap">
        <div class="mountain-small"></div>
        <div class="mountain-big"></div>
        <div class="snow-cap"></div>
      </div>
    </div>
    <div class="back-temp">36.5°C</div>
    <div class="back-title">TEMP BATTLE</div>
    <div class="back-dots">• • •</div>
  `;
}


function clearDragVisuals() {
  activeDrag?.ghost.remove();
  activeDrag = null;
  document.body.classList.remove("is-dragging-card");
  document.querySelectorAll(".drop-candidate, .drop-ready").forEach(el => {
    el.classList.remove("drop-candidate", "drop-ready");
  });
}

function createDragGhost(shell, event) {
  const rect = shell.getBoundingClientRect();

  const ghost = shell.cloneNode(true);
  ghost.classList.add("drag-ghost-card", "mini-drag-card-fixed");
  ghost.classList.remove("dragging");

  const scale = Math.min(1, Math.max(0.42, 64 / rect.width));
  const ghostWidth = Math.round(rect.width * scale);
  const ghostHeight = Math.round(rect.height * scale);

  const applyBox = (el, width, height) => {
    el.style.setProperty("width", `${width}px`, "important");
    el.style.setProperty("height", `${height}px`, "important");
    el.style.setProperty("min-width", `${width}px`, "important");
    el.style.setProperty("max-width", `${width}px`, "important");
    el.style.setProperty("min-height", `${height}px`, "important");
    el.style.setProperty("max-height", `${height}px`, "important");
    el.style.setProperty("box-sizing", "border-box", "important");
  };

  applyBox(ghost, ghostWidth, ghostHeight);

  ghost.style.setProperty("position", "fixed", "important");
  ghost.style.setProperty("left", "-10000px", "important");
  ghost.style.setProperty("top", "-10000px", "important");
  ghost.style.setProperty("z-index", "99999", "important");
  ghost.style.setProperty("pointer-events", "none", "important");
  ghost.style.setProperty("opacity", "1", "important");
  ghost.style.setProperty("transform", "none", "important");
  ghost.style.setProperty("margin", "0", "important");
  ghost.style.setProperty("overflow", "visible", "important");
  ghost.style.setProperty("border-radius", "14px", "important");

  const hoverInfo = ghost.querySelector(".asset-hover-info");
  if (hoverInfo) hoverInfo.remove();

  ghost.querySelectorAll(".card-flip, .card-face, .card-front, .asset-card-image").forEach(el => {
    el.style.setProperty("width", "100%", "important");
    el.style.setProperty("height", "100%", "important");
    el.style.setProperty("min-width", "0", "important");
    el.style.setProperty("max-width", "none", "important");
    el.style.setProperty("min-height", "0", "important");
    el.style.setProperty("max-height", "none", "important");
    el.style.setProperty("border-radius", "14px", "important");
    el.style.setProperty("box-sizing", "border-box", "important");
  });

  ghost.querySelectorAll(".asset-card-symbol").forEach(el => {
    el.style.setProperty("width", "42px", "important");
    el.style.setProperty("height", "42px", "important");
    el.style.setProperty("font-size", "25px", "important");
    el.style.setProperty("border-radius", "14px", "important");
  });

  document.body.appendChild(ghost);

  if (event.dataTransfer && event.dataTransfer.setDragImage) {
    event.dataTransfer.setDragImage(ghost, Math.round(ghostWidth * 0.5), Math.round(ghostHeight * 0.55));
  }

  return ghost;
}
