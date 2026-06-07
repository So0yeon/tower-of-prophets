// =====================================================================
//  설정 파일 — 여기 두 줄만 본인 Supabase 값으로 바꾸면 됩니다.
//  값 찾는 곳: Supabase 대시보드 > Project Settings > API
// =====================================================================

window.CONFIG = {
  // 프로젝트 URL (예: https://abcdwxyz.supabase.co)
  SUPABASE_URL: "https://evkyiemqdeoaaorynozy.supabase.co",

  // anon public 키 (긴 문자열). service_role 키는 절대 넣지 마세요!
  SUPABASE_ANON_KEY: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImV2a3lpZW1xZGVvYWFvcnlub3p5Iiwicm9sZSI6ImFub24iLCJpYXQiOjE3ODA3OTI5NTYsImV4cCI6MjA5NjM2ODk1Nn0.VRURNH8nXpK8wpAaDG3YlV7NwqaBDr7CNj9WTbQTdTY",

  // ---- 게임 규칙(원하면 조정 가능) ----
  TOTAL_LAYERS: 5,            // 총 계층 수
  DURATION_SECONDS: 300,      // 계층당 예언 시간(초) = 5분
  ABILITY_UNLOCK_LAYER: 3,    // 능력 카드 해금 계층
  TRUTH_FACTOR: 0.5,          // 진실의 좌표 = 평균 × 이 값
  ABILITY_COST: 1,            // 능력 1회 사용 비용(통찰력)
  SCORE_TABLE: { 1: 8, 2: 5, 3: 3, 4: 2, 5: 1 }, // 등수별 통찰력 (6위 이하 0)
};
