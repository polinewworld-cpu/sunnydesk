/* 성능박스·구글 로그인(인증·계정)·시계·헬퍼·유튜브 모니터링
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ---------- 성능확인 (개발용, config.devTools=false 면 숨김) ---------- */
let _perfEnabled = false;
let _perfLines = [];
function perfLog(label, ms){
  if(!_perfEnabled) return;
  _perfLines.push(`${label}: ${Math.round(ms)}ms`);
  _perfLines = _perfLines.slice(-8);
  const txt = document.getElementById('perfDebugText');
  if(txt) txt.textContent = _perfLines.join('\n');
  // 박스는 "성능확인" 버튼으로만 연다 — 자동 등장 안 함
}
function perfBoxVisible(){
  const box = document.getElementById('perfDebugBox');
  return !!box && box.style.display === 'block';
}
function setPerfBox(on){
  const box = document.getElementById('perfDebugBox');
  if(!box || !_perfEnabled) return;
  box.style.display = on ? 'block' : 'none';
  if(on){
    const txt = document.getElementById('perfDebugText');
    if(txt) txt.textContent = _perfLines.length ? _perfLines.join('\n') : '(아직 측정된 항목 없음 — 업데이트·탭 이동을 해보세요)';
  }
}

/* 성능확인 박스 — config.devTools 켜졌을 때만. 드래그로 이동, ✕/버튼 재클릭으로 닫음. */
const PERF_BOX_POS_LS_KEY = 'jsg_perfbox_pos_v1';
function initPerfDebugBox(){
  _perfEnabled = (JUNGLE_CONFIG.devTools !== false);
  const box = document.getElementById('perfDebugBox');
  if(!box) return;
  box.style.display = 'none';
  if(!_perfEnabled) return;

  // 텍스트 영역 + 닫기 버튼 구조로 (한 번만)
  if(!document.getElementById('perfDebugText')){
    box.textContent = '';
    box.insertAdjacentHTML('beforeend',
      '<button id="perfDebugClose" title="닫기" style="position:absolute;top:2px;right:4px;background:none;border:none;color:#fff;font-size:13px;line-height:1;cursor:pointer;padding:2px 4px;">✕</button>'
      + '<pre id="perfDebugText" style="margin:0;font:inherit;white-space:pre;padding-right:14px;"></pre>');
    const cl = document.getElementById('perfDebugClose');
    cl.addEventListener('pointerdown', e=> e.stopPropagation());
    cl.addEventListener('click', ()=>{ box.style.display = 'none'; });
  }
  box.style.pointerEvents = 'auto';
  box.style.cursor = 'move';

  // 저장된 위치 복원 (없으면 좌하단 기본값 유지)
  const clamp = (v, max)=> Math.max(0, Math.min(v, max));
  const applyPos = (x, y)=>{
    const w = box.offsetWidth, h = box.offsetHeight;
    box.style.left = clamp(x, window.innerWidth  - w) + 'px';
    box.style.top  = clamp(y, window.innerHeight - h) + 'px';
    box.style.right = 'auto';
    box.style.bottom = 'auto';
  };
  try{
    const saved = JSON.parse(localStorage.getItem(PERF_BOX_POS_LS_KEY) || 'null');
    if(saved && typeof saved.x === 'number' && typeof saved.y === 'number') applyPos(saved.x, saved.y);
  }catch(e){}

  let dragging = false, dx = 0, dy = 0;
  box.addEventListener('pointerdown', e=>{
    dragging = true;
    const r = box.getBoundingClientRect();
    dx = e.clientX - r.left;
    dy = e.clientY - r.top;
    box.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  box.addEventListener('pointermove', e=>{
    if(!dragging) return;
    applyPos(e.clientX - dx, e.clientY - dy);
  });
  const end = ()=>{
    if(!dragging) return;
    dragging = false;
    const r = box.getBoundingClientRect();
    try{ localStorage.setItem(PERF_BOX_POS_LS_KEY, JSON.stringify({x: r.left, y: r.top})); }catch(e){}
  };
  box.addEventListener('pointerup', end);
  box.addEventListener('pointercancel', end);
}

const TAB_DEFS = JUNGLE_CONFIG.youtubeTabs;

const DEFAULT_CHANNELS_BY_TAB = JUNGLE_CONFIG.youtubeDefaultChannels;

const FIREBASE_URL = JUNGLE_CONFIG.rtdbUrl;

/* ============================================================
   구글 로그인 게이트 (Bundle C1, 2026-09-02)
   - 로그인 전엔 앱을 초기화하지 않는다. 로그인 오버레이(#authGate)만 보임
   - 모든 RTDB 요청은 dbFetch()를 거쳐 ?auth=<idToken>을 붙인다 (notice.js도 사용)
   - 계정 레지스트리 /accounts/{uid}, 선착순 slotCount개, 첫 등록자가 마스터
   ============================================================ */
let CURRENT_USER = null;      // firebase.User
let CURRENT_ACCOUNT = null;   // {uid, email, nickname, createdAt, isMaster}
let _authRejectMsg = '';      // 슬롯 초과 등 거부 사유 (오버레이에 표시)

async function dbFetch(url, opts){
  try{
    const u = firebase.auth().currentUser;
    if(u){
      const token = await u.getIdToken();
      url += (url.indexOf('?') >= 0 ? '&' : '?') + 'auth=' + encodeURIComponent(token);
    }
  }catch(e){ /* 토큰 못 얻으면 그냥 무인증으로 시도 (규칙이 아직 열려 있을 때 대비) */ }
  return fetch(url, opts);
}
window.dbFetch = dbFetch;

function authGateEl(){ return document.getElementById('authGate'); }
function showAuthGate(msg){
  const g = authGateEl(); if(g){ g.hidden = false; g.classList.remove('auth-loading'); }
  const m = document.getElementById('authMsg');
  if(m){
    if(msg){ m.textContent = msg; m.hidden = false; }
    else { m.textContent = ''; m.hidden = true; }
  }
  const btn = document.getElementById('authGoogleBtn');
  if(btn) btn.disabled = false;
}
function hideAuthGate(){ const g = authGateEl(); if(g) g.hidden = true; }

async function resolveAccount(user){
  // 이미 등록된 계정?
  const existing = await dbFetch(`${FIREBASE_URL}/accounts/${user.uid}.json`).then(r=>r.json()).catch(()=>null);
  if(existing && typeof existing === 'object'){
    return {ok:true, account:{uid:user.uid, ...existing}};
  }
  // 신규 — 슬롯 확인
  const all = await dbFetch(`${FIREBASE_URL}/accounts.json`).then(r=>r.json()).catch(()=>({})) || {};
  const count = Object.keys(all).length;
  const slots = JUNGLE_CONFIG.slotCount || 3;
  if(count >= slots){
    return {ok:false, reason:`자리가 다 찼어요 (${count}/${slots}). 팀 마스터에게 문의하세요.`};
  }
  const account = {
    email: user.email || '',
    nickname: '',
    createdAt: Date.now(),
    isMaster: count === 0
  };
  await dbFetch(`${FIREBASE_URL}/accounts/${user.uid}.json`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(account)
  });
  return {ok:true, account:{uid:user.uid, ...account}};
}

function promptNickname(uid){
  return new Promise(resolve=>{
    const back = document.createElement('div');
    back.className = 'ql-modal-back';
    back.innerHTML = `<div class="ql-modal">
        <h3>이름을 입력하세요</h3>
        <div class="hint">팀에서 서로 알아볼 수 있도록 <b>실명</b>을 입력해 주세요.</div>
        <div class="ql-row"><input type="text" id="nickInput" maxlength="20" placeholder="예: 홍길동"></div>
        <div class="ql-actions">
          <button class="subtab-btn" id="nickSaveBtn">저장</button>
        </div>
      </div>`;
    document.body.appendChild(back);
    const input = back.querySelector('#nickInput');
    input.focus();
    const save = async ()=>{
      const v = input.value.trim();
      if(!v){ input.focus(); return; }
      await dbFetch(`${FIREBASE_URL}/accounts/${uid}/nickname.json`, {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(v)
      });
      if(CURRENT_ACCOUNT) CURRENT_ACCOUNT.nickname = v;
      if(typeof renderSbAccount === 'function') renderSbAccount();
      back.remove();
      resolve(v);
    };
    back.querySelector('#nickSaveBtn').onclick = save;
    input.addEventListener('keydown', e=>{ if(e.key==='Enter') save(); });
  });
}

// SNS 모니터링(sns-tool.html)의 Firestore 규칙은 sns_allow/{uid} 명단만 통과시킨다.
// Firestore 규칙은 RTDB를 못 읽으므로, 마스터가 로그인할 때마다 /accounts 명단을 sns_allow로 복사한다.
// (추가된 계정은 올리고, 빠진 계정은 지움. 쓰기는 규칙상 마스터만 가능)
async function syncSnsAllowList(user){
  const base = `https://firestore.googleapis.com/v1/projects/${JUNGLE_CONFIG.firebase.projectId}/databases/(default)/documents/sns_allow`;
  const token = await user.getIdToken();
  const H = {'Authorization':'Bearer '+token, 'Content-Type':'application/json'};
  const accounts = await dbFetch(`${FIREBASE_URL}/accounts.json`).then(r=>r.json()) || {};
  const cur = await fetch(base+'?pageSize=300', {headers:H}).then(r=>r.json());
  const have = {};
  (cur.documents||[]).forEach(d=>{
    const f = d.fields||{};
    have[d.name.split('/').pop()] = !!(f.master && f.master.booleanValue);
  });
  const jobs = [];
  Object.entries(accounts).forEach(([uid, a])=>{
    const master = !!(a && a.isMaster);
    if(have[uid] === master) return;
    jobs.push(fetch(`${base}/${uid}`, {method:'PATCH', headers:H, body: JSON.stringify({fields:{
      master:{booleanValue:master}, email:{stringValue:(a&&a.email)||''}
    }})}));
  });
  Object.keys(have).forEach(uid=>{
    if(!accounts[uid] && uid !== user.uid) jobs.push(fetch(`${base}/${uid}`, {method:'DELETE', headers:H}));
  });
  const rs = await Promise.all(jobs);
  const bad = rs.filter(r=>!r.ok).length;
  if(jobs.length) console.log(`[SNS 명단] 변경 ${jobs.length}건` + (bad ? `, 실패 ${bad}건` : ''));
}

let _appStarted = false;
async function onSignedIn(user){
  CURRENT_USER = user;
  let gate;
  try{
    gate = await resolveAccount(user);
  }catch(e){
    console.error('[로그인] 계정 확인 실패', e);
    _authRejectMsg = '로그인 처리 중 오류가 났어요. 새로고침 후 다시 시도해 주세요.';
    await firebase.auth().signOut();
    return;
  }
  if(!gate.ok){
    _authRejectMsg = gate.reason;
    await firebase.auth().signOut();  // → onAuthStateChanged(null) → 오버레이에 사유 표시
    return;
  }
  CURRENT_ACCOUNT = gate.account;
  // SNS 모니터링 iframe(people.html·sns-tool.html)이 계정별 데이터 경로를 잡을 수 있도록 uid 공유.
  // 같은 origin이라 localStorage로 전달됨(postMessage 타이밍 불필요).
  // SNS 모니터링 데이터는 고객사 단위로 공유 — user.uid가 아니라 config의 snsClient로 네임스페이스
  try{ localStorage.setItem('jungle_sns_client', JUNGLE_CONFIG.snsClient || 'default'); }catch(e){}
  if(CURRENT_ACCOUNT.isMaster) syncSnsAllowList(user).catch(e=>console.warn('[SNS 명단] 동기화 실패', e));
  renderSbAccount();
  initPerfDebugBox();
  const _pt = ()=> performance.now() - (window.__perfStart || 0);   // 임시 측정용
  perfLog('· 계정확인', _pt());
  if(!CURRENT_ACCOUNT.nickname){
    hideAuthGate();
    await promptNickname(user.uid);
  }
  try{
    await seedUserData(user.uid);   // 최초 로그인: 팀 공유값 + 이 브라우저 localStorage → /users/{uid}
  }catch(e){ console.warn('[개인화] seed 실패(계속 진행)', e); }
  perfLog('· seed', _pt());
  try{ localStorage.setItem('jungle_seen_login', '1'); }catch(e){} // 다음 새로고침 때 로그인창 깜빡임 방지
  hideAuthGate();
  if(!_appStarted){
    _appStarted = true;
    startApp();
    if(window.initNoticeData) window.initNoticeData();
  }
}

/* /users/{uid} 경로 헬퍼 — C2. sub 예: 'news_keywords', 'saved_news', 'read_at' */
function userPath(sub){
  const uid = (CURRENT_USER && CURRENT_USER.uid) || '_noauth';
  return `${FIREBASE_URL}/users/${uid}/${sub}.json`;
}

/* 최초 로그인 1회 — 개인 데이터 초기값을 채운다.
   - 뉴스 키워드 / 버린 기사 / 언론사 온오프: 그 시점 팀 공유값을 복사
   - 읽음 / 스크랩 / 존안: 이 브라우저 localStorage에 남아 있던 기존 값을 올림
   _seededAt 마커가 있으면 두 번 다시 하지 않음. */
const SEEDED_LS_PREFIX = 'jungle_seeded_';
async function seedUserData(uid){
  // 이 기기에서 이미 seed 확인이 끝났으면 네트워크 없이 종료
  try{ if(localStorage.getItem(SEEDED_LS_PREFIX + uid)) return; }catch(e){}
  // 전체 서브트리 대신 _seededAt 한 필드만 얕게 조회 (매 로드 부하의 주범이었음)
  const seededAt = await dbFetch(`${FIREBASE_URL}/users/${uid}/_seededAt.json`).then(r=>r.json()).catch(()=>null);
  if(seededAt){
    try{ localStorage.setItem(SEEDED_LS_PREFIX + uid, '1'); }catch(e){}
    return;
  }

  const seed = { _seededAt: Date.now() };
  const [kw, dis, out] = await Promise.all([
    dbFetch(`${FIREBASE_URL}/news_keywords.json`).then(r=>r.json()).catch(()=>null),
    dbFetch(`${FIREBASE_URL}/news_dismissed.json`).then(r=>r.json()).catch(()=>null),
    dbFetch(`${FIREBASE_URL}/disabled_outlets.json`).then(r=>r.json()).catch(()=>null)
  ]);
  if(Array.isArray(kw)) seed.news_keywords = kw;
  if(dis && typeof dis === 'object') seed.news_dismissed = dis;
  if(Array.isArray(out)) seed.disabled_outlets = out;

  try{ const r = JSON.parse(localStorage.getItem(READ_AT_LS_KEY) || 'null'); if(r && typeof r==='object') seed.read_at = Object.entries(r); }catch(e){}
  try{ const r = JSON.parse(localStorage.getItem(READ_TODAY_LS_KEY) || 'null'); if(Array.isArray(r) && r.length) seed.read_today = r; }catch(e){}
  try{ const r = JSON.parse(localStorage.getItem(SAVED_NEWS_LS_KEY) || 'null'); if(r && typeof r==='object' && Object.keys(r).length) seed.saved_news = r; }catch(e){}
  try{ const r = JSON.parse(localStorage.getItem(ARCHIVE_LS_KEY) || 'null'); if(r && typeof r==='object' && Object.keys(r).length) seed.archived = r; }catch(e){}
  try{ const r = JSON.parse(localStorage.getItem(ARCHIVE_FOLDERS_LS_KEY) || 'null'); if(Array.isArray(r) && r.length) seed.archive_folders = r; }catch(e){}

  await dbFetch(`${FIREBASE_URL}/users/${uid}.json`, {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(seed)
  });
  try{ localStorage.setItem(SEEDED_LS_PREFIX + uid, '1'); }catch(e){}
}

function initAuthGate(){
  firebase.initializeApp(JUNGLE_CONFIG.firebase);
  const auth = firebase.auth();

  // 팝업 방식 우선 — signInWithRedirect는 브라우저 서드파티 저장소 차단(스토리지 파티셔닝)으로
  // firebaseapp.com 헬퍼 도메인에서 세션 복원이 실패해 "로그인했는데 다시 로그인 요구" 루프가 생김.
  // 팝업이 막힌 환경에서만 리다이렉트로 폴백한다.
  const btn = document.getElementById('authGoogleBtn');
  if(btn) btn.onclick = async ()=>{
    btn.disabled = true;
    _authRejectMsg = '';
    const provider = new firebase.auth.GoogleAuthProvider();
    try{
      await auth.signInWithPopup(provider);   // 성공 시 onAuthStateChanged가 이어받음
    }catch(err){
      console.error('[로그인] 팝업 실패', err);
      const code = err && err.code;
      if(code === 'auth/popup-blocked' || code === 'auth/operation-not-supported-in-this-environment' || code === 'auth/cancelled-popup-request'){
        auth.signInWithRedirect(provider);    // 팝업 차단 환경 → 리다이렉트
        return;
      }
      if(code === 'auth/popup-closed-by-user'){ btn.disabled = false; return; }
      _authRejectMsg = (err && err.message) ? err.message : '로그인에 실패했어요.';
      showAuthGate(_authRejectMsg);
    }
  };

  auth.getRedirectResult().catch(err=>{
    console.error('[로그인] 리다이렉트 결과 오류', err);
    _authRejectMsg = err && err.message ? err.message : '로그인에 실패했어요.';
  });

  auth.onAuthStateChanged(user=>{
    if(user){
      onSignedIn(user);
    }else{
      try{ localStorage.removeItem('jungle_seen_login'); }catch(e){} // 실제 로그아웃 상태 — 다음부턴 게이트 바로 표시
      showAuthGate(_authRejectMsg);
    }
  });
}
document.addEventListener('DOMContentLoaded', initAuthGate);

let state = {
  apiKey: JUNGLE_CONFIG.googleApiKey,
  activeTab: 'default',
  tabs: {} // id -> {channels, videos, meta, errors}
};

/* 유튜브 영상·채널 메타 캐시 — API 실패(할당량 초과 등) 시 마지막 수집분을 보여준다. */
const YT_CACHE_LS_KEY = 'jsg_yt_cache_v1';
function ytCacheSave(){
  try{
    const dump = {};
    Object.keys(state.tabs).forEach(id=>{
      const t = state.tabs[id];
      if(t && (t.videos || t.meta)) dump[id] = { videos: t.videos || {}, meta: t.meta || {}, savedAt: Date.now() };
    });
    localStorage.setItem(YT_CACHE_LS_KEY, JSON.stringify(dump));
  }catch(e){}
}
function ytCacheLoad(){
  try{
    const dump = JSON.parse(localStorage.getItem(YT_CACHE_LS_KEY) || 'null');
    if(!dump) return;
    Object.keys(dump).forEach(id=>{
      if(!state.tabs[id]) return;
      if(dump[id].videos && !Object.keys(state.tabs[id].videos||{}).length) state.tabs[id].videos = dump[id].videos;
      if(dump[id].meta && !Object.keys(state.tabs[id].meta||{}).length) state.tabs[id].meta = dump[id].meta;
    });
  }catch(e){}
}

/* 유튜브 영상 '확인했음' — 개인 전용(로컬 저장). 누르면 그 카드는 내 화면에서 완전히 사라짐(팀원 화면엔 영향 없음) */
const YT_CHECKED_LS_KEY = 'jsg_yt_checked_v1';
function loadYtChecked(){
  try{ return new Set(JSON.parse(localStorage.getItem(YT_CHECKED_LS_KEY)||'[]')); }
  catch(e){ return new Set(); }
}
function saveYtChecked(){
  try{ localStorage.setItem(YT_CHECKED_LS_KEY, JSON.stringify(Array.from(ytChecked))); }
  catch(e){}
}
let ytChecked = loadYtChecked();
function markYtChecked(id){
  ytChecked.add(id);
  saveYtChecked();
  renderSections();
}

function genChannelId(){
  return 'c_' + Date.now().toString(36) + Math.random().toString(36).slice(2,8);
}
function ensureChannelIds(list){
  let changed = false;
  (list||[]).forEach(c=>{
    if(!c.id){ c.id = genChannelId(); changed = true; }
  });
  return changed;
}

function ensureTabShape(id){
  if(!state.tabs[id]) state.tabs[id] = {channels:[], videos:{}, meta:{}, errors:{}};
}

async function loadState(){
  TAB_DEFS.forEach(td=>ensureTabShape(td.id));
  ytCacheLoad();   // 마지막 수집분 복원 (API 실패해도 화면이 안 빈다)
  try{
    const res = await dbFetch(FIREBASE_URL + '/tabs_channels.json');
    const data = await res.json();
    if(data){
      TAB_DEFS.forEach(td=>{
        if(data[td.id]) state.tabs[td.id].channels = data[td.id];
      });
    }
  }catch(e){}
  TAB_DEFS.forEach(td=>{
    if(!state.tabs[td.id].channels || state.tabs[td.id].channels.length===0){
      state.tabs[td.id].channels = (DEFAULT_CHANNELS_BY_TAB[td.id]||[]).slice();
    }
    if(ensureChannelIds(state.tabs[td.id].channels)){
      dbFetch(`${FIREBASE_URL}/tabs_channels/${td.id}.json`, {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(state.tabs[td.id].channels)
      }).catch(()=>{});
    }
  });
}

async function saveActiveTabChannels(){
  try{
    await dbFetch(`${FIREBASE_URL}/tabs_channels/${state.activeTab}.json`, {
      method:'PUT',
      headers:{'Content-Type':'application/json'},
      body: JSON.stringify(state.tabs[state.activeTab].channels)
    });
  }catch(e){}
}

async function refetchActiveTabChannels(){
  try{
    const res = await dbFetch(`${FIREBASE_URL}/tabs_channels/${state.activeTab}.json`);
    const data = await res.json();
    if(data){
      state.tabs[state.activeTab].channels = data;
      if(ensureChannelIds(state.tabs[state.activeTab].channels)){
        await saveActiveTabChannels();
      }
    }
  }catch(e){}
}

/* ---------- Clock ----------
   주말(토·일)은 방송이 없어 카운트다운 대상에서 제외. 방송별 skipWeekdays(요일별 추가 휴방)도 건너뛴다. */
function nextBroadcastTime(t, now){
  let cand = new Date(now);
  cand.setHours(t.hour, t.minute||0, 0, 0);
  if(cand<=now) cand.setDate(cand.getDate()+1);
  for(let i=0;i<14;i++){
    const dow = cand.getDay();
    const skip = dow===0 || dow===6 || (Array.isArray(t.skipWeekdays) && t.skipWeekdays.includes(dow));
    if(!skip) return cand;
    cand = new Date(cand); cand.setDate(cand.getDate()+1);
  }
  return cand;
}
function updateClock(){
  if(!(JUNGLE_CONFIG.broadcastTimes || []).length) return;   // 써니데스크: 방송 시간이 없으면 카운트다운을 쓰지 않는다
  const now = new Date();
  const targets = JUNGLE_CONFIG.broadcastTimes.map(t=> nextBroadcastTime(t, now));
  let next = targets.sort((a,b)=>a-b)[0];
  let diff = Math.floor((next-now)/1000);
  const hh = String(Math.floor(diff/3600)).padStart(2,'0');
  const mm = String(Math.floor((diff%3600)/60)).padStart(2,'0');
  const ss = String(diff%60).padStart(2,'0');
  const txt = `${hh}:${mm}:${ss}`;
  document.getElementById('countdown').textContent = txt;
  const sc = document.querySelector('#sbCountdown b');
  if(sc) sc.textContent = txt;
}
setInterval(updateClock,1000); updateClock();

/* ---------- Helpers ---------- */
function relTime(iso){
  const diffMs = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diffMs/60000);
  if(m<60) return `${m}분 전`;
  const h = Math.floor(m/60);
  if(h<24) return `${h}시간 전`;
  const d = Math.floor(h/24);
  return `${d}일 전`;
}
function fmtViews(n){
  n = Number(n||0);
  if(n>=100000000) return (n/100000000).toFixed(1)+'억';
  if(n>=10000) return (n/10000).toFixed(1)+'만';
  return n.toLocaleString();
}
function fmtDuration(iso){
  const m = iso.match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return '';
  const h = parseInt(m[1]||0), mi = parseInt(m[2]||0), s = parseInt(m[3]||0);
  if(h) return `${h}:${String(mi).padStart(2,'0')}:${String(s).padStart(2,'0')}`;
  return `${mi}:${String(s).padStart(2,'0')}`;
}
function durationToSeconds(iso){
  const m = (iso||'').match(/PT(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/);
  if(!m) return null;
  const h = parseInt(m[1]||0), mi = parseInt(m[2]||0), s = parseInt(m[3]||0);
  return h*3600 + mi*60 + s;
}

function normalizePlaylistId(v){
  if(!v) return '';
  v = v.trim();
  const m = v.match(/[?&]list=([^&]+)/);
  if(m) return decodeURIComponent(m[1]);
  return v;
}

/* ---------- YouTube API ---------- */
async function ytGet(path, params){
  const url = new URL(`https://www.googleapis.com/youtube/v3/${path}`);
  Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v));
  url.searchParams.set('key', state.apiKey);
  const res = await fetch(url.toString());
  const data = await res.json();
  if(!res.ok){
    const msg = data?.error?.message || `HTTP ${res.status}`;
    throw new Error(msg);
  }
  return data;
}

async function fetchChannel(handle){
  const cleanHandle = handle.startsWith('@') ? handle : '@'+handle;
  const data = await ytGet('channels', {part:'snippet,contentDetails', forHandle:cleanHandle});
  if(!data.items || data.items.length===0) throw new Error('채널을 찾을 수 없음 (핸들 확인 필요)');
  const item = data.items[0];
  return {
    title: item.snippet.title,
    avatar: item.snippet.thumbnails?.default?.url || '',
    uploadsPlaylistId: item.contentDetails.relatedPlaylists.uploads
  };
}

async function fetchRecentVideos(playlistId){
  const collected = [];
  let pageToken;
  let scanned = 0;
  const maxScan = 50;

  while(scanned < maxScan && collected.length < 6){
    const params = {part:'snippet', playlistId, maxResults:25};
    if(pageToken) params.pageToken = pageToken;
    const data = await ytGet('playlistItems', params);
    const rawItems = data.items || [];
    if(rawItems.length===0) break;
    scanned += rawItems.length;

    let items = rawItems.map(it=>({
      id: it.snippet.resourceId.videoId,
      title: it.snippet.title,
      thumb: it.snippet.thumbnails?.medium?.url || it.snippet.thumbnails?.default?.url || '',
      publishedAt: it.snippet.publishedAt,
      description: (it.snippet.description||'').slice(0,150)
    }));
    items = items.filter(v => v.title !== 'Private video' && v.title !== 'Deleted video');

    if(items.length){
      const ids = items.map(v=>v.id).join(',');
      try{
        const statsData = await ytGet('videos', {part:'statistics,contentDetails,liveStreamingDetails', id:ids});
        const byId = {};
        (statsData.items||[]).forEach(v=>{ byId[v.id] = v; });
        items.forEach(v=>{
          const s = byId[v.id];
          if(s){
            v.views = s.statistics?.viewCount;
            v.duration = fmtDuration(s.contentDetails?.duration||'');
            v.isLive = !!s.liveStreamingDetails;
            const secs = durationToSeconds(s.contentDetails?.duration);
            v.isShort = !v.isLive && secs!==null && secs <= YT_SHORT_MAX_SEC;
          }
        });
        items = items.filter(v=>!v.isShort);
      }catch(e){ items = []; }
      collected.push(...items);
    }

    pageToken = data.nextPageToken;
    if(!pageToken) break;
  }

  return collected.slice(0, YT_PER_CHANNEL);
}

/* ---------- Tabs ---------- */
function renderTabs(){
  const el = document.getElementById('tabsRow');
  el.innerHTML = TAB_DEFS.map(td=>`
    <button class="subtab-btn ${td.id===state.activeTab?'active':''}" data-tab="${td.id}">${td.label}</button>
  `).join('');
  el.querySelectorAll('.subtab-btn').forEach(btn=>{
    btn.onclick = async ()=>{
      state.activeTab = btn.dataset.tab;
      renderTabs();
      await refetchActiveTabChannels();
      renderChannelList();
      renderSections();
    };
  });
}

/* ---------- Rendering ---------- */
function renderChannelList(){
  const cur = state.tabs[state.activeTab];
  document.getElementById('curTabLabel').textContent = `현재 탭: ${TAB_DEFS.find(t=>t.id===state.activeTab).label}`;
  const el = document.getElementById('channelList');
  el.innerHTML = cur.channels.map((c)=>`
    <div class="channel-item">
      <div><span class="name">${c.name}</span><span class="handle">${c.handle}</span><span class="handle">· ${c.playlistId?`지정 재생목록 (${c.playlistId})`:'채널 업로드 전체'}</span></div>
      <div style="display:flex;gap:6px;">
        <button class="ghost" data-id="${c.id}" data-action="edit">수정</button>
        <button class="ghost" data-id="${c.id}" data-action="remove">삭제</button>
      </div>
    </div>
  `).join('');
  el.querySelectorAll('button[data-action="edit"]').forEach(btn=>{
    btn.onclick = ()=>{
      const c = cur.channels.find(x=>x.id===btn.dataset.id);
      if(!c) return;
      document.getElementById('newHandle').value = c.handle;
      document.getElementById('newName').value = c.name;
      document.getElementById('newPlaylistId').value = c.playlistId || '';
      document.getElementById('addChannelBtn').textContent = '수정 완료';
      document.getElementById('addChannelBtn').dataset.editingId = c.id;
      document.getElementById('newHandle').scrollIntoView({behavior:'smooth', block:'center'});
    };
  });
  el.querySelectorAll('button[data-action="remove"]').forEach(btn=>{
    btn.onclick = async ()=>{
      await refetchActiveTabChannels();
      state.tabs[state.activeTab].channels = state.tabs[state.activeTab].channels.filter(c=>c.id!==btn.dataset.id);
      await saveActiveTabChannels();
      renderChannelList();
      renderSections();
    };
  });
}

function renderSections(){
  const cur = state.tabs[state.activeTab];
  const root = document.getElementById('sections');
  if(cur.channels.length===0){
    root.innerHTML = `<div class="empty-hint">이 탭에 채널이 없습니다. 상단 ⚙ 설정에서 채널을 추가하세요.</div>`;
    return;
  }
  root.innerHTML = cur.channels.map(c=>{
    const meta = cur.meta[c.id];
    const err = cur.errors[c.id];
    const videos = cur.videos[c.id];
    let cardsHtml;
    let staleNote = '';
    if(err && (!videos || !videos.length)){
      cardsHtml = `<div class="empty-hint" style="flex:1;">⚠ ${err}</div>`;
    }else if(!videos){
      cardsHtml = Array(4).fill(0).map(()=>`<div class="skeleton"></div>`).join('');
    }else if(videos.length===0){
      cardsHtml = `<div class="empty-hint" style="flex:1;">최근 업로드 영상 없음</div>`;
    }else{
      if(err) staleNote = `<div class="yt-stale-note">업데이트 실패 — 마지막 수집분을 보여드려요</div>`;
      const visible = videos.filter(v=>!ytChecked.has(v.id));
      if(visible.length===0){
        cardsHtml = `<div class="empty-hint" style="flex:1;">전부 확인했음 ✓</div>`;
      }else{
        const chName = meta?.title || c.name || '';
        cardsHtml = visible.map(v=>{
          const vurl = `https://www.youtube.com/watch?v=${v.id}`;
          const scrapped = !!newsState.savedNews[linkToSafeKey(vurl)];
          return `
        <div class="card" data-vid="${v.id}">
          <a class="card-link" href="${vurl}" target="_blank" rel="noopener">
            <div class="thumb-wrap">
              <img class="thumb" src="${v.thumb}" loading="lazy">
              ${v.duration?`<div class="dur">${v.duration}</div>`:''}
            </div>
            <div class="body">
              <div class="title">${v.title}</div>
              <div class="meta"><span>${relTime(v.publishedAt)}</span><span>${v.views!==undefined?fmtViews(v.views)+'회':''}</span></div>
            </div>
          </a>
          <div class="action-row">
            <button class="read-btn" data-ytcheck="${v.id}">- 빼기</button>
            <span class="action-sep">|</span>
            <button class="save-btn${scrapped?' saved':''}" data-ytscrap="${v.id}"
              data-vtitle="${esc(v.title||'')}" data-vurl="${esc(vurl)}" data-vthumb="${esc(v.thumb||'')}"
              data-vchannel="${esc(chName)}" data-vpub="${esc(v.publishedAt||'')}"
              ${scrapped?'disabled':''}>${scrapped?'✓ 스크랩됨':'+ 스크랩'}</button>
          </div>
        </div>
      `;}).join('');
      }
    }
    return `
      <div class="channel-section" draggable="true" data-id="${c.id}">
        <div class="channel-head">
          <span class="drag-handle" title="드래그해서 순서 변경">⠿</span>
          ${meta?.avatar?`<img class="avatar" src="${meta.avatar}">`:''}
          <h3>${meta?.title || c.name}</h3>
          <span class="handle-link">${c.handle}</span>
          <span class="status ${err?'err':''}">${err?'수집 실패':(videos?`${videos.length}개 수집됨`:'대기 중')}</span>
        </div>
        ${staleNote}
        <div class="card-row">${cardsHtml}</div>
      </div>
    `;
  }).join('');
  wireChannelDragDrop(root);
  root.querySelectorAll('[data-ytcheck]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.preventDefault(); e.stopPropagation();
      markYtChecked(btn.dataset.ytcheck);
    };
  });
  root.querySelectorAll('[data-ytscrap]').forEach(btn=>{
    btn.onclick = async (e)=>{
      e.preventDefault(); e.stopPropagation();
      const url = btn.dataset.vurl;
      const key = linkToSafeKey(url);
      if(newsState.savedNews[key]) return;
      const item = {
        type:'youtube', title: btn.dataset.vtitle || '(제목 없음)',
        link: url, youtubeUrl: url, source: btn.dataset.vchannel || '유튜브',
        thumbnail: btn.dataset.vthumb || '',
        pubDate: btn.dataset.vpub || new Date().toISOString(),
        note:'', tags:[], bodyIsFinal:true,
        order: nextSavedOrder(), addedAt: Date.now()
      };
      btn.disabled = true; btn.textContent = '✓ 스크랩됨'; btn.classList.add('saved');
      const ok = await saveSavedNewsItem(key, item);
      if(!ok){ btn.disabled = false; btn.textContent = '+ 스크랩'; btn.classList.remove('saved'); alert('스크랩 저장에 실패했어요.'); }
      else{ enrichScrapWithGeminiYoutubeSummary(key, url); }   // 배경에서 Gemini 영상요약 생성
    };
  });
}

/* ---------- 채널 카드 드래그 순서 변경(실시간 저장) ---------- */
let dragSrcId = null;
function wireChannelDragDrop(root){
  const sections = root.querySelectorAll('.channel-section');
  sections.forEach(el=>{
    el.addEventListener('dragstart', (e)=>{
      if(!e.target.closest('.drag-handle')){ e.preventDefault(); return; }
      dragSrcId = el.dataset.id;
      el.classList.add('dragging');
    });
    el.addEventListener('dragend', ()=>{
      el.classList.remove('dragging');
      sections.forEach(s=>s.classList.remove('drag-over'));
    });
    el.addEventListener('dragover', (e)=>{
      e.preventDefault();
      if(el.dataset.id!==dragSrcId) el.classList.add('drag-over');
    });
    el.addEventListener('dragleave', ()=>{
      el.classList.remove('drag-over');
    });
    el.addEventListener('drop', async (e)=>{
      e.preventDefault();
      el.classList.remove('drag-over');
      const targetId = el.dataset.id;
      if(!dragSrcId || dragSrcId===targetId) return;
      const cur = state.tabs[state.activeTab];
      const fromIdx = cur.channels.findIndex(c=>c.id===dragSrcId);
      const toIdx = cur.channels.findIndex(c=>c.id===targetId);
      if(fromIdx<0 || toIdx<0) return;
      const [moved] = cur.channels.splice(fromIdx,1);
      cur.channels.splice(toIdx,0,moved);
      renderSections();
      renderChannelList();
      await saveActiveTabChannels();
    });
  });
}

/* ---------- Refresh flow (active tab only) ---------- */
async function refreshAll(){
  if(!state.apiKey){
    alert('먼저 ⚙ 설정에서 YouTube Data API 키를 입력하세요.');
    document.getElementById('settingsPanel').classList.add('open');
    return;
  }
  await refetchActiveTabChannels();
  const cur = state.tabs[state.activeTab];
  const btn = document.getElementById('refreshBtn');
  btn.disabled = true; btn.textContent = '업데이트 중...';
  cur.errors = {};
  renderChannelList();
  renderSections();

  for(const c of cur.channels){
    try{
      let targetPlaylistId;
      if(c.playlistId && c.playlistId.trim()){
        targetPlaylistId = c.playlistId.trim();
      }else{
        if(!cur.meta[c.id]){
          cur.meta[c.id] = await fetchChannel(c.handle);
        }
        targetPlaylistId = cur.meta[c.id].uploadsPlaylistId;
      }
      const videos = await fetchRecentVideos(targetPlaylistId);
      cur.videos[c.id] = videos;
      delete cur.errors[c.id];
    }catch(e){
      cur.errors[c.id] = e.message;   // cur.videos[c.id]는 유지 — 마지막 수집분 계속 표시
    }
    renderSections();
  }
  ytCacheSave();
  if(typeof _ytAutoLast !== 'undefined') _ytAutoLast[state.activeTab] = Date.now();   // 수동 갱신도 자동 갱신 간격에 반영
  btn.disabled = false; btn.textContent = '최신으로 업데이트';
}

