# 써니데스크 (Claude Code용 프로젝트 안내)

정치·사회·국제·문화예술 뉴스와 유튜브·SNS를 한곳에서 모니터링하고, 스크랩해 리포트까지 쓰는 개인용 웹앱.
**주인(써니)이 바이브코딩을 배우면서 직접 고쳐 나가는 프로젝트**다. 코드를 대신 고쳐 주기보다, 무엇을 왜 바꾸는지 짧게 설명하고 한 번에 한 가지씩 바꾼다.
처음 개통하는 중이면 **`HANDOVER.md`를 먼저 읽고**(한 번에 한 단계씩 안내하는 규칙과 순서가 있다), 서비스별 상세는 `SETUP.md`를 본다.

## 지금 연결된 Firebase
- 지금은 **임시 프로젝트 `sunny-desk`**(앱 주소 `https://sunny-desk.web.app`)에 연결돼 있다. 써니가 자기 프로젝트로 바꿀 때는 `SETUP.md` 1단계를 자기 계정으로 다시 하고, 아래 값을 바꾼다: `config.js`(firebase, rtdbUrl), `people.html`·`sns-tool.html`의 `firebaseConfig`, `.firebaserc`, `worker-rss-relay.js`·`x-analysis/worker/x-search-worker.js`의 `ALLOWED_ORIGINS`.
- 프로젝트 소유권을 써니에게 넘기는 방법도 있다(Firebase 콘솔 > 설정 > 사용자 및 권한에서 소유자 추가).

## 작업 규칙
- 큰 변경은 바로 코딩하지 말고, 무엇을 어떻게 바꿀지 먼저 말해서 확인받는다.
- 고치기 전에 `git commit`으로 지금 상태를 저장해 둔다. 되돌릴 수 있어야 마음 놓고 실험한다.
- 배포 순서: `npm run check`(통과해야 함) → `npm run build` → `firebase deploy --only hosting --project <프로젝트ID>`. `build`를 빼먹으면 옛 화면이 올라간다.
- 키·쿠키·비밀번호는 코드와 GitHub에 쓰지 않는다. 네이버 키와 SNS 쿠키는 Worker 비밀값(`wrangler secret put`)에만 둔다.
- 로그인이 필요한 화면은 Claude가 직접 테스트할 수 없다. "됐다"고 단정하지 말고 써니가 브라우저에서 확인한다.
- 이 앱을 만든 쪽에서 정글2라는 원본이 계속 바뀌지만, 이 저장소는 독립 사본이다. 원본 변경은 자동으로 들어오지 않는다.

## 구조 한눈에
- `config.js` 개인 설정 한 곳(Firebase, 키, 방송 시간, 유튜브 탭, 링크).
- `index.html` 화면 뼈대. 스크립트 로딩 순서: `config.js → app-*.js → recommend.js → notice.js → pillnav.js` (바꾸면 안 됨).
- `app-*.js` 본체. **전역 스코프를 공유하고 로드 순서가 고정**이다. 새 파일을 만들면 `index.html`, `scripts/build.mjs`, `scripts/check.mjs`(`APP_FILES`) 세 곳에 추가한다.

| 파일 | 하는 일 |
|---|---|
| `app-core.js` | 구글 로그인·계정, 시계, 헬퍼, 유튜브 모니터링 |
| `app-news-data.js` | 기사 수집, 읽음 처리, 유사 기사 묶기, 슬라이더, 화면 설정 |
| `app-keywords.js` | 키워드·스크랩 저장 |
| `app-gemini.js` | Gemini 호출(스크랩 요약) |
| `app-news-feed.js` | 기사 카드·스와이프·목록 그리기·필터 |
| `app-news-view.js` | 검색, 뉴스 하위 탭 |
| `app-report-scrap.js` | 뉴스 리포트(인쇄·Word), 스크랩 추가 |
| `app-archive-memo.js` | 존안, 메모, 네이버 섹션 수집 |
| `app-settings.js` | 설정 화면 |
| `app-shell.js` | 화면 전환, 사이드바 메뉴, 헤더 |
| `app.js` | 모바일 서랍, 버튼 연결, `startApp`(맨 마지막) |
| `recommend.js` | 뉴스 추천 탭(여러 출처를 한 이슈로 묶기) |
| `app-shinpd*.js` | 신피디(이슈 브리핑). **아직 써니에 맞게 기획하지 않았다**(아래) |
| `people.html`, `sns-tool.html` | SNS 모니터링(iframe). `config.js`를 못 읽어서 값이 따로 박혀 있다 |
| `worker-rss-relay.js` | Cloudflare Worker 소스(네이버·RSS·페북 중계) |
| `x-analysis/worker/` | X 검색 Worker 소스 |
| `scripts/` | `npm run check`, `npm run build` |

- 팀 공유 데이터는 Realtime Database, 개인 데이터는 `/users/{uid}/` 아래에 저장된다. 브라우저 쪽은 REST 호출이다.
- `let/const` 최상위 변수는 `window.X`로 안 보인다. iframe끼리 공유하려면 `window.fn = …`으로 내보내야 한다.

## 이 앱의 현재 범위
- 사이드바: 뉴스 모니터링, 유튜브 모니터링, SNS 모니터링, 뉴스 리포트, 신피디, 메모, 설정(관리·언론사), 리셋.
- 뉴스 하위 탭: 실시간 / 추천 / 키워드 / 스크랩 / 존안. 기본은 **구독한 언론사 기사만** 본다.
- 스크랩과 메모는 절대 합치지 않는다(과거에 합쳤다가 사고가 났다).

## 숨겨 둔 것 (코드는 남아 있다) — 지우기 연습거리
HTML에 `data-sunny-hidden` 표시가 붙은 요소들이다. 화면에서만 숨겼고, 코드는 그대로다. 하나씩 완전히 지워 보면 구조가 보인다. 지울 때마다 `npm run check`로 확인한다.

| 숨긴 것 | 관련 코드 |
|---|---|
| 여론 모니터링 | `index.html #opinionApp`, `app-opinion.js` |
| 공지사항 | `index.html #noticeApp`, `notice.js` |
| 캔바·스튜디오(외부) | `index.html` 외부 그룹, `app.js`의 `modeCanvaBtn`/`modeStudioBtn` 부분 |
| 뉴스 '관심(세트)' 탭 | `subtabImportantBtn`, `app-keywords.js` 일부 |
| 뉴스 '사설칼럼' 탭 | `subtabOpcolBtn`, `app-opcol.js` |
| SNS '떠든 사람들' 탭 | `people.html #tabDebate` |
| 설정의 유형·불만·알고리즘 탭 | `app-settings.js` |
| 스크랩 팀원 보기 | `app-scrap-peer.js`(`config.js scrapPeers`가 빈 배열) |
| 방송 카운트다운(헤더·사이드바 "다음방송") | `index.html .gb-countdown`·`#sbCountdown`, `app-core.js updateClock`(`config.js broadcastTimes`가 빈 배열) |

## 아직 안 한 것 (써니와 정해야 한다)
1. **국내정치 / 외신 탭 분리**: 분야별로 키워드·구독·읽음이 따로 가야 한다. 외신은 직접 등록한 RSS로 묶는다. 지금은 분리돼 있지 않다.
2. **유튜브 카테고리를 써니가 자유롭게 만들기**: 지금 탭은 `config.js youtubeTabs`에 고정돼 있다. 뉴스추천 탭(`recommend.js`)과 신피디가 이 탭 목록을 읽으니 같이 확인해야 한다.
3. **신피디**: 마지막에 기획한다. 이름은 `써니사이드`로 바꾸고, 신상 카드(나이·성별·학력)와 얼굴 사진, "편집장님" 호칭은 뺐다(대화 상대는 "사용자"). 아직 **정치신세계용 정치 로직이 남아 있으니 믿고 쓰지 않는다**: ① `SP_CHANNEL_ID`(반이재명 시선 프롬프트, `app-shinpd.js`) ② 이슈를 정권 타격/방어/무관으로 가르고 '무관'이면 지워 버리는 로직(`app-shinpd.js` 480행 부근, 문화예술·사회 이슈가 전부 사라진다) ③ 방송 브리프 점수의 "정권 타격" 항목(`app-shinpd-brief.js`) ④ 이재명 X 직접 조회·SNS 탭(`app-shinpd.js`) ⑤ 딴지일보 베스트 수집(`app-shinpd.js`). 또 `config.js`의 `ourYoutubeHandle`(써니 채널 핸들)을 채워야 "우리 채널" 이력이 맞게 잡힌다. 메뉴는 설정 > 관리 > '사용할 메뉴'에서 끌 수 있다.
4. SNS 화면의 국회의원 명단은 기본값(`sns-tool.html INLINE_MEMBERS`)으로 시작한다. 계파·티어·메모는 비어 있다.
5. 뉴스 배제 필터(스포츠·종교·연예·증시·부동산)가 정치 위주로 설계돼 있어, 문화예술·사회 기사를 걸러 낼 수 있다. 분야를 넓히면 먼저 손볼 곳이다.

## 외부 연결
브라우저 → Cloudflare Worker `naver-news-proxy`(네이버 API·RSS·페북) / `x-search-worker`(X) → 각 서비스.
브라우저 → YouTube Data API, Gemini API(직접).
X·페북은 로그인 쿠키 방식이라 만료나 429로 끊길 수 있다. 결과가 갑자기 비면 쿠키부터 의심하고, 429는 우회하지 말고 15~30분 기다린다.
로컬(localhost)에서는 Worker CORS 때문에 뉴스·SNS가 실패하는 게 정상이다.
