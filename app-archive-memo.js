/* 존안·메모·메모 카테고리
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ---------- 존안 (아카이브) — 스크랩에서 넘어온 기사를 태그로 정리 ----------
   태그는 미리 만들지 않고 기사 카드의 '태그' 버튼으로 그때그때 붙인다(한 기사에 여러 개).
   상단 필터 칩은 실제로 쓰이는 태그에서 자동 생성. 로컬 전용(팀 공유 아님). */
const ARCHIVE_LS_KEY = 'jsg_archive_v1';                 // (구) 로컬 키 — seed에서만 참조
const ARCHIVE_FOLDERS_LS_KEY = 'jsg_archive_folders_v1'; // (구) 로컬 키 — seed에서만 참조

/* 존안 — C2부터 /users/{uid}/archived, /archive_folders 가 정본. */
function persistArchive(){
  dbFetch(userPath('archived'), {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newsState.archived)
  }).catch(e=> console.warn('[존안 동기화 실패]', e));
}
async function loadArchive(){
  try{
    const res = await dbFetch(userPath('archived'));
    const data = await res.json();
    const archived = (data && typeof data === 'object') ? data : {};
    // excerpt는 폐지(제목+링크+메모만 유지) — 예전에 남아있던 값이 있으면 지운다.
    let changed = false;
    Object.values(archived).forEach(it=>{
      if(it && it.excerpt !== undefined){ delete it.excerpt; changed = true; }
    });
    if(changed) dbFetch(userPath('archived'), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(archived)
    }).catch(e=> console.warn('[존안 동기화 실패]', e));
    return archived;
  }catch(e){ return {}; }
}
function persistArchiveFolders(){
  dbFetch(userPath('archive_folders'), {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newsState.archiveFolders)
  }).catch(e=> console.warn('[존안 폴더 동기화 실패]', e));
}
async function loadArchiveFolders(){
  try{
    const res = await dbFetch(userPath('archive_folders'));
    const data = await res.json();
    return Array.isArray(data) ? data : [];
  }catch(e){ return []; }
}

/* 스크랩 탭의 '존안' 버튼 — 스크랩에서 지우고 존안으로 옮김(메모·서식·썸네일 그대로 승계) */
async function moveToArchive(key){
  const item = newsState.savedNews[key];
  if(!item) return;
  // 먼저 존안에 넣고(유실 방지), 그다음 스크랩에서 제거
  newsState.archived[key] = {...item, tags: item.tags || []};
  persistArchive();
  delete newsState.savedNews[key];
  savedNoteOpenKeys.delete(key);
  await deleteSavedNewsItem(key);
}
/* 존안 탭의 '스크랩으로' 버튼 — moveToArchive의 반대. 메모·태그·썸네일 그대로 승계해서
   스크랩으로 되돌린다(2026-09-09). */
async function moveToSaved(key){
  const item = newsState.archived[key];
  if(!item) return;
  // 먼저 스크랩에 넣고(유실 방지), 그다음 존안에서 제거
  newsState.savedNews[key] = {...item, order: nextSavedOrder()};
  await saveSavedNewsItem(key, newsState.savedNews[key]);
  delete newsState.archived[key];
  archiveNoteOpenKeys.delete(key);
  persistArchive();
}

let archiveTagFilter = null;   // null = '미분류'(태그 없는 기사), 문자열 = 그 태그로 필터
let archiveNoteOpenKeys = new Set();

function archiveTagCounts(){
  const counts = {};
  Object.values(newsState.archived).forEach(item=>{
    (item.tags||[]).forEach(t=>{ counts[t] = (counts[t]||0) + 1; });
  });
  return counts;
}
function untaggedArchiveCount(){
  return Object.values(newsState.archived).filter(i=> !(i.tags||[]).length).length;
}
function addArchiveTag(key, raw){
  const tag = String(raw||'').trim().replace(/^#/, '');
  if(!tag) return;
  const item = newsState.archived[key];
  if(!item) return;
  item.tags = item.tags || [];
  if(!item.tags.includes(tag)) item.tags.push(tag);
  persistArchive();
  renderArchiveFolders();
  renderArchive();
}


function archiveDeleteTag(name){
  newsState.archiveFolders = (newsState.archiveFolders||[]).filter(f=> f !== name);
  Object.values(newsState.archived).forEach(it=>{
    if(it.tags) it.tags = it.tags.filter(t=> t !== name);
  });
  if(archiveTagFilter === name) archiveTagFilter = null;
  persistArchiveFolders();
  persistArchive();
  renderArchiveFolders();
  renderArchive();
}
function archiveRenameTag(oldName, newName){
  const folders = newsState.archiveFolders || [];
  if(folders.includes(newName)){ alert(`이미 있는 카테고리입니다: ${newName}`); return; }
  newsState.archiveFolders = folders.map(f=> f === oldName ? newName : f);
  Object.values(newsState.archived).forEach(it=>{
    if(it.tags) it.tags = it.tags.map(t=> t === oldName ? newName : t);
  });
  if(archiveTagFilter === oldName) archiveTagFilter = newName;
  persistArchiveFolders();
  persistArchive();
  renderArchiveFolders();
  renderArchive();
}
/* 카드를 "미분류" 칩으로 드래그 — 카테고리를 전부 떼어 미분류로 되돌림 */
function clearArchiveTags(key){
  const item = newsState.archived[key];
  if(!item || !(item.tags||[]).length) return;
  item.tags = [];
  persistArchive();
  renderArchiveFolders();
  renderArchive();
}
function archiveAddTags(raw){
  const names = String(raw||'').split(',').map(s=> s.trim().replace(/^#/, '')).filter(Boolean);
  if(!names.length) return;
  newsState.archiveFolders = newsState.archiveFolders || [];
  names.forEach(n=>{ if(!newsState.archiveFolders.includes(n)) newsState.archiveFolders.push(n); });
  persistArchiveFolders();
  renderArchiveFolders();
}

/* 존안 상단 태그줄을 스크롤 시 서브탭 바로 아래에 고정 — 서브탭 <header> 높이만큼 top 을 맞춘다 */
function syncArchiveStickyBar(){
  const bar = document.getElementById('archiveStickyBar');
  if(!bar) return;
  const hdr = document.querySelector('#newsApp > header');   // #ytApp의 숨겨진 탭줄 잡지 않도록 스코프
  const base = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
  bar.style.top = ((hdr ? hdr.offsetHeight : 0) + base) + 'px';
}
window.addEventListener('resize', ()=>{ if(document.getElementById('archivePanel') && document.getElementById('archivePanel').style.display !== 'none') syncArchiveStickyBar(); });

/* 메모 카테고리 태그 줄을 스크롤 시 메모 헤더 바로 아래에 고정(2026-09-09) */
function syncMemoCatStickyBar(){
  const bar = document.getElementById('memoFloat');   // 입력창+카테고리+메모 추가 묶음 전체를 고정
  if(!bar) return;
  const hdr = document.querySelector('#memoApp > header');
  const base = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
  bar.style.top = ((hdr ? hdr.offsetHeight : 0) + base) + 'px';
}
window.addEventListener('resize', ()=>{
  const p = document.getElementById('memoApp');
  if(p && p.style.display !== 'none') syncMemoCatStickyBar();
});
// 메모 화면을 열 때 top을 계산하는 순간엔 메모 헤더가 잠깐 보여서(47px) 111px로 잡히고, 직후
// syncScreenHeaders가 헤더를 숨겨도(→0) 값이 안 바뀌어 고정 영역 위에 47px 틈이 생겼음(2026-10-03 실사용).
// ResizeObserver는 관찰 시점 기준 0→0이라 안 불림 — 타이밍에 기대지 않고 스크롤할 때마다 현재 헤더 높이로 맞춤.
window.addEventListener('scroll', ()=>{
  const p = document.getElementById('memoApp');
  if(p && p.style.display !== 'none') syncMemoCatStickyBar();
}, {passive:true});

/* 스크랩 탭 상단 툴바(리포트 대상 바 + 스크랩 추가)를 스크롤 시 서브탭 바로 아래 고정 */
function syncSavedToolbarSticky(){
  const bar = document.querySelector('#savedNewsPanel .saved-toolbar');
  if(!bar) return;
  // #newsApp 스코프 필수 — 그냥 '.news-subtabs'면 숨겨진 #ytApp의 탭줄(높이 0)을 잡아서 top이 어긋남
  const hdr = document.querySelector('#newsApp > header');
  const base = parseInt(getComputedStyle(document.documentElement).getPropertyValue('--header-h')) || 64;
  bar.style.top = ((hdr ? hdr.offsetHeight : 0) + base) + 'px';
}
window.addEventListener('resize', ()=>{
  const p = document.getElementById('savedNewsPanel');
  if(p && p.style.display !== 'none') syncSavedToolbarSticky();
});

/* 존안 카테고리 칩 — 필터 + 삭제(✕) + 드래그 타깃 + 새 카테고리 입력을 한 줄에 통합 (2026-09-04, 용어를 "카테고리"로 2026-09-05) */
function renderArchiveFolders(){
  const el = document.getElementById('archiveFolderChips');
  if(!el) return;
  const counts = archiveTagCounts();
  const folders = newsState.archiveFolders || [];
  el.innerHTML =
      `<button class="saved-hashtag-chip${archiveTagFilter===null?' active':''}" data-tag="" data-uncat>미분류 <span class="count">${untaggedArchiveCount()}</span></button>`
    + folders.map(t=>`<span class="saved-hashtag-chip has-x${archiveTagFilter===t?' active':''}${(counts[t]||0)===0?' empty':''}" data-folder="${esc(t)}"><button class="sh-filter" data-tag="${esc(t)}">${esc(t)} <span class="count">${counts[t]||0}</span></button><button class="sh-edit" data-ren="${esc(t)}" title="이름 수정" aria-label="카테고리 이름 수정">✎</button><button class="sh-del" data-del="${esc(t)}" title="카테고리 삭제" aria-label="카테고리 삭제">✕</button></span>`).join('')
    + `<input class="sh-tag-input" id="newArchTagInput" placeholder="카테고리 추가 (쉼표로 여러 개)">`
    + `<button class="sh-tag-add" id="addArchTagBtn">+ 추가</button>`;
  el.querySelectorAll('[data-tag]').forEach(btn=>{
    btn.onclick = ()=>{
      archiveTagFilter = btn.dataset.tag || null;
      renderArchiveFolders();
      renderArchive();
    };
  });
  el.querySelectorAll('[data-del]').forEach(btn=>{
    btn.onclick = (e)=>{ e.stopPropagation(); archiveDeleteTag(btn.dataset.del); };
  });
  el.querySelectorAll('[data-ren]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const oldName = btn.dataset.ren;
      openRenameModal('카테고리 이름 수정', oldName, v=> archiveRenameTag(oldName, v));
    };
  });
  enableChipReorder(el, '[data-folder]', 'data-folder', order=>{
    newsState.archiveFolders = order;
    persistArchiveFolders();
    renderArchiveFolders();
  });
  const addFn = ()=>{ const i = document.getElementById('newArchTagInput'); archiveAddTags(i.value); i.value=''; };
  document.getElementById('addArchTagBtn').onclick = addFn;
  document.getElementById('newArchTagInput').onkeydown = (e)=>{ if(e.key==='Enter') addFn(); };
  // 기사 카드를 카테고리 칩 위로 드래그하면 그 카테고리가 붙고 미분류에서 사라짐. 미분류 칩으로 되돌리면 카테고리 전부 해제.
  el.querySelectorAll('[data-folder], [data-uncat]').forEach(chip=>{
    chip.addEventListener('dragover', (e)=>{ e.preventDefault(); chip.classList.add('drag-over'); });
    chip.addEventListener('dragleave', ()=> chip.classList.remove('drag-over'));
    chip.addEventListener('drop', (e)=>{
      e.preventDefault();
      chip.classList.remove('drag-over');
      const key = e.dataTransfer.getData('text/plain');
      if(chip.dataset.folder) addArchiveTag(key, chip.dataset.folder);
      else clearArchiveTags(key);
    });
  });
}

function renderArchive(){
  const root = document.getElementById('archiveList');
  if(!root) return;
  flushOpenNoteEditors();
  let entries = Object.entries(newsState.archived);
  if(archiveTagFilter) entries = entries.filter(([,item])=> (item.tags||[]).includes(archiveTagFilter));
  else entries = entries.filter(([,item])=> !(item.tags||[]).length);   // 미분류 = 태그 없는 기사
  entries.sort((a,b)=> safeArticleTime(b[1].pubDate) - safeArticleTime(a[1].pubDate));

  if(entries.length===0){
    root.className = '';
    root.innerHTML = `<div class="empty-hint">${archiveTagFilter?'이 카테고리에 담긴 존안 기사가 없습니다.':'미분류 기사가 없습니다. 스크랩 탭에서 "존안" 버튼을 눌러 보관하고, 여기서 카드를 카테고리로 끌어다 분류하세요.'}</div>`;
    return;
  }
  const cardHtml = ([key, item])=>{
    const open = archiveNoteOpenKeys.has(key);
    const tags = item.tags || [];
    const titleHtml = item.link
      ? `<a class="sc-title" href="${item.link}" target="_blank" rel="noopener">${esc(item.title||'(제목 없음)')}</a>`
      : `<span class="sc-title">${esc(item.title||'(제목 없음)')}</span>`;
    const metaBits = [pressDisplayName(item.source), item.pubDate ? relTimeNews(item.pubDate) : ''].filter(Boolean).join(' · ');
    const noteText = noteToText(item.note);
    const notePreview = (!open && noteText) ? `<div class="sc-note-preview">${esc(noteText)}</div>` : '';
    const thumbHtml = item.thumbnail ? `<img class="sc-thumb-img" src="${esc(item.thumbnail)}" alt="" loading="lazy">` : '';
    const embedHtml = item.embed ? `<div class="sns-embed" data-provider="${esc(item.embed.provider)}" data-url="${esc(item.embed.url)}"></div>` : '';
    const editor = open ? richNoteEditorHtml(key, item.note) : '';
    const tagLine = tags.length ? `<div class="sc-meta arch-tag-line">${tags.map(esc).join(' · ')}</div>` : '';
    return `<div class="saved-card archive-card${open?' open':''}" data-key="${key}" draggable="true">
      <div class="sc-main">
        ${thumbHtml}
        <div class="sc-body">
          ${titleHtml}
          ${metaBits ? `<div class="sc-meta">${esc(metaBits)}</div>` : ''}
          ${tagLine}
          ${embedHtml}
          ${notePreview}
        </div>
        <div class="sc-actions">
          <button class="sc-btn${noteText.trim()?' has-note':''}" data-arch-toggle="${key}">${open?'접기':'메모'}</button>
          <button class="sc-btn" data-arch-restore="${key}">스크랩으로</button>
          <button class="sc-btn" data-arch-del="${key}">삭제</button>
        </div>
      </div>
      ${editor}
    </div>`;
  };
  root.className = 'saved-list';
  root.innerHTML = entries.map(cardHtml).join('');
  renderSnsEmbeds(root);

  root.querySelectorAll('.archive-card').forEach(card=>{
    card.addEventListener('dragstart', (e)=>{ e.dataTransfer.setData('text/plain', card.dataset.key); });
  });
  root.querySelectorAll('.archive-card.open').forEach(card=>
    wireRichNote(card, {
      getItem: k=> newsState.archived[k],
      persist: (k, it)=>{ newsState.archived[k] = it; persistArchive(); return true; },
      onSaved: k=>{ archiveNoteOpenKeys.delete(k); renderArchive(); }   // "완료" 누르면 메모창 접기
    }));
  root.querySelectorAll('[data-arch-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.archToggle;
      if(archiveNoteOpenKeys.has(key)) archiveNoteOpenKeys.delete(key);
      else archiveNoteOpenKeys.add(key);
      renderArchive();
    };
  });
  root.querySelectorAll('[data-arch-restore]').forEach(btn=>{
    btn.onclick = async ()=>{
      const key = btn.dataset.archRestore;
      btn.disabled = true;
      await moveToSaved(key);
      renderArchiveFolders();
      renderArchive();
    };
  });
  root.querySelectorAll('[data-arch-del]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.archDel;
      delete newsState.archived[key];
      archiveNoteOpenKeys.delete(key);
      persistArchive();
      renderArchiveFolders();
      renderArchive();
    };
  });
}

/* ---------- 메모 (개인 전용 — 가피메모·후니메모 대체, 2026-09-05) ----------
   /users/{uid}/personal_memos 에 저장. 팀 공유 아님, 로그인한 본인만 봄. 스크랩과는 완전히 별개(2026-09-05 재확인 —
   한때 스크랩에 합쳤다가 되돌림). 뉴스·스크랩·존안과 같은 CSS/컴포넌트(.saved-card, .sc- 계열, .saved-hashtag-chip,
   richNoteEditorHtml/wireRichNote)를 그대로 재사용해 디자인만 통일. 가피메모의 카테고리·별점·완료·퀵애드 기능을 여기 복원. */
async function loadPersonalMemos(){
  try{
    const res = await dbFetch(userPath('personal_memos'));
    const data = await res.json();
    newsState.personalMemos = (data && typeof data === 'object') ? data : {};
  }catch(e){ newsState.personalMemos = {}; }
}
async function savePersonalMemoItem(key, item){
  newsState.personalMemos[key] = item;
  try{
    const res = await dbFetch(userPath('personal_memos/' + key), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item)
    });
    if(!res.ok) throw new Error('HTTP ' + res.status);
    return true;
  }catch(e){ console.warn('[메모 저장 실패]', e); return false; }
}
async function deletePersonalMemoItem(key){
  delete newsState.personalMemos[key];
  try{ await dbFetch(userPath('personal_memos/' + key), {method:'DELETE'}); }
  catch(e){ console.warn('[메모 삭제 실패]', e); }
}
function addPersonalMemo(){
  const key = 'pm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  const item = { title:'', note:'', link:'', stars:0, done:false, createdAt: Date.now(), updatedAt: Date.now() };
  savePersonalMemoItem(key, item);
  renderPersonalMemos();
  requestAnimationFrame(()=>{
    const el = document.querySelector(`.pm-card[data-key="${key}"] .pm-title-input`);
    if(el) el.focus();
  });
}

/* 퀵애드 — 가피메모의 "링크 또는 메모를 입력하세요" 한 줄 입력 복원.
   http(s)://로 시작하면 링크로 자동 분석해서 저장, 아니면 텍스트 메모로 즉시 저장. */
async function quickAddMemo(raw){
  raw = String(raw||'').trim();
  if(!raw) return;
  let item = null;
  if(/^https?:\/\//i.test(raw)){
    const url = raw;
    if(isYoutubeUrl(url)){
      let title = url, thumbnail = '';
      try{ const r = await fetchYoutubeTitle(url); title = r.title || url; thumbnail = r.thumbnail || ''; }catch(e){}
      item = { type:'youtube', title, link:url, source:'유튜브' };
      if(thumbnail) item.thumbnail = thumbnail;
    }else if(isTweetUrl(url)){
      let text = '', author = '';
      try{ const r = await fetchTweetOembed(url); text = r.text; author = r.author; }catch(e){}
      item = { type:'twitter', title: text ? text.split('\n')[0].slice(0,50) : (author?'@'+author:'X 게시물'),
               link:url, source:'X', embed:{provider:'twitter',url}, note: text ? textToNoteHtml(text) : '' };
    }else if(isFbPostUrl(url)){
      const canonical = await resolveShareUrl(url);
      item = { type:'facebook', title:'페이스북 게시물', link:canonical, source:'페이스북', embed:{provider:'facebook',url:canonical} };
    }else{
      let title = url, body = '';
      try{ const r = await fetchArticlePage(url); title = r.title || url; body = r.body || ''; }catch(e){}
      item = { type:'url', title, link:url, source: guessPressFromUrl(url), note: body ? textToNoteHtml(body) : '' };
    }
  }else{
    const title = raw.length > 40 ? raw.slice(0,40) + '…' : raw;
    item = { type:'manual', title, link:'', source:'직접 입력', note: textToNoteHtml(raw) };
  }
  if(!item.note) item.note = '';
  item.stars = 0;
  item.done = false;
  item.createdAt = Date.now();
  item.updatedAt = Date.now();
  const key = item.link ? linkToSafeKey(item.link) : ('pm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6));
  await savePersonalMemoItem(key, item);
  renderPersonalMemos();
}

/* 스크랩 한 줄 빠른 추가 — quickAddMemo와 같은 패턴(링크/텍스트 자동판별, 모달 없이 즉시 저장).
   모바일 홈 인덱스 전용. 기존 openScrapAddModal(3탭 모달)은 그대로 유지, 이건 더 단순한 별도 경로. */
async function quickAddScrap(raw){
  raw = String(raw||'').trim();
  if(!raw) return false;
  let item = null, key = null;
  if(/^https?:\/\//i.test(raw)){
    const url = raw;
    key = linkToSafeKey(url);
    if(isYoutubeUrl(url)){
      let title = url, thumbnail = '';
      try{ const r = await fetchYoutubeTitle(url); title = r.title || url; thumbnail = r.thumbnail || ''; }catch(e){}
      item = { type:'youtube', title, link:url, youtubeUrl:url, source:'유튜브', bodyIsFinal:true };
      if(thumbnail) item.thumbnail = thumbnail;
    }else if(isTweetUrl(url)){
      let text = '', author = '';
      try{ const r = await fetchTweetOembed(url); text = r.text; author = r.author; }catch(e){}
      const title = text ? text.split('\n')[0].slice(0,50) : (author?'@'+author:'X 게시물');
      item = { type:'twitter', title, link:url, source:'X', embed:{provider:'twitter',url}, bodyIsFinal:true,
               note: text ? textToNoteHtml(text + (author ? `\n\n— @${author}` : '')) : '' };
    }else if(isFbPostUrl(url)){
      const canonical = await resolveShareUrl(url);
      key = linkToSafeKey(canonical);
      item = { type:'facebook', title:'페이스북 게시물', link:canonical, source:'페이스북', embed:{provider:'facebook',url:canonical}, bodyIsFinal:true };
    }else{
      // 가져오기(제목·본문 fetch)와 요약을 기다리지 않고 즉시 저장 — 나머지는 배경에서 처리(2026-09-17).
      item = { type:'url', title: url, link:url, source: guessPressFromUrl(url), bodyIsFinal:false, note:'' };
    }
  }else{
    const title = raw.length > 50 ? raw.slice(0,50) + '…' : raw;
    item = { type:'manual', title, link:'', source:'직접 입력', bodyIsFinal:true, note: textToNoteHtml(raw) };
    key = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
  }
  if(item.note == null) item.note = '';
  item.pubDate = new Date().toISOString();
  item.tags = [];
  item.order = nextSavedOrder();
  item.addedAt = Date.now();
  const ok = await saveSavedNewsItem(key, item);
  if(ok){
    renderSavedNews();
    if(item.type === 'url') enrichScrapWithGeminiNewsSummary(key, item.link);   // 배경에서 제목·요약 채움
  }
  return ok;
}

/* ---------- 메모 카테고리 (가피메모 복원) — 스크랩·존안 카테고리와는 별개, /users/{uid}/memo_categories.
   존안과 동일하게 "미분류"가 기본값(카테고리 없는 메모) — 자동으로 어떤 카테고리에도 안 들어가고,
   드래그로 칩에 놓아야 분류되며 그 순간 미분류에서 빠진다. */
const MEMO_CAT_DEFAULTS = ['AI','프롬프트','디자인','촬영과편집','정치','레시피','기타'];
let memoCatFilter = null;   // null = 미분류(카테고리 없는 메모), 문자열 = 그 카테고리
let memoTitleEditKeys = new Set();
/* 메모 카드 접기/펼치기 — 스크랩·존안과 반대로 "닫힌 키"만 기록한다(기존엔 항상 펼침이었으므로
   기본값을 펼침으로 유지해 기존 화면이 그대로 보이게 함, 2026-09-09). */
let personalMemoClosedKeys = new Set();
newsState.memoCategories = MEMO_CAT_DEFAULTS.slice();
async function loadMemoCategories(){
  try{
    const res = await dbFetch(userPath('memo_categories'));
    const data = await res.json();
    newsState.memoCategories = (Array.isArray(data) && data.length) ? data : MEMO_CAT_DEFAULTS.slice();
  }catch(e){ newsState.memoCategories = MEMO_CAT_DEFAULTS.slice(); }
}
function persistMemoCategories(){
  dbFetch(userPath('memo_categories'), {
    method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newsState.memoCategories)
  }).catch(e=> console.warn('[메모 카테고리 저장 실패]', e));
}
function memoFaviconUrl(link){
  try{ return `https://www.google.com/s2/favicons?domain=${new URL(link).hostname}&sz=32`; }catch(e){ return ''; }
}
function untaggedMemoCount(){
  return Object.values(newsState.personalMemos).filter(it=> !it.category).length;
}
function renderMemoCatChips(){
  const el = document.getElementById('memoCatChips');
  if(!el) return;
  const cats = newsState.memoCategories.length ? newsState.memoCategories : MEMO_CAT_DEFAULTS;
  const counts = {};
  Object.values(newsState.personalMemos).forEach(it=>{ if(it.category) counts[it.category] = (counts[it.category]||0) + 1; });
  el.innerHTML = `<button class="saved-hashtag-chip${memoCatFilter===null?' active':''}" data-memo-cat="" data-memo-uncat>미분류 <span class="count">${untaggedMemoCount()}</span></button>`
    + cats.map(c=> `<span class="saved-hashtag-chip has-x${memoCatFilter===c?' active':''}" data-memo-cat-drop="${esc(c)}"><button class="sh-filter" data-memo-cat="${esc(c)}">${esc(c)} <span class="count">${counts[c]||0}</span></button><button class="sh-edit" data-memo-ren="${esc(c)}" title="이름 수정" aria-label="카테고리 이름 수정">✎</button><button class="sh-del" data-memo-del="${esc(c)}" title="카테고리 삭제" aria-label="카테고리 삭제">✕</button></span>`).join('')
    // 카테고리 추가 — 예전 ⚙ 관리 모달 대신 스패너를 켰을 때만 칩 줄 끝에 나타남 (2026-09-24)
    + `<input class="sh-tag-input edit-only" id="newMemoCatInput" placeholder="카테고리 추가">`
    + `<button class="sh-tag-add edit-only" id="addMemoCatBtn">+ 추가</button>`;
  el.querySelectorAll('[data-memo-cat]').forEach(btn=>{
    btn.onclick = ()=>{ memoCatFilter = btn.dataset.memoCat || null; renderMemoCatChips(); renderPersonalMemos(); };
  });
  // 기본 카테고리만 보이는 상태(저장된 목록 없음)에서 고치면 기본값을 실제 목록으로 먼저 옮겨 둠
  const ensureCats = ()=>{ if(!newsState.memoCategories.length) newsState.memoCategories = MEMO_CAT_DEFAULTS.slice(); return newsState.memoCategories; };
  el.querySelectorAll('[data-memo-ren]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const oldName = btn.dataset.memoRen;
      openRenameModal('카테고리 이름 수정', oldName, v=>{
        const list = ensureCats();
        if(list.includes(v)){ alert(`이미 있는 카테고리입니다: ${v}`); return; }
        const i = list.indexOf(oldName);
        if(i<0) return;
        list[i] = v;
        Object.entries(newsState.personalMemos).forEach(([k,it])=>{
          if(it.category === oldName){ it.category = v; savePersonalMemoItem(k, it); }
        });
        if(memoCatFilter === oldName) memoCatFilter = v;
        persistMemoCategories();
        renderMemoCatChips(); renderPersonalMemos();
      });
    };
  });
  el.querySelectorAll('[data-memo-del]').forEach(btn=>{
    btn.onclick = (e)=>{
      e.stopPropagation();
      const name = btn.dataset.memoDel;
      if(!confirm(`"${name}" 카테고리를 삭제할까요? 이 카테고리의 메모는 미분류로 이동합니다.`)) return;
      newsState.memoCategories = ensureCats().filter(c=> c !== name);
      Object.entries(newsState.personalMemos).forEach(([k,it])=>{
        if(it.category === name){ delete it.category; savePersonalMemoItem(k, it); }
      });
      if(memoCatFilter === name) memoCatFilter = null;
      persistMemoCategories();
      renderMemoCatChips(); renderPersonalMemos();
    };
  });
  const addCat = ()=>{
    const inp = document.getElementById('newMemoCatInput');
    const list = ensureCats();
    inp.value.split(',').map(v=>v.trim()).filter(Boolean).forEach(v=>{ if(!list.includes(v)) list.push(v); });
    inp.value = '';
    persistMemoCategories();
    renderMemoCatChips();
    document.getElementById('newMemoCatInput')?.focus();
  };
  enableChipReorder(el, '[data-memo-cat-drop]', 'data-memo-cat-drop', order=>{
    newsState.memoCategories = order;
    persistMemoCategories();
    renderMemoCatChips();
  });
  document.getElementById('addMemoCatBtn').onclick = addCat;
  document.getElementById('newMemoCatInput').onkeydown = (e)=>{ if(e.key==='Enter') addCat(); };
  el.querySelectorAll('[data-memo-cat-drop], [data-memo-uncat]').forEach(chip=>{
    chip.addEventListener('dragover', (e)=>{ e.preventDefault(); chip.classList.add('drag-over'); });
    chip.addEventListener('dragleave', ()=> chip.classList.remove('drag-over'));
    chip.addEventListener('drop', (e)=>{
      e.preventDefault();
      chip.classList.remove('drag-over');
      const key = e.dataTransfer.getData('text/plain');
      const it = newsState.personalMemos[key];
      if(!it) return;
      if(chip.dataset.memoCatDrop) it.category = chip.dataset.memoCatDrop;
      else delete it.category;   // 미분류 칩으로 되돌림
      savePersonalMemoItem(key, it);
      renderMemoCatChips();
      renderPersonalMemos();
    });
  });
}

function renderPersonalMemos(){
  const root = document.getElementById('personalMemoList');
  if(!root) return;
  flushOpenNoteEditors();
  renderMemoCatChips();
  syncMemoCatStickyBar();
  let entries = Object.entries(newsState.personalMemos);
  if(memoCatFilter) entries = entries.filter(([,it])=> it.category === memoCatFilter);
  else entries = entries.filter(([,it])=> !it.category);   // 미분류 = 카테고리 없는 메모
  entries.sort((a,b)=>{
    const doneA = a[1].done ? 1 : 0, doneB = b[1].done ? 1 : 0;
    if(doneA !== doneB) return doneA - doneB;
    const starsA = a[1].stars || 0, starsB = b[1].stars || 0;
    if(starsA !== starsB) return starsB - starsA;
    return (b[1].updatedAt||b[1].createdAt||0) - (a[1].updatedAt||a[1].createdAt||0);
  });

  if(entries.length === 0){
    root.className = '';
    const totalCount = Object.keys(newsState.personalMemos).length;
    const msg = memoCatFilter ? '이 카테고리에 담긴 메모가 없습니다.'
      : totalCount === 0 ? '아직 메모가 없습니다. 위 입력창이나 "+ 메모 추가"로 시작하세요.'
      : '미분류 메모가 없습니다. 모두 카테고리로 분류됐습니다.';
    root.innerHTML = `<div class="empty-hint">${msg}</div>`;
    return;
  }
  root.className = 'saved-list';
  root.innerHTML = entries.map(([key, item])=>{
    const editingTitle = memoTitleEditKeys.has(key);
    const titleHtml = editingTitle
      ? `<input type="text" class="sc-title-input" data-mtitle-input="${key}" value="${esc(item.title||'')}" placeholder="제목 없음">`
      : (item.link
          ? `<a class="sc-title" href="${item.link}" target="_blank" rel="noopener">${esc(item.title||'(제목 없음)')}</a>`
          : `<span class="sc-title">${esc(item.title||'(제목 없음)')}</span>`);
    const _pmEmbeddable = !!(item.link && (isYoutubeUrl(item.link) || isInstagramUrl(item.link)));
    let thumbInner;
    if(item.thumbnail) thumbInner = `<img class="sc-thumb-img" src="${esc(item.thumbnail)}" alt="" loading="lazy">`;
    else if(item.link){ const fav = memoFaviconUrl(item.link); thumbInner = fav ? `<img class="sc-thumb-img sc-thumb-fav" src="${esc(fav)}" alt="" loading="lazy">` : ''; }
    else thumbInner = `<div class="sc-thumb-img sc-thumb-memo">📝</div>`;
    const thumbHtml = thumbInner
      ? `<span class="sc-thumb-wrap${_pmEmbeddable?' sc-thumb-playable':''}"${_pmEmbeddable?' data-pm-play="1"':''}>${thumbInner}${_pmEmbeddable?'<span class="sc-thumb-play">▶</span>':''}</span>`
      : '';
    const embedHtml = item.embed ? `<div class="sns-embed" data-provider="${esc(item.embed.provider)}" data-url="${esc(item.embed.url)}"></div>` : '';
    const metaBits = [pressDisplayName(item.source), relTimeNews(new Date(item.updatedAt||item.createdAt||Date.now()).toISOString())].filter(Boolean).join(' · ');
    const stars = item.stars || 0;
    let starHtml = '';
    for(let i=1;i<=3;i++) starHtml += `<span class="sc-star${stars>=i?' on':''}" data-mstar-key="${key}" data-star="${i}">★</span>`;
    const open = !personalMemoClosedKeys.has(key);
    const noteText = noteToText(item.note);
    const notePreview = (!open && noteText) ? `<div class="sc-note-preview">${esc(noteText)}</div>` : '';
    const editor = open ? richNoteEditorHtml(key, item.note) : '';
    return `<div class="saved-card pm-card${item.done?' sc-done':''}${open?' open':''}" data-key="${key}" draggable="true">
      <div class="sc-main">
        ${thumbHtml}
        <div class="sc-body">
          <div class="sc-title-row">
            <button class="sc-title-edit" data-mtitle-edit="${key}" title="제목 수정">✎</button>
            ${titleHtml}
          </div>
          <div class="sc-star-row">${starHtml}</div>
          ${metaBits ? `<div class="sc-meta">${esc(metaBits)}</div>` : ''}
          ${embedHtml}
          ${notePreview}
        </div>
        <div class="sc-actions">
          <button class="sc-btn${item.done?' sc-done-on':''}" data-mdone-toggle="${key}">${item.done?'✓ 완료':'완료'}</button>
          <button class="sc-btn${noteText.trim()?' has-note':''}" data-pm-note-toggle="${key}">${open?'접기':'메모'}</button>
          <button class="sc-btn" data-pm-del="${key}">삭제</button>
        </div>
      </div>
      ${editor}
    </div>`;
  }).join('');
  renderSnsEmbeds(root);

  root.querySelectorAll('[data-mtitle-edit]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.mtitleEdit;
      memoTitleEditKeys.add(key);
      renderPersonalMemos();
      const inp = root.querySelector(`[data-mtitle-input="${key}"]`);
      if(inp){ inp.focus(); inp.select(); }
    };
  });
  root.querySelectorAll('[data-mtitle-input]').forEach(inp=>{
    inp.onkeydown = (e)=>{ if(e.key === 'Enter') inp.blur(); };
    inp.onblur = ()=>{
      const key = inp.dataset.mtitleInput;
      const it = newsState.personalMemos[key];
      if(it && inp.value.trim()){ it.title = inp.value.trim(); it.updatedAt = Date.now(); savePersonalMemoItem(key, it); }
      memoTitleEditKeys.delete(key);
      renderPersonalMemos();
    };
  });
  root.querySelectorAll('.pm-card.open').forEach(card=>
    wireRichNote(card, {
      getItem: k=> newsState.personalMemos[k],
      persist: (k, it)=>{ it.updatedAt = Date.now(); return savePersonalMemoItem(k, it); },
      onSaved: k=>{ personalMemoClosedKeys.add(k); renderPersonalMemos(); }   // "완료" 누르면 메모창 접기
    }));
  root.querySelectorAll('[data-pm-note-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.pmNoteToggle;
      if(personalMemoClosedKeys.has(key)) personalMemoClosedKeys.delete(key);
      else personalMemoClosedKeys.add(key);
      renderPersonalMemos();
    };
  });
  root.querySelectorAll('[data-pm-del]').forEach(btn=>{
    btn.onclick = ()=>{
      if(!confirm('이 메모를 삭제할까요?')) return;
      deletePersonalMemoItem(btn.dataset.pmDel);
      renderPersonalMemos();
    };
  });
  root.querySelectorAll('[data-mdone-toggle]').forEach(btn=>{
    btn.onclick = ()=>{
      const it = newsState.personalMemos[btn.dataset.mdoneToggle];
      if(!it) return;
      it.done = !it.done;
      savePersonalMemoItem(btn.dataset.mdoneToggle, it);
      renderPersonalMemos();
    };
  });
  root.querySelectorAll('[data-mstar-key]').forEach(s=>{
    s.onclick = ()=>{
      const it = newsState.personalMemos[s.dataset.mstarKey];
      if(!it) return;
      const val = Number(s.dataset.star);
      it.stars = (it.stars||0) === val ? 0 : val;
      savePersonalMemoItem(s.dataset.mstarKey, it);
      renderPersonalMemos();
    };
  });
  root.querySelectorAll('.pm-card[draggable="true"]').forEach(card=>{
    card.addEventListener('dragstart', (e)=>{ e.dataTransfer.setData('text/plain', card.dataset.key); });
  });
  root.querySelectorAll('[data-pm-play]').forEach(wrap=>{
    wrap.onclick = ()=>{
      const card = wrap.closest('.pm-card');
      const it = card && newsState.personalMemos[card.dataset.key];
      if(it && it.link) openEmbedPopup(it.link);
    };
  });
}

function customFeedNames(){
  return new Set(customFeedList().map(f=> f.name));
}
function allKnownOutletNames(){
  const names = new Set();
  RSS_FEEDS.forEach(f=> names.add(outletBaseName(f.name)));
  PRESS_DOMAIN_MAP.forEach(([,name])=> names.add(name));
  newsState.discoveredOutlets.forEach(n=> names.add(n));
  newsState.subscribedOutlets.forEach(n=> names.add(n));
  newsState.articles.forEach(a=>{ if(a.source) names.add(outletBaseName(a.source)); });
  const custom = customFeedNames();
  return Array.from(names).filter(n=> n && !custom.has(n)).sort((a,b)=> a.localeCompare(b, 'ko'));
}
/* 설정 탭 "팀 계정" 섹션 — 슬롯 현황 + 닉네임 목록 + (마스터만) 삭제 + 로그아웃 */
/* 좌측 서랍 하단 계정 블록 (닉네임 + 로그아웃) */
function renderSbAccount(){
  const el = document.getElementById('sbAccount');
  if(!el) return;
  const a = CURRENT_ACCOUNT || {};
  const photoURL = CURRENT_USER && CURRENT_USER.photoURL;
  const initial = (a.nickname || a.email || '?').trim().charAt(0).toUpperCase();
  const avatarHtml = photoURL
    ? `<img class="sba-avatar" src="${esc(photoURL)}" alt="" referrerpolicy="no-referrer">`
    : `<span class="sba-avatar sba-avatar-fallback">${esc(initial)}</span>`;
  el.innerHTML = `
    <div class="sba-row">
      ${avatarHtml}
      <div class="sba-text">
        <span class="sba-name">${esc(a.nickname || '(이름 미입력)')}</span>
        <span class="sba-email">${esc(a.email || '')}</span>
      </div>
    </div>
    <button class="sba-logout" id="sbaLogoutBtn" title="로그아웃">
      <svg class="sba-logout-ico" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="fill:none"><path stroke-linecap="round" stroke-linejoin="round" d="M5.636 5.636a9 9 0 1 0 12.728 0M12 3v9"/></svg>
      <span class="sba-logout-label">로그아웃</span>
    </button>`;
  el.querySelector('#sbaLogoutBtn').onclick = async ()=>{
    try{ localStorage.removeItem('jungle_seen_login'); }catch(e){}
    await firebase.auth().signOut();
    location.reload();
  };
}

async function renderTeamAccounts(){
  const root = document.getElementById('teamAccountsSection');
  if(!root) return;
  const slots = JUNGLE_CONFIG.slotCount || 3;
  let accounts = {};
  try{
    accounts = await dbFetch(`${FIREBASE_URL}/accounts.json`).then(r=>r.json()) || {};
  }catch(e){}
  const entries = Object.entries(accounts)
    .sort((a,b)=> (a[1].createdAt||0) - (b[1].createdAt||0));
  const isMaster = !!(CURRENT_ACCOUNT && CURRENT_ACCOUNT.isMaster);
  const myUid = CURRENT_ACCOUNT && CURRENT_ACCOUNT.uid;

  const chips = entries.map(([uid, a])=>{
    const me = uid === myUid;
    const canDelete = isMaster && !me && !a.isMaster;
    return `<span class="ta-chip">
      <span class="ta-name">${esc(a.nickname || '(이름 미입력)')}</span>${a.isMaster?'<span class="ta-badge">마스터</span>':''}${me?'<span class="ta-badge me">나</span>':''}
      <span class="ta-email">${esc(a.email||'')}</span>
      ${canDelete ? `<button class="ta-del" data-del-uid="${esc(uid)}">삭제</button>` : ''}
    </span>`;
  }).join('');

  root.innerHTML = `
    <div class="team-acct-bar">
      <span class="ta-head">팀 계정 <span class="ta-slots">${entries.length} / ${slots}</span></span>
      ${chips || '<span class="empty-hint">등록된 계정이 없습니다.</span>'}
      <button id="authLogoutBtn" class="ta-logout">로그아웃</button>
    </div>`;

  root.querySelectorAll('[data-del-uid]').forEach(btn=>{
    btn.onclick = async ()=>{
      const uid = btn.dataset.delUid;
      const a = accounts[uid] || {};
      if(!confirm(`'${a.nickname || a.email || uid}' 계정을 삭제할까요? 이 사람은 다시 로그인하면 자리가 남아 있을 때만 들어올 수 있어요.`)) return;
      await dbFetch(`${FIREBASE_URL}/accounts/${uid}.json`, {method:'DELETE'});
      renderTeamAccounts();
    };
  });
  const logoutBtn = document.getElementById('authLogoutBtn');
  if(logoutBtn) logoutBtn.onclick = async ()=>{
    try{ localStorage.removeItem('jungle_seen_login'); }catch(e){}
    await firebase.auth().signOut();
    location.reload();
  };
}

/* RSS 주소로 한 번 수집해서 유효한 피드인지 확인 (기타 언론사 구독 등록용) */
async function validateRssFeed(url){
  try{
    const items = await fetchOneFeed({name:'(확인)', url});
    return Array.isArray(items) && items.length > 0;
  }catch(e){ return false; }
}

function customFeedCardHtml(){
  const feeds = customFeedList();
  const rows = feeds.length ? feeds.map(f=>`
      <div class="cf-row${f.deadSince?' dead':''}">
        <span class="cf-name">${esc(f.name)}</span>
        <span class="cf-url">${esc(f.url)}</span>
        ${f.deadSince ? '<span class="cf-badge">수집 실패</span>' : ''}
        <button class="cf-del" data-cf-del="${esc(f.id)}">삭제</button>
      </div>`).join('') : '<div class="cf-empty">아직 등록한 언론사가 없습니다</div>';
  const groupHead = feeds.length ? `<div class="outlet-group-head danger"><span class="bar"></span>네이버 미입점 언론사<span class="cnt">${feeds.length}곳</span></div>` : '';
  return `
    <div class="cf-card">
      <div class="cf-head">네이버 미입점 언론사 직접 등록 <span class="cf-sub">RSS 주소 · 팀 공유 · 실시간 탭에 항상 표시</span></div>
      <div class="cf-add">
        <input id="cfName" placeholder="언론사 이름">
        <input id="cfUrl" placeholder="RSS 주소 (https://…/rss.xml)">
        <button id="cfAddBtn">추가</button>
      </div>
      <div id="cfMsg" class="cf-msg"></div>
      ${groupHead}
      <div class="cf-list">${rows}</div>
    </div>`;
}

function renderOutletSettings(){
  const root = document.getElementById('outletSettingsList');
  if(!root) return;
  const outlets = allKnownOutletNames();
  const on  = outlets.filter(n=>  newsState.subscribedOutlets.has(n));
  const off = outlets.filter(n=> !newsState.subscribedOutlets.has(n));
  const item = (name, isOff)=>`
      <label class="outlet-settings-item${isOff?' off':''}">
        <input type="checkbox" data-outlet="${esc(name)}" ${isOff?'':'checked'}>
        ${esc(pressDisplayName(name))}
      </label>`;
  const section = (label, list, isOff)=> list.length===0 ? '' : `
    <div class="outlet-group-head${isOff?' off':''}"><span class="bar"></span>${label}<span class="cnt">${list.length}곳</span></div>
    <div class="outlet-settings-grid">${list.map(n=>item(n,isOff)).join('')}</div>`;

  root.innerHTML = customFeedCardHtml() + section('구독중', on, false) + section('구독 안 함', off, true);

  const toggleSub = async (name, checked)=>{
    if(checked) newsState.subscribedOutlets.add(name);
    else newsState.subscribedOutlets.delete(name);
    await saveSubscribedOutlets();
    renderOutletSettings();
    renderAllNewsViews();
  };
  root.querySelectorAll('[data-outlet]').forEach(ck=>{
    ck.onchange = ()=> toggleSub(ck.dataset.outlet, ck.checked);
  });

  const addBtn = document.getElementById('cfAddBtn');
  if(addBtn) addBtn.onclick = async ()=>{
    const name = (document.getElementById('cfName').value || '').trim();
    const url  = (document.getElementById('cfUrl').value || '').trim();
    const msg  = document.getElementById('cfMsg');
    if(!name || !url){ msg.textContent = '이름과 RSS 주소를 모두 입력하세요'; return; }
    if(!/^https?:\/\//i.test(url)){ msg.textContent = 'http(s):// 로 시작하는 주소여야 합니다'; return; }
    if(customFeedList().some(f=> f.url === url)){ msg.textContent = '이미 등록된 주소입니다'; return; }
    addBtn.disabled = true; msg.textContent = '피드 확인 중…';
    const valid = await validateRssFeed(url);
    addBtn.disabled = false;
    if(!valid){ msg.textContent = '유효한 RSS를 찾지 못했습니다 — 주소를 확인해 주세요'; return; }
    const id = 'cf_' + Date.now().toString(36);
    await saveCustomFeed(id, { name, url, addedAt: Date.now(), deadSince: null });
    newsState.subscribedOutlets.add(name);
    await saveSubscribedOutlets();
    renderOutletSettings();
    refreshNews(true);
  };
  root.querySelectorAll('[data-cf-del]').forEach(b=>{
    b.onclick = async ()=>{
      const f = newsState.customFeeds[b.dataset.cfDel];
      await deleteCustomFeed(b.dataset.cfDel);
      if(f){ newsState.subscribedOutlets.delete(f.name); await saveSubscribedOutlets(); }
      renderOutletSettings();
      renderAllNewsViews();
    };
  });
}

const NAVER_PROXY_URL = JUNGLE_CONFIG.naverProxyUrl + '/';

const PRESS_DOMAIN_MAP = [
  ['chosun.com', '조선일보'], ['joongang.co.kr', '중앙일보'], ['joins.com', '중앙일보'],
  ['donga.com', '동아일보'], ['hankookilbo.com', '한국일보'], ['khan.co.kr', '경향신문'],
  ['hani.co.kr', '한겨레'], ['sedaily.com', '서울경제'], ['segye.com', '세계일보'],
  ['kmib.co.kr', '국민일보'], ['nocutnews.co.kr', '노컷뉴스'], ['mk.co.kr', '매일경제'],
  ['yna.co.kr', '연합뉴스'], ['yonhapnews.co.kr', '연합뉴스'], ['ohmynews.com', '오마이뉴스'],
  ['hankyung.com', '한국경제'], ['imaeil.com', '매일신문'], ['newsis.com', '뉴시스'],
  ['seoul.co.kr', '서울신문'], ['sisajournal.com', '시사저널'], ['newscj.com', '천지일보'],
  ['heraldcorp.com', '헤럴드경제'], ['newdaily.co.kr', '뉴데일리'], ['mt.co.kr', '머니투데이'],
  ['newstomato.com', '뉴스토마토'], ['fnnews.com', '파이낸셜뉴스'], ['edaily.co.kr', '이데일리'],
  ['asiae.co.kr', '아시아경제'], ['pressian.com', '프레시안'], ['dailian.co.kr', '데일리안'],
  ['news1.kr', '뉴스1'], ['munhwa.com', '문화일보'], ['naeil.com', '내일신문'],
  ['viewsnnews.com', '뷰스앤뉴스'],
  ['ytn.co.kr', 'YTN'], ['kbs.co.kr', 'KBS'], ['imbc.com', 'MBC'], ['sbs.co.kr', 'SBS'],
  ['jtbc.co.kr', 'JTBC'], ['tvchosun.com', 'TV조선'], ['ichannela.com', '채널A'],
  ['akomnews.com', '한의신문'], ['asiatime.co.kr', '아시아타임즈'], ['ajunews.com', '아주경제'],
  ['aitimes.com', 'AI타임스'], ['arunews.com', '위클리한국주택경제신문'], ['aitimes.kr', '인공지능신문'],
  ['4th.kr', '포쓰저널'], ['asiaa.co.kr', '아시아에이'], ['ablenews.co.kr', '에이블뉴스'],
  ['aflnews.co.kr', '농수축산신문'], ['abcn.kr', 'ABC뉴스'], ['bbc.com', 'BBC'],
  ['00news.co.kr', '공공뉴스'], ['apsk.co.kr', '메디팜스투데이'], ['100ssd.co.kr', '백세시대'],
  ['amnews.co.kr', '농축유통신문'], ['ajnews.co.kr', '아주경제'], ['apnews.kr', 'AP신문'],
  ['bizhankook.com', '비즈한국'], ['agrinet.co.kr', '한국농어민신문'], ['basketkorea.com', '바스켓코리아'],
  ['atstar1.com', '앳스타일'], ['autodaily.co.kr', '엠투데이'], ['bigtanews.co.kr', '빅터뉴스'],
  ['aptn.co.kr', '아파트관리신문'], ['biospectator.com', '바이오스펙테이터'], ['banronbodo.com', '반론보도닷컴'],
  ['babytimes.co.kr', '베이비타임즈'], ['biztribune.co.kr', '비즈트리뷴'], ['betanews.net', '베타뉴스'],
  ['autotimes.co.kr', '오토타임즈'], ['beminor.com', '비마이너'], ['besteleven.com', 'Best Eleven'],
  ['bravo.etoday.co.kr', '브라보마이라이프'], ['bulkyo21.com', '불교닷컴'], ['bokuennews.com', '보건산업 대표 종합전문지-보건신문'],
  ['boannews.com', '보안뉴스'], ['beopbo.com', '법보신문'], ['bizwork.co.kr', '비즈워크'],
  ['businesspost.co.kr', '비즈니스포스트'], ['bloter.net', '블로터'], ['bizwnews.com', '비즈월드'],
  ['biotimes.co.kr', '바이오타임즈'], ['breaknews.com', '브레이크뉴스'], ['byline.network', '바이라인네트워크'],
  ['btnnews.tv', 'BTN불교TV'], ['bosa.co.kr', '의학신문'], ['cctimes.kr', '충청타임즈'],
  ['cbci.co.kr', 'CBC뉴스 | CBCNEWS'], ['businessplus.kr', '비즈니스플러스'], ['busanmbc.co.kr', '부산MBC'],
  ['bzeronews.com', '공뉴스'], ['beyondpost.co.kr', '비욘드포스트'], ['catholicnews.co.kr', '가톨릭뉴스 지금여기'],
  ['ceoscoredaily.com', 'CEO스코어데일리'], ['ccdailynews.com', '충청일보'], ['ccreview.co.kr', '충청리뷰'],
  ['civicnews.com', 'CIVICNEWS(시빅뉴스)'], ['ccnnews.co.kr', '충청뉴스'], ['asiatoday.co.kr', '아시아투데이'],
  ['ccdn.co.kr', '충청매일'], ['cfnews.kr', '유교신문'], ['choicenews.co.kr', '초이스경제'],
  ['bntnews.co.kr', 'bntnews'], ['christiantoday.co.kr', '종교신문 1위 크리스천투데이'], ['chukkyung.co.kr', '축산경제신문'],
  ['chmbc.co.kr', '춘천MBC'], ['consumernews.co.kr', '소비자가 만드는 신문'], ['coinreaders.com', '코인리더스'],
  ['cooknchefnews.com', '쿡앤셰프(Cook&Chef)'], ['cnbizm.com', '문화경제'], ['daily.hankooki.com', '데일리한국'],
  ['chungnamilbo.co.kr', '충남일보'], ['dailynk.com', 'DailyNK'], ['cnet.co.kr', '씨넷코리아'],
  ['daejonilbo.com', '대전일보'], ['cnbnews.com', 'CNB뉴스'], ['dailymedi.com', '데일리메디'],
  ['dailysecu.com', '데일리시큐'], ['dailypharm.com', '데일리팜'], ['cwn.kr', 'CWN뉴스'],
  ['dealsite.co.kr', '딜사이트'], ['dailycar.co.kr', '데일리카'], ['dailypop.kr', '데일리팝'],
  ['dailysmart.co.kr', '스마트경제'], ['danbinews.com', '단비뉴스'], ['dailysportshankook.co.kr', '데일리스포츠한국'],
  ['dandinews.com', '단디뉴스'], ['ddanzi.com', '딴지일보_21세기 명랑사회를 향하여'], ['dgmbc.com', '대구MBC'],
  ['datanet.co.kr', '데이터넷'], ['digitalchosun.dizzo.com', '디지틀조선일보-디조닷컴 dizzo.com'], ['dentalnews.or.kr', '치과신문'],
  ['datasom.co.kr', '데이터솜'], ['dizzotv.com', '디지틀조선TV'], ['dailytw.kr', '데일리투머로우'],
  ['businesskorea.co.kr', 'Businesskorea'], ['decenter.kr', 'Decenter'], ['dispatch.co.kr', '디스패치 | 뉴스는 팩트다!'],
  ['cctoday.co.kr', '충청투데이'], ['busan.com', '부산일보'], ['dongascience.com', 'DongA Science'],
  ['digitaltoday.co.kr', '디지털투데이 (DigitalToday)'], ['doctorsnews.co.kr', '의협신문'], ['dnews.co.kr', '대한경제'],
  ['celuvmedia.com', '셀럽미디어'], ['ddaily.co.kr', '디지털데일리'], ['discoverynews.kr', '디스커버리뉴스(DISCOVERYNEWS)'],
  ['domin.co.kr', '전북도민일보'], ['dkilbo.com', '대경일보'], ['djtimes.co.kr', '당진시대'],
  ['docdocdoc.co.kr', '청년의사'], ['dtnews24.com', '디트NEWS24'], ['economist.co.kr', '이코노미스트'],
  ['efnews.co.kr', '파이낸셜신문'], ['dongponews.net', '재외동포신문'], ['e-platform.net', '에너지플랫폼뉴스'],
  ['e2news.com', '이투뉴스'], ['econovill.com', 'ER 이코노믹리뷰'], ['ebn.co.kr', '이비엔(EBN)뉴스센터'],
  ['engdaily.com', '엔지니어링데일리'], ['e-science.co.kr', '이코노미사이언스'], ['econonews.co.kr', '이코노뉴스'],
  ['electimes.com', '전기신문'], ['dailybrief.co.kr', '데일리브리프'], ['enter.etoday.co.kr', '비즈엔터'],
  ['edupress.kr', '에듀프레스(edupress)'], ['dailyt.co.kr', '데일리환경'], ['economytalk.kr', '이코노미톡뉴스'],
  ['ekoreanews.co.kr', '이코리아'], ['ekn.kr', '에너지경제신문'], ['epj.co.kr', '일렉트릭파워'],
  ['energydaily.co.kr', '에너지데일리'], ['dynews.co.kr', '동양일보'], ['enetnews.co.kr', '이넷뉴스'],
  ['energy-news.co.kr', '에너지신문'], ['farminsight.net', '팜인사이트'], ['farmnmarket.com', '팜앤마켓매거진'],
  ['ferrotimes.com', '페로타임즈(FerroTimes)'], ['enewstoday.co.kr', '이뉴스투데이'], ['etnews.com', '미래를 보는 창 - 전자신문'],
  ['fashionbiz.co.kr', '패션비즈'], ['etoday.co.kr', '프리미엄 경제신문 이투데이'], ['esgeconomy.com', 'ESG경제'],
  ['ezyeconomy.com', '이지경제'], ['epnc.co.kr', '테크월드'], ['dhnews.co.kr', '대학저널'],
  ['eroun.net', '이로운넷'], ['fpn119.co.kr', '소방방재신문'], ['factin.co.kr', '여론과뉴스'],
  ['fntoday.co.kr', '파이낸스투데이'], ['fetv.co.kr', 'FETV'], ['finomy.com', '현대경제신문'],
  ['esquirekorea.co.kr', 'ESQUIRE'], ['fieldnews.kr', '필드뉴스'], ['ftimes.kr', 'FT스포츠'],
  ['financialpost.co.kr', '파이낸셜포스트'], ['gamechosun.co.kr', '게임조선'], ['fourfourtwo.co.kr', '포포투'],
  ['fins.co.kr', '보험매일'], ['footballist.co.kr', '풋볼리스트(FOOTBALLIST)'], ['delighti.co.kr', '딜라이트닷넷'],
  ['fortunekorea.co.kr', '포춘코리아'], ['g-enews.com', '글로벌이코노믹'], ['foodnews.co.kr', '식품저널 foodnews'],
  ['fsnews.co.kr', '대한급식신문'], ['ggmedinews.com', '경기메디뉴스'], ['ftoday.co.kr', '파이낸셜투데이'],
  ['geconomy.co.kr', 'G.ECONOMY(지이코노미)'], ['game.dailyesports.com', '데일리게임'], ['fntimes.com', '한국금융신문'],
  ['gasnews.com', '가스신문'], ['gnmaeil.com', '경남매일'], ['gamemeca.com', '게임메카'],
  ['gamevu.co.kr', '게임뷰'], ['gjdream.com', '드림투데이'], ['gameple.co.kr', '게임플'],
  ['ggilbo.com', '금강일보'], ['golfhankook.hankooki.com', '골프한국'], ['globale.co.kr', '글로벌E'],
  ['greened.kr', '녹색경제신문'], ['gocj.net', '대전시티저널'], ['gametoc.co.kr', '게임톡'],
  ['gosiweek.com', '피앤피뉴스'], ['gqkorea.co.kr', 'GQ Korea'], ['goodmorningcc.com', '굿모닝충청'],
  ['hbnpress.com', 'HBN뉴스'], ['getnews.co.kr', '글로벌경제신문'], ['gpkorea.com', '지피코리아'],
  ['hangyo.com', '한국교육신문'], ['goodkyung.com', '굿모닝경제'], ['g1tv.co.kr', 'G1방송'],
  ['goodnews1.com', '데일리굿뉴스'], ['handmk.com', '핸드메이커(handmaker)'], ['gnnews.co.kr', '경남일보'],
  ['headlinejeju.co.kr', '헤드라인제주'], ['gimhaenews.co.kr', '김해뉴스'], ['hellot.net', '헬로티'],
  ['huffingtonpost.kr', '허프포스트코리아'], ['gukjenews.com', '국제뉴스'], ['ibabynews.com', '임신·출산·육아전문언론ㅣ베이비뉴스'],
  ['greenpostkorea.co.kr', '그린포스트코리아'], ['globalepic.co.kr', '글로벌에픽'], ['hapt.co.kr', '한국아파트신문'],
  ['hg-times.com', '한강타임즈'], ['hansbiz.co.kr', '한스경제'], ['heraldmuse.com', '헤럴드뮤즈 (Herald Muse)'],
  ['hellodd.com', '헬로디디'], ['hyunbulnews.com', '현대불교'], ['hidomin.com', '경북도민일보'],
  ['housingherald.co.kr', '하우징헤럴드'], ['ildaro.com', '일다'], ['hemophilia.co.kr', '헤모필리아라이프'],
  ['ibulgyo.com', '불교신문'], ['ibuan.com', '부안독립신문'], ['idomin.com', '경남도민일보'],
  ['idaegu.com', '대구일보'], ['ilovepc.co.kr', '디지털포스트(PC사랑)'], ['idaegu.co.kr', '대구신문'],
  ['ikpnews.net', '한국농정신문'], ['ifs.or.kr', '(사)국가미래연구원'], ['ilyosisa.co.kr', '일요시사'],
  ['ikoreanspirit.com', 'K스피릿'], ['idsn.co.kr', '매일안전신문'], ['incheonin.com', '인천in 시민언론의 길을 열어갑니다'],
  ['inews24.com', '아이뉴스24'], ['ilemonde.com', '르몽드디플로마티크(LeMonde Diplomatique)'], ['hinews.co.kr', '하이뉴스'],
  ['idjnews.kr', '당진신문'], ['ikld.kr', '국토일보'], ['impacton.net', 'IMPACT ON(임팩트온)'],
  ['iminju.net', '민주신문'], ['interview365.com', '인터뷰365'], ['incheontoday.com', '인천투데이'],
  ['incheonilbo.com', '인천일보'], ['inthenews.co.kr', '인더뉴스'], ['incheonnews.com', '인천뉴스'],
  ['industrynews.co.kr', '인더스트리뉴스'], ['isplus.com', '일간스포츠'], ['imwood.co.kr', '나무신문'],
  ['intn.co.kr', '日刊 NTN(일간NTN)'], ['insight.co.kr', '인사이트'], ['inews365.com', '충북일보'],
  ['insidevina.com', '인사이드비나'], ['jejumbc.com', '제주MBC'], ['itworld.co.kr', 'ITWorld'],
  ['insnews.co.kr', '한국보험신문'], ['interfootball.co.kr', '인터풋볼'], ['irobotnews.com', '로봇신문'],
  ['insightkorea.co.kr', '인사이트코리아'], ['issuenbiz.com', '이슈앤비즈'], ['inven.co.kr', '인벤'],
  ['itbiznews.com', 'IT비즈뉴스'], ['jbnews.com', '중부매일'], ['jeonmin.co.kr', '위즈뉴스'],
  ['jejunews.com', '제주일보'], ['jasm.co.kr', '중앙신문'], ['itdaily.kr', '아이티데일리'],
  ['jejumaeil.net', '제주매일'], ['jejusori.net', '제주의소리'], ['hdhy.co.kr', '현대해양'],
  ['jjan.kr', '전북일보 인터넷신문'], ['jeonmae.co.kr', '전국매일신문'], ['jejudomin.co.kr', '제주도민일보'],
  ['jemin.com', '제민일보'], ['jeollailbo.com', '전라일보'], ['jibs.co.kr', 'JIBS제주방송'],
  ['jnilbo.com', '전남일보'], ['iusm.co.kr', '울산매일'], ['joynews24.com', '조이뉴스24'],
  ['joseilbo.com', '1등 조세회계 경제신문 조세일보'], ['jjn.co.kr', '전북중앙'], ['joongangenews.com', '중앙이코노미뉴스'],
  ['joongboo.com', '중부일보'], ['jmbc.co.kr', '전주MBC'], ['joygm.com', '광명지역신문'],
  ['joongdo.co.kr', '중도일보'], ['ikbc.co.kr', 'KBC광주방송'], ['kbmaeil.com', '경북매일'],
  ['k-health.com', '헬스경향'], ['kdfnews.com', '한국면세뉴스'], ['junggi.co.kr', '중기이코노미'],
  ['kgnews.co.kr', '경기신문'], ['kado.net', '강원도민일보'], ['job-post.co.kr', '잡포스트(JOBPOST)'],
  ['jbsori.com', '전북의소리'], ['kjmbc.co.kr', '광주MBC'], ['kjdaily.com', '광주매일신문'],
  ['kbanker.co.kr', 'DFT 대한금융신문'], ['kidd.co.kr', '산업일보'], ['kdpress.co.kr', '데일리경제'],
  ['kfenews.co.kr', '소년한국일보'], ['kizmom.com', '키즈맘'], ['kbiznews.co.kr', '중소기업뉴스'],
  ['koreadaily.com', '미주중앙일보'], ['kmaeil.com', '경인매일'], ['knnews.co.kr', '경남신문'],
  ['khgames.co.kr', '경향게임스'], ['kookbang.dema.mil.kr', '국방일보-Kookbangilbo'], ['journal.kobeta.com', '방송기술저널'],
  ['knpnews.com', '한국원자력신문'], ['klnews.co.kr', '물류신문'], ['kihoilbo.co.kr', '기호일보'],
  ['kor.theasian.asia', '아시아엔 THE AsiaN'], ['kmecnews.co.kr', '기계설비신문'], ['kidshankook.kr', '소년한국일보'],
  ['kmedinfo.co.kr', '격주간 의료정보'], ['kormedi.com', '건강을 위한 정직한 지식'], ['koit.co.kr', '정보통신신문'],
  ['kpenews.com', '한국정경신문'], ['konas.net', '코나스넷'], ['journalist.or.kr', '한국기자협회'],
  ['koreaittimes.com', 'Korea IT Times'], ['kpinews.kr', 'KPI뉴스'], ['koreahealthlog.com', '코리아헬스로그'],
  ['koreastocknews.com', '증권경제신문'], ['koreareport.co.kr', '코리아리포트'], ['ktnews.com', '한국섬유신문'],
  ['kr.people.com.cn', '인민망'], ['koscaj.com', '대한전문건설신문'], ['kyeonggi.com', '경기일보'],
  ['korea.kr', '대한민국 정책브리핑'], ['kwnews.co.kr', '강원일보'], ['ksg.co.kr', '코리아쉬핑가제트'],
  ['lawtalknews.co.kr', '로톡뉴스'], ['ksilbo.co.kr', '경상일보'], ['kpanews.co.kr', '약사공론'],
  ['kyeongin.com', '경인일보'], ['legaltimes.co.kr', '리걸타임즈'], ['livesnews.com', '라이브뉴스'],
  ['kyosu.net', '교수신문'], ['m-economynews.com', 'M이코노미뉴스'], ['m-i.kr', '매일일보'],
  ['lecturernews.com', '한국강사신문'], ['lcnews.co.kr', '라이센스뉴스'], ['m.skyedaily.com', '스카이데일리'],
  ['laborplus.co.kr', '참여와혁신'], ['kookje.co.kr', '부산의 대표 정론지, 국제신문'], ['lifein.news', '라이프인'],
  ['lkp.news', '리버티코리아포스트'], ['livebiz.today', '생생비즈플러스'], ['kyongbuk.co.kr', '경북일보'],
  ['mbn.co.kr', 'MBN'], ['m-joongang.com', '월간중앙'], ['mcnews.co.kr', '매일건설신문'],
  ['mdilbo.com', '무등일보'], ['labortoday.co.kr', '매일노동뉴스'], ['mediagunpo.co.kr', '군포시민신문'],
  ['mbceg.co.kr', 'MBC 강원영동'], ['koreatimes.com', '미주한국일보'], ['medigatenews.com', 'MEDI:GATE NEWS'],
  ['mediajeju.com', '미디어제주'], ['meconomynews.com', '시장경제신문'], ['mbnmoney.mbn.co.kr', '경제채널 매일경제TV'],
  ['mhnse.com', 'MHN / 엠에이치앤'], ['megaeconomy.co.kr', '메가경제'], ['kwangju.co.kr', '광주일보'],
  ['mediafine.co.kr', '미디어파인'], ['maniareport.com', '마니아타임즈'], ['medicaltimes.com', '메디칼타임즈'],
  ['mdtoday.co.kr', '메디컬투데이'], ['medipana.com', '메디파나뉴스'], ['medisobizanews.com', '메디소비자뉴스'],
  ['medicopharma.co.kr', '메디코파마'], ['mfgkr.com', 'MFG'], ['medical-tribune.co.kr', '메디칼트리뷴'],
  ['mhj21.com', '문화저널21'], ['kr.aving.net', '에이빙(AVING)'], ['mjmedi.com', '민족의학신문'],
  ['mstoday.co.kr', 'MS TODAY'], ['mkhealth.co.kr', '매경헬스'], ['news.cpbc.co.kr', 'cpbc News'],
  ['mydaily.co.kr', '마이데일리'], ['mpmbc.co.kr', '목포MBC'], ['mhns.co.kr', '더쎈뉴스(The CEN News)'],
  ['news.dealsitetv.com', 'DealSite경제TV'], ['namdonews.com', '남도일보'], ['mtnews.net', '기계신문'],
  ['moneystorm.kr', '머니스톰'], ['mygoyang.com', '고양신문'], ['n.news.naver.com', '네이버 뉴스'],
  ['nc.press', '뉴스컬처'], ['netongs.com', '여수넷통뉴스'], ['monews.co.kr', '메디칼업저버'],
  ['nbntv.kr', 'NBN미디어'], ['new.dailypharm.com', '데일리팜'], ['news.bizwatch.co.kr', '비즈워치'],
  ['news.ebs.co.kr', 'EBS 뉴스'], ['news.einfomax.co.kr', '연합인포맥스'], ['news.ifm.kr', '경인방송'],
  ['news.mtn.co.kr', 'MTN NEWS'], ['news.lghellovision.net', 'LG헬로비전'], ['news.tf.co.kr', '더팩트'],
  ['news.bbsi.co.kr', '불교방송'], ['news.skbroadband.com', 'B tv news'], ['nbntv.co.kr', '내외경제TV'],
  ['news.koreanbar.or.kr', '법조신문'], ['news2day.co.kr', '뉴스투데이'], ['newscham.net', '참세상'],
  ['news.unn.net', '한국대학신문'], ['newsen.com', '뉴스엔'], ['newsam.co.kr', '농기자재신문(주)'],
  ['news.knn.co.kr', '부산경남대표방송 KNN 뉴스'], ['newsbrite.net', '뉴스브라이트'], ['news.inochong.org', '노동과희망'],
  ['newscammp.co.kr', '뉴스캠프'], ['newsmp.com', '의약뉴스'], ['newsfarm.co.kr', '한국농업신문'],
  ['newsdream.kr', '뉴스드림'], ['newsgn.com', '뉴스경남'], ['newsclaim.co.kr', '뉴스클레임'],
  ['newsjeju.net', '뉴스제주'], ['newsinside.kr', '뉴스인사이드'], ['newsfreezone.co.kr', '뉴스프리존'],
  ['newstapa.org', '뉴스타파(NEWSTAPA)'], ['newsmap.co.kr', '뉴스맵'], ['newskr.kr', '센트럴경제'],
  ['newslock.co.kr', '뉴스락'], ['newspenguin.com', '뉴스펭귄'], ['newspim.com', '뉴스핌'],
  ['newstown.co.kr', '자유 대한민국 수호자 - 뉴스타운'], ['newsnjoy.or.kr', '뉴스앤조이'], ['newsway.co.kr', '뉴스웨이'],
  ['newstnt.com', '뉴스티앤티'], ['newstopkorea.com', '뉴스톱'], ['newspost.kr', '뉴스포스트'],
  ['newsian.co.kr', '뉴시안'], ['newsverse.kr', '뉴스버스(Newsverse)'], ['newsprime.co.kr', '프라임경제'],
  ['news.hidoc.co.kr', '하이닥'], ['newswhoplus.com', '뉴스후플러스'], ['newswatch.kr', '뉴스워치'],
  ['newsworker.co.kr', '뉴스워커'], ['nextdaily.co.kr', '넥스트데일리'], ['ngonews.kr', '한국NGO신문'],
  ['nspna.com', 'NSP NEWS'], ['newsworks.co.kr', '뉴스웍스'], ['niceeconomy.co.kr', '나이스경제'],
  ['nongmin.com', '농민신문'], ['nongaek.com', '논객닷컴'], ['opinionnews.co.kr', '오피니언뉴스'],
  ['paxetv.com', '팍스경제TV'], ['platum.kr', '플래텀'], ['pckworld.com', '한국기독공보'],
  ['osen.co.kr', 'OSEN'], ['onews.tv', '열린뉴스통신'], ['newscape.co.kr', '뉴스케이프'],
  ['ntoday.co.kr', '투데이신문'], ['radiokorea.com', 'RadioKorea'], ['obsnews.co.kr', 'OBS경인TV'],
  ['pdjournal.com', 'PD저널'], ['pharmnews.com', '팜뉴스'], ['pennmike.com', '펜앤마이크'],
  ['pinpointnews.co.kr', '핀포인트뉴스'], ['raonnews.com', '라온신문'], ['newswell.co.kr', '뉴스웰'],
  ['pn.or.kr', '평화뉴스'], ['press9.kr', 'PRESS9'], ['newsroad.co.kr', '뉴스로드'],
  ['popcornnews.net', '팝콘뉴스'], ['newsquest.co.kr', '뉴스퀘스트'], ['pointdaily.co.kr', '포인트데일리'],
  ['pointe.co.kr', '포인트경제'], ['public25.com', '퍼블릭타임스'], ['queen.co.kr', 'Queen 이코노미퀸'],
  ['rapportian.com', '라포르시안'], ['pressman.kr', '프레스맨'], ['redian.org', '레디앙'],
  ['rightknow.co.kr', '알티케이뉴스'], ['rcast.co.kr', '리얼캐스트'], ['sateconomy.co.kr', '토요경제'],
  ['seoultimes.news', '서울타임즈뉴스'], ['newstree.kr', '뉴스;트리(주)'], ['safetimes.co.kr', '세이프타임즈'],
  ['sidae.com', '동행미디어 시대'], ['samdailbo.com', '삼다일보'], ['sejungilbo.com', '세정일보'],
  ['sentv.co.kr', '(주) 서울경제티브이'], ['rookie.co.kr', 'ROOKIE'], ['s-journal.co.kr', 'S저널'],
  ['segyebiz.com', '세계비즈'], ['seoulfn.com', '서울파이낸스'], ['sisanews24.co.kr', '시사뉴스24'],
  ['siminilbo.co.kr', '시민일보'], ['siminsori.com', '시민의소리'], ['snmnews.com', '철강금속신문'],
  ['sisajournal-e.com', '시사저널e'], ['socialvalue.kr', '사회가치 공유 언론-소셜밸류'], ['shinailbo.co.kr', '신아일보'],
  ['sisafocus.co.kr', '시사포커스'], ['sisaon.co.kr', '시사오늘(시사ON)'], ['sisaweek.com', '시사위크'],
  ['smartbizn.com', '스마트비즈'], ['sports.hankooki.com', '스포츠한국'], ['slist.kr', '싱글리스트'],
  ['spotvnews.co.kr', 'SPOTV NEWS'], ['sisunnews.co.kr', '시선뉴스'], ['spochoo.com', '더게이트(THE GATE)'],
  ['sportsworldi.com', '스포츠월드'], ['peoplewatch.co.kr', '피플워치'], ['sommeliertimes.com', '소믈리에타임즈'],
  ['ngetnews.com', '뉴스저널리즘'], ['starnewskorea.com', '스타뉴스'], ['sportsq.co.kr', '스포츠Q(큐)'],
  ['smarttoday.co.kr', '스마트투데이'], ['sportalkorea.com', '스포탈코리아'], ['sportsseoul.com', '스포츠서울'],
  ['stoo.com', '스포츠투데이'], ['swtvnews.com', 'SWTV'], ['taxtimes.co.kr', '한국세정신문-한국대표 조세정론지'],
  ['polinews.co.kr', '폴리뉴스 Polinews'], ['tbc.co.kr', 'TBC 티비씨'], ['srtimes.kr', 'SR타임스'],
  ['starnewsk.com', '케이스타뉴스'], ['suwonilbo.kr', '수원일보'], ['stnsports.co.kr', 'STN NEWS'],
  ['stardailynews.co.kr', '스타데일리뉴스'], ['startuptoday.co.kr', '오늘경제'], ['ppss.kr', 'ㅍㅍㅅㅅ PPSS'],
  ['tbs.seoul.kr', 'TBS'], ['tfmedia.co.kr', '조세금융신문'], ['straightnews.co.kr', '스트레이트뉴스'],
  ['thefirstmedia.net', '더퍼스트미디어'], ['techm.kr', '테크M'], ['realfoods.co.kr', '리얼푸드 REALFOODS'],
  ['safetynews.co.kr', '안전신문'], ['tennis.co.kr', '테니스코리아'], ['tenasia.co.kr', '텐아시아'],
  ['the-pr.co.kr', 'The PR 더피알'], ['the-biz.co.kr', 'THE Biz(더비즈)'], ['the-today.com', '더투데이'],
  ['theopiniontimes.news', '더오피니언타임즈'], ['theguru.co.kr', '더구루'], ['tgdaily.co.kr', '더게임스데일리'],
  ['thedailypost.kr', '데일리포스트'], ['thebk.co.kr', '뷰티경제'], ['tjmbc.co.kr', '대전MBC'],
  ['thelec.kr', '디일렉(THE ELEC)'], ['thetracker.co.kr', '더트래커'], ['theviewers.co.kr', '뷰어스'],
  ['thisisgame.com', '디스이즈게임'], ['thegolftimes.co.kr', '골프타임즈'], ['thefairnews.co.kr', '더페어'],
  ['sjbnews.com', '새전북신문'], ['thebigdata.co.kr', '빅데이터뉴스'], ['thescoop.co.kr', '더스쿠프'],
  ['thepublic.kr', '더퍼블릭'], ['thevaluenews.co.kr', '더밸류뉴스'], ['tokenpost.kr', '토큰포스트'],
  ['tvreport.co.kr', 'TV리포트'], ['todayenergy.kr', '투데이에너지'], ['topdaily.kr', '톱데일리'],
  ['topstarnews.net', '톱스타뉴스'], ['tournews21.com', '투어코리아'], ['tvdaily.co.kr', '티브이데일리'],
  ['todaykorea.co.kr', '투데이코리아'], ['tongilnews.com', '통일뉴스'], ['ttlnews.com', '퍼블릭뉴스통신(Public news-network for TTL)'],
  ['travie.com', '트래비 매거진'], ['thepowernews.co.kr', '더파워'], ['traveltimes.co.kr', '여행신문'],
  ['tjb.co.kr', 'TJB 티제이비'], ['technoa.co.kr', '테크노아'], ['ujeil.com', '울산제일일보'],
  ['viva100.com', '브릿지경제'], ['voakorea.com', 'Voice of America'], ['thebell.co.kr', '더벨'],
  ['upkoreanews.kr', '업코리아'], ['ulsanpress.net', '울산신문'], ['weekly.hankooki.com', '주간한국'],
  ['vegannews.co.kr', '비건뉴스'], ['whosaeng.com', '후생신보'], ['whitepaper.co.kr', '화이트페이퍼'],
  ['venturesquare.net', '벤처스퀘어'], ['wikileaks-kr.org', '위키리크스한국'], ['wkorea.com', 'W Korea'],
  ['veritas-a.com', '베리타스알파'], ['webeconomy.co.kr', '웹이코노미'], ['welfarenews.net', '웰페어뉴스'],
  ['wikitree.co.kr', '위키트리'], ['weeklytoday.com', '위클리오늘'], ['worldkorean.net', '월드코리안뉴스'],
  ['weeklytrade.co.kr', '한국무역신문'], ['worknworld.kctu.org', '노동과세계'], ['widedaily.com', '와이드경제'],
  ['wolyo.co.kr', '월요신문'], ['womentimes.co.kr', '우먼타임스'], ['thereport.co.kr', '더리포트'],
  ['wowtv.co.kr', '한국경제TV'], ['xportsnews.com', '엑스포츠뉴스'], ['ysmbc.co.kr', '여수MBC'],
  ['woodkorea.co.kr', '한국목재신문'], ['womaneconomy.co.kr', '여성경제신문'], ['youthdaily.co.kr', '청년일보'],
  ['yonhapmidas.com', '연합뉴스 월간 마이더스'], ['womennews.co.kr', '여성신문'], ['zdnet.co.kr', 'IT세상을 바꾸는 힘 지디넷코리아'],
  ['yangsanilbo.com', '양산신문'], ['yonhapnewstv.co.kr', '연합뉴스TV'], ['ziksir.com', '직썰'],
  ['tleaves.co.kr', '더리브스'], ['youngnong.co.kr', '한국영농신문'], ['updownnews.co.kr', '업다운뉴스'],
  ['vogue.co.kr', 'Vogue korea'],
];
function guessPressFromUrl(url){
  try{
    const host = new URL(url).hostname.replace(/^www\./, '');
    const hit = PRESS_DOMAIN_MAP.find(([domain]) => host.includes(domain));
    if(hit) return hit[1];
    return host;
  }catch(e){
    return '';
  }
}

/* 언론사 표시명 변환기 — 저장된 값(도메인 등)을 실제 한글 언론사명으로 화면에만 표시.
   구독 식별자(data-outlet)나 저장 데이터는 건드리지 않고 화면 출력 시에만 사용. */
const PRESS_DOMAIN_LOOKUP = new Map(PRESS_DOMAIN_MAP);
function pressDisplayName(name){
  const raw = String(name||'').trim();
  if(!raw) return raw;
  if(PRESS_DOMAIN_LOOKUP.has(raw)) return PRESS_DOMAIN_LOOKUP.get(raw);
  const bare = raw.replace(/^www\./, '');
  if(PRESS_DOMAIN_LOOKUP.has(bare)) return PRESS_DOMAIN_LOOKUP.get(bare);
  return raw;
}
function decodeNaverText(str){
  return String(str||'')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&#39;/g, "'");
}
async function fetchNaverNews(query){
  const url = `${NAVER_PROXY_URL}?query=${encodeURIComponent(query)}&display=${NAVER_DISPLAY}&sort=date`;
  const res = await fetchWithTimeout(url, {cache:'no-store'}, 6000);
  if(!res.ok) throw new Error('네이버 API 호출 실패');
  const data = await res.json();
  if(!data.items) throw new Error('네이버 응답 형식 이상');
  return data.items.map(item=>{
    const rawUrl = item.originallink || item.link;
    const title = decodeNaverText(item.title);
    const fullText = decodeNaverText(item.description);
    return {
      title,
      link: canonicalizeLink(rawUrl),
      pubDate: item.pubDate,
      source: guessPressFromUrl(rawUrl),
      fullText,
      excerpt: fullText.slice(0,500)
    };
  });
}
let NAVER_DISPLAY = 100;

/* 관심뉴스 = 관심 키워드로 네이버 검색. 정당명만 기본으로 얹어 최소 커버리지 확보. */
let NAVER_BASE_QUERIES = ['국민의힘','더불어민주당','조국혁신당','개혁신당'];

async function collectNaverArticles(){
  const kw = keywordsForImportantAll().map(k=>k.label);
  const queries = [...new Set([...NAVER_BASE_QUERIES, ...kw])];
  const merged = [];
  const CHUNK = 5;
  for(let i=0; i<queries.length; i+=CHUNK){
    const part = queries.slice(i, i+CHUNK);
    const results = await Promise.allSettled(part.map(q => fetchNaverNews(q)));
    results.forEach(r=>{ if(r.status==='fulfilled') merged.push(...r.value); });
    if(i + CHUNK < queries.length) await new Promise(r=>setTimeout(r, 200));
  }
  merged.forEach(a=>{ a._via = 'search'; });   // 관심뉴스·키워드 탭에서 실시간(section)과 구분
  return merged;
}

/* 네이버 정치 섹션(news.naver.com/section/100) — 카테고리 확정 정치.
   검색 API엔 카테고리가 없어서 섹션 페이지 HTML을 Worker /fetch로 받아 파싱한다.
   구조: li.sa_item > a.sa_text_title(+strong.sa_text_strong) / .sa_text_press / .sa_text_datetime>b(상대시각) */
const NAVER_SECTION_URL = 'https://news.naver.com/section/100';
function naverRelTimeToTs(s){
  s = String(s || '').replace(/\s+/g, '');
  const now = Date.now();
  let m;
  if(!s || /^방금/.test(s)) return now;
  if((m = s.match(/(\d+)분전/)))   return now - (+m[1]) * 60000;
  if((m = s.match(/(\d+)시간전/))) return now - (+m[1]) * 3600000;
  if((m = s.match(/(\d+)일전/)))   return now - (+m[1]) * 86400000;
  if((m = s.match(/(\d{4})\.(\d{2})\.(\d{2})/))) return new Date(`${m[1]}-${m[2]}-${m[3]}T09:00:00+09:00`).getTime();
  return now; // 시간 미상(헤드라인 카드 등)은 방금으로 취급 — 섹션은 최신순이라 무방
}
function parseNaverSection(htmlText){
  const doc = new DOMParser().parseFromString(htmlText, 'text/html');
  const out = [];
  const seen = new Set();
  doc.querySelectorAll('a.sa_text_title').forEach(a=>{
    const href = a.getAttribute('href') || '';
    if(!/\/article\/\d+\/\d+/.test(href)) return;
    const link = canonicalizeLink(href);
    if(seen.has(link)) return;
    const strong = a.querySelector('.sa_text_strong') || a;
    const title = (strong.textContent || '').replace(/\s+/g, ' ').trim();
    if(title.length < 6) return;
    seen.add(link);
    const item = a.closest('.sa_item') || a.parentElement;
    const pressEl = item && item.querySelector('.sa_text_press');
    const ledeEl  = item && item.querySelector('.sa_text_lede');
    const timeEl  = item && item.querySelector('.sa_text_datetime');
    const excerpt = ledeEl ? (ledeEl.textContent || '').replace(/\s+/g, ' ').trim() : '';
    out.push({
      title, link,
      pubDate: new Date(naverRelTimeToTs(timeEl ? timeEl.textContent : '')).toISOString(),
      source: pressEl ? (pressEl.textContent || '').trim() : '네이버뉴스',
      fullText: excerpt,
      excerpt: excerpt.slice(0, 500),
      _via: 'section'   // 실시간 탭은 이 태그가 붙은 기사만
    });
  });
  return out;
}
async function collectNaverSection(){
  const url = `${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(NAVER_SECTION_URL)}`;
  // Worker의 네이버 섹션 fetch는 대체로 1초 미만이지만 간헐적으로 20초 넘게 걸린다(콜드 스타트·네이버 스로틀).
  // 8초 단일 타임아웃이면 그때마다 실시간 기사가 통째로 0건이 됐다 → 짧게 한 번, 실패하면 길게 한 번 더.
  const timeouts = [10000, 18000];
  let lastErr;
  for(const ms of timeouts){
    try{
      const res = await fetchWithTimeout(url, {cache:'no-store'}, ms);
      if(!res.ok) throw new Error('네이버 섹션 응답 ' + res.status);
      const items = parseNaverSection(await res.text());
      if(items.length) return items;
      lastErr = new Error('네이버 섹션 파싱 0건');
    }catch(e){ lastErr = e; }
  }
  throw lastErr;
}


function loadMoreButtonHtml(viewKey, hasMore){
  if(!hasMore) return '';
  return `<div class="load-more-row"><button class="load-more-btn" data-loadmore="${viewKey}">뉴스 더보기<span class="arrow"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="fill:none;width:15px;height:15px"><path stroke-linecap="round" stroke-linejoin="round" d="M3 4.5h14.25M3 9h9.75M3 13.5h9.75m4.5-4.5v12m0 0-3.75-3.75M17.25 21 21 17.25"/></svg></span></button></div>`;
}
function wireLoadMoreButtons(root, onLoadMore){
  root.querySelectorAll('[data-loadmore]').forEach(btn=>{
    btn.onclick = ()=>{
      const key = btn.dataset.loadmore;
      newsState.showCounts[key] = (newsState.showCounts[key]||LOAD_MORE_STEP) + LOAD_MORE_STEP;
      onLoadMore();
      if(typeof saveViewStateDebounced === 'function') saveViewStateDebounced();
    };
  });
}

/* 수집 = 소스 2개뿐.
   ① 네이버 정치 섹션(news.naver.com/section/100) → 실시간 (_via:'section')
   ② 관심 키워드로 네이버 검색 → 관심뉴스 (_via:'search')
   RSS·신문사 스크레이프·정치 관련도 게이트 전부 제거(2026-09-03, 사장님 지시). */
/* 네이버 미입점 언론사 — 사용자가 언론사 탭에서 직접 등록한 RSS. _via:'custom' → 구독 토글과
   무관하게 항상 노출(직접 등록 = 명시적 구독). 각 피드에 타임아웃, 실패는 deadSince 로 표시만. */
async function collectCustomFeeds(){
  const feeds = customFeedList();
  if(!feeds.length) return [];
  const batches = await Promise.all(feeds.map(async f=>{
    try{
      const items = await fetchOneFeed({ name: f.name, url: f.url });
      const ok = Array.isArray(items) && items.length > 0;
      markCustomFeedHealth(f.id, ok);
      return (items || []).map(it=>{
        let ts = Date.parse(it.pubDate); if(isNaN(ts)) ts = Date.now();
        return {
          title: it.title, link: it.link,
          pubDate: new Date(ts).toISOString(),
          source: f.name,
          fullText: it.fullText || '',
          excerpt: (it.excerpt || it.fullText || '').slice(0, 500),
          _via: 'custom'
        };
      }).filter(a => a.title && a.link);
    }catch(e){ markCustomFeedHealth(f.id, false); return []; }
  }));
  return batches.flat();
}

async function collectArticles(){
  await loadNewsDismissed();
  const fetched = [];

  const [sectionItems, searchItems, customItems] = await Promise.all([
    Promise.race([collectNaverSection().catch(()=> []),  new Promise(r => setTimeout(()=> r([]), 30000))]),
    Promise.race([collectNaverArticles().catch(()=> []), new Promise(r => setTimeout(()=> r([]), 25000))]),
    Promise.race([collectCustomFeeds().catch(()=> []),   new Promise(r => setTimeout(()=> r([]), 20000))])
  ]);
  if(Array.isArray(sectionItems)) fetched.push(...sectionItems);
  if(Array.isArray(searchItems))  fetched.push(...searchItems);
  if(Array.isArray(customItems))  fetched.push(...customItems);

  const cleaned = fetched.filter(a => !isExcludedArticle(a));   // 형식 잡음(운세·부고·사진 등)만
  noteDiscoveredOutlets(cleaned);

  const byLink = new Map(newsState.articles.map(a=>[a.link, a]));
  const newlyAdded = [];
  cleaned.forEach(a=>{
    if(!byLink.has(a.link)){
      const withMeta = {...a, collectedAt: Date.now()};
      byLink.set(a.link, withMeta);
      newlyAdded.push(withMeta);
    }
  });

  // (예전엔 여기서 "이미 읽은 기사와 비슷하면 새 기사도 자동 읽음 처리"를 했는데, readLinks에
  //  들어가면 영구 제외라 "유사한 기사" 슬라이더로도 못 되돌림 — isSimilarToTodaysRead(render 시점,
  //  슬라이더에 반응)가 이미 같은 역할을 조건부로 해주므로 이 영구 mutation은 제거함.)
  const cutoff = Date.now() - NEWS_POOL_WINDOW_MS;
  newsState.articles = Array.from(byLink.values()).filter(a => a.collectedAt >= cutoff);

  const okCount = (Array.isArray(sectionItems) ? sectionItems.length : 0)
              + (Array.isArray(searchItems) ? searchItems.length : 0)
              + (Array.isArray(customItems) ? customItems.length : 0);
  const deadFeeds = customFeedList().filter(f => f.deadSince).map(f => f.name);
  return {okCount, failCount: deadFeeds.length, failedNames: deadFeeds, newlyAdded};
}

function updateNewsStatusLine(okCount, failCount, failedNames){
  if(okCount!==null){
    console.log(`[뉴스 수집] ${okCount}개 성공${failCount?`, ${failCount}개 실패(${(failedNames||[]).join(', ')})`:''} · 기사 ${newsState.articles.length}건(5일 누적)`);
  }
}

let _isCollectingNews = false;

async function refreshNews(bypassCooldown){
  if(_isCollectingNews) return;
  const btn = document.getElementById('newsRefreshBtn');
  if(!bypassCooldown){
    const elapsed = Date.now() - lastSharedSavedAt;
    if(elapsed < COOLDOWN_MS){
      const leftMin = Math.ceil((COOLDOWN_MS - elapsed)/60000);
      perfLog('수집 스킵(쿨다운 ' + leftMin + '분)', 0);
      updateRefreshButtonState();
      return;
    }
  }
  _isCollectingNews = true;
  updateRefreshButtonState();
  if(_cooldownTimer){ clearInterval(_cooldownTimer); _cooldownTimer = null; }
  const __t0 = performance.now();
  try {
    pruneExpiredReadToday();
    pruneExpiredRead();
    const {okCount, failCount, failedNames, newlyAdded} = await collectArticles();
    updateNewsStatusLine(okCount, failCount, failedNames);
    perfLog(`수집 ${okCount}성공/${failCount}실패 +${(newlyAdded||[]).length}신규`, performance.now() - __t0);
    renderAllNewsViews();
    saveArticleCacheLocal();
    await saveArticleCacheShared();
  } catch(e) {
    console.error('[뉴스 수집 실패]', e);
    perfLog('수집 오류: ' + (e && e.message || e), performance.now() - __t0);
  } finally {
    _isCollectingNews = false;
    startCooldownCountdown();
  }
}
document.getElementById('newsRefreshBtn').onclick = function(){ refreshNews(false); };

async function fullRefreshNews(){
  if(!confirm('지금까지 쌓인 기사 목록을 전부 비우고 완전히 새로 불러옵니다. 계속할까요?')) return;
  if(_isCollectingNews) return;
  const btn = document.getElementById('newsFullRefreshBtn');
  const btnLabel = btn.querySelector('.ml') || btn;   // 사이드바 이동 후 아이콘(.mi)까지 지우지 않도록 라벨만 교체
  btn.disabled = true; btnLabel.textContent = '새로 불러오는 중...';
  _isCollectingNews = true;
  updateRefreshButtonState();
  if(_cooldownTimer){ clearInterval(_cooldownTimer); _cooldownTimer = null; }
  try {
    newsState.articles = [];
    pruneExpiredReadToday();
    pruneExpiredRead();
    const __t0 = performance.now();
    const {okCount, failCount, failedNames, newlyAdded} = await collectArticles();
    updateNewsStatusLine(okCount, failCount, failedNames);
    perfLog(`리셋수집 ${okCount}성공/${failCount}실패 ${(newlyAdded||[]).length}건`, performance.now() - __t0);
    renderAllNewsViews();
    saveArticleCacheLocal();
    await saveArticleCacheShared();
  } catch(e) {
    console.error('[리셋 수집 실패]', e);
  } finally {
    btn.disabled = false; btnLabel.textContent = '리셋';
    _isCollectingNews = false;
    startCooldownCountdown();
  }
}
document.getElementById('newsFullRefreshBtn').onclick = fullRefreshNews;

/* 읽은 기사 목록 초기화 — 설정 탭의 아이콘 버튼(hover 말풍선). 개인(기기) 전용 localStorage만 지운다.
   계정 시스템(Bundle C) 이후엔 닉네임별 Firebase 사본도 함께 지우도록 확장할 것. */
function clearReadHistory(){
  const back = document.createElement('div');
  back.className = 'ql-modal-back';
  back.innerHTML = `<div class="ql-modal">
      <h3>- 뺀 기사 초기화</h3>
      <div class="hint">빼기 처리한 기사를 모두 되돌립니다. 계속할까요?</div>
      <div class="ql-actions">
        <button class="subtab-btn" id="readResetCancelBtn">취소</button>
        <button class="subtab-btn" id="readResetOkBtn">초기화</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const close = ()=> back.remove();
  back.querySelector('#readResetCancelBtn').onclick = close;
  guardBackdropClose(back, close);
  back.querySelector('#readResetOkBtn').onclick = ()=>{
    newsState.readLinks.clear();
    newsState.readAt = {};
    newsState.readToday = [];
    if(_readAtSyncTimer){ clearTimeout(_readAtSyncTimer); _readAtSyncTimer = null; }
    dbFetch(userPath('read_at'),    {method:'DELETE'}).catch(()=>{});
    dbFetch(userPath('read_today'), {method:'DELETE'}).catch(()=>{});
    close();
    renderAllNewsViews();
  };
}
document.getElementById('clearReadHistoryBtn').onclick = clearReadHistory;
document.getElementById('scrapAddBtn').onclick = openScrapAddModal;
document.getElementById('headerScrapAddBtn').onclick = openScrapAddModal;
document.getElementById('memoAddBtn')?.addEventListener('click', addPersonalMemo);
// (구) ⚙ 카테고리 관리 모달 버튼은 스패너 방식으로 대체(2026-09-24) — openMemoCatManageModal은 순서 변경용으로 남겨 둠
{
  const qaInput = document.getElementById('memoQuickAdd');
  const qaBtn = document.getElementById('memoQuickAddBtn');
  const submitMemoQuickAdd = async ()=>{
    const raw = qaInput.value.trim();
    if(!raw) return;
    qaBtn.disabled = true; qaInput.disabled = true;
    try{ await quickAddMemo(raw); qaInput.value = ''; }
    finally{ qaBtn.disabled = false; qaInput.disabled = false; qaInput.focus(); }
  };
  qaBtn?.addEventListener('click', submitMemoQuickAdd);
  qaInput?.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') submitMemoQuickAdd(); });
}
{
  // 모바일 홈 인덱스 — 메모 빠른입력 (메모 페이지와 같은 quickAddMemo 재사용, 모달 없이 토스트만)
  const hmInput = document.getElementById('homeMemoQuickAdd');
  const hmBtn = document.getElementById('homeMemoQuickAddBtn');
  const submitHomeMemo = async ()=>{
    const raw = hmInput.value.trim();
    if(!raw) return;
    hmBtn.disabled = true; hmInput.disabled = true;
    try{ await quickAddMemo(raw); hmInput.value = ''; _settingsToast('저장되었습니다'); }
    finally{ hmBtn.disabled = false; hmInput.disabled = false; hmInput.focus(); }
  };
  hmBtn?.addEventListener('click', submitHomeMemo);
  hmInput?.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') submitHomeMemo(); });

  // 모바일 홈 인덱스 — 스크랩 빠른입력
  const hsInput = document.getElementById('homeScrapQuickAdd');
  const hsBtn = document.getElementById('homeScrapQuickAddBtn');
  const submitHomeScrap = async ()=>{
    const raw = hsInput.value.trim();
    if(!raw) return;
    hsBtn.disabled = true; hsInput.disabled = true;
    try{ await quickAddScrap(raw); hsInput.value = ''; _settingsToast('저장되었습니다'); }
    finally{ hsBtn.disabled = false; hsInput.disabled = false; hsInput.focus(); }
  };
  hsBtn?.addEventListener('click', submitHomeScrap);
  hsInput?.addEventListener('keydown', (e)=>{ if(e.key === 'Enter') submitHomeScrap(); });

  document.getElementById('homeLiveBtn')?.addEventListener('click', ()=>{ showMode('news'); showNewsSubtab('live'); });
}

function saveArticleCacheLocal(sync){
  // JSON.stringify + localStorage 쓰기가 기사量이 많을수록 순간적으로 화면을 멈추게 해서,
  // 평소엔 화면이 다 그려진 다음(다음 틱)으로 미룸 — 저장 시점이 아주 조금 늦어질 뿐 기능은 동일.
  // sync=true 는 백그라운드 전환 순간처럼 "다음 틱이 안 올 수도 있는" 상황에서 즉시 저장.
  const write = ()=>{
    try{
      localStorage.setItem(NEWS_CACHE_LOCAL_KEY, JSON.stringify({articles: newsState.articles, savedAt: Date.now()}));
    }catch(e){}
  };
  if(sync) write(); else setTimeout(write, 0);
}
function loadArticleCacheLocal(){
  try{
    const raw = localStorage.getItem(NEWS_CACHE_LOCAL_KEY);
    if(!raw) return null;
    const parsed = JSON.parse(raw);
    return (parsed && Array.isArray(parsed.articles) && parsed.articles.length) ? parsed : null;
  }catch(e){ return null; }
}
async function saveArticleCacheShared(){
  const now = Date.now();
  try{
    await dbFetch(FIREBASE_URL + '/news_pool_cache.json', {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({articles: newsState.articles, savedAt: now})
    });
    lastSharedSavedAt = now;
  }catch(e){}
}
async function loadArticleCacheShared(){
  try{
    const res = await dbFetch(FIREBASE_URL + '/news_pool_cache.json');
    const data = await res.json();
    if(data && typeof data.savedAt === 'number') lastSharedSavedAt = data.savedAt;
    return (data && Array.isArray(data.articles) && data.articles.length) ? data : null;
  }catch(e){ return null; }
}

function updateRefreshButtonState(){
  const btn = document.getElementById('newsRefreshBtn');
  if(!btn) return;
  if(_isCollectingNews){
    btn.disabled = true;
    btn.textContent = '수집 중...';
    return;
  }
  const elapsed = Date.now() - lastSharedSavedAt;
  const remaining = COOLDOWN_MS - elapsed;
  if(remaining > 0){
    const sec = Math.ceil(remaining / 1000);
    const min = Math.floor(sec / 60);
    const s = sec % 60;
    btn.disabled = true;
    // 헤더 한 줄에 들어가도록 짧게 (2026-09-24) — 자세한 문구는 마우스 올리면 보임
    btn.textContent = `갱신 ${min}:${String(s).padStart(2,'0')}`;
    btn.title = min > 0 ? `${min}분 ${s}초 후 갱신 가능` : `${s}초 후 갱신 가능`;
  }else{
    btn.disabled = false;
    btn.textContent = '업데이트';
    btn.title = '';
  }
}

function startCooldownCountdown(){
  if(_cooldownTimer) clearInterval(_cooldownTimer);
  updateRefreshButtonState();
  _cooldownTimer = setInterval(()=>{
    const elapsed = Date.now() - lastSharedSavedAt;
    if(elapsed >= COOLDOWN_MS){
      clearInterval(_cooldownTimer);
      _cooldownTimer = null;
    }
    updateRefreshButtonState();
  }, 1000);
}

let AUTO_COLLECT_HOURS = [6, 12, 16];
const AUTO_COLLECT_SLOT_KEY = 'jungle_auto_collect_slot';
/* 팀 공유 풀이 이 시간보다 오래되면 앱이 떠 있는 동안 자동 수집한다.
   (네이버 섹션 기사는 스크랩 시점에 이미 0~2h 지난 상태라, 수집이 뜸하면 "3시간 창"이 금방 빈다) */
let AUTO_COLLECT_STALE_MS = 14 * 60 * 1000;

function checkFixedScheduleCollect(){
  // 1) 고정 시각 수집 (6·12·16시)
  const now = new Date();
  if(AUTO_COLLECT_HOURS.includes(now.getHours()) && now.getMinutes() === 0){
    const slotKey = now.getFullYear() + '-' + (now.getMonth()+1) + '-' + now.getDate() + '-' + now.getHours();
    if(localStorage.getItem(AUTO_COLLECT_SLOT_KEY) !== slotKey){
      localStorage.setItem(AUTO_COLLECT_SLOT_KEY, slotKey);
      console.log('[고정시각 자동수집] ' + now.getHours() + '시');
      refreshNews(true);
      return;
    }
  }
  // 2) 신선도 기반 — 팀 풀이 14분 넘게 낡았고 지금 수집 중이 아니면 조용히 갱신
  if(_isCollectingNews) return;
  if(Date.now() - lastSharedSavedAt <= AUTO_COLLECT_STALE_MS) return;
  // 다른 기기가 방금 수집했을 수도 있으니 서버 savedAt을 한 번 확인
  dbFetch(FIREBASE_URL + '/news_pool_cache/savedAt.json').then(r=>r.json()).then(serverSavedAt=>{
    if(typeof serverSavedAt === 'number' && serverSavedAt > lastSharedSavedAt) lastSharedSavedAt = serverSavedAt;
    if(!_isCollectingNews && Date.now() - lastSharedSavedAt > AUTO_COLLECT_STALE_MS){
      console.log('[신선도 자동수집] 풀이 ' + Math.round((Date.now()-lastSharedSavedAt)/60000) + '분 지남');
      refreshNews(true);
    }
  }).catch(()=>{});
}

