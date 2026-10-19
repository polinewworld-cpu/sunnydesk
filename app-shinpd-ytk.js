/* 신피디 — 유튜브 정책·알고리즘 전문가 + 쌓이는 지식 창고(2026-10-16 사장님)
   - 지식 창고: /recommend/shinpd/ytk/{id} = { f:사실 한두 문장, s:출처, u:URL, d:발효·발표 시기, c:분야, at:배운 시각 }
   - 쌓는 길 3가지
     ① 공부: 분야별로 구글 검색을 켠 제미나이가 "한국 시사 유튜브 운영자에게 중요한 사실"을 정리(알고리즘 탭 갱신 때 가장 비어 있는 분야부터, "유튜브 공부해"로도 실행)
     ② 공식 자료: 알고리즘 탭의 공식 영상 정리·공식 계정 글이 생기면 그대로 창고에 넣음
     ③ 대화: 유튜브 질문에 검색해서 새로 알게 된 것을 답 끝에 [학습] 줄로 남기면 창고에 넣음
   - 대화에서는 질문과 관련 있는 지식만 골라(최신순·낱말 겹침) 프롬프트에 넣고, 출처·시기를 구분해서 말하게 한다.
   - 관리: "유튜브 지식 보여줘" / "유튜브 지식 N번 삭제" / "유튜브 공부해" */
const SPK = { MAX: 400, CTX: 14, STUDY_N: 6 };
const SPK_INTENT = /유튜브|youtube|알고리즘|쇼츠|숏츠|수익\s*(창출|화)|노란\s*딱지|광고\s*(적합|제한)|커뮤니티\s*(가이드|규정)|가이드라인|저작권|스트라이크|경고|제재|삭제\s*당|추천\s*(영상|피드|노출)|노출|조회수\s*(가|가\s*왜|떡락|폭락)|구독자|시청\s*(지속|시간)|썸네일|클릭률|CTR|라이브\s*(규정|정책)|슈퍼챗|채널\s*(운영|정책)|파트너\s*프로그램|YPP/i;
const SPK_TOPICS = [
  { c: '수익화', q: '유튜브 파트너 프로그램(YPP) 수익 창출 자격, 재사용 콘텐츠 정책, 광고 적합성(정치·시사 콘텐츠의 노란 딱지·제한적 광고) 최신 기준' },
  { c: '정책', q: '유튜브 커뮤니티 가이드라인 중 선거·정치 허위정보, 혐오·괴롭힘, 스팸·기만 관행, 폭력적 발언 관련 최신 규정과 변경' },
  { c: '알고리즘', q: '유튜브 추천 알고리즘 작동 원리(클릭률, 평균 시청 지속시간, 시청 만족도 설문, 홈·추천·검색 노출)에 대한 유튜브 공식 설명과 최근 변화' },
  { c: '쇼츠', q: '유튜브 쇼츠 알고리즘, 조회수 집계 방식, 쇼츠 수익 분배, 쇼츠 길이 정책, 쇼츠가 롱폼 채널에 미치는 영향 최신' },
  { c: '라이브', q: '유튜브 라이브 스트리밍의 추천·노출 방식, 슈퍼챗, 라이브 중 정책 위반 사례, 다시보기·클립 처리, 라이브 관련 최근 변경' },
  { c: '한국', q: '한국 정치 시사 유튜브 채널이 받은 경고·수익 중지·삭제·제한 사례와 한국 관련 YouTube 정책·규제 동향' },
  { c: '제목썸네일', q: '유튜브 제목·썸네일 클릭률(CTR) 관련 정책, 클릭베이트·기만적 메타데이터 규정, 제목·썸네일 A/B 테스트 기능' },
  { c: '분석', q: '유튜브 스튜디오 분석 지표(노출 클릭률, 평균 시청 지속시간, 시청자 유지율, 신규 시청자) 해석과 최근 추가된 분석 기능' },
  { c: '저작권', q: '유튜브 저작권 클레임, 공정 이용, 뉴스 영상·방송 화면 인용, 콘텐츠 ID 분쟁 처리 정책과 최근 변화' }
];

let spkCache = null, spkCacheAt = 0, spkStudyBusy = false;
async function spkLoad(force){
  if(!force && spkCache && Date.now() - spkCacheAt < 5 * 60000) return spkCache;
  let d = null;
  try{ d = await spdGet('ytk'); }catch(e){}
  spkCache = (d && typeof d === 'object') ? d : {};
  spkCacheAt = Date.now();
  return spkCache;
}
const spkFmt = ms=> { const d = new Date(ms + 9 * 3600000); return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}-${String(d.getUTCDate()).padStart(2, '0')}`; };
const spkTok = t=> new Set((String(t || '').toLowerCase().match(/[가-힣]{2,}|[a-z0-9]{3,}/g) || []));

/* 새 사실 넣기 — 같은 뜻이 이미 있으면 새 것으로 갱신(시기가 더 최근일 때)만 한다 */
async function spkAdd(facts, cat){
  const cur = await spkLoad();
  let added = 0;
  for(const x of facts || []){
    const f = String((x && x.f) || '').replace(/\s+/g, ' ').trim().slice(0, 320);
    if(f.length < 12) continue;
    const dup = Object.entries(cur).find(([, v])=> v && sppSimilar(v.f, f));
    const rec = { f, s: String(x.s || '').slice(0, 80), u: /^https?:\/\//.test(x.u || '') ? String(x.u).slice(0, 300) : '', d: String(x.d || '').slice(0, 10), c: x.c || cat || '기타', at: Date.now() };
    if(dup){
      if(rec.d && rec.d > (dup[1].d || '')){ cur[dup[0]] = Object.assign({}, dup[1], rec); await spdPutJson('ytk/' + dup[0], cur[dup[0]]).catch(()=> {}); }
      continue;
    }
    const id = 'k' + rcHash(f + '|' + Date.now());
    cur[id] = rec; added++;
    await spdPutJson('ytk/' + id, rec).catch(()=> {});
  }
  const keys = Object.keys(cur);
  if(keys.length > SPK.MAX){   // 오래 전에 배운 것부터 정리
    keys.sort((a, b)=> (cur[a].at || 0) - (cur[b].at || 0)).slice(0, keys.length - SPK.MAX).forEach(k=> { delete cur[k]; spdRtdb('ytk/' + k, { method: 'DELETE' }).catch(()=> {}); });
  }
  return added;
}

/* 질문과 관련 있는 지식 — 낱말 겹침 + 최신 */
async function spkRelevant(q, n){
  const cur = await spkLoad();
  const qt = spkTok(q);
  const rows = Object.values(cur).filter(v=> v && v.f).map(v=> {
    const t = spkTok(v.f + ' ' + (v.c || '')); let hit = 0; qt.forEach(w=> { if(t.has(w)) hit++; });
    const age = (Date.now() - (v.at || 0)) / 86400000;
    return { v, s: hit * 3 + Math.max(0, 2 - age / 30) };
  }).sort((a, b)=> b.s - a.s);
  return rows.slice(0, n || SPK.CTX).filter(x=> x.s > 0.5).map(x=> x.v);
}

function spkParseArr(text){
  try{ return JSON.parse((String(text || '').match(/\[[\s\S]*\]/) || ['null'])[0]); }catch(e){ return null; }
}
/* 공부 — 지식이 가장 적은 분야부터 구글 검색으로 정리해 창고에 넣는다 */
async function spkStudy(count, manual){
  if(spkStudyBusy) return { busy: true };
  if(!manual && typeof geminiSearchOk === 'function' && !geminiSearchOk()) return { log: ['검색 한도로 자동 공부 건너뜀'] };   // 자동 공부는 검색이 될 때만
  spkStudyBusy = true;
  const log = [];
  try{
    const cur = await spkLoad(true);
    const n = {}; SPK_TOPICS.forEach(t=> { n[t.c] = 0; }); Object.values(cur).forEach(v=> { if(v && n[v.c] != null) n[v.c]++; });
    const order = SPK_TOPICS.slice().sort((a, b)=> n[a.c] - n[b.c]).slice(0, Math.max(1, count || 1));
    for(const t of order){
      if(typeof geminiQuotaLeft === 'function' && geminiQuotaLeft('shinpdalgo') <= 0){ log.push('오늘 공부 한도 소진'); break; }
      geminiQuotaConsume('shinpdalgo');
      const known = Object.values(cur).filter(v=> v && v.c === t.c).sort((a, b)=> (b.at || 0) - (a.at || 0)).slice(0, 10).map(v=> '- ' + v.f.slice(0, 80)).join('\n');
      const prompt = [
        '당신은 YouTube 정책·알고리즘·채널 운영에 가장 정통한 전문가입니다. 구글 검색으로 직접 확인해서, 한국의 정치 시사 유튜브 채널 운영자에게 실제로 중요한 사실만 정리하세요.',
        '주제: ' + t.q,
        `${SPK.STUDY_N}개 이내. JSON 배열만 출력: [{"f":"사실 한두 문장(구체적 수치·조건·시점 포함)","s":"출처(공식 문서명·매체)","u":"출처 URL(있으면)","d":"발효·발표 시기 YYYY-MM 또는 YYYY-MM-DD(모르면 빈 문자열)"}]`,
        '규칙: 검색으로 확인된 것만 쓰고 추측·일반론 금지. 공식 문서(YouTube 고객센터·공식 블로그)를 우선하고, 비공식 분석·경험담이면 s에 "비공식"이라고 적으세요. 출처 없이 떠도는 소문은 넣지 마세요.',
        known ? '이미 알고 있는 것(겹치지 않게):\n' + known : ''
      ].filter(Boolean).join('\n');
      let res = await callGeminiParts([{ text: prompt }], { temperature: 0.2 }, undefined, [{ google_search: {} }]);
      let unverified = false;
      if(!(res && res.text)){ res = await callGeminiParts([{ text: prompt.replace('구글 검색으로 직접 확인해서, ', '') }], { temperature: 0.2 }); unverified = true; }   // 검색 한도가 찼을 땐 기본 지식으로 정리하되 '검색 미확인'을 표시
      const arr = res && res.text ? spkParseArr(res.text) : null;
      if(!Array.isArray(arr)){ log.push(`${t.c}: 정리 실패`); continue; }
      const added = await spkAdd(arr.map(x=> Object.assign({}, x, { c: t.c, s: unverified ? String(x.s || '').slice(0, 50) + ' · 검색 미확인' : x.s })), t.c);
      log.push(`${t.c}: ${added}건 추가${unverified ? '(검색 한도로 미확인)' : ''}`);
    }
  }finally{ spkStudyBusy = false; }
  return { log };
}

/* 알고리즘 탭 갱신 직후 — 공식 계정 글을 창고에 넣고, 지식이 적으면 공부를 더 한다(백그라운드) */
function sppYtkFromAlgo(data){
  (async ()=> {
    try{
      const posts = (data.sns || []).filter(x=> x && x.official && (x.ko || x.t)).slice(0, 8)
        .map(x=> ({ f: String(x.ko || x.t), s: '@' + (x.h || '공식 계정'), u: x.u, d: isFinite(x.ts) ? spkFmt(x.ts) : '', c: '공식 발표' }));
      await spkAdd(posts, '공식 발표');
      const total = Object.keys(await spkLoad()).length;
      await spkStudy(total < 30 ? 2 : 1);   // 갱신마다 많이 하지 않는다(검색 한도 절약)
    }catch(e){}
  })();
}
function sppYtkFromVideo(v, bullets){
  const f = String(bullets || '').split('\n').map(l=> l.replace(/^\s*[-•*]\s*/, '').trim()).filter(Boolean).join(' ').slice(0, 320);
  if(f.length < 12) return;
  const off = !v.off;   // 비공식 크리에이터 채널은 공식 정책과 섞이지 않게 따로 표시
  spkAdd([{ f, s: (off ? 'YouTube 공식 영상: ' : (v.ch || '크리에이터') + ' 영상(비공식 노하우): ') + String(v.ko || v.t || '').slice(0, 50), u: v.u, d: isFinite(v.ts) ? spkFmt(v.ts) : '', c: off ? '공식 발표' : '크리에이터 노하우' }], off ? '공식 발표' : '크리에이터 노하우').catch(()=> {});
}

/* 대화 — 질문과 관련된 지식을 프롬프트 블록으로 */
async function sppYtkBlock(q){
  if(!SPK_INTENT.test(q)) return '';
  const rel = await spkRelevant(q).catch(()=> []);
  const know = rel.length
    ? rel.map(v=> `- (${v.d || spkFmt(v.at)} · ${v.s || '출처 미상'}${v.u ? ' ' + v.u : ''}) ${v.f}`).join('\n')
    : '(이 질문과 겹치는 지식이 아직 창고에 없음)';
  return [
    '[유튜브 전문가로서의 규칙] 당신은 YouTube 정책·알고리즘·수익화·쇼츠·라이브 규정에 가장 해박한 사람입니다. 사용자가 이 분야를 물으면 아는 만큼 정확하고 구체적으로 답하되,',
    '- 확인 수준을 구분하세요: 공식 문서로 확인된 것 / 업계에서 통하는 경험칙 / 추정. 추정을 사실처럼 말하지 마세요.',
    '- 정책·알고리즘은 자주 바뀝니다. 아래 지식은 날짜가 있는 것만 믿고, 오래된 것(몇 달 전)이거나 중요한 판단(수익·제재)이면 구글 검색으로 현재 상태를 확인한 뒤 답하세요. 상충하면 최신 쪽을 따르고 바뀌었다고 알리세요.',
    '- 우리 채널(정치 시사 라이브·편집 영상)에 어떻게 적용되는지까지 말하세요. 일반론만 늘어놓지 마세요.',
    '- 검색해서 새로 확인한 정책·알고리즘 사실이 아래 지식에 없으면 답 맨 끝에 별도 줄로 `[학습] 사실 한두 문장 || 출처(공식 문서·매체명) || URL(있으면)` 을 쓰세요(최대 3줄, 확실한 것만. 이 줄은 화면에서 지워지고 지식 창고에 저장됩니다).',
    '[내가 쌓아 둔 유튜브 지식 — 이 질문과 관련된 것]\n' + know
  ].join('\n');
}
/* 답 끝의 [학습] 줄을 떼어 창고에 넣는다 */
function sppYtkHarvest(text){
  const facts = [];
  const clean = String(text || '').replace(/^\s*\[학습\]\s*(.+)$/gm, (m, body)=> {
    const p = body.split('||').map(x=> x.trim());
    if(p[0] && p[0].length >= 12) facts.push({ f: p[0], s: (p[1] || '').slice(0, 80), u: /^https?:/.test(p[2] || '') ? p[2] : '', d: spkFmt(Date.now()).slice(0, 7), c: '대화' });
    return '';
  }).replace(/\n{3,}/g, '\n\n').trim();
  if(facts.length) spkAdd(facts.slice(0, 3), '대화').catch(()=> {});
  return clean;
}

/* 명령 */
async function sppYtkCommand(t){
  const list = /^\s*유튜브\s*(?:지식|창고)\s*(?:목록|보여|확인|뭐|알려)/.test(t);
  const del = t.match(/^\s*유튜브\s*(?:지식|창고)\s*(\d+)\s*번?\s*(?:삭제|지워|빼)/);
  const study = /^\s*유튜브\s*(?:공부|학습)\s*(?:해|좀|하자|시작)/.test(t);
  if(!list && !del && !study) return null;
  if(study){
    if(spkStudyBusy) return { text: '지금 공부하는 중입니다. 조금 뒤에 지식 창고를 열어 보세요.' };
    const r = await spkStudy(3, true);
    const total = Object.keys(await spkLoad(true)).length;
    return { text: `공부했습니다. ${(r.log || []).join(' · ') || '새로 정리된 것이 없습니다'}. 지식 창고에 지금 ${total}건 있습니다.` };
  }
  const cur = await spkLoad(true);
  const rows = Object.entries(cur).filter(([, v])=> v && v.f).sort((a, b)=> (b[1].at || 0) - (a[1].at || 0));
  if(del){
    const i = Number(del[1]) - 1;
    if(i < 0 || i >= Math.min(rows.length, 30)) return { text: `${del[1]}번은 없습니다. 최근 순 목록(1~${Math.min(rows.length, 30)}번)에서 골라 주세요.` };
    const [k, v] = rows[i];
    delete cur[k]; await spdRtdb('ytk/' + k, { method: 'DELETE' }).catch(()=> {});
    return { text: `${del[1]}번("${v.f.slice(0, 40)}…")을 지식 창고에서 뺐습니다.` };
  }
  if(!rows.length) return { text: '지식 창고가 아직 비었습니다. "유튜브 공부해"라고 하면 바로 채웁니다.' };
  const by = {}; rows.forEach(([, v])=> { by[v.c || '기타'] = (by[v.c || '기타'] || 0) + 1; });
  return { text: `지식 창고 ${rows.length}건(${Object.entries(by).map(([c, n])=> `${c} ${n}`).join(' · ')}). 최근 것부터:\n` + rows.slice(0, 15).map(([, v], i)=> `${i + 1}. (${v.d || spkFmt(v.at)}) ${v.f.slice(0, 110)}`).join('\n') };
}
