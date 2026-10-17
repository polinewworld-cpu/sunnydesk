/* 관심뉴스 세트·키워드 관리·중요도 클러스터·스크랩 저장/불러오기
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ===== 관심뉴스 세트 (최대 5개, 계정별) =====
   관심뉴스 탭을 복제해 세트별로 독립된 키워드·필터값을 갖는다.
   키워드 scope: 'important'(1번 세트, 레거시), 'important2'~'important5', 'live'.
   scope 없는(예전) 키워드는 모든 탭에 적용(하위호환). */
const IMPORTANT_SCOPE_IDS = ['important', 'important2', 'important3', 'important4', 'important5'];
const IMPORTANT_SETS_MAX = 5;
const DEFAULT_IMPORTANT_SETS = [{ id: 'important', name: '관심뉴스' }];
newsState.importantSets = DEFAULT_IMPORTANT_SETS.slice();
newsState.activeImportantSet = 'important';
/* 세트별 필터값 저장소. _importantWindowStep 등은 "지금 활성 세트"의 값이고,
   세트 전환 시 이 저장소로 넣고/뺀다. */
let _impStepStore = {};

function importantSetName(id){
  const s = newsState.importantSets.find(x=> x.id === id);
  return s ? s.name : '관심뉴스';
}
/* 모든 관심뉴스 세트의 키워드(수집·여론·키워드탭에서 씀) */
function keywordsForImportantAll(){
  return newsState.keywords;   // 통합 이후 모든 키워드가 공통
}

async function loadImportantSets(){
  try{
    const res = await dbFetch(userPath('important_sets'));
    const d = await res.json();
    if(d && Array.isArray(d.sets) && d.sets.length){
      newsState.importantSets = d.sets
        .filter(s=> s && IMPORTANT_SCOPE_IDS.indexOf(s.id) >= 0)
        .map(s=> ({ id: s.id, name: String(s.name || importantSetName(s.id)).slice(0, 20) }));
      if(!newsState.importantSets.length) newsState.importantSets = DEFAULT_IMPORTANT_SETS.slice();
      if(!newsState.importantSets.some(s=> s.id === 'important')){
        newsState.importantSets.unshift({ id:'important', name:'관심뉴스' });
      }
    }
    if(d && d.steps && typeof d.steps === 'object') _impStepStore = d.steps;
    if(d && d.active && newsState.importantSets.some(s=> s.id === d.active)) newsState.activeImportantSet = d.active;
  }catch(e){}
}
/* loadUiPrefs·loadImportantSets가 병렬로 끝난 뒤 호출 — 활성 세트의 필터값을 변수에 얹는다.
   (1번 세트는 ui_prefs의 값이 기본, 2번~는 important_sets.steps 만 소스) */
function applyActiveImportantSteps(){
  const st = _impStepStore[newsState.activeImportantSet];
  if(!st) return;
  if(typeof st.win === 'number' && st.win >= 0 && st.win < LIVE_WINDOW_STEPS.length){
    _importantWindowStep = st.win; IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[st.win].hours;
  }
  if(typeof st.dup === 'number' && st.dup >= 0 && st.dup < DUP_STEPS.length) _importantDupStep = st.dup;
  if(typeof st.rel === 'number' && st.rel >= 0 && st.rel < RELEVANCE_STEPS.length) _importantRelevanceStep = st.rel;
  if(typeof st.syn === 'number' && st.syn >= 0 && st.syn < SYNONYM_STEPS.length) _importantSynonymStep = st.syn;
  syncActiveFilterSteps();
}
let _impSetsSaveTimer = null;
function saveImportantSets(){
  _impStepStore[newsState.activeImportantSet] = {
    win: _importantWindowStep, dup: _importantDupStep, rel: _importantRelevanceStep, syn: _importantSynonymStep
  };
  if(_impSetsSaveTimer) clearTimeout(_impSetsSaveTimer);
  _impSetsSaveTimer = setTimeout(()=>{
    _impSetsSaveTimer = null;
    dbFetch(userPath('important_sets'), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ sets: newsState.importantSets, active: newsState.activeImportantSet, steps: _impStepStore })
    }).catch(()=>{});
  }, 600);
}
/* 관심뉴스 탭에서 필터 슬라이더를 움직이면 그 세트 값으로 저장 */
function noteImportantFilterChange(){
  if(newsState.activeSubtab === 'important') saveImportantSets();
}
/* 관심뉴스 세트 전환 시 필터 슬라이더 값(창/중복/관련성)을 세트별로 스왑 저장.
   탭 이동(showNewsSubtab)과 분리해서, 설정 화면에서 세트를 추가/삭제할 때는
   현재 보고 있는 화면을 강제로 옮기지 않고도 값만 갱신할 수 있게 한다(2026-09-09). */
function _swapImportantSetSteps(id){
  if(id === newsState.activeImportantSet) return;
  _impStepStore[newsState.activeImportantSet] = {
    win: _importantWindowStep, dup: _importantDupStep, rel: _importantRelevanceStep, syn: _importantSynonymStep
  };
  newsState.activeImportantSet = id;
  const st = _impStepStore[id] || { win: IMPORTANT_WINDOW_DEFAULT_STEP, dup: DUP_DEFAULT_STEP, rel: 0, syn: 0 };
  _importantWindowStep = st.win; IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[st.win].hours;
  _importantDupStep = st.dup; _importantRelevanceStep = st.rel; _importantSynonymStep = st.syn || 0;
  try{ localStorage.setItem(IMPORTANT_WINDOW_STEP_LS_KEY, String(st.win)); }catch(e){}
  try{ localStorage.setItem(IMPORTANT_DUP_STEP_LS_KEY, String(st.dup)); }catch(e){}
  try{ localStorage.setItem(IMPORTANT_REL_STEP_LS_KEY, String(st.rel)); }catch(e){}
  try{ localStorage.setItem(IMPORTANT_SYN_STEP_LS_KEY, String(st.syn || 0)); }catch(e){}
  saveImportantSets();
}
/* 관심뉴스 세트 탭(1depth) 클릭 — 필터값 스왑 후 관심뉴스 탭을 연다.
   예전 2depth pill-switcher용 switchImportantSet()을 대체(2026-09-09). */
function selectImportantSetTab(id){
  if(!newsState.importantSets.some(s=> s.id === id)) return;
  _swapImportantSetSteps(id);
  showNewsSubtab('important');
}
function addImportantSet(){
  if(newsState.importantSets.length >= IMPORTANT_SETS_MAX){ _settingsToast('관심뉴스는 최대 ' + IMPORTANT_SETS_MAX + '개까지'); return; }
  const used = newsState.importantSets.map(s=> s.id);
  const id = IMPORTANT_SCOPE_IDS.find(x=> used.indexOf(x) < 0);
  if(!id) return;
  const n = newsState.importantSets.length + 1;
  newsState.importantSets.push({ id, name: '관심뉴스' + n });
  _impStepStore[id] = { win: IMPORTANT_WINDOW_DEFAULT_STEP, dup: DUP_DEFAULT_STEP, rel: 0 };
  saveImportantSets();
  renderImportantSetTabs();
}
function deleteImportantSet(id){
  if(id === 'important'){ _settingsToast('1번 세트는 삭제할 수 없어요'); return; }
  if(newsState.importantSets.length <= 1) return;
  // 키워드는 실시간·관심뉴스 공통(2026-09-24 통합)이라 세트를 지워도 키워드는 그대로
  if(!confirm('"' + importantSetName(id) + '" 세트를 삭제할까요?')) return;
  newsState.importantSets = newsState.importantSets.filter(s=> s.id !== id);
  delete _impStepStore[id];
  const wasActive = newsState.activeImportantSet === id;
  if(wasActive) newsState.activeImportantSet = 'important';
  saveImportantSets();
  if(wasActive && newsState.activeSubtab === 'important') showNewsSubtab('important');
  else renderImportantSetTabs();
}
/* 관심뉴스 세트를 1depth 탭으로 렌더링 — 기본 세트는 고정 버튼(subtabImportantBtn)을 재사용하고
   이름만 동기화하며, 추가 세트는 #importantSetTabsExtra에 동적 버튼으로 생성한다.
   이름변경·삭제·추가 자체는 설정 > 관리메뉴 "관심뉴스 세트 관리"에서 한다(2026-09-09). */
function renderImportantSetTabs(){
  const btn = document.getElementById('subtabImportantBtn');
  if(btn){ const nm = importantSetName('important'); btn.textContent = (nm === '관심뉴스') ? '관심' : nm; }   // 탭 이름 단순화(2026-10-04)
  const box = document.getElementById('importantSetTabsExtra');
  if(box){
    const extra = newsState.importantSets.filter(s=> s.id !== 'important');
    box.innerHTML = extra.map(s=>{
      return '<button class="subtab-btn imp-set-tab" data-imp-set="' + esc(s.id) + '">' + esc(s.name) + '</button>';
    }).join('');
    box.querySelectorAll('[data-imp-set]').forEach(b=>{
      b.onclick = ()=> selectImportantSetTab(b.dataset.impSet);
    });
  }
  syncImportantTabActive();
}
/* 관심뉴스 계열 탭(기본 + 추가 세트) 중 현재 활성 탭에만 .active 표시 */
function syncImportantTabActive(){
  const btn = document.getElementById('subtabImportantBtn');
  if(btn) btn.classList.toggle('active', newsState.activeSubtab==='important' && newsState.activeImportantSet==='important');
  document.querySelectorAll('#importantSetTabsExtra [data-imp-set]').forEach(b=>{
    b.classList.toggle('active', newsState.activeSubtab==='important' && newsState.activeImportantSet === b.dataset.impSet);
  });
}

function currentKeywordScope(){
  return newsState.activeSubtab === 'important' ? newsState.activeImportantSet : 'live';
}
function keywordsForScope(scope){
  return newsState.keywords;   // 통합 이후 모든 키워드가 실시간·관심뉴스 공통
}
/* 키워드 하나를 등록한다 — 실시간 탭 인라인 추가, 관심뉴스 관리메뉴 추가에서 공용으로 쓴다(2026-09-09). */
async function addKeywordTerms(scope, rawValue){
  const terms = String(rawValue||'').split(',').map(s=>s.trim().replace(/^#/,'')).filter(Boolean);
  if(!terms.length) return false;
  const label = terms[0];
  if(newsState.keywords.some(k=>k.label===label)){
    alert(`이미 등록된 키워드입니다: ${label}`);
    return false;
  }
  newsState.keywords.push({id:newKeywordId(), label, terms});
  await saveNewsKeywords();
  return true;
}
/* 키워드 삭제 — 지금 메모리에 있는 목록을 통째로 덮어쓰지 않고, 서버 최신값을 다시 받아
   그 안에서 지운 뒤 저장한다. 다른 탭·기기(PC/모바일 동시 사용)에 열려있던 낡은 목록이
   그 사이에 배경 저장을 타면 방금 지운 키워드가 되살아나던 문제(last-writer-wins) 방지. */
async function deleteNewsKeyword(id){
  newsState.keywords = newsState.keywords.filter(k=>k.id!==id);
  newsState.selectedKeywords.delete(id);
  let serverList = null;
  try{
    const res = await dbFetch(userPath('news_keywords'));
    const data = await res.json();
    if(Array.isArray(data)) serverList = data;
  }catch(e){}
  if(serverList){
    newsState.keywords = serverList.filter(k=> k && k.id !== id).map(normalizeKeyword);
    newsState.selectedKeywords.delete(id);
  }
  await saveNewsKeywords();
}
/* 관심뉴스 키워드 추가·수정·삭제는 실시간과 동일하게 이 화면(칩 줄)에서 그대로 한다 —
   관리메뉴로 옮긴 건 키워드가 아니라 "세트(탭)" 관리였다(2026-09-09, 사용자 정정으로 되돌림). */
/* 키워드 생성은 키워드 탭 하나로 통합(2026-09-23) — 예전엔 실시간·관심뉴스 탭에 각자
   똑같은 추가줄이 따로 떠서 "어디서 만들었는지" 헷갈렸음. 이제 이 줄은 키워드 탭에서만
   보이고(showNewsSubtab에서 표시 제어), 어느 쪽에 넣을지는 아래 스코프 선택으로 고른다.
   기존 키워드 보기·수정·삭제는 renderKeywordToggleGrid(아래 그리드)가 맡는다. */
function renderKeywordManageRow(){
  const el = document.getElementById('keywordManageRow');
  if(!el) return;
  if(newsState.activeSubtab !== 'keyword'){ el.innerHTML=''; return; }
  el.innerHTML =
      `<input class="km-input" id="newKeywordInput" placeholder="키워드 추가 (쉼표로 동의어 함께, 예: 여론조사, 지지율, 갤럽)">`
    + `<button class="km-add-btn" id="addKeywordBtn">+ 추가</button>`;
  const addFn = async ()=>{
    const input = document.getElementById('newKeywordInput');
    const ok = await addKeywordTerms(undefined, input.value);
    if(ok){ input.value=''; renderKeywordToggleGrid(); renderAllNewsViews(); }
  };
  document.getElementById('addKeywordBtn').onclick = addFn;
  document.getElementById('newKeywordInput').onkeydown = (e)=>{ if(e.key==='Enter') addFn(); };
}

/* 모달 배경(바깥) 클릭 닫기 보호 — 모든 입력 창 공통 (2026-09-28).
   ① 누르기·떼기 둘 다 배경일 때만 닫음(입력칸에서 드래그하다 바깥에서 떼도 안 닫힘)
   ② 입력값을 바꾼 상태면 배경 클릭은 무시 — 닫으려면 취소/닫기 버튼. isDirty를 넘기면 그걸로 판단,
      안 넘기면 호출 시점의 입력값 스냅샷과 비교한다(그래서 창 내용을 다 채운 뒤에 호출할 것). */
function guardBackdropClose(back, close, isDirty){
  const snap = ()=> [...back.querySelectorAll('input, textarea, select, [contenteditable="true"]')]
    .map(el=> el.isContentEditable ? el.innerHTML : ((el.type === 'checkbox' || el.type === 'radio') ? el.checked : el.value))
    .join('\u0001');
  const initial = snap();
  const dirty = isDirty || (()=> snap() !== initial);
  let downOnBack = false;
  back.addEventListener('pointerdown', (e)=>{ downOnBack = (e.target === back); });
  back.addEventListener('click', (e)=>{
    const onBack = e.target === back && downOnBack;
    downOnBack = false;
    if(onBack && !dirty()) close();
  });
}
/* 동의어 수정 — 기존 window.prompt() 대신 다른 화면(바로가기 링크 등)과 통일된 모달 UI.
   인라인 칩(데스크톱)·⚙ 모달(모바일) 양쪽에서 공통으로 씀. onSaved는 저장 후 호출할 추가 콜백(선택). */
function openKeywordEditModal(kw, onSaved){
  const back = document.createElement('div');
  back.className = 'ql-modal-back';
  back.innerHTML = `<div class="ql-modal">
      <h3>동의어 수정</h3>
      <div class="hint">쉼표로 구분해서 입력하세요. 첫 번째가 대표 이름이 됩니다.</div>
      <div class="ql-row"><input type="text" id="kwEditInput" value="${esc(kw.terms.join(', '))}"></div>
      <div class="ql-actions">
        <button class="subtab-btn" id="kwEditCancelBtn">취소</button>
        <button class="subtab-btn" id="kwEditSaveBtn">저장</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const input = back.querySelector('#kwEditInput');
  input.focus();
  input.select();

  const close = ()=> back.remove();
  const save = async ()=>{
    const terms = input.value.split(',').map(s=>s.trim()).filter(Boolean);
    if(!terms.length) return;
    kw.terms = terms; kw.label = terms[0];
    await saveNewsKeywords();
    close();
    renderKeywordManageRow();
    renderAllNewsViews();
    if(onSaved) onSaved();
  };
  back.querySelector('#kwEditCancelBtn').onclick = close;
  back.querySelector('#kwEditSaveBtn').onclick = save;
  guardBackdropClose(back, close);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') save(); });
}

/* 모바일 전용 — 인라인 칩 대신 ⚙ 버튼으로 여는 키워드 관리 모달(바로가기 링크 모달과 같은 패턴) */
function openKeywordGearModal(){
  const scope = currentKeywordScope();
  const scopeLabel = scope !== 'live' ? (importantSetName(scope) + ' 키워드') : '실시간 키워드';
  const back = document.createElement('div');
  back.className = 'ql-modal-back';

  const renderList = () => {
    const scoped = keywordsForScope(scope);
    if(scoped.length === 0) return `<div class="empty-hint">등록된 ${scopeLabel}가 없습니다.</div>`;
    return scoped.map(k=>`
      <div class="ql-row" data-kwid="${esc(k.id)}">
        <span class="km-label" style="flex:1;">#${esc(k.label)}${k.terms.length>1?` <span class="syn-count">+${k.terms.length-1}</span>`:''}</span>
        <button data-kwedit="${esc(k.id)}" title="동의어 수정">✎</button>
        <button data-kwdel="${esc(k.id)}" title="삭제">✕</button>
      </div>
    `).join('');
  };

  back.innerHTML = `<div class="ql-modal">
      <h3>${scopeLabel} 관리</h3>
      <div class="hint">${scope!=='live'?importantSetName(scope):'실시간'} 탭에서만 쓰이는 키워드입니다.</div>
      <div id="kwGearList">${renderList()}</div>
      <div class="channel-row" style="margin-top:10px;">
        <input type="text" id="kwGearNewInput" placeholder="키워드 추가 (쉼표로 동의어, 예: 여론조사, 지지율)">
        <button class="small" id="kwGearAddBtn">추가</button>
      </div>
      <div class="ql-actions">
        <button class="subtab-btn" id="kwGearCloseBtn">닫기</button>
      </div>
    </div>`;
  document.body.appendChild(back);

  function wireRows(){
    back.querySelectorAll('[data-kwedit]').forEach(btn=>{
      btn.onclick = ()=>{
        const kw = newsState.keywords.find(k=>k.id===btn.dataset.kwedit);
        if(kw) openKeywordEditModal(kw, refresh);
      };
    });
    back.querySelectorAll('[data-kwdel]').forEach(btn=>{
      btn.onclick = async ()=>{
        await deleteNewsKeyword(btn.dataset.kwdel);
        refresh();
        renderKeywordManageRow();
        renderAllNewsViews();
      };
    });
  }
  function refresh(){
    document.getElementById('kwGearList').innerHTML = renderList();
    wireRows();
  }
  wireRows();

  back.querySelector('#kwGearAddBtn').onclick = async ()=>{
    const input = document.getElementById('kwGearNewInput');
    const ok = await addKeywordTerms(scope, input.value);
    if(ok){ input.value = ''; refresh(); renderKeywordManageRow(); renderAllNewsViews(); }
  };
  const close = ()=> back.remove();
  back.querySelector('#kwGearCloseBtn').onclick = close;
  guardBackdropClose(back, close);
}

/* 관심뉴스 세트(탭) 관리 패널 — 설정 > 관리메뉴 > 사용할 메뉴 옆(2026-09-09).
   세트 이름 변경·삭제·추가를 여기서 한다. 관심뉴스 탭 상단 줄은 탭 전환 전용으로 남긴다.
   (키워드 추가는 관심뉴스 탭에 그대로 — 관리메뉴로 옮길 건 세트였다는 사용자 정정으로 대체) */
function renderImportantSetAdmin(){
  const box = document.getElementById('importantSetAdminList');
  if(!box) return;
  const sets = newsState.importantSets || [];
  box.innerHTML = sets.map(s=>{
    const isDefault = s.id === 'important';
    return `<div class="ims-row" data-set-row="${esc(s.id)}">
      <input type="text" class="ims-name-input" data-set-id="${esc(s.id)}" value="${esc(s.name)}" maxlength="20">
      ${isDefault ? '<span class="ims-badge">기본</span>' : `<button class="ims-del" data-set-del="${esc(s.id)}">삭제</button>`}
    </div>`;
  }).join('')
  + (sets.length < IMPORTANT_SETS_MAX
      ? `<button class="sc-btn" id="imsAddBtn">+ 세트 추가</button>`
      : `<span class="km-hint">세트는 최대 ${IMPORTANT_SETS_MAX}개까지 만들 수 있어요</span>`);

  box.querySelectorAll('.ims-name-input').forEach(inp=>{
    const commit = ()=>{
      const id = inp.dataset.setId;
      const s = newsState.importantSets.find(x=> x.id === id);
      if(!s) return;
      const name = inp.value.trim().slice(0, 20);
      if(!name){ inp.value = s.name; return; }
      if(name === s.name) return;
      s.name = name;
      saveImportantSets();
      renderImportantSetTabs();
    };
    inp.addEventListener('blur', commit);
    inp.addEventListener('keydown', (e)=>{ if(e.key==='Enter'){ e.preventDefault(); inp.blur(); } });
  });
  box.querySelectorAll('[data-set-del]').forEach(btn=>{
    btn.onclick = ()=>{ deleteImportantSet(btn.dataset.setDel); renderImportantSetAdmin(); };
  });
  const addBtn = document.getElementById('imsAddBtn');
  if(addBtn) addBtn.onclick = ()=>{ addImportantSet(); renderImportantSetAdmin(); };
}
document.getElementById('keywordGearBtn').onclick = openKeywordGearModal;

let LIVE_WINDOW_HOURS = LIVE_WINDOW_STEPS[_liveWindowStep].hours;           // 실시간 시간창 — 슬라이더(48/24/8/3/1h)
let IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[_importantWindowStep].hours;  // 관심뉴스 시간창 — 별도 슬라이더(기본 24h)
let CLUSTER_CAP = 40;
let SINGLE_CAP = 60;
let KEYWORD_RELATED_CAP = 7;

function articlesWithinHours(articles, hours){
  const cutoff = Date.now() - hours*60*60*1000;
  return articles.filter(a=>{
    const t = parseArticleDate(a.pubDate);
    return !isNaN(t) && t >= cutoff;
  });
}

function buildImportanceClusters(articles){
  const pool = articles
    .filter(a => !newsState.readLinks.has(a.link))
    .filter(a => !newsState.dismissedLinks.has(a.link))
    .sort((a,b)=> sortTimeValue(b) - sortTimeValue(a));

  const timeOf = new Map();
  pool.forEach(a => timeOf.set(a, parseArticleDate(a.pubDate)));

  const clusters = [];
  let activeClusters = [];
  // 단어 인덱스 — 클러스터의 기준 기사(articles[0])가 가진 단어별로 소속 클러스터를 미리 표시해둠.
  // 새 기사와 겹치는 단어가 하나도 없는 클러스터는 제목 유사도가 0이라 sameStory()를 불러도 항상
  // false이므로, 그런 클러스터는 애초에 비교 후보에서 빼도 결과가 똑같음(2026-09-01 확정, 안전한 최적화).
  const wordIndex = new Map(); // 단어 -> Set(클러스터)
  const indexCluster = c => wordSetOf(c.articles[0].title).forEach(w=>{
    if(!wordIndex.has(w)) wordIndex.set(w, new Set());
    wordIndex.get(w).add(c);
  });
  const unindexCluster = c => wordSetOf(c.articles[0].title).forEach(w=>{
    const set = wordIndex.get(w);
    if(set){ set.delete(c); if(set.size===0) wordIndex.delete(w); }
  });

  pool.forEach(a=>{
    const aTime = timeOf.get(a);
    const stillActive = [];
    activeClusters.forEach(c=>{
      const repTime = timeOf.get(c.articles[0]);
      const withinWindow = isNaN(aTime) || isNaN(repTime) || Math.abs(repTime - aTime) <= TITLE_DUP_TIME_WINDOW_MS;
      if(withinWindow) stillActive.push(c); else unindexCluster(c);
    });
    activeClusters = stillActive;

    const aWords = wordSetOf(a.title);
    let candidates;
    if(aWords.size === 0){
      candidates = activeClusters; // 제목에서 유의미한 단어를 못 뽑은 예외적인 경우만 안전하게 전체 비교
    }else{
      const candidateSet = new Set();
      aWords.forEach(w=>{ const s = wordIndex.get(w); if(s) s.forEach(c=>candidateSet.add(c)); });
      candidates = Array.from(candidateSet);
    }

    const cluster = candidates.find(c => sameStory(c.articles[0], a));
    if(cluster){
      cluster.articles.push(a);
    }else{
      const c = {articles:[a]};
      clusters.push(c);
      activeClusters.push(c);
      indexCluster(c);
    }
  });

  clusters.forEach(c=>{
    c.rep = c.articles.find(a=>PRIORITY_SOURCES.has(a.source) && a.excerpt)
      || c.articles.find(a=>PRIORITY_SOURCES.has(a.source))
      || c.articles.find(a=>a.excerpt)
      || c.articles[0];
    c.sourceSet = new Set(c.articles.map(a=>a.source));
  });

  const clusterTagBonus = c => c.articles.some(hasPriorityTag) ? CLUSTER_TAG_BONUS : 0;
  return clusters.sort((a,b)=> (b.articles.length + clusterTagBonus(b)) - (a.articles.length + clusterTagBonus(a)));
}

function wireReadButtons(root){
  root.querySelectorAll('[data-read]').forEach(btn=>{
    btn.onclick = ()=> markAsRead(btn.dataset.read);
  });
}

newsState.savedNews = {};
newsState.archived = {};
newsState.archiveFolders = [];
newsState.personalMemos = {};

function linkToSafeKey(link){
  let h = 0;
  const str = String(link||'');
  for(let i=0;i<str.length;i++){ h = ((h<<5) - h + str.charCodeAt(i)) | 0; }
  return 'k' + Math.abs(h).toString(36);
}
const SAVED_NEWS_LS_KEY = 'jsg_saved_news_v1';   // (구) 로컬 키 — seed에서만 참조

/* 스크랩 — C2부터 /users/{uid}/saved_news 가 정본. 이미지가 붙을 수 있어(D-2) 아이템별로
   따로 PUT 한다(맵 전체를 매번 쓰지 않음). 키(linkToSafeKey / m타임스탬프)는 RTDB 안전 문자열. */
async function loadSavedNews(){
  try{
    const res = await dbFetch(userPath('saved_news'));
    const data = await res.json();
    newsState.savedNews = (data && typeof data === 'object') ? data : {};
  }catch(e){ newsState.savedNews = {}; }
  // 마이그레이션 — 예전 직접입력/URL/유튜브 스크랩은 본문이 body에만 있고 note가 비어
  // 화면에 안 보였음. body → note 로 옮기고 서버에도 반영.
  // excerpt는 폐지(제목+링크+메모만 유지) — 예전에 남아있던 값이 있으면 지운다.
  Object.entries(newsState.savedNews).forEach(([key, it])=>{
    if(!it) return;
    let changed = false;
    if(it.body && !it.note){
      it.note = textToNoteHtml(it.body);
      delete it.body;
      changed = true;
    }
    if(it.excerpt !== undefined){
      delete it.excerpt;
      changed = true;
    }
    if(changed) saveSavedNewsItem(key, it);  // 백그라운드 persist
  });
}
async function saveSavedNewsItem(key, item){
  newsState.savedNews[key] = item;
  try{
    const res = await dbFetch(userPath('saved_news/' + key), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item)
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  }catch(e){ console.warn('[스크랩 저장 실패]', e); return false; }
}
async function deleteSavedNewsItem(key){
  delete newsState.savedNews[key];
  try{
    await dbFetch(userPath('saved_news/' + key), {method:'DELETE'});
  }catch(e){ console.warn('[스크랩 삭제 실패]', e); }
}

