/* BabyBloom 앱 로직: 날짜 계산 + 렌더링 (localStorage) */

const LS_KEY = 'babybloom';
const DAY = 24 * 60 * 60 * 1000;
const EMPTY_RECORDS = { poop: [], feed: [], solids: [], pee: [], sleep: [] };

// 카테고리 원색 (시인성 우선)
const CATS = {
  '모유': { c: '#E64980', e: '🤱' },
  '분유': { c: '#F59F00', e: '🍼' },
  '유축': { c: '#2F9E44', e: '🥛' },
  '이유식': { c: '#1C7ED6', e: '🥣' },
  '소변': { c: '#22B8CF', e: '💧' },
  '대변': { c: '#8D6E63', e: '💩' },
  '수면': { c: '#7048E8', e: '😴' },
};

// ---------- 상태 ----------
function loadState() {
  try {
    const s = JSON.parse(localStorage.getItem(LS_KEY)) || null;
    if (s) s.records = Object.assign({}, EMPTY_RECORDS, s.records);
    return s;
  } catch { return null; }
}
function saveState(s) { localStorage.setItem(LS_KEY, JSON.stringify(s)); }
let state = loadState();

// ---------- 날짜 유틸 ----------
function parseDate(str) { const [y, m, d] = str.split('-').map(Number); return new Date(y, m - 1, d); }
function today() { const t = new Date(); return new Date(t.getFullYear(), t.getMonth(), t.getDate()); }
function addMonths(date, m) {
  const whole = Math.floor(m), frac = m - whole;
  const d = new Date(date.getFullYear(), date.getMonth() + whole, date.getDate());
  return frac ? new Date(d.getTime() + Math.round(frac * 30 * DAY)) : d;
}
function addDays(date, n) { return new Date(date.getTime() + n * DAY); }
function addWeeks(date, w) { return new Date(date.getTime() + Math.round(w * 7 * DAY)); }
function fmt(d) { return `${d.getFullYear()}.${String(d.getMonth() + 1).padStart(2, '0')}.${String(d.getDate()).padStart(2, '0')}`; }
function isoDate(d) { return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`; }
function nowTime() { const n = new Date(); return `${String(n.getHours()).padStart(2, '0')}:${String(n.getMinutes()).padStart(2, '0')}`; }
function fmtShort(d) { return `${d.getMonth() + 1}/${d.getDate()}`; }
function daysBetween(a, b) { return Math.round((b - a) / DAY); }

function birth() { return parseDate(state.birth); }
function wwBase() { return state.due ? parseDate(state.due) : birth(); }
function ageDays() { return daysBetween(birth(), today()); }
function ageMonths() {
  const b = birth(), t = today();
  let m = (t.getFullYear() - b.getFullYear()) * 12 + (t.getMonth() - b.getMonth());
  if (t.getDate() < b.getDate()) m--;
  return Math.max(0, m);
}

// ---------- 일정 계산 ----------
function eventWindow(ev) {
  const b = birth();
  const start = ev.startD != null ? addDays(b, ev.startD) : addMonths(b, ev.startM);
  const end = ev.endD != null ? addDays(b, ev.endD)
    : (ev.endM != null && ev.endM !== ev.startM) ? addMonths(b, ev.endM) : start;
  // 단일 날짜형(생후 n개월)은 권장일 이후 30일까지를 접종 가능 기간으로 봄
  const graceEnd = end.getTime() === start.getTime() ? addDays(end, 30) : end;
  return { start, end, graceEnd };
}
function activeVaccines() {
  const rota = state.rota || 'rotateq';
  return VACCINES.filter(v => !v.rota || v.rota === 'both' || v.rota === rota);
}
function allEvents() {
  const vs = activeVaccines().map(v => ({ ...v, type: 'vaccine', label: `${v.vaccine} ${v.dose}` }));
  const cs = CHECKUPS.map(c => ({ ...c, type: 'checkup', label: c.name }));
  return [...vs, ...cs]
    .map(ev => ({ ...ev, ...eventWindow(ev) }))
    .sort((a, b) => a.start - b.start);
}
function eventStatus(ev) {
  if (state.done[ev.id]) return 'done';
  const t = today();
  if (t > ev.graceEnd) return 'overdue';
  if (t >= ev.start) return 'open';       // 접종 가능 기간
  return 'upcoming';
}
function currentLeap() {
  const w = daysBetween(wwBase(), today()) / 7;
  return LEAPS.find(l => w >= l.startW && w <= l.endW) || null;
}
function nextLeap() {
  const w = daysBetween(wwBase(), today()) / 7;
  return LEAPS.find(l => l.startW > w) || null;
}
function currentLangStage() {
  const m = ageMonths();
  return LANG_MILESTONES.find(s => m >= s.startM && m <= s.endM) || null;
}

// ---------- 렌더 ----------
const $ = sel => document.querySelector(sel);

function render() {
  if (!state || !state.birth) { $('#onboarding').hidden = false; $('#app').hidden = true; return; }
  $('#onboarding').hidden = true; $('#app').hidden = false;
  renderHome(); renderSchedule(); renderLeaps(); renderLang(); renderRecord();
}

function renderHome() {
  const d = ageDays(), m = ageMonths(), w = Math.floor(d / 7);
  const nm = state.name || '아기';
  const last = nm.charCodeAt(nm.length - 1);
  const josa = last >= 0xAC00 && last <= 0xD7A3 && (last - 0xAC00) % 28 !== 0 ? '과' : '와';
  $('#home-name').textContent = nm + josa;
  $('#home-dday').textContent = `D+${d}`;
  const subChips = [`생후 ${w}주`, `${m}개월`];
  if (state.due && state.due !== state.birth) {
    const cw = Math.floor(daysBetween(wwBase(), today()) / 7);
    subChips.push(`교정 ${cw}주`);
  }
  $('#home-sub').innerHTML = subChips.map(c => `<span>${c}</span>`).join('');

  const cards = [];
  // 1) 원더윅스
  const leap = currentLeap(), next = nextLeap();
  if (leap) {
    cards.push(card('🌩️', `원더윅스 ${leap.n}차 도약기 진행 중`,
      `<b>「${leap.name}」</b> ${leap.baby}<br><span class="tip">💡 ${leap.tip}</span>`, '', '#7048E8'));
  } else if (next) {
    const dd = daysBetween(today(), addWeeks(wwBase(), next.startW));
    cards.push(card('🌤️', `지금은 맑음! 다음 도약기까지 ${dd}일`,
      `${next.n}차 「${next.name}」 — ${fmt(addWeeks(wwBase(), next.startW))}경 시작 예상`, '', '#7048E8'));
  }
  // 2) 놓친 접종·검진
  const events = allEvents();
  const overdue = events.filter(ev => eventStatus(ev) === 'overdue');
  if (overdue.length) {
    cards.push(card('⚠️', `지난 일정 ${overdue.length}건 미체크`,
      overdue.slice(0, 3).map(ev => ev.label).join(', ') + (overdue.length > 3 ? ' 외' : '') +
      '<br><span class="tip">완료했다면 일정 탭에서 체크해주세요. 놓쳤다면 병원과 따라잡기 일정을 상담하세요.</span>', 'warn', '#D6336C'));
  }
  // 3) 접종 가능 기간 + 30일 내 다가오는 일정
  const openNow = events.filter(ev => eventStatus(ev) === 'open');
  const soon = events.filter(ev => eventStatus(ev) === 'upcoming' && daysBetween(today(), ev.start) <= 30);
  if (openNow.length) {
    cards.push(card('💉', '지금 접종·검진 가능 기간',
      openNow.map(ev => `${ev.label} <span class="date">(${ev.end > ev.start ? `~${fmt(ev.end)}` : `권장일 ${fmt(ev.start)}`})</span>`).join('<br>'), '', '#2B8A3E'));
  }
  if (soon.length) {
    cards.push(card('🗓️', '30일 안에 다가와요',
      soon.map(ev => `${ev.label} <span class="date">${fmt(ev.start)}${ev.end > ev.start ? '~' : ''}</span>`).join('<br>'), '', '#F59F00'));
  }
  // 4) 기록 기반 비서 카드 (배변 경고 / 오늘 수유 / 알레르기 관찰)
  const tISO = isoDate(today());
  const poopToday = state.records.poop.filter(p => p.d === tISO);
  const dangerPoop = poopToday.map(p => POOP_COLORS.find(c => c.id === p.color)).find(c => c && c.level === 'danger');
  if (dangerPoop) {
    cards.push(card('💩', `오늘 배변 색(${dangerPoop.name}) 확인 필요`, `${dangerPoop.note}`, 'warn', '#D6336C'));
  }
  const feedToday = state.records.feed.filter(f => f.d === tISO);
  if (feedToday.length) {
    cards.push(card('🍼', '오늘 수유', feedSummary(feedToday) + `<br><a href="#" class="link" data-goto="record">기록 탭에서 자세히 →</a>`, '', '#F59F00'));
  }
  const watching = state.records.solids.filter(s => s.status === 'watch');
  if (watching.length) {
    cards.push(card('🥣', '알레르기 관찰 중인 새 재료', watching.map(s => `${s.name} (${daysBetween(parseDate(s.start), today()) + 1}일차/3일)`).join(', '), '', '#1C7ED6'));
  }
  // 5) 언어발달
  const lang = currentLangStage();
  if (lang) {
    cards.push(card('🗣️', lang.title, `${lang.items[0]}<br><span class="tip">💡 ${lang.parentTip}</span>
      <br><a href="#" class="link" data-goto="lang">발달 탭에서 체크하기 →</a>`, '', '#2B8A3E'));
  }
  $('#home-cards').innerHTML = cards.join('');
}

function card(emoji, title, body, cls = '', accent = '#E8590C') {
  return `<div class="card ${cls}" style="--ac:${accent}">
    <div class="card-ico">${emoji}</div>
    <div class="card-main"><div class="card-title">${title}</div><div class="card-body">${body}</div></div>
  </div>`;
}

function renderSchedule() {
  const events = allEvents();
  const rows = events.map(ev => {
    const st = eventStatus(ev);
    const range = ev.end > ev.start ? `${fmt(ev.start)} ~ ${fmt(ev.end)}` : fmt(ev.start);
    const badge = { done: '완료', overdue: '지남', open: '지금', upcoming: '예정' }[st];
    return `<label class="row ${st}">
      <input type="checkbox" data-id="${ev.id}" ${state.done[ev.id] ? 'checked' : ''}>
      <span class="row-main">
        <span class="row-label">${ev.type === 'checkup' ? '🩺' : '💉'} ${ev.label}</span>
        <span class="row-date">${range}${ev.note ? ` · ${ev.note}` : ''}</span>
      </span>
      <span class="badge b-${st}">${badge}</span>
    </label>`;
  });
  $('#schedule-list').innerHTML = rows.join('');
}

function renderLeaps() {
  const base = wwBase();
  const cur = currentLeap();
  $('#leaps-base').textContent = state.due && state.due !== state.birth
    ? `출산예정일(${fmt(parseDate(state.due))}) 기준` : '생년월일 기준 (출산예정일 입력 시 더 정확해요)';
  $('#leaps-list').innerHTML = LEAPS.map(l => {
    const s = addWeeks(base, l.startW), e = addWeeks(base, l.endW);
    const isCur = cur && cur.n === l.n;
    const past = today() > e;
    return `<div class="leap ${isCur ? 'current' : ''} ${past ? 'past' : ''}">
      <div class="leap-head"><span class="leap-n">${l.n}차</span> <b>${l.name}</b>
        <span class="leap-date">${fmtShort(s)}~${fmtShort(e)} (${Math.round(l.startW)}~${Math.round(l.endW)}주)</span>
        ${isCur ? '<span class="badge b-open">진행 중</span>' : ''}</div>
      <div class="leap-body">👶 ${l.baby}<br>💡 ${l.tip}</div>
    </div>`;
  }).join('');
}

function renderLang() {
  const m = ageMonths();
  $('#lang-list').innerHTML = LANG_MILESTONES.map(s => {
    const isCur = m >= s.startM && m <= s.endM;
    const items = s.items.map((it, i) => {
      const key = `lang-${s.startM}-${i}`;
      return `<label class="check-item"><input type="checkbox" data-id="${key}" ${state.done[key] ? 'checked' : ''}> ${it}</label>`;
    }).join('');
    return `<div class="lang-stage ${isCur ? 'current' : ''}">
      <div class="lang-title">${s.title} ${isCur ? '<span class="badge b-open">지금</span>' : ''}</div>
      ${items}
      <div class="motor">🏃 몸: ${s.motor}</div>
      <div class="tip">💡 ${s.parentTip}</div>
      ${s.redFlag ? `<div class="redflag">🚨 ${s.redFlag}</div>` : ''}
      <details ${isCur ? 'open' : ''}>
        <summary>🧸 이 시기 놀이법 & 장난감 가이드</summary>
        <ul>${s.play.map(p => `<li>${p}</li>`).join('')}</ul>
        <div class="toy-line"><b>추천 장난감:</b> ${s.toys.join(', ')}</div>
        <div class="toy-skip">✋ ${s.toySkip}</div>
      </details>
    </div>`;
  }).join('');
}

// ---------- 기록 탭 ----------
function feedSummary(entries) {
  const byType = {};
  entries.forEach(f => {
    byType[f.type] = byType[f.type] || { n: 0, amt: 0 };
    byType[f.type].n++; byType[f.type].amt += f.amt || 0;
  });
  return Object.entries(byType).map(([t, v]) =>
    `${t} ${v.n}회${v.amt ? ` · ${v.amt}${t === '모유' ? '분' : t === '이유식' ? 'g' : 'ml'}` : ''}`).join(' / ');
}

// 기록 이벤트 유틸
function dtOf(e) { return new Date(`${e.d}T${e.t || '00:00'}`); }
function timeAgo(dt) {
  const m = Math.floor((new Date() - dt) / 60000);
  if (m < 1) return '방금';
  if (m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}시간 ${m % 60}분 전`;
  const d = Math.floor(h / 24);
  return `${d}일 ${h % 24}시간 전`;
}
function latestOf(arr) { return arr.length ? arr.reduce((a, b) => dtOf(a) >= dtOf(b) ? a : b) : null; }
// 수면 상태: 마지막 이벤트가 '잠듦'이면 자는 중
function sleepState() {
  const ev = state.records.sleep;
  const last = ev.length ? ev[ev.length - 1] : null;
  return { asleep: !!last && last.ev === 'sleep', last };
}
// 잠듦→기상 짝 지어 세션 목록으로 (자는 중이면 end=null)
function sleepSessions() {
  const out = [];
  let open = null;
  for (const e of state.records.sleep) {
    if (e.ev === 'sleep') { if (open) out.push({ start: open, end: null }); open = e; }
    else if (open) { out.push({ start: open, end: e }); open = null; }
  }
  if (open) out.push({ start: open, end: null });
  return out;
}
// 모든 기록을 통합 이벤트로 (일별 로그·차트용)
function allRecordEvents() {
  const r = state.records, out = [];
  r.feed.forEach((f, i) => out.push({ kind: f.type, d: f.d, t: f.t, coll: 'feed', idx: i,
    text: `${f.type}${f.amt ? ` ${f.amt}${f.type === '모유' ? '분' : f.type === '이유식' ? 'g' : 'ml'}` : ''}` }));
  r.pee.forEach((p, i) => out.push({ kind: '소변', d: p.d, t: p.t, coll: 'pee', idx: i, text: '소변' }));
  r.poop.forEach((p, i) => {
    const c = POOP_COLORS.find(x => x.id === p.color);
    out.push({ kind: '대변', d: p.d, t: p.t, coll: 'poop', idx: i, text: `대변 · ${c ? c.name : ''}`, level: c && c.level });
  });
  r.sleep.forEach((s, i) => out.push({ kind: '수면', d: s.d, t: s.t, coll: 'sleep', idx: i, text: s.ev === 'sleep' ? '잠듦' : '기상' }));
  return out;
}

function renderLastSummary() {
  const r = state.records;
  const chips = [];
  const lastFeed = latestOf(r.feed);
  chips.push(`<span class="chip" style="--cc:${CATS['분유'].c}">🍼 마지막 수유 <b>${lastFeed ? timeAgo(dtOf(lastFeed)) : '기록 없음'}</b></span>`);
  const lastDiaper = latestOf([...r.pee.map(p => ({ ...p, k: '소변' })), ...r.poop.map(p => ({ ...p, k: '대변' }))]);
  chips.push(`<span class="chip" style="--cc:${CATS['대변'].c}">💧 마지막 기저귀 <b>${lastDiaper ? `${timeAgo(dtOf(lastDiaper))} (${lastDiaper.k})` : '기록 없음'}</b></span>`);
  const ss = sleepState();
  chips.push(`<span class="chip" style="--cc:${CATS['수면'].c}">😴 ${ss.asleep ? `자는 중 · <b>${timeAgo(dtOf(ss.last)).replace(' 전', '째')}</b>` : `마지막 잠 <b>${ss.last ? timeAgo(dtOf(ss.last)) : '기록 없음'}</b>`}</span>`);
  $('#last-summary').innerHTML = chips.join('');
}

function renderQuickRow() {
  const ss = sleepState();
  const btns = ['모유', '분유', '유축', '이유식'].map(t =>
    `<button type="button" class="quick" data-quick="feed" data-type="${t}" style="--cc:${CATS[t].c}"><span class="q-ico">${CATS[t].e}</span>${t}</button>`);
  btns.push(`<button type="button" class="quick" data-quick="pee" style="--cc:${CATS['소변'].c}"><span class="q-ico">💧</span>소변</button>`);
  btns.push(`<button type="button" class="quick" data-quick="poop" style="--cc:${CATS['대변'].c}"><span class="q-ico">💩</span>대변</button>`);
  btns.push(`<button type="button" class="quick ${ss.asleep ? 'on' : ''}" data-quick="sleep" style="--cc:${CATS['수면'].c}"><span class="q-ico">${ss.asleep ? '🌞' : '😴'}</span>${ss.asleep ? '기상' : '잠듦'}</button>`);
  $('#quick-row').innerHTML = btns.join('');
}

function renderDayLog() {
  const events = allRecordEvents();
  const days = [];
  for (let i = 0; i < 7; i++) days.push(isoDate(addDays(today(), -i)));
  const html = days.map(d => {
    const evs = events.filter(e => e.d === d).sort((a, b) => (b.t || '').localeCompare(a.t || ''));
    if (!evs.length) return '';
    const feeds = state.records.feed.filter(f => f.d === d);
    const totals = [];
    if (feeds.length) totals.push(feedSummary(feeds));
    const poopN = state.records.poop.filter(p => p.d === d).length;
    const peeN = state.records.pee.filter(p => p.d === d).length;
    if (poopN || peeN) totals.push(`기저귀 ${poopN + peeN}회`);
    const dt = parseDate(d);
    const dayName = ['일', '월', '화', '수', '목', '금', '토'][dt.getDay()];
    const isToday = d === isoDate(today());
    return `<div class="day-group">
      <div class="day-head ${isToday ? 'today' : ''}"><b>${dt.getMonth() + 1}월 ${dt.getDate()}일 (${dayName})${isToday ? ' · 오늘' : ''}</b><span>${totals.join(' · ')}</span></div>
      ${evs.map(e => `<div class="evt ${e.level === 'danger' ? 'danger' : ''}">
        <span class="evt-ico" style="background:${CATS[e.kind].c}1F; border-color:${CATS[e.kind].c}55">${CATS[e.kind].e}</span>
        <span class="evt-time">${e.t || ''}</span>
        <span class="evt-text">${e.text}</span>
        <button type="button" class="rec-del" data-del="${e.coll}" data-idx="${e.idx}">✕</button>
      </div>`).join('')}
    </div>`;
  }).filter(Boolean).join('');
  $('#day-log').innerHTML = html || '<p class="empty">최근 7일 기록이 없어요. 위의 버튼으로 기록을 시작해보세요.</p>';
}

function renderChart() {
  const events = allRecordEvents();
  const days = [];
  for (let i = 6; i >= 0; i--) days.push(isoDate(addDays(today(), -i)));
  const topPct = t => { const [h, m] = (t || '00:00').split(':').map(Number); return (h + m / 60) / 24 * 100; };
  // 수면 블록: 세션을 날짜별로 자르기
  const sleepBlocks = {};
  for (const s of sleepSessions()) {
    const start = dtOf(s.start);
    const end = s.end ? dtOf(s.end) : new Date();
    let cur = new Date(start);
    while (cur < end) {
      const dISO = isoDate(cur);
      const dayEnd = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate() + 1);
      const segEnd = end < dayEnd ? end : dayEnd;
      const t0 = (cur.getHours() + cur.getMinutes() / 60) / 24 * 100;
      const t1 = (segEnd.getHours() + segEnd.getMinutes() / 60) / 24 * 100 || 100;
      (sleepBlocks[dISO] = sleepBlocks[dISO] || []).push({ top: t0, h: Math.max(t1 - t0, 0.8) });
      cur = dayEnd;
    }
  }
  const cols = days.map(d => {
    const dt = parseDate(d);
    const isToday = d === isoDate(today());
    const evs = events.filter(e => e.d === d);
    const marks = [];
    (sleepBlocks[d] || []).forEach(b => marks.push(`<div class="m-sleep" style="top:${b.top}%;height:${b.h}%"></div>`));
    evs.forEach(e => {
      if (e.kind === '수면') return;
      const top = topPct(e.t);
      if (e.kind === '대변') marks.push(`<div class="m-poop" style="top:${top}%">💩</div>`);
      else if (e.kind === '소변') marks.push(`<div class="m-bar" style="top:${top}%;background:${CATS['소변'].c};height:3px"></div>`);
      else marks.push(`<div class="m-bar" style="top:${top}%;background:${CATS[e.kind].c}" title="${e.text}"></div>`);
    });
    return `<div class="chart-day">
      <div class="chart-col">${marks.join('')}</div>
      <div class="chart-label ${isToday ? 'today' : ''}">${dt.getDate()}일</div>
    </div>`;
  }).join('');
  $('#chart').innerHTML = `
    <div class="chart-hours">${[0, 6, 12, 18, 24].map(h => `<span style="top:${h / 24 * 100}%">${String(h).padStart(2, '0')}</span>`).join('')}</div>
    <div class="chart-grid">${cols}</div>`;
}

function renderRecord() {
  const tISO = isoDate(today());
  renderLastSummary(); renderQuickRow(); renderDayLog();
  if (!$('#view-pattern').hidden) renderChart();

  // --- 배변 ---
  $('#poop-colors').innerHTML = POOP_COLORS.map(c =>
    `<button type="button" class="swatch" data-poop="${c.id}" title="${c.name}">
      <span class="dot" style="background:${c.hex}"></span>${c.name.split('(')[0]}</button>`).join('');
  const poops = state.records.poop.slice(-5).reverse();
  $('#poop-log').innerHTML = poops.length ? poops.map((p, i) => {
    const c = POOP_COLORS.find(x => x.id === p.color) || {};
    const prev = poops[i + 1] && POOP_COLORS.find(x => x.id === poops[i + 1].color);
    let compare = '';
    if (prev && i === 0) {
      compare = prev.id === c.id ? `지난번과 같은 ${c.name}이에요.` :
        `지난번(${prev.name}) → 이번(${c.name})으로 바뀌었어요.`;
      if (c.level === 'ok') compare += ' 정상 범위예요.';
    }
    return `<div class="rec-item ${c.level}">
      <span class="dot" style="background:${c.hex}"></span>
      <span class="rec-main">${p.d.slice(5).replace('-', '/')} ${p.t || ''} · ${c.name}
        <small>${i === 0 ? (compare ? compare + ' ' : '') + c.note : ''}</small></span>
      <button type="button" class="rec-del" data-del="poop" data-idx="${state.records.poop.length - 1 - i}">✕</button>
    </div>`;
  }).join('') : '<p class="empty">색을 눌러 오늘의 배변을 기록해보세요.</p>';

  // --- 수유 ---
  const feed = state.records.feed;
  const feedToday = feed.filter(f => f.d === tISO);
  const last7 = feed.filter(f => daysBetween(parseDate(f.d), today()) < 7);
  const days7 = new Set(last7.map(f => f.d)).size || 1;
  let stats = feedToday.length ? `<b>오늘:</b> ${feedSummary(feedToday)}` : '<b>오늘:</b> 아직 기록이 없어요';
  if (last7.length) {
    stats += `<br><b>최근 7일:</b> 하루 평균 ${(last7.length / days7).toFixed(1)}회, ${feedSummary(last7)}`;
    const milkToday = feedToday.filter(f => f.type === '분유').reduce((a, f) => a + (f.amt || 0), 0);
    const milk7 = last7.filter(f => f.type === '분유').reduce((a, f) => a + (f.amt || 0), 0) / days7;
    if (milkToday && milk7 && milkToday < milk7 * 0.7 && feedToday.length >= 3) {
      stats += `<br><span class="warn-text">📉 오늘 분유량이 최근 평균(${Math.round(milk7)}ml)보다 꽤 적어요.</span>`;
    }
  }
  $('#feed-stats').innerHTML = stats;

  // --- 이유식 단계 + 알레르기 ---
  const m = ageMonths();
  const stage = SOLID_STAGES.find(s => m >= s.startM && m <= s.endM);
  $('#solid-stage').innerHTML = stage
    ? `<div class="stage-box"><b>${stage.name}</b> — ${stage.form} · ${stage.freq}<br><span class="tip">💡 ${stage.tip}</span></div>`
    : `<div class="stage-box">아직 이유식 전이에요 (보통 생후 4~6개월 시작). 시작 전 소아청소년과와 상의하세요.</div>`;
  $('#solid-log').innerHTML = state.records.solids.slice().reverse().map(s => {
    const idx = state.records.solids.indexOf(s);
    const day = daysBetween(parseDate(s.start), today()) + 1;
    const badge = s.status === 'ok' ? '<span class="badge b-open">이상 없음</span>'
      : s.status === 'react' ? '<span class="badge b-overdue">반응 있음</span>'
      : `<span class="badge b-upcoming">관찰 ${Math.min(day, 3)}일차/3일</span>`;
    const btns = s.status === 'watch'
      ? `<button type="button" class="mini ok" data-solid="ok" data-idx="${idx}">이상없음</button>
         <button type="button" class="mini bad" data-solid="react" data-idx="${idx}">반응있음</button>` : '';
    return `<div class="rec-item"><span class="rec-main">🥕 ${s.name} <small>(${s.start.slice(5).replace('-', '/')} 시작)</small> ${badge}
      ${s.status === 'react' ? '<small class="warn-text">발진·구토 등이 있었다면 해당 재료를 중단하고 소아청소년과와 상의하세요.</small>' : ''}</span>${btns}
      <button type="button" class="rec-del" data-del="solids" data-idx="${idx}">✕</button></div>`;
  }).join('') || '<p class="empty">새로 시도한 재료를 등록하면 3일 관찰을 도와드려요.</p>';
  $('#allergy-list').innerHTML = ALLERGY_NOTES.map(n => `<li>${n}</li>`).join('');
}

// ---------- 캘린더(.ics) 내보내기 ----------
function icsDate(d) { return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`; }
function icsEscape(s) { return String(s).replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,'); }

function buildICS() {
  const nm = state.name || '아기';
  const lines = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//BabyBloom//KR', 'CALSCALE:GREGORIAN',
    `X-WR-CALNAME:${icsEscape(`베이비블룸 · ${nm}`)}`,
  ];
  const pushEvent = (uid, date, endDate, title, desc) => {
    lines.push('BEGIN:VEVENT', `UID:${uid}@babybloom`,
      `DTSTAMP:${icsDate(today())}T000000Z`,
      `DTSTART;VALUE=DATE:${icsDate(date)}`,
      `DTEND;VALUE=DATE:${icsDate(addDays(endDate || date, 1))}`,
      `SUMMARY:${icsEscape(title)}`,
      `DESCRIPTION:${icsEscape(desc + ' — 베이비블룸(참고용, 병원과 상담하세요)')}`,
      'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${icsEscape(title)}`, 'TRIGGER:-P1D', 'END:VALARM',
      'END:VEVENT');
  };
  // 접종·검진: 완료 안 된 미래·진행 중 일정만
  allEvents().forEach(ev => {
    const st = eventStatus(ev);
    if (st !== 'upcoming' && st !== 'open') return;
    const icon = ev.type === 'checkup' ? '🩺' : '💉';
    const range = ev.end > ev.start ? `기간: ${fmt(ev.start)}~${fmt(ev.end)}` : `권장일: ${fmt(ev.start)}`;
    pushEvent(ev.id, ev.start, null, `${icon} ${nm} ${ev.label}`, `${range}${ev.note ? ' · ' + ev.note : ''}`);
  });
  // 원더윅스: 아직 안 온 도약기 시작일
  const base = wwBase();
  LEAPS.forEach(l => {
    const s = addWeeks(base, l.startW), e = addWeeks(base, l.endW);
    if (e < today()) return;
    pushEvent(`leap${l.n}`, s, null, `🌩️ ${nm} 원더윅스 ${l.n}차 「${l.name}」 시작 예상`, `${fmtShort(s)}~${fmtShort(e)} (±1~2주 개인차)`);
  });
  lines.push('END:VCALENDAR');
  return lines.join('\r\n');
}

// ---------- 이벤트 ----------
document.addEventListener('DOMContentLoaded', () => {
  // 온보딩 제출
  $('#onboard-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#in-name').value.trim();
    const birthV = $('#in-birth').value;
    if (!birthV) return;
    state = {
      name, birth: birthV, due: $('#in-due').value || '', rota: $('#in-rota').value,
      done: (state && state.done) || {},
      records: Object.assign({}, EMPTY_RECORDS, state && state.records),
    };
    saveState(state); render();
  });

  // 탭 전환
  document.querySelectorAll('.tab').forEach(btn => btn.addEventListener('click', () => switchTab(btn.dataset.tab)));

  // 체크박스(일정·발달) + 홈 링크 위임
  document.body.addEventListener('change', e => {
    if (e.target.matches('input[type=checkbox][data-id]')) {
      state.done[e.target.dataset.id] = e.target.checked;
      if (!e.target.checked) delete state.done[e.target.dataset.id];
      saveState(state); renderHome(); renderSchedule();
    }
  });
  document.body.addEventListener('click', e => {
    const link = e.target.closest('[data-goto]');
    if (link) { e.preventDefault(); switchTab(link.dataset.goto); return; }

    const sw = e.target.closest('[data-poop]');
    if (sw) {
      state.records.poop.push({ d: isoDate(today()), t: nowTime(), color: sw.dataset.poop });
      saveState(state); renderRecord(); renderHome(); return;
    }
    const qk = e.target.closest('[data-quick]');
    if (qk) {
      const q = qk.dataset.quick;
      if (q === 'feed') {
        $('#feed-type').value = qk.dataset.type;
        document.querySelector('#feed-form').scrollIntoView({ behavior: 'smooth', block: 'center' });
        $('#feed-amt').focus();
      } else if (q === 'pee') {
        state.records.pee.push({ d: isoDate(today()), t: nowTime() });
        saveState(state); renderRecord();
      } else if (q === 'poop') {
        document.querySelector('#poop-colors').scrollIntoView({ behavior: 'smooth', block: 'center' });
      } else if (q === 'sleep') {
        const ev = sleepState().asleep ? 'wake' : 'sleep';
        state.records.sleep.push({ d: isoDate(today()), t: nowTime(), ev });
        saveState(state); renderRecord();
      }
      return;
    }
    const seg = e.target.closest('.seg-btn');
    if (seg) {
      document.querySelectorAll('.seg-btn').forEach(b => b.classList.toggle('active', b === seg));
      $('#view-rec').hidden = seg.dataset.view !== 'rec';
      $('#view-pattern').hidden = seg.dataset.view !== 'pattern';
      if (seg.dataset.view === 'pattern') renderChart();
      return;
    }
    const sb = e.target.closest('[data-solid]');
    if (sb) {
      state.records.solids[Number(sb.dataset.idx)].status = sb.dataset.solid;
      saveState(state); renderRecord(); renderHome(); return;
    }
    const del = e.target.closest('[data-del]');
    if (del) {
      state.records[del.dataset.del].splice(Number(del.dataset.idx), 1);
      saveState(state); renderRecord(); renderHome(); return;
    }
  });

  // 수유 기록 추가 (시간 수정 가능, 비우면 지금)
  $('#feed-form').addEventListener('submit', e => {
    e.preventDefault();
    const type = $('#feed-type').value;
    const amt = Number($('#feed-amt').value) || 0;
    const t = $('#feed-time').value || nowTime();
    state.records.feed.push({ d: isoDate(today()), t, type, amt });
    state.records.feed.sort((a, b) => dtOf(a) - dtOf(b));
    saveState(state); $('#feed-amt').value = ''; $('#feed-time').value = '';
    renderRecord(); renderHome();
  });

  // 새 이유식 재료 등록
  $('#solid-form').addEventListener('submit', e => {
    e.preventDefault();
    const name = $('#solid-name').value.trim();
    if (!name) return;
    state.records.solids.push({ name, start: isoDate(today()), status: 'watch' });
    saveState(state); $('#solid-name').value = '';
    renderRecord(); renderHome();
  });

  // 설정(아기 정보 수정)
  $('#btn-edit').addEventListener('click', () => {
    $('#in-name').value = state.name || '';
    $('#in-birth').value = state.birth || '';
    $('#in-due').value = state.due || '';
    $('#in-rota').value = state.rota || 'rotateq';
    $('#onboarding').hidden = false; $('#app').hidden = true;
  });

  // 캘린더 내보내기
  $('#btn-ics').addEventListener('click', () => {
    if (!state) return;
    const blob = new Blob([buildICS()], { type: 'text/calendar;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `babybloom-${state.name || '아기'}-일정.ics`;
    a.click();
    URL.revokeObjectURL(a.href);
  });

  // 데이터 백업 / 복원
  $('#btn-export').addEventListener('click', () => {
    if (!state) { alert('저장된 데이터가 없어요.'); return; }
    const blob = new Blob([JSON.stringify(state, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `babybloom-backup-${isoDate(today())}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  });
  $('#btn-import').addEventListener('click', () => $('#import-file').click());
  $('#import-file').addEventListener('change', e => {
    const f = e.target.files[0];
    if (!f) return;
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const s = JSON.parse(reader.result);
        if (!s || !s.birth) throw new Error('형식 오류');
        s.records = Object.assign({}, EMPTY_RECORDS, s.records);
        state = s; saveState(state); render();
        alert('백업을 불러왔어요! 🌷');
      } catch { alert('올바른 백업 파일이 아니에요.'); }
      e.target.value = '';
    };
    reader.readAsText(f);
  });

  // PWA 서비스워커 등록 (오프라인 지원)
  if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('sw.js').catch(() => {});
  }

  render();
});

function switchTab(tab) {
  document.querySelectorAll('.tab').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  document.querySelectorAll('.panel').forEach(p => p.hidden = p.id !== `panel-${tab}`);
  window.scrollTo(0, 0);
}
