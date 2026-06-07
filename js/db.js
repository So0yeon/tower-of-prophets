// =====================================================================
//  db.js — Supabase 접속 + 게임에 필요한 모든 DB 동작을 한 곳에 모음
//  (supabase-js v2 는 각 HTML에서 CDN으로 먼저 로드됩니다)
// =====================================================================

(function (global) {
  const C = global.CONFIG;
  if (!C || C.SUPABASE_URL.startsWith("여기에")) {
    console.warn("[예언자들의 탑] config.js 에 Supabase URL/KEY 를 먼저 입력하세요.");
  }

  const sb = global.supabase.createClient(C.SUPABASE_URL, C.SUPABASE_ANON_KEY, {
    realtime: { params: { eventsPerSecond: 5 } },
  });

  // ---------------- 방 (교사) ----------------

  async function createRoom() {
    // 코드 충돌 시 최대 8회 재시도
    for (let i = 0; i < 8; i++) {
      const code = GameLogic.makeRoomCode();
      const { data, error } = await sb
        .from("rooms")
        .insert({
          code,
          phase: "lobby",
          current_layer: 0,
          total_layers: C.TOTAL_LAYERS,
          duration_seconds: C.DURATION_SECONDS,
        })
        .select()
        .single();
      if (!error) return data;
      if (error.code !== "23505") throw error; // 23505=unique 위반 → 코드만 바꿔 재시도
    }
    throw new Error("입장 코드 생성에 실패했습니다. 다시 시도해 주세요.");
  }

  async function getRoom(roomId) {
    const { data, error } = await sb.from("rooms").select("*").eq("id", roomId).single();
    if (error) throw error;
    return data;
  }

  async function getRoomByCode(code) {
    const { data, error } = await sb
      .from("rooms")
      .select("*")
      .eq("code", code.toUpperCase())
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function updateRoom(roomId, patch) {
    const { data, error } = await sb.from("rooms").update(patch).eq("id", roomId).select().single();
    if (error) throw error;
    return data;
  }

  async function startLayer(roomId, layer) {
    const room = await getRoom(roomId);
    const deadline = new Date(Date.now() + room.duration_seconds * 1000).toISOString();
    return updateRoom(roomId, {
      phase: "prophecy",
      current_layer: layer,
      layer_deadline: deadline,
      truth_coordinate: null,
      average: null,
    });
  }

  async function purgeRoom(roomId) {
    // rooms 삭제 → cascade 로 하위 기록 전부 삭제
    const { error } = await sb.rpc("purge_room", { p_room_id: roomId });
    if (error) {
      // RPC 없을 때 폴백: 직접 삭제
      await sb.from("rooms").delete().eq("id", roomId);
    }
  }

  // ---------------- 플레이어 (학생) ----------------

  async function joinRoom(code, nickname) {
    const room = await getRoomByCode(code);
    if (!room) throw new Error("그런 코드의 탑이 없습니다.");
    if (room.phase !== "lobby") throw new Error("이미 시작된 탑에는 입장할 수 없습니다.");

    // 다음 예언자 번호 = (현재 최대 + 1), 충돌 시 재시도
    for (let i = 0; i < 8; i++) {
      const { data: maxRow } = await sb
        .from("players")
        .select("player_number")
        .eq("room_id", room.id)
        .order("player_number", { ascending: false })
        .limit(1)
        .maybeSingle();
      const nextNum = (maxRow?.player_number || 0) + 1;

      const { data, error } = await sb
        .from("players")
        .insert({ room_id: room.id, player_number: nextNum, nickname: nickname || null })
        .select()
        .single();
      if (!error) return { room, player: data };
      if (error.code !== "23505") throw error; // 번호 충돌 → 재시도
    }
    throw new Error("입장에 실패했습니다. 다시 시도해 주세요.");
  }

  async function getPlayers(roomId) {
    const { data, error } = await sb
      .from("players")
      .select("*")
      .eq("room_id", roomId)
      .order("player_number");
    if (error) throw error;
    return data || [];
  }

  async function getPlayer(playerId) {
    const { data, error } = await sb.from("players").select("*").eq("id", playerId).single();
    if (error) throw error;
    return data;
  }

  async function touchPlayer(playerId) {
    await sb.from("players").update({ last_seen: new Date().toISOString() }).eq("id", playerId);
  }

  // ---------------- 예언 (제출) ----------------

  async function submitProphecy(roomId, playerId, layer, value) {
    const { data, error } = await sb
      .from("prophecies")
      .upsert(
        { room_id: roomId, player_id: playerId, layer, value },
        { onConflict: "room_id,player_id,layer" }
      )
      .select()
      .single();
    if (error) throw error;
    return data;
  }

  async function getProphecies(roomId, layer) {
    const { data, error } = await sb
      .from("prophecies")
      .select("*")
      .eq("room_id", roomId)
      .eq("layer", layer);
    if (error) throw error;
    return data || [];
  }

  async function getMyProphecy(roomId, playerId, layer) {
    const { data, error } = await sb
      .from("prophecies")
      .select("*")
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .eq("layer", layer)
      .maybeSingle();
    if (error) throw error;
    return data;
  }

  async function getAllProphecies(roomId) {
    const { data, error } = await sb
      .from("prophecies")
      .select("*")
      .eq("room_id", roomId)
      .order("layer");
    if (error) throw error;
    return data || [];
  }

  // ---------------- 능력 ----------------

  // 통찰력 1 차감 + 사용기록 남기기. 통찰력 부족하면 거부.
  async function useAbility(room, player, ability, targetPlayerId) {
    if (player.insight < C.ABILITY_COST) throw new Error("통찰력이 부족합니다.");

    const newInsight = player.insight - C.ABILITY_COST;
    const { data: updated, error: e1 } = await sb
      .from("players")
      .update({ insight: newInsight })
      .eq("id", player.id)
      .eq("insight", player.insight) // 낙관적 잠금
      .select()
      .single();
    if (e1 || !updated) throw new Error("통찰력 차감에 실패했습니다. 다시 시도해 주세요.");

    await sb.from("ability_uses").insert({
      room_id: room.id,
      player_id: player.id,
      layer: room.current_layer,
      ability,
      target_player_id: targetPlayerId || null,
    });

    return updated; // 갱신된 player
  }

  async function setVeil(roomId, playerId, layer) {
    await sb
      .from("prophecies")
      .update({ hidden: true })
      .eq("room_id", roomId)
      .eq("player_id", playerId)
      .eq("layer", layer);
  }

  async function getResonanceUses(roomId, layer) {
    const { data, error } = await sb
      .from("ability_uses")
      .select("player_id, target_player_id")
      .eq("room_id", roomId)
      .eq("layer", layer)
      .eq("ability", "resonance");
    if (error) throw error;
    return data || [];
  }

  // ---------------- 실시간 구독 ----------------

  function subscribeRoom(roomId, handlers) {
    const ch = sb
      .channel("room:" + roomId)
      .on("postgres_changes",
        { event: "*", schema: "public", table: "rooms", filter: `id=eq.${roomId}` },
        (p) => handlers.onRoom && handlers.onRoom(p.new))
      .on("postgres_changes",
        { event: "*", schema: "public", table: "players", filter: `room_id=eq.${roomId}` },
        () => handlers.onPlayers && handlers.onPlayers())
      .on("postgres_changes",
        { event: "*", schema: "public", table: "prophecies", filter: `room_id=eq.${roomId}` },
        () => handlers.onProphecies && handlers.onProphecies())
      .subscribe();
    return () => sb.removeChannel(ch);
  }

  global.DB = {
    sb,
    createRoom, getRoom, getRoomByCode, updateRoom, startLayer, purgeRoom,
    joinRoom, getPlayers, getPlayer, touchPlayer,
    submitProphecy, getProphecies, getMyProphecy, getAllProphecies,
    useAbility, setVeil, getResonanceUses,
    subscribeRoom,
  };
})(window);
