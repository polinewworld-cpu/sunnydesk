/* ======================================================================
   뉴스추천 탭 (별칭: 사각지대 탭) — 기능정의서 v0.4 §4.1~4.4 (2026-10-04)
   - 풀 탭을 훑은 뒤 놓친 이슈를 신호 숫자로 올려주는 "두 번째 눈". AI 추천·중요도 판정 없음.
   - 수집 담당(리더) 탭 하나만 15분마다: 기사 풀 + 경쟁 유튜브 RSS + 1티어 SNS(4조 순환) →
     브라우저 임베딩(multilingual-e5-small, Web Worker)으로 같은 이슈 묶기 → RTDB /recommend 저장.
   - 나머지 탭(휴대폰 포함)은 묶음 결과만 읽어서 카드로 보여준다(모델 안 받음).
   - 실측(2026-10-04, 실제 기사 800건): 제목+요약 150자, 평균유사도 0.90 + 최소유사도 0.86에서
     이슈 단위로 섞임 없이 묶임. 모델 첫 다운로드 약 118MB(수집 PC만, 이후 브라우저 캐시).
   app.js 전역(dbFetch, FIREBASE_URL, newsState, userPath, esc, …)을 그대로 쓴다. app.js 다음에 로드.
   ====================================================================== */

/* ---------- 설정값 (쓰면서 조정) ---------- */
const RC = {
  VER: 2,                           // 수집 로직 버전. 새 버전 탭은 옛 버전 탭이 쥔 담당 자리를 즉시 넘겨받는다(2026-10-06 — 옛 코드 탭이 자리를 쥐고 안 놓아 수정이 반영 안 됐음). 수집 코드를 고치면 올릴 것
  CYCLE_MS: 15 * 60 * 1000,         // 수집 주기 (2026-10-04 5분→15분, 사장님 지시)
  LOOKBACK_MS: 3 * 3600 * 1000,     // 추천 시작 = 다음 방송 3시간 전
  LEASE_MS: 6 * 60 * 1000,          // 수집 담당 유지 시간(1분마다 갱신)(담당 탭이 꺼지면 이 시간 뒤 다른 탭이 이어받음)
  TICK_MS: 60 * 1000,
  MODEL: 'Xenova/multilingual-e5-small',
  TF_URL: 'https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js',
  JOIN: 0.90,                       // 묶음 평균 유사도가 이 값 이상이면 같은 이슈
  GAP: 0.04,                        // 묶음 안 최소 유사도는 JOIN-GAP 이상(사슬처럼 번지는 것 방지)
  MAYBE: 0.88,                      // MAYBE~JOIN 사이면서
  MAYBE_PAIR: 0.92,                 //   묶음 안 어떤 항목과는 이 값 이상이면 "비슷할 수도"
  FB_JOIN: 0.40, FB_MAYBE: 0.28,    // 임베딩 실패 시 단어 비교(자카드) 대체 기준
  POOL_MS: 72 * 3600 * 1000,        // 묶기 대상 기간(기사 풀이 3일)
  KEEP_MS: 14 * 86400 * 1000,       // 보관 기간
  REBUILD_MS: 6 * 3600 * 1000,      // 묶음 전체 재계산 주기
  SNS_GROUPS: 4,                    // 1티어를 4조로 나눠 15분마다 한 조 → 의원 한 명당 1시간에 한 번
  // 노출은 절대 기준(기사 N건 이상 등)이 아니라 상대 순위다(2026-10-06 사장님 지시): 후보 전체에 점수를 매겨 위에서 MAX_CARDS개를 보여주고,
  // 하나를 빼거나(무시) 스크랩하면 그 자리를 다음 순위가 채운다. 점수 = (집계 기간 기사 수 + 유튜브 곳수×3 + SNS 인원×3) × 신선도.
  // 신선도 = 0.5^(이슈 첫 기사 이후 경과 시간 / FRESH_HALF_MS) — 오래된 이슈를 자르지 않고 순위만 낮춘다(어제 이슈가 새 이슈를 밀어내지 않게).
  FRESH_HALF_MS: 12 * 3600 * 1000,
  FRESH_MS: 12 * 3600 * 1000,       // 대기 구간(방송 집계 시작 전) 목록의 시작 시각 한도로만 쓴다
  STORE_MS: 36 * 3600 * 1000,       // 묶음 기록 보관 대상 = 첫 기사가 이 시간 안(그보다 오래된 이슈는 점수가 너무 낮아 저장 안 함)
  FRESH_MIN_TOTAL: 2,               // 이슈 전체 기사 2건 이상(한 건짜리는 이슈가 아님)
  W_YT: 3, W_SNS: 3,
  ATTACH_SIM: 0.90,                 // 유튜브·SNS → 가장 비슷한 기사와 이 값 이상 + 핵심 단어 공유면 그 묶음에 붙임
  REAPPEAR_RATIO: 2,                // 무시 시점 대비 약 2배면 다시 띄움
  MAX_CARDS: 15,                    // 한 번에 보여주는 추천 카드 수(사장님 지시 2026-10-06, 10→15)
  PREVIEW_WHEN_WAITING: false,   // (미사용 — 대기 구간은 rcWindow가 지난 방송 이후로 이어서 보여준다)      // 끔(2026-10-05): 미리보기가 켜져 있으면 시작 시각(11시·16시)에 24시간 목록이 통째로 사라지고, 어제 이슈가 다시 뜸
  DUP_JACCARD: 0.4,                 // 대표 제목 단어가 이만큼 겹치면 같은 이슈로 보고 한 카드로 합침(실측: 겹침 0.4↑ 10쌍 전부 같은 이슈)
  SORT: 'recent',                   // 'recent'=마지막 추가 시각순 / 'signal'=신호 합계순
  NEW_BLINK_MS: 60 * 1000,          // NEW 깜박임 시간
  DETAIL_MAX: 30,                   // 카드 펼치기에 담는 항목 수(묶음당)
  POLL_ON_MS: 60 * 1000,            // 탭 보고 있을 때 갱신 간격
  POLL_OFF_MS: 3 * 60 * 1000        // 다른 화면일 때(배지용)
};
const RC_BASE = () => `${FIREBASE_URL}/recommend`;
const X_WORKER_URL = 'https://x-search-worker.YOUR-ACCOUNT.workers.dev/search';

/* ---------- 공통 헬퍼 ---------- */
function rcHash(s){
  let h = 0x811c9dc5;
  s = String(s || '');
  for(let i = 0; i < s.length; i++){ h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(36);
}
function rcTs(v){ const t = new Date(v).getTime(); return isFinite(t) ? t : 0; }
async function rcGet(path, query){
  const res = await dbFetch(`${RC_BASE()}/${path}.json${query ? '?' + query : ''}`);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function rcPatch(path, obj){
  const res = await dbFetch(`${RC_BASE()}/${path}.json`, {
    method:'PATCH', headers:{'Content-Type':'application/json'}, body: JSON.stringify(obj)
  });
  if(!res.ok) throw new Error('HTTP ' + res.status);
}
function rcOrderQuery(field, startAt){ return `orderBy=${encodeURIComponent('"' + field + '"')}&startAt=${Math.floor(startAt)}`; }
function rcIsMobileDevice(){
  try{
    if(window.matchMedia('(max-width:900px)').matches) return true;
    return /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
  }catch(e){ return false; }
}
function rcSleep(ms){ return new Promise(r=> setTimeout(r, ms)); }
/* 화면 멈춤 방지용 양보. 탭이 숨겨져 있으면 브라우저가 타이머를 분당 1회로 제한해서 양보 한 번에 최대 1분씩 걸린다
   (2026-10-05 실측: 수집 한 주기가 44분 걸림 → 화면 데이터가 계속 늦음). 숨겨진 탭은 멈출 화면이 없으니 건너뛴다. */
function rcYield(){ return document.hidden ? Promise.resolve() : rcSleep(0); }
/* FB 글은 날짜(YYYY-MM-DD, UTC)만 온다. 최근 하루 안의 글은 처음 본 시각으로, 그보다 오래된 글은 그날 정오로 친다. */
function rcDayTs(day){
  if(!day) return Date.now();
  const t = rcTs(day);
  if(!t) return Date.now();
  return (Date.now() - t < 36 * 3600 * 1000) ? Date.now() : t + 12 * 3600 * 1000;
}

/* ---------- 집계 기간: 다음 방송 3시간 전부터 지금까지 (2026-10-04 사장님 확정) ----------
   14시 방송 = 11시부터 추천 시작, 19시 방송 = 16시부터 추천 시작. 그 전에는 "HH시부터 시작" 안내만.
   휴방(주말·skipWeekdays)은 건너뛴다. */
function rcBroadcastSlots(now, dir){
  const times = (JUNGLE_CONFIG.broadcastTimes || []);
  const out = [];
  for(let d = 0; d < 8; d++){
    const day = new Date(now); day.setDate(day.getDate() + (dir < 0 ? -d : d));
    const wd = day.getDay();
    if(wd === 0 || wd === 6) continue;
    times.forEach(t=>{
      if((t.skipWeekdays || []).includes(wd)) return;
      const x = new Date(day); x.setHours(t.hour, t.minute || 0, 0, 0);
      out.push({ at: x.getTime(), label: t.label || `${t.hour}시 방송` });
    });
  }
  return out;
}
function rcWindow(){
  const now = Date.now();
  const next = rcBroadcastSlots(now, 1).filter(x=> x.at > now).sort((a,b)=> a.at - b.at)[0];
  if(!next) return { start: now - 24 * 3600 * 1000, nextLabel: '', waiting: false };
  const start = next.at - RC.LOOKBACK_MS;
  if(start > now){
    // 다음 방송 집계 시작 전(휴방일 포함, 예: 화요일은 2시 방송이 없어 아침부터 16시까지 비어 있었음)에도 목록을 비우지 않는다.
    // 지난 방송 이후(없으면 최근 12시간)에 새로 생긴 이슈를 계속 보여주고, 시작 시각이 되면 평소 규칙(방송 3시간 전~)으로 바뀐다.
    const prev = rcBroadcastSlots(now, -1).filter(x=> x.at <= now).sort((a,b)=> b.at - a.at)[0];
    const from = Math.max(prev ? prev.at : 0, now - RC.FRESH_MS);
    return { start: from, nextLabel: next.label, waiting: false, carry: true, opensAt: start };
  }
  // 집계 시작 시각이 되는 순간 목록이 텅 비는 문제(2026-10-06 16:00 실측: 직전 290개 이슈 → 0개) 방지 —
  // 창은 항상 최근 LOOKBACK(3시간) 이상으로 잡는다. 방송 3시간 전 시각이 더 이르면(방송에 가까워질수록) 그 시각부터.
  return { start: Math.min(start, now - RC.LOOKBACK_MS), nextLabel: next.label, waiting: false, opensAt: start };
}

/* ======================================================================
   수집 담당(리더) — 한 탭만. 휴대폰은 담당하지 않는다(모델 118MB).
   ====================================================================== */
const rcTabId = 't' + Math.random().toString(36).slice(2, 10);
let rcIsLeader = false;
let rcLastCycle = 0;
let rcCycleRunning = false;

async function rcTryLease(){
  if(rcIsMobileDevice() || !CURRENT_USER) return false;
  const now = Date.now();
  const url = `${RC_BASE()}/lease.json`;
  let etag = null, cur = null;
  try{
    const res = await dbFetch(url, { headers: { 'X-Firebase-ETag': 'true' } });
    etag = res.headers.get('ETag');
    cur = await res.json();
  }catch(e){
    // ETag 헤더가 막히는 환경이면 일반 조회로(쓰고 다시 읽어 확인하는 방식)
    try{ cur = await (await dbFetch(url)).json(); etag = null; }catch(e2){ return false; }
  }
  if(cur && cur.owner !== rcTabId && cur.until > now && (cur.ver || 0) >= RC.VER) return false;   // 같은·더 새 버전이 쥐고 있으면 양보, 옛 버전이면 가져온다
  const lease = { owner: rcTabId, ver: RC.VER, uid: CURRENT_USER.uid,
    name: (CURRENT_ACCOUNT && CURRENT_ACCOUNT.nickname) || '', until: now + RC.LEASE_MS };
  try{
    const headers = { 'Content-Type': 'application/json' };
    if(etag) headers['if-match'] = etag;
    const put = await dbFetch(url, { method: 'PUT', headers, body: JSON.stringify(lease) });
    if(!put.ok) return false;                     // 412 = 다른 탭이 먼저 잡음
    if(!etag){                                    // ETag를 못 읽는 환경 — 쓰고 다시 읽어 확인
      await rcSleep(1500);
      const chk = await (await dbFetch(url)).json();
      if(!chk || chk.owner !== rcTabId) return false;
    }
    return true;
  }catch(e){ return false; }
}

/* ---------- 임베딩: Web Worker 안에서 transformers.js ---------- */
const RC_WORKER_SRC = `
let ext = null;
self.onmessage = async (e) => {
  const { id, type, texts, url, model } = e.data;
  try {
    if (!ext) {
      const T = await import(url);
      T.env.allowLocalModels = false;
      ext = await T.pipeline('feature-extraction', model, { dtype: 'q8' });
    }
    if (type === 'load') { self.postMessage({ id, ok: true }); return; }
    const out = await ext(texts, { pooling: 'mean', normalize: true });
    const buf = new Float32Array(out.data);
    self.postMessage({ id, ok: true, dim: out.dims[1], buf }, [buf.buffer]);
  } catch (err) {
    self.postMessage({ id, ok: false, error: String((err && err.message) || err) });
  }
};`;
let rcEmbWorker = null, rcEmbSeq = 0, rcEmbOk = null, rcEmbErr = '';
const rcEmbWait = {};
function rcEmbCall(msg){
  if(!rcEmbWorker){
    const blobUrl = URL.createObjectURL(new Blob([RC_WORKER_SRC], { type: 'text/javascript' }));
    rcEmbWorker = new Worker(blobUrl, { type: 'module' });
    rcEmbWorker.onmessage = (e)=>{ const w = rcEmbWait[e.data.id]; if(w){ delete rcEmbWait[e.data.id]; w(e.data); } };
    rcEmbWorker.onerror = (e)=>{ Object.keys(rcEmbWait).forEach(k=>{ rcEmbWait[k]({ ok:false, error: e.message || 'worker error' }); delete rcEmbWait[k]; }); };
  }
  const id = ++rcEmbSeq;
  return new Promise(res=>{
    rcEmbWait[id] = res;
    rcEmbWorker.postMessage(Object.assign({ id, url: RC.TF_URL, model: RC.MODEL }, msg));
  });
}
async function rcEnsureModel(){
  if(rcEmbOk !== null) return rcEmbOk;
  const r = await rcEmbCall({ type: 'load' });
  rcEmbOk = !!r.ok;
  rcEmbErr = r.ok ? '' : (r.error || '모델 로딩 실패');
  if(!r.ok) console.warn('[뉴스추천] 임베딩 로딩 실패 — 단어 비교로 대체', r.error);
  return rcEmbOk;
}
async function rcEmbedTexts(texts){
  const out = [];
  for(let i = 0; i < texts.length; i += 16){
    const r = await rcEmbCall({ type: 'embed', texts: texts.slice(i, i + 16).map(t=> 'query: ' + t) });
    if(!r.ok) throw new Error(r.error);
    for(let j = 0; j < r.buf.length / r.dim; j++) out.push(r.buf.slice(j * r.dim, (j + 1) * r.dim));
  }
  return out;
}

/* ---------- 벡터 캐시(IndexedDB) — 항목당 1회만 계산 ---------- */
const rcIdb = {
  _db: null,
  open(){
    if(this._db) return Promise.resolve(this._db);
    return new Promise((res, rej)=>{
      const rq = indexedDB.open('jungle_recommend', 1);
      rq.onupgradeneeded = ()=> rq.result.createObjectStore('vec');
      rq.onsuccess = ()=>{ this._db = rq.result; res(this._db); };
      rq.onerror = ()=> rej(rq.error);
    });
  },
  async getMany(ids){
    const db = await this.open();
    return new Promise(res=>{
      const out = {}, tx = db.transaction('vec', 'readonly'), st = tx.objectStore('vec');
      ids.forEach(id=>{ const g = st.get(id); g.onsuccess = ()=>{ if(g.result) out[id] = g.result; }; });
      tx.oncomplete = ()=> res(out); tx.onerror = ()=> res(out);
    });
  },
  async putMany(entries){
    const db = await this.open();
    return new Promise(res=>{
      const tx = db.transaction('vec', 'readwrite'), st = tx.objectStore('vec');
      entries.forEach(([id, v])=> st.put({ v, at: Date.now() }, id));
      tx.oncomplete = ()=> res(); tx.onerror = ()=> res();
    });
  },
  async prune(before){
    const db = await this.open();
    return new Promise(res=>{
      const tx = db.transaction('vec', 'readwrite'), st = tx.objectStore('vec');
      const cur = st.openCursor();
      cur.onsuccess = ()=>{ const c = cur.result; if(!c) return; if(c.value && c.value.at < before) c.delete(); c.continue(); };
      tx.oncomplete = ()=> res(); tx.onerror = ()=> res();
    });
  }
};

/* ---------- 입력 항목 ---------- */
// 항목 = { id, k:'a'|'y'|'s', t:제목/본문앞부분, u:링크, s:언론사/채널/정치인, ts, text:묶기용 텍스트, v:벡터 }
const rcItems = new Map();
let rcYtChannels = [];             // [{handle,name,channelId}]
let rcSnsLoaded = false, rcYtLoaded = false;
const rcStatus = { yt: {}, sns: {}, emb: {} };

function rcIsLiveArticle(a){ return a._via === 'section' || a._via === 'custom'; }   // visibleArticles('live')와 같은 기준
function rcArticleItems(){
  const cutoff = Date.now() - RC.POOL_MS;
  const out = [];
  (newsState.articles || []).forEach(a=>{
    if(!a || !a.link || !a.title) return;
    // 실시간 탭과 같은 기사만 쓴다(2026-10-08 사장님 지시): 실시간 = 네이버 정치섹션 + 직접 등록 언론사.
    // 키워드 검색으로 들어온 기사(_via:'search', 풀의 88%)가 스포츠·연예를 끌고 와서 추천에 섞이던 원인. 배제 단어 필터만으론 못 막았다.
    if(!rcIsLiveArticle(a)) return;
    if(isExcludedArticle(a)) return;   // 정글2 배제 필터를 추천에도 그대로 적용(스포츠·사진·부고·보도자료 등, 2026-10-06)
    const ts = rcTs(a.pubDate);
    if(!ts || ts < cutoff) return;
    out.push({ id: 'a' + rcHash(a.link), k: 'a', t: a.title, u: a.link, s: a.source || '', ts,
      x: String(a.excerpt || a.fullText || '').slice(0, 200),
      text: a.title + ' ' + String(a.excerpt || a.fullText || '').slice(0, 150) });
  });
  return out;
}

async function rcLoadYtChannels(){
  const tabs = await dbFetch(`${FIREBASE_URL}/tabs_channels.json`).then(r=> r.json()).catch(()=> null) || {};
  const list = [];
  Object.values(tabs).forEach(arr=> (Array.isArray(arr) ? arr : Object.values(arr || {})).forEach(c=>{
    if(c && c.handle && !list.some(x=> x.handle === c.handle)) list.push({ handle: c.handle, name: c.name || c.handle });
  }));
  // 핸들 → 채널 ID (API 없이 채널 페이지에서 추출, 팀 공유 캐시)
  const cache = await rcGet('yt_channel_ids').catch(()=> null) || {};
  const add = {};
  for(const c of list){
    const key = rcHash(c.handle);
    if(cache[key]){ c.channelId = cache[key]; continue; }
    try{
      const html = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent('https://www.youtube.com/' + c.handle)}`, {}, 15000).then(r=> r.text());
      const m = html.match(/"externalId":"(UC[\w-]{20,})"/) || html.match(/channel\/(UC[\w-]{20,})/);
      if(m){ c.channelId = m[1]; add[key] = m[1]; }
    }catch(e){}
  }
  if(Object.keys(add).length) rcPatch('yt_channel_ids', add).catch(()=>{});
  rcYtChannels = list;
  rcPatch('status', { ytChannels: list.length }).catch(()=>{});
}

let rcRssDeadUntil = 0, rcRssFails = 0;
function rcYtRssFail(){ if(++rcRssFails >= 2) rcRssDeadUntil = Date.now() + 6 * 3600 * 1000; }
async function rcCollectYoutube(){
  if(!rcYtChannels.length) await rcLoadYtChannels();
  if(!rcYtLoaded){
    const old = await rcGet('yt', rcOrderQuery('ts', Date.now() - RC.POOL_MS)).catch(()=> null) || {};
    Object.entries(old).forEach(([id, x])=> rcItems.set(id, { id, k:'y', t:x.t, u:x.u, s:x.s, ts:x.ts, desc: x.d || '', text: (x.t + ' ' + (x.d || '')).trim() }));
    rcYtLoaded = true;
  }
  const fresh = {};
  let okCount = 0, fail = 0, lastErr = '';
  for(const c of rcYtChannels){
    if(!c.channelId){ fail++; continue; }
    try{
      // 영상 목록: 1순위 공개 RSS(쿼터 0). 2026-10-06 유튜브가 RSS를 전 채널 404로 막아서, 실패하면 Data API 업로드 목록(채널당 1유닛)으로 받는다.
      let vids = null;
      try{
        if(Date.now() < rcRssDeadUntil) throw new Error('RSS 중단 중');
        const feedUrl = 'https://www.youtube.com/feeds/videos.xml?channel_id=' + c.channelId;
        const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/rss?url=${encodeURIComponent(feedUrl)}`, { cache: 'no-store' }, 12000);
        if(!res.ok) throw new Error('HTTP ' + res.status);
        const xml = new DOMParser().parseFromString(await res.text(), 'text/xml');
        vids = Array.from(xml.querySelectorAll('entry')).map(en=> ({
          vid: (en.getElementsByTagName('yt:videoId')[0] || {}).textContent,
          title: (en.querySelector('title') || {}).textContent || '',
          ts: rcTs((en.querySelector('published') || {}).textContent),
          raw: (en.getElementsByTagName('media:description')[0] || {}).textContent || ''
        }));
      }catch(e1){
        if(/HTTP (404|5\d\d)/.test(String(e1.message))) rcYtRssFail();   // RSS가 막힌 걸로 보고 한동안 시도하지 않는다(채널마다 실패 호출 낭비 방지)
        const api = `https://www.googleapis.com/youtube/v3/playlistItems?part=snippet&maxResults=15&playlistId=UU${c.channelId.slice(2)}&key=${JUNGLE_CONFIG.googleApiKey}`;
        const res = await fetchWithTimeout(api, {}, 12000);
        if(!res.ok) throw new Error('API HTTP ' + res.status);
        const j = await res.json();
        vids = (j.items || []).map(it=> ({
          vid: it.snippet && it.snippet.resourceId && it.snippet.resourceId.videoId,
          title: (it.snippet && it.snippet.title) || '',
          ts: rcTs(it.snippet && it.snippet.publishedAt),
          raw: (it.snippet && it.snippet.description) || ''
        }));
      }
      // 설명란: 채널이 영상마다 반복해 붙이는 후원·가입 안내 줄(같은 줄이 3개 영상 이상)과 링크·전화번호 줄은 버린다.
      // 목차("13:05 중수청·공소청 출범")나 해시태그가 남아 매칭에 큰 도움이 됨(2026-10-04 실측: 붙는 영상 23→51/90)
      const lineCount = {};
      vids.forEach(v=> new Set(v.raw.split('\n').map(l=> l.trim()).filter(Boolean)).forEach(l=> lineCount[l] = (lineCount[l] || 0) + 1));
      const cleanDesc = (raw)=> raw.split('\n').map(l=> l.trim())
        .filter(l=> l && (lineCount[l] || 0) < 3 && !/https?:\/\/|www\.|\d{3,4}-\d{4}|구독|후원|가입|좋아요|알림/.test(l))
        .join(' ').slice(0, 400);
      vids.forEach(v=>{
        const { vid, title, ts } = v;
        if(!vid || !title || ts < Date.now() - RC.POOL_MS) return;
        const id = 'y' + vid.replace(/[^\w-]/g, '');
        const desc = cleanDesc(v.raw);
        const prev = rcItems.get(id);
        if(prev && prev.desc === desc) return;
        const it = { id, k: 'y', t: title, u: 'https://www.youtube.com/watch?v=' + vid, s: c.name, ts, desc, text: (title + ' ' + desc).trim() };
        rcItems.set(id, it);
        fresh[id] = { t: it.t, u: it.u, s: it.s, ts, d: desc };
      });
      okCount++;
    }catch(e){ fail++; lastErr = String(e && e.message || e); }
    await rcSleep(400);   // 프록시 초당 한도
  }
  if(Object.keys(fresh).length) await rcPatch('yt', fresh).catch(()=>{});
  rcStatus.yt = { ok: okCount > 0, at: Date.now(), channels: rcYtChannels.length, fail, err: fail ? lastErr.slice(0, 80) : '' };
}

/* ---------- SNS: 1티어 의원 명단(Firestore REST) → FB /fbposts + X(all) 순환 ---------- */
let rcRoster = null, rcRosterAt = 0;
function rcFsVal(f){
  if(!f) return '';
  if('stringValue' in f) return f.stringValue;
  if('integerValue' in f) return String(f.integerValue);
  if('doubleValue' in f) return String(f.doubleValue);
  return '';
}
async function rcFsList(colPath, fields){
  const token = await firebase.auth().currentUser.getIdToken();
  const pid = JUNGLE_CONFIG.firebase.projectId;
  const out = {};
  let pageToken = '';
  for(let guard = 0; guard < 10; guard++){
    const q = new URLSearchParams({ pageSize: '300' });
    fields.forEach(f=> q.append('mask.fieldPaths', f));
    if(pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/${colPath}?${q}`,
      { headers: { Authorization: 'Bearer ' + token } });
    if(!res.ok) throw new Error('Firestore ' + res.status);
    const j = await res.json();
    (j.documents || []).forEach(d=>{
      const id = d.name.split('/').pop();
      const o = {};
      fields.forEach(f=> o[f] = rcFsVal((d.fields || {})[f]));
      out[id] = o;
    });
    pageToken = j.nextPageToken || '';
    if(!pageToken) break;
  }
  return out;
}
function rcFbVanity(url){
  try{
    const u = new URL(url, 'https://www.facebook.com');
    const id = u.searchParams.get('id');
    if(/profile\.php/i.test(u.pathname) && id) return id;
    return u.pathname.replace(/^\/+|\/+$/g, '').split('/')[0] || '';
  }catch(e){ return ''; }
}
/* 명단은 Firestore에서 통째로 읽으면 문서 수백 건이 읽기 한도를 쓴다 — 하루 5만 건 무료 한도를 SNS 도구·정글JK와 같이 쓰다 넘으면 429("의원 명단을 못 읽음", 2026-10-17).
   그래서 RTDB(/recommend/roster)에 사본을 두고 하루 한 번만 Firestore에서 새로 읽는다. Firestore가 막히면 오래된 사본이라도 쓴다(빈 화면·수집 중단 금지). */
const RC_ROSTER_TTL = 24 * 3600 * 1000;
async function rcLoadRoster(){
  if(rcRoster && Date.now() - rcRosterAt < 6 * 3600 * 1000) return rcRoster;
  let cached = null;
  try{ cached = await rcGet('roster'); }catch(e){}
  if(cached && Array.isArray(cached.list) && cached.list.length && Date.now() - (cached.at || 0) < RC_ROSTER_TTL){
    rcRoster = cached.list; rcRosterAt = Date.now(); return rcRoster;
  }
  try{
    const fresh = await rcLoadRosterFromFirestore();
    rcPatch('roster', { at: Date.now(), list: fresh }).catch(()=> {});
    return fresh;
  }catch(e){
    if(cached && Array.isArray(cached.list) && cached.list.length){ rcRoster = cached.list; rcRosterAt = Date.now() - 5 * 3600 * 1000; return rcRoster; }   // 1시간 뒤 다시 시도
    throw e;
  }
}
async function rcLoadRosterFromFirestore(){
  const cli = JUNGLE_CONFIG.snsClient || 'sunnydesk';
  const [subj, obj] = await Promise.all([
    rcFsList(`sns_u/${cli}/politicians`, ['tier', 'name']),
    rcFsList('politicians', ['fb', 'x', 'name'])
  ]);
  const list = [];
  Object.entries(subj).forEach(([id, s])=>{
    if(String(s.tier) !== '1') return;
    const o = obj[id] || {};
    const name = s.name || o.name || id.replace(/^\d+_/, '');
    const fb = /facebook\.com/i.test(o.fb || '') ? rcFbVanity(o.fb) : '';
    const x = (o.x || '').trim();
    if(fb || x) list.push({ id, name, fb, x });
  });
  list.sort((a, b)=> a.id.localeCompare(b.id));
  rcRoster = list; rcRosterAt = Date.now();
  return list;
}
async function rcCollectSns(){
  if(!rcSnsLoaded){
    const old = await rcGet('sns', rcOrderQuery('ts', Date.now() - RC.POOL_MS)).catch(()=> null) || {};
    Object.entries(old).forEach(([id, x])=> rcItems.set(id, { id, k:'s', t:(x.text || '').slice(0, 100), u:x.u, s:x.n, ts:x.ts, text:(x.text || '').slice(0, 300) }));
    rcSnsLoaded = true;
  }
  let roster;
  try{ roster = await rcLoadRoster(); }
  catch(e){ rcStatus.sns = { ok: false, at: Date.now(), error: '의원 명단을 못 읽음(' + e.message + ')' }; return; }
  if(!roster.length){ rcStatus.sns = { ok: false, at: Date.now(), error: '1티어 의원 SNS가 없음' }; return; }
  const st = await rcGet('status').catch(()=> null) || {};
  const cursor = ((st.snsCursor || 0) + 1) % RC.SNS_GROUPS;
  const group = roster.filter((m, i)=> i % RC.SNS_GROUPS === cursor);
  const cutoff = Date.now() - RC.POOL_MS;
  const fresh = {};
  const add = (net, name, text, url, ts)=>{
    text = String(text || '').trim();
    if(!text || !ts || ts < cutoff) return;
    const id = 's' + rcHash(url || (name + text.slice(0, 80)));
    if(rcItems.has(id)) return;
    rcItems.set(id, { id, k: 's', t: text.slice(0, 100), u: url, s: name, ts, text: text.slice(0, 300) });
    fresh[id] = { n: name, net, text: text.slice(0, 2000), u: url || '', ts };
  };
  let fbOk = 0, fbFail = 0, needsCookie = false, xErr = '';
  for(const m of group.filter(g=> g.fb)){
    try{
      const j = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fbposts?u=${encodeURIComponent(m.fb)}`, {}, 20000).then(r=> r.json());
      if(j.needsCookie) needsCookie = true;
      (j.posts || []).forEach(p=> add('fb', m.name, p.text, p.url, rcDayTs(p.date)));
      if(j.ok) fbOk++; else fbFail++;
    }catch(e){ fbFail++; }
    await rcSleep(1500);   // 모니터링 계정 보호 — 천천히
  }
  const xTargets = group.filter(g=> g.x).map(g=> ({ name: g.name, x: g.x }));
  for(let i = 0; i < xTargets.length; i += 25){   // Worker는 요청당 25명까지
    try{
      const res = await fetch(X_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, days: 2, targets: xTargets.slice(i, i + 25) }) });
      const j = await res.json();
      if(!res.ok) xErr = j.error || ('HTTP ' + res.status);
      (j.posts || []).forEach(p=> add('x', p.name, p.text, p.url, p.created ? rcTs(p.created) : rcDayTs(p.date)));
    }catch(e){ xErr = e.message; }
  }
  if(Object.keys(fresh).length) await rcPatch('sns', fresh).catch(()=>{});
  await rcPatch('status', { snsCursor: cursor }).catch(()=>{});
  rcStatus.sns = { ok: (fbOk > 0 || (xTargets.length && !xErr)), at: Date.now(), group: cursor, members: group.length,
    error: needsCookie ? 'FB 쿠키 미설정' : (xErr ? 'X: ' + xErr : (fbFail && !fbOk ? 'FB 조회 실패' : '')) };
}

/* ---------- 묶기 ---------- */
let rcClusters = [];                 // {id, sum, n, members:[id], first, last, maybe}
let rcBuiltAt = 0, rcProcessed = new Set();
let rcTuning = { join: RC.JOIN, maybe: RC.MAYBE };
let rcDecisions = {};
const rcWritten = new Map();         // cid -> 마지막으로 쓴 JSON(바뀐 것만 다시 씀)

function rcTokens(text){
  const set = new Set();
  normalizeAbbrev(String(text || '')).replace(/[^가-힣A-Za-z0-9一-龥]+/g, ' ').split(' ').forEach(w=>{
    const s = (typeof stripJosa === 'function') ? stripJosa(w) : w;
    if(s && s.length >= 2) set.add(s);
  });
  return set;
}
function rcDot(a, b){ let s = 0; for(let i = 0; i < a.length; i++) s += a[i] * b[i]; return s; }
function rcSim(a, b){
  if(a.v && b.v) return rcDot(a.v, b.v);
  if(!a.tok) a.tok = rcTokens(a.text);
  if(!b.tok) b.tok = rcTokens(b.text);
  let inter = 0; a.tok.forEach(w=>{ if(b.tok.has(w)) inter++; });
  const uni = a.tok.size + b.tok.size - inter;
  return uni ? inter / uni : 0;
}
function rcClusterScore(it, c){
  if(it.v && c.sum){ return { mean: rcDot(it.v, c.sum) / c.n }; }
  let s = 0, k = 0;
  for(const id of c.members.slice(-30)){ const m = rcItems.get(id); if(m){ s += rcSim(it, m); k++; } }
  return { mean: k ? s / k : 0 };
}
function rcMinSim(it, c){
  let mn = 1;
  for(const id of c.members.slice(-40)){ const m = rcItems.get(id); if(m) mn = Math.min(mn, rcSim(it, m)); }
  return mn;
}
function rcMaxSim(it, c){
  let mx = -1;
  for(const id of c.members.slice(-60)){ const m = rcItems.get(id); if(m) mx = Math.max(mx, rcSim(it, m)); }
  return mx;
}
function rcPairKey(a, b){ return a < b ? a + '_' + b : b + '_' + a; }
function rcAssign(it){
  const join = it.v ? rcTuning.join : RC.FB_JOIN;
  const maybe = it.v ? rcTuning.maybe : RC.FB_MAYBE;
  const activeFrom = it.ts - RC.POOL_MS;
  let best = null, bs = -1;
  for(const c of rcClusters){
    if(c.gone || c.last < activeFrom) continue;
    const { mean } = rcClusterScore(it, c);
    if(mean > bs){ bs = mean; best = c; }
  }
  if(best && bs >= join && rcMinSim(it, best) >= join - (it.v ? RC.GAP : 0.15)){
    best.members.push(it.id); best.n++;
    if(it.v && best.sum){ for(let i = 0; i < it.v.length; i++) best.sum[i] += it.v[i]; }
    best.first = Math.min(best.first, it.ts); best.last = Math.max(best.last, it.ts);
    return;
  }
  const c = { id: it.id, sum: it.v ? Float32Array.from(it.v) : null, n: 1, members: [it.id], first: it.ts, last: it.ts, maybe: null };
  // "비슷할 수도" = 묶음 전체와는 기준 미달이지만 그 안의 어떤 항목과는 아주 가까운 경우만
  // (평균만 보면 e5 기본 유사도가 0.84 안팎이라 무관한 쌍이 대량으로 걸림 — 2026-10-04 실측)
  if(best && bs >= maybe && rcMaxSim(it, best) >= (it.v ? RC.MAYBE_PAIR : RC.FB_JOIN)){
    const d = rcDecisions[rcPairKey(c.id, best.id)];
    if(!d || d.d !== 'split') c.maybe = best.id;
  }
  rcClusters.push(c);
}
function rcMergeInto(a, b){   // b를 a로 합침
  b.members.forEach(id=> a.members.push(id));
  a.n += b.n;
  if(a.sum && b.sum){ for(let i = 0; i < a.sum.length; i++) a.sum[i] += b.sum[i]; } else a.sum = null;
  a.first = Math.min(a.first, b.first); a.last = Math.max(a.last, b.last);
  b.gone = a.id;
}
function rcApplyDecisions(){
  const byId = new Map(rcClusters.map(c=> [c.id, c]));
  const findLive = (id)=>{ let c = byId.get(id), g = 0; while(c && c.gone && g++ < 10) c = byId.get(c.gone); return c; };
  Object.values(rcDecisions).forEach(d=>{
    if(!d || d.d !== 'merge') return;
    const a = findLive(d.a), b = findLive(d.b);
    if(a && b && a !== b) rcMergeInto(a, b);
  });
  rcClusters.forEach(c=>{ if(c.maybe){ const t = findLive(c.maybe); if(!t || t === c) c.maybe = null; else c.maybe = t.id; } });
}
async function rcEnsureVectors(items){
  const need = items.filter(it=> !it.v);
  if(!need.length) return;
  if(!(await rcEnsureModel())) return;
  const vkey = it=> it.k === 'a' ? it.id : it.id + '~' + rcHash(it.text);
  const cached = await rcIdb.getMany(need.map(vkey)).catch(()=> ({}));
  const miss = [];
  need.forEach(it=>{ const c = cached[vkey(it)]; if(c && c.v) it.v = c.v; else miss.push(it); });
  for(let i = 0; i < miss.length; i += 64){
    const chunk = miss.slice(i, i + 64);
    try{
      const vecs = await rcEmbedTexts(chunk.map(it=> it.text));
      chunk.forEach((it, j)=> it.v = vecs[j]);
      await rcIdb.putMany(chunk.map(it=> [vkey(it), it.v]));
    }catch(e){
      rcEmbOk = false; rcEmbErr = e.message;
      console.warn('[뉴스추천] 임베딩 실패 — 단어 비교로 대체', e);
      return;
    }
  }
}
/* 유튜브·SNS 붙이기(2026-10-04) — 기사끼리 쓰는 묶음 규칙(묶음 평균 0.90)을 영상·SNS에 쓰면 말투가 달라
   거의 안 붙었다(영상 71개 중 1개). 그래서 영상·SNS는 묶음을 만들지 않고, 가장 비슷한 기사 한 건과
   ATTACH_SIM 이상이면서 핵심 단어를 하나 이상 공유하면 그 기사의 묶음에 "붙인다". 묶음 평균(sum)은 안 바꾼다. */
const RC_STOP = new Set(['이재명','대통령','국민의힘','민주당','더불어민주당','논란','공개','정부','여야','live','현장','속보','이유','뉴스','오늘',
  '국회의원','의원','대표','정권','이제','결국','대한민국','국민','생중계','하이라이트','심층분석','몰아보기','단독','팩트','최병묵의','주진우의','이슈해설','일타뉴스']);
function rcKeyTokens(text){
  return (String(text || '').toLowerCase().replace(/\[[^\]]*\]/g, ' ').match(/[가-힣a-z0-9一-龥]{2,}/g) || [])
    .map(w=> w.replace(/(은|는|이|가|을|를|의|에|에서|으로|로|와|과|도|만|까지|부터|엔|에게)$/, ''))
    .filter(w=> w.length >= 2 && !RC_STOP.has(w));
}
async function rcAttachSignals(signals, articles){
  rcClusters.forEach(c=> c.att = []);
  const arts = articles.filter(a=> a.v);
  if(!arts.length) return;
  const clusterOf = new Map();
  const byId = new Map(rcClusters.map(c=> [c.id, c]));
  rcClusters.forEach(c=>{
    let live = c, g = 0;
    while(live && live.gone && g++ < 10) live = byId.get(live.gone);
    if(live) c.members.forEach(id=> clusterOf.set(id, live));
  });
  let k = 0;
  for(const it of signals){
    if(!it.v) continue;
    let best = null, bs = -1;
    for(const a of arts){ const s = rcDot(it.v, a.v); if(s > bs){ bs = s; best = a; } }
    if(!best || bs < RC.ATTACH_SIM) continue;
    const hay = (best.t + ' ' + (best.x || '')).toLowerCase();
    if(!rcKeyTokens(it.text).some(w=> hay.includes(w))) continue;
    const c = clusterOf.get(best.id);
    if(c) c.att.push(it.id);
    if(++k % 20 === 0) await rcYield();
  }
}
function rcRepresentative(c){
  let best = null, bs = -Infinity;
  c.members.forEach(id=>{
    const m = rcItems.get(id);
    if(!m || m.k !== 'a') return;
    const s = (m.v && c.sum) ? rcDot(m.v, c.sum) : -m.ts;   // 임베딩 없으면 가장 먼저 나온 기사
    if(s > bs){ bs = s; best = m; }
  });
  return best || rcItems.get(c.members[0]);
}
function rcClusterRecord(c){
  const ms = c.members.concat(c.att || []).map(id=> rcItems.get(id)).filter(Boolean);
  const kinds = new Set(ms.map(m=> m.k));
  const arts = ms.filter(m=> m.k === 'a').length;
  // 첫 기사가 STORE_MS 안이고 이슈 전체 기사 2건 이상일 때만 저장
  if(!(c.first >= Date.now() - RC.STORE_MS) || arts < RC.FRESH_MIN_TOTAL) return null;
  const rep = rcRepresentative(c);
  // 집계용 압축 목록 "k|ts36|출처" + 펼치기용 상세(최근순 30개)
  const m = {};
  ms.forEach(x=>{ m[x.id] = x.k + '|' + x.ts.toString(36) + '|' + String(x.s || '').slice(0, 40); });
  const d = {};
  ms.slice().sort((a, b)=> b.ts - a.ts).slice(0, RC.DETAIL_MAX).forEach(x=>{
    d[x.id] = { k: x.k, t: String(x.t || '').slice(0, 120), u: x.u || '', s: String(x.s || '').slice(0, 40), ts: x.ts };
  });
  const rec = { t: rep ? String(rep.t).slice(0, 160) : '', u: rep ? rep.u : '', x: (rep && rep.x) || '', rs: rep ? String(rep.s || '') : '', rt: rep ? rep.ts : 0,
    first: c.first, last: c.last, m, d };
  if(c.maybe){
    const o = rcClusters.find(x=> x.id === c.maybe);
    const orep = o ? rcRepresentative(o) : null;
    rec.maybe = { id: c.maybe, t: orep ? String(orep.t).slice(0, 120) : '' };
  }
  return rec;
}
async function rcWriteClusters(fullRebuild){
  const now = Date.now();
  const patch = {};
  const live = new Set();
  rcClusters.forEach(c=>{
    if(c.gone){
      if(rcWritten.has(c.id)){ patch[c.id] = { gone: c.gone, upd: now, last: c.last }; rcWritten.delete(c.id); }
      return;
    }
    const rec = rcClusterRecord(c);
    if(!rec) return;
    live.add(c.id);
    const json = JSON.stringify(rec);
    if(rcWritten.get(c.id) === json) return;
    rcWritten.set(c.id, json);
    patch[c.id] = Object.assign(rec, { upd: now });
  });
  if(fullRebuild){
    // 재계산으로 사라진 묶음은 "gone" 표시, 14일 지난 묶음은 삭제
    const shallow = await rcGet('clusters', 'shallow=true').catch(()=> null) || {};
    const keys = Object.keys(shallow);
    if(keys.length){
      const lasts = await rcGet('clusters', rcOrderQuery('last', 0)).catch(()=> null) || {};
      keys.forEach(k=>{
        const r = lasts[k];
        if(!r) return;
        if(r.last < now - RC.KEEP_MS){ patch[k] = null; return; }
        if(!live.has(k) && !r.gone && r.last >= now - RC.POOL_MS) patch[k] = { gone: '_', upd: now, last: r.last };
      });
    }
  }
  const ids = Object.keys(patch);
  for(let i = 0; i < ids.length; i += 60){
    const part = {};
    ids.slice(i, i + 60).forEach(k=> part[k] = patch[k]);
    await rcPatch('clusters', part);
  }
  return ids.length;
}
async function rcPruneRaw(){
  const before = Date.now() - RC.KEEP_MS;
  for(const path of ['yt', 'sns']){
    const old = await rcGet(path, `orderBy=${encodeURIComponent('"ts"')}&endAt=${before}`).catch(()=> null) || {};
    const del = {}; Object.keys(old).forEach(k=> del[k] = null);
    if(Object.keys(del).length) await rcPatch(path, del).catch(()=>{});
  }
  rcIdb.prune(before).catch(()=>{});
}

/* 다시 계산(6시간마다, 수집 PC가 바뀌거나 정글2를 새로 열 때)하면 묶음 번호(=가장 오래된 기사 id)가 달라져서
   같은 이슈가 "사라짐 + 새 카드"로 바뀌고 무시·스크랩·NEW 기록이 끊겼다(2026-10-05 실측: 오늘만 대량 사라짐 5회, 사라진 묶음 722개).
   그래서 새로 만든 묶음이 DB에 이미 있는 묶음과 기사를 절반 이상 공유하면 예전 번호를 그대로 물려받는다. */
async function rcRelabelFromDb(){
  const prev = await rcGet('clusters', rcOrderQuery('last', Date.now() - RC.POOL_MS)).catch(()=> null);
  if(!prev) return 0;
  const owner = new Map(), size = {};
  Object.entries(prev).forEach(([cid, r])=>{
    if(!r || r.gone || !r.m) return;
    const ids = Object.keys(r.m);
    size[cid] = ids.length;
    ids.forEach(id=>{ if(!owner.has(id)) owner.set(id, cid); });
  });
  const cand = [];
  rcClusters.forEach(c=>{
    if(c.gone) return;
    const votes = {};
    c.members.forEach(id=>{ const o = owner.get(id); if(o) votes[o] = (votes[o] || 0) + 1; });
    Object.entries(votes).forEach(([o, v])=>{ if(v * 2 >= Math.min(c.members.length, size[o])) cand.push({ c, o, v }); });
  });
  cand.sort((a, b)=> b.v - a.v);
  const final = new Map(), taken = new Set();
  cand.forEach(({ c, o })=>{ if(final.has(c) || taken.has(o)) return; final.set(c, o); taken.add(o); });
  rcClusters.forEach(c=>{
    if(c.gone || final.has(c)) return;
    let id = c.id; while(taken.has(id)){ id += '_'; }
    taken.add(id); final.set(c, id);
  });
  const remap = new Map();
  rcClusters.forEach(c=>{ if(final.has(c) && final.get(c) !== c.id) remap.set(c.id, final.get(c)); });
  rcClusters.forEach(c=>{ if(c.maybe && remap.has(c.maybe)) c.maybe = remap.get(c.maybe); });
  rcClusters.forEach(c=>{ if(final.has(c)) c.id = final.get(c); });
  return remap.size;
}

async function rcRunCycle(){
  if(rcCycleRunning) return;
  rcCycleRunning = true;
  const t0 = Date.now();
  try{
    rcDecisions = await rcGet('decisions').catch(()=> null) || {};
    const tun = await rcGet('tuning').catch(()=> null);
    if(tun && tun.join) rcTuning = { join: tun.join, maybe: tun.maybe || RC.MAYBE };
    rcArticleItems().forEach(it=>{ if(!rcItems.has(it.id)) rcItems.set(it.id, it); });
    await rcCollectYoutube().catch(e=> rcStatus.yt = { ok:false, at:Date.now(), error:e.message });
    await rcCollectSns().catch(e=> rcStatus.sns = { ok:false, at:Date.now(), error:e.message });
    // 오래된 항목 정리
    const cutoff = Date.now() - RC.POOL_MS;
    rcItems.forEach((it, id)=>{ if(it.ts < cutoff) rcItems.delete(id); });

    const everything = Array.from(rcItems.values()).sort((a, b)=> a.ts - b.ts);
    await rcEnsureVectors(everything);
    const all = everything.filter(it=> it.k === 'a');   // 묶음은 기사로만 만든다
    const full = !rcBuiltAt || Date.now() - rcBuiltAt > RC.REBUILD_MS;
    if(full){
      rcClusters = []; rcProcessed = new Set();
      for(let i = 0; i < all.length; i++){
        rcAssign(all[i]); rcProcessed.add(all[i].id);
        if(i % 150 === 149) await rcYield();   // 화면 멈춤 방지
      }
      rcBuiltAt = Date.now();
      await rcRelabelFromDb().catch(e=> console.warn('[뉴스추천] 묶음 번호 이어받기 실패', e));
    }else{
      for(const it of all){ if(!rcProcessed.has(it.id)){ rcAssign(it); rcProcessed.add(it.id); } }
      rcClusters = rcClusters.filter(c=> !c.gone || rcWritten.has(c.id) || c.last >= cutoff);
    }
    rcApplyDecisions();
    await rcAttachSignals(everything.filter(it=> it.k !== 'a'), all);
    const written = await rcWriteClusters(full);
    rcStatus.emb = { ok: !!rcEmbOk, mode: rcEmbOk ? 'embedding' : 'words', error: rcEmbOk ? '' : rcEmbErr };
    await rcPatch('status', {
      at: Date.now(), ms: Date.now() - t0, written, items: rcItems.size,
      collector: (CURRENT_ACCOUNT && CURRENT_ACCOUNT.nickname) || '',
      yt: rcStatus.yt, sns: rcStatus.sns, emb: rcStatus.emb
    }).catch(()=>{});
    if(full) rcPruneRaw().catch(()=>{});
    rcViewer.lastFetch = 0;             // 수집 담당 탭 화면도 바로 갱신
    if(rcViewerActive()) rcRefreshView();
  }catch(e){
    console.warn('[뉴스추천] 수집 주기 실패', e);
  }finally{
    rcLastCycle = Date.now();
    rcCycleRunning = false;
  }
}

async function rcTick(){
  if(!CURRENT_USER || typeof _appStarted === 'undefined' || !_appStarted) return;
  const wasLeader = rcIsLeader;
  rcIsLeader = await rcTryLease();
  if(rcIsLeader && !wasLeader){ rcBuiltAt = 0; rcWritten.clear(); }   // 새로 담당을 맡으면 전체 재계산
  if(rcIsLeader && Date.now() - rcLastCycle >= RC.CYCLE_MS) rcRunCycle();
  rcViewerTick();
}

/* ======================================================================
   화면(모든 기기) — /recommend/clusters 를 읽어 카드로
   ====================================================================== */
const rcViewer = {
  clusters: {},       // cid -> 기록
  maxUpd: 0, lastFetch: 0, fetching: false,
  status: null,
  ignored: {}, scrapped: {},
  personalLoaded: false,
  newSince: {},       // cid -> NEW로 처음 감지한 시각(깜박임 1분)
  hidden: new Set(),  // 이번 세션에 합치기로 숨긴 카드
  splitDone: new Set()
};
const RC_SEEN_LS = 'jsg_rc_seen_v1';
function rcSeenLoad(){ try{ return JSON.parse(localStorage.getItem(RC_SEEN_LS) || 'null'); }catch(e){ return null; } }
function rcSeenSave(m){ try{ localStorage.setItem(RC_SEEN_LS, JSON.stringify(m)); }catch(e){} }
let rcSeen = rcSeenLoad();

function rcViewerActive(){
  try{ return _currentMode === 'news' && newsState.activeSubtab === 'recommend' && !document.hidden; }catch(e){ return false; }
}
async function rcLoadPersonal(){
  const [ig, sc] = await Promise.all([
    dbFetch(userPath('recommend_ignored')).then(r=> r.json()).catch(()=> null),
    dbFetch(userPath('recommend_scrapped')).then(r=> r.json()).catch(()=> null)
  ]);
  rcViewer.ignored = ig || {}; rcViewer.scrapped = sc || {};
  rcViewer.personalLoaded = true;
}
async function rcFetchClusters(){
  if(rcViewer.fetching) return;
  rcViewer.fetching = true;
  try{
    const win = rcWindow();
    const from = rcViewer.maxUpd ? rcViewer.maxUpd : Math.min(win.start, Date.now());
    const [data, st] = await Promise.all([
      rcGet('clusters', rcOrderQuery('upd', from)).catch(()=> null),
      rcGet('status').catch(()=> null)
    ]);
    if(!rcViewer.personalLoaded) await rcLoadPersonal();
    rcViewer.status = st;
    Object.entries(data || {}).forEach(([id, r])=>{
      if(!r) return;
      if(r.upd > rcViewer.maxUpd) rcViewer.maxUpd = r.upd;
      if(r.gone){ delete rcViewer.clusters[id]; return; }
      rcViewer.clusters[id] = r;
    });
    rcViewer.lastFetch = Date.now();
  }finally{ rcViewer.fetching = false; }
}
function rcParseMembers(r, start){
  const yt = new Set(), names = new Set();
  let arts = 0, last = 0;
  Object.values(r.m || {}).forEach(v=>{
    const [k, ts36, src] = String(v).split('|');
    const ts = parseInt(ts36, 36);
    if(!(ts >= start)) return;
    if(k === 'a') arts++;
    else if(k === 'y') yt.add(src);
    else if(k === 's') names.add(src);
    if(ts > last) last = ts;
  });
  return { Y: yt.size, A: arts, S: names.size, T: last };
}
function rcSnsCollected(start){
  const st = rcViewer.status;
  return !!(st && st.sns && st.sns.at && st.sns.at >= start && st.sns.ok);
}
/* 같은 이슈가 묶음 두 개로 갈라져 카드가 두 장 뜨던 것(2026-10-05 실측: 지지율 기사 등 같은 제목 3쌍)을 한 카드로 합친다.
   대표 제목의 단어가 DUP_JACCARD 이상 겹치면 같은 이슈. 카드 번호는 묶음 번호 중 사전순으로 가장 앞선 것(구성이 같으면 안 바뀜). */
function rcCoreTokens(r){
  // 묶음 안 기사 제목들에서 자주 나오는 단어(전체의 30%↑, 최소 2번) = 이 이슈의 핵심어. 대표 제목 하나보다 훨씬 안정적이다.
  if(r._core) return r._core;
  const sets = Object.values(r.d || {}).filter(x=> x.k === 'a').map(x=> rcKeyTokens(x.t));
  sets.push(rcKeyTokens(r.t || ''));
  const cnt = new Map();
  sets.forEach(s=> new Set(s).forEach(w=> cnt.set(w, (cnt.get(w) || 0) + 1)));
  const need = Math.max(2, 0.3 * sets.length);
  r._core = new Set(Array.from(cnt).filter(([, n])=> n >= need).map(([w])=> w));
  return r._core;
}
function rcMergeDuplicates(entries){
  const parent = entries.map((_, i)=> i);
  const find = (i)=>{ while(parent[i] !== i){ parent[i] = parent[parent[i]]; i = parent[i]; } return i; };
  const toks = entries.map(([, r])=>{ if(!r._tt) r._tt = rcTokens(r.t || ''); return r._tt; });
  const cores = entries.map(([, r])=> rcCoreTokens(r));
  for(let i = 0; i < entries.length; i++){
    for(let j = i + 1; j < entries.length; j++){
      const a = toks[i], b = toks[j];
      let same = false;
      if(a.size && b.size){
        let n = 0; a.forEach(w=>{ if(b.has(w)) n++; });
        if(n && n / (a.size + b.size - n) >= RC.DUP_JACCARD) same = true;
      }
      if(!same){   // 같은 사건을 다른 말로 쓴 묶음(2026-10-06 실측: 조희대 국감 한 건이 카드 5장) — 핵심어가 2개 이상, 작은 쪽의 절반 이상 겹치면 같은 이슈
        const ca = cores[i], cb = cores[j];
        if(ca.size && cb.size){
          let n = 0; ca.forEach(w=>{ if(cb.has(w)) n++; });
          if(n >= 2 && n / Math.min(ca.size, cb.size) >= 0.5) same = true;
        }
      }
      if(same) parent[find(j)] = find(i);
    }
  }
  const groups = new Map();
  entries.forEach((e, i)=>{ const g = find(i); if(!groups.has(g)) groups.set(g, []); groups.get(g).push(e); });
  const size = (r)=> Object.keys(r.m || {}).length;
  return Array.from(groups.values()).map(g=>{
    if(g.length === 1) return { cid: g[0][0], r: g[0][1], cids: [g[0][0]] };
    const base = g.slice().sort((x, y)=> size(y[1]) - size(x[1]))[0][1];   // 제목·대표기사는 기사가 많은 쪽
    const m = {}, d = {};
    g.forEach(([, r])=>{ Object.assign(m, r.m || {}); Object.assign(d, r.d || {}); });
    const dd = {};
    Object.entries(d).sort((a, b)=> b[1].ts - a[1].ts).slice(0, RC.DETAIL_MAX).forEach(([k, v])=> dd[k] = v);
    const cids = g.map(x=> x[0]).sort();
    const r = Object.assign({}, base, { m, d: dd,
      first: Math.min(...g.map(x=> x[1].first || Infinity)), last: Math.max(...g.map(x=> x[1].last || 0)) });
    return { cid: cids[0], r, cids };
  });
}
/* 무시·스크랩 기록 찾기 — 묶음 번호가 바뀌어도(다시 계산 등) 기록해 둔 기사 id가 30% 이상 겹치면 같은 이슈로 본다 */
function rcPastFind(map, cids, r){
  for(const c of cids){ if(map[c]) return map[c]; }
  const have = new Set(Object.keys(r.m || {}));
  for(const v of Object.values(map)){
    if(!v || !Array.isArray(v.ids) || !v.ids.length) continue;
    let n = 0; for(const id of v.ids) if(have.has(id)) n++;
    if(n >= Math.max(1, Math.ceil(v.ids.length * 0.3))) return v;
  }
  return null;
}
function rcArticleIds(r){ return Object.keys((r && r.m) || {}).filter(id=> id[0] === 'a').slice(-150); }
function rcRec(cid){ return (rcViewer.view && rcViewer.view[cid]) || rcViewer.clusters[cid]; }
function rcScore(r, sig){
  const age = Math.max(0, Date.now() - (r.first || Date.now()));
  return (sig.A + RC.W_YT * sig.Y + RC.W_SNS * sig.S) * Math.pow(0.5, age / RC.FRESH_HALF_MS);
}
function rcCards(){
  const win = rcWindow();
  const out = [];
  const savedLinks = new Set(Object.values(newsState.savedNews || {}).map(it=> it && it.link).filter(Boolean));
  const savedIds = new Set(Array.from(savedLinks).map(l=> 'a' + rcHash(l)));
  const searchIds = new Set((newsState.articles || []).filter(a=> a && a.link && !rcIsLiveArticle(a)).map(a=> 'a' + rcHash(a.link)));
  const entries = Object.entries(rcViewer.clusters).filter(([cid, r])=> r && !rcViewer.hidden.has(cid) && rcParseMembers(r, win.start).T);
  rcViewer.view = {};
  rcMergeDuplicates(entries).forEach(({ cid, r, cids })=>{
    rcViewer.view[cid] = r;
    if(rcPastFind(rcViewer.scrapped, cids, r)) return;
    const sig = rcParseMembers(r, win.start);
    if(!sig.T) return;
    const kinds = (sig.A ? 1 : 0) + (sig.Y ? 1 : 0) + (sig.S ? 1 : 0);
    // 한 건짜리는 이슈가 아님. 그 밖의 절대 기준은 없다 — 아래에서 점수 순으로 MAX_CARDS개를 고른다.
    // 키워드 검색 기사(실시간에 안 나오는 기사)는 세지 않는다 — 수집 PC가 옛 코드로 만든 묶음도 바로 걸러지게
    const aAll = Object.entries(r.m || {}).filter(([id, v])=> String(v).startsWith('a|') && !searchIds.has(id)).length;
    if(aAll < RC.FRESH_MIN_TOTAL) return;
    if(r.u && searchIds.has('a' + rcHash(r.u))) return;
    // 이미 저장돼 있던 묶음(필터 적용 전 수집분)도 대표 기사가 배제 대상이면 바로 뺀다 — 수집이 다시 도는 6시간을 기다리지 않게
    if(isExcludedArticle({ title: r.t || '', excerpt: r.x || '', link: r.u || '', source: r.rs || '' })) return;
    // 이미 스크랩한 기사가 들어 있는 묶음은 제외 (이번 집계 기간 안의 기사 + 대표기사 + 최근 30건)
    if(Object.entries(r.m || {}).some(([id, v])=> savedIds.has(id) && parseInt(String(v).split('|')[1], 36) >= win.start)) return;
    if(Object.values(r.d || {}).some(x=> x.k === 'a' && savedLinks.has(x.u))) return;
    if(r.u && savedLinks.has(r.u)) return;
    let reappear = false;
    const ig = rcPastFind(rcViewer.ignored, cids, r);
    if(ig){
      const yUp = sig.Y >= Math.max(ig.y * RC.REAPPEAR_RATIO, ig.y + 1) && sig.Y > ig.y;
      const aUp = sig.A >= Math.max(ig.a * RC.REAPPEAR_RATIO, ig.a + 2);
      if(!(yUp || aUp)) return;
      reappear = true;
    }
    out.push({ cid, r, sig, score: rcScore(r, sig), reappear, maybe: (r.maybe && !rcViewer.splitDone.has(cid)) ? r.maybe : null });
  });
  // 합치기·분리 버튼은 뺐다(2026-10-04 사장님: 무엇과 무엇인지 모름). 대신 서로 비슷한 두 묶음이 함께 뜨면 기사 많은 쪽만 남긴다.
  const byCid = new Map(out.map(c=> [c.cid, c]));
  const drop = new Set();
  out.forEach(c=>{
    const o = c.maybe && byCid.get(c.maybe.id);
    if(!o || drop.has(o.cid) || drop.has(c.cid)) return;
    drop.add(o.sig.A > c.sig.A ? c.cid : o.cid);
  });
  if(drop.size){ for(let k = out.length - 1; k >= 0; k--) if(drop.has(out[k].cid)) out.splice(k, 1); }
  if(RC.SORT === 'signal') out.sort((a, b)=> (b.sig.Y + b.sig.A + b.sig.S) - (a.sig.Y + a.sig.A + a.sig.S) || b.sig.T - a.sig.T);
  else out.sort((a, b)=> b.sig.T - a.sig.T);
  // 점수 순으로 MAX_CARDS개만 고른다(상대 순위). 빼기·스크랩·무시된 묶음은 위에서 이미 빠졌으므로 다음 순위가 그 자리를 채운다.
  // 고른 뒤 보여주는 순서는 위 정렬(마지막 추가 시각순) 그대로.
  if(out.length > RC.MAX_CARDS){
    const keep = new Set(out.slice().sort((a, b)=> b.score - a.score || b.sig.T - a.sig.T)
      .slice(0, RC.MAX_CARDS).map(c=> c.cid));
    return out.filter(c=> keep.has(c.cid));
  }
  return out;
}
function rcMarkNew(cards){
  // 처음 쓰는 기기: 지금 보이는 것 전부를 "본 것"으로 — 첫 화면이 전부 깜박이지 않게
  if(!rcSeen){ rcSeen = {}; cards.forEach(c=> rcSeen[c.cid] = c.sig.T); rcSeenSave(rcSeen); }
  const now = Date.now();
  let n = 0;
  cards.forEach(c=>{
    c.isNew = !(rcSeen[c.cid] >= c.sig.T);
    if(c.isNew){ n++; if(!rcViewer.newSince[c.cid]) rcViewer.newSince[c.cid] = now; }
    else delete rcViewer.newSince[c.cid];
  });
  return n;
}
function rcSetBadge(n){
  const el = document.getElementById('rcCount');
  if(el){ el.textContent = n > 99 ? '99+' : String(n); el.hidden = !n; }
  const nb = document.getElementById('modeNewsBtn');
  if(nb) nb.classList.toggle('rc-has-new', n > 0);
}
function rcAgo(ts){
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if(m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}
function rcSignalLine(sig, start){
  const yTotal = (rcViewer.status && rcViewer.status.ytChannels) || 6;
  const sns = rcSnsCollected(start) ? `SNS ${sig.S}명` : `<span class="rc-gray">SNS 미수집</span>`;
  return `유튜브 ${sig.Y}/${yTotal}곳 · 기사 ${sig.A}건 · ${sns}`;
}
function rcStatusLine(){
  const st = rcViewer.status;
  const win = rcWindow();
  const d = new Date(win.start);
  const when = `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  const od = new Date(win.opensAt || win.start);
  const opens = `${String(od.getHours()).padStart(2, '0')}:${String(od.getMinutes()).padStart(2, '0')}`;
  const bits = [win.carry ? `지난 방송 이후 새 이슈 · ${win.nextLabel} 집계는 ${opens}부터`
    : `집계 ${when} 이후${win.nextLabel ? ' · ' + win.nextLabel + '용' : ''}`];
  if(!st || !st.at) bits.push('아직 수집 기록이 없어요 — PC에서 정글2를 켜 두면 15분마다 수집해요');
  else{
    bits.push(`마지막 수집 ${rcAgo(st.at)}${st.collector ? ' (' + esc(st.collector) + ' PC)' : ''}`);
  }
  return bits.join(' · ');
}
/* 카드 모양은 다른 뉴스 탭(newsItemHtml)과 통일 — 제목 오른쪽 "- 빼기 | + 스크랩", 아래 요약문·메타(2026-10-04) */
let rcArticleIndex = null, rcArticleIndexN = -1;
function rcArticleByLink(link){
  const arts = newsState.articles || [];
  if(rcArticleIndexN !== arts.length){ rcArticleIndex = new Map(arts.map(a=> [a.link, a])); rcArticleIndexN = arts.length; }
  return link ? rcArticleIndex.get(link) : null;
}
function rcCardHtml(c, idx, start, enterIdx){
  const r = c.r;
  const art = rcArticleByLink(r.u);
  const excerpt = r.x || (art && (art.excerpt || art.fullText)) || '';
  const src = r.rs || (art && art.source) || '';
  const repTs = r.rt || (art && rcTs(art.pubDate)) || c.sig.T;
  const blink = c.isNew && (Date.now() - (rcViewer.newSince[c.cid] || 0) < RC.NEW_BLINK_MS);
  const badges = (c.isNew ? `<span class="rc-badge rc-new${blink ? ' blink' : ''}">NEW</span>` : '')
    + (c.reappear ? `<span class="rc-badge rc-re">무시했던 이슈</span>` : '');
  const title = r.u ? `<a class="ni-title" href="${esc(r.u)}" target="_blank" rel="noopener">${badges}${esc(r.t)}</a>` : `<span class="ni-title">${badges}${esc(r.t)}</span>`;
  const n = Object.values(r.d || {}).filter(x=> x.ts >= start).length;
  const enter = enterIdx >= 0 ? ` rc-enter" style="animation-delay:${enterIdx * 1.2}s` : '';
  return `<div class="news-item rc-item${c.isNew ? ' is-new' : ''}${enter}" data-rc="${c.cid}">
    <div class="ni-top">
      ${title}
      <div class="action-row">
        <button class="read-btn" data-rc-ignore="${c.cid}">- 빼기</button>
        <span class="action-sep">|</span>
        <button class="save-btn" data-rc-scrap="${c.cid}">+ 스크랩</button>
      </div>
    </div>
    ${excerpt ? `<div class="ni-excerpt">${esc(tidyExcerpt(excerpt))}</div>` : ''}
    <div class="ni-meta">${esc(pressDisplayName(src) || '')}${src ? ' · ' : ''}${relTimeNews(new Date(repTs).toISOString())}</div>
    <div class="rc-sig">${rcSignalLine(c.sig, start)} · 마지막 추가 ${rcAgo(c.sig.T)}
      ${n ? `<button class="rc-link" data-rc-expand="${c.cid}" data-n="${n}">관련 ${n}건 ▾</button>` : ''}</div>
    <div class="rc-detail" id="rcDetail_${c.cid}" hidden></div>
  </div>`;
}
function rcDetailHtml(r, start){
  const items = Object.values(r.d || {}).filter(x=> x.ts >= start).sort((a, b)=> b.ts - a.ts);
  if(!items.length) return '<div class="rc-gray">이 기간에 붙은 항목이 없어요</div>';
  const label = { a: '기사', y: '유튜브', s: 'SNS' };
  const total = Object.keys(r.m || {}).length;
  return items.map(x=> `<div class="rc-di"><span class="rc-k rc-k-${x.k}">${label[x.k] || ''}</span>
      ${x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t)}</a>` : esc(x.t)}
      <span class="rc-gray">${esc(x.s || '')} · ${rcAgo(x.ts)}</span></div>`).join('')
    + (total > items.length ? `<div class="rc-gray">최근 ${items.length}건만 표시</div>` : '');
}
/* 수집이 조용히 죽지 않도록: 유튜브 채널 절반 이상 실패, 수집 전체 실패, 마지막 수집이 40분 넘게 멈춤 중 하나면 빨간 띠로 알린다(2026-10-06 — RSS 차단으로 5/6 실패를 아무도 몰랐음). */
function rcAlertHtml(){
  const st = rcViewer.status;
  if(!st || !st.at) return '';
  const msgs = [];
  if(Date.now() - st.at > 40 * 60 * 1000) msgs.push('수집이 40분 넘게 멈춰 있어요 — 수집 담당 PC에서 정글2를 켜 주세요');
  const y = st.yt;
  if(y && (y.ok === false || (y.channels && y.fail >= Math.ceil(y.channels / 2)))){
    const quota = /403|429/.test(y.err || '');
    msgs.push(`유튜브 수집이 막혔어요(채널 ${y.channels || 0}곳 중 ${y.fail != null ? y.fail : '전부'}곳 실패${y.err ? ' · ' + esc(y.err) : ''})${quota ? ' — API 하루 한도가 찼을 수 있어요' : ' — 유튜브 영상 신호가 빠진 채로 집계 중이에요'}`);
  }
  if(st.emb && st.emb.mode === 'words') msgs.push('의미 비교 모델을 못 불러와 단어 비교로 묶는 중이에요(정확도가 떨어져요)');
  if(st.sns && st.sns.error) msgs.push('SNS 수집 오류: ' + esc(st.sns.error));
  return msgs.map(m=> `<div class="rc-alert">⚠ ${m}</div>`).join('');
}
let rcRenderedIds = new Set();
function rcRender(){
  const root = document.getElementById('recommendPanel');
  if(!root) return;
  const win = rcWindow();
  const cards = rcCards();
  const nNew = rcMarkNew(cards);
  rcSetBadge(nNew);
  if(!rcViewerActive()) return;
  // 화면에 아직 없던 카드는 1.2초 간격으로 하나씩 올라오게
  let enter = 0;
  const firstPaint = !rcRenderedIds.size;
  const html = cards.map((c, i)=> rcCardHtml(c, i, win.start, (!firstPaint && !rcRenderedIds.has(c.cid + ':' + c.sig.T)) ? enter++ : -1)).join('');
  rcRenderedIds = new Set(cards.map(c=> c.cid + ':' + c.sig.T));
  // 머리는 한 번만 그리고, 1분마다는 상태줄과 카드 목록만 바꾼다(펼친 상태 보존)
  if(!root.querySelector('.rc-head')){
    root.innerHTML = `
      <div class="rc-head">
        <div class="rc-status" id="rcStatusLine"></div>
        <div id="rcAlert"></div>
      </div>
      <div id="rcListWrap"></div>`;
  }
  root.querySelector('#rcStatusLine').innerHTML = rcStatusLine();
  root.querySelector('#rcAlert').innerHTML = rcAlertHtml();
  const wrap = root.querySelector('#rcListWrap');
  const openDetails = new Set(Array.from(wrap.querySelectorAll('.rc-detail:not([hidden])')).map(el=> el.id));
  wrap.innerHTML = cards.length ? `<div class="news-grid rc-list">${html}</div>` : `<div class="empty-hint">지금 집계 기간에 올라온 이슈가 없어요.</div>`;
  openDetails.forEach(id=>{
    const el = document.getElementById(id);
    if(!el) return;
    const cid = id.replace('rcDetail_', '');
    el.hidden = false; el.innerHTML = rcDetailHtml(rcRec(cid) || {}, win.start);
    const b = wrap.querySelector(`[data-rc-expand="${cid}"]`); if(b) b.textContent = '접기 ▴';
  });
  rcWire(wrap, win);
}
function rcWire(root, win){
  root.querySelectorAll('[data-rc]').forEach(card=>{
    card.addEventListener('click', ()=> rcMarkSeen(card.dataset.rc), { capture: true });
  });
  root.querySelectorAll('[data-rc-expand]').forEach(b=> b.onclick = ()=>{
    const cid = b.dataset.rcExpand, el = document.getElementById('rcDetail_' + cid);
    if(!el) return;
    el.hidden = !el.hidden;
    b.textContent = el.hidden ? `관련 ${b.dataset.n}건 ▾` : '접기 ▴';
    if(!el.hidden) el.innerHTML = rcDetailHtml(rcRec(cid) || {}, win.start);
  });
  root.querySelectorAll('[data-rc-scrap]').forEach(b=> b.onclick = ()=> rcScrap(b.dataset.rcScrap, b));
  root.querySelectorAll('[data-rc-ignore]').forEach(b=> b.onclick = ()=> rcIgnore(b.dataset.rcIgnore));
}
function rcMarkSeen(cid){
  const r = rcRec(cid);
  if(!r) return;
  const sig = rcParseMembers(r, rcWindow().start);
  if(!rcSeen) rcSeen = {};
  if(rcSeen[cid] >= sig.T) return;
  rcSeen[cid] = sig.T; rcSeenSave(rcSeen);
  delete rcViewer.newSince[cid];
  const card = document.querySelector(`[data-rc="${cid}"]`);
  if(card){ card.classList.remove('is-new'); card.querySelectorAll('.rc-new').forEach(x=> x.remove()); }
  rcSetBadge(rcCards().filter(c=> !(rcSeen[c.cid] >= c.sig.T)).length);
}
function rcRemoveCard(cid){
  const el = document.querySelector(`[data-rc="${cid}"]`);
  if(el) el.remove();
  rcRender();   // 한 장을 빼면(빼기·스크랩) 다음 순위 카드가 그 자리를 채운다(2026-10-06)
}
async function rcIgnore(cid){
  const r = rcRec(cid);
  if(!r) return;
  const sig = rcParseMembers(r, rcWindow().start);
  const rec = { at: Date.now(), y: sig.Y, a: sig.A, s: sig.S, ids: rcArticleIds(r) };
  rcViewer.ignored[cid] = rec;
  rcRemoveCard(cid);
  dbFetch(userPath('recommend_ignored/' + cid), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(rec) })
    .catch(e=> console.warn('[뉴스추천] 무시 저장 실패', e));
}
async function rcScrap(cid, btn){
  const r = rcRec(cid);
  if(!r) return;
  const win = rcWindow();
  const sig = rcParseMembers(r, win.start);
  if(btn){ btn.disabled = true; btn.textContent = '저장 중…'; btn.classList.add('saved'); }
  const label = { a: '기사', y: '유튜브', s: 'SNS' };
  const lines = [`[뉴스추천] ${r.t}`, rcSignalLine(sig, win.start).replace(/<[^>]+>/g, ''), ''];
  Object.values(r.d || {}).filter(x=> x.ts >= win.start).sort((a, b)=> b.ts - a.ts).forEach(x=>{
    lines.push(`· [${label[x.k] || ''}] ${x.t}${x.s ? ' (' + x.s + ')' : ''}`);
    if(x.u) lines.push('  ' + x.u);
  });
  const key = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);
  // 헤드라인(대표) 기사가 일반 기사면 다른 뉴스 카드 스크랩과 똑같이 배경에서 Gemini 요약을 만든다(2026-10-06 사장님 지시).
  // 묶음 기사 목록은 요약 뒤에 그대로 붙는다(noteTail). 대표가 유튜브·SNS면 예전처럼 목록만 저장.
  const link = r.u || '';
  const isArticle = !!link && !isYoutubeUrl(link) && !isTweetUrl(link) && !isFbPostUrl(link);
  const listHtml = linkifyNoteHtml(lines.join('\n'));
  const item = isArticle
    ? { title: r.t, link, source: r.rs || '뉴스추천', pubDate: r.rt ? new Date(r.rt).toISOString() : new Date().toISOString(),
        note: listHtml, noteTail: '<p><br></p>' + listHtml, tags: [], order: nextSavedOrder(), addedAt: Date.now() }
    : { type: 'manual', title: r.t, link, source: '뉴스추천', bodyIsFinal: true,
        note: listHtml, pubDate: new Date().toISOString(), tags: [], order: nextSavedOrder(), addedAt: Date.now() };
  const ok = await saveSavedNewsItem(key, item);
  if(ok && isArticle) enrichScrapWithGeminiNewsSummary(key, link);
  if(ok){
    const srec = { at: Date.now(), ids: rcArticleIds(r) };
    rcViewer.scrapped[cid] = srec;
    dbFetch(userPath('recommend_scrapped/' + cid), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(srec) }).catch(()=>{});
    rcRemoveCard(cid);
    try{ renderSavedNews(); }catch(e){}
    _settingsToast('스크랩에 저장했어요');
  }else{
    if(btn){ btn.disabled = false; btn.textContent = '+ 스크랩'; }
    _settingsToast('스크랩 저장 실패 — 새로고침 후 다시 시도해 주세요');
  }
}

/* ---------- 화면 갱신 주기 ---------- */
async function rcRefreshView(){
  try{ await rcFetchClusters(); }catch(e){}
  rcRender();
}
function rcViewerTick(){
  if(!CURRENT_USER) return;
  const gap = rcViewerActive() ? RC.POLL_ON_MS : RC.POLL_OFF_MS;
  if(Date.now() - rcViewer.lastFetch >= gap - 2000) rcRefreshView();
  else if(rcViewerActive()) rcRender();   // NEW 깜박임 1분 만료 반영
}
window.rcShowTab = function(){ rcViewer.lastFetch = 0; rcRenderedIds = new Set(); rcRefreshView(); };
document.addEventListener('visibilitychange', ()=>{ if(!document.hidden && rcViewerActive()) rcRefreshView(); });
setTimeout(rcTick, 15000);
setInterval(rcTick, RC.TICK_MS);
