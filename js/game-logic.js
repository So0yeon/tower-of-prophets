// =====================================================================
//  game-logic.js — 게임 계산 로직 (순수 함수, UI/DB와 분리되어 테스트 쉬움)
//  교사 화면에서 결과를 계산할 때 사용합니다.
// =====================================================================

(function (global) {
  const EPS = 1e-9;

  /**
   * 한 계층의 결과를 계산한다.
   * @param {Array} prophecies  [{ player_id, value, hidden }, ...]
   * @param {Object} opts        { truthFactor, scoreTable }
   * @returns {Object} { average, truth, results }
   *   results = [{ player_id, value, hidden, distance, rank, gained }] (거리 오름차순)
   */
  function computeLayer(prophecies, opts) {
    const truthFactor = opts.truthFactor ?? 0.5;
    const scoreTable = opts.scoreTable ?? { 1: 8, 2: 5, 3: 3, 4: 2, 5: 1 };

    const n = prophecies.length;
    if (n === 0) return { average: 0, truth: 0, results: [] };

    const sum = prophecies.reduce((s, p) => s + p.value, 0);
    const average = sum / n;
    const truth = average * truthFactor;

    // 거리 계산 후 오름차순 정렬
    const rows = prophecies.map((p) => ({
      player_id: p.player_id,
      value: p.value,
      hidden: !!p.hidden,
      distance: Math.abs(p.value - truth),
    }));
    rows.sort((a, b) => a.distance - b.distance);

    // 공동순위(표준 경쟁식: 1,1,3,4 ...) 부여
    let rank = 0;
    let prevDist = null;
    rows.forEach((r, i) => {
      if (prevDist === null || Math.abs(r.distance - prevDist) > EPS) {
        rank = i + 1;
        prevDist = r.distance;
      }
      r.rank = rank;
      r.gained = scoreTable[r.rank] || 0; // 6위 이하 0
    });

    return { average, truth, results: rows };
  }

  /**
   * 공명(resonance) 적용 — 지목 대상이 얻은 통찰력만큼 사용자도 추가 획득.
   * @param {Array} results        computeLayer().results
   * @param {Array} resonanceUses  [{ player_id, target_player_id }, ...]
   * @returns {Object} bonusByPlayer  { player_id: 추가통찰력, ... }
   */
  function applyResonance(results, resonanceUses) {
    const gainedBy = {};
    results.forEach((r) => (gainedBy[r.player_id] = r.gained));
    const bonus = {};
    (resonanceUses || []).forEach((u) => {
      const g = gainedBy[u.target_player_id] || 0;
      bonus[u.player_id] = (bonus[u.player_id] || 0) + g;
    });
    return bonus;
  }

  /** 입장 코드 생성 — 헷갈리는 글자(0,O,1,I,L) 제외, 4자리 */
  function makeRoomCode() {
    const alphabet = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 4; i++) {
      s += alphabet[Math.floor(Math.random() * alphabet.length)];
    }
    return s;
  }

  /** 1~100 자연수만 통과시키는 검증 */
  function isValidProphecy(v) {
    return Number.isInteger(v) && v >= 1 && v <= 100;
  }

  global.GameLogic = { computeLayer, applyResonance, makeRoomCode, isValidProphecy, EPS };
})(window);
