/* ======================================================================
   신피디 (2026-10-13) — 정글2 전용. 정치신세계 PD 겸 모니터링 담당 AI 캐릭터.
   - 리포트: 정글2가 이미 수집한 데이터(추천 묶음·유튜브·SNS·여론·스크랩)를 숫자·시각·링크로만 정리. AI 호출 0, 중요도 판단 없음.
   - 3시간마다 자동(정글2 탭이 열려 있는 동안) + [새로고침] 즉시 생성. 결과는 RTDB /recommend/shinpd/report 한 부를 팀 3명이 같이 봄.
   - 대화: 저장된 리포트 데이터만 근거로 제미나이가 답함(없으면 "없습니다"). 하루 기기별 상한 GEMINI_DAILY_CAP.shinpd.
   recommend.js·app-opinion.js 전역(rcGet, rcCards, rcViewer, opinionState …)을 호출 시점에 쓴다(이 파일이 먼저 로드돼도 무방).
   ====================================================================== */
const SHINPD = {
  EVERY_MS: 2 * 3600 * 1000,       // 자동 생성 주기
  LEASE_MS: 4 * 60 * 1000,         // 동시에 여러 탭이 만들지 않게 하는 임대
  CHECK_MS: 5 * 60 * 1000,         // 자동 생성 필요 여부 점검 간격
  YT_HOURS: 48,                    // 조회수 상위 대상 기간
  TOP_ISSUES: 10,
  INTEREST_MAX: 20,                // 관심인물 SNS 조회 상한(계정 보호)
  FACE: 'shinpd-face.jpg?v=20261013b',
  OUR_CHANNEL_HINT: () => String((typeof JUNGLE_CONFIG !== 'undefined' && JUNGLE_CONFIG.siteName) || '정치신세계')
};
let shinpdReport = null;           // 화면에 쓰는 마지막 리포트
let shinpdBusy = false;
let shinpdTimer = null;
let shinpdChat = [];               // [{role:'user'|'pd', text}]
let shinpdChatBusy = false;
let shinpdChatAt = 0;              // 마지막 대화 시각(ms). 0 = 모름. users/{uid}/shinpd_chat_at 에도 저장(2026-10-16)
const SP_CHAT_IDLE_MS = 20 * 60 * 1000;   // 마지막 대화 후 이만큼 지나면 del처럼 자동 초기화(사장님 2026-10-16: "대화 끊어진지 20분이면 초기화")
let shinpdIdleWait = false;
let shinpdAdvice = {};            // 제목·섬네일 제안 { 주제키: {angle,titles,thumbs,why,at,t} }

/* ---------- 작은 헬퍼 ---------- */
function spOurs(name){ return String(name || '').replace(/\s+/g, '').includes(SHINPD.OUR_CHANNEL_HINT().replace(/\s+/g, '')); }
function spAgo(ts){
  const m = Math.max(0, Math.floor((Date.now() - ts) / 60000));
  if(m < 1) return '방금';
  if(m < 60) return `${m}분 전`;
  const h = Math.floor(m / 60);
  return h < 24 ? `${h}시간 전` : `${Math.floor(h / 24)}일 전`;
}
function spClock(ts){
  const d = new Date(ts);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}
function spNum(n){ return (n == null || n === '') ? '-' : Number(n).toLocaleString('ko-KR'); }
function spVideoId(u){ const m = String(u || '').match(/[?&]v=([\w-]{6,})/); return m ? m[1] : ''; }
function spPut(path, obj){
  return dbFetch(`${RC_BASE()}/${path}.json`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(obj) })
    .then(r=> { if(!r.ok) throw new Error('HTTP ' + r.status); });
}
function spNextBroadcast(){
  const now = Date.now();
  const next = rcBroadcastSlots(now, 1).filter(x=> x.at > now).sort((a, b)=> a.at - b.at)[0];
  return next ? { at: next.at, label: next.label } : null;
}

/* ---------- 관심인물(그룹 탭 별표) — Firestore REST ---------- */
function spFsStr(f){ return f && typeof f.stringValue === 'string' ? f.stringValue : ''; }
async function spLoadInterestPeople(){
  const cfg = { pid: JUNGLE_CONFIG.firebase.projectId, key: JUNGLE_CONFIG.firebase.apiKey };   // people.html과 같은 Firebase 프로젝트
  let ns = 'shared';
  try{ ns = localStorage.getItem('jungle_sns_client') || 'shared'; }catch(e){}
  const col = ns === 'shared' ? 'people_v2' : `sns_u/${ns}/people_v2`;
  const out = [];
  let pageToken = '';
  for(let guard = 0; guard < 10; guard++){
    const q = new URLSearchParams({ pageSize: '300', key: cfg.key });
    if(pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${cfg.pid}/databases/(default)/documents/${col}?${q}`);
    if(!res.ok) throw new Error('관심인물 목록 HTTP ' + res.status);
    const j = await res.json();
    (j.documents || []).forEach(d=>{
      const f = d.fields || {};
      if(!(f.interest && f.interest.booleanValue === true)) return;
      const links = ((f.links && f.links.arrayValue && f.links.arrayValue.values) || [])
        .map(v=> spFsStr(v.mapValue && v.mapValue.fields && v.mapValue.fields.url)).filter(Boolean);
      const fb = links.find(u=> /facebook\.com/i.test(u)) || '';
      const x = links.find(u=> /(^|\/\/)(www\.)?(x|twitter)\.com\//i.test(u)) || '';
      out.push({ name: spFsStr(f.name) || '(이름 없음)', fb: fb ? rcFbVanity(fb) : '', x });
    });
    pageToken = j.nextPageToken || '';
    if(!pageToken) break;
  }
  return out;
}
/* 국회의원 중 계파 태그에 '관심'이 붙은 의원 — sns_u/{고객사}/politicians(주관) + politicians(FB·X) */
async function spLoadInterestMembers(){
  const token = await firebase.auth().currentUser.getIdToken();
  const pid = JUNGLE_CONFIG.firebase.projectId;
  const cli = JUNGLE_CONFIG.snsClient || 'sunnydesk';
  const tagged = [];
  let pageToken = '';
  for(let guard = 0; guard < 10; guard++){
    const q = new URLSearchParams({ pageSize: '300' });
    ['factions', 'name'].forEach(f=> q.append('mask.fieldPaths', f));
    if(pageToken) q.set('pageToken', pageToken);
    const res = await fetch(`https://firestore.googleapis.com/v1/projects/${pid}/databases/(default)/documents/sns_u/${cli}/politicians?${q}`,
      { headers: { Authorization: 'Bearer ' + token } });
    if(!res.ok) throw new Error('관심 의원 목록 HTTP ' + res.status);
    const j = await res.json();
    (j.documents || []).forEach(d=>{
      const f = d.fields || {};
      const tags = ((f.factions && f.factions.arrayValue && f.factions.arrayValue.values) || []).map(spFsStr);
      if(tags.some(t=> t.trim() === '관심')) tagged.push({ id: d.name.split('/').pop(), name: spFsStr(f.name) });
    });
    pageToken = j.nextPageToken || '';
    if(!pageToken) break;
  }
  if(!tagged.length) return [];
  const obj = await rcFsList('politicians', ['fb', 'x', 'name']);
  const out = [];
  tagged.forEach(t=>{
    const o = obj[t.id] || {};
    const fb = /facebook\.com/i.test(o.fb || '') ? rcFbVanity(o.fb) : '';
    const x = (o.x || '').trim();
    out.push({ name: t.name || o.name || t.id.replace(/^\d+_/, ''), fb, x });
  });
  return out;
}
/* ---------- 딴지일보 게시판 베스트(자유게시판 등) — Worker /fetch로 받아 표를 읽는다 ---------- */
const DDANZI_URL = 'https://www.ddanzi.com/best_all';
async function spCollectDdanzi(){
  const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(DDANZI_URL)}`, { cache: 'no-store' }, 20000);
  if(!res.ok) throw new Error('딴지 응답 ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const rows = Array.from(doc.querySelectorAll('table.fz_change tbody tr')).filter(tr=> tr.querySelector('td.title'));
  const num = el=> parseInt(String(el ? el.textContent : '').replace(/[^\d]/g, ''), 10) || 0;
  const posts = rows.slice(0, 30).map(tr=>{
    const a = tr.querySelector('td.title a');
    const boardEl = a && a.querySelector('span');
    const board = boardEl ? boardEl.textContent.replace(/[\[\]]/g, '').trim() : '';
    const title = a ? Array.from(a.childNodes).filter(n=> n.nodeType === 3).map(n=> n.textContent).join('').replace(/\s+/g, ' ').trim() : '';
    const href = a ? (a.getAttribute('href') || '').replace(/&statusList=[^&#]*/, '') : '';
    return { t: title, board, u: href, comments: num(tr.querySelector('.talk')), votes: num(tr.querySelector('td.voteNum')), views: num(tr.querySelector('td.readNum')), date: (tr.querySelector('td.time') || {}).textContent ? tr.querySelector('td.time').textContent.trim() : '' };
  }).filter(x=> x.t && x.u);
  if(!posts.length) throw new Error('딴지 글 목록을 읽지 못함(페이지 모양 변경?)');
  return posts.sort((a, b)=> b.votes - a.votes).slice(0, 20);   // 빼기로 지워도 다른 글이 채워지도록 넉넉히
}
/* 관심 명단은 Firestore 문서 수백 건을 통째로 읽는다 — 리포트를 만들 때마다 읽으면 하루 5만 건 무료 읽기 한도를 금방 쓴다(2026-10-17 429).
   RTDB에 사본을 두고 6시간 안엔 그걸 쓴다. Firestore가 막히면 오래된 사본이라도 쓴다. */
const SP_INTEREST_TTL = 6 * 3600000;
async function spInterestCached(name, loader){
  let c = null;
  try{ c = await spdGet('interest_' + name); }catch(e){}
  const ok = c && c.at && (Array.isArray(c.list) || c.n === 0);
  if(ok && Date.now() - c.at < SP_INTEREST_TTL) return Array.isArray(c.list) ? c.list : [];
  try{
    const list = await loader();
    spdPutJson('interest_' + name, { at: Date.now(), n: list.length, list }).catch(()=> {});
    return list;
  }catch(e){
    if(ok) return Array.isArray(c.list) ? c.list : [];
    throw e;
  }
}
async function spCollectInterestPosts(sinceTs){
  const status = { ok: true, people: 0, error: '', detail: '' };
  const dg = { members: 0, stars: 0, fbN: 0, fbFail: 0, fbPosts: 0, xN: 0, xPosts: 0, noAddr: 0 };
  const posts = [];
  let people = [];
  let members = [], memberErr = '';
  try{ members = await spInterestCached('members', spLoadInterestMembers); }
  catch(e){ memberErr = '관심 의원 명단을 못 읽음(' + String(e.message || e) + ')'; }
  dg.members = members.length;
  try{ people = await spInterestCached('people', spLoadInterestPeople); dg.stars = people.length; }
  catch(e){
    if(!members.length) return { posts, status: { ok: false, people: 0, error: String(e.message || e) } };
    memberErr = memberErr || ('별표 인물 명단을 못 읽음(' + String(e.message || e) + ')');
  }
  // 의원 먼저, 같은 이름은 한 번만
  const seen = new Set(members.map(m=> m.name));
  people = members.concat(people.filter(p=> !seen.has(p.name)));
  status.people = people.length;
  if(memberErr) status.error = memberErr;
  const targets = people.slice(0, SHINPD.INTEREST_MAX);
  dg.noAddr = targets.filter(t=> !t.fb && !t.x).length;
  dg.noX = targets.filter(t=> !t.x).map(t=> t.name);
  if(people.length > targets.length) status.error = `관심인물 ${people.length}명 중 ${targets.length}명만 조회`;
  let needsCookie = false;
  for(const p of targets.filter(t=> t.fb)){
    dg.fbN++;
    try{
      const j = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fbposts?u=${encodeURIComponent(p.fb)}`, {}, 20000).then(r=> r.json());
      if(j.needsCookie) needsCookie = true;
      (j.posts || []).forEach(x=>{
        const ts = rcDayTs(x.date);
        if(x.text && ts >= sinceTs){ dg.fbPosts++; posts.push({ name: p.name, net: 'fb', text: String(x.text).slice(0, 280), u: x.url || '', ts }); }
      });
    }catch(e){ dg.fbFail++; }
    await rcSleep(1200);
  }
  const xt = targets.filter(t=> t.x).map(t=> ({ name: t.name, x: t.x }));
  dg.xN = xt.length;
  for(let i = 0; i < xt.length; i += 25){
    try{
      const res = await fetch(X_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ all: true, days: 2, targets: xt.slice(i, i + 25) }) });
      const j = await res.json();
      if(!res.ok) status.error = 'X: ' + (j.error || res.status);
      (j.posts || []).forEach(x=>{
        const ts = x.created ? rcTs(x.created) : rcDayTs(x.date);
        if(x.text && ts >= sinceTs){ dg.xPosts++; posts.push({ name: x.name, net: 'x', text: String(x.text).slice(0, 280), u: x.url || '', ts }); }
      });
    }catch(e){ status.error = 'X: ' + (e.message || e); }
  }
  if(needsCookie) status.error = 'FB 쿠키 미설정';
  if(!people.length) status.error = status.error || '별표 또는 "관심" 태그를 붙인 인물이 없음';
  status.detail = `관심 의원 ${dg.members}명·별표 인물 ${dg.stars}명 중 ${targets.length}명 조회(페이스북 ${dg.fbN}명 중 ${dg.fbFail}명 실패, 새 글 ${dg.fbPosts}건 / X ${dg.xN}명, 새 글 ${dg.xPosts}건` + (dg.noAddr ? `, 주소가 없어 건너뜀 ${dg.noAddr}명` : '') + ')' + (dg.noX.length ? ` X 주소가 없는 인물: ${dg.noX.join(', ')}.` : '');
  posts.sort((a, b)=> b.ts - a.ts);
  return { posts, status };
}

/* ---------- 터질 만한 이슈 후보 (2026-10-13 사장님 지적: "왜 이걸 추천하는지 로직이 없다") ----------
   조건: 우리 영상 없음 + 라이브 아닌 영상 기준 2개 채널↑ + 움직임 신호(진영 횡단·최근 번짐·조회수 가속) 하나 이상. 라이브·중계는 후보 계산에서 뺀다.
   타이밍(사장님: "지금 들어가도 되나"): 이미 다룬 채널 수로 선점 가능(2곳↓) / 적기(3~4) / 막차(5~7) / 포화(8↑). 규칙 기반이라 실사용 보고 조정. */
function spTotalChannels(){
  try{ return Object.values(state.tabs || {}).reduce((a, t)=> a + (((t || {}).channels || []).length), 0); }catch(e){ return 0; }
}
function spTiming(nCh){ return nCh <= 2 ? '선점 가능' : nCh <= 4 ? '적기' : nCh <= 7 ? '막차' : '포화'; }
/* ---------- 영상 내용 요약 (2026-10-13 사장님: "1시간짜리 영상 제목만 던져주면 내가 볼 시간 있어? 중요한 것만 요약해줘") ----------
   제미나이가 영상을 직접 보고 '핵심 쟁점 한 문장 + 중요한 내용 3~4개'를 뽑아 둔다(영상별로 /recommend/shinpd/vd/{영상}에 2일 캐시).
   25분보다 긴 영상은 앞 12분만 본다(토큰·시간 한도) — 요약에 "앞 12분 기준"이라고 밝힌다. */
const SP_VD_PER_BUILD = 6;          // 한 번 만들 때 새로 분석하는 영상 수(시간·한도)
const SP_VD_POOL = 14;              // 후보 풀(조회수순)
const SP_VD_VER = 3;                // 기록 형식(이전 형식은 다시 분석)
const SP_VD_FULL_SEC = 10 * 60;   // 이보다 긴 영상은 앞부분만(2026-10-16 토큰 절감: 25분 영상이 약 14만 토큰이라 분당 한도를 넘겼다)
const SP_VD_HEAD_SEC = 10 * 60;
const SP_VD_FPS = 0.2;            // 말이 중심이라 장면은 5초에 1장이면 충분 — 토큰이 약 1/2.5
function spParseJson(text){
  const t = String(text || '').replace(/```[a-z]*/gi, '').trim();
  const i = t.indexOf('{'), j = t.lastIndexOf('}');
  if(i < 0 || j <= i) return null;
  try{ return JSON.parse(t.slice(i, j + 1)); }catch(e){ return null; }
}
async function spVideoDigest(v){
  if(geminiQuotaLeft('shinpdv') <= 0) return { stop: '신피디 영상 분석 하루 한도 소진' };
  geminiQuotaConsume('shinpdv');
  const long = v.dur != null && v.dur > SP_VD_FULL_SEC;
  await spVideoGate();   // 분당 토큰 한도 보호(app-shinpd-algo.js)
  const prompt = [
    '이 유튜브 영상(길면 앞부분만 보여 줌)을 보고 JSON으로만 답해.',
    '형식: {"i":"이 영상의 핵심 쟁점·주장 한 문장(70자 이내)","sum":["가장 중요한 내용 3~4개, 각 80자 이내"]}',
    'sum은 바쁜 편집장이 영상을 안 보고도 알 수 있게 새로운 사실·구체적 주장·핵심 논거·인물 간 충돌을 문장으로 쓴다. 인사말·구독 요청·광고·잡담은 넣지 마라. 영상에 없는 내용·추측은 쓰지 마라.'
  ].join(' ');
  const part = { file_data: { file_uri: 'https://www.youtube.com/watch?v=' + v.id } };
  part.video_metadata = Object.assign({ fps: SP_VD_FPS }, long ? { start_offset: '0s', end_offset: SP_VD_HEAD_SEC + 's' } : {});
  const parts = [{ text: prompt }, part];
  const run = (cfg, model)=> Promise.race([callGeminiParts(parts, cfg, model), new Promise(r=> setTimeout(()=> r({ text: null, error: '시간 초과' }), 150000))]);
  // 영상 분석은 편지·요약과 다른 모델 통(GEMINI_VIDEO_MODEL)으로, 안 되면 기본 모델로 한 번 더
  const cfg = { responseMimeType: 'application/json', responseSchema: SP_DIGEST_SCHEMA };
  let res = await run(Object.assign({ mediaResolution: 'MEDIA_RESOLUTION_LOW' }, cfg), GEMINI_VIDEO_MODEL);
  if(!res.text && /media|resolution|Unknown name|Invalid/i.test(res.error || '')) res = await run(cfg, GEMINI_VIDEO_MODEL);
  if(!res.text) res = await run(cfg);
  if(res.quotaBlocked) return { stop: res.error };
  const j = res.text ? spParseJson(res.text) : null;
  if(!j) return { fail: res.error || '응답을 읽지 못함' };
  const str = (x, n)=> String(x || '').replace(/\s+/g, ' ').trim().slice(0, n);
  const rec = {
    i: str(j.i, 90),
    sum: (Array.isArray(j.sum) ? j.sum : []).map(x=> str(x, 100)).filter(x=> x.length >= 8).slice(0, 4),
    part: long ? `앞 ${SP_VD_HEAD_SEC / 60}분 기준` : '', v: SP_VD_VER, at: Date.now()
  };
  if(!rec.sum.length && !rec.i) return { fail: '요약이 비어 있음' };
  await spdPutJson('vd/' + v.id, rec).catch(()=> {});
  return { rec };
}
async function spDigestBuild(videos, rising, topics, newsTitles, now, notes){
  const vd = await spdGet('vd').catch(()=> null) || {};
  Object.keys(vd).forEach(k=> { if(vd[k] && vd[k].at && now - vd[k].at > 2 * 86400000){ delete vd[k]; spdRtdb('vd/' + k, { method: 'DELETE' }).catch(()=>{}); } });
  const byId = new Map(videos.map(v=> [v.id, v]));
  const ok = v=> v && !v.short && !v.live && v.chId !== 'our' && now - v.ts < 36 * 3600000 && (v.dur == null || v.dur <= 3 * 3600);
  const order = [];
  const push = id=> { const v = byId.get(id); if(ok(v) && !order.includes(id)) order.push(id); };
  rising.slice(0, 5).forEach(x=> push(x.id));
  topics.slice(0, 6).forEach(t=> { const top = (t.vids || []).slice().sort((a, b)=> (b.views || 0) - (a.views || 0))[0]; if(top) push(top.id); });
  videos.filter(ok).filter(v=> isFinite(v.views)).sort((a, b)=> b.views - a.views).slice(0, SP_VD_POOL).forEach(v=> push(v.id));
  const cur = id=> vd[id] && vd[id].v === SP_VD_VER;
  let fresh = 0, failMsg = '';
  for(const id of order){
    if(cur(id)) continue;
    if(fresh >= SP_VD_PER_BUILD) break;
    const r = await spVideoDigest(byId.get(id));
    if(r.stop){ failMsg = r.stop; break; }
    if(r.rec){ vd[id] = r.rec; fresh++; }
    else failMsg = r.fail || failMsg;
    await rcSleep(2500);
  }
  if(failMsg) notes.push('영상 내용 요약: ' + String(failMsg).slice(0, 80));
  // 무대: 사건성 단어와 위원회 이름
  const titles = videos.filter(v=> !v.short && v.chId !== 'our' && now - v.ts < 24 * 3600000).map(v=> v.t).concat(newsTitles);
  const STAGE = ['국정감사', '국감', '청문회', '재판', '선고', '탄핵', '특검', '기자회견', '토론회', '대정부질문', '본회의', '최고위원회', '전당대회', '경선'];
  const stage = STAGE.map(w=> ({ w, n: titles.filter(t=> t.includes(w)).length })).filter(x=> x.n >= 3).sort((a, b)=> b.n - a.n).slice(0, 2).map(x=> x.w);
  const comCount = {};
  titles.forEach(t=> (t.match(/(법사위|재경위|복지위|국방위|행안위|외통위|과방위|교육위|정무위|기재위|산자위|환노위|국토위|농해수위|문체위|여가위|운영위|예결위|정보위|윤리특위)/g) || []).forEach(c=> { comCount[c] = (comCount[c] || 0) + 1; }));
  const committees = Object.entries(comCount).sort((a, b)=> b[1] - a[1]).slice(0, 5).map(x=> x[0]);
  const done = order.filter(cur).length;
  return { vd, stage, committees, analyzed: done, pending: order.length - done, fresh };
}
function spVdCur(vd, id){ return vd && vd[id] && vd[id].v === SP_VD_VER ? vd[id] : null; }

/* ---------- 기사에 많이 인용된 발언 (2026-10-13 사장님: "화제발언은 기사에 많이 피인용된 게 의미 있는 발언") ----------
   영상에서 AI가 고른 말이 아니라, 같은 이슈 기사 제목들에 큰따옴표·작은따옴표로 인용된 말 중 서로 다른 기사 2건 이상이 인용한 것만 센다(코드가 세므로 지어낼 수 없음). */
const SP_QUOTE_RE = /["“‘'「]([^"“”‘’'「」]{8,90})["”’'」]/g;
function spQuoteCandidates(arts){
  const groups = [];
  arts.forEach((a, idx)=>{
    SP_QUOTE_RE.lastIndex = 0;
    let m;
    while((m = SP_QUOTE_RE.exec(a.t))){
      const q = m[1].trim();
      const key = q.replace(/[\s·…\.,!?'"“”‘’「」]/g, '');
      if(key.length < 8) continue;
      let g = groups.find(x=> x.key.includes(key.slice(0, 8)) || key.includes(x.key.slice(0, 8)));
      if(!g){ g = { key, text: q, arts: new Set(), sample: a.t }; groups.push(g); }
      g.arts.add(idx);
      if(q.length > g.text.length) g.text = q;
    }
  });
  return groups.filter(g=> g.arts.size >= 2).sort((a, b)=> b.arts.size - a.arts.size).slice(0, 4)
    .map(g=> ({ text: g.text, n: g.arts.size, sample: g.sample }));
}

/* ---------- 이슈 브리핑 (2026-10-13 제로베이스 개편) ----------
   사장님: "아무 맥락도 신피디는 제공하지 못하고 요약을 하는 것도 아니야." → 제목·숫자 나열이 아니라 이슈마다 제미나이가 자료를 읽고
   무슨 일인지·왜 터졌는지·핵심 발언·유튜브 상황·각·제목을 써 준다. 이슈 후보 = 기사 묶음(뉴스) + 유튜브 주제. 자료에 없는 말은 쓰지 않게 한다. */
const SP_BRIEF_MAX = 24;      // 제미나이에 보낼 후보 상한(정권 타격이 아닌 건 걸러져 줄어든다)
const SP_BRIEF_CHUNK = 8;      // 한 번에 보내는 후보 수
const SP_BRIEF_SHOW = 8;       // 편지에 보이는 이슈 수
let spBriefAir = '';   // 제미나이에게 알려 주는 우리 방송·업로드 목록(이슈 브리핑 때마다 채움)
const SP_BRIEF_VER = 9;     // 프롬프트·형식을 바꾸면 올린다(캐시된 옛 브리핑을 쓰지 않게)
/* 채널 정체성(2026-10-13 사장님: "정치신세계의 정치편향성 알지? 그렇게 코딩하면 일 2번 한다") — 방송원고 스킬(political-scripts)의 세계관·이슈 정의를 그대로 옮김.
   신피디가 이슈를 고르고 각을 말할 때 이 시선을 기본값으로 쓴다. 우선순위는 팩트 > 세계관 > 논리. */
const SP_CHANNEL_ID = [
  '[채널 정체성 — 정치신세계]',
  '- 반이재명 성향 채널입니다. 모든 이슈를 먼저 "이재명(정부·여당)에게 타격이 되는가"로 가릅니다. 편향성은 강점이니 억지 중립으로 쓰지 마세요.',
  '- 우선순위는 팩트 > 세계관 > 논리입니다. 사실·숫자·발언·직함은 [자료]에 있는 것만 씁니다. 세계관에 따른 해석은 사실처럼 단정하지 말고 "~로 읽힙니다/~일 수 있습니다"로 해석임을 드러내세요.',
  '- 이슈의 정의: 정부·지자체의 추진 동정(발표·착공·부지 확정·성과 홍보)은 이슈가 아닙니다. 차질·이탈·장애·모순·충돌·의혹 신호가 이슈입니다. 민주당 내 갈등·계파싸움은 크게 다룰 소재이고, 여당 쪽 유튜버·스피커도 소재입니다.',
  '- 세계관 축: 안보(대북 저자세·한미동맹 약화·친중), 사법(방탄·검찰·수사기관·사법부 흔들기, 연성독재의 누적 패턴), 경제(포퓰리즘·성장 저해·부동산). 공통 동기는 지지율·방탄·표입니다.',
  '- 말과 현실이 어긋나는 지점(구호와 실제의 모순)은 발견했을 때만 짚고, 억지로 만들지 마세요. 시청층에 여성이 많으니 군사·법률 용어처럼 낯선 개념은 쉽게 풀어 주세요.',
  '- 표기: 이재명은 직함 없이 "이재명"으로만 씁니다("대표"·"대통령" 등을 임의로 붙이지 마세요). 다른 사람의 직함은 [자료]에 적힌 그대로만 쓰고 없으면 이름만 씁니다. 새미래민주당은 "새민주", 대표는 전병헌입니다.'
].join('\n');
const SP_BRIEF_SCHEMA = { type: 'OBJECT', properties: { items: { type: 'ARRAY', items: { type: 'OBJECT', properties: {
  id: { type: 'STRING' }, issue: { type: 'BOOLEAN' }, stance: { type: 'STRING', enum: ['타격', '방어', '무관'] }, axis: { type: 'STRING', enum: ['안보', '사법', '경제', '여당갈등', '기타'] },
  name: { type: 'STRING' }, ours: { type: 'BOOLEAN' }, oursRef: { type: 'STRING' }, what: { type: 'STRING' }, why: { type: 'STRING' }, hit: { type: 'STRING' }, read: { type: 'STRING' }, term: { type: 'STRING' },
  quotes: { type: 'ARRAY', items: { type: 'OBJECT', properties: { n: { type: 'INTEGER' }, who: { type: 'STRING' }, ctx: { type: 'STRING' } }, required: ['n', 'who', 'ctx'] } },
  taken: { type: 'ARRAY', items: { type: 'STRING' } }, angle: { type: 'STRING' }, titles: { type: 'ARRAY', items: { type: 'STRING' } } },
  required: ['id', 'issue', 'stance', 'axis', 'name', 'what', 'why', 'hit', 'read', 'term', 'quotes', 'taken', 'angle', 'titles'] } } }, required: ['items'] };
const SP_DIGEST_SCHEMA = { type: 'OBJECT', properties: { i: { type: 'STRING' }, sum: { type: 'ARRAY', items: { type: 'STRING' } } }, required: ['i', 'sum'] };
const SP_BRIEF_TTL = 40 * 60000;
function spCardArts(card){
  const seen = new Set(), out = [];
  const add = (t, s, u, ts)=> { t = String(t || '').replace(/\s+/g, ' ').trim(); if(!t || seen.has(t)) return; seen.add(t); out.push({ t, s: String(s || ''), u: u || '', ts: ts || 0 }); };
  add(card.r.t, card.r.rs, card.r.u, card.r.ts || ((Object.values(card.r.d || {}).find(x=> x.u && x.u === card.r.u) || {}).ts));
  Object.values(card.r.d || {}).filter(x=> x.k === 'a').sort((a, b)=> (b.ts || 0) - (a.ts || 0)).forEach(x=> add(x.t, x.s, x.u, x.ts));
  return out.slice(0, 16);
}
function spBriefCandidates(cards, topics, ourRecent72, vd, now, prevIds, rising){
  // 후보를 넉넉히 잡는다(2026-10-13 사장님: "고작 토픽 2개 정리한 게 다냐"). 정권 타격 여부는 제미나이가 가르므로(홍보성 소식이 자리를 차지해도 걸러짐)
  // 후보는 기사 묶음 12 + 유튜브 주제 8(채널 1곳이라도 조회수 순) + 속도 붙는 영상 중 어느 후보에도 안 든 것(씨앗)까지 본다.
  const cands = [];
  const usedTopic = new Set();
  // 2026-10-16 사장님: 중요도보다 '모니터링 중인 유튜브 채널의 새 이슈 발굴' — 후보는 유튜브 주제(영상 묶음)가 중심, 기사 묶음은 같은 이야기일 때 근거로만 붙인다
  const byCid = new Map(cards.map(c=> [c.cid, c]));
  topics.slice().sort((a, b)=> (b.newest || 0) - (a.newest || 0)).slice(0, 20).forEach(t=> {
    usedTopic.add(t.key);
    const id = t.cid != null && byCid.has(t.cid) ? 'c' + t.cid : 't' + t.key;
    const dup = cands.find(x=> x.id === id);
    if(dup){ dup.topics.push(t); return; }
    cands.push({ id, card: id[0] === 'c' ? byCid.get(t.cid) : null, topics: [t] });
  });
  const ourToks = ourRecent72.map(v=> new Set(rcKeyTokens(v.t)));
  const enrich = c=>{
    c.arts = c.card ? spCardArts(c.card) : [];
    c.quotes = spQuoteCandidates(c.arts);
    const vids = [], seen = new Set();
    if(c.seedVid){ seen.add(c.seedVid.id); vids.push({ id: c.seedVid.id, t: c.seedVid.t, u: c.seedVid.u, ts: c.seedVid.ts, views: c.seedVid.views }); }
    c.topics.forEach(t=> (t.vids || []).forEach(v=> { if(!seen.has(v.id)){ seen.add(v.id); vids.push(v); } }));
    // 기사 묶음에 함께 묶인 유튜브 영상(수집기가 같은 이슈로 묶은 것)도 유튜브 상황에 넣는다
    if(c.card) Object.values(c.card.r.d || {}).filter(x=> x.k === 'y').forEach(x=> {
      const m = String(x.u || '').match(/[?&]v=([\w-]{6,})/); const id = m ? m[1] : x.u;
      if(id && !seen.has(id)){ seen.add(id); vids.push({ id, t: x.t, u: x.u, ts: x.ts, views: null }); }
    });
    c.vids = vids.sort((a, b)=> (b.views || 0) - (a.views || 0)).slice(0, 5);
    c.A = c.card ? c.card.sig.A : 0;
    c.nCh = Math.max(c.topics.reduce((m, t)=> Math.max(m, t.nCh || 0), 0), c.card ? c.card.sig.Y : 0, c.seedVid ? 1 : 0);
    c.firstTs = c.vids.length ? Math.min.apply(null, c.vids.map(v=> v.ts)) : 0;
    const core = new Set(c.card ? rcCoreTokens(c.card.r) : []); c.topics.forEach(t=> t.core.forEach(w=> core.add(w)));
    if(c.seedVid) rcKeyTokens(c.seedVid.t).forEach(w=> core.add(w));
    c.ours = c.topics.some(t=> t.ours) || ourToks.some(s=> spOursMatch(core, s));
    c.isNew = !prevIds.has(c.id) || c.topics.some(t=> t.isNew);
    const views = c.vids.reduce((m, v)=> m + (isFinite(v.views) ? v.views : 0), 0);
    // 신선도: 가장 새 근거(기사·영상) 기준으로 시간이 지날수록 급감시킨다 — 며칠 묵은 이슈가 쌓인 기사 수로 맨 위에 눌러앉지 못하게(2026-10-16 사장님)
    c.lastTs = Math.max(0, ...c.vids.map(v=> v.ts || 0), ...c.topics.map(t=> t.newest || 0));   // 새 영상이 언제 올라왔나가 기준(기사 날짜는 보지 않는다)
    const ageH = c.lastTs ? Math.max(0, (now - c.lastTs) / 3600000) : 99;
    c.ageH = ageH;
    c.priority = 1000 - ageH * 10 + c.nCh * 2 + (c.isNew ? 5 : 0);   // 가장 새로 올라온 영상의 이슈부터
    c.digests = c.vids.map(v=> { const d = spVdCur(vd, v.id); return d ? { t: spdCleanTitle(v.t, 50), i: d.i, sum: d.sum } : null; }).filter(Boolean).slice(0, 2);
  };
  cands.forEach(enrich);
  // 씨앗: 지금 유튜브에서 속도 붙는데 기사 묶음·주제 어디에도 안 잡힌 영상(예: 단일 채널의 폭로성 영상) — 제목·내용 요약이 곧 자료
  const have = new Set(); cands.forEach(c=> c.vids.forEach(v=> have.add(v.id)));
  const candToks = cands.map(c=> new Set(c.arts.map(a=> a.t).concat(c.vids.map(v=> v.t)).flatMap(t=> rcKeyTokens(t))));
  (rising || []).slice(0, 10).forEach(x=> {
    if(x.live || x.ours || have.has(x.id)) return;
    const tk = rcKeyTokens(x.t);
    if(candToks.some(set=> tk.filter(w=> set.has(w)).length >= 3)) return;   // 이미 다른 후보와 같은 이야기
    const c = { id: 'v' + x.id, card: null, topics: [], seedVid: x };
    enrich(c); cands.push(c);
  });
  return cands.filter(c=> c.ageH <= 12 && c.vids.length).sort((a, b)=> b.priority - a.priority).slice(0, SP_BRIEF_MAX);   // 12시간 안에 새 영상이 없는 이슈는 뺀다
}
function spBriefText(c){
  const L = [`### 이슈 후보 id=${c.id}`];
  if(c.arts.length) L.push(`[기사 제목 — 이 이슈 기사 총 ${c.A}건 중]\n` + c.arts.map(a=> `- ${spdCleanTitle(a.t, 90)}`).join('\n'));
  if(c.card && c.card.r.x) L.push('[대표 기사 발췌] ' + String(c.card.r.x).replace(/\s+/g, ' ').slice(0, 200));
  if(c.vids.length) L.push('[유튜브 영상 제목]\n' + c.vids.map(v=> `- ${spdCleanTitle(v.t, 70)}`).join('\n'));
  if(c.digests.length) L.push('[영상 내용 요약]\n' + c.digests.map(d=> `- ${d.t} → ${d.i}${d.sum.length ? ' / ' + d.sum.join(' / ') : ''}`).join('\n'));
  if(c.quotes.length) L.push('[인용후보 — 기사 제목에 큰따옴표로 인용된 말]\n' + c.quotes.map((q, i)=> `${i + 1}. "${q.text}" (기사 ${q.n}건이 인용) — 예: ${spdCleanTitle(q.sample, 80)}`).join('\n'));
  return L.join('\n');
}
function spBriefPrompt(cands, ourTop){
  return [
    '당신은 정치 시사 유튜브 "정치신세계"의 PD "신피디"입니다. 편집장은 이슈의 내용을 모르고 기사·영상을 읽을 시간도 없습니다. 아래 이슈 후보마다 [자료]만 읽고, 채널 정체성의 시선으로 맥락을 요약해 주세요.',
    SP_CHANNEL_ID,
    '규칙: [자료]에 없는 사실·직함·배경은 절대 쓰지 마세요(당신이 아는 지식으로 채우지 마세요). 직함은 자료에 적힌 그대로만, 없으면 이름만 씁니다. 자료만으로 어떤 사건인지 알 수 없거나, 정부·지자체의 추진 동정·홍보에 그치면 issue를 false로, stance를 무관으로 하세요 — 정책·비전 발표, 선포식·행사, 대통령 일정, 시설 개방·이전·착공, 성과 홍보가 그렇습니다. 정부 계획·결정을 소개하는 내용뿐이면 같은 이유로 무관이고, 타격은 [자료]에 실제로 나온 비판·반발·차질·의혹·모순을 hit에서 짚을 수 있을 때만 줍니다 — 출연자 소개·프로그램명·채널명·일반적 주제의 영상만 있는 경우도 그렇습니다.',
    '출력은 JSON 한 덩어리만: {"items":[{"id":"자료의 id","issue":true,"stance":"타격(이재명·정부·여당에 불리한 사실·의혹·갈등) | 방어(정권이 비판·의혹에 맞서 내놓은 해명·반박·반격 — 정책 발표·행사·성과 홍보는 방어가 아님) | 무관","axis":"안보|사법|경제|여당갈등|기타","name":"이슈 이름 — 처음 보는 사람도 알아볼 20자 이내의 말","what":"무슨 일인지 2~3문장. 누가 누구에게(무엇에) 무엇을 했고 지금 어떤 상황인지","why":"what에 없는 새 정보 한 문장 — 왜 지금 터졌는지·쟁점·대립 구도(what을 되풀이하지 말 것)","hit":"이 이슈가 이재명 정부·여당에 어떤 타격(또는 방어 프레임)인지 한 문장 — 자료의 사실에 근거해서만. 무관이면 빈 문자열","read":"채널 세계관으로 읽은 해석 한 줄(등장인물의 의도 가설 등). 근거가 약하면 빈 문자열이고, 사실처럼 단정하지 말고 해석임을 드러낼 것","term":"일반 시청자가 모를 만한 용어·낯선 인물·기관이 있을 때만 자료에 근거한 한 줄 설명, 없으면 빈 문자열. 대통령·여야 지도부·유명 정치인의 직함 설명은 쓰지 마라","quotes":[{"n":인용후보 번호,"who":"발언자(자료에 있을 때만)","ctx":"어떤 사안에 대한 말인지 15자 이내"}],"taken":["유튜브 영상 제목들에서 이미 쓰인 각(프레임) 1~3개 — 제목을 베끼지 말고 6~15자 명사구로, 예: 채무 팩트체크, SNS 저격 해명"],"angle":"그 각들과 겹치지 않는, 채널 시선(정권 타격·모순·누적 패턴)으로 잡을 수 있는 비어 있는 각 한 줄(방향만, 없는 사실은 쓰지 않음)","titles":["제목 후보 3개, 각 40자 이내. 본문보다 세게 질러도 되지만 사실을 허위로 단정하지는 말 것"]}]}',
    'quotes는 [인용후보]에 있는 번호만 쓰고 이슈의 핵심일 때만 최대 2개, 없으면 빈 배열입니다. 유튜브 영상 제목이 없으면 taken은 빈 배열로 두세요.',
    '이슈마다 ours(우리가 이미 같은 사건을 다뤘으면 true)와 oursRef(근거가 된 아래 항목 한 줄, 없으면 빈 문자열)도 채우세요. [우리 최근 방송·업로드]에 같은 인물·사건·쟁점이 나오면 제목의 표현이 달라도 true입니다. 확실히 없을 때만 false.',
    '[우리 최근 방송·업로드 — 영상 제목, 뉴스 리포트(방송에서 다룬 기사·메모), 방송 꼭지 요약]'+String.fromCharCode(10)+'' + (typeof spBriefAir === 'string' && spBriefAir ? spBriefAir : '(없음)'),
    '우리 채널에서 조회수가 높았던 영상 제목(제목 톤 참고): ' + ((ourTop || []).slice(0, 5).map(v=> v.t).join(' / ') || '(없음)'),
    '',
    '[자료]',
    cands.map(spBriefText).join('\n\n')
  ].join('\n');
}
/* 제미나이가 몰려서(503)·한도(429)로 실패하면 잠깐 쉬고 다시, 그래도 안 되면 다른 모델(모델마다 한도 통이 따로)로 넘긴다.
   재시도로 안 풀리는 오류(요청 형식 문제 등)는 바로 돌려준다. */
const SP_RETRY_RE = /high demand|overload|unavailable|try again|503|429|rate|quota|시간 초과|응답이 비었/i;
async function spGeminiRetry(parts, cfg){
  const chain = [undefined, GEMINI_VIDEO_MODEL, 'gemini-3.5-flash'];
  let last = null;
  for(const m of chain){
    for(let k = 0; k < 2; k++){
      const res = await callGeminiParts(parts, cfg, m);
      if(res && res.text) return res;
      last = res;
      if(res && res.quotaBlocked) break;                                  // 이 모델은 한도 소진 → 다음 모델로
      if(!SP_RETRY_RE.test(String((res && res.error) || ''))) return res;
      await rcSleep(k ? 6000 : 3000);
    }
  }
  return last;
}
async function spBriefGenerate(cands, ourTop, now, notes){
  const cache = await spdGet('brief').catch(()=> null) || {};
  const out = {};
  const need = [];
  cands.forEach(c=>{
    const h = rcHash('v' + SP_BRIEF_VER + '|' + spBriefText(c));
    const hit = cache[c.id];
    if(hit && hit.h === h && hit.at && now - hit.at < SP_BRIEF_TTL && hit.b) out[c.id] = hit.b;
    else { c.hash = h; need.push(c); }
  });
  Object.keys(cache).forEach(k=> { if(cache[k] && cache[k].at && now - cache[k].at > 6 * 3600000) spdRtdb('brief/' + k, { method: 'DELETE' }).catch(()=>{}); });
  const str = (x, n)=> String(x || '').replace(/\s+/g, ' ').trim().slice(0, n);
  // 한 번에 8개씩 나눠 보낸다 — 후보를 늘려도 응답이 잘리지 않게(출력 한도)
  for(let i = 0; i < need.length; i += SP_BRIEF_CHUNK){
    const part = need.slice(i, i + SP_BRIEF_CHUNK);
    if(geminiQuotaLeft('shinpd') <= 0){ notes.push('이슈 요약: 오늘 이 기기에서 쓸 수 있는 제미나이 횟수를 다 썼어요.'); break; }
    const res = await spGeminiRetry([{ text: spBriefPrompt(part, ourTop) }], { responseMimeType: 'application/json', responseSchema: SP_BRIEF_SCHEMA });
    if(res && res.text) geminiQuotaConsume('shinpd');   // 실패한 호출은 세지 않음(503으로 다 날려 놓고 한도만 줄던 문제)
    const j = res && res.text ? spParseJson(res.text) : null;
    if(!j || !Array.isArray(j.items)){ notes.push('이슈 요약: ' + String((res && res.error) || '응답을 읽지 못함').slice(0, 80)); continue; }
    j.items.forEach(it=>{
      const c = part.find(x=> x.id === it.id);
      if(!c) return;
      const b = { issue: it.issue === true, stance: ['타격', '방어', '무관'].includes(it.stance) ? it.stance : '무관', axis: str(it.axis, 6), hit: str(it.hit, 200), read: str(it.read, 200), name: str(it.name, 30), what: str(it.what, 420), why: str(it.why, 200), term: str(it.term, 200),
        quotes: (Array.isArray(it.quotes) ? it.quotes : []).map(q=> { const k = c.quotes[(q && q.n) - 1]; return k ? { text: k.text, n: k.n, who: str(q.who, 12), ctx: str(q.ctx, 24) } : null; }).filter(Boolean).slice(0, 2),
        taken: c.vids.length ? (Array.isArray(it.taken) ? it.taken : []).map(x=> str(x, 80)).filter(Boolean).slice(0, 3) : [],   // 영상 제목이 없으면 '이미 쓰인 각'을 말할 근거가 없다
        ours: it.ours === true, oursRef: str(it.oursRef, 70),
        angle: str(it.angle, 200),
        titles: (Array.isArray(it.titles) ? it.titles : []).map(x=> str(x, 60)).filter(Boolean).slice(0, 3) };
      if(b.issue && (b.what.length < 15 || !b.name)) b.issue = false;
      if(b.issue && (b.stance === '무관' || (b.stance === '타격' && !b.hit))) b.issue = false;   // 채널 정체성: 정권에 타격(또는 맞서야 할 방어 프레임)이 아닌 소식은 이슈가 아니다
      out[c.id] = b;
      spdPutJson('brief/' + c.id, { at: now, h: c.hash, b }).catch(()=> {});
    });
  }
  return out;
}

/* ---------- 리포트 만들기 (v2: 유튜브 중심 → 2026-10-13 이슈 브리핑 개편) ---------- */
const SP_NAME_STOP = new Set(['논란', '공방', '충돌', '갈등', '국감', '발언', '의혹', '이슈', '문제', '관련', '정면', '대통령', '지사']);
function spMergeBriefs(list){
  const out = [];
  list.forEach(b=>{
    // 이름 비교는 rcKeyTokens를 쓰지 않는다 — 그건 '이재명'·'대통령' 같은 흔한 말을 불용어로 지워 같은 이야기를 못 알아본다
    const t = new Set((String(b.name).match(/[가-힣A-Za-z0-9]{2,}/g) || []).map(w=> w.replace(/(은|는|이|가|을|를|의|과|와)$/, '')).filter(w=> w.length >= 2 && !SP_NAME_STOP.has(w)));
    const urls = new Set((b.vids || []).map(v=> v.u).concat((b.arts || []).map(a=> a.u)).filter(Boolean));
    const hit = out.find(o=> { let n = 0; t.forEach(w=> { if(o._tok.has(w)) n++; }); return n >= 2 || [...urls].some(u=> o._urls.has(u)); });
    if(hit){
      const seenV = new Set((hit.vids || []).map(v=> v.u)), seenA = new Set((hit.arts || []).map(a=> a.u));
      hit.vids = (hit.vids || []).concat((b.vids || []).filter(v=> !seenV.has(v.u))).slice(0, 4);
      hit.arts = (hit.arts || []).concat((b.arts || []).filter(a=> !seenA.has(a.u))).slice(0, 4);
      hit.nCh = Math.max(hit.nCh || 0, b.nCh || 0); hit.A = Math.max(hit.A || 0, b.A || 0);
      hit.firstTs = [hit.firstTs, b.firstTs].filter(Boolean).sort((x, y)=> x - y)[0] || 0;
      hit.timing = hit.nCh ? spTiming(hit.nCh) : '';
      hit.merged = (hit.merged || 0) + 1;
      return;
    }
    b._tok = t; b._urls = urls; out.push(b);
  });
  out.forEach(o=> { delete o._tok; delete o._urls; });
  return out;
}
async function spProbeLeeX(){
  // 이재명 X 한 계정을 직접 부른다 — 1티어 수집분에 안 잡혀도 왜 안 잡히는지 화면에 밝히기 위해
  try{
    const roster = await rcLoadRoster();
    const m = roster.find(x=> /이재명/.test(x.name));
    if(!m || !m.x) return { state: 'nohandle' };
    const res = await fetch(X_WORKER_URL, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ all: true, days: 3, targets: [{ name: m.name, x: m.x }] }) });
    const j = await res.json();
    if(!res.ok) return { state: 'err', handle: m.x, err: String(j.error || res.status).slice(0, 80) };
    const posts = (j.posts || []).map(p=> ({ name: p.name, net: 'x', text: String(p.text || '').slice(0, 280), u: p.url, ts: p.created ? rcTs(p.created) : rcDayTs(p.date) }));
    if((j.failed_accounts || []).length) return { state: 'fail', handle: m.x, err: String(((j.failed_details || [])[0] || {}).error || '').slice(0, 80), posts };
    return { state: posts.length ? 'ok' : 'empty', handle: m.x, posts };
  }catch(e){ return { state: 'err', err: String(e.message || e).slice(0, 60) }; }
}
async function shinpdBuild(){
  const now = Date.now();
  const notes = [];
  const prev = await rcGet('shinpd/report').catch(()=> null);
  const prevAt = (prev && prev.at) || (now - SHINPD.EVERY_MS);
  const prevKeys = new Set(((prev && prev.ver >= 2 && prev.topics) || []).map(x=> x.key));
  const prevBriefIds = new Set(((prev && prev.briefs) || []).map(b=> b.id));

  // 1) 유튜브 모니터링 화면 데이터 최신화(오래됐으면 화면과 같은 방식으로 갱신)
  try{
    const rf = await spdRefreshStaleTabs(SPD.YT_STALE_MS);
    if(rf.fail) notes.push(`유튜브 채널 ${rf.fail}곳은 목록을 못 받아 마지막 수집분을 썼어요.`);
  }catch(e){ notes.push('유튜브 목록 갱신 실패: ' + String(e.message || e).slice(0, 60)); }

  // 2) 우리 채널 인식 + 지난 영상 이력
  let our = null, hist = null;
  try{ our = await spdOurChannel(); }catch(e){ notes.push('우리 채널 인식 실패: ' + String(e.message || e).slice(0, 60)); }
  try{ hist = await spdOurHistoryCached(); }catch(e){ notes.push('우리 채널 영상 이력을 못 받음: ' + String(e.message || e).slice(0, 60)); }
  const ourKnown = !!our;
  if(!ourKnown) notes.push(`'${SHINPD.OUR_CHANNEL_HINT()}' 채널을 찾지 못해 우리 영상 유무는 비교할 수 없어요. 유튜브 탭에 채널을 등록하거나 config.js에 ourYoutubeHandle을 적어 주세요.`);
  else if(our.autoFound) notes.push(`우리 채널을 '${our.name}'(으)로 자동 인식했어요. 다른 채널이면 알려 주세요.`);
  const ourVids = ((hist && hist.vids) || []).filter(v=> !v.short);
  const ourRecent72 = ourVids.filter(v=> now - v.p < 72 * 3600000).map(v=> ({ t: v.t, v: v.v, p: v.p }));
  let onAir = [];
  try{ onAir = await spOnAirLoad(now); }catch(e){}   // 방송에서 다룬 내용(뉴스 리포트·꼭지 요약) — 우리 영상 판정에 함께 쓴다
  onAir.forEach(x=> ourRecent72.push({ t: x.text, v: 0, p: x.at, air: true }));

  // 3) 영상 모음 = 유튜브 모니터링 화면(+등록 안 된 우리 채널의 최근 영상)
  let videos = spdYtAll();
  if(our && !our.registered){
    ourVids.filter(v=> now - v.p < 72 * 3600000).forEach(v=> videos.push({ id: v.id, t: v.t, ch: our.name || SHINPD.OUR_CHANNEL_HINT(), chId: 'our', tab: '', ts: v.p, views: v.v, live: !!v.live, short: false, thumb: '' }));
  }
  const seenIds = new Set(); videos = videos.filter(v=> !seenIds.has(v.id) && seenIds.add(v.id));

  // 4) 지금 속도 붙는 영상
  const snaps = await spdLoadSnaps().catch(()=> []);
  const rising = videos.filter(v=> !v.short && now - v.ts < 48 * 3600000)
    .map(v=> { const r = spdRate(v, snaps, now); return r ? { v, r } : null; }).filter(Boolean)
    .filter(x=> !(x.v.live && !(x.r.views > 0)))
    .sort((a, b)=> b.r.perH - a.r.perH).slice(0, SPD.RISING_MAX)
    .map(x=> ({ id: x.v.id, ch: x.v.ch, t: x.v.t, u: 'https://www.youtube.com/watch?v=' + x.v.id, ts: x.v.ts, views: x.r.views,
      perH: Math.round(x.r.perH), d: x.r.d, acc: x.r.acc == null ? null : Math.round(x.r.acc * 10) / 10, est: x.r.est, live: x.v.live, ours: spOurs(x.v.ch) }));
  const snapInfo = { n: snaps.length, from: snaps.length ? snaps[0].at : 0 };
  if(snaps.length < 2) notes.push('조회수 기록이 아직 쌓이는 중이라 "지금 속도"는 올라온 뒤 평균 시속으로 계산했어요(기록은 정글2 탭이 열려 있는 동안 15분마다 쌓여요).');

  // 5) 주제 묶기(유튜브 영상 제목 기준)
  const allTopics = spdTopics(videos, now, ourRecent72);
  const topics = allTopics.slice(0, SPD.TOPICS_MAX);
  topics.forEach(t=> { t.isNew = !prevKeys.has(t.key); t.sns = []; t.art = null; t.cid = ''; });

  // 6) 기사 묶음 = 이슈의 뼈대. 주제와 연결
  await rcFetchClusters().catch(()=>{});
  const cards = rcCards().slice().sort((a, b)=> b.score - a.score || b.sig.T - a.sig.T);
  const cardCores = cards.map(c=> ({ c, core: rcCoreTokens(c.r) }));
  topics.forEach(t=>{
    let best = null;
    cardCores.forEach(cc=> { let n = 0; t.core.forEach(w=> { if(cc.core.has(w)) n++; }); if(n >= 2 && (!best || cc.c.sig.A > best.c.sig.A)) best = cc; });
    if(best){
      t.cid = best.c.cid;
      t.art = { A: best.c.sig.A, t: best.c.r.t || '', u: best.c.r.u || '' };
      Object.values(best.c.r.d || {}).filter(x=> x.k === 's').slice(0, 2).forEach(x=> t.sns.push({ name: x.s, text: String(x.t || '').slice(0, 120), u: x.u, ts: x.ts }));
    }
  });

  // 7) SNS — 1티어 수집분(/recommend/sns)에서 이재명 최근 3개 + 관심인물 + 이재명 X 직접 조회
  const lee = [];
  try{
    const sp = await rcGet('sns', rcOrderQuery('ts', now - RC.POOL_MS)) || {};
    Object.values(sp).filter(x=> x && /이재명/.test(x.n || '')).sort((a, b)=> b.ts - a.ts).slice(0, 3)
      .forEach(x=> lee.push({ name: x.n, net: x.net, text: String(x.text || '').slice(0, 280), u: x.u, ts: x.ts }));
  }catch(e){ notes.push('1티어 SNS 수집분을 못 읽음'); }
  const leeX = await spProbeLeeX();
  (leeX.posts || []).forEach(p=> { if(!lee.some(x=> x.u === p.u)) lee.push(p); });
  lee.sort((a, b)=> b.ts - a.ts); lee.splice(4);
  // 관심인물 글 수집은 뺐다(2026-10-17): 이슈 브리핑에 쓰이지 않는데 의원·별표 명단 Firestore 읽기와 FB·X 호출만 크게 쓴다(읽기 한도 429)
  const interest = { posts: [], status: { ok: true, people: 0, error: '', detail: '' } };
  interest.posts.forEach(p=>{
    const toks = new Set(rcKeyTokens(p.text));
    const hit = topics.find(t=> { let n = 0; t.core.forEach(w=> { if(toks.has(w)) n++; }); return n >= 2; });
    if(hit){ p.issue = hit.t; if(hit.sns.length < 3) hit.sns.push({ name: p.name, text: p.text.slice(0, 120), u: p.u, ts: p.ts }); }
  });
  let ddanzi = { posts: [], error: '' };
  try{ ddanzi.posts = await spCollectDdanzi(); }catch(e){ ddanzi.error = String(e.message || e).slice(0, 80); }
  const st = rcViewer.status || {};
  const snsStatus = { tier1: st.sns ? { ok: !!st.sns.ok, at: st.sns.at, error: st.sns.error || '' } : null, interest: interest.status };

  // 8) 구독자 증감
  const subs = await spdSubsSummary().catch(()=> ({ rows: [], days: 0 }));

  // 9) 영상 내용 요약(속도 붙는 영상·주제 대표 영상) → 이슈 브리핑(기사+유튜브를 제미나이가 읽고 맥락을 씀)
  const ourTop = ourVids.slice().sort((a, b)=> b.v - a.v).slice(0, 8).map(v=> ({ t: v.t, v: v.v }));
  const ourRecent = ourVids.slice(0, 5).map(v=> ({ t: v.t, v: v.v, p: v.p }));
  let dg = { vd: {}, stage: [], committees: [], analyzed: 0, pending: 0 };
  try{ dg = await spDigestBuild(videos, rising, topics, cards.slice(0, 60).map(c=> c.r.t || ''), now, notes); }
  catch(e){ notes.push('영상 내용 요약 실패: ' + String(e.message || e).slice(0, 60)); }
  rising.forEach(x=> { const d = spVdCur(dg.vd, x.id); if(d){ x.i = d.i; x.sum = d.sum; x.part = d.part; } });
  let briefs = [];
  try{
    const cands = spBriefCandidates(cards, topics, ourRecent72, dg.vd, now, prevBriefIds, rising);
    const seenAir = new Set();
    spBriefAir = ourVids.filter(v=> now - v.p < 72 * 3600000).slice(0, 12).map(v=> `- (${spClock(v.p)} 업로드) ${String(v.t).slice(0, 70)}`)
      .concat(onAir.slice().sort((a, b)=> b.at - a.at).filter(x=> { const k = x.text.slice(0, 40); if(seenAir.has(k)) return false; seenAir.add(k); return true; }).slice(0, 36).map(x=> `- (${spClock(x.at)} ${x.src}) ${String(x.text).slice(0, 80)}`)).join(String.fromCharCode(10));
    const gen = await spBriefGenerate(cands, ourTop, now, notes);
    briefs = cands.filter(c=> gen[c.id] && gen[c.id].issue).map(c=> {
      const b = gen[c.id];
      return { id: c.id, kind: c.card ? 'news' : 'yt', stance: b.stance || '무관', axis: b.axis || '', hit: b.hit || '', read: b.read || '', name: b.name, what: b.what, why: b.why || '', term: b.term || '', quotes: b.quotes || [], taken: b.taken || [], angle: b.angle || '', titles: b.titles || [],
        A: c.A, nCh: c.nCh, firstTs: c.firstTs || 0, lastTs: c.lastTs || 0, score: c.priority, timing: c.nCh ? spTiming(c.nCh) : '', ours: !!c.ours || !!b.ours, oursRef: b.oursRef || '', isNew: !!c.isNew, topicKey: (c.topics[0] || {}).key || '',
        arts: c.arts.slice(0, 3).map(a=> ({ t: spdCleanTitle(a.t, 70), u: a.u, ts: a.ts || 0 })), vids: c.vids.slice(0, 3).map(v=> ({ t: spdCleanTitle(v.t, 70), u: v.u, views: v.views, ts: v.ts || 0 })) };
    });
    const SR = { 타격: 0, 방어: 1, 무관: 2 };
    briefs.sort((a, b)=> (b.score || 0) - (a.score || 0));   // 새 영상이 가장 최근인 이슈가 위로(정권 타격 여부는 태그로만 표시)
    briefs = spMergeBriefs(briefs);   // 같은 이야기를 다룬 후보는 한 이슈로 합친다
  }catch(e){ notes.push('이슈 요약 실패: ' + String(e.message || e).slice(0, 60)); }

  // 10) 제목·섬네일 제안은 버튼으로 요청한 것만 불러 둔다(브리핑이 각·제목 후보를 이미 줌)
  const advMap = await spdGet('advice').catch(()=> null) || {};
  Object.keys(advMap).forEach(k=> { if(advMap[k] && advMap[k].at && now - advMap[k].at > 2 * 86400000) spdRtdb('advice/' + k, { method: 'DELETE' }).catch(()=>{}); });
  shinpdAdvice = advMap;

  const report = {
    at: now, prevAt, ver: 2, rev: 7, totalCh: spTotalChannels(),
    heat: { stage: dg.stage, committees: dg.committees, analyzed: dg.analyzed, pending: dg.pending },
    briefs,
    next: spNextBroadcast(),
    ourKnown, our: our ? { name: our.name, auto: !!our.autoFound } : null,
    ourRecent72: ourRecent72.filter(v=> !v.air).map(v=> ({ t: v.t, p: v.p })),
    onAir: onAir.slice(0, 120),
    ourBlock: { recent: ourRecent, top: ourTop.slice(0, 5) },
    rising, snapInfo,
    topics, gaps: ourKnown ? topics.filter(t=> !t.ours && t.nCh >= 2).map(t=> t.key) : [],
    subs,
    sns: { lee, interest: interest.posts.slice(0, 12), status: snsStatus, leeX: { state: leeX.state, handle: leeX.handle || '', err: leeX.err || '' } },
    ddanzi, notes,
    ytMeta: { videos: videos.length }
  };
  report.letter = { text: spLetterFallback(report), ai: briefs.length > 0, at: Date.now() };
  return report;
}

/* 챗·편지에 쓸 SNS 글을 거르는 코드 규칙 — 주소·해시태그만 있는 글(영상 공유 등)은 뺀다 */
function spSnsWorthy(p){
  const t = String(p.text || '').replace(/https?:\/\/\S+/g, ' ').replace(/#\S+/g, ' ').replace(/\s+/g, ' ').trim();
  return t.length >= 25;
}
/* ---------- 보고 메일 본문 = 이슈 브리핑 (2026-10-13 제로베이스 개편) ----------
   편집장이 방송 직전에 알고 싶은 건 ① 지금 터진 이슈가 뭔지(무슨 일·왜) ② 지금 들어가도 되나(유튜브 상황) ③ 어떤 각·제목으로 ④ 방송에서 쓸 핵심 발언.
   이슈마다 제미나이가 자료를 읽고 쓴 요약(briefs)을 코드가 이 틀에 담는다. 쓸 게 없는 칸은 비운다(억지로 채우지 않음). */
function spDur(ms){
  const m = Math.max(0, Math.round(ms / 60000)), h = Math.floor(m / 60), mm = m % 60;
  return h ? (mm ? `${h}시간 ${mm}분` : `${h}시간`) : `${mm}분`;
}
function spVidLabel(t){ return spdCleanTitle(t, 28); }
function spSnsLine(r){
  const s = r.sns || {}, ss = s.status || {};
  const bad = [];
  if(ss.tier1 && !ss.tier1.ok) bad.push('1티어 의원 SNS 수집이 끊겨 있습니다' + (ss.tier1.error ? `(${ss.tier1.error})` : ''));
  else if(!ss.tier1) bad.push('1티어 의원 SNS는 아직 수집 기록이 없습니다');
  if(ss.interest && ss.interest.error) bad.push(`관심인물은 ${ss.interest.error}`);
  const n = (s.interest || []).length, l = (s.lee || []).length;
  return `SNS는 이재명 최근 글 ${l}건을 가져왔습니다.${bad.length ? ' ' + bad.join(', ') + '.' : ''}`;
}
function spSnsWarn(r){
  const s = r.sns || {}, ss = s.status || {};
  const bad = [];
  if(ss.tier1 && !ss.tier1.ok) bad.push('1티어 의원 SNS 수집이 끊겨 있습니다');
  if(ss.interest && ss.interest.error) bad.push(`관심인물은 ${ss.interest.error}`);
  return bad.length ? 'SNS 수집에 문제가 있습니다: ' + bad.join(', ') + '.' : '';
}
function spBriefYt(b, r){
  const total = r.totalCh ? `등록 채널 ${r.totalCh}곳 중 ` : '';
  const y = b.nCh ? `유튜브에서는 ${total}${b.nCh}곳이 이미 다뤘고${b.firstTs ? ` 첫 영상은 ${spDur(r.at - b.firstTs)} 전` : ''}입니다 → ${b.timing || spTiming(b.nCh)}.` : '유튜브에서는 아직 다룬 곳이 없습니다.';
  return y + (b.ours ? ` 정치신세계는 이미 다뤘습니다${b.oursRef ? '(' + esc(b.oursRef) + ')' : ''}.` : ' 정치신세계는 아직 다루지 않았습니다.');
}
function spBriefHtml(r){
  const bs = (r.briefs || []).slice(0, SP_BRIEF_SHOW);
  const h = r.heat || {};
  // 인사말은 '국감 날' 같은 고정 문구 대신, 새로 올라온 이슈 → 위 순번 순으로 이름을 뽑아 매번 바뀌게(2026-10-16 사장님: 며칠째 국정감사만 말하면 망한 것)
  const lead = bs.filter(b=> b.isNew).concat(bs.filter(b=> !b.isNew)).slice(0, 3).map(b=> esc(b.name));
  const nNew = bs.filter(b=> b.isNew).length;
  const intro = `<p class="sp-hello">${lead.length ? `${nNew ? `새로 올라온 이슈 ${nNew}건. ` : ''}지금 먼저 볼 것: ${lead.join(' · ')}. ` : ''}이슈 ${bs.length}건을 내용과 함께 정리했습니다.</p>`;
  const link = (u, t, n)=> u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(spdCleanTitle(t, n || 34))}</a>` : esc(spdCleanTitle(t, n || 34));
  const blocks = bs.map((b, i)=>{
    const tags = (b.ours ? '' : '<em class="sp-new">우리 영상 없음</em>') + (b.timing ? `<em class="sp-net">${esc(b.timing)}</em>` : '');
    const quotes = (b.quotes || []).map(q=> `<p class="sp-iq">“${esc(q.text)}”<span> — ${q.who ? esc(q.who) : '발언자 미상'}${q.ctx ? `(${esc(q.ctx)})` : ''} · 기사 ${q.n}건이 인용</span></p>`).join('');
    const taken = (b.taken || []).length ? `이미 쓰인 각: ${esc(b.taken.join(' / '))}` : '';
    const angle = b.angle ? `${taken ? ' · ' : ''}비어 있는 각: ${esc(b.angle)}` : '';
    const titles = (b.titles || []).length ? `<p class="sp-iy">제목 후보 ${b.titles.map(t=> `「${esc(t)}」`).join(' ')}</p>` : '';
    const wh = x=> { const l = link(x.u, x.t); return l && x.ts ? `${l} <small>(${esc(spAgo(x.ts))})</small>` : l; };   // 근거마다 발행 시각(2026-10-16 사장님)
    const src = (b.arts || []).slice(0, 2).map(wh).concat((b.vids || []).slice(0, 2).map(wh)).filter(Boolean);
    return `<div class="sp-issue"><div class="sp-ih"><b>${i + 1}. ${esc(b.name)}</b>${typeof spIssueBtn === 'function' ? spIssueBtn(b) : ''}${tags}</div>`
      + `<p>${esc(b.what)}${b.why ? ' ' + esc(b.why) : ''}</p>`
      + (b.term ? `<p class="sp-iterm">${esc(b.term)}</p>` : '')
      + (b.hit ? `<p class="sp-ihit"><b>${b.stance === '방어' ? '정권 쪽 프레임' : '정권 영향'}</b> ${esc(b.hit)}</p>` : '')
      + (b.read ? `<p class="sp-iread">채널 관점 해석 — ${esc(b.read)}</p>` : '')
      + quotes
      + `<p class="sp-iy">${esc(spBriefYt(b, r))}${taken || angle ? ' ' + taken + angle : ''}</p>`
      + titles
      + (src.length ? `<div class="sp-sub">근거: ${src.join(' · ')}</div>` : '') + '</div>';
  }).join('');
  const dz = ((r.ddanzi || {}).posts || []).filter(x=> !spDzHidden.has(spDzId(x.u))).slice(0, 3);
  const dzHtml = dz.length ? `<p class="sp-iy">딴지 베스트: ${dz.map(x=> `<a class="sp-vlink sp-dz" href="${esc(x.u)}" data-u="${esc(x.u)}">「${esc(x.t)}」</a>`).join(' ')}</p>` : '';
  const warn = spSnsWarn(r);
  const notesHtml = (r.notes || []).filter(n=> /이슈 요약|영상 내용 요약/.test(n)).map(n=> `<p class="sp-warn">${esc(n)}</p>`).join('');
  return `<div class="sp-letter">${intro}${blocks || '<p>이슈 요약을 만들지 못했습니다. 새로고침으로 다시 시도해 주세요.</p>'}${dzHtml}${warn ? `<p class="sp-warn">${esc(warn)}</p>` : ''}${notesHtml}</div>`;
}
function spLetterFallback(r){
  const p = [];
  const bs = r.briefs || [];
  if(bs.length) bs.slice(0, 6).forEach(b=> p.push(`${b.name} — ${b.what}${b.why ? ' ' + b.why : ''} ${spBriefYt(b, r)}`));
  else {
    const tp = (r.topics || []).slice(0, 4).map(t=> `${t.t}(${t.nCh}곳)`);
    p.push('이슈 요약을 만들지 못했습니다(제미나이 한도·오류).' + (tp.length ? ` 유튜브에서 많이 다룬 주제는 ${tp.join(', ')}입니다.` : ''));
  }
  const w = spSnsWarn(r); if(w) p.push(w);
  return p.join('\n\n');
}

/* ---------- 만들기 조율(임대) — 여러 탭이 동시에 만들지 않게 ---------- */
async function shinpdRun(manual){
  if(shinpdBusy) return;
  shinpdBusy = true;
  shinpdPaint();
  try{
    if(!manual){
      const lease = await rcGet('shinpd/lease').catch(()=> null);
      if(lease && lease.at && Date.now() - lease.at < SHINPD.LEASE_MS) return;
      const me = 'p' + Math.random().toString(36).slice(2, 8);
      await spPut('shinpd/lease', { id: me, at: Date.now() });
      await rcSleep(1500);
      const chk = await rcGet('shinpd/lease').catch(()=> null);
      if(!chk || chk.id !== me) return;
    }
    const report = await shinpdBuild();
    await spPut('shinpd/report', report);
    shinpdReport = report;
  }catch(e){
    console.warn('[신피디] 리포트 생성 실패', e);
    shinpdReport = Object.assign({}, shinpdReport || {}, { failMsg: String(e && e.message || e).slice(0, 100) });
  }finally{
    shinpdBusy = false;
    shinpdPaint();
  }
}
async function shinpdLoad(){
  try{ const r = await rcGet('shinpd/report'); if(r && r.at) shinpdReport = r; }catch(e){}
  try{ shinpdAdvice = await spdGet('advice') || {}; }catch(e){}
  await spDzLoadHidden();
  return shinpdReport;
}
const spLeaseId = 'sp' + Math.random().toString(36).slice(2, 10);
function shinpdStale(){ return !shinpdReport || !shinpdReport.at || shinpdReport.ver !== 2 || shinpdReport.rev !== 7 || shinpdReport.at < spLastSlot([13, 18], Date.now()); }   // 13시·18시(방송 1시간 전)에만 자동, 그 밖엔 새로고침 때
async function shinpdAutoCheck(){
  if(shinpdBusy || !menuEnabled('shinpd')) return;   // 메뉴를 끈 계정은 자동 리포트를 만들지 않음
  await shinpdLoad();
  if(shinpdStale()){
    // 탭이 여러 개 열려 있어도 자동 생성은 한 곳만 — 잠금(10분)을 먼저 잡은 탭이 만든다(제미나이 중복 호출 방지)
    try{
      const lk = await spdGet('report_lease').catch(()=> null);
      if(lk && lk.at && Date.now() - lk.at < 10 * 60000 && lk.owner !== spLeaseId) return;
      await spdPutJson('report_lease', { owner: spLeaseId, at: Date.now() });
      await rcSleep(1500);
      const chk = await spdGet('report_lease').catch(()=> null);
      if(chk && chk.owner !== spLeaseId) return;
    }catch(e){}
    await shinpdRun(false);
  }
  else if(_currentMode === 'shinpd') shinpdPaint();
}
function shinpdStartTimer(){
  if(shinpdTimer) return;
  try{ spdStart(); }catch(e){}   // 조회수(15분)·구독자(하루) 기록 시작
  setTimeout(shinpdAutoCheck, 20000);   // 앱이 뜨고 수집 담당이 정해질 시간을 준 뒤
  shinpdTimer = setInterval(shinpdAutoCheck, SHINPD.CHECK_MS);
}

/* ---------- 화면 (v2: 유튜브 중심) — RTDB는 빈 배열을 버리므로 모든 목록은 || [] 로 읽는다 ---------- */
function spLink(u, label){ return u ? `<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>` : esc(label); }
function spSection(title, body, sub){
  return `<section class="sp-sec"><h3>${esc(title)}${sub ? `<span>${esc(sub)}</span>` : ''}</h3>${body}</section>`;
}
function spEmpty(msg){ return `<p class="sp-empty">${esc(msg)}</p>`; }
function spViews(n){ return (n == null || !isFinite(n)) ? '-' : fmtViews(n) + '회'; }
function spSigned(n){ return n == null ? '-' : (n > 0 ? '+' : '') + Number(n).toLocaleString('ko-KR'); }
function spSubsN(n){ return n >= 10000 ? (n / 10000).toFixed(n >= 100000 ? 1 : 2).replace(/\.?0+$/, '') + '만' : Number(n).toLocaleString('ko-KR'); }
const SP_OPEN_DEFAULT = { rising: true, topics: true, subs: false, trends: false, sns: false, op: false, news: false, studio: false };
let shinpdOpen = {};                // 사용자가 펼치거나 접은 상태(다시 그려도 유지)
/* 자세한 자료 = 가로 탭(2026-10-13). spDet은 탭 한 칸의 정보만 돌려주고, shinpdBodyHtml이 탭 줄과 본문을 짠다 */
const SP_TAB_ORDER = ['topics', 'rising', 'sns', 'ddanzi', 'subs'];   // 2026-10-13 사장님: 스튜디오·스크랩후속·여론·검색트렌드·화제 인물은 필요 없음 → 뺌
let shinpdTab = '';
try{ shinpdTab = localStorage.getItem('shinpd_tab') || ''; }catch(e){}
function spDet(id, title, sub, body){ return { id, title, sub, body }; }
function spRisingRow(x, i){
  const tag = (x.ours ? ' <em class="sp-net">우리</em>' : '') + (x.live ? ' <em class="sp-net">라이브</em>' : '');
  const sum = (x.sum || []).length
    ? `${x.i ? `<div class="sp-sub sp-what">${esc(x.i)}</div>` : ''}<ul class="sp-sum">${x.sum.map(s=> `<li>${esc(s)}</li>`).join('')}</ul>${x.part ? `<div class="sp-sub">(${esc(x.part)} 요약)</div>` : ''}`
    : `<div class="sp-sub">${x.live ? '라이브라 요약하지 않았어요.' : '내용 요약 준비 중이에요(다음 새로고침 때 이어서).'}</div>`;
  return `<li><div class="sp-line">${i + 1}. ${spLink(x.u, spdCleanTitle(x.t, 70))}${tag}</div>${sum}`
    + `<div class="sp-sub">${esc(x.ch)} · ${esc(spAgo(x.ts))}</div></li>`;   // 참고 채널 조회수·시속은 보여 주지 않음(2026-10-15 사장님)
}
function spAdviceInner(t){
  const a = (shinpdAdvice || {})[t.key];
  const btn = `<button type="button" class="sp-btn" data-adv="${esc(t.key)}">${a ? '다시 제안' : '제목·섬네일 제안'}</button>`;
  if(!a || !(a.titles || []).length) return btn;
  return (a.taken && a.taken.length ? `<div class="sp-sub">이미 쓰인 각: ${esc(a.taken.join(' / '))}</div>` : '')
    + `<div class="sp-sub sp-flag">비어 있는 각: ${esc(a.angle || '-')}</div>`
    + `<ol class="sp-list">${(a.titles || []).map(x=> `<li><div class="sp-line">${esc(x)}</div></li>`).join('')}</ol>`
    + (a.thumbs || []).map(x=> `<div class="sp-sub">섬네일: ${esc(x.text)} — ${esc(x.layout)}</div>`).join('')
    + `<div class="sp-sub">${esc(a.why || '')}${a.at ? ' · ' + spAgo(a.at) : ''}</div>${btn}`;
}
/* 유튜브 핫토픽 한 줄 = 이슈 브리핑(무슨 일·왜 뜨나) + 유튜브 숫자 + 영상 제목(채널명 없이) */
function spTopicBriefRow(b, i, r){
  const t = (r.topics || []).find(x=> x.key === b.topicKey);
  const flag = b.ours ? ' <em class="sp-net">우리 영상 있음</em>' : (r.ourKnown ? ' <em class="sp-new">우리 영상 없음</em>' : '');
  const num = `${b.nCh}곳이 다룸 · ${b.timing}${b.firstTs ? ` · 첫 영상 ${spDur(r.at - b.firstTs)} 전` : ''}${b.A ? ` · 기사 ${b.A}건` : ''}`;
  return `<li><div class="sp-line">${i + 1}. <b>${esc(b.name)}</b>${flag}</div>`
    + `<div class="sp-sub sp-what">${esc(b.what)}${b.why ? ' ' + esc(b.why) : ''}</div>`
    + `<div class="sp-sub">${esc(num)}</div>`
    + (b.vids || []).map(v=> `<div class="sp-sub">${spLink(v.u, spdCleanTitle(v.t, 70))}</div>`).join('')
    + (t ? `<details class="sp-det sp-in" data-sec="adv-${esc(t.key)}"${('adv-' + t.key) in shinpdOpen && shinpdOpen['adv-' + t.key] ? ' open' : ''}><summary>제목·섬네일 제안${(shinpdAdvice || {})[t.key] ? ' 보기' : ''}</summary>${spAdviceInner(t)}</details>` : '')
    + '</li>';
}
function spLetterHtml(r){
  return spBriefHtml(r) + `<div class="sp-sub">${r.letter && r.letter.ai === false ? '제미나이 요약이 없어 자동 서식으로 표시했어요(한도·오류).' : ''}</div>`;
}
function shinpdBodyHtml(r){
  if(!r || !r.at) return `<p class="sp-empty">${shinpdBusy ? '리포트를 만드는 중이에요…' : '아직 만들어진 리포트가 없어요. 새로고침을 눌러 주세요.'}</p>`;
  if(r.ver !== 2 || r.rev < 6) return `<p class="sp-empty">${shinpdBusy ? '새 형식으로 만드는 중이에요…' : '이전 형식의 리포트예요. 새로고침을 눌러 주세요.'}</p>`;
  const parts = [spLetterHtml(r), '<div class="sp-more">자세한 자료</div>'];
  const rising = (r.rising || []).slice(0, 5);
  parts.push(spDet('rising', '지금 속도 붙는 영상', (r.snapInfo && r.snapInfo.n >= 2) ? `기록 ${r.snapInfo.n}회` : '기록 쌓이는 중',
    rising.length ? `<ol class="sp-list">${rising.map(spRisingRow).join('')}</ol>` : spEmpty('지금 올라온 영상이 없습니다.')));
  const yb = (r.briefs || []).filter(b=> b.nCh).sort((a, b)=> b.nCh - a.nCh);
  const gapNames = yb.filter(b=> !b.ours).map(b=> b.name);
  parts.push(spDet('topics', '유튜브 핫토픽', `${yb.length}개 · 채널 많은 순`,
    (yb.length ? `<ol class="sp-list">${yb.slice(0, 6).map((b, i)=> spTopicBriefRow(b, i, r)).join('')}</ol>` : spEmpty('유튜브에서 여러 곳이 다룬 이슈가 아직 없습니다.'))
    + (r.ourKnown ? `<p class="sp-sub">우리 영상 없는 이슈: ${gapNames.length ? esc(gapNames.slice(0, 4).join(' · ')) : '없음'}</p>` : `<p class="sp-sub">우리 채널을 찾지 못해 비교하지 못했어요.</p>`)));

  const sb = r.subs || {};
  const subLine = (sb.rows || []).filter(x=> x.our).slice(0, 1).map(x=> `${esc(x.nm)}${x.our ? '(우리)' : ''} ${spSubsN(x.n)}${x.d1 != null ? `(${spSigned(x.d1)})` : ''}`).join(' · ');
  const ob = r.ourBlock || {};
  parts.push(spDet('subs', '우리 구독자·조회수', (sb.days || 0) < 2 ? '증감은 내일부터' : '괄호는 전일 대비',
    (subLine ? `<p class="sp-line">${subLine}</p>` : spEmpty('구독자 기록이 아직 없습니다.'))
    + ((ob.recent || []).length ? `<p class="sp-sub">우리 최근 영상: ${ob.recent.slice(0, 3).map(v=> `${esc(String(v.t).slice(0, 28))} ${spViews(v.v)}`).join(' · ')}</p>` : '')));

  const sns = r.sns || {}, ss = sns.status || {};
  const warn = [];
  if(ss.tier1 && !ss.tier1.ok) warn.push('1티어 의원 SNS 수집 끊김');
  if(ss.interest && ss.interest.error) warn.push('관심인물: ' + ss.interest.error);
  const lx = sns.leeX || {};
  const leeXNote = lx.state === 'empty' ? `이재명 X(@${lx.handle}): 최근 3일 검색 결과가 0건입니다. X 수집 워커와 로그인 쿠키는 정상이고 다른 정치인 계정은 읽히는데 이 계정만 0건이라, 워커가 쓰는 X 계정이 이재명 계정에 차단됐거나 X가 이 계정 검색을 막은 것으로 보입니다(원인 미확정).`
    : lx.state === 'nohandle' ? '이재명 X 주소가 의원 명단에 없습니다.'
    : (lx.state === 'err' || lx.state === 'fail') ? `이재명 X를 못 불렀습니다${lx.err ? ': ' + lx.err : ''}.` : '';
  const snsRow = p=> `<li><div class="sp-line">${esc(p.name)} <span class="sp-net">${p.net === 'x' ? 'X' : 'FB'}</span> ${p.u ? `<a href="${esc(p.u)}" class="sp-dz" data-u="${esc(p.u)}" data-ptitle="${esc(p.name)} · ${p.net === 'x' ? 'X' : 'FB'}" data-peek="${esc(String(p.text).replace(/\s+/g, ' ').trim())}">${esc(String(p.text).slice(0, 50))}</a>` : esc(String(p.text).slice(0, 50))}</div></li>`;
  parts.push(spDet('sns', 'SNS', `이재명 ${(sns.lee || []).length}`,
    (warn.length ? `<p class="sp-warn">${warn.map(esc).join(' · ')}</p>` : '')
    + (leeXNote ? `<p class="sp-warn">${esc(leeXNote)}</p>` : '')
    + (ss.interest && ss.interest.detail ? `<p class="sp-sub">${esc(ss.interest.detail)}</p>` : '')
    + (((sns.lee || []).length || (sns.interest || []).length) ? `<ul class="sp-list">${(sns.lee || []).slice(0, 3).concat((sns.interest || []).slice(0, 4)).map(snsRow).join('')}</ul>` : spEmpty('새 글이 없습니다.'))));

  const dz = r.ddanzi || {};
  const dzShown = (dz.posts || []).filter(x=> !spDzHidden.has(spDzId(x.u))).slice(0, 7);
  parts.push(spDet('ddanzi', '딴지 베스트', `${dzShown.length}건`, dz.error ? `<p class="sp-warn">${esc(dz.error)}</p>`
    : (dzShown.length ? `<ul class="sp-list">${dzShown.map(x=> `<li><div class="sp-line"><a href="${esc(x.u)}" class="sp-dz" data-u="${esc(x.u)}">${esc(x.t)}</a> <button type="button" class="sp-x" data-dzx="${esc(spDzId(x.u))}" title="이 글 빼기" aria-label="이 글 빼기">✕</button></div><div class="sp-sub">${esc(x.board)} · 동의 ${spNum(x.votes)} · 조회 ${spNum(x.views)} · 댓글 ${spNum(x.comments)}</div></li>`).join('')}</ul>` : spEmpty('가져온 글이 없습니다.'))));

  const tabs = parts.filter(x=> x && typeof x === 'object').sort((a, b)=> SP_TAB_ORDER.indexOf(a.id) - SP_TAB_ORDER.indexOf(b.id));
  const active = tabs.some(t=> t.id === shinpdTab) ? shinpdTab : 'topics';
  return parts.filter(x=> typeof x === 'string').join('')
    + `<div class="sp-tabs" role="tablist">${tabs.map(t=> `<button type="button" role="tab" class="sp-tab${t.id === active ? ' on' : ''}" data-tab="${t.id}">${esc(t.title)}</button>`).join('')}</div>`
    + tabs.map(t=> `<section class="sp-panel" data-panel="${t.id}"${t.id === active ? '' : ' hidden'}><div class="sp-ph">${esc(t.title)}${t.sub ? `<span>${esc(t.sub)}</span>` : ''}</div>${t.body}</section>`).join('');
}
function shinpdPaint(){
  const root = document.getElementById('shinpdBody');
  if(!root) return;
  const r = shinpdReport;
  const meta = document.getElementById('shinpdMeta');
  if(meta){
    const stale = r && r.at && r.at < spLastSlot([13, 18], Date.now());
    meta.innerHTML = shinpdBusy ? '만드는 중…'
      : (r && r.at ? `${spClock(r.at)} 생성 · ${spAgo(r.at)}${stale ? ' <b class="sp-stale">오래됨</b>' : ''}` : '리포트 없음');
  }
  const rb = document.getElementById('shinpdRefresh'); if(rb) rb.disabled = shinpdBusy;
  const fail = r && r.failMsg ? `<p class="sp-warn">리포트 생성 실패: ${esc(r.failMsg)}</p>` : '';
  let html;
  try{ html = shinpdBodyHtml(r); }
  catch(e){ console.error('[shinpd] 본문 그리기 실패', e); html = `<p class="sp-warn">리포트를 화면에 그리지 못했어요: ${esc(e && e.message || String(e))}</p>`; }
  if(typeof spViewIsAlgo === 'function' && spViewIsAlgo()){ spViewPaintAlgo(root); return; }   // 상단 탭이 '유튜브 알고리즘'일 때(app-shinpd-algo.js)
  root.innerHTML = fail + html;
  if(typeof spViewSyncChrome === 'function') spViewSyncChrome();
}
function shinpdPopout(doPrint){
  const paper = document.getElementById('shinpdPaper');
  if(!paper) return;
  const w = window.open('', '_blank', 'popup=yes,width=980,height=900');
  if(!w) return;
  const links = Array.from(document.querySelectorAll('link[rel="stylesheet"]')).map(l=> `<link rel="stylesheet" href="${l.href}">`).join('');
  const clone = paper.cloneNode(true);
  clone.querySelectorAll('.sp-tabs').forEach(b=> b.remove());
  clone.querySelectorAll('.sp-panel').forEach(b=> b.removeAttribute('hidden'));
  clone.querySelectorAll('button').forEach(b=> b.remove());
  w.document.open();
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8"><title>신피디 모니터링 리포트</title>${links}<style>body{margin:0;background:#fff;}.sp-main{margin:0 auto;padding:16px;max-width:900px;}</style></head><body><main class="sp-main">${clone.outerHTML}</main></body></html>`);
  w.document.close();
  if(doPrint) w.addEventListener('load', ()=> setTimeout(()=> { try{ w.focus(); w.print(); }catch(e){} }, 300));
}
async function shinpdAdviseClick(key, btn){
  const r = shinpdReport;
  const t = r && (r.topics || []).find(x=> x.key === key);
  if(!t || !btn) return;
  btn.disabled = true; btn.textContent = '만드는 중…';
  const ob = r.ourBlock || {};
  const trends = r.trends || {};
  const res = await spdAdvise(t, { ourTop: ob.top || [], ourRecent: ob.recent || [], suggest: trends.suggest || [] }).catch(e=> ({ error: String(e.message || e) }));
  if(res.error){ btn.disabled = false; btn.textContent = res.error; return; }
  res.at = Date.now(); res.t = t.t;
  shinpdAdvice[key] = res;
  spdPutJson('advice/' + key, res).catch(()=>{});
  shinpdPaint();
}
async function shinpdStudioUpload(inp){
  const f = inp.files && inp.files[0];
  const msg = document.getElementById('shinpdStudioMsg');
  if(!f) return;
  if(msg) msg.textContent = '읽는 중…';
  try{
    await spdSaveStudio(await f.text());
    if(shinpdReport) shinpdReport.studio = await spdStudioSummary();
    shinpdPaint();
    const m2 = document.getElementById('shinpdStudioMsg'); if(m2) m2.textContent = '저장했어요. 다음 리포트부터 자동으로 반영돼요.';
  }catch(e){ if(msg) msg.textContent = '못 읽었어요: ' + String(e.message || e); }
}
/* ---------- 딴지 글 미리보기(마우스 오버) · 네이버 키워드 레이어(클릭) ---------- */
const spDzCache = new Map();
async function spDzPreviewText(u){
  if(spDzCache.has(u)) return spDzCache.get(u);
  const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(u)}`, { cache: 'no-store' }, 15000);
  if(!res.ok) throw new Error('HTTP ' + res.status);
  const doc = new DOMParser().parseFromString(await res.text(), 'text/html');
  const body = doc.querySelector('.xe_content');
  let t = body ? body.textContent : '';
  if(!t.trim()){ const m = doc.querySelector('meta[property="og:description"]'); t = m ? (m.getAttribute('content') || '') : ''; }
  t = t.replace(/\s+/g, ' ').trim().slice(0, 300);
  spDzCache.set(u, t);
  return t;
}
let spPeekFor = '';
function spPeekEl(){
  let el = document.getElementById('spPeek');
  if(!el){ el = document.createElement('div'); el.id = 'spPeek'; el.className = 'sp-peek'; el.hidden = true; document.body.appendChild(el); }
  return el;
}
async function spPeekShow(a){
  const u = a.getAttribute('data-u') || a.getAttribute('href');
  spPeekFor = u;
  const el = spPeekEl();
  const own = a.getAttribute('data-peek');   // SNS 글처럼 글이 이미 있는 경우는 받아 오지 않고 바로 보여 줌
  el.innerHTML = `<b>${esc(a.getAttribute('data-ptitle') || a.textContent)}</b><div class="sp-peek-t">${own != null ? esc(own) : '불러오는 중…'}</div>`;
  el.hidden = false;
  const rc = a.getBoundingClientRect();
  const w = Math.min(380, window.innerWidth - 24);
  el.style.width = w + 'px';
  el.style.left = Math.max(12, Math.min(rc.left, window.innerWidth - w - 12)) + 'px';
  const below = rc.bottom + 8, h = el.offsetHeight || 140;
  el.style.top = (below + h > window.innerHeight ? Math.max(8, rc.top - h - 8) : below) + 'px';
  if(own != null) return;
  let txt;
  try{ txt = (await spDzPreviewText(u)) || '(본문을 읽지 못했습니다)'; }catch(e){ txt = '미리보기를 받지 못했습니다.'; }
  if(spPeekFor === u) el.querySelector('.sp-peek-t').textContent = txt;
}
function spPeekHide(){ spPeekFor = ''; const el = document.getElementById('spPeek'); if(el) el.hidden = true; }
function spOpenWin(u){ spPeekHide(); window.open(u, 'ddanzi_view', 'popup=yes,width=980,height=900'); }

async function spKwOpen(kw, src){
  src = src === 'google' ? 'google' : 'naver';
  let el = document.getElementById('spKwLayer');
  if(!el){
    el = document.createElement('div'); el.id = 'spKwLayer'; el.className = 'sp-layer'; el.hidden = true;
    el.addEventListener('click', e=> { if(e.target === el || (e.target.closest && e.target.closest('[data-kwclose]'))) el.hidden = true; });
    document.addEventListener('keydown', e=> { if(e.key === 'Escape') el.hidden = true; });
    document.body.appendChild(el);
  }
  const naverUrl = src === 'google' ? `https://www.google.com/search?q=${encodeURIComponent(kw)}&tbm=nws&tbs=sbd:1` : `https://search.naver.com/search.naver?where=news&query=${encodeURIComponent(kw)}&sort=1`;
  el.innerHTML = `<div class="sp-layer-box"><div class="sp-layer-h"><b>${esc(kw)}</b><span>${src === 'google' ? '구글 뉴스 최신순' : '네이버 뉴스 최신순'}</span><button type="button" data-kwclose aria-label="닫기">✕</button></div><div class="sp-layer-b">불러오는 중…</div><div class="sp-layer-f"><a href="${esc(naverUrl)}" target="_blank" rel="noopener noreferrer">${src === 'google' ? '구글에서 전체 보기' : '네이버에서 전체 보기'}</a></div></div>`;
  el.hidden = false;
  const body = el.querySelector('.sp-layer-b');
  try{
    const strip = h=> String(h || '').replace(/<[^>]+>/g, '').replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&apos;|&#0?39;/g, "'");
    let rows;
    if(src === 'google'){
      // 구글 뉴스 RSS. 1순위 Worker /fetch(띄어쓰기 검색어도 됨, 단 when: 연산자는 502), 안 되면 rss2json(한 단어만 되고 자주 실패)
      const rssUrl = `https://news.google.com/rss/search?q=${encodeURIComponent(kw)}&hl=ko&gl=KR&ceid=KR:ko`;
      rows = [];
      for(let k = 0; k < 3 && !rows.length; k++){   // 구글이 Cloudflare 주소에 간헐적으로 502를 줘서 세 번까지 다시 시도
        try{
          const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(rssUrl)}`, { cache: 'no-store' }, 15000);
          if(!res.ok) throw new Error('HTTP ' + res.status);
          const doc = new DOMParser().parseFromString(await res.text(), 'text/xml');
          rows = Array.from(doc.getElementsByTagName('item')).map(it=> {
            const g = tag=> { const n = it.getElementsByTagName(tag)[0]; return n ? n.textContent.trim() : ''; };
            return { t: strip(g('title')), u: g('link'), ts: Date.parse(g('pubDate')), d: '' };
          });
        }catch(e){ rows = []; }
        if(!rows.length && k < 2) await rcSleep(1200);
      }
      if(!rows.length){
        const res = await fetchWithTimeout(`https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(rssUrl)}`, {}, 15000);
        const j = await res.json();
        if(j.status !== 'ok') throw new Error(j.message || '구글 뉴스 응답 오류');
        rows = (j.items || []).map(it=> ({ t: strip(it.title), u: it.link, ts: Date.parse(String(it.pubDate || '').replace(' ', 'T') + 'Z'), d: '' }));
      }
    }else{
      const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/?query=${encodeURIComponent(kw)}&display=30&sort=date`, {}, 15000);
      const j = await res.json();
      rows = (j.items || []).map(it=> ({ t: strip(it.title), u: it.originallink || it.link, ts: Date.parse(it.pubDate), d: strip(it.description).slice(0, 70) }));
    }
    rows = rows.filter(x=> x.t && x.u).sort((a, b)=> (isNaN(b.ts) ? 0 : b.ts) - (isNaN(a.ts) ? 0 : a.ts)).slice(0, 10);   // 무조건 최신순
    body.innerHTML = rows.length ? `<ol class="sp-list">${rows.map(x=> `<li><div class="sp-line"><a href="${esc(x.u)}" target="_blank" rel="noopener noreferrer">${esc(x.t)}</a></div><div class="sp-sub">${isNaN(x.ts) ? '' : spAgo(x.ts)}${x.d ? ' · ' + esc(x.d) : ''}</div></li>`).join('')}</ol>${src === 'google' ? '<p class="sp-sub">구글 뉴스가 돌려준 결과를 최신순으로 정렬해 10건 보여 줍니다. 더 보려면 아래 버튼을 누르세요.</p>' : ''}` : '<p class="sp-sub">검색 결과가 없습니다.</p>';
  }catch(e){ body.innerHTML = `<p class="sp-sub">검색 결과를 받지 못했습니다. 아래 버튼으로 ${src === 'google' ? '구글' : '네이버'}에서 보세요.</p>`; }
}

function initShinpdMode(){
  const app = document.getElementById('shinpdApp');
  if(!app) return;
  if(!app.dataset.wired){
    app.dataset.wired = '1';
    document.getElementById('shinpdRefresh').onclick = ()=> shinpdRun(true);
    document.getElementById('shinpdChatBtn').onclick = ()=> shinpdToggleChat();
    document.getElementById('shinpdChatClose').onclick = ()=> shinpdToggleChat(false);
    document.getElementById('shinpdChatForm').addEventListener('submit', e=>{ e.preventDefault(); shinpdSend(); });
    document.getElementById('shinpdPopout').onclick = ()=> shinpdPopout(false);
    document.getElementById('shinpdPrint').onclick = ()=> shinpdPopout(true);
    document.getElementById('shinpdBody').addEventListener('click', e=>{
      const b = e.target.closest && e.target.closest('[data-adv]');
      if(b) shinpdAdviseClick(b.getAttribute('data-adv'), b);
      const tb = e.target.closest && e.target.closest('.sp-tab');
      if(tb){
        const id = tb.getAttribute('data-tab');
        shinpdTab = id;
        try{ localStorage.setItem('shinpd_tab', id); }catch(err){}
        const root = document.getElementById('shinpdBody');
        root.querySelectorAll('.sp-tab').forEach(x=> x.classList.toggle('on', x === tb));
        root.querySelectorAll('.sp-panel').forEach(x=> { x.hidden = x.getAttribute('data-panel') !== id; });
      }
      const xb = e.target.closest && e.target.closest('[data-dzx]');
      if(xb){ spDzHide(xb.getAttribute('data-dzx')); return; }
      const kw = e.target.closest && e.target.closest('a.sp-kw');
      if(kw){ e.preventDefault(); spKwOpen(kw.getAttribute('data-kw'), kw.getAttribute('data-src')); }
      const dz = e.target.closest && e.target.closest('a.sp-dz');
      if(dz){ e.preventDefault(); spOpenWin(dz.getAttribute('data-u') || dz.getAttribute('href')); }
    });
    document.getElementById('shinpdBody').addEventListener('mouseover', e=>{
      const a = e.target.closest && e.target.closest('a.sp-dz');
      if(a && !(e.relatedTarget && a.contains(e.relatedTarget))) spPeekShow(a);
    });
    document.getElementById('shinpdBody').addEventListener('mouseout', e=>{
      const a = e.target.closest && e.target.closest('a.sp-dz');
      if(a && !(e.relatedTarget && a.contains(e.relatedTarget))) spPeekHide();
    });
    document.getElementById('shinpdBody').addEventListener('toggle', e=>{
      const d = e.target; if(d && d.classList && d.classList.contains('sp-det')) shinpdOpen[d.getAttribute('data-sec')] = d.open;
    }, true);
    document.getElementById('shinpdBody').addEventListener('change', e=>{
      if(e.target && e.target.id === 'shinpdStudioFile') shinpdStudioUpload(e.target);
    });
  }
  shinpdPaint();
  shinpdLoad().then(()=> { shinpdPaint(); if(shinpdStale()) shinpdAutoCheck(); });
}

/* ---------- 대화 ---------- */
const SHINPD_PERSONA = [
  '당신은 "신피디"입니다. 정치신세계 방송의 30대 PD이자 유튜브 채널 운영 파트너입니다. 편집장에게 존댓말로, 짧은 문장으로, 결론부터 말합니다.',
  '규칙: (1) 사실·숫자·시각·채널명은 아래 [리포트 데이터]에 있는 것만 말합니다. 없으면 "수집된 데이터에 없습니다"라고만 하고 추측해서 채우지 않습니다.',
  '(2) 근거 링크는 데이터에 있는 주소만 그대로 적고, 주소를 만들어 내지 않습니다.',
  SP_CHANNEL_ID,
  '(3) 위 채널 정체성이 기본 시선입니다. 이슈가 이재명 정부·여당에 타격인지는 데이터의 이슈브리핑(정권영향·영향)을 근거로 말하고, 세계관 해석은 해석이라고 밝힙니다. 소재의 최종 선택은 편집장 몫입니다. 영상 제목·섬네일·각(다른 채널과 겹치지 않게 잡는 방향)은 요청받거나 데이터가 뒷받침할 때 적극적으로 조언하고, 우리 채널에서 조회수가 높았던 영상과 지금 다른 채널의 반응을 근거로 듭니다.',
  '(4) 성격이나 습관을 대사로 설명하지 않고, "경쟁 채널·경쟁사"라는 말을 쓰지 않습니다. 다른 채널은 실제 채널 이름으로, 일반적으로는 "다른 방송", "저쪽"이라고 합니다.',
  '(5) 이모티콘과 마크다운 서식(굵게·표)을 쓰지 않고 줄글과 줄바꿈으로만 답합니다. 답은 10줄 이내로 합니다.'
].join('\n');
function spSnapshotForChat(r){
  if(!r || !r.at) return '(리포트 없음)';
  if(r.ver !== 2 || r.rev < 6) return '(이전 형식 리포트 — 새로고침 필요)';
  const cut = (s, n)=> String(s || '').slice(0, n);
  const o = {
    생성시각: spClock(r.at), 다음방송: r.next ? `${r.next.label} ${spClock(r.next.at)}` : '없음', 남은시간: r.next ? spDur(r.next.at - r.at) : '없음', SNS수집상태: spSnsLine(r), 우리채널: r.our ? r.our.name : '미확인',
    타이밍기준: '선점 가능=이미 다룬 채널 2곳 이하, 적기=3~4곳, 막차=5~7곳, 포화=8곳 이상(등록 채널 ' + (r.totalCh || '?') + '곳 기준)',
    이슈브리핑: (r.briefs || []).map(b=> ({ 이슈: b.name, 정권영향: b.stance || '무관', 축: b.axis || undefined, 무슨일: b.what, 왜: b.why, 영향: b.hit || undefined, 채널관점해석: b.read || undefined, 설명: b.term || undefined,
      핵심발언: (b.quotes || []).map(q=> `${q.who || '발언자 미상'}(${q.ctx || ''}): "${q.text}" — 기사 ${q.n}건이 인용`),
      유튜브: b.nCh ? `${b.nCh}곳이 다룸 · ${b.timing}` : '아직 다룬 곳 없음', 첫영상: b.firstTs ? spClock(b.firstTs) : undefined, 우리영상: b.ours ? '있음' : '없음', 신규: !!b.isNew,
      이미쓰인각: b.taken || [], 빈각: b.angle || '', 제목후보: b.titles || [], 근거기사: (b.arts || []).map(a=> `${a.t} ${a.u}`), 근거영상: (b.vids || []).map(v=> `${v.t} ${v.u}`) })),
    지금속도붙는영상: (r.rising || []).map(x=> `${x.ch} | ${spVidLabel(x.t)}${x.ours ? ' | 우리영상' : ''}${x.i ? ' | 쟁점: ' + x.i : ''}${(x.sum || []).length ? ' | 요약: ' + x.sum.join(' / ') + (x.part ? ' (' + x.part + ')' : '') : ''} | ${x.u}`),
    유튜브주제: (r.topics || []).map(t=> ({ 주제: t.t, 다룬채널수: t.nCh, 우리영상: t.ours ? '있음' : (r.ourKnown ? '없음' : '비교불가'), 신규: !!t.isNew,
      영상: (t.vids || []).map(v=> `${v.ch} | 표기 ${spVidLabel(v.t)} | ${spClock(v.ts)} | ${v.u}`),
      관련기사: t.art ? `${t.art.A}건 ${cut(t.art.t, 50)} ${t.art.u}` : '없음',
      SNS: (t.sns || []).map(s=> `${s.name}: ${cut(s.text, 50)} ${s.u}`) })),
    우리채널: { 최근영상: ((r.ourBlock || {}).recent || []).map(v=> `${cut(v.t, 60)} 조회수 ${v.v}`), 조회수높았던영상: ((r.ourBlock || {}).top || []).map(v=> `${cut(v.t, 60)} 조회수 ${v.v}`) },
    구독자: ((r.subs || {}).rows || []).filter(x=> x.our).map(x=> `${x.nm}${x.our ? '(우리)' : ''} ${x.n}명 어제대비 ${x.d1 == null ? '-' : x.d1} 7일대비 ${x.d7 == null ? '-' : x.d7}`),
    이재명SNS: ((r.sns || {}).lee || []).filter(spSnsWorthy).map(p=> `${p.net} ${spClock(p.ts)} ${cut(p.text, 100)} ${p.u}`),
    관심인물새글: ((r.sns || {}).interest || []).filter(spSnsWorthy).map(p=> `${p.name} ${p.net} ${spClock(p.ts)} ${cut(p.text, 100)} ${p.u}`),
    딴지베스트: ((r.ddanzi || {}).posts || []).slice(0, 8).map(p=> `제목 ${cut(p.t, 80)} | ${p.board} | 동의 ${p.votes} 조회 ${p.views} 댓글 ${p.comments} | ${p.u}`)
  };
  return JSON.stringify(o).slice(0, 24000);
}
function spLinkify(text){
  return esc(text).replace(/https?:\/\/[^\s<)]+/g, m=> `<a href="${m}" target="_blank" rel="noopener noreferrer">링크</a>`).replace(/\n/g, '<br>');
}
function spMyInitial(){
  try{ const u = firebase.auth().currentUser; const n = u && (u.displayName || u.email) || '나'; return esc(String(n).trim().charAt(0).toUpperCase()); }catch(e){ return '나'; }
}
function shinpdChatPaint(){
  const box = document.getElementById('shinpdChatLog');
  if(!box) return;
  if(typeof spIssueActive === 'function' && spIssueActive()){ spIssuePaint(); return; }
  const pic = '<img class="tg-pic" src="shinpd-face.jpg?v=20261013b" alt="">';
  const list = shinpdChat.length ? shinpdChat : [{ role: 'pd', text: '리포트 기준으로 물어보세요. 예: "정치신세계가 아직 안 다룬 소재는?" "이 이슈 유튜브 어디가 다뤘어요?"' }];
  box.innerHTML = list.map(m=> m.role === 'user'
      ? `<div class="tg-row me"><div class="tg-msg me">${esc(m.text).replace(/\n/g, '<br>')}</div><span class="tg-me-av">${spMyInitial()}</span></div>`
      : `<div class="tg-row">${pic}<div class="tg-msg pd">${spLinkify(m.text)}</div></div>`).join('')
    + (shinpdChatBusy ? `<div class="tg-row">${pic}<div class="tg-msg pd typing">입력 중…</div></div>` : '');
  box.scrollTop = box.scrollHeight;
}
function shinpdToggleChat(force){
  const p = document.getElementById('shinpdChat');
  if(!p) return;
  const open = (force === undefined) ? p.hidden : !!force;
  p.hidden = !open;
  if(open && typeof spIssueActive === 'function' && spIssueActive() && !spIssueOpening) spIssueExit();   // 상단 대화 버튼으로 열면 일반 대화
  if(open){
    shinpdChatPaint(); setTimeout(()=> { const i = document.getElementById('shinpdChatInput'); if(i) i.focus(); }, 50);
    shinpdChatIdleCheck().then(changed=> { if(changed) shinpdChatPaint(); }).catch(()=>{});   // 20분 넘게 쉬었으면 비운 화면으로
  }
}
/* 대화 초기화 — `del` 명령과 20분 자동 초기화가 같이 쓴다: 대화·AI 횟수·마지막 대화 시각을 지움(지침·기억은 그대로).
   withIssues=true면 이슈별 대화(메모리에만 있음)도 비움. */
function shinpdChatReset(withIssues){
  shinpdChat = []; shinpdChatAt = 0;
  try{ ['shinpd_chat', 'shinpd_ai', 'shinpd_chat_at'].forEach(k=> dbFetch(userPath(k), { method: 'DELETE' }).catch(()=>{})); }catch(e){}
  if(withIssues && typeof spIssueChats !== 'undefined') Object.keys(spIssueChats).forEach(k=> { spIssueChats[k].length = 0; });
}
/* 마지막 대화 시각을 지금으로(말을 걸 때·답이 올 때). 기기가 달라도 같은 시계를 쓰도록 서버에도 적는다 */
function shinpdChatTouch(){
  shinpdChatAt = Date.now();
  try{ dbFetch(userPath('shinpd_chat_at'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: String(shinpdChatAt) }).catch(()=>{}); }catch(e){}
}
/* 20분 자동 초기화 확인 — 채팅창을 열 때·말을 걸 때·화면을 불러올 때 부른다. 바뀌었으면(초기화·다른 기기 대화로 교체) true.
   서버의 마지막 대화 시각을 따른다: PC에서 방금 말했는데 오래 켜 둔 휴대폰이 "20분 지났다"며 지우는 사고를 막는다. */
async function shinpdChatIdleCheck(){
  if(shinpdChatBusy || (typeof spIssueBusy !== 'undefined' && spIssueBusy)) return false;   // 답을 기다리는 중엔 건드리지 않음
  const issueHas = ()=> typeof spIssueChats !== 'undefined' && Object.keys(spIssueChats).some(k=> spIssueChats[k].length);
  if(!shinpdChat.length && !issueHas()) return false;   // 지울 대화가 없다
  let srv = 0;
  try{ const r = await dbFetch(userPath('shinpd_chat_at')); if(r.ok) srv = Number(await r.json()) || 0; }catch(e){}
  // 기다리는 사이 상태가 바뀌었을 수 있어 아래는 모두 지금 상태로 다시 본다
  if(shinpdChatBusy || (typeof spIssueBusy !== 'undefined' && spIssueBusy)) return false;
  if(!shinpdChat.length && !issueHas()) return false;
  const local = shinpdChatAt;
  const at = Math.max(local, srv);
  if(!at){ shinpdChatTouch(); return false; }   // 시각 기록이 없는 옛 대화 — 지금부터 20분을 센다
  if(Date.now() - at >= SP_CHAT_IDLE_MS){ shinpdChatReset(true); return true; }
  shinpdChatAt = at;
  if(local && srv > local){   // 다른 기기가 더 최근에 말함 → 이 기기의 낡은 대화를 서버 것으로 교체
    try{
      const j = await dbFetch(userPath('shinpd_chat')).then(r=> r.json());
      if(Array.isArray(j)){ shinpdChat = j.filter(m=> m && m.text).slice(-60); return true; }
    }catch(e){}
  }
  return false;
}
async function shinpdSend(){
  const inp = document.getElementById('shinpdChatInput');
  const q = (inp.value || '').trim();
  if(q && !shinpdChatBusy){   // 20분 넘게 쉬었으면 빈 대화에서 시작(확인하는 동안 보내기 버튼을 또 눌러도 한 번만)
    if(shinpdIdleWait) return;
    shinpdIdleWait = true;
    try{ if(await shinpdChatIdleCheck()) shinpdChatPaint(); }catch(e){}
    shinpdIdleWait = false;
  }
  if(typeof spIssueActive === 'function' && spIssueActive()){ if(q && typeof spIssueSend === 'function') await spIssueSend(); return; }   // 이슈별 대화(app-shinpd-issue.js)
  if(!q || shinpdChatBusy) return;
  // 명령(지침·기억·자기소개·del)은 제미나이를 부르지 않고 바로 처리 — 한도가 차도 쓸 수 있음(app-shinpd-persona.js)
  if(typeof shinpdPersonaCommand === 'function'){
    let cmd = null;
    try{ cmd = await shinpdPersonaCommand(q); }catch(e){ cmd = null; }
    if(cmd){
      inp.value = '';
      if(cmd.clear){ shinpdChatReset(false); }
      else { shinpdChat.push({ role: 'user', text: q }, { role: 'pd', text: cmd.text }); shinpdChat = shinpdChat.slice(-60); shinpdChatTouch(); try{ dbFetch(userPath('shinpd_chat'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shinpdChat) }).catch(()=>{}); }catch(e){} }
      shinpdChatPaint(); return;
    }
  }
  if(geminiQuotaLeft('shinpd') <= 0){
    shinpdChat.push({ role: 'user', text: q }, { role: 'pd', text: '오늘 이 기기에서 쓸 수 있는 질문 횟수를 다 썼습니다. 내일 다시 물어봐 주세요.' });
    shinpdChatTouch(); inp.value = ''; shinpdChatPaint(); return;
  }
  shinpdChat.push({ role: 'user', text: q });
  shinpdChatTouch();
  inp.value = '';
  shinpdChatBusy = true; shinpdChatPaint();
  geminiQuotaConsume('shinpd');
  let text, error;
  if(typeof shinpdPersonaReply === 'function'){
    ({ text, error } = await shinpdPersonaReply(shinpdChat.slice(0, -1), q));   // 페르소나 대화(app-shinpd-persona.js)
  }else{
    const hist = shinpdChat.slice(-9, -1).map(m=> (m.role === 'user' ? '편집장: ' : '신피디: ') + m.text).join('\n');
    const prompt = `${SHINPD_PERSONA}\n\n[리포트 데이터]\n${spSnapshotForChat(shinpdReport)}\n\n[이전 대화]\n${hist || '(없음)'}\n\n편집장: ${q}\n신피디:`;
    ({ text, error } = await callGeminiParts([{ text: prompt }]));
  }
  shinpdChatBusy = false;
  shinpdChat.push({ role: 'pd', text: text || ('지금은 답을 못 드립니다. ' + (error || '')) });
  shinpdChat = shinpdChat.slice(-60);
  shinpdChatTouch();
  shinpdChatPaint();
  try{ dbFetch(userPath('shinpd_chat'), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(shinpdChat) }).catch(()=>{}); }catch(e){}
}
/* 딴지 베스트 '빼기' — 계정별(users/{uid}/shinpd_dz_hidden/{글번호}) */
let spDzHidden = new Set();
function spDzId(u){ const m = String(u || '').match(/document_srl=(\d+)|\/(\d{6,})(?:$|[?#])/); return m ? (m[1] || m[2]) : ''; }
async function spDzLoadHidden(){
  try{
    const j = await dbFetch(userPath('shinpd_dz_hidden')).then(r=> r.json());
    spDzHidden = new Set(j && typeof j === 'object' ? Object.keys(j) : []);
  }catch(e){}
}
function spDzHide(id){
  if(!id) return;
  spDzHidden.add(id);
  try{ dbFetch(userPath('shinpd_dz_hidden/' + id), { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: String(Date.now()) }).catch(()=>{}); }catch(e){}
  shinpdPaint();
}
async function shinpdLoadChat(){
  try{
    const j = await dbFetch(userPath('shinpd_chat')).then(r=> r.json());
    if(Array.isArray(j)) shinpdChat = j.filter(m=> m && m.text).slice(-60);
  }catch(e){}
  try{ await shinpdChatIdleCheck(); }catch(e){}   // 어제 하던 대화가 남아 있으면 20분 지난 것으로 보고 지움
}
