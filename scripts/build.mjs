// 정글2 배포 빌드 스크립트.
// app-*.js(app.js를 영역별로 나눈 13개)/recommend.js/style.css/notice.js/config.js를 압축 + 파일명에 콘텐츠 해시를 붙여 dist/에 내놓는다.
// index.html의 <script src>/<link href>는 해시가 붙은 파일명으로 자동 치환된다.
// people.html·sns-tool.html은 내장된 <style>/<script>만 그 자리에서 압축하고(외부 참조 없음),
// 대신 index.html이 이 두 파일을 iframe으로 불러올 때 ?v=해시 쿼리를 붙여 캐시를 무효화한다.
//
// 캐시 전략: 해시가 붙는 산출물(js/css)은 firebase.json에서 max-age=1년 immutable로 캐시하고,
// html은 계속 no-cache로 남긴다 — 배포 즉시 index.html은 새로 받아지고, 그 안의 해시가 바뀐 파일만
// 다시 받아진다(안 바뀐 파일은 그대로 캐시에서 씀). "배포했는데 왜 안 바뀌었냐" 문제는 생기지 않는다.
import { readFileSync, writeFileSync, mkdirSync, rmSync, copyFileSync } from 'fs';
import { createHash } from 'crypto';
import { transformSync } from 'esbuild';

const ROOT = process.cwd();
const DIST = `${ROOT}/dist`;

rmSync(DIST, { recursive: true, force: true });
mkdirSync(DIST, { recursive: true });

function hashOf(content) {
  return createHash('sha256').update(content).digest('hex').slice(0, 10);
}
// charset:'utf8' 필수 — 기본값(ascii)이면 한글이 전부 \uXXXX 이스케이프로 부풀려져
// 오히려 원본보다 커진다(2026-09-17 빌드 중 실측: 121KB -> 147KB로 커지는 걸 보고 발견).
function minifyJs(code) {
  return transformSync(code, { minify: true, loader: 'js', charset: 'utf8' }).code;
}
function minifyCss(code) {
  return transformSync(code, { minify: true, loader: 'css', charset: 'utf8' }).code;
}
function safeMinifyInlineScripts(html) {
  return html.replace(/<script([^>]*)>([\s\S]*?)<\/script>/g, (whole, attrs, code) => {
    if (/\bsrc\s*=/.test(attrs)) return whole;   // 외부 스크립트 — 인라인 내용 없음
    if (!code.trim()) return whole;
    try { return `<script${attrs}>${minifyJs(code)}</script>`; }
    catch (e) { console.warn('  ! 인라인 <script> 압축 실패, 원본 유지:', e.message); return whole; }
  });
}
function safeMinifyInlineStyles(html) {
  return html.replace(/<style>([\s\S]*?)<\/style>/g, (whole, css) => {
    try { return `<style>${minifyCss(css)}</style>`; }
    catch (e) { console.warn('  ! 인라인 <style> 압축 실패, 원본 유지:', e.message); return whole; }
  });
}

// 1) 핵심 산출물(app.js / notice.js / config.js / style.css) — 압축 + 해시 파일명
const HASHED_SOURCES = [
  { file: 'app-core.js', loader: 'js' },
  { file: 'app-news-data.js', loader: 'js' },
  { file: 'app-keywords.js', loader: 'js' },
  { file: 'app-gemini.js', loader: 'js' },
  { file: 'app-news-feed.js', loader: 'js' },
  { file: 'app-opcol.js', loader: 'js' },
  { file: 'app-news-view.js', loader: 'js' },
  { file: 'app-scrap-peer.js', loader: 'js' },
  { file: 'app-report-scrap.js', loader: 'js' },
  { file: 'app-archive-memo.js', loader: 'js' },
  { file: 'app-settings.js', loader: 'js' },
  { file: 'app-shell.js', loader: 'js' },
  { file: 'app-opinion.js', loader: 'js' },
  { file: 'app-shinpd-data.js', loader: 'js' },
  { file: 'app-shinpd-algo.js', loader: 'js' },
  { file: 'app-shinpd-persona.js', loader: 'js' },
  { file: 'app-shinpd-ytk.js', loader: 'js' },
  { file: 'app-shinpd-brief.js', loader: 'js' },
  { file: 'app-shinpd-issue.js', loader: 'js' },
  { file: 'app-shinpd.js', loader: 'js' },
  { file: 'app.js', loader: 'js' },
  { file: 'recommend.js', loader: 'js' },
  { file: 'notice.js', loader: 'js' },
  { file: 'config.js', loader: 'js' },
  { file: 'pillnav.js', loader: 'js' },   // index.html·people.html 둘 다 참조
  { file: 'app-float.js', loader: 'js' }, // 글쓰기 플로팅 툴바 — index.html·people.html 둘 다 참조
  { file: 'app-special.js', loader: 'js' }, // 특수문자 모달(팩트파인더에서 복사) — index.html·people.html 둘 다 참조
  { file: 'style.css', loader: 'css' },
];
const renameMap = {};   // 원본 파일명 -> 해시 붙은 파일명 (index.html 참조 치환용)
for (const { file, loader } of HASHED_SOURCES) {
  const src = readFileSync(`${ROOT}/${file}`, 'utf8');
  const min = loader === 'js' ? minifyJs(src) : minifyCss(src);
  const hash = hashOf(min);
  const ext = file.slice(file.lastIndexOf('.') + 1);
  const base = file.slice(0, file.lastIndexOf('.'));
  const outFile = `${base}.${hash}.${ext}`;
  writeFileSync(`${DIST}/${outFile}`, min);
  renameMap[file] = outFile;
  console.log(`  ${file} -> ${outFile}  (${src.length} -> ${min.length} bytes, ${(100 - min.length / src.length * 100).toFixed(1)}% 감소)`);
}

// 2) index.html — 참조 치환 + 인라인 압축, sns 프레임 캐시버스팅용 해시도 계산해 둠
const peopleHash = hashOf(readFileSync(`${ROOT}/people.html`, 'utf8'));
const snsHash = hashOf(readFileSync(`${ROOT}/sns-tool.html`, 'utf8'));

let indexHtml = readFileSync(`${ROOT}/index.html`, 'utf8');
for (const [orig, hashed] of Object.entries(renameMap)) {
  indexHtml = indexHtml.split(`"${orig}"`).join(`"${hashed}"`);
}
indexHtml = indexHtml.replace('src="people.html"', `src="people.html?v=${peopleHash}"`);
indexHtml = safeMinifyInlineStyles(indexHtml);
indexHtml = safeMinifyInlineScripts(indexHtml);
writeFileSync(`${DIST}/index.html`, indexHtml);

// 3) people.html — sns-tool.html을 iframe으로 불러오는 부분에 캐시버스팅 쿼리, 인라인 압축
let peopleHtml = readFileSync(`${ROOT}/people.html`, 'utf8');
peopleHtml = peopleHtml.split('"pillnav.js"').join(`"${renameMap['pillnav.js']}"`);
peopleHtml = peopleHtml.split('"app-float.js"').join(`"${renameMap['app-float.js']}"`);
peopleHtml = peopleHtml.split('"app-special.js"').join(`"${renameMap['app-special.js']}"`);
peopleHtml = peopleHtml.replace('src="sns-tool.html"', `src="sns-tool.html?v=${snsHash}"`);
peopleHtml = peopleHtml.replace(
  /f\.contentWindow\.location\.replace\("sns-tool\.html"\)/,
  `f.contentWindow.location.replace("sns-tool.html?v=${snsHash}")`
);
peopleHtml = peopleHtml.replace(/f\.src\s*=\s*"sns-tool\.html";/, `f.src = "sns-tool.html?v=${snsHash}";`);
peopleHtml = safeMinifyInlineStyles(peopleHtml);
peopleHtml = safeMinifyInlineScripts(peopleHtml);
writeFileSync(`${DIST}/people.html`, peopleHtml);

// 4) sns-tool.html — 인라인 압축만(참조하는 외부 리소스 없음)
let snsHtml = readFileSync(`${ROOT}/sns-tool.html`, 'utf8');
snsHtml = safeMinifyInlineStyles(snsHtml);
snsHtml = safeMinifyInlineScripts(snsHtml);
writeFileSync(`${DIST}/sns-tool.html`, snsHtml);

// 5) 그대로 복사할 정적 파일
for (const f of ['404.html', 'favicon.png']) {
  copyFileSync(`${ROOT}/${f}`, `${DIST}/${f}`);
}

console.log('빌드 완료 → dist/');
