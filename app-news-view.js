/* 기사 검색·뉴스 탭 전환·스크랩/뉴스 화면
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ========================================================================
   기사 검색 — 키워드 탭 상단. 대상: 현재 풀(3일) + [네이버에서 더 찾기] + 내 스크랩·존안.
   시간창 무시(3일 전체), "유사한 기사" 슬라이더는 적용. 최신순 ↔ 관련도순.
   ======================================================================== */
newsState.searchSort = 'recent';   // 'recent' | 'relevance'
let _kwSearchDebounce = null;

function parseSearchQuery(raw){
  const q = normalizeAbbrev(String(raw||'').trim());
  const phrases = [], terms = [], excludes = [];
  q.replace(/"([^"]+)"/g, (_, p)=>{ const t = p.trim().toLowerCase(); if(t) phrases.push(t); return ' '; })
   .split(/\s+/).filter(Boolean).forEach(tok=>{
     if(tok[0] === '-' && tok.length > 1) excludes.push(tok.slice(1).toLowerCase());
     else terms.push(tok.toLowerCase());
   });
  return { phrases, terms, excludes, raw: String(raw||'').trim() };
}
function articleSearchText(a){
  return normalizeAbbrev(`${a.title||''} ${a.source||''} ${a.fullText||a.excerpt||''} ${a.note?noteToText(a.note):''}`).toLowerCase();
}
function matchesSearch(a, p){
  if(!p.terms.length && !p.phrases.length) return false;
  const txt = articleSearchText(a);
  for(const e of p.excludes) if(txt.includes(e)) return false;
  for(const t of p.terms)   if(!txt.includes(t)) return false;
  for(const ph of p.phrases) if(!txt.includes(ph)) return false;
  return true;
}
function searchScore(a, p){
  const title = normalizeAbbrev(a.title||'').toLowerCase();
  const txt = articleSearchText(a);
  let s = 0;
  [...p.terms, ...p.phrases].forEach(t=>{
    if(title.includes(t)) s += 10;
    const m = txt.split(t).length - 1;
    s += Math.min(m, 5);
  });
  return s;
}
function highlightTerms(str, p){
  let out = esc(str);
  const toks = [...p.phrases, ...p.terms].filter(t=>t.length>1)
    .sort((a,b)=>b.length-a.length).map(t=> t.replace(/[.*+?^${}()|[\]\\]/g,'\\$&'));
  if(toks.length) out = out.replace(new RegExp('('+toks.join('|')+')', 'gi'), '<mark>$1</mark>');
  return out;
}

/* 최근 검색어 — 계정 동기화 */
async function loadRecentSearches(){
  try{
    const d = await dbFetch(userPath('recent_searches')).then(r=>r.json());
    newsState.recentSearches = Array.isArray(d) ? d.filter(s=>typeof s==='string').slice(0,8) : [];
  }catch(e){ newsState.recentSearches = []; }
}
let _recentSaveTimer = null;
function saveRecentSearches(){
  if(_recentSaveTimer) clearTimeout(_recentSaveTimer);
  _recentSaveTimer = setTimeout(()=>{
    dbFetch(userPath('recent_searches'), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify((newsState.recentSearches||[]).slice(0,8))
    }).catch(()=>{});
  }, 800);
}
function pushRecentSearch(q){
  q = String(q||'').trim();
  if(!q) return;
  const list = (newsState.recentSearches || []).filter(s=> s.toLowerCase() !== q.toLowerCase());
  list.unshift(q);
  newsState.recentSearches = list.slice(0, 8);
  saveRecentSearches();
  renderRecentSearches();
}
function renderRecentSearches(){
  const row = document.getElementById('searchRecentRow');
  if(!row) return;
  const list = newsState.recentSearches || [];
  if(!list.length || globalSearchValue()){ row.innerHTML = ''; row.style.display = 'none'; return; }
  row.style.display = 'flex';
  row.innerHTML = `<span class="kw-recent-label">최근 검색</span>` + list.map(s=>`
    <span class="kw-recent-chip" data-q="${esc(s)}">${esc(s)}<button class="kw-recent-x" data-del="${esc(s)}" aria-label="삭제">✕</button></span>`).join('');
  row.querySelectorAll('.kw-recent-chip').forEach(c=>{
    c.onclick = (e)=>{
      if(e.target.closest('[data-del]')) return;
      const inp = document.getElementById('globalSearch');
      if(inp){ inp.value = c.dataset.q; runKeywordSearch(); }
    };
  });
  row.querySelectorAll('[data-del]').forEach(b=>{
    b.onclick = (e)=>{
      e.stopPropagation();
      newsState.recentSearches = (newsState.recentSearches||[]).filter(s=> s !== b.dataset.del);
      saveRecentSearches(); renderRecentSearches();
    };
  });
}

function globalSearchValue(){
  const el = document.getElementById('globalSearch');
  return el ? el.value.trim() : '';
}
/* 검색 결과는 소속 없는 별도 페이지(#searchApp) — 사이드바 메뉴에 없고 헤더 검색창으로만 진입.
   검색어를 비우거나 ✕/ESC 하면 검색 직전 화면으로 복귀. */
let _modeBeforeSearch = 'news';
function openSearchPage(){
  if(_currentMode !== 'search') _modeBeforeSearch = _currentMode || 'news';
  showMode('search');
}
function closeSearchPage(){
  const back = (_modeBeforeSearch && _modeBeforeSearch !== 'search') ? _modeBeforeSearch : 'news';
  showMode(back);
  if(back === 'news') showNewsSubtab(newsState.activeSubtab || 'live');
}
/* 헤더 검색창 입력 → 별도 검색 페이지를 열고 결과를 그린다 */
function runKeywordSearch(opts){
  opts = opts || {};
  const raw = globalSearchValue();
  const clearBtn = document.getElementById('globalSearchClear');
  if(clearBtn) clearBtn.hidden = !raw;
  syncSearchExpanded();

  if(raw && _currentMode !== 'search') openSearchPage();
  if(!raw && _currentMode !== 'search'){ renderRecentSearches(); return; }
  renderSearchResults(opts);
}
function renderSearchResults(opts){
  opts = opts || {};
  const raw = globalSearchValue();
  const box = document.getElementById('searchResults');
  if(!box) return;
  renderRecentSearches();

  if(!raw){
    box.innerHTML = `<div class="empty-hint">상단 검색창에 검색어를 입력하면 수집된 기사 전체(최근 3일)에서 찾아 드립니다.</div>`;
    return;
  }

  const p = parseSearchQuery(raw);
  const alreadyKw = newsState.keywords.some(k=> (k.label||'').toLowerCase() === raw.toLowerCase());

  // 검색 대상 = 수집된 기사 풀 전체 (3일, _via·구독·읽음 무관). 그냥 모든 곳에서 뽑아온 기사.
  let hits = (newsState.articles || []).filter(a=> matchesSearch(a, p));
  hits = dedupeSimilarTitles(hits);
  hits.sort(newsState.searchSort === 'relevance'
    ? (a,b)=> searchScore(b,p) - searchScore(a,p) || sortTimeValue(b) - sortTimeValue(a)
    : (a,b)=> sortTimeValue(b) - sortTimeValue(a));

  const head = `
    <div class="kw-search-head">
      <span class="kw-sort">
        <button class="kw-sort-opt${newsState.searchSort==='recent'?' on':''}" data-sort="recent">최신순</button>
        <button class="kw-sort-opt${newsState.searchSort==='relevance'?' on':''}" data-sort="relevance">관련도순</button>
      </span>
    </div>`;
  const foot = `
    <div class="kw-search-foot">
      ${alreadyKw ? '' : '<button class="sc-btn" id="kwSearchSave">+ 키워드로 저장</button>'}
      <button class="sc-btn" id="kwSearchNaver">네이버에서 더 찾기</button>
    </div>`;

  const cardHtml = (a)=>{
    const h = highlightTerms(a.title||'(제목 없음)', p);
    const ex = a.excerpt ? `<div class="ni-excerpt">${highlightTerms(tidyExcerpt(a.excerpt), p)}</div>` : '';
    const link = a.link ? `href="${a.link}" target="_blank" rel="noopener"` : '';
    return `<div class="news-item" data-link="${esc(a.link||'')}" data-title="${esc(a.title||'')}" data-source="${esc(a.source||'')}" data-pubdate="${esc(a.pubDate||'')}" data-excerpt="${esc(a.excerpt||'')}">
      <div class="ni-top"><a class="ni-title" ${link}>${h}</a>${a.link?actionRowHtml(a):''}</div>
      ${ex}
      <div class="ni-meta">${esc(pressDisplayName(a.source)||'')} · ${a.pubDate?relTimeNews(a.pubDate):'시간 미상'}</div>
    </div>`;
  };

  const showCount = newsState.showCounts.search || LOAD_MORE_STEP;
  const shown = hits.slice(0, showCount);
  const hasMore = shown.length < hits.length;

  let html = head;
  if(shown.length){
    html += `<div class="news-grid">${shown.map(cardHtml).join('')}</div>` + loadMoreButtonHtml('search', hasMore);
  }
  // 결과가 없으면 본문은 하얗게 비워두고, "네이버에서 더 찾기"만 아래에 조용히
  html += foot;
  box.innerHTML = html;

  box.querySelectorAll('.kw-sort-opt').forEach(b=> b.onclick = ()=>{ newsState.searchSort = b.dataset.sort; runKeywordSearch(); });
  box.querySelectorAll('[data-read]').forEach(btn=> btn.onclick = ()=> markAsRead(btn.dataset.read));
  wireSaveButtons(box);
  wireLoadMoreButtons(box, ()=>renderSearchResults(opts));
  const nb = box.querySelector('#kwSearchNaver'); if(nb) nb.onclick = keywordSearchNaver;
  const sb = box.querySelector('#kwSearchSave');
  if(sb) sb.onclick = async ()=>{
    if(newsState.keywords.some(k=> (k.label||'').toLowerCase() === raw.toLowerCase())) return;
    newsState.keywords.push({ id: newKeywordId(), label: raw, terms: [raw], scope: 'important' });
    await saveNewsKeywords();
    renderKeywordManageRow();
    renderKeywordToggleGrid();
    runKeywordSearch({remember:false});
  };

  if(opts.remember !== false) pushRecentSearch(raw);
}

async function keywordSearchNaver(){
  const raw = globalSearchValue();
  const btn = document.querySelector('#searchResults #kwSearchNaver');
  if(!raw || !btn) return;
  btn.disabled = true; btn.textContent = '네이버 검색 중…';
  try{
    const items = await fetchNaverNews(raw);
    const byLink = new Map(newsState.articles.map(a=>[a.link, a]));
    let added = 0;
    (items||[]).forEach(a=>{
      if(a && a.link && !byLink.has(a.link)){ byLink.set(a.link, {...a, _via:'search', collectedAt: Date.now()}); added++; }
    });
    if(added){ newsState.articles = Array.from(byLink.values()); saveArticleCacheLocal(true); }
    runKeywordSearch({remember:false});
    const nb2 = document.querySelector('#searchResults #kwSearchNaver');
    if(nb2){ nb2.textContent = added ? `네이버 +${added}건` : '네이버 결과 없음'; nb2.disabled = true;
      setTimeout(()=>{ nb2.textContent = '네이버에서 더 찾기'; nb2.disabled = false; }, 2500); }
  }catch(e){
    btn.textContent = '네이버 검색 실패';
    setTimeout(()=>{ btn.textContent = '네이버에서 더 찾기'; btn.disabled = false; }, 2500);
  }
}

function initKeywordSearch(){
  const inp = document.getElementById('globalSearch');
  if(!inp || inp.dataset.wired) return;
  inp.dataset.wired = '1';
  inp.addEventListener('input', ()=>{
    newsState.showCounts.search = LOAD_MORE_STEP;
    if(_kwSearchDebounce) clearTimeout(_kwSearchDebounce);
    _kwSearchDebounce = setTimeout(()=> runKeywordSearch({fromInput:true, remember:false}), 320);
  });
  inp.addEventListener('keydown', e=>{
    if(e.key === 'Enter'){ if(_kwSearchDebounce) clearTimeout(_kwSearchDebounce); runKeywordSearch({fromInput:true}); }
    if(e.key === 'Escape'){ inp.value = ''; if(_currentMode === 'search') closeSearchPage(); inp.blur(); syncSearchExpanded(); }
  });
  inp.addEventListener('blur', ()=>{ if(globalSearchValue()) pushRecentSearch(globalSearchValue()); syncSearchExpanded(); });
  inp.addEventListener('focus', syncSearchExpanded);
  // 접힌 동그란 버튼 상태에서도 아무 곳이나 누르면 입력창으로 포커스 (input이 투명해 클릭이 안 닿을 수 있음)
  document.getElementById('gbSearch').addEventListener('click', e=>{ if(e.target.id !== 'globalSearchClear') inp.focus(); });
  document.getElementById('globalSearchClear').onclick = ()=>{
    inp.value = '';
    if(_currentMode === 'search') closeSearchPage(); else runKeywordSearch();
    syncSearchExpanded();
  };
}
/* 모바일: 검색창에 포커스 있거나 입력값 있으면 헤더에서 로고·업데이트·⋮ 접고 검색창 확장 */
function syncSearchExpanded(){
  const bar = document.querySelector('.google-bar');
  const inp = document.getElementById('globalSearch');
  if(!bar || !inp) return;
  const on = (document.activeElement === inp) || !!inp.value.trim();
  bar.classList.toggle('searching', on);
}

let savedNoteOpenKeys = new Set();

/* 스크랩 정렬 — 등록 역순(최근 스크랩이 맨 위). order 내림차순으로 표시.
   드래그·▲▼ 는 표시 순서대로 order를 (n-1..0)로 재부여한다. */
function savedSortKey(item){
  if(typeof item.order === 'number') return item.order;
  // order 없는 레거시 아이템은 order 트래킹 이전 것 → 항상 맨 아래로 보내되, 그중에선 최신이 위
  return (item.addedAt || safeArticleTime(item.pubDate) || 0) - 1e15;
}
function nextSavedOrder(){
  const nums = Object.values(newsState.savedNews).map(i=> typeof i.order==='number' ? i.order : null).filter(n=>n!==null);
  return (nums.length ? Math.max(...nums) : 0) + 1; // 새 스크랩은 가장 큰 order → 맨 위
}
function sortedSavedEntries(){
  return Object.entries(newsState.savedNews).sort((a,b)=> savedSortKey(b[1]) - savedSortKey(a[1]));
}

/* 메모 HTML에서 3줄 미리보기용 순수 텍스트 추출 */
function noteToText(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html || '';
  return (tmp.textContent || '').replace(/\n{2,}/g,'\n').trim();
}
/* 순수 텍스트 → 메모 에디터용 HTML (문단 <p>, 줄바꿈 <br>) */
function textToNoteHtml(text){
  const t = String(text || '').trim();
  if(!t) return '';
  return t.split(/\n\s*\n+/).map(p => '<p>' + esc(p).replace(/\n/g, '<br>') + '</p>').join('');
}
/* 펼쳐진 메모 에디터의 현재 내용을 아이템에 반영 + 저장. 재렌더 전에 반드시 호출. */
function flushOpenNoteEditors(){
  document.querySelectorAll('.saved-card.open .sc-note-rich').forEach(rich=>{
    const card = rich.closest('.saved-card');
    const key = card && card.dataset.key;
    const it = key && newsState.savedNews[key];
    if(it && it.note !== rich.innerHTML){
      it.note = rich.innerHTML;
      saveSavedNewsItem(key, it);
    }
  });
  document.querySelectorAll('.archive-card.open .sc-note-rich').forEach(rich=>{
    const card = rich.closest('.archive-card');
    const key = card && card.dataset.key;
    const it = key && newsState.archived[key];
    if(it && it.note !== rich.innerHTML){ it.note = rich.innerHTML; persistArchive(); }
  });
}

/* 리치 메모 에디터 HTML (스크랩·존안 공통) */
function richNoteEditorHtml(key, noteHtml){
  return `
    <div class="sc-note-edit">
      <div class="sc-toolbar">
        <button class="sc-tb" data-cmd="block" data-val="h3" title="제목">제목</button>
        <button class="sc-tb" data-cmd="block" data-val="h4" title="소제목">소제목</button>
        <button class="sc-tb" data-cmd="block" data-val="p" title="본문">본문</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb" data-cmd="bold" title="굵게"><b>B</b></button>
        <button class="sc-tb" data-cmd="italic" title="기울임"><i>I</i></button>
        <button class="sc-tb" data-cmd="underline" title="밑줄"><u>U</u></button>
        <button class="sc-tb" data-cmd="quote" title="인용구(선택한 문장을 이탤릭+큰따옴표로, 다시 누르면 해제)">“”</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb sc-hl" data-cmd="highlight" data-color="#fff59d" title="노랑 형광펜" style="background:#fff59d">&nbsp;</button>
        <button class="sc-tb sc-hl" data-cmd="highlight" data-color="#b9f6ca" title="초록 형광펜" style="background:#b9f6ca">&nbsp;</button>
        <button class="sc-tb sc-hl" data-cmd="highlight" data-color="#ffcdd2" title="분홍 형광펜" style="background:#ffcdd2">&nbsp;</button>
        <button class="sc-tb sc-hl-clear" data-cmd="highlight" data-color="" title="형광펜 지우기">지우기</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb" data-cmd="image" title="이미지 삽입(커서 위치)">🖼 이미지</button>
      </div>
      <div class="sc-note-rich" contenteditable="true" data-note="${key}" data-placeholder="메모·원고를 자유롭게. 제목/소제목/본문, 굵게, 밑줄, 이미지 삽입">${noteHtml || ''}</div>
      <input type="file" accept="image/*" class="sc-img-input" hidden>
      <div class="sc-note-actions">
        <span class="sc-save-hint">입력하면 자동 저장돼요</span>
        <button class="primary small" data-note-save="${key}" title="남은 내용을 저장하고 메모창을 접습니다">완료</button>
      </div>
    </div>`;
}

/* 리치 메모 에디터 배선 (스크랩·존안 공통).
   opts.getItem(key) -> item;  opts.persist(key, item) -> Promise<bool>|bool */
function wireRichNote(card, opts){
  const key = card.dataset.key;
  const rich = card.querySelector('.sc-note-rich');
  const fileInput = card.querySelector('.sc-img-input');
  if(!rich) return;

  let autosaveTimer = null;
  let lastSaved = rich.innerHTML;
  // 저장 상태는 "완료" 버튼 왼쪽 고정 자리에 계속 표시(2026-09-28) — 예전엔 버튼 오른쪽에 "저장됨"이
  // 떴다 사라지며 버튼이 밀렸고, 버튼 이름이 "저장"인데 실제론 창을 접어서 헷갈렸음.
  const hintEl = card.querySelector('.sc-save-hint');
  const showHint = (text, state)=>{
    if(!hintEl) return;
    hintEl.textContent = text;
    hintEl.classList.toggle('ok', state === 'ok');
    hintEl.classList.toggle('bad', state === 'bad');
  };
  const hhmm = ()=>{ const d = new Date(); return String(d.getHours()).padStart(2,'0') + ':' + String(d.getMinutes()).padStart(2,'0'); };
  const save = async ()=>{
    if(autosaveTimer){ clearTimeout(autosaveTimer); autosaveTimer = null; }
    const it = opts.getItem(key);
    if(!it) return;
    if(rich.innerHTML === lastSaved) return;
    it.note = rich.innerHTML;
    showHint('저장 중…');
    const ok = await opts.persist(key, it);
    if(ok !== false){ lastSaved = it.note; showHint('✓ 자동 저장됨 ' + hhmm(), 'ok'); }
    else { showHint('저장 실패 — 새로고침 후 다시 시도하세요', 'bad'); }
  };

  rich.addEventListener('input', ()=>{
    showHint('입력 중…');
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(save, 1500);
  });

  // 붙여넣기는 서식(글꼴·크기·색·링크 등) 다 버리고 순수 텍스트만
  const insertPlain = (text)=>{
    if(!text) return;
    rich.focus();
    document.execCommand('insertText', false, text);
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(save, 1500);
  };
  const scheduleAutosave = ()=>{
    if(autosaveTimer) clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(save, 1500);
  };
  rich.addEventListener('paste', (e)=>{
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    const imgFile = clipboardImageFile(e);
    if(imgFile){ insertImageAtCursor(rich, imgFile, scheduleAutosave); return; }
    const html = cd ? cd.getData('text/html') : '';
    if(html){
      const sanitized = sanitizePastedHtml(html);
      if(sanitized){
        rich.focus();
        document.execCommand('insertHTML', false, sanitized);
        scheduleAutosave();
        return;
      }
    }
    insertPlain(cd ? cd.getData('text/plain') : '');
  });
  wireImageClickResize(rich, scheduleAutosave);
  card.querySelectorAll('.sc-tb').forEach(btn=>{
    btn.onmousedown = (e)=> e.preventDefault();
    btn.onclick = ()=>{
      const cmd = btn.dataset.cmd;
      rich.focus();
      if(cmd === 'bold') document.execCommand('bold');
      else if(cmd === 'italic') document.execCommand('italic');
      else if(cmd === 'underline') document.execCommand('underline');
      else if(cmd === 'quote') toggleQuoteMark(rich);
      else if(cmd === 'block') document.execCommand('formatBlock', false, btn.dataset.val);
      else if(cmd === 'highlight') applyHighlight(btn.dataset.color);
      else if(cmd === 'image'){ fileInput.click(); return; }
      save();
    };
  });
  fileInput.onchange = async ()=>{
    const file = fileInput.files && fileInput.files[0];
    fileInput.value = '';
    if(!file) return;
    await insertImageAtCursor(rich, file, save);
  };
  card.querySelector('[data-note-save]').onclick = async ()=>{
    await save();
    if(typeof opts.onSaved === 'function') opts.onSaved(key);
  };
  rich.addEventListener('blur', save);
}


/* 첨부 이미지 리사이즈 — 긴 변 900px, JPEG 0.68. dataURL 반환 */
function resizeImageFile(file, maxSide){
  maxSide = maxSide || 900;
  return new Promise((resolve, reject)=>{
    const fr = new FileReader();
    fr.onload = ()=>{
      const img = new Image();
      img.onload = ()=>{
        let {width:w, height:h} = img;
        if(w > maxSide || h > maxSide){
          const r = Math.min(maxSide/w, maxSide/h);
          w = Math.round(w*r); h = Math.round(h*r);
        }
        const cv = document.createElement('canvas');
        cv.width = w; cv.height = h;
        cv.getContext('2d').drawImage(img, 0, 0, w, h);
        resolve(cv.toDataURL('image/jpeg', 0.68));
      };
      img.onerror = reject;
      img.src = fr.result;
    };
    fr.onerror = reject;
    fr.readAsDataURL(file);
  });
}

/* 붙여넣기 이벤트에서 이미지 파일 추출 (이미지가 있으면 File 객체, 없으면 null) */
function clipboardImageFile(e){
  const cd = e.clipboardData || window.clipboardData;
  if(!cd) return null;
  const items = cd.items;
  if(items){
    for(let i=0;i<items.length;i++){
      const it = items[i];
      if(it.kind === 'file' && it.type && it.type.indexOf('image/') === 0) return it.getAsFile();
    }
  }
  const files = cd.files;
  if(files && files.length && files[0].type && files[0].type.indexOf('image/') === 0) return files[0];
  return null;
}
/* 붙여넣기 HTML 서식 정리: 폰트·크기·색 등은 다 버리고 굵게·이탤릭·밑줄만 살려서 안전한 HTML로 변환.
   태그명(B/STRONG/I/EM/U)뿐 아니라 style="font-weight:bold" 같은 인라인 스타일도 인식한다. */
function sanitizePastedHtml(html){
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  const BLOCK_RE = /^(P|DIV|LI|TR|H[1-6]|TABLE|BLOCKQUOTE|UL|OL)$/;
  const out = [];
  const wrap = (text, active)=>{
    let s = esc(text);
    if(active.b) s = `<b>${s}</b>`;
    if(active.i) s = `<i>${s}</i>`;
    if(active.u) s = `<u>${s}</u>`;
    return s;
  };
  const walk = (node, active)=>{
    if(node.nodeType === Node.TEXT_NODE){
      if(node.nodeValue) out.push(wrap(node.nodeValue, active));
      return;
    }
    if(node.nodeType !== Node.ELEMENT_NODE) return;
    const tag = node.tagName;
    if(tag === 'SCRIPT' || tag === 'STYLE') return;
    if(tag === 'BR'){ out.push('<br>'); return; }
    const st = node.style || {};
    const next = {
      b: active.b || tag === 'B' || tag === 'STRONG' || /^(bold|bolder|[6-9]00)$/.test(String(st.fontWeight||'')),
      i: active.i || tag === 'I' || tag === 'EM' || st.fontStyle === 'italic',
      u: active.u || tag === 'U' || /underline/.test(String(st.textDecorationLine || st.textDecoration || ''))
    };
    node.childNodes.forEach(ch => walk(ch, next));
    if(BLOCK_RE.test(tag)) out.push('<br>');
  };
  tmp.childNodes.forEach(ch => walk(ch, {b:false, i:false, u:false}));
  return out.join('').replace(/(<br>\s*){3,}/g, '<br><br>').replace(/(<br>\s*)+$/, '');
}
/* 이미지 파일을 리사이즈해 커서 위치(el)에 삽입. onDone은 삽입 성공 후 호출(저장 트리거용) */
async function insertImageAtCursor(el, file, onDone){
  try{
    const dataUrl = await resizeImageFile(file);
    el.focus();
    document.execCommand('insertHTML', false, `<img src="${dataUrl}" alt="">`);
    if(typeof onDone === 'function') await onDone();
  }catch(e){ alert('이미지를 넣지 못했어요.'); }
}
/* 인용부호 버튼: 선택한 문장을 이탤릭+앞뒤 큰따옴표로 묶는다. 이미 묶인 자리를 다시 선택해 누르면 해제(토글) */
function toggleQuoteMark(root){
  const sel = window.getSelection();
  if(!sel || sel.rangeCount === 0) return;
  const range = sel.getRangeAt(0);
  if(!root.contains(range.commonAncestorContainer)) return;
  let node = range.commonAncestorContainer;
  if(node.nodeType === Node.TEXT_NODE) node = node.parentNode;
  const quoteEl = node.closest ? node.closest('.sc-quote') : null;
  if(quoteEl && root.contains(quoteEl)){
    const stripped = quoteEl.textContent.replace(/^“/, '').replace(/”$/, '');
    const textNode = document.createTextNode(stripped);
    quoteEl.replaceWith(textNode);
    sel.removeAllRanges();
    const r = document.createRange();
    r.selectNodeContents(textNode);
    sel.addRange(r);
    return;
  }
  if(sel.isCollapsed) return;
  const selectedText = range.toString();
  if(!selectedText) return;
  range.deleteContents();
  const wrapper = document.createElement('i');
  wrapper.className = 'sc-quote';
  const openMark = document.createElement('span');
  openMark.className = 'sc-quote-mark';
  openMark.textContent = '“';
  const closeMark = document.createElement('span');
  closeMark.className = 'sc-quote-mark';
  closeMark.textContent = '”';
  wrapper.appendChild(openMark);
  wrapper.appendChild(document.createTextNode(selectedText));
  wrapper.appendChild(closeMark);
  range.insertNode(wrapper);
  sel.removeAllRanges();
  const r2 = document.createRange();
  r2.selectNodeContents(wrapper);
  sel.addRange(r2);
}
/* 선택 영역에 형광펜(배경색) 적용/해제. color가 빈 값이면 해제 */
function applyHighlight(color){
  const val = color || 'transparent';
  let ok = false;
  try{ ok = document.execCommand('hiliteColor', false, val); }catch(e){ ok = false; }
  if(!ok){ try{ document.execCommand('backColor', false, val); }catch(e){} }
}

/* 에디터 안 이미지를 클릭하면 25/50/75/100% 크기 버튼을 띄워줌 — 폭만 지정하고 높이는 auto라 비율은 항상 유지됨.
   버튼바는 contenteditable 밖(body)에 띄워서 저장되는 innerHTML에는 절대 섞이지 않음. */
let _imgResizeBar = null;
function ensureImgResizeBar(){
  if(_imgResizeBar) return _imgResizeBar;
  const bar = document.createElement('div');
  bar.className = 'sc-img-resize-bar';
  bar.hidden = true;
  [25,50,75,100].forEach(pct=>{
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'sc-img-resize-btn';
    b.textContent = pct + '%';
    b.dataset.pct = String(pct);
    bar.appendChild(b);
  });
  document.body.appendChild(bar);
  document.addEventListener('click', (e)=>{
    if(!_imgResizeBar || _imgResizeBar.hidden) return;
    if(_imgResizeBar.contains(e.target) || e.target.tagName === 'IMG') return;
    _imgResizeBar.hidden = true;
  });
  window.addEventListener('scroll', ()=>{ if(_imgResizeBar) _imgResizeBar.hidden = true; }, true);
  _imgResizeBar = bar;
  return bar;
}
function wireImageClickResize(root, onChange){
  root.addEventListener('click', (e)=>{
    const img = e.target.closest('img');
    if(!img || !root.contains(img)) return;
    e.preventDefault();
    const bar = ensureImgResizeBar();
    const r = img.getBoundingClientRect();
    bar.style.left = Math.max(4, window.scrollX + r.left) + 'px';
    bar.style.top = (window.scrollY + r.top - 34) + 'px';
    bar.hidden = false;
    bar.querySelectorAll('.sc-img-resize-btn').forEach(b=>{
      b.onclick = (ev)=>{
        ev.preventDefault(); ev.stopPropagation();
        img.style.width = b.dataset.pct + '%';
        img.style.height = 'auto';
        bar.hidden = true;
        if(typeof onChange === 'function') onChange();
      };
    });
  });
}

/* 스크랩 필드 몇 개만 한 번에 저장(멀티패스 PATCH 1건). 순서·선택은 아이템 통째 PUT(메모·이미지 포함)을
   수십 건 보내던 탓에 연타하면 늦게 도착한 옛 순서가 덮어써 순서가 되돌아갔다(2026-10-08 후니 지적). */
async function patchSavedFields(map){
  if(!Object.keys(map).length) return;
  try{
    const res = await dbFetch(userPath('saved_news'), {
      method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(map)
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
  }catch(e){ console.warn('[스크랩 부분 저장 실패]', e); }
}
// 순서 저장은 연타가 끝난 뒤 한 번만(그 사이 화면은 즉시 바뀜)
let _savedOrderTimer = null;
function persistSavedOrderSoon(){
  clearTimeout(_savedOrderTimer);
  _savedOrderTimer = setTimeout(()=>{
    const map = {};
    Object.entries(newsState.savedNews).forEach(([k, it])=>{ if(it && typeof it.order === 'number') map[k + '/order'] = it.order; });
    patchSavedFields(map);
  }, 400);
}
/* 이동 — keys(하나 또는 선택한 여러 개)를 한 칸씩 위(-1)/아래(+1)로. 선택이 떨어져 있어도 각자 한 칸씩,
   맨 끝에 닿은 것은 멈추고 나머지만 움직인다. moved면 true */
function moveSavedKeys(keys, dir){
  const order = sortedSavedEntries().map(([k])=>k);
  const sel = new Set(keys);
  let moved = false;
  const idxs = order.map((k, i)=> sel.has(k) ? i : -1).filter(i=> i >= 0);
  if(dir > 0) idxs.reverse();
  idxs.forEach(i=>{
    const j = i + dir;
    if(j < 0 || j >= order.length || sel.has(order[j])) return;   // 끝이거나 바로 옆도 선택됨(묶음째 막힘)
    [order[i], order[j]] = [order[j], order[i]];
    moved = true;
  });
  if(!moved) return false;
  const n = order.length;
  order.forEach((k, idx)=>{ if(newsState.savedNews[k]) newsState.savedNews[k].order = n - 1 - idx; });
  persistSavedOrderSoon();
  return true;
}
/* 카드의 ▲▼ — 옮긴 카드가 마우스 밑에 그대로 있도록 화면을 같이 스크롤한다.
   예전엔 카드만 올라가서 같은 자리를 다시 누르면 다른 카드의 버튼이 눌렸다(연속 이동 불가). */
/* 옮긴 카드를 원래 화면 위치(top0)로 되돌린다. 페이지 맨 위·맨 아래라 스크롤할 여유가 없으면
   목록 위/아래에 임시 여백을 넣어서라도 맞춘다 — 그래야 같은 자리 연타가 같은 카드에 먹는다
   (2026-10-08 실측: 맨 위에선 스크롤 보정이 안 돼 두 번째 클릭이 옆 카드를 눌러 순서가 되돌아감).
   여백은 마우스가 목록을 벗어나면 걷는다. */
let _savedPadTop = 0, _savedPadBottom = 0;
function keepCardUnderPointer(card, top0){
  const root = document.getElementById('savedNewsList');
  let delta = card.getBoundingClientRect().top - top0;
  if(delta < 0 && -delta > window.scrollY){
    _savedPadTop += Math.ceil(-delta - window.scrollY);
    root.style.paddingTop = _savedPadTop + 'px';
    delta = card.getBoundingClientRect().top - top0;
  }
  if(delta > 0){
    const room = document.documentElement.scrollHeight - window.innerHeight - window.scrollY;
    if(delta > room){ _savedPadBottom += Math.ceil(delta - room); root.style.paddingBottom = _savedPadBottom + 'px'; }
  }
  window.scrollBy(0, delta);
  if(!root._padReset){
    root._padReset = true;
    root.addEventListener('pointerleave', ()=>{
      if(!_savedPadTop && !_savedPadBottom) return;
      _savedPadTop = _savedPadBottom = 0;
      root.style.paddingTop = root.style.paddingBottom = '';
    });
  }
}
function moveSaved(key, dir){
  const sel = `.saved-card[data-key="${CSS.escape(key)}"]`;
  const before = document.querySelector(sel);
  const top0 = before ? before.getBoundingClientRect().top : null;
  // 선택된 카드의 ▲▼를 누르면 선택한 것 전부가 같이 움직인다(2026-10-08 사장님: "2개 선택했으면 같이")
  const it = newsState.savedNews[key];
  const keys = (it && it.reportOn === true)
    ? sortedSavedEntries().filter(([, x])=> x.reportOn === true).map(([k])=>k)
    : [key];
  if(!moveSavedKeys(keys, dir)) return;
  renderSavedNews();
  const after = document.querySelector(sel);
  if(after && top0 !== null) keepCardUnderPointer(after, top0);
  const btn = after && after.querySelector(dir < 0 ? '[data-move-up]' : '[data-move-down]');
  if(btn && !btn.disabled) btn.focus({ preventScroll: true });
}
/* 선택한 스크랩 묶음 이동 — 상단(고정) 툴바 버튼이라 계속 같은 자리를 눌러 연속 이동된다. 선택은 유지. */
function moveSelectedSaved(dir){
  const keys = sortedSavedEntries().filter(([, it])=> it.reportOn === true).map(([k])=>k);
  if(!keys.length) return;
  if(!moveSavedKeys(keys, dir)) return;
  renderSavedNews();
  const first = document.querySelector(`.saved-card[data-key="${CSS.escape(keys[dir < 0 ? 0 : keys.length - 1])}"]`);
  if(first){
    const r = first.getBoundingClientRect();
    const bar = document.querySelector('#savedNewsPanel .saved-toolbar');
    const barBottom = bar ? bar.getBoundingClientRect().bottom : 0;
    if(r.top < barBottom + 8 || r.bottom > window.innerHeight - 8) first.scrollIntoView({ block: 'center' });
  }
}
function setSavedSelection(keys, on){
  const map = {};
  keys.forEach(k=>{ const it = newsState.savedNews[k]; if(it){ it.reportOn = on; map[k + '/reportOn'] = on; } });
  patchSavedFields(map);
}
let _savedLastCheckedKey = null;   // Shift+클릭 범위 선택 기준점

/* 상단 툴바 — 하나라도 체크하면 [N개 선택 ▲ ▼ 존안 삭제 리포트작성]이 켜진다.
   예전엔 체크해도 '리포트작성' 하나만 켜져서 "전체선택해도 활성화되는 메뉴가 없다"는 지적(2026-10-08 후니). */
function renderSavedSelectionBar(){
  const entries = sortedSavedEntries();
  const selKeys = entries.filter(([, it])=> it.reportOn === true).map(([k])=>k);
  const n = selKeys.length;
  const bar = document.getElementById('savedReportBar');
  if(bar){
    bar.hidden = entries.length === 0;
    const dis = n ? '' : ' disabled';
    bar.innerHTML = `${n ? `<span class="sc-sel-count"><b>${n}</b>개 선택</span>` : ''}
      <button class="small sc-sel-btn" id="scSelUp"${dis} title="선택한 스크랩 위로 (⌥↑ / Alt+↑)">▲</button>
      <button class="small sc-sel-btn" id="scSelDown"${dis} title="선택한 스크랩 아래로 (⌥↓ / Alt+↓)">▼</button>
      <button class="small" id="scSelArchive"${dis}>존안</button>
      <button class="small" id="scSelDelete"${dis}>삭제</button>
      <button class="primary small" id="scMakeReport"${dis}>리포트작성 (${n})</button>`;
    bar.querySelector('#scSelUp').onclick = ()=> moveSelectedSaved(-1);
    bar.querySelector('#scSelDown').onclick = ()=> moveSelectedSaved(+1);
    bar.querySelector('#scSelArchive').onclick = async ()=>{
      const keys = sortedSavedEntries().filter(([, it])=> it.reportOn === true).map(([k])=>k);
      if(!keys.length) return;
      for(const k of keys){
        // 존안에는 선택 표시를 지우고 넘긴다(나중에 스크랩으로 되돌려도 선택된 채로 나오지 않게)
        if(newsState.savedNews[k]) newsState.savedNews[k].reportOn = false;
        await moveToArchive(k);
      }
      renderSavedNews();
    };
    bar.querySelector('#scSelDelete').onclick = async ()=>{
      const keys = sortedSavedEntries().filter(([, it])=> it.reportOn === true).map(([k])=>k);
      if(!keys.length || !confirm(`선택한 스크랩 ${keys.length}개를 삭제할까요?`)) return;
      const map = {};
      keys.forEach(k=>{ delete newsState.savedNews[k]; savedNoteOpenKeys.delete(k); map[k] = null; });
      renderSavedNews();
      await patchSavedFields(map);
    };
    bar.querySelector('#scMakeReport').onclick = createReportFromSelection;
  }
  const selAllBtn = document.getElementById('scrapSelectAllBtn');
  if(selAllBtn){
    const allOn = entries.length > 0 && n === entries.length;
    selAllBtn.textContent = allOn ? '선택해제' : '전체선택';
    selAllBtn.disabled = entries.length === 0;
    selAllBtn.onclick = ()=>{
      setSavedSelection(sortedSavedEntries().map(([k])=>k), !allOn);
      renderSavedNews();
    };
  }
}
/* 키보드 — 선택이 있을 때 ⌥↑/⌥↓(윈도우 Alt+↑/↓)로 선택 묶음 이동. 메모 편집·입력 중엔 무시. */
document.addEventListener('keydown', (e)=>{
  if(!e.altKey || e.metaKey || e.ctrlKey || (e.key !== 'ArrowUp' && e.key !== 'ArrowDown')) return;
  const panel = document.getElementById('savedNewsPanel');
  if(!panel || panel.style.display === 'none') return;
  const t = e.target;
  if(t && (t.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) && t.type !== 'checkbox')) return;
  if(!Object.values(newsState.savedNews).some(it=> it && it.reportOn === true)) return;
  e.preventDefault();
  moveSelectedSaved(e.key === 'ArrowUp' ? -1 : +1);
});

function renderSavedNews(){
  const root = document.getElementById('savedNewsList');
  if(!root) return;
  flushOpenNoteEditors();   // 재렌더로 에디터 DOM이 날아가기 전에 내용 저장
  const entries = sortedSavedEntries();

  if(entries.length===0){
    root.className = '';
    root.innerHTML = `<div class="empty-hint">아직 스크랩한 기사가 없습니다. 기사 옆 "스크랩" 버튼을 눌러보세요.</div>`;
    const bar = document.getElementById('savedReportBar');
    if(bar){ bar.hidden = true; }
    const selAllBtn0 = document.getElementById('scrapSelectAllBtn');
    if(selAllBtn0){ selAllBtn0.textContent = '전체선택'; selAllBtn0.disabled = true; }
    return;
  }

  const cardHtml = ([key, item], idx, arr)=>{
    const open = savedNoteOpenKeys.has(key);
    const titleHtml = item.link
      ? `<a class="sc-title" href="${item.link}" target="_blank" rel="noopener">${esc(item.title||'(제목 없음)')}</a>`
      : `<span class="sc-title">${esc(item.title||'(제목 없음)')}</span>`;
    const metaBits = [pressDisplayName(item.source), item.pubDate ? relTimeNews(item.pubDate) : ''].filter(Boolean).join(' · ');
    const noteText = noteToText(item.note);
    const notePreview = (!open && noteText) ? `<div class="sc-note-preview">${esc(noteText)}</div>` : '';
    const thumbHtml = item.thumbnail ? `<img class="sc-thumb-img" src="${esc(item.thumbnail)}" alt="" loading="lazy">` : '';
    const embedHtml = item.embed ? `<div class="sns-embed" data-provider="${esc(item.embed.provider)}" data-url="${esc(item.embed.url)}"></div>` : '';
    const editor = open ? richNoteEditorHtml(key, item.note) : '';
    const reportOn = item.reportOn === true; // 기본 선택 안 함
    return `<div class="saved-card${open?' open':''}${reportOn?'':' report-off'}" data-key="${key}">
      <div class="sc-main">
        <label class="sc-report" title="리포트에 반영">
          <input type="checkbox" data-report="${key}" ${reportOn?'checked':''}>
        </label>
        ${thumbHtml}
        <div class="sc-body">
          ${titleHtml}
          ${metaBits ? `<div class="sc-meta">${esc(metaBits)}</div>` : ''}
          ${embedHtml}
          ${notePreview}
        </div>
        <div class="sc-actions">
          <span class="sc-move">
            <button class="sc-btn sc-mv" data-move-up="${key}" ${idx===0?'disabled':''} title="위로">▲</button>
            <button class="sc-btn sc-mv" data-move-down="${key}" ${idx===arr.length-1?'disabled':''} title="아래로">▼</button>
          </span>
          ${item.aiFailed && item.link ? `<button class="sc-btn sc-ai-retry" data-ai-retry="${key}" title="AI 요약이 실패했어요 — 다시 만들어요">요약 다시</button>` : ''}
          <button class="sc-btn${noteText.trim()?' has-note':''}" data-note-toggle="${key}">${open?'접기':'메모'}</button>
          <button class="sc-btn" data-archive-move="${key}">존안</button>
          <button class="sc-btn" data-saved-delete="${key}">삭제</button>
        </div>
      </div>
      ${editor}
    </div>`;
  };

  root.className = 'saved-list';
  root.innerHTML = entries.map(cardHtml).join('');
  renderSnsEmbeds(root);
  renderSavedSelectionBar();
  syncSavedToolbarSticky();

  // 체크 = 선택(리포트·이동·존안·삭제 공통). Shift+클릭이면 앞서 누른 것부터 여기까지 한꺼번에(맥 Finder처럼).
  root.querySelectorAll('[data-report]').forEach(cb=>{
    cb.onclick = (e)=>{
      const key = cb.dataset.report;
      if(!newsState.savedNews[key]) return;
      const order = sortedSavedEntries().map(([k])=>k);
      let keys = [key];
      if(e.shiftKey && _savedLastCheckedKey && _savedLastCheckedKey !== key){
        const a = order.indexOf(_savedLastCheckedKey), b = order.indexOf(key);
        if(a >= 0 && b >= 0) keys = order.slice(Math.min(a, b), Math.max(a, b) + 1);
      }
      _savedLastCheckedKey = key;
      setSavedSelection(keys, cb.checked);
      keys.forEach(k=>{
        const card = root.querySelector(`.saved-card[data-key="${CSS.escape(k)}"]`);
        if(!card) return;
        card.classList.toggle('report-off', !cb.checked);
        const c = card.querySelector('[data-report]'); if(c) c.checked = cb.checked;
      });
      renderSavedSelectionBar();
    };
  });

  root.querySelectorAll('.saved-card.open').forEach(card=>
    wireRichNote(card, {
      getItem: k=> newsState.savedNews[k], persist: saveSavedNewsItem,
      onSaved: k=>{ savedNoteOpenKeys.delete(k); renderSavedNews(); }   // "저장" 누르면 메모창 접기
    }));

  root.querySelectorAll('[data-note-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.noteToggle;
      if(savedNoteOpenKeys.has(key)) savedNoteOpenKeys.delete(key);
      else savedNoteOpenKeys.add(key);
      renderSavedNews();
    };
  });
  root.querySelectorAll('[data-ai-retry]').forEach(b=> b.onclick = ()=> retryGeminiSummary(b.dataset.aiRetry));
  root.querySelectorAll('[data-move-up]').forEach(b=> b.onclick = ()=> moveSaved(b.dataset.moveUp, -1));
  root.querySelectorAll('[data-move-down]').forEach(b=> b.onclick = ()=> moveSaved(b.dataset.moveDown, +1));
  root.querySelectorAll('[data-archive-move]').forEach(btn=>{
    btn.onclick = async ()=>{ await moveToArchive(btn.dataset.archiveMove); renderSavedNews(); };
  });
  root.querySelectorAll('[data-saved-delete]').forEach(btn=>{
    btn.onclick = async ()=>{
      const key = btn.dataset.savedDelete;
      delete newsState.savedNews[key];
      savedNoteOpenKeys.delete(key);
      await deleteSavedNewsItem(key);
      renderSavedNews();
    };
  });
}

