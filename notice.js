/* ================= 공지사항 (팀 전체 공유, 제한 없는 CRUD) ================= */
const NOTICE_PATH = '/notices.json';
let notices = {}; // {id: {title, body}}
let noticeEditId = null;

/* 캘린더 — 유튜브와 동일한 API 키 재사용, 읽기 전용 */
const CALENDAR_ID = JUNGLE_CONFIG.calendarId;
const CALENDAR_WINDOW_DAYS = JUNGLE_CONFIG.calendarWindowDays;

function noticeEsc(s){
  return String(s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}

async function loadNotices(){
  try{
    const res = await dbFetch(FIREBASE_URL + NOTICE_PATH);
    const data = await res.json();
    notices = data || {};
  }catch(e){ notices = {}; }
  renderNotices();
}
async function createNotice(title, body){
  const res = await dbFetch(FIREBASE_URL + NOTICE_PATH, {
    method:'POST', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({title, body})
  });
  const data = await res.json();
  return data.name;
}
async function updateNotice(id, title, body){
  await dbFetch(FIREBASE_URL + '/notices/' + id + '.json', {
    method:'PUT', headers:{'Content-Type':'application/json'},
    body: JSON.stringify({title, body})
  });
}
async function deleteNotice(id){
  await dbFetch(FIREBASE_URL + '/notices/' + id + '.json', {method:'DELETE'});
}

/* ---------- 이번 주 일정 (구글 캘린더, 읽기 전용) ---------- */
function calFormatTime(iso){
  const d = new Date(iso);
  let h = d.getHours();
  const ampm = h < 12 ? '오전' : '오후';
  let h12 = h % 12; if(h12 === 0) h12 = 12;
  const m = d.getMinutes();
  return `${ampm} ${h12}시${m ? ' ' + m + '분' : ''}`;
}
function calFormatDay(dateObj){
  const days = ['일','월','화','수','목','금','토'];
  return `${dateObj.getDate()}(${days[dateObj.getDay()]})`;
}
async function loadWeeklyCalendar(){
  const body = document.getElementById('calMemoBody');
  if(!body) return;
  if(!JUNGLE_CONFIG.googleApiKey){
    body.innerHTML = `<div class="empty-hint">API 키가 설정되어 있지 않습니다.</div>`;
    return;
  }
  try{
    const now = new Date();
    const timeMin = new Date(now); timeMin.setHours(0,0,0,0);
    const timeMax = new Date(timeMin); timeMax.setDate(timeMax.getDate() + CALENDAR_WINDOW_DAYS);
    const url = `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(CALENDAR_ID)}/events`
      + `?key=${encodeURIComponent(JUNGLE_CONFIG.googleApiKey)}&timeMin=${encodeURIComponent(timeMin.toISOString())}`
      + `&timeMax=${encodeURIComponent(timeMax.toISOString())}&singleEvents=true&orderBy=startTime`;
    const res = await fetch(url);
    const data = await res.json();
    if(!res.ok){
      body.innerHTML = `<div class="empty-hint">일정을 불러오지 못했습니다${data.error?.message?' ('+noticeEsc(data.error.message)+')':''}.</div>`;
      return;
    }
    renderWeeklyCalendar(data.items || []);
  }catch(e){
    body.innerHTML = `<div class="empty-hint">일정을 불러오지 못했습니다.</div>`;
  }
}
function renderWeeklyCalendar(items){
  const body = document.getElementById('calMemoBody');
  if(!body) return;
  if(items.length === 0){
    body.innerHTML = `<div class="empty-hint">이번 주 등록된 일정이 없습니다.</div>`;
    return;
  }
  const byDay = {};
  const order = [];
  items.forEach(ev=>{
    const startRaw = ev.start?.dateTime || ev.start?.date;
    const endRaw = ev.end?.dateTime || ev.end?.date;
    if(!startRaw) return;
    const d = new Date(startRaw);
    const dayKey = calFormatDay(d);
    if(!byDay[dayKey]){ byDay[dayKey] = []; order.push(dayKey); }
    const timeLabel = ev.start?.dateTime
      ? `${calFormatTime(startRaw)}${endRaw ? ' ~ ' + calFormatTime(endRaw) : ''}`
      : '종일';
    byDay[dayKey].push({title: ev.summary || '(제목 없음)', time: timeLabel});
  });
  body.innerHTML = order.map(dayKey=>`
    <div class="cal-day">
      <div class="cal-date">${noticeEsc(dayKey)}</div>
      ${byDay[dayKey].map(e=>`
        <div class="cal-event">${noticeEsc(e.title)}<span class="cal-time">${noticeEsc(e.time)}</span></div>
      `).join('')}
    </div>
  `).join('');
}

const NOTICE_MEMO_COLORS = ['notice-y','notice-p','notice-b'];
const noticeOpenIds = new Set();   // 펼친 공지 (새로고침하면 다시 전부 접힘)

function renderNotices(){
  const grid = document.getElementById('noticeGrid');
  if(!grid) return;
  // 일정 카드는 공지 카드들과 같은 매이슨리 흐름 안에 있어야 "일정 아래에도 포스트잇이 붙는다" —
  // 매번 innerHTML을 통째로 갈아끼우므로, 지우기 전에 현재 상태 그대로 떼어뒀다가 맨 앞에 되돌려놓는다.
  const calCard = document.getElementById('calMemoCard');
  const calHtml = calCard ? calCard.outerHTML : '';
  const ids = Object.keys(notices);
  if(ids.length===0){
    grid.innerHTML = calHtml + `<div class="empty-hint">아직 등록된 공지사항이 없습니다.</div>`;
    wireNoticeEvents();
    return;
  }
  grid.innerHTML = calHtml + ids.map((id, idx)=>{
    const n = notices[id] || {};
    const isEdit = noticeEditId===id;
    const colorClass = NOTICE_MEMO_COLORS[idx % NOTICE_MEMO_COLORS.length];
    if(isEdit){
      return `
      <div class="notice-card ${colorClass} notice-editing">
        <input class="notice-edit-title" id="noticeEditTitle" value="${noticeEsc(n.title)}" placeholder="제목">
        <textarea class="notice-edit-body" id="noticeEditBody" placeholder="내용">${noticeEsc(n.body)}</textarea>
        <div class="notice-actions">
          <button class="primary small" data-notice-save="${id}">저장</button>
          <button class="ghost small" data-notice-cancel="${id}">취소</button>
        </div>
      </div>`;
    }
    // 제목 줄 아코디언 — 기본은 접힘, 제목 줄(오른쪽 화살표)을 누르면 본문·수정/삭제가 펼쳐짐 (2026-09-24)
    const open = noticeOpenIds.has(id);
    return `
    <div class="notice-card ${colorClass}${open ? ' open' : ''}" data-notice-card="${id}">
      <button class="notice-head" data-notice-toggle="${id}" aria-expanded="${open}">
        <span class="notice-title">${noticeEsc(n.title)}</span>
        <svg class="notice-caret" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 9 6 6 6-6"/></svg>
      </button>
      <div class="notice-fold">
        <div class="notice-body">${noticeEsc(n.body)}</div>
        <div class="notice-actions">
          <button class="ghost small" data-notice-edit="${id}">수정</button>
          <button class="ghost small" data-notice-delete="${id}">삭제</button>
        </div>
      </div>
    </div>`;
  }).join('');
  wireNoticeEvents();
}

function wireNoticeEvents(){
  document.querySelectorAll('[data-notice-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const id = btn.dataset.noticeToggle;
      const open = !noticeOpenIds.has(id);
      if(open) noticeOpenIds.add(id); else noticeOpenIds.delete(id);
      btn.closest('.notice-card')?.classList.toggle('open', open);
      btn.setAttribute('aria-expanded', String(open));
    };
  });
  document.querySelectorAll('[data-notice-edit]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); noticeEditId = btn.dataset.noticeEdit; renderNotices(); };
  });
  document.querySelectorAll('[data-notice-delete]').forEach(btn=>{
    btn.onclick = async (e)=>{
      e.stopPropagation();
      const id = btn.dataset.noticeDelete;
      if(!confirm('이 공지를 삭제할까요?')) return;
      await deleteNotice(id);
      delete notices[id];
      renderNotices();
    };
  });
  document.querySelectorAll('[data-notice-save]').forEach(btn=>{
    btn.onclick = async (e)=>{
      e.stopPropagation();
      const id = btn.dataset.noticeSave;
      const title = document.getElementById('noticeEditTitle').value.trim();
      const body = document.getElementById('noticeEditBody').value.trim();
      if(!title) return;
      await updateNotice(id, title, body);
      notices[id] = {title, body};
      noticeEditId = null;
      renderNotices();
    };
  });
  document.querySelectorAll('[data-notice-cancel]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); noticeEditId = null; renderNotices(); };
  });
}

document.getElementById('noticeNewBtn').onclick = ()=>{
  const form = document.getElementById('noticeNewForm');
  form.style.display = (form.style.display==='none') ? '' : 'none';
};
document.getElementById('noticeNewCancel').onclick = ()=>{
  document.getElementById('noticeNewTitle').value = '';
  document.getElementById('noticeNewBody').value = '';
  document.getElementById('noticeNewForm').style.display = 'none';
};
document.getElementById('noticeNewSave').onclick = async ()=>{
  const title = document.getElementById('noticeNewTitle').value.trim();
  const body = document.getElementById('noticeNewBody').value.trim();
  if(!title) return;
  const id = await createNotice(title, body);
  notices[id] = {title, body};
  document.getElementById('noticeNewTitle').value = '';
  document.getElementById('noticeNewBody').value = '';
  document.getElementById('noticeNewForm').style.display = 'none';
  renderNotices();
};

/* 로그인 게이트(app.js) 이후에 호출된다 — RTDB 요청이 인증 토큰을 실을 수 있도록.
   자동 실행하지 않음. */
window.initNoticeData = function(){
  loadNotices();
  loadWeeklyCalendar();
};

/* ---------- 셸 동작: 데스크톱 사이드바 접기 (모바일 서랍은 app.js) ---------- */
(function(){
  const SB_KEY = 'jsp_sidebar_collapsed';
  if(localStorage.getItem(SB_KEY)==='1') document.body.classList.add('sidebar-collapsed');
  const tg = document.getElementById('sidebarToggleBtn');
  if(tg) tg.onclick = ()=>{
    const c = document.body.classList.toggle('sidebar-collapsed');
    try{ localStorage.setItem(SB_KEY, c?'1':'0'); }catch(e){}
  };
})();
