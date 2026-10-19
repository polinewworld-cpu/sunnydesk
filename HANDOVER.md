# 써니데스크 인수인계 — 처음 시작하는 순서

안녕하세요 써니님!

써니데스크는 뉴스·유튜브·SNS를 한곳에서 모아 보고, 스크랩해서 리포트까지 쓰는 웹앱이에요.
이 앱은 써니님이 **직접 만져 보면서 바이브코딩을 배우는 용도**로 드리는 거예요. 한 번에 다 하지 않아도 됩니다. 순서대로, 한 단계씩 같이 해 봐요. 잘 안 되는 건 사장님께 물어보면 돼요.

---

## 이 문서를 읽는 Claude에게 (진행 규칙)

써니님은 코딩이 처음인 왕초보입니다. 아래 규칙을 지켜 주세요.

1. **한 번에 한 단계, 한 가지만** 안내합니다. 여러 단계나 여러 질문을 한꺼번에 뿌리지 않습니다. 써니님이 "됐어요"라고 하면 다음 단계로 갑니다.
2. 쉬운 말로 짧게 씁니다. 처음 나오는 용어는 한 줄로 풀어 줍니다.
3. **콘솔·웹사이트의 메뉴 이름과 주소를 기억으로 단정하지 않습니다.** Firebase, Cloudflare, 네이버 같은 화면은 자주 바뀝니다. 써니님께 **화면 캡처를 부탁하고, 화면에 실제로 보이는 버튼 이름으로** 안내합니다. 주소(URL)도 추측하지 않습니다.
4. 키·비밀번호·쿠키는 GitHub와 코드 파일에 쓰지 않습니다. 네이버 키는 `wrangler secret put` 입력창에 써니님이 직접 붙여넣게 합니다(채팅에도 붙이지 않게 안내).
5. 파일을 고치기 전에 `git commit`으로 지금 상태를 저장하게 합니다. 되돌릴 수 있어야 마음 놓고 해 볼 수 있어요.
6. 로그인이 필요한 화면은 Claude가 직접 못 봅니다. "됐다"고 단정하지 말고 써니님이 브라우저에서 확인하게 합니다.
7. 막히면 억지로 우회하지 말고 멈춰서 "사장님께 물어보세요"라고 안내합니다.
8. 각 단계가 끝날 때마다 이 문서 맨 아래 **진행 기록**의 체크를 갱신합니다.

---

## 지금 상태 (사장님이 해 둔 것)

- 코드: https://github.com/polinewworld-cpu/sunnydesk (키·개인정보는 모두 비워져 있어요)
- **임시 Firebase 프로젝트 `sunny-desk`** (사장님 계정). 앱 주소는 `https://sunny-desk.web.app` 이에요. 구글 로그인, 데이터베이스(Realtime Database·Firestore), 보안 규칙까지 켜 둔 상태이고, **나중에 써니님이 자기 걸로 바꾸는 것이 목표**예요.
- **아직 비어 있는 것**: 서버(Cloudflare Worker), 네이버 키, YouTube 키, Gemini 키. 그래서 지금은 로그인만 되고 뉴스는 안 나와요.
- 화면에서 숨겨 둔 메뉴가 있어요(여론, 공지사항, 관심 탭 등). 자세한 건 `CLAUDE.md`를 보세요.
- 아직 안 한 것: 국내정치/외신 탭 분리, 유튜브 카테고리 자유 만들기, 신피디. **이건 처음에 건드리지 않아요.** 사장님과 상의한 뒤에 합니다.

---

## 단계 (이 순서대로)

### 0단계. 도구 준비
- Node.js(20 이상), Git, Claude Code가 설치돼 있는지 확인합니다. 터미널에서 `node -v`, `git --version`.
- 없으면 하나씩 설치합니다.

### 1단계. 코드 받기
```
git clone https://github.com/polinewworld-cpu/sunnydesk
cd sunnydesk
npm install
npm run check
```
`npm run check`가 `✓ 모두 통과`로 끝나면 성공입니다.

### 2단계. 앱에 첫 로그인
- `https://sunny-desk.web.app` 을 열어 구글 로그인을 해 봅니다.
- **먼저 로그인한 사람이 어드민(마스터)** 이 되고, 자리는 2명까지예요. 사장님이 이미 확인용으로 들어가셨는지 사장님께 먼저 물어보세요. 써니님이 어드민이 되려면 써니님이 먼저 들어가야 합니다.
- 로그인이 안 되면 여기서 멈추고 사장님께 알려 주세요(서버 배포가 아직일 수 있어요).

### 3단계. 서버(Cloudflare Worker) 올리기
Worker는 브라우저 대신 네이버·RSS 같은 곳에 요청을 해 주는 "심부름꾼 서버"예요.

1. https://dash.cloudflare.com 에 무료 가입합니다. 가입 후 `workers.dev` 서브도메인(내 주소)을 정하게 돼요. 이게 `YOUR-ACCOUNT` 자리에 들어갑니다.
2. 터미널에서:
   ```
   npx wrangler login
   npx wrangler deploy worker-rss-relay.js --name naver-news-proxy --compatibility-date 2026-06-01
   ```
3. 나온 주소(`https://naver-news-proxy.내서브도메인.workers.dev`)를 앱에 알려 줍니다. `YOUR-ACCOUNT`를 찾아 바꿔요.
   ```
   grep -rn "YOUR-ACCOUNT" --include=*.js --include=*.html . --exclude-dir=node_modules --exclude-dir=dist
   ```
   (`config.js`, `recommend.js`, `app-opcol.js`, `people.html`, `sns-tool.html`)
4. 바꾼 뒤 앱을 다시 올려야 합니다. 이때 **Firebase 배포 권한**이 필요해요.
   - 사장님께 "Firebase 콘솔에서 제 구글 계정을 `sunny-desk` 프로젝트의 소유자(또는 편집자)로 초대해 주세요"라고 요청합니다.
   - 초대받으면:
     ```
     npm i -g firebase-tools
     firebase login
     npm run check
     npm run build
     firebase deploy --only hosting --project sunny-desk
     ```
5. 확인: `https://sunny-desk.web.app` → **뉴스 모니터링 → 실시간**에 기사가 나오는지 봅니다. 설정 → 언론사에서 구독할 언론사를 고르세요(구독한 언론사 기사만 보여요).

> 이 Worker는 `sunny-desk` 주소에서 온 요청만 받도록 돼 있어요(`worker-rss-relay.js` 위쪽 `ALLOWED_ORIGINS`). 나중에 Firebase 프로젝트를 바꾸면 여기도 바꿔야 해요.

### 4단계. 네이버 API 키 (키워드 검색용)
**키워드로 기사를 찾는 기능**은 네이버 키가 있어야 해요. (실시간 탭은 키 없이도 나옵니다.)

- 쓰는 곳은 네이버 **개발자센터가 아니라 "네이버 클라우드(NAVER Cloud Platform)의 NAVER API HUB"** 예요. 앱 코드가 `naverapihub.apigw.ntruss.com` 으로 요청하기 때문입니다.
- 네이버 클라우드에 가입해 NAVER API HUB에서 **뉴스 검색**을 쓸 수 있는 애플리케이션을 등록하고, **Client ID와 Secret**을 받습니다. 가입이나 등록 중에 결제수단·본인 인증을 요구할 수 있으니, 화면에 보이는 대로 따라가되 **모르겠으면 사장님께 먼저 물어보세요.** 무료 구간이 있는지도 화면에서 확인합니다.
- 받은 키를 Worker에 비밀값으로 넣습니다(입력창이 뜨면 값을 붙여넣어요).
  ```
  npx wrangler secret put NAVER_CLIENT_ID --name naver-news-proxy
  npx wrangler secret put NAVER_CLIENT_SECRET --name naver-news-proxy
  ```
- 확인: 앱의 **키워드** 탭에서 키워드를 하나 등록하고 기사가 나오는지 봅니다.

### 5단계. 앱 안에서 내 것으로 채우기
- **설정 → 언론사**: 구독할 언론사 고르기. 외신은 같은 곳에서 **직접 RSS 등록**.
- **뉴스 → 키워드**: 관심 키워드 등록.
- **유튜브 모니터링**: 볼 채널 추가.

### 6단계. YouTube 키 (유튜브 모니터링)
- Google Cloud 콘솔에서 **YouTube Data API v3**를 켜고 API 키를 만듭니다. 키 **제한**을 걸어 내 사이트 주소(`https://sunny-desk.web.app/*`)에서만 쓰이게 합니다.
- `config.js`의 `googleApiKey`에 넣습니다.
- ⚠️ **키를 넣은 `config.js`는 이 공개 저장소에 올리지 마세요.** 키를 넣은 뒤에는 자기 GitHub에 **비공개(Private) 저장소**를 만들어 거기에만 올리세요.

### 7단계. Gemini 키 (요약)
- https://aistudio.google.com 에서 API 키를 만들어 `config.js`의 `geminiApiKey`에 넣습니다. 같은 키를 `people.html`의 `GEMINI_API_KEY_DB`, `sns-tool.html`의 `GEMINI_API_KEY_XFEED`에도 넣습니다. 6단계의 ⚠️ 주의가 똑같이 적용돼요.

### 8단계. 그다음에 (천천히)
- SNS(X·페북 쿠키) 켜기: `SETUP.md` 6단계.
- 국내정치/외신 탭 분리, 유튜브 카테고리 만들기: 사장님과 먼저 상의.
- `CLAUDE.md`의 "숨겨 둔 것"을 하나씩 지워 보며 코드 구조 익히기.
- 신피디: 마지막에 따로 기획해요.
- **내 Firebase로 옮기기**: `SETUP.md` 1단계를 내 계정으로 하고 값을 바꿉니다(`CLAUDE.md`의 "지금 연결된 Firebase" 참고). 또는 사장님이 소유권을 넘겨 줄 수도 있어요.

---

## 막힐 때

| 증상 | 먼저 볼 것 |
|---|---|
| 로그인이 안 돼요 | 사장님 서버 배포 여부, 자리(2명)가 다 찼는지 |
| 뉴스가 하나도 안 나와요 | 3단계 Worker 주소, 다시 배포했는지, 브라우저 콘솔의 CORS 오류 |
| 키워드를 등록해도 기사가 안 나와요 | 4단계 네이버 키가 맞는지 |
| 고쳤는데 화면이 그대로예요 | `npm run build` 후 배포했는지, 강력 새로고침 |
| 뭐가 뭔지 모르겠어요 | 멈추고 사장님께 물어보기 |

더 자세한 설명은 `SETUP.md`(서비스별 만드는 법)와 `CLAUDE.md`(코드 구조)에 있어요.

---

## 진행 기록 (Claude가 갱신)

- [ ] 0 도구 준비
- [ ] 1 코드 받기·check 통과
- [ ] 2 첫 로그인
- [ ] 3 Worker 올리기·앱 재배포·실시간 뉴스 확인
- [ ] 4 네이버 API HUB 키·키워드 검색 확인
- [ ] 5 언론사 구독·키워드·유튜브 채널
- [ ] 6 YouTube 키
- [ ] 7 Gemini 키
- [ ] 8 이후 과제 (사장님과 상의)
