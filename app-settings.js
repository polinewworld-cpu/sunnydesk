/* 모바일 상태 복원·설정 페이지·마법사·알고리즘 탭
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ===== 모바일 상태 복원 =====
   모바일 브라우저는 앱을 백그라운드로 보내면 페이지를 통째로 버려 → 복귀 시 전체 새로고침.
   새로고침 자체는 못 막으므로, 떠나기 직전 화면 상태를 저장해 뒀다가 다음 로드 때 되살린다.
   저장 대상: 보던 서브탭 / "더보기"로 펼친 개수 / 스크롤 위치. (사이드바 대분류는 항상 뉴스로 시작) */
const VIEW_STATE_LS_KEY = 'jungle_view_state_v1';
const VIEW_STATE_MAX_AGE_MS = 6 * 60 * 60 * 1000;   // 6시간 지난 상태(특히 스크롤)는 무시
let _pendingRestoreScrollY = 0;
let _viewStateSaveTimer = null;

function saveViewState(){
  try{
    localStorage.setItem(VIEW_STATE_LS_KEY, JSON.stringify({
      subtab: newsState.activeSubtab,
      showCounts: newsState.showCounts,
      scrollY: window.scrollY || window.pageYOffset || 0,
      savedAt: Date.now()
    }));
  }catch(e){}
}
function saveViewStateDebounced(){
  if(_viewStateSaveTimer) clearTimeout(_viewStateSaveTimer);
  _viewStateSaveTimer = setTimeout(saveViewState, 400);
}
/* startApp 렌더가 끝난 뒤 호출 — 서브탭/펼침수는 이미 newsState에 반영돼 있고, 스크롤만 복원 */
function restoreViewStateAfterRender(){
  let st;
  try{ st = JSON.parse(localStorage.getItem(VIEW_STATE_LS_KEY) || 'null'); }catch(e){}
  const fresh = !!(st && st.savedAt && (Date.now() - st.savedAt) < VIEW_STATE_MAX_AGE_MS);
  // 없어진 탭 → 대체 탭('report'→스크랩, 'outlets'→언론사 관리메뉴 이동으로 없어짐→실시간, 2026-09-09)
  const rawSub = st && st.subtab;
  const sub = rawSub === 'report' ? 'saved' : (rawSub === 'outlets' ? 'live' : (rawSub || 'live'));
  try{ showNewsSubtab(sub); }catch(e){}
  if(fresh && _pendingRestoreScrollY > 0){
    // 레이아웃이 안정된 뒤 두 프레임에 걸쳐 복원 (이미지·폰트 로딩으로 높이가 늦게 잡힘)
    const y = _pendingRestoreScrollY;
    requestAnimationFrame(()=> requestAnimationFrame(()=>{
      window.scrollTo(0, y);
      setTimeout(()=> window.scrollTo(0, y), 250);
    }));
  }
}
/* startApp 시작부에서 호출 — 캐시된 상태를 newsState에 미리 얹어 첫 렌더부터 반영되게 */
function preloadViewState(){
  let st;
  try{ st = JSON.parse(localStorage.getItem(VIEW_STATE_LS_KEY) || 'null'); }catch(e){}
  if(!st) return;
  if(st.subtab){
    // 'outlets'는 언론사 탭을 관리메뉴로 옮기며 없앤 값 — 예전에 저장된 상태 호환(2026-09-09)
    newsState.activeSubtab = st.subtab === 'report' ? 'saved' : (st.subtab === 'outlets' ? 'live' : st.subtab);
  }
  const fresh = st.savedAt && (Date.now() - st.savedAt) < VIEW_STATE_MAX_AGE_MS;
  if(fresh){
    _pendingRestoreScrollY = st.scrollY || 0;
    // 펼친 개수 복원은 최근 세션(6h)에서만, 상한 LOAD_MORE_STEP*2 — 안 그러면 낡은 큰 값이 "더보기" 버튼을 영구 숨김
    if(st.showCounts && typeof st.showCounts === 'object'){
      Object.keys(newsState.showCounts).forEach(k=>{
        const v = st.showCounts[k];
        if(typeof v === 'number' && v > newsState.showCounts[k]) newsState.showCounts[k] = Math.min(v, LOAD_MORE_STEP * 2);
      });
    }
  }
}

function flushStateOnHide(){
  saveArticleCacheLocal(true);   // 수집분 유실 방지 — 즉시 동기 저장
  saveViewState();
}
document.addEventListener('visibilitychange', ()=>{
  if(document.visibilityState === 'visible'){
    updateRefreshButtonState();
    checkFixedScheduleCollect();
    syncUserReadFromServer();   // 다른 기기에서 표시한 읽음 흡수
    syncUiPrefsFromServer();    // 다른 기기에서 바꾼 슬라이더·범위 토글 흡수
  }else{
    flushStateOnHide();
  }
});
window.addEventListener('pagehide', flushStateOnHide);
window.addEventListener('scroll', saveViewStateDebounced, {passive:true});

function showNewsSubtab(tab){
  newsState.activeSubtab = tab;
  syncActiveFilterSteps();   // 실시간/관심뉴스 각자의 유사도·관련성 값으로 슬라이더·렌더 정렬
  document.getElementById('subtabLiveBtn').classList.toggle('active', tab==='live');
  document.getElementById('subtabImportantBtn').classList.toggle('active', tab==='important' && newsState.activeImportantSet==='important');
  document.getElementById('subtabKeywordBtn').classList.toggle('active', tab==='keyword');
  document.getElementById('subtabRecommendBtn').classList.toggle('active', tab==='recommend');
  document.getElementById('subtabOpcolBtn').classList.toggle('active', tab==='opcol');
  document.getElementById('subtabSavedNewsBtn').classList.toggle('active', tab==='saved');
  document.getElementById('subtabArchiveBtn').classList.toggle('active', tab==='archive');
  document.getElementById('liveFeedPanel').style.display = tab==='live' ? '' : 'none';
  const twoBarTabs = (tab==='live' || tab==='important');   // 3대 필터 슬라이더 노출 대상
  if(twoBarTabs){ initClusterSlider(); initDupSlider(); initRelevanceSlider(); initSynonymSlider(); }  // 탭마다 시간창 값이 달라 전환 시 다시 바인딩
  const scopeBar = document.getElementById('outletScopeBar');
  if(scopeBar){
    const scopeTabs = (tab==='live' || tab==='important' || tab==='keyword');
    scopeBar.style.display = scopeTabs ? 'inline-flex' : 'none';
    if(scopeTabs) renderOutletScopeToggle();
  }
  syncFilterPanel();
  document.getElementById('importantNewsPanel').style.display = tab==='important' ? '' : 'none';
  document.getElementById('recommendPanel').style.display = tab==='recommend' ? '' : 'none';
  document.getElementById('keywordNewsPanel').style.display = tab==='keyword' ? '' : 'none';
  document.getElementById('opcolPanel').style.display = tab==='opcol' ? '' : 'none';
  document.getElementById('savedNewsPanel').style.display = tab==='saved' ? '' : 'none';
  document.getElementById('archivePanel').style.display = tab==='archive' ? '' : 'none';
  document.getElementById('keywordManageRow').style.display = tab==='keyword' ? '' : 'none';
  const gearBtn = document.getElementById('keywordGearBtn');
  if(gearBtn) gearBtn.style.display = 'none';   // 키워드 생성·관리는 이제 키워드 탭 하나로 통합, 모바일 전용 모달 경로는 은퇴
  renderImportantSetTabs();   // 관심뉴스 세트 1depth 탭 — 이름 동기화 + 활성 표시 갱신
  if(tab==='live'){ renderLiveFeed(); }
  if(tab==='important'){ renderImportantNews(); }
  if(tab==='keyword'){ renderKeywordManageRow(); renderKeywordToggleGrid(); renderKeywordResults(); }
  if(tab==='opcol'){ renderOpcol(); }
  if(tab==='recommend' && typeof window.rcShowTab === 'function'){ window.rcShowTab(); }
  if(tab==='saved'){ renderSavedNews(); syncSavedToolbarSticky(); }
  if(tab==='archive'){ renderArchiveFolders(); renderArchive(); syncArchiveStickyBar(); }
  if(typeof saveViewStateDebounced === 'function') saveViewStateDebounced();
}
document.getElementById('subtabLiveBtn').onclick = ()=> showNewsSubtab('live');
document.getElementById('subtabImportantBtn').onclick = ()=> selectImportantSetTab('important');
document.getElementById('subtabKeywordBtn').onclick = ()=> showNewsSubtab('keyword');
document.getElementById('subtabOpcolBtn').onclick = ()=> showNewsSubtab('opcol');
document.getElementById('subtabRecommendBtn').onclick = ()=> showNewsSubtab('recommend');
document.getElementById('subtabSavedNewsBtn').onclick = ()=> showNewsSubtab('saved');
document.getElementById('subtabArchiveBtn').onclick = ()=> showNewsSubtab('archive');

/* ======================================================================
   설정 페이지 — 유형(persona) 프리셋 + "기사 노출에 불만 있어요"(트러블 조정)
   진입: 사이드바 '도구' > 설정. 성능확인 버튼은 이 페이지 하단으로 이설.
   유형/트러블 선택 → ui_prefs 일괄 적용 → 실시간 탭으로 이동.
   ====================================================================== */
const PERSONA_ICONS = {
  '공보담당자형': 'M20 3H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V5a2 2 0 0 0-2-2zm0 16H4V5h16v14zM6 7h6v6H6V7zm7 0h5v2h-5V7zm0 4h5v2h-5v-2zM6 15h12v2H6v-2z',
  '보좌진(의원실)형': 'M6.62 10.79c1.44 2.83 3.76 5.14 6.59 6.59l2.2-2.2c.27-.27.67-.36 1.02-.24 1.12.37 2.33.57 3.57.57.55 0 1 .45 1 1V20c0 .55-.45 1-1 1-9.39 0-17-7.61-17-17 0-.55.45-1 1-1h3.5c.55 0 1 .45 1 1 0 1.25.2 2.45.57 3.57.11.35.03.74-.25 1.02l-2.2 2.2z',
  '결정권자 본인형': 'M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20zm0 18a8 8 0 1 1 0-16 8 8 0 0 1 0 16zm.5-13H11v6l5.25 3.15.75-1.23-4.5-2.67z',
  '방송작가·PD형': 'M17 10.5V7a1 1 0 0 0-1-1H4a1 1 0 0 0-1 1v10a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1v-3.5l4 4v-11l-4 4z',
  '모니터링·리서처형': 'M15.5 14h-.79l-.28-.27a6.5 6.5 0 1 0-.7.7l.27.28v.79l5 4.99L20.49 19l-4.99-5zm-6 0A4.5 4.5 0 1 1 14 9.5 4.5 4.5 0 0 1 9.5 14z',
  '이슈대응·SNS팀형': 'M12 22c1.1 0 2-.9 2-2h-4a2 2 0 0 0 2 2zm6-6v-5c0-3.07-1.64-5.64-4.5-6.32V4c0-.83-.67-1.5-1.5-1.5s-1.5.67-1.5 1.5v.68C7.63 5.36 6 7.92 6 11v5l-2 2v1h16v-1l-2-2z',
  '지역정치형': 'M12 2C8.13 2 5 5.13 5 9c0 5.25 7 13 7 13s7-7.75 7-13c0-3.87-3.13-7-7-7zm0 9.5A2.5 2.5 0 1 1 12 6.5a2.5 2.5 0 0 1 0 5z',
};
const PERSONA_PRESETS = [
  {
    name: '공보담당자형',
    tagline: '지휘부의 조간 브리핑을 대신합니다',
    desc: '실시간 뉴스는 지휘권자가 아침에 신문을 훑는 시간을 줄여주는 역할입니다. 주식·날씨·경제·정치 주요 이슈·지역·특정 정책처럼 형식이 정해져 있어 실시간 키워드도 거기에 맞춥니다. 관심뉴스는 담당 현안을 하나도 빠뜨리지 않고 모두 담습니다.',
    kw: '실시간 키워드는 브리핑 형식(경제·정치 현안·지역)에 맞춰 좁게, 관심뉴스 키워드는 담당 인물·정책을 빠짐없이 등록하세요.',
    prefs: { liveWindowStep:2, liveDupStep:4, liveRelevanceStep:1, outletScope:'all',
             importantWindowStep:1, importantDupStep:0, importantRelevanceStep:1 }
  },
  {
    name: '보좌진(의원실)형',
    tagline: '기자 전화가 오기 전에 알아야 합니다',
    desc: '의원 발언·피감기관·상임위 이슈에 즉각 대응해야 하는 자리입니다. 속보를 놓치는 것이 가장 큰 사고라, 실시간은 짧은 시간창으로 촘촘히 보고 관련성 기준은 낮춰 하나도 흘리지 않습니다. 관심뉴스는 길게 잡아 광범위하게 수집한 뒤 존안에 정리합니다.',
    kw: '실시간에 의원명·지역구·상임위·상대 진영 키워드를 넓게. 관심뉴스는 소관 정책 전반을 폭넓게 등록하세요.',
    prefs: { liveWindowStep:3, liveDupStep:2, liveRelevanceStep:0, outletScope:'all',
             importantWindowStep:0, importantDupStep:1, importantRelevanceStep:0 }
  },
  {
    name: '결정권자 본인형',
    tagline: '하루 10분, 큰 것만',
    desc: '후보·의원 본인이 짧게 확인하는 용도입니다. 같은 얘기를 두 번 보기 싫고, 정말 큰 이슈만 걸러서 봅니다. 실시간·관심뉴스 모두 유사 기사는 강하게 묶고 관련성 기준은 높게 둡니다.',
    kw: '본인명과 핵심 현안 2~3개만. 키워드를 좁게 유지하는 것이 이 유형의 핵심입니다.',
    prefs: { liveWindowStep:3, liveDupStep:4, liveRelevanceStep:2, outletScope:'all',
             importantWindowStep:2, importantDupStep:3, importantRelevanceStep:2 }
  },
  {
    name: '방송작가·PD형',
    tagline: '아이템 회의용, 서로 다른 스토리',
    desc: '방송 아이템을 고르는 용도라 같은 사안의 기사 20개보다 서로 다른 스토리가 중요합니다. 유사 기사는 강하게 묶고, 관심뉴스는 확실히 관련된 덩어리만 남도록 관련성 기준을 높입니다. 뉴스 리포트를 적극적으로 씁니다.',
    kw: '아이템이 될 만한 주제어 위주로. 인물보다 사건·쟁점 키워드를 등록하세요.',
    prefs: { liveWindowStep:2, liveDupStep:4, liveRelevanceStep:1, outletScope:'all',
             importantWindowStep:1, importantDupStep:3, importantRelevanceStep:2 }
  },
  {
    name: '모니터링·리서처형',
    tagline: '지금 다 안 봐도, 나중에 다 찾아져야',
    desc: '전수 수집이 목적입니다. 지금 화면에서 다 읽지 않아도 되지만 나중에 검색하면 빠짐없이 나와야 합니다. 유사 기사는 거의 묶지 않고 관련성 필터도 끄며, 시간창은 넓게 둡니다.',
    kw: '넓게 등록하세요. 놓치는 것이 병합·필터로 걸러지는 것보다 더 큰 손해인 유형입니다.',
    prefs: { liveWindowStep:1, liveDupStep:0, liveRelevanceStep:0, outletScope:'all',
             importantWindowStep:0, importantDupStep:0, importantRelevanceStep:0 }
  },
  {
    name: '이슈대응·SNS팀형',
    tagline: '논란이 터지는 순간을 잡습니다',
    desc: '부정 여론의 초기 신호를 포착하는 자리입니다. 실시간은 아주 짧은 시간창으로 지금 막 뜨는 것만 봅니다. 관심뉴스는 하루 단위로 프레임 확산을 추적합니다.',
    kw: '본인명·조직명과 부정 프레임어(의혹·논란·해명·거짓말·특혜)를 조합해 등록하세요.',
    prefs: { liveWindowStep:4, liveDupStep:2, liveRelevanceStep:0, outletScope:'all',
             importantWindowStep:1, importantDupStep:1, importantRelevanceStep:1 }
  },
  {
    name: '지역정치형',
    tagline: '특정 시·군·구, 도의회 중심',
    desc: '기초의원·지역지처럼 특정 지역이 중심이고 중앙 정치는 배경입니다. 실시간은 지역 언론사 위주로 보고, 관심뉴스는 길게 잡아 지역 현안을 전수 수집합니다.',
    kw: '지역명·지역 현안·지역 인사 위주로. 관심뉴스 키워드를 넓게 잡아 지역 이슈를 전수로 담으세요.',
    // liveRelevanceStep은 0으로 — 실시간 수집원이 네이버 "정치 섹션"(전국 헤드라인) 하나뿐이라
    // 지역명이 제목에 직접 안 걸리는 경우가 대부분이라, 여기서 관련성 필터를 걸면 실시간 탭이
    // 통째로 비어버림. outletScope도 구독 언론사가 없는 계정에선 똑같이 전부 걸러지므로 'all'로.
    prefs: { liveWindowStep:2, liveDupStep:3, liveRelevanceStep:0, outletScope:'all',
             importantWindowStep:0, importantDupStep:1, importantRelevanceStep:0 }
  },
];

const _CL = (v, max)=> Math.max(0, Math.min(max, v));
function _winMax(){ return LIVE_WINDOW_STEPS.length - 1; }
function _dupMax(){ return DUP_STEPS.length - 1; }
function _relMax(){ return RELEVANCE_STEPS.length - 1; }

const TROUBLE_FIXES = [
  { label: '실시간이 너무 적게 떠요',
    detail: '실시간의 표시 시간을 넓히고, 관련성 기준과 유사 기사 병합을 한 단계씩 완화합니다.',
    apply: (c)=>({
      liveWindowStep:    _CL(c.liveWindowStep    - 1, _winMax()),
      liveRelevanceStep: _CL(c.liveRelevanceStep - 1, _relMax()),
      liveDupStep:       _CL(c.liveDupStep       - 1, _dupMax()),
    }) },
  { label: '같은 기사가 계속 도배돼요',
    detail: '실시간·관심뉴스의 유사 기사 병합을 한 단계씩 더 강하게 합니다.',
    apply: (c)=>({
      liveDupStep:      _CL(c.liveDupStep      + 1, _dupMax()),
      importantDupStep: _CL(c.importantDupStep + 1, _dupMax()),
    }) },
  { label: '관련 없는 기사가 섞여 나와요',
    detail: '실시간·관심뉴스의 기사 관련성 기준을 한 단계씩 올립니다.',
    apply: (c)=>({
      liveRelevanceStep:      _CL(c.liveRelevanceStep      + 1, _relMax()),
      importantRelevanceStep: _CL(c.importantRelevanceStep + 1, _relMax()),
    }) },
  { label: '관심뉴스에 중요한 게 안 떠요',
    detail: '관심뉴스의 관련성 기준을 낮추고 표시 시간을 넓힙니다.',
    apply: (c)=>({
      importantRelevanceStep: _CL(c.importantRelevanceStep - 1, _relMax()),
      importantWindowStep:    _CL(c.importantWindowStep    - 1, _winMax()),
    }) },
  { label: '너무 옛날 기사만 보여요',
    detail: '실시간·관심뉴스의 표시 시간을 한 단계씩 좁혀 최신 기사 위주로 봅니다.',
    apply: (c)=>({
      liveWindowStep:      _CL(c.liveWindowStep      + 1, _winMax()),
      importantWindowStep: _CL(c.importantWindowStep + 1, _winMax()),
    }) },
];

const PREF_FIELD_META = {
  liveWindowStep:         { group:'실시간',  name:'뉴스 표시량', kind:'win' },
  liveDupStep:            { group:'실시간',  name:'유사한 기사', kind:'dup' },
  liveRelevanceStep:      { group:'실시간',  name:'기사 관련성', kind:'rel' },
  outletScope:            { group:'실시간',  name:'언론사 범위', kind:'scope' },
  importantWindowStep:    { group:'관심뉴스', name:'뉴스 표시량', kind:'win' },
  importantDupStep:       { group:'관심뉴스', name:'유사한 기사', kind:'dup' },
  importantRelevanceStep: { group:'관심뉴스', name:'기사 관련성', kind:'rel' },
};

let _settingsTab = 'manage';
function _isMaster(){ return !!(CURRENT_ACCOUNT && CURRENT_ACCOUNT.isMaster); }
function renderSettingsPage(){
  const at = document.getElementById('setTabAlgo');
  if(at) at.hidden = true;   // 써니데스크: 알고리즘 탭은 쓰지 않는다
  if(_settingsTab === 'algo' && !_isMaster()) _settingsTab = 'manage';
  renderPersonaGrid();
  renderTroubleList();
  renderSettingsFoot();
  renderMenuToggles();
  renderImportantSetAdmin();
  renderOutletSettings();
  renderTeamAccounts();
  if(_isMaster()) renderAlgoPane();
  showSettingsTab(_settingsTab);
}
function showSettingsTab(which){
  if(which === 'algo' && !_isMaster()) which = 'persona';
  _settingsTab = which;
  const map = { persona:['setTabPersona','setPanePersona'], trouble:['setTabTrouble','setPaneTrouble'], manage:['setTabManage','setPaneManage'], outlets:['setTabOutlets','setPaneOutlets'], algo:['setTabAlgo','setPaneAlgo'] };
  Object.entries(map).forEach(([k, [tab, pane]])=>{
    document.getElementById(tab)?.classList.toggle('active', which === k);
    const el = document.getElementById(pane); if(el) el.hidden = which !== k;
  });
}
function _prefsMatchPersona(preset){
  const c = currentUiPrefs();
  return Object.keys(preset.prefs).every(k => c[k] === preset.prefs[k]);
}
function renderPersonaGrid(){
  const box = document.getElementById('personaGrid');
  if(!box) return;
  box.innerHTML = PERSONA_PRESETS.map((p, i)=>`
    <button class="persona-card${_prefsMatchPersona(p) ? ' current' : ''}" data-idx="${i}">
      <span class="pc-no">${i + 1}</span>
      <span class="pc-icon"><svg viewBox="0 0 24 24" fill="currentColor"><path d="${PERSONA_ICONS[p.name] || ''}"/></svg></span>
      <span class="pc-name">${esc(p.name)}</span>
      <span class="pc-tag">${esc(p.tagline)}</span>
      ${_prefsMatchPersona(p) ? '<span class="pc-cur">지금 설정</span>' : ''}
    </button>`).join('');
  box.querySelectorAll('.persona-card').forEach(c=>{
    c.onclick = ()=> openPersonaModal(PERSONA_PRESETS[parseInt(c.dataset.idx, 10)]);
  });
}
function renderTroubleList(){
  const box = document.getElementById('troubleList');
  if(!box) return;
  box.innerHTML = TROUBLE_FIXES.map((f, i)=>`
    <button class="trouble-item" data-idx="${i}">
      <span class="ti-label">${esc(f.label)}</span>
      <span class="ti-arrow">›</span>
    </button>`).join('');
  box.querySelectorAll('.trouble-item').forEach(b=>{
    b.onclick = ()=> openTroubleModal(TROUBLE_FIXES[parseInt(b.dataset.idx, 10)]);
  });
}
function renderSettingsFoot(){
  const foot = document.getElementById('setFoot');
  if(foot) foot.innerHTML = '';
  // 개발자 도구 카드(관리 탭) — devTools 켜졌을 때만. 성능 오버레이 ON/OFF 토글.
  const card = document.getElementById('devToolsCard');
  const chk  = document.getElementById('perfToggleChk');
  const on   = (JUNGLE_CONFIG.devTools !== false) && _perfEnabled;
  if(card) card.hidden = !on;
  if(chk && on){
    chk.checked = perfBoxVisible();
    chk.onchange = ()=> setPerfBox(chk.checked);
  }
}

/* 슬라이더형 단계 선택 컨트롤 (모달 안) */
function _stepControl(label, labels, value, onChange){
  const wrap = document.createElement('div');
  wrap.className = 'step-ctl';
  const max = labels.length - 1;
  wrap.innerHTML = `
    <div class="step-ctl-head"><span class="step-ctl-label">${esc(label)}</span><span class="step-ctl-val"></span></div>
    <input type="range" min="0" max="${max}" step="1" value="${value}">
    <div class="step-ctl-ticks">${labels.map((l, i)=>`<span data-i="${i}">${esc(l)}</span>`).join('')}</div>`;
  const range = wrap.querySelector('input');
  const val   = wrap.querySelector('.step-ctl-val');
  const ticks = [...wrap.querySelectorAll('.step-ctl-ticks span')];
  function paint(v){
    val.textContent = labels[v];
    ticks.forEach((t, i)=> t.classList.toggle('on', i === v));
  }
  range.oninput = ()=>{ const v = parseInt(range.value, 10); paint(v); onChange(v); };
  ticks.forEach(t => t.onclick = ()=>{ const v = parseInt(t.dataset.i, 10); range.value = String(v); paint(v); onChange(v); });
  paint(value);
  return wrap;
}
function _scopeControl(value, onChange){
  const wrap = document.createElement('div');
  wrap.className = 'step-ctl';
  wrap.innerHTML = `
    <div class="step-ctl-head"><span class="step-ctl-label">언론사 범위</span></div>
    <div class="scope-ctl">
      <button data-v="all">전체 기사</button>
      <button data-v="subscribed">구독 언론사만</button>
    </div>`;
  const btns = [...wrap.querySelectorAll('.scope-ctl button')];
  const paint = (v)=> btns.forEach(b=> b.classList.toggle('on', b.dataset.v === (v === 'subscribed' ? 'subscribed' : 'all')));
  btns.forEach(b => b.onclick = ()=>{ paint(b.dataset.v); onChange(b.dataset.v); });
  paint(value);
  return wrap;
}

function _openSetModal(inner){
  const back = document.createElement('div');
  back.className = 'set-modal-back';
  back.innerHTML = `<div class="set-modal">${inner}</div>`;
  document.body.appendChild(back);
  const close = ()=> back.remove();
  guardBackdropClose(back, close, ()=> false);   // 설정 창은 입력 즉시 적용이라 드래그 오작동만 막음
  back.querySelector('.set-modal-x')?.addEventListener('click', close);
  document.addEventListener('keydown', function esc(e){ if(e.key === 'Escape'){ close(); document.removeEventListener('keydown', esc); } });
  return { back, close };
}

function openPersonaModal(preset){
  const draft = Object.assign({}, preset.prefs);
  const { back, close } = _openSetModal(`
    <button class="set-modal-x" aria-label="닫기">✕</button>
    <h3>${esc(preset.name)}</h3>
    <p class="set-modal-desc">${esc(preset.desc)}</p>
    <div class="set-modal-scroll">
      <div class="pm-sec"><div class="pm-sec-t">실시간</div><div id="pmLive"></div></div>
      <div class="pm-sec"><div class="pm-sec-t">관심뉴스</div><div id="pmImp"></div></div>
      <div class="pm-kw"><b>키워드 전략</b><br>${esc(preset.kw)}</div>
    </div>
    <div class="set-modal-foot">
      <button class="set-btn ghost" id="pmCancel">닫기</button>
      <button class="set-btn primary" id="pmStart">시작할게요</button>
    </div>`);
  const winLabels = LIVE_WINDOW_STEPS.map(s=> s.label.replace(/\s*내$/, ''));
  const dupLabels = DUP_STEPS.map(s=> s.label);
  const relLabels = RELEVANCE_STEPS.map(s=> s.label);
  const live = back.querySelector('#pmLive');
  live.appendChild(_stepControl('뉴스 표시량', winLabels, draft.liveWindowStep,    v=> draft.liveWindowStep = v));
  live.appendChild(_stepControl('유사한 기사', dupLabels, draft.liveDupStep,        v=> draft.liveDupStep = v));
  live.appendChild(_stepControl('기사 관련성', relLabels, draft.liveRelevanceStep,  v=> draft.liveRelevanceStep = v));
  live.appendChild(_scopeControl(draft.outletScope, v=> draft.outletScope = v));
  const imp = back.querySelector('#pmImp');
  imp.appendChild(_stepControl('뉴스 표시량', winLabels, draft.importantWindowStep,    v=> draft.importantWindowStep = v));
  imp.appendChild(_stepControl('유사한 기사', dupLabels, draft.importantDupStep,        v=> draft.importantDupStep = v));
  imp.appendChild(_stepControl('기사 관련성', relLabels, draft.importantRelevanceStep,  v=> draft.importantRelevanceStep = v));
  back.querySelector('#pmCancel').onclick = close;
  back.querySelector('#pmStart').onclick = ()=>{ close(); applyPrefsAndGoLive(draft); };
}

/* pref 필드 하나 → 그에 맞는 슬라이더/토글 컨트롤 (유형 모달과 동일한 컴포넌트) */
function _prefControl(field, value, onChange){
  const m = PREF_FIELD_META[field] || { group:'', name:field, kind:'' };
  const label = m.group ? `${m.group} · ${m.name}` : m.name;
  if(m.kind === 'win') return _stepControl(label, LIVE_WINDOW_STEPS.map(s=> s.label.replace(/\s*내$/, '')), value, onChange);
  if(m.kind === 'dup') return _stepControl(label, DUP_STEPS.map(s=> s.label), value, onChange);
  if(m.kind === 'rel') return _stepControl(label, RELEVANCE_STEPS.map(s=> s.label), value, onChange);
  if(m.kind === 'scope') return _scopeControl(value, onChange);
  return document.createTextNode('');
}

function openTroubleModal(fix){
  const cur = currentUiPrefs();
  const next = fix.apply(cur);
  const keys = Object.keys(next).filter(k => next[k] !== cur[k]);
  const draft = Object.assign({}, cur);
  keys.forEach(k => draft[k] = next[k]);
  const { back, close } = _openSetModal(`
    <button class="set-modal-x" aria-label="닫기">✕</button>
    <h3>${esc(fix.label)}</h3>
    <p class="set-modal-desc">${esc(fix.detail)} 추천값으로 맞춰뒀으니 필요하면 더 조정하세요.</p>
    <div class="set-modal-scroll">
      <div id="tfControls"></div>
      ${keys.length ? '' : '<p class="tf-noop">이미 조정 한계라 더 바꿀 값이 없어요.</p>'}
    </div>
    <div class="set-modal-foot">
      <button class="set-btn ghost" id="tfCancel">닫기</button>
      <button class="set-btn primary" id="tfApply"${keys.length ? '' : ' disabled'}>적용할게요</button>
    </div>`);
  const box = back.querySelector('#tfControls');
  keys.forEach(k => box.appendChild(_prefControl(k, draft[k], v => draft[k] = v)));
  back.querySelector('#tfCancel').onclick = close;
  const ap = back.querySelector('#tfApply');
  if(ap && keys.length) ap.onclick = ()=>{ close(); applyPrefsAndGoLive(draft); };
}

function applyPrefsAndGoLive(partial){
  const merged = Object.assign(currentUiPrefs(), partial);
  applyUiPrefs(merged);
  saveUiPrefs();
  if(document.getElementById('clusterSliderBar')) initClusterSlider();
  if(document.getElementById('dupSliderBar')) initDupSlider();
  if(document.getElementById('relSliderBar')) initRelevanceSlider();
  if(document.getElementById('synSliderBar')) initSynonymSlider();
  renderOutletScopeToggle();
  syncFilterPanel();
  showMode('news');
  showNewsSubtab('live');
  _settingsToast('설정을 적용했어요');
}
let _settingsToastTimer = null;
function _settingsToast(msg){
  let el = document.getElementById('settingsToast');
  if(!el){
    el = document.createElement('div');
    el.id = 'settingsToast';
    el.className = 'settings-toast';
    document.body.appendChild(el);
  }
  el.textContent = msg;
  el.classList.add('show');
  if(_settingsToastTimer) clearTimeout(_settingsToastTimer);
  _settingsToastTimer = setTimeout(()=> el.classList.remove('show'), 2200);
}

/* ======================================================================
   초기 세팅 마법사 — 4문항 → 유형 추천 + 미세 보정 → 유형 모달로 인계.
   최초 로그인(설정 손 안 댐 + wizardDone 없음) 시 자동, 설정 유형 탭 버튼으로도 재실행.
   ====================================================================== */
const WIZARD_STEPS = [
  { q: '실시간 뉴스, 주로 어떻게 쓰세요?', opts: [
    { t: '상사·지휘부의 아침 브리핑을 대신',        persona: 0 },
    { t: '속보가 터지면 바로 대응 (기자 대응 등)',   persona: 1 },
    { t: '짧게 훑고 큰 것만 파악',                   persona: 2 },
    { t: '방송·콘텐츠 아이템 찾기',                  persona: 3 },
    { t: '나중에 검색되게 일단 다 모으기',           persona: 4 },
    { t: '논란·부정 여론을 초기에 포착',             persona: 5 },
  ] },
  { q: '주로 어느 무대를 보세요?', opts: [
    { t: '전국·중앙 정치',                     override: null },
    { t: '특정 지역 (시·군·구, 도의회) 중심',   override: 6 },
  ] },
  { q: '둘 중 더 싫은 쪽은?', opts: [
    { t: '중요한 걸 놓치는 것',        tweak: 'loose' },
    { t: '같은 기사가 반복되는 것',    tweak: 'tight' },
    { t: '딱히 없음',                  tweak: null },
  ] },
  { q: '뉴스는 얼마나 자주 확인하세요?', opts: [
    { t: '하루 종일 수시로',           freq: 'often' },
    { t: '아침에 한 번, 짬날 때',      freq: 'rare' },
  ] },
];
function markWizardDone(){
  _wizardDone = true;
  try{ localStorage.setItem('jsg_wizard_done_v1', '1'); }catch(e){}
  saveUiPrefs();
}
function maybeShowSetupWizard(){
  return;   // 써니데스크: 유형 마법사는 쓰지 않는다(설정에서 유형 탭을 뺌)
  if(_wizardDone) return;
  try{ if(localStorage.getItem('jsg_wizard_done_v1') === '1'){ _wizardDone = true; return; } }catch(e){}
  const c = currentUiPrefs();
  const untouched = c.liveWindowStep === LIVE_WINDOW_DEFAULT_STEP && c.importantWindowStep === IMPORTANT_WINDOW_DEFAULT_STEP
    && c.liveDupStep === DUP_DEFAULT_STEP && c.importantDupStep === DUP_DEFAULT_STEP
    && c.liveRelevanceStep === 0 && c.importantRelevanceStep === 0 && c.outletScope === 'all';
  if(!untouched){ markWizardDone(); return; }   // 이미 설정을 만진 사용자는 안 띄움
  openSetupWizard();
}
function openSetupWizard(){
  const answers = [];
  let step = 0;
  const { back, close } = _openSetModal('<div id="wzBody"></div>');
  const bodyEl = back.querySelector('#wzBody');
  function paint(){
    if(step < WIZARD_STEPS.length){
      const s = WIZARD_STEPS[step];
      bodyEl.innerHTML = `
        <button class="set-modal-x" aria-label="닫기">✕</button>
        <div class="wz-progress">${WIZARD_STEPS.map((_,i)=>`<span class="${i===step?'on':''}${i<step?' done':''}"></span>`).join('')}</div>
        <h3>${esc(s.q)}</h3>
        <div class="wz-opts">${s.opts.map((o,i)=>`<button class="wz-opt" data-i="${i}">${esc(o.t)}</button>`).join('')}</div>
        ${step > 0 ? '<div class="set-modal-foot"><button class="set-btn ghost" id="wzBack">이전</button></div>' : ''}`;
      bodyEl.querySelector('.set-modal-x').onclick = ()=>{ markWizardDone(); close(); };
      bodyEl.querySelectorAll('.wz-opt').forEach(b=> b.onclick = ()=>{ answers[step] = s.opts[+b.dataset.i]; step++; paint(); });
      const bk = bodyEl.querySelector('#wzBack'); if(bk) bk.onclick = ()=>{ step--; paint(); };
      return;
    }
    let idx = answers[0].persona;
    if(answers[1] && answers[1].override != null) idx = answers[1].override;
    const rec = PERSONA_PRESETS[idx];
    const draft = Object.assign({}, rec.prefs);
    const tw = answers[2] && answers[2].tweak;
    if(tw === 'loose'){
      draft.liveDupStep = _CL(draft.liveDupStep - 1, _dupMax());  draft.importantDupStep = _CL(draft.importantDupStep - 1, _dupMax());
      draft.liveRelevanceStep = _CL(draft.liveRelevanceStep - 1, _relMax());  draft.importantRelevanceStep = _CL(draft.importantRelevanceStep - 1, _relMax());
    }else if(tw === 'tight'){
      draft.liveDupStep = _CL(draft.liveDupStep + 1, _dupMax());  draft.importantDupStep = _CL(draft.importantDupStep + 1, _dupMax());
    }
    if(answers[3] && answers[3].freq === 'rare') draft.liveWindowStep = _CL(draft.liveWindowStep - 1, _winMax());

    bodyEl.innerHTML = `
      <button class="set-modal-x" aria-label="닫기">✕</button>
      <div class="wz-progress">${WIZARD_STEPS.map(()=>'<span class="done"></span>').join('')}</div>
      <h3>추천 유형: ${esc(rec.name)}</h3>
      <p class="set-modal-desc">${esc(rec.desc)}</p>
      <div class="set-modal-foot">
        <button class="set-btn ghost" id="wzChoose">직접 고를게요</button>
        <button class="set-btn primary" id="wzGo">이 설정으로 시작</button>
      </div>`;
    bodyEl.querySelector('.set-modal-x').onclick = ()=>{ markWizardDone(); close(); };
    bodyEl.querySelector('#wzChoose').onclick = ()=>{ markWizardDone(); close(); showMode('settings'); showSettingsTab('persona'); };
    bodyEl.querySelector('#wzGo').onclick = ()=>{
      markWizardDone(); close();
      openPersonaModal({ name: `추천: ${rec.name}`, desc: rec.desc, kw: rec.kw, prefs: draft });
    };
  }
  paint();
}
document.getElementById('setWizardBtn')?.addEventListener('click', openSetupWizard);

/* ======================================================================
   관리자 [알고리즘] 탭 — 소스 상수 미세튜닝. 마스터 전용.
   저장: /admin_config (팀 전역). 앱 로드 시 applyAdminConfig가 상수 오버레이.
   ====================================================================== */
let ADMIN_CFG = {};
let _algoDefaults = null;
const ABBREV_REGEX_ENTRIES = [[/(?<!더불어)민주당/g, '더불어민주당']];

function snapshotAlgoDefaults(){
  const mm = (ms, per)=> Math.round(ms / per);
  return {
    collectHours: [...AUTO_COLLECT_HOURS],
    staleMin: mm(AUTO_COLLECT_STALE_MS, 60000),
    cooldownMin: mm(COOLDOWN_MS, 60000),
    poolDays: mm(NEWS_POOL_WINDOW_MS, 86400000),
    naverDisplay: NAVER_DISPLAY,
    naverBaseQueries: [...NAVER_BASE_QUERIES],
    prioritySources: [...PRIORITY_SOURCES],
    dupSteps: DUP_STEPS.map(s => ({ label: s.label, title: s.title, floor: s.floor, body: s.body })),
    dupTimeWindowH: mm(TITLE_DUP_TIME_WINDOW_MS, 3600000),
    bodyMinWords: BODY_MIN_WORDS,
    relevanceMins: RELEVANCE_STEPS.map(s => s.min),
    relevanceUseBody: RELEVANCE_USE_BODY,
    windowStepsH: LIVE_WINDOW_STEPS.map(s => s.hours),
    clusterCap: CLUSTER_CAP, singleCap: SINGLE_CAP, keywordRelatedCap: KEYWORD_RELATED_CAP, loadMoreStep: LOAD_MORE_STEP,
    priorityTagBonusMin: mm(PRIORITY_TAG_BONUS_MS, 60000),
    clusterTagBonus: CLUSTER_TAG_BONUS,
    liveKeywordBonusMin: mm(LIVE_KEYWORD_BONUS_MS, 60000),
    readExpireH: mm(READ_EXPIRE_MS, 3600000),
    readSimilarHideH: mm(READ_SIMILAR_HIDE_MS, 3600000),
    ytPerChannel: YT_PER_CHANNEL, ytShortMaxSec: YT_SHORT_MAX_SEC,
    filterOn: { ...FILTER_ON },
    filterWords: {
      prRelease: [...PR_EXCLUDE_KEYWORDS], protocol: [...PROTOCOL_EXCLUDE_KEYWORDS], weather: [...WEATHER_EXCLUDE_KEYWORDS],
      localGovCouncil: [...LOCAL_COUNCIL_KEYWORDS], kids: [...KIDS_KEYWORDS], sports: [...SPORTS_KEYWORDS], religion: [...RELIGION_KEYWORDS],
      entertainment: [...ENTERTAINMENT_KEYWORDS], finance: [...FINANCE_KEYWORDS], housingEdu: [...HOUSING_EDU_KEYWORDS],
      progressiveOpinionOutlets: [...PROGRESSIVE_OPINION_OUTLETS], productPr: [...PRODUCT_PR_KEYWORDS],
      simpleAccident: [...SIMPLE_ACCIDENT_KEYWORDS], obituary: [...OBITUARY_KEYWORDS],
      lifeInfoAlways: [...LIFE_INFO_ALWAYS], healthTip: [...HEALTH_TIP_KEYWORDS],
    },
    abbrev: ABBREV_NORMALIZE_MAP.filter(p => typeof p[0] === 'string').map(p => [p[0], p[1]]),
    josa: [...JOSA_SUFFIXES],
    trackingParams: [...TRACKING_PARAMS],
  };
}
function _aNum(v, d){ return (typeof v === 'number' && isFinite(v)) ? v : d; }
function _aNumArr(v, d){ return (Array.isArray(v) && v.length && v.every(x => typeof x === 'number' && isFinite(x))) ? v.slice() : d.slice(); }
function _aStrArr(v, d){ return Array.isArray(v) ? v.map(x => String(x).trim()).filter(Boolean) : d.slice(); }

function applyAdminConfig(cfg){
  if(!_algoDefaults) _algoDefaults = snapshotAlgoDefaults();
  const D = _algoDefaults;
  cfg = (cfg && typeof cfg === 'object') ? cfg : {};
  ADMIN_CFG = cfg;

  AUTO_COLLECT_HOURS    = _aNumArr(cfg.collectHours, D.collectHours).filter(h => h >= 0 && h <= 23);
  AUTO_COLLECT_STALE_MS = _aNum(cfg.staleMin, D.staleMin) * 60000;
  COOLDOWN_MS           = _aNum(cfg.cooldownMin, D.cooldownMin) * 60000;
  NEWS_POOL_WINDOW_MS   = _aNum(cfg.poolDays, D.poolDays) * 86400000;
  NAVER_DISPLAY         = _aNum(cfg.naverDisplay, D.naverDisplay);
  NAVER_BASE_QUERIES    = _aStrArr(cfg.naverBaseQueries, D.naverBaseQueries);
  PRIORITY_SOURCES      = new Set(_aStrArr(cfg.prioritySources, D.prioritySources));

  const ds = (Array.isArray(cfg.dupSteps) && cfg.dupSteps.length === 5) ? cfg.dupSteps : D.dupSteps;
  DUP_STEPS = ds.map((s, i)=>({
    label: D.dupSteps[i].label,
    title: _aNum(s && s.title, D.dupSteps[i].title),
    floor: _aNum(s && s.floor, D.dupSteps[i].floor),
    body:  _aNum(s && s.body,  D.dupSteps[i].body),
  }));
  applyDupStep(_dupStep);
  TITLE_DUP_TIME_WINDOW_MS = _aNum(cfg.dupTimeWindowH, D.dupTimeWindowH) * 3600000;
  BODY_MIN_WORDS = _aNum(cfg.bodyMinWords, D.bodyMinWords);

  const rm = Array.isArray(cfg.relevanceMins) ? cfg.relevanceMins : [];
  RELEVANCE_STEPS = RELEVANCE_STEPS.map((s, i)=>({ label: s.label, min: _aNum(rm[i], D.relevanceMins[i]) }));
  RELEVANCE_USE_BODY = (typeof cfg.relevanceUseBody === 'boolean') ? cfg.relevanceUseBody : D.relevanceUseBody;

  const wh = Array.isArray(cfg.windowStepsH) ? cfg.windowStepsH : [];
  LIVE_WINDOW_STEPS = LIVE_WINDOW_STEPS.map((s, i)=>{
    const h = _aNum(wh[i], D.windowStepsH[i]);
    return { label: `${h}시간 내`, hours: h };
  });
  LIVE_WINDOW_HOURS = LIVE_WINDOW_STEPS[_liveWindowStep].hours;
  IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[_importantWindowStep].hours;

  CLUSTER_CAP = _aNum(cfg.clusterCap, D.clusterCap);
  SINGLE_CAP = _aNum(cfg.singleCap, D.singleCap);
  KEYWORD_RELATED_CAP = _aNum(cfg.keywordRelatedCap, D.keywordRelatedCap);
  LOAD_MORE_STEP = _aNum(cfg.loadMoreStep, D.loadMoreStep);
  PRIORITY_TAG_BONUS_MS = _aNum(cfg.priorityTagBonusMin, D.priorityTagBonusMin) * 60000;
  CLUSTER_TAG_BONUS = _aNum(cfg.clusterTagBonus, D.clusterTagBonus);
  LIVE_KEYWORD_BONUS_MS = _aNum(cfg.liveKeywordBonusMin, D.liveKeywordBonusMin) * 60000;
  READ_EXPIRE_MS = _aNum(cfg.readExpireH, D.readExpireH) * 3600000;
  READ_SIMILAR_HIDE_MS = _aNum(cfg.readSimilarHideH, D.readSimilarHideH) * 3600000;
  YT_PER_CHANNEL = _aNum(cfg.ytPerChannel, D.ytPerChannel);
  YT_SHORT_MAX_SEC = _aNum(cfg.ytShortMaxSec, D.ytShortMaxSec);

  const fo = (cfg.filterOn && typeof cfg.filterOn === 'object') ? cfg.filterOn : {};
  Object.keys(FILTER_ON).forEach(k=>{ FILTER_ON[k] = (typeof fo[k] === 'boolean') ? fo[k] : D.filterOn[k]; });

  const fw = (cfg.filterWords && typeof cfg.filterWords === 'object') ? cfg.filterWords : {};
  PR_EXCLUDE_KEYWORDS        = _aStrArr(fw.prRelease, D.filterWords.prRelease);
  PROTOCOL_EXCLUDE_KEYWORDS  = _aStrArr(fw.protocol, D.filterWords.protocol);
  WEATHER_EXCLUDE_KEYWORDS   = _aStrArr(fw.weather, D.filterWords.weather);
  LOCAL_COUNCIL_KEYWORDS     = _aStrArr(fw.localGovCouncil, D.filterWords.localGovCouncil);
  KIDS_KEYWORDS              = _aStrArr(fw.kids, D.filterWords.kids);
  SPORTS_KEYWORDS            = _aStrArr(fw.sports, D.filterWords.sports);
  RELIGION_KEYWORDS          = _aStrArr(fw.religion, D.filterWords.religion);
  ENTERTAINMENT_KEYWORDS     = _aStrArr(fw.entertainment, D.filterWords.entertainment);
  FINANCE_KEYWORDS           = _aStrArr(fw.finance, D.filterWords.finance);
  HOUSING_EDU_KEYWORDS       = _aStrArr(fw.housingEdu, D.filterWords.housingEdu);
  PROGRESSIVE_OPINION_OUTLETS = new Set(_aStrArr(fw.progressiveOpinionOutlets, D.filterWords.progressiveOpinionOutlets));
  PRODUCT_PR_KEYWORDS        = _aStrArr(fw.productPr, D.filterWords.productPr);
  SIMPLE_ACCIDENT_KEYWORDS   = _aStrArr(fw.simpleAccident, D.filterWords.simpleAccident);
  OBITUARY_KEYWORDS          = _aStrArr(fw.obituary, D.filterWords.obituary);
  LIFE_INFO_ALWAYS           = _aStrArr(fw.lifeInfoAlways, D.filterWords.lifeInfoAlways);
  HEALTH_TIP_KEYWORDS        = _aStrArr(fw.healthTip, D.filterWords.healthTip);

  const ab = Array.isArray(cfg.abbrev) ? cfg.abbrev.filter(p => Array.isArray(p) && p[0] && p[1]) : D.abbrev;
  ABBREV_NORMALIZE_MAP = [...ABBREV_REGEX_ENTRIES, ...ab.map(p => [String(p[0]), String(p[1])])];
  JOSA_SUFFIXES = _aStrArr(cfg.josa, D.josa);
  TRACKING_PARAMS = _aStrArr(cfg.trackingParams, D.trackingParams);
}
async function loadAdminConfig(){
  try{
    const res = await dbFetch(`${FIREBASE_URL}/admin_config.json`);
    applyAdminConfig(await res.json());
  }catch(e){ applyAdminConfig({}); }
}
async function saveAdminConfig(cfg){
  applyAdminConfig(cfg);
  try{
    const r = await dbFetch(`${FIREBASE_URL}/admin_config.json`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(cfg || {})
    });
    return r.ok;
  }catch(e){ return false; }
}

const ALGO_SECTIONS = [
  { t: 'A. 수집 — 언제·얼마나 긁어오나', fields: [
    { p:'collectHours', type:'intlist', label:'자동수집 고정 시각', unit:'시',
      help:'앱이 열려 있을 때 이 시각 정각에 팀 전체 뉴스 풀을 갱신합니다. 쉼표로 구분.',
      impact:'개수를 늘리면 더 자주 신선해지지만 네이버 요청이 늘어납니다.' },
    { p:'staleMin', type:'int', label:'신선도 자동수집 주기', unit:'분', min:3, max:180,
      help:'팀 풀이 이보다 낡고 앱이 열려 있으면 조용히 다시 수집합니다.',
      impact:'줄이면 실시간이 항상 최신(요청 급증) / 늘리면 요청 절약(실시간 탭이 빌 수 있음).' },
    { p:'cooldownMin', type:'int', label:'수동 갱신 최소 간격', unit:'분', min:1, max:60,
      help:'"업데이트" 버튼을 다시 누를 수 있게 되기까지의 시간.',
      impact:'짧게 하면 남용·요청 증가, 길게 하면 답답함.' },
    { p:'poolDays', type:'int', label:'기사 풀 보관 기간', unit:'일', min:1, max:14,
      help:'이보다 오래된 기사는 버립니다.',
      impact:'늘리면 검색·존안에 유리하지만 중복 판정·메모리 부하가 커집니다.' },
    { p:'naverDisplay', type:'int', label:'네이버 검색 쿼리당 건수', unit:'건', min:10, max:100,
      help:'관심뉴스 수집 시 쿼리 하나당 받아오는 최대 기사 수 (네이버 상한 100).',
      impact:'줄이면 수집이 빠르지만 놓치는 기사가 생깁니다.' },
    { p:'naverBaseQueries', type:'words', label:'네이버 기본 검색어',
      help:'관심뉴스가 등록 키워드와 별개로 항상 검색하는 쿼리. 한 줄에 하나.',
      impact:'늘리면 폭넓게 수집되지만 관련 없는 기사도 섞일 수 있습니다.' },
  ]},
  { t: 'B. 형식 잡음 필터 — 수집 시점에 버림', fields: 'FILTERS' },
  { t: 'C. 유사기사 병합', fields: [
    { p:'dupSteps', type:'dupgrid', label:'유사기사 5단계 임계값 (0~1)',
      help:'"유사한 기사" 슬라이더가 고르는 5개 프리셋. 제목=이 이상이면 곧바로 같은 기사 / 하한=이 미만이면 절대 병합 안 함 / 본문=그 사이에서 본문 유사도가 이 이상이면 병합.',
      impact:'값을 낮추면 더 공격적으로 묶여 화면 기사 수가 줄고, 높이면 거의 안 묶입니다.' },
    { p:'dupTimeWindowH', type:'int', label:'병합 시간창', unit:'시간', min:1, max:168,
      help:'발행 시각이 이보다 떨어진 두 기사는 제목이 같아도 별개로 취급합니다.',
      impact:'줄이면 며칠 이어지는 이슈가 날짜별로 쪼개집니다.' },
    { p:'bodyMinWords', type:'int', label:'본문 비교 최소 단어 수', unit:'개', min:1, max:30,
      help:'본문 단어가 이보다 적으면 본문 유사도를 0으로 봅니다(제목만으로 판정).',
      impact:'높이면 요약만 있는 기사끼리는 본문 비교를 건너뜁니다.' },
  ]},
  { t: 'D. 클러스터링·정렬', fields: [
    { p:'clusterCap', type:'int', label:'관심뉴스 클러스터 최대 개수', unit:'개', min:5, max:200,
      help:'관심뉴스 탭에 표시할 이슈 카드 상한.', impact:'늘리면 스크롤이 길어집니다.' },
    { p:'singleCap', type:'int', label:'실시간 단독 기사 최대 개수', unit:'개', min:5, max:200,
      help:'클러스터로 안 묶이는 개별 헤드라인 상한.', impact:'늘리면 개별 기사가 더 많이 노출됩니다.' },
    { p:'keywordRelatedCap', type:'int', label:'키워드 카드당 관련기사 최대', unit:'개', min:1, max:30,
      help:'관심뉴스 한 카드 안에 접히는 관련기사 수.', impact:'' },
    { p:'loadMoreStep', type:'int', label:'"더보기" 증가 단위', unit:'개', min:3, max:50,
      help:'"더보기"를 한 번 누를 때마다 추가로 보이는 기사 수.', impact:'' },
    { p:'priorityTagBonusMin', type:'int', label:'[단독]·[속보] 정렬 보너스', unit:'분', min:0, max:360,
      help:'제목에 [단독]/[속보]가 붙은 기사를 이만큼 더 최신인 것처럼 취급해 위로 올립니다.',
      impact:'0이면 태그를 무시하고 시각순대로만 정렬합니다.' },
    { p:'clusterTagBonus', type:'float', label:'클러스터 태그 가산', unit:'건', min:0, max:5, step:0.1,
      help:'관심뉴스에서 [단독]/[속보] 포함 클러스터를 관련기사 N건 더 큰 것처럼 정렬합니다.',
      impact:'0이면 순수하게 관련기사 수로만 정렬합니다.' },
    { p:'liveKeywordBonusMin', type:'int', label:'실시간 키워드 정렬 보너스', unit:'분', min:0, max:360,
      help:'실시간 키워드에 걸린 기사를 이만큼 최신으로 취급(현재는 블록 최상단 방식이라 영향 적음).', impact:'' },
  ]},
  { t: 'E. 관련성 필터', fields: [
    { p:'relevanceMins', type:'intlist', label:'관련성 3단계 최소 적중 수', unit:'개',
      help:'낮음·중간·높음 각각에서 등록 키워드가 몇 개 이상 걸려야 통과할지. 예: 0, 2, 3',
      impact:'높이면 확실히 관련된 기사만 남고, 낮추면 폭넓게 통과합니다.' },
    { p:'relevanceUseBody', type:'bool', label:'적중 판정에 본문 포함',
      help:'끄면 제목+요약문만 보고, 켜면 본문까지 봅니다.',
      impact:'켜면 더 관대하게(본문에만 언급돼도) 통과합니다.' },
  ]},
  { t: 'F. 시간창', fields: [
    { p:'windowStepsH', type:'intlist', label:'"뉴스 표시량" 5단계 시간', unit:'시간',
      help:'슬라이더 왼쪽→오른쪽 순. 예: 48, 24, 8, 3, 1',
      impact:'값을 키우면 오래된 기사까지, 줄이면 최근 것만 보입니다.' },
  ]},
  { t: 'G. 읽음·버림', fields: [
    { p:'readExpireH', type:'int', label:'읽음(=버림) 유지 기간', unit:'시간', min:1, max:720,
      help:'읽거나 버린 기사가 다시 안 뜨는 기간.', impact:'늘리면 지운 기사가 오래 안 보입니다.' },
    { p:'readSimilarHideH', type:'int', label:'읽은 기사와 유사한 기사 숨김', unit:'시간', min:0, max:720,
      help:'읽은 것과 비슷한 기사도 이 기간 숨깁니다. 0이면 유사 기사 숨김 안 함.', impact:'' },
  ]},
  { t: 'H. 유튜브', fields: [
    { p:'ytPerChannel', type:'int', label:'채널당 표시 영상 수', unit:'개', min:1, max:20,
      help:'각 채널에서 최근 몇 개까지 가져올지.', impact:'' },
    { p:'ytShortMaxSec', type:'int', label:'쇼츠 판정 길이', unit:'초', min:0, max:600,
      help:'이보다 짧은 영상은 쇼츠로 보고 제외합니다.',
      impact:'올리면 짧은 정규 영상도 걸러지고, 0이면 쇼츠도 다 표시합니다.' },
  ]},
  { t: 'I. 텍스트 정규화 · 기타', fields: [
    { p:'abbrev', type:'pairs', label:'약어 정규화',
      help:'한 줄에 "약어 → 정식표기". 예: 국힘 → 국민의힘  (민주당 규칙은 코드 고정)',
      impact:'제목·검색·중복판정 전반에 영향. 잘못 넣으면 엉뚱하게 치환됩니다.' },
    { p:'josa', type:'words', label:'조사 제거 목록',
      help:'제목 비교 전에 떼어내는 한국어 조사. 한 줄에 하나.', impact:'' },
    { p:'trackingParams', type:'words', label:'링크 추적 파라미터 제거',
      help:'기사 링크에서 지우는 쿼리 파라미터(utm_source 등). 중복 판정 정확도용.', impact:'' },
    { p:'prioritySources', type:'words', label:'우선 언론사',
      help:'클러스터 대표 기사를 고를 때 우선하는 언론사. 한 줄에 하나.', impact:'' },
  ]},
];
const ALGO_FILTER_DEFS = [
  { flag:'prRelease', words:'filterWords.prRelease', label:'보도자료·행사', ex:'업무협약·MOU·체결식·출범식·위촉' },
  { flag:'protocol', words:'filterWords.protocol', label:'의전·동정', ex:'접견·예방·환담·기념촬영·오찬' },
  { flag:'weather', words:'filterWords.weather', label:'날씨', ex:'날씨·기온·미세먼지·폭염·태풍' },
  { flag:'localGov', words:'filterWords.localGovCouncil', label:'지자체 홍보', ex:'지방의회 단어만 편집. "○○시," 시작·시장/군수 홍보문구 패턴은 코드 고정.' },
  { flag:'photo', label:'사진·화보', ex:'[포토][사진][화보] 태그 + 캡션만 있는 기사. 패턴 고정.' },
  { flag:'progressiveOpinion', words:'filterWords.progressiveOpinionOutlets', label:'진보 사설·칼럼', ex:'대상 언론사만 편집. [사설][칼럼][기고] 태그 패턴은 고정.' },
  { flag:'membership', label:'유료 멤버십', ex:'[멤버십][유료구독] 태그. 조선·중앙 한정. 패턴 고정.' },
  { flag:'productPr', words:'filterWords.productPr', label:'신제품 홍보', ex:'신제품 출시·한정판 출시·팝업스토어' },
  { flag:'simpleAccident', words:'filterWords.simpleAccident', label:'단순 사건·사고', ex:'교통사고·아파트 화재·추락사' },
  { flag:'obituary', words:'filterWords.obituary', label:'부고', ex:'모친상·부친상·빈소·발인' },
  { flag:'personnel', label:'인사 발령', ex:'리스트형 인사("N급 인사 단행"). 개각·장관 인선은 통과. 패턴 고정.' },
  { flag:'kids', words:'filterWords.kids', label:'어린이', ex:'어린이 기자·어린이신문·주니어 뉴스' },
  { flag:'sports', words:'filterWords.sports', label:'스포츠', ex:'손흥민·프로야구·월드컵·A매치·스타디움 등. 제목에 대통령·국회·의원·정당 같은 정치 단어가 함께 있으면 통과(병역특례 논란 등).' },
  { flag:'religion', words:'filterWords.religion', label:'종교', ex:'교회·목사·성당·불교·스님·예배 등. 정치 단어가 함께 있으면 통과(통일교·신천지 정치 이슈 등).' },
  { flag:'entertainment', words:'filterWords.entertainment', label:'연예', ex:'배우·가수·아이돌·드라마·예능·콘서트 등. 정치 단어(또는 검열·상영 철회·고발)가 함께 있으면 통과.' },
  { flag:'finance', words:'filterWords.finance', label:'증시·재테크', ex:'코스피·주가·환율·비트코인·ETF 등. 금융당국·정책·세제·규제 등 경제 정책 단어가 함께 있으면 통과.' },
  { flag:'housingEdu', words:'filterWords.housingEdu', label:'부동산·입시', ex:'분양·청약·전세·재건축·수능·입시·사교육 등. 정책·대책·규제·교육부·특혜 등이 함께 있으면 통과.' },
  { flag:'lifeInfo', words:'filterWords.lifeInfoAlways', words2:'filterWords.healthTip', label:'운세·생활정보', ex:'운세·타로·로또 당첨은 무조건 배제. 건강정보 팁은 보건정책 신호(의대증원 등)가 없을 때만.' },
];

function _algoPath(o, path){ return path.split('.').reduce((x, k)=> (x == null ? x : x[k]), o); }
function _algoSetPath(o, path, v){
  const ks = path.split('.'); let cur = o;
  for(let i = 0; i < ks.length - 1; i++){ cur = (cur[ks[i]] = cur[ks[i]] || {}); }
  cur[ks[ks.length - 1]] = v;
}
function _dupGridHtml(steps){
  const rows = steps.map((s, i)=>`<tr><td>${esc(s.label)}</td>
    <td><input type="number" data-dup="${i}-title" value="${s.title}" step="0.01" min="0" max="1"></td>
    <td><input type="number" data-dup="${i}-floor" value="${s.floor}" step="0.01" min="0" max="1"></td>
    <td><input type="number" data-dup="${i}-body" value="${s.body}" step="0.01" min="0" max="1"></td></tr>`).join('');
  return `<table class="dup-grid" data-dupgrid><thead><tr><th></th><th>제목</th><th>하한</th><th>본문</th></tr></thead><tbody>${rows}</tbody></table>`;
}
function _algoFieldHtml(f, cur){
  const v = _algoPath(cur, f.p);
  let ctl = '';
  if(f.type === 'int' || f.type === 'float'){
    const step = f.type === 'float' ? (f.step || 0.01) : 1;
    ctl = `<input type="number" data-path="${f.p}" data-kind="num" value="${v}" step="${step}"${f.min != null ? ` min="${f.min}"` : ''}${f.max != null ? ` max="${f.max}"` : ''}>${f.unit ? `<span class="au">${esc(f.unit)}</span>` : ''}`;
  }else if(f.type === 'bool'){
    ctl = `<label class="asw"><input type="checkbox" data-path="${f.p}" data-kind="bool"${v ? ' checked' : ''}> 사용</label>`;
  }else if(f.type === 'intlist'){
    ctl = `<input type="text" data-path="${f.p}" data-kind="numlist" value="${esc((v || []).join(', '))}">${f.unit ? `<span class="au">${esc(f.unit)}</span>` : ''}`;
  }else if(f.type === 'words'){
    ctl = `<textarea data-path="${f.p}" data-kind="lines" rows="4">${esc((v || []).join('\n'))}</textarea>`;
  }else if(f.type === 'pairs'){
    ctl = `<textarea data-path="${f.p}" data-kind="pairs" rows="4">${esc((v || []).map(p => `${p[0]} → ${p[1]}`).join('\n'))}</textarea>`;
  }else if(f.type === 'dupgrid'){
    ctl = _dupGridHtml(v || []);
  }
  return `<div class="algo-field">
    <div class="af-head"><span class="af-label">${esc(f.label)}</span><button class="af-reset" data-reset="${f.p}">기본값</button></div>
    ${f.help ? `<div class="af-help">${esc(f.help)}</div>` : ''}
    ${f.impact ? `<div class="af-impact">${esc(f.impact)}</div>` : ''}
    <div class="af-ctl">${ctl}</div>
  </div>`;
}
function _algoFilterRowHtml(fd, cur){
  const on = _algoPath(cur, 'filterOn.' + fd.flag);
  let w = '';
  if(fd.words){
    w += `<textarea data-path="${fd.words}" data-kind="lines" rows="3" placeholder="한 줄에 하나">${esc((_algoPath(cur, fd.words) || []).join('\n'))}</textarea>`;
  }
  if(fd.words2){
    w += `<div class="af-sub">건강정보 팁 (보건정책 신호 없을 때만 배제)</div><textarea data-path="${fd.words2}" data-kind="lines" rows="3">${esc((_algoPath(cur, fd.words2) || []).join('\n'))}</textarea>`;
  }
  return `<div class="algo-field">
    <div class="af-head"><label class="asw"><input type="checkbox" data-path="filterOn.${fd.flag}" data-kind="bool"${on ? ' checked' : ''}> <b>${esc(fd.label)}</b></label><button class="af-reset" data-reset="filterOn.${fd.flag}">기본값</button></div>
    <div class="af-help">${esc(fd.ex)}</div>
    ${w ? `<div class="af-ctl">${w}</div>` : ''}
  </div>`;
}
function renderAlgoPane(){
  const host = document.getElementById('algoSections');
  if(!host) return;
  const cur = snapshotAlgoDefaults();          // 현재 적용값
  const def = _algoDefaults || cur;            // 코드 기본값

  host.innerHTML = ALGO_SECTIONS.map(sec=>{
    const inner = sec.fields === 'FILTERS'
      ? ALGO_FILTER_DEFS.map(fd => _algoFilterRowHtml(fd, cur)).join('')
      : sec.fields.map(f => _algoFieldHtml(f, cur)).join('');
    return `<details class="algo-sec"><summary>${esc(sec.t)}</summary><div class="algo-sec-body">${inner}</div></details>`;
  }).join('');
  host.querySelectorAll('[data-reset]').forEach(btn => btn.onclick = ()=> _algoResetField(btn.dataset.reset, def));

  const foot = document.getElementById('algoFoot');
  if(foot){
    foot.innerHTML = `<button class="set-btn ghost" id="algoResetAll">전체 기본값으로</button><button class="set-btn primary" id="algoSave">저장 · 팀 전체 적용</button>`;
    foot.querySelector('#algoSave').onclick = _algoSaveClicked;
    foot.querySelector('#algoResetAll').onclick = async ()=>{
      if(!confirm('모든 알고리즘 값을 코드 기본값으로 되돌립니다. 팀 전체에 적용됩니다.')) return;
      const ok = await saveAdminConfig({});
      if(!ok){ alert('저장 실패 — 마스터 권한/네트워크 확인'); return; }
      renderAlgoPane(); renderAllNewsViews();
      _settingsToast('기본값으로 되돌렸어요');
    };
  }
}
function _algoResetField(path, def){
  if(path === 'dupSteps'){
    def.dupSteps.forEach((s, i)=> ['title','floor','body'].forEach(k=>{
      const inp = document.querySelector(`#setPaneAlgo [data-dup="${i}-${k}"]`);
      if(inp) inp.value = s[k];
    }));
    return;
  }
  const dv = _algoPath(def, path);
  const el = document.querySelector(`#setPaneAlgo [data-path="${path}"]`);
  if(!el || dv === undefined) return;
  const kind = el.dataset.kind;
  if(kind === 'bool') el.checked = !!dv;
  else if(kind === 'numlist') el.value = (dv || []).join(', ');
  else if(kind === 'lines') el.value = (dv || []).join('\n');
  else if(kind === 'pairs') el.value = (dv || []).map(p => `${p[0]} → ${p[1]}`).join('\n');
  else el.value = dv;
}
function _algoReadForm(){
  const cfg = {};
  document.querySelectorAll('#setPaneAlgo [data-path]').forEach(el=>{
    const path = el.dataset.path, kind = el.dataset.kind;
    let v;
    if(kind === 'num'){ v = parseFloat(el.value); if(isNaN(v)) return; }
    else if(kind === 'bool') v = el.checked;
    else if(kind === 'numlist') v = el.value.split(/[\s,]+/).map(Number).filter(n => !isNaN(n));
    else if(kind === 'lines') v = el.value.split('\n').map(s => s.trim()).filter(Boolean);
    else if(kind === 'pairs') v = el.value.split('\n').map(s=>{
      const m = s.split(/\s*(?:→|->|=>|\t)\s*/); return (m[0] && m[1]) ? [m[0].trim(), m[1].trim()] : null;
    }).filter(Boolean);
    else return;
    _algoSetPath(cfg, path, v);
  });
  const grid = document.querySelector('#setPaneAlgo [data-dupgrid]');
  if(grid){
    cfg.dupSteps = [];
    for(let r = 0; r < 5; r++){
      const g = k => parseFloat(grid.querySelector(`[data-dup="${r}-${k}"]`).value);
      cfg.dupSteps.push({ title: g('title'), floor: g('floor'), body: g('body') });
    }
  }
  return cfg;
}
async function _algoSaveClicked(){
  const cfg = _algoReadForm();
  const btn = document.getElementById('algoSave');
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
  const ok = await saveAdminConfig(cfg);
  if(btn){ btn.disabled = false; btn.textContent = '저장 · 팀 전체 적용'; }
  if(!ok){ alert('저장에 실패했어요. 마스터 권한 또는 네트워크를 확인하세요.'); return; }
  if(document.getElementById('clusterSliderBar')) initClusterSlider();
  if(document.getElementById('dupSliderBar')) initDupSlider();
  if(document.getElementById('relSliderBar')) initRelevanceSlider();
  if(document.getElementById('synSliderBar')) initSynonymSlider();
  renderAllNewsViews();
  renderAlgoPane();
  _settingsToast('저장했어요 · 팀 전체에 적용됨');
}
document.getElementById('setTabAlgo')?.addEventListener('click', ()=> showSettingsTab('algo'));
document.getElementById('setTabManage')?.addEventListener('click', ()=> showSettingsTab('manage'));
document.getElementById('setTabOutlets')?.addEventListener('click', ()=> showSettingsTab('outlets'));

document.getElementById('setTabPersona')?.addEventListener('click', ()=> showSettingsTab('persona'));
document.getElementById('setTabTrouble')?.addEventListener('click', ()=> showSettingsTab('trouble'));

