# 써니데스크 개통 가이드

이 문서는 **대신 해 주는 문서가 아니라, 직접 해 보게 하는 문서**예요.
서버, 계정, 키를 하나씩 만들면서 "이 앱이 어떻게 돌아가는지"를 몸으로 익히는 게 목표입니다.
막히면 Claude Code에게 "SETUP.md 3단계에서 이런 에러가 나요"라고 붙여넣으세요.

## 먼저 알아 둘 구조 (5분)

```
브라우저(이 앱) ──▶ Firebase Hosting      화면 파일을 내려줌
              ├─▶ Firebase Auth         구글 로그인
              ├─▶ Realtime Database     스크랩·메모·키워드·설정 저장
              ├─▶ Cloudflare Worker     네이버·RSS·페북 요청을 대신 해 줌 (브라우저가 직접 못 하는 요청)
              ├─▶ YouTube Data API      유튜브 채널·영상 목록
              └─▶ Gemini API            기사·영상 요약
```

- 값은 전부 `config.js` 한 파일에 모읍니다. `YOUR_`로 시작하거나 비어 있는 값이 아직 안 채운 곳이에요.
- 서버(Worker)는 "중간 심부름꾼"이에요. 네이버 키 같은 비밀은 브라우저가 아니라 Worker 안에 둡니다.

## 0. 준비물

| 도구 | 설치 확인 |
|---|---|
| Node.js 20 이상 | `node -v` |
| Git | `git --version` |
| Firebase CLI | `npm i -g firebase-tools` → `firebase --version` |
| 계정 | 구글 계정, Cloudflare 계정(무료), 네이버 계정 |

저장소를 받고 패키지를 설치합니다.

```bash
git clone <이 저장소 주소> sunnydesk
cd sunnydesk
npm install
```

## 1. Firebase 프로젝트 만들기 (로그인 + 데이터 저장)

1. https://console.firebase.google.com → **프로젝트 추가**. 이름은 자유(예: `sunnydesk-내이름`). 이 이름이 `YOUR_PROJECT_ID`가 됩니다.
2. **Authentication** → 시작하기 → 로그인 방법 → **Google** 사용 설정.
3. **Realtime Database** → 데이터베이스 만들기 → 위치 `asia-southeast1(싱가포르)` → 잠금 모드로 시작.
4. **Firestore Database** → 데이터베이스 만들기 (SNS 탭의 인물 정보를 저장해요).
5. **프로젝트 설정 → 일반 → 내 앱 → 웹 앱(</>) 추가**. 나오는 `firebaseConfig` 값을 `config.js`의 `firebase: {...}`에 넣고, 같은 화면의 Realtime Database 주소를 `rtdbUrl`에 넣습니다.
6. 아래 세 군데도 같은 프로젝트로 맞춥니다 (이 파일들은 `config.js`를 못 읽어서 값이 따로 박혀 있어요).
   - `people.html` 안 `firebaseConfig` 안의 `YOUR_`로 시작하는 값 전부
   - `sns-tool.html` 안 `firebaseConfig` 안의 `YOUR_`로 시작하는 값 전부
   - `.firebaserc` 안 `YOUR_PROJECT_ID`
7. 로그인 허용 도메인: Authentication → 설정 → **승인된 도메인**에 `YOUR_PROJECT_ID.web.app`이 있는지 확인.
8. 보안 규칙 올리기:
   ```bash
   firebase login
   firebase deploy --only database,firestore --project YOUR_PROJECT_ID
   ```

> 확인: 여기까지 하면 이 앱이 "누가 로그인했는지" 알고, 데이터를 저장할 수 있는 상태예요.

## 2. Cloudflare Worker 올리기 (서버 심부름꾼)

1. https://dash.cloudflare.com 가입 → 오른쪽 위 계정 이름에서 **workers.dev 서브도메인**을 정합니다 (예: `sunny`). 이게 `YOUR-ACCOUNT`예요.
2. `worker-rss-relay.js` 맨 위 `ALLOWED_ORIGINS`의 `YOUR_PROJECT_ID`를 1단계의 이름으로 바꿉니다. (내 사이트에서 온 요청만 받겠다는 뜻이에요.)
3. 배포:
   ```bash
   npx wrangler login
   npx wrangler deploy worker-rss-relay.js --name naver-news-proxy --compatibility-date 2026-06-01
   ```
4. 나온 주소(`https://naver-news-proxy.YOUR-ACCOUNT.workers.dev`)를 앱에 알려 줍니다. 아래 파일에서 `YOUR-ACCOUNT`를 찾아 바꾸세요.
   ```bash
   grep -rn "YOUR-ACCOUNT" --include=*.js --include=*.html . --exclude-dir=node_modules --exclude-dir=dist
   ```
   (`config.js`, `recommend.js`, `app-opcol.js`, `people.html`, `sns-tool.html`)

> 참고: Worker를 고쳐서 다시 올릴 때는 반드시 `--keep-vars`를 붙이세요. 안 붙이면 3단계에서 넣을 키가 지워져요.

## 3. 네이버 API 키 (뉴스 검색)

1. https://developers.naver.com → 로그인 → **Application → 애플리케이션 등록**.
2. 사용 API: **검색**, **데이터랩(검색어 트렌드)**. (데이터랩은 신피디에서 쓸 때만 필요해요.)
3. 나온 Client ID / Client Secret을 Worker에 **비밀값**으로 넣습니다. 코드에 쓰지 않아요.
   ```bash
   npx wrangler secret put NAVER_CLIENT_ID --name naver-news-proxy
   npx wrangler secret put NAVER_CLIENT_SECRET --name naver-news-proxy
   ```

## 4. YouTube Data API 키

1. https://console.cloud.google.com → 프로젝트 선택(Firebase가 만든 프로젝트 그대로 써도 됩니다).
2. **API 및 서비스 → 라이브러리 → YouTube Data API v3 → 사용**.
3. **사용자 인증 정보 → 사용자 인증 정보 만들기 → API 키**.
4. **키 제한**: 애플리케이션 제한을 "웹사이트"로 하고 `https://YOUR_PROJECT_ID.web.app/*`만 허용. (키가 화면 코드에 들어가므로 꼭 제한하세요.)
5. `config.js`의 `googleApiKey`에 넣습니다.

하루 쿼터는 10,000유닛이에요. 채널 목록 조회는 가볍지만 검색은 비싸니(100유닛) 이 숫자를 기억해 두세요.

## 5. Gemini API 키 (요약)

1. https://aistudio.google.com/apikey → **API 키 만들기** (무료 등급으로 시작).
2. `config.js`의 `geminiApiKey`에 넣습니다.
3. 같은 키를 `people.html`의 `GEMINI_API_KEY_DB`, `sns-tool.html`의 `GEMINI_API_KEY_XFEED`에도 넣습니다.
4. 무료 등급은 하루 호출 수가 정해져 있어요. 요약이 갑자기 안 되면 한도 소진부터 의심하세요.

## 6. (선택) SNS 수집용 쿠키

X·페이스북 글 수집은 공식 API가 아니라 **로그인 쿠키 방식**이라 가끔 끊깁니다. 필요할 때만 하세요.

- 페이스북: 쿠키를 `npx wrangler secret put FB_COOKIE --name naver-news-proxy`
- X: `x-analysis/worker/`의 Worker를 따로 올립니다.
  ```bash
  cd x-analysis/worker
  npx wrangler secret put AUTH_TOKEN
  npx wrangler secret put CT0
  npx wrangler deploy
  ```
  (`x-search-worker.js` 맨 위 `ALLOWED_ORIGINS`도 바꾸고, 앱의 `x-search-worker.YOUR-ACCOUNT` 주소도 바꿉니다.)

쿠키는 비밀번호와 같아요. 절대 코드나 GitHub에 쓰지 마세요.

## 7. 검사하고 올리기

```bash
npm run check     # 문법·참조 검사 + 빌드. 실패하면 올리지 마세요
npm run build     # dist/ 만들기 (빼먹으면 옛 화면이 올라가요)
firebase deploy --only hosting --project YOUR_PROJECT_ID
```

`https://YOUR_PROJECT_ID.web.app` 에 접속해 구글 로그인이 되면 성공입니다.
**첫 번째로 로그인한 계정이 마스터**가 됩니다.

## 8. 첫 실행 후 할 일 (앱 안에서)

1. **설정 → 언론사**: 구독할 언론사를 고르세요. 이 앱은 구독한 언론사 기사만 보여 줍니다.
2. **설정 → 언론사 → 직접 RSS 등록**: 외신 RSS를 넣으세요.
3. **뉴스 → 키워드**: 관심 키워드를 등록하세요.
4. **유튜브 모니터링**: 볼 채널을 추가하세요.
5. `config.js`의 `broadcastTimes`를 내 방송 시간으로 바꾸세요.

## 키와 공개 저장소 (중요)

- Firebase `apiKey`는 원래 화면 코드에 들어가는 값이라 공개돼도 괜찮아요. 대신 **보안 규칙**(1-8)이 지켜 줍니다.
- Gemini·YouTube 키는 **공개 저장소에 올리면 누가 쓸 수 있어요.** 키를 채운 `config.js`를 공개 저장소에 푸시하지 마세요. 내 저장소는 비공개로 만들거나, 키는 올리지 않는 방식을 쓰세요.
- 네이버 키와 쿠키는 처음부터 코드에 없습니다(Worker 비밀값). 그대로 두세요.
- 실수로 올렸다면 지우는 것만으로는 부족해요. **키를 폐기하고 새로 발급**하세요.

## 자주 막히는 곳

| 증상 | 확인 |
|---|---|
| 로그인 창이 안 뜸 / 에러 | 1-5의 `config.js` 값, 1-7 승인된 도메인 |
| 뉴스가 하나도 안 옴 | 2단계 Worker 주소와 `ALLOWED_ORIGINS`, 3단계 네이버 키 |
| 브라우저 콘솔에 CORS 오류 | `ALLOWED_ORIGINS`에 내 사이트 주소가 있는지, 배포했는지 |
| 유튜브 목록이 비어 있음 | 4단계 키 제한 주소, 쿼터 |
| 요약이 안 됨 | 5단계 키, 하루 한도 |
| 고쳤는데 화면이 그대로 | `npm run build`를 했는지, 브라우저 강력 새로고침 |
