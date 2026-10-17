/* ======================================================================
   신피디 데이터 파이프라인 (2026-10-13) — 정글2 전용.
   app-shinpd.js(리포트·대화)가 쓰는 재료를 모으고 기록한다. 전역 스코프 공유, 호출 시점에 다른 app-*.js·recommend.js 전역을 쓴다.
   1) 유튜브 모니터링 화면 데이터(state.tabs) = 리포트의 중심 소스. 오래되면 화면과 같은 방식으로 갱신.
   2) 조회수 스냅샷(15분, RTDB /recommend/shinpd/snap) → "지금 속도 붙는 영상". 구독자 스냅샷(하루 1회, /subs) → 증감.
      서버 크론이 없어서 정글2 탭이 열려 있는 동안만 쌓인다(수집 담당 한 탭이 임대로 맡음).
   3) 우리 채널(정치신세계) 인식·지난 영상 이력 → 제목·섬네일 제안의 근거.
   4) 검색·트렌드: 구글 트렌드 한국 급상승(RSS), 네이버·유튜브 자동완성, 네이버 데이터랩(Worker /datalab).
   5) 스튜디오 CSV 읽기(구독자·조회수 등). 스튜디오 API 연동은 아직 없음.
   6) 제목·섬네일 제안(제미나이). 정글2의 "AI는 노동만" 원칙의 예외 — 신피디의 제목·섬네일·각 제안에만 쓴다.
   ====================================================================== */
const SPD = {
  SNAP_MS: 15 * 60 * 1000,         // 조회수 기록 간격
  SNAP_KEEP_MS: 8 * 3600 * 1000,   // 기록 보관
  TRACK_H: 72,                     // 이 시간 안에 올라온 영상만 추적
  YT_STALE_MS: 40 * 60 * 1000,     // 유튜브 목록이 이보다 오래되면 리포트 직전에 갱신
  TOPIC_WIN_H: 24,
  TOPICS_MAX: 12,
  RISING_MAX: 10,
  SUBS_EVERY_MS: 20 * 3600 * 1000,
  SUBS_KEEP_DAYS: 40,
  HIST_STALE_MS: 6 * 3600 * 1000
};
let spdYtAt = {};                  // 탭별 마지막 갱신 시각(이 파일이 한 것)

const SPD_JUNK = /(시죠|하죠|니다|네요|군요|래요|세요|인가요|일까|할까|더니|는데|인데|해요|예요|이에요|어요|아요)$/;   // 대화체 어미 조각은 주제 이름·핵심어에서 뺀다("어려우시죠 김예지" 사고)
function spdSleep(ms){ return new Promise(r=> setTimeout(r, ms)); }
function spdDayKey(ts){
  const d = new Date(ts);
  return `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}`;
}
function spdDayKeyToTs(k){ return new Date(+k.slice(0, 4), +k.slice(4, 6) - 1, +k.slice(6, 8), 12).getTime(); }
function spdRtdb(path, opt){ return dbFetch(`${RC_BASE()}/shinpd/${path}.json`, opt); }
async function spdGet(path, query){
  const res = await dbFetch(`${RC_BASE()}/shinpd/${path}.json${query ? '?' + query : ''}`);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  return res.json();
}
async function spdPutJson(path, obj){
  const res = await spdRtdb(path, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) });
  if(!res.ok) throw new Error('HTTP ' + res.status);
}
/* 여러 탭 중 한 탭만 하게 하는 임대(recommend.js와 같은 방식) */
async function spdClaim(name, ms){
  const cur = await spdGet(name).catch(()=> null);
  if(cur && cur.at && Date.now() - cur.at < ms) return false;
  const me = 'p' + Math.random().toString(36).slice(2, 8);
  await spdPutJson(name, { id: me, at: Date.now() });
  await spdSleep(1200);
  const chk = await spdGet(name).catch(()=> null);
  return !!(chk && chk.id === me);
}

/* ---------- 1. 유튜브 모니터링 화면 데이터 ---------- */
function spdDurSec(d){
  const p = String(d || '').split(':').map(Number);
  if(!p.length || p.some(x=> !isFinite(x))) return null;
  return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : (p.length === 2 ? p[0] * 60 + p[1] : null);
}
function spdYtAll(){
  const out = [];
  (TAB_DEFS || []).forEach(td=>{
    const tab = state.tabs[td.id];
    if(!tab) return;
    (tab.channels || []).forEach(c=>{
      const chName = ((tab.meta || {})[c.id] || {}).title || c.name || c.handle || '';
      ((tab.videos || {})[c.id] || []).forEach(v=>{
        const ts = new Date(v.publishedAt).getTime();
        if(!v || !v.id || !isFinite(ts)) return;
        out.push({ id: v.id, t: v.title || '', ch: chName, chId: c.id, tab: td.id, ts, views: v.views == null ? NaN : Number(v.views),
          live: !!v.isLive, short: !!v.isShort, thumb: v.thumb || '', dur: spdDurSec(v.duration) });
      });
    });
  });
  return out;
}
async function spdRefreshTab(tabId){
  const cur = state.tabs[tabId];
  if(!cur) return { ok: 0, fail: 0 };
  let ok = 0, fail = 0;
  for(const c of (cur.channels || [])){
    try{
      let pl = (c.playlistId || '').trim();
      if(!pl){
        if(!cur.meta[c.id]) cur.meta[c.id] = await fetchChannel(c.handle);
        pl = cur.meta[c.id].uploadsPlaylistId;
      }
      cur.videos[c.id] = await fetchRecentVideos(pl);
      if(cur.errors) delete cur.errors[c.id];
      ok++;
    }catch(e){
      (cur.errors || (cur.errors = {}))[c.id] = e.message;
      fail++;
    }
  }
  spdYtAt[tabId] = Date.now();
  try{ if(typeof _ytAutoLast !== 'undefined') _ytAutoLast[tabId] = Date.now(); }catch(e){}
  try{ ytCacheSave(); }catch(e){}
  try{ if(state.activeTab === tabId && _currentMode === 'yt') { renderSections(); } }catch(e){}
  return { ok, fail };
}
async function spdRefreshStaleTabs(staleMs){
  const res = { refreshed: 0, ok: 0, fail: 0 };
  for(const td of (TAB_DEFS || [])){
    const last = Math.max(spdYtAt[td.id] || 0, (typeof _ytAutoLast !== 'undefined' && _ytAutoLast[td.id]) || 0);
    if(Date.now() - last < staleMs) continue;
    const r = await spdRefreshTab(td.id);
    res.refreshed++; res.ok += r.ok; res.fail += r.fail;
  }
  return res;
}

/* ---------- 2-a. 조회수 스냅샷(15분) ---------- */
function spdSlot(ts){ return Math.floor(ts / SPD.SNAP_MS).toString(36).padStart(6, '0'); }
async function spdSnapTick(){
  try{
    if(!CURRENT_USER || typeof _appStarted === 'undefined' || !_appStarted) return;
    const last = await spdGet('snap_last').catch(()=> null);
    if(last && Date.now() - last < SPD.SNAP_MS - 60000) return;
    if(!(await spdClaim('snap_lease', 4 * 60 * 1000))) return;
    await spdRefreshStaleTabs(60 * 60 * 1000);          // 새 영상 발견용(한 시간에 한 번)
    const now = Date.now();
    const ids = Array.from(new Set(spdYtAll().filter(v=> !v.short && now - v.ts < SPD.TRACK_H * 3600 * 1000).map(v=> v.id)));
    const ours = await spdOurHistoryCached().catch(()=> null);
    if(ours && ours.vids) ours.vids.filter(v=> !v.short && now - v.p < SPD.TRACK_H * 3600 * 1000).forEach(v=> { if(!ids.includes(v.id)) ids.push(v.id); });
    if(!ids.length) return;
    const snap = {};
    for(let i = 0; i < ids.length; i += 50){
      const data = await ytGet('videos', { part: 'statistics', id: ids.slice(i, i + 50).join(',') });
      (data.items || []).forEach(it=> { const n = Number(it.statistics && it.statistics.viewCount); if(isFinite(n)) snap[it.id] = n; });
    }
    await spdPutJson('snap/' + spdSlot(now), snap);
    await spdPutJson('snap_last', now);
    // 오래된 기록 정리
    const keys = await spdGet('snap', 'shallow=true').catch(()=> null);
    const cut = spdSlot(now - SPD.SNAP_KEEP_MS);
    for(const k of Object.keys(keys || {})){ if(k < cut) await spdRtdb('snap/' + k, { method: 'DELETE' }).catch(()=>{}); }
  }catch(e){ console.warn('[신피디] 조회수 기록 실패', e); }
}
async function spdLoadSnaps(){
  const raw = await spdGet('snap').catch(()=> null) || {};
  return Object.keys(raw).sort().map(k=> ({ at: parseInt(k, 36) * SPD.SNAP_MS, m: raw[k] || {} }));
}
/* 영상별 지난 한 시간 조회수 증가. 기록이 없으면 올라온 뒤 평균 시속으로 대신(est). */
function spdRate(v, snaps, now){
  const cur = isFinite(v.views) ? v.views : null;
  const ageH = Math.max(0.25, (now - v.ts) / 3600000);
  const withV = snaps.filter(s=> s.m[v.id] != null);
  if(withV.length){
    const latest = withV[withV.length - 1];
    const base = cur != null ? Math.max(cur, latest.m[v.id]) : latest.m[v.id];
    const target = now - 3600000;
    const old = withV.filter(s=> s.at <= latest.at - 20 * 60000).sort((a, b)=> Math.abs(a.at - target) - Math.abs(b.at - target))[0];
    if(old){
      const dtH = Math.max(0.3, (now - old.at) / 3600000);
      const perH = (base - old.m[v.id]) / dtH;
      let acc = null;
      const older = withV.filter(s=> s.at <= old.at - 20 * 60000).sort((a, b)=> Math.abs(a.at - (old.at - 3600000)) - Math.abs(b.at - (old.at - 3600000)))[0];
      if(older){
        const prev = (old.m[v.id] - older.m[v.id]) / Math.max(0.3, (old.at - older.at) / 3600000);
        if(prev > 0) acc = perH / prev;
      }
      return { perH: Math.max(0, perH), d: Math.max(0, base - old.m[v.id]), acc, est: false, views: base };
    }
  }
  return cur != null ? { perH: cur / ageH, d: null, acc: null, est: true, views: cur } : null;
}

/* ---------- 3. 우리 채널 인식 + 이력 ---------- */
function spdOurFromTabs(){
  for(const td of (TAB_DEFS || [])){
    const tab = state.tabs[td.id];
    for(const c of ((tab && tab.channels) || [])){
      const nm = ((tab.meta || {})[c.id] || {}).title || c.name || '';
      if(spOurs(nm) || spOurs(c.name || '')) return { chId: c.id, name: nm || c.name, handle: c.handle, uploads: ((tab.meta || {})[c.id] || {}).uploadsPlaylistId || (c.playlistId || ''), registered: true };
    }
  }
  return null;
}
async function spdOurChannel(){
  const reg = spdOurFromTabs();
  if(reg){
    if(!reg.uploads && reg.handle){ try{ reg.uploads = (await fetchChannel(reg.handle)).uploadsPlaylistId; }catch(e){} }
    return reg;
  }
  const cfgHandle = (typeof JUNGLE_CONFIG !== 'undefined' && JUNGLE_CONFIG.ourYoutubeHandle) || '';
  let saved = await spdGet('ourch').catch(()=> null);
  if(saved && saved.uploads) return { name: saved.title, handle: saved.handle || '', uploads: saved.uploads, channelId: saved.id, registered: false };
  if(cfgHandle){
    const d = await ytGet('channels', { part: 'snippet,contentDetails', forHandle: cfgHandle.startsWith('@') ? cfgHandle : '@' + cfgHandle });
    const it = (d.items || [])[0];
    if(it){ saved = { id: it.id, title: it.snippet.title, handle: cfgHandle, uploads: it.contentDetails.relatedPlaylists.uploads }; await spdPutJson('ourch', saved); return { name: saved.title, handle: saved.handle, uploads: saved.uploads, channelId: saved.id, registered: false }; }
  }
  // 이름 검색(100유닛) — 실패하면 6시간 동안 다시 시도하지 않음
  try{
    const noRetry = Number(localStorage.getItem('jsg_spd_ourch_try') || 0);
    if(Date.now() - noRetry < 6 * 3600 * 1000) return null;
    localStorage.setItem('jsg_spd_ourch_try', String(Date.now()));
  }catch(e){}
  const q = SHINPD.OUR_CHANNEL_HINT();
  const s = await ytGet('search', { part: 'snippet', type: 'channel', q, maxResults: 5 });
  const norm = x=> String(x || '').replace(/\s+/g, '');
  const hit = (s.items || []).find(it=> norm(it.snippet && it.snippet.title).includes(norm(q)));
  if(!hit) return null;
  const cid = hit.snippet.channelId || (hit.id && hit.id.channelId);
  const d = await ytGet('channels', { part: 'snippet,contentDetails', id: cid });
  const it = (d.items || [])[0];
  if(!it) return null;
  saved = { id: it.id, title: it.snippet.title, handle: it.snippet.customUrl || '', uploads: it.contentDetails.relatedPlaylists.uploads };
  await spdPutJson('ourch', saved);
  return { name: saved.title, handle: saved.handle, uploads: saved.uploads, channelId: saved.id, registered: false, autoFound: true };
}
async function spdFetchOurHistory(our){
  const vids = [];
  let pageToken;
  for(let page = 0; page < 2; page++){
    const params = { part: 'snippet', playlistId: our.uploads, maxResults: 50 };
    if(pageToken) params.pageToken = pageToken;
    const d = await ytGet('playlistItems', params);
    (d.items || []).forEach(it=> {
      const t = it.snippet && it.snippet.title;
      if(t && t !== 'Private video' && t !== 'Deleted video') vids.push({ id: it.snippet.resourceId.videoId, t, p: new Date(it.snippet.publishedAt).getTime() });
    });
    pageToken = d.nextPageToken;
    if(!pageToken) break;
  }
  for(let i = 0; i < vids.length; i += 50){
    const d = await ytGet('videos', { part: 'statistics,contentDetails,liveStreamingDetails', id: vids.slice(i, i + 50).map(v=> v.id).join(',') });
    const by = {}; (d.items || []).forEach(x=> { by[x.id] = x; });
    vids.slice(i, i + 50).forEach(v=>{
      const x = by[v.id]; if(!x) return;
      v.v = Number(x.statistics && x.statistics.viewCount);
      v.live = !!x.liveStreamingDetails;
      const secs = durationToSeconds(x.contentDetails && x.contentDetails.duration);
      v.short = !v.live && secs !== null && secs <= YT_SHORT_MAX_SEC;
    });
  }
  return vids.filter(v=> isFinite(v.v));
}
async function spdOurHistoryCached(){
  const cached = await spdGet('ourhist').catch(()=> null);
  if(cached && cached.at && Date.now() - cached.at < SPD.HIST_STALE_MS) return cached;
  const our = await spdOurChannel().catch(()=> null);
  if(!our || !our.uploads) return cached || null;
  const vids = await spdFetchOurHistory(our);
  const out = { at: Date.now(), name: our.name, vids: vids.slice(0, 100) };
  await spdPutJson('ourhist', out).catch(()=>{});
  return out;
}

/* ---------- 2-b. 구독자 스냅샷(하루 1회) + 증감 ---------- */
async function spdSubsTick(){
  try{
    if(!CURRENT_USER || typeof _appStarted === 'undefined' || !_appStarted) return;
    const last = await spdGet('subs_last').catch(()=> null);
    if(last && Date.now() - last < SPD.SUBS_EVERY_MS) return;
    if(!(await spdClaim('subs_lease', 5 * 60 * 1000))) return;
    const rec = {};
    for(const td of (TAB_DEFS || [])){
      const tab = state.tabs[td.id];
      for(const c of ((tab && tab.channels) || [])){
        if(!c.handle) continue;
        try{
          const d = await ytGet('channels', { part: 'statistics', forHandle: c.handle.startsWith('@') ? c.handle : '@' + c.handle });
          const st = d.items && d.items[0] && d.items[0].statistics;
          if(st && !st.hiddenSubscriberCount && st.subscriberCount != null)
            rec[c.id] = { n: Number(st.subscriberCount), nm: ((tab.meta || {})[c.id] || {}).title || c.name || c.handle };
        }catch(e){}
      }
    }
    try{
      const our = await spdOurChannel();
      if(our){
        let st = null;
        if(our.channelId){ const d = await ytGet('channels', { part: 'statistics', id: our.channelId }); st = d.items && d.items[0] && d.items[0].statistics; }
        else if(our.handle){ const d = await ytGet('channels', { part: 'statistics', forHandle: our.handle.startsWith('@') ? our.handle : '@' + our.handle }); st = d.items && d.items[0] && d.items[0].statistics; }
        if(st && !st.hiddenSubscriberCount && st.subscriberCount != null) rec.our = { n: Number(st.subscriberCount), nm: our.name || SHINPD.OUR_CHANNEL_HINT(), our: true };
      }
    }catch(e){}
    if(!Object.keys(rec).length) return;
    await spdPutJson('subs/' + spdDayKey(Date.now()), rec);
    await spdPutJson('subs_last', Date.now());
    const keys = await spdGet('subs', 'shallow=true').catch(()=> null);
    const cut = spdDayKey(Date.now() - SPD.SUBS_KEEP_DAYS * 86400000);
    for(const k of Object.keys(keys || {})){ if(k < cut) await spdRtdb('subs/' + k, { method: 'DELETE' }).catch(()=>{}); }
  }catch(e){ console.warn('[신피디] 구독자 기록 실패', e); }
}
async function spdSubsSummary(){
  const raw = await spdGet('subs').catch(()=> null) || {};
  const days = Object.keys(raw).sort();
  if(!days.length) return { rows: [], days: 0 };
  const lastDay = days[days.length - 1];
  const nearest = (targetTs)=> { let best = null, bd = Infinity; days.forEach(k=> { const d = Math.abs(spdDayKeyToTs(k) - targetTs); if(k !== lastDay && d < bd){ bd = d; best = k; } }); return best; };
  const lastTs = spdDayKeyToTs(lastDay);
  const d1k = nearest(lastTs - 86400000), d7k = nearest(lastTs - 7 * 86400000);
  const rows = Object.entries(raw[lastDay] || {}).map(([id, o])=> {
    const p1 = d1k && raw[d1k] && raw[d1k][id], p7 = d7k && raw[d7k] && raw[d7k][id];
    return { id, nm: o.nm, n: o.n, our: !!o.our || spOurs(o.nm),
      d1: p1 ? o.n - p1.n : null, d1Days: d1k ? Math.round((lastTs - spdDayKeyToTs(d1k)) / 86400000) : null,
      d7: p7 ? o.n - p7.n : null, d7Days: d7k ? Math.round((lastTs - spdDayKeyToTs(d7k)) / 86400000) : null };
  });
  rows.sort((a, b)=> (b.our ? 1 : 0) - (a.our ? 1 : 0) || (b.d1 || 0) - (a.d1 || 0));
  return { rows, days: days.length, lastDay };
}

/* ---------- 4. 검색·트렌드 ---------- */
function spdProxyFetch(url, ms){
  return fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(url)}`, {}, ms || 15000).then(r=> { if(!r.ok) throw new Error('HTTP ' + r.status); return r.text(); });
}
function spdFlatStrings(x, out){
  if(typeof x === 'string') out.push(x);
  else if(Array.isArray(x)) x.forEach(y=> spdFlatStrings(y, out));
  return out;
}
async function spdGoogleTrends(){
  const xml = await spdProxyFetch('https://trends.google.com/trending/rss?geo=KR');
  const doc = new DOMParser().parseFromString(xml, 'text/xml');
  const txt = (el, tag)=> { const n = el.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
  return Array.from(doc.getElementsByTagName('item')).slice(0, 25).map(it=> ({
    t: txt(it, 'title'), traffic: txt(it, 'ht:approx_traffic'), news: txt(it, 'ht:news_item_title'), newsUrl: txt(it, 'ht:news_item_url')
  })).filter(x=> x.t);
}
async function spdSuggest(kw){
  const out = { kw, naver: [], yt: [], err: '' };
  try{
    const txt = await spdProxyFetch(`https://ac.search.naver.com/nx/ac?q=${encodeURIComponent(kw)}&con=1&frm=nx&ans=2&r_format=json&r_enc=UTF-8&r_unicode=0&t_koreng=1&run=2&rev=4&q_enc=UTF-8&st=100`);
    const j = JSON.parse(txt);
    out.naver = Array.from(new Set(spdFlatStrings(j.items, []).filter(s=> s && s !== kw && !/^[0-9]+$/.test(s)))).slice(0, 8);
  }catch(e){ out.err = '네이버 ' + (e.message || e); }
  try{
    const txt = await spdProxyFetch(`https://suggestqueries.google.com/complete/search?client=firefox&ds=yt&hl=ko&q=${encodeURIComponent(kw)}`);
    const j = JSON.parse(txt);
    out.yt = Array.from(new Set(spdFlatStrings(j[1], []).filter(s=> s && s !== kw))).slice(0, 8);
  }catch(e){ out.err += (out.err ? ' · ' : '') + '유튜브 ' + (e.message || e); }
  return out;
}
async function spdDatalab(keywords){
  const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/datalab`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ keywords: keywords.slice(0, 5) })
  }, 15000);
  const j = await res.json().catch(()=> ({}));
  if(!res.ok) throw new Error(j.error ? String(j.error).slice(0, 80) : 'HTTP ' + res.status);
  return (j.results || []).map(r=> {
    const pts = (r.data || []).map(p=> Number(p.ratio)).filter(x=> isFinite(x));
    if(!pts.length) return { kw: r.title, last: null, chg: null };
    const last = pts[pts.length - 1], prev = pts.slice(0, -1);
    const avg = prev.length ? prev.reduce((a, b)=> a + b, 0) / prev.length : 0;
    return { kw: r.title, last: Math.round(last), chg: avg > 0 ? Math.round((last / avg - 1) * 100) : null };
  });
}
async function spdCollectTrends(keywords){
  const out = { google: [], suggest: [], datalab: [], status: {} };
  let gerr = '';
  for(let i = 0; i < 2 && !out.google.length; i++){   // 한 번 실패해도 한 번 더(2026-10-13)
    try{ out.google = await spdGoogleTrends(); }catch(e){ gerr = String(e.message || e).slice(0, 60); await spdSleep(1500); }
  }
  out.status.google = out.google.length ? 'ok' : '구글 트렌드: ' + (gerr || '목록이 비어 있음');
  let sugErr = 0;
  for(const kw of keywords.slice(0, 5)){
    const s = await spdSuggest(kw);
    if(s.err && !s.naver.length && !s.yt.length) sugErr++;
    out.suggest.push({ kw, naver: s.naver, yt: s.yt });
    await spdSleep(400);
  }
  out.status.suggest = keywords.length && sugErr === Math.min(5, keywords.length) ? '자동완성을 못 받음' : 'ok';
  try{ out.datalab = keywords.length ? await spdDatalab(keywords) : []; out.status.datalab = 'ok'; }
  catch(e){ out.status.datalab = '데이터랩: ' + String(e.message || e).slice(0, 70) + ' (Worker 재배포·데이터랩 권한 필요)'; }
  return out;
}

/* ---------- 5. 스튜디오 CSV ---------- */
function spdCsvRows(text){
  text = String(text || '').replace(/^﻿/, '');
  const first = text.split(/\r?\n/)[0] || '';
  const delim = (first.match(/\t/g) || []).length > (first.match(/,/g) || []).length ? '\t' : ((first.match(/;/g) || []).length > (first.match(/,/g) || []).length ? ';' : ',');
  const rows = []; let row = [], cur = '', q = false;
  for(let i = 0; i < text.length; i++){
    const ch = text[i];
    if(q){ if(ch === '"'){ if(text[i + 1] === '"'){ cur += '"'; i++; } else q = false; } else cur += ch; }
    else if(ch === '"') q = true;
    else if(ch === delim){ row.push(cur); cur = ''; }
    else if(ch === '\n' || ch === '\r'){ if(ch === '\r' && text[i + 1] === '\n') i++; row.push(cur); cur = ''; if(row.some(x=> x.trim() !== '')) rows.push(row); row = []; }
    else cur += ch;
  }
  row.push(cur); if(row.some(x=> x.trim() !== '')) rows.push(row);
  return rows;
}
function spdParseStudio(text){
  const rows = spdCsvRows(text);
  if(rows.length < 2) throw new Error('표에 데이터가 없어요');
  const head = rows[0].map(h=> String(h).trim().toLowerCase());
  const find = (...res)=> head.findIndex(h=> res.some(r=> r.test(h)));
  const col = {
    date: find(/날짜|^date|^day|^일$/),
    views: find(/^조회수|^views/),
    subs: find(/^구독자$|^subscribers$|구독자 순|net subscribers|구독자 증감/),
    gained: find(/구독자.*(획득|증가)|subscribers gained/),
    lost: find(/구독자.*(손실|감소)|subscribers lost/),
    watch: find(/시청 ?시간|watch time/),
    impr: find(/노출수|^impressions$/),
    ctr: find(/노출 클릭률|impressions click-through|^ctr/)
  };
  if(col.date < 0) throw new Error('날짜 열을 찾지 못했어요(스튜디오에서 내려받은 CSV인지 확인해 주세요)');
  const num = s=> { const n = parseFloat(String(s == null ? '' : s).replace(/[,%\s]/g, '')); return isFinite(n) ? n : null; };
  const out = [];
  rows.slice(1).forEach(r=>{
    const m = String(r[col.date] || '').match(/(\d{4})\D+(\d{1,2})\D+(\d{1,2})/);
    if(!m) return;
    const o = { d: `${m[1]}${m[2].padStart(2, '0')}${m[3].padStart(2, '0')}` };
    ['views', 'subs', 'gained', 'lost', 'watch', 'impr', 'ctr'].forEach(k=> { if(col[k] >= 0) o[k] = num(r[col[k]]); });
    if(o.subs == null && o.gained != null && o.lost != null) o.subs = o.gained - Math.abs(o.lost);
    out.push(o);
  });
  if(!out.length) throw new Error('날짜가 있는 행이 없어요');
  const keep = Object.keys(col).filter(k=> col[k] >= 0 && k !== 'date');
  if(col.subs < 0 && col.gained >= 0 && col.lost >= 0) keep.push('subs');   // 획득-손실로 계산한 순증감
  if(!keep.length) throw new Error('조회수·구독자 등 알아볼 수 있는 열이 없어요');
  out.sort((a, b)=> a.d < b.d ? -1 : 1);
  return { rows: out.slice(-400), cols: keep };
}
async function spdSaveStudio(text){
  const p = spdParseStudio(text);
  const data = { at: Date.now(), cols: p.cols, rows: p.rows };
  await spdPutJson('studio', data);
  return data;
}
async function spdStudioSummary(){
  const s = await spdGet('studio').catch(()=> null);
  if(!s || !s.rows || !s.rows.length) return null;
  const rows = s.rows;
  const sum = (arr, k)=> arr.reduce((a, r)=> a + (r[k] || 0), 0);
  const last7 = rows.slice(-7), prev7 = rows.slice(-14, -7);
  const o = { at: s.at, from: last7[0].d, to: last7[last7.length - 1].d, cols: s.cols || [] };
  ['views', 'subs', 'gained', 'lost', 'watch', 'impr'].forEach(k=> {
    if((s.cols || []).includes(k)){ o[k] = Math.round(sum(last7, k) * 10) / 10; if(prev7.length) o[k + 'Prev'] = Math.round(sum(prev7, k) * 10) / 10; }
  });
  if((s.cols || []).includes('ctr')){ const v = last7.map(r=> r.ctr).filter(x=> x != null); if(v.length) o.ctr = Math.round(v.reduce((a, b)=> a + b, 0) / v.length * 10) / 10; }
  o.daily = last7.map(r=> ({ d: r.d, views: r.views, subs: r.subs }));
  return o;
}

/* ---------- 6. 제목·섬네일 제안(제미나이) ---------- */
function spdParseJsonLoose(text){
  const m = String(text || '').match(/\{[\s\S]*\}/);
  if(!m) return null;
  try{ return JSON.parse(m[0]); }catch(e){ return null; }
}
async function spdAdvise(topic, ctx){
  if(geminiQuotaLeft('shinpd') <= 0) return { error: '오늘 이 기기에서 쓸 수 있는 제안 횟수를 다 썼어요.' };
  const ourTop = (ctx.ourTop || []).slice(0, 8).map(v=> `- ${v.t} (조회수 ${v.v})`).join('\n') || '(없음)';
  const ourRecent = (ctx.ourRecent || []).slice(0, 5).map(v=> `- ${v.t} (조회수 ${v.v})`).join('\n') || '(없음)';
  const vids = (topic.vids || []).slice(0, 6).map(v=> `- [${v.ch}] ${v.t} (조회수 ${v.views == null ? '?' : v.views}, ${spAgo(v.ts)})`).join('\n');
  const sug = (ctx.suggest || []).map(s=> `${s.kw}: 네이버 ${s.naver.slice(0, 5).join(', ') || '-'} / 유튜브 ${s.yt.slice(0, 5).join(', ') || '-'}`).join('\n') || '(없음)';
  const prompt = [
    '당신은 시사 유튜브 "정치신세계"의 PD입니다. 편집장에게 영상 제목과 섬네일을 제안합니다.',
    '아래 [데이터]에 있는 것만 근거로 하고, 없는 사실을 지어내지 않습니다. 낚시성 허위 단정, 확인되지 않은 의혹을 사실처럼 쓰는 표현은 피합니다.',
    '출력은 JSON 한 덩어리만: {"taken":["이미 쓰인 각 2~3개 — 아래 영상 제목들에서 읽히는 프레임을 각 한 줄로"],"angle":"그 프레임들과 겹치지 않는, 아직 비어 있는 각 한 줄(데이터에 없는 사실은 지어내지 말고 방향만)","titles":["제목 후보 5개, 각 40자 이내"],"thumbs":[{"text":"섬네일 문구(2줄 이내)","layout":"구도·인물·색 한 줄"} 3개],"why":"우리 채널에서 잘 된 제목의 어떤 점을 따랐는지 한 줄"}',
    '',
    '[데이터]',
    `주제: ${topic.t}`,
    `이 주제를 다룬 영상(${topic.nCh}개 채널):\n${vids}`,
    `우리 채널(정치신세계)에서 조회수가 높았던 영상:\n${ourTop}`,
    `우리 채널 최근 영상:\n${ourRecent}`,
    `이 주제 관련 검색어·자동완성:\n${sug}`
  ].join('\n');
  geminiQuotaConsume('shinpd');
  const { text, error } = await callGeminiParts([{ text: prompt }]);
  if(!text) return { error: error || '제안을 못 받았어요.' };
  const j = spdParseJsonLoose(text);
  if(!j || !Array.isArray(j.titles)) return { error: '제안 형식을 읽지 못했어요.' };
  return { taken: (Array.isArray(j.taken) ? j.taken : []).map(x=> String(x).slice(0, 80)).slice(0, 3), angle: String(j.angle || '').slice(0, 200), why: String(j.why || '').slice(0, 200),
    titles: j.titles.map(x=> String(x).slice(0, 80)).slice(0, 5),
    thumbs: (j.thumbs || []).map(x=> ({ text: String((x && x.text) || '').slice(0, 80), layout: String((x && x.layout) || '').slice(0, 120) })).slice(0, 3) };
}

/* ---------- 제목 정리(이모지·따옴표·괄호 꼬리표 제거, 짧게) ---------- */
function spdCleanTitle(s, n){
  const src = String(s || '');
  let t = src.replace(/[\u{1F000}-\u{1FFFF}\u{2600}-\u{27BF}\u{FE0F}\u{200D}]/gu, ' ')
    .replace(/\([^)]*\)|\[[^\]]*\]|【[^】]*】|<[^>]*>/g, ' ')
    .replace(/[“”"‘’'「」『』《》]/g, '')
    .replace(/[…·|]+/g, ' ').replace(/\s+/g, ' ').trim();
  n = n || 30;
  if(t.length > n) t = t.slice(0, n).replace(/\s+\S*$/, '') + '…';
  return t || src.slice(0, n);
}

/* ---------- 주제 묶기(유튜브 영상 제목 기준) ---------- */
/* 우리 영상이 이 이슈를 다뤘는지 — 겹치는 낱말 2개 이상, 또는 3자 이상 뚜렷한 낱말 1개(인물명·사건어)(2026-10-16: 우리 방송 제목에 인물명이 빠져 '우리 영상 없음'으로 잘못 나왔음) */
function spOursMatch(core, toks){
  let n = 0, long = false;
  core.forEach(w=> { if(toks.has(w)){ n++; if(w.length >= 3) long = true; } });
  return n >= 2 || long;
}
function spdTopics(videos, now, ourRecent){
  const win = now - SPD.TOPIC_WIN_H * 3600000;
  const vs = videos.filter(v=> v.ts >= win && !v.short).sort((a, b)=> b.ts - a.ts).map(v=> Object.assign({}, v, { tok: new Set(rcKeyTokens(v.t)) }));
  const cl = [];
  vs.forEach(v=>{
    let best = null, bs = 0;
    cl.forEach(c=>{ let n = 0; v.tok.forEach(w=> { if(c.freq.has(w)) n++; }); if(n >= 2 && n > bs){ bs = n; best = c; } });
    if(!best){ best = { vids: [], freq: new Map() }; cl.push(best); }
    best.vids.push(v);
    v.tok.forEach(w=> best.freq.set(w, (best.freq.get(w) || 0) + 1));
  });
  return cl.map(c=>{
    const chs = new Map();
    c.vids.forEach(v=> { const o = chs.get(v.chId || v.ch); if(!o || (v.views || 0) > (o.views || 0)) chs.set(v.chId || v.ch, v); });
    const rep = c.vids.slice().sort((a, b)=> (isFinite(b.views) ? b.views : 0) - (isFinite(a.views) ? a.views : 0))[0];
    const need = c.vids.length >= 3 ? Math.ceil(c.vids.length * 0.3) : 2;
    let core = Array.from(c.freq.entries()).filter(([w, n])=> n >= Math.min(need, c.vids.length) && !SPD_JUNK.test(w)).sort((a, b)=> b[1] - a[1] || b[0].length - a[0].length).map(([w])=> w);
    if(core.length < 2) core = Array.from(rep.tok).filter(w=> !SPD_JUNK.test(w));
    const coreSet = new Set(core.slice(0, 6));
    const oursV = c.vids.some(v=> spOurs(v.ch));
    const oursRecent = (ourRecent || []).some(v=> spOursMatch(coreSet, new Set(rcKeyTokens(v.t))));
    return {
      key: rcHash(Array.from(coreSet).sort().join('|') || rep.t),
      t: (core.slice(0, 3).join(' ') || spdCleanTitle(rep.t)), rt: spdCleanTitle(rep.t, 40), kw: core[0] || '', core: Array.from(coreSet),
      nCh: chs.size, views: c.vids.reduce((a, v)=> a + (isFinite(v.views) ? v.views : 0), 0),
      newest: Math.max.apply(null, c.vids.map(v=> v.ts)),
      ours: oursV || oursRecent,
      vids: Array.from(chs.values()).sort((a, b)=> (isFinite(b.views) ? b.views : 0) - (isFinite(a.views) ? a.views : 0)).slice(0, 6)
        .map(v=> ({ id: v.id, ch: v.ch, t: v.t, u: 'https://www.youtube.com/watch?v=' + v.id, ts: v.ts, views: isFinite(v.views) ? v.views : null, live: v.live }))
    };
  }).sort((a, b)=> b.nCh - a.nCh || b.views - a.views);
}

/* ---------- 시작 ---------- */
let spdTimer = null;
function spdStart(){
  if(spdTimer) return;
  const on = ()=> (typeof menuEnabled !== 'function') || menuEnabled('shinpd');   // 신피디 메뉴를 끄면 조회수·구독자 기록(유튜브 API)도 멈춤
  setTimeout(()=> { if(on()){ spdSnapTick(); spdSubsTick(); } }, 45000);
  spdTimer = setInterval(()=> { if(on()){ spdSnapTick(); spdSubsTick(); } }, 5 * 60 * 1000);
}
