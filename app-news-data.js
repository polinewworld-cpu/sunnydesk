/* 뉴스 수집·읽음·유사도(중복 판정)·슬라이더·화면 설정 동기화
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ================= 정치뉴스 기능 ================= */

const RSS_FEEDS = [
  ...JUNGLE_CONFIG.rssFeeds.national,
  ...JUNGLE_CONFIG.rssFeeds.local
];

/* ↓↓ 관리자 [알고리즘] 탭에서 덮어쓸 수 있는 값들은 let. 초기값 = 기본값 스냅샷 소스. ↓↓ */
let PRIORITY_SOURCES = new Set(['조선일보','동아일보','매일신문']);

let PR_EXCLUDE_KEYWORDS = ['업무협약','MOU','체결식','기념식','축제','출범식','위촉장','위촉',
  '임명장','표창','수상식','착공식','준공식','개소식','개관식','홍보관','박람회','설명회','간담회',
  '캠페인','홍보대사','전달식','시상식','품평회','시식회','견학','기공식','발대식','후원식','협약식',
  '감사패','공모전','일자리박람회','채용박람회',
  '구독자','돌파','골드버튼','실버버튼','누적 조회수'];

let PROTOCOL_EXCLUDE_KEYWORDS = ['접견','예방','환담','기념촬영','환영식','환송식','영접',
  '국빈','친서','오찬','만찬','다과','환영 만찬','타운홀'];

let WEATHER_EXCLUDE_KEYWORDS = ['날씨','기온','미세먼지','장마','폭염','한파','태풍','강수','황사'];

/* 관리자 [알고리즘] 탭 튜닝값 (기타). /admin_config 로드 시 applyAdminConfig가 덮어씀 */
let YT_PER_CHANNEL = 6;          // 채널당 표시 영상 수
let YT_SHORT_MAX_SEC = 180;      // 이보다 짧으면 쇼츠로 보고 제외
let CLUSTER_TAG_BONUS = 0.5;     // [단독]/[속보] 포함 클러스터 정렬 가산(건 수 환산)
let COOLDOWN_MS = JUNGLE_CONFIG.refreshIntervalMs;  // 수동 갱신 최소 간격
let RELEVANCE_USE_BODY = true;   // 관련성 적중 판정에 본문 포함 여부
/* 형식 잡음 필터 14종 on/off */
let FILTER_ON = {
  prRelease: true, protocol: true, weather: true, localGov: true, photo: true,
  progressiveOpinion: true, membership: true, productPr: true, simpleAccident: true,
  obituary: true, personnel: true, kids: true, lifeInfo: true,
  sports: true, religion: true, entertainment: true, finance: true, housingEdu: true,
};

function isPrRelease(article){
  const text = article.title + ' ' + (article.excerpt||'');
  return (FILTER_ON.prRelease && PR_EXCLUDE_KEYWORDS.some(kw => text.includes(kw)))
    || (FILTER_ON.protocol && PROTOCOL_EXCLUDE_KEYWORDS.some(kw => text.includes(kw)))
    || (FILTER_ON.weather  && WEATHER_EXCLUDE_KEYWORDS.some(kw => text.includes(kw)));
}

const LOCAL_GOV_TITLE_START = /^\S{2,6}(시|군|구|도|특별자치시|특별자치도)\s*,/;
let LOCAL_COUNCIL_KEYWORDS = ['시의회','구의회','군의회','도의회','광역의회','기초의회','의회 의장'];
const LOCAL_CHIEF_TITLE = /(시장|군수|구청장|도지사|교육감|시의원|구의원|군의원|도의원)/;
const LOCAL_CHIEF_PROMO_PHRASE = /(행보|현안사업|총력|박차|드라이브|전방위|속도|힘쏟|앞장|매진|주력|행정력)/;

function isLocalGovArticle(article){
  const title = article.title || '';
  if(LOCAL_GOV_TITLE_START.test(title)) return true;
  if(LOCAL_COUNCIL_KEYWORDS.some(kw => title.includes(kw))) return true;
  if(LOCAL_CHIEF_TITLE.test(title) && LOCAL_CHIEF_PROMO_PHRASE.test(title)) return true;
  return false;
}

/* 사진 기사 — 사진+캡션만 있고 본문이 없는 기사는 전부 배제.
   ① 제목에 포토/사진/화보/영상 태그(대괄호·꺾쇠·괄호 어디든)  ② 제목이 그 단어로 시작/끝
   ③ 통신사 사진 전용 URL 코드  ④ 본문이 사실상 비어 있음(캡션 수준) */
const PHOTO_ARTICLE_TAG = /[\[(【〈《][^\])】〉》]*(포토|사진|화보|영상|movie|photo)[^\])】〉》]*[\])】〉》]/i;
function isWirePhotoUrl(link){
  const l = String(link || '');
  return /\/view\/(PYH|GYH|PCM|PEP|PAP|AJP|PIC|PYW)\d/.test(l)   // 연합뉴스 사진
      || /\/NISI\d{6,}/.test(l)                                   // 뉴시스 사진(NISI). 텍스트는 NISX
      || /(\/photo\/|\/photos\/|\/gallery\/|photoView)/i.test(l); // 일반 사진 뷰어 경로
}
function isPhotoArticle(article){
  const t = (article.title || '').trim();
  if(PHOTO_ARTICLE_TAG.test(t)) return true;
  if(/^(포토|화보|사진)[\s:·ㅣ|＋+]/.test(t) || /[\s·ㅣ|](포토|화보)\s*[+＋]?$/.test(t)) return true;
  if(isWirePhotoUrl(article.link)) return true;
  const body = String(article.fullText || article.excerpt || '').replace(/<[^>]+>/g, '').trim();
  if(body && body.length < 25 && /(포토|사진|photo)/i.test(t)) return true;
  return false;
}

/* 인사 기사 — 리스트형 인사 발령("[인사] ○○부", "◇인사◇", "△△은행 인사", "교육부 1급 인사 단행").
   개각·장관 인사·청와대 참모 교체 등 정치성 인사는 제외하지 않는다. 인사청문회도 당연히 살림. */
function isPersonnelNoticeArticle(article){
  const t = (article.title || '').trim();
  if(/^[\s]*(\[\s*인사\s*\]|[◇◆△▲■□]\s*인사|【\s*인사\s*】|「인사」|<인사>|인사\s*[·:])/.test(t)) return true;
  if(/개각|입각|장관\s*(지명|후보|인선)|차관\s*지명|대통령|청와대|대통령실|비서관|수석/.test(t)) return false;
  if(/^.{0,18}\s인사$/.test(t)) return true;
  return /(임원 인사|정기 인사|수시 인사|승진 인사|전보 인사|인사 발령|인사이동|인사 단행|간부 인사|고위 인사|국장급 인사|과장급 인사|[0-9]급 인사)/.test(t);
}

/* 어린이 기사 — 어린이신문·어린이 기자단 등 어린이용 콘텐츠. 어린이 정책·어린이날 행사 기사는 제외 안 함 */
let KIDS_KEYWORDS = ['어린이 기자','어린이신문','어린이동아','어린이조선','소년한국','주니어 뉴스','키즈 뉴스','눈높이 뉴스'];
function isKidsArticle(article){
  const t = (article.title || '').trim();
  if(/^\s*\[\s*(어린이|주니어|키즈|NIE)\s*\]/.test(t)) return true;
  return KIDS_KEYWORDS.some(kw => t.includes(kw));
}

/* 주제 배제 필터 5종 — 스포츠·종교·연예·증시/재테크·부동산/입시 (2026-10-06 사장님 지시, 정글2의 금기).
   실시간 탭은 네이버 "정치섹션"만 읽어 이런 기사가 구조적으로 거의 안 들어오지만, 관심 키워드 검색 결과(풀의 약 90%)와
   추천·키워드 탭에는 섞여 들어온다. 규칙: 제목에 그 분야 단어가 있고 정치 단어(TOPIC_POLITICS_VETO)는 없을 때만 배제 —
   "축구대표팀 군면제 논란 안철수 발언" 같은 정치 기사는 통과. 분야별 추가 통과 단어(경제·부동산 정책 등)는 TOPIC_EXTRA_VETO.
   분야 단어는 알고리즘 탭에서 편집, 정치·통과 단어는 코드 고정. */
let SPORTS_KEYWORDS = ['손흥민','이강인','김민재','황희찬','류현진','오타니','프로야구','KBO','K리그','EPL','MLB','NBA','KBL','WKBL','월드컵','올림픽','패럴림픽','아시안게임','A매치','스타디움','축구','야구','농구','프로배구','V리그','여자배구','남자배구','금메달','은메달','동메달','챔피언십','홈런','선발투수','역전승','역전패','무승부'];
let RELIGION_KEYWORDS = ['교회','목사','성당','천주교','가톨릭','불교','스님','사찰','조계종','기독교','개신교','신앙','예배','법회','종교','성탄절','부활절','부처님오신날','석가탄신일','교황','선교사','통일교','신천지'];
let ENTERTAINMENT_KEYWORDS = ['여배우','남배우','영화배우','탤런트','K팝','트로트','신곡','싱어송라이터','아이돌','드라마','예능','영화제','개봉','열애','결혼설','이혼설','걸그룹','보이그룹','콘서트','팬미팅','BTS','블랙핑크','뮤직비디오','넷플릭스','앨범','연예인','연예계'];
let FINANCE_KEYWORDS = ['코스피','코스닥','주가','환율','비트코인','가상자산','ETF','증시','공모주','펀드','배당금','배당락','시가총액','선물옵션'];
let HOUSING_EDU_KEYWORDS = ['분양','청약','아파트값','전세','월세','재건축','재개발','집값','수능','입시','대입','학원','사교육','논술','수시 합격'];
const TOPIC_POLITICS_VETO = /(대통령|총리|장관|국회|국감|국정|여당|야당|여야|與|野|더불어민주당|민주당|국민의힘|국힘|조국혁신당|개혁신당|정당|정부|청와대|대통령실|의원|의장|지도부|정권|특검|검찰|수사|재판|판결|탄핵|청문회|병역|군면제|군 면제|군대|군인|면제|특례|국방|입법|법안|선거|후보|공천|지사|시장|문체부|체육회|예산|파장|BTS|개편|재고|李|韓|尹)/;
/* 종교·연예·증시·부동산/입시는 "정치 기사를 잘못 빼는 것"이 "스포츠 하나를 못 빼는 것"보다 나쁘므로 통과 조건을 더 엄격하게 둔다:
   따옴표 인용(정치인·공직자 발언 기사의 특징)·정치·여론·북한·주요 정치인 이름·"대표/위원장"·증인·논란/의혹이 제목에 있으면 통과. 스포츠에는 적용 안 함(국가대표 때문). */
const TOPIC_STRICT_VETO = /(["“”‘’]|정치|여론|지지율|北|북한|김정은|김여정|미사일|국방|(?<!국가)대표|위원장|최고위|이재명|한동훈|장동혁|정청래|조국|이준석|안철수|김민석|유승민|오세훈|박지원|증인|질타|추궁|논란|의혹)/;
const TOPIC_EXTRA_VETO = {
  entertainment: /(검열|상영 철회|서한|고발|고소|법적 책임|국정원|블랙리스트|보혁|극우|극좌|우파|좌파|진보|보수|후폭풍|불똥)/,
  finance: /(금융당국|금융위|금감원|기재부|기획재정부|한국은행|한은|정책|세제|세금|규제|관세|대미투자|투자협정|부양책|경제 대책)/,
  housingEdu: /(정책|대책|규제|세제|공급|국토부|국토교통부|LH|종부세|양도세|교육부|교육감|교육청|특혜|의혹|비리)/,
};
function isTopicArticle(article, words, extraVeto, strict){
  const t = (article.title || '').trim();
  if(!t || !words.some(kw => t.includes(kw))) return false;
  if(TOPIC_POLITICS_VETO.test(t)) return false;
  if(strict && TOPIC_STRICT_VETO.test(t)) return false;
  return !(extraVeto && extraVeto.test(t));
}
function isSportsArticle(a){ return isTopicArticle(a, SPORTS_KEYWORDS); }
function isReligionArticle(a){ return isTopicArticle(a, RELIGION_KEYWORDS, null, true); }
function isEntertainmentArticle(a){ return isTopicArticle(a, ENTERTAINMENT_KEYWORDS, TOPIC_EXTRA_VETO.entertainment, true); }
function isFinanceArticle(a){ return isTopicArticle(a, FINANCE_KEYWORDS, TOPIC_EXTRA_VETO.finance, true); }
function isHousingEduArticle(a){ return isTopicArticle(a, HOUSING_EDU_KEYWORDS, TOPIC_EXTRA_VETO.housingEdu, true); }

const OPINION_ARTICLE_TAG = /^\s*\[[^\]]*(사설|칼럼|기고|시론)[^\]]*\]/;
let PROGRESSIVE_OPINION_OUTLETS = new Set(['한겨레','오마이뉴스','경향신문']);
function isProgressiveOpinion(article){
  return PROGRESSIVE_OPINION_OUTLETS.has(article.source) && OPINION_ARTICLE_TAG.test(article.title || '');
}

const MEMBERSHIP_ARTICLE_TAG = /^\s*\[[^\]]*(멤버십|유료\s*구독|유료\s*콘텐츠)[^\]]*\]/;
function isMembershipArticle(article){
  const src = article.source || '';
  if(!(src.startsWith('조선일보') || src.startsWith('중앙일보'))) return false;
  return MEMBERSHIP_ARTICLE_TAG.test(article.title || '');
}

let PRODUCT_PR_KEYWORDS = ['신제품 출시','정식 출시','단독 출시','한정판 출시','리뉴얼 출시',
  '컬래버레이션','콜라보레이션','프로모션 진행','사전예약 판매','완판 행렬','매진 행렬',
  '누적 판매량','판매량 1위','베스트셀러 1위','굿즈 출시','팝업스토어','플래그십 스토어',
  '신메뉴 출시','리미티드 에디션'];
function isProductPrArticle(article){
  const text = (article.title||'') + ' ' + (article.excerpt||'');
  return PRODUCT_PR_KEYWORDS.some(kw => text.includes(kw));
}

let SIMPLE_ACCIDENT_KEYWORDS = ['교통사고','음주운전 적발','화재 발생','아파트 화재','공장 화재',
  '건물 붕괴','추락사','익사','감전사','폭발 사고','열차 사고','지하철 고장','산불 발생',
  '등산객 조난','물놀이 사고','침수 피해'];
function isSimpleAccidentArticle(article){
  const text = (article.title||'') + ' ' + (article.excerpt||'');
  return SIMPLE_ACCIDENT_KEYWORDS.some(kw => text.includes(kw));
}

/* 부고 — [부고] 태그, 가족상(모친상 등), 장례 안내(빈소·발인·부의). 뉴스성 '별세/타계'는 살림 */
let OBITUARY_KEYWORDS = ['모친상','부친상','조모상','조부상','장인상','장모상','빙모상','빙부상',
  '시모상','시부상','자당상','부군상','부인상','부의','발인','빈소 마련','조전 접수'];
function isObituaryArticle(article){
  const title = article.title || '';
  if(/^[\s]*(\[\s*부고\s*\]|【\s*부고\s*】|◇\s*부고|부고\s*[·:])/.test(title)) return true;
  return OBITUARY_KEYWORDS.some(kw => title.includes(kw));
}

/* 운세·사주·건강정보·NIE 등 생활정보 코너 — 사회면 RSS에 섞여 들어옴.
   의료대란·의대증원·건강보험 같은 보건 정책 기사는 살린다(정치 문맥어로 구분). */
// 무조건 배제 — 운세·사주·복권·NIE. 정치와 절대 안 엮임
let LIFE_INFO_ALWAYS = ['오늘의 운세','내일의 운세','주간 운세','띠별 운세','별자리 운세','토정비결',
  '사주풀이','타로','오늘의 별자리','로또 번호','로또 1등','로또 당첨','복권 1등','복권 당첨',
  '신문은 선생님','신문 활용 교육','[NIE]','오늘의 날씨','주간 날씨'];
// 건강정보 팁 — 아래 정책 신호가 없을 때만 배제
let HEALTH_TIP_KEYWORDS = ['건강 칼럼','건강 상식','건강 Q&A','약 이야기','이런 증상','의 효능',
  '에 좋은 음식','에 좋은 운동','예방하는 법','다이어트 성공','면역력 높이','꿀잠','노화 늦추',
  '장수 비결','피부 노화','탈모 예방','치매 예방','혈압 낮추','혈당 관리','건강한 노후','디톡스','스트레칭 방법'];
const HEALTH_POLICY_HINT = /(의대\s*증원|의정\s*갈등|의료\s*대란|전공의|건강보험료|건보\s*재정|건강보험공단|국민건강보험|보건복지부|필수의료|비대면\s*진료|간호법|의료법 개정)/;
function isLifeInfoArticle(article){
  const t = (article.title || '') + ' ' + (article.excerpt || '');
  if(LIFE_INFO_ALWAYS.some(kw => t.includes(kw))) return true;
  if(HEALTH_POLICY_HINT.test(t)) return false;
  return HEALTH_TIP_KEYWORDS.some(kw => t.includes(kw));
}

/* 수집 제외 필터 — 소스는 전부 정치 카테고리(정치면 RSS + 네이버 정치섹션 + 신문사 정치/사회면)라
   "비정치인지" 판정하는 블랙리스트는 두지 않는다. 보도자료·포토·부고·운세 같은 형식적 잡음만 걷어낸다. */
function isExcludedArticle(article){
  return isPrRelease(article)   // prRelease/protocol/weather 플래그는 isPrRelease 내부에서 각각 체크
    || (FILTER_ON.localGov            && isLocalGovArticle(article))
    || (FILTER_ON.photo              && isPhotoArticle(article))
    || (FILTER_ON.progressiveOpinion && isProgressiveOpinion(article))
    || (FILTER_ON.membership         && isMembershipArticle(article))
    || (FILTER_ON.lifeInfo           && isLifeInfoArticle(article))
    || (FILTER_ON.productPr          && isProductPrArticle(article))
    || (FILTER_ON.simpleAccident     && isSimpleAccidentArticle(article))
    || (FILTER_ON.obituary           && isObituaryArticle(article))
    || (FILTER_ON.personnel          && isPersonnelNoticeArticle(article))
    || (FILTER_ON.kids               && isKidsArticle(article))
    || (FILTER_ON.sports             && isSportsArticle(article))
    || (FILTER_ON.religion           && isReligionArticle(article))
    || (FILTER_ON.entertainment      && isEntertainmentArticle(article))
    || (FILTER_ON.finance            && isFinanceArticle(article))
    || (FILTER_ON.housingEdu         && isHousingEduArticle(article));
}

/* 소스가 네이버 정치섹션 + 관심 키워드 검색 둘뿐이라 별도 게이트 없음. 형식 잡음만 거른다. */
function keepArticle(article){
  return !isExcludedArticle(article);
}

const DEFAULT_KEYWORDS = JUNGLE_CONFIG.defaultKeywords;

const KEYWORD_SYNONYM_SEED = {
  '여론조사': ['여론조사','지지율','정당 지지도','국정운영 지지도','대통령 지지율','적합도',
    '차기 대선주자','대권주자','후보 적합도','갤럽','한국갤럽','리얼미터','엔지동','NBS',
    '코리아리서치','한길리서치','에이스리서치']
};

function newKeywordId(){ return 'kw_' + Date.now().toString(36) + Math.random().toString(36).slice(2,7); }

function normalizeKeyword(k){
  if(typeof k === 'string'){
    return {id:newKeywordId(), label:k, terms:(KEYWORD_SYNONYM_SEED[k]||[k]).slice(), scope:undefined};
  }
  // 실시간·관심뉴스 키워드 완전 통합(2026-09-24) — scope(실시간만/관심만 구분)는 더 이상 쓰지 않음
  return {id:k.id||newKeywordId(), label:k.label, terms:(k.terms&&k.terms.length?k.terms:[k.label])};
}
/* 같은 이름(라벨) 키워드가 여럿이면 하나로 합침 — 동의어는 합집합, 먼저 나온 것의 id 유지.
   통합 전엔 같은 이름이 실시간용·관심용으로 따로 있을 수 있었음. 합쳐졌으면 true */
function mergeDuplicateKeywords(){
  const byLabel = new Map();
  const out = [];
  newsState.keywords.forEach(k=>{
    const prev = byLabel.get(k.label);
    if(!prev){ byLabel.set(k.label, k); out.push(k); return; }
    k.terms.forEach(t=>{ if(!prev.terms.includes(t)) prev.terms.push(t); });
  });
  const merged = out.length !== newsState.keywords.length;
  newsState.keywords = out;
  return merged;
}

let TRACKING_PARAMS = ['utm_source','utm_medium','utm_campaign','utm_content','utm_term',
  'fbclid','gclid','ref','refer','referer','spref','sns','from','rss','rssid','cds_rss','xtor'];
const READ_AT_LS_KEY = 'jsg_news_read_at_v2';
let READ_EXPIRE_MS = 48 * 60 * 60 * 1000;      // 읽음 = 버림. 48시간 유지(모든 탭 창이 48시간 이내라 사실상 영구)
const READ_TODAY_LS_KEY = 'jsg_news_read_today_v1';
let READ_SIMILAR_HIDE_MS = 48 * 60 * 60 * 1000; // 읽은 기사와 유사한 기사도 48시간 숨김
const NEWS_CACHE_LOCAL_KEY = 'newsArticleCache_v1';

let newsState = {
  articles: [],
  keywords: [],
  selectedKeywords: new Set(),
  activeSubtab: 'live',
  dismissedLinks: new Set(),
  leftoverExtraCap: 0,
  leftoverSelected: new Set(),
  readLinks: new Set(),   // 로그인 후 loadUserRead()가 /users/{uid}/read_at 에서 채움
  readAt: {},
  readToday: [],
  disabledOutlets: new Set(),   // (구) 차단 목록 — subscribedOutlets 마이그레이션에만 쓰임
  subscribedOutlets: new Set(), // 구독한 언론사(화이트리스트). 실시간은 이 목록만
  discoveredOutlets: new Set(), // 한 번이라도 등장한 언론사 전부 (설정 목록에 계속 남음)
  reports: {},                  // id -> {id,title,bodyHtml,createdAt,updatedAt} — 직접 작성 리포트(개인, 24h 만료)
  showCounts: {live:10, important:10, keyword:10, cons:10, prog:10}
};

let LOAD_MORE_STEP = 10;
let NEWS_POOL_WINDOW_MS = 24 * 3 * 60 * 60 * 1000; // 5일→3일 (2026-09-01 확정, 앱 기준 3일)

let lastSharedSavedAt = 0;
let _autoRefreshTimer = null;
let _cooldownTimer = null;

/* ===== 읽음(=버림) — C2부터 계정별 Firebase(/users/{uid})가 정본. localStorage 안 씀. =====
   read_at 은 서버에 [[url, ts], ...] 배열로 저장(키에 URL을 못 쓰므로).
   read_today 는 [{title, fullText, addedAt}, ...] 배열 그대로. */
async function loadUserRead(){
  const cutoff = Date.now() - READ_EXPIRE_MS;
  const tCutoff = Date.now() - READ_SIMILAR_HIDE_MS;
  try{
    const [atArr, todayArr] = await Promise.all([
      dbFetch(userPath('read_at')).then(r=>r.json()).catch(()=>null),
      dbFetch(userPath('read_today')).then(r=>r.json()).catch(()=>null)
    ]);
    const map = {};
    if(Array.isArray(atArr)){
      atArr.forEach(pair=>{
        if(Array.isArray(pair) && pair[0] && pair[1] >= cutoff) map[pair[0]] = pair[1];
      });
    }
    newsState.readAt = map;
    newsState.readLinks = new Set(Object.keys(map));
    newsState.readToday = Array.isArray(todayArr) ? todayArr.filter(r => r && r.addedAt >= tCutoff) : [];
  }catch(e){
    newsState.readAt = {}; newsState.readLinks = new Set(); newsState.readToday = [];
  }
}

/* ── 기기 간 읽음 병합 ──
   read_at/read_today를 통째로 PUT하면 다른 기기가 그 사이 표시한 읽음이 사라진다.
   저장 직전 서버 값을 받아 합치고(union), 화면 복귀·주기적으로도 서버에서 다시 흡수한다. */
function mergeServerReadAt(serverArr){
  if(!Array.isArray(serverArr)) return false;
  const cutoff = Date.now() - READ_EXPIRE_MS;
  let changed = false;
  serverArr.forEach(pair=>{
    if(!Array.isArray(pair) || !pair[0]) return;
    const url = pair[0], ts = pair[1];
    if(!(ts >= cutoff)) return;
    const cur = newsState.readAt[url];
    if(cur === undefined || ts > cur){ newsState.readAt[url] = ts; newsState.readLinks.add(url); changed = true; }
  });
  return changed;
}
function mergeServerReadToday(serverArr){
  if(!Array.isArray(serverArr)) return false;
  const tCutoff = Date.now() - READ_SIMILAR_HIDE_MS;
  const have = new Set(newsState.readToday.map(r => (r.title||'') + '\u0001' + (r.addedAt||0)));
  let changed = false;
  serverArr.forEach(r=>{
    if(!r || !(r.addedAt >= tCutoff)) return;
    const k = (r.title||'') + '\u0001' + (r.addedAt||0);
    if(!have.has(k)){ newsState.readToday.push(r); have.add(k); changed = true; }
  });
  return changed;
}
let _readSyncPoll = null;
async function syncUserReadFromServer(){
  try{
    const [atArr, todayArr] = await Promise.all([
      dbFetch(userPath('read_at')).then(r=>r.json()).catch(()=>null),
      dbFetch(userPath('read_today')).then(r=>r.json()).catch(()=>null)
    ]);
    const c1 = mergeServerReadAt(atArr);
    const c2 = mergeServerReadToday(todayArr);
    if(c1 || c2) renderAllNewsViews();
  }catch(e){}
}

let _readAtSyncTimer = null;
function saveReadLinks(){
  if(_readAtSyncTimer) clearTimeout(_readAtSyncTimer);
  _readAtSyncTimer = setTimeout(async ()=>{
    _readAtSyncTimer = null;
    try{
      const serverArr = await dbFetch(userPath('read_at')).then(r=>r.json()).catch(()=>null);
      mergeServerReadAt(serverArr);   // 다른 기기 읽음 흡수 후
      const arr = Object.entries(newsState.readAt);
      await dbFetch(userPath('read_at'), {
        method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(arr)
      });
    }catch(e){ console.warn('[읽음 동기화 실패]', e); }
  }, 800);
}
async function saveReadToday(){
  try{
    const serverArr = await dbFetch(userPath('read_today')).then(r=>r.json()).catch(()=>null);
    mergeServerReadToday(serverArr);
    await dbFetch(userPath('read_today'), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(newsState.readToday)
    });
  }catch(e){ console.warn('[읽음(유사) 동기화 실패]', e); }
}
function pruneExpiredRead(){
  const cutoff = Date.now() - READ_EXPIRE_MS;
  let changed = false;
  Object.keys(newsState.readAt).forEach(k=>{
    if(!(newsState.readAt[k] >= cutoff)){ delete newsState.readAt[k]; newsState.readLinks.delete(k); changed = true; }
  });
  if(changed) saveReadLinks();
}
function addReadLink(link, ts){
  if(!link) return;
  newsState.readAt[link] = ts || Date.now();
  newsState.readLinks.add(link);
}
function pruneExpiredReadToday(){
  const cutoff = Date.now() - READ_SIMILAR_HIDE_MS;
  const before = newsState.readToday.length;
  newsState.readToday = newsState.readToday.filter(r => r.addedAt >= cutoff);
  if(newsState.readToday.length !== before) saveReadToday();
}
function isSimilarToTodaysRead(article){
  return newsState.readToday.some(r => sameStory({title:r.title, fullText:r.fullText||''}, article));
}

function getAllReadablePool(){
  return newsState.articles;
}

function markAsRead(link){
  if(!link || newsState.readLinks.has(link)) return;
  const __t0 = performance.now();
  addReadLink(link, Date.now());
  const pool = getAllReadablePool();
  const target = pool.find(a => a.link === link);
  if(target){
    const now = Date.now();
    // 비슷한 기사를 readLinks에 같이 박아버리면 영구 제외라 "유사한 기사" 슬라이더를 나중에 풀어도
    // 다시 안 나옴 — readToday에만 등록해서 isSimilarToTodaysRead(조건부·슬라이더 반응형)가 대신 가리게 함.
    pruneExpiredReadToday();
    newsState.readToday.push({title: target.title, fullText: target.fullText || '', addedAt: now});
    saveReadToday();
  }
  saveReadLinks();
  renderAllNewsViews();
  perfLog('읽음 처리', performance.now() - __t0);
}
function canonicalizeLink(url){
  if(!url) return '';
  try{
    const u = new URL(url.trim());
    TRACKING_PARAMS.forEach(p=>u.searchParams.delete(p));
    u.hash = '';
    let s = u.toString();
    if(s.endsWith('/') && u.pathname !== '/') s = s.slice(0,-1);
    return s;
  }catch(e){
    return url.trim();
  }
}

let ABBREV_NORMALIZE_MAP = [
  ['국힘','국민의힘'],
  [/(?<!더불어)민주당/g, '더불어민주당'],
  ['尹','윤석열'], ['韓','한동훈'], ['文','문재인'],
];
function normalizeAbbrev(text){
  let t = String(text||'');
  ABBREV_NORMALIZE_MAP.forEach(([pattern, full])=>{
    t = (pattern instanceof RegExp) ? t.replace(pattern, full) : t.split(pattern).join(full);
  });
  return t;
}
const KO_NUM_UNIT = {'십':10, '백':100, '천':1000, '만':1e4, '억':1e8, '조':1e12};
function parseKoreanNumber(str){
  let total = 0, cur = 0, num = 0, seen = false, hasFrac = false;
  const s = String(str).replace(/,/g, '');
  for(let i=0; i<s.length; i++){
    const ch = s[i];
    if(ch >= '0' && ch <= '9'){ num = num*10 + (+ch); seen = true; continue; }
    if(ch === '.'){
      let j = i+1, frac = '';
      while(j < s.length && s[j] >= '0' && s[j] <= '9'){ frac += s[j]; j++; }
      if(frac){ num = num + parseFloat('0.'+frac); i = j-1; hasFrac = true; continue; }
      return null;
    }
    const u = KO_NUM_UNIT[ch];
    if(u === undefined) return null;
    seen = true;
    if(u >= 1e4){ cur = (cur + num) * u; total += cur; cur = 0; num = 0; }
    else { cur += (num || 1) * u; num = 0; }
  }
  if(!seen) return null;
  const v = total + cur + num;
  return (isFinite(v) && v > 0) ? v : null;
}
function numberToken(v){
  const exp = Math.floor(Math.log10(v));
  const mant = Math.round(v / Math.pow(10, exp - 1));
  return 'num' + mant + 'e' + (exp + 30);
}
/* 단위가 이어지는 복합 금액("3억5천만원", "1조 2천억원")을 한 덩어리로 잡는다. 첫 덩어리에 단위가 있을 때만 뒤 덩어리를 잇는다("2 3억" 같은 우연한 이음 방지). */
const NUMERIC_EXPR_REGEX = /[0-9][0-9,\.]*\s*(?:[조억만천백십]+(?:\s*[0-9][0-9,\.]*\s*[조억만천백십]+)*)?/g;
function normalizeNumbers(text){
  return String(text||'').replace(NUMERIC_EXPR_REGEX, m=>{
    const trimmed = m.replace(/\s+/g,'').replace(/[\.,]+$/,'');
    const hasBigUnit = /[조억만]/.test(trimmed);
    const digitCount = (trimmed.match(/[0-9]/g) || []).length;
    if(!hasBigUnit && digitCount < 3) return m;
    const v = parseKoreanNumber(trimmed);
    return v === null ? m : ' ' + numberToken(v) + ' ';
  });
}

let JOSA_SUFFIXES = ['에서','에게','으로','부터','까지','에','와','과','은','는','이','가','을','를','의','도','로','서'];
function stripJosa(word){
  if(word.length < 3) return word;
  if(/^num\d/.test(word)) return word;
  for(const j of JOSA_SUFFIXES){
    if(word.length - j.length >= 2 && word.endsWith(j)) return word.slice(0, -j.length);
  }
  return word;
}

function normalizeTitleForDedup(title){
  const base = normalizeNumbers(
      normalizeAbbrev(title||'')
        .replace(/\[[^\]]*\]/g,' ')
        .replace(/["'"'‘’“”]/g,'')
    )
    .replace(/[^\p{L}\p{N}\s]/gu,' ')
    .replace(/\s+/g,' ')
    .trim()
    .toLowerCase();
  return base.split(' ').map(stripJosa).join(' ');
}
const _simCache = {word:new Map(), bigram:new Map(), body:new Map()};
const SIM_CACHE_MAX = 20000;
function _cached(map, key, make){
  let v = map.get(key);
  if(v === undefined){
    if(map.size > SIM_CACHE_MAX) map.clear();
    v = make();
    map.set(key, v);
  }
  return v;
}
function wordSetOf(t){
  return _cached(_simCache.word, String(t||''), ()=>
    new Set(normalizeTitleForDedup(t).split(' ').filter(w=>w.length>1)));
}
function bigramSetOf(t){
  return _cached(_simCache.bigram, String(t||''), ()=> charBigrams(normalizeTitleForDedup(t)));
}

function wordSimilarity(a,b){
  const ta = wordSetOf(a);
  const tb = wordSetOf(b);
  if(ta.size===0 || tb.size===0) return 0;
  const [small, big] = ta.size <= tb.size ? [ta, tb] : [tb, ta];
  let overlap=0;
  small.forEach(w=>{ if(big.has(w)) overlap++; });
  return overlap / small.size;
}
function charBigrams(str){
  const s = str.replace(/\s+/g,'');
  const grams = new Set();
  for(let i=0;i<s.length-1;i++){ grams.add(s.slice(i,i+2)); }
  return grams;
}
function charSimilarity(a,b){
  const ga = bigramSetOf(a);
  const gb = bigramSetOf(b);
  if(ga.size===0 || gb.size===0) return 0;
  const [small, big] = ga.size <= gb.size ? [ga, gb] : [gb, ga];
  let overlap=0;
  small.forEach(g=>{ if(big.has(g)) overlap++; });
  return overlap / small.size;
}
function titleSimilarity(a,b){
  return Math.max(wordSimilarity(a,b), charSimilarity(a,b));
}
/* ===== 실시간 이슈 표시 범위 슬라이더 (2026-09-01 확정) =====
   기존엔 이 슬라이더가 "중복판정 임계값"을 조절했는데, 발행시간 기준 시간창 선택으로 전면 교체.
   왼쪽부터 넓은 시간창(48시간) → 좁은 시간창(1시간) 순. 중복판정 임계값은 '보통'(0.6)으로 고정. */
let LIVE_WINDOW_STEPS = [
  { label: '48시간 내', hours: 48 },
  { label: '24시간 내', hours: 24 },
  { label: '8시간 내',  hours: 8  },
  { label: '3시간 내',  hours: 3  },
  { label: '1시간 내',  hours: 1  },
];
const LIVE_WINDOW_STEP_LS_KEY = 'jsg_live_window_step_v1';
const IMPORTANT_WINDOW_STEP_LS_KEY = 'jsg_important_window_step_v1';
const LIVE_WINDOW_DEFAULT_STEP = 3;      // '3시간 내'
const IMPORTANT_WINDOW_DEFAULT_STEP = 1; // '24시간 내'
function _readStep(key, def){
  try{ const v = parseInt(localStorage.getItem(key), 10);
    return (v >= 0 && v < LIVE_WINDOW_STEPS.length) ? v : def; }catch(e){ return def; }
}
let _liveWindowStep = _readStep(LIVE_WINDOW_STEP_LS_KEY, LIVE_WINDOW_DEFAULT_STEP);
let _importantWindowStep = _readStep(IMPORTANT_WINDOW_STEP_LS_KEY, IMPORTANT_WINDOW_DEFAULT_STEP);
function saveLiveWindowStep(step){
  _liveWindowStep = step;
  try{ localStorage.setItem(LIVE_WINDOW_STEP_LS_KEY, String(step)); }catch(e){}
  saveUiPrefs();
}
function saveImportantWindowStep(step){
  _importantWindowStep = step;
  try{ localStorage.setItem(IMPORTANT_WINDOW_STEP_LS_KEY, String(step)); }catch(e){}
  saveUiPrefs();
  noteImportantFilterChange();
}
/* 활성 탭(실시간/관심뉴스)별 시간창 슬라이더 값 — 두 탭이 독립적으로 시간창을 가진다 */
function activeWindowStep(){ return newsState.activeSubtab === 'important' ? _importantWindowStep : _liveWindowStep; }
function applyActiveWindowStep(step){
  if(newsState.activeSubtab === 'important'){
    IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[step].hours;
    saveImportantWindowStep(step);
  }else{
    LIVE_WINDOW_HOURS = LIVE_WINDOW_STEPS[step].hours;
    saveLiveWindowStep(step);
  }
}

/* "유사한 기사" 슬라이더 — 제목 유사도 임계값을 조절한다. (표시 라벨: 최대한 많게 ~ 최대한 적게)
   임계값이 낮을수록 서로 다른 제목도 같은 기사로 병합 → 화면 기사 수 감소('최대한 적게').
   각 단계가 title/floor/body 3개 값을 동시에 움직여 병합 강도 차이를 크게 벌린다.
   title = 제목 유사도가 이 값 이상이면 곧바로 같은 기사
   floor = 제목 유사도가 이 값 미만이면 절대 병합 안 함
   body  = 그 사이 구간에서 본문 유사도가 이 값 이상이면 병합
   '보통'(0.60/0.25/0.50)이 기존 고정값. 읽음 전파·유사기사 숨김도 이 값을 따른다. */
let DUP_STEPS = [
  { label: '최대한 많게',  title: 0.93, floor: 0.62, body: 0.92 },
  { label: '많게',        title: 0.70, floor: 0.34, body: 0.60 },
  { label: '보통',        title: 0.60, floor: 0.25, body: 0.50 },
  { label: '적게',        title: 0.38, floor: 0.12, body: 0.30 },
  { label: '최대한 적게',  title: 0.20, floor: 0.05, body: 0.17 },
];
/* 유사한 기사·기사 관련성은 실시간/관심뉴스가 각자 값을 가진다 (시간창 슬라이더와 동일 패턴).
   _dupStep / _relevanceStep = 현재 활성 탭 기준 값 — 렌더·프리뷰·슬라이더 표시가 참조한다.
   syncActiveFilterSteps()가 탭 전환·설정 적용마다 활성 탭 값으로 맞춘다.
   구 단일키(jsg_dup_step_v1 / jsg_relevance_step_v1)는 마이그레이션 seed로만 읽는다. */
const DUP_STEP_LS_KEY = 'jsg_dup_step_v1';                     // 레거시
const LIVE_DUP_STEP_LS_KEY = 'jsg_live_dup_step_v1';
const IMPORTANT_DUP_STEP_LS_KEY = 'jsg_important_dup_step_v1';
const DUP_DEFAULT_STEP = 2; // '보통'
function _readStepLS(key, len){
  try{ const v = parseInt(localStorage.getItem(key), 10);
    return (v >= 0 && v < len) ? v : null; }catch(e){ return null; }
}
const _legacyDupStep = _readStepLS(DUP_STEP_LS_KEY, DUP_STEPS.length);
let _liveDupStep      = _readStepLS(LIVE_DUP_STEP_LS_KEY, DUP_STEPS.length)      ?? (_legacyDupStep ?? DUP_DEFAULT_STEP);
let _importantDupStep = _readStepLS(IMPORTANT_DUP_STEP_LS_KEY, DUP_STEPS.length) ?? (_legacyDupStep ?? DUP_DEFAULT_STEP);
let _dupStep = _liveDupStep;
function saveDupStep(step){
  _dupStep = step;
  if(newsState.activeSubtab === 'important'){
    _importantDupStep = step;
    try{ localStorage.setItem(IMPORTANT_DUP_STEP_LS_KEY, String(step)); }catch(e){}
    noteImportantFilterChange();
  }else{
    _liveDupStep = step;
    try{ localStorage.setItem(LIVE_DUP_STEP_LS_KEY, String(step)); }catch(e){}
  }
  saveUiPrefs();
}

/* "기사 관련성" 슬라이더 — 등록 키워드 중 몇 개가 제목+요약문에 걸리는지로 필터.
   낮음 = 필터 없음, 중간 = 2개 이상, 높음 = 3개 이상. 실시간·관심뉴스 각자 값. */
let RELEVANCE_STEPS = [
  { label: '낮음', min: 0 },
  { label: '중간', min: 2 },
  { label: '높음', min: 3 },
];
const RELEVANCE_STEP_LS_KEY = 'jsg_relevance_step_v1';         // 레거시
const LIVE_REL_STEP_LS_KEY = 'jsg_live_rel_step_v1';
const IMPORTANT_REL_STEP_LS_KEY = 'jsg_important_rel_step_v1';
const _legacyRelStep = _readStepLS(RELEVANCE_STEP_LS_KEY, RELEVANCE_STEPS.length);
let _liveRelevanceStep      = _readStepLS(LIVE_REL_STEP_LS_KEY, RELEVANCE_STEPS.length)      ?? (_legacyRelStep ?? 0);
let _importantRelevanceStep = _readStepLS(IMPORTANT_REL_STEP_LS_KEY, RELEVANCE_STEPS.length) ?? (_legacyRelStep ?? 0);
let _relevanceStep = _liveRelevanceStep;
function saveRelevanceStep(step){
  _relevanceStep = step;
  if(newsState.activeSubtab === 'important'){
    _importantRelevanceStep = step;
    try{ localStorage.setItem(IMPORTANT_REL_STEP_LS_KEY, String(step)); }catch(e){}
    noteImportantFilterChange();
  }else{
    _liveRelevanceStep = step;
    try{ localStorage.setItem(LIVE_REL_STEP_LS_KEY, String(step)); }catch(e){}
  }
  saveUiPrefs();
}
/* "키워드 정확도" 슬라이더 — 키워드 동의어(3~6개) 중 몇 개가 같은 기사에 동시에 걸려야
   매칭으로 인정할지. 낮음 = 1개(기존과 동일, OR), 중간 = 2개, 높음 = 3개. 실시간·관심뉴스 각자 값.
   기사 관련성(RELEVANCE_STEPS)과는 축이 다름 — 그건 "서로 다른 등록 키워드가 몇 건 걸리는가",
   이건 "키워드 하나의 동의어가 몇 개나 겹치는가"를 본다. */
let SYNONYM_STEPS = [
  { label: '낮음', min: 1 },
  { label: '중간', min: 2 },
  { label: '높음', min: 3 },
];
const LIVE_SYN_STEP_LS_KEY = 'jsg_live_syn_step_v1';
const IMPORTANT_SYN_STEP_LS_KEY = 'jsg_important_syn_step_v1';
let _liveSynonymStep      = _readStepLS(LIVE_SYN_STEP_LS_KEY, SYNONYM_STEPS.length)      ?? 0;
let _importantSynonymStep = _readStepLS(IMPORTANT_SYN_STEP_LS_KEY, SYNONYM_STEPS.length) ?? 0;
let _synonymStep = _liveSynonymStep;
function saveSynonymStep(step){
  _synonymStep = step;
  if(newsState.activeSubtab === 'important'){
    _importantSynonymStep = step;
    try{ localStorage.setItem(IMPORTANT_SYN_STEP_LS_KEY, String(step)); }catch(e){}
    noteImportantFilterChange();
  }else{
    _liveSynonymStep = step;
    try{ localStorage.setItem(LIVE_SYN_STEP_LS_KEY, String(step)); }catch(e){}
  }
  saveUiPrefs();
}
/* 활성 탭(실시간/관심뉴스) 기준으로 _dupStep·_relevanceStep·_synonymStep 및 병합 임계값을 맞춘다 */
function syncActiveFilterSteps(){
  const imp = (typeof newsState !== 'undefined') && newsState.activeSubtab === 'important';
  _dupStep = imp ? _importantDupStep : _liveDupStep;
  _relevanceStep = imp ? _importantRelevanceStep : _liveRelevanceStep;
  _synonymStep = imp ? _importantSynonymStep : _liveSynonymStep;
  applyDupStep(_dupStep);
}
/* 필터 패널(3대 슬라이더) 열림 상태 — 기본 닫힘 */
const FILTER_OPEN_LS_KEY = 'jsg_filter_open_v1';
let _filterPanelOpen = (()=>{ try{ return localStorage.getItem(FILTER_OPEN_LS_KEY) === '1'; }catch(e){ return false; } })();
function setFilterPanelOpen(open){
  _filterPanelOpen = !!open;
  try{ localStorage.setItem(FILTER_OPEN_LS_KEY, _filterPanelOpen ? '1' : '0'); }catch(e){}
  saveUiPrefs();
}

/* 키워드 구절 매칭(기능정의서 v0.4 §4.1, 2026-10-04) — 키워드(또는 동의어)에 띄어쓰기가 있으면 "구절"로 본다.
   공백을 모두 지운 뒤 모든 단어가 들어 있고, 첫 단어~마지막 단어 사이 틈이 단어당 PHRASE_GAP자 이내일 때만 일치.
   예) "홍길동 골프 회동" → "홍길동, 주말 골프 회동 논란" ○ / 한참 떨어진 문단에 따로 나오면 ×.
   한 단어 키워드는 예전처럼 포함 검사. 조사가 붙은 변형("골프장", "회동을")은 부분 일치로 잡힌다. */
let PHRASE_GAP = 20;
function phraseMatchSquashed(squashed, words){
  if(!words.length) return false;
  const pos = [];
  for(const w of words){
    const list = [];
    let i = squashed.indexOf(w);
    while(i >= 0 && list.length < 50){ list.push(i); i = squashed.indexOf(w, i + 1); }
    if(!list.length) return false;
    pos.push(list);
  }
  if(words.length === 1) return true;
  const allow = words.reduce((n, w)=> n + w.length, 0) + PHRASE_GAP * (words.length - 1);
  let best = Infinity;
  const walk = (k, lo, hi)=>{
    if(hi - lo >= best) return;
    if(k === words.length){ best = hi - lo; return; }
    for(const p of pos[k]) walk(k + 1, Math.min(lo, p), Math.max(hi, p + words[k].length));
  };
  walk(0, Infinity, -Infinity);
  return best <= allow;
}
/* normText = normalizeAbbrev를 거친 본문 */
function termMatchesText(term, normText){
  const t = String(term || '').trim();
  if(!t) return false;
  if(!/\s/.test(t)) return normText.includes(normalizeAbbrev(t));
  const words = t.split(/\s+/).map(w=> normalizeAbbrev(w).replace(/\s+/g, '').toLowerCase()).filter(Boolean);
  return phraseMatchSquashed(normText.replace(/\s+/g, '').toLowerCase(), words);
}

/* 한 기사에 등록 키워드가 몇 개 걸리는지 (제목+요약문+본문, 동의어 포함). 키워드 개수(동의어 개수 아님) */
function keywordHitCount(article, keywords){
  if(!keywords || !keywords.length) return 0;
  const text = normalizeAbbrev(`${article.title||''} ${article.excerpt||''} ${RELEVANCE_USE_BODY ? (article.fullText||'') : ''}`);
  let n = 0;
  for(const kw of keywords){
    if((kw.terms||[kw.label]).some(t=> termMatchesText(t, text))) n++;
  }
  return n;
}
function relevancePasses(article, keywords){
  const min = RELEVANCE_STEPS[_relevanceStep].min;
  if(min <= 0) return true;
  return keywordHitCount(article, keywords) >= min;
}

let TITLE_DUP_THRESHOLD, TITLE_DUP_FLOOR, BODY_DUP_THRESHOLD;
function applyDupStep(step){
  const s = DUP_STEPS[step] || DUP_STEPS[DUP_DEFAULT_STEP];
  TITLE_DUP_THRESHOLD = s.title;
  TITLE_DUP_FLOOR = s.floor;
  BODY_DUP_THRESHOLD = s.body;
}
applyDupStep(_dupStep);
let BODY_MIN_WORDS = 5;
let TITLE_DUP_TIME_WINDOW_MS = 24 * 60 * 60 * 1000;

function bodyWordSet(text){
  return _cached(_simCache.body, String(text||''), ()=>
    new Set(normalizeTitleForDedup(String(text||'')).split(' ').filter(w=>w.length>1)));
}
function bodySimilarity(a,b){
  const sa = bodyWordSet(a), sb = bodyWordSet(b);
  if(sa.size < BODY_MIN_WORDS || sb.size < BODY_MIN_WORDS) return 0;
  const [small, big] = sa.size <= sb.size ? [sa, sb] : [sb, sa];
  let overlap = 0;
  small.forEach(w=>{ if(big.has(w)) overlap++; });
  return overlap / small.size;
}

function leadingBracketTag(title){
  const m = /^\s*\[([^\]]{1,20})\]/.exec(String(title||''));
  return m ? m[1].replace(/\s+/g,'') : '';
}
const NON_OUTLET_BRACKETS = new Set(['단독','속보','종합','인터뷰','일문일답','전문','영상','포토','사설','칼럼']);
function differentBracketTag(a, b){
  const ta = leadingBracketTag(a.title), tb = leadingBracketTag(b.title);
  if(!ta || !tb) return false;
  if(NON_OUTLET_BRACKETS.has(ta) || NON_OUTLET_BRACKETS.has(tb)) return false;
  return ta !== tb;
}

/* 같은 여론조사를 언론사마다 다른 제목으로 쓴 기사 묶기(2026-10-06 — "李 지지율 37.4%" 3건, "한동훈 1위" 3건이 따로 노출되던 문제).
   둘 다 여론조사 기사이고 ① 소수점 있는 같은 수치(37.4%)나 서로 다른 수치 2개 이상이 겹치거나, ② 조사 용어를 뺀 핵심 단어가 2개 이상 겹치면 같은 조사로 본다. */
const POLL_WORD_RX = /여론조사|지지율|지지도|갤럽|리얼미터|엠브레인|NBS|호감도|선호도|차기 ?(?:대통령|대선|지도자)감?/;
const POLL_STOP_WORDS = new Set(['여론조사','지지율','지지도','갤럽','리얼미터','엠브레인','조사','결과','대통령','국민의힘','더불어민주당','민주당','정당','응답','전주','대비','포인트','오차','한국갤럽','신뢰수준']);
function pollPercentSet(title){ return new Set(String(title||'').match(/\d+(?:\.\d+)?\s?%/g) || []); }
function samePoll(a, b){
  const ta = String(a.title||''), tb = String(b.title||'');
  if(!POLL_WORD_RX.test(ta) || !POLL_WORD_RX.test(tb)) return false;
  const pa = pollPercentSet(ta), pb = pollPercentSet(tb);
  let common = 0, decimal = false;
  pa.forEach(x=>{ if(pb.has(x)){ common++; if(x.includes('.')) decimal = true; } });
  if(decimal || common >= 2) return true;
  const wa = wordSetOf(ta), wb = wordSetOf(tb);
  let shared = 0;
  wa.forEach(w=>{ if(wb.has(w) && !POLL_STOP_WORDS.has(w) && !/^(num\d|[\d.,%]+$)/.test(w)) shared++; });
  return shared >= 2;
}
function sameStory(a, b){
  if(!a || !b) return false;
  if(differentBracketTag(a, b)) return false;
  if(samePoll(a, b)) return true;
  const ts = titleSimilarity(a.title, b.title);
  if(ts >= TITLE_DUP_THRESHOLD) return true;
  if(ts < TITLE_DUP_FLOOR) return false;
  return bodySimilarity(a.fullText, b.fullText) >= BODY_DUP_THRESHOLD;
}
function sameStoryInWindow(a, b){
  if(!sameStory(a, b)) return false;
  const at = parseArticleDate(a.pubDate), bt = parseArticleDate(b.pubDate);
  if(isNaN(at) || isNaN(bt)) return true;
  return Math.abs(at - bt) <= TITLE_DUP_TIME_WINDOW_MS;
}

const PRIORITY_TAG_REGEX = /\[(단독|속보)\]/;
function hasPriorityTag(article){ return PRIORITY_TAG_REGEX.test(article && article.title || ''); }
let PRIORITY_TAG_BONUS_MS = 45 * 60 * 1000;
function sortTimeValue(article){
  return safeArticleTime(article.pubDate) + (hasPriorityTag(article) ? PRIORITY_TAG_BONUS_MS : 0);
}
/* 실시간 탭 전용 — 등록한 '실시간 키워드'에 매칭되는 기사는 목록에서 위로 끌어올림(정렬 가중치만,
   화면엔 표시 안 함). 다른 탭(관심뉴스·저장 등)의 정렬에는 영향 없도록 sortTimeValue와 분리. */
let LIVE_KEYWORD_BONUS_MS = 20 * 60 * 1000;
function hasLiveKeywordMatch(article, liveKeywords){
  const list = liveKeywords || keywordsForScope('live');
  return list.some(kw => keywordMatchesArticle(article, kw));
}
function dedupeSimilarTitles(items){
  const kept = [];
  items.forEach(a=>{
    const dup = kept.find(k => sameStoryInWindow(k, a));
    if(!dup) kept.push(a);
  });
  return kept;
}

function stripHtml(str){
  const tmp = document.createElement('div');
  tmp.innerHTML = str || '';
  return (tmp.textContent || tmp.innerText || '').replace(/\s+/g,' ').trim();
}
function esc(str){
  return String(str||'').replace(/&/g,'&amp;').replace(/"/g,'&quot;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}
/* 이모지 제거 — 카페 반응 리포트 텍스트에 이모지가 섞여 들어오지 않게. ★(U+2605) 같은 마커·문장부호는 보존. */
function stripEmoji(str){
  let s = String(str == null ? '' : str);
  try{
    s = s.replace(/[\u{FE00}-\u{FE0F}\u{1F3FB}-\u{1F3FF}\u{200D}\u{20E3}\u{1F1E6}-\u{1F1FF}]/gu, '')
         .replace(/\p{Extended_Pictographic}/gu, '');
  }catch(e){
    // 구형 엔진 폴백: 이모지 대부분이 서로게이트 쌍(U+1F000 이상)이라 그것만 제거
    s = s.replace(/[\uD800-\uDBFF][\uDC00-\uDFFF]/g, '').replace(/[️⃣☀-⛿✀-➿]/g, function(ch){ return ch === '★' ? ch : ''; });
  }
  return s.replace(/\s{2,}/g, ' ').trim();
}

async function loadNewsKeywords(){
  try{
    const res = await dbFetch(userPath('news_keywords'));
    const data = await res.json();
    const raw = (data && Array.isArray(data)) ? data : DEFAULT_KEYWORDS.slice();
    newsState.keywords = raw.map(normalizeKeyword);
    const hadScope = raw.some(k=> k && typeof k === 'object' && k.scope);
    const merged = mergeDuplicateKeywords();
    if(Array.isArray(data) && (hadScope || merged)) saveNewsKeywords();   // 방금 받은 서버값 기준이라 덮어쓰기 경합 없음
  }catch(e){
    newsState.keywords = DEFAULT_KEYWORDS.map(normalizeKeyword);
  }
}
async function saveNewsKeywords(){
  try{
    await dbFetch(userPath('news_keywords'), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(newsState.keywords)
    });
  }catch(e){}
}

async function loadNewsDismissed(){
  try{
    const res = await dbFetch(userPath('news_dismissed'));
    const data = await res.json();
    newsState.dismissedLinks = new Set((data && Array.isArray(data.links)) ? data.links : []);
    newsState.leftoverExtraCap = (data && typeof data.extraCap === 'number') ? data.extraCap : 0;
  }catch(e){
    newsState.dismissedLinks = new Set();
    newsState.leftoverExtraCap = 0;
  }
}
async function saveNewsDismissed(){
  try{
    await dbFetch(userPath('news_dismissed'), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({links: Array.from(newsState.dismissedLinks), extraCap: newsState.leftoverExtraCap})
    });
  }catch(e){}
}

async function loadDisabledOutlets(){
  try{
    const res = await dbFetch(userPath('disabled_outlets'));
    const data = await res.json();
    newsState.disabledOutlets = new Set(Array.isArray(data) ? data : []);
  }catch(e){
    newsState.disabledOutlets = new Set();
  }
}

/* 구독 언론사(화이트리스트). 실시간 = 이 목록의 매체만.
   기본값 = "아무것도 구독 안 함". 사용자가 설정 탭에서 직접 체크한 매체만 구독으로 잡힌다.
   (예전엔 등장한 매체를 전부 자동 구독했으나 2026-09-03 뒤집음. 키도 _v3로 올려 옛 목록 폐기.)
   ── RTDB는 빈 배열/빈 객체를 저장하지 못한다. 그래서 "이 사용자 초기화 끝남"을 별도 플래그
      (SUBSCRIBED_DONE_KEY)로 기록한다. 플래그가 있으면 목록이 비어 있어도 "사용자가 0개 고른
      상태"로 존중하고 절대 재초기화하지 않는다. */
function outletBaseName(name){ return String(name||'').replace(/\([^)]*\)$/, '').trim(); }
function isSubscribedOutlet(source){
  return newsState.subscribedOutlets.has(outletBaseName(source));
}
/* 개통 시 config.js 로 초기 구독 목록을 넣을 수 있는 고리. 없으면 빈 목록. */
function defaultSubscribedSet(){
  const seed = JUNGLE_CONFIG.defaultSubscribedOutlets;
  return new Set(Array.isArray(seed) ? seed : []);
}
/* 키 버전 _v3: 예전 "전부 구독" 목록을 버리고 빈 목록으로 새 출발 */
const SUBSCRIBED_KEY = 'subscribed_outlets_v3';
const SUBSCRIBED_DONE_KEY = 'subscribed_setup_done_v3';
async function loadSubscribedOutlets(){
  let list, done, ok = false;
  try{
    [list, done] = await Promise.all([
      dbFetch(userPath(SUBSCRIBED_KEY)).then(r=>r.json()),
      dbFetch(userPath(SUBSCRIBED_DONE_KEY)).then(r=>r.json())
    ]);
    ok = true;
  }catch(e){ ok = false; }

  if(ok && done){
    // 초기화 완료 사용자 — 저장된 목록 그대로 사용(비어 있으면 진짜 0개)
    newsState.subscribedOutlets = new Set(Array.isArray(list) ? list : []);
    return;
  }
  if(ok){
    // 신규(또는 _v3 이전) 사용자 — 기본값으로 1회 초기화 + 완료 플래그 기록
    newsState.subscribedOutlets = defaultSubscribedSet();
    saveSubscribedOutlets();
    return;
  }
  // 읽기 실패 → 서버를 절대 덮어쓰지 않는다. 이번 세션만 기본값
  newsState.subscribedOutlets = defaultSubscribedSet();
}
async function saveSubscribedOutlets(){
  try{
    await Promise.all([
      dbFetch(userPath(SUBSCRIBED_KEY), {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: JSON.stringify(Array.from(newsState.subscribedOutlets))
      }),
      dbFetch(userPath(SUBSCRIBED_DONE_KEY), {
        method:'PUT', headers:{'Content-Type':'application/json'},
        body: 'true'
      })
    ]);
  }catch(e){}
}
async function loadDiscoveredOutlets(){
  try{
    const res = await dbFetch(userPath('discovered_outlets'));
    const data = await res.json();
    newsState.discoveredOutlets = new Set(Array.isArray(data) ? data : []);
  }catch(e){ newsState.discoveredOutlets = new Set(); }
}
let _discSaveTimer = null;
function saveDiscoveredOutlets(){
  if(_discSaveTimer) clearTimeout(_discSaveTimer);
  _discSaveTimer = setTimeout(()=>{
    dbFetch(userPath('discovered_outlets'), {
      method:'PUT', headers:{'Content-Type':'application/json'},
      body: JSON.stringify(Array.from(newsState.discoveredOutlets))
    }).catch(()=>{});
  }, 1000);
}
/* 수집된 기사의 매체를 발견 목록에 등록. 새 매체가 하나라도 생기면 true */
function noteDiscoveredOutlets(articles){
  let changed = false;
  (articles||[]).forEach(a=>{
    const n = outletBaseName(a.source);
    if(n && !newsState.discoveredOutlets.has(n)){ newsState.discoveredOutlets.add(n); changed = true; }
  });
  if(changed) saveDiscoveredOutlets();
  return changed;
}

/* 관심뉴스·키워드 탭 언론사 범위 토글 — 'subscribed'(기본) | 'all'. 기기별 저장. */
const OUTLET_SCOPE_LS_KEY = 'jsg_outlet_scope_v2';   // v2: 기본값 subscribed → all
let newsOutletScope = (()=>{ try{ return localStorage.getItem(OUTLET_SCOPE_LS_KEY) === 'all' ? 'all' : 'subscribed'; }catch(e){ return 'subscribed'; } })();   // 써니데스크: 기본은 구독 언론사만
function setNewsOutletScope(v){
  newsOutletScope = (v === 'subscribed') ? 'subscribed' : 'all';
  try{ localStorage.setItem(OUTLET_SCOPE_LS_KEY, newsOutletScope); }catch(e){}
  saveUiPrefs();
}

/* ===== 화면 설정(슬라이더·범위 토글) 계정 단위 동기화 =====
   시간창(실시간·관심뉴스 각각) / 유사한 기사 / 언론사 범위 — PC·모바일 공유.
   localStorage는 즉시 표시용 캐시로 계속 쓰되 /users/{uid}/ui_prefs 가 정본. */
let _wizardDone = false;   // 초기 세팅 마법사 완료/스킵 여부 (계정 동기화)
function currentUiPrefs(){
  return { liveWindowStep: _liveWindowStep, importantWindowStep: _importantWindowStep,
           liveDupStep: _liveDupStep, importantDupStep: _importantDupStep,
           liveRelevanceStep: _liveRelevanceStep, importantRelevanceStep: _importantRelevanceStep,
           liveSynonymStep: _liveSynonymStep, importantSynonymStep: _importantSynonymStep,
           dupStep: _liveDupStep, relevanceStep: _liveRelevanceStep,   // 레거시 클라이언트 호환
           outletScope: newsOutletScope, filterPanelOpen: _filterPanelOpen,
           wizardDone: _wizardDone };
}
function applyUiPrefs(p, opts){
  if(!p || typeof p !== 'object') return false;
  let changed = false;
  const setStep = (v, cur, set)=>{
    if(typeof v === 'number' && v >= 0 && v < LIVE_WINDOW_STEPS.length && v !== cur){ set(v); return true; }
    return false;
  };
  if(setStep(p.liveWindowStep, _liveWindowStep, v=>{ _liveWindowStep = v; LIVE_WINDOW_HOURS = LIVE_WINDOW_STEPS[v].hours;
    try{ localStorage.setItem(LIVE_WINDOW_STEP_LS_KEY, String(v)); }catch(e){} })) changed = true;
  if(setStep(p.importantWindowStep, _importantWindowStep, v=>{ _importantWindowStep = v; IMPORTANT_WINDOW_HOURS = LIVE_WINDOW_STEPS[v].hours;
    try{ localStorage.setItem(IMPORTANT_WINDOW_STEP_LS_KEY, String(v)); }catch(e){} })) changed = true;
  const setDup = (v, cur, lsKey, set)=>{
    if(typeof v === 'number' && v >= 0 && v < DUP_STEPS.length && v !== cur){
      set(v); try{ localStorage.setItem(lsKey, String(v)); }catch(e){} return true;
    }
    return false;
  };
  const dupLive = (typeof p.liveDupStep === 'number') ? p.liveDupStep : p.dupStep;
  const dupImp  = (typeof p.importantDupStep === 'number') ? p.importantDupStep : p.dupStep;
  if(setDup(dupLive, _liveDupStep, LIVE_DUP_STEP_LS_KEY, v=>{ _liveDupStep = v; })) changed = true;
  if(setDup(dupImp,  _importantDupStep, IMPORTANT_DUP_STEP_LS_KEY, v=>{ _importantDupStep = v; })) changed = true;

  const setRel = (v, cur, lsKey, set)=>{
    if(typeof v === 'number' && v >= 0 && v < RELEVANCE_STEPS.length && v !== cur){
      set(v); try{ localStorage.setItem(lsKey, String(v)); }catch(e){} return true;
    }
    return false;
  };
  const relLive = (typeof p.liveRelevanceStep === 'number') ? p.liveRelevanceStep : p.relevanceStep;
  const relImp  = (typeof p.importantRelevanceStep === 'number') ? p.importantRelevanceStep : p.relevanceStep;
  if(setRel(relLive, _liveRelevanceStep, LIVE_REL_STEP_LS_KEY, v=>{ _liveRelevanceStep = v; })) changed = true;
  if(setRel(relImp,  _importantRelevanceStep, IMPORTANT_REL_STEP_LS_KEY, v=>{ _importantRelevanceStep = v; })) changed = true;

  const setSyn = (v, cur, lsKey, set)=>{
    if(typeof v === 'number' && v >= 0 && v < SYNONYM_STEPS.length && v !== cur){
      set(v); try{ localStorage.setItem(lsKey, String(v)); }catch(e){} return true;
    }
    return false;
  };
  if(setSyn(p.liveSynonymStep, _liveSynonymStep, LIVE_SYN_STEP_LS_KEY, v=>{ _liveSynonymStep = v; })) changed = true;
  if(setSyn(p.importantSynonymStep, _importantSynonymStep, IMPORTANT_SYN_STEP_LS_KEY, v=>{ _importantSynonymStep = v; })) changed = true;

  const scope = (p.outletScope === 'all') ? 'all' : 'subscribed';   // 써니데스크: 저장된 값이 없으면 구독 언론사만
  if(scope !== newsOutletScope){
    newsOutletScope = scope;
    try{ localStorage.setItem(OUTLET_SCOPE_LS_KEY, scope); }catch(e){}
    changed = true;
  }
  if(p.wizardDone === true && !_wizardDone) _wizardDone = true;   // 한 번 true면 유지
  if(changed) syncActiveFilterSteps();
  if(typeof p.filterPanelOpen === 'boolean' && p.filterPanelOpen !== _filterPanelOpen){
    _filterPanelOpen = p.filterPanelOpen;
    try{ localStorage.setItem(FILTER_OPEN_LS_KEY, _filterPanelOpen ? '1' : '0'); }catch(e){}
    changed = true;
  }
  return changed;
}
async function loadUiPrefs(){
  try{
    const p = await dbFetch(userPath('ui_prefs')).then(r=>r.json());
    if(p && typeof p === 'object'){ applyUiPrefs(p); }
    else { saveUiPrefs(); }   // 서버에 없음 → 현재(localStorage seed·기본값)를 올림
  }catch(e){}
}
let _uiPrefsSaveTimer = null;
function saveUiPrefs(){
  if(_uiPrefsSaveTimer) clearTimeout(_uiPrefsSaveTimer);
  _uiPrefsSaveTimer = setTimeout(()=>{
    _uiPrefsSaveTimer = null;
    dbFetch(userPath('ui_prefs'), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(currentUiPrefs())
    }).catch(()=>{});
  }, 600);
}
/* 다른 기기에서 바꾼 화면 설정 흡수 — 읽음 동기화(visibilitychange·60초)에 얹어 호출 */
async function syncUiPrefsFromServer(){
  try{
    const p = await dbFetch(userPath('ui_prefs')).then(r=>r.json());
    if(applyUiPrefs(p)){
      if(document.getElementById('clusterSliderBar')) initClusterSlider();
      if(document.getElementById('dupSliderBar')) initDupSlider();
      if(document.getElementById('relSliderBar')) initRelevanceSlider();
      if(document.getElementById('synSliderBar')) initSynonymSlider();
      renderOutletScopeToggle();
      syncFilterPanel();
      renderAllNewsViews();
    }
  }catch(e){}
}

/* 기타 언론사 구독 — 팀 공유. /custom_feeds = {id: {name, url, addedAt, deadSince}} */
newsState.customFeeds = {};
async function loadCustomFeeds(){
  try{
    const res = await dbFetch(`${FIREBASE_URL}/custom_feeds.json`);
    const data = await res.json();
    newsState.customFeeds = (data && typeof data === 'object') ? data : {};
  }catch(e){ newsState.customFeeds = {}; }
}
async function saveCustomFeed(id, feed){
  newsState.customFeeds[id] = feed;
  try{
    await dbFetch(`${FIREBASE_URL}/custom_feeds/${id}.json`, {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(feed)
    });
  }catch(e){ console.warn('[구독 피드 저장 실패]', e); }
}
async function deleteCustomFeed(id){
  delete newsState.customFeeds[id];
  try{ await dbFetch(`${FIREBASE_URL}/custom_feeds/${id}.json`, {method:'DELETE'}); }catch(e){}
}
function customFeedList(){
  return Object.entries(newsState.customFeeds)
    .map(([id, f])=>({id, ...f}))
    .sort((a,b)=> (a.addedAt||0) - (b.addedAt||0));
}
/* 수집 성공/실패로 피드 생존 상태를 기록. 죽으면 deadSince, 살아나면 해제. 자동 삭제는 안 함. */
function markCustomFeedHealth(id, ok){
  const f = newsState.customFeeds[id];
  if(!f) return;
  if(ok && f.deadSince){ f.deadSince = null; saveCustomFeed(id, f); }
  else if(!ok && !f.deadSince){ f.deadSince = Date.now(); saveCustomFeed(id, f); }
}

/* fetch + 타임아웃 — 죽은 프록시 연결이 몇 분씩 매달려 수집 전체를 잡는 걸 막는다.
   Promise.all은 가장 느린 요청을 기다리므로 이 가드가 없으면 한 피드가 전체를 인질로 잡음. */
function fetchWithTimeout(url, opts, ms){
  ms = ms || 6000;
  const ctrl = new AbortController();
  const timer = setTimeout(()=> ctrl.abort(), ms);
  return fetch(url, {...(opts||{}), signal: ctrl.signal})
    .finally(()=> clearTimeout(timer));
}

/* 동시 실행 개수를 제한하는 작업 풀 — 선형 지연(idx*400) 대신 사용.

async function fetchFeedViaAllOrigins(feed){
  const sep = feed.url.includes('?') ? '&' : '?';
  const busted = `${feed.url}${sep}_cb=${Date.now()}`;
  const res = await fetchWithTimeout(`https://api.allorigins.win/raw?url=${encodeURIComponent(busted)}`, {cache:'no-store'}, 7000);
  if(!res.ok) throw new Error('allorigins 수집 실패');
  return parseFeedXml(await res.text(), feed);
}

/* 1순위 — 사장님 Cloudflare Worker(/rss 중계). 무료 프록시(codetabs/allorigins/rss2json)가
   CORS·429로 전멸해서 Worker를 앞에 둔다.
   ※ 원문 URL에 _cb 캐시버스터를 붙이지 않는다 — 일부 피드(연합·한경)가 예상치 못한
     쿼리 파라미터에 502를 냄. Worker가 no-store로 응답하고 cf 캐시도 60초라 신선도 충분. */
async function fetchFeedViaWorker(feed){
  const res = await fetchWithTimeout(`${JUNGLE_CONFIG.naverProxyUrl}/rss?url=${encodeURIComponent(feed.url)}`, {cache:'no-store'}, 6000);
  if(!res.ok) throw new Error('Worker RSS 중계 실패 ' + res.status);
  return parseFeedXml(await res.text(), feed);
}

async function fetchOneFeed(feed){
  let lastErr;
  // 1순위 Worker(사장님 자기 Cloudflare Worker)가 거의 항상 됨. 폴백은 죽은 무료 프록시라
  // 오래 매달리기만 하므로 각 시도에 타임아웃을 걸고, rss2json(429 잦음)은 맨 뒤로.
  for(const fn of [fetchFeedViaWorker, fetchFeedViaAllOrigins, fetchFeedViaRss2json]){
    try{ return await fn(feed); }
    catch(e){ lastErr = e; }
  }
  throw lastErr || new Error('모든 경로 실패');
}


function parseFeedXml(text, feed){
  const xml = new DOMParser().parseFromString(text, 'text/xml');
  if(xml.querySelector('parsererror')) throw new Error('XML 파싱 실패');

  const items = Array.from(xml.querySelectorAll('item, entry')).slice(0, 20);
  if(items.length === 0) throw new Error('기사 없음');

  return items.map(it=>{
    const get = (tag) => it.querySelector(tag)?.textContent?.trim() || '';
    let link = get('link');
    if(!link){
      link = it.querySelector('link')?.getAttribute('href') || '';
    }
    link = canonicalizeLink(link);
    const pubDate = get('pubDate') || get('pubdate') || get('published') || get('updated') || get('dc\\:date');
    const desc = get('description') || get('summary') || get('content');
    const fullText = stripHtml(desc);
    return {
      title: get('title'),
      link,
      pubDate,
      source: feed.name,
      fullText,
      excerpt: fullText.slice(0,500)
    };
  }).filter(a=>a.title && a.link);
}

async function fetchFeedViaRss2json(feed){
  const proxyUrl = `https://api.rss2json.com/v1/api.json?rss_url=${encodeURIComponent(feed.url)}`;
  const res = await fetchWithTimeout(proxyUrl, {}, 7000);
  const data = await res.json();
  if(data.status !== 'ok') throw new Error(data.message || '수집 실패');
  return (data.items||[]).slice(0,20).map(it=>{
    const fullText = stripHtml(it.description || it.content || '');
    return {
      title: (it.title||'').trim(),
      link: canonicalizeLink(it.link),
      pubDate: it.pubDate,
      source: feed.name,
      fullText,
      excerpt: fullText.slice(0,500)
    };
  });
}

function parseArticleDate(dateStr){
  if(!dateStr) return NaN;
  let t = new Date(dateStr).getTime();
  if(!isNaN(t)) return t;

  const s = String(dateStr).trim().replace(/\./g, '-').replace(/-\s+/g, '-').replace(/\s+/g, ' ');
  t = new Date(s).getTime();
  if(!isNaN(t)) return t;

  const m = s.match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if(m){
    t = new Date(`${m[1]}T${m[2]}+09:00`).getTime();
    if(!isNaN(t)) return t;
  }
  return NaN;
}
function safeArticleTime(dateStr){
  const t = parseArticleDate(dateStr);
  return isNaN(t) ? -Infinity : t;
}

function relTimeNews(dateStr){
  const t = parseArticleDate(dateStr);
  if(!dateStr || isNaN(t)) return '시간 미상';
  const diffMs = Date.now() - t;
  if(diffMs < -5*60000) return '시간 미상';
  const m = Math.floor(Math.max(diffMs,0)/60000);
  if(m<60) return `${m}분 전`;
  const h = Math.floor(m/60);
  if(h<24) return `${h}시간 전`;
  const d = Math.floor(h/24);
  if(d>365) return '시간 미상';
  return `${d}일 전`;
}

/* 한 키워드 그룹 안에서 동의어가 몇 개나 걸리는지(제목+요약문+본문). keywordHitCount(등록 키워드 개수)와는
   축이 다름 — 이건 "이 키워드 하나"의 동의어 3~6개 중 몇 개가 동시에 맞는지를 본다. */
function keywordTermHitCount(article, kw){
  const terms = kw.terms || [kw.label];
  const text = normalizeAbbrev(`${article.title||''} ${article.excerpt||''} ${article.fullText||''}`);
  let n = 0;
  for(const term of terms){
    if(termMatchesText(term, text)) n++;
  }
  return n;
}
/* 키워드 정확도(SYNONYM_STEPS, 실시간·관심뉴스 각자 값) — 등록된 동의어 중 최소 N개가 동시에
   나와야 매칭으로 인정. 그룹 크기(3~6개)보다 큰 값이면(동의어가 적은 키워드) 그룹 크기로 clamp. */
function keywordMatchesArticle(article, kw){
  const terms = kw.terms || [kw.label];
  const min = Math.min(SYNONYM_STEPS[_synonymStep].min, terms.length);
  return keywordTermHitCount(article, kw) >= min;
}


function renderAllNewsViews(){
  // 예전엔 5개 화면을 매번 다 다시 그렸음 — 지금 보고 있는 탭만 다시 그리도록 축소
  // (다른 탭은 그 탭으로 전환하는 순간 showNewsSubtab에서 새로 그려서 항상 최신 상태를 보장함)
  const tab = newsState.activeSubtab;
  if(tab === 'live') renderLiveFeed();
  else if(tab === 'important') renderImportantNews();
  else if(tab === 'keyword'){ renderKeywordToggleGrid(); renderKeywordResults(); }
  else if(tab === 'opcol') renderOpcolSubs();
}

