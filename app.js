/* 모바일 서랍·UI 연결·startApp — 마지막에 로드
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ===== 모바일 네비 좌측 서랍. ≤900px에서만 서랍으로 동작. ===== */
function drawerIsMobile(){ try{ return window.matchMedia('(max-width:900px)').matches; }catch(e){ return false; } }
function closeAllDrawers(){
  document.getElementById('appSidebar')?.classList.remove('drawer-open');
  document.getElementById('drawerBackdrop')?.classList.remove('show');
  document.body.classList.remove('drawer-open');
}
function openLeftDrawer(){
  renderDrawerQuicklinks();
  document.getElementById('appSidebar')?.classList.add('drawer-open');
  document.getElementById('drawerBackdrop')?.classList.add('show');
  document.body.classList.add('drawer-open');
}
/* 좌측 서랍 하단 바로가기 링크 (우측 서랍 폐지분 이설) */
function renderDrawerQuicklinks(){
  const box = document.getElementById('sbQuicklinks');
  if(!box) return;
  const links = (newsState.quickLinks || []).filter(l=> l && l.url);
  box.innerHTML = links.map(l=>
    `<button class="sb-ql" data-ql="${esc(l.url)}">${esc(l.name || l.url)}</button>`).join('')
    + `<button class="sb-ql sb-ql-manage" id="sbQlManage">바로가기 링크 관리</button>`;
  box.querySelectorAll('[data-ql]').forEach(b=> b.onclick = ()=>{ window.open(b.dataset.ql, '_blank', 'noopener'); closeAllDrawers(); });
  const mg = box.querySelector('#sbQlManage');
  if(mg) mg.onclick = ()=>{ closeAllDrawers(); document.getElementById('quickLinkSettingsBtn')?.click(); };
}

document.getElementById('drawerBackdrop')?.addEventListener('click', closeAllDrawers);
document.getElementById('leftDrawerClose')?.addEventListener('click', closeAllDrawers);
document.getElementById('mobileMenuBtn')?.addEventListener('click', openLeftDrawer);
document.addEventListener('keydown', e=>{ if(e.key === 'Escape') closeAllDrawers(); });
window.addEventListener('resize', ()=>{ if(!drawerIsMobile()) closeAllDrawers(); });

document.getElementById('modeYtBtn').onclick = ()=> showMode('yt');
document.getElementById('modeNewsBtn').onclick = ()=> showMode('news');
// 헤더 Jungle 로고 = 홈(실시간). 모바일 서랍은 별도 컬러 햄버거(#mobileMenuBtn).
const _gbBrand = document.getElementById('gbBrand');
if(_gbBrand) _gbBrand.onclick = ()=>{ showMode('news'); showNewsSubtab('live'); };
// 좌측 서랍(모바일) Jungle 로고 = 홈(모바일 전용 인덱스: 메모·스크랩 빠른입력 + 실시간 바로가기)
const _sbHomeBtn = document.getElementById('sbHomeBtn');
if(_sbHomeBtn){
  const goHome = ()=>{ showMode('home'); closeAllDrawers(); };
  _sbHomeBtn.onclick = goHome;
  _sbHomeBtn.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' || e.key === ' '){ e.preventDefault(); goHome(); } });
}
document.getElementById('modeNoticeBtn').onclick = ()=> showMode('notice');
{ const b = document.getElementById('modeSettingsBtn'); if(b) b.onclick = ()=> showMode('settings'); }
document.getElementById('modeSnsBtn').onclick = ()=> showMode('sns');
{ const b = document.getElementById('modeOpinionBtn'); if(b) b.onclick = ()=> showMode('opinion'); }
{ const b = document.getElementById('modeReportBtn'); if(b) b.onclick = ()=> showMode('report'); }
document.getElementById('modeMemoBtn').onclick = ()=> showMode('memo');
{ const b = document.getElementById('modeShinpdBtn'); if(b) b.onclick = ()=> showMode('shinpd'); }
// 서랍에서 화면 이동 후 자동으로 닫기
document.querySelectorAll('#appSidebar .mode-btn').forEach(b=>
  b.addEventListener('click', ()=>{ if(drawerIsMobile()) closeAllDrawers(); }));
newsState.quickLinks = [];

async function loadQuickLinks(){
  try{
    const res = await dbFetch(FIREBASE_URL + '/quick_links.json');
    const data = await res.json();
    newsState.quickLinks = Array.isArray(data) ? data.filter(x=>x && x.url) : [];
  }catch(e){ newsState.quickLinks = []; }
  renderQuickLinkSelect();
}
async function saveQuickLinks(){
  try{
    await dbFetch(FIREBASE_URL + '/quick_links.json', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(newsState.quickLinks)
    });
  }catch(e){ alert('링크 목록 저장에 실패했습니다. 잠시 후 다시 시도해 주세요.'); }
}
function renderQuickLinkSelect(){
  const sel = document.getElementById('quickLinkSelect');
  if(sel){
    sel.innerHTML = '<option value="">선택하세요</option>' +
      newsState.quickLinks.map(l=>`<option value="${esc(l.url)}">${esc(l.name || l.url)}</option>`).join('');
    sel.value = '';
  }
  renderDrawerQuicklinks();   // 모바일 좌측 서랍 하단에도 반영
}
document.getElementById('quickLinkSelect').onchange = (e)=>{
  const url = e.target.value;
  if(!url) return;
  window.open(url, '_blank', 'noopener');
  e.target.value = '';
};

function openQuickLinkSettings(){
  const draft = newsState.quickLinks.map(l=>({name:l.name||'', url:l.url||''}));
  const back = document.createElement('div');
  back.className = 'ql-modal-back';
  back.innerHTML = `<div class="ql-modal">
      <h3>바로가기 링크 관리</h3>
      <div class="hint">왼쪽 손잡이를 끌어 순서를 바꿀 수 있습니다. 팀 전체에 공유됩니다.</div>
      <div id="qlList"></div>
      <button class="subtab-btn" id="qlAddBtn">+ 링크 추가</button>
      <div class="ql-actions">
        <button class="subtab-btn" id="qlCancelBtn">취소</button>
        <button class="subtab-btn" id="qlSaveBtn">저장</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  const listEl = back.querySelector('#qlList');
  let dragIdx = null;
  function paint(){
    listEl.innerHTML = draft.map((l,i)=>`
      <div class="ql-row" draggable="true" data-i="${i}">
        <span class="grip">⋮⋮</span>
        <input class="ql-name" data-i="${i}" data-f="name" placeholder="제호" value="${esc(l.name)}">
        <input class="ql-url" data-i="${i}" data-f="url" placeholder="https://..." value="${esc(l.url)}">
        <button data-del="${i}" title="삭제">✕</button>
      </div>`).join('');
    listEl.querySelectorAll('input').forEach(inp=>{
      inp.oninput = ()=>{ draft[+inp.dataset.i][inp.dataset.f] = inp.value; };
    });
    listEl.querySelectorAll('[data-del]').forEach(b=>{
      b.onclick = ()=>{ draft.splice(+b.dataset.del,1); paint(); };
    });
    listEl.querySelectorAll('.ql-row').forEach(row=>{
      row.ondragstart = ()=>{ dragIdx = +row.dataset.i; row.classList.add('dragging'); };
      row.ondragend   = ()=>{ row.classList.remove('dragging'); };
      row.ondragover  = (ev)=>{ ev.preventDefault(); };
      row.ondrop = (ev)=>{
        ev.preventDefault();
        const to = +row.dataset.i;
        if(dragIdx===null || dragIdx===to) return;
        const [moved] = draft.splice(dragIdx,1);
        draft.splice(to,0,moved);
        dragIdx = null;
        paint();
      };
    });
  }
  paint();

  back.querySelector('#qlAddBtn').onclick = ()=>{ draft.push({name:'',url:''}); paint(); };
  const close = ()=> back.remove();
  back.querySelector('#qlCancelBtn').onclick = close;
  guardBackdropClose(back, close);
  back.querySelector('#qlSaveBtn').onclick = async ()=>{
    newsState.quickLinks = draft
      .map(l=>({name:(l.name||'').trim(), url:(l.url||'').trim()}))
      .filter(l=>l.url)
      .map(l=>({name:l.name || l.url, url:/^https?:\/\//i.test(l.url) ? l.url : 'https://' + l.url}));
    await saveQuickLinks();
    renderQuickLinkSelect();
    close();
  };
}
document.getElementById('quickLinkSettingsBtn').onclick = openQuickLinkSettings;

document.getElementById('modeCanvaBtn').onclick = ()=>
  window.open(JUNGLE_CONFIG.links.canva, '_blank', 'noopener');
document.getElementById('modeStudioBtn').onclick = ()=>
  window.open(JUNGLE_CONFIG.links.studio, '_blank', 'noopener');

/* ---------- Wire up UI ---------- */
document.getElementById('settingsBtn').onclick = async ()=>{
  const panel = document.getElementById('settingsPanel');
  const opening = !panel.classList.contains('open');
  panel.classList.toggle('open');
  if(opening){
    await refetchActiveTabChannels();
    renderChannelList();
    renderSections();
  }
};
document.getElementById('refreshBtn').onclick = refreshAll;
/* 유튜브 모니터링 자동 갱신(2026-10-06 — 전엔 "최신으로 업데이트"를 눌러야만 새 영상이 들어와 과거에 멈춰 있었음).
   유튜브 화면을 보고 있는 동안, 화면에 보이는 탭을 10분마다(탭마다 따로 센다) 조용히 갱신한다. 화면에 들어올 때·탭이 다시 보일 때도 오래됐으면 즉시.
   쿼터: 채널당 약 3유닛 × 5채널 × 하루 최대 ~144회 ≈ 2,200유닛(일 한도 10,000) — 화면을 보고 있을 때만 돌아서 실제론 훨씬 적다. */
window.JUNGLE_RTDB_URL = FIREBASE_URL;                  // people.html(iframe) 안의 특수문자 모달이 부모의 DB 주소·권한을 빌려 쓴다
window.__jungleIsMaster = ()=> _isMaster();
const YT_AUTO_MS = 10 * 60 * 1000;
const _ytAutoLast = {};
let _ytAutoBusy = false;
async function ytAutoRefresh(){
  if(_currentMode !== 'yt' || document.hidden || _ytAutoBusy || !state.apiKey) return;
  const btn = document.getElementById('refreshBtn');
  if(!btn || btn.disabled) return;                      // 수동 갱신 중
  const tab = state.activeTab;
  if(Date.now() - (_ytAutoLast[tab] || 0) < YT_AUTO_MS) return;
  _ytAutoBusy = true; _ytAutoLast[tab] = Date.now();
  try{ await refreshAll(); }catch(e){ console.warn('[유튜브 자동 갱신 실패]', e); }
  finally{ _ytAutoBusy = false; }
}
setInterval(ytAutoRefresh, 60 * 1000);
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden) ytAutoRefresh(); });
document.getElementById('addChannelBtn').onclick = async ()=>{
  const h = document.getElementById('newHandle').value.trim();
  const n = document.getElementById('newName').value.trim();
  const playlistId = normalizePlaylistId(document.getElementById('newPlaylistId').value);
  if(!h) return;
  const btn = document.getElementById('addChannelBtn');
  const editingId = btn.dataset.editingId;
  await refetchActiveTabChannels();
  const cur = state.tabs[state.activeTab];
  if(editingId){
    const idx = cur.channels.findIndex(c=>c.id===editingId);
    if(idx>=0) cur.channels[idx] = {id:editingId, handle:h, name:n||h, playlistId};
    else cur.channels.push({id:genChannelId(), handle:h, name:n||h, playlistId});
    delete cur.videos[editingId];
    delete cur.errors[editingId];
    delete btn.dataset.editingId;
    btn.textContent = '추가';
  }else{
    cur.channels.push({id:genChannelId(), handle:h, name:n||h, playlistId});
  }
  await saveActiveTabChannels();
  document.getElementById('newHandle').value='';
  document.getElementById('newName').value='';
  document.getElementById('newPlaylistId').value='';
  renderChannelList();
  renderSections();
};

async function startApp(){
  // 로그인 게이트(initAuthGate → onSignedIn)에서만 호출된다. 자동 실행하지 않음.
  // 서로 무관한 초기 데이터는 순서대로 기다리지 않고 동시에 요청 (2026-09-01 확정)
  const [,,,,,,archived, archiveFolders] = await Promise.all([
    loadState(),
    loadNewsKeywords(),
    loadNewsDismissed(),
    loadDisabledOutlets(),
    loadSavedNews(),
    loadQuickLinks(),
    loadArchive(),
    loadArchiveFolders(),
    loadPersonalMemos(),
    loadMemoCategories(),
    loadUserRead(),
    loadCustomFeeds(),
    loadDiscoveredOutlets(),
    loadReports(),
    loadUiPrefs(),
    loadRecentSearches(),
    loadAdminConfig(),
    loadMenuPrefs(),
    loadImportantSets()
  ]);
  applyMenuVisibility();
  try{ if(menuEnabled('shinpd')){ shinpdStartTimer(); shinpdLoadChat(); } }catch(e){}   // 신피디: 3시간 자동 리포트 점검·대화 기록(2026-10-13)
  applyActiveImportantSteps();   // ui_prefs·important_sets 둘 다 로드된 뒤 활성 세트 필터값 확정
  newsState.archived = archived || {};
  newsState.archiveFolders = archiveFolders || [];
  perfLog('· 데이터로드', performance.now() - (window.__perfStart || 0));   // 임시 측정용

  preloadViewState();   // 모바일 복귀: 서브탭/펼침수를 첫 렌더 전에 얹음

  const _poolFilter = (a)=> keepArticle(a);

  const localCache = loadArticleCacheLocal();
  if(localCache){
    newsState.articles = localCache.articles.filter(_poolFilter);
    // 팀 공유 캐시도 배경에서 받아 병합 — 모바일에서 localStorage가 유실돼도(사파리 7일 삭제 등)
    // 새로고침 시 팀의 최신 기사 풀로 복구되어 "실시간 뉴스가 다 사라지는" 문제를 막는다.
    loadArticleCacheShared().then(shared=>{
      if(shared && typeof shared.savedAt === 'number'){ lastSharedSavedAt = shared.savedAt; startCooldownCountdown(); }
      if(!shared || !Array.isArray(shared.articles) || !shared.articles.length) return;
      const byLink = new Map(newsState.articles.map(a=>[a.link, a]));
      let added = 0;
      shared.articles.forEach(a=>{
        if(a && a.link && !byLink.has(a.link) && _poolFilter(a)){ byLink.set(a.link, a); added++; }
      });
      if(added){
        const cutoff = Date.now() - NEWS_POOL_WINDOW_MS;
        newsState.articles = Array.from(byLink.values()).filter(a=> !a.collectedAt || a.collectedAt >= cutoff);
        renderLiveFeed();
        if(newsState.activeSubtab === 'important') renderImportantNews();
        saveArticleCacheLocal(true);
      }
    }).catch(()=>{});
  }else{
    // 로컬 캐시가 없으면(첫 로드·모바일 유실) 첫 렌더 전에 팀 공유 캐시를 기다린다
    const shared0 = await loadArticleCacheShared();
    if(shared0 && Array.isArray(shared0.articles)){
      newsState.articles = shared0.articles.filter(_poolFilter);
      saveArticleCacheLocal(true);
    }
  }

  noteDiscoveredOutlets(newsState.articles);   // 캐시 풀의 매체도 설정 목록에 등록
  // 구독 언론사 — 마이그레이션이 discoveredOutlets·현재 풀을 참고하므로 풀 로드 뒤에
  await loadSubscribedOutlets();

  // 첫 화면에 필요한 것만 즉시 렌더 — 새로고침 직전 탭이 실시간이 아니면 실시간을 먼저 그렸다가
  // 다시 바꾸는 깜빡임 없이, 바로 그 탭으로 렌더한다 (preloadViewState가 이미 activeSubtab을 얹어둠)
  renderTabs();
  renderKeywordManageRow();
  initClusterSlider();
  initDupSlider();
  initRelevanceSlider();
  initSynonymSlider();
  initFilterToggle();
  initKeywordSearch();   // 헤더 검색창 (전역)
  renderOutletScopeToggle();
  syncFilterPanel();
  if(newsState.activeSubtab === 'live') renderLiveFeed();
  perfLog('초기 로딩', performance.now() - (window.__perfStart || performance.now()));
  startCooldownCountdown();
  restoreViewStateAfterRender();   // 저장된 서브탭으로 전환(실시간이면 여기서 처음 렌더됨)
  // 새로고침이면 보던 화면(주소의 #m=)을 되살린다. 새 탭이면: 모바일은 매 진입 시 인덱스(메모·스크랩 빠른입력+실시간 바로가기)가 첫 화면
  if(!restoreModeFromHash() && drawerIsMobile()) showMode('home');
  setTimeout(maybeShowSetupWizard, 900);   // 최초 로그인 시 초기 세팅 마법사

  // 안 보이는 탭·유튜브 렌더는 첫 페인트 뒤로 (관심뉴스 클러스터링 ~300ms 등이 화면을 막지 않게)
  requestAnimationFrame(()=> requestAnimationFrame(()=>{
    renderChannelList();
    renderSections();
    renderKeywordToggleGrid();
    renderKeywordResults();
    renderImportantNews();
    renderOutletSettings();
    renderSavedNews();
    renderArchiveFolders();
    renderArchive();
  }));

  checkFixedScheduleCollect();
  _autoRefreshTimer = setInterval(checkFixedScheduleCollect, 60*1000);
  _readSyncPoll = setInterval(()=>{ syncUserReadFromServer(); syncUiPrefsFromServer(); }, 60*1000);   // 기기 간 읽음·화면설정 주기 동기화

  // 캐시 풀에 네이버 정치섹션 기사가 하나도 없으면(구버전 캐시·최초 로드) 즉시 한 번 수집
  if(!newsState.articles.some(a => a._via === 'section')){
    refreshNews(true).then(()=> renderAllNewsViews());
  }

  setInterval(async ()=>{
    const ytVisible = document.getElementById('ytApp').style.display !== 'none';
    if(!ytVisible) return; // 유튜브 탭을 보고 있지 않으면 폴링 자체를 건너뜀 (2026-09-01 확정)
    const before = JSON.stringify(state.tabs[state.activeTab].channels);
    await refetchActiveTabChannels();
    const after = JSON.stringify(state.tabs[state.activeTab].channels);
    if(before !== after){
      renderChannelList();
      renderSections();
    }
  }, 8000);

  renderTeamAccounts();
  restoreScrapDraftIfAny();
}

