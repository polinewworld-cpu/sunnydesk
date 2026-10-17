/* 알약형 내비(.pill-nav) 슬라이딩 인디케이터 — 2026-09-24 사장님 시안(Magnetic Pill Navbar).
   각 .pill-nav 안에 검은 알약(.pill-ind) 하나를 넣고, 활성 탭(.active 또는 .on)으로 스프링처럼 미끄러지게 옮긴다.
   탭 전환 로직은 건드리지 않음 — class 변화·탭 재렌더링·리사이즈를 감시해서 위치만 따라감. */
(function(){
  function activeTab(nav){
    return nav.querySelector('.subtab-btn.active:not([hidden]), .snstab.on, .groupTab.on');
  }
  function place(nav, animate){
    const ind = nav._pillInd;
    const btn = activeTab(nav);
    if(!btn || !btn.offsetWidth){ ind.style.opacity = '0'; return; }
    if(!animate) ind.classList.add('no-anim');
    ind.style.opacity = '1';
    ind.style.width = btn.offsetWidth + 'px';
    ind.style.height = btn.offsetHeight + 'px';
    ind.style.top = btn.offsetTop + 'px';
    ind.style.transform = 'translateX(' + btn.offsetLeft + 'px)';
    if(!animate){ void ind.offsetWidth; ind.classList.remove('no-anim'); }
  }
  function setup(nav){
    if(nav._pillInd) return;
    const ind = document.createElement('span');
    ind.className = 'pill-ind';
    ind.setAttribute('aria-hidden', 'true');
    nav.insertBefore(ind, nav.firstChild);
    nav._pillInd = ind;
    nav.classList.add('has-ind');
    const update = () => {
      // 탭 줄을 innerHTML로 통째로 다시 그리는 곳(유튜브 #tabsRow 등)은 인디케이터까지 지워버림 → 다시 끼워 넣음
      if(ind.parentNode !== nav) nav.insertBefore(ind, nav.firstChild);
      // 이미 보이던 알약이면 새 위치로 미끄러지고(버튼이 재생성돼도 알약 요소는 같으니 이전 위치에서 출발),
      // 처음 나타날 때는 제자리에 바로 놓음
      place(nav, ind.style.opacity === '1');
    };
    // 인디케이터 자체의 style 변경은 무시(무한 루프 방지)
    new MutationObserver(muts => {
      if(muts.some(m => m.target !== ind)) update();
    }).observe(nav, {subtree:true, childList:true, attributes:true, attributeFilter:['class','hidden']});
    if(window.ResizeObserver) new ResizeObserver(() => place(nav, false)).observe(nav);
    update();
  }
  function init(){ document.querySelectorAll('.pill-nav').forEach(setup); }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
  // 폰트 로딩 후 글자 폭이 바뀌면 다시 맞춤
  if(document.fonts && document.fonts.ready) document.fonts.ready.then(() => {
    document.querySelectorAll('.pill-nav').forEach(n => n._pillInd && place(n, false));
  });
})();
