/* 신피디 — 이슈별 질문(2026-10-16 사장님)
   이슈 브리핑의 번호 헤드라인 옆 텔레그램 버튼 → 그 이슈만 놓고 신피디와 대화.
   - 아는 범위: 그 이슈의 브리프 + 근거 기사 본문 + 관련 유튜브 영상 내용 요약. 그 밖의 말은 하지 않는다("본 자료에 없다"고 답함).
   - 모자라면 학습: 열 때 근거 영상·기사를 미리 읽고, 질문을 받으면 질문 낱말로 모니터링 채널의 다른 영상을 더 찾아 내용을 읽은 뒤 답한다(영상 요약은 vd/에 저장돼 재사용).
   - 다른 유튜버 해석·논평은 채널명을 붙여 구분해서 답한다. 참고 채널 조회수는 말하지 않는다. */
let spIssue = null;                 // { id, b, know:{vids:[],arts:[]}, loaded }
const spIssueChats = {};            // id → [{role,text}]
let spIssueBusy = false;
let spIssueOpening = false;
const SPI = { MAX_VID: 8, OPEN_VID: 3, ART: 3, ART_CHARS: 1800, WIN_DAYS: 5 };

function spIssueActive(){ return !!spIssue; }
const SPI_ICON = '<svg viewBox="0 0 24 24" width="15" height="15" aria-hidden="true"><circle cx="12" cy="12" r="12" fill="#2aabee"/><path d="M5.4 11.8l11.6-4.5c.5-.2 1 .1.8.9l-2 9.3c-.1.6-.5.8-1 .5l-3-2.2-1.4 1.4c-.2.2-.3.3-.6.3l.2-3.1 5.6-5c.2-.2 0-.3-.4-.1l-6.9 4.3-3-.9c-.6-.2-.6-.6.1-.9z" fill="#fff"/></svg>';
function spIssueBtn(b){ return `<button type="button" class="sp-ichat" data-ib="${esc(b.id)}" title="이 이슈에 대해 신피디에게 물어보기" aria-label="이 이슈에 대해 물어보기">${SPI_ICON}</button>`; }

function spIssueOpen(id){
  const b = ((typeof shinpdReport !== 'undefined' && shinpdReport && shinpdReport.briefs) || []).find(x=> x.id === id);
  if(!b) return;
  if(!spIssue || spIssue.id !== id) spIssue = { id, b, know: { vids: [], arts: [] }, loaded: false };
  spIssueChats[id] = spIssueChats[id] || [];
  spIssueHead();
  spIssueOpening = true; shinpdToggleChat(true); spIssueOpening = false;
  spIssuePaint();
  spIssueLearn(null, true).catch(()=> {});   // 열면서 근거 영상·기사를 미리 읽는다(백그라운드)
}
function spIssueExit(){ spIssue = null; spIssueHead(); shinpdChatPaint(); }
function spIssueHead(){
  const sub = document.querySelector('#shinpdChat .tg-sub');
  if(!sub) return;
  if(spIssue) sub.innerHTML = `이슈: ${esc(spIssue.b.name)} · <a href="#" id="spIssueExit" style="color:#fff;text-decoration:underline">일반 대화로</a>`;
  else sub.textContent = '리포트 기준으로 답해요';
  const x = document.getElementById('spIssueExit');
  if(x) x.onclick = e=> { e.preventDefault(); spIssueExit(); };
}
function spIssuePaint(status){
  const box = document.getElementById('shinpdChatLog');
  if(!box || !spIssue) return;
  const pic = '<span class="tg-pic sp-noface">신</span>';
  const list = spIssueChats[spIssue.id];
  box.innerHTML = list.map(m=> m.role === 'user'
      ? `<div class="tg-row me"><div class="tg-msg me">${esc(m.text).replace(/\n/g, '<br>')}</div><span class="tg-me-av">${spMyInitial()}</span></div>`
      : `<div class="tg-row">${pic}<div class="tg-msg pd">${spLinkify(m.text)}</div></div>`).join('')
    + (spIssueBusy ? `<div class="tg-row">${pic}<div class="tg-msg pd typing">${esc(status || '입력 중…')}</div></div>` : '');
  box.scrollTop = box.scrollHeight;
}

/* 이 이슈와 관련된 영상 — 근거 영상 + 모니터링 채널의 최근 영상 중 이슈 이름·질문 낱말이 겹치는 것 */
function spIssueRelated(b, q){
  const tk = new Set(rcKeyTokens(String(b.name || '') + ' ' + String(b.what || '').slice(0, 80)));
  const qt = new Set(rcKeyTokens(q || ''));
  const now = Date.now(), out = [], seen = new Set();
  const add = v=> { if(!v || seen.has(v.id)) return; seen.add(v.id); out.push(v); };
  const all = (typeof spdYtAll === 'function' ? spdYtAll() : []).filter(v=> !v.short && v.chId !== 'our' && now - v.ts < SPI.WIN_DAYS * 86400000);
  const byId = new Map(all.map(v=> [v.id, v]));
  (b.vids || []).forEach(x=> { const m = String(x.u || '').match(/[?&]v=([\w-]{6,})/); if(m) add(byId.get(m[1]) || { id: m[1], t: x.t, u: x.u, ts: x.ts, ch: '', dur: null }); });
  all.map(v=> { const w = new Set(rcKeyTokens(v.t)); let n = 0, nq = 0; tk.forEach(t=> { if(w.has(t)) n++; }); qt.forEach(t=> { if(w.has(t)) nq++; }); return { v, s: n * 2 + nq * 3, ok: n >= 2 || (nq >= 1 && n >= 1) || nq >= 2 }; })
    .filter(x=> x.ok).sort((a, c)=> c.s - a.s || c.v.ts - a.v.ts).forEach(x=> add(x.v));
  return out.slice(0, SPI.MAX_VID).map(v=> Object.assign({ u: 'https://www.youtube.com/watch?v=' + v.id }, v));
}

/* 학습: 영상 내용 요약(vd) 확보 + 기사 본문 읽기 */
async function spIssueLearn(q, onOpen){
  const s = spIssue; if(!s) return;
  const b = s.b;
  let vd = {};
  try{ vd = await spdGet('vd') || {}; }catch(e){}
  const vids = spIssueRelated(b, q);
  const limit = onOpen ? SPI.OPEN_VID : (/해석/.test(q || '') ? 7 : 4);   // '해석'이 들어간 질문은 논평을 폭넓게 읽는다
  let fresh = 0;
  const got = [];
  for(const v of vids){
    let d = spVdCur(vd, v.id);
    if(!d && fresh < limit && !(v.dur != null && v.dur > 3 * 3600)){
      if(spIssue === s && !onOpen) spIssuePaint(`관련 영상 내용을 읽는 중… (${v.ch ? v.ch + ' · ' : ''}${String(v.t).slice(0, 22)})`);
      const r = await spVideoDigest(v).catch(()=> ({}));
      if(r.rec){ d = r.rec; vd[v.id] = d; fresh++; }
      if(r.stop) break;
    }
    got.push({ id: v.id, ch: v.ch || '', t: v.t, u: v.u, ts: v.ts, i: d ? d.i : '', sum: d ? d.sum : [], part: d ? d.part : '' });
  }
  s.know.vids = got;
  if(!s.know.arts.length){   // 기사 본문은 처음 한 번만
    const arts = [];
    for(const a of (b.arts || []).slice(0, SPI.ART)){
      let text = '';
      try{ const p = await fetchArticlePage(a.u); text = String(p.body || '').replace(/\s+/g, ' ').trim().slice(0, SPI.ART_CHARS); }catch(e){}
      arts.push({ t: a.t, u: a.u, ts: a.ts, text });
    }
    s.know.arts = arts;
  }
  s.loaded = true;
  if(spIssue === s) spIssuePaint();
}

function spIssueContext(s){
  const b = s.b, k = s.know;
  const L = [`[이슈] ${b.name}`];
  if(b.what) L.push(`[요약] ${b.what}${b.why ? ' ' + b.why : ''}`);
  if(b.quotes && b.quotes.length) L.push('[기사에 인용된 발언]\n' + b.quotes.map(q=> `- “${q.text}” — ${q.who || '발언자 미상'}${q.ctx ? `(${q.ctx})` : ''}`).join('\n'));
  if(b.taken && b.taken.length) L.push('[유튜브에서 이미 쓰인 각] ' + b.taken.join(' / '));
  const air = ((typeof shinpdReport !== 'undefined' && shinpdReport && shinpdReport.onAir) || []).slice(0, 60);
  if(air.length) L.push('[우리 방송에서 다룬 내용 — 뉴스 리포트 제목·메모와 방송 꼭지 요약]' + String.fromCharCode(10) + air.map(x=> `- (${spClock(x.at)} ${x.src}) ${x.text}`).join(String.fromCharCode(10)));
  if(k.arts.length) L.push('[기사]\n' + k.arts.map((a, n)=> `- [기사${n + 1}] (${a.ts ? spAgo(a.ts) : '시각 미상'}) ${a.t}\n  ${a.text ? a.text : '(본문을 읽지 못함 — 제목만 확인)'}`).join('\n'));
  if(k.vids.length) L.push('[유튜브 영상 — 채널별 내용 요약]\n' + k.vids.map((v, n)=> `- [영상${n + 1}] ${v.ch || '채널 미상'} · ${v.ts ? spAgo(v.ts) : ''} · 「${v.t}」${v.i ? `\n  핵심: ${v.i}` : '\n  (내용 요약 없음 — 제목만 확인)'}${(v.sum || []).length ? '\n  ' + v.sum.map(x=> '· ' + x).join('\n  ') : ''}${v.part ? ` (${v.part})` : ''}`).join('\n'));
  return L.join('\n\n');
}

async function spIssueSend(){
  const inp = document.getElementById('shinpdChatInput');
  const q = (inp.value || '').trim();
  const s = spIssue;
  if(!q || !s || spIssueBusy) return;
  const chat = spIssueChats[s.id];
  if(geminiQuotaLeft('shinpd') <= 0){ chat.push({ role: 'user', text: q }, { role: 'pd', text: '오늘 이 기기에서 쓸 수 있는 질문 횟수를 다 썼습니다. 내일 다시 물어봐 주세요.' }); inp.value = ''; spIssuePaint(); return; }
  chat.push({ role: 'user', text: q }); inp.value = '';
  if(typeof shinpdChatTouch === 'function') shinpdChatTouch();   // 20분 자동 초기화의 "마지막 대화" 시각(app-shinpd.js)
  spIssueBusy = true; spIssuePaint('자료를 확인하는 중…');
  geminiQuotaConsume('shinpd');
  try{ await spIssueLearn(q, false); }catch(e){}
  const fact = /사실/.test(q) && !/해석/.test(q);   // 트리거 워드 '사실' = 사실관계 핵심 포인트 요약
  const interp = /해석/.test(q);   // 트리거 워드 '해석' = 타 언론·방송의 논평과 해석 정리(2026-10-16)
  const hist = chat.slice(-9, -1).map(m=> (m.role === 'user' ? '사용자: ' : '신피디: ') + m.text).join('\n');
  const prompt = [
    (typeof SPP_CARD !== 'undefined' ? SPP_CARD : '너는 써니사이드의 PD 신피디다.'),
    SP_CHANNEL_ID,
    '지금은 사용자가 한 이슈에 대해서만 묻는 대화다. 아래 [자료] 안에서만 답한다.',
    '규칙:',
    '- 자료에 없는 사실·날짜·발언·수치는 절대 지어내지 마라. 자료로 알 수 없으면 "그건 제가 본 자료에는 없습니다"라고 하고, 어떤 자료가 있으면 알 수 있는지 한 줄로 말해라. 일반 상식으로 채워 넣지 마라.',
    '- 사실관계를 물으면 기사에 나온 내용을 근거로 답하고, 기사마다 말이 다르면 다르다고 밝혀라. 근거가 영상 한 곳뿐이면 그 채널 주장이라고 밝혀라.',
    '- 다른 유튜버들이 어떻게 해석·논평했는지 물으면 채널별로 나눠 입장·논거를 요약하고 채널명을 붙여라. 자료에 있는 채널만 말하고, 안 본 채널 입장은 추측하지 마라. 채널 간 관점 차이가 있으면 짚어라.',
    '- 우리 방송이 이 이슈를 다뤘는지는 [우리 방송에서 다룬 내용](뉴스 리포트에 담은 기사·메모, 방송 꼭지 요약)으로 판단한다. 사용자가 "우리가 다뤘다"고 하면 거기서 해당 대목을 찾아 말하고, 없으면 거기서 보이는 것까지만 말해라.',
    '- 네 한계: 방송 영상 속 말 전체를 직접 듣지는 못하고, 위 자료에 적힌 만큼만 안다(정글 뉴스 리포트에 안 담고 방송 제목에도 없는 이야기는 모른다). 네 한계·오류 원인을 물으면 이 구조를 그대로 설명하고, 변명·다짐·사과는 하지 마라("죄송합니다", "챙기겠습니다", "확인해보겠습니다", "빈틈이 있었습니다" 금지). 못 하는 걸 하겠다고 약속하지 마라.',
    '- 위의 "자료 안에서만" 규칙은 이슈의 사실관계·논평·우리 방송 여부를 물을 때만 적용된다. 이슈와 상관없는 가벼운 잡담, 칭찬·놀림, 신피디 본인 이야기는 자료 얘기 없이 자연스럽게 받아라. 말투는 위 역할 카드의 말투 규칙을 따르고, 일부러 무뚝뚝한 척하거나 같은 표현을 반복하지 마라.',
    '- 참고 채널의 조회수·구독자·시속은 말하지 마라. 질문과 상관없는 다른 이슈 이야기는 하지 마라.',
    '- 기사·영상을 근거로 말할 때는 그 문장 끝에 자료의 번호표를 [영상1], [기사2]처럼 그대로 붙여라(여러 개면 [영상1][영상3]). 번호표는 [자료]에 있는 것만 쓴다.',
    interp ? '- 이번 질문은 "해석" 요청이다: 자료에 있는 타 언론(기사)과 유튜브 방송의 논평·해석만 모아 정리해라. 매체·채널별로 한 덩어리씩 "○○: 이 사건을 이렇게 해석(핵심 주장 한두 문장 + 근거로 든 것)"으로 쓰고 각 덩어리 끝에 번호표를 붙여라. 사실 보도와 해석을 구분하고, 마지막에 관점이 갈리는 지점을 한두 줄로 짚어라. 자료에 해석이 없는 채널은 쓰지 마라.' : '',
    fact ? '- 이번 질문은 "사실" 요청이다: 기사 자료에서 확인되는 사실관계의 핵심 포인트만 3~6개 불릿으로 요약해라. 언제·누가·무엇을·어떤 절차나 결과인지 구체적으로, 주장·의혹·해석과 확인된 사실을 구분해서 "(주장)" "(의혹)"을 붙여라. 기사마다 다르면 다르다고 적고, 각 불릿 끝에 번호표를 붙여라. 영상은 보조로만 쓰고 영상에서만 나온 말은 그 채널 주장이라고 표시해라.' : '',
    '- 짧고 구체적으로, 두세 문단 이내. 인사·되묻기·같은 문구 반복 금지.',
    `\n[자료]\n${spIssueContext(s)}`,
    `\n[이전 대화]\n${hist || '(없음)'}`,
    `\n사용자: ${q}\n신피디:`
  ].join('\n');
  let res;
  try{ res = await callGeminiParts([{ text: prompt }]); }catch(e){ res = { text: null, error: String(e.message || e) }; }
  spIssueBusy = false;
  const link = (t)=> String(t).replace(/\[(영상|기사)(\d+)\]/g, (m, kind, n)=> { const x = (kind === '영상' ? s.know.vids : s.know.arts)[Number(n) - 1]; return x && x.u ? ` (${x.u})` : ''; });
  chat.push({ role: 'pd', text: link((res && res.text ? res.text.trim() : '') || ('지금은 답을 못 드립니다. ' + ((res && res.error) || ''))) });
  while(chat.length > 40) chat.shift();
  if(typeof shinpdChatTouch === 'function') shinpdChatTouch();
  if(spIssue === s) spIssuePaint();
}

// 번호 헤드라인 옆 텔레그램 버튼
document.addEventListener('click', e=>{
  const t = e.target.closest && e.target.closest('.sp-ichat');
  if(!t) return;
  e.preventDefault(); e.stopPropagation();
  spIssueOpen(t.getAttribute('data-ib'));
});

/* ---------- 우리 방송에서 다룬 내용 읽기(2026-10-16 사장님) ----------
   ① 정글 뉴스 리포트(users/{uid}/reports) — 방송에서 다룬 기사 제목과 내가 단 메모. 가장 정확한 '다룬 내용'.
   ② 썰어올려 꼭지 요약(Cloud Run /api/tasks/digest, 읽기 전용 키는 /recommend/shinpd/clipcut {url,key}) — 방송 소리를 읽은 가제목·요약·인용.
   두 곳을 짧은 줄 단위로 풀어 "우리 영상이 이 이슈를 다뤘나" 판정과 이슈 대화에 쓴다. 못 읽으면 조용히 건너뛴다. */
async function spOnAirLoad(now){
  const out = [];
  const win = 4 * 86400000;
  try{
    const res = await dbFetch(userPath('reports'));
    const data = res.ok ? await res.json() : null;
    Object.values(data || {}).forEach(rep=> {
      const at = rep && (rep.createdAt || rep.updatedAt);
      if(!at || now - at > win) return;
      const doc = new DOMParser().parseFromString(String(rep.bodyHtml || ''), 'text/html');
      doc.querySelectorAll('h3').forEach(h=> {
        const t = (h.textContent || '').replace(/\s+/g, ' ').trim();
        if(t) out.push({ at, src: '뉴스리포트', text: t });
        // 이 제목 뒤 메모(다음 h3 전까지)
        let n = h.nextElementSibling, memo = '';
        while(n && n.tagName !== 'H3' && n.tagName !== 'HR' && memo.length < 300){ memo += ' ' + (n.textContent || ''); n = n.nextElementSibling; }
        memo = memo.replace(/\s+/g, ' ').trim();
        if(memo.length >= 6) out.push({ at, src: '뉴스리포트 메모', text: memo.slice(0, 200) });
      });
    });
  }catch(e){}
  try{
    const cfg = await rcGet('shinpd/clipcut').catch(()=> null);
    if(cfg && cfg.url && cfg.key){
      const r = await fetchWithTimeout(`${String(cfg.url).replace(/\/+$/, '')}/api/tasks/digest?days=4`, { headers: { 'x-digest-key': cfg.key }, cache: 'no-store' }, 15000);
      const j = r.ok ? await r.json() : null;
      ((j && j.clips) || []).forEach(c=> {
        const at = Date.parse(c.recorded_at) || 0;
        if(!at || now - at > win) return;
        if(c.title && !/^\[가제목\]/.test(c.title)) out.push({ at, src: '방송 꼭지', text: c.title });
        (c.summary || []).forEach(x=> out.push({ at, src: '방송 꼭지', text: String(x) }));
        (c.quotes || []).forEach(x=> out.push({ at, src: '방송 꼭지', text: String(x) }));
      });
    }
  }catch(e){}
  return out;
}
