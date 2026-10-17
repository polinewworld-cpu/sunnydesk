/* ============================================================
   써니데스크 설정 파일 — 여기 값을 SETUP.md 순서대로 하나씩 채운다.
   'YOUR_'로 시작하거나 비어 있는 값이 아직 안 채운 곳이다.
   ============================================================ */

const JUNGLE_CONFIG = {

  /* ---------- 브랜딩 ---------- */
  siteName: '써니데스크',
  ourYoutubeHandle: '',   // 신피디: 우리 유튜브 채널 핸들(예 '@xxxx'). 비워 두면 유튜브 탭 등록 채널 → 이름 검색 순으로 찾음
  brandLabel: 'SunnyDesk',

  /* ---------- Firebase ---------- */
  firebase: {
    apiKey: "YOUR_FIREBASE_API_KEY",
    authDomain: "YOUR_PROJECT_ID.firebaseapp.com",
    projectId: "YOUR_PROJECT_ID",
    storageBucket: "YOUR_PROJECT_ID.firebasestorage.app",
    messagingSenderId: "YOUR_SENDER_ID",
    appId: "YOUR_APP_ID"
  },

  /* Realtime Database (Firestore 이관 전까지 사용) */
  rtdbUrl: 'https://YOUR_PROJECT_ID-default-rtdb.REGION.firebasedatabase.app',

  /* ---------- Google API (유튜브 + 캘린더 공용) ---------- */
  googleApiKey: '',   // YouTube Data API 키(SETUP.md 4단계)

  /* ---------- 네이버 검색 프록시 ---------- */
  naverProxyUrl: 'https://naver-news-proxy.YOUR-ACCOUNT.workers.dev',

  /* 2026-10-07: 요약용 키를 새 구글 프로젝트로 분리했다(옛 키가 정글2·JK·떠든 사람들·X 정리와 한도 500건/일을 같이 쓰다 소진).
     옛 키는 people.html(떠든 사람들)·sns-tool.html(X 정리)에 그대로 남아 있어 그쪽 한도와 요약 한도가 이제 따로다. */
  /* ---------- Gemini API (스크랩 자동요약) ----------
     클라이언트에서 직접 호출(Cloudflare Worker 경유 시 지역차단 에러가 잦아 2026-09-17 변경).
     무료 티어 키라 노출돼도 비용 위험은 없음(최악의 경우 일일 한도 소진). */
  geminiApiKey: '',

  /* ---------- 계정 슬롯 ---------- */
  slotCount: 2,   // 이 앱에서 허용하는 구글 계정 수(선착순). 초과 시 신규 로그인 거부

  /* ---------- SNS 모니터링 데이터 분리 키 ----------
     SNS 모니터링(국회의원·일반인)의 계파·태그·티어·커스텀 인물은 이 값 단위로 공유된다.
     = 고객사 단위. 같은 고객사의 모든 계정이 같은 데이터를 본다. 고객사마다 달라야 함. */
  snsClient: 'sunnydesk',

  /* ---------- 스크랩 탭 팀원 보기 ----------
     스크랩 탭 왼쪽 위의 [내 탭 | 팀원 탭]. email 계정이 이 앱에 등록돼 있으면 label 이름의 탭으로 나온다. 내 계정이 목록에 있으면 내 탭 이름도 label을 쓴다.
     (순서는 항상 내 탭이 맨 앞) */
  scrapPeers: [],

  /* ---------- 개발 도구 ---------- */
  devTools: true,   // 사이드바 "성능확인" 노출 여부

  /* ---------- 페이스북 임베드(스크랩) ---------- */
  fbAppId: '',    // 있으면 FB SDK init에 사용(공개 게시물 임베드는 없어도 대체로 동작)

  /* ---------- 갱신 주기 ---------- */
  refreshIntervalMs: 5 * 60 * 1000,   // 자동 폴링 및 수동 갱신 최소 간격

  /* ---------- 캘린더 ---------- */
  calendarId: '',
  calendarWindowDays: 7,

  /* ---------- 방송 카운트다운 ----------
     주말(토·일)은 항상 휴방 처리(app.js updateClock). skipWeekdays는 그 외 요일별 추가 휴방(0=일 ~ 6=토). */
  broadcastTimes: [
    { hour: 20, minute: 0, label: '저녁 방송', skipWeekdays: [] }   // 예시 — 써니의 실제 방송 시간으로 바꾸세요
  ],

  /* ---------- 유튜브 탭 정의 ---------- */
  youtubeTabs: [
    { id: 'default', label: '내 채널들' }   // 카테고리(탭)는 여기서 늘린다. id는 영문, label은 화면에 보이는 이름
  ],

  /* ---------- 유튜브 기본 채널 ---------- */
  youtubeDefaultChannels: {
    default: []
  },

  /* ---------- 기본 키워드 ---------- */
  defaultKeywords: [],

  /* ---------- 초기 구독 언론사 ----------
     신규 계정이 처음 로그인할 때 이 목록으로 구독을 채운다(언론사명 기준, base name).
     빈 배열이면 아무것도 구독하지 않은 상태로 시작하고, 사용자가 설정 탭에서 직접 고른다. */
  defaultSubscribedOutlets: [],

  /* ---------- RSS 피드 (2계층 구조) ----------
     national: 공통 전국지 (모든 고객사 공유)
     local:    고객사 지역지 추가분 (고객사마다 다름)
     실제 수집 시: [...JUNGLE_CONFIG.rssFeeds.national, ...JUNGLE_CONFIG.rssFeeds.local] */
  rssFeeds: {
    national: [],
    local: []
  },

  /* ---------- 탭 표시 여부 ---------- */
  tabs: {
    news:      true,
    youtube:   true,
    sns:       true,
    notice:    true,
    memo:      true,
    canva:     true,
    studio:    true
  },

  /* ---------- 외부 링크 (없으면 해당 탭 미표시) ----------
     가피메모·후니메모는 2026-09-05부로 자체 "메모" 기능(개인 전용)으로 대체돼 제거됨. */
  links: {
    canva:     '',
    studio:    ''
  }
};