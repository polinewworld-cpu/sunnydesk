/* 스크랩 탭 — 팀원 스크랩 보기 + 퍼가기 (2026-10-06)
   스크랩 탭 왼쪽 위에 [내 탭 | 팀원 탭] 이 생긴다. 사장님 계정이면 "가피"가 기본이고 옆에 "후니", 후니 계정이면 반대.
   팀원 탭은 읽기 전용으로 메모까지 펼친 채 보여 주고, 핫핑크 "퍼가기"를 누르면 그 스크랩이 내 스크랩으로 복사된다(상대 것은 그대로).
   - 탭 이름·대상은 config.js scrapPeers([{label, email}]). 팀원 목록은 /accounts에서 이메일로 찾는다.
   - 읽기: RTDB 규칙의 users/$uid/saved_news 를 로그인한 팀 계정이 읽을 수 있게 열어 둠(database.rules.json).
   - renderSavedNews()를 감싸서(원본은 그대로 호출) 팀원 탭일 땐 팀원 화면을, 내 탭일 땐 원래 화면을 그린다. */
(function(){
  const origRender = renderSavedNews;
  let view = 'me';                 // 'me' 또는 팀원 uid
  let people = null;               // [{uid,label,me,email}] — 보여 줄 탭 순서(내 탭이 맨 앞)
  let peopleAt = 0;
  const cache = {};                // uid -> {at, items}
  const copiedMap = {};            // 팀원uid|원래키 -> 내 스크랩 키 (이번 접속에서 퍼간 것, 버튼 상태·편집 이동용)

  async function loadPeople(){
    if(people && Date.now() - peopleAt < 5 * 60 * 1000) return people;
    let accounts = {};
    try{ accounts = await dbFetch(`${FIREBASE_URL}/accounts.json`).then(r=> r.json()) || {}; }catch(e){}
    const cfg = (JUNGLE_CONFIG.scrapPeers || []);
    const aliasOf = (email)=> { const p = cfg.find(x=> String(x.email).toLowerCase() === String(email||'').toLowerCase()); return p ? p.label : ''; };
    const me = CURRENT_ACCOUNT ? CURRENT_ACCOUNT.uid : (CURRENT_USER && CURRENT_USER.uid);
    const list = [];
    const myAcc = accounts[me] || {};
    list.push({ uid:'me', me:true, label: aliasOf(myAcc.email) || '내 스크랩' });
    cfg.forEach(p=>{
      const hit = Object.entries(accounts).find(([uid, a])=> uid !== me && String(a.email||'').toLowerCase() === String(p.email).toLowerCase());
      if(hit) list.push({ uid: hit[0], me:false, label: p.label });
    });
    people = list.length > 1 ? list : [];     // 보여 줄 팀원이 없으면 탭 자체를 숨긴다
    peopleAt = Date.now();
    return people;
  }

  function tabsEl(){
    let el = document.getElementById('scrapPeerTabs');
    if(!el){
      const bar = document.querySelector('#savedNewsPanel .saved-toolbar');   // 전체선택·스크랩 추가·리포트작성과 같은 줄, 맨 왼쪽
      if(!bar) return null;
      el = document.createElement('div');
      el.id = 'scrapPeerTabs';
      el.className = 'scrap-peer-tabs';
      el.setAttribute('role', 'tablist');
      bar.insertBefore(el, bar.firstChild);
      el.addEventListener('click', (e)=>{
        const b = e.target.closest('[data-peer]');
        if(!b || b.dataset.peer === view) return;
        view = b.dataset.peer;
        renderSavedNews();
      });
    }
    return el;
  }
  function paintTabs(){
    const el = tabsEl();
    if(!el) return;
    if(!people || !people.length){ el.hidden = true; return; }
    el.hidden = false;
    el.innerHTML = people.map(p=> `<button class="spt-opt${(p.me ? 'me' : p.uid) === view ? ' on' : ''}" data-peer="${p.me ? 'me' : esc(p.uid)}">${esc(p.label)}</button>`).join('');
    const bar = el.parentElement;
    if(bar) bar.classList.toggle('peer-view', view !== 'me');   // 팀원 탭에선 탭만 남기고 내 스크랩용 버튼은 숨김
  }

  /* 팀원 메모는 서식(굵게·형광펜·링크·이미지)을 살리되 위험한 태그·속성은 모두 버린다 */
  function cleanNoteParts(html){
    // DOMParser는 비활성 문서에 파싱해서 <img onerror>·<script>가 정리 전에 실행되지 않는다(div.innerHTML은 이미지를 바로 불러와 onerror가 돈다)
    const tmp = new DOMParser().parseFromString('<body>' + String(html || '') + '</body>', 'text/html').body;
    const ALLOW = new Set(['P','DIV','BR','B','STRONG','I','EM','U','H3','H4','HR','BLOCKQUOTE','UL','OL','LI','A','IMG','SPAN']);
    const walk = (node)=>{
      Array.from(node.childNodes).forEach(ch=>{
        if(ch.nodeType === 3) return;
        if(ch.nodeType !== 1){ ch.remove(); return; }
        if(/^(SCRIPT|STYLE|IFRAME|OBJECT|EMBED|NOSCRIPT|TEMPLATE|SVG|MATH|FORM|INPUT|BUTTON|TEXTAREA|SELECT|LINK|META)$/.test(ch.tagName)){ ch.remove(); return; }
        if(!ALLOW.has(ch.tagName)){ ch.replaceWith(...Array.from(ch.childNodes)); return; }
        const keep = {};
        if(ch.tagName === 'A'){ const h = ch.getAttribute('href') || ''; if(/^https?:\/\//i.test(h)){ keep.href = h; keep.target = '_blank'; keep.rel = 'noopener noreferrer'; } }
        if(ch.tagName === 'IMG'){ const s = ch.getAttribute('src') || ''; if(/^(https:\/\/|data:image\/)/i.test(s)){ keep.src = s; keep.loading = 'lazy'; } else { ch.remove(); return; } }
        if(ch.tagName === 'SPAN'){
          const bg = ch.style.backgroundColor, col = ch.style.color;
          let st = ''; if(bg) st += 'background-color:' + bg + ';'; if(col) st += 'color:' + col + ';';
          if(/url\(|expression|javascript/i.test(st)) st = '';
          if(st) keep.style = st;
        }
        Array.from(ch.attributes).map(a=> a.name).forEach(n=> ch.removeAttribute(n));
        Object.entries(keep).forEach(([k, v])=> ch.setAttribute(k, v));
        walk(ch);
      });
    };
    walk(tmp);
    return { html: tmp.innerHTML, text: tmp.textContent || '' };
  }

  async function loadPeerItems(uid){
    const c = cache[uid];
    if(c && Date.now() - c.at < 60 * 1000) return c.items;
    const res = await dbFetch(`${FIREBASE_URL}/users/${uid}/saved_news.json`);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const data = await res.json();
    const items = (data && typeof data === 'object') ? data : {};
    cache[uid] = { at: Date.now(), items };
    return items;
  }
  const orderOf = (it)=> typeof it.order === 'number' ? it.order : (it.addedAt || 0);

  async function renderPeer(){
    const root = document.getElementById('savedNewsList');
    if(!root) return;
    const p = people.find(x=> x.uid === view);
    if(!p){ view = 'me'; return origRender(); }
    const bar = document.getElementById('savedReportBar'); if(bar) bar.hidden = true;
    root.className = '';
    root.innerHTML = '<div class="empty-hint">불러오는 중…</div>';
    let items;
    try{ items = await loadPeerItems(p.uid); }
    catch(e){ root.innerHTML = `<div class="empty-hint">${esc(p.label)}의 스크랩을 불러오지 못했어요. 새로고침 후 다시 시도해 주세요.</div>`; return; }
    if(view !== p.uid) return;       // 불러오는 사이 다른 탭으로 옮겼으면 그리지 않는다
    const entries = Object.entries(items).sort((a, b)=> orderOf(b[1]) - orderOf(a[1]));
    const head = `<div class="peer-note">${esc(p.label)}의 스크랩 ${entries.length}건 · 읽기 전용 — 마음에 드는 건 "퍼가기"로 내 스크랩에 담아요</div>`;
    if(!entries.length){ root.className = 'saved-list'; root.innerHTML = head + `<div class="empty-hint">${esc(p.label)}의 스크랩이 아직 없어요.</div>`; return; }
    root.className = 'saved-list';
    root.innerHTML = head + entries.map(([key, it])=>{
      const title = it.link
        ? `<a class="sc-title" href="${esc(it.link)}" target="_blank" rel="noopener">${esc(it.title || '(제목 없음)')}</a>`
        : `<span class="sc-title">${esc(it.title || '(제목 없음)')}</span>`;
      const meta = [pressDisplayName(it.source), it.pubDate ? relTimeNews(it.pubDate) : ''].filter(Boolean).join(' · ');
      const cn = cleanNoteParts(it.note);
      const note = (cn.text.trim() || /<img/i.test(cn.html)) ? `<div class="peer-note-body">${cn.html}</div>` : '';
      const embed = it.embed ? `<div class="sns-embed" data-provider="${esc(it.embed.provider)}" data-url="${esc(it.embed.url)}"></div>` : '';
      const myKey = copiedMap[p.uid + '|' + key] || (it.link && newsState.savedNews[linkToSafeKey(it.link)] ? linkToSafeKey(it.link) : '');
      return `<div class="saved-card open peer-card" data-key="${esc(key)}">
        <div class="sc-main"><div class="sc-body">${title}${meta ? `<div class="sc-meta">${esc(meta)}</div>` : ''}${embed}${note}</div>
          <div class="sc-actions">${myKey
            ? `<button class="sc-copy-btn is-mine" data-edit="${esc(myKey)}">내 스크랩에서 편집 →</button>`
            : `<button class="sc-copy-btn" data-copy="${esc(key)}">퍼가기</button>`}</div></div>
      </div>`;
    }).join('');
    try{ renderSnsEmbeds(root); }catch(e){}
    root.querySelectorAll('[data-copy]').forEach(btn=>{
      btn.onclick = async ()=>{
        const key = btn.dataset.copy, src = items[key];
        if(!src) return;
        btn.disabled = true; btn.textContent = '담는 중…';
        const myKey = await copyToMine(p, key, src);
        if(myKey){
          btn.disabled = false; btn.textContent = '내 스크랩에서 편집 →'; btn.classList.add('is-mine');
          btn.removeAttribute('data-copy'); btn.dataset.edit = myKey; btn.onclick = ()=> goEdit(myKey);
        }else{ btn.disabled = false; btn.textContent = '퍼가기'; }
      };
    });
    root.querySelectorAll('[data-edit]').forEach(btn=>{ btn.onclick = ()=> goEdit(btn.dataset.edit); });
  }

  // 내 스크랩 탭으로 돌아가 그 카드의 메모 편집기를 펼치고 커서를 놓는다
  function goEdit(myKey){
    view = 'me';
    try{ savedNoteOpenKeys.add(myKey); }catch(e){}
    renderSavedNews();
    setTimeout(()=>{
      const card = document.querySelector(`#savedNewsList .saved-card[data-key="${CSS.escape(myKey)}"]`);
      if(!card) return;
      card.scrollIntoView({ block:'center', behavior:'smooth' });
      const rich = card.querySelector('.sc-note-rich');
      if(rich) rich.focus();
    }, 150);
  }

  async function copyToMine(p, srcKey, src){
    // 남이 쓴 내용이 내 에디터(contenteditable)에 그대로 들어가면 안 되므로 메모는 정리한 HTML로, 링크는 http(s)만 가져온다
    const mine = JSON.parse(JSON.stringify(src));
    mine.note = cleanNoteParts(src.note).html;
    if(mine.link && !/^https?:\/\//i.test(mine.link)) mine.link = '';
    if(mine.thumbnail && !/^https:\/\//i.test(mine.thumbnail)) delete mine.thumbnail;
    delete mine.reportOn;                                   // 리포트 선택은 내 것으로 새로
    const key = mine.link ? linkToSafeKey(mine.link) : ('m_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6));
    if(newsState.savedNews[key]){ _settingsToast('이미 내 스크랩에 있어요'); copiedMap[p.uid + '|' + srcKey] = key; return key; }
    mine.order = nextSavedOrder();
    mine.addedAt = Date.now();
    mine.copiedFrom = p.label;
    newsState.savedNews[key] = mine;
    const ok = await saveSavedNewsItem(key, mine);
    if(!ok){ delete newsState.savedNews[key]; _settingsToast('퍼가기에 실패했어요 — 새로고침 후 다시 시도해 주세요'); return ''; }
    copiedMap[p.uid + '|' + srcKey] = key;
    try{ renderAllNewsViews(); }catch(e){}                  // 같은 기사가 실시간·관심·키워드 목록에서도 빠지게
    _settingsToast(`${p.label}의 스크랩을 내 스크랩으로 퍼왔어요 — "내 스크랩에서 편집"으로 바로 고칠 수 있어요`);
    return key;
  }

  // renderSavedNews 감싸기 — 호출하는 모든 곳(스크랩 저장·삭제·탭 전환)이 자동으로 이 흐름을 탄다
  renderSavedNews = function(){
    if(!people){
      loadPeople().then(()=>{ paintTabs(); if(people && people.length) renderSavedNews(); }).catch(()=>{});
      return origRender();
    }
    paintTabs();
    if(view !== 'me' && people.length) return renderPeer();
    if(view !== 'me') view = 'me';
    return origRender();
  };
})();
