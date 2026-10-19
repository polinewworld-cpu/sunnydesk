/* =========================================================================
   신피디 '방송 브리프' (2026-10-15 사장님 지시: 방송 직전 한 장짜리 + 우리 채널 패턴 학습)
   - 우리 채널 최근 60일 영상(공개 조회수·길이·업로드 시각·제목, 유튜브 API 약 12유닛)에서 패턴을 계산해 /recommend/shinpd/pattern 에 저장(20시간마다 갱신)
   - 방송 브리프 = 다음 방송까지 남은 시간 + 지금 리포트의 이슈 중 후보 3개(타이밍·우리 대박 키워드와의 겹침으로 점수) + 제목 후보
   - 근거는 전부 공개 숫자(조회수 등). 클릭률·시청 지속시간은 못 보므로 "왜"는 단정하지 않는다. 제미나이는 안 씀(코드가 계산).
   ========================================================================= */
const SPB = { TTL: 3 * 3600 * 1000, DAYS: 3 };   // 2026-10-16 사장님: 60일 평균은 의미 없다 → 최근 3일만
const SPB_STOP = new Set(['영상', '충격', '결국', '드디어', '진짜', '사실', '이유', '관련', '발언', '공개', '입장', '정리', '분석', '긴급', '단독', '라이브', '생방송', '다시', '오늘', '지금', '논란', '의혹', '정치', '뉴스', '속보', '현장', '전체', '최초', '모든', '그리고']);
let spPattern = null, spPatternLoaded = false, spPatternBusy = false, spPatternErr = '';

function spbMedian(a){ if(!a.length) return 0; const s = a.slice().sort((x, y)=> x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2); }
async function spPatternLoad(){
  if(spPatternLoaded) return;
  spPatternLoaded = true;
  try{ spPattern = await spdGet('pattern'); }catch(e){}
}
async function spPatternBuild(){
  const our = await spdOurChannel();
  if(!our || !our.uploads) throw new Error('우리 채널을 찾지 못했습니다');
  const cutoff = Date.now() - SPB.DAYS * 86400000;
  const ids = []; let token = '', stop = false;
  for(let i = 0; i < 8 && !stop; i++){
    const p = { part: 'contentDetails', playlistId: our.uploads, maxResults: 50 };
    if(token) p.pageToken = token;
    const d = await ytGet('playlistItems', p);
    (d.items || []).forEach(it=> { const ts = Date.parse((it.contentDetails || {}).videoPublishedAt); if(isFinite(ts) && ts < cutoff){ stop = true; return; } ids.push(it.contentDetails.videoId); });
    token = d.nextPageToken || ''; if(!token) break;
  }
  const vids = [];
  for(let i = 0; i < ids.length; i += 50){
    const d = await ytGet('videos', { part: 'snippet,statistics,contentDetails,liveStreamingDetails', id: ids.slice(i, i + 50).join(',') });
    (d.items || []).forEach(x=> {
      const sec = durationToSeconds((x.contentDetails || {}).duration) || 0;
      vids.push({ id: x.id, t: (x.snippet || {}).title || '', ts: Date.parse((x.snippet || {}).publishedAt), v: Number((x.statistics || {}).viewCount || 0), sec, live: !!x.liveStreamingDetails });
    });
  }
  const now = Date.now();
  const old = vids.filter(x=> now - x.ts >= 4 * 86400000);   // 4일 미만은 조회수가 덜 쌓여 제외
  if(old.length < 20) throw new Error('분석할 영상이 부족합니다(' + old.length + '개)');
  const med = spbMedian(old.map(x=> x.v));
  const sorted = old.slice().sort((a, b)=> b.v - a.v);
  const topN = Math.max(3, Math.round(old.length * 0.3));
  const top = sorted.slice(0, topN);
  // 대박 영상에 유독 자주 나오는 말(인물·소재) — 전체 대비 비율(lift)이 1.5배 이상이고 대박에서 3번 이상
  const tok = x=> new Set(rcKeyTokens(x.t).filter(w=> w.length >= 2 && !/^\d+$/.test(w) && !SPB_STOP.has(w)));
  const cAll = {}, cTop = {};
  old.forEach(x=> tok(x).forEach(w=> { cAll[w] = (cAll[w] || 0) + 1; }));
  top.forEach(x=> tok(x).forEach(w=> { cTop[w] = (cTop[w] || 0) + 1; }));
  const hot = Object.keys(cTop).filter(w=> cTop[w] >= 2 && (cTop[w] / top.length) / (cAll[w] / old.length) >= 1.2)
    .sort((a, b)=> cTop[b] - cTop[a] || cAll[a] - cAll[b]).slice(0, 14).map(w=> ({ w, top: cTop[w], all: cAll[w] }));
  const kst = x=> new Date(x.ts + 9 * 3600000).getUTCHours();
  const slot = (a, b)=> { const v = old.filter(x=> kst(x) >= a && kst(x) < b).map(x=> x.v); return { n: v.length, med: spbMedian(v) }; };
  const len = (a, b)=> { const v = old.filter(x=> x.sec >= a && x.sec < b).map(x=> x.v); return { n: v.length, med: spbMedian(v) }; };
  const sl = old.filter(x=> / \/ /.test(x.t)).map(x=> x.v), ns = old.filter(x=> !/ \/ /.test(x.t)).map(x=> x.v);
  const wk = {};
  old.forEach(x=> { const d = new Date(x.ts + 9 * 3600000); const mon = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() - ((d.getUTCDay() + 6) % 7))); const k = mon.toISOString().slice(5, 10); (wk[k] = wk[k] || []).push(x.v); });
  const data = {
    at: now, days: SPB.DAYS, n: old.length, median: med,
    top: top.slice(0, 8).map(x=> ({ t: x.t.slice(0, 60), v: x.v, ts: x.ts })), hot,
    slots: { afternoon: slot(13, 16), evening: slot(19, 22), other: { n: old.length - slot(13, 16).n - slot(19, 22).n, med: spbMedian(old.filter(x=> { const h = kst(x); return !(h >= 13 && h < 16) && !(h >= 19 && h < 22); }).map(x=> x.v)) } },
    lens: { short: len(0, 600), mid: len(600, 1800), long: len(1800, 99999) },
    slash: { yes: { n: sl.length, med: spbMedian(sl) }, no: { n: ns.length, med: spbMedian(ns) } },
    weekly: Object.keys(wk).sort().slice(-8).map(k=> ({ w: k, n: wk[k].length, med: spbMedian(wk[k]) }))
  };
  await spdPutJson('pattern', data).catch(()=>{});
  return data;
}
async function spPatternEnsure(force){
  await spPatternLoad();
  const stale = !spPattern || !spPattern.at || Date.now() - spPattern.at > SPB.TTL || spPattern.days !== SPB.DAYS;
  if((force || stale) && !spPatternBusy){
    spPatternBusy = true; spPatternErr = ''; if(typeof shinpdPaint === 'function') shinpdPaint();
    try{ spPattern = await spPatternBuild(); }
    catch(e){ spPatternErr = String(e.message || e).slice(0, 80); }
    finally{ spPatternBusy = false; if(typeof shinpdPaint === 'function') shinpdPaint(); }
  }
  return spPattern;
}
// 채팅 프롬프트용 한 줄 요약
function spPatternText(){
  const p = spPattern; if(!p || !p.at) return '';
  const k = n=> n >= 1000 ? (n / 1000).toFixed(1) + '천' : String(n);
  return `[우리 채널 최근 ${p.days}일 패턴 — 공개 조회수 기준, 영상 ${p.n}개]\n- 조회수 보통 ${k(p.median)}. 대박 영상에 유독 자주 나온 말: ${(p.hot || []).slice(0, 8).map(h=> h.w).join(', ') || '없음'}.\n- 업로드 시간대별 보통 조회수: 13~16시 ${k(p.slots.afternoon.med)}, 19~22시 ${k(p.slots.evening.med)}, 그 밖 ${k(p.slots.other.med)}. 길이별 보통: 10분 미만 ${k(p.lens.short.med)}, 10~30분 ${k(p.lens.mid.med)}, 30분 이상 ${k(p.lens.long.med)}.\n- 제목에 " / "로 두 꼭지를 이은 영상 ${k(p.slash.yes.med)}(${p.slash.yes.n}개) vs 아닌 영상 ${k(p.slash.no.med)}(${p.slash.no.n}개) — 방송 본편 제목 형식과 겹쳐 확정은 아님.\n- 클릭률·시청 지속시간은 여기서 볼 수 없음.`;
}

/* ---------- 방송 브리프 ---------- */
function spbTimingScore(t){ t = String(t || ''); return /선점/.test(t) ? 3 : /적기/.test(t) ? 2 : /막차/.test(t) ? 1 : 0; }
function spbPicks(r, pattern){
  if(!r || !(r.briefs || []).length) return [];
  const hotSet = new Map(((pattern && pattern.hot) || []).map(h=> [h.w, h]));
  return r.briefs.filter(b=> !b.ours && b.name).map(b=> {
    const toks = new Set(rcKeyTokens([b.name].concat(b.titles || []).concat([b.what || '']).join(' ')));
    const matched = Array.from(toks).filter(w=> hotSet.has(w));
    const score = spbTimingScore(b.timing) + Math.min(matched.length, 3) * 1.5 + Math.min(b.nCh || 0, 3) * 0.5 + Math.min(b.A || 0, 5) * 0.3;
    return { b, matched, score };
  }).sort((a, c)=> c.score - a.score).slice(0, 3);
}
function spbHtml(){
  const r = shinpdReport, p = spPattern;
  const nb = (typeof spNextBroadcast === 'function') ? spNextBroadcast() : null;
  const head = `<div class="sp-line"><b>${nb ? `다음 방송 ${esc(nb.label)} ${esc(spClock(nb.at))} — ${esc(spDur(nb.at - Date.now()))} 남음` : '예정된 방송이 없습니다'}</b>${spPatternBusy ? ' <span class="sp-sub">우리 채널 패턴 계산 중…</span>' : ''} <button type="button" class="sp-mini" data-brief-refresh>패턴 새로고침</button></div>`;
  const stale = r && r.at && r.at < spLastSlot([13, 18], Date.now()) ? `<p class="sp-warn">리포트가 ${esc(spAgo(r.at))}에 만들어진 것입니다. 오래됐으니 이슈 브리핑 탭의 새로고침을 먼저 눌러 보세요.</p>` : '';
  if(!r || !r.at) return head + '<p class="sp-sub">리포트가 아직 없습니다. 이슈 브리핑 탭에서 새로고침을 눌러 주세요.</p>';
  if(r.ver !== 2 || r.rev < 6) return head + '<p class="sp-sub">이전 형식의 리포트입니다. 이슈 브리핑 탭에서 새로고침을 눌러 주세요.</p>';
  const picks = spbPicks(r, p);
  const cards = picks.length ? picks.map((x, i)=> {
    const b = x.b;
    const chips = [b.timing ? `<span class="sp-net">${esc(b.timing)}</span>` : '', b.nCh ? `<span class="sp-sub">유튜브 ${b.nCh}곳 · 첫 영상 ${esc(spAgo(b.firstTs))}${b.A ? ` · 기사 ${b.A}건` : ''}</span>` : `<span class="sp-sub">유튜브엔 아직 없음${b.A ? ` · 기사 ${b.A}건` : ''}</span>`].filter(Boolean).join(' ');
    const fit = x.matched.length ? `우리 최근 대박 영상에 자주 나온 말과 겹침: ${esc(x.matched.slice(0, 4).join(' · '))}` : (p ? '우리 대박 키워드와 겹치는 말은 없음' : '우리 채널 패턴을 아직 못 불러왔습니다');
    const titles = (b.titles || []).slice(0, 2);
    return `<div class="sp-camp"><div class="sp-line"><b>${i + 1}. ${esc(b.name)}</b></div><div class="sp-sub">${chips}</div>${b.what ? `<div class="sp-line">${esc(String(b.what).slice(0, 150))}</div>` : ''}<div class="sp-sub">${fit}</div>${titles.length ? `<ul class="sp-list">${titles.map(t=> `<li><div class="sp-line">${esc(t)}</div></li>`).join('')}</ul>` : ''}</div>`;
  }).join('') + (picks.length >= 2 ? `<div class="sp-camp"><div class="sp-line"><b>두 꼭지 묶음 제안</b></div><div class="sp-sub">우리 영상 중 " / "로 두 꼭지를 이은 제목이 평소보다 잘 나왔습니다(표본 작음).</div><div class="sp-line">「${esc(picks[0].b.name)}」 / 「${esc(picks[1].b.name)}」</div></div>` : '') : '<p class="sp-sub">후보로 올릴 이슈가 지금은 없습니다(리포트의 이슈가 모두 우리가 다뤘거나 비어 있음).</p>';
  const pat = p && p.at ? `<div class="sp-camp"><div class="sp-line"><b>우리 채널 최근 ${p.days}일 패턴</b> <span class="sp-sub">공개 조회수 기준 · 영상 ${p.n}개 · ${esc(spAgo(p.at))} 계산</span></div>`
    + `<div class="sp-sub">조회수 보통 ${spNum(p.median)} · 시간대별 보통 13~16시 ${spNum(p.slots.afternoon.med)} / 19~22시 ${spNum(p.slots.evening.med)} / 그 밖 ${spNum(p.slots.other.med)} · 길이 10분 미만 ${spNum(p.lens.short.med)} / 10~30분 ${spNum(p.lens.mid.med)} / 30분↑ ${spNum(p.lens.long.med)}</div>`
    + `<div class="sp-sub">대박에 자주 나온 말: ${(p.hot || []).length ? esc(p.hot.map(h=> `${h.w}(${h.top}/${h.all})`).join(' · ')) : '뚜렷한 것 없음'}</div>`
    + `<ul class="sp-list">${(p.top || []).slice(0, 5).map(t=> `<li><div class="sp-sub">${spNum(t.v)} · ${esc(t.t)}</div></li>`).join('')}</ul>`
    + `<div class="sp-sub">클릭률·시청 지속시간은 볼 수 없어서 "왜 잘 나왔는지"는 단정하지 않습니다.</div></div>`
    : `<div class="sp-camp"><div class="sp-sub">${spPatternBusy ? '' : (spPatternErr ? '우리 채널 패턴을 못 만들었습니다: ' + esc(spPatternErr) : '우리 채널 패턴이 아직 없습니다.')}</div></div>`;
  return head + stale + cards + pat;
}
function spbPaint(root){
  const meta = document.getElementById('shinpdMeta');
  if(meta) meta.textContent = shinpdReport && shinpdReport.at ? `리포트 ${spClock(shinpdReport.at)} · ${spAgo(shinpdReport.at)}` : '리포트 없음';
  root.innerHTML = spbHtml();
  if(!spPatternLoaded || (!spPatternBusy && (!spPattern || Date.now() - (spPattern.at || 0) > SPB.TTL || spPattern.days !== SPB.DAYS))) setTimeout(()=> spPatternEnsure(false), 0);
}
document.addEventListener('click', e=>{
  if(e.target.closest && e.target.closest('[data-brief-refresh]')) spPatternEnsure(true);
});
document.addEventListener('click', e=>{
  if(shinpdView === 'brief' && e.target.closest && e.target.closest('#shinpdRefresh')){ e.stopImmediatePropagation(); e.preventDefault(); spPatternEnsure(true); }
}, true);
