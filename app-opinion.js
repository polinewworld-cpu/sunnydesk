/* 여론 모니터링
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ==================== 여론 모니터링 (등록 카페 화이트리스트) ====================
   지역 정가가 "지역 카페 민심"을 보는 용도. 키워드로 검색하는 게 아니라, 등록한 카페의
   최근 글 목록 그 자체를 가져와 카페 단위로 보여준다.
   - Worker /cafefeed?url= : 카페 주소 → clubId·카페명 자동 해석 + 최신글(제목·게시판·조회수·댓글수·시각)
   - 관심뉴스 키워드를 체크박스로 골라 → 그 키워드가 걸리는 글은 ★ 강조/상단
   - 카페 카드 [스크랩] = 그 카페 요약 리포트
   관심뉴스 탭의 [커뮤니티+뉴스 스크랩]도 여기 등록 카페 피드를 재사용한다. */
const OPINION_PROXY = JUNGLE_CONFIG.naverProxyUrl;
const OPINION_WINDOW_STEPS = [
  { label: '48시간 내', hours: 48 },
  { label: '24시간 내', hours: 24 },
  { label: '12시간 내', hours: 12 },
  { label: '6시간 내',  hours: 6  },
];
const OPINION_WINDOW_DEFAULT_STEP = 1;
const OPINION_WINDOW_LS_KEY  = 'jsg_opinion_window_v2';
const OPINION_SORT_LS_KEY    = 'jsg_opinion_sort_v1';
const OPINION_SELKW_LS_KEY   = 'jsg_opinion_selkw_v1';
const OPINION_FAVONLY_LS_KEY = 'jsg_opinion_favonly_v1';
const OPINION_CARD_CAP  = 20;      // 카드에 보일 글 수(전체 보기 눌렀을 때)
const OPINION_DIGEST_CAP = 20;     // 리포트에 담을 글 수
const OPINION_MIN_INTERVAL = 60 * 1000;
const OPINION_AUTO_MS = 10 * 60 * 1000;

const opinionState = {
  inited:false, loading:false, lastRun:0,
  cafes:[],            // 화이트리스트 [{url, slug, name}]  (RTDB 팀 공유)
  cafesLoaded:false,
  feeds:{},            // slug → { name, cafeUrl, posts:[], error, ok }
  error:null,
  scanDone:0, scanTotal:0,
  sortMode:'recent',   // 'recent' | 'views'
  selKw:new Set(),     // 체크된 관심 키워드 라벨
  showAll:false,       // 전체 글 보기(체크 안 하면 키워드 관련 글만)
  expanded:new Set(),  // 카드별 "전체 N건 보기" 펼침
  scrapped:new Set(),  // slug
  allScrapped:false
};
let _opinionWired = false;
let _opinionScanToken = 0;
let _opinionAutoTimer = null;
let _opinionWindowStep = (function(){
  try{ const v = parseInt(localStorage.getItem(OPINION_WINDOW_LS_KEY), 10);
    return (v >= 0 && v < OPINION_WINDOW_STEPS.length) ? v : OPINION_WINDOW_DEFAULT_STEP;
  }catch(e){ return OPINION_WINDOW_DEFAULT_STEP; }
})();
try{ if(localStorage.getItem(OPINION_SORT_LS_KEY) === 'views') opinionState.sortMode = 'views'; }catch(e){}
try{ opinionState.showAll = localStorage.getItem(OPINION_FAVONLY_LS_KEY) === '1'; }catch(e){}
try{ (JSON.parse(localStorage.getItem(OPINION_SELKW_LS_KEY)) || []).forEach(l=> opinionState.selKw.add(l)); }catch(e){}

function opinionWindowHours(){ return OPINION_WINDOW_STEPS[_opinionWindowStep].hours; }
function opTs(d){ const t = Date.parse(d || ''); return isNaN(t) ? 0 : t; }
function opNum(n){ return (n == null) ? '' : Number(n).toLocaleString('ko-KR'); }

/* 관심 키워드 풀 — 지금은 관심뉴스 키워드. #4(관심뉴스 복제) 붙으면 전체 세트 합집합으로 교체 */
function opinionKeywordPool(){ return keywordsForImportantAll(); }
function opinionSelectedKeywords(){
  const pool = opinionKeywordPool();
  const sel = pool.filter(k=> opinionState.selKw.has(k.label));
  return sel.length ? sel : [];   // 아무것도 안 고르면 강조 없음
}
function opinionNormalize(s){ return String(s || '').toLowerCase().replace(/\s+/g, ''); }
function postMatchesKeywords(post, kws){
  if(!kws.length) return false;
  const hay = opinionNormalize((post.title || '') + ' ' + (post.summary || ''));
  return kws.some(k => (k.terms || [k.label]).some(t => {
    if(!t) return false;
    if(!/\s/.test(String(t).trim())) return hay.includes(opinionNormalize(t));
    return phraseMatchSquashed(hay, String(t).trim().split(/\s+/).map(opinionNormalize).filter(Boolean));   // 구절 키워드
  }));
}

function initOpinionMode(){
  if(!_opinionWired){
    _opinionWired = true;
    const rb = document.getElementById('opinionRefreshBtn');
    if(rb) rb.onclick = ()=> runOpinionScan();
    const sb = document.getElementById('opinionScrapAllBtn');
    if(sb) sb.onclick = ()=> scrapOpinionAll();
    const kb = document.getElementById('opinionKeywordBtn');
    if(kb) kb.onclick = ()=> gotoImportantKeywords();
    const sl = document.getElementById('opinionWindowSlider');
    if(sl){
      sl.max = String(OPINION_WINDOW_STEPS.length - 1);
      sl.value = String(_opinionWindowStep);
      let _winTimer = null;
      sl.oninput = ()=>{
        _opinionWindowStep = +sl.value;
        try{ localStorage.setItem(OPINION_WINDOW_LS_KEY, String(_opinionWindowStep)); }catch(e){}
        renderOpinion();
        // 기간을 넓히면 더 깊이 긁어야 한다 → 슬라이더 멈춘 뒤 재수집
        if(_winTimer) clearTimeout(_winTimer);
        _winTimer = setTimeout(()=>{ _winTimer = null; if(opinionState.cafes.length) runOpinionScan({force:true}); }, 700);
      };
    }
    const seg = document.getElementById('opinionSortSeg');
    if(seg) seg.querySelectorAll('[data-sort]').forEach(b=>{
      b.onclick = ()=>{
        opinionState.sortMode = b.dataset.sort;
        try{ localStorage.setItem(OPINION_SORT_LS_KEY, opinionState.sortMode); }catch(e){}
        renderOpinion();
      };
    });
    const fo = document.getElementById('opinionFavOnlyBtn');
    if(fo) fo.onclick = ()=>{
      opinionState.showAll = !opinionState.showAll;
      try{ localStorage.setItem(OPINION_FAVONLY_LS_KEY, opinionState.showAll ? '1' : '0'); }catch(e){}
      renderOpinion();
    };
    const ci = document.getElementById('opinionCafeInput');
    if(ci) ci.onkeydown = (e)=>{ if(e.key === 'Enter'){ addOpinionCafe(ci.value); ci.value = ''; } };
    const cab = document.getElementById('opinionCafeAddBtn');
    if(cab) cab.onclick = ()=>{ addOpinionCafe(ci ? ci.value : ''); if(ci) ci.value = ''; };
  }
  if(!opinionState.cafesLoaded) loadOpinionCafes();
  if(!opinionState.inited){ opinionState.inited = true; if(opinionState.cafesLoaded) runOpinionScan({force:true}); }
  else renderOpinion();
  startOpinionAutoRefresh();
}

function gotoImportantKeywords(){
  showMode('news');
  if(typeof showNewsSubtab === 'function') showNewsSubtab('important');
  setTimeout(()=>{
    const gear = document.getElementById('keywordGearBtn');
    const row = document.getElementById('keywordManageRow');
    if(row && getComputedStyle(row).display === 'none' && gear) gear.click();
    const target = row || gear;
    if(target && target.scrollIntoView) target.scrollIntoView({behavior:'smooth', block:'center'});
  }, 120);
}
function startOpinionAutoRefresh(){
  if(_opinionAutoTimer) return;
  _opinionAutoTimer = setInterval(()=>{
    const app = document.getElementById('opinionApp');
    if(!app || app.style.display === 'none') return;
    if(document.hidden || opinionState.loading || !opinionState.cafes.length) return;
    if(Date.now() - opinionState.lastRun < OPINION_AUTO_MS) return;
    runOpinionScan({force:true});
  }, 60 * 1000);
}

/* ---- 등록 카페 (팀 공유, RTDB /opinion_fav_cafes) ---- */
function opinionCafeSlug(u){
  const m = String(u || '').match(/cafe\.naver\.com\/(?:ca-fe\/(?:web\/)?cafes\/)?([A-Za-z0-9_-]+)/i);
  return m ? m[1] : '';
}
async function loadOpinionCafes(){
  try{
    const res = await dbFetch(FIREBASE_URL + '/opinion_fav_cafes.json');
    const data = await res.json();
    const arr = Array.isArray(data) ? data : [];
    opinionState.cafes = arr.map(x=>{
      if(!x) return null;
      // 신형 {url,slug,name}
      if(x.url || x.slug){
        const slug = x.slug || opinionCafeSlug(x.url);
        if(!slug) return null;
        return { url: x.url || ('https://cafe.naver.com/' + slug), slug, name: x.name || slug };
      }
      // 구형 {text,kind} — slug만 살릴 수 있음
      if(x.text && x.kind === 'slug'){
        return { url: 'https://cafe.naver.com/' + x.text, slug: x.text, name: x.text };
      }
      return null;
    }).filter(Boolean);
  }catch(e){ opinionState.cafes = []; }
  opinionState.cafesLoaded = true;
  if(opinionState.inited && !opinionState.loading && opinionState.cafes.length && !Object.keys(opinionState.feeds).length){
    runOpinionScan({force:true});
  } else {
    renderOpinion();
  }
}
async function saveOpinionCafes(){
  try{
    await dbFetch(FIREBASE_URL + '/opinion_fav_cafes.json', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(opinionState.cafes.map(c=> ({ url:c.url, slug:c.slug, name:c.name })))
    });
  }catch(e){ console.warn('[등록 카페 저장 실패]', e); }
}
async function addOpinionCafe(raw){
  const slug = opinionCafeSlug(raw);
  if(!slug){ _settingsToast('네이버 카페 주소를 붙여넣어 주세요 (cafe.naver.com/…)'); return; }
  if(opinionState.cafes.some(c=> c.slug === slug)){ _settingsToast('이미 등록된 카페입니다'); return; }
  const cafe = { url: 'https://cafe.naver.com/' + slug, slug, name: slug };
  opinionState.cafes.push(cafe);
  saveOpinionCafes();
  renderOpinion();
  // 바로 피드 1건 로드해서 이름·글 확보
  const feed = await fetchCafeFeed(cafe.url);
  if(feed.ok){
    cafe.name = feed.cafeName || slug;
    opinionState.feeds[slug] = feedToState(feed);
    saveOpinionCafes();
  }else{
    opinionState.feeds[slug] = { name: feed.cafeName || slug, cafeUrl: cafe.url, posts: [], ok:false, error: feed.error || '불러오기 실패' };
    if(feed.cafeName){ cafe.name = feed.cafeName; saveOpinionCafes(); }
  }
  renderOpinion();
}
function removeOpinionCafe(slug){
  opinionState.cafes = opinionState.cafes.filter(c=> c.slug !== slug);
  delete opinionState.feeds[slug];
  opinionState.scrapped.delete(slug);
  saveOpinionCafes();
  renderOpinion();
}

/* ---- 수집 ---- */
async function fetchCafeFeed(cafeUrl){
  const url = OPINION_PROXY + '/cafefeed?url=' + encodeURIComponent(cafeUrl) + '&sinceHours=' + opinionWindowHours();
  const res = await fetchWithTimeout(url, {cache:'no-store'}, 15000);
  if(!res.ok) return { ok:false, error: '프록시 응답 ' + res.status };
  return await res.json();
}
function feedToState(feed){
  return {
    name: feed.cafeName || feed.slug,
    cafeUrl: feed.cafeUrl || ('https://cafe.naver.com/' + feed.slug),
    ok: true, error: null, truncated: !!feed.truncated,
    posts: (feed.posts || []).map(p=>({
      title: p.title || '',
      link: canonicalizeLink(p.link || ''),
      board: p.board || '',
      readCount: (p.readCount == null) ? null : p.readCount,
      commentCount: (p.commentCount == null) ? null : p.commentCount,
      likeCount: (p.likeCount == null) ? null : p.likeCount,
      writer: p.writer || '',
      summary: p.summary || '',
      pubDate: p.pubDate || ''
    })).filter(p=> p.title && p.link)
  };
}

async function runOpinionScan(opts){
  opts = opts || {};
  if(opinionState.loading) return;
  if(!opinionState.cafes.length){ opinionState.error = 'no-cafe'; renderOpinion(); return; }
  if(!opts.force && opinionState.lastRun){
    const wait = OPINION_MIN_INTERVAL - (Date.now() - opinionState.lastRun);
    if(wait > 0){ _settingsToast('방금 받았어요 — ' + Math.ceil(wait/1000) + '초 뒤에 다시 눌러주세요'); return; }
  }
  const token = ++_opinionScanToken;
  opinionState.loading = true;
  opinionState.error = null;
  opinionState.scanDone = 0;
  opinionState.scanTotal = opinionState.cafes.length;
  renderOpinion();
  try{
    const list = opinionState.cafes.slice();
    const CHUNK = 3;
    for(let i=0;i<list.length;i+=CHUNK){
      if(token !== _opinionScanToken) return;
      const part = list.slice(i, i+CHUNK);
      const results = await Promise.allSettled(part.map(c=> fetchCafeFeed(c.url).then(f=> ({ c, f }))));
      results.forEach(r=>{
        if(r.status !== 'fulfilled') return;
        const { c, f } = r.value;
        if(f && f.ok){
          if(f.cafeName && f.cafeName !== c.name){ c.name = f.cafeName; }
          opinionState.feeds[c.slug] = feedToState(f);
        }else{
          opinionState.feeds[c.slug] = { name: (f && f.cafeName) || c.name, cafeUrl: c.url, posts: [], ok:false, error: (f && f.error) || '불러오기 실패' };
        }
      });
      opinionState.scanDone = Math.min(i + CHUNK, list.length);
      renderOpinion();
      if(i + CHUNK < list.length) await new Promise(r=>setTimeout(r, 200));
    }
    if(token !== _opinionScanToken) return;
    // 이름이 바뀐 게 있으면 저장
    saveOpinionCafes();
    opinionState.lastRun = Date.now();
    opinionState.scrapped = new Set();
    opinionState.allScrapped = false;
  }catch(e){
    if(token === _opinionScanToken) opinionState.error = String((e && e.message) || e);
  }finally{
    if(token === _opinionScanToken){ opinionState.loading = false; renderOpinion(); }
  }
}

/* ---- 카페별 표시 목록 ----
   기본: 체크한 키워드가 걸리는 글만. 키워드 미체크 또는 "전체 글"/카드 펼침이면 전체.
   반환: { posts(화면용), kwPosts, allWithin, kwCount, total, hasKw, showingAll } */
function opinionCafeView(slug){
  const feed = opinionState.feeds[slug];
  if(!feed || !feed.ok) return { posts:[], kwPosts:[], allWithin:[], kwCount:0, total:0, hasKw:false, showingAll:false, feed };
  const cutoff = Date.now() - opinionWindowHours() * 3600 * 1000;
  const within = feed.posts.filter(p=>{
    const t = opTs(p.pubDate);
    return !(t && t < cutoff);
  });
  const kws = opinionSelectedKeywords();
  const hasKw = kws.length > 0;
  const marked = within.map(p=> Object.assign({}, p, { _kw: hasKw && postMatchesKeywords(p, kws) }));
  const sortFn = (opinionState.sortMode === 'views')
    ? (a,b)=> (b.readCount || 0) - (a.readCount || 0)
    : (a,b)=> opTs(b.pubDate) - opTs(a.pubDate);
  const kwPosts = marked.filter(p=> p._kw).sort(sortFn);
  const allSorted = marked.slice().sort(sortFn);
  const showingAll = !hasKw || opinionState.showAll || opinionState.expanded.has(slug);
  return {
    posts: showingAll ? allSorted : kwPosts,
    kwPosts, allWithin: allSorted,
    kwCount: kwPosts.length, total: within.length,
    hasKw, showingAll, feed
  };
}

function renderOpinion(){
  const list = document.getElementById('opinionList');
  const note = document.getElementById('opinionNote');
  if(!list || !note) return;

  const rb = document.getElementById('opinionRefreshBtn');
  if(rb){
    rb.disabled = opinionState.loading || !opinionState.cafes.length;
    rb.textContent = opinionState.loading ? ('수집 ' + opinionState.scanDone + '/' + opinionState.scanTotal) : '업데이트';
  }
  const sab = document.getElementById('opinionScrapAllBtn');
  if(sab){
    sab.disabled = opinionState.loading || opinionState.allScrapped || !opinionState.cafes.length;
    sab.textContent = opinionState.allScrapped ? '✓ 스크랩됨' : '전체 스크랩';
  }
  const val = document.getElementById('opinionWindowVal');
  if(val) val.textContent = OPINION_WINDOW_STEPS[_opinionWindowStep].label;
  const seg = document.getElementById('opinionSortSeg');
  if(seg) seg.querySelectorAll('[data-sort]').forEach(b=> b.classList.toggle('on', b.dataset.sort === opinionState.sortMode));
  const fo = document.getElementById('opinionFavOnlyBtn');
  const anyKw = opinionSelectedKeywords().length > 0;
  if(fo){
    fo.hidden = !anyKw;
    fo.classList.toggle('on', opinionState.showAll);
    fo.textContent = opinionState.showAll ? '키워드 글만' : '전체 글 보기';
  }

  renderOpinionKwChips();
  renderOpinionCafeChips();

  if(!opinionState.cafes.length){
    note.innerHTML = '위 입력창에 네이버 카페 주소를 붙여넣고 <b>[등록]</b>하세요. 등록한 카페에서 <b>관심 키워드</b>가 걸리는 글을 모아 봅니다.';
    list.innerHTML = '';
    return;
  }
  if(opinionState.loading && !Object.keys(opinionState.feeds).length){
    note.textContent = '등록한 카페의 최근 글을 불러오는 중… (' + opinionState.scanDone + '/' + opinionState.scanTotal + ')';
    list.innerHTML = '<div class="opinion-empty">잠시만요…</div>';
    return;
  }

  const views = opinionState.cafes.map(c=> ({ c, v: opinionCafeView(c.slug) }));
  const totalKw = views.reduce((s,x)=> s + x.v.kwCount, 0);
  const totalRecent = views.reduce((s,x)=> s + x.v.total, 0);
  const when = opinionState.lastRun ? relTimeNews(new Date(opinionState.lastRun).toISOString()) : '';
  note.textContent = anyKw
    ? ('등록 카페 ' + opinionState.cafes.length + '곳 · 관심 키워드 관련 ' + totalKw + '건 (최근 글 ' + totalRecent + '건 중) · '
       + OPINION_WINDOW_STEPS[_opinionWindowStep].label + (when ? ' · ' + when : ''))
    : ('등록 카페 ' + opinionState.cafes.length + '곳 · 최근 글 ' + totalRecent + '건 · '
       + OPINION_WINDOW_STEPS[_opinionWindowStep].label + (when ? ' · ' + when : '')
       + ' — 위에서 관심 키워드를 체크하면 관련 글만 봅니다');

  list.innerHTML = views.map((x, i)=> opinionCafeCardHtml(x.c, i, x.v)).join('');
  list.querySelectorAll('[data-op-scrap]').forEach(btn=>{
    btn.onclick = ()=> scrapOpinionCafe(btn.dataset.opScrap, btn);
  });
  list.querySelectorAll('[data-op-expand]').forEach(btn=>{
    btn.onclick = ()=>{
      const s = btn.dataset.opExpand;
      if(opinionState.expanded.has(s)) opinionState.expanded.delete(s);
      else opinionState.expanded.add(s);
      renderOpinion();
    };
  });
  list.querySelectorAll('[data-op-retry]').forEach(btn=>{
    btn.onclick = async ()=>{
      btn.disabled = true; btn.textContent = '…';
      const c = opinionState.cafes.find(z=> z.slug === btn.dataset.opRetry);
      if(c){
        const f = await fetchCafeFeed(c.url);
        opinionState.feeds[c.slug] = f.ok ? feedToState(f)
          : { name: (f && f.cafeName) || c.name, cafeUrl: c.url, posts: [], ok:false, error: (f && f.error) || '불러오기 실패' };
      }
      renderOpinion();
    };
  });
  list.querySelectorAll('[data-op-del]').forEach(btn=>{
    btn.onclick = ()=>{ if(confirm('이 카페를 등록 목록에서 뺄까요?')) removeOpinionCafe(btn.dataset.opDel); };
  });
}

function renderOpinionKwChips(){
  const box = document.getElementById('opinionKwChips');
  if(!box) return;
  const pool = opinionKeywordPool();
  if(!pool.length){
    box.innerHTML = '<span class="op-fav-none">관심뉴스 키워드가 없습니다 → [키워드 관리]</span>';
    return;
  }
  box.innerHTML = pool.map(k=>
    '<label class="op-kw-chip' + (opinionState.selKw.has(k.label) ? ' on' : '') + '">'
    + '<input type="checkbox" data-kw="' + esc(k.label) + '"' + (opinionState.selKw.has(k.label) ? ' checked' : '') + '>'
    + esc(k.label) + '</label>').join('');
  box.querySelectorAll('[data-kw]').forEach(cb=>{
    cb.onchange = ()=>{
      if(cb.checked) opinionState.selKw.add(cb.dataset.kw);
      else opinionState.selKw.delete(cb.dataset.kw);
      try{ localStorage.setItem(OPINION_SELKW_LS_KEY, JSON.stringify([...opinionState.selKw])); }catch(e){}
      renderOpinion();
    };
  });
}
function renderOpinionCafeChips(){
  const box = document.getElementById('opinionCafeChips');
  if(!box) return;
  box.innerHTML = opinionState.cafes.map(c=>
    '<span class="op-fav-chip">' + esc(c.name) + '<span class="x" data-cafe-del="' + esc(c.slug) + '">✕</span></span>').join('');
  box.querySelectorAll('[data-cafe-del]').forEach(x=>{ x.onclick = ()=> removeOpinionCafe(x.dataset.cafeDel); });
}

function opinionPostLi(p){
  const star = p._kw ? '<span class="op-fav-star">★</span> ' : '';
  const meta = [];
  if(p.board) meta.push(esc(p.board));
  if(p.readCount != null) meta.push('조회 ' + opNum(p.readCount));
  if(p.commentCount) meta.push('댓글 ' + opNum(p.commentCount));
  if(p.pubDate) meta.push(esc(relTimeNews(p.pubDate)));
  return '<li>' + star + '<a href="' + esc(p.link) + '" target="_blank" rel="noopener">' + esc(p.title) + '</a>'
    + (meta.length ? ' <span class="op-when">' + meta.join(' · ') + '</span>' : '') + '</li>';
}
function opinionCafeCardHtml(c, i, v){
  const feed = v.feed;
  if(feed && feed.ok === false){
    return '<div class="opinion-cafe op-cafe-err">'
      + '<div class="op-head"><div class="op-cafe-name">' + esc(c.name) + '</div>'
      + '<span><button class="ghost small" data-op-retry="' + esc(c.slug) + '">다시</button> '
      + '<button class="ghost small" data-op-del="' + esc(c.slug) + '">삭제</button></span></div>'
      + '<div class="op-empty-kw">불러오기 실패: ' + esc(feed.error || '') + '</div></div>';
  }
  const posts = v.posts.slice(0, OPINION_CARD_CAP);
  const hidden = v.posts.length - posts.length;
  const done = opinionState.scrapped.has(c.slug);
  const trunc = feed && feed.truncated;

  // 헤더: 키워드 모드면 "관련 N건", 아니면 "최근 N건"
  const headCount = v.hasKw
    ? ('<b>' + v.kwCount + '건</b> <span class="op-head-sub">관련 (최근 ' + v.total + '건 중)</span>')
    : ('<b>' + v.total + '건</b> <span class="op-head-sub">최근 글</span>');

  // 본문
  let bodyHtml;
  if(!posts.length){
    bodyHtml = '<div class="op-empty-kw">'
      + (v.hasKw && !v.showingAll ? '이 기간에 관심 키워드 관련 글이 없습니다.' : '이 기간에 글이 없습니다.')
      + (v.hasKw && !v.showingAll && v.total ? ' <button class="op-inline-link" data-op-expand="' + esc(c.slug) + '">전체 ' + v.total + '건 보기</button>' : ' 기간을 넓혀보세요.')
      + '</div>';
  }else{
    bodyHtml = '<ul class="op-main">' + posts.map(opinionPostLi).join('') + '</ul>';
    if(v.hasKw && !opinionState.showAll){
      if(!v.showingAll && v.total > v.kwCount){
        bodyHtml += '<button class="op-inline-link" data-op-expand="' + esc(c.slug) + '">이 카페 전체 ' + v.total + '건 보기</button>';
      }else if(v.showingAll){
        bodyHtml += '<button class="op-inline-link" data-op-expand="' + esc(c.slug) + '">관련 글만 보기</button>';
      }
    }
    if(hidden > 0) bodyHtml += '<div class="op-more">외 ' + hidden + '건' + (trunc ? ' · 이 카페는 글이 많아 최근분만 가져왔습니다' : '') + '</div>';
  }

  return '<div class="opinion-cafe">'
    + '<div class="op-head">'
    +   '<div class="op-cafe-name"><a href="' + esc((feed && feed.cafeUrl) || c.url) + '" target="_blank" rel="noopener">' + esc(c.name) + '</a> ' + headCount + '</div>'
    +   '<button class="ghost small" data-op-scrap="' + esc(c.slug) + '"' + ((posts.length && !done) ? '' : ' disabled') + '>'
    +     (done ? '✓ 스크랩됨' : '스크랩') + '</button>'
    + '</div>'
    + bodyHtml
    + '</div>';
}

/* ---- 리포트 텍스트 ---- */
function opinionPostLine(p){
  const bits = [];
  if(p.board) bits.push(stripEmoji(p.board));
  if(p.readCount != null) bits.push('조회 ' + opNum(p.readCount));
  if(p.commentCount) bits.push('댓글 ' + opNum(p.commentCount));
  const tail = bits.length ? ' (' + bits.join(' · ') + ')' : '';
  const when = p.pubDate ? ' — ' + relTimeNews(p.pubDate) : '';
  return (p._kw ? '★ ' : '') + stripEmoji(p.title) + tail + when;
}
function buildCafeReport(name, v){
  name = stripEmoji(name);
  const win = OPINION_WINDOW_STEPS[_opinionWindowStep].label;
  // 리포트 대상: 키워드가 있으면 관련 글, 없으면 최근 글
  const src = v.hasKw ? v.kwPosts : v.allWithin;
  const lines = [];
  if(v.hasKw){
    const sel = opinionSelectedKeywords().map(k=> "'" + k.label + "'").join(',');
    lines.push('[' + name + '] ' + win + ', ' + sel + ' 관련 ' + v.kwCount + '건 (최근 글 ' + v.total + '건 중)');
  }else{
    lines.push('[' + name + '] ' + win + ' 최근 글 ' + v.total + '건');
  }
  const byViews = src.slice().sort((a,b)=> (b.readCount || 0) - (a.readCount || 0));
  if(byViews.length && byViews.some(p=> p.readCount != null)){
    lines.push('', '조회수 상위');
    byViews.slice(0, 5).forEach((p, i)=>{
      lines.push((i + 1) + '. ' + opinionPostLine(p));
      if(p.link) lines.push('   ' + p.link);
    });
  }
  lines.push('', v.hasKw ? '관련 글 전체' : '최근 글 전체');
  src.slice(0, OPINION_DIGEST_CAP).forEach(p=>{
    lines.push('· ' + opinionPostLine(p));
    if(p.link) lines.push('  ' + p.link);
  });
  if(src.length > OPINION_DIGEST_CAP) lines.push('… 외 ' + (src.length - OPINION_DIGEST_CAP) + '건');
  return lines.join('\n');
}
function linkifyNoteHtml(text){
  const t = String(text || '').trim();
  if(!t) return '';
  return t.split(/\n\s*\n+/).map(par=>{
    const safe = esc(par)
      .replace(/(https?:\/\/[^\s<]+)/g, '<a href="$1" target="_blank" rel="noopener">$1</a>')
      .replace(/\n/g, '<br>');
    return '<p>' + safe + '</p>';
  }).join('');
}

async function scrapOpinionCafe(slug, btn){
  const c = opinionState.cafes.find(z=> z.slug === slug);
  const v = opinionCafeView(slug);
  if(!c || !v.total) return;
  if(opinionState.scrapped.has(slug)){ _settingsToast('이미 스크랩했습니다'); return; }
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; }
  const body = '[여론 리포트] ' + new Date().toLocaleDateString('ko-KR') + '\n\n' + buildCafeReport(c.name, v);
  const n = v.hasKw ? v.kwCount : v.total;
  const ok = await saveOpinionScrap('[여론] ' + stripEmoji(c.name) + ' ' + (v.hasKw ? '관련 ' : '') + n + '건', body);
  if(ok) opinionState.scrapped.add(slug);
  if(btn){ btn.textContent = ok ? '✓ 스크랩됨' : '스크랩'; btn.disabled = !!ok; }
}
async function scrapOpinionAll(){
  const parts = opinionState.cafes.map(c=> ({ c, v: opinionCafeView(c.slug) })).filter(x=> x.v.total);
  if(!parts.length){ _settingsToast('먼저 [업데이트]로 카페 글을 수집하세요'); return; }
  const sab = document.getElementById('opinionScrapAllBtn');
  if(sab){ sab.disabled = true; sab.textContent = '저장 중…'; }
  const head = '[여론 모니터링] ' + new Date().toLocaleDateString('ko-KR') + ' · 카페 ' + parts.length + '곳 · '
    + OPINION_WINDOW_STEPS[_opinionWindowStep].label;
  const body = [head, ''].concat(parts.map(x=> buildCafeReport(x.c.name, x.v) + '\n')).join('\n');
  const ok = await saveOpinionScrap('[여론 모니터링] ' + new Date().toLocaleDateString('ko-KR'), body);
  opinionState.allScrapped = !!ok;
  renderOpinion();
}
async function saveOpinionScrap(title, body){
  const key = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const note = linkifyNoteHtml(body);
  const item = {
    type:'manual', title: title, link:'', source:'여론 모니터링', bodyIsFinal:true, note: note,
    pubDate: new Date().toISOString(),
    tags: [], order: nextSavedOrder(), addedAt: Date.now()
  };
  const ok = await saveSavedNewsItem(key, item);
  if(!ok){ _settingsToast('스크랩 저장 실패 — 새로고침 후 다시 시도해 주세요'); return false; }
  try{ if(typeof savedNoteOpenKeys !== 'undefined') savedNoteOpenKeys.add(key); }catch(e){}
  renderSavedNews();
  _settingsToast('스크랩에 저장했습니다');
  return true;
}

/* ---- 관심뉴스 탭 → 키워드 그룹 스크랩 (뉴스만 / 커뮤니티+뉴스) ----
   커뮤니티 = 등록된 카페들의 최근 글 중 그 키워드가 걸리는 것. */
let _importantKwArticles = {};
const _importantScrapped = new Set();

async function opinionEnsureFeeds(){
  const missing = opinionState.cafes.filter(c=> !opinionState.feeds[c.slug]);
  if(!missing.length) return;
  const results = await Promise.allSettled(missing.map(c=> fetchCafeFeed(c.url).then(f=> ({ c, f }))));
  results.forEach(r=>{
    if(r.status !== 'fulfilled') return;
    const { c, f } = r.value;
    opinionState.feeds[c.slug] = f.ok ? feedToState(f)
      : { name: (f && f.cafeName) || c.name, cafeUrl: c.url, posts: [], ok:false, error:(f && f.error) || '실패' };
  });
}
function buildNewsDigest(label, articles, total){
  const n = (typeof total === 'number') ? total : articles.length;
  const lines = ["'" + label + "' 키워드로 " + n + '건의 기사가 나왔습니다.', '', '주요 헤드라인'];
  articles.slice(0, OPINION_DIGEST_CAP).forEach(a=>{
    lines.push('· ' + a.title + (a.source ? ' (' + pressDisplayName(a.source) + ')' : '') + (a.pubDate ? ' — ' + relTimeNews(a.pubDate) : ''));
    if(a.link) lines.push('  ' + a.link);
  });
  if(articles.length > OPINION_DIGEST_CAP) lines.push('… 외 ' + (articles.length - OPINION_DIGEST_CAP) + '건');
  return lines.join('\n');
}
function buildCommunityDigestForKeyword(label, kw){
  const kws = [kw];
  const hits = [];
  opinionState.cafes.forEach(c=>{
    const feed = opinionState.feeds[c.slug];
    if(!feed || !feed.ok) return;
    feed.posts.forEach(p=>{
      if(postMatchesKeywords(p, kws)) hits.push(Object.assign({}, p, { _kw:true, _cafe:c.name }));
    });
  });
  hits.sort((a,b)=> (b.readCount || 0) - (a.readCount || 0));
  const lines = ["'" + label + "' 관련 커뮤니티 글 " + hits.length + '건 (등록 카페 ' + opinionState.cafes.length + '곳)', '', '주요 글들'];
  hits.slice(0, OPINION_DIGEST_CAP).forEach(p=>{
    lines.push('· ' + p.title + ' (' + p._cafe + (p.readCount != null ? ' · 조회 ' + opNum(p.readCount) : '') + ')'
      + (p.pubDate ? ' — ' + relTimeNews(p.pubDate) : ''));
    if(p.link) lines.push('  ' + p.link);
  });
  if(hits.length > OPINION_DIGEST_CAP) lines.push('… 외 ' + (hits.length - OPINION_DIGEST_CAP) + '건');
  return { text: lines.join('\n'), count: hits.length };
}

async function scrapImportantKeyword(label, withCommunity, btn){
  const entry = _importantKwArticles[label];
  const articles = (entry && entry.list) || [];
  const newsTotal = (entry && entry.total) || articles.length;
  if(!articles.length){ _settingsToast('스크랩할 기사가 없습니다'); return; }
  const mark = label + '|' + (withCommunity ? 'both' : 'news');
  if(_importantScrapped.has(mark)){ _settingsToast('이미 스크랩했습니다'); return; }

  const orig = btn ? btn.textContent : '';
  if(btn){ btn.disabled = true; btn.textContent = withCommunity ? '커뮤니티 수집 중…' : '저장 중…'; }
  const dateStr = new Date().toLocaleDateString('ko-KR');
  let body, title, source;

  if(withCommunity){
    if(!opinionState.cafesLoaded) await loadOpinionCafes();
    let comm = { text:'등록된 카페가 없습니다. 여론 모니터링에서 카페를 먼저 등록하세요.', count:0 };
    if(opinionState.cafes.length){
      try{ await opinionEnsureFeeds(); }catch(e){}
      const kw = opinionKeywordPool().find(k=> k.label === label) || { label, terms:[label] };
      comm = buildCommunityDigestForKeyword(label, kw);
    }
    body = '[이슈 리포트] "' + label + '" · ' + dateStr + '\n\n'
      + buildNewsDigest(label, articles, newsTotal) + '\n\n' + comm.text;
    title = '[이슈] "' + label + '" 뉴스 ' + newsTotal + ' · 커뮤니티 ' + comm.count;
    source = '이슈 리포트';
  }else{
    body = '[뉴스 리포트] "' + label + '" · ' + dateStr + '\n\n' + buildNewsDigest(label, articles, newsTotal);
    title = '[뉴스] "' + label + '" ' + newsTotal + '건';
    source = '관심뉴스';
  }

  const key = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  const note = linkifyNoteHtml(body);
  const item = {
    type:'manual', title: title, link:'', source: source, bodyIsFinal:true, note: note,
    pubDate: new Date().toISOString(),
    tags: [], order: nextSavedOrder(), addedAt: Date.now()
  };
  const ok = await saveSavedNewsItem(key, item);
  if(ok){
    _importantScrapped.add(mark);
    try{ if(typeof savedNoteOpenKeys !== 'undefined') savedNoteOpenKeys.add(key); }catch(e){}
    renderSavedNews();
    _settingsToast('스크랩에 저장했습니다');
    if(btn){ btn.textContent = '✓ 스크랩됨'; }
  }else{
    _settingsToast('스크랩 저장 실패 — 새로고침 후 다시 시도해 주세요');
    if(btn){ btn.textContent = orig; btn.disabled = false; }
  }
}

