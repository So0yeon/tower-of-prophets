// =====================================================================
//  student.js — 예언자(학생) 디벗 화면 로직
// =====================================================================

const C = window.CONFIG;
const $ = (id) => document.getElementById(id);

const ABILITIES = [
  { key: "veil",      icon: "🜂", name: "운명의 장막", desc: "이번 계층 결과에서 내 예언값을 숨깁니다 (??? 표시). 계산은 정상." },
  { key: "telepathy", icon: "🜄", name: "정신 감응",   desc: "예언자 1명의 이번 계층 예언값을 확인합니다." },
  { key: "akashic",   icon: "🜁", name: "아카식 열람", desc: "지난 계층들의 전체 기록을 다시 봅니다." },
  { key: "resonance", icon: "🜃", name: "공명",       desc: "지목한 예언자가 통찰력을 얻으면 나도 그만큼 추가 획득." },
];

const S = {
  roomId: null, playerId: null,
  room: null, player: null, players: [],
  myProphecy: null,         // 현재 계층 내 예언
  unsub: null, timerInt: null, waitMsgInt: null,
};

// ---------- 초기화 ----------
(function init() {
  bindJoin();
  bindPlay();
  $("modalClose").onclick = closeModal;
  const r = localStorage.getItem("top_player_room");
  const p = localStorage.getItem("top_player_id");
  if (r && p) resume(r, p);
})();

async function resume(roomId, playerId) {
  try {
    const room = await DB.getRoom(roomId);
    const player = await DB.getPlayer(playerId);
    if (room && player && room.phase !== "ended") { await attach(room, player); return; }
  } catch (_) {}
  localStorage.removeItem("top_player_room");
  localStorage.removeItem("top_player_id");
}

// ---------- 입장 ----------
function bindJoin() {
  $("codeInput").addEventListener("input", (e) => (e.target.value = e.target.value.toUpperCase()));
  $("btnJoin").onclick = doJoin;
  $("codeInput").addEventListener("keydown", (e) => e.key === "Enter" && doJoin());
}

async function doJoin() {
  const code = $("codeInput").value.trim();
  $("joinError").textContent = "";
  if (code.length < 4) { $("joinError").textContent = "코드 4자리를 입력하세요."; return; }
  $("btnJoin").disabled = true;
  try {
    // Re-attach existing player if localStorage has valid ids for the same room
    const storedRoom = localStorage.getItem("top_player_room");
    const storedPlayerId = localStorage.getItem("top_player_id");
    if (storedRoom && storedPlayerId) {
      const room = await DB.getRoomByCode(code);
      if (room && room.id === storedRoom) {
        const player = await DB.getPlayer(storedPlayerId);
        if (player) { await attach(room, player); $("btnJoin").disabled = false; return; }
      }
    }

    // Create new player; DB.joinRoom will generate & persist a random nickname
    const { room, player } = await DB.joinRoom(code);
    localStorage.setItem("top_player_room", room.id);
    localStorage.setItem("top_player_id", player.id);
    await attach(room, player);
  } catch (err) {
    $("joinError").textContent = err.message || "입장에 실패했습니다.";
  } finally {
    $("btnJoin").disabled = false;
  }
}

async function attach(room, player) {
  S.roomId = room.id; S.playerId = player.id;
  S.room = room; S.player = player;
  $("waitNum").textContent = "P" + player.player_number;
  $("sNum").textContent = "P" + player.player_number;

  await refreshAll();
  S.unsub = DB.subscribeRoom(room.id, {
    onRoom: (r) => { const prevLayer = S.room?.current_layer; S.room = r; if (r.current_layer !== prevLayer) S.myProphecy = null; render(); },
    onPlayers: () => refreshPlayers(),
    onProphecies: () => refreshMyProphecy(),
  });
  startTimer();
  // 출석 표시 주기적 갱신
  setInterval(() => DB.touchPlayer(S.playerId), 30000);
  render();
}

async function refreshAll() {
  await Promise.all([refreshPlayers(), refreshMyProphecy()]);
}
async function refreshPlayers() {
  S.players = await DB.getPlayers(S.roomId);
  S.player = S.players.find((p) => p.id === S.playerId) || S.player;
  render();
}
async function refreshMyProphecy() {
  if (!S.room || S.room.current_layer < 1) { S.myProphecy = null; return render(); }
  S.myProphecy = await DB.getMyProphecy(S.roomId, S.playerId, S.room.current_layer);
  render();
}

// ---------- 렌더 ----------
function render() {
  const r = S.room;
  if (!r) return;
  show("view-join", false);
  show("view-wait", r.phase === "lobby");
  show("view-play", r.phase === "prophecy" || r.phase === "revealing" || r.phase === "revealed");
  show("view-end", r.phase === "ended");

  const nick = S.player?.nickname ? `✦ ${S.player.nickname}` : "—";
  $("nickWait").textContent = nick;
  $("nickPlay").textContent = nick;

  if (r.phase === "lobby") { hideWait(); }
  if (r.phase === "prophecy") { hideWait(); renderPlay(); }
  if (r.phase === "revealing") { renderPlay(); showRevealing(); }
  if (r.phase === "revealed") { renderPlay(); showMyResult(); }
  if (r.phase === "ended") { hideWait(); renderEnd(); }
}

function renderPlay() {
  const r = S.room, me = S.player;
  $("sInsight").textContent = me ? me.insight : 0;
  $("sRank").textContent = myRank() + "위";
  $("sLayer").textContent = `제${r.current_layer}계층`;

  // 입력 vs 제출완료
  const submitted = !!S.myProphecy;
  const locked = r.phase !== "prophecy" || remainSec() <= 0;
  show("inputArea", !submitted);
  show("submittedArea", submitted);
  if (submitted) {
    $("myValue").textContent = S.myProphecy.hidden ? S.myProphecy.value + " (장막)" : S.myProphecy.value;
  }
  $("btnSubmit").disabled = locked;
  $("prophecyInput").disabled = locked;

  renderCards();
  renderRecords();
}

function renderCards() {
  const r = S.room;
  const unlocked = r.current_layer >= C.ABILITY_UNLOCK_LAYER && r.phase === "prophecy";
  $("abilityState").textContent = unlocked
    ? `보유 통찰력 ${S.player?.insight ?? 0} · 1회 ${C.ABILITY_COST}통찰력`
    : `제${C.ABILITY_UNLOCK_LAYER}계층부터 해금`;

  const wrap = $("cards");
  wrap.innerHTML = "";
  ABILITIES.forEach((a) => {
    const canUse = unlocked && (S.player?.insight ?? 0) >= C.ABILITY_COST;
    const el = document.createElement("div");
    el.className = "card" + (canUse ? "" : " locked");
    el.innerHTML =
      `<span class="cost">${C.ABILITY_COST}</span>
       <div class="ic">${a.icon}</div>
       <div class="cn">${a.name}</div>
       <div class="cd">${a.desc}</div>`;
    if (canUse) el.onclick = () => useAbility(a.key);
    wrap.appendChild(el);
  });
}

async function renderRecords() {
  const { data } = await DB.sb
    .from("prophecies").select("*")
    .eq("room_id", S.roomId).eq("player_id", S.playerId).order("layer");
  const el = $("records");
  if (!data || data.length === 0) {
    el.innerHTML = `<p class="muted" style="font-size:.85rem;">아직 기록이 없습니다.</p>`;
    return;
  }
  el.innerHTML = "";
  data.forEach((p) => {
    const row = document.createElement("div");
    row.className = "rec";
    const rankTxt = p.rank ? `${p.rank}위` : "—";
    const gainTxt = p.rank ? `+${p.gained_insight}` : "";
    row.innerHTML =
      `<span class="rl">제${p.layer}계층</span>
       <span class="rv">${p.value}${p.hidden ? " 🜂" : ""}</span>
       <span class="rr">${rankTxt}</span>
       <span class="rg">${gainTxt}</span>`;
    el.appendChild(row);
  });
}

function myRank() {
  const me = S.player; if (!me) return "-";
  const better = S.players.filter((p) => p.insight > me.insight).length;
  return better + 1;
}

// ---------- 예언 제출 ----------
function bindPlay() {
  $("btnSubmit").onclick = submitProphecy;
  $("prophecyInput").addEventListener("keydown", (e) => e.key === "Enter" && submitProphecy());
  $("prophecyInput").addEventListener("input", (e) => {
    e.target.value = e.target.value.replace(/[^0-9]/g, "").slice(0, 3);
  });
  $("btnEdit").onclick = () => { S.myProphecy = null; render(); $("prophecyInput").focus(); };
}

async function submitProphecy() {
  const v = parseInt($("prophecyInput").value, 10);
  if (!GameLogic.isValidProphecy(v)) { flash($("prophecyInput")); return; }
  $("btnSubmit").disabled = true;
  try {
    const row = await DB.submitProphecy(S.roomId, S.playerId, S.room.current_layer, v);
    S.myProphecy = row;
    render();
  } catch (err) {
    alert("제출 실패: " + (err.message || ""));
  } finally {
    $("btnSubmit").disabled = false;
  }
}

// ---------- 능력 ----------
async function useAbility(key) {
  if ((S.player?.insight ?? 0) < C.ABILITY_COST) return;

  if (key === "veil") {
    if (!S.myProphecy) { alert("먼저 예언을 제출해야 장막을 칠 수 있습니다."); return; }
    if (S.myProphecy.hidden) { alert("이미 장막을 쳤습니다."); return; }
    if (!confirm("운명의 장막을 사용할까요? (통찰력 1 소모)")) return;
    await spend("veil");
    await DB.setVeil(S.roomId, S.playerId, S.room.current_layer);
    await refreshMyProphecy();
    alert("이번 계층 결과에서 당신의 예언값이 숨겨집니다.");
  }

  if (key === "akashic") {
    if (!confirm("아카식 레코드를 열람할까요? (통찰력 1 소모)")) return;
    await spend("akashic");
    await showAkashic();
  }

  if (key === "telepathy") {
    pickTarget("정신 감응 — 누구의 예언을 읽을까요?", async (target) => {
      await spend("telepathy", target.id);
      const tp = await DB.getMyProphecy(S.roomId, target.id, S.room.current_layer);
      const v = tp ? tp.value : null;
      openModal("정신 감응 결과",
        `<p style="margin:8px 0;">${nameOf(target)} 의 이번 계층 예언:</p>
         <div class="reveal-truth" style="font-size:2.6rem;">${v ?? "아직 예언 안 함"}</div>`);
    });
  }

  if (key === "resonance") {
    pickTarget("공명 — 누구와 공명할까요?", async (target) => {
      await spend("resonance", target.id);
      openModal("공명 성립",
        `<p style="margin:8px 0;">${nameOf(target)} 와(과) 공명합니다.</p>
         <p class="muted" style="font-size:.85rem;">이번 계층에서 ${nameOf(target)} 가 통찰력을 얻으면 당신도 그만큼 추가로 얻습니다.</p>`);
    });
  }
}

async function spend(ability, targetId) {
  const updated = await DB.useAbility(S.room, S.player, ability, targetId);
  S.player = updated;
  render();
}

function pickTarget(title, onPick) {
  const others = S.players.filter((p) => p.id !== S.playerId);
  if (others.length === 0) { alert("대상이 없습니다."); return; }
  const body = `<div class="target-list">` +
    others.map((p) => `<button class="target-btn" data-id="${p.id}">${nameOf(p)}</button>`).join("") +
    `</div>`;
  openModal(title, body);
  $("modalBody").querySelectorAll(".target-btn").forEach((btn) => {
    btn.onclick = () => {
      const target = others.find((p) => p.id === btn.dataset.id);
      onPick(target);
    };
  });
}

async function showAkashic() {
  const { data } = await DB.sb
    .from("prophecies").select("*")
    .eq("room_id", S.roomId).lt("layer", S.room.current_layer)
    .not("rank", "is", null).order("layer");
  let html = "";
  const byLayer = {};
  (data || []).forEach((p) => { (byLayer[p.layer] = byLayer[p.layer] || []).push(p); });
  Object.keys(byLayer).sort().forEach((L) => {
    html += `<h3 style="margin:14px 0 6px; font-size:1.05rem;" class="gold">제${L}계층</h3>`;
    byLayer[L].sort((a, b) => a.rank - b.rank).forEach((p) => {
      html += `<div class="result-row"><span>${labelById(p.player_id)}</span>
               <span class="tech">${p.hidden ? "???" : p.value}</span>
               <span class="muted">${p.rank}위 (+${p.gained_insight})</span></div>`;
    });
  });
  if (!html) html = `<p class="muted">아직 공개된 지난 계층이 없습니다.</p>`;
  openModal("아카식 레코드", html);
}

// ---------- 결과 오버레이 ----------
function showRevealing() {
  $("swait").classList.add("show");
  $("myResult").classList.add("hidden");
  const msgs = ["집단의식 분석 중...", "진실의 좌표 계산 중..."];
  let i = 0;
  $("swaitMsg").textContent = msgs[0];
  clearInterval(S.waitMsgInt);
  S.waitMsgInt = setInterval(() => { i = (i + 1) % msgs.length; $("swaitMsg").textContent = msgs[i]; }, 1500);
}

async function showMyResult() {
  clearInterval(S.waitMsgInt);
  $("swait").classList.add("show");
  $("swaitMsg").textContent = "";
  const mine = await DB.getMyProphecy(S.roomId, S.playerId, S.room.current_layer);
  $("myResult").classList.remove("hidden");
  $("myTruth").textContent = fmtTruth(S.room.truth_coordinate ?? 0);
  if (mine) {
    $("resVal").textContent = mine.hidden ? `${mine.value} (장막)` : mine.value;
    $("resRank").textContent = mine.rank ? `${mine.rank}위` : "미제출";
    $("resGain").textContent = `+${mine.gained_insight ?? 0}`;
  } else {
    $("resVal").textContent = "미제출";
    $("resRank").textContent = "-";
    $("resGain").textContent = "+0";
  }
}

function hideWait() { $("swait").classList.remove("show"); clearInterval(S.waitMsgInt); }

// ---------- 엔딩 ----------
function renderEnd() {
  const sorted = [...S.players].sort((a, b) => b.insight - a.insight || a.player_number - b.player_number);
  const winner = sorted[0];
  const meRank = sorted.findIndex((p) => p.id === S.playerId) + 1;
  const iWon = winner && winner.id === S.playerId;
  $("endIcon").textContent = iWon ? "👑" : "👁️‍🗨️";
  $("endTitle").textContent = iWon ? "당신은 초월자입니다" : "초월자가 탄생했습니다";
  $("endName").textContent = winner ? nameOf(winner) : "—";
  $("endScore").textContent = S.player ? S.player.insight : 0;
  $("endRank").textContent = `당신은 ${meRank}위`;
}

// ---------- 타이머 ----------
function startTimer() {
  clearInterval(S.timerInt);
  S.timerInt = setInterval(() => {
    if (!S.room || S.room.phase !== "prophecy") return;
    const s = remainSec();
    $("sTimer").textContent = fmtTime(s);
    if (s <= 0) { $("btnSubmit").disabled = true; $("prophecyInput").disabled = true; }
  }, 500);
}
function remainSec() {
  if (!S.room?.layer_deadline) return 0;
  return Math.max(0, Math.round((new Date(S.room.layer_deadline) - Date.now()) / 1000));
}

// ---------- 모달 ----------
function openModal(title, html) { $("modalTitle").textContent = title; $("modalBody").innerHTML = html; $("modal").classList.add("show"); }
function closeModal() { $("modal").classList.remove("show"); }

// ---------- 헬퍼 ----------
function show(id, on) { $(id).classList.toggle("hidden", !on); }
function nameOf(p) { return p.nickname ? `${p.nickname} (P${p.player_number})` : `예언자 ${p.player_number}`; }
function labelById(id) { const p = S.players.find((x) => x.id === id); return p ? nameOf(p) : "예언자?"; }
function fmtTime(s) { return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`; }
function fmtTruth(v) { return Number.isInteger(v) ? String(v) : Number(v).toFixed(1); }
function flash(el) { el.style.borderColor = "var(--danger)"; setTimeout(() => (el.style.borderColor = ""), 600); }
