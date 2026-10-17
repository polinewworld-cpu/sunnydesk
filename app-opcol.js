/* 사설·칼럼 탭
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ========================================================================
   사설·칼럼 탭 (2026-09-28) — 네이버 오피니언 면(사설·칼럼)을 구독제로 모아 본다. 정글2 전용.
   ・구독(사람마다): users/{uid}/opcol_subs = ["020|김순덕 칼럼", "028|사설", "020|*"(언론사 전체)]
   ・칼럼 목록(팀 공유): /opcol_catalog/{officeId} = {name, series:{안전키:{n:칼럼명, d:마지막 본 날짜}}}
     수집할 때마다 자동으로 늘어난다. 칼럼명 = 제목 앞/뒤 [말머리]의 '/' 앞부분,
     말머리 없으면 '기타 칼럼', 사설 면 글은 '사설'.
   ・데이터: naver-news-proxy /opcol(목록 중계), /oppress(언론사 목록)
   ・진보 사설·칼럼 자동배제(isProgressiveOpinion)는 이 탭엔 적용 안 함 — 구독한 건 보여준다.
   ======================================================================== */
const OPCOL_WORKER = 'https://naver-news-proxy.YOUR-ACCOUNT.workers.dev';
// 격주·3주 간격 칼럼(예: 동아 김순덕 칼럼)이 있어서 기간을 넉넉히 — 앞쪽 며칠 치를 먼저 보여주고 나머지는 이어서 채움
const OPCOL_DAYS = 30;           // 구독 목록에 모아 보는 기간 (먼저 OPCOL_FIRST_DAYS일 치)
const OPCOL_FIRST_DAYS = 7;
const OPCOL_SCAN_DAYS = 60;      // 관리에서 언론사를 펼칠 때 칼럼명을 찾는 기간 (먼저 14일 치)
const OPCOL_ETC = '기타 칼럼', OPCOL_EDITORIAL = '사설';
const opcolState = {
  subs: [], subsLoaded: false,
  press: [], pressLoaded: false,
  catalog: {}, catalogLoaded: false,
  items: [], loading: false, loadedSig: '',
  view: 'subs', filter: null,
  draft: null, search: '', expanded: new Set(), scanned: new Set(), scanning: new Set(),
};
newsState.showCounts.opcol = newsState.showCounts.opcol || 10;

function opcolSeriesOf(title, kind){
  const t = String(title || '').trim();
  const m = t.match(/^\[([^\]]+)\]/) || t.match(/\[([^\]]+)\]\s*$/);
  if(m){
    const name = m[1].split('/')[0].replace(/\s+/g, ' ').trim();
    if(name === '사설') return OPCOL_EDITORIAL;
    if(name) return name;
  }
  return kind === 'editorial' ? OPCOL_EDITORIAL : OPCOL_ETC;
}
const opcolSafeKey = (s)=> String(s).replace(/[.#$\[\]\/]/g, '_');
const opcolSubKey = (oid, series)=> oid + '|' + series;
function opcolPressName(oid){
  const p = opcolState.press.find(x=> x.officeId === oid);
  return (p && p.name) || (opcolState.catalog[oid] && opcolState.catalog[oid].name) || oid;
}
// "#동아_김순덕 칼럼" — 언론사명 끝의 일보·신문은 떼서 짧게
function opcolShortPress(name){
  const s = String(name || '').replace(/(일보|신문)$/, '');
  return s || name;
}
function opcolChipLabel(key){
  const [oid, series] = key.split('|');
  return '#' + opcolShortPress(opcolPressName(oid)) + '_' + (series === '*' ? '전체' : series);
}
function opcolDates(n){
  // KST 기준 오늘부터 n일 — YYYYMMDD
  const out = [];
  const now = Date.now() + 9 * 3600000;
  for(let i = 0; i < n; i++){
    out.push(new Date(now - i * 86400000).toISOString().slice(0, 10).replace(/-/g, ''));
  }
  return out;
}
async function opcolPool(tasks, conc){
  let i = 0;
  const run = async ()=>{ while(i < tasks.length){ const t = tasks[i++]; try{ await t(); }catch(e){} } };
  await Promise.all(Array.from({ length: Math.min(conc, tasks.length) }, run));
}

/* ---- 불러오기·저장 ---- */
async function loadOpcolSubs(){
  try{
    const d = await dbFetch(userPath('opcol_subs')).then(r=> r.json());
    opcolState.subs = Array.isArray(d) ? d.filter(x=> typeof x === 'string') : [];
  }catch(e){ opcolState.subs = []; }
  opcolState.subsLoaded = true;
}
async function saveOpcolSubs(){
  const res = await dbFetch(userPath('opcol_subs'), {
    method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(opcolState.subs)
  });
  if(!res || !res.ok) throw new Error('HTTP ' + (res && res.status));
}
async function loadOpcolCatalog(){
  try{
    const d = await dbFetch(`${FIREBASE_URL}/opcol_catalog.json`).then(r=> r.json());
    opcolState.catalog = (d && typeof d === 'object') ? d : {};
  }catch(e){ opcolState.catalog = {}; }
  opcolState.catalogLoaded = true;
}
async function loadOpcolPress(){
  if(opcolState.pressLoaded) return;
  try{
    const d = await fetch(`${OPCOL_WORKER}/oppress`).then(r=> r.json());
    if(d && Array.isArray(d.press) && d.press.length){ opcolState.press = d.press; opcolState.pressLoaded = true; }
  }catch(e){}
}
/* 새로 본 칼럼명을 팀 공유 목록에 반영 — 없던 것이거나 마지막 본 날짜가 바뀐 것만 쓴다 */
function opcolRecordCatalog(items){
  const today = opcolDates(1)[0];
  const updates = {};
  items.forEach(it=>{
    if(!it.officeId || !it.series) return;
    const cat = opcolState.catalog[it.officeId] || (opcolState.catalog[it.officeId] = { name: it.officeName, series: {} });
    if(!cat.series) cat.series = {};
    if(!cat.name && it.officeName) cat.name = it.officeName;
    const k = opcolSafeKey(it.series);
    const day = it.ts ? new Date(it.ts + 9 * 3600000).toISOString().slice(0, 10).replace(/-/g, '') : today;
    const prev = cat.series[k];
    if(prev && prev.d >= day) return;
    cat.series[k] = { n: it.series, d: day };
    (updates[it.officeId] = updates[it.officeId] || { name: cat.name, series: {} }).series[k] = cat.series[k];
  });
  Object.entries(updates).forEach(([oid, u])=>{
    dbFetch(`${FIREBASE_URL}/opcol_catalog/${oid}/series.json`, {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u.series)
    }).catch(()=>{});
    if(u.name) dbFetch(`${FIREBASE_URL}/opcol_catalog/${oid}/name.json`, {
      method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(u.name)
    }).catch(()=>{});
  });
}

/* ---- 네이버 오피니언 목록 ---- */
const _opcolPageCache = new Map();   // 세션 메모리 캐시 — 오늘자는 10분, 지난 날짜는 세션 내내
async function opcolFetchPage(kind, oid, date, page){
  const ck = [kind, oid, date, page].join(':');
  const hit = _opcolPageCache.get(ck);
  const isToday = date === opcolDates(1)[0];
  if(hit && (!isToday || Date.now() - hit.at < 600000)) return hit;
  try{
    const r = await fetch(`${OPCOL_WORKER}/opcol?kind=${kind}&officeId=${oid}&date=${date}&page=${page}`).then(x=> x.json());
    const out = { at: Date.now(), ok: !!r.ok, pageSize: r.pageSize || 18, items: r.items || [] };
    if(out.ok) _opcolPageCache.set(ck, out);
    return out;
  }catch(e){ return { ok: false, pageSize: 18, items: [] }; }
}
async function opcolFetchDay(kind, oid, date, maxPages){
  let all = [];
  for(let p = 1; p <= maxPages; p++){
    const r = await opcolFetchPage(kind, oid, date, p);
    all = all.concat(r.items.map(it=> ({ ...it, kind, series: opcolSeriesOf(it.title, kind) })));
    if(r.items.length < r.pageSize) break;
  }
  return all;
}

/* 구독한 언론사만 최근 OPCOL_DAYS일 치 수집 → 구독 조건으로 거름 */
async function loadOpcolItems(force){
  const subs = opcolState.subs;
  const sig = subs.slice().sort().join(',') + '@' + opcolDates(1)[0] + ':' + Math.floor(Date.now() / 600000);
  if(!force && opcolState.loadedSig === sig) return;
  if(opcolState.loading) return;
  opcolState.loading = true;
  renderOpcolSubs();
  const byOffice = {};
  subs.forEach(k=>{ const [oid, s] = k.split('|'); (byOffice[oid] = byOffice[oid] || new Set()).add(s); });
  const fetched = [];
  const tasksFor = (dates)=>{
    const tasks = [];
    Object.entries(byOffice).forEach(([oid, set])=>{
      const all = set.has('*');
      const needEd = all || set.has(OPCOL_EDITORIAL);
      const needCol = all || [...set].some(s=> s !== OPCOL_EDITORIAL);
      dates.forEach(d=>{
        if(needCol) tasks.push(async ()=>{ fetched.push(...await opcolFetchDay('column', oid, d, 5)); });
        if(needEd)  tasks.push(async ()=>{ fetched.push(...await opcolFetchDay('editorial', oid, d, 3)); });
      });
    });
    return tasks;
  };
  const dates = opcolDates(OPCOL_DAYS);
  await opcolPool(tasksFor(dates.slice(0, OPCOL_FIRST_DAYS)), 4);
  opcolApplyItems(fetched, subs);      // 최근 며칠 치 먼저 표시
  renderOpcolSubs();
  await opcolPool(tasksFor(dates.slice(OPCOL_FIRST_DAYS)), 4);
  opcolRecordCatalog(fetched);
  opcolApplyItems(fetched, subs);
  opcolState.loadedSig = sig;
  opcolState.loading = false;
  renderOpcolSubs();
}
function opcolApplyItems(fetched, subs){
  const subSet = new Set(subs);
  const seen = new Set();
  opcolState.items = fetched
    .filter(it=> it.link && (subSet.has(opcolSubKey(it.officeId, '*')) || subSet.has(opcolSubKey(it.officeId, it.series))))
    .filter(it=> !seen.has(it.link) && seen.add(it.link))
    .map(it=> ({
      title: it.title, link: it.link, source: it.officeName || opcolPressName(it.officeId),
      pubDate: it.ts ? new Date(it.ts).toISOString() : '', excerpt: it.excerpt,
      _ts: it.ts || 0, _sub: subSet.has(opcolSubKey(it.officeId, it.series)) ? opcolSubKey(it.officeId, it.series) : opcolSubKey(it.officeId, '*'),
    }))
    .sort((a, b)=> b._ts - a._ts);
}

/* ---- 화면 ---- */
function opcolVisibleItems(){
  return opcolState.items.filter(a=>{
    if(newsState.readLinks.has(a.link) || newsState.dismissedLinks.has(a.link)) return false;
    const key = linkToSafeKey(a.link);
    return !newsState.savedNews[key] && !newsState.archived[key];
  });
}
async function renderOpcol(){
  const panel = document.getElementById('opcolPanel');
  if(!panel) return;
  panel.querySelectorAll('[data-opview]').forEach(b=> b.classList.toggle('active', b.dataset.opview === opcolState.view));
  document.getElementById('opcolSubsView').hidden = opcolState.view !== 'subs';
  document.getElementById('opcolManageView').hidden = opcolState.view !== 'manage';
  if(!opcolState.subsLoaded) await loadOpcolSubs();
  if(opcolState.view === 'subs'){
    if(!opcolState.pressLoaded) loadOpcolPress().then(()=> renderOpcolSubs());
    if(!opcolState.catalogLoaded) loadOpcolCatalog();
    renderOpcolSubs();
    loadOpcolItems(false);
  }else{
    renderOpcolManage();
  }
}
function renderOpcolSubs(){
  const chips = document.getElementById('opcolChips');
  const list = document.getElementById('opcolList');
  if(!chips || !list || opcolState.view !== 'subs') return;
  const subs = opcolState.subs;
  if(!subs.length){
    chips.innerHTML = '';
    list.innerHTML = `<div class="empty-hint">구독 중인 사설·칼럼이 없습니다. 위 <b>관리</b>에서 언론사나 칼럼을 골라 저장하세요.</div>`;
    return;
  }
  if(opcolState.filter && !subs.includes(opcolState.filter)) opcolState.filter = null;
  const pool = opcolVisibleItems();
  const count = (k)=> pool.filter(a=> a._sub === k).length;
  chips.innerHTML = `<div class="kw-toggle-row">`
    + `<div class="kw-toggle kw-live${opcolState.filter === null ? ' checked' : ''}" data-opsub="">전체 <span class="count">${pool.length}</span></div>`
    + subs.map(k=> `<div class="kw-toggle kw-live${opcolState.filter === k ? ' checked' : ''}" data-opsub="${esc(k)}">${esc(opcolChipLabel(k))} <span class="count">${count(k)}</span></div>`).join('')
    + `</div>`;
  chips.querySelectorAll('[data-opsub]').forEach(c=>{
    c.onclick = ()=>{
      const k = c.dataset.opsub || null;
      opcolState.filter = (opcolState.filter === k) ? null : k;
      newsState.showCounts.opcol = LOAD_MORE_STEP;
      renderOpcolSubs();
    };
  });
  const shownPool = opcolState.filter ? pool.filter(a=> a._sub === opcolState.filter) : pool;
  if(!shownPool.length){
    list.innerHTML = `<div class="empty-hint">${opcolState.loading ? '사설·칼럼을 불러오는 중…' : `최근 ${OPCOL_DAYS}일 동안 올라온 글이 없습니다.`}</div>`;
    return;
  }
  const showCount = newsState.showCounts.opcol || LOAD_MORE_STEP;
  const shown = shownPool.slice(0, showCount);
  list.innerHTML = `<div class="news-grid">` + shown.map(a=> newsItemHtml(a, { metaExtra: opcolChipLabel(a._sub).slice(1) })).join('')
    + `</div>` + loadMoreButtonHtml('opcol', shown.length < shownPool.length)
    + (opcolState.loading ? `<div class="empty-hint">더 불러오는 중…</div>` : '');
  list.querySelectorAll('[data-read]').forEach(btn=>{ btn.onclick = ()=> markAsRead(btn.dataset.read); });
  wireSaveButtons(list);
  wireSwipeHandlers(list);
  wireLoadMoreButtons(list, renderOpcolSubs);
}

/* 관리 — 검색 + 탐색기(언론사 › 사설·칼럼명) + 체크 후 저장 */
function opcolSeriesList(oid){
  const cat = opcolState.catalog[oid];
  const names = cat && cat.series ? Object.values(cat.series).sort((a, b)=> (b.d || '').localeCompare(a.d || '')).map(x=> x.n) : [];
  const out = [OPCOL_EDITORIAL];
  names.forEach(n=>{ if(n !== OPCOL_EDITORIAL && n !== OPCOL_ETC && !out.includes(n)) out.push(n); });
  out.push(OPCOL_ETC);
  return out;
}
function opcolOfficeList(){
  const map = new Map();
  opcolState.press.forEach(p=> map.set(p.officeId, p.name));
  Object.entries(opcolState.catalog).forEach(([oid, c])=>{ if(!map.has(oid)) map.set(oid, (c && c.name) || oid); });
  return [...map.entries()].map(([officeId, name])=> ({ officeId, name })).sort((a, b)=> a.name.localeCompare(b.name, 'ko'));
}
async function opcolScanOffice(oid){
  if(opcolState.scanned.has(oid) || opcolState.scanning.has(oid)) return;
  opcolState.scanning.add(oid);
  renderOpcolTree();
  const found = [];
  const dates = opcolDates(OPCOL_SCAN_DAYS);
  await opcolPool(dates.slice(0, 14).map(d=> async ()=>{ found.push(...await opcolFetchDay('column', oid, d, 2)); }), 4);
  opcolRecordCatalog(found.splice(0));   // 2주 치 먼저 반영
  renderOpcolTree();
  await opcolPool(dates.slice(14).map(d=> async ()=>{ found.push(...await opcolFetchDay('column', oid, d, 2)); }), 6);
  opcolRecordCatalog(found);
  opcolState.scanning.delete(oid);
  opcolState.scanned.add(oid);
  renderOpcolTree();
}
async function renderOpcolManage(){
  const root = document.getElementById('opcolManageView');
  if(!root) return;
  if(!opcolState.draft) opcolState.draft = new Set(opcolState.subs);
  if(!root.dataset.built){
    root.dataset.built = '1';
    root.innerHTML = `<div class="opcol-manage-bar">
        <input class="km-input" id="opcolSearch" placeholder="언론사·칼럼명 검색 (예: 김순덕, 동아)">
        <span class="opcol-sel-count" id="opcolSelCount"></span>
        <button class="km-add-btn" id="opcolResetBtn">되돌리기</button>
        <button class="km-add-btn opcol-save" id="opcolSaveBtn">저장</button>
      </div>
      <div class="opcol-note">언론사를 펼치면 최근 ${OPCOL_SCAN_DAYS}일 치 칼럼명을 찾아 목록에 더합니다. 언론사에 체크하면 그 언론사 사설·칼럼 전체를 구독합니다.</div>
      <div class="opcol-tree" id="opcolTree"><div class="empty-hint">언론사 목록을 불러오는 중…</div></div>`;
    const input = root.querySelector('#opcolSearch');
    input.oninput = ()=>{ opcolState.search = input.value.trim(); renderOpcolTree(); };
    root.querySelector('#opcolResetBtn').onclick = ()=>{ opcolState.draft = new Set(opcolState.subs); renderOpcolTree(); };
    root.querySelector('#opcolSaveBtn').onclick = async ()=>{
      const prevSubs = opcolState.subs;
      opcolState.subs = [...opcolState.draft];
      try{ await saveOpcolSubs(); }
      catch(e){ opcolState.subs = prevSubs; alert('저장에 실패했어요(로그인 만료 등). 새로고침 후 다시 시도해 주세요.'); return; }
      opcolState.loadedSig = '';
      opcolState.filter = null;
      _settingsToast('사설·칼럼 구독을 저장했어요');
      opcolState.view = 'subs';
      renderOpcol();
    };
  }
  root.querySelector('#opcolSearch').value = opcolState.search;
  renderOpcolTree();
  const tasks = [];
  if(!opcolState.pressLoaded) tasks.push(loadOpcolPress());
  if(!opcolState.catalogLoaded) tasks.push(loadOpcolCatalog());
  if(tasks.length){ await Promise.all(tasks); renderOpcolTree(); }
}
function renderOpcolTree(){
  const tree = document.getElementById('opcolTree');
  if(!tree || opcolState.view !== 'manage') return;
  const draft = opcolState.draft || new Set();
  const q = opcolState.search.replace(/\s+/g, '').toLowerCase();
  const norm = (s)=> String(s).replace(/\s+/g, '').toLowerCase();
  const offices = opcolOfficeList();
  const rows = [];
  offices.forEach(o=>{
    const series = opcolSeriesList(o.officeId);
    const officeHit = !q || norm(o.name).includes(q);
    const seriesHits = q ? series.filter(s=> norm(s).includes(q)) : [];
    if(!officeHit && !seriesHits.length) return;
    const allOn = draft.has(opcolSubKey(o.officeId, '*'));
    const picked = series.filter(s=> draft.has(opcolSubKey(o.officeId, s))).length;
    const open = opcolState.expanded.has(o.officeId) || (q && seriesHits.length > 0);
    const shownSeries = (q && !officeHit) ? seriesHits : series;
    rows.push(`<div class="opt-office${open ? ' open' : ''}" data-oid="${esc(o.officeId)}">
        <button class="opt-caret" data-toggle="${esc(o.officeId)}" aria-label="펼치기">${open ? '▾' : '▸'}</button>
        <label class="opt-label"><input type="checkbox" data-office="${esc(o.officeId)}"${allOn ? ' checked' : ''}> ${esc(o.name)}</label>
        ${(allOn || picked) ? `<span class="opt-picked">${allOn ? '전체 구독' : picked + '개 구독'}</span>` : ''}
      </div>`);
    if(open){
      rows.push(`<div class="opt-series-list">`
        + shownSeries.map(s=> `<label class="opt-series"><input type="checkbox" data-sub="${esc(opcolSubKey(o.officeId, s))}"${(allOn || draft.has(opcolSubKey(o.officeId, s))) ? ' checked' : ''}${allOn ? ' disabled' : ''}> ${esc(s)}</label>`).join('')
        + (opcolState.scanning.has(o.officeId) ? `<span class="opt-scanning">칼럼명 찾는 중…</span>` : '')
        + `</div>`);
    }
  });
  tree.innerHTML = rows.length ? rows.join('')
    : `<div class="empty-hint">${opcolState.pressLoaded || opcolState.catalogLoaded ? '검색 결과가 없습니다. 칼럼명은 한 번이라도 수집된 것만 검색됩니다 — 언론사를 펼쳐 보세요.' : '언론사 목록을 불러오는 중…'}</div>`;
  const cnt = document.getElementById('opcolSelCount');
  if(cnt) cnt.textContent = draft.size ? `${draft.size}개 선택` : '';
  tree.querySelectorAll('[data-toggle]').forEach(b=>{
    b.onclick = ()=>{
      const oid = b.dataset.toggle;
      if(opcolState.expanded.has(oid)) opcolState.expanded.delete(oid);
      else { opcolState.expanded.add(oid); opcolScanOffice(oid); }
      renderOpcolTree();
    };
  });
  tree.querySelectorAll('[data-office]').forEach(cb=>{
    cb.onchange = ()=>{
      const oid = cb.dataset.office;
      [...draft].forEach(k=>{ if(k.startsWith(oid + '|')) draft.delete(k); });   // 전체로 바꾸면 개별 선택은 정리
      if(cb.checked) draft.add(opcolSubKey(oid, '*'));
      renderOpcolTree();
    };
  });
  tree.querySelectorAll('[data-sub]').forEach(cb=>{
    cb.onchange = ()=>{
      if(cb.checked) draft.add(cb.dataset.sub); else draft.delete(cb.dataset.sub);
      renderOpcolTree();
    };
  });
}
document.querySelectorAll('#opcolPanel [data-opview]').forEach(b=>{
  b.onclick = ()=>{
    opcolState.view = b.dataset.opview;
    if(opcolState.view === 'manage') opcolState.draft = new Set(opcolState.subs);
    renderOpcol();
  };
});

