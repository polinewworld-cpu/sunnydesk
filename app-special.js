/* 특수문자 삽입 모달 — 팩트파인더 SpecialCharacterModal을 정글2용 바닐라 JS로 옮긴 것 (2026-10-06).
   - 기본 100개 세트(자주쓰는·화살표·단위)는 팩트파인더 lib/specialCharSeed.ts에서 그대로 복사. 팩트파인더와 서버·데이터는 공유하지 않는다(사장님 결정).
   - 글을 쓰는 중 텍스트를 드래그하면 뜨는 플로팅 툴바(app-float.js)의 "특수문자" 버튼으로 연다. 모달은 닫히지 않고 계속 열려 있어 연속 삽입 가능.
   - 마스터만 문자 추가·삭제(편집장 권한 대응). 추가분·숨김(삭제한 기본 문자)은 RTDB /special_chars 에 팀 공유로 저장.
   - index.html과 people.html(iframe) 양쪽에서 쓰므로 자체 스타일 주입 IIFE. RTDB는 부모 창의 dbFetch를 빌려 쓴다. */
(function(){
  if(window.__jungleSpecial) return;
  window.__jungleSpecial = true;

  /* ===== 팩트파인더 specialCharSeed.ts 그대로 ===== */
  const 자주쓰는 = [
    ['★','별(채움)'],['☆','별(빈)'],['○','원(빈)'],['●','원(채움)'],['◎','이중원'],
    ['□','사각(빈)'],['■','사각(채움)'],['△','삼각(빈)'],['▲','삼각(채움)'],['▽','역삼각(빈)'],
    ['▼','역삼각(채움)'],['◇','마름모(빈)'],['◆','마름모(채움)'],['♤','스페이드(빈)'],['♠','스페이드(채움)'],
    ['♡','하트(빈)'],['♥','하트(채움)'],['♧','클로버(빈)'],['♣','클로버(채움)'],['☞','오른손가락'],
    ['☜','왼손가락'],['☏','전화'],['✓','체크'],['✔','굵은 체크'],['✕','엑스'],
    ['✖','굵은 엑스'],['※','참고표'],['‥','두점 줄임'],['…','줄임표'],['·','가운뎃점'],
    ['~','물결'],['`','억음부호'],['¨','분음부호'],['§','절 표시'],['¶','문단 표시'],
    ['†','단검표'],['‡','이중단검표'],['‖','이중수직선'],['¦','끊긴 수직선'],['№','넘버 표시'],
  ];
  const 화살표 = [
    ['→','오른쪽'],['←','왼쪽'],['↑','위쪽'],['↓','아래쪽'],['↔','좌우'],
    ['↕','상하'],['⇒','이중 오른쪽'],['⇐','이중 왼쪽'],['⇑','이중 위쪽'],['⇓','이중 아래쪽'],
    ['⇔','이중 좌우'],['⇕','이중 상하'],['➔','화살표'],['➜','화살표(굵게)'],['➝','화살표(가늘게)'],
    ['➞','화살표'],['➟','화살표'],['➠','화살표 머리'],['➡','채움 오른쪽'],['⬅','채움 왼쪽'],
    ['⬆','채움 위쪽'],['⬇','채움 아래쪽'],['↗','오른위 대각선'],['↘','오른아래 대각선'],['↙','왼아래 대각선'],
    ['↖','왼위 대각선'],['⤴','우상 회전'],['⤵','우하 회전'],['↩','되돌리기'],['↪','다시하기'],
  ];
  const 단위 = [
    ['℃','섭씨'],['℉','화씨'],['%','퍼센트'],['‰','퍼밀'],['₩','원'],
    ['$','달러'],['€','유로'],['¥','엔/위안'],['£','파운드'],['¢','센트'],
    ['㎡','제곱미터'],['㎥','세제곱미터'],['㎢','제곱킬로미터'],['㎝','센티미터'],['㎜','밀리미터'],
    ['㎞','킬로미터'],['㎏','킬로그램'],['㎎','밀리그램'],['㎍','마이크로그램'],['㎖','밀리리터'],
    ['㎗','데시리터'],['㎘','킬로리터'],['㏊','헥타르'],['㎚','나노미터'],['°','도(각도)'],
    ['′','분(각도)'],['″','초(각도)'],['Ω','옴'],['Å','옹스트롬'],['㎾','킬로와트'],
  ];
  const SEED = [];
  [[자주쓰는,'자주쓰는'],[화살표,'화살표'],[단위,'단위']].forEach(([list, cat])=> list.forEach(([char, label], i)=>
    SEED.push({ id:'seed|' + cat + '|' + char, char, label, category:cat, order:i, seed:true })));
  const PREFERRED_ORDER = ['자주쓰는','화살표','단위'];

  // 팩트파인더 lib/frenchBrackets.ts — CJK 겹낫표 《 》를 « » 로 바꿔 넣는다
  const toFrench = (v)=> String(v).replace(/《/g, '«').replace(/》/g, '»');

  /* ===== 저장소(RTDB /special_chars) ===== */
  const host = (()=>{ try{ return (window.parent && window.parent !== window && window.parent.dbFetch) ? window.parent : window; }catch(e){ return window; } })();
  const rtdb = ()=> (typeof FIREBASE_URL !== 'undefined' ? FIREBASE_URL : host.JUNGLE_RTDB_URL);
  const dbf = (url, opt)=> (typeof dbFetch === 'function' ? dbFetch : host.dbFetch)(url, opt);
  const isMaster = ()=>{ try{ return !!(host.__jungleIsMaster && host.__jungleIsMaster()); }catch(e){ return false; } };
  let custom = {}, hidden = {};
  async function loadStore(){
    try{
      const d = await dbf(rtdb() + '/special_chars.json').then(r=> r.json());
      custom = (d && d.items) || {}; hidden = (d && d.hidden) || {};
    }catch(e){ custom = {}; hidden = {}; }
  }
  const allChars = ()=> SEED.filter(c=> !hidden[encodeKey(c.id)]).concat(Object.entries(custom).map(([id, c])=> Object.assign({ id }, c)));
  const encodeKey = (id)=> id.replace(/[.#$\[\]\/]/g, '_') ;   // RTDB 키 금지 문자 치환

  /* ===== 스타일 ===== */
  const css = document.createElement('style');
  css.textContent = `
  .jsc-back{position:fixed;inset:0;z-index:9500;background:rgba(0,0,0,.45);display:flex;align-items:center;justify-content:center;padding:16px;}
  .jsc-box{background:#fff;border-radius:16px;width:100%;max-width:512px;max-height:80vh;display:flex;flex-direction:column;overflow:hidden;box-shadow:0 20px 25px -5px rgba(0,0,0,.1),0 8px 10px -6px rgba(0,0,0,.08);font-family:inherit;}
  .jsc-head{padding:14px 16px;border-bottom:1px solid #f1f1f1;display:flex;align-items:center;justify-content:space-between;}
  .jsc-head h3{margin:0;font-size:16px;font-weight:700;color:#18181b;}
  .jsc-x{all:unset;cursor:pointer;color:#9ca3af;font-size:18px;line-height:1;padding:4px;}
  .jsc-x:hover{color:#52525b;}
  .jsc-cats{padding:12px 16px;display:flex;flex-wrap:wrap;gap:6px;border-bottom:1px solid #f1f1f1;}
  .jsc-cat{all:unset;cursor:pointer;font-size:12px;font-weight:700;border-radius:8px;padding:5px 12px;border:1px solid #e5e7eb;background:#fff;color:#6b7280;}
  .jsc-cat.on{background:#18181b;border-color:#18181b;color:#fff;}
  .jsc-grid-wrap{padding:16px;overflow-y:auto;flex:1;}
  .jsc-grid{display:grid;grid-template-columns:repeat(10,1fr);gap:6px;}
  @media (max-width:520px){.jsc-grid{grid-template-columns:repeat(8,1fr);}}
  .jsc-ch{all:unset;box-sizing:border-box;position:relative;aspect-ratio:1;border-radius:8px;border:1px solid #e5e7eb;font-size:18px;display:flex;align-items:center;justify-content:center;cursor:pointer;color:#18181b;}
  .jsc-ch:hover{border-color:#18181b;background:rgba(0,0,0,.04);}
  .jsc-del{position:absolute;top:-6px;right:-6px;width:16px;height:16px;border-radius:8px;background:#9ca3af;color:#fff;font-size:11px;line-height:16px;text-align:center;}
  .jsc-del:hover{background:#dc2626;}
  .jsc-empty{font-size:13px;color:#9ca3af;margin:0 0 8px;}
  .jsc-add{padding:12px;border-top:1px solid #f1f1f1;}
  .jsc-add-row{display:flex;align-items:center;gap:6px;}
  .jsc-add input{font:inherit;font-size:13px;border:1px solid #e5e7eb;border-radius:8px;padding:6px 8px;outline:none;min-width:0;}
  .jsc-add input:focus{border-color:#18181b;}
  .jsc-add .c{width:56px;text-align:center;} .jsc-add .l{flex:1;} .jsc-add .k{width:112px;flex:none;}
  .jsc-addbtn{all:unset;cursor:pointer;flex:none;font-size:12px;font-weight:700;color:#fff;background:#18181b;border-radius:8px;padding:8px 12px;}
  .jsc-addbtn[disabled]{opacity:.5;}
  .jsc-hint{font-size:12px;color:#9ca3af;margin:6px 0 0;} .jsc-err{font-size:12px;color:#dc2626;margin:6px 0 0;}
  `;
  document.head.appendChild(css);

  /* ===== 모달 ===== */
  let backEl = null, active = '자주쓰는', saved = null, targetEditor = null, busy = false, err = '';

  function capture(){
    const s = window.getSelection();
    if(s && s.rangeCount){ const r = s.getRangeAt(0).cloneRange(); saved = r; }
  }
  function insertChar(ch){
    if(!targetEditor) return;
    targetEditor.focus();
    const s = window.getSelection();
    if(saved){ s.removeAllRanges(); s.addRange(saved); }
    document.execCommand('insertText', false, toFrench(ch));
    capture();                                           // 곧바로 이어 넣을 수 있게 새 커서 위치 보관
    targetEditor.dispatchEvent(new Event('input', { bubbles:true }));
  }

  function categories(list){
    const present = new Set(list.map(c=> c.category));
    const pref = PREFERRED_ORDER.filter(c=> present.has(c));
    const rest = [...present].filter(c=> !PREFERRED_ORDER.includes(c)).sort((a, b)=> a.localeCompare(b, 'ko'));
    return pref.concat(rest);
  }
  const esc = (s)=> String(s).replace(/[&<>"]/g, m=> ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;'}[m]));

  function render(){
    if(!backEl) return;
    const list = allChars();
    const cats = categories(list);
    if(cats.length && !cats.includes(active)) active = cats[0];
    const manage = isMaster();
    const visible = list.filter(c=> c.category === active).sort((a, b)=> (a.order||0) - (b.order||0));
    backEl.querySelector('.jsc-box').innerHTML = `
      <div class="jsc-head"><h3>특수문자</h3><button class="jsc-x" data-x title="닫기">✕</button></div>
      ${cats.length ? `<div class="jsc-cats">${cats.map(c=> `<button class="jsc-cat${c === active ? ' on' : ''}" data-cat="${esc(c)}">${esc(c)}</button>`).join('')}</div>` : ''}
      <div class="jsc-grid-wrap">
        ${visible.length ? '' : '<p class="jsc-empty">이 카테고리에 등록된 문자가 없습니다.</p>'}
        <div class="jsc-grid">${visible.map(c=> `<button class="jsc-ch" data-ch="${esc(c.char)}" data-id="${esc(c.id)}" title="${esc(c.label || '')}">${esc(c.char)}${manage ? '<span class="jsc-del" data-del title="삭제">✕</span>' : ''}</button>`).join('')}</div>
      </div>
      ${manage ? `<div class="jsc-add"><div class="jsc-add-row">
          <input class="c" placeholder="문자" maxlength="8"><input class="l" placeholder="설명 (선택)">
          <input class="k" placeholder="카테고리 (기본 ${esc(active)})" list="jsc-cats-dl"><datalist id="jsc-cats-dl">${cats.map(c=> `<option value="${esc(c)}">`).join('')}</datalist>
          <button class="jsc-addbtn" data-add ${busy ? 'disabled' : ''}>+ 추가</button></div>
          ${err ? `<p class="jsc-err">${esc(err)}</p>` : ''}
          <p class="jsc-hint">새 카테고리 이름을 입력하면 위에 새 탭이 생깁니다.</p></div>` : ''}`;
  }

  async function addChar(){
    const root = backEl.querySelector('.jsc-add');
    const char = root.querySelector('.c').value.trim();
    const label = root.querySelector('.l').value.trim();
    const category = root.querySelector('.k').value.trim() || active || '자주쓰는';
    if(!char) return;
    busy = true; err = ''; render();
    try{
      const id = 'c_' + Date.now().toString(36);
      const item = { char, label, category, order: Object.keys(custom).length + 100 };
      const res = await dbf(rtdb() + '/special_chars/items/' + id + '.json', { method:'PUT', headers:{'Content-Type':'application/json'}, body: JSON.stringify(item) });
      if(!res.ok) throw new Error('HTTP ' + res.status);
      custom[id] = item; active = category;
    }catch(e){ err = '특수문자 추가에 실패했습니다.'; }
    busy = false; render();
  }
  async function delChar(id){
    try{
      if(id.startsWith('seed|')){
        const k = encodeKey(id);
        await dbf(rtdb() + '/special_chars/hidden/' + encodeURIComponent(k) + '.json', { method:'PUT', headers:{'Content-Type':'application/json'}, body:'true' });
        hidden[k] = true;
      }else{
        await dbf(rtdb() + '/special_chars/items/' + id + '.json', { method:'DELETE' });
        delete custom[id];
      }
    }catch(e){ err = '삭제에 실패했습니다.'; }
    render();
  }

  function close(){ if(backEl){ backEl.remove(); backEl = null; } }
  async function open(editor){
    targetEditor = editor || targetEditor;
    capture();
    close();
    backEl = document.createElement('div');
    backEl.className = 'jsc-back';
    backEl.innerHTML = '<div class="jsc-box"></div>';
    document.body.appendChild(backEl);
    backEl.addEventListener('mousedown', (e)=>{ if(!e.target.closest('input')) e.preventDefault(); });   // 입력칸이 아니면 에디터 선택이 풀리지 않게
    backEl.addEventListener('click', (e)=>{
      if(e.target === backEl || e.target.closest('[data-x]')){ close(); return; }
      const cat = e.target.closest('[data-cat]'); if(cat){ active = cat.dataset.cat; render(); return; }
      const del = e.target.closest('[data-del]'); if(del){ e.stopPropagation(); delChar(del.closest('.jsc-ch').dataset.id); return; }
      const ch = e.target.closest('[data-ch]'); if(ch){ insertChar(ch.dataset.ch); return; }
      if(e.target.closest('[data-add]')) addChar();
    });
    backEl.addEventListener('keydown', (e)=>{ if(e.key === 'Enter' && e.target.closest('.jsc-add')) addChar(); if(e.key === 'Escape') close(); });
    render();
    await loadStore();
    render();
  }

  window.JungleSpecialChars = { open, close };
  // 플로팅 툴바(app-float.js)에 "특수문자" 버튼 등록 — 선택 영역 끝에 삽입(선택한 글이 지워지지 않게)
  window.JungleFloatExtras = window.JungleFloatExtras || [];
  window.JungleFloatExtras.push({ label:'특수문자', title:'특수문자 삽입', onClick(editor){
    const s = window.getSelection();
    if(s && s.rangeCount){ const r = s.getRangeAt(0).cloneRange(); r.collapse(false); s.removeAllRanges(); s.addRange(r); }
    open(editor);
  }});
})();
