/* 글쓰기 영역 플로팅 툴바 — 텍스트를 드래그하면 선택 영역 위에 B·I·U·색·링크 툴바가 뜬다 (2026-10-06, 팩트파인더 에디터와 같은 모양).
   대상: 스크랩·존안·메모 노트(.sc-note-rich), 뉴스 리포트(.rp-body), 떠든 히스토리(.dh-body).
   - 독립 파일: index.html과 people.html(iframe)이 같은 파일을 쓰므로 스타일도 이 안에서 주입한다. 전역을 만들지 않는다(IIFE).
   - 명령 실행 뒤 'input' 이벤트를 쏴서 각 에디터의 자동 저장이 그대로 돌게 한다.
   - 사진·갤러리·특수문자 버튼은 window.JungleFloatExtras(배열)에 {label,title,onClick(editor)}를 넣으면 같은 줄에 붙는다(팩트파인더 모듈 연결용 자리). */
(function(){
  if(window.__jungleFloat) return;
  window.__jungleFloat = true;

  const EDITOR_SEL = '.sc-note-rich, .rp-body, .dh-body';
  const HL_COLORS = [['#fff59d','노랑'], ['#b9f6ca','초록'], ['#ffcdd2','분홍']];

  const css = document.createElement('style');
  css.textContent = `
  .jf-bar{position:fixed;z-index:9000;display:none;align-items:center;gap:2px;padding:6px 8px;background:#fff;border:1px solid rgba(0,0,0,.08);
    border-radius:14px;box-shadow:0 8px 24px rgba(0,0,0,.14),0 2px 6px rgba(0,0,0,.08);font-family:inherit;user-select:none;-webkit-user-select:none;}
  .jf-bar.on{display:flex;}
  .jf-btn{all:unset;box-sizing:border-box;min-width:34px;height:34px;padding:0 9px;display:inline-flex;align-items:center;justify-content:center;
    font-size:15px;font-weight:600;color:#27272a;border-radius:9px;cursor:pointer;}
  .jf-btn:hover{background:rgba(0,0,0,.06);}
  .jf-sep{width:1px;height:20px;background:rgba(0,0,0,.12);margin:0 6px;}
  .jf-color{position:relative;}
  .jf-dot{width:26px;height:26px;border-radius:50%;background:#7dd3fc;box-shadow:0 0 0 3px rgba(125,211,252,.35);}
  .jf-pop{position:absolute;left:50%;top:calc(100% + 8px);transform:translateX(-50%);display:none;gap:6px;align-items:center;padding:8px 10px;background:#fff;
    border:1px solid rgba(0,0,0,.08);border-radius:12px;box-shadow:0 8px 24px rgba(0,0,0,.14);white-space:nowrap;}
  .jf-pop.on{display:flex;}
  .jf-sw{all:unset;width:24px;height:24px;border-radius:50%;cursor:pointer;box-shadow:inset 0 0 0 1px rgba(0,0,0,.15);}
  .jf-clear{all:unset;font-size:12px;font-weight:600;color:#52525b;padding:4px 6px;border-radius:6px;cursor:pointer;}
  .jf-clear:hover{background:rgba(0,0,0,.06);}
  @media (max-width:600px){.jf-btn{min-width:30px;height:32px;padding:0 6px;font-size:14px;}.jf-sep{margin:0 3px;}}
  `;
  document.head.appendChild(css);

  const bar = document.createElement('div');
  bar.className = 'jf-bar';
  bar.setAttribute('role', 'toolbar');
  bar.innerHTML = `
    <button class="jf-btn" data-c="bold" title="굵게"><b>B</b></button>
    <button class="jf-btn" data-c="italic" title="기울임"><i>I</i></button>
    <button class="jf-btn" data-c="underline" title="밑줄"><u>U</u></button>
    <span class="jf-btn jf-color" data-c="color" title="형광펜"><span class="jf-dot"></span>
      <span class="jf-pop">${HL_COLORS.map(([c, n])=> `<button class="jf-sw" data-hl="${c}" title="${n} 형광펜" style="background:${c}"></button>`).join('')}<button class="jf-clear" data-hl="">지우기</button></span>
    </span>
    <button class="jf-btn" data-c="link" title="링크">링크</button>
    <span class="jf-extras"></span>`;
  document.body.appendChild(bar);

  let editor = null;      // 지금 선택이 걸린 에디터
  let savedRange = null;  // 링크 입력창 등으로 포커스를 잃어도 되돌릴 수 있게 보관

  const editorOf = (node)=>{
    const el = node && (node.nodeType === 1 ? node : node.parentElement);
    return el && el.closest ? el.closest(EDITOR_SEL) : null;
  };
  const emitInput = ()=>{ if(editor) editor.dispatchEvent(new Event('input', { bubbles:true })); };
  const restore = ()=>{
    if(!savedRange) return;
    if(editor) editor.focus();
    const s = window.getSelection(); s.removeAllRanges(); s.addRange(savedRange);
  };

  function renderExtras(){
    const box = bar.querySelector('.jf-extras');
    const list = Array.isArray(window.JungleFloatExtras) ? window.JungleFloatExtras : [];
    const sig = list.map(x=> x.label).join('|');
    if(box.dataset.sig === sig) return;
    box.dataset.sig = sig;
    box.innerHTML = list.length ? '<span class="jf-sep"></span>' : '';
    list.forEach(x=>{
      const b = document.createElement('button');
      b.className = 'jf-btn'; b.textContent = x.label; b.title = x.title || x.label;
      b.addEventListener('mousedown', e=> e.preventDefault());
      b.addEventListener('click', ()=>{ restore(); try{ x.onClick(editor, savedRange); }catch(err){ console.warn('[플로팅 툴바]', err); } });
      box.appendChild(b);
    });
  }

  function place(){
    const sel = window.getSelection();
    if(!editor || !sel.rangeCount || sel.isCollapsed){ hide(); return; }
    const r = sel.getRangeAt(0).getBoundingClientRect();
    if(!r.width && !r.height){ hide(); return; }
    bar.classList.add('on');
    const bw = bar.offsetWidth, bh = bar.offsetHeight, vw = window.innerWidth, vh = window.innerHeight;
    let left = r.left + r.width / 2 - bw / 2;
    left = Math.max(8, Math.min(left, vw - bw - 8));
    let top = r.top - bh - 10;
    if(top < 8) top = Math.min(r.bottom + 10, vh - bh - 8);   // 위에 자리가 없으면 선택 영역 아래
    bar.style.left = left + 'px';
    bar.style.top = top + 'px';
  }
  function hide(){
    bar.classList.remove('on');
    bar.querySelector('.jf-pop').classList.remove('on');
  }

  let timer = 0;
  const schedule = ()=>{ clearTimeout(timer); timer = setTimeout(update, 16); };   // rAF는 백그라운드·숨은 iframe에서 멈추므로 타이머 사용
  function update(){
    const sel = window.getSelection();
    if(!sel.rangeCount || sel.isCollapsed){ if(!bar.matches(':hover')) hide(); return; }
    const ed = editorOf(sel.anchorNode);
    if(!ed || editorOf(sel.focusNode) !== ed){ hide(); return; }
    editor = ed;
    savedRange = sel.getRangeAt(0).cloneRange();
    renderExtras();
    place();
  }
  document.addEventListener('selectionchange', schedule);
  document.addEventListener('mouseup', schedule);
  document.addEventListener('keyup', schedule);
  window.addEventListener('scroll', ()=>{ if(bar.classList.contains('on')) place(); }, true);
  window.addEventListener('resize', schedule);
  document.addEventListener('mousedown', (e)=>{ if(!bar.contains(e.target) && !editorOf(e.target)) hide(); });

  bar.addEventListener('mousedown', (e)=>{ e.preventDefault(); });   // 클릭해도 선택이 풀리지 않게

  bar.addEventListener('click', (e)=>{
    const sw = e.target.closest('[data-hl]');
    if(sw){
      restore();
      const val = sw.dataset.hl;
      document.execCommand('styleWithCSS', false, true);
      if(!val){ document.execCommand('hiliteColor', false, 'transparent'); }
      else if(!document.execCommand('hiliteColor', false, val)) document.execCommand('backColor', false, val);
      document.execCommand('styleWithCSS', false, false);
      bar.querySelector('.jf-pop').classList.remove('on');
      emitInput(); schedule();
      return;
    }
    const b = e.target.closest('[data-c]');
    if(!b || !editor) return;
    const c = b.dataset.c;
    if(c === 'color'){ bar.querySelector('.jf-pop').classList.toggle('on'); return; }
    restore();
    if(c === 'bold' || c === 'italic' || c === 'underline') document.execCommand(c);
    else if(c === 'link'){
      const inLink = (()=>{ const n = window.getSelection().anchorNode; const el = n && (n.nodeType === 1 ? n : n.parentElement); return el && el.closest('a'); })();
      if(inLink){ document.execCommand('unlink'); }
      else{
        const range = savedRange;
        const url = window.prompt('링크 주소를 입력하세요 (https://…)', 'https://');
        if(!url || !/^https?:\/\//i.test(url.trim())) return;
        savedRange = range; restore();
        document.execCommand('createLink', false, url.trim());
        editor.querySelectorAll('a[href]').forEach(a=>{ a.target = '_blank'; a.rel = 'noopener noreferrer'; });
      }
    }
    emitInput(); schedule();
  });
})();
