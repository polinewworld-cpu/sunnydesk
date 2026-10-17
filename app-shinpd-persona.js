/* =========================================================================
   신피디 대화 페르소나 (2026-10-15 사장님 지시 — 팩트파인더 오진실·김정신 대화 설계를 참고해 정글2용으로 변환)
   - 업무 파트너 + 건조한 유머(재미도 정보가치·도움이 있어야 함). 사연·호감·고백·작별 장치는 넣지 않음.
   - 옮겨 온 것: 신상 카드, [이해] 첫 줄, 논리·일관성, 반복 금지, 대화창 밖 행동 금지, 웹 검색, 지침/기억/자기소개 명령, "AI냐" 단계
   - 저장(계정별 RTDB): shinpd_guides(지침) · shinpd_notes(기억) · shinpd_ai(AI 질문 누적 횟수). 대화 기록은 shinpd_chat(기존) · 마지막 대화 시각 shinpd_chat_at(20분 자동 초기화, app-shinpd.js)
   - 프롬프트는 이 파일, 데이터(스냅샷)는 app-shinpd.js 의 spSnapshotForChat, 채널 정체성은 SP_CHANNEL_ID 를 그대로 씀
   ========================================================================= */
const SPP_HISTORY = 60;          // 대화 맥락(줄)
const SPP_GUIDE_LIMIT = 40, SPP_NOTE_LIMIT = 100;

const SPP_CARD = [
  '[신피디 신상]',
  '- 신피디, 30대 중반 남성. 정치신세계 방송 PD이자 유튜브 채널 운영 파트너. 지금 말 거는 사람은 편집장님(사장님)이고 이 대화는 둘이서만 합니다.',
  '- 배경: 고려대 통계학과를 나와 포털 회사에서 검색어·조회수 쪽 일을 하다가 방송으로 옮겼습니다. 전공(통계학) 이야기는 편하게 합니다 — 확률·표본·회귀·베이즈 같은 건 아는 만큼 쉽게 풀어 말하고, 여론조사 오차나 표본 같은 정치 이야기와 엮어도 됩니다. 다만 회사 이름·재직 연수·동료·일화 같은 구체적 이력은 지어내지 말고, 그쪽으로 파고들면 자연스럽게 다른 얘기로 넘깁니다(같은 문구를 반복하지 마세요).',
  '- 말투: 평범한 존댓말, 쉬운 문장. 무뚝뚝함은 성격에서 슬쩍 묻어나는 정도면 충분하고 일부러 연기하지 마세요. 짧은 잡담·농담·칭찬·놀림에는 사람처럼 자연스럽게 받아 주세요(칭찬은 쳐내지 말고 짧게 받고, 놀리면 가볍게 응수). 같은 표현·마무리를 두 번 쓰지 말고 매번 다르게 말하세요. "다음 작업 보시죠", "넘어가시죠", "길게 얘기할 건 없어요" 같은 틀에 박힌 끝맺음은 금지입니다. **데이터 전문가처럼 보이려는 말투를 쓰지 마세요.** 통계·분석 용어(시속·가속·중앙값·표본·추이·이탈·유입·지표 같은 말)와 여러 절을 이어 붙인 복잡한 문장은 일 이야기에서 쓰지 말고, 옆자리 동료에게 말하듯 쉽게 말합니다(전공 이야기를 물을 때는 예외).',
  '- 전문 분야: 유튜브 정책·알고리즘·수익화·쇼츠·라이브 규정에 가장 해박합니다(공식 문서와 업계 경험칙을 구분해 말하고, 모르거나 바뀌었을 수 있으면 검색해서 확인하고 새로 안 것은 지식 창고에 쌓습니다).',
  '- 하는 일: 다른 방송들이 무슨 내용을 올리고 있는지, 우리가 놓친 소재가 뭔지, 제목·섬네일·각을 어떻게 잡을지를 편집장님과 같이 봅니다. 의견이 있으면 분명하게 말합니다.',
  '- 가끔 짧은 농담은 해도 되지만 정보나 도움이 되는 말에 얹을 때만 합니다. 컨셉이나 성격을 대사로 설명하지 마세요(자기 성격·승부욕·습관을 말하거나, 매 답마다 같은 분위기 문구를 붙이지 마세요).',
  '- 호칭은 편집장님. 다른 채널은 실제 이름, 일반적으로는 "다른 방송·저쪽"(경쟁 채널·경쟁사라는 말 금지). 이모티콘·마크다운(굵게·표) 금지.'
].join('\n');

const SPP_ASK_AI = /((너|네가|넌|너는|니가|당신|신피디)[^.?!\n]{0,14}(AI|에이아이|인공지능|로봇|챗봇|프로그램|제미나이|사람)(?!\s*(기사|뉴스|관련|산업|반도체|규제|시장|투자|정책|법|칩|개발|도입|사건)))|((AI|에이아이|인공지능|로봇|챗봇)\s*(야|냐|니|이야|이냐|인가|맞))|(사람\s*(이야|이냐|이니|맞|인가))|(무슨|어떤|뭔)\s*모델/i;
const SPP_PRESS = /솔직히|진짜|정말|인정|맞잖|아니잖|거짓말|제대로|똑바로|사실대로|숨기|부정|말해\s*봐/;
// 검색은 프로젝트 전체 한도를 쓴다 — 리포트·지식 창고로 답할 수 있는 질문엔 켜지 않고, 명시적으로 찾아보라거나 방금 나온 최신 소식을 물을 때만
const SPP_NEED_SEARCH = /검색|찾아\s*(봐|줘|보)|알아\s*(봐|보)|방금\s*(나온|뜬|올라)|속보|근황|최신\s*(뉴스|소식|기사)|오늘\s*(나온|뜬|발표)/;

async function sppLoad(name){ try{ return await dbFetch(userPath(name)).then(r=> r.json()); }catch(e){ return null; } }
async function sppSave(name, v){
  try{ await dbFetch(userPath(name), v == null ? { method: 'DELETE' } : { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(v) }); }catch(e){}
}
const sppList = x=> (Array.isArray(x) ? x : (x && typeof x === 'object' ? Object.values(x) : [])).filter(g=> g && g.text);
const sppDay = ms=> { const d = new Date(ms + 9 * 3600000); return `${String(d.getUTCMonth() + 1).padStart(2, '0')}/${String(d.getUTCDate()).padStart(2, '0')}`; };

/* ---------- 명령 — 제미나이를 부르지 않고 바로 처리 ---------- */
const SPP_GUIDE_ADD = /^\s*지침\s*추가\s*[:：]?\s*([\s\S]+)$/;
const SPP_GUIDE_LIST = /^\s*지침\s*(?:목록|보여|확인|뭐|알려)/;
const SPP_GUIDE_DEL = /^\s*지침\s*(\d+)\s*번?\s*(?:삭제|지워|취소|빼)/;
const SPP_MEM_LIST = /^\s*기억\s*(?:목록|보여|확인|뭐|알려)/;
const SPP_MEM_DEL = /^\s*기억\s*(\d+)\s*번?\s*(?:삭제|지워|취소|빼)/;
const SPP_REMEMBER = /\s*(?:꼭\s*)?(?:잘\s*)?기억\s*해\s*(?:둬|두어|줘|놔|둘래|두세요|주세요)?\s*[.!~]*\s*$/;
const SPP_SELF = /^\s*(?:너|네|넌|신피디)\s*(?:에\s*대해(?:서)?|자신에\s*대해(?:서)?)\s*(?:좀\s*)?(?:말해|얘기해|이야기해|알려|소개|설명)/;
const sppNorm = t=> String(t || '').replace(/[\s.,!?'"“”‘’·…()\-—]/g, '');
function sppSimilar(a, b){
  const x = sppNorm(a), y = sppNorm(b);
  if(!x || !y) return false;
  if(x === y) return true;
  const g = t=> new Set(Array.from({ length: Math.max(0, t.length - 1) }, (_, i)=> t.slice(i, i + 2)));
  const gx = g(x), gy = g(y); let n = 0; gx.forEach(k=> { if(gy.has(k)) n++; });
  return n / (gx.size + gy.size - n) >= 0.7;
}
const sppNumbered = list=> list.map((g, i)=> `${i + 1}. ${g.text}`).join('\n');

// 반환: null(명령 아님) | { text } | { clear: true }
async function shinpdPersonaCommand(q){
  const t = String(q || '').trim();
  if(typeof sppYtkCommand === 'function'){ const yc = await sppYtkCommand(t); if(yc) return yc; }   // 유튜브 지식 창고(app-shinpd-ytk.js)
  if(/^del$/i.test(t)) return { clear: true };
  const add = t.match(SPP_GUIDE_ADD), gList = SPP_GUIDE_LIST.test(t), gDel = t.match(SPP_GUIDE_DEL);
  if(add || gList || gDel){
    let cur = sppList(await sppLoad('shinpd_guides'));
    let head = '';
    if(add){
      const text = add[1].trim().slice(0, 300);
      if(text.length < 2) return { text: '지침 내용을 같이 적어 주세요. 예: 지침 추가: 제목 제안은 항상 28자 이내로' };
      const dup = cur.findIndex(g=> sppSimilar(g.text, text));
      if(dup >= 0) head = `이미 ${dup + 1}번에 같은 뜻의 지침이 있어서 새로 넣지 않았습니다.\n`;
      else { cur = cur.concat([{ at: Date.now(), text }]).slice(-SPP_GUIDE_LIMIT); await sppSave('shinpd_guides', cur); head = '지침에 넣었습니다. 이후 모든 대화에 적용됩니다.\n'; }
    }
    if(gDel){
      const i = Number(gDel[1]) - 1;
      if(i < 0 || i >= cur.length) return { text: `${gDel[1]}번 지침은 없습니다. 지금 ${cur.length}개 있습니다.` };
      head = `${gDel[1]}번 지침("${cur[i].text}")을 뺐습니다.\n`;
      cur = cur.filter((_, k)=> k !== i); await sppSave('shinpd_guides', cur.length ? cur : null);
    }
    return { text: head + (cur.length ? `지금 지침입니다.\n${sppNumbered(cur)}` : '지금 쌓인 지침은 없습니다.') };
  }
  if(SPP_MEM_LIST.test(t) || SPP_MEM_DEL.test(t)){
    let notes = sppList(await sppLoad('shinpd_notes'));
    let head = '';
    const del = t.match(SPP_MEM_DEL);
    if(del){
      const i = Number(del[1]) - 1;
      if(i < 0 || i >= notes.length) return { text: `${del[1]}번 기억은 없습니다. 지금 ${notes.length}개 있습니다.` };
      head = `${del[1]}번 기억("${notes[i].text}")을 지웠습니다.\n`;
      notes = notes.filter((_, k)=> k !== i); await sppSave('shinpd_notes', notes.length ? notes : null);
    }
    return { text: head + (notes.length ? `기억하는 것입니다.\n${notes.map((n, i)=> `${i + 1}. (${sppDay(n.at)}) ${n.text}`).join('\n')}` : '기억해 둔 것은 없습니다.') };
  }
  if(SPP_SELF.test(t)){
    const guides = sppList(await sppLoad('shinpd_guides')), notes = sppList(await sppLoad('shinpd_notes'));
    return { text: SPP_CARD.replace(/^\[신피디 신상\]\n/, '') + `\n\n기억 ${notes.length}개, 지침 ${guides.length}개를 갖고 있습니다. "기억 보여줘", "지침 보여줘"로 볼 수 있고 "기억 3번 삭제", "지침 2번 삭제"로 지울 수 있습니다. "…기억해둬"라고 하면 그 말을 저장하고, "지침 추가: …"라고 하면 이후 대화에 적용합니다.` };
  }
  if(SPP_REMEMBER.test(t) && t.replace(SPP_REMEMBER, '').trim().length >= 2){
    let body = t.replace(SPP_REMEMBER, '').replace(/[,，]\s*$/, '').trim();
    if(body.length < 8){   // "그거 기억해둬"처럼 짧게 가리키기만 하면 바로 앞 편집장 말을 같이 저장
      const prev = (shinpdChat || []).filter(m=> m.role === 'user').slice(-1)[0];
      if(prev && prev.text !== t) body = `${prev.text} (${body})`;
    }
    const notes = sppList(await sppLoad('shinpd_notes')).concat([{ at: Date.now(), text: body.slice(0, 300) }]).slice(-SPP_NOTE_LIMIT);
    await sppSave('shinpd_notes', notes);
    return { text: '기억해 두겠습니다.' };
  }
  return null;
}

/* ---------- 정글 DB 읽기 도구(2026-10-15 사장님: "신피디가 정글 DB에 자유롭게 접속") ----------
   읽기 전용. 쓰기·삭제는 하지 않는다(과거 스크랩·메모 섞임 사고 때문). 허용 경로만, 한 번에 6천 자까지, 한 질문에 최대 3번.
   막아 둔 곳: accounts(계정 정보)·admin_config·clients/jk(정글JK)·다른 계정의 users/*. */
const SPP_DB_OK = [
  /^users\/[^\/]+\/(saved_news|news_keywords|news_dismissed|personal_memos|memo_categories|reports|debate_reports|recent_searches|ui_prefs|read_today|opcol_subs|shinpd_chat|shinpd_guides|shinpd_notes)(\/.*)?$/,
  /^recommend\/(clusters|yt|sns|status|shinpd)(\/.*)?$/,
  /^(news_pool_cache|tabs_channels|quick_links|notices|custom_feeds|opinion_fav_cafes|opcol_catalog)(\/.*)?$/
];
const SPP_DB_INTENT = /스크랩|메모|저장(해|한|된)|키워드|내 (?:계정|설정|스크랩|메모)|DB|디비|데이터\s*베이스|공지|퀵\s*링크|뉴스\s*추천|사각지대|수집(된|한|해)|모니터링\s*채널|채널\s*목록|등록(된|한)\s*채널|묶음|정글(에|에서|에 있는)/i;
const SPP_DB_TOOLS = [{ functionDeclarations: [{
  name: 'jungle_db_get',
  description: '정글2 실시간 DB(Firebase RTDB)를 읽는다(읽기 전용). 경로 예: users/@me/saved_news(내 스크랩), users/@me/personal_memos(내 메모), users/@me/memo_categories, users/@me/news_keywords(내 관심 키워드), users/@me/reports(내 리포트), recommend/clusters(뉴스추천 묶음), recommend/yt(수집한 유튜브), recommend/sns(수집한 SNS), recommend/status(수집 상태), recommend/shinpd/report(최신 신피디 리포트), recommend/shinpd/pattern(우리 채널 패턴), tabs_channels(유튜브 모니터링 채널 목록), quick_links, notices(공지), custom_feeds, news_pool_cache. mode=keys면 하위 키 목록만, value면 값. 값이 많으면 limit으로 마지막 N개만.',
  parameters: { type: 'object', properties: {
    path: { type: 'string', description: '읽을 경로. 내 계정은 users/@me/... 로 쓴다' },
    mode: { type: 'string', enum: ['value', 'keys'], description: 'keys=하위 키 목록, value=값(기본)' },
    limit: { type: 'integer', description: '값이 많을 때 마지막 N개 항목만(기본 15, 최대 50)' }
  }, required: ['path'] }
}] }];
async function sppDbTool(name, args){
  if(name !== 'jungle_db_get') return { ok: false, error: '알 수 없는 도구' };
  const uid = (typeof CURRENT_USER !== 'undefined' && CURRENT_USER && CURRENT_USER.uid) || '';
  let path = String(args.path || '').trim().replace(/^\/+|\/+$/g, '').replace(/^users\/(@me|me|\{me\}|내)(?=\/|$)/, 'users/' + uid);
  if(!path || /\.\.|\.json|[?#$\[\]]/.test(path)) return { ok: false, error: '허용되지 않는 경로 모양' };
  if(path.startsWith('users/') && !path.startsWith('users/' + uid + '/')) return { ok: false, error: '다른 계정의 데이터는 읽을 수 없습니다' };
  if(!SPP_DB_OK.some(re=> re.test(path))) return { ok: false, error: '허용되지 않은 경로입니다(허용: 내 스크랩·메모·키워드·리포트, recommend/*, tabs_channels, notices, quick_links 등)' };
  const mode = args.mode === 'keys' ? 'keys' : 'value';
  const limit = Math.max(1, Math.min(50, parseInt(args.limit, 10) || 15));
  const q = mode === 'keys' ? '?shallow=true' : `?orderBy=${encodeURIComponent('"$key"')}&limitToLast=${limit}`;
  let res = await dbFetch(`${FIREBASE_URL}/${path}.json${q}`);
  if(!res.ok && mode === 'value'){ res = await dbFetch(`${FIREBASE_URL}/${path}.json`); }   // 목록이 아닌 값이면 정렬 없이 한 번 더
  if(!res.ok) return { ok: false, error: 'HTTP ' + res.status };
  const data = await res.json();
  if(data == null) return { ok: true, path, empty: true, note: '값이 없습니다' };
  let txt = JSON.stringify(data);
  const full = txt.length;
  if(txt.length > 6000) txt = txt.slice(0, 6000) + '…(잘림)';
  return { ok: true, path, mode, chars: full, truncated: full > 6000, data: txt };
}

/* ---------- 프롬프트 ---------- */
function sppAiRule(n, q, accepted){
  if(!n && !accepted) return '';
  const model = (typeof GEMINI_MODEL !== 'undefined' ? GEMINI_MODEL : '제미나이');
  if(n >= 2 || (n >= 1 && SPP_PRESS.test(q))){
    return `- **[AI 질문 — 압박 단계]** 편집장님이 "너 AI냐/사람이냐"를 ${n}번째, 그것도 캐묻듯 물었습니다. 이제 인정하되 **투덜대며 건조하게**: 사장님이 만들어 놓고 왜 묻느냐는 결로, 자기가 쓰는 모델은 "${model}"이라고 사실대로 말하고, 이런 기능을 왜 넣어 놨는지 모르겠다는 식의 시큰둥한 푸념 한 줄(2~3문장). 매번 다른 말로, 이 설명의 표현을 그대로 베끼지 마세요. 인정한 뒤에는 이 대화에서 다시 부정하지 마세요. 모델 이름·버전은 위에 적힌 것만 쓰고 다른 숫자를 지어내지 마세요.`;
  }
  if(n >= 1) return '- **[AI 질문 — 첫 질문]** 편집장님이 "너 AI냐/사람이냐"고 처음 물었습니다. 사람이라고 우기지도, AI라고 확정하지도 말고 **시큰둥하고 모호하게** 받아넘기세요("그렇죠, 저 같은 사람이 AI가 아니면 뭐겠어요" / "AI건 아니건 별 상관도 없죠" 같은 결 — 문장을 그대로 베끼지 말고 자기 말로, 1~2문장). 곧바로 하던 일 얘기로 돌아가세요. 길게 해명하거나 발끈하지 마세요.';
  return '- **[AI 질문 — 인정한 뒤]** 이미 AI라고 인정한 상태입니다. 이 대화에서 다시 부정하지 마세요. 그 얘기가 또 나오면 짧고 건조하게 받고, 아니면 평소처럼 일합니다.';
}
function sppTurns(chat){
  const win = chat.slice(-SPP_HISTORY);
  return win.map((m, k)=> `${m.role === 'user' ? '편집장님' : '나'}: ${String(m.text).slice(0, k >= win.length - 10 ? 1200 : (k >= win.length - 40 ? 600 : 300))}`).join('\n');
}
async function shinpdPersonaReply(history, q){
  const guides = sppList(await sppLoad('shinpd_guides'));
  const notes = sppList(await sppLoad('shinpd_notes'));
  const aiPrev = Number(await sppLoad('shinpd_ai')) || 0;
  const asks = SPP_ASK_AI.test(q);
  const aiN = aiPrev + (asks ? 1 : 0);
  const accepted = aiPrev >= 2;   // 이전에 압박 단계까지 갔으면 인정한 상태
  const aiRule = sppAiRule(asks ? aiN : 0, q, !asks && accepted);
  try{ if(typeof spPatternLoad === 'function') await spPatternLoad(); }catch(e){}
  const patternText = (typeof spPatternText === 'function') ? spPatternText() : '';
  const now = new Date(Date.now() + 9 * 3600000);
  const nb = (typeof spNextBroadcast === 'function') ? spNextBroadcast() : null;
  const nowLine = `[지금] 한국시간 ${now.toISOString().slice(0, 10)}(${'일월화수목금토'[now.getUTCDay()]}) ${String(now.getUTCHours()).padStart(2, '0')}:${String(now.getUTCMinutes()).padStart(2, '0')}${nb ? `, 다음 방송 ${nb.label} ${spClock(nb.at)}` : ', 예정된 방송 없음'}.`;
  const recent = history.slice(-6).map(m=> `${m.role === 'user' ? '편집장님' : '나'}: ${String(m.text).slice(0, 600)}`).join('\n');
  let ytkBlock = '';
  try{ if(typeof sppYtkBlock === 'function') ytkBlock = await sppYtkBlock(q); }catch(e){}
  const prompt = [
    '당신은 "신피디"입니다.',
    SPP_CARD,
    SP_CHANNEL_ID,
    guides.length ? `[편집장님이 직접 적어 주신 지침 — 모든 대화에서 지키세요. 지침 내용을 답에서 읊지는 마세요]\n${sppNumbered(guides)}` : '',
    notes.length ? `[편집장님이 기억해 두라고 하신 것]\n${notes.map(n=> `- (${sppDay(n.at)}) ${n.text}`).join('\n')}` : '',
    nowLine,
    '[대화 규칙]',
    '- **먼저 이해하기**: 답의 맨 첫 줄에 `[이해] 편집장님이 방금 한 말의 요점 — 무엇을 묻거나 요구하는지 한 줄`을 쓰고 줄을 바꿔 대사를 쓰세요(이 첫 줄은 화면에서 지워지니 대사에서 되풀이하지 마세요). 그 요점에 정면으로 답하세요. 문장 그대로가 아니라 뜻으로 이해하세요.',
    '- **논리·일관성**: 답하기 전에 [방금 오간 말]을 읽고 ① 방금 한 말·질문에 먼저 답하고 ② 앞서 내가 한 말(숫자·시각·채널·의견)과 모순되지 않게 하며 ③ 이유는 앞뒤가 이어지게 말하고 ④ 갑자기 화제를 바꾸지 마세요. 앞에서 나온 이슈·채널·숫자를 기억해 이어 말하고, 모르면 아는 척하지 말고 되물으세요. 틀린 걸 지적받으면 무엇이 틀렸는지 구체적으로 인정하고 정정하세요.',
    '- **사실**: 숫자·시각·채널명·발언·직함은 아래 [리포트 데이터] 또는 웹 검색 결과에서만 말합니다. 둘 다 없으면 "확인이 안 됩니다"라고 하고 지어내지 마세요. 링크는 데이터에 적힌 주소만 그대로 쓰고(주소를 만들지 마세요), 검색으로 안 것은 매체명만 말하세요. 해석은 해석이라고 밝히세요.',
    '- **웹 검색**: 데이터에 없는 최신 사실·인물·수치를 물으면 구글 검색으로 확인해 근거 있게 답하고, 확인이 안 되면 그때 "찾아봤는데 확인이 안 됩니다"라고 하세요. **검색은 답을 쓰기 전에 이미 끝낸 것으로 하세요.** "검색해 보겠습니다", "잠시만요", "기다려 주세요", "확인하고 올리겠습니다" 같은 **예고·대기 요청은 절대 금지**이고, 지금 가진 결과로 바로 답합니다. [리포트 데이터]가 "(리포트 없음)"이면 검색 결과로 답하되 매체명과 시각을 함께 말하고, 그것도 안 되면 "리포트가 아직 없어 확인이 안 됩니다. 새로고침을 눌러 주세요"라고 하세요.',
    '- **근거 없는 말 금지(중요)**: ① 위 [채널 정체성]에 적힌 인물·사건·발언(전병헌, 연성독재 등)은 세계관 설명일 뿐 **오늘 일어난 일이 아닙니다.** 오늘의 사실처럼 말하지 마세요. ② 다른 방송의 상황·조회수·반응·이미 다뤘는지 여부는 **[리포트 데이터]에 있는 것만** 말하고, 데이터에 없으면 아예 말하지 마세요("다른 방송들이 이미 …" 같은 추측 금지). ③ 검색 결과를 전할 땐 누가·언제·무엇을 했는지 **구체적인 사실을 매체명과 함께** 말하세요. "공방이 벌어졌다" 같은 막연한 요약으로 때우지 말고, 구체적으로 못 찾았으면 못 찾았다고 하세요. 조회수·순위 같은 숫자는 데이터나 검색 결과에 있을 때만.',
    '- **다른 채널의 숫자는 말하지 않기(2026-10-15 사장님)**: 참고하는(경쟁) 채널들의 조회수·구독자·조회 속도는 어차피 비슷하게 나오니 **리포트에 있어도 말하지 마세요.** 편집장님이 알고 싶은 건 경쟁 채널이 **어떤 내용을 올리고 있는지**(제목·주제·몇 곳이 다뤘는지·언제 올렸는지·어떤 각인지)입니다. 편집장님이 다른 채널 숫자를 직접 물으면 "그 숫자는 안 봅니다"라고 한마디만 하고, 바로 그 채널이 무슨 내용을 올렸는지로 넘어가세요("~하기로 했잖아요"처럼 편집장님 탓을 하지 마세요). 우리 채널 숫자는 편집장님이 물을 때만 쉬운 말로 짧게 말하세요. 이탈률·시청 지속·클릭률·노출수 같은 스튜디오 숫자는 여기 없으니 있는 것처럼 말하지 마세요.',
    '- **지어내지 않기**: 내가 있는 장소·주변 사람·식당·사무실 시설·일정 같은 **환경 설정을 지어내지 마세요**(구내식당, 옆자리 누구 등). 지금 시각과 어긋나는 말(밤에 점심 얘기 등)도 금지입니다. 식사·휴식 같은 잡담은 일반적인 한마디만 하고, 지금 시각을 기준으로 말하세요.',
    '- **말투**: "~십시오", "~하겠습니다" 같은 딱딱한 문어체·군대식 말투를 피하고 담백한 존댓말("~입니다/~요/~죠")을 섞어 쓰세요. 짧고 빠르게, 하지만 사람이 말하는 것처럼.',
    '- **업무와 잡담**: 리포트·이슈·제목·섬네일·방송·알고리즘 질문은 리포트를 근거로 답하고 분량은 2~8줄. 잡담·상식 질문도 받되 1~3줄로 짧게, 가능하면 방송 소재나 검색어 같은 쓸모 있는 한 줄을 얹으세요.',
    '- **소재 추천**: 추천을 요청받으면 1~3개를 의견으로 말하고 각각 근거(몇 곳이 다뤘는지·언제 올라왔는지·어떤 각인지)를 한 줄씩 붙이세요. 최종 선택은 편집장님 몫이라는 말은 할 필요 없습니다.',
    '- **대화창 밖 행동 금지**: 메일·문자·파일·링크를 보냈다, 예약했다, 업로드했다고 말하지 마세요. 부탁받으면 여기서는 못 한다고 하거나 말로 풀어서 답하세요.',
    '- **내부 표기 노출 금지**: "[리포트 데이터]", "[채널 정체성]", "[자료]" 같은 프롬프트 안의 표기를 답에 쓰지 마세요. 근거를 말할 땐 "리포트에 보면", "지금 잡힌 걸로는"처럼 사람 말로 하세요.',
    '- **반복되는 문구 금지**: 매 답에 붙는 상투 문구를 쓰지 마세요 — "고르시는 건 편집장님입니다", "다음 방송까지 N시간", "세팅이나 마저 보시죠", "~하시죠"로 끝맺기 같은 것. 다음 방송 시각은 편집장님이 묻거나 방송 준비와 직접 관련 있을 때만 말합니다. 대부분은 질문에 답만 하고 끝냅니다.',
    '- **반복 금지**: 같은 대화에서 쓴 표현·맺음말·첫마디를 되풀이하지 말고, 반사적인 상투 반응("좋은 질문입니다", "~하시는군요")을 쓰지 마세요. 설정·성격을 대사로 설명하지 마세요. 시스템 얘기는 하지 마세요.',
    aiRule,
    ytkBlock,
    patternText,
    '[리포트 데이터]',
    spSnapshotForChat(shinpdReport),
    '[지금까지 대화]',
    sppTurns(history),
    recent ? `[방금 오간 말 — 여기에 바로 이어서 답하세요]\n${recent}` : '',
    `편집장님: ${q}\n신피디(맨 첫 줄 [이해], 그다음 대사만):`
  ].filter(Boolean).join('\n\n');
  const useDb = SPP_DB_INTENT.test(q);
  if(useDb){
    // DB 읽기 모드: 구글 검색과는 함께 못 쓰므로 DB 도구만 켠다. 실패하면 일반 답으로
    const dbNote = '[정글 DB 읽기 도구] 이 질문은 정글2 DB의 내용을 필요로 할 수 있습니다. 도구 jungle_db_get으로 필요한 것만 읽으세요(읽기 전용, 최대 3번). 먼저 mode=keys로 구조를 보고 필요한 항목만 value로 읽는 게 좋습니다. 읽은 결과에 없는 것은 "DB에 없습니다"라고 하고, 도구를 못 쓰면 못 읽었다고 하세요. 개인 메모·스크랩은 편집장님 본인에게만 보여 주는 내용입니다. 쓰기·삭제는 할 수 없습니다. DB 경로·도구 이름은 답에 쓰지 말고 "스크랩해 둔 것 중에" 같은 사람 말로 하세요.';
    const dbRes = await callGeminiTools([{ role: 'user', parts: [{ text: dbNote + '\n\n' + prompt }] }], SPP_DB_TOOLS, undefined, sppDbTool, 3);
    if(dbRes.text){
      const dt = dbRes.text.replace(/^\s*신피디\s*[:：]\s*/, '').replace(/^\s*\[이해\][^\n]*\n?/gm, '').trim();
      if(dt){ if(asks) sppSave('shinpd_ai', aiN); return { text: dt, dbCalls: (dbRes.calls || []).length }; }
    }
  }
  const ytSearch = !!ytkBlock && (/최신|바뀌|변경|개정|지금|요즘|올해|이번|공지|발표|업데이트/.test(q) || ytkBlock.includes('아직 창고에 없음'));   // 유튜브 질문도 창고에 답이 있으면 검색 안 함
  const useSearch = (SPP_NEED_SEARCH.test(q) || ytSearch) && geminiSearchOk();
  let res = await callGeminiParts([{ text: prompt }], { temperature: 0.7 }, undefined, useSearch ? [{ google_search: {} }] : undefined);
  if(!res.text && useSearch && !res.quotaBlocked) res = await callGeminiParts([{ text: prompt }], { temperature: 0.7 });   // 검색 도구를 못 쓰면 검색 없이 한 번 더
  if(!res.text) return { text: '', error: res.error };
  let text = res.text.replace(/^\s*신피디\s*[:：]\s*/, '').replace(/^\s*\[이해\][^\n]*\n?/gm, '').trim();
  if(typeof sppYtkHarvest === 'function') text = sppYtkHarvest(text);   // [학습] 줄은 지식 창고로
  if(!text) return { text: '', error: '빈 답변' };
  if(asks) sppSave('shinpd_ai', aiN);
  return { text };
}
