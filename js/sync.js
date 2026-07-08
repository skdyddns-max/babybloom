/* 가족 공유 — Supabase REST 직접 호출 (SDK 불필요)
 * 동작: 가족 코드 생성/참여 → 기록 변경 2.5초 후 자동 푸시(읽기→합치기→쓰기),
 *       앱 열기·화면 복귀·60초마다 풀. 기록은 합집합 병합이라 두 사람이 동시에 써도 유실 없음. */
let familyPushTimer = null;

function familyReady() {
  return typeof SUPABASE_CONFIG !== 'undefined' && !!SUPABASE_CONFIG.url && !!SUPABASE_CONFIG.anonKey;
}
function familyJoined() { return familyReady() && state && state.family && state.family.code; }
function sbHeaders(extra) {
  return Object.assign({
    apikey: SUPABASE_CONFIG.anonKey,
    Authorization: `Bearer ${SUPABASE_CONFIG.anonKey}`,
    'Content-Type': 'application/json',
  }, extra);
}
function sbUrl(q) { return `${SUPABASE_CONFIG.url}/rest/v1/families${q}`; }

// 원격 상태를 내 상태에 병합 (기록=합집합, 체크=OR, 아기정보=비어있으면 채움)
function mergeStates(remote) {
  if (!remote) return;
  for (const k of Object.keys(EMPTY_RECORDS)) {
    const seen = new Set();
    const merged = [...(state.records[k] || []), ...((remote.records && remote.records[k]) || [])]
      .filter(x => { const s = JSON.stringify(x); if (seen.has(s)) return false; seen.add(s); return true; });
    merged.sort((a, b) => `${a.d || a.start || ''}${a.t || ''}`.localeCompare(`${b.d || b.start || ''}${b.t || ''}`));
    state.records[k] = merged;
  }
  state.done = Object.assign({}, remote.done, state.done);
  for (const f of ['name', 'birth', 'due', 'rota']) if (!state[f] && remote[f]) state[f] = remote[f];
}

async function familyFetchRemote(code) {
  const r = await fetch(sbUrl(`?code=eq.${encodeURIComponent(code)}&select=data,updated_at`), { headers: sbHeaders() });
  if (!r.ok) throw new Error('fetch');
  const rows = await r.json();
  return rows[0] || null;
}

async function familyPush() {
  if (!familyJoined()) return;
  try {
    const row = await familyFetchRemote(state.family.code);
    if (row) mergeStates(row.data);
    const res = await fetch(sbUrl(`?code=eq.${encodeURIComponent(state.family.code)}`), {
      method: 'PATCH', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ data: state, updated_at: new Date().toISOString() }),
    });
    if (res.ok) {
      state.family.lastSync = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      renderFamily();
    }
  } catch { /* 오프라인 등 — 다음 변경/풀 때 재시도 */ }
}
function scheduleFamilyPush() {
  if (!familyJoined()) return;
  clearTimeout(familyPushTimer);
  familyPushTimer = setTimeout(familyPush, 2500);
}

async function familyPull() {
  if (!familyJoined()) return;
  try {
    const row = await familyFetchRemote(state.family.code);
    if (row && row.data) {
      const before = JSON.stringify(state.records) + JSON.stringify(state.done);
      mergeStates(row.data);
      state.family.lastSync = Date.now();
      localStorage.setItem(LS_KEY, JSON.stringify(state));
      if (before !== JSON.stringify(state.records) + JSON.stringify(state.done)) render();
      else renderFamily();
    }
  } catch { }
}

async function familyCreate() {
  const code = Array.from({ length: 6 }, () => 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'[Math.floor(Math.random() * 31)]).join('');
  try {
    const res = await fetch(sbUrl(''), {
      method: 'POST', headers: sbHeaders({ Prefer: 'return=minimal' }),
      body: JSON.stringify({ code, data: state, updated_at: new Date().toISOString() }),
    });
    if (!res.ok) throw new Error();
    state.family = { code, lastSync: Date.now() };
    saveState(state); renderFamily();
    alert(`가족 코드가 만들어졌어요!\n\n   ${code}\n\n남편(가족) 폰의 베이비블룸 → 아기 정보 수정 → 가족 공유에서 이 코드를 입력하면 함께 기록할 수 있어요.`);
  } catch { alert('코드 생성에 실패했어요. 네트워크와 설정을 확인해주세요.'); }
}

async function familyJoin(code) {
  code = (code || '').trim().toUpperCase();
  if (code.length !== 6) { alert('6자리 가족 코드를 입력해주세요.'); return; }
  try {
    const row = await familyFetchRemote(code);
    if (!row) { alert('그 코드의 가족을 찾지 못했어요. 코드를 다시 확인해주세요.'); return; }
    if (!state) state = { done: {}, records: JSON.parse(JSON.stringify(EMPTY_RECORDS)) };
    mergeStates(row.data);
    state.family = { code, lastSync: Date.now() };
    saveState(state); render();
    alert('가족 공유에 참여했어요! 🌷 이제 기록이 함께 보여요.');
  } catch { alert('참여에 실패했어요. 네트워크와 설정을 확인해주세요.'); }
}

function familyLeave() {
  if (!confirm('가족 공유를 끊을까요? (지금까지의 기록은 이 기기에 그대로 남아요)')) return;
  delete state.family;
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  renderFamily();
}

function renderFamily() {
  const box = document.querySelector('#family-ui');
  if (!box) return;
  if (!familyReady()) {
    box.innerHTML = `<p class="fam-guide">실시간 공유는 무료 Supabase 키를 등록하면 켜져요.
      <a href="https://github.com/skdyddns-max/babybloom/blob/main/docs/%EA%B0%80%EC%A1%B1%EA%B3%B5%EC%9C%A0-%EC%84%A4%EC%A0%95.md" target="_blank" rel="noopener">설정 방법 보기 →</a><br>
      <small>그 전에도 캘린더 내보내기(일정)와 백업 파일 전송(기록)으로 공유할 수 있어요.</small></p>`;
    return;
  }
  if (familyJoined()) {
    const last = state.family.lastSync ? timeAgo(new Date(state.family.lastSync)) : '아직';
    box.innerHTML = `
      <p class="fam-status">🟢 공유 중 · 코드 <b class="fam-code">${state.family.code}</b><br><small>마지막 동기화: ${last}</small></p>
      <div class="backup-btns">
        <button type="button" id="btn-fam-sync">지금 동기화</button>
        <button type="button" id="btn-fam-leave">공유 끊기</button>
      </div>`;
    box.querySelector('#btn-fam-sync').addEventListener('click', () => { familyPull().then(familyPush); });
    box.querySelector('#btn-fam-leave').addEventListener('click', familyLeave);
  } else {
    box.innerHTML = `
      <div class="backup-btns"><button type="button" id="btn-fam-create">가족 코드 만들기</button></div>
      <div class="fam-join">
        <input type="text" id="fam-code-in" maxlength="6" placeholder="받은 코드 6자리" autocapitalize="characters" autocomplete="off">
        <button type="button" id="btn-fam-join">참여</button>
      </div>`;
    box.querySelector('#btn-fam-create').addEventListener('click', familyCreate);
    box.querySelector('#btn-fam-join').addEventListener('click', () => familyJoin(document.querySelector('#fam-code-in').value));
  }
}

document.addEventListener('DOMContentLoaded', () => {
  renderFamily();
  familyPull();
  setInterval(familyPull, 60000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) familyPull(); });
});
