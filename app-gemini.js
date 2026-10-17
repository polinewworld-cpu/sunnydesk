/* Gemini 스크랩 자동요약
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ===== 스크랩 자동요약 (Gemini) — 뉴스 카드/유튜브 카드에서 "+ 스크랩" 누르면 배경에서
   원문(또는 영상)을 Gemini로 요약해 기존 발췌요약을 대체한다.
   클라이언트에서 Gemini API 직접 호출(2026-09-17) — Cloudflare Worker 경유 시 "User location
   is not supported" 지역차단 에러가 잦아서(클로드 테스트 환경에서도 재현됨, Worker 쪽 문제로
   판단) 브라우저(실제 한국 IP)에서 바로 부르는 쪽으로 변경. 무료 티어 키라 노출돼도 비용
   위험 없음(최악의 경우 일일 한도 소진). 무료 한도 보호용 하루 상한: 뉴스 30건 · 유튜브 3건
   (기기별 localStorage 카운트). */
const GEMINI_MODEL = 'gemini-3.5-flash-lite';
// 모델마다 한도 통이 따로라서(같은 키) 영상 분석은 다른 모델로 보낸다(2026-10-13): 편지·요약이 쓰는 통을 아끼기 위해
const GEMINI_VIDEO_MODEL = 'gemini-3.1-flash-lite';
function geminiUrl(model){ return 'https://generativelanguage.googleapis.com/v1beta/models/' + (model || GEMINI_MODEL) + ':generateContent?key=' + JUNGLE_CONFIG.geminiApiKey; }
const GEMINI_DIRECT_URL = geminiUrl(GEMINI_MODEL);
// 기기별 하루 상한 — 실제 API 한도는 일 500·분 15(팀 공유 키). 2026-09-28 뉴스 30→60, 유튜브 3→10으로 상향
// (유튜브 3건은 하루 중간에 바로 차서 "요약이 갑자기 안 된다"로 보였음)
const GEMINI_DAILY_CAP = { news: 60, youtube: 10, shinpd: 300, shinpdv: 150, shinpdalgo: 60 };   // shinpdv = 신피디 영상 내용 분석
function _geminiQuotaState(kind){
  try{
    const raw = localStorage.getItem('jsg_gemini_quota_' + kind + '_v1');
    const today = new Date().toISOString().slice(0, 10);
    const st = raw ? JSON.parse(raw) : null;
    return (st && st.date === today) ? st : { date: today, count: 0 };
  }catch(e){ return { date:'', count: 0 }; }
}
function geminiQuotaLeft(kind){ return GEMINI_DAILY_CAP[kind] - _geminiQuotaState(kind).count; }
function geminiQuotaConsume(kind){
  try{
    const st = _geminiQuotaState(kind);
    st.count += 1;
    localStorage.setItem('jsg_gemini_quota_' + kind + '_v1', JSON.stringify(st));
  }catch(e){}
}
/* ===== 하루 한도 소진 처리 (2026-10-07) =====
   무료 키의 하루 500건이 다 차면(팀·JK·스킬이 한 키를 같이 씀) 오류 메시지에 "Please retry in 19h38m33s"가 온다.
   예전엔 요약마다 3번씩 다시 호출하며 계속 실패했다. 이제는 한 번 감지하면 그 시각까지 호출 자체를 멈추고(이 기기),
   "몇 시 이후 다시 만들 수 있어요"로 안내한다. 분당 한도(retry in 16s)는 예전처럼 잠깐 기다렸다 재시도. */
const GEMINI_BLOCK_KEY = 'jsg_gemini_blocked_v1';
function _quotaRetrySeconds(err){
  const m = String(err || '').match(/retry in\s*(?:(\d+)h)?\s*(?:(\d+)m)?\s*(?:([\d.]+)s)?/i);
  if(!m || (!m[1] && !m[2] && !m[3])) return null;
  return (+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (parseFloat(m[3]) || 0);
}
function isDailyQuotaError(err){
  const s = String(err || '');
  if(!/quota|RESOURCE_EXHAUSTED/i.test(s)) return false;
  const sec = _quotaRetrySeconds(s);
  return sec === null ? /PerDay|per day|free_tier_requests/i.test(s) : sec >= 600;   // 10분 넘게 기다려야 하면 하루 한도
}
function _geminiKeyTag(){ return String(JUNGLE_CONFIG.geminiApiKey || '').slice(-8); }
function _geminiBlockKey(model){ return GEMINI_BLOCK_KEY + (model && model !== GEMINI_MODEL ? '_' + model : ''); }
function _geminiBlockedUntil(model){
  try{
    const st = JSON.parse(localStorage.getItem(_geminiBlockKey(model)) || 'null');
    if(!st || st.until <= Date.now()) return 0;
    return (st.k === _geminiKeyTag()) ? st.until : 0;   // 지금 키로 기록된 차단만 인정 — 키를 바꿨거나 표식 없는 옛 기록(10-07 오전 배포분)은 무시
  }catch(e){ return 0; }
}
function _geminiBlockMsg(until){
  const d = new Date(until), p = n => String(n).padStart(2, '0');
  const same = d.toDateString() === new Date().toDateString();
  return `오늘 Gemini 무료 한도를 다 썼어요 — ${same ? '' : '내일 '}${p(d.getHours())}:${p(d.getMinutes())} 이후 "요약 다시 만들기"로 다시 할 수 있어요`;
}
function _geminiSetBlocked(err, model){
  const sec = _quotaRetrySeconds(err);
  const until = Date.now() + (sec !== null ? sec * 1000 : 6 * 3600 * 1000) + 60 * 1000;
  try{ localStorage.setItem(_geminiBlockKey(model), JSON.stringify({ until, k: _geminiKeyTag() })); }catch(e){}
  return until;
}
// Gemini 호출 공통 — parts 배열을 보내고 첫 후보의 텍스트를 돌려준다.
// 실패 사유를 { text:null, error } 로 돌려준다 — 콘솔뿐 아니라 화면 토스트로도 띄워서
// 모바일에서 콘솔을 못 봐도 무슨 이유로 실패했는지 바로 보이게 한다.
/* ===== 모든 모델 돌려 쓰기 + 검색 절제 (2026-10-16) =====
   무료 키는 모델마다 한도 통(분당 토큰·하루 요청)이 따로다. 한 모델에 몰리면 분당 토큰(3.1 Flash Lite 250K)을 넘어 429가 나서,
   호출마다 풀을 번갈아 시작하고, 막히면(429·503·하루 한도·모델 종료) 다음 모델로 넘긴다. 하루 한도가 작은 모델(20건)은 한도가 차면 차단 기록으로 건너뛴다.
   구글 검색 연결은 프로젝트 전체 한도라 모델을 바꿔도 소용없다 → 한 번 막히면 3시간 동안 검색 없이 부른다. */
const GEMINI_POOL = ['gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.8-flash', 'gemini-3.5-flash-lite', 'gemini-3.1-flash-lite', 'gemini-3.7-flash', 'gemini-3.6-flash', 'gemini-3-flash-preview'];
const GEMINI_SEARCH_COOL = 'jsg_gemini_search_cool_v1';
function geminiSearchOk(){ try{ return Number(localStorage.getItem(GEMINI_SEARCH_COOL) || 0) < Date.now(); }catch(e){ return true; } }
function geminiSearchFail(){ try{ localStorage.setItem(GEMINI_SEARCH_COOL, String(Date.now() + 3 * 3600000)); }catch(e){} }
let _geminiRot = Math.floor(Math.random() * GEMINI_POOL.length);
const _GEMINI_RETRYABLE = /quota|exhausted|429|high demand|overload|unavailable|503|rate|no longer available|not found|404|한도|시간 초과/i;
async function callGeminiParts(parts, genCfg, model, tools){
  const useSearch = !!(tools && tools.some(t=> t && t.google_search));
  if(useSearch && !geminiSearchOk()) return { text: null, error: '구글 검색 한도를 써서 잠시 검색 없이 답합니다', searchBlocked: true, quotaBlocked: true };
  // 시작 모델: 지정했으면 그 모델부터, 아니면 풀을 돌려 가며. 나머지는 이어서 대체.
  const uniq = [];
  const start = model ? [model] : [];
  if(!model){ for(let i = 0; i < GEMINI_POOL.length; i++){ start.push(GEMINI_POOL[(_geminiRot + i) % GEMINI_POOL.length]); } _geminiRot = (_geminiRot + 1) % GEMINI_POOL.length; }
  start.concat(GEMINI_POOL).forEach(m=> { if(m && !uniq.includes(m)) uniq.push(m); });
  const order = uniq.slice(0, useSearch ? 2 : 6);   // 검색은 어느 모델이든 같은 통이라 2번만 시도
  let last = null;
  for(const m of order){
    if(_geminiBlockedUntil(m === GEMINI_MODEL ? undefined : m) && order.length > 1){ continue; }
    const r = await _geminiOnce(parts, genCfg, m === GEMINI_MODEL ? undefined : m, tools);
    if(r.text) return r;
    last = r;
    if(!(r.quotaBlocked || _GEMINI_RETRYABLE.test(String(r.error || '')))) return r;   // 형식 오류 같은 건 다른 모델도 똑같아서 바로 돌려준다
  }
  if(useSearch && last && /quota|exhausted|429/i.test(String(last.error || ''))) geminiSearchFail();
  return last || { text: null, error: '사용 가능한 모델이 없습니다' };
}
async function _geminiOnce(parts, genCfg, model, tools){
  const blockedUntil = _geminiBlockedUntil(model);
  if(blockedUntil) return { text: null, error: _geminiBlockMsg(blockedUntil), quotaBlocked: true };   // 한도 소진 중 — 호출하지 않는다
  try{
    const res = await fetch(model ? geminiUrl(model) : GEMINI_DIRECT_URL, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Object.assign({ contents: [{ parts }] }, genCfg ? { generationConfig: genCfg } : {}, tools ? { tools } : {}))
    });
    const data = await res.json();
    if(!res.ok){
      const err = (data && data.error && data.error.message) || ('HTTP ' + res.status);
      console.warn('[Gemini 호출 실패]', err);
      const viaSearch = !!(tools && tools.some(t=> t && t.google_search));   // 검색 연결 한도 오류는 그 모델의 일반 호출까지 막지 않는다
      if(isDailyQuotaError(err) && !viaSearch) return { text: null, error: _geminiBlockMsg(_geminiSetBlocked(err, model)), quotaBlocked: true };
      return { text: null, error: err };
    }
    const cand = data && data.candidates && data.candidates[0];
    const text = (cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text || '').trim();
    if(!text){ console.warn('[Gemini 호출 실패] 빈 응답', data); return { text: null, error: '응답이 비었습니다' }; }
    return { text, error: null };
  }catch(e){
    console.warn('[Gemini 호출 실패] 네트워크', e);
    return { text: null, error: '네트워크 오류' };
  }
}
/* 함수 호출 대화(2026-10-15 신피디 DB 읽기 도구). contents=[{role,parts}], tools=[{functionDeclarations}],
   runTool(name,args) → 응답 객체. 모델이 도구를 부르면 실행해 돌려주고 최대 maxRounds번 반복한다. 모델이 준 parts(생각 서명 포함)를 그대로 되돌려 보낸다. */
async function callGeminiTools(contents, tools, model, runTool, maxRounds){
  const blockedUntil = _geminiBlockedUntil(model);
  if(blockedUntil) return { text: null, error: _geminiBlockMsg(blockedUntil), quotaBlocked: true };
  const calls = [];
  try{
    for(let round = 0; round <= (maxRounds || 3); round++){
      const last = round === (maxRounds || 3);
      const res = await fetch(model ? geminiUrl(model) : GEMINI_DIRECT_URL, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(Object.assign({ contents }, last ? {} : { tools }))
      });
      const data = await res.json();
      if(!res.ok){
        const err = (data && data.error && data.error.message) || ('HTTP ' + res.status);
        if(isDailyQuotaError(err)) return { text: null, error: _geminiBlockMsg(_geminiSetBlocked(err, model)), quotaBlocked: true, calls };
        return { text: null, error: err, calls };
      }
      const cand = data && data.candidates && data.candidates[0];
      const parts = (cand && cand.content && cand.content.parts) || [];
      const fcs = parts.filter(p=> p.functionCall);
      if(!fcs.length || last){
        const text = parts.map(p=> p.text || '').join('').trim();
        if(!text) return { text: null, error: '응답이 비었습니다', calls };
        return { text, error: null, calls };
      }
      contents.push({ role: 'model', parts });
      const out = [];
      for(const p of fcs){
        const name = p.functionCall.name, args = p.functionCall.args || {};
        let r; try{ r = await runTool(name, args); }catch(e){ r = { ok: false, error: String(e.message || e).slice(0, 120) }; }
        calls.push({ name, args });
        out.push({ functionResponse: { name, response: r } });
      }
      contents.push({ role: 'user', parts: out });
    }
  }catch(e){ return { text: null, error: '네트워크 오류', calls }; }
  return { text: null, error: '도구 호출이 끝나지 않았습니다', calls };
}
async function geminiSummarize(payload){
  const STYLE = '한국어 음슴체로 써줘(예: "~함." "따라서 ~임." "한편 ~는 이에 대해 ~라고 지적함." "그러나 ~라는 반박도 있음.") — 자수를 줄이는 게 목적이야. '
    + '문장은 접속사를 살려 자연스럽게 이어 쓰고, 내용이 바뀌는 부분은 줄바꿈으로 문단을 나눠줘. 한 문장마다 억지로 끊어서 나열하지는 마. '
    + '비슷한 내용을 반복해서 다시 쓰지 말고, 핵심과 맥락이 이어지도록 압축해줘. 중요도 순으로 재배열하지 말고 원문에 나온 순서 그대로 요약해줘. '
    + '인물의 실제 발언은 그대로 인용해 큰따옴표로 표시해줘. '
    // 호칭 규칙(2026-10-06 사장님 지시): 처음엔 이름+직책, 두 번째부터는 직함·호칭 없이 이름만.
    + '등장인물은 요약에서 처음 언급할 때만 이름과 함께 직책·직급·소속을 적어줘(예: "대통령 이재명", "국민의힘 대표 한동훈", "미국 대통령 트럼프"). '
    + '두 번째 언급부터는 어떤 호칭·직함·직급도 붙이지 말고 이름 석자(외국인은 흔히 쓰는 이름)만 써서 "이재명은", "한동훈은", "트럼프는"처럼 정리해줘. '
    + '"이재명 대통령은", "한 대표는", "김 의원은", "~씨", "~님" 같은 표현은 두 번째부터 절대 쓰지 마. 성만 따로 줄여 부르는 것("이 대통령")도 쓰지 마.';
  const parts = payload.youtubeUrl
    ? [
        // 분량: 09-22에 "원 분량의 절반·요점만"으로 줄였더니 너무 짧아져 맥락이 끊김 → 2026-09-28 약 2배로 늘리고
        // 접속사로 앞뒤 연결·인과를 살리도록 지시(사장님 요청). 받아적기 수준(09-22 이전)까지 늘리진 말 것.
        { text: '이 유튜브 영상 내용을 요약해줘. ' + STYLE
          + ' 단, 이 영상 요약은 자수를 아끼기보다 영상을 안 본 사람도 맥락과 논리 흐름을 따라갈 수 있게 하는 게 목적이야. 화자의 말을 그대로 옮겨적지는 말되, 주장마다 그 배경·근거·결론을 함께 담아 넉넉하게 정리해줘. 영상의 흐름(도입→전개→결론)에 맞춰 문단 5~8개 정도, 문단마다 3~5문장 분량이 목표야 — 짧게 뭉뚱그리지 마.'
          + ' 맥락 파악이 어려운 만큼 앞뒤 문장이 어떻게 이어지는지 접속사(그래서·따라서·왜냐하면·그런데·반면·그 결과·이에 대해 등)로 분명히 드러내고, 원인과 결과·전제와 결론 같은 인과관계가 빠지지 않게 써줘. 같은 말 반복과 추임새만 빼고, 맥락을 설명하는 부연은 살려. 핵심 발언은 큰따옴표로 인용하고 나머지는 간접화법으로 정리해줘. 자막이 없어도 영상 자체를 끝까지 보고 정리해줘.' },
        { file_data: { file_uri: String(payload.youtubeUrl) } }
      ]
    : [{ text: '다음 뉴스 기사를 정리해줘. ' + STYLE
        + ' 핵심 사실·발언·수치를 빠짐없이 담아서 기사 원문 내용을 충분히 파악할 수 있을 만큼 구체적으로 작성해줘(짧게 뭉뚱그리지 말 것).\n\n'
        + String(payload.text || '').trim().slice(0, 12000) }];
  const { text, error, quotaBlocked } = await callGeminiParts(parts);
  return { summary: text, error, quotaBlocked };
}
// gemini-3.5-flash-lite 실측 한도: 분당 15 · 일일 500(2026-09-17, aistudio 대시보드 확인).
// 호출 간격 4.5초 → 분당 최대 ~13건으로 여유 있게 억제(몰아서 스크랩해도 한도 안 넘게).
let _geminiQueue = Promise.resolve();
function _geminiEnqueue(fn){
  const run = _geminiQueue.then(()=> new Promise(r=> setTimeout(r, 4500))).then(fn).catch(()=> null);
  _geminiQueue = run.catch(()=>{});
  return run;
}
// Google 에러 메시지에 "retry in 16.3s" 처럼 대기시간이 박혀 오면 그만큼(+1초) 기다리고,
// 없으면 4초 기본 대기. 지역 오류(User location...)처럼 대기시간이 안 나오는 경우도
// Cloudflare 경유지가 요청마다 바뀔 수 있어 재시도해볼 가치가 있음. 최대 3회.
function _parseRetryDelayMs(errText){
  const m = String(errText || '').match(/retry in\s*([\d.]+)\s*s/i);
  return m ? Math.min(30000, Math.ceil(parseFloat(m[1]) * 1000) + 1000) : null;
}
async function geminiSummarizeRetry(payload){
  let lastError = null;
  for(let i=0; i<3; i++){
    const r = await geminiSummarize(payload);
    if(r.summary) return r;
    lastError = r.error;
    if(r.quotaBlocked) break;          // 하루 한도 소진 — 재시도해도 소용없음
    if(i < 2) await new Promise(res=> setTimeout(res, _parseRetryDelayMs(r.error) || 4000));
  }
  return { summary: null, error: lastError };
}
// renderSavedNews()는 매번 flushOpenNoteEditors()부터 실행해서 "열려 있는 편집창의 현재 DOM
// 내용"을 모델에 되써넣는다(사용자가 타이핑 중인 걸 재렌더가 날리지 않게 하기 위함). 그런데
// 배경 요약이 끝나는 시점엔 편집창이 이미 빈 채로 열려 있을 수 있어, 그 낡은 빈 DOM이 방금 넣은
// 요약을 되돌려버린다 — renderSavedNews 부르기 전에 열려있는 편집창 DOM부터 새 내용으로 맞춰둔다.
function _syncOpenNoteEditorDom(key, noteHtml){
  try{
    const rich = document.querySelector(`.saved-card[data-key="${CSS.escape(key)}"].open .sc-note-rich`);
    if(rich) rich.innerHTML = noteHtml;
  }catch(e){}
}
async function applyGeminiSummaryToSaved(key, summary){
  const cur = newsState.savedNews[key];
  if(!cur) return;
  cur.note = textToNoteHtml(summary) + (cur.noteTail || '');   // noteTail: 요약 뒤에 붙일 원래 내용(뉴스추천 스크랩의 묶음 기사 목록)
  delete cur.noteTail;
  delete cur.aiFailed;
  await saveSavedNewsItem(key, cur);
  _syncOpenNoteEditorDom(key, cur.note);
  renderSavedNews();
}
// 토스트(2초)만으로는 놓치기 쉬워서, 실패 사유를 편집창(note)에도 직접 남겨 화면에 계속
// 보이게 한다(이미 note에 뭔가 있으면 안 건드림 — 실패 표시가 실제 내용을 덮지 않게).
async function markGeminiFailure(key, error){
  _settingsToast('AI 요약 실패: ' + String(error||'').slice(0,50));
  const cur = newsState.savedNews[key];
  if(!cur) return;
  const failHtml = textToNoteHtml('⚠ AI 요약 실패: ' + String(error || '알 수 없는 오류'));
  if(cur.noteTail){ cur.note = failHtml + cur.noteTail; }      // 뉴스추천 스크랩: 묶음 기사 목록은 그대로 두고 앞에 실패 표시
  else if(!cur.note){ cur.note = failHtml; }
  else return;                                                  // 사용자가 쓴 메모가 있으면 덮지 않음
  cur.aiFailed = true;                                          // 카드에 "요약 다시 만들기" 버튼이 뜬다
  await saveSavedNewsItem(key, cur);
  _syncOpenNoteEditorDom(key, cur.note);
  renderSavedNews();
}
/* "요약 다시 만들기" — 실패한 스크랩(note가 실패 표시뿐이거나 뉴스추천 목록뿐)의 요약을 다시 시도한다 */
function retryGeminiSummary(key){
  const it = newsState.savedNews[key];
  if(!it || !it.link) return;
  const until = _geminiBlockedUntil();
  if(until){ _settingsToast(_geminiBlockMsg(until)); return; }
  _settingsToast('요약을 다시 만드는 중…');
  if(isYoutubeUrl(it.link)) enrichScrapWithGeminiYoutubeSummary(key, it.link);
  else enrichScrapWithGeminiNewsSummary(key, it.link);
}
// 저장은 이미 끝난 뒤 배경에서 note만 채운다 — 실패하면 note가 예전처럼 비어 있는 채로
// 앱은 안 막힘(실패를 성공처럼 꾸미지 않는다). 실패 사유는 토스트 + note에 남겨서
// 모바일에서도 바로 원인 확인 가능하게 함.
async function enrichScrapWithGeminiNewsSummary(key, link){
  if(geminiQuotaLeft('news') <= 0){ markGeminiFailure(key, '오늘 뉴스 요약 한도(' + GEMINI_DAILY_CAP.news + '건) 소진'); return; }
  _geminiEnqueue(async ()=>{
    let body = '', fetchedTitle = '';
    try{ const r = await fetchArticlePage(link); body = r.body || ''; fetchedTitle = r.title || ''; }catch(e){}
    let before = newsState.savedNews[key];
    // 즉시저장 경로(quickAddScrap)는 제목을 URL 그대로 넣어두므로, 진짜 제목을 가져왔으면 배경에서 채워준다.
    // 카드 스크랩 경로는 이미 실제 제목이 들어있어 건드리지 않음.
    if(before && fetchedTitle && (!before.title || before.title === link)){
      before.title = fetchedTitle;
      await saveSavedNewsItem(key, before);
      renderSavedNews();
    }
    const source = body;
    if(!source){ markGeminiFailure(key, '요약할 원문을 못 가져왔습니다'); return; }
    const { summary, error } = await geminiSummarizeRetry({ text: source });
    if(!summary){ markGeminiFailure(key, error); return; }
    geminiQuotaConsume('news');
    await applyGeminiSummaryToSaved(key, summary);
  });
}
// 스크랩 추가 모달의 URL 탭처럼 본문을 이미 손에 쥐고 있을 때 쓴다 — 링크를 다시 가져오지 않고
// (사용자가 가져온 본문을 직접 수정했을 수 있으므로) 그 본문 그대로 요약만 배경에서 돌린다.
async function enrichScrapWithGeminiTextSummary(key, text){
  if(!text) return;
  if(geminiQuotaLeft('news') <= 0){ markGeminiFailure(key, '오늘 뉴스 요약 한도(' + GEMINI_DAILY_CAP.news + '건) 소진'); return; }
  _geminiEnqueue(async ()=>{
    const { summary, error } = await geminiSummarizeRetry({ text });
    if(!summary){ markGeminiFailure(key, error); return; }
    geminiQuotaConsume('news');
    await applyGeminiSummaryToSaved(key, summary);
  });
}
async function enrichScrapWithGeminiYoutubeSummary(key, youtubeUrl){
  if(geminiQuotaLeft('youtube') <= 0){ markGeminiFailure(key, '오늘 유튜브 요약 한도(' + GEMINI_DAILY_CAP.youtube + '건) 소진'); return; }
  _geminiEnqueue(async ()=>{
    const { summary, error } = await geminiSummarizeRetry({ youtubeUrl });
    if(!summary){ markGeminiFailure(key, error); return; }
    geminiQuotaConsume('youtube');
    await applyGeminiSummaryToSaved(key, summary);
  });
}
