/* =========================================================================
   신피디 '유튜브 알고리즘' 탭 (2026-10-14 사장님 지시: 알고리즘·공식 입장·운영 지침을 유튜브·SNS·기사로 끌어오기)
   - 자세한 자료 탭줄의 한 칸. 리포트와 별개로 /recommend/shinpd/algo 에 저장(팀 공용), 6시간 지나면 탭을 열 때 새로 가져옴.
   - 출처: ① 공식 입장·지침(How YouTube Works 페이지 → 제미나이가 원문 근거로만 요약, 주 1회)
           ② YouTube 공식 블로그(RSS) ③ 공식 영상(Creator Insider·YouTube Creators·YouTube Korea, 유튜브 API 채널당 1유닛)
           ④ SNS(YouTube Creators·TeamYouTube 공식 X, vidIQ는 비공식 표시) ⑤ 기사(네이버 뉴스 최신순)
   - 제미나이는 번역·요약만 한다(원문에 없는 말·평가·조언 금지). 한도는 별도 통 shinpdalgo(하루 30).
   ========================================================================= */
const SPA = {
  STALE_MS: 6 * 3600 * 1000,
  GUIDE_MS: 7 * 86400000,
  CHANNELS: [
    { id: 'UCGg-UqjRgzhYDPJMr-9HXCg', name: 'Creator Insider' },
    { id: 'UCkRfArvrzheW2E7b6SVT7vQ', name: 'YouTube Creators' },
    { id: 'UCOH52Yqq4-rdLvpt2Unsqsw', name: 'YouTube Korea' },
    { id: 'UCxJexsOTNecY8aaBJjWe4Yg', name: 'YouTube 크리에이터(한국)' },
    // 크리에이터 노하우 채널(비공식) — 2026-10-16 사장님: 비블 같은 채널도 신피디 학습자료로. 공식 지식과 섞이지 않게 official:false로 표시
    { id: 'UCP-fDy76kLheskwrmA-b5_w', name: '비블 bibl(비공식)', official: false },
    { id: 'UCXG8hH02Em6_6pF38THOlSg', name: '광장(비공식)', official: false },
    { id: 'UCMEP3ouODGt9C8Ed4DbjZjQ', name: '애니한 콘텐츠랩(비공식)', official: false, only: /유튜브|쇼츠|알고리즘|조회|구독|채널|수익|노출|썸네일|후킹|클릭/ }
  ],
  X: [{ h: 'YouTubeCreators', official: true }, { h: 'TeamYouTube', official: true }, { h: 'vidiq', official: false }],
  QUERIES: ['유튜브 알고리즘', '유튜브 정책 변경', '유튜브 수익 창출 정책', '유튜브 쇼츠 정책', '유튜버 수익화 기준', '유튜브 추천 알고리즘'],
  GUIDES: [
    { id: 'rec', name: '추천 알고리즘 — 유튜브 공식 설명', u: 'https://www.youtube.com/howyoutubeworks/product-features/recommendations/' },
    { id: 'pol', name: '정책 개요 — 유튜브 공식', u: 'https://www.youtube.com/howyoutubeworks/policies/' }
  ]
};
let spAlgo = null, spAlgoLoaded = false, spAlgoBusy = false, spAlgoWanted = false, spAlgoMsg = '';

function spaStrip(h){
  return String(h || '').replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ').replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&quot;/g, '"').replace(/&#0?39;|&apos;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim();
}
async function spaFetchText(url){
  let err = '';
  for(let i = 0; i < 3; i++){
    try{
      const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(url)}`, { cache: 'no-store' }, 20000);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      return await res.text();
    }catch(e){ err = String(e.message || e); await rcSleep(1200); }
  }
  throw new Error(err);
}

/* ③ 공식 영상(채널 업로드 목록: 채널당 1유닛 + 길이 확인 1유닛) — 내용 정리는 펼칠 때 만든다 */
const SPA_VSUM_MAX_SEC = 25 * 60;
async function spaVideos(){
  const out = [];
  for(const c of SPA.CHANNELS){
    try{
      const d = await ytGet('playlistItems', { part: 'snippet', playlistId: 'UU' + c.id.slice(2), maxResults: 5 });
      (d.items || []).forEach(it=> {
        const sn = it.snippet || {};
        if(!sn.title || sn.title === 'Private video' || sn.title === 'Deleted video') return;
        // YouTube Korea는 오락·이벤트 영상이 많아 알고리즘·정책·크리에이터 관련 제목만
        if(c.name === 'YouTube Korea' && !/알고리즘|정책|수익|쇼츠|Shorts|크리에이터|업데이트|기능|스튜디오|YPP|가이드|파트너|채널|조회|구독/i.test(sn.title)) return;
        if(c.only && !c.only.test(sn.title)) return;
        out.push({ off: c.official === false, id: (sn.resourceId || {}).videoId, ch: c.name, t: sn.title, u: 'https://www.youtube.com/watch?v=' + (sn.resourceId || {}).videoId, ts: Date.parse(sn.publishedAt) });
      });
    }catch(e){ if(!out.length && c === SPA.CHANNELS[SPA.CHANNELS.length - 1]) throw e; }
  }
  // 채널당 최근 3개씩만 모아 최신순 14개 — 올리는 횟수가 많은 채널이 공식 영상을 밀어내지 않게
  const per = {}; const top = out.sort((a, b)=> b.ts - a.ts).filter(x=> { per[x.ch] = (per[x.ch] || 0) + 1; return per[x.ch] <= 3; }).slice(0, 14).filter(x=> x.id);
  try{
    const d = await ytGet('videos', { part: 'contentDetails', id: top.map(x=> x.id).join(',') });
    const sec = {}; (d.items || []).forEach(v=> { sec[v.id] = durationToSeconds((v.contentDetails || {}).duration) || 0; });
    top.forEach(x=> { x.sec = sec[x.id] || 0; });
  }catch(e){}
  return top;
}
// 펼치면 만드는 영상 내용 정리: 제미나이가 영상을 보고 한국어 불릿 5~7개(영상에 나온 내용만). 한 번 만들면 팀이 같이 씀
let spaVsumBusy = new Set(), spaOpen = new Set();
/* 영상 읽기 호출 사이 간격 — 3.1 Flash Lite 분당 토큰 한도(무료 250K)를 영상 몇 개가 한 번에 넘겨 429가 났다(2026-10-16). 이전 호출 시작 후 25초 이상 지나야 다음 영상을 읽는다. */
let spVideoGateAt = 0, spVideoGateQ = Promise.resolve();
function spVideoGate(){
  const p = spVideoGateQ.then(async ()=> {
    const wait = Math.max(0, spVideoGateAt + 25000 - Date.now());
    if(wait) await new Promise(r=> setTimeout(r, wait));
    spVideoGateAt = Date.now();
  });
  spVideoGateQ = p.catch(()=> {});
  return p;
}
async function spaVideoSummary(v){
  if(geminiQuotaLeft('shinpdalgo') <= 0) return { err: '오늘 정리 한도를 다 썼어요' };
  geminiQuotaConsume('shinpdalgo');
  const prompt = '이 유튜브 영상(영어일 수 있음)의 핵심을 한국어 1~2문장(두 줄 이내)으로 설명해줘. 크리에이터가 알아야 할 가장 중요한 한 가지를 골라, 무엇이 바뀌는지·조건·수치·시점처럼 구체적인 내용을 담아. "이 영상은~" 같은 소개말, 인사, 홍보, 나열은 쓰지 마. 영상에서 말하거나 보여 준 내용만 쓰고 추측은 금지. 한 문장만 써도 좋다. 불릿·마크다운·이모티콘 금지.';
  const parts = [{ text: prompt }, { file_data: { file_uri: v.u }, video_metadata: Object.assign({ fps: 0.2 }, v.sec > 15 * 60 ? { start_offset: '0s', end_offset: '900s' } : {}) }];
  await spVideoGate();
  let res = await Promise.race([callGeminiParts(parts, undefined, GEMINI_VIDEO_MODEL), new Promise(r=> setTimeout(()=> r({ text: null, error: '시간 초과' }), 120000))]);
  if(!res.text) res = await Promise.race([callGeminiParts(parts), new Promise(r=> setTimeout(()=> r({ text: null, error: '시간 초과' }), 120000))]);   // 영상 모델이 막히면 기본 모델(토큰 통이 따로)로
  if(!res.text) return { err: res.error || '정리하지 못했어요' };
  return { bullets: res.text.replace(/\*\*/g, '').trim().slice(0, 400), at: Date.now(), v: 2 };
}
function spaBulletsHtml(b){
  return `<ul class="sp-list">${String(b).split('\n').map(l=> l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).map(l=> `<li><div class="sp-sub">${esc(l)}</div></li>`).join('')}</ul>`;
}
async function spaEnsureVideoSummary(id){
  if(!spAlgo || !id) return;
  const v = (spAlgo.videos || []).find(x=> x.id === id);
  if(!v) return;
  spAlgo.vsum = spAlgo.vsum || {};
  const body = ()=> document.querySelector(`.sp-vbody[data-vid="${id}"]`);
  const put = html=> { const b = body(); if(b) b.querySelector('.sp-vtext').innerHTML = html; };
  if(spAlgo.vsum[id] && spAlgo.vsum[id].bullets && spAlgo.vsum[id].v === 2){ put(spaBulletsHtml(spAlgo.vsum[id].bullets)); return; }
  if(v.sec > SPA_VSUM_MAX_SEC){ put('<span class="sp-sub">영상이 길어서(25분 초과) 정리하지 않았어요. 아래 링크로 보세요.</span>'); return; }
  if(spaVsumBusy.has(id)) return;
  spaVsumBusy.add(id);
  put('<span class="sp-sub">영상 내용을 정리하는 중… (10~30초)</span>');
  try{
    const r = await spaVideoSummary(v);
    if(r.bullets){
      spAlgo.vsum[id] = { bullets: r.bullets, at: r.at, v: 2 };
      put(spaBulletsHtml(r.bullets));
      spdPutJson('algo/vsum/' + id, spAlgo.vsum[id]).catch(()=>{});
      try{ if(typeof sppYtkFromVideo === 'function') sppYtkFromVideo(v, r.bullets); }catch(e){}   // v.off=true면 비공식 노하우로 저장
    }else{ put(`<span class="sp-warn">${esc(r.err)}. 접었다가 다시 펼치면 다시 시도합니다.</span>`); }
  }finally{ spaVsumBusy.delete(id); }
}

/* ④ SNS(X) — 답글(@로 시작)은 뺌 */
async function spaSns(){
  const res = await fetch(X_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ all: true, days: 14, targets: SPA.X.map(x=> ({ name: x.h, x: x.h })) }) });
  const j = await res.json();
  if(!res.ok) throw new Error(j.error || ('HTTP ' + res.status));
  const off = {}; SPA.X.forEach(x=> { off[x.h.toLowerCase()] = x.official; });
  const per = {};
  return (j.posts || []).filter(p=> p.text && !/^@/.test(p.text.trim()))
    .sort((a, b)=> Date.parse(b.created || b.date) - Date.parse(a.created || a.date))
    .filter(p=> { const k = String(p.handle).toLowerCase(); per[k] = (per[k] || 0) + 1; return per[k] <= 4; })
    .slice(0, 10).map(p=> ({ h: p.handle, official: !!off[String(p.handle).toLowerCase()], t: String(p.text).replace(/\s+/g, ' ').slice(0, 280), u: p.url || '', ts: Date.parse(p.created || p.date) }));
}

/* ⑤ 기사(네이버 뉴스 최신순) */
async function spaNews(){
  const rows = [];
  for(const q of SPA.QUERIES){
    try{
      const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/?query=${encodeURIComponent(q)}&display=30&sort=date`, {}, 15000);
      const j = await res.json();
      (j.items || []).forEach(it=> rows.push({ t: spaStrip(it.title), u: it.originallink || it.link, ts: Date.parse(it.pubDate), d: spaStrip(it.description).slice(0, 110), q }));
    }catch(e){}
    await rcSleep(300);
  }
  const seen = new Set();
  const out = rows.filter(x=> x.t && x.u && /유튜브|유튜버|youtube|쇼츠/i.test(x.t) && /알고리즘|정책|수익|약관|가이드라인|규정|개편|변경|업데이트|제재|광고|노출|추천|저작권/.test(x.t + ' ' + x.d)).sort((a, b)=> (b.ts || 0) - (a.ts || 0)).filter(x=> { const k = x.t.replace(/\s+/g, '').slice(0, 18); if(seen.has(k)) return false; seen.add(k); return true; });
  if(!out.length) throw new Error('기사를 받지 못함');
  return out.slice(0, 12);
}

/* 영어 → 한국어 번역·한 줄 요지(제미나이 1회). 원문에 없는 말 금지 */
async function spaTranslate(data){
  const items = [];
  (data.videos || []).forEach((x, i)=> items.push({ k: 'v' + i, t: x.t }));
  (data.sns || []).forEach((x, i)=> items.push({ k: 's' + i, t: x.t }));
  const need = items.filter(x=> !/[가-힣]{3}/.test(x.t));
  if(!need.length || geminiQuotaLeft('shinpdalgo') <= 0) return;
  geminiQuotaConsume('shinpdalgo');
  const prompt = '다음은 YouTube 공식 블로그·공식 영상·공식/관련 계정의 영어 글이야. 각 항목을 JSON 배열로만 답해. 형식: [{"k":"키","ko":"제목·본문을 자연스러운 한국어로 옮긴 것(고유명사·기능 이름은 원문 그대로 병기 가능)","pt":"원문에 적힌 핵심만 한국어 한 문장(60자 이내), 없으면 빈 문자열"}]. 원문에 없는 내용·추측·평가·조언은 쓰지 마.\n\n' + JSON.stringify(need.slice(0, 30));
  const res = await callGeminiParts([{ text: prompt }], { responseMimeType: 'application/json' });
  let arr = null;
  try{ arr = res.text ? JSON.parse((res.text.match(/\[[\s\S]*\]/) || ['null'])[0]) : null; }catch(e){}
  if(!Array.isArray(arr)) return;
  const map = {}; arr.forEach(x=> { if(x && x.k) map[x.k] = x; });
  const put = (list, p)=> (list || []).forEach((x, i)=> { const m = map[p + i]; if(m){ x.ko = String(m.ko || '').slice(0, 300); x.pt = String(m.pt || '').slice(0, 100); } });
  put(data.videos, 'v'); put(data.sns, 's');
}

async function spAlgoRefresh(){
  if(spAlgoBusy) return;
  spAlgoBusy = true; spAlgoMsg = '가져오는 중…'; shinpdPaint();
  const errors = [];
  try{
    const [videos, sns, news] = await Promise.allSettled([spaVideos(), spaSns(), spaNews()]);
    const val = (r, name)=> { if(r.status === 'fulfilled') return r.value; errors.push(name + ': ' + String(r.reason && r.reason.message || r.reason).slice(0, 60)); return null; };
    const prev = spAlgo || {};
    const data = { at: Date.now(), videos: val(videos, '공식 영상') || (prev.videos || []), sns: val(sns, 'SNS') || (prev.sns || []), news: val(news, '기사') || (prev.news || []), errors };
    // 이미 만든 영상 내용 정리는 현재 목록에 있는 것만 남김
    const ids = new Set(data.videos.map(v=> v.id));
    data.vsum = {}; Object.keys(prev.vsum || {}).forEach(k=> { if(ids.has(k)) data.vsum[k] = prev.vsum[k]; });
    try{ await spaTranslate(data); }catch(e){ errors.push('번역: ' + String(e.message || e).slice(0, 50)); }
    spAlgo = data;
    await spdPutJson('algo', data).catch(()=> errors.push('저장 실패'));
    try{ if(typeof sppYtkFromAlgo === 'function') sppYtkFromAlgo(data); }catch(e){}   // 유튜브 지식 창고에 공식 글을 넣고 공부(백그라운드)
  }finally{
    spAlgoBusy = false; spAlgoMsg = '';
    shinpdPaint();
  }
}
/* 정해진 시각(KST) 중 지금까지 가장 최근 것 — 자동 갱신은 이 시각이 지났는데 자료가 그 전 것일 때만 한다(2026-10-16 사장님: 이슈·방송 브리핑 13시·18시, 알고리즘 짝수날 06시, 나머지는 새로고침 때) */
function spLastSlot(hours, now, dayOk){
  const K = 9 * 3600000, day = 86400000;
  const base = Math.floor((now + K) / day) * day;   // 오늘 0시(KST) — UTC 기준 환산
  for(let d = 0; d < 4; d++){
    const dayStart = base - d * day;
    if(dayOk && !dayOk(new Date(dayStart).getUTCDate())) continue;
    for(const h of hours.slice().sort((a, b)=> b - a)){
      const t = dayStart + h * 3600000 - K;
      if(t <= now) return t;
    }
  }
  return 0;
}
function spAlgoSlot(now){ return spLastSlot([6], now || Date.now(), d=> d % 2 === 0); }
async function spAlgoEnsure(force){
  if(!spAlgoLoaded){ spAlgoLoaded = true; try{ spAlgo = await spdGet('algo'); }catch(e){} shinpdPaint(); }
  const stale = !spAlgo || !spAlgo.at || spAlgo.at < spAlgoSlot();
  if((force || (spAlgoWanted && stale)) && !spAlgoBusy) await spAlgoRefresh();
}

/* 화면 */
function spAlgoHtml(){
  const d = spAlgo;
  const head = `<div class="sp-sub">${spAlgoBusy ? esc(spAlgoMsg || '가져오는 중…') : (d && d.at ? `${esc(spClock(d.at))} 갱신 · ${esc(spAgo(d.at))}` : '아직 가져온 자료가 없습니다.')} <button type="button" class="sp-mini" data-algo-refresh${spAlgoBusy ? ' disabled' : ''}>새로고침</button></div>`;
  if(!d) return head + (spAlgoBusy ? '' : '<p class="sp-sub">탭을 열면 자동으로 가져옵니다. 처음 한 번은 20~30초 걸립니다.</p>');
  const warn = (d.errors || []).length ? `<p class="sp-warn">일부를 못 가져왔어요: ${esc(d.errors.join(' · '))}</p>` : '';
  const sec = (title, sub, body)=> `<div class="sp-camp"><div class="sp-line"><b>${esc(title)}</b>${sub ? ` <span class="sp-sub">${esc(sub)}</span>` : ''}</div>${body}</div>`;
  const vs = d.vsum || {};
  const vids = (d.videos || []).length ? (d.videos || []).map(x=> {
    const open = spaOpen.has(x.id);
    const sm = vs[x.id] && vs[x.id].v === 2 && vs[x.id].bullets;
    const inner = sm ? spaBulletsHtml(sm) : (x.sec > SPA_VSUM_MAX_SEC ? '<span class="sp-sub">영상이 길어서(25분 초과) 정리하지 않았어요. 아래 링크로 보세요.</span>' : '<span class="sp-sub">펼치면 영상 내용을 정리해 보여 줍니다.</span>');
    return `<details class="sp-det sp-in sp-vdet" data-vid="${esc(x.id)}"${open ? ' open' : ''}><summary>${esc(x.ko || x.t)} <span class="sp-sub">${esc(x.ch)} · ${isFinite(x.ts) ? esc(spAgo(x.ts)) : ''}</span></summary>`
      + `<div class="sp-vbody" data-vid="${esc(x.id)}"><div class="sp-vtext">${inner}</div><div class="sp-sub"><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">영상으로 가기 ↗</a></div></div></details>`;
  }).join('') : '<div class="sp-sub">가져오지 못했습니다.</div>';
  const sns = (d.sns || []).length ? `<ul class="sp-list">${d.sns.map(x=> `<li><div class="sp-line">${x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${esc(x.ko || x.t)}</a>` : esc(x.ko || x.t)}</div><div class="sp-sub">@${esc(x.h)}${x.official ? '' : ' (비공식·유튜브 분석 서비스)'} · ${isFinite(x.ts) ? esc(spAgo(x.ts)) : ''}</div></li>`).join('')}</ul>` : '<div class="sp-sub">가져오지 못했습니다.</div>';
  const news = (d.news || []).length ? `<ul class="sp-list">${d.news.map(x=> `<li><div class="sp-line">${spLink(x.u, x.t)}</div><div class="sp-sub">${isFinite(x.ts) ? esc(spAgo(x.ts)) + ' · ' : ''}${esc(x.d)}</div></li>`).join('')}</ul>` : '<div class="sp-sub">가져오지 못했습니다.</div>';
  return head + warn
    + sec('공식·크리에이터 영상', '제목을 누르면 내용 정리가 펼쳐지고, 거기서 영상으로 갈 수 있어요. (비공식)은 크리에이터 노하우 채널이에요', vids)
    + sec('SNS', 'X 공식 계정 최근 글(답글 제외)', sns)
    + sec('관련 기사', '알고리즘·정책 변경·수익 창출 최신순', news);
}
function spAlgoPanel(){
  if(shinpdTab === 'algo') spAlgoWanted = true;
  if(!spAlgoLoaded || (spAlgoWanted && !spAlgoBusy && (!spAlgo || !spAlgo.at || spAlgo.at < spAlgoSlot()))) setTimeout(()=> spAlgoEnsure(false), 0);
  return spDet('algo', '유튜브 알고리즘', spAlgo && spAlgo.at ? spAgo(spAlgo.at) : '', spAlgoHtml());
}
/* ---------- 상단 보기 탭(이슈 브리핑 / 유튜브 알고리즘) — 2026-10-15 사장님: 탭은 화면 상단에 ---------- */
let shinpdView = 'report';
try{ const sv = localStorage.getItem('shinpd_view'); shinpdView = (sv === 'algo' || sv === 'brief') ? sv : 'report'; }catch(e){}
function spViewIsAlgo(){ return shinpdView === 'algo' || shinpdView === 'brief'; }   // 이슈 브리핑이 아닌 보기(알고리즘·방송 브리프)
function spViewSyncChrome(){
  document.querySelectorAll('#shinpdViewTabs .sp-vt').forEach(b=> b.classList.toggle('on', b.getAttribute('data-view') === shinpdView));
  const sub = document.querySelector('#shinpdPaper .gm-subject');
  if(sub) sub.textContent = shinpdView === 'algo' ? '유튜브 알고리즘·운영 지침' : (shinpdView === 'brief' ? '방송 브리프' : '신피디 모니터링 리포트');
}
function spViewPaintAlgo(root){
  spViewSyncChrome();
  if(shinpdView === 'brief' && typeof spbPaint === 'function'){ spbPaint(root); return; }
  if(shinpdView === 'algo'){ spAlgoWanted = true; if(!spAlgoLoaded || (!spAlgoBusy && (!spAlgo || !spAlgo.at || spAlgo.at < spAlgoSlot()))) setTimeout(()=> spAlgoEnsure(false), 0); }
  const meta = document.getElementById('shinpdMeta');
  if(meta) meta.textContent = spAlgoBusy ? '가져오는 중…' : (spAlgo && spAlgo.at ? `${spClock(spAlgo.at)} 갱신 · ${spAgo(spAlgo.at)}` : '자료 없음');
  root.innerHTML = spAlgoHtml();
}
function spViewSet(v){
  shinpdView = (v === 'algo' || v === 'brief') ? v : 'report';
  try{ localStorage.setItem('shinpd_view', shinpdView); }catch(e){}
  shinpdPaint();
}
document.addEventListener('click', e=>{
  const vt = e.target.closest && e.target.closest('#shinpdViewTabs .sp-vt');
  if(vt){ spViewSet(vt.getAttribute('data-view')); return; }
  const b = e.target.closest && e.target.closest('[data-algo-refresh]');
  if(b){ spAlgoWanted = true; spAlgoEnsure(true); }
});
// 알고리즘 보기에서는 상단 새로고침 아이콘이 알고리즘 자료를 새로 가져오게(리포트를 다시 만들지 않음)
document.addEventListener('click', e=>{
  if(shinpdView === 'algo' && e.target.closest && e.target.closest('#shinpdRefresh')){ e.stopImmediatePropagation(); e.preventDefault(); spAlgoWanted = true; spAlgoEnsure(true); }
}, true);
// 공식 영상 아코디언: 펼치면 내용 정리를 만들거나 저장된 것을 보여 줌
document.addEventListener('toggle', e=>{
  const d = e.target;
  if(!d || !d.classList || !d.classList.contains('sp-vdet')) return;
  const id = d.getAttribute('data-vid');
  if(d.open){ spaOpen.add(id); spaEnsureVideoSummary(id); } else spaOpen.delete(id);
}, true);
