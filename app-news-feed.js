/* 뉴스 카드·스와이프·실시간/관심 렌더·슬라이더·필터·키워드 탭
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
function saveButtonHtml(article){
  const key = linkToSafeKey(article.link);
  const saved = !!newsState.savedNews[key];
  return `<button class="save-btn${saved?' saved':''}" data-save="${key}"
    data-save-title="${esc(article.title)}" data-save-link="${esc(article.link)}"
    data-save-source="${esc(article.source||'')}" data-save-pubdate="${esc(article.pubDate||'')}"
    ${saved?'disabled':''}>${saved?'✓ 스크랩됨':'+ 스크랩'}</button>`;
}
/* 읽음 = 빼기(화면에서 치움)와 같은 동작이라 문구도 통일. 이 "- 빼기 | + 스크랩" 표기가 앱 전체 표준. */
function actionRowHtml(article){
  return `<div class="action-row">
    <button class="read-btn" data-read="${esc(article.link)}">- 빼기</button>
    <span class="action-sep">|</span>
    ${saveButtonHtml(article)}
  </div>`;
}
function tidyExcerpt(str){
  return String(str||'').replace(/[.\u2026\s]+$/,'') + '\u2026';
}
function newsItemHtml(article, opts){
  opts = opts || {};
  const sub = !!opts.sub;
  const showExcerpt = (opts.excerpt !== false) && !sub;
  const ex = (showExcerpt && article.excerpt)
    ? `<div class="ni-excerpt">${esc(tidyExcerpt(article.excerpt))}</div>` : '';
  const actions = (opts.actionsHtml !== undefined) ? opts.actionsHtml : actionRowHtml(article);
  const metaExtra = opts.metaExtra ? ` · ${esc(opts.metaExtra)}` : '';
  return `<div class="news-item${sub?' ni-sub':''}" data-link="${esc(article.link)}" data-title="${esc(article.title)}" data-source="${esc(article.source||'')}" data-pubdate="${esc(article.pubDate||'')}" data-excerpt="${esc(article.excerpt||'')}">
    <div class="ni-top">
      ${sub?'<span class="ni-arrow"><svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="fill:none;width:14px;height:14px;vertical-align:-2px"><path stroke-linecap="round" stroke-linejoin="round" d="m16.49 12 3.75 3.75m0 0-3.75 3.75m3.75-3.75H3.74V4.499"/></svg></span>':''}
      <a class="ni-title" href="${article.link}" target="_blank" rel="noopener">${esc(article.title)}</a>
      ${actions}
    </div>
    ${ex}
    <div class="ni-meta">${esc(pressDisplayName(article.source)||'')} · ${relTimeNews(article.pubDate)}${metaExtra}</div>
  </div>`;
}

function wireSaveButtons(root){
  root.querySelectorAll('[data-save]').forEach(btn=>{
    btn.onclick = async (e)=>{
      e.stopPropagation();
      const __t0 = performance.now();
      const key = btn.dataset.save;
      if(newsState.savedNews[key]) return;
      const item = {
        title: btn.dataset.saveTitle, link: btn.dataset.saveLink,
        source: btn.dataset.saveSource, pubDate: btn.dataset.savePubdate,
        note: '', tags: [], order: nextSavedOrder(), addedAt: Date.now()
      };
      newsState.savedNews[key] = item;
      btn.disabled = true; btn.classList.add('saved'); btn.textContent = '✓ 스크랩됨';
      await saveSavedNewsItem(key, item);
      renderAllNewsViews(); // 스크랩한 기사는 실시간·관심뉴스·키워드 목록에서 즉시 사라짐
      enrichScrapWithGeminiNewsSummary(key, item.link);   // 배경에서 Gemini 요약으로 발췌요약 대체
      perfLog('스크랩 처리', performance.now() - __t0);
    };
  });
}



function checkFeedEmpty(root){
  if(!root) return;
  const cards = root.querySelectorAll('.news-item:not(.ni-sub), .theme-card');
  const visibleCards = Array.from(cards).filter(c=>!c.classList.contains('swipe-collapsed') && c.style.display !== 'none');
  if(visibleCards.length === 0){
    root.innerHTML = `<div class="empty-hint swipe-finished-hint">오늘 뉴스는 다 봤어요 👏<br><span style="font-size:12px;color:var(--text-faint);">5분 후 새로운 뉴스가 업데이트됩니다</span></div>`;
  }
}

function wireSwipeHandlers(root){
  if(!root) return;
  const cards = root.querySelectorAll('.news-item:not(.ni-sub)');
  cards.forEach(card=>{
    if(card.dataset.swipeWired) return;
    card.dataset.swipeWired = 'true';
    card.classList.add('swipeable-card');

    let startX = 0, startY = 0, currentX = 0, currentY = 0;
    let isSwiping = false, isTouchActive = false;

    card.addEventListener('touchstart', (e)=>{
      if(e.touches.length !== 1) return;
      if(e.target.closest('button, a, input, textarea')) return;

      const touch = e.touches[0];
      startX = touch.clientX;
      startY = touch.clientY;
      currentX = startX;
      currentY = startY;
      isTouchActive = true;
      isSwiping = false;
    }, {passive: true});

    card.addEventListener('touchmove', (e)=>{
      if(!isTouchActive || e.touches.length !== 1) return;
      const touch = e.touches[0];
      currentX = touch.clientX;
      currentY = touch.clientY;

      const deltaX = currentX - startX;
      const deltaY = currentY - startY;

      if(!isSwiping){
        if(Math.abs(deltaX) > Math.abs(deltaY) * 1.5 && Math.abs(deltaX) > 15){
          isSwiping = true;
          card.classList.add('swiping');
        }
      }

      if(isSwiping){
        if(e.cancelable) e.preventDefault();
        card.style.transform = `translate3d(${deltaX}px, 0, 0)`;
        card.style.opacity = Math.max(0.35, 1 - Math.abs(deltaX) / (card.offsetWidth || 350));
      }
    }, {passive: false});

    const endSwipe = ()=>{
      if(!isTouchActive) return;
      isTouchActive = false;
      card.classList.remove('swiping');

      if(!isSwiping){
        card.style.transform = '';
        card.style.opacity = '';
        return;
      }
      isSwiping = false;

      const deltaX = currentX - startX;
      const threshold = Math.max(100, (card.offsetWidth || 350) * 0.4);

      const link = card.dataset.link;
      const title = card.dataset.title;
      const source = card.dataset.source;
      const pubDate = card.dataset.pubdate;

      if(deltaX < -threshold){
        card.classList.add('swipe-dismissing-left');
        if(link){
          newsState.dismissedLinks.add(link);
          saveNewsDismissed();
        }
        setTimeout(()=>{
          card.classList.add('swipe-collapsed');
          setTimeout(()=> checkFeedEmpty(root), 300);
        }, 250);
      }else if(deltaX > threshold){
        card.classList.add('swipe-dismissing-right');
        if(link){
          const key = linkToSafeKey(link);
          const item = {
            title: title || '', link: link,
            source: source || '', pubDate: pubDate || '',
            note: '', tags: [], order: nextSavedOrder(), addedAt: Date.now()
          };
          newsState.savedNews[key] = item;
          saveSavedNewsItem(key, item);
          enrichScrapWithGeminiNewsSummary(key, link);   // 배경에서 Gemini 요약으로 발췌요약 대체
        }
        setTimeout(()=>{
          card.classList.add('swipe-collapsed');
          setTimeout(()=> checkFeedEmpty(root), 300);
        }, 250);
      }else{
        card.style.transform = '';
        card.style.opacity = '';
      }
    };

    card.addEventListener('touchend', endSwipe, {passive: true});
    card.addEventListener('touchcancel', endSwipe, {passive: true});
  });
}

function renderClusteredFeed(rootId, deleteBtnId, windowHours, sortMode, viewKey){
  const root = document.getElementById(rootId);
  // 관심뉴스 화면은 항상 관심뉴스용 유사도·관련성 값으로 계산 (활성 탭과 무관)
  if(viewKey === 'important'){ _dupStep = _importantDupStep; _relevanceStep = _importantRelevanceStep; applyDupStep(_dupStep); }
  const wrapGrid = (inner) => inner ? `<div class="theme-grid">${inner}</div>` : '';

  // 관심뉴스는 유사기사 숨김(readToday)을 적용하지 않는다 — 한 기사를 빼도 유사 기사가 함께 사라지지 않게
  const windowed = articlesWithinHours(visibleArticles(newsOutletScope, { keepSimilar: viewKey === 'important' }), windowHours);
  if(windowed.length===0){
    root.innerHTML = `<div class="empty-hint">최근 ${windowHours}시간 이내 수집된 기사가 없습니다. "최신으로 업데이트"를 눌러보세요.</div>`;
    wireReadButtons(root); wireSaveButtons(root);
    return;
  }
  let clusters = buildImportanceClusters(windowed);
  let themeClusters, singleArticles;

  if(sortMode === 'keyword-priority'){
    // 관심뉴스: 유사도 기반 중복 제거를 쓰지 않는다 (2026-09-07 새 규칙).
    // 키워드에 걸린 기사를 클러스터로 접지 않고 개별로 나열 → 한 기사를 빼도 그 한 건만 사라지고
    // 카드는 유지된다. "유사한 기사" 슬라이더는 관심뉴스에서 무효(실시간에만 적용).
    const consumed = new Set();
    const keywordCards = [];
    const impScope = currentKeywordScope();
    const impKws = keywordsForScope(impScope);
    const allArticles = clusters.flatMap(c => c.articles);
    keywordsForScope(impScope).forEach(kw=>{
      const matched = allArticles.filter(a => !consumed.has(a.link) && keywordMatchesArticle(a, kw));
      if(matched.length === 0) return;

      matched.sort((x,y)=> sortTimeValue(y) - sortTimeValue(x));
      const capped = matched.slice(0, KEYWORD_RELATED_CAP);

      const rep = capped.find(a=>PRIORITY_SOURCES.has(a.source) && a.excerpt)
        || capped.find(a=>PRIORITY_SOURCES.has(a.source))
        || capped.find(a=>a.excerpt)
        || capped[0];
      capped.forEach(a=>consumed.add(a.link));
      // _kwAll/_kwTotal: 카드에 보이는 건 capped(기본 7건)뿐이지만, 리포트 건수·본문은
      // 잘리기 전 실제 수치를 써야 한다(안 그러면 "7건의 기사가 나왔습니다"로 항상 틀림).
      keywordCards.push({articles: capped, rep, sourceSet: new Set(capped.map(a=>a.source)),
        _kwLabel: kw.label, _kwAll: matched, _kwTotal: matched.length});
    });

    // 관심뉴스는 등록 키워드(관심 키워드)에 걸리는 것만 노출 — 안 걸리는 클러스터·단독기사는 완전히 제외 (2026-09-01 확정)
    let filtered = keywordCards;
    if(_relevanceStep > 0){
      filtered = keywordCards.filter(kc=>{
        return kc.articles.some(a=> keywordHitCount(a, impKws) >= RELEVANCE_STEPS[_relevanceStep].min);
      });
    }
    themeClusters = filtered.slice(0, CLUSTER_CAP);
    singleArticles = [];
  }else{

    if(sortMode === 'recency'){
      clusters = [...clusters].sort((a,b)=>{
        const at = Math.max(...a.articles.map(sortTimeValue));
        const bt = Math.max(...b.articles.map(sortTimeValue));
        return bt - at;
      });
    }
    themeClusters = clusters.filter(c=>c.articles.length>=2).slice(0, CLUSTER_CAP);
    singleArticles = clusters.filter(c=>c.articles.length===1).map(c=>c.articles[0]).slice(0, SINGLE_CAP);
  }

  // 관심뉴스: 키워드 그룹 스크랩(뉴스만 / 커뮤니티+뉴스)에서 쓸 기사 목록을 라벨별로 보관.
  // 카드 표시분(capped)이 아니라 잘리기 전 목록·총건수를 넘겨야 리포트 숫자가 맞는다.
  if(viewKey === 'important'){
    _importantKwArticles = {};
    themeClusters.forEach(t=>{
      if(t._kwLabel) _importantKwArticles[t._kwLabel] = { list: t._kwAll || t.articles, total: t._kwTotal || t.articles.length };
    });
  }

  if(themeClusters.length===0 && singleArticles.length===0){
    root.innerHTML = `<div class="empty-hint">표시할 기사가 없습니다.</div>`;
    wireReadButtons(root); wireSaveButtons(root);
    return;
  }

  const totalAvailable = themeClusters.length + singleArticles.length;
  const showCount = newsState.showCounts[viewKey] || LOAD_MORE_STEP;
  const shownThemeClusters = themeClusters.slice(0, showCount);
  const shownSingleArticles = singleArticles.slice(0, Math.max(0, showCount - shownThemeClusters.length));
  const hasMore = (shownThemeClusters.length + shownSingleArticles.length) < totalAvailable;

  const keepAllRelated = (sortMode === 'keyword-priority'); // 관심뉴스: 유사기사도 접지 않고 다 보여준다
  const themeCardsHtml = shownThemeClusters.map((t)=>{
    const relatedHtml = t.articles
      .filter(a=>a!==t.rep)
      .filter(a=> keepAllRelated || !sameStory(t.rep, a))
      .map(a=>newsItemHtml(a, {sub:true})).join('');
    return `
      <div class="theme-card" data-link="${esc(t.rep.link)}" data-title="${esc(t.rep.title)}" data-source="${esc(t.rep.source||'')}" data-pubdate="${esc(t.rep.pubDate||'')}" data-excerpt="${esc(t.rep.excerpt||'')}">
        ${t._kwLabel ? `<div class="theme-tags"><span class="tag">#${esc(t._kwLabel)}</span></div>` : ''}
        <div class="theme-title-row">
          <div class="theme-title"><a href="${t.rep.link}" target="_blank" rel="noopener" style="color:inherit;">${esc(t.rep.title)}</a></div>
          ${actionRowHtml(t.rep)}
        </div>
        ${t.rep.excerpt?`<div class="theme-excerpt">${esc(t.rep.excerpt)}...</div>`:''}
        <div class="theme-meta">${esc(pressDisplayName(t.rep.source))} · ${relTimeNews(t.rep.pubDate)} · ${t.sourceSet.size}개 언론사 · 관련기사 ${t.articles.length}건</div>
        <div class="related-grid">${relatedHtml}</div>
        ${(viewKey==='important' && t._kwLabel) ? `<div class="kw-scrap-row">
          <button class="kw-scrap-btn" data-kws-news="${esc(t._kwLabel)}">뉴스만 스크랩</button>
          <button class="kw-scrap-btn kw-scrap-both" data-kws-both="${esc(t._kwLabel)}">커뮤니티+뉴스 스크랩</button>
        </div>` : ''}
      </div>
    `;
  }).join('');
  const themesHtml = wrapGrid(themeCardsHtml);

  const standaloneHtml = shownSingleArticles.map(a=>newsItemHtml(a)).join('');
  const listHtml = shownSingleArticles.length ? `
    <div class="section-label"><span>개별 헤드라인 ${shownSingleArticles.length}건</span></div>
    <div class="news-grid">${standaloneHtml}</div>
  ` : '';

  root.innerHTML = themesHtml + listHtml + loadMoreButtonHtml(viewKey, hasMore);

  wireReadButtons(root);
  wireSaveButtons(root);
  wireSwipeHandlers(root);
  wireLoadMoreButtons(root, ()=> renderClusteredFeed(rootId, deleteBtnId, windowHours, sortMode, viewKey));
  if(viewKey === 'important'){
    root.querySelectorAll('[data-kws-news]').forEach(b=> b.onclick = ()=> scrapImportantKeyword(b.dataset.kwsNews, false, b));
    root.querySelectorAll('[data-kws-both]').forEach(b=> b.onclick = ()=> scrapImportantKeyword(b.dataset.kwsBoth, true, b));
  }
}

/* 실시간 정렬 — 실시간 키워드 매칭 기사를 무조건 최상단 블록으로, 각 블록 안에서는 최신순.
   (예전 +20분 보너스는 시간창에서 거의 안 보여서 폐기) */
function liveOrder(items, liveKws){
  const byRecent = (a,b)=> sortTimeValue(b) - sortTimeValue(a);
  if(!liveKws.length) return items.slice().sort(byRecent);
  const hit = [], rest = [];
  items.forEach(a=> (hasLiveKeywordMatch(a, liveKws) ? hit : rest).push(a));
  hit.sort(byRecent); rest.sort(byRecent);
  return [...hit, ...rest];
}
function renderLiveFeed(){
  const root = document.getElementById('liveFeedPanel');
  if(!root) return;
  // 실시간 화면은 항상 실시간용 유사도·관련성 값으로 계산
  _dupStep = _liveDupStep; _relevanceStep = _liveRelevanceStep; applyDupStep(_dupStep);
  const viewKey = 'live';
  const liveKws = keywordsForScope('live');
  let pool = visibleArticles('live');
  if(_relevanceStep > 0) pool = pool.filter(a=> relevancePasses(a, liveKws));
  let items = dedupeSimilarTitles(liveOrder(articlesWithinHours(pool, LIVE_WINDOW_HOURS), liveKws));

  // 시간창 안에 기사가 없어도 풀에 뭔가 있으면 최근 순으로 보여준다 (모바일 새로고침 시 빈 화면 방지)
  let fellBack = false;
  if(items.length === 0 && pool.length > 0){
    fellBack = true;
    items = dedupeSimilarTitles(liveOrder(pool.slice(), liveKws));
  }

  if(items.length===0){
    root.innerHTML = `<div class="empty-hint">아직 수집된 기사가 없습니다. "업데이트"를 눌러보세요.</div>`;
    return;
  }
  // 대체 노출(fellBack) 상태에선 선택한 시간창을 이미 벗어난 기사들이라 "더보기"로 계속 파고들면
  // 안내문 없이 며칠 전 기사까지 나오게 됨 — 딱 한 번, 고정된 개수만 보여주고 더보기는 열지 않는다.
  // 더 보고 싶으면 시간창 슬라이더를 직접 넓히도록 유도.
  const showCount = fellBack ? LOAD_MORE_STEP : (newsState.showCounts[viewKey] || LOAD_MORE_STEP);
  const shown = items.slice(0, showCount);
  const hasMore = !fellBack && shown.length < items.length;
  root.innerHTML =
    (fellBack ? `<div class="feed-fallback-note">최근 ${LIVE_WINDOW_HOURS}시간 창에 새 기사가 없어 최근 기사를 보여드려요. 새로 받으려면 "업데이트".</div>` : '')
    + `<div class="news-grid">${shown.map(a=>newsItemHtml(a)).join('')}</div>`
    + loadMoreButtonHtml(viewKey, hasMore);
  wireReadButtons(root);
  wireSaveButtons(root);
  wireSwipeHandlers(root);
  wireLoadMoreButtons(root, renderLiveFeed);
}
function renderImportantNews(){
  const __t0 = performance.now();
  renderClusteredFeed('importantNewsPanel', 'importantDeleteBtn', IMPORTANT_WINDOW_HOURS, 'keyword-priority', 'important');
  perfLog('관심뉴스 탭 계산', performance.now() - __t0);
}

function initClusterSlider(){
  const slider  = document.getElementById('clusterSlider');
  const label   = document.getElementById('clusterSliderLabel');
  const preview = document.getElementById('clusterSliderPreview');
  const ticks   = document.getElementById('clusterSliderTicks');
  if(!slider || !label) return;

  let previewHideTimer = null;

  // 슬라이더 눈금 — 어디까지 끌면 어느 단계인지 보이도록. LIVE_WINDOW_STEPS를 단일 출처로 사용.
  function renderTicks(activeStep){
    if(!ticks) return;
    ticks.innerHTML = LIVE_WINDOW_STEPS.map((s, i)=>{
      const short = s.label.replace(/\s*내$/, '');
      return `<span class="slider-tick${i===activeStep?' active':''}" data-step="${i}">${short}</span>`;
    }).join('');
    ticks.querySelectorAll('.slider-tick').forEach(t=>{
      t.onclick = ()=>{
        const step = parseInt(t.dataset.step, 10);
        slider.value = String(step);
        slider.dispatchEvent(new Event('input',  {bubbles:true}));
        slider.dispatchEvent(new Event('change', {bubbles:true}));
      };
    });
  }

  // 실시간·관심뉴스 중 지금 보고 있는 탭의 시간창을 조절 (두 탭이 독립적인 값을 가짐)
  const isImp = () => newsState.activeSubtab === 'important';
  const cur = activeWindowStep();
  slider.value = String(cur);
  label.textContent = LIVE_WINDOW_STEPS[cur].label;
  renderTicks(cur);

  // 드래그 중엔 라벨과 미리보기 개수만 잠깐 보여주고, 1.2초 뒤 미리보기는 자동으로 사라짐
  function showPreview(step){
    if(!preview) return;
    const pool = isImp() ? visibleArticles(newsOutletScope) : visibleArticles('live');
    const windowed = articlesWithinHours(pool, LIVE_WINDOW_STEPS[step].hours);
    const deduped = dedupeSimilarTitles(windowed.sort((a,b)=>sortTimeValue(b)-sortTimeValue(a)));
    preview.textContent = `${deduped.length}개 기사`;
    preview.classList.add('active');
    if(previewHideTimer) clearTimeout(previewHideTimer);
    previewHideTimer = setTimeout(()=> preview.classList.remove('active'), 1200);
  }

  slider.oninput = () => {
    const step = parseInt(slider.value, 10);
    label.textContent = LIVE_WINDOW_STEPS[step].label;
    renderTicks(step);
    showPreview(step);
  };
  // 손을 뗀 순간(change) 별도 '적용' 버튼 없이 바로 반영
  slider.onchange = () => {
    const step = parseInt(slider.value, 10);
    applyActiveWindowStep(step);
    if(isImp()){ newsState.showCounts.important = LOAD_MORE_STEP; renderImportantNews(); }
    else       { newsState.showCounts.live = LOAD_MORE_STEP; renderLiveFeed(); }
  };
}

function initDupSlider(){
  const slider  = document.getElementById('dupSlider');
  const label   = document.getElementById('dupSliderLabel');
  const preview = document.getElementById('dupSliderPreview');
  const ticks   = document.getElementById('dupSliderTicks');
  if(!slider || !label) return;

  let previewHideTimer = null;

  function renderTicks(activeStep){
    if(!ticks) return;
    ticks.innerHTML = DUP_STEPS.map((s, i)=>
      `<span class="slider-tick${i===activeStep?' active':''}" data-step="${i}">${s.label}</span>`).join('');
    ticks.querySelectorAll('.slider-tick').forEach(t=>{
      t.onclick = ()=>{
        slider.value = String(t.dataset.step);
        slider.dispatchEvent(new Event('input',  {bubbles:true}));
        slider.dispatchEvent(new Event('change', {bubbles:true}));
      };
    });
  }

  slider.value = String(_dupStep);
  label.textContent = DUP_STEPS[_dupStep].label;
  renderTicks(_dupStep);

  function showPreview(step){
    if(!preview) return;
    const cur = _dupStep;
    applyDupStep(step);
    const isImp = newsState.activeSubtab === 'important';
    const hrs = isImp ? IMPORTANT_WINDOW_HOURS : LIVE_WINDOW_HOURS;
    const windowed = articlesWithinHours(visibleArticles(isImp ? newsOutletScope : 'live'), hrs);
    const deduped = dedupeSimilarTitles(windowed.sort((a,b)=>sortTimeValue(b)-sortTimeValue(a)));
    applyDupStep(cur);
    preview.textContent = `${deduped.length}개 기사`;
    preview.classList.add('active');
    if(previewHideTimer) clearTimeout(previewHideTimer);
    previewHideTimer = setTimeout(()=> preview.classList.remove('active'), 1200);
  }

  slider.oninput = () => {
    const step = parseInt(slider.value, 10);
    label.textContent = DUP_STEPS[step].label;
    renderTicks(step);
    showPreview(step);
  };
  slider.onchange = () => {
    const step = parseInt(slider.value, 10);
    saveDupStep(step);
    applyDupStep(step);
    newsState.showCounts.live = LOAD_MORE_STEP;
    newsState.showCounts.important = LOAD_MORE_STEP;
    renderAllNewsViews();
  };
}

/* "기사 관련성" 슬라이더 (낮음/중간/높음) */
function initRelevanceSlider(){
  const slider = document.getElementById('relSlider');
  const label  = document.getElementById('relSliderLabel');
  const ticks  = document.getElementById('relSliderTicks');
  if(!slider || !label) return;
  function renderTicks(active){
    if(!ticks) return;
    ticks.innerHTML = RELEVANCE_STEPS.map((s,i)=>
      `<span class="slider-tick${i===active?' active':''}" data-step="${i}">${s.label}</span>`).join('');
    ticks.querySelectorAll('.slider-tick').forEach(t=>{
      t.onclick = ()=>{ slider.value = String(t.dataset.step);
        slider.dispatchEvent(new Event('input',{bubbles:true}));
        slider.dispatchEvent(new Event('change',{bubbles:true})); };
    });
  }
  slider.value = String(_relevanceStep);
  label.textContent = RELEVANCE_STEPS[_relevanceStep].label;
  renderTicks(_relevanceStep);
  slider.oninput = ()=>{
    const step = parseInt(slider.value, 10);
    label.textContent = RELEVANCE_STEPS[step].label;
    renderTicks(step);
  };
  slider.onchange = ()=>{
    saveRelevanceStep(parseInt(slider.value, 10));
    newsState.showCounts.live = LOAD_MORE_STEP;
    newsState.showCounts.important = LOAD_MORE_STEP;
    renderAllNewsViews();
  };
}

/* "키워드 정확도" 슬라이더 (낮음/중간/높음) — "기사 관련성"과 같은 패턴 */
function initSynonymSlider(){
  const slider = document.getElementById('synSlider');
  const label  = document.getElementById('synSliderLabel');
  const ticks  = document.getElementById('synSliderTicks');
  if(!slider || !label) return;
  function renderTicks(active){
    if(!ticks) return;
    ticks.innerHTML = SYNONYM_STEPS.map((s,i)=>
      `<span class="slider-tick${i===active?' active':''}" data-step="${i}">${s.label}</span>`).join('');
    ticks.querySelectorAll('.slider-tick').forEach(t=>{
      t.onclick = ()=>{ slider.value = String(t.dataset.step);
        slider.dispatchEvent(new Event('input',{bubbles:true}));
        slider.dispatchEvent(new Event('change',{bubbles:true})); };
    });
  }
  slider.value = String(_synonymStep);
  label.textContent = SYNONYM_STEPS[_synonymStep].label;
  renderTicks(_synonymStep);
  slider.oninput = ()=>{
    const step = parseInt(slider.value, 10);
    label.textContent = SYNONYM_STEPS[step].label;
    renderTicks(step);
  };
  slider.onchange = ()=>{
    saveSynonymStep(parseInt(slider.value, 10));
    newsState.showCounts.live = LOAD_MORE_STEP;
    newsState.showCounts.important = LOAD_MORE_STEP;
    renderAllNewsViews();
  };
}

function initFilterToggle(){
  const btn = document.getElementById('filterToggleBtn');
  if(!btn || btn.dataset.wired) return;
  btn.dataset.wired = '1';
  btn.onclick = ()=>{ setFilterPanelOpen(!_filterPanelOpen); syncFilterPanel(); };
}
/* 필터 바(언론사 토글 + [필터] 버튼) + 슬라이더 패널 열기/닫기 */
function syncFilterPanel(){
  const tab = newsState.activeSubtab;
  const twoBarTab = (tab === 'live' || tab === 'important');
  const bar = document.getElementById('filterBar');
  const row = document.getElementById('sliderRow');
  const btn = document.getElementById('filterToggleBtn');
  const scope = document.getElementById('outletScopeBar');
  if(btn) btn.style.display = twoBarTab ? '' : 'none';   // [필터] 버튼은 실시간·관심뉴스만
  // 키워드 탭 — 스패너 버튼(언론사 행 왼쪽)으로 칩의 ✎·✕를 켜고 끔 (2026-09-24)
  const wrench = document.getElementById('kwWrenchBtn');
  if(wrench) wrench.style.display = tab === 'keyword' ? '' : 'none';
  const open = _filterPanelOpen && twoBarTab;
  if(row) row.style.display = open ? 'flex' : 'none';
  if(btn){
    btn.classList.toggle('open', open);
    btn.setAttribute('aria-expanded', open ? 'true' : 'false');
  }
  // 필터 바는 [필터] 버튼이나 언론사 토글 중 하나라도 보일 때만
  const scopeShown = scope && scope.style.display !== 'none';
  if(bar) bar.style.display = (twoBarTab || scopeShown) ? 'flex' : 'none';
}

/* 실시간·관심뉴스·키워드 탭 상단의 언론사 범위 토글 (공유) */
function renderOutletScopeToggle(){
  const sub = document.getElementById('osbSubscribed');
  const all = document.getElementById('osbAll');
  if(!sub || !all) return;
  sub.classList.toggle('active', newsOutletScope === 'subscribed');
  all.classList.toggle('active', newsOutletScope === 'all');
  const pick = (v)=>()=>{
    if(newsOutletScope === v) return;
    setNewsOutletScope(v);
    renderOutletScopeToggle();
    newsState.showCounts.live = LOAD_MORE_STEP;
    newsState.showCounts.important = LOAD_MORE_STEP;
    newsState.showCounts.keyword = LOAD_MORE_STEP;
    renderAllNewsViews();
  };
  sub.onclick = pick('subscribed');
  all.onclick = pick('all');
}

/* scope:
   'live'       = 실시간 탭 — 네이버 정치 섹션 기사. 언론사 범위 토글(newsOutletScope) 적용.
   'subscribed' = 관심뉴스·키워드 — 구독 언론사만 (섹션·검색 둘 다)
   'all'        = 관심뉴스·키워드 "전체 기사" — 언론사 필터 없음
   실시간·관심뉴스·키워드가 하나의 newsOutletScope 토글(기본 'all')을 공유한다. */
function visibleArticles(scope, opts){
  let pool = newsState.articles;
  if(scope === 'live'){
    // 실시간 = 네이버 정치섹션 + 직접 등록한 미입점 언론사(_via:'custom')
    pool = pool.filter(a => a._via === 'section' || a._via === 'custom');
    if(newsOutletScope === 'subscribed') pool = pool.filter(a => a._via === 'custom' || isSubscribedOutlet(a.source));
  }else if(scope !== 'all'){
    pool = pool.filter(a => a._via === 'custom' || isSubscribedOutlet(a.source));
  }
  if(newsState.dismissedLinks.size>0){
    pool = pool.filter(a => !newsState.dismissedLinks.has(a.link));
  }
  // 읽음 처리한 기사 그 자체 — 예전엔 여기서 안 걸러지고 '유사기사 숨김'(readToday)에만 의존해서
  // 실시간 탭에서 읽음 눌러도 간헐적으로 안 사라지는 문제가 있었음. 직접 필터링으로 확실히 고정.
  if(newsState.readLinks.size>0){
    pool = pool.filter(a => !newsState.readLinks.has(a.link));
  }
  if(!(opts && opts.keepSimilar) && newsState.readToday && newsState.readToday.length>0){
    pool = pool.filter(a => !isSimilarToTodaysRead(a));
  }
  // 스크랩·존안으로 넘어간 기사는 실시간·관심뉴스·키워드 탭에서 완전히 사라짐 (2026-09-01 확정)
  pool = pool.filter(a=>{
    const key = linkToSafeKey(a.link);
    return !newsState.savedNews[key] && !newsState.archived[key];
  });
  return pool;
}

/* 스패너 버튼 — 칩의 ✎(수정)·✕(삭제)는 평소엔 숨기고, 스패너를 눌렀을 때만 보인다 (2026-09-24).
   키워드 탭·존안 카테고리·메모 카테고리 공통: data-wrench-for="대상 id"인 요소에 .edit-mode를 토글.
   칩 줄은 innerHTML로 다시 그려져도 대상 요소 자체의 class는 그대로라 상태가 유지된다. */
document.addEventListener('click', (e)=>{
  const btn = e.target.closest('[data-wrench-for]');
  if(!btn) return;
  const target = document.getElementById(btn.dataset.wrenchFor);
  if(!target) return;
  const on = target.classList.toggle('edit-mode');
  btn.classList.toggle('open', on);
  btn.setAttribute('aria-pressed', on ? 'true' : 'false');
});
/* 스패너 켠 상태(.edit-mode)에서 칩을 끌어 순서 바꾸기 — 존안·메모 카테고리 공통 (2026-09-24).
   미분류 칩은 itemSelector에 안 걸려서 맨 앞 고정. 마우스·터치 둘 다 되도록 pointer 이벤트 사용
   (HTML5 drag는 터치에서 안 되고, 카드→칩으로 끌어 분류하는 기존 드래그와도 겹침).
   칩 줄은 innerHTML로 다시 그려져도 컨테이너는 그대로라 리스너는 한 번만 붙인다. */
function enableChipReorder(container, itemSelector, keyAttr, onReorder){
  if(!container || container._reorderOn) return;
  container._reorderOn = true;
  let drag = null;
  let suppressClickUntil = 0;
  container.addEventListener('click', e=>{
    if(Date.now() < suppressClickUntil){ e.stopPropagation(); e.preventDefault(); }
  }, true);
  container.addEventListener('pointerdown', e=>{
    if(!container.classList.contains('edit-mode') || e.button !== 0) return;
    const chip = e.target.closest(itemSelector);
    if(!chip || !container.contains(chip) || e.target.closest('.sh-edit, .sh-del')) return;
    drag = { chip, x:e.clientX, y:e.clientY, moved:false, id:e.pointerId };
  });
  container.addEventListener('pointermove', e=>{
    if(!drag || e.pointerId !== drag.id) return;
    if(!drag.moved){
      if(Math.abs(e.clientX - drag.x) + Math.abs(e.clientY - drag.y) < 6) return;
      drag.moved = true;
      drag.chip.classList.add('reordering');
      try{ container.setPointerCapture(e.pointerId); }catch(_){}
    }
    const hit = document.elementFromPoint(e.clientX, e.clientY);
    const over = hit && hit.closest(itemSelector);
    if(!over || over === drag.chip || !container.contains(over)) return;
    const r = over.getBoundingClientRect();
    const after = e.clientX > r.left + r.width / 2;
    container.insertBefore(drag.chip, after ? over.nextSibling : over);
  });
  const end = ()=>{
    if(!drag) return;
    const d = drag; drag = null;
    if(!d.moved) return;
    d.chip.classList.remove('reordering');
    suppressClickUntil = Date.now() + 300;   // 드래그 끝의 click이 필터 선택으로 먹히지 않게
    onReorder([...container.querySelectorAll(itemSelector)].map(c=> c.getAttribute(keyAttr)));
  };
  container.addEventListener('pointerup', end);
  container.addEventListener('pointercancel', end);
}
/* 이름 수정 모달 — 동의어 수정 모달과 같은 모양. onSave(새 이름)는 값이 바뀌었을 때만 호출 */
function openRenameModal(title, current, onSave){
  const back = document.createElement('div');
  back.className = 'ql-modal-back';
  back.innerHTML = `<div class="ql-modal">
      <h3>${esc(title)}</h3>
      <div class="ql-row"><input type="text" id="renameInput" value="${esc(current)}"></div>
      <div class="ql-actions">
        <button class="subtab-btn" id="renameCancelBtn">취소</button>
        <button class="subtab-btn" id="renameSaveBtn">저장</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const input = back.querySelector('#renameInput');
  input.focus(); input.select();
  const close = ()=> back.remove();
  const save = ()=>{
    const v = input.value.trim();
    close();
    if(v && v !== current) onSave(v);
  };
  back.querySelector('#renameCancelBtn').onclick = close;
  back.querySelector('#renameSaveBtn').onclick = save;
  guardBackdropClose(back, close);
  input.addEventListener('keydown', (e)=>{ if(e.key==='Enter') save(); if(e.key==='Escape') close(); });
}
function renderKeywordToggleGrid(){
  const el = document.getElementById('keywordToggleGrid');
  if(newsState.keywords.length===0){
    el.innerHTML = `<div class="empty-hint">상단에서 키워드를 먼저 추가하세요.</div>`;
    return;
  }
  const pool = visibleArticles(newsOutletScope).filter(a=>!newsState.readLinks.has(a.link));
  const chip = (k, groupClass) => {
    const count = pool.filter(a=>keywordMatchesArticle(a, k)).length;
    return `
      <div class="kw-toggle ${groupClass} ${newsState.selectedKeywords.has(k.id)?'checked':''}" data-id="${esc(k.id)}">
        #${esc(k.label)} <span class="count">${count}</span>
        <span class="kw-toggle-edit" data-edit="${esc(k.id)}" title="동의어 수정">✎</span>
        <span class="kw-toggle-del" data-del="${esc(k.id)}" title="이 키워드 삭제">✕</span>
      </div>
    `;
  };
  // 실시간·관심 키워드를 한 줄로 통합(2026-09-24) — 예전엔 두 묶음으로 나눠 그려서
  // 공유 키워드(이재명·국민의힘 등)가 양쪽에 똑같이 두 번씩 떴음. 키워드마다 한 번만 표시.
  el.innerHTML =
      `<div class="kw-toggle-row">${newsState.keywords.map(k=>chip(k,'kw-live')).join('')}</div>`;
  el.querySelectorAll('.kw-toggle').forEach(t=>{
    t.onclick = ()=>{
      const id = t.dataset.id;
      if(newsState.selectedKeywords.has(id)) newsState.selectedKeywords.delete(id);
      else newsState.selectedKeywords.add(id);
      renderKeywordToggleGrid();
      renderKeywordResults();
    };
  });
  // 키워드 탭은 실시간·관심뉴스 전체를 한데 모아 보여주는 화면이라, 어느 세트에 속한
  // 키워드인지 몰라도 여기서 바로 지울 수 있어야 한다(2026-09-22, 사장님 지적 — 관리줄은
  // 지금 보고 있는 세트 것만 나와서 다른 세트 키워드는 지울 방법이 없었음).
  el.querySelectorAll('.kw-toggle-del').forEach(x=>{
    x.onclick = async (e)=>{
      e.stopPropagation();
      await deleteNewsKeyword(x.dataset.del);
      renderKeywordManageRow();
      renderKeywordToggleGrid();
      renderKeywordResults();
    };
  });
  el.querySelectorAll('.kw-toggle-edit').forEach(x=>{
    x.onclick = (e)=>{
      e.stopPropagation();
      const kw = newsState.keywords.find(k=>k.id===x.dataset.edit);
      if(kw) openKeywordEditModal(kw, ()=>{ renderKeywordToggleGrid(); renderKeywordResults(); });
    };
  });
}

function renderKeywordResults(){
  const root = document.getElementById('keywordResultList');
  if(newsState.selectedKeywords.size===0){
    root.innerHTML = `<div class="empty-hint">위에서 키워드를 하나 이상 누르면 관련 기사가 여기 나열됩니다.</div>`;
    return;
  }
  const selectedKws = newsState.keywords.filter(k=>newsState.selectedKeywords.has(k.id));
  let matched = visibleArticles(newsOutletScope).filter(a=>{
    if(newsState.readLinks.has(a.link)) return false;
    for(const kw of selectedKws){ if(keywordMatchesArticle(a, kw)) return true; }
    return false;
  }).sort((a,b)=> sortTimeValue(b) - sortTimeValue(a));
  matched = dedupeSimilarTitles(matched);

  if(matched.length===0){
    root.innerHTML = `<div class="empty-hint">일치하는 기사가 없습니다.</div>`;
    return;
  }
  const showCount = newsState.showCounts.keyword || LOAD_MORE_STEP;
  const shown = matched.slice(0, showCount);
  const hasMore = shown.length < matched.length;
  root.innerHTML = `<div class="news-grid">` + shown.map(a=>newsItemHtml(a)).join('')
    + `</div>` + loadMoreButtonHtml('keyword', hasMore);
  root.querySelectorAll('[data-read]').forEach(btn=>{
    btn.onclick = ()=> markAsRead(btn.dataset.read);
  });
  wireSaveButtons(root);
  wireSwipeHandlers(root);
  wireLoadMoreButtons(root, renderKeywordResults);
}

