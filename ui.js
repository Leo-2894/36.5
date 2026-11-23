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
let handOwner = null;
const handSlots = [];
let hoveredCard = null;
let activeDrag = null;
let bgm = null;
let flashTimer;
const shakeTimers = new WeakMap();
let onlineSide = null;
let onlineClock;
let onlineDeadline = null;
let onlineNotice = "";
const cardById = new Map(GameRules.cards.map(card => [card.id, card]));
const cardArtUrl = card => (window.desktopOnline ? "card-art://local/" : "assets/cards/") + card.id + ".png";
const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
const slotLayouts = new WeakMap();
const playerReadings = new WeakMap();
const statusLayouts = new WeakMap();
const queuedSwaps = new Map();
let logNeedsScroll = false;
const cardTones = { "체온 상승": "heat", "체온 저하": "ice", "복불복": "chance", "효과": "status", "자폭": "fracture", "스페셜": "rare" };

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

function setText(element, value) {
  const source = String(value);
  const node = element.firstChild;
  if (node?.nodeType === Node.TEXT_NODE && !node.nextSibling && textSources.get(node) === source) return;
  const label = document.createTextNode(translateText(source));
  textSources.set(label, source);
  element.replaceChildren(label);
}

function setFlag(element, property, value) {
  if (element[property] !== value) element[property] = value;
}

function applyLanguageToPage(root = document.body) {
  if (root === document.body) {
    document.documentElement.lang = language;
    get("langBtn").textContent = languages[language];
  }
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  while (walker.nextNode()) {
    const node = walker.currentNode;
    if (node.parentElement.closest("#langBtn, script")) continue;
    const original = textSources.get(node) ?? node.nodeValue;
    textSources.set(node, original);
    const translated = translateText(original);
    if (node.nodeValue !== translated) node.nodeValue = translated;
  }
  root.querySelectorAll("[data-aria-label]").forEach(element => {
    const label = translateText(element.dataset.ariaLabel);
    if (element.getAttribute("aria-label") !== label) element.setAttribute("aria-label", label);
  });
}

function log(message, kind = "notice") {
  const line = document.createElement("div");
  line.className = kind;
  setText(line, message);
  const box = get("log");
  box.append(line);
  logEntries.push(line);
  if (logEntries.length > 100) logEntries.shift().remove();
  logNeedsScroll = true;
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

function handleEvent(event, live = true) {
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
      if (live) {
        showCardCast(player, card);
        const rival = player.name === "P1" ? "P2" : "P1";
        if (card.target !== "random") BattleEffects.cast(card.id, player.name,
          card.target === "both" ? [player.name, rival] : [card.target === "self" ? player.name : rival]);
        const wave = get("battleWave");
        wave.dataset.tone = cardTones[card.type];
        wave.getAnimations().forEach(animation => animation.cancel());
        if (!reducedMotion.matches) wave.animate([{ opacity: .85 }, { opacity: 0 }], { duration: 650 });
      }
      break;
    case "draw":
      if (live && !player.isAI) drawnSlot = event.index;
      break;
    case "temperature": {
      const sign = event.delta > 0 ? "+" : "";
      if (live) showTempFloat(player, event.delta);
      log(player.name + " · " + event.reason + " · " + sign + event.delta + "°C → " + player.temp + "°C",
        event.delta < 0 ? "danger" : event.delta > 0 ? "good" : "notice");
      break;
    }
    case "status":
      log(player.name + " · " + status.name + " " + status.remaining + "턴");
      if (live) showStatusEffect(player, status.name);
      break;
    case "cure":
      log(player.name + " · " + status.name + " 제거", "good");
      if (live) showStatusEffect(player, status.name + " 제거", "special");
      break;
    case "overheat":
      if (live) {
        screenFlash("overheat");
        showBurst(player, "40°C 과열!", "overheat");
      }
      log(player.name + " · 40°C 과열!", "danger");
      break;
    case "swap":
      log(event.exchanged ? "다음 카드 교체" : "교체 가능한 카드가 없습니다.");
      if (live && event.exchanged) queuedSwaps.set(player.name, event);
      break;
    case "waterGun":
      if (live) {
        BattleEffects.cast("water-gun", event.caster ?? player.name, [player.name]);
        showRussianHit(player);
      }
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
    case "stormStart":
      if (live) playSound("blizzard.mp3", 0.9);
      break;
    case "blizzard":
      log("Blizzard #" + event.count + " · " + stormDamageText(event.damage), "danger");
      break;
    case "result": {
      const title = event.winner === "DRAW" ? "무승부" : event.winner + " 승리";
      log(event.forfeited ? event.forfeited + " 기권 · " + title : title, "danger");
      if (!live) {
        showEndingScene(event.winner, event.both, event.forfeited);
        break;
      }
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
  if (!match || match.gameOver) return;

  const session = match;
  if (session.storm) {
    get("timer").textContent = "–";
    turnTimer = setTimeout(() => {
      if (match !== session) return;
      session.advanceStorm();
      render();
      scheduleTurn();
    }, GameRules.stormPhaseMs(session.storm));
    return;
  }
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
  clearTimeout(onlineClock);
  onlineClock = null;
  onlineDeadline = null;
  onlineNotice = "";
  onlineSide = null;
  clearTimeout(endingTimer);
  clearTimeout(flashTimer);
  get("stormNotice").hidden = true;
  Snowfall.update(false);
  BattleEffects.clear();
  queuedSwaps.clear();
  document.querySelectorAll(".preview-swap").forEach(effect => effect.remove());
  get("screenFlash").className = "screen-flash";
  clearDragVisuals();
  clearResultEffects();
  document.querySelectorAll(".placement-flight, .cast-seal, .thermal-impact, .temp-burst, .temp-float, .effect-pop, .russian-hit, .object-effect").forEach(effect => effect.remove());
  for (const id of ["p1Slot", "p2Slot"]) slotLayouts.delete(get(id));
  document.querySelectorAll(".rh-shake").forEach(panel => panel.classList.remove("rh-shake"));
  hideEndingScene();
  drawnSlot = null;
  handOwner = null;
  hoveredCard = null;
  match = null;
}

function revealBoard() {
  get("rulesScreen").classList.remove("show");
  get("startMenu").classList.add("hidden");
  document.body.classList.remove("game-not-started");
  document.querySelector(".wrap").classList.add("fullscreen-game");
  get("log").replaceChildren();
  logEntries.length = 0;
  logNeedsScroll = false;
  startBgm();
}

function startMatch() {
  resetMatch();
  revealBoard();
  match = new Match({ onEvent: handleEvent, timedStorms: true });
  match.start();
  render();
  scheduleTurn();
}

function returnToMainMenu(event) {
  if (onlineSide) Online.leave();
  resetMatch();
  stopBgm();
  document.body.classList.add("game-not-started");
  document.querySelector(".wrap").classList.remove("fullscreen-game");
  get("startMenu").classList.remove("hidden");
  get("startGameBtn").focus();
  applyLanguageToPage();
  if (event) Online.backToDesktop();
}

function ownsTurn() {
  return match && !match.gameOver && !match.storm && !match.currentPlayer.isAI && (!onlineSide || match.current === onlineSide);
}

function updateOnlineClock() {
  clearTimeout(onlineClock);
  onlineClock = null;
  if (!onlineSide) return;
  const timer = get("timer");
  const remaining = onlineDeadline === null ? 0 : Math.max(0, onlineDeadline - performance.now());
  const seconds = Math.ceil(remaining / 1000);
  const value = onlineDeadline === null ? "–" : String(seconds);
  if (timer.textContent !== value) timer.textContent = value;
  if (seconds > 0) onlineClock = setTimeout(updateOnlineClock, Math.ceil(remaining - (seconds - 1) * 1000));
}

function setOnlineNotice(message) {
  onlineNotice = message;
  if (onlineSide && match) renderOnlineTurn();
}

function renderOnlineTurn() {
  const status = get("onlineTurnStatus");
  setFlag(status, "hidden", !onlineSide);
  if (!onlineSide) return;
  setFlag(status, "className", onlineNotice ? "connection-issue" : ownsTurn() ? "local-turn" : "");
  setText(status, onlineNotice || (match.gameOver ? "게임 종료" : ownsTurn() ? "내 차례" : "상대 차례"));
}

function receiveOnlineState(state, events, requestMs, restoring) {
  if (!onlineSide) {
    resetMatch();
    onlineSide = state.side;
    match = { preview: player => player.nextCard };
    revealBoard();
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
  let stormElapsedMs = 0;
  if (state.storm && !match.storm && state.remainingMs !== null) {
    const phaseLeft = Math.max(0, state.remainingMs - requestMs / 2);
    const stormLeft = phaseLeft + (state.storm === "approaching" ? GameRules.stormPhaseMs("active") : 0);
    stormElapsedMs = Math.max(0, SETTINGS.stormDuration - stormLeft);
  }
  Object.assign(match, {
    players, currentPlayer: players.find(player => player.name === state.current),
    current: state.current, starter: state.starter, turn: state.turn,
    storm: state.storm, stormDamage: state.stormDamage, stormElapsedMs,
    blizzardCount: state.blizzardCount, gameOver: state.phase === "finished",
  });
  onlineDeadline = state.storm || state.remainingMs === null ? null : performance.now() + Math.max(0, state.remainingMs - requestMs / 2);
  for (const event of events) handleEvent({ ...event, card: card(event.card) }, !restoring);
  render();
}

async function stageHumanCard(index, keyboard = false) {
  if (!ownsTurn()) return;
  const session = match;
  const player = match.currentPlayer;
  const origin = !activeDrag && !reducedMotion.matches
    ? get("hand").querySelector('[data-hand-index="' + index + '"]')?.getBoundingClientRect() : null;
  if (onlineSide) {
    clearDragVisuals();
    if (!await Online.action("stage", { index }) || match !== session || match.currentPlayer.pending?.index !== index) return;
  } else {
    if (!match.stage(index)) return;
    clearDragVisuals();
    render();
  }
  playSound("card-move.m4a", 0.85);
  if (origin) animatePlacement(origin, get(playerPrefix(player) + "Slot").querySelector(".pending img"));
  if (keyboard) get("endBtn").focus();
}

function animatePlacement(origin, thumbnail) {
  if (!thumbnail || reducedMotion.matches) return;
  const target = thumbnail.getBoundingClientRect();
  if (!target.width || !target.height) return;
  const flight = thumbnail.cloneNode();
  flight.className = "placement-flight";
  flight.setAttribute("aria-hidden", "true");
  Object.assign(flight.style, { left: target.x + "px", top: target.y + "px", width: target.width + "px", height: target.height + "px" });
  document.body.append(flight);
  const dx = origin.x + origin.width / 2 - target.x - target.width / 2;
  const dy = origin.y + origin.height / 2 - target.y - target.height / 2;
  const scale = Math.min(2.4, origin.height / target.height);
  const motion = flight.animate([
    { transform: `translate(${dx}px,${dy}px) rotate(-5deg) scale(${scale})`, opacity: .82 },
    { transform: "none", opacity: 1 },
  ], { duration: 270, easing: "cubic-bezier(.22,.72,.3,1)" });
  motion.onfinish = () => flight.remove();
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
    if (resolved && event.detail === 0 && !match.gameOver && !match.currentPlayer.isAI) {
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
  const panel = temp.closest(".player");
  panel.classList.toggle("chained", hasStatus(player, "행동 제한"));
  panel.classList.toggle("frosted", hasStatus(player, "동상"));
  if (playerReadings.get(panel) !== player.temp) {
    playerReadings.set(panel, player.temp);
    setText(temp, player.temp.toFixed(1) + "°C");
    temp.className = "temp" + (player.temp <= 30 ? " danger" : player.temp <= 34 ? " cold" : "");
    const percent = (player.temp - SETTINGS.lossTemp) / (SETTINGS.overheatTemp - SETTINGS.lossTemp) * 100;
    const fill = Math.max(0, Math.min(100, percent));
    get(prefix + "Bar").style.width = fill + "%";
    panel.style.setProperty("--reading", fill * 2.7 + "deg");
    panel.dataset.thermal = player.temp >= SETTINGS.reducedHealingTemp ? "hot" : player.temp <= 34 ? "cold" : "steady";
  }
  const takingTurn = !match.gameOver && !match.storm && match.currentPlayer?.name === player.name;
  panel.classList.toggle("taking-turn", takingTurn);
  setText(get(prefix + "Actions"), takingTurn
    ? remainingActions(player)
    : match.gameOver ? "게임 종료" : "차례 대기");
  setText(get(prefix + "Badge"), onlineSide ? (player.name === onlineSide ? "내 자리" : "상대 자리") : player.isAI ? "AI" : "플레이어");

  const statuses = get(prefix + "Status");
  const statusLabels = player.statuses.length ? player.statuses.map(status => status.name + " " + status.remaining) : ["상태 없음"];
  const statusLayout = statusLabels.join("|");
  if (statusLayouts.get(statuses) !== statusLayout) {
    statusLayouts.set(statuses, statusLayout);
    statuses.replaceChildren(...statusLabels.map((label, index) => {
      const status = player.statuses[index];
      const item = document.createElement("div");
      item.className = "status";
      if (!status) { setText(item, label); return item; }
      item.classList.add(isBuff(status.name) ? "benefit" : "penalty");
      const title = document.createElement("strong");
      setText(title, (isBuff(status.name) ? "＋ " : "− ") + label + "턴");
      let heading = title;
      if (status.name === "몸살") {
        item.classList.add("status-fever");
        heading = document.createElement("div");
        heading.className = "status-fever-heading";
        const warning = document.createElement("span");
        warning.className = "status-fever-warning";
        setText(warning, "피해 주의");
        heading.append(title, warning);
      }
      const effect = document.createElement("small");
      setText(effect, statusEffects[status.name] ?? status.name);
      item.append(heading, effect);
      return item;
    }));
  }

  const preview = get(prefix + "Next");
  if (player.isAI) setText(preview, "AI는 비공개");
  else if (onlineSide && player.name !== onlineSide) setText(preview, "상대 카드 비공개");
  else if (hasStatus(player, "실명")) setText(preview, "실명 상태: 다음 카드 확인 불가");
  else {
    const card = match.preview(player);
    if (!card) setText(preview, "없음");
    else if (preview.querySelector(":scope > img")?.dataset.card !== card.id) {
      const thumbnail = document.createElement("img");
      thumbnail.src = cardArtUrl(card);
      thumbnail.dataset.card = card.id;
      thumbnail.alt = "";
      thumbnail.draggable = false;
      const details = document.createElement("span");
      const name = document.createElement("strong");
      setText(name, card.name);
      const description = document.createElement("span");
      setText(description, card.desc);
      details.append(name, description);
      preview.replaceChildren(thumbnail, details);
    }
  }
}

const statusEffects = {
  "후공 보너스": "첫 차례에 상대 체온을 낮추는 카드 피해 +2°C",
  "보온": "받는 체온 피해 50% 감소", "옷 파손": "받는 체온 피해 25% 증가",
  "몸살": "받는 피해 50% 증가 · 회복량 25% 감소", "동상": "회복량 50% 감소",
  "핫팩": "내 차례 시작 시 +1°C", "선풍기": "내 차례 시작 시 −1°C",
  "행동 제한": "한 차례에 행동 1회", "회복 제한": "회복 카드 사용 불가", "실명": "다음 카드 비공개",
};

function remainingActions(player) {
  const limit = maxActions(player);
  return Math.max(0, limit - player.actionsUsed) + " / " + limit;
}

function renderHand(player) {
  const hand = get("hand");
  const active = ownsTurn();
  const owner = player.isAI ? "AI" : player.name;
  if (handOwner !== owner) {
    handOwner = owner;
    handSlots.length = 0;
    hand.replaceChildren();
  }

  if (player.isAI) {
    if (!hand.firstElementChild) {
      const waiting = document.createElement("div");
      waiting.className = "mini-card ai-hand-message";
      hand.append(waiting);
    }
    setText(hand.firstElementChild, match.gameOver ? "게임 종료" : "AI가 카드를 고르고 있습니다.");
    return;
  }

  for (let index = player.hand.length; index < handSlots.length; index++) handSlots[index]?.shell.remove();
  handSlots.length = player.hand.length;
  for (const [index, card] of player.hand.entries()) {
    const previous = handSlots[index];
    if (!card) {
      previous?.shell.remove();
      handSlots[index] = null;
      continue;
    }
    const pending = player.pending?.index === index;
    const reason = match.gameOver ? "게임 종료" : !active ? "상대 차례"
      : pending ? "카드 대기중" : player.pending ? "배치한 카드를 확정하거나 취소하세요." : legalCard(player, card);
    const enabled = !reason;
    if (previous?.card === card && previous.pending === pending && drawnSlot !== index) {
      if (previous.enabled !== enabled) {
        setCardEnabled(previous.shell, enabled);
        previous.enabled = enabled;
      }
      previous.reason = reason;
      continue;
    }
    const shell = document.createElement("div");
    shell.className = "card-shell asset-skin";
    shell.dataset.handIndex = index;
    if (drawnSlot === index) shell.classList.add("flip-enter");
    shell.setAttribute("role", "button");
    setCardEnabled(shell, enabled);

    if (pending) {
      shell.classList.add("waiting-card");
      shell.dataset.ariaLabel = "카드 대기중";
      shell.innerHTML = '<div class="card-flip"><div class="card-face card-front asset-card-front waiting-front">' +
        '<div class="asset-card-image waiting-asset-card"><div class="asset-card-symbol waiting-symbol">?</div></div>' +
        '</div><div class="card-face card-back">' + createCardBackHTML() + "</div></div>";
    } else {
      shell.dataset.ariaLabel = card.name + " · " + card.desc;
      shell.innerHTML = '<div class="card-flip">' + createAssetCardFaceHTML(card) +
        '<div class="card-face card-back">' + createCardBackHTML() + "</div></div>";
    }

    if (!pending) {
      shell.onclick = () => { if (shell.draggable) stageHumanCard(index); };
      shell.onkeydown = event => {
        if (!shell.draggable || (event.key !== "Enter" && event.key !== " ")) return;
        event.preventDefault();
        stageHumanCard(index, true);
      };
      shell.ondragstart = event => {
        if (!shell.draggable || !event.dataTransfer) return;
        event.dataTransfer.setData(dragType, String(index));
        event.dataTransfer.effectAllowed = "move";
        activeDrag = { index, session: match, ghost: createDragGhost(shell, event) };
        document.body.classList.add("is-dragging-card");
        const zone = get(playerPrefix(player) + "Slot").closest(".slot");
        zone.dataset.tone = cardTones[card.type];
        if (card.type === "스페셜") zone.dataset.special = card.id;
        zone.classList.add("drop-candidate");
        requestAnimationFrame(() => {
          if (activeDrag?.index === index && shell.isConnected) shell.classList.add("dragging");
        });
      };
      shell.ondragend = () => {
        shell.classList.remove("dragging");
        clearDragVisuals();
      };
    }
    applyLanguageToPage(shell);
    shell.setAttribute("aria-label", translateText(shell.dataset.ariaLabel));
    if (previous) previous.shell.replaceWith(shell);
    else hand.insertBefore(shell, handSlots.slice(index + 1).find(Boolean)?.shell ?? null);
    handSlots[index] = { card, pending, enabled, reason, shell };
  }
  drawnSlot = null;
}

function setCardEnabled(shell, enabled) {
  shell.classList.toggle("disabled", !enabled);
  shell.setAttribute("aria-disabled", String(!enabled));
  shell.tabIndex = 0;
  shell.draggable = enabled;
}

function renderCardDetails(focus = document.activeElement) {
  const shell = hoveredCard?.isConnected ? hoveredCard : focus?.closest?.("#hand .card-shell:focus-visible");
  const slot = handSlots.find(item => item && item.shell === shell) ?? handSlots.find(item => item?.pending);
  const details = get("cardDetails");
  const card = slot?.card;
  for (const item of handSlots) {
    item?.shell.classList.toggle("inspected", item === slot && !item.pending);
  }
  setFlag(details.dataset, "tone", card ? cardTones[card.type] : "neutral");
  setText(get("detailName"), card?.name ?? "카드 설명");
  setFlag(get("detailType"), "hidden", !card);
  setFlag(get("detailReason"), "hidden", !slot?.reason);
  if (card) setText(get("detailType"), card.type);
  if (slot?.reason) setText(get("detailReason"), slot.reason);
  setText(get("detailEffect"), card?.desc ?? "카드에 커서를 올리거나 Tab으로 설명을 확인하세요.");
}

const hand = get("hand");
hand.onpointerover = event => {
  if (event.pointerType === "touch") return;
  const shell = event.target.closest(".card-shell");
  if (shell === hoveredCard) return;
  hoveredCard = shell;
  renderCardDetails();
};
hand.onpointerout = event => {
  if (!hoveredCard || hoveredCard.contains(event.relatedTarget)) return;
  hoveredCard = null;
  renderCardDetails();
};
hand.addEventListener("focusin", event => {
  if (event.target.matches(":focus-visible")) hoveredCard = null;
  renderCardDetails();
});
hand.addEventListener("focusout", event => renderCardDetails(event.relatedTarget));

function renderSlot(player) {
  const slot = get(playerPrefix(player) + "Slot");
  const layout = JSON.stringify([player.usedThisTurn.map(card => card.id), player.pending?.card.id, player.pending?.index]);
  if (slotLayouts.get(slot) === layout) return;
  slotLayouts.set(slot, layout);
  if (player.pending) slot.parentElement.querySelector(".cast-seal")?.remove();
  document.querySelector(".placement-flight")?.remove();
  const cards = player.usedThisTurn.map(card => ({ card, pending: false }));
  if (player.pending) cards.push({ card: player.pending.card, pending: true });
  slot.replaceChildren(...cards.map(({ card, pending }) => {
    const tile = document.createElement("div");
    tile.className = "slot-card" + (pending ? " pending" : "");
    tile.dataset.tone = cardTones[card.type];
    if (card.type === "스페셜") tile.dataset.special = card.id;
    const label = document.createElement("span");
    setText(label, card.name + (pending ? " · 대기" : ""));
    if (pending) {
      const art = document.createElement("img");
      art.src = cardArtUrl(card);
      art.alt = "";
      tile.append(art);
      const detail = document.createElement("small");
      detail.className = "slot-card-detail";
      setText(detail, card.desc);
      label.append(detail);
    }
    tile.append(label);
    return tile;
  }));
  if (player.pending) slot.scrollTop = slot.scrollHeight;
}

function showPreviewSwap(player, event) {
  const replacement = cardById.get(event.replacementCard);
  if (!replacement || player.isAI || (onlineSide && player.name !== onlineSide) || hasStatus(player, "실명")) return;

  const preview = get(playerPrefix(player) + "Next");
  preview.querySelector(".preview-swap")?.remove();
  const effect = document.createElement("div");
  effect.className = "preview-swap";
  effect.setAttribute("role", "status");
  const art = document.createElement("span");
  art.className = "preview-swap-art";
  art.setAttribute("aria-hidden", "true");

  const previous = cardById.get(event.previousCard);
  for (const [card, phase] of [[previous, "outgoing"], [replacement, "incoming"]]) {
    if (!card) continue;
    const image = document.createElement("img");
    image.className = "preview-swap-" + phase;
    image.src = cardArtUrl(card);
    image.alt = "";
    art.append(image);
  }

  const detail = document.createElement("span");
  detail.className = "preview-swap-caption";
  const name = document.createElement("strong");
  const destination = document.createElement("small");
  setText(name, replacement.name);
  setText(destination, "교체 완료 · 손패에 추가");
  detail.append(name, destination);
  effect.append(art, detail);
  preview.append(effect);
  setTimeout(() => effect.remove(), 1800);
}

function stormDamageText(damage) {
  return "P1 −" + damage.P1 + "°C · P2 −" + damage.P2 + "°C";
}

function render() {
  if (!match) return;
  const storm = !match.gameOver && match.storm;
  get("stormNotice").hidden = !storm;
  Snowfall.update(Boolean(storm), match.stormElapsedMs);
  if (storm) {
    const approaching = storm === "approaching";
    const damage = match.stormDamage ?? Object.fromEntries(match.players.map(player => [player.name, GameRules.blizzardDamage(player)]));
    setText(get("stormText"), (approaching ? "예상 피해" : "적용 피해") + " · " + stormDamageText(damage));
  }
  const step = match.turn % SETTINGS.blizzardInterval;
  const gauge = get("blizzardGauge");
  const progress = (step / SETTINGS.blizzardInterval * 100) + "%";
  if (gauge.style.getPropertyValue("--blizzard-progress") !== progress) gauge.style.setProperty("--blizzard-progress", progress);
  setText(gauge.querySelector(".blizzard-label"), "Blizzard " + step + "/" + SETTINGS.blizzardInterval);
  const forecast = !match.gameOver && !storm && step === SETTINGS.blizzardInterval - 1;
  gauge.classList.toggle("forecast", forecast);
  setText(gauge.querySelector(".blizzard-sub"), forecast
    ? "다음 턴 시작 시 눈보라 · 체온에 따라 −1.5~−5.5°C"
    : match.blizzardCount + "회 발동");
  setText(get("turnInfo"), "인게임 턴 " + match.turn + " · " + match.starter + " 선공");

  for (const player of match.players) {
    renderPlayer(player);
    renderSlot(player);
    const swap = queuedSwaps.get(player.name);
    if (swap) showPreviewSwap(player, swap);
  }
  queuedSwaps.clear();

  const player = onlineSide ? match.players.find(side => side.name === onlineSide) : match.currentPlayer;
  const active = ownsTurn();
  const pending = active && player.pending;
  setFlag(get("handActions"), "hidden", !active);
  if (active) setText(get("handActions"), "남은 행동 " + remainingActions(player));
  setText(get("handTitle"), match.gameOver ? "게임 종료" : player.name + " 손패");
  setText(get("endBtn"), pending ? "카드 배치 확정" : "턴 종료");
  setFlag(get("endBtn"), "disabled", !active);
  get("endBtn").classList.toggle("confirm-ready", Boolean(pending));
  setFlag(get("cancelBtn"), "disabled", !pending);
  setFlag(get("restartBtn"), "hidden", Boolean(onlineSide));
  setFlag(get("endingRestartBtn"), "hidden", Boolean(onlineSide));
  setText(get("mainMenuBtn"), onlineSide && !match.gameOver ? "기권하고 나가기" : "메인화면으로");
  if (!active && !onlineSide && get("timer").textContent !== "–") get("timer").textContent = "–";
  renderHand(player);
  renderCardDetails();
  renderOnlineTurn();
  updateOnlineClock();
  if (logNeedsScroll) {
    const combatLog = get("log");
    combatLog.scrollTop = combatLog.scrollHeight;
    logNeedsScroll = false;
  }
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
  setText(burst, text);
  panel.appendChild(burst);
  setTimeout(() => burst.remove(), 1400);
}

function showCardCast(player, card) {
  const slot = get(playerPrefix(player) + "Slot").closest(".slot");
  const seal = document.createElement("div");
  seal.className = "cast-seal";
  seal.dataset.tone = cardTones[card.type];
  seal.setAttribute("aria-hidden", "true");
  const special = card.type === "스페셜";
  if (special) {
    seal.dataset.special = card.id;
    const emblem = document.createElement("span");
    emblem.className = "special-emblem";
    emblem.append(document.createElement("i"), document.createElement("b"));
    seal.append(emblem);
  } else {
    const art = document.createElement("img");
    art.src = cardArtUrl(card);
    art.alt = "";
    seal.append(art);
  }
  const title = document.createElement("strong");
  setText(title, card.name);
  seal.append(title);
  if (!reducedMotion.matches) {
    const sparks = document.createElement("span");
    sparks.className = "cast-sparks";
    for (let index = 0; index < (special ? 12 : 8); index++) {
      const pixel = document.createElement("i");
      const side = index % 2 === 0 ? -1 : 1;
      const lane = Math.floor(index / 2);
      pixel.style.left = (50 + side * (20 + lane % 3 * 10)) + "%";
      pixel.style.top = (22 + (lane * 19 + (side + 1) * 7) % 60) + "%";
      pixel.style.setProperty("--dx", side * (10 + lane * 2) + "px");
      pixel.style.setProperty("--dy", (card.type === "체온 상승" ? -15 : card.type === "체온 저하" ? 14 : lane % 2 ? 11 : -11) + "px");
      pixel.style.animationDelay = (lane * 35) + "ms";
      sparks.append(pixel);
    }
    seal.append(sparks);
  }
  slot.querySelector(".cast-seal")?.remove();
  slot.append(seal);
  setTimeout(() => seal.remove(), special ? 1550 : 1050);
}

function showThermalImpact(anchor, tone) {
  const impact = document.createElement("span");
  impact.className = "thermal-impact";
  impact.dataset.tone = tone;
  impact.setAttribute("aria-hidden", "true");
  for (let i = 0; i < 8; i++) {
    const shard = document.createElement("i");
    shard.style.setProperty("--angle", (i * 45 + 22.5) + "deg");
    impact.append(shard);
  }
  anchor.querySelector(".thermal-impact")?.remove();
  anchor.append(impact);
  setTimeout(() => impact.remove(), 800);
}

function showTempFloat(player, delta) {
  const panel = document.getElementById(playerPrefix(player) + "Temp")?.closest(".player");
  if (!panel) return;

  if (delta && !reducedMotion.matches) showThermalImpact(panel.querySelector(".bar-inner"), delta > 0 ? "heat" : "ice");
  const floatEl = document.createElement("div");
  if (delta === 0) {
    floatEl.className = "temp-float no-change";
    setText(floatEl, "변화없음");
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
  if (statusName === "몸살" && effectKind === "debuff") {
    pop.classList.add("fever-warning");
    setText(pop, "몸살 · 피해 주의");
  } else {
    setText(pop, `${effectKind === "buff" ? "BUFF" : effectKind === "debuff" ? "DEBUFF" : "EFFECT"} · ${statusName}`);
  }
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
  applyLanguageToPage(overlay);
  setTimeout(() => overlay.remove(), 2400);
}

function showEndingScene(winner, both, forfeited) {
  const name = winner === "P1" ? "P2" : "P1";
  setText(get("endingTitle"), winner === "P1" ? "P1이 승리하였습니다!"
    : winner === "P2" ? "P2가 승리하였습니다!" : "무승부입니다!");
  setText(get("endingSub"), forfeited ? forfeited + " 기권"
    : winner === "DRAW" ? "양쪽 모두 같은 체온으로 한계선 아래에 도달했습니다."
    : both ? name + "의 체온이 더 낮았습니다." : name + "가 저체온 상태에 도달했습니다.");
  document.body.classList.add("game-not-started");
  document.querySelector(".wrap").classList.remove("fullscreen-game");
  get("endingScreen").classList.add("show");
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
  const visual = `<img class="custom-card-asset" src="${cardArtUrl(card)}" alt="" draggable="false">`;

  return `
    <div class="card-face card-front asset-card-front">
      <div class="asset-card-image ${getCardAssetClass(card)} has-custom-asset">${visual}</div>
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
    delete el.dataset.tone;
    delete el.dataset.special;
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
