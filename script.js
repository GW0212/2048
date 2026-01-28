(() => {
  const SIZE = 4;
  const WIN_TILE = 2048;
  const STORAGE_KEY = "web2048_state_v5";

  const elBoard = document.getElementById("board");
  const elBg = document.getElementById("bg");
  const elTiles = document.getElementById("tiles");
  const elScore = document.getElementById("score");
  const elBest = document.getElementById("best");
  const elBestName = document.getElementById("bestNameInline");
  const elReset = document.getElementById("resetBtn");
  const elSoundToggle = document.getElementById("soundToggle");

  const elModal = document.getElementById("modal");
  const elModalTitle = document.getElementById("modalTitle");
  const elModalMsg = document.getElementById("modalMsg");
  const elModalPrimary = document.getElementById("modalPrimary");
  const elModalGameOverWrap = document.getElementById("modalGameOverWrap");
  const elModalBest = document.getElementById("modalBest");
  const elModalBestName = document.getElementById("modalBestName");
  const elModalFinal = document.getElementById("modalFinal");
  const elModalNameWrap = document.getElementById("modalNameWrap");
  const elNameInput = document.getElementById("nameInput");

  let layout = { cell: 0, gap: 0 };
  let state = null;

  let modalMode = null; // highscore | gameover | gameclear
  let locked = false;
  let pendingGameOverAfterName = false;

  function emptyState() {
    return {
      grid: Array(SIZE * SIZE).fill(null),
      tiles: {},
      score: 0,
      best: 0,
      bestName: "",
      status: "playing",
      bestNamedAt: 0,
      soundEnabled: true,
    };
  }

  function saveState() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch (e) { console.warn(e); }
  }
  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return null;
      const s = JSON.parse(raw);
      if (!s || !Array.isArray(s.grid) || s.grid.length !== SIZE*SIZE || typeof s.tiles !== "object") return null;
      if (!["playing","won","over"].includes(s.status)) s.status = "playing";
      s.score = Number(s.score || 0);
      s.best = Number(s.best || 0);
      s.bestNamedAt = Number(s.bestNamedAt || 0);
      s.bestName = (typeof s.bestName === "string") ? s.bestName : "";
      s.soundEnabled = (typeof s.soundEnabled === "boolean") ? s.soundEnabled : true;
      return s;
    } catch { return null; }
  }

  function uid(){ return "t" + Math.random().toString(16).slice(2) + Date.now().toString(16); }
  function idx(r,c){ return r*SIZE + c; }

  function calcLayout() {
    const styles = getComputedStyle(elBoard);
    const pad = parseFloat(styles.getPropertyValue("--pad")) || 12;
    const gap = parseFloat(styles.getPropertyValue("--gap")) || 12;
    const w = elBoard.clientWidth - pad*2;
    const cell = (w - gap*(SIZE-1)) / SIZE;
    layout = { cell, gap };
    for (const id in state.tiles) positionTileEl(state.tiles[id], false);
  }
  function posOf(r,c){
    const { cell, gap } = layout;
    return { x: c*(cell+gap), y: r*(cell+gap) };
  }
  function positionTileEl(tile, animate=true){
    const el = document.querySelector(`[data-id="${tile.id}"]`);
    if (!el) return;
    const { cell } = layout;
    const { x,y } = posOf(tile.r, tile.c);

    el.style.width = cell + "px";
    el.style.height = cell + "px";
    el.style.setProperty("--x", x + "px");
    el.style.setProperty("--y", y + "px");

    const v = tile.value;
    el.style.fontSize = (v >= 1024 ? Math.max(18, cell*0.25) : Math.max(22, cell*0.32)) + "px";

    if (!animate) {
      el.style.transition = "none";
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
      void el.offsetHeight;
      el.style.transition = "";
    } else {
      el.style.transform = `translate3d(${x}px, ${y}px, 0)`;
    }
  }

  function buildBackground(){
    if (elBg.childElementCount) return;
    for (let i=0;i<SIZE*SIZE;i++){
      const d = document.createElement("div");
      d.className = "cell";
      elBg.appendChild(d);
    }
  }

  function createTile(value, r, c){
    const id = uid();
    const t = { id, value, r, c };
    state.tiles[id] = t;
    state.grid[idx(r,c)] = id;

    const el = document.createElement("div");
    el.className = `tile t-${value}`;
    el.dataset.id = id;
    el.textContent = String(value);
    elTiles.appendChild(el);

    positionTileEl(t, false);
    el.classList.add("bump");
    el.addEventListener("animationend", ()=> el.classList.remove("bump"), { once:true });
    return t;
  }

  function removeTile(id){
    const el = document.querySelector(`[data-id="${id}"]`);
    if (el) el.remove();
    delete state.tiles[id];
  }

  function emptyCells(){
    const res=[];
    for (let r=0;r<SIZE;r++) for (let c=0;c<SIZE;c++) if (!state.grid[idx(r,c)]) res.push({r,c});
    return res;
  }

  function addRandomTile(){
    const empties = emptyCells();
    if (!empties.length) return false;
    const spot = empties[Math.floor(Math.random()*empties.length)];
    const value = Math.random() < 0.9 ? 2 : 4;
    createTile(value, spot.r, spot.c);
    sSpawn();
    return true;
  }

  function tilt(dir){
    const map = { left:"rotateY(6deg)", right:"rotateY(-6deg)", up:"rotateX(-6deg)", down:"rotateX(6deg)" };
    elBoard.style.transform = map[dir] || "none";
    clearTimeout(tilt._t);
    tilt._t = setTimeout(()=>{ elBoard.style.transform = "none"; }, 120);
  }

  // Sound (WebAudio) - no external files
  let audioCtx = null;
  function getAudioCtx(){
    if (!audioCtx) audioCtx = new (window.AudioContext || window.webkitAudioContext)();
    return audioCtx;
  }
  function beep(freq, durMs, type="sine", gain=0.04){
    if (!state.soundEnabled) return;
    try{
      const ctx = getAudioCtx();
      if (ctx.state === "suspended") ctx.resume();
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = type;
      o.frequency.value = freq;
      g.gain.value = gain;
      o.connect(g);
      g.connect(ctx.destination);
      const t0 = ctx.currentTime;
      o.start(t0);
      o.stop(t0 + durMs/1000);
    } catch(e){}
  }
  function sMove(){ beep(260, 40, "square", 0.03); }
  function sMerge(){ beep(520, 70, "triangle", 0.05); }
  function sSpawn(){ beep(180, 35, "sine", 0.02); }
  function sOver(){ beep(120, 160, "sawtooth", 0.05); }
  function sClear(){ beep(740, 140, "triangle", 0.05); }


  function showModal(mode, opts = {}) {
    modalMode = mode;
    locked = true;

    elModalTitle.textContent = opts.title || "알림";
    elModalMsg.textContent = opts.message || "";
    elModalPrimary.textContent = opts.primaryText || "확인";

    elModalGameOverWrap.classList.add("hidden");
    elModalNameWrap.classList.add("hidden");

    if (mode === "highscore") {
      elModalNameWrap.classList.remove("hidden");
      elNameInput.value = opts.defaultName || "";
      setTimeout(() => elNameInput.focus(), 0);
    }

    if (mode === "gameover") {
      elModalGameOverWrap.classList.remove("hidden");
      elModalBest.textContent = String(state.best);
      elModalBestName.textContent = state.bestName ? state.bestName : "-";
      elModalFinal.textContent = String(state.score);
    }

    elModal.classList.remove("hidden");
  }

  function hideModal() {
    elModal.classList.add("hidden");
    modalMode = null;
    locked = false;
  }

  function hasMoves(){
    if (emptyCells().length) return true;
    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const id = state.grid[idx(r,c)];
        const v = state.tiles[id].value;
        if (c < SIZE-1) {
          const idR = state.grid[idx(r,c+1)];
          if (v === state.tiles[idR].value) return true;
        }
        if (r < SIZE-1) {
          const idD = state.grid[idx(r+1,c)];
          if (v === state.tiles[idD].value) return true;
        }
      }
    }
    return false;
  }

  function newGame(keepBest=true){
    const best = keepBest ? (state?.best || 0) : 0;
    const bestName = keepBest ? (state?.bestName || "") : "";
    const bestNamedAt = keepBest ? (state?.bestNamedAt || 0) : 0;
    const soundEnabled = (state?.soundEnabled !== undefined) ? state.soundEnabled : true;

    elTiles.innerHTML = "";
    state = emptyState();
    state.best = best;
    state.bestName = bestName;
    state.bestNamedAt = bestNamedAt;
    state.soundEnabled = soundEnabled;

    buildBackground();
    calcLayout();
    addRandomTile();
    addRandomTile();

    state.status = "playing";
    pendingGameOverAfterName = false;
    hideModal();
    renderTop();
    saveState();
  }

  function renderSoundUI(){
    if (!elSoundToggle) return;
    elSoundToggle.textContent = state.soundEnabled ? "🔊 Sound: ON" : "🔇 Sound: OFF";
  }

  function renderTop(){
    elScore.textContent = String(state.score);
    elBest.textContent = String(state.best);
    elBestName.textContent = state.bestName ? state.bestName : "";
    renderSoundUI();
  }

  // 규칙: 최고기록 팝업은 "게임 오버 시 최고기록일 때만" 뜬다.
  function shouldAskNameOnGameOver(prevBest){
    const isNewBest = state.score > prevBest;
    const notNamedYet = state.bestNamedAt < state.best;
    return isNewBest && notNamedYet;
  }

  function showHighScoreNamePopup() {
    showModal("highscore", {
      title: "최고 기록!",
      message: "축하드립니다! 최고기록입니다! 이름을 남겨주세요",
      primaryText: "저장",
      defaultName: state.bestName || "",
    });
  }

  function showGameOverPopup(){
    showModal("gameover", {
      title: "게임 오버",
      message: "",
      primaryText: "다시 하기",
    });
  }

  function showGameClearPopup(){
    showModal("gameclear", {
      title: "게임 클리어",
      message: "게임 클리어 됐다",
      primaryText: "확인",
    });
  }

  function afterMoveFinalize(prevBest){
    // best update
    if (state.score > state.best) state.best = state.score;

    // status
    const maxVal = Math.max(...Object.values(state.tiles).map(t=>t.value), 0);
    if (maxVal >= WIN_TILE) state.status = "won";
    else if (!hasMoves()) state.status = "over";
    else state.status = "playing";

    renderTop();
    saveState();

    if (state.status === "over") {
      sOver();
      if (shouldAskNameOnGameOver(prevBest)) {
        pendingGameOverAfterName = true;
        showHighScoreNamePopup();
      } else {
        pendingGameOverAfterName = false;
        showGameOverPopup();
      }
      return;
    }

    if (state.status === "won") {
      sClear();
      showGameClearPopup();
      return;
    }

    // playing 상태에서는 어떤 경우에도 최고기록 팝업을 띄우지 않음
    hideModal();
  }

  function move(dir){
    if (state.status !== "playing") return;
    if (locked) return;

    tilt(dir);

    const prevBest = state.best;

    const lines=[];
    for (let k=0;k<SIZE;k++){
      const line=[];
      for (let i=0;i<SIZE;i++){
        let r,c;
        if (dir==="left"){ r=k; c=i; }
        if (dir==="right"){ r=k; c=SIZE-1-i; }
        if (dir==="up"){ r=i; c=k; }
        if (dir==="down"){ r=SIZE-1-i; c=k; }
        const id = state.grid[idx(r,c)];
        if (id) line.push(id);
      }
      lines.push(line);
    }

    const nextGrid = Array(SIZE*SIZE).fill(null);
    const merged = [];
    let gained = 0;
    let changed = false;

    for (let k=0;k<SIZE;k++){
      const ids = lines[k];
      const out=[];
      for (let i=0;i<ids.length;i++){
        const curId = ids[i];
        const curV = state.tiles[curId].value;
        const nextId = ids[i+1];
        if (nextId && state.tiles[nextId].value === curV){
          const toId = curId;
          const fromId = nextId;
          const newVal = curV*2;
          out.push(toId);
          merged.push({toId, fromId, newVal});
          gained += newVal;
          i++;
        } else out.push(curId);
      }
      for (let i=0;i<SIZE;i++){
        let r,c;
        if (dir==="left"){ r=k; c=i; }
        if (dir==="right"){ r=k; c=SIZE-1-i; }
        if (dir==="up"){ r=i; c=k; }
        if (dir==="down"){ r=SIZE-1-i; c=k; }
        const id = out[i] || null;
        if (id) {
          const t = state.tiles[id];
          if (t.r !== r || t.c !== c) changed = true;
          nextGrid[idx(r,c)] = id;
        }
      }
    }
    if (!changed && merged.length===0) return;

    sMove();

    if (merged.length) sMerge();
    for (const m of merged){
      state.tiles[m.toId].value = m.newVal;
      removeTile(m.fromId);
      for (let i=0;i<nextGrid.length;i++) if (nextGrid[i]===m.fromId) nextGrid[i]=null;
    }

    state.grid = nextGrid;

    for (let r=0;r<SIZE;r++){
      for (let c=0;c<SIZE;c++){
        const id = state.grid[idx(r,c)];
        if (!id) continue;
        state.tiles[id].r = r;
        state.tiles[id].c = c;
      }
    }

    for (const m of merged){
      const el = document.querySelector(`[data-id="${m.toId}"]`);
      if (!el) continue;
      el.className = `tile t-${m.newVal}`;
      el.textContent = String(m.newVal);
      el.classList.add("bump");
      el.addEventListener("animationend", ()=> el.classList.remove("bump"), { once:true });
    }

    for (const id in state.tiles) positionTileEl(state.tiles[id], true);

    state.score += gained;
    if (state.score > state.best) state.best = state.score;

    setTimeout(()=>{
      addRandomTile();
      afterMoveFinalize(prevBest);
    }, 150);
  }

  function onKeyDown(e){
    const map = {
      ArrowLeft:"left", ArrowRight:"right", ArrowUp:"up", ArrowDown:"down",
      a:"left", A:"left", d:"right", D:"right", w:"up", W:"up", s:"down", S:"down"
    };
    const dir = map[e.key];
    if (!dir) return;
    e.preventDefault();
    move(dir);
  }

  // 마우스 드래그 + 모바일 스와이프: Pointer Events (타일은 pointer-events:none 처리됨)
  let dragStart = null;
  function onPointerDown(e){
    if (e.pointerType === "mouse" && e.button !== 0) return;
    dragStart = { x: e.clientX, y: e.clientY, id: e.pointerId };
    // 캡처로 보드 밖에서 놓아도 pointerup이 보드로 들어오게
    try { elBoard.setPointerCapture(e.pointerId); } catch {}
  }
  function onPointerUp(e){
    if (!dragStart) return;
    const dx = e.clientX - dragStart.x;
    const dy = e.clientY - dragStart.y;
    dragStart = null;

    const ax = Math.abs(dx), ay = Math.abs(dy);
    const TH = 18;
    if (Math.max(ax, ay) < TH) return;

    if (ax > ay) move(dx > 0 ? "right" : "left");
    else move(dy > 0 ? "down" : "up");
  }

  function restore(){
    buildBackground();
    calcLayout();
    elTiles.innerHTML="";
    for (const id in state.tiles){
      const t=state.tiles[id];
      const el=document.createElement("div");
      el.className = `tile t-${t.value}`;
      el.dataset.id=id;
      el.textContent=String(t.value);
      elTiles.appendChild(el);
      positionTileEl(t,false);
    }
    renderTop();

    // 저장된 상태 복원: 게임오버면 동일 규칙 적용
    if (state.status === "over") {
      sOver();
      // "게임 오버의 최종 점수가 최고기록인 경우 + 미입력"일 때만 팝업
      const isThisRunBest = (state.score === state.best);
      const needName = isThisRunBest && (state.bestNamedAt < state.best);
      if (needName) {
        pendingGameOverAfterName = true;
        showHighScoreNamePopup();
      } else {
        showGameOverPopup();
      }
    } else if (state.status === "won") {
      showGameClearPopup();
    } else {
      hideModal();
    }
  }

  // Modal primary action
  elModalPrimary.addEventListener("click", () => {
    if (modalMode === "highscore") {
      const name = (elNameInput.value || "").trim() || "익명";
      state.bestName = name;
      state.bestNamedAt = state.best;
      saveState();
      renderTop();
      hideModal();

      if (pendingGameOverAfterName) {
        pendingGameOverAfterName = false;
        showGameOverPopup();
      }
      return;
    }

    if (modalMode === "gameover" || modalMode === "gameclear") {
      newGame(true);
      return;
    }

    hideModal();
  });

  // Events
  if (elSoundToggle){
    elSoundToggle.addEventListener("click", ()=>{
      state.soundEnabled = !state.soundEnabled;
      renderSoundUI();
      saveState();
      if (state.soundEnabled) { try{ getAudioCtx(); audioCtx.resume(); }catch(e){} }
    });
  }
  elReset.addEventListener("click", ()=> newGame(true));
  window.addEventListener("keydown", onKeyDown, { passive:false });
  window.addEventListener("resize", ()=> calcLayout());

  elBoard.addEventListener("pointerdown", onPointerDown, { passive:true });
  elBoard.addEventListener("pointerup", onPointerUp, { passive:true });
  elBoard.addEventListener("pointercancel", () => { dragStart = null; }, { passive:true });

  // Boot
  state = loadState();
  if (!state) {
    newGame(true);
  } else {
    if (state.score > state.best) state.best = state.score;
    buildBackground();
    calcLayout();
    restore();
  }
})();