// 정글2 배포 전 자동 점검: `npm run check`
//  1) 문법 검사 — JS 전부 + HTML 인라인 스크립트
//  2) 참조 검사 — index.html이 불러오는 파일이 실제로 있는지
//  3) 핵심 순수 함수 단위 테스트(app.js에서 함수 본문만 떼어 vm에서 실행)
//  4) 빌드 + dist 점검 — index.html이 가리키는 해시 파일이 dist에 있는지
// 하나라도 실패하면 종료 코드 1. 배포 전에 `npm run check && npm run deploy`.
import { readFileSync, existsSync } from 'fs';
import { execSync } from 'child_process';
import vm from 'vm';
import { transformSync } from 'esbuild';

const ROOT = process.cwd();
let failed = 0;
const ok = (m) => console.log('  ✓ ' + m);
const bad = (m) => { failed++; console.log('  ✗ ' + m); };
const read = (f) => readFileSync(`${ROOT}/${f}`, 'utf8');

// ---------- 1) 문법 ----------
console.log('[1] 문법 검사');
const APP_FILES = ['app-core.js', 'app-news-data.js', 'app-keywords.js', 'app-gemini.js', 'app-news-feed.js', 'app-opcol.js', 'app-news-view.js', 'app-scrap-peer.js', 'app-report-scrap.js', 'app-archive-memo.js', 'app-settings.js', 'app-shell.js', 'app-opinion.js', 'app-shinpd-data.js', 'app-shinpd-algo.js', 'app-shinpd-persona.js', 'app-shinpd-ytk.js', 'app-shinpd-brief.js', 'app-shinpd-issue.js', 'app-shinpd.js', 'app.js'];
const JS_FILES = [...APP_FILES, 'recommend.js', 'notice.js', 'pillnav.js', 'app-float.js', 'app-special.js', 'config.js', 'worker-rss-relay.js', 'x-analysis/worker/x-search-worker.js', 'scripts/build.mjs'];
for (const f of JS_FILES) {
  try { transformSync(read(f), { loader: 'js', format: 'esm' }); ok(f); }
  catch (e) { bad(`${f}: ${String(e.message).split('\n')[0]}`); }
}
for (const f of ['index.html', 'people.html', 'sns-tool.html', '404.html']) {
  const html = read(f);
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/g;
  let m, n = 0, err = null;
  while ((m = re.exec(html))) {
    if (/\bsrc\s*=/.test(m[1]) || !m[2].trim() || /type\s*=\s*["']?(application\/json|text\/template)/.test(m[1])) continue;
    n++;
    try { transformSync(m[2], { loader: 'js', format: /type\s*=\s*["']?module/.test(m[1]) ? 'esm' : 'iife' }); }
    catch (e) { err = String(e.message).split('\n')[0]; }
  }
  err ? bad(`${f} 인라인 스크립트: ${err}`) : ok(`${f} (인라인 스크립트 ${n}개)`);
}

// ---------- 2) 참조 ----------
console.log('[2] index.html 참조 파일');
const idx = read('index.html');
const refs = [...idx.matchAll(/<script[^>]+src="([^"]+)"/g)].map(x => x[1])
  .concat([...idx.matchAll(/<link[^>]+href="([^"]+\.css)"/g)].map(x => x[1]))
  .filter(r => !/^https?:/.test(r));
for (const r of refs) existsSync(`${ROOT}/${r}`) ? ok(r) : bad(`${r} 없음`);

// ---------- 3) 단위 테스트 ----------
console.log('[3] 핵심 함수 테스트');
const appLines = APP_FILES.map(read).join('\n').split(/\r?\n/);   // 윈도우 작업본은 CRLF일 수 있음
function pick(name) {
  const i = appLines.findIndex(l => new RegExp(`^(async\\s+)?function\\s+${name}\\b|^(const|let)\\s+${name}\\b`).test(l));
  if (i < 0) throw new Error(`app-*.js에서 ${name} 선언을 못 찾음(이름이 바뀌었나?)`);
  if (/^(async\s+)?function/.test(appLines[i])) {
    const open = (appLines[i].match(/{/g) || []).length;
    if (open > 0 && open === (appLines[i].match(/}/g) || []).length) return appLines[i];   // 한 줄짜리 함수
    let j = i; while (j < appLines.length && appLines[j] !== '}') j++;
    return appLines.slice(i, j + 1).join('\n');
  }
  if (/;\s*$/.test(appLines[i])) return appLines[i];
  let j = i + 1; while (j < appLines.length && !/^[\]}]\s*;/.test(appLines[j])) j++;
  return appLines.slice(i, j + 1).join('\n');
}
const NEED = ['ABBREV_NORMALIZE_MAP', 'normalizeAbbrev', 'KO_NUM_UNIT', 'parseKoreanNumber', 'numberToken', 'NUMERIC_EXPR_REGEX', 'normalizeNumbers',
  'JOSA_SUFFIXES', 'stripJosa', 'normalizeTitleForDedup', '_simCache', 'SIM_CACHE_MAX', '_cached', 'wordSetOf', 'bigramSetOf', 'wordSimilarity',
  'charBigrams', 'charSimilarity', 'titleSimilarity', 'PHRASE_GAP', 'phraseMatchSquashed', 'termMatchesText', 'nextBroadcastTime', '_quotaRetrySeconds', 'isDailyQuotaError', 'SPORTS_KEYWORDS', 'RELIGION_KEYWORDS', 'ENTERTAINMENT_KEYWORDS', 'FINANCE_KEYWORDS', 'HOUSING_EDU_KEYWORDS', 'TOPIC_POLITICS_VETO', 'TOPIC_STRICT_VETO', 'TOPIC_EXTRA_VETO', 'isTopicArticle', 'isSportsArticle', 'isReligionArticle', 'isEntertainmentArticle', 'isFinanceArticle', 'isHousingEduArticle', 'POLL_WORD_RX', 'POLL_STOP_WORDS', 'pollPercentSet', 'samePoll'];
const ctx = vm.createContext({});
try {
  vm.runInContext(NEED.map(pick).join('\n') + '\n;this.api={parseKoreanNumber,normalizeNumbers,stripJosa,titleSimilarity,phraseMatchSquashed,termMatchesText,nextBroadcastTime,normalizeAbbrev,samePoll,isDailyQuotaError,_quotaRetrySeconds,isSportsArticle,isReligionArticle,isEntertainmentArticle,isFinanceArticle,isHousingEduArticle};', ctx);
} catch (e) { bad('함수 추출 실패: ' + e.message); }
const A = ctx.api;
if (A) {
  const t = (name, fn) => { try { fn() ? ok(name) : bad(name); } catch (e) { bad(`${name}: ${e.message}`); } };
  t('한글 숫자 3억5천만 = 350000000', () => A.parseKoreanNumber('3억5천만') === 350000000);
  t('쉼표 숫자 1,200 = 1200', () => A.parseKoreanNumber('1,200') === 1200);
  t('숫자 아닌 글자는 null', () => A.parseKoreanNumber('가나다') === null);
  t('표기가 달라도 같은 금액은 같은 토큰(3.5억 = 350000000)', () => A.normalizeNumbers('예산 3.5억원') === A.normalizeNumbers('예산 350000000원'));
  t('복합 금액: 3억5천만원 = 3.5억 = 350000000', () => A.normalizeNumbers('예산 3억5천만원') === A.normalizeNumbers('예산 350000000원') && A.normalizeNumbers('3억 5천만원') === A.normalizeNumbers('3.5억원'));
  t('복합 금액: 1조 2천억원 = 1.2조원', () => A.normalizeNumbers('1조 2천억원') === A.normalizeNumbers('1.2조원'));
  t('숫자 두 개가 우연히 이어져도 합치지 않음(2 3억)', () => A.normalizeNumbers('오후 2 3억원') === '오후 2' + A.normalizeNumbers(' 3억원'));
  t('조사 절단: 국회에서 → 국회', () => A.stripJosa('국회에서') === '국회');
  t('조사 절단: 어간 2글자 미만이면 유지', () => A.stripJosa('나는') === '나는');
  t('약칭 통일: 국힘 → 국민의힘', () => A.normalizeAbbrev('국힘 대표') === '국민의힘 대표');
  t('약칭 통일: 더불어민주당은 중복 치환 안 함', () => A.normalizeAbbrev('더불어민주당') === '더불어민주당');
  t('같은 제목 유사도 1', () => A.titleSimilarity('여야 국회 예산안 처리 합의', '여야 국회 예산안 처리 합의') === 1);
  t('다른 사건 제목은 유사도 낮음(<0.3)', () => A.titleSimilarity('여야 국회 예산안 처리 합의', '프로야구 한국시리즈 우승 확정') < 0.3);
  t('구절 일치: 가까이 있으면 ○', () => A.phraseMatchSquashed('홍길동주말골프회동논란', ['홍길동', '골프', '회동']));
  t('구절 일치: 멀리 떨어지면 ×', () => !A.phraseMatchSquashed('홍길동' + '가'.repeat(60) + '골프' + '나'.repeat(60) + '회동', ['홍길동', '골프', '회동']));
  t('구절 일치: 한 단어가 없으면 ×', () => !A.phraseMatchSquashed('홍길동골프', ['홍길동', '골프', '회동']));
  t('구절 키워드 + 띄어쓰기 본문', () => A.termMatchesText('홍길동 골프 회동', '홍길동, 주말 골프 회동 논란'));
  t('같은 여론조사: 같은 수치(37.4%) 다른 제목 → 같은 조사', () => A.samePoll({ title: "3주 만에 다시 떨어진 李 지지율 '37.4%'" }, { title: '민생 강조했지만 DMZ 논란에…李 지지율 37.4%로 소폭 하락 [리얼미터]' }));
  t('같은 여론조사: 핵심어 2개 겹침(한동훈·1위)', () => A.samePoll({ title: '[티조챗] "차기 대통령감? 한동훈 1위" 지지율 오른다' }, { title: '김재원 "한동훈 지지율 1위? 이낙연도 1위 달렸지만"' }));
  t('다른 여론조사는 안 묶음(이재명 vs 한동훈)', () => !A.samePoll({ title: '李 지지율 37.4% 하락' }, { title: '한동훈 지지율 18.7% 1위' }));
  t('여론조사 아닌 기사는 안 묶음', () => !A.samePoll({ title: '국감 조희대 출석 37.4%' }, { title: '농지 전수조사 37.4% 감소' }));
  t('스포츠 배제: 손흥민 A매치 기사', () => A.isSportsArticle({ title: '용인미르스타디움서 손흥민 A매치 최다골 신기록' }));
  t('스포츠 배제: 경기장 홍보 기사', () => A.isSportsArticle({ title: '용인미르스타디움, 국제대회 치를 수 있는 역량 또 다시 증명' }));
  t('스포츠 통과: 축구대표팀 군면제 정치 논란', () => !A.isSportsArticle({ title: '"군대 안가" 자랑한 축구대표팀에…안철수 "군면제 가당찮다"' }));
  t('스포츠 통과: 일반 정치 기사', () => !A.isSportsArticle({ title: '김민석 "조희대, 떳떳하지 못하면 스스로 물러나는 것이 도리"' }));
  t('종교 배제: 교회 행사 기사', () => A.isReligionArticle({ title: '서울 대형교회 목사, 성탄절 예배서 새 건축 계획 발표' }));
  t('종교 통과: 통일교 정치자금 수사', () => !A.isReligionArticle({ title: '통일교 한학자 총재 소환…민주당 의원 금품 수수 의혹 수사' }));
  t('종교 통과: 3기 신도시(신도·선교 오탐 방지)', () => !A.isReligionArticle({ title: "3기신도시 '선교통·후입주' 약속 불발?" }));
  t('연예 배제: 아이돌 컴백', () => A.isEntertainmentArticle({ title: '인기 걸그룹 컴백…신곡 뮤직비디오 공개' }));
  t('연예 통과: 영화 논란에 정치권', () => !A.isEntertainmentArticle({ title: "국힘 영화 '암살자(들)' 비판에 유해진 배우 힘내라" }));
  t('증시 배제: 코스피 시황', () => A.isFinanceArticle({ title: '코스피 3,000선 회복…외국인 순매수 확대' }));
  t('증시 통과: 금융 정책 기사', () => !A.isFinanceArticle({ title: '금융위, 가상자산 규제 강화…비트코인 ETF 허용 논의' }));
  t('부동산 배제: 분양 소식', () => A.isHousingEduArticle({ title: '수도권 아파트 분양 청약 경쟁률 급등' }));
  t('부동산 통과: 정책 기사', () => !A.isHousingEduArticle({ title: '정부, 전세 대책 발표…공급 확대·규제 완화' }));
  const QUOTA_MSG = 'You exceeded your current quota, please check your plan and billing details. * Quota exceeded for metric: generativelanguage.googleapis.com/generate_content_free_tier_requests, limit: 500, model: gemini-3.5-flash-lite Please retry in 19h38m33.200265961s.';
  t('Gemini 대기시간 파싱: 19h38m33.2s', () => Math.round(A._quotaRetrySeconds(QUOTA_MSG)) === 19 * 3600 + 38 * 60 + 33);
  t('Gemini 하루 한도 소진 감지', () => A.isDailyQuotaError(QUOTA_MSG));
  t('Gemini 분당 한도(retry in 16.3s)는 하루 한도가 아님', () => !A.isDailyQuotaError('You exceeded your current quota. Please retry in 16.3s.'));
  t('Gemini 일반 오류는 한도 소진이 아님', () => !A.isDailyQuotaError('User location is not supported for the API use.'));
  t('방송 카운트다운: 금요일 휴방 + 주말 → 다음 월요일', () => {
    const next = A.nextBroadcastTime({ hour: 19, minute: 0, skipWeekdays: [5] }, new Date(2026, 9, 8, 20, 0, 0));   // 목 20시
    return next.getDay() === 1 && next.getDate() === 12 && next.getHours() === 19;
  });
}

// ---------- 4) 빌드 ----------
console.log('[4] 빌드 + dist 점검');
try {
  execSync('node scripts/build.mjs', { cwd: ROOT, stdio: 'pipe' });
  const di = readFileSync(`${ROOT}/dist/index.html`, 'utf8');
  const drefs = [...di.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(x => x[1]).filter(r => !/^https?:/.test(r));
  if (!drefs.length) bad('dist/index.html에 스크립트 참조가 없음');
  for (const r of drefs) existsSync(`${ROOT}/dist/${r}`) ? ok('dist/' + r) : bad(`dist/${r} 없음`);
  for (const f of ['people.html', 'sns-tool.html']) existsSync(`${ROOT}/dist/${f}`) ? ok('dist/' + f) : bad(`dist/${f} 없음`);
} catch (e) { bad('빌드 실패: ' + String(e.stderr || e.message).split('\n')[0]); }

console.log(failed ? `\n✗ 실패 ${failed}건 — 배포하지 마세요.` : '\n✓ 모두 통과');
process.exit(failed ? 1 : 0);
