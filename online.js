"use strict";

const Online = (() => {
  const dialog = get("onlineLobby");
  const hosted = location.protocol === "http:" || location.protocol === "https:";
  const savedKey = "36.5.invite-session";
  const roomPattern = /^[2-9A-HJ-NP-Z]{6}$/;
  const modeTitles = { lan: "같은 네트워크", internet: "다른 네트워크" };
  const query = new URLSearchParams(location.search);
  const readMode = value => Object.hasOwn(modeTitles, value) ? value : null;
  const expectedMode = readMode(query.get("mode"));
  const fromDesktop = hosted && query.get("desktop") === "1";
  const errorMessages = {
    ROOM_MISSING: "방을 찾을 수 없습니다. 초대 코드와 서버 주소를 확인하세요.",
    ROOM_FULL: "이미 두 사람이 참가한 방입니다.",
    SERVER_FULL: "서버의 대기실이 가득 찼습니다. 잠시 뒤 다시 시도하세요.",
    STALE_ACTION: "경기가 갱신되었습니다. 현재 차례를 확인하세요.",
    INVALID_ACTION: "지금은 이 행동을 할 수 없습니다.",
    UNAUTHORIZED: "방 접속 정보가 만료되었습니다.",
    MATCH_UNAVAILABLE: "이 방에서는 지금 이 행동을 할 수 없습니다.",
  };
  let session = null;
  let pollTimer = null;
  let inviteTimer = null;
  let inviteState = null;
  let lanAddresses = [];
  let busy = false;
  let selectedMode = hosted ? expectedMode : null;
  let serverModeMismatch = false;
  const mismatchMessage = "선택한 네트워크 모드와 주소가 다릅니다. 친구가 보낸 초대 링크와 모드를 확인하세요.";
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(location.hostname);
  let inviteOrigin = hosted && !loopback ? location.origin : null;

  function request(path, { token, body, keepalive = false, signal } = {}) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    const timeout = AbortSignal.timeout(6500);
    return fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
      keepalive,
    }).then(async response => {
      if (response.status === 204) return null;
      if (!response.ok) {
        const data = await response.json().catch(() => null);
        throw Object.assign(new Error("Online request failed"), { code: data?.error });
      }
      return response.json();
    });
  }

  function roomPath(room, suffix = "") {
    return "/api/rooms/" + room.code + suffix;
  }

  function message(text) {
    setText(get("onlineMessage"), text);
  }

  function enableLobbyButtons(enabled) {
    for (const button of dialog.querySelectorAll("button")) button.disabled = !enabled;
    get("copyInviteBtn").disabled = !enabled || !get("inviteLink").value;
  }

  function errorMessage(error) {
    return errorMessages[error.code] ?? "서버에 연결할 수 없습니다. 주소와 연결을 확인하세요.";
  }

  function remember(room) {
    try {
      if (room) sessionStorage.setItem(savedKey, JSON.stringify({ code: room.code, token: room.token }));
      else sessionStorage.removeItem(savedKey);
    } catch {}
  }

  function storedSession() {
    try {
      const room = JSON.parse(sessionStorage.getItem(savedKey));
      return roomPattern.test(room?.code) && /^[\w-]{32}$/.test(room?.token) ? room : null;
    } catch { return null; }
  }

  function updateRoomCode(code) {
    const url = new URL(location.href);
    if (code) url.searchParams.set("room", code);
    else url.searchParams.delete("room");
    if (url.href !== location.href) history.replaceState(null, "", url);
    get("inviteCode").value = code ?? "";
  }

  function inviteLink() {
    if (!session || session.playing) return;
    const selector = get("lanAddress");
    get("lanAddressPicker").hidden = selectedMode !== "lan" || lanAddresses.length < 2;
    const output = get("inviteLink");
    output.value = "";
    const address = selectedMode === "lan" ? selector.value || inviteOrigin : inviteOrigin;
    if (!address) {
      get("copyInviteBtn").disabled = true;
      return;
    }
    const url = new URL("/", address);
    url.searchParams.set("room", session.code);
    if (selectedMode) url.searchParams.set("mode", selectedMode);
    output.value = url.href;
    get("copyInviteBtn").disabled = busy;
  }

  function showInviteStatus(room) {
    const status = get("inviteStatus");
    status.hidden = !["preparing", "failed"].includes(inviteState);
    if (inviteState === "failed") {
      setText(status, "공개 주소를 열지 못했습니다. 돌아가서 방 만들기를 다시 눌러 주세요.");
    } else if (inviteState === "preparing") {
      setText(status, "방이 생성되었습니다. 공개 주소 연결이 확인되면 링크를 복사할 수 있습니다.");
    }
    clearTimeout(inviteTimer);
    if (inviteState !== "preparing") return;
    inviteTimer = setTimeout(async () => {
      try {
        const info = await request("/api/info");
        if (session !== room || room.playing) return;
        inviteOrigin = info.origin ?? inviteOrigin;
        inviteState = info.inviteState ?? null;
        inviteLink();
      } catch {
        if (session !== room || room.playing) return;
      }
      showInviteStatus(room);
    }, 900);
  }

  function syncReadyButton() {
    const button = get("lobbyReadyBtn");
    const ready = session?.ownReady ?? false;
    button.disabled = busy || session?.phase !== "lobby" || session.sending;
    button.setAttribute("aria-pressed", String(ready));
    setText(button, ready ? "준비 취소" : "준비 완료");
  }

  function showWaiting(room, state) {
    const inLobby = state.phase === "lobby";
    const segmentWasHidden = get("matchLobby").hidden;
    get("onlineChoices").hidden = true;
    get("waitingRoom").hidden = inLobby;
    get("matchLobby").hidden = !inLobby;
    get("onlineIntro").hidden = inLobby;
    setText(get("onlineTitle"), inLobby ? "대전 대기실" : modeTitles[selectedMode] ?? "온라인 1대1");
    message("");
    if (!inLobby) {
      get("roomCode").textContent = room.code;
      inviteLink();
      showInviteStatus(room);
      return;
    }
    clearTimeout(inviteTimer);
    for (const [index, row] of [get("lobbyP1"), get("lobbyP2")].entries()) {
      const side = index === 0 ? "P1" : "P2";
      const ready = state.ready[index];
      setText(row.querySelector("strong"), side + " · " + (state.side === side ? "내 자리" : "상대 자리"));
      setText(row.querySelector("span"), ready ? "준비 완료" : "준비 중");
      row.classList.toggle("is-ready", ready);
    }
    room.ownReady = state.ready[state.side === "P1" ? 0 : 1];
    syncReadyButton();
    if (segmentWasHidden && !busy) get("lobbyReadyBtn").focus();
  }

  function openLobby() {
    setText(get("onlineTitle"), modeTitles[selectedMode] ?? "온라인 1대1");
    get("onlineModes").hidden = hosted || Boolean(selectedMode);
    get("onlineDesktop").hidden = hosted || !selectedMode;
    get("hostModeBtn").hidden = !window.desktopOnline;
    get("internetHelp").hidden = !window.desktopOnline || selectedMode !== "internet";
    get("onlineChoices").hidden = !hosted || Boolean(session) || serverModeMismatch;
    get("waitingRoom").hidden = session?.phase !== "waiting";
    get("matchLobby").hidden = session?.phase !== "lobby";
    get("onlineIntro").hidden = session?.phase === "lobby";
    if (!dialog.open) dialog.showModal();
    if (!session) message(serverModeMismatch ? mismatchMessage : "");
    if (hosted && !serverModeMismatch && get("inviteCode").value) get("inviteCode").focus();
  }

  function selectMode(mode) {
    selectedMode = mode;
    get("serverForm").reset();
    get("serverAddress").placeholder = mode === "lan" ? "http://192.168.0.10:3650" : "https://…";
    openLobby();
    (window.desktopOnline ? get("hostModeBtn") : get("serverAddress")).focus();
  }

  function forget(room = session) {
    if (session !== room) return;
    clearTimeout(pollTimer);
    clearTimeout(inviteTimer);
    room?.pollController?.abort();
    session = null;
    remember(null);
    if (room) updateRoomCode(null);
  }

  function leave() {
    const room = session;
    if (!room) return;
    forget(room);
    request(roomPath(room, "/leave"), { token: room.token, body: {}, keepalive: true }).catch(() => {});
  }

  function dismiss() {
    if (busy) return;
    if (!hosted && selectedMode) {
      const button = selectedMode === "lan" ? "chooseLanMode" : "chooseInternetMode";
      selectedMode = null;
      openLobby();
      get(button).focus();
      return;
    }
    leave();
    dialog.close();
    if (!backToDesktop()) get("onlineBtn").focus();
  }

  function backToDesktop() {
    if (!fromDesktop || history.length <= 1) return false;
    history.back();
    return true;
  }

  function applyState(room, data, requestMs) {
    if (!data || session !== room || data.version <= room.version) return;
    const previousPhase = room.phase;
    room.phase = data.phase;
    room.version = data.version;
    const restoring = room.restoring;
    room.restoring = false;
    if (data.phase === "waiting" || data.phase === "lobby") {
      room.lobbyId = data.lobbyId;
      showWaiting(room, data);
      return;
    }

    const actionVersion = data.actionVersion ?? data.version;
    const gameplayChanged = !room.playing || room.actionVersion !== actionVersion || previousPhase !== data.phase;
    room.actionVersion = actionVersion;
    if (dialog.open) dialog.close();
    clearTimeout(inviteTimer);
    room.playing = true;
    room.finished = data.phase === "finished";
    if (room.finished) room.pollController?.abort();
    const events = data.events.filter(event => event.id > room.eventId);
    if (events.length) room.eventId = events.at(-1).id;
    if (gameplayChanged) receiveOnlineState(data, events, requestMs, restoring);
    else if (!restoring) for (const event of events) {
      if (event.type === "emote") showReaction(event.from, event.emote);
    }
  }

  function schedulePoll(room, delay = 650) {
    if (session !== room || room.finished) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => poll(room), delay);
  }

  async function poll(room) {
    if (session !== room || room.pollController) return;
    const controller = new AbortController();
    room.pollController = controller;
    const sent = performance.now();
    let delay = 0;
    try {
      const data = await request(roomPath(room) + "?after=" + room.version + "&event=" + room.eventId + "&wait=1", {
        token: room.token, signal: controller.signal,
      });
      if (session !== room || controller.signal.aborted) return;
      if (room.offline) {
        if (room.playing) setOnlineNotice("");
        else message("");
        room.offline = false;
      }
      // An immediate empty reply can come from an older server without long polling.
      if (!data && performance.now() - sent < 350) delay = 650;
      applyState(room, data, 0);
    } catch (error) {
      if (session !== room || controller.signal.aborted) return;
      if (["ROOM_MISSING", "UNAUTHORIZED"].includes(error.code)) {
        forget(room);
        if (room.playing) returnToMainMenu();
        openLobby();
        message(errorMessage(error));
        return;
      }
      delay = 1250;
      room.offline = true;
      if (room.playing) setOnlineNotice("연결을 다시 시도하는 중…");
      else message("연결을 다시 시도하는 중…");
    } finally {
      room.pollController = null;
      schedulePoll(room, delay);
    }
  }

  function startSession(credentials, data, requestMs = 0) {
    const room = { ...credentials, version: 0, eventId: 0, playing: false, finished: false, sending: false, restoring: !data };
    session = room;
    remember(room);
    updateRoomCode(room.code);
    applyState(room, data, requestMs);
    schedulePoll(room, 0);
  }

  async function lobbyRequest(operation) {
    if (busy || session) return;
    message("");
    busy = true;
    enableLobbyButtons(false);
    try { await operation(); }
    catch (error) { message(errorMessage(error)); }
    finally {
      busy = false;
      enableLobbyButtons(true);
      syncReadyButton();
      if (session?.phase === "lobby") get("lobbyReadyBtn").focus();
    }
  }

  async function action(type, detail = {}) {
    const room = session;
    const ready = type === "ready";
    const emote = type === "emote";
    const pending = emote ? "reacting" : "sending";
    if (!room || room.finished || room[pending] || (ready ? room.phase !== "lobby" : !room.playing)) return false;
    room[pending] = true;
    if (ready) syncReadyButton();
    const sent = performance.now();
    try {
      const state = await request(roomPath(room, "/action") + "?event=" + room.eventId, {
        token: room.token, body: { type, ...detail, version: room.actionVersion, lobbyId: room.lobbyId },
      });
      if (session !== room) return false;
      if (!ready && !emote) setOnlineNotice("");
      applyState(room, state, performance.now() - sent);
      return true;
    } catch (error) {
      if (session === room) {
        if (ready && !room.playing) message(errorMessage(error));
        else if (!emote) setOnlineNotice(error.code === "OPPONENT_TURN" ? "상대 차례" : errorMessage(error));
        room.pollController?.abort();
        schedulePoll(room, 0);
      }
      return false;
    } finally {
      room[pending] = false;
      if (ready) syncReadyButton();
    }
  }

  function inviteUrl(value) {
    const normalized = value.trim();
    const scheme = selectedMode === "internet" ? "https://" : "http://";
    const url = new URL(/^[a-z]+:\/\//i.test(normalized) ? normalized : scheme + normalized);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    if (selectedMode === "lan" && !url.port && normalized === url.hostname) url.port = "3650";
    return url;
  }

  get("onlineBtn").onclick = openLobby;
  get("chooseLanMode").onclick = () => selectMode("lan");
  get("chooseInternetMode").onclick = () => {
    selectMode("internet");
    window.desktopOnline?.prepareInternet?.().catch(() => {});
  };
  get("closeOnlineBtn").onclick = dismiss;
  dialog.oncancel = event => { event.preventDefault(); dismiss(); };
  window.addEventListener("pageshow", event => {
    if (event.persisted && !hosted && dialog.open) {
      selectedMode = null;
      openLobby();
    }
  });

  const startDesktopHost = mode => lobbyRequest(async () => {
    const internet = mode === "internet";
    if (internet) message("인터넷 초대 주소를 만드는 중입니다…");
    try {
      const address = await window.desktopOnline.startHost(mode);
      location.assign(new URL("/?online=host&desktop=1&mode=" + mode, address));
    } catch {
      message(internet ? "인터넷 초대 주소를 만들지 못했습니다. 인터넷 연결을 확인한 뒤 다시 시도하세요."
        : "이 PC에서 같은 네트워크 방을 열지 못했습니다. 네트워크 연결을 확인해 주세요.");
    }
  });
  get("hostModeBtn").onclick = () => startDesktopHost(selectedMode);

  get("serverAddress").oninput = event => {
    try {
      const code = inviteUrl(event.target.value).searchParams.get("room")?.toUpperCase();
      if (roomPattern.test(code)) get("serverCode").value = code;
    } catch {}
  };

  get("serverForm").onsubmit = event => {
    event.preventDefault();
    try {
      const url = inviteUrl(get("serverAddress").value);
      const linkMode = readMode(url.searchParams.get("mode"));
      if (linkMode && linkMode !== selectedMode) {
        message(mismatchMessage);
        return;
      }
      if (selectedMode === "internet" && url.protocol !== "https:") {
        message("다른 네트워크 모드에서는 HTTPS 초대 링크를 사용하세요.");
        return;
      }
      const code = (get("serverCode").value.trim() || url.searchParams.get("room"))?.toUpperCase();
      if (!roomPattern.test(code)) {
        message("초대 코드 6자리를 확인하세요.");
        get("serverCode").focus();
        return;
      }
      const target = new URL("/", url.origin);
      target.searchParams.set("room", code);
      target.searchParams.set("mode", selectedMode);
      target.searchParams.set("join", "1");
      if (window.desktopOnline) target.searchParams.set("desktop", "1");
      location.assign(target);
    } catch { message("올바른 서버 주소 또는 초대 링크를 입력하세요."); }
  };

  function createRoom() {
    return lobbyRequest(async () => {
      await serverInfo;
      if (serverModeMismatch) {
        message(mismatchMessage);
        return;
      }
      const sent = performance.now();
      const result = await request("/api/rooms", { body: {} });
      startSession({ token: result.token, code: result.state.code }, result.state, performance.now() - sent);
    });
  }

  get("createRoomBtn").onclick = createRoom;
  get("lobbyReadyBtn").onclick = () => action("ready", { ready: !session?.ownReady });
  get("lanAddress").onchange = inviteLink;
  get("joinForm").onsubmit = event => {
    event.preventDefault();
    joinRoom(get("inviteCode").value.trim().toUpperCase());
  };

  function joinRoom(code) {
    if (!roomPattern.test(code)) {
      message("초대 코드 6자리를 확인하세요.");
      return;
    }
    lobbyRequest(async () => {
      await serverInfo;
      if (serverModeMismatch) {
        message(mismatchMessage);
        return;
      }
      const sent = performance.now();
      const result = await request(roomPath({ code }, "/join"), { body: {} });
      startSession({ token: result.token, code }, result.state, performance.now() - sent);
    });
  }

  get("copyInviteBtn").onclick = async () => {
    const input = get("inviteLink");
    let copied = false;
    try {
      await navigator.clipboard.writeText(input.value);
      copied = true;
    } catch {
      input.select();
      copied = document.execCommand("copy");
    }
    message(copied ? "초대 링크를 복사했습니다." : "선택된 초대 링크를 복사해 친구에게 보내세요.");
  };

  const serverInfo = hosted ? request("/api/info").then(info => {
    const mode = readMode(info.mode);
    serverModeMismatch = Boolean(mode && expectedMode && mode !== expectedMode);
    if (serverModeMismatch) {
      get("onlineChoices").hidden = true;
      message(mismatchMessage);
      return;
    }
    selectedMode = mode ?? expectedMode;
    setText(get("onlineTitle"), modeTitles[selectedMode] ?? "온라인 1대1");
    lanAddresses = [...new Set(info.addresses ?? [])];
    get("lanAddress").replaceChildren(...lanAddresses.map(address => new Option(address, address)));
    inviteOrigin = info.origin ?? lanAddresses[0] ?? inviteOrigin;
    inviteState = info.inviteState ?? null;
    inviteLink();
  }).catch(() => {}) : null;
  if (hosted) {
    const code = query.get("room")?.toUpperCase();
    if (roomPattern.test(code)) get("inviteCode").value = code;
    if (query.has("online") || code) openLobby();
    const saved = storedSession();
    if (saved && (!code || code === saved.code) && query.get("online") !== "host") {
      openLobby();
      get("onlineChoices").hidden = true;
      message("방에 다시 연결하는 중…");
      serverInfo.then(() => {
        if (!serverModeMismatch && dialog.open) startSession(saved);
      });
    } else if (query.get("online") === "host") {
      // Consume this flag before reloading or restoring the room from the same tab.
      query.set("online", "1");
      history.replaceState(null, "", "/?" + query);
      serverInfo.then(createRoom);
    } else if (query.get("join") === "1" && roomPattern.test(code)) {
      query.delete("join");
      history.replaceState(null, "", "/?" + query);
      joinRoom(code);
    }
  } else if (query.get("online") === "tunnel-closed") {
    selectMode("internet");
    message("인터넷 초대 연결이 종료되었습니다. 새 방을 만들어 주세요.");
  }

  return { action, leave, backToDesktop };
})();

