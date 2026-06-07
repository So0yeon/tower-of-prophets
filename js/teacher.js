// =====================================================================
//  teacher.js — 교사(관측소) 화면 로직. 결과 계산의 '권한자' 역할.
// =====================================================================

const C = window.CONFIG;
const $ = (id) => document.getElementById(id);

const state = {
  roomId: null,
  room: null,
  players: [],
  unsub: null,
  timerInt: null,
  revealing: false,   // 중복 공개 방지
  lastLayerRevealed: 0,
};

// ---------- 초기화 ----------
(async function init() {
  buildTicks();
  bindButtons();
  const saved = localStorage.getItem("top_teacher_room");
  if (saved) {
    try {
      const room = await DB.getRoom(saved);
      if (room && room.phase !== "ended") { await attach(room); return; }
    } catch (_) {}
    localStorage.removeItem("top_teacher_room");
  }
  await createNewRoom();
})();

async function createNewRoom() {
  setConn("탑을 세우는 중...");
  const room = await DB.createRoom();
  localStorage.setItem("top_teacher_room", room.id);
  await attach(room);
}

async function attach(room) {
  state.roomId = room.id;
  state.room = room;
  $("roomCode").textContent = room.code;
  setConn("관측소 연결됨");

  await refreshPlayers();
  state.unsub = DB.subscribeRoom(room.id, {
    onRoom: (r) => { state.room = r; render(); },
    onPlayers: () => refreshPlayers(),
    onProphecies: () => onPropheciesChanged(),
  });
  startTimerLoop();
  render();

  // 새로고침 후 공개 직후 상태라면 결과 화면 재구성
  if (room.phase === "revealing" || room.phase === "revealed") {
    await reconstructReveal();
  }
}

async function refreshPlayers() {
  state.players = await DB.getPlayers(state.roomId);
  render();
}

// ---------- 렌더 ----------
function render() {
  const r = state.room;
  if (!r) return;

  // 상단 계층 태그
  $("layerTag").textContent =
    r.phase === "lobby" ? "대기실"
    : r.phase === "ended" ? "기록 소멸"
    : `제${r.current_layer}계층`;

  show("view-lobby", r.phase === "lobby");
  show("view-play", r.phase === "prophecy" || r.phase === "revealing" || r.phase === "revealed");
  show("view-end", r.phase === "ended");

  if (r.phase === "lobby") renderLobby();
  if (r.phase === "prophecy") renderPlay();
  if (r.phase === "ended") renderEnding();

  $("abilityChip").style.display = r.current_layer >= C.ABILITY_UNLOCK_LAYER ? "" : "none";
}

function renderLobby() {
  const grid = $("lobbyPlayers");
  grid.innerHTML = "";
  state.players.forEach((p) => {
    const d = document.createElement("div");
    d.className = "pnode";
    d.textContent = p.player_number;
    d.title = p.nickname || "";
    grid.appendChild(d);
  });
  $("lobbyCount").textContent = state.players.length;
  $("btnStartGame").disabled = state.players.length < 2;
}

function renderPlay() {
  $("totalCount").textContent = state.players.length;
  renderRanking($("rankList"));
}

function renderRanking(el) {
  const sorted = [...state.players].sort((a, b) => b.insight - a.insight || a.player_number - b.player_number);
  el.innerHTML = "";
  sorted.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "rank-row" + (i === 0 && p.insight > 0 ? " top1" : "");
    row.innerHTML =
      `<span class="pos">${i + 1}</span>
       <span class="name">${nameOf(p)}</span>
       <span class="score">${p.insight}</span>`;
    el.appendChild(row);
  });
}

function nameOf(p) {
  return p.nickname ? `${p.nickname} (P${p.player_number})` : `예언자 ${p.player_number}`;
}
function labelById(id) {
  const p = state.players.find((x) => x.id === id);
  return p ? nameOf(p) : "알 수 없음";
}

// ---------- 타이머 & 제출 감시 ----------
function startTimerLoop() {
  clearInterval(state.timerInt);
  state.timerInt = setInterval(tick, 500);
}

async function tick() {
  const r = state.room;
  if (!r || r.phase !== "prophecy") return;
  const remain = Math.max(0, Math.round((new Date(r.layer_deadline) - Date.now()) / 1000));
  $("timer").textContent = fmtTime(remain);

  // 마감 시간 종료 → 자동 공개
  if (remain <= 0 && !state.revealing) { revealLayer(); }
}

async function onPropheciesChanged() {
  if (!state.room || state.room.phase !== "prophecy") return;
  const prophs = await DB.getProphecies(state.roomId, state.room.current_layer);
  $("submitCount").textContent = prophs.length;
  // 전원 제출 시 자동 공개
  if (prophs.length >= state.players.length && state.players.length > 0 && !state.revealing) {
    revealLayer();
  }
}

function fmtTime(s) {
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, "0")}`;
}

// ---------- 게임 진행 ----------
async function startGame() {
  state.revealing = false;
  await DB.startLayer(state.roomId, 1);
}

async function startNextLayer() {
  const r = state.room;
  const next = r.current_layer + 1;
  state.revealing = false;
  hideReveal();
  if (next > r.total_layers) {
    await DB.updateRoom(state.roomId, { phase: "ended" });
  } else {
    await DB.startLayer(state.roomId, next);
  }
}

// ---------- 결과 계산 + 공개 ----------
async function revealLayer() {
  if (state.revealing) return;
  state.revealing = true;
  const layer = state.room.current_layer;
  if (state.lastLayerRevealed === layer) return;
  state.lastLayerRevealed = layer;

  await DB.updateRoom(state.roomId, { phase: "revealing" });

  const prophs = await DB.getProphecies(state.roomId, layer);
  const { average, truth, results } = GameLogic.computeLayer(
    prophs.map((p) => ({ player_id: p.player_id, value: p.value, hidden: p.hidden })),
    { truthFactor: C.TRUTH_FACTOR, scoreTable: C.SCORE_TABLE }
  );

  // 공명 보너스
  const resUses = await DB.getResonanceUses(state.roomId, layer);
  const bonus = GameLogic.applyResonance(results, resUses);

  // 통찰력 누적 계산
  const players = await DB.getPlayers(state.roomId);
  const insightMap = {};
  players.forEach((p) => (insightMap[p.id] = p.insight));

  for (const r of results) {
    const total = r.gained + (bonus[r.player_id] || 0);
    insightMap[r.player_id] += total;
    await DB.sb.from("prophecies")
      .update({ distance: r.distance, rank: r.rank, gained_insight: total })
      .eq("room_id", state.roomId).eq("player_id", r.player_id).eq("layer", layer);
  }
  // 제출 안 했지만 공명 보너스만 받는 경우
  Object.keys(bonus).forEach((pid) => {
    if (!results.find((r) => r.player_id === pid)) insightMap[pid] += bonus[pid];
  });
  // 통찰력 DB 반영
  for (const p of players) {
    if (insightMap[p.id] !== p.insight) {
      await DB.sb.from("players").update({ insight: insightMap[p.id] }).eq("id", p.id);
    }
  }

  await DB.updateRoom(state.roomId, { average, truth_coordinate: truth, phase: "revealed" });
  await refreshPlayers();

  await runRevealAnimation(truth, results);
}

// 공개 연출 (기획서의 하이라이트)
async function runRevealAnimation(truth, results, instant) {
  const overlay = $("reveal");
  const msg = $("revealMsg");
  const truthBox = $("revealTruthBox");
  const podium = $("podium");
  overlay.classList.add("show");
  truthBox.classList.add("hidden");
  podium.innerHTML = "";
  $("btnNext").classList.add("hidden");
  $("revealCore").textContent = "∴";

  const sleep = (ms) => new Promise((r) => setTimeout(r, instant ? 0 : ms));

  msg.textContent = "집단의식 분석 중...";
  await sleep(1500);
  msg.textContent = "진실의 좌표 계산 중...";
  await sleep(1500);

  // 큰 숫자 등장 (카운트업)
  msg.textContent = "";
  truthBox.classList.remove("hidden");
  $("revealCore").textContent = fmtTruth(truth);
  await countUp($("revealTruth"), truth, instant ? 0 : 900);
  await sleep(600);

  // 상위 5명 공개
  const top5 = results.slice(0, 5);
  const medals = ["①", "②", "③", "④", "⑤"];
  top5.forEach((r, i) => {
    const row = document.createElement("div");
    row.className = "prow";
    const valTxt = r.hidden ? "???" : r.value;
    row.innerHTML =
      `<span class="medal gold">${medals[i] || i + 1}</span>
       <span class="name">${labelById(r.player_id)}</span>
       <span class="pval">예언 ${valTxt}</span>
       <span class="pgain">+${r.gained}</span>`;
    podium.appendChild(row);
    setTimeout(() => row.classList.add("in"), instant ? 0 : 500 + i * 350);
  });
  await sleep(500 + top5.length * 350 + 400);

  $("btnNext").classList.remove("hidden");
  $("btnNext").textContent =
    state.room.current_layer >= state.room.total_layers ? "초월자 선정" : "다음 계층으로";
}

async function reconstructReveal() {
  const layer = state.room.current_layer;
  const prophs = await DB.getProphecies(state.roomId, layer);
  const results = prophs
    .filter((p) => p.rank != null)
    .sort((a, b) => a.rank - b.rank)
    .map((p) => ({ player_id: p.player_id, value: p.value, hidden: p.hidden, rank: p.rank, gained: p.gained_insight }));
  state.lastLayerRevealed = layer;
  await runRevealAnimation(state.room.truth_coordinate || 0, results, true);
}

function countUp(el, target, dur) {
  return new Promise((resolve) => {
    if (dur === 0) { el.textContent = fmtTruth(target); return resolve(); }
    const start = performance.now();
    function step(t) {
      const k = Math.min(1, (t - start) / dur);
      const eased = 1 - Math.pow(1 - k, 3);
      el.textContent = fmtTruth(target * eased);
      if (k < 1) requestAnimationFrame(step); else resolve();
    }
    requestAnimationFrame(step);
  });
}
function fmtTruth(v) {
  return Number.isInteger(v) ? String(v) : v.toFixed(1);
}

function hideReveal() { $("reveal").classList.remove("show"); }

// ---------- 엔딩 ----------
function renderEnding() {
  const sorted = [...state.players].sort((a, b) => b.insight - a.insight || a.player_number - b.player_number);
  const winner = sorted[0];
  if (winner) {
    $("winnerName").textContent = nameOf(winner);
    $("winnerScore").textContent = winner.insight;
  }
  const el = $("finalRank");
  el.innerHTML = "";
  sorted.forEach((p, i) => {
    const row = document.createElement("div");
    row.className = "rank-row" + (i === 0 ? " top1" : "");
    row.innerHTML =
      `<span class="pos">${i + 1}</span>
       <span class="name">${nameOf(p)}</span>
       <span class="score">${p.insight}</span>`;
    el.appendChild(row);
  });
  hideReveal();
}

// ---------- 종료 / 정리 ----------
async function finishAndPurge(confirmMsg) {
  if (!confirm(confirmMsg)) return;
  if (state.unsub) state.unsub();
  clearInterval(state.timerInt);
  try { await DB.purgeRoom(state.roomId); } catch (_) {}
  localStorage.removeItem("top_teacher_room");
  location.href = "index.html";
}

// ---------- 버튼 ----------
function bindButtons() {
  $("btnStartGame").onclick = startGame;
  $("btnReveal").onclick = () => revealLayer();
  $("btnNext").onclick = startNextLayer;
  $("btnAbort").onclick = () => finishAndPurge("정말 탑을 무너뜨릴까요? 모든 기록이 삭제됩니다.");
  $("btnAbort2").onclick = () => finishAndPurge("게임을 종료하고 모든 기록을 삭제할까요?");
  $("btnFinish").onclick = () => finishAndPurge("탑을 닫고 모든 예언·통찰력·능력 기록을 영구 삭제합니다. 계속할까요?");
}

// ---------- 잡 헬퍼 ----------
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function setConn(t) { $("connText").textContent = t; }
function buildTicks() {
  const t = $("ticks");
  if (!t) return;
  for (let i = 0; i < 60; i++) {
    const i2 = document.createElement("i");
    i2.style.transform = `rotate(${i * 6}deg)`;
    if (i % 5 === 0) i2.style.height = "16px";
    t.appendChild(i2);
  }
}
