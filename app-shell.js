/* 화면 전환·메뉴 on/off·헤더 통합
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ---------- Mode switch ---------- */
const MODE_SCREEN_NAMES = {
  yt: '유튜브 모니터링',
  news: '뉴스 모니터링',
  notice: '공지사항',
  sns: 'SNS 모니터링',
  opinion: '여론 모니터링',
  report: '뉴스 리포트',
  settings: '설정',
  search: '검색',
  memo: '메모',
  shinpd: '신피디',
  home: '홈'
};
let _currentMode = 'news';

/* ===== 사용할 메뉴 on/off (계정별, RTDB users/{uid}/menu_prefs) =====
   뉴스 모니터링은 항상 켜짐. 유튜브·SNS·여론·공지사항·메모·신피디만 토글(메모·신피디는 2026-10-13 추가). */
const MENU_TOGGLE_DEFS = [
  { key:'yt',      btn:'modeYtBtn',      label:'유튜브 모니터링' },
  { key:'sns',     btn:'modeSnsBtn',     label:'SNS 모니터링' },
  { key:'memo',    btn:'modeMemoBtn',    label:'메모' },
  { key:'shinpd',  btn:'modeShinpdBtn',  label:'신피디' },
];
let _menuPrefs = { yt:true, sns:true, memo:true, shinpd:true };
function menuEnabled(key){ return _menuPrefs[key] !== false; }
async function loadMenuPrefs(){
  try{
    const p = await dbFetch(userPath('menu_prefs')).then(r=>r.json());
    if(p && typeof p === 'object'){
      MENU_TOGGLE_DEFS.forEach(d=>{ if(typeof p[d.key] === 'boolean') _menuPrefs[d.key] = p[d.key]; });
    }
  }catch(e){}
}
function saveMenuPrefs(){
  dbFetch(userPath('menu_prefs'), {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(_menuPrefs)
  }).catch(()=>{});
}
function applyMenuVisibility(){
  MENU_TOGGLE_DEFS.forEach(d=>{
    const b = document.getElementById(d.btn);
    if(b) b.style.display = menuEnabled(d.key) ? '' : 'none';
  });
  // 지금 보고 있는 화면이 방금 꺼졌으면 뉴스로 되돌림
  if(!menuEnabled(_currentMode)) showMode('news');
}
function renderMenuToggles(){
  const box = document.getElementById('menuToggleList');
  if(!box) return;
  box.innerHTML =
    `<label class="menu-toggle-row is-fixed">
       <input type="checkbox" checked disabled> <span>뉴스 모니터링</span>
       <em>항상 켜짐</em>
     </label>`
    + MENU_TOGGLE_DEFS.map(d=>
      `<label class="menu-toggle-row">
         <input type="checkbox" data-menu-key="${d.key}"${menuEnabled(d.key) ? ' checked' : ''}>
         <span>${esc(d.label)}</span>
       </label>`).join('');
  box.querySelectorAll('[data-menu-key]').forEach(cb=>{
    cb.onchange = ()=>{
      _menuPrefs[cb.dataset.menuKey] = cb.checked;
      saveMenuPrefs();
      applyMenuVisibility();
      if(cb.dataset.menuKey === 'shinpd' && cb.checked){ try{ shinpdStartTimer(); }catch(e){} }   // 신피디를 다시 켜면 자동 점검 시작
    };
  });
}

/* ===== 헤더 통합 (2026-09-24) =====
   PC(>900px)에서는 지금 화면의 탭·주요 버튼 DOM을 상단 헤더 슬롯으로 "옮겨" 끼운다(복제 아님 → 기존 이벤트·id 그대로 동작).
   화면을 바꾸거나 모바일 폭이 되면 원래 자리(주석 표식)로 되돌린다. 내용이 다 빠진 화면별 <header>는 숨김. */
const HEADER_SLOT_DEFS = {
  news:     { tabs:['#newsApp .news-subtabs > .pill-nav'] },
  yt:       { tabs:['#tabsRow'], actions:['#ytApp .header-row > .actions'] },
  settings: { tabs:['#settingsApp .set-subtabs'] },
  opinion:  { actions:['#opinionApp .op-actions'] },
  notice:   { actions:['#noticeApp .header-row > .actions'] },
  sns:      { tabs:['#snsHeaderTabsWrap'] },   // 안쪽 people.html 탭을 비춰 그린 것 (아래 SNS 헤더 탭)
};
const _slotMoved = [];   // {el, mark}
function _slotMove(el, slot){
  let mark = el._slotMark;
  if(!mark){ mark = document.createComment('header-slot'); el.parentNode.insertBefore(mark, el); el._slotMark = mark; }
  slot.appendChild(el);
  _slotMoved.push(el);
}
function _slotRestoreAll(){
  while(_slotMoved.length){
    const el = _slotMoved.pop();
    el._slotMark.parentNode.insertBefore(el, el._slotMark);
  }
}
function _hasVisibleContent(el){
  return [...el.children].some(c=>{
    if(!c.offsetWidth || !c.offsetHeight) return false;
    if(c.children.length) return _hasVisibleContent(c);
    return !!c.textContent.trim() || /^(INPUT|BUTTON|SELECT|TEXTAREA|IMG|SVG|CANVAS|IFRAME)$/i.test(c.tagName);
  });
}
function syncScreenHeaders(){
  document.querySelectorAll('body > div[id$="App"] > header').forEach(h=>{
    if(!h.parentElement.offsetWidth) return;   // 안 보이는 화면은 보일 때 다시 계산
    if(h.style.display) h.style.display = '';
    h.querySelectorAll(':scope > .header-row').forEach(r=>{
      if(r.style.display) r.style.display = '';
      const want = _hasVisibleContent(r) ? '' : 'none';
      if(r.style.display !== want) r.style.display = want;
    });
    const want = _hasVisibleContent(h) ? '' : 'none';
    if(h.style.display !== want) h.style.display = want;
  });  // 헤더 표시가 바뀌었으니 메모 고정 영역 위치도 다시(위 스크롤 핸들러와 같은 이유)
  if(typeof syncMemoCatStickyBar === 'function') syncMemoCatStickyBar();
}
function syncHeaderSlots(){
  _slotRestoreAll();
  const def = window.innerWidth > 900 ? HEADER_SLOT_DEFS[_currentMode] : null;
  if(def){
    const put = (sels, slotId)=> (sels||[]).forEach(sel=>{
      const el = document.querySelector(sel);
      if(el) _slotMove(el, document.getElementById(slotId));
    });
    put(def.tabs, 'gbTabsSlot');
    put(def.actions, 'gbActionsSlot');
  }
  syncScreenHeaders();
  _snsPostHeaderMode();
}

/* ----- SNS 헤더 탭: 안쪽 people.html 과 메시지로 연결 ----- */
function _snsFrameWin(){ return document.getElementById('snsToolFrame')?.contentWindow || null; }
function _snsPost(msg){ const w = _snsFrameWin(); if(w) w.postMessage(msg, location.origin); }
function _snsPostHeaderMode(){ _snsPost({ type:'jungle-sns-header-mode', on: window.innerWidth > 900 && _currentMode === 'sns' }); }
function renderSnsHeaderTabs(tabs){
  const box = document.getElementById('snsHeaderTabs');
  if(!box) return;
  box.querySelectorAll('.subtab-btn').forEach(b=> b.remove());   // pillnav.js 인디케이터(.pill-ind)는 남김
  tabs.forEach(t=>{
    const b = document.createElement('button');
    b.className = 'subtab-btn' + (t.on ? ' active' : '');
    b.textContent = t.label;
    if(t.deletable){
      const x = document.createElement('span');
      x.className = 'gx'; x.textContent = '✕'; x.title = '그룹 삭제';
      x.onclick = e=>{ e.stopPropagation(); _snsPost({ type:'jungle-sns-del-group', group:t.group }); };
      b.appendChild(x);
    }
    b.onclick = ()=> _snsPost({ type:'jungle-sns-tab-click', key:t.key, group:t.group });
    box.appendChild(b);
  });
}
window.addEventListener('message', e=>{
  if(e.origin !== location.origin || e.source !== _snsFrameWin()) return;
  if(e.data && e.data.type === 'jungle-sns-tabs'){
    renderSnsHeaderTabs(e.data.tabs || []);
    _snsPostHeaderMode();   // 안쪽 페이지가 (다시) 로드된 직후에도 헤더 모드를 알려줌
  }
});
document.getElementById('snsHeaderAddBtn')?.addEventListener('click', ()=> _snsPost({ type:'jungle-sns-add-group' }));
// 화면별 헤더 안 내용이 바뀌면(키워드 줄 표시, 유튜브 채널 설정 펼침 등) 헤더를 다시 보이거나 숨김
(function(){
  let t = null;
  // syncScreenHeaders 자신이 바꾸는 header/.header-row 의 style 변경은 무시(무한 반복 방지)
  const isOwn = m => m.type === 'attributes' && m.attributeName === 'style' &&
    (m.target.tagName === 'HEADER' || m.target.classList.contains('header-row'));
  const mo = new MutationObserver(muts=>{
    if(muts.every(isOwn) || t) return;
    t = setTimeout(()=>{ t = null; syncScreenHeaders(); }, 0);   // rAF는 백그라운드 탭에서 멈춰서 setTimeout 사용
  });
  document.querySelectorAll('body > div[id$="App"] > header').forEach(h=>
    mo.observe(h, {subtree:true, childList:true, attributes:true, attributeFilter:['style','class','hidden']}));
  let wasDesktop = window.innerWidth > 900;
  window.addEventListener('resize', ()=>{
    const d = window.innerWidth > 900;
    if(d !== wasDesktop){ wasDesktop = d; syncHeaderSlots(); }
  });
  // 첫 화면(뉴스)은 showMode를 거치지 않고 바로 보이므로 시작할 때 한 번 맞춰 둔다
  syncHeaderSlots();
})();

function showMode(mode){
  // 끈 메뉴로는 못 들어감
  if(MENU_TOGGLE_DEFS.some(d=> d.key === mode) && !menuEnabled(mode)) mode = 'news';
  _currentMode = mode;
  if(mode === 'yt' && typeof ytAutoRefresh === 'function') setTimeout(ytAutoRefresh, 300);   // 유튜브 화면에 들어오면 오래된 목록을 바로 갱신
  // SNS는 화면 높이에 딱 맞춘 iframe이라 바깥 페이지가 스크롤되면 iframe 윗부분(탭)이 고정 헤더 밑으로 숨음
  document.body.classList.toggle('mode-sns', mode==='sns');
  document.getElementById('modeYtBtn').classList.toggle('active', mode==='yt');
  document.getElementById('modeNewsBtn').classList.toggle('active', mode==='news');
  document.getElementById('modeNoticeBtn').classList.toggle('active', mode==='notice');
  document.getElementById('modeSnsBtn').classList.toggle('active', mode==='sns');
  document.getElementById('modeOpinionBtn')?.classList.toggle('active', mode==='opinion');
  document.getElementById('modeReportBtn')?.classList.toggle('active', mode==='report');
  document.getElementById('modeSettingsBtn')?.classList.toggle('active', mode==='settings');
  document.getElementById('modeMemoBtn')?.classList.toggle('active', mode==='memo');
  document.getElementById('modeShinpdBtn')?.classList.toggle('active', mode==='shinpd');
  document.getElementById('ytApp').style.display = mode==='yt' ? '' : 'none';
  document.getElementById('newsApp').style.display = mode==='news' ? '' : 'none';
  document.getElementById('noticeApp').style.display = mode==='notice' ? '' : 'none';
  document.getElementById('snsApp').style.display = mode==='sns' ? '' : 'none';
  const opApp = document.getElementById('opinionApp');
  if(opApp){ opApp.style.display = mode==='opinion' ? '' : 'none'; if(mode==='opinion') initOpinionMode(); }
  const mApp = document.getElementById('memoApp');
  if(mApp){ mApp.style.display = mode==='memo' ? '' : 'none'; if(mode==='memo') renderPersonalMemos(); }
  const spApp = document.getElementById('shinpdApp');
  if(spApp){ spApp.style.display = mode==='shinpd' ? '' : 'none'; if(mode==='shinpd') initShinpdMode(); }
  const hmApp = document.getElementById('homeApp');
  if(hmApp) hmApp.style.display = mode==='home' ? '' : 'none';
  const rApp = document.getElementById('reportApp');
  if(rApp){ rApp.style.display = mode==='report' ? '' : 'none'; if(mode==='report') renderReports(); }
  const sApp = document.getElementById('settingsApp');
  if(sApp){ sApp.style.display = mode==='settings' ? '' : 'none'; if(mode==='settings') renderSettingsPage(); }
  const schApp = document.getElementById('searchApp');
  if(schApp) schApp.style.display = mode==='search' ? '' : 'none';
  // 검색 페이지를 벗어나면 헤더 검색창을 비운다 (다른 메뉴로 이동 시)
  if(mode !== 'search'){
    const gs = document.getElementById('globalSearch');
    if(gs && gs.value){
      gs.value = '';
      const cb = document.getElementById('globalSearchClear'); if(cb) cb.hidden = true;
      if(typeof syncSearchExpanded === 'function') syncSearchExpanded();
    }
  }
  const nameEl = document.getElementById('gbScreenName');
  if(nameEl) nameEl.textContent = MODE_SCREEN_NAMES[mode] || '';
  const newsActions = document.getElementById('gbNewsActions');
  if(newsActions) newsActions.style.display = mode==='news' ? '' : 'none';
  syncHeaderSlots();
  writeModeHash(mode);
  window.scrollTo({top:0});
}
/* 새로고침해도 보던 화면 유지(2026-10-13 사장님 지시) — 주소 끝 #m=화면 에 기록하고 시작할 때 되살린다.
   주소에 없는 새 탭은 예전처럼 뉴스(모바일은 홈)에서 시작한다. 검색 화면은 검색어가 필요해 기록하지 않는다. */
const MODE_HASH_RE = /(?:^|[#&])m=([a-z]+)/;
function writeModeHash(mode){
  try{
    if(mode === 'search') return;
    const h = mode === 'news' ? '' : '#m=' + mode;
    if(location.hash === h || (!h && !location.hash)) return;
    history.replaceState(null, '', location.pathname + location.search + h);
  }catch(e){}
}
function restoreModeFromHash(){
  const m = (location.hash.match(MODE_HASH_RE) || [])[1];
  if(!m || m === 'news' || m === 'search' || !MODE_SCREEN_NAMES[m]) return false;
  const y = (typeof _pendingRestoreScrollY === 'number') ? _pendingRestoreScrollY : 0;
  showMode(m);
  if(y > 0 && _currentMode === m){   // showMode가 맨 위로 올리므로 저장해 둔 스크롤을 다시 얹는다
    requestAnimationFrame(()=> requestAnimationFrame(()=>{ window.scrollTo(0, y); setTimeout(()=> window.scrollTo(0, y), 250); }));
  }
  return true;
}

