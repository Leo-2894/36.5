"use strict";

(() => {
  const find = id => document.getElementById(id);
  const channel = "36.5-card-effects";
  const { cards, Match } = GameRules;
  const byId = new Map(cards.map(card => [card.id, card]));
  const art = card => "assets/cards/" + card.id + ".png";
  const signed = temp => (temp > 0 ? "+" : "") + temp + "°C";
  const stage = find("effectStage");

  if (stage) {
    const types = ["전체", ...new Set(cards.map(card => card.type))];
    const filters = find("typeFilters");
    const catalog = find("cardCatalog");
    const search = find("cardSearch");
    const caster = find("caster");
    const outcome = find("outcome");
    const applyStatus = find("applyStatus");
    const monitor = find("monitorState");
    const play = find("playEffect");
    const reset = find("resetStage");
    let selected = byId.get("swap") ?? cards[0];
    let filter = "전체";
    let ready = false;

    function send(action) {
      if (!ready) return;
      stage.contentWindow.postMessage({
        channel, action, card: selected.id, caster: caster.value,
        outcome: outcome.selectedIndex, applyStatus: applyStatus.checked,
      }, "*");
      monitor.textContent = action === "play" ? "재생 중" : "재생 대기";
    }

    function showSelection() {
      find("selectedArt").src = art(selected);
      const type = find("selectedType");
      type.textContent = selected.type;
      type.dataset.type = selected.type;
      find("selectedTitle").textContent = selected.name;
      find("selectedDescription").textContent = selected.desc;

      const choices = selected.target === "random"
        ? ["상대 피격", "자신 피격"]
        : (selected.outcomes ?? []).map(signed);
      outcome.replaceChildren(...choices.map(label => new Option(label)));
      outcome.hidden = find("outcomeLabel").hidden = choices.length === 0;
      if (selected.id === "hot-air-blower") outcome.selectedIndex = choices.length - 1;
      find("statusOption").hidden = !selected.chance;
      find("statusLabel").textContent = selected.chance ? selected.status + " 발동" : "";
      applyStatus.checked = true;

      for (const button of catalog.children) {
        button.setAttribute("aria-pressed", String(button.dataset.card === selected.id));
      }
      send("reset");
    }

    function filterCards() {
      const query = search.value.trim().toLowerCase().replace(/\s/g, "");
      let count = 0;
      for (const button of catalog.children) {
        const card = byId.get(button.dataset.card);
        const name = card.name.toLowerCase().replace(/\s/g, "");
        button.hidden = (filter !== "전체" && card.type !== filter) || !name.includes(query);
        if (!button.hidden) count++;
      }
      find("cardCount").textContent = count === cards.length ? cards.length + "종" : count + " / " + cards.length;
      find("emptyCards").hidden = count > 0;
    }

    for (const type of types) {
      const button = document.createElement("button");
      button.type = "button";
      button.textContent = type;
      button.dataset.type = type;
      button.setAttribute("aria-pressed", String(type === filter));
      button.onclick = () => {
        filter = type;
        for (const chip of filters.children) chip.setAttribute("aria-pressed", String(chip === button));
        filterCards();
      };
      filters.append(button);
    }

    for (const card of cards) {
      const button = document.createElement("button");
      button.type = "button";
      button.className = "catalog-card";
      button.dataset.card = card.id;
      button.dataset.type = card.type;
      const image = document.createElement("img");
      image.src = art(card);
      image.loading = "lazy";
      image.alt = "";
      image.width = 48;
      image.height = 77;
      const name = document.createElement("span");
      name.textContent = card.name;
      button.append(image, name);
      button.onclick = () => {
        selected = card;
        showSelection();
        if (play.getBoundingClientRect().top < 0) {
          stage.closest(".review-workspace").scrollIntoView({ block: "start" });
        }
      };
      catalog.append(button);
    }

    window.addEventListener("message", event => {
      if (event.source !== stage.contentWindow || event.origin !== "null" || event.data?.channel !== channel) return;
      if (event.data.action === "ready") {
        ready = true;
        play.disabled = reset.disabled = false;
        send("reset");
      } else if (event.data.action === "complete") {
        monitor.textContent = "재생 완료";
      }
    });
    search.addEventListener("input", filterCards);
    caster.addEventListener("change", () => send("reset"));
    play.onclick = () => send("play");
    reset.onclick = () => send("reset");
    filterCards();
    showSelection();
    if (location.protocol === "file:") stage.src = "index.html#card-effects-preview";
    else monitor.textContent = "HTML 파일을 직접 열어 주세요";
    return;
  }

  if (location.protocol !== "file:" || location.hash !== "#card-effects-preview" || window.parent === window) return;
  const stylesheet = document.createElement("link");
  stylesheet.rel = "stylesheet";
  stylesheet.href = "card-effects-review.css";
  document.body.classList.add("fx-preview-stage");
  language = "ko";
  applyLanguageToPage();
  const report = action => window.parent.postMessage({ channel, action }, "*");
  let placementTimer;
  let playbackTimer;

  window.addEventListener("message", event => {
    if (event.source !== window.parent || event.origin !== "null" || event.data?.channel !== channel) return;
    const { action, card: id, caster, outcome, applyStatus } = event.data;
    const card = byId.get(id);
    if (!card || !["reset", "play"].includes(action) || !["P1", "P2"].includes(caster)) return;

    clearTimeout(placementTimer);
    clearTimeout(playbackTimer);
    resetMatch();
    find("battleWave").getAnimations().forEach(animation => animation.cancel());
    revealBoard({ music: false });

    match = new Match({ starter: caster, aiPlayer: null, random: () => .57 });
    match.start();
    const user = match.currentPlayer;
    for (const player of match.players) player.statuses = [];
    user.hand = [card];
    user.deck = ["ice-bottle", "shaved-ice", "water-gun"].map(id => byId.get(id));
    if (card.removeDebuff) match.applyStatus(user, "동상", 2);
    const options = card.outcomes?.length ?? 2;
    const selectedOutcome = Number.isInteger(outcome) && outcome >= 0 && outcome < options ? outcome : 0;
    const rolls = [(selectedOutcome + .5) / options, applyStatus ? 0 : .99];
    match.random = () => rolls.shift() ?? .57;
    match.onEvent = handleEvent;
    render();
    find("hand").inert = true;

    if (action === "play") {
      const origin = find("hand").firstElementChild.getBoundingClientRect();
      if (!match.stage(0)) return;
      render();
      animatePlacement(origin, find(caster.toLowerCase() + "Slot").querySelector(".pending img"));
      placementTimer = setTimeout(() => {
        match.confirm();
        render();
        playbackTimer = setTimeout(() => report("complete"), 2300);
      }, reducedMotion.matches ? 0 : 280);
    }
  });

  stylesheet.addEventListener("load", () => report("ready"), { once: true });
  document.head.append(stylesheet);
})();
