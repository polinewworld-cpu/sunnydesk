/**
 * 네이버 뉴스 검색 API 프록시 + 중계 (Cloudflare Worker: naver-news-proxy)
 */

const ALLOWED_ORIGINS = [
  'https://sunny-desk.web.app',      // 써니의 Firebase Hosting 주소(SETUP.md 참고)
  'https://sunny-desk.firebaseapp.com',
];

// "기타 언론사 구독"으로 임의 지방지 RSS를 등록하므로 도메인 화이트리스트를 두지 않는다.
// CORS를 정글 도메인으로 제한하고, localhost/사설 IP만 차단.
function rssHostAllowed(hostname) {
  const h = (hostname || '').toLowerCase();
  if (!h) return false;
  if (h === 'localhost' || h === '0.0.0.0' || h.endsWith('.localhost')) return false;
  if (/^(10\.|127\.|169\.254\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h)) return false;
  if (h.endsWith('.internal') || h.endsWith('.local')) return false;
  return true;
}

function corsHeaders(request) {
  const origin = request.headers.get('Origin') || '';
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Vary': 'Origin',
  };
}

function json(obj, status, request) {
  return new Response(JSON.stringify(obj), {
    status: status || 200,
    headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
  });
}

// 모던 facebook.com HTML(로그인 상태)의 임베드 GraphQL JSON에서 게시물 본문 텍스트를 뽑는다.
// FB가 마크업을 바꾸면 깨질 수 있는 best-effort 파서.
function parseFbProfilePosts(html) {
  const out = [];
  const seen = new Set();
  // 실제 구조(2026-09-23 /fbstruct로 확인): 한 게시물 노드 안에 creation_time이 message보다
  // "앞"에, permalink_url이 "뒤"에 온다. 링크 슬래시는 JSON 이스케이프(\/)된 상태.
  // 그래서 시각은 message 직전 구간에서 가장 가까운 것, 링크는 직후 구간에서 첫 번째 것을 쓴다.
  const findNearby = (html, fromIdx) => {
    let date = null, url = null;
    const before = html.slice(Math.max(0, fromIdx - 6000), fromIdx);
    const cts = [...before.matchAll(/"creation_time":(\d{10})/g)];
    let ctRaw = cts.length ? cts[cts.length - 1][1] : null;
    if (!ctRaw){ const f = html.slice(fromIdx, fromIdx + 6000).match(/"creation_time":(\d{10})/); if (f) ctRaw = f[1]; }
    if (ctRaw) date = new Date(parseInt(ctRaw, 10) * 1000).toISOString().slice(0, 10);
    const after = html.slice(fromIdx, fromIdx + 12000);
    const perma = after.match(/"permalink_url":"([^"]+)"/)
      || after.match(/"(https:\\\/\\\/www\.facebook\.com\\\/[^"]*?\\\/(?:posts|videos)\\\/[^"]+)"/)
      || before.match(/"permalink_url":"([^"]+)"/);
    if (perma) url = decodeJsonStr(perma[1]);
    return { date, url };
  };
  const push = (raw, fromIdx) => {
    let t = decodeJsonStr(raw).trim();
    if (!t || t.length < 4) return;
    if (/^(Facebook|더 보기|See more|모두 보기)$/i.test(t)) return;
    if (seen.has(t)) return;
    seen.add(t);
    const { date, url } = findNearby(html, fromIdx);
    out.push({ text: t.length > 1200 ? t.slice(0, 1200) + '…' : t, date, url });
  };
  // "message":{ ... "text":"..." }  (게시물 본문) — message 안에 ranges 배열 등 중첩 객체가
  // 깊게 들어가 있어서 한 번의 정규식으로 괄호 짝을 맞추면 자주 끊긴다. message 시작점마다
  // 그 뒤 4000자 안의 첫 "text"를 본문으로 본다.
  let re = /"message":\{/g;
  let m;
  while ((m = re.exec(html)) && out.length < 25){
    const t = html.slice(m.index, m.index + 4000).match(/"text":"((?:[^"\\]|\\.)*)"/);
    if (t) push(t[1], m.index);
  }
  // 폴백: story_message / comet 렌더러의 text 노드
  if (out.length === 0) {
    re = /"__typename":"TextWithEntities"[^}]*?"text":"((?:[^"\\]|\\.)*)"/g;
    while ((m = re.exec(html)) && out.length < 25) push(m[1], m.index);
  }
  return out;
}
function decodeJsonStr(s) {
  try { return JSON.parse('"' + s + '"'); }
  catch { return String(s).replace(/\\u([0-9a-fA-F]{4})/g, (_, h) => String.fromCharCode(parseInt(h, 16))).replace(/\\n/g, '\n').replace(/\\"/g, '"').replace(/\\\//g, '/').replace(/\\\\/g, '\\'); }
}

/* ===================== 여론 모니터링 — 네이버 카페 =====================
   등록한 카페(화이트리스트)마다 "최근 글 목록"을 가져온다. 검색이 아니라 카페 그 자체의
   최신글 피드. 로그인 없이도 열리는 공개 API를 쓴다.
     1) cafe.naver.com/<slug> HTML  →  g_sClubId + <title>에서 카페명
     2) apis.naver.com/.../cafe-boardlist-api/v1/cafes/<clubId>/menus/0/articles?sortBy=TIME
        → 제목·게시판명·조회수·댓글수·좋아요·작성시각·글쓴이 (댓글 본문만 막힘) */

const BROWSER_UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function stripTags(s) {
  return String(s || '')
    .replace(/<[^>]+>/g, '')
    .replace(/&quot;/g, '"').replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ')
    .replace(/\s+/g, ' ').trim();
}

function cafeSlugFromUrl(u) {
  const m = String(u || '').match(/cafe\.naver\.com\/(?:ca-fe\/(?:web\/)?cafes\/)?([A-Za-z0-9_-]+)/i);
  return m ? m[1] : '';
}

function cafeArtItem(it, slug) {
  return {
    articleId: it.articleId,
    title: stripTags(it.subject || ''),
    board: it.menuName || '',
    readCount: (it.readCount == null) ? null : it.readCount,
    commentCount: (it.commentCount == null) ? null : it.commentCount,
    likeCount: (it.likeCount == null) ? null : it.likeCount,
    writer: (it.writerInfo && it.writerInfo.nickName) || '',
    summary: stripTags(it.summary || ''),
    pubDate: it.writeDateTimestamp ? new Date(it.writeDateTimestamp).toISOString() : '',
    link: 'https://cafe.naver.com/' + slug + '/' + it.articleId,
  };
}

// 등록한 카페 한 곳의 최신글 피드. sinceHours 안의 글이 다 담길 때까지 페이지네이션(최대 CAFE_FEED_MAX_PAGES).
// { ok, slug, clubId, cafeName, cafeUrl, posts[], truncated } 또는 { ok:false, error }
const CAFE_FEED_MAX_PAGES = 6;   // 페이지당 50 → 최대 300건
async function fetchCafeFeed(cafeUrl, sinceHours) {
  const slug = cafeSlugFromUrl(cafeUrl);
  if (!slug) return { ok: false, error: '네이버 카페 주소가 아닙니다' };
  const hours = Math.min(Math.max(parseInt(sinceHours, 10) || 24, 1), 168);
  const cutoff = Date.now() - hours * 3600 * 1000;
  let clubId = '';
  let cafeName = slug;
  // 1) 카페 메인 HTML에서 clubId (숫자라 MS949 인코딩과 무관하게 안전)
  try {
    const mr = await fetch('https://cafe.naver.com/' + slug, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept-Language': 'ko-KR,ko;q=0.9' },
      cf: { cacheTtl: 600, cacheEverything: true },
    });
    const html = await mr.text();
    clubId = (html.match(/g_sClubId\s*=\s*["'](\d+)["']/) || [])[1] || '';
  } catch (e) {
    return { ok: false, slug, error: '카페 페이지를 열 수 없습니다' };
  }
  if (!clubId) return { ok: false, slug, cafeName, error: '카페를 찾을 수 없습니다 (주소 오류이거나 비공개 카페)' };
  // 2) 카페명은 별도 JSON API에서 (메인 HTML은 MS949라 제목이 깨진다)
  try {
    const ir = await fetch('https://apis.naver.com/cafe-web/cafe-cafeinfo-api/v1.0/cafes/' + clubId, {
      headers: { 'User-Agent': BROWSER_UA, 'Accept': 'application/json' },
      cf: { cacheTtl: 3600, cacheEverything: true },
    });
    if (ir.ok) {
      const info = await ir.json();
      const nm = info && info.result && info.result.cafeName;
      if (nm) cafeName = String(nm).replace(/['"]+$/, '').trim();
    }
  } catch (e) { /* 이름 없으면 slug 그대로 */ }

  try {
    const posts = [];
    let truncated = false;
    for (let page = 1; page <= CAFE_FEED_MAX_PAGES; page++) {
      const api = 'https://apis.naver.com/cafe-web/cafe-boardlist-api/v1/cafes/' + clubId
        + '/menus/0/articles?page=' + page + '&pageSize=50&sortBy=TIME&viewType=L';
      const ar = await fetch(api, {
        headers: { 'User-Agent': BROWSER_UA, 'Referer': 'https://cafe.naver.com/' + slug, 'Accept': 'application/json' },
        cf: { cacheTtl: 120, cacheEverything: true },
      });
      if (!ar.ok) {
        if (page === 1) return { ok: false, slug, clubId, cafeName, error: '게시글 목록 접근 불가 (' + ar.status + ')' };
        break;
      }
      const d = await ar.json();
      const list = (d && d.result && d.result.articleList) || [];
      if (!list.length) break;
      let oldestOnPage = Infinity;
      for (const a of list) {
        const p = cafeArtItem(a.item || a || {}, slug);
        if (!p.articleId || !p.title) continue;
        const ts = p.pubDate ? Date.parse(p.pubDate) : 0;
        if (ts && ts < oldestOnPage) oldestOnPage = ts;
        posts.push(p);
      }
      const pi = (d && d.result && d.result.pageInfo) || {};
      if (oldestOnPage <= cutoff) break;             // 이 페이지에 시간창 밖 글이 나옴 → 충분
      if (pi.visibleNextButton === false) break;     // 마지막 페이지
      if (page === CAFE_FEED_MAX_PAGES) truncated = true;  // 더 있는데 상한
    }
    return { ok: true, slug, clubId, cafeName, cafeUrl: 'https://cafe.naver.com/' + slug, posts, truncated };
  } catch (e) {
    return { ok: false, slug, clubId, cafeName, error: '게시글 목록 파싱 실패' };
  }
}

export default {
  async fetch(request, env) {
    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(request) });
    }

    const url = new URL(request.url);

    // ---------- 리다이렉트 해석 (페북 share/p/ 短링크 → 실제 permalink) ----------
    if (['/resolve', '/resolve/'].includes(url.pathname)) {
      const target = url.searchParams.get('url');
      if (!target) return json({ error: 'url 파라미터가 필요합니다' }, 400, request);
      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return json({ error: '잘못된 url' }, 400, request);
      }
      if (!rssHostAllowed(targetUrl.hostname)) {
        return json({ error: '허용되지 않은 주소: ' + targetUrl.hostname }, 403, request);
      }
      try {
        const res = await fetch(targetUrl.toString(), {
          headers: { 'User-Agent': 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)' },
          redirect: 'follow',
        });
        return json({ finalUrl: res.url || target, status: res.status }, 200, request);
      } catch (e) {
        return json({ error: '해석 실패: ' + e.message, finalUrl: target }, 200, request);
      }
    }

    // ---------- 개인 FB 프로필 최신 글 추출 (Page Plugin으로 임베드 불가한 개인계정용) ----------
    // env.FB_COOKIE (모니터링용 FB 계정의 c_user; xs 쿠키)가 설정돼 있어야 동작.
    // 없으면 needsCookie:true 만 반환. 텍스트만 추출(사진·리치 임베드 없음). 30분 캐시.
    // FB_COOKIE 형식 점검용 — 값 자체는 절대 내보내지 않고 모양만 알려준다.
    if (url.pathname === '/fbdiag') {
      const c = (env && env.FB_COOKIE) ? String(env.FB_COOKIE) : '';
      return json({
        set: !!c, length: c.length,
        hasCUser: /(^|;\s*)c_user=\d+/.test(c), hasXs: /(^|;\s*)xs=[^;]+/.test(c),
        hasNewline: /[\r\n]/.test(c), hasQuote: /["']/.test(c), hasNonAscii: /[^\x20-\x7E]/.test(c),
        edgeSpace: c !== c.trim(),
      }, 200, request);
    }
    if (['/fbposts', '/fbposts/'].includes(url.pathname)) {
      const u = (url.searchParams.get('u') || '').trim();
      if (!u || !/^[A-Za-z0-9.\-_]+$/.test(u)) {
        return json({ ok: false, error: 'u 파라미터(프로필 vanity 또는 id)가 필요합니다', posts: [] }, 400, request);
      }
      const cookie = (env && env.FB_COOKIE) ? String(env.FB_COOKIE) : '';
      if (!cookie) return json({ ok: false, needsCookie: true, posts: [] }, 200, request);

      const target = 'https://www.facebook.com/' + encodeURIComponent(u);
      try {
        const res = await fetch(target, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
            'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,image/avif,image/webp,*/*;q=0.8',
            'Accept-Language': 'ko-KR,ko;q=0.9,en;q=0.5',
            'Sec-Fetch-Dest': 'document',
            'Sec-Fetch-Mode': 'navigate',
            'Sec-Fetch-Site': 'none',
            'Sec-Fetch-User': '?1',
            'Upgrade-Insecure-Requests': '1',
            'Cookie': cookie,
          },
          redirect: 'follow',
          // 성공 응답만 30분 캐시 — 예전엔 에러(400)까지 캐시돼서 쿠키를 고쳐도 30분간 계속 실패로 보였음
          cf: { cacheTtlByStatus: { '200-299': 1800, '300-599': 0 }, cacheEverything: true },
        });
        if (!res.ok){
          const snippet = (await res.text().catch(()=> '')).replace(/\s+/g,' ').slice(0, 200);
          return json({ ok: false, error: 'FB 응답 ' + res.status, detail: snippet, posts: [] }, 200, request);
        }
        const html = await res.text();
        const posts = parseFbProfilePosts(html).slice(0, 6);
        return json({ ok: posts.length > 0, needsCookie: false, count: posts.length, posts }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'FB 조회 실패: ' + e.message, posts: [] }, 200, request);
      }
    }

    // ---------- 사설·칼럼 (네이버 오피니언 면) — 2026-09-28 ----------
    // /opcol?kind=column|editorial&officeId=020&date=YYYYMMDD&page=1
    //   네이버 오피니언 면이 내부적으로 쓰는 목록 API를 중계. XHR 헤더가 있어야 JSON을 준다.
    //   필요한 필드만 추려서 돌려줌. 10분 캐시.
    if (['/opcol', '/opcol/'].includes(url.pathname)) {
      const kind = url.searchParams.get('kind') === 'editorial' ? 'editorial' : 'column';
      const officeId = (url.searchParams.get('officeId') || '').replace(/\D/g, '').slice(0, 4);
      const date = (url.searchParams.get('date') || '').replace(/\D/g, '').slice(0, 8);
      const page = Math.max(1, Math.min(30, parseInt(url.searchParams.get('page'), 10) || 1));
      const api = `https://news.naver.com/opinion/${kind}/api?officeId=${officeId}&date=${date}&page=${page}`;
      try {
        const res = await fetch(api, {
          headers: {
            'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'application/json, text/javascript, */*; q=0.01',
            'X-Requested-With': 'XMLHttpRequest',
            'Referer': `https://news.naver.com/opinion/${kind}`,
          },
          cf: { cacheTtlByStatus: { '200-299': 600, '300-599': 0 }, cacheEverything: true },
        });
        if (!res.ok) return json({ ok: false, error: '네이버 응답 ' + res.status, items: [] }, 200, request);
        const data = await res.json();
        const msg = (data && data.message) || {};
        const items = (msg.contents || []).map((c) => ({
          officeId: c.officeId,
          officeName: c.officeName,
          title: String(c.title || '').trim(),
          link: c.linkUrl,
          excerpt: String(c.subContent || '').trim(),
          ts: (c.serviceTime && c.serviceTime.date) || null,
        }));
        return json({ ok: true, kind, pageSize: msg.pageSize || 18, items }, 200, request);
      } catch (e) {
        return json({ ok: false, error: '오피니언 목록 조회 실패: ' + e.message, items: [] }, 200, request);
      }
    }
    // /oppress — 오피니언 면 언론사 목록 [{officeId, name}] (칼럼 면 언론사 선택 목록에서 추출, 하루 캐시)
    if (['/oppress', '/oppress/'].includes(url.pathname)) {
      try {
        const res = await fetch('https://news.naver.com/opinion/column', {
          headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
          cf: { cacheTtlByStatus: { '200-299': 86400, '300-599': 0 }, cacheEverything: true },
        });
        const html = await res.text();
        const seen = new Set();
        const press = [];
        for (const m of html.matchAll(/data-office-id="(\d+)"\s+data-office-name="([^"]+)"/g)) {
          if (seen.has(m[1])) continue;
          seen.add(m[1]);
          press.push({ officeId: m[1], name: m[2] });
        }
        return json({ ok: press.length > 0, press }, 200, request);
      } catch (e) {
        return json({ ok: false, error: '언론사 목록 조회 실패: ' + e.message, press: [] }, 200, request);
      }
    }

    // ---------- 중계 (RSS 피드 + 임의 페이지 HTML) ----------
    if (['/rss', '/rss/', '/fetch', '/fetch/'].includes(url.pathname)) {
      const target = url.searchParams.get('url');
      if (!target) return json({ error: 'url 파라미터가 필요합니다' }, 400, request);

      let targetUrl;
      try {
        targetUrl = new URL(target);
      } catch {
        return json({ error: '잘못된 url' }, 400, request);
      }
      if (!['http:', 'https:'].includes(targetUrl.protocol)) {
        return json({ error: 'http/https 만 허용됩니다' }, 400, request);
      }
      if (!rssHostAllowed(targetUrl.hostname)) {
        return json({ error: '허용되지 않은 주소: ' + targetUrl.hostname }, 403, request);
      }

      // 인스타그램은 일반 UA로는 로그인 벽만 보여 og:title/description을 못 가져온다.
      // 메타 자사 크롤러(facebookexternalhit) UA로 요청하면 공개 게시물의 메타태그를 그대로 받는다(2026-09-09).
      // 노션도 똑같은 문제 — 일반 UA는 빈 SPA 껍데기(og:title이 "Notion"이라는 자사 광고문구)만 주지만,
      // facebookexternalhit UA로 요청하면 (공유 링크를 걸었을 때 미리보기를 만들어주려고) 그 페이지 실제
      // 제목/설명이 박힌 og 태그를 그대로 내려준다 — app.notion.com(로그인 필요해 보이는 링크)도 동일하게 통함(2026-10-03).
      const useCrawlerUA = /(^|\.)instagram\.com$/i.test(targetUrl.hostname)
        || /(^|\.)notion\.(site|so|com)$/i.test(targetUrl.hostname);
      try {
        const res = await fetch(targetUrl.toString(), {
          headers: {
            'User-Agent': useCrawlerUA
              ? 'facebookexternalhit/1.1 (+http://www.facebook.com/externalhit_uatext.php)'
              : 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
            'Accept': 'application/rss+xml, application/xml, text/xml, text/html, */*',
          },
          redirect: 'follow',
          cf: { cacheTtl: 60, cacheEverything: true },
        });
        if (!res.ok) return json({ error: '원문 서버 응답 ' + res.status }, 502, request);
        const body = await res.text();
        const ct = res.headers.get('Content-Type') || 'text/plain; charset=utf-8';
        return new Response(body, {
          headers: { ...corsHeaders(request), 'Content-Type': ct, 'Cache-Control': 'no-store' },
        });
      } catch (e) {
        return json({ error: '중계 실패: ' + e.message }, 502, request);
      }
    }

    // ---------- 네이버 데이터랩 검색어 추이 (신피디, 2026-10-13) ----------
    // POST {keywords:[최대 5]} → 최근 14일 일별 검색 비율. 네이버 개발자센터에서 이 앱에 "데이터랩(검색어 트렌드)" 사용 권한이 켜져 있어야 한다.
    if (['/datalab', '/datalab/'].includes(url.pathname)) {
      if (!ALLOWED_ORIGINS.includes(request.headers.get('Origin') || '')) {
        return json({ error: '허용되지 않은 출처' }, 403, request);
      }
      if (request.method !== 'POST') return json({ error: 'POST만 허용' }, 405, request);
      if (!env.NAVER_CLIENT_ID || !env.NAVER_CLIENT_SECRET) return json({ error: '네이버 키 미설정' }, 500, request);
      let body;
      try { body = await request.json(); } catch { return json({ error: '잘못된 JSON' }, 400, request); }
      const kws = (Array.isArray(body.keywords) ? body.keywords : []).map(k => String(k).trim()).filter(Boolean).slice(0, 5);
      if (!kws.length) return json({ error: 'keywords가 필요합니다' }, 400, request);
      const ymd = d => d.toISOString().slice(0, 10);
      const end = new Date(Date.now() + 9 * 3600 * 1000 - 86400000);       // 한국 기준 어제까지
      const start = new Date(end.getTime() - 13 * 86400000);
      try {
        const r = await fetch('https://openapi.naver.com/v1/datalab/search', {
          method: 'POST',
          headers: {
            'X-Naver-Client-Id': env.NAVER_CLIENT_ID,
            'X-Naver-Client-Secret': env.NAVER_CLIENT_SECRET,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            startDate: ymd(start), endDate: ymd(end), timeUnit: 'date',
            keywordGroups: kws.map(k => ({ groupName: k, keywords: [k] })),
          }),
        });
        const txt = await r.text();
        if (!r.ok) return json({ error: '데이터랩 응답 ' + r.status + ' ' + txt.slice(0, 120) }, 502, request);
        return new Response(txt, { headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' } });
      } catch (e) {
        return json({ error: '데이터랩 호출 실패: ' + e.message }, 502, request);
      }
    }

    // ---------- 스크랩 자동요약 (Gemini) ----------
    // 뉴스: {text: 원문 본문} / 유튜브: {youtubeUrl: 영상 주소, 자막 추출 없이 Gemini가 영상 자체를 봄}
    // env.GEMINI_API_KEY 가 Cloudflare 대시보드(Variables, Encrypt)에 설정돼 있어야 동작.
    // 없으면 needsKey:true 만 반환 — 클라이언트는 이걸 보고 기존 발췌요약으로 조용히 폴백한다.
    if (['/summarize', '/summarize/'].includes(url.pathname)) {
      if (!ALLOWED_ORIGINS.includes(request.headers.get('Origin') || '')) {
        return json({ ok: false, error: '허용되지 않은 출처' }, 403, request);
      }
      if (request.method !== 'POST') {
        return json({ ok: false, error: 'POST만 허용됩니다' }, 405, request);
      }
      if (!env.GEMINI_API_KEY) {
        return json({ ok: false, needsKey: true, error: 'GEMINI_API_KEY 미설정' }, 200, request);
      }
      let payload;
      try { payload = await request.json(); } catch { return json({ ok: false, error: '잘못된 요청' }, 400, request); }
      const youtubeUrl = payload && payload.youtubeUrl;
      const text = payload && payload.text;

      let parts;
      if (youtubeUrl) {
        if (!/^https?:\/\/(www\.)?(youtube\.com|youtu\.be)\//i.test(String(youtubeUrl))) {
          return json({ ok: false, error: '유튜브 주소가 아닙니다' }, 400, request);
        }
        parts = [
          { text: '이 유튜브 영상 내용을 한국어로 문단 형태로 요약해줘. 핵심 발언·주장 위주로 3~6문장, 자막이 없어도 영상 자체를 보고 요약해줘.' },
          { file_data: { file_uri: String(youtubeUrl) } },
        ];
      } else {
        const body = String(text || '').trim().slice(0, 12000);
        if (!body) return json({ ok: false, error: '요약할 본문이 없습니다' }, 400, request);
        parts = [{ text: '다음 뉴스 기사를 한국어로 문단 형태로 요약해줘. 3~6문장, 핵심 사실 위주로 담담하게.\n\n' + body }];
      }

      const model = env.GEMINI_MODEL || 'gemini-3.6-flash';
      try {
        const gRes = await fetch(
          'https://generativelanguage.googleapis.com/v1beta/models/' + model + ':generateContent?key=' + env.GEMINI_API_KEY,
          {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ contents: [{ parts }] }),
          }
        );
        const data = await gRes.json();
        if (!gRes.ok) {
          return json({ ok: false, error: (data && data.error && data.error.message) || ('Gemini 응답 ' + gRes.status) }, 200, request);
        }
        const cand = data && data.candidates && data.candidates[0];
        const summary = (cand && cand.content && cand.content.parts && cand.content.parts[0] && cand.content.parts[0].text || '').trim();
        if (!summary) return json({ ok: false, error: '요약 결과가 비었습니다' }, 200, request);
        return json({ ok: true, summary }, 200, request);
      } catch (e) {
        return json({ ok: false, error: 'Gemini 호출 실패: ' + e.message }, 200, request);
      }
    }

    // ---------- 여론 모니터링: 등록 카페 최신글 피드 ----------
    if (['/cafefeed', '/cafefeed/'].includes(url.pathname)) {
      // 이 경로는 정글 앱 전용 — 등록된 Origin이 아니면 거절(무단 프록시 사용 차단).
      if (!ALLOWED_ORIGINS.includes(request.headers.get('Origin') || '')) {
        return json({ ok: false, error: '허용되지 않은 출처' }, 403, request);
      }
      const cu = url.searchParams.get('url');
      if (!cu) return json({ ok: false, error: 'url 파라미터가 필요합니다' }, 400, request);
      const out = await fetchCafeFeed(cu, url.searchParams.get('sinceHours') || url.searchParams.get('size'));
      return json(out, 200, request);
    }

    // ---------- 네이버 뉴스 검색 ----------
    const query = url.searchParams.get('query');
    if (!query) {
      return json({ error: 'query 파라미터가 필요합니다 (예: ?query=이재명)' }, 400, request);
    }

    const display = url.searchParams.get('display') || '20';
    const sort = url.searchParams.get('sort') || 'date';
    const start = url.searchParams.get('start') || '1';

    const naverUrl =
      'https://naverapihub.apigw.ntruss.com/search/v1/news' +
      '?query=' + encodeURIComponent(query) +
      '&display=' + encodeURIComponent(display) +
      '&start=' + encodeURIComponent(start) +
      '&sort=' + encodeURIComponent(sort);

    try {
      const naverRes = await fetch(naverUrl, {
        headers: {
          'X-NCP-APIGW-API-KEY-ID': env.NAVER_CLIENT_ID,
          'X-NCP-APIGW-API-KEY': env.NAVER_CLIENT_SECRET,
        },
      });
      const body = await naverRes.text();
      return new Response(body, {
        status: naverRes.status,
        headers: { ...corsHeaders(request), 'Content-Type': 'application/json; charset=utf-8' },
      });
    } catch (err) {
      return json({ error: '네이버 API 호출 실패', detail: String(err) }, 502, request);
    }
  },
};
