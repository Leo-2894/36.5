"use strict";

const Online = (() => {
  const dialog = get("onlineLobby");
  const hosted = location.protocol === "http:" || location.protocol === "https:";
  const savedKey = "36.5.invite-session";
  const roomPattern = /^[2-9A-HJ-NP-Z]{6}$/;
  const errorMessages = {
    ROOM_MISSING: "방을 찾을 수 없습니다. 초대 코드와 서버 주소를 확인하세요.",
    ROOM_FULL: "이미 두 사람이 참가한 방입니다.",
    SERVER_FULL: "서버의 대기실이 가득 찼습니다. 잠시 뒤 다시 시도하세요.",
    STALE_ACTION: "경기가 갱신되었습니다. 현재 차례를 확인하세요.",
    INVALID_ACTION: "지금은 이 행동을 할 수 없습니다.",
    UNAUTHORIZED: "방 접속 정보가 만료되었습니다.",
  };
  let session = null;
  let pollTimer = null;
  let busy = false;
  let inviteOrigin = location.origin;

  function request(path, { token, body, keepalive = false } = {}) {
    const headers = {};
    if (token) headers.Authorization = "Bearer " + token;
    if (body !== undefined) headers["Content-Type"] = "application/json";
    return fetch(path, {
      method: body === undefined ? "GET" : "POST",
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      cache: "no-store",
      signal: AbortSignal.timeout(6500),
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
    get("onlineMessage").textContent = text;
    applyLanguageToPage();
  }

  function enableLobbyButtons(enabled) {
    for (const button of dialog.querySelectorAll("button")) button.disabled = !enabled;
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

  function inviteLink() {
    if (!session || session.playing) return;
    const url = new URL("/", inviteOrigin);
    url.searchParams.set("room", session.code);
    get("inviteLink").value = url.href;
  }

  function showWaiting() {
    get("onlineChoices").hidden = true;
    get("waitingRoom").hidden = false;
    get("roomCode").textContent = session.code;
    inviteLink();
    message("");
  }

  function openLobby() {
    get("onlineDesktop").hidden = hosted;
    get("hostOnDesktopBtn").hidden = !window.desktopOnline;
    get("onlineChoices").hidden = !hosted || Boolean(session);
    get("waitingRoom").hidden = !session || session.playing;
    if (!dialog.open) dialog.showModal();
    if (!session) message("");
    if (hosted && get("inviteCode").value) get("inviteCode").focus();
  }

  function forget(room = session) {
    if (session !== room) return;
    clearTimeout(pollTimer);
    session = null;
    remember(null);
  }

  function leave() {
    const room = session;
    if (!room) return;
    forget(room);
    request(roomPath(room, "/leave"), { token: room.token, body: {}, keepalive: true }).catch(() => {});
  }

  function dismiss() {
    if (busy) return;
    leave();
    dialog.close();
    get("onlineBtn").focus();
  }

  function applyState(room, data, requestMs) {
    if (!data || session !== room || data.version <= room.version) return;
    room.version = data.version;
    if (data.phase === "waiting") {
      showWaiting();
      return;
    }

    if (dialog.open) dialog.close();
    room.playing = true;
    room.finished = data.phase === "finished";
    const events = data.events.filter(event => event.id > room.eventId);
    if (events.length) room.eventId = events.at(-1).id;
    receiveOnlineState(data, events, requestMs);
  }

  function schedulePoll(room, delay = 650) {
    if (session !== room || room.finished) return;
    clearTimeout(pollTimer);
    pollTimer = setTimeout(() => poll(room), delay);
  }

  async function poll(room) {
    if (session !== room || room.polling) return;
    room.polling = true;
    const sent = performance.now();
    let delay = 650;
    try {
      const data = await request(roomPath(room) + "?after=" + room.version, { token: room.token });
      if (session !== room) return;
      if (room.offline) {
        if (room.playing) setOnlineNotice("");
        else message("");
        room.offline = false;
      }
      applyState(room, data, performance.now() - sent);
    } catch (error) {
      if (session !== room) return;
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
      room.polling = false;
      schedulePoll(room, delay);
    }
  }

  function startSession(credentials, data, requestMs = 0) {
    const room = { ...credentials, version: 0, eventId: 0, playing: false, finished: false, sending: false };
    session = room;
    remember(room);
    applyState(room, data, requestMs);
    schedulePoll(room, data ? 350 : 0);
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
    }
  }

  async function action(type, detail = {}) {
    const room = session;
    if (!room?.playing || room.finished || room.sending) return false;
    room.sending = true;
    const sent = performance.now();
    try {
      const state = await request(roomPath(room, "/action"), {
        token: room.token, body: { type, ...detail, version: room.version },
      });
      if (session !== room) return false;
      setOnlineNotice("");
      applyState(room, state, performance.now() - sent);
      return true;
    } catch (error) {
      if (session === room) {
        setOnlineNotice(error.code === "OPPONENT_TURN" ? "상대 차례" : errorMessage(error));
        if (!room.polling) schedulePoll(room, 0);
      }
      return false;
    } finally {
      room.sending = false;
    }
  }

  function normalizeServer(value) {
    const normalized = value.trim();
    const url = new URL(/^[a-z]+:\/\//i.test(normalized) ? normalized : "http://" + normalized);
    if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) throw new Error();
    const target = new URL("/", url.origin);
    const code = url.searchParams.get("room")?.toUpperCase();
    if (roomPattern.test(code)) target.searchParams.set("room", code);
    target.searchParams.set("online", "1");
    return target;
  }

  get("onlineBtn").onclick = openLobby;
  get("closeOnlineBtn").onclick = dismiss;
  dialog.oncancel = event => { event.preventDefault(); dismiss(); };

  get("hostOnDesktopBtn").onclick = () => lobbyRequest(async () => {
    try {
      const address = await window.desktopOnline.startHost();
      location.assign(new URL("/?online=host", address));
    } catch {
      message("이 PC에서 서버를 시작할 수 없습니다. 3650 포트가 사용 중인지 확인하세요.");
    }
  });

  get("serverForm").onsubmit = event => {
    event.preventDefault();
    try { location.assign(normalizeServer(get("serverAddress").value)); }
    catch { message("올바른 서버 주소 또는 초대 링크를 입력하세요."); }
  };

  function createRoom() {
    return lobbyRequest(async () => {
      const sent = performance.now();
      const result = await request("/api/rooms", { body: {} });
      startSession({ token: result.token, code: result.state.code }, result.state, performance.now() - sent);
    });
  }

  get("createRoomBtn").onclick = createRoom;
  get("joinForm").onsubmit = event => {
    event.preventDefault();
    const code = get("inviteCode").value.trim().toUpperCase();
    if (!roomPattern.test(code)) {
      message("초대 코드 6자리를 확인하세요.");
      return;
    }
    lobbyRequest(async () => {
      const sent = performance.now();
      const result = await request(roomPath({ code }, "/join"), { body: {} });
      startSession({ token: result.token, code }, result.state, performance.now() - sent);
    });
  };

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

  if (hosted) {
    request("/api/info").then(info => {
      inviteOrigin = info.origin ?? info.addresses[0] ?? location.origin;
      inviteLink();
    }).catch(() => {});
    const query = new URLSearchParams(location.search);
    const code = query.get("room")?.toUpperCase();
    if (roomPattern.test(code)) get("inviteCode").value = code;
    if (query.has("online") || code) openLobby();
    const saved = storedSession();
    if (saved && (!code || code === saved.code) && query.get("online") !== "host") {
      openLobby();
      get("onlineChoices").hidden = true;
      message("방에 다시 연결하는 중…");
      startSession(saved);
    } else if (query.get("online") === "host") {
      // Consume this flag before reloading or restoring the room from the same tab.
      history.replaceState(null, "", "/?online=1");
      createRoom();
    }
  }

  return { action, leave };
})();

