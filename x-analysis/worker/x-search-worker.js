/**
 * x-search-worker — 정글2 sns-tool.html의 "X 보기"가 직접 호출하는 Cloudflare Worker.
 *
 * X 공식 API가 아니라, Firefox에서 뽑아 Worker Secret으로 저장해둔 로그인 세션
 * (AUTH_TOKEN/CT0)으로 X의 내부 GraphQL(SearchTimeline)을 호출한다. 로직은
 * last30days-skill의 vendor/bird-search(twitter-client-*.js)를 Cloudflare Workers
 * 런타임(파일시스템 없음, fetch/Web Crypto만 사용 가능)에 맞게 포팅한 것.
 *
 * 필요한 Secret: wrangler secret put AUTH_TOKEN / CT0
 * 배포:          npx wrangler deploy --config x-analysis/worker/wrangler.toml
 */

const ALLOWED_ORIGINS = new Set([
  'https://sunny-desk.web.app',      // 써니의 Firebase Hosting 주소
  'https://sunny-desk.firebaseapp.com',
  'http://localhost:8793',
  'http://localhost:8794',
]);

const TWITTER_API_BASE = 'https://x.com/i/api/graphql';
const BEARER = 'Bearer AAAAAAAAAAAAAAAAAAAAANRILgAAAAAAnNwIzUejRCOuH5E6I8xnZz4puTs%3D1Zv7ttfk8LF81IUq16cHjhLTvJu4FA33AGWWjCpTnA';
// SearchTimeline queryId는 X가 수시로 바꾼다 — last30days-skill이 알고 있는 것들을
// 순서대로 시도(가장 최근에 확인된 것부터). 전부 실패하면 last30days-skill을 다시
// 돌려서 query-ids.json을 확인하고 여기 목록을 갱신해야 한다.
const SEARCH_QUERY_IDS = [
  '6AAys3t42mosm_yTI_QENg',
  'M1jEez78PEfVfbQLvlWMvQ',
  '5h0kNbk3ii97rmfY6CdgAA',
  'Tp1sewRU1AsZpBWhqCZicQ',
];

const SEARCH_FEATURES = {
  rweb_video_screen_enabled: true,
  profile_label_improvements_pcf_label_in_post_enabled: true,
  responsive_web_profile_redirect_enabled: true,
  rweb_tipjar_consumption_enabled: true,
  verified_phone_label_enabled: false,
  creator_subscriptions_tweet_preview_api_enabled: true,
  responsive_web_graphql_timeline_navigation_enabled: true,
  responsive_web_graphql_exclude_directive_enabled: true,
  responsive_web_graphql_skip_user_profile_image_extensions_enabled: false,
  premium_content_api_read_enabled: false,
  communities_web_enable_tweet_community_results_fetch: true,
  c9s_tweet_anatomy_moderator_badge_enabled: true,
  responsive_web_grok_analyze_button_fetch_trends_enabled: false,
  responsive_web_grok_analyze_post_followups_enabled: false,
  responsive_web_grok_annotations_enabled: false,
  responsive_web_jetfuel_frame: true,
  post_ctas_fetch_enabled: true,
  responsive_web_grok_share_attachment_enabled: true,
  responsive_web_edit_tweet_api_enabled: true,
  graphql_is_translatable_rweb_tweet_is_translatable_enabled: true,
  view_counts_everywhere_api_enabled: true,
  longform_notetweets_consumption_enabled: true,
  responsive_web_twitter_article_tweet_consumption_enabled: true,
  tweet_awards_web_tipping_enabled: false,
  responsive_web_grok_show_grok_translated_post: false,
  responsive_web_grok_analysis_button_from_backend: true,
  creator_subscriptions_quote_tweet_preview_enabled: false,
  freedom_of_speech_not_reach_fetch_enabled: true,
  standardized_nudges_misinfo: true,
  tweet_with_visibility_results_prefer_gql_limited_actions_policy_enabled: true,
  rweb_video_timestamps_enabled: true,
  longform_notetweets_rich_text_read_enabled: true,
  longform_notetweets_inline_media_enabled: true,
  responsive_web_grok_image_annotation_enabled: true,
  responsive_web_grok_imagine_annotation_enabled: true,
  responsive_web_grok_community_note_auto_translation_is_enabled: false,
  articles_preview_enabled: true,
  responsive_web_enhance_cards_enabled: false,
};

// Cloudflare Workers 무료/기본 플랜은 한 번의 요청 처리 중 만들 수 있는 하위 요청(subrequest)
// 수가 50개로 제한된다. 핸들 하나당 보통 fetch 1번(실패 시 최대 4번 재시도)이라 여유 있게
// 25로 잡는다. 대상이 이보다 많으면 클라이언트가 여러 번 나눠 호출해야 한다
// (sns-tool.html의 window.searchXChunked 참고).
const MAX_TARGETS_PER_REQUEST = 25;
const COUNT_PER_HANDLE = 15;

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.has(origin) ? origin : '';
  return {
    'Access-Control-Allow-Origin': allow,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function jsonResponse(data, status, origin) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json', ...corsHeaders(origin) },
  });
}

function hex(bytes) {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function buildHeaders(env) {
  return {
    accept: '*/*',
    'accept-language': 'en-US,en;q=0.9',
    authorization: BEARER,
    'x-csrf-token': env.CT0,
    'x-twitter-auth-type': 'OAuth2Session',
    'x-twitter-active-user': 'yes',
    'x-twitter-client-language': 'en',
    'x-client-uuid': crypto.randomUUID(),
    'x-twitter-client-deviceid': crypto.randomUUID(),
    'x-client-transaction-id': hex(crypto.getRandomValues(new Uint8Array(16))),
    cookie: `auth_token=${env.AUTH_TOKEN}; ct0=${env.CT0}`,
    'user-agent':
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36',
    origin: 'https://x.com',
    referer: 'https://x.com/',
    'content-type': 'application/json',
  };
}

function unwrapTweetResult(result) {
  if (!result) return undefined;
  return result.tweet || result;
}

function firstText(...values) {
  for (const v of values) {
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function extractTweetText(result) {
  const note = result?.note_tweet?.note_tweet_results?.result;
  const noteText = note
    ? firstText(note.text, note.richtext?.text, note.rich_text?.text, note.content?.text)
    : undefined;
  return noteText || firstText(result?.legacy?.full_text);
}

function mapTweetResult(result) {
  const userResult = result?.core?.user_results?.result;
  const userLegacy = userResult?.legacy;
  const userCore = userResult?.core;
  const username = userLegacy?.screen_name ?? userCore?.screen_name;
  if (!result?.rest_id || !username) return undefined;
  const text = extractTweetText(result);
  if (!text) return undefined;
  return {
    id: result.rest_id,
    text,
    createdAt: result.legacy?.created_at,
    replyCount: result.legacy?.reply_count,
    retweetCount: result.legacy?.retweet_count,
    likeCount: result.legacy?.favorite_count,
    conversationId: result.legacy?.conversation_id_str,
    inReplyToStatusId: result.legacy?.in_reply_to_status_id_str,
    authorHandle: username,
  };
}

function collectTweetResultsFromEntry(entry) {
  const results = [];
  const push = (r) => {
    if (r?.rest_id) results.push(r);
  };
  const content = entry.content;
  push(content?.itemContent?.tweet_results?.result);
  push(content?.item?.itemContent?.tweet_results?.result);
  for (const item of content?.items ?? []) {
    push(item?.item?.itemContent?.tweet_results?.result);
    push(item?.itemContent?.tweet_results?.result);
    push(item?.content?.itemContent?.tweet_results?.result);
  }
  return results;
}

function parseTweetsFromInstructions(instructions) {
  const tweets = [];
  const seen = new Set();
  for (const instruction of instructions ?? []) {
    for (const entry of instruction.entries ?? []) {
      for (const raw of collectTweetResultsFromEntry(entry)) {
        const mapped = mapTweetResult(unwrapTweetResult(raw));
        if (!mapped || seen.has(mapped.id)) continue;
        seen.add(mapped.id);
        tweets.push(mapped);
      }
    }
  }
  return tweets;
}

// X 답글은 본문이 답한 대상의 @핸들로 시작한다(leading run). 그 관례를 이용해
// "누구에게 쓴 글인지"를 추정 — last30days-skill의 leading_mentions와 동일 로직.
function leadingMentions(text) {
  const out = [];
  for (const token of (text || '').split(/\s+/)) {
    const tok = token.replace(/[,.:;!?]+$/, '');
    if (tok.startsWith('@') && tok.length > 1) out.push(tok.slice(1).toLowerCase());
    else break;
  }
  return out;
}

// 같은 명단·같은 기간을 짧은 시간에 반복 조회하지 않도록 10분 캐시한다
// (여러 번 분석하거나 여러 사람이 동시에 쓸 때 X 요청 한도(429)에 덜 걸리게).
// ⚠️ 캐시 조회·저장도 하위요청 50개 한도에 포함된다. 예전엔 계정마다 캐시를 따로 둬서
// 25명 = 캐시조회 25 + X 25 + 캐시저장 25 = 75개로 한도를 넘어 Worker가 통째로 죽었고
// (에러 1101, CORS 헤더 없음 → 브라우저엔 "Failed to fetch"), 2026-09-24 요청(청크) 단위 캐시
// 하나로 바꿔 캐시 비용을 2개로 줄였다.
const CHUNK_CACHE_TTL = 600;
const SUBREQUEST_BUDGET = 46;   // 한도 50에서 여유 4

async function chunkCacheKey(handles, fromDate) {
  const raw = [...handles].sort().join(',') + '|' + fromDate;
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(raw));
  return new Request(`https://x-search-cache.internal/chunk/${hex(new Uint8Array(digest))}`);
}

async function searchOneHandleUncached(env, handle, fromDate, budget) {
  const query = `from:${handle} since:${fromDate}`;
  const variables = { rawQuery: query, count: COUNT_PER_HANDLE, querySource: 'typed_query', product: 'Latest' };
  const params = new URLSearchParams({ variables: JSON.stringify(variables) });
  const headers = buildHeaders(env);

  let lastError = 'unknown';
  for (const queryId of SEARCH_QUERY_IDS) {
    // 실패 시 다른 queryId로 재시도하느라 하위요청이 늘 수 있음 — 한도가 바닥나면 이 계정은 실패로 넘김
    if (budget.left <= 0) { lastError = '요청 한도 초과로 건너뜀(잠시 후 다시 시도)'; break; }
    budget.left--;
    const url = `${TWITTER_API_BASE}/${queryId}/SearchTimeline?${params.toString()}`;
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ features: SEARCH_FEATURES, queryId }),
      });
      if (res.status === 404) {
        lastError = 'HTTP 404 (queryId 만료)';
        continue;
      }
      if (!res.ok) {
        lastError = `HTTP ${res.status}: ${(await res.text()).slice(0, 200)}`;
        continue;
      }
      const data = await res.json();
      if (data.errors?.length) {
        lastError = data.errors.map((e) => e.message).join(', ');
        continue;
      }
      const instructions = data.data?.search_by_raw_query?.search_timeline?.timeline?.instructions;
      return { ok: true, tweets: parseTweetsFromInstructions(instructions) };
    } catch (e) {
      lastError = String(e);
    }
  }
  return { ok: false, error: lastError };
}

function isoDate(ts) {
  // X createdAt: "Wed Jan 15 14:30:00 +0000 2026"
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10);
}

async function handleSearch(req, env, origin) {
  let body;
  try {
    body = await req.json();
  } catch {
    return jsonResponse({ error: '요청 본문이 JSON이 아닙니다.' }, 400, origin);
  }
  const { topic, days, targets } = body || {};
  // all:true — 주제어 거르기 없이 최근 글을 전부 돌려준다(뉴스추천 탭 SNS 원문 수집용, 2026-10-04)
  const all = body && body.all === true;
  if (!all && (!topic || typeof topic !== 'string')) return jsonResponse({ error: 'topic이 필요합니다.' }, 400, origin);
  if (!Array.isArray(targets) || targets.length === 0) return jsonResponse({ error: 'targets가 비어있습니다.' }, 400, origin);
  if (!env.AUTH_TOKEN || !env.CT0) return jsonResponse({ error: 'Worker에 AUTH_TOKEN/CT0 시크릿이 설정돼 있지 않습니다.' }, 500, origin);

  const windowDays = Math.max(1, parseInt(days, 10) || 7);
  const fromDate = new Date(Date.now() - windowDays * 86400000).toISOString().slice(0, 10);

  const limited = targets.slice(0, MAX_TARGETS_PER_REQUEST);
  const byHandle = new Map();
  for (const t of limited) {
    let handle = (t.x_handle || t.x || '').trim();
    if (handle.startsWith('http')) handle = handle.replace(/\/+$/, '').split('/').pop().replace(/^@/, '');
    if (!handle) continue;
    byHandle.set(handle.toLowerCase(), { name: t.name || handle, factions: t.factions || [] });
  }

  const budget = { left: SUBREQUEST_BUDGET - 2 };   // 캐시 조회·저장 2개 몫을 먼저 뺌
  const cache = caches.default;
  const cacheKey = await chunkCacheKey(byHandle.keys(), fromDate);
  let searchResults = null;
  const hit = await cache.match(cacheKey);
  if (hit) searchResults = await hit.json();
  if (!searchResults) {
    searchResults = await Promise.all(
      [...byHandle.keys()].map(async (handle) => ({ handle, result: await searchOneHandleUncached(env, handle, fromDate, budget) }))
    );
    // 전원 성공한 경우만 캐시(일부 실패를 10분간 굳혀두지 않도록)
    if (searchResults.every((r) => r.result.ok)) {
      await cache.put(cacheKey, new Response(JSON.stringify(searchResults), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CHUNK_CACHE_TTL}` },
      }));
    }
  }

  const failures = searchResults.filter((r) => !r.result.ok);
  const topicLower = all ? '' : topic.toLowerCase();
  const trackedHandles = new Set(byHandle.keys());
  const posts = [];

  for (const { handle, result } of searchResults) {
    if (!result.ok) continue;
    const meta = byHandle.get(handle);
    for (const tw of result.tweets) {
      if (!all && !tw.text.toLowerCase().includes(topicLower)) continue;
      const mentioned = leadingMentions(tw.text);
      const directedAt = mentioned.filter((m) => trackedHandles.has(m)).map((m) => byHandle.get(m).name);
      posts.push({
        name: meta.name,
        factions: meta.factions,
        handle,
        date: isoDate(tw.createdAt),
        created: (() => { const d = new Date(tw.createdAt); return Number.isNaN(d.getTime()) ? null : d.toISOString(); })(),
        text: tw.text,
        url: `https://x.com/${handle}/status/${tw.id}`,
        engagement: { likes: tw.likeCount ?? null, reposts: tw.retweetCount ?? null, replies: tw.replyCount ?? null },
        directed_at: directedAt,
        // 요청을 여러 청크로 나눠 보낼 때(대상이 많을 때) 클라이언트가 전체 명단 기준으로
        // directed_at을 다시 계산할 수 있도록 원본 멘션도 같이 내려준다 — 이 청크 안에서만
        // directed_at을 계산하면 다른 청크에 있는 동료를 향한 멘션을 놓치게 된다.
        mentioned_handles: mentioned,
      });
    }
  }
  posts.sort((a, b) => (b.date || '').localeCompare(a.date || ''));

  const byFaction = {};
  for (const p of posts) {
    for (const f of p.factions?.length ? p.factions : ['(계파 미입력)']) {
      byFaction[f] = (byFaction[f] || 0) + 1;
    }
  }
  const exchanges = posts.filter((p) => p.directed_at.length > 0);

  const result = {
    topic,
    window_days: windowDays,
    from_date: fromDate,
    total_matched_posts: posts.length,
    posts,
    by_faction: byFaction,
    exchanges,
    generated_at: new Date().toISOString(),
    searched_accounts: byHandle.size,
    failed_accounts: failures.map((f) => f.handle),
    failed_details: failures.map((f) => ({ handle: f.handle, error: String(f.result.error || "").slice(0, 200) })),
  };

  return jsonResponse(result, 200, origin);
}

export default {
  async fetch(req, env) {
    const origin = req.headers.get('Origin') || '';
    if (req.method === 'OPTIONS') {
      return new Response(null, { status: 204, headers: corsHeaders(origin) });
    }
    const url = new URL(req.url);
    if (url.pathname === '/search' && req.method === 'POST') {
      // 예상 못 한 예외로 Worker가 죽으면 CORS 헤더 없는 1101 응답이 나가 브라우저엔
      // "Failed to fetch"만 보임 — 진짜 원인이 화면에 뜨도록 JSON 오류로 감싼다
      try {
        return await handleSearch(req, env, origin);
      } catch (e) {
        return jsonResponse({ error: 'X 검색 Worker 오류: ' + String(e && e.message || e).slice(0, 200) }, 500, origin);
      }
    }
    if (url.pathname === '/health') {
      return jsonResponse({ ok: true, hasSecrets: Boolean(env.AUTH_TOKEN && env.CT0) }, 200, origin);
    }
    return jsonResponse({ error: 'not found' }, 404, origin);
  },
};
