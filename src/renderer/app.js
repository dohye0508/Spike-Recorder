'use strict';

(function () {
  var api = window.api;
  var Seg = window.Seg;
  var $ = function (id) { return document.getElementById(id); };

  var P1_COLOR = '#FF4A1C', P2_COLOR = '#36B7FF', AMBER = '#FFB21E';
  var MAX_SCORE = 9999;
  var TEMP_NAME = 'ㅇㅇㅇ';

  var state = null;
  var adminOpen = false;

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  // ───────────────────────── 화면 비율 유지 확대·축소 ─────────────────────────
  function fit() {
    var stage = $('stage');
    var s = Math.min(window.innerWidth / 1440, window.innerHeight / 900);
    var x = (window.innerWidth - 1440 * s) / 2, y = (window.innerHeight - 900 * s) / 2;
    stage.style.transform = 'translate(' + x + 'px,' + y + 'px) scale(' + s + ')';
  }
  window.addEventListener('resize', fit);
  fit();

  // ───────────────────────── 관중용 스코어보드 (Main.dc.html renderVals) ─────────────────────────
  var RAINBOW = ['#2F7BFF', '#3D6BFF', '#5A5CFF', '#7A4DFF', '#9B45F0', '#BE3FD9', '#DA3BB8', '#EE3A8F', '#F93D63', '#FF4A3D', '#FF5E2A', '#FF7A1F', '#FF9A1A', '#FFBA1A', '#FFD61F'];
  var CROWNS = [
    { c: '#FFC83D', e: '#B07A0E', label: '1위' },
    { c: '#D3DAE2', e: '#7C8792', label: '2위' },
    { c: '#D88A4E', e: '#8A4A1E', label: '3위' }
  ];

  function winnerKey(g) {
    if (g.phase === 'measuring') return 'measuring';
    if (g.phase === 'result') return g.winner;
    return 'none';
  }

  function levelOf(v) {
    return Math.max(0, Math.min(15, Math.round((v / MAX_SCORE) * 15)));
  }

  function meterHtml(v) {
    var level = levelOf(v), html = '';
    for (var i = 15; i >= 1; i--) {
      var c = RAINBOW[i - 1], lit = i <= level;
      html += '<div style="width:54px;height:24px;border-radius:12px;box-sizing:border-box;display:flex;align-items:center;justify-content:center;font-size:15px;' + (lit ? 'background:' + c + ';color:#1A0D0B;box-shadow:0 0 8px ' + c + ',0 0 20px ' + c + '66' : 'background:' + c + '12;color:' + c + '66;border:1px solid ' + c + '30') + '">' + i + '</div>';
    }
    return html;
  }

  function player(color, isWin, isLose, samples, needed, best) {
    samples = Math.max(0, Math.min(needed, samples || 0));
    return {
      samples: samples,
      best: best,
      bar: 'height:100%;width:' + (samples / needed * 100) + '%;background:' + color + ';box-shadow:0 0 10px ' + color,
      labelStyle: 'color:' + color + ';text-shadow:0 0 12px ' + color + '99',
      panel: 'background:#1C0F0D;' + (isWin ? 'border:2px solid ' + color + ';box-shadow:0 0 0 6px ' + color + '1F, 0 0 48px ' + color + '40' : 'border:2px solid #3A2420') + (isLose ? ';opacity:0.62' : '')
    };
  }

  function crownSvg(cr) {
    return '<svg role="img" aria-label="' + cr.label + '" width="44" height="36" viewBox="0 0 44 36" style="filter:drop-shadow(0 0 6px ' + cr.c + '99)">' +
      '<path d="M5 27 L3 9 L13 17 L22 4 L31 17 L41 9 L39 27 Z" fill="' + cr.c + '" stroke="' + cr.e + '" stroke-width="1.5" stroke-linejoin="round"></path>' +
      '<rect x="5" y="29" width="34" height="5" rx="1.5" fill="' + cr.c + '" stroke="' + cr.e + '" stroke-width="1.5"></rect>' +
      '<circle cx="3" cy="8" r="2.6" fill="' + cr.c + '"></circle>' +
      '<circle cx="22" cy="3.2" r="2.8" fill="' + cr.c + '"></circle>' +
      '<circle cx="41" cy="8" r="2.6" fill="' + cr.c + '"></circle>' +
      '<circle cx="22" cy="20" r="3" fill="' + cr.e + '"></circle>' +
      '</svg>';
  }

  function hallRows(records) {
    var html = '';
    for (var i = 0; i < 5; i++) {
      var r = records[i];
      var col = i === 0 ? AMBER : '#E8963A';
      var cr = CROWNS[i];
      var row = 'display:flex;align-items:center;gap:18px;padding:14px 18px;border-radius:14px;' + (i === 0 ? 'background:#2A1610;border:1px solid #6B4318' : 'border:1px solid transparent;border-top-color:#2E1B17');
      html += '<div style="' + row + '">' +
        '<div style="width: 48px; height: 40px; flex: none; display: flex; align-items: center; justify-content: center">' +
        (cr ? crownSvg(cr) : '<div style="font-size: 36px; color: #C9B3AC">' + (i + 1) + '</div>') +
        '</div>' +
        '<div style="flex-grow: 1; min-width: 0; font-size: 30px; color: ' + (r ? '#E9DAD5' : '#5A4540') + '; white-space: nowrap; overflow: hidden; text-overflow: ellipsis">' + (r ? esc(r.name) : '-') + '</div>' +
        Seg.display(r ? Seg.pad(r.score) : '    ', 40, col) +
        '</div>';
    }
    return html;
  }

  // 숫자·레벨 미터는 아래 애니메이션 루프가 채운다 (id: p1-digits, p1-meter, p1-level)
  function playerPanel(p, side, needed, measuring) {
    var isP1 = side === 1;
    var id = 'p' + side;
    var info = '측정 ' + p.samples + ' / ' + needed + ' · 최고 ' + p.best;
    var status = measuring
      ? (isP1
        ? '<div style="display: flex; flex-direction: column; gap: 8px; width: 270px">' +
          '<div style="font-size: 22px; color: #E9DAD5">' + info + '</div>' +
          '<div style="height: 10px; border-radius: 5px; background: #2E1B17; overflow: hidden"><div style="' + p.bar + '"></div></div></div>'
        : '<div style="display: flex; flex-direction: column; gap: 8px; width: 270px; align-items: flex-end">' +
          '<div style="font-size: 22px; color: #E9DAD5">' + info + '</div>' +
          '<div style="width: 100%; height: 10px; border-radius: 5px; background: #2E1B17; overflow: hidden; display: flex; justify-content: flex-end"><div style="' + p.bar + '"></div></div></div>')
      : '<div id="' + id + '-level" style="font-size: 22px; color: #B8A29B"></div>';
    return '<div style="width: 420px; box-sizing: border-box; padding: 32px 28px; border-radius: 24px; display: flex; flex-direction: ' + (isP1 ? 'row' : 'row-reverse') + '; gap: 32px; align-items: center; ' + p.panel + '">' +
      '<div id="' + id + '-meter" style="display: flex; flex-direction: column; gap: 7px"></div>' +
      '<div style="display: flex; flex-direction: column; gap: 28px; align-items: ' + (isP1 ? 'flex-start' : 'flex-end') + '">' +
      '<div style="font-size: 40px; ' + p.labelStyle + '">PLAYER ' + side + '</div>' +
      '<div id="' + id + '-digits"></div>' + status +
      '</div></div>';
  }

  function renderMain() {
    var g = state.game;
    var winner = winnerKey(g);
    var needed = g.samplesNeeded;
    var wc = winner === 'p1' ? P1_COLOR : winner === 'p2' ? P2_COLOR : AMBER;
    var measuring = winner === 'measuring';
    var LABELS = { measuring: '5초 동안 힘껏 쥐세요', draw: '동점', none: '다음 경기 대기' };
    var TEXTS = { p1: 'PLAYER 1', p2: 'PLAYER 2', draw: 'DRAW', measuring: '측정 중', none: 'START 버튼을 누르세요' };
    var winnerTextStyle = 'color:' + wc + ';text-shadow:0 0 18px ' + wc + ',0 0 44px ' + wc + '80';
    var bannerStyle = 'background:#1C0F0D;border:3px solid ' + wc + ';box-shadow:0 0 30px ' + wc + '55, inset 0 0 30px ' + wc + '22';
    var p1 = player(P1_COLOR, winner === 'p1', winner === 'p2', g.p1.samples, needed, g.p1.score);
    var p2 = player(P2_COLOR, winner === 'p2', winner === 'p1', g.p2.samples, needed, g.p2.score);

    var banner = '<div style="align-self: center; width: 980px; box-sizing: border-box; padding: 22px 40px 26px; border-radius: 28px; display: flex; flex-direction: column; align-items: center; gap: 4px; ' + bannerStyle + '">' +
      '<div style="font-size: 26px; letter-spacing: 0.3em; color: #C9B3AC">' + (LABELS[winner] || 'WINNER') + '</div>' +
      '<div style="font-size: 92px; line-height: 1; white-space: nowrap; ' + winnerTextStyle + '">' + (TEXTS[winner] || '') + '</div>' +
      (winner === 'draw' ? '<div style="margin-top: 10px; font-size: 24px; color: #C9B3AC">관리자가 새 경기를 시작하면 다시 측정합니다</div>' : '') +
      '</div>';

    var hall = '<div style="flex-grow: 1; min-width: 0; box-sizing: border-box; padding: 28px 32px; border-radius: 24px; background: #1C0F0D; border: 1px solid #3A2420; display: flex; flex-direction: column; gap: 14px">' +
      '<h2 style="margin: 0 0 6px; font-size: 44px; font-weight: 400; text-align: center; color: #FFB21E; text-shadow: 0 0 14px rgba(255,178,30,0.55)">명예의 전당</h2>' +
      hallRows(state.hall) + '</div>';

    $('main').innerHTML = banner +
      '<div style="flex-grow: 1; display: flex; gap: 40px; align-items: stretch; min-height: 0">' +
      playerPanel(p1, 1, needed, measuring) + hall + playerPanel(p2, 2, needed, measuring) +
      '</div>';
    drawn = { p1: -1, p2: -1 }; // 새로 만든 칸이라 다시 그리기
    drawPlayers();
  }

  // ───────────────────────── 숫자 애니메이션 ─────────────────────────
  // 아두이노 값은 0.1초마다 오지만, 화면은 매 프레임 목표값을 향해 부드럽게 따라가서 연속적으로 오르내린다.
  // 측정 중 목표값 = 방금 들어온 값(현재 힘), 그 밖에는 최종 점수(최댓값).
  var SMOOTH_MS = 70;
  var shown = { p1: 0, p2: 0 };
  var drawn = { p1: -1, p2: -1 };
  var lastFrame = 0;

  function targetOf(k) {
    var p = state.game[k];
    return state.game.phase === 'measuring' ? p.current : p.score;
  }

  function drawPlayers() {
    ['p1', 'p2'].forEach(function (k) {
      var v = Math.round(shown[k]);
      if (v === drawn[k]) return;
      drawn[k] = v;
      var color = k === 'p1' ? P1_COLOR : P2_COLOR;
      var d = $(k + '-digits'), m = $(k + '-meter'), l = $(k + '-level');
      if (d) d.innerHTML = Seg.display(Seg.pad(v), 104, color);
      if (m) m.innerHTML = meterHtml(v);
      if (l) l.textContent = '레벨 ' + levelOf(v) + ' / 15';
    });
  }

  function frame(t) {
    var dt = lastFrame ? Math.min(100, t - lastFrame) : 16;
    lastFrame = t;
    if (state) {
      var a = 1 - Math.exp(-dt / SMOOTH_MS);
      ['p1', 'p2'].forEach(function (k) {
        var target = targetOf(k);
        shown[k] = Math.abs(target - shown[k]) < 1 ? target : shown[k] + (target - shown[k]) * a;
      });
      drawPlayers();
    }
    requestAnimationFrame(frame);
  }
  requestAnimationFrame(frame);

  // ───────────────────────── 관리자 화면 (Admin.dc.html renderVals) ─────────────────────────
  var MEDAL = ['#FFC83D', '#D3DAE2', '#D88A4E'];
  var renderedHallKey = '';

  function stateLabel(g) {
    if (g.phase === 'measuring') return ['측정 중', AMBER];
    if (g.phase === 'result') {
      if (g.winner === 'p1') return ['PLAYER 1 승 · 재경기 대기', '#FF6A45'];
      if (g.winner === 'p2') return ['PLAYER 2 승 · 재경기 대기', '#5CC4FF'];
      return ['DRAW · 재경기 대기', AMBER];
    }
    return ['대기 중 · START 대기', '#C9B3AC'];
  }

  function renderAdminRows(force) {
    var records = state.hall;
    var key = JSON.stringify(records);
    if (!force && key === renderedHallKey) return;
    // 입력 중이던 값은 기록 id 기준으로 살려 둔다
    var drafts = {};
    if (!force) {
      document.querySelectorAll('#rows input[data-id]').forEach(function (el) {
        if (el.value !== el.dataset.saved) drafts[el.dataset.id] = el.value;
      });
    }
    renderedHallKey = key;
    var pending = 0;
    var html = records.map(function (d, i) {
      var temp = d.name === TEMP_NAME;
      if (temp) pending++;
      var row = 'display:grid;grid-template-columns:70px minmax(0,1fr) 150px 140px;gap:16px;align-items:center;padding:14px 18px;border-radius:14px;' + (temp ? 'background:#2A1610;border:1px solid #6B4318' : 'border:1px solid #2E1B17');
      var input = 'box-sizing:border-box;width:100%;height:52px;padding:0 ' + (temp ? '110px' : '16px') + ' 0 16px;border-radius:10px;font-family:inherit;font-size:26px;color:#F3E6E1;background:#120807;border:2px solid ' + (temp ? '#FFB21E' : '#4A2E28');
      var value = Object.prototype.hasOwnProperty.call(drafts, d.id) ? drafts[d.id] : d.name;
      var when = new Date(d.at);
      var whenText = isNaN(when) ? '' : (when.getMonth() + 1) + '/' + when.getDate() + ' ' + String(when.getHours()).padStart(2, '0') + ':' + String(when.getMinutes()).padStart(2, '0');
      return '<div style="' + row + '">' +
        '<div style="font-size: 30px; color:' + (MEDAL[i] || '#C9B3AC') + '">' + (i + 1) + '</div>' +
        '<div style="position: relative; min-width: 0">' +
        '<label for="name-' + (i + 1) + '" style="position: absolute; width: 1px; height: 1px; overflow: hidden; clip: rect(0 0 0 0)">' + (i + 1) + '위 이름</label>' +
        '<input id="name-' + (i + 1) + '" type="text" maxlength="20" data-id="' + esc(d.id) + '" data-saved="' + esc(d.name) + '" value="' + esc(value) + '" style="' + input + '">' +
        // 다섯 줄이 모두 임시 이름이어도 넘치지 않도록 안내 문구는 입력 칸 오른쪽 안에 표시
        (temp ? '<div style="position: absolute; right: 16px; top: 0; bottom: 0; display: flex; align-items: center; pointer-events: none; font-size: 18px; color: #FFB21E">임시 이름</div>' : '') +
        '</div>' +
        '<div style="font-size: 34px; color: #FFB21E; font-variant-numeric: tabular-nums">' + d.score + '</div>' +
        '<div style="display: flex; flex-direction: column; gap: 2px"><div style="font-size: 22px; color:' + (d.player === 'PLAYER 1' ? '#FF6A45' : '#5CC4FF') + '">' + d.player + '</div>' +
        '<div style="font-size: 16px; color: #8E7770">' + whenText + '</div></div>' +
        '</div>';
    }).join('');
    if (!records.length) {
      html = '<div style="padding: 40px 18px; font-size: 24px; color: #8E7770; text-align: center">아직 기록이 없습니다</div>';
    }
    $('rows').innerHTML = html;
    $('pending').textContent = '이름 입력이 필요한 기록 ' + pending + '개';
  }

  function port(name, path, ok, color) {
    var dot = 'width:14px;height:14px;border-radius:7px;flex:none;background:' + (ok ? '#4CD964' : '#FF5A47') + ';box-shadow:0 0 10px ' + (ok ? '#4CD964' : '#FF5A47');
    return '<div style="display: flex; align-items: center; gap: 12px; padding: 10px 16px; border-radius: 14px; background: #241411">' +
      '<div style="' + dot + '" aria-hidden="true"></div>' +
      '<div style="font-size: 22px; flex: none; color:' + color + '">' + name + '</div>' +
      '<div style="font-size: 16px; color: #B8A29B; flex-grow: 1; min-width: 0; text-align: right; white-space: nowrap; overflow: hidden; text-overflow: ellipsis" title="' + esc(path) + '">' + esc(path) + '</div>' +
      '<div style="font-size: 20px; color:' + (ok ? '#7BE08A' : '#FF8A7A') + '">' + (ok ? '연결됨' : '연결 끊김') + '</div>' +
      '</div>';
  }

  function fillSettingsInputs() {
    $('cal-p1').value = state.settings.calibration.p1;
    $('cal-p2').value = state.settings.calibration.p2;
  }

  function renderAdmin() {
    var g = state.game;
    renderAdminRows(false);
    var lbl = stateLabel(g);
    $('state-text').textContent = lbl[0];
    $('state-text').style.color = lbl[1];
    var busy = g.phase === 'measuring';
    $('btn-start').disabled = busy;
    $('btn-stop').disabled = !busy;

    var ps = state.ports;
    var openCount = ps.open.length;
    var noSignal = function (k) {
      return ps[k].path ? ps[k].path + ' · 2초 넘게 신호 없음' : '신호 없음 · 열린 포트 ' + openCount + '개';
    };
    $('ports').innerHTML =
      port('PLAYER 1', ps.p1.connected ? ps.p1.path : noSignal('p1'), ps.p1.connected, '#FF6A45') +
      port('PLAYER 2', ps.p2.connected ? ps.p2.path : noSignal('p2'), ps.p2.connected, '#5CC4FF');

    $('sim-toggle').checked = state.sim;
    $('btn-fullscreen').textContent = state.fullscreen ? '창 모드로 보기' : '전체화면으로 보기';
    if (state.saveError) {
      $('names-msg').textContent = state.saveError;
      $('names-msg').style.color = '#FF8A7A';
    }
  }

  function render() {
    if (!state) return;
    renderMain();
    if (adminOpen) renderAdmin();
  }

  // ───────────────────────── 관리자 화면 열기 / 닫기 ─────────────────────────
  var isMac = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
  $('shortcut').textContent = isMac ? 'Control + D' : 'Ctrl + D';
  $('fs-shortcut').textContent = isMac ? 'F11 / Control + Cmd + F' : 'F11';

  function openAdmin() {
    adminOpen = true;
    releaseSimKeys();
    $('admin').hidden = false;
    $('main').hidden = true;
    renderAdminRows(true);
    fillSettingsInputs();
    renderAdmin();
  }

  function closeAdmin() {
    adminOpen = false;
    if (document.activeElement) document.activeElement.blur();
    $('admin').hidden = true;
    $('main').hidden = false;
  }

  function saveNames() {
    var names = {};
    document.querySelectorAll('#rows input[data-id]').forEach(function (el) { names[el.dataset.id] = el.value; });
    api.saveNames(names).then(function (ok) {
      var msg = $('names-msg');
      msg.textContent = ok ? '이름을 저장했습니다.' : '저장에 실패했습니다.';
      msg.style.color = ok ? '#7BE08A' : '#FF8A7A';
      renderedHallKey = '';
      // 저장 직후 상태가 오면 다시 그리도록 강제
      api.getState().then(function (s) { state = s; renderAdminRows(true); renderAdmin(); });
    });
  }

  function saveSettings() {
    var next = {
      calibration: { p1: parseFloat($('cal-p1').value), p2: parseFloat($('cal-p2').value) }
    };
    api.saveSettings(next).then(function (s) {
      state.settings = s;
      fillSettingsInputs();
      var btn = $('btn-save-settings');
      btn.textContent = '저장됨';
      btn.style.color = btn.style.borderColor = '#7BE08A';
      setTimeout(function () { btn.textContent = '저장'; btn.style.color = btn.style.borderColor = '#FFB21E'; }, 1500);
    });
  }

  $('btn-close').addEventListener('click', closeAdmin);
  $('btn-fullscreen').addEventListener('click', function () { api.toggleFullscreen(); });
  $('btn-start').addEventListener('click', function () { api.start(); });
  $('btn-stop').addEventListener('click', function () { api.stop(); });
  $('btn-save-names').addEventListener('click', saveNames);
  $('btn-reconnect').addEventListener('click', function () { api.reconnect(); });
  $('btn-save-settings').addEventListener('click', saveSettings);
  $('sim-toggle').addEventListener('change', function (e) { api.setSim(e.target.checked); });
  $('btn-quit').addEventListener('click', function () {
    if (window.confirm('앱을 종료할까요?')) api.quit();
  });
  $('rows').addEventListener('keydown', function (e) {
    if (e.key === 'Enter' && !e.isComposing) saveNames();
  });

  // ───────────────────────── 키보드 ─────────────────────────
  // 한글 입력 상태에서도 동작하도록 e.key 대신 e.code 사용
  var SIM_KEYS = { KeyA: 'a', KeyL: 'l', KeyT: 't' };
  var held = {};

  function releaseSimKeys() {
    held = {};
    api.simKey('release', false);
  }

  window.addEventListener('keydown', function (e) {
    // 전체화면 ↔ 창 모드 (관중 화면·관리자 화면 어디서나)
    if (e.key === 'F11' || (isMac && e.code === 'KeyF' && e.ctrlKey && e.metaKey)) {
      e.preventDefault();
      if (!e.repeat) api.toggleFullscreen();
      return;
    }
    // 관리자 화면: Control + D (Windows는 Ctrl + D). macOS의 Cmd 는 Control 과 별개라 Control 키만 본다.
    if (e.code === 'KeyD' && e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      e.preventDefault();
      if (adminOpen) closeAdmin(); else openAdmin();
      return;
    }
    if (adminOpen) {
      if (e.key === 'Escape') { e.preventDefault(); closeAdmin(); }
      return;
    }
    if (!state || !state.sim || e.ctrlKey || e.altKey || e.metaKey) return;
    if (e.code === 'KeyS') {
      if (!e.repeat) api.simKey('s', true);
    } else if (SIM_KEYS[e.code] && !held[e.code]) {
      held[e.code] = true;
      api.simKey(SIM_KEYS[e.code], true);
    }
  });

  window.addEventListener('keyup', function (e) {
    if (SIM_KEYS[e.code] && held[e.code]) {
      held[e.code] = false;
      api.simKey(SIM_KEYS[e.code], false);
    }
  });

  window.addEventListener('blur', releaseSimKeys);

  // ───────────────────────── 상태 수신 ─────────────────────────
  api.onState(function (s) { state = s; render(); });
  api.getState().then(function (s) { if (!state) { state = s; render(); } });
})();
