/* 뉴스 리포트·인쇄·Word·스크랩 직접 추가
   (app.js를 2026-10-06 영역별로 나눈 파일. 전역 스코프 공유 — 로드 순서는 index.html 참고) */
/* ========================================================================
   뉴스 리포트 — 대메뉴(showMode 'report'). 스크랩 체크분을 한 문서로 모아 아코디언에서
   다듬고 인쇄·Word. 개인 데이터(/users/{uid}/reports/{id}). 삭제 전까지 영구 보관.
   ======================================================================== */
function reportTitleAt(ts){
  const d = new Date(ts), p = n=> String(n).padStart(2,'0');
  return `${d.getFullYear()}-${p(d.getMonth()+1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
async function loadReports(){
  try{
    const data = await dbFetch(userPath('reports')).then(r=>r.json());
    newsState.reports = (data && typeof data === 'object' && !Array.isArray(data)) ? data : {};
  }catch(e){ newsState.reports = {}; }
}
async function saveReport(rep){
  rep.updatedAt = Date.now();
  newsState.reports[rep.id] = rep;
  try{
    const res = await dbFetch(userPath('reports/' + rep.id), {
      method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(rep)
    });
    return res.ok;
  }catch(e){ console.warn('[리포트 저장 실패]', e); return false; }
}
async function deleteReport(id){
  delete newsState.reports[id];
  if(_reportOpenId === id) _reportOpenId = null;
  try{ await dbFetch(userPath('reports/' + id), {method:'DELETE'}); }catch(e){}
}

/* 스크랩 체크분(표시 순서대로) → 한 문서 HTML. 제목+메모만 들어간다(자동 원문 요약 fetch 폐지). */
function assembleReportBody(entries){
  // 기사마다 <hr> 앞에 빈 문단 하나 = 커서가 정상 서체 자리에 떨어지는 코멘트 칸. 문서 끝에도 하나.
  const body = entries.map(([, it])=>{
    const title = esc(it.title || '(제목 없음)');
    const note = (it.note && noteToText(it.note).trim()) ? it.note : '';
    return `<h3>${title}</h3>${note}<p><br></p><hr>`;
  }).join('');
  return body + '<p><br></p>';
}
async function createReportFromSelection(){
  const entries = sortedSavedEntries().filter(([, it])=> it.reportOn === true);
  if(!entries.length){ alert('리포트에 넣을 스크랩을 먼저 체크하세요.'); return; }
  const ts = Date.now();
  const rep = { id: 'r_' + ts, title: reportTitleAt(ts), bodyHtml: assembleReportBody(entries), createdAt: ts, updatedAt: ts };
  if(!(await saveReport(rep))){ alert('리포트를 만들지 못했어요. 새로고침 후 다시 시도하세요.'); return; }
  _reportOpenId = rep.id;
  showMode('report');
  renderReports();
}

/* ---------- 뉴스 리포트 목록 + 아코디언 편집 ---------- */
let _reportOpenId = null;
let _reportAutosave = null;

let _reportSearchTimer = null;
document.getElementById('reportSearch')?.addEventListener('input', ()=>{
  clearTimeout(_reportSearchTimer);
  // 다시 그리기 전에 열려 있는 편집 내용부터 저장(렌더가 자동저장 타이머를 지우므로)
  _reportSearchTimer = setTimeout(async ()=>{ await flushReportEditor(); renderReports(); }, 200);
});
function renderReports(){
  const root = document.getElementById('reportList');
  if(!root) return;
  if(_reportAutosave){ clearTimeout(_reportAutosave); _reportAutosave = null; }
  const all = Object.values(newsState.reports).sort((a,b)=> (b.createdAt||0) - (a.createdAt||0));

  if(!all.length){
    root.innerHTML = `<div class="empty-hint">저장된 리포트가 없어요. 스크랩 탭에서 기사를 체크하고 "리포트작성"을 눌러보세요.</div>`;
    return;
  }
  // 리포트 검색 — 제목·본문 모두 (띄어쓰기로 여러 단어 입력 시 모두 포함된 것만). 열려 있는 리포트는 편집 중이라 항상 남김
  const terms = (document.getElementById('reportSearch')?.value || '').toLowerCase().split(/\s+/).filter(Boolean);
  const list = terms.length ? all.filter(r=>{
    if(r.id === _reportOpenId) return true;
    const hay = ((r.title || '') + ' ' + noteToText(r.bodyHtml || '')).toLowerCase();
    return terms.every(t=> hay.includes(t));
  }) : all;
  if(!list.length){
    root.innerHTML = `<div class="empty-hint">"${esc(terms.join(' '))}"이(가) 들어간 리포트가 없어요.</div>`;
    return;
  }
  root.innerHTML = list.map(r=>{
    const open = r.id === _reportOpenId;
    const preview = esc(noteToText(r.bodyHtml).slice(0, 120));
    return `<div class="rp-row${open?' open':''}" data-id="${esc(r.id)}">
      <button class="rp-row-head" data-rp-toggle="${esc(r.id)}">
        <span class="rp-row-name">${esc(r.title)}</span>
        ${open ? '' : `<span class="rp-row-prev">${preview || '(내용 없음)'}</span>`}
        <span class="rp-row-caret">${open
          ? '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="fill:none;width:14px;height:14px" title="접기"><path stroke-linecap="round" stroke-linejoin="round" d="M8.25 6.75 12 3m0 0 3.75 3.75M12 3v18"/></svg>'
          : '<svg viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" style="fill:none;width:14px;height:14px" title="펼치기"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 13.5 12 21m0 0-7.5-7.5M12 21V3"/></svg>'
        }</span>
      </button>
      ${open ? reportEditorHtml(r) : ''}
    </div>`;
  }).join('');

  root.querySelectorAll('[data-rp-toggle]').forEach(b=> b.onclick = ()=> toggleReportOpen(b.dataset.rpToggle));
  const openRow = root.querySelector('.rp-row.open');
  if(openRow) wireReportEditor(openRow, _reportOpenId);
}
async function toggleReportOpen(id){
  if(_reportOpenId === id){ await flushReportEditor(); _reportOpenId = null; }
  else { await flushReportEditor(); _reportOpenId = id; }
  renderReports();
}
function reportEditorHtml(rep){
  return `
    <div class="rp-editor">
      <input type="text" class="rp-doc-title" value="${esc(rep.title)}" aria-label="문서 제목">
      <div class="rp-toolbar">
        <button class="sc-tb" data-rp-cmd="block" data-val="h3">제목</button>
        <button class="sc-tb" data-rp-cmd="block" data-val="h4">소제목</button>
        <button class="sc-tb" data-rp-cmd="block" data-val="p">본문</button>
        <button class="sc-tb" data-rp-cmd="sum">요약</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb" data-rp-cmd="bold"><b>B</b></button>
        <button class="sc-tb" data-rp-cmd="italic"><i>I</i></button>
        <button class="sc-tb" data-rp-cmd="underline"><u>U</u></button>
        <button class="sc-tb" data-rp-cmd="quote" title="인용구(선택한 문장을 이탤릭+큰따옴표로, 다시 누르면 해제)">“”</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb sc-hl" data-rp-cmd="highlight" data-color="#fff59d" title="노랑 형광펜" style="background:#fff59d">&nbsp;</button>
        <button class="sc-tb sc-hl" data-rp-cmd="highlight" data-color="#b9f6ca" title="초록 형광펜" style="background:#b9f6ca">&nbsp;</button>
        <button class="sc-tb sc-hl" data-rp-cmd="highlight" data-color="#ffcdd2" title="분홍 형광펜" style="background:#ffcdd2">&nbsp;</button>
        <button class="sc-tb sc-hl-clear" data-rp-cmd="highlight" data-color="" title="형광펜 지우기">지우기</button>
        <span class="sc-tb-sep"></span>
        <button class="sc-tb" data-rp-cmd="hr">— 가로줄</button>
        <button class="sc-tb" data-rp-cmd="image">🖼 이미지</button>
      </div>
      <div class="rp-body" contenteditable="true" spellcheck="false">${rep.bodyHtml || ''}</div>
      <input type="file" accept="image/*" class="rp-img-input" hidden>
      <div class="rp-editor-foot">
        <span class="rp-save-state"></span>
        <span class="rp-foot-spacer"></span>
        <button class="sc-btn" data-rp-foot="print"><svg class="btn-ico" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="15" height="15" style="fill:none"><path stroke-linecap="round" stroke-linejoin="round" d="M6.72 13.829c-.24.03-.48.062-.72.096m.72-.096a42.415 42.415 0 0 1 10.56 0m-10.56 0L6.34 18m10.94-4.171c.24.03.48.062.72.096m-.72-.096L17.66 18m0 0 .229 2.523a1.125 1.125 0 0 1-1.12 1.227H7.231c-.662 0-1.18-.568-1.12-1.227L6.34 18m11.318 0h1.091A2.25 2.25 0 0 0 21 15.75V9.456c0-1.081-.768-2.015-1.837-2.175a48.055 48.055 0 0 0-1.913-.247M6.34 18H5.25A2.25 2.25 0 0 1 3 15.75V9.456c0-1.081.768-2.015 1.837-2.175a48.041 48.041 0 0 1 1.913-.247m10.5 0a48.536 48.536 0 0 0-10.5 0m10.5 0V3.375c0-.621-.504-1.125-1.125-1.125h-8.25c-.621 0-1.125.504-1.125 1.125v3.659M18 10.5h.008v.008H18V10.5Zm-3 0h.008v.008H15V10.5Z"/></svg>인쇄</button>
        <button class="sc-btn" data-rp-foot="word"><svg class="btn-ico" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="15" height="15" style="fill:none"><path stroke-linecap="round" stroke-linejoin="round" d="M19.5 14.25v-2.625a3.375 3.375 0 0 0-3.375-3.375h-1.5A1.125 1.125 0 0 1 13.5 7.125v-1.5a3.375 3.375 0 0 0-3.375-3.375H8.25m.75 12 3 3m0 0 3-3m-3 3v-6m-1.5-9H5.625c-.621 0-1.125.504-1.125 1.125v17.25c0 .621.504 1.125 1.125 1.125h12.75c.621 0 1.125-.504 1.125-1.125V11.25a9 9 0 0 0-9-9Z"/></svg>Word</button>
        <button class="sc-btn rp-row-del" data-rp-foot="delete"><svg class="btn-ico" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="15" height="15" style="fill:none"><path stroke-linecap="round" stroke-linejoin="round" d="m14.74 9-.346 9m-4.788 0L9.26 9m9.968-3.21c.342.052.682.107 1.022.166m-1.022-.165L18.16 19.673a2.25 2.25 0 0 1-2.244 2.077H8.084a2.25 2.25 0 0 1-2.244-2.077L4.772 5.79m14.456 0a48.108 48.108 0 0 0-3.478-.397m-12 .562c.34-.059.68-.114 1.022-.165m0 0a48.11 48.11 0 0 1 3.478-.397m7.5 0v-.916c0-1.18-.91-2.164-2.09-2.201a51.964 51.964 0 0 0-3.32 0c-1.18.037-2.09 1.022-2.09 2.201v.916m7.5 0a48.667 48.667 0 0 0-7.5 0"/></svg>삭제</button>
        <button class="sc-btn primary" data-rp-foot="save"><svg class="btn-ico" viewBox="0 0 24 24" stroke="currentColor" stroke-width="1.5" width="15" height="15" style="fill:none"><path stroke-linecap="round" stroke-linejoin="round" d="m20.25 7.5-.625 10.632a2.25 2.25 0 0 1-2.247 2.118H6.622a2.25 2.25 0 0 1-2.247-2.118L3.75 7.5m8.25 3v6.75m0 0-3-3m3 3 3-3M3.375 7.5h17.25c.621 0 1.125-.504 1.125-1.125v-1.5c0-.621-.504-1.125-1.125-1.125H3.375c-.621 0-1.125.504-1.125 1.125v1.5c0 .621.504 1.125 1.125 1.125Z"/></svg>저장</button>
      </div>
    </div>`;
}
/* 열려 있는 아코디언 에디터의 내용을 즉시 저장 (재렌더·탭이동 전 호출) */
async function flushReportEditor(){
  if(_reportAutosave){ clearTimeout(_reportAutosave); _reportAutosave = null; }
  const row = document.querySelector('.rp-row.open');
  if(!row) return;
  const r = newsState.reports[row.dataset.id];
  if(!r) return;
  const titleEl = row.querySelector('.rp-doc-title');
  const body = row.querySelector('.rp-body');
  if(!body) return;
  const t = (titleEl.value || '').trim() || reportTitleAt(r.createdAt);
  if(r.title !== t || r.bodyHtml !== body.innerHTML){
    r.title = t; r.bodyHtml = body.innerHTML;
    await saveReport(r);
  }
}
function wireReportEditor(row, id){
  const rep = newsState.reports[id];
  if(!rep) return;
  const titleEl = row.querySelector('.rp-doc-title');
  const body = row.querySelector('.rp-body');
  const fileInp = row.querySelector('.rp-img-input');
  const stateEl = row.querySelector('.rp-save-state');
  if(!body) return;

  // 기존 문서 교정: 맨 끝이 <hr>거나 비어 있으면 정상 서체의 빈 문단을 붙여 커서 착지점을 만든다
  const ensureTailPara = ()=>{
    const last = body.lastElementChild;
    if(!last || last.tagName === 'HR'){
      body.insertAdjacentHTML('beforeend', '<p><br></p>');
    }
  };
  ensureTailPara();

  const markSaved = (ok)=>{
    if(ok === false){ stateEl.textContent = '저장 실패 — 새로고침 후 다시'; stateEl.classList.add('bad'); return; }
    const d = new Date(), p = n=> String(n).padStart(2,'0');
    stateEl.textContent = `임시저장됨 ${p(d.getHours())}:${p(d.getMinutes())}`;
    stateEl.classList.remove('bad');
  };
  const persist = async ()=>{
    const r = newsState.reports[id];
    if(!r) return;
    r.title = (titleEl.value || '').trim() || reportTitleAt(r.createdAt);
    r.bodyHtml = body.innerHTML;
    markSaved(await saveReport(r));
    const nameEl = row.querySelector('.rp-row-name');
    if(nameEl) nameEl.textContent = r.title;
  };
  const scheduleSave = ()=>{
    if(_reportAutosave) clearTimeout(_reportAutosave);
    _reportAutosave = setTimeout(persist, 2000);
  };

  titleEl.addEventListener('input', scheduleSave);
  body.addEventListener('input', scheduleSave);
  body.addEventListener('blur', persist);
  body.addEventListener('paste', (e)=>{
    e.preventDefault();
    const cd = e.clipboardData || window.clipboardData;
    const imgFile = clipboardImageFile(e);
    if(imgFile){ insertImageAtCursor(body, imgFile, scheduleSave); return; }
    const html = cd ? cd.getData('text/html') : '';
    if(html){
      const sanitized = sanitizePastedHtml(html);
      if(sanitized){
        body.focus();
        document.execCommand('insertHTML', false, sanitized);
        scheduleSave();
        return;
      }
    }
    const text = cd ? cd.getData('text/plain') : '';
    if(text){ document.execCommand('insertText', false, text); scheduleSave(); }
  });
  wireImageClickResize(body, scheduleSave);

  const setBlockRole = (role)=>{
    document.execCommand('formatBlock', false, role === 'sum' ? 'p' : role);
    const sel = window.getSelection();
    if(!sel || !sel.rangeCount) return;
    let n = sel.anchorNode;
    while(n && n !== body && !/^(P|H3|H4)$/.test(n.nodeName)) n = n.parentNode;
    if(n && n !== body) n.classList.toggle('rp-sum', role === 'sum');
  };
  row.querySelectorAll('.sc-tb').forEach(btn=>{
    btn.onmousedown = (e)=> e.preventDefault();
    btn.onclick = ()=>{
      const cmd = btn.dataset.rpCmd;
      body.focus();
      if(cmd === 'bold') document.execCommand('bold');
      else if(cmd === 'italic') document.execCommand('italic');
      else if(cmd === 'underline') document.execCommand('underline');
      else if(cmd === 'quote') toggleQuoteMark(body);
      else if(cmd === 'hr') document.execCommand('insertHorizontalRule');
      else if(cmd === 'block') setBlockRole(btn.dataset.val);
      else if(cmd === 'sum') setBlockRole('sum');
      else if(cmd === 'highlight') applyHighlight(btn.dataset.color);
      else if(cmd === 'image'){ fileInp.click(); return; }
      scheduleSave();
    };
  });
  fileInp.onchange = async ()=>{
    const file = fileInp.files && fileInp.files[0];
    fileInp.value = '';
    if(!file) return;
    await insertImageAtCursor(body, file, persist);
  };
  row.querySelectorAll('[data-rp-foot]').forEach(btn=>{
    btn.onclick = async ()=>{
      const act = btn.dataset.rpFoot;
      if(act === 'save'){ await persist(); }
      else if(act === 'print'){ await persist(); printReport(id); }
      else if(act === 'word'){ await persist(); exportReportWord(id); }
      else if(act === 'delete'){
        if(!confirm(`'${rep.title}' 리포트를 삭제할까요?`)) return;
        await deleteReport(id); renderReports();
      }
    };
  });
}

/* ---------- 인쇄 (A4) ---------- */
function reportPrintCss(){
  return `@page{size:A4;margin:18mm 16mm;}
    *{box-sizing:border-box;}
    body{font-family:'Pretendard','Pretendard Variable',system-ui,-apple-system,sans-serif;color:#111;line-height:1.7;font-size:11.5pt;margin:0;}
    h1.rp-print-title{font-size:16pt;margin:0 0 14pt;padding-bottom:6pt;border-bottom:2px solid #222;}
    h3{font-size:13pt;margin:16pt 0 4pt;}
    h4{font-size:11.5pt;margin:11pt 0 3pt;color:#333;}
    p{margin:4pt 0;}
    p.rp-sum{font-size:8.5pt;color:#666;}
    hr{border:none;border-top:1px solid #bbb;margin:13pt 0;}
    img{max-width:100%;height:auto;}`;
}
function printReport(id){
  const rep = newsState.reports[id];
  if(!rep){ alert('리포트를 찾을 수 없어요.'); return; }
  printReportDoc(rep.title, rep.bodyHtml);
}
/* 제목+본문만으로 인쇄 — 뉴스 리포트와 SNS "떠든 히스토리"(people.html iframe)가 같이 쓴다 */
function printReportDoc(title, bodyHtml){
  const rep = { title, bodyHtml };
  const w = window.open('', '_blank');
  if(!w){ alert('팝업이 차단됐어요. 팝업을 허용한 뒤 다시 시도하세요.'); return; }
  w.document.write(`<!doctype html><html lang="ko"><head><meta charset="utf-8">
    <title>${esc(rep.title)}</title>
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/static/pretendard.css">
    <style>${reportPrintCss()}</style></head><body>
    <h1 class="rp-print-title">${esc(rep.title)}</h1>
    ${rep.bodyHtml || ''}
    <script>window.onload=function(){setTimeout(function(){window.print();},250);};<\/script>
    </body></html>`);
  w.document.close();
}

/* ---------- Word(.docx) 내보내기 ---------- */
let _docxLibPromise = null;
function ensureDocxLib(){
  if(window.htmlDocx) return Promise.resolve(true);
  if(_docxLibPromise) return _docxLibPromise;
  _docxLibPromise = new Promise(resolve=>{
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/html-docx-js@0.3.1/dist/html-docx.js';
    s.onload = ()=> resolve(!!window.htmlDocx);
    s.onerror = ()=>{ _docxLibPromise = null; resolve(false); };
    document.head.appendChild(s);
  });
  return _docxLibPromise;
}
async function exportReportWord(id){
  const rep = newsState.reports[id];
  if(!rep){ alert('리포트를 찾을 수 없어요.'); return; }
  return exportReportDocWord(rep.title, rep.bodyHtml);
}
async function exportReportDocWord(title, bodyHtml){
  const rep = { title, bodyHtml };
  const ok = await ensureDocxLib();
  if(!ok || !window.htmlDocx){ alert('Word 변환 모듈을 불러오지 못했어요. 인쇄 기능을 이용해 주세요.'); return; }
  const html = `<!doctype html><html><head><meta charset="utf-8"><style>
    body{font-family:'Malgun Gothic','맑은 고딕',sans-serif;font-size:11pt;line-height:1.7;color:#111;}
    h1{font-size:16pt;} h3{font-size:13pt;} h4{font-size:11.5pt;color:#333;}
    p{margin:4pt 0;} p.rp-sum{font-size:8.5pt;color:#666;}
    hr{border:none;border-top:1px solid #bbb;}
    </style></head><body><h1>${esc(rep.title)}</h1>${rep.bodyHtml || ''}</body></html>`;
  try{
    const blob = window.htmlDocx.asBlob(html);
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = (rep.title || '리포트').replace(/[\\/:*?"<>|]/g, '').replace(/\s+/g, '_') + '.docx';
    document.body.appendChild(a); a.click(); a.remove();
    setTimeout(()=> URL.revokeObjectURL(a.href), 2000);
  }catch(e){ console.warn('[Word 변환 실패]', e); alert('Word 파일을 만들지 못했어요. 인쇄 기능을 이용해 주세요.'); }
}

/* ---------- 스크랩 직접 추가 (URL / 직접입력 / 유튜브) ---------- */
/* 본문(설명 우선)에서 첫 문장을 뽑는다 — 노션 등 <title>이 부실한 페이지 대응(2026-09-09).
   일반 웹페이지 전부에 통일 적용. 문장부호(.!?…) 기준 첫 문장, 없으면 앞부분만 자른다. */
function firstSentenceFrom(text){
  const t = String(text||'').replace(/\s+/g,' ').trim();
  if(!t) return '';
  const m = t.match(/^.{2,200}?[.!?。！？](?=\s|$)/);
  if(m) return m[0].trim();
  return t.length > 60 ? t.slice(0,60) + '…' : t;
}
/* 인스타그램 og:description은 "45 likes, 70 comments - user on Month Day, Year: "캡션""
   형식으로 좋아요·댓글 수·날짜·계정명이 앞에 붙어 나온다 — 실제 캡션만 남기고 제거(2026-09-09). */
function stripInstagramMetaPrefix(text){
  const t = String(text||'');
  const m = t.match(/^[\d.,]+[KMkm]?\s+likes?,\s*[\d.,]+[KMkm]?\s+comments?\s*-\s*\S+\s+on\s+[A-Za-z]+\s+\d{1,2},\s*\d{4}:\s*/i);
  let rest = m ? t.slice(m[0].length) : t;
  rest = rest.trim().replace(/^["“”'‘’]+/, '').replace(/["“”'‘’]+$/, '').trim();
  return rest;
}
function extractArticleFromHtml(html, url){
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const meta = (sel)=> doc.querySelector(sel)?.getAttribute('content') || '';
  const rawTitle = (meta('meta[property="og:title"]') || (doc.querySelector('title')?.textContent || '')).trim();
  const desc  = stripInstagramMetaPrefix(meta('meta[property="og:description"]') || meta('meta[name="description"]'));
  doc.querySelectorAll('script,style,noscript,nav,header,footer,aside,form').forEach(el=> el.remove());
  const cand = doc.querySelector('article, [itemprop="articleBody"], #newsct_article, #article-view-content-div, .article-body, .news-content, #articleBody') || doc.body;
  let text = (cand ? cand.textContent : '').replace(/\s+/g,' ').trim();
  if(text.length > 6000) text = text.slice(0, 6000) + '…';
  // 제목은 <title>/og:title 대신 본문(설명 우선) 첫 문장을 쓴다 — 노션·인스타그램 등에서
  // 사이트 이름만 나오는 문제 대응(2026-09-09). 전부 실패하면 기존 title로 폴백.
  const title = firstSentenceFrom(desc || text) || rawTitle;
  // 인스타그램은 SPA라 body(text)가 og:description(desc)과 같은 캡션을 그대로 다시 담고 있어
  // desc+text로 합치면 캡션이 그대로 두 번 붙는다 — 캡션(desc) 하나만 쓴다(2026-09-17).
  if(isInstagramUrl(url)) return { title, body: desc || text };
  // 본문: 설명(desc)보다 눈에 띄게 긴 실제 기사 본문(text)이 있으면 desc+text 전체를 채우고,
  // 노션 랜딩페이지처럼 설명문 몇 줄이 전부인(=실제 기사 본문이 없는) 짧은 페이지는
  // 제목과 동일하게 첫 문장만 채운다 — 본문에 설명 전체가 그대로 중복 노출되는 문제
  // 대응(2026-09-09).
  const hasRealBody = !!text && text.length > desc.length + 30;
  const body = hasRealBody
    ? (desc ? desc + '\n\n' : '') + text
    : (firstSentenceFrom(desc || text) || desc || text);
  return { title, body };
}
async function fetchArticlePage(url){
  const res = await fetch(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(url)}`, {cache:'no-store'});
  if(!res.ok) throw new Error('페이지를 가져오지 못했어요 (' + res.status + ')');
  return extractArticleFromHtml(await res.text(), url);
}
function isYoutubeUrl(url){
  return /(?:youtube\.com\/(?:watch|shorts|live)|youtu\.be\/)/i.test(url || '');
}
function isInstagramUrl(url){
  return /instagram\.com\/(?:p|reel|reels|tv)\//i.test(url || '');
}
function isTweetUrl(url){
  return /(?:twitter\.com|x\.com)\/[^/]+\/status\/\d+/i.test(url || '');
}
function isFbPostUrl(url){
  return /facebook\.com\/(?:[^/]+\/posts\/|[^/]+\/videos\/|permalink\.php|story\.php|watch\/?\?v=|share\/[pv]\/|photo)/i.test(url || '')
      || /fb\.watch\//i.test(url || '');
}
/* 페북 share/p/ 短링크는 fb-post 위젯이 못 읽는다 → Worker로 실제 permalink를 받아온다 */
async function resolveShareUrl(url){
  if(!/facebook\.com\/share\//i.test(url)) return url;
  try{
    const r = await fetch(`${JUNGLE_CONFIG.naverProxyUrl}/resolve?url=${encodeURIComponent(url)}`, {cache:'no-store'});
    const d = await r.json();
    const f = d && d.finalUrl;
    if(f && /facebook\.com\/(?:[^/]+\/(?:posts|videos)\/|permalink|photo|story\.php|watch)/i.test(f)){
      return f.split('?')[0];
    }
  }catch(e){}
  return url;
}
/* 유튜브는 페이지가 JS 렌더라 본문 추출이 안 된다. oEmbed로 제목만 가져온다(Worker 경유). */
async function fetchYoutubeTitle(url){
  const oe = `https://www.youtube.com/oembed?url=${encodeURIComponent(url)}&format=json`;
  const res = await fetch(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(oe)}`, {cache:'no-store'});
  if(!res.ok) throw new Error('유튜브 정보를 가져오지 못했어요');
  const data = await res.json();
  return { title: data.title || '', author: data.author_name || '', thumbnail: data.thumbnail_url || '' };
}
/* X(트위터) 게시물 — oEmbed로 본문·작성자를 가져온다(Worker 경유). */
async function fetchTweetOembed(url){
  const oe = `https://publish.twitter.com/oembed?url=${encodeURIComponent(url)}&omit_script=1&dnt=1`;
  const res = await fetch(`${JUNGLE_CONFIG.naverProxyUrl}/fetch?url=${encodeURIComponent(oe)}`, {cache:'no-store'});
  if(!res.ok) throw new Error('트윗을 가져오지 못했어요');
  const data = await res.json();
  const tmp = document.createElement('div'); tmp.innerHTML = data.html || '';
  const p = tmp.querySelector('blockquote p');
  const text = (p ? p.textContent : '').trim();
  return { text, author: data.author_name || '', html: data.html || '' };
}

/* SNS 임베드 SDK — 필요할 때 한 번만 로드 */
let _fbSdkPromise = null;
function loadFbSdk(){
  if(_fbSdkPromise) return _fbSdkPromise;
  _fbSdkPromise = new Promise(resolve=>{
    if(!document.getElementById('fb-root')){
      const r = document.createElement('div'); r.id = 'fb-root'; document.body.appendChild(r);
    }
    window.fbAsyncInit = function(){
      try{
        const cfg = { xfbml:false, version:'v19.0' };
        if(JUNGLE_CONFIG.fbAppId) cfg.appId = JUNGLE_CONFIG.fbAppId;
        FB.init(cfg);
      }catch(e){}
      resolve();
    };
    const s = document.createElement('script');
    s.async = true; s.defer = true; s.crossOrigin = 'anonymous';
    s.src = 'https://connect.facebook.net/ko_KR/sdk.js#xfbml=1&version=v19.0';
    s.onerror = ()=> resolve();
    document.head.appendChild(s);
    setTimeout(resolve, 4000); // SDK가 안 떠도 진행
  });
  return _fbSdkPromise;
}
let _twttrPromise = null;
function loadTwitterWidgets(){
  if(_twttrPromise) return _twttrPromise;
  _twttrPromise = new Promise(resolve=>{
    const s = document.createElement('script');
    s.async = true; s.charset = 'utf-8';
    s.src = 'https://platform.twitter.com/widgets.js';
    s.onload = resolve; s.onerror = ()=> resolve();
    document.head.appendChild(s);
    setTimeout(resolve, 4000);
  });
  return _twttrPromise;
}

/* 카드 안의 .sns-embed 컨테이너를 실제 위젯으로 렌더 (data-url 만 필요) */
async function renderSnsEmbeds(root){
  const fbEls = root.querySelectorAll('.sns-embed[data-provider="facebook"]:not([data-rendered])');
  const twEls = root.querySelectorAll('.sns-embed[data-provider="twitter"]:not([data-rendered])');
  if(fbEls.length){
    await loadFbSdk();
    fbEls.forEach(el=>{
      el.dataset.rendered = '1';
      el.innerHTML = `<div class="fb-post" data-href="${esc(el.dataset.url)}" data-width="500" data-show-text="true"></div>`;
      try{ if(window.FB && FB.XFBML) FB.XFBML.parse(el); }catch(e){}
    });
  }
  if(twEls.length){
    await loadTwitterWidgets();
    twEls.forEach(el=>{
      el.dataset.rendered = '1';
      el.innerHTML = `<blockquote class="twitter-tweet"><a href="${esc(el.dataset.url)}"></a></blockquote>`;
      try{ if(window.twttr && twttr.widgets) twttr.widgets.load(el); }catch(e){}
    });
  }
}

/* 인스타그램 공식 임베드 위젯(embed.js) — 페북/트위터 위젯과 같은 지연 로드 패턴(2026-09-09)
   최초 시도 때 네트워크가 느려 4초 타임아웃이 onload보다 먼저 끝나버리면 실패(false)가
   그대로 캐시되어, 스크립트가 뒤늦게 실제로 로드돼도 이후 모든 인스타 임베드가 계속
   "불러오지 못했어요"로만 뜨는 문제가 있었다 — 실패는 캐시하지 않고 재시도 가능하게,
   타임아웃도 6초로 늘려 수정(2026-09-09). */
let _igEmbedPromise = null;
function loadInstagramEmbed(){
  if(window.instgrm && window.instgrm.Embeds) return Promise.resolve(true);
  if(_igEmbedPromise) return _igEmbedPromise;
  _igEmbedPromise = new Promise(resolve=>{
    let settled = false;
    const finish = (ok)=>{
      if(settled) return;
      settled = true;
      if(!ok) _igEmbedPromise = null; // 실패는 캐시하지 않음 — 다음 시도에서 다시 시도
      resolve(ok);
    };
    let s = document.querySelector('script[data-ig-embed]');
    if(!s){
      s = document.createElement('script');
      s.async = true;
      s.dataset.igEmbed = '1';
      s.src = 'https://www.instagram.com/embed.js';
      s.onload = ()=> finish(true);
      s.onerror = ()=> finish(false);
      document.head.appendChild(s);
    }else{
      s.addEventListener('load', ()=> finish(true));
      s.addEventListener('error', ()=> finish(false));
    }
    setTimeout(()=> finish(!!(window.instgrm && window.instgrm.Embeds)), 6000);
  });
  return _igEmbedPromise;
}
/* 유튜브(쇼츠 포함) 재생용 embed URL — 영상ID만 뽑아 iframe에 넣는다 */
function youtubeEmbedUrl(url){
  try{
    const u = new URL(url);
    let id = '';
    if(/(^|\.)youtu\.be$/i.test(u.hostname)) id = u.pathname.slice(1);
    else if(/\/shorts\//i.test(u.pathname)) id = u.pathname.split('/shorts/')[1];
    else if(/\/live\//i.test(u.pathname)) id = u.pathname.split('/live/')[1];
    else id = u.searchParams.get('v') || '';
    id = (id||'').split(/[?&\/]/)[0];
    return id ? `https://www.youtube.com/embed/${id}?autoplay=1` : '';
  }catch(e){ return ''; }
}
/* 메모 썸네일 클릭 → 인스타그램(영상·카드뉴스)·유튜브(쇼츠 포함) 임베드 팝업 복원(2026-09-09).
   저장된 embed 정보가 없어도 링크 패턴만으로 판별해, 예전에 저장된 메모도 그대로 동작한다. */
async function openEmbedPopup(url){
  if(!url) return;
  const isShorts = /\/shorts\//i.test(url);
  const back = document.createElement('div');
  back.className = 'ql-modal-back embed-popup-back';
  back.innerHTML = `<div class="ql-modal embed-popup${isShorts?' embed-popup-portrait':''}">
      <button class="embed-popup-close" id="embedPopupClose" title="닫기">✕</button>
      <div class="embed-popup-body" id="embedPopupBody"><div class="empty-hint">불러오는 중…</div></div>
    </div>`;
  document.body.appendChild(back);
  const close = ()=> back.remove();
  back.querySelector('#embedPopupClose').onclick = close;
  guardBackdropClose(back, close);
  const body = back.querySelector('#embedPopupBody');

  if(isYoutubeUrl(url)){
    const embedUrl = youtubeEmbedUrl(url);
    body.innerHTML = embedUrl
      ? `<iframe src="${esc(embedUrl)}" allow="autoplay; encrypted-media; picture-in-picture" allowfullscreen></iframe>`
      : `<div class="empty-hint">영상을 불러오지 못했어요.<br><a href="${esc(url)}" target="_blank" rel="noopener">새 창에서 열기</a></div>`;
  }else if(isInstagramUrl(url)){
    body.innerHTML = `<blockquote class="instagram-media" data-instgrm-permalink="${esc(url)}" data-instgrm-version="14" style="margin:0;"></blockquote>`;
    const ok = await loadInstagramEmbed();
    if(ok && window.instgrm && window.instgrm.Embeds){
      try{ window.instgrm.Embeds.process(); }catch(e){}
    }else{
      body.innerHTML = `<div class="empty-hint">인스타그램을 불러오지 못했어요.<br><a href="${esc(url)}" target="_blank" rel="noopener">새 창에서 열기</a></div>`;
    }
  }else{
    close();
    window.open(url, '_blank', 'noopener');
  }
}

const SCRAP_DRAFT_KEY = 'jungle_scrap_add_draft_v1';
const SCRAP_DRAFT_TTL = 24 * 3600 * 1000;
function loadScrapDraft(){
  try{
    const d = JSON.parse(localStorage.getItem(SCRAP_DRAFT_KEY) || 'null');
    if(d && Date.now() - (d.at || 0) < SCRAP_DRAFT_TTL) return d;
  }catch(e){}
  return null;
}
function clearScrapDraft(){ try{ localStorage.removeItem(SCRAP_DRAFT_KEY); }catch(e){} }
/* 페이지가 새로 떠도(휴대폰 앱 전환 등) 쓰다 만 스크랩이 있으면 스크랩 탭에서 창을 다시 띄워 준다 */
function restoreScrapDraftIfAny(){
  if(!loadScrapDraft() || document.querySelector('.scrap-add-modal')) return;
  showMode('news');
  if(typeof showNewsSubtab === 'function') showNewsSubtab('saved');
  openScrapAddModal();
}
function openScrapAddModal(){
  const back = document.createElement('div');
  back.className = 'ql-modal-back';
  const SA_DESC = {
    url: '기사 주소는 제목·본문을 자동으로 가져와요. <b>페이스북·X(트위터) 게시물</b> 링크는 그 글·사진·영상이 카드에 그대로 임베드됩니다. <b>유튜브</b> 링크는 제목·썸네일만 가져오고, 영상 내용은 직접 정리해요.',
    manual: '링크 없이 <b>내용만</b> 적어 스크랩해요. 제목은 없어도 됩니다.'
  };
  back.innerHTML = `<div class="ql-modal scrap-add-modal">
      <h3>스크랩 추가</h3>
      <div class="sa-tabs">
        <button class="sa-tab active" data-sa="url">URL</button>
        <button class="sa-tab" data-sa="manual">직접 입력</button>
      </div>
      <div class="sa-desc" id="saDesc"></div>
      <div class="sa-pane" data-pane="url">
        <div class="sa-row">
          <input type="text" id="saUrl" class="sa-full" placeholder="기사 · 페이스북 · X · 유튜브 주소">
          <button class="small" id="saUrlFetch">가져오기</button>
        </div>
        <div id="saUrlMsg" class="cf-msg" hidden></div>
        <div id="saUrlEmbedPrev" class="sa-embed-prev" hidden></div>
        <div class="sa-label" data-for="url" hidden>제목</div>
        <input type="text" id="saUrlTitle" class="sa-full" placeholder="제목" hidden>
        <div class="sa-label" data-for="url" hidden>본문</div>
        <textarea id="saUrlBody" class="sa-body" placeholder="가져온 본문 (다듬어도 됩니다)" hidden></textarea>
      </div>
      <div class="sa-pane" data-pane="manual" hidden>
        <div class="sa-label">제목 <span style="font-weight:400;">(선택)</span></div>
        <input type="text" id="saManTitle" class="sa-full" placeholder="비워두면 본문 첫 줄이 제목이 됩니다">
        <div class="sa-label">내용</div>
        <textarea id="saManBody" class="sa-body" placeholder="메모·원고를 자유롭게 적어요"></textarea>
      </div>
      <div class="ql-actions">
        <button class="subtab-btn" id="saCancel">취소</button>
        <button class="subtab-btn" id="saSave">스크랩 저장</button>
      </div>
    </div>`;
  document.body.appendChild(back);
  const $ = (s)=> back.querySelector(s);
  const close = ()=> back.remove();
  // 입력 중엔 배경 클릭으로 안 닫힘("스크랩 추가" 버튼 자리가 곧 배경이라 터치패드 오클릭에 글이 날아갔음)
  const SA_FIELDS = ['saUrl','saUrlTitle','saUrlBody','saManTitle','saManBody'];
  const hasInput = ()=> SA_FIELDS.some(id=> ($('#'+id)?.value || '').trim() !== '');
  guardBackdropClose(back, close, hasInput);
  $('#saCancel').onclick = ()=>{
    if(hasInput() && !confirm('작성 중인 내용을 버릴까요?')) return;
    clearScrapDraft();
    close();
  };

  let mode = 'url';
  let ytData = null;     // {url, thumbnail} — URL 탭에서 유튜브 링크 감지 시
  let urlEmbed = null;   // {provider:'twitter'|'facebook', url} — URL 탭에서 SNS 링크 감지 시
  const setMode = (nm)=>{
    mode = nm;
    back.querySelectorAll('.sa-tab').forEach(x=> x.classList.toggle('active', x.dataset.sa===nm));
    back.querySelectorAll('.sa-pane').forEach(p=> p.hidden = p.dataset.pane !== nm);
    $('#saDesc').innerHTML = SA_DESC[nm];
  };
  back.querySelectorAll('.sa-tab').forEach(t=>{ t.onclick = ()=>{ setMode(t.dataset.sa); saveDraft(); }; });
  setMode('url');

  // 임시저장(2026-09-28) — 창이 어떤 이유로든 사라져도(휴대폰에서 다른 앱 갔다 오면 페이지가 통째로
  // 새로 뜨는 경우 포함) 쓰던 내용을 잃지 않도록 입력할 때마다 이 기기에 저장, 다시 열면 복원.
  const saveDraft = ()=>{
    if(!hasInput()){ clearScrapDraft(); return; }
    const d = { mode, at: Date.now(), ytData, urlEmbed };
    SA_FIELDS.forEach(id=> d[id] = $('#'+id).value);
    try{ localStorage.setItem(SCRAP_DRAFT_KEY, JSON.stringify(d)); }catch(e){}
  };
  const draft = loadScrapDraft();
  if(draft){
    SA_FIELDS.forEach(id=>{ if(typeof draft[id] === 'string') $('#'+id).value = draft[id]; });
    ytData = draft.ytData || null;
    urlEmbed = draft.urlEmbed || null;
    if(draft.saUrlTitle || draft.saUrlBody){
      back.querySelectorAll('.sa-label[data-for="url"]').forEach(el=> el.hidden = false);
      $('#saUrlTitle').hidden = false; $('#saUrlBody').hidden = false;
    }
    setMode(draft.mode === 'manual' ? 'manual' : 'url');
    const note = document.createElement('div');
    note.className = 'cf-msg ok';
    note.textContent = '작성 중이던 내용을 불러왔어요.';
    $('#saDesc').after(note);
  }
  back.addEventListener('input', saveDraft);

  $('#saUrlFetch').onclick = async ()=>{
    let url = $('#saUrl').value.trim();
    const msg = $('#saUrlMsg');
    if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
    try{ new URL(url); }catch(e){ msg.hidden = false; msg.textContent = '주소가 올바르지 않습니다.'; return; }

    const revealUrlFields = ()=>{
      back.querySelectorAll('.sa-label[data-for="url"]').forEach(el=> el.hidden = false);
      $('#saUrlTitle').hidden = false; $('#saUrlBody').hidden = false;
    };
    const prev = $('#saUrlEmbedPrev');

    // 유튜브는 페이지가 JS 렌더라 본문 추출이 안 됨 — oEmbed로 제목·썸네일만, 내용은 직접 정리
    if(isYoutubeUrl(url)){
      $('#saUrlFetch').disabled = true;
      msg.hidden = false; msg.classList.add('ok'); msg.textContent = '가져오는 중…';
      try{
        const {title, author, thumbnail} = await fetchYoutubeTitle(url);
        $('#saUrl').value = url;
        ytData = { url, thumbnail: thumbnail || '' };
        urlEmbed = null;
        revealUrlFields();
        if(title) $('#saUrlTitle').value = title;
        $('#saUrlBody').placeholder = '영상 요지·발언 등을 직접 정리해요';
        prev.hidden = !thumbnail;
        prev.innerHTML = thumbnail ? `<img src="${esc(thumbnail)}" alt="" style="max-width:220px;border-radius:8px;display:block;">` : '';
        msg.classList.remove('ok');
        msg.textContent = title ? `가져왔어요${author?' · '+author:''}. 영상 내용은 아래에 직접 적어 주세요.` : '제목을 못 가져왔어요. 직접 입력해 주세요.';
      }catch(e){
        msg.classList.remove('ok');
        revealUrlFields();
        msg.textContent = '유튜브 정보를 못 가져왔어요. 제목을 직접 입력해 주세요.';
      }finally{ $('#saUrlFetch').disabled = false; }
      return;
    }

    $('#saUrlFetch').disabled = true;
    msg.hidden = false; msg.textContent = '가져오는 중…'; msg.classList.add('ok');

    // ── X(트위터) 게시물 ──
    if(isTweetUrl(url)){
      try{
        const {text, author} = await fetchTweetOembed(url);
        $('#saUrl').value = url;
        urlEmbed = { provider:'twitter', url };
        revealUrlFields();
        $('#saUrlTitle').value = text ? text.split('\n')[0].slice(0,50) : (author ? '@'+author : 'X 게시물');
        $('#saUrlBody').value = text + (author ? `\n\n— @${author}` : '');
        prev.hidden = false;
        prev.innerHTML = `<div class="sns-embed" data-provider="twitter" data-url="${esc(url)}"></div>`;
        renderSnsEmbeds(prev);
        msg.hidden = true; msg.classList.remove('ok');
      }catch(e){
        msg.classList.remove('ok'); revealUrlFields();
        urlEmbed = { provider:'twitter', url };
        prev.hidden = false;
        prev.innerHTML = `<div class="sns-embed" data-provider="twitter" data-url="${esc(url)}"></div>`;
        renderSnsEmbeds(prev);
        msg.textContent = '트윗 본문은 카드에서 그대로 보여요. 필요하면 제목·본문을 직접 넣어 주세요.';
      }finally{ $('#saUrlFetch').disabled = false; }
      return;
    }

    // ── 페이스북 게시물 (본문 추출 불가 — 임베드만) ──
    if(isFbPostUrl(url)){
      $('#saUrlFetch').disabled = true;
      msg.hidden = false; msg.classList.add('ok'); msg.textContent = '가져오는 중…';
      const canonical = await resolveShareUrl(url);   // share/p/ 短링크 → 실제 permalink
      $('#saUrl').value = canonical;
      urlEmbed = { provider:'facebook', url: canonical };
      revealUrlFields();
      $('#saUrlTitle').placeholder = '제목 (선택)';
      prev.hidden = false;
      prev.innerHTML = `<div class="sns-embed" data-provider="facebook" data-url="${esc(canonical)}"></div>`;
      renderSnsEmbeds(prev);
      msg.classList.remove('ok');
      msg.textContent = '페북 글은 카드에 그대로 임베드돼요(사진·영상 포함). 안 보이면 글쓴이 이름을 눌렀을 때 나오는 원문 주소를 넣어 보세요.';
      $('#saUrlFetch').disabled = false;
      return;
    }

    try{
      const {title, body} = await fetchArticlePage(url);
      $('#saUrl').value = url;
      revealUrlFields();
      $('#saUrlTitle').value = title || '';
      $('#saUrlBody').value = body || '';
      msg.classList.remove('ok');
      if(!body){ msg.textContent = '본문을 자동으로 못 찾았어요. 아래에 직접 넣어 주세요.'; }
      else { msg.hidden = true; }
    }catch(e){
      msg.classList.remove('ok');
      revealUrlFields();
      msg.textContent = '자동 수집에 실패했어요. 제목·본문을 직접 넣어 주세요.';
    }finally{ $('#saUrlFetch').disabled = false; }
  };

  // 제목이 비었으면 본문 첫 줄(최대 50자)을 제목으로. 그것도 없으면 "(메모)".
  const deriveTitle = (title, body)=>{
    if(title) return title;
    const first = String(body || '').split('\n')[0].trim();
    return first ? first.slice(0, 50) : '(메모)';
  };

  const _fetchUrl = $('#saUrlFetch').onclick;
  $('#saUrlFetch').onclick = async ()=>{ await _fetchUrl(); saveDraft(); };

  $('#saSave').onclick = async ()=>{
    let item = null, key = null, body = '';
    if(mode === 'url'){
      let url = $('#saUrl').value.trim();
      if(!/^https?:\/\//i.test(url)) url = 'https://' + url;
      let title = $('#saUrlTitle').value.trim();
      body = $('#saUrlBody').value.trim();
      if(!url){ alert('기사 주소를 넣고 "가져오기"를 눌러주세요.'); return; }
      const snsEmbed = urlEmbed && urlEmbed.url === url ? urlEmbed : (isTweetUrl(url) ? {provider:'twitter',url} : isFbPostUrl(url) ? {provider:'facebook',url} : null);
      const isYt = ytData && ytData.url === url;
      if(!snsEmbed && !title && !body){ alert('제목이나 본문 중 하나는 필요해요.'); return; }
      key = linkToSafeKey(url);
      if(snsEmbed){
        title = (title || (body ? body.split('\n')[0].slice(0,50) : '')) ||
                (snsEmbed.provider==='facebook' ? '페이스북 게시물' : 'X 게시물');
        item = { type: snsEmbed.provider, title, link:url,
                 source: snsEmbed.provider==='facebook' ? '페이스북' : 'X',
                 embed: snsEmbed, bodyIsFinal:true };
      }else if(isYt){
        title = deriveTitle(title, body);
        item = { type:'youtube', title, link:url, youtubeUrl:url, source:'유튜브', bodyIsFinal:true };
        if(ytData.thumbnail) item.thumbnail = ytData.thumbnail;
      }else{
        title = deriveTitle(title, body);
        item = { type:'url', title, link:url, source: guessPressFromUrl(url), bodyIsFinal:false };
      }
    }else{
      let title = $('#saManTitle').value.trim();
      body = $('#saManBody').value.trim();
      if(!title && !body){ alert('내용을 입력하세요.'); return; }
      title = deriveTitle(title, body);
      key = 'm_' + Date.now().toString(36) + Math.random().toString(36).slice(2,6);
      item = { type:'manual', title, link:'', source:'직접 입력', bodyIsFinal:true };
    }
    // 본문은 처음부터 note(=메모 에디터가 편집하는 곳)에 넣는다. 별도 body 필드 안 씀.
    item.note = body ? textToNoteHtml(body) : '';
    item.pubDate = new Date().toISOString();
    item.tags = [];
    item.order = nextSavedOrder(); item.addedAt = Date.now();
    const okSave = await saveSavedNewsItem(key, item);
    if(!okSave){ alert('저장에 실패했어요(로그인 만료 등). 새로고침 후 다시 시도해 주세요.'); return; }
    savedNoteOpenKeys.add(key);   // 만들자마자 내용이 보이도록 메모 펼침
    clearScrapDraft();
    close();
    renderSavedNews();
    // URL 탭으로 기사 본문을 그대로 가져온 경우만 배경에서 Gemini 요약(직접 입력·SNS·유튜브는 제외)
    if(item.type === 'url' && body) enrichScrapWithGeminiTextSummary(key, body);
  };
}

