/* 가족 공유(Supabase) 설정 — docs/가족공유-설정.md 참고
 * 두 값을 채우면 '아기 정보 수정' 화면의 가족 공유가 자동 활성화됩니다.
 * 비어 있으면 앱은 지금처럼 이 기기에만 저장(로컬 모드)됩니다. */
const SUPABASE_CONFIG = {
  url: '',      // 예: 'https://xxxx.supabase.co'
  anonKey: '',  // Project Settings → API → anon public
};

/* 방문자 집계(GoatCounter) — docs/방문자집계-설정.md 참고
 * GoatCounter에서 만든 코드(사이트 이름)를 넣으면 방문 집계가 켜집니다.
 * 예: 'babybloom' → https://babybloom.goatcounter.com 대시보드에서 확인.
 * 비어 있으면 추적 코드를 아예 로드하지 않아요(개인정보 안전). */
const GOATCOUNTER_CODE = '';
