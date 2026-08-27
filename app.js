(function () {
  "use strict";

  /* ---------------------------------------------------------------
   * 운동 종목 계층 구조: 부위(상체/하체) -> 근육 그룹 -> 종목
   * ------------------------------------------------------------- */
  var EXERCISE_DATA = {
    "상체": {
      "가슴": ["벤치프레스", "인클라인 벤치프레스", "덤벨 플라이", "케이블 크로스오버", "푸시업"],
      "등": ["데드리프트", "바벨로우", "랫풀다운", "시티드 로우", "풀업"],
      "어깨": ["오버헤드 프레스", "사이드 레터럴레이즈", "프론트 레이즈", "리어 델트 플라이"],
      "팔": ["바벨컬", "덤벨컬", "해머컬", "트라이셉스 푸시다운", "딥스"]
    },
    "하체": {
      "대퇴사두근": ["스쿼트", "프론트 스쿼트", "레그프레스", "레그익스텐션", "런지"],
      "햄스트링·둔근": ["루마니안 데드리프트", "레그컬", "힙쓰러스트", "불가리안 스플릿 스쿼트"],
      "종아리": ["스탠딩 카프레이즈", "시티드 카프레이즈"],
      "코어": ["행잉 레그레이즈", "케이블 크런치", "플랭크"]
    }
  };

  var PART_META = {
    "상체": { icon: "💪", desc: "가슴 · 등 · 어깨 · 팔", cls: "upper" },
    "하체": { icon: "🦵", desc: "하체 · 둔근 · 코어", cls: "lower" }
  };

  var LS_CUSTOM = "wc_custom_exercises";
  var LS_HISTORY = "wc_history";
  var LS_LAST_SETTINGS = "wc_last_settings";

  /* ---------------------------------------------------------------
   * localStorage helpers
   * ------------------------------------------------------------- */
  function loadJSON(key, fallback) {
    try {
      var raw = localStorage.getItem(key);
      return raw ? JSON.parse(raw) : fallback;
    } catch (e) {
      return fallback;
    }
  }
  function saveJSON(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch (e) { /* storage unavailable */ }
  }

  function getCustomExercises() {
    return loadJSON(LS_CUSTOM, {});
  }
  function addCustomExercise(part, group, name) {
    name = name.trim();
    if (!name) return;
    var custom = getCustomExercises();
    custom[part] = custom[part] || {};
    custom[part][group] = custom[part][group] || [];
    var all = getExercises(part, group);
    if (all.indexOf(name) !== -1) return;
    custom[part][group].push(name);
    saveJSON(LS_CUSTOM, custom);
  }
  function getExercises(part, group) {
    var builtin = (EXERCISE_DATA[part] && EXERCISE_DATA[part][group]) || [];
    var custom = getCustomExercises();
    var extra = (custom[part] && custom[part][group]) || [];
    return builtin.concat(extra);
  }
  function getGroups(part) {
    var groups = Object.keys(EXERCISE_DATA[part] || {});
    var custom = getCustomExercises();
    if (custom[part]) {
      Object.keys(custom[part]).forEach(function (g) {
        if (groups.indexOf(g) === -1) groups.push(g);
      });
    }
    return groups;
  }

  function getHistory() { return loadJSON(LS_HISTORY, []); }
  function saveHistoryRecord(record) {
    var history = getHistory();
    history.unshift(record);
    saveJSON(LS_HISTORY, history);
  }

  function getLastSettings(exercise) {
    var all = loadJSON(LS_LAST_SETTINGS, {});
    return all[exercise] || null;
  }
  function saveLastSettings(exercise, settings) {
    var all = loadJSON(LS_LAST_SETTINGS, {});
    all[exercise] = settings;
    saveJSON(LS_LAST_SETTINGS, all);
  }

  /* ---------------------------------------------------------------
   * State
   * ------------------------------------------------------------- */
  var state = {
    screen: "home",
    homeStep: "part", // 'part' | 'group' | 'exercise'
    part: null,
    group: null,
    exercise: null,
    sets: 3,
    reps: 12,
    rest: 60,
    currentSet: 1,
    completedSets: 0,
    isResting: false,
    remaining: 0,
    timerId: null,
    startedAt: null
  };

  var SETS_MIN = 1, SETS_MAX = 10;
  var REPS_MIN = 10, REPS_MAX = 30;
  var REST_MIN = 10, REST_MAX = 300, REST_STEP = 10;

  function clamp(v, min, max) { return Math.max(min, Math.min(max, v)); }

  function formatSeconds(s) {
    if (s < 60) return s + "초";
    var m = Math.floor(s / 60);
    var r = s % 60;
    return r === 0 ? m + "분" : m + "분 " + r + "초";
  }
  function formatClock(s) {
    var m = Math.floor(s / 60);
    var r = s % 60;
    return (m < 10 ? "0" + m : m) + ":" + (r < 10 ? "0" + r : r);
  }
  function formatDateKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() + "-" + String(d.getMonth() + 1).padStart(2, "0") + "-" + String(d.getDate()).padStart(2, "0");
  }
  function formatDateLabel(key) {
    var todayKey = formatDateKey(Date.now());
    var yestKey = formatDateKey(Date.now() - 86400000);
    if (key === todayKey) return "오늘";
    if (key === yestKey) return "어제";
    var parts = key.split("-");
    return parts[1] + "월 " + parts[2] + "일";
  }
  function formatTime(ts) {
    var d = new Date(ts);
    var h = d.getHours(), m = d.getMinutes();
    var ampm = h < 12 ? "오전" : "오후";
    var h12 = h % 12 === 0 ? 12 : h % 12;
    return ampm + " " + h12 + ":" + String(m).padStart(2, "0");
  }

  /* ---------------------------------------------------------------
   * Sound / vibration feedback
   * ------------------------------------------------------------- */
  function beep() {
    try {
      var Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return;
      var ctx = new Ctx();
      var o = ctx.createOscillator();
      var g = ctx.createGain();
      o.connect(g); g.connect(ctx.destination);
      o.frequency.value = 880;
      g.gain.setValueAtTime(0.0001, ctx.currentTime);
      g.gain.exponentialRampToValueAtTime(0.35, ctx.currentTime + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, ctx.currentTime + 0.35);
      o.start();
      o.stop(ctx.currentTime + 0.4);
      setTimeout(function () { ctx.close(); }, 500);
    } catch (e) { /* ignore */ }
  }
  function vibrate(pattern) {
    if (navigator.vibrate) { try { navigator.vibrate(pattern); } catch (e) {} }
  }

  /* ---------------------------------------------------------------
   * Screen switching
   * ------------------------------------------------------------- */
  var screens = {};
  ["home", "setup", "workout", "complete", "history"].forEach(function (name) {
    screens[name] = document.getElementById("screen-" + name);
  });
  var bottomNav = document.getElementById("bottom-nav");

  function showScreen(name) {
    state.screen = name;
    Object.keys(screens).forEach(function (key) {
      screens[key].classList.toggle("active", key === name);
    });
    var showNav = name === "home" || name === "history";
    bottomNav.classList.toggle("hidden", !showNav);
    document.querySelectorAll(".nav-btn").forEach(function (btn) {
      btn.classList.toggle("active", btn.dataset.nav === name);
    });
    window.scrollTo(0, 0);
  }

  document.querySelectorAll(".nav-btn").forEach(function (btn) {
    btn.addEventListener("click", function () {
      if (btn.dataset.nav === "home") {
        state.homeStep = "part";
        renderHome();
        showScreen("home");
      } else {
        renderHistory();
        showScreen("history");
      }
    });
  });

  /* ---------------------------------------------------------------
   * HOME
   * ------------------------------------------------------------- */
  var homeTitle = document.getElementById("home-title");
  var homeSubtitle = document.getElementById("home-subtitle");
  var homeContent = document.getElementById("home-content");
  var homeBackRow = document.getElementById("home-back-row");
  var homeStats = document.getElementById("home-stats");
  document.getElementById("home-back-btn").addEventListener("click", function () {
    if (state.homeStep === "exercise") { state.homeStep = "group"; }
    else if (state.homeStep === "group") { state.homeStep = "part"; }
    renderHome();
  });

  function renderHomeStats() {
    var history = getHistory();
    var todayKey = formatDateKey(Date.now());
    var todaySets = 0, todaySessions = 0;
    history.forEach(function (r) {
      if (formatDateKey(r.finishedAt) === todayKey) {
        todaySessions++;
        todaySets += r.completedSets;
      }
    });
    homeStats.innerHTML =
      '<div class="stat-card"><div class="stat-value">' + todaySessions + '</div><div class="stat-label">오늘 완료 종목</div></div>' +
      '<div class="stat-card"><div class="stat-value">' + todaySets + '</div><div class="stat-label">오늘 완료 세트</div></div>';
  }

  function renderHome() {
    renderHomeStats();
    if (state.homeStep === "part") {
      homeTitle.textContent = "오늘의 운동";
      homeSubtitle.textContent = "부위를 선택하세요";
      homeBackRow.classList.add("hidden");
      var html = '<div class="part-grid">';
      ["상체", "하체"].forEach(function (part) {
        var meta = PART_META[part];
        html += '<div class="part-card ' + meta.cls + '" data-part="' + part + '">' +
          '<span class="part-icon">' + meta.icon + '</span>' +
          '<div class="part-name">' + part + '</div>' +
          '<div class="part-desc">' + meta.desc + '</div>' +
          '</div>';
      });
      html += '</div>';
      homeContent.innerHTML = html;
      homeContent.querySelectorAll(".part-card").forEach(function (el) {
        el.addEventListener("click", function () {
          state.part = el.dataset.part;
          state.homeStep = "group";
          renderHome();
        });
      });
    } else if (state.homeStep === "group") {
      homeTitle.textContent = state.part;
      homeSubtitle.textContent = "근육 그룹을 선택하세요";
      homeBackRow.classList.remove("hidden");
      var groups = getGroups(state.part);
      var ghtml = '<div class="group-grid">';
      groups.forEach(function (g) {
        var count = getExercises(state.part, g).length;
        ghtml += '<div class="group-card" data-group="' + g + '">' +
          '<div class="group-name">' + g + '</div>' +
          '<div class="group-count">종목 ' + count + '개</div>' +
          '</div>';
      });
      ghtml += '</div>';
      homeContent.innerHTML = ghtml;
      homeContent.querySelectorAll(".group-card").forEach(function (el) {
        el.addEventListener("click", function () {
          state.group = el.dataset.group;
          state.homeStep = "exercise";
          renderHome();
        });
      });
    } else if (state.homeStep === "exercise") {
      homeTitle.textContent = state.group;
      homeSubtitle.textContent = state.part + " · 종목을 선택하세요";
      homeBackRow.classList.remove("hidden");
      var exercises = getExercises(state.part, state.group);
      var ehtml = '<div class="exercise-list">';
      exercises.forEach(function (name) {
        ehtml += '<div class="exercise-row" data-exercise="' + name + '">' +
          '<span class="exercise-name">' + name + '</span><span class="chevron">›</span></div>';
      });
      ehtml += '</div>' +
        '<div class="add-exercise-row">' +
        '<input type="text" id="custom-exercise-input" placeholder="종목 직접 추가">' +
        '<button id="add-exercise-btn" type="button">추가</button>' +
        '</div>';
      homeContent.innerHTML = ehtml;
      homeContent.querySelectorAll(".exercise-row").forEach(function (el) {
        el.addEventListener("click", function () {
          selectExercise(el.dataset.exercise);
        });
      });
      document.getElementById("add-exercise-btn").addEventListener("click", function () {
        var input = document.getElementById("custom-exercise-input");
        if (input.value.trim()) {
          addCustomExercise(state.part, state.group, input.value);
          input.value = "";
          renderHome();
        }
      });
      document.getElementById("custom-exercise-input").addEventListener("keydown", function (e) {
        if (e.key === "Enter") document.getElementById("add-exercise-btn").click();
      });
    }
  }

  /* ---------------------------------------------------------------
   * SETUP (세트 / 목표 횟수 / 휴식시간)
   * ------------------------------------------------------------- */
  var setupContent = document.getElementById("setup-content");
  var setupExerciseName = document.getElementById("setup-exercise-name");
  var setupBreadcrumb = document.getElementById("setup-breadcrumb");

  document.getElementById("setup-back-btn").addEventListener("click", function () {
    state.homeStep = "exercise";
    renderHome();
    showScreen("home");
  });

  function selectExercise(name) {
    state.exercise = name;
    var last = getLastSettings(name);
    if (last) {
      state.sets = clamp(last.sets, SETS_MIN, SETS_MAX);
      state.reps = clamp(last.reps, REPS_MIN, REPS_MAX);
      state.rest = clamp(last.rest, REST_MIN, REST_MAX);
    } else {
      state.sets = 3;
      state.reps = 12;
      state.rest = 60;
    }
    renderSetup();
    showScreen("setup");
  }

  function renderSetup() {
    setupExerciseName.textContent = state.exercise;
    setupBreadcrumb.textContent = state.part + " · " + state.group;
    setupContent.innerHTML =
      stepperCardHTML("sets", "세트 수", state.sets, "세트", SETS_MIN, SETS_MAX, 1) +
      stepperCardHTML("reps", "목표 횟수 (1세트당)", state.reps, "회", REPS_MIN, REPS_MAX, 1) +
      stepperCardHTML("rest", "세트 간 휴식 시간", state.rest, null, REST_MIN, REST_MAX, REST_STEP, formatSeconds);
    bindStepper("sets", SETS_MIN, SETS_MAX, 1);
    bindStepper("reps", REPS_MIN, REPS_MAX, 1);
    bindStepper("rest", REST_MIN, REST_MAX, REST_STEP);
  }

  function stepperCardHTML(key, title, value, unit, min, max, step, formatFn) {
    var display = formatFn ? formatFn(value) : (value + (unit ? '<span class="unit">' + unit + '</span>' : ""));
    return '<div class="stepper-card" data-key="' + key + '">' +
      '<div class="stepper-label"><span class="label-title">' + title + '</span>' +
      '<span class="label-value" id="' + key + '-value">' + display + '</span></div>' +
      '<div class="stepper-controls">' +
      '<button class="stepper-btn" id="' + key + '-minus" type="button">−</button>' +
      '<div class="stepper-track">' +
      '<input type="range" id="' + key + '-range" min="' + min + '" max="' + max + '" step="' + step + '" value="' + value + '">' +
      '<div class="stepper-track-labels"><span>' + min + (formatFn ? "초" : "") + '</span><span>' + max + (formatFn ? "초" : "") + '</span></div>' +
      '</div>' +
      '<button class="stepper-btn" id="' + key + '-plus" type="button">+</button>' +
      '</div></div>';
  }

  function bindStepper(key, min, max, step) {
    var range = document.getElementById(key + "-range");
    var valueEl = document.getElementById(key + "-value");
    var minusBtn = document.getElementById(key + "-minus");
    var plusBtn = document.getElementById(key + "-plus");
    var formatFn = key === "rest" ? formatSeconds : null;
    var unit = key === "reps" ? "회" : (key === "sets" ? "세트" : null);

    function update(v) {
      v = clamp(v, min, max);
      state[key] = v;
      range.value = v;
      valueEl.innerHTML = formatFn ? formatFn(v) : (v + (unit ? '<span class="unit">' + unit + '</span>' : ""));
      minusBtn.disabled = v <= min;
      plusBtn.disabled = v >= max;
    }
    range.addEventListener("input", function () { update(parseInt(range.value, 10)); });
    minusBtn.addEventListener("click", function () { update(state[key] - step); });
    plusBtn.addEventListener("click", function () { update(state[key] + step); });
    update(state[key]);
  }

  document.getElementById("start-workout-btn").addEventListener("click", function () {
    startWorkout();
  });

  /* ---------------------------------------------------------------
   * WORKOUT (세트 카운트 + 휴식 타이머)
   * ------------------------------------------------------------- */
  var workoutContent = document.getElementById("workout-content");
  var workoutExerciseName = document.getElementById("workout-exercise-name");
  var workoutBreadcrumb = document.getElementById("workout-breadcrumb");

  document.getElementById("workout-cancel-btn").addEventListener("click", function () {
    if (confirm("운동을 종료할까요? 진행 상황은 저장되지 않습니다.")) {
      stopTimer();
      state.homeStep = "exercise";
      renderHome();
      showScreen("home");
    }
  });

  function startWorkout() {
    saveLastSettings(state.exercise, { sets: state.sets, reps: state.reps, rest: state.rest });
    state.currentSet = 1;
    state.completedSets = 0;
    state.isResting = false;
    state.startedAt = Date.now();
    renderWorkout();
    showScreen("workout");
  }

  function renderWorkout() {
    workoutExerciseName.textContent = state.exercise;
    workoutBreadcrumb.textContent = state.part + " · " + state.group;

    var dots = "";
    for (var i = 1; i <= state.sets; i++) {
      var cls = "set-dot";
      if (i <= state.completedSets) cls += " done";
      else if (i === state.currentSet && !state.isResting) cls += " current";
      dots += '<span class="' + cls + '"></span>';
    }

    if (state.isResting) {
      workoutContent.innerHTML =
        '<div class="set-dots">' + dots + '</div>' +
        '<div class="rest-panel">' +
        '<div class="rest-label">휴식 중</div>' +
        '<div class="rest-timer" id="rest-timer">' + formatClock(state.remaining) + '</div>' +
        '<div class="rest-bar-track"><div class="rest-bar-fill" id="rest-bar-fill" style="width:100%"></div></div>' +
        '<div class="rest-actions">' +
        '<button id="rest-add10-btn" type="button">+10초</button>' +
        '<button class="skip-btn" id="rest-skip-btn" type="button">쉬는시간 건너뛰기</button>' +
        '</div></div>';
      document.getElementById("rest-add10-btn").addEventListener("click", function () {
        state.remaining += 10;
        updateRestDisplay();
      });
      document.getElementById("rest-skip-btn").addEventListener("click", function () {
        endRest();
      });
    } else {
      workoutContent.innerHTML =
        '<div class="set-dots">' + dots + '</div>' +
        '<div class="set-progress">' +
        '<span class="set-current">' + state.currentSet + '</span><span class="set-total"> / ' + state.sets + '세트</span>' +
        '<div class="set-caption">현재 세트</div>' +
        '</div>' +
        '<div class="reps-target"><div class="reps-value">목표 ' + state.reps + '회</div>' +
        '<div class="reps-label">이 세트에서 수행할 횟수</div></div>' +
        '<button class="complete-set-btn" id="complete-set-btn" type="button">세트 완료 ✓</button>';
      document.getElementById("complete-set-btn").addEventListener("click", completeSet);
    }
  }

  function completeSet() {
    state.completedSets++;
    vibrate(60);
    if (state.completedSets >= state.sets) {
      finishWorkout();
      return;
    }
    state.currentSet++;
    startRest();
  }

  function startRest() {
    state.isResting = true;
    state.remaining = state.rest;
    renderWorkout();
    var restTotal = state.rest;
    stopTimer();
    state.timerId = setInterval(function () {
      state.remaining--;
      if (state.remaining <= 0) {
        beep();
        vibrate([120, 80, 120]);
        endRest();
        return;
      }
      updateRestDisplay(restTotal);
    }, 1000);
    updateRestDisplay(restTotal);
  }

  function updateRestDisplay(restTotal) {
    var timerEl = document.getElementById("rest-timer");
    var fillEl = document.getElementById("rest-bar-fill");
    if (timerEl) timerEl.textContent = formatClock(Math.max(0, state.remaining));
    if (fillEl) {
      var total = restTotal || state.rest;
      var pct = clamp((state.remaining / total) * 100, 0, 100);
      fillEl.style.width = pct + "%";
    }
  }

  function endRest() {
    stopTimer();
    state.isResting = false;
    renderWorkout();
  }

  function stopTimer() {
    if (state.timerId) {
      clearInterval(state.timerId);
      state.timerId = null;
    }
  }

  function finishWorkout() {
    stopTimer();
    var record = {
      part: state.part,
      group: state.group,
      exercise: state.exercise,
      sets: state.sets,
      reps: state.reps,
      rest: state.rest,
      completedSets: state.completedSets,
      startedAt: state.startedAt,
      finishedAt: Date.now()
    };
    saveHistoryRecord(record);
    renderComplete(record);
    showScreen("complete");
  }

  /* ---------------------------------------------------------------
   * COMPLETE
   * ------------------------------------------------------------- */
  var completeContent = document.getElementById("complete-content");

  function renderComplete(record) {
    var durationMin = Math.round((record.finishedAt - record.startedAt) / 60000);
    completeContent.innerHTML =
      '<div class="complete-emoji">🎉</div>' +
      '<div class="complete-title">운동 완료!</div>' +
      '<div class="complete-sub">' + record.exercise + '을(를) 잘 끝냈어요</div>' +
      '<div class="summary-card">' +
      '<div class="summary-row"><span class="k">부위</span><span class="v">' + record.part + ' · ' + record.group + '</span></div>' +
      '<div class="summary-row"><span class="k">완료 세트</span><span class="v">' + record.completedSets + ' / ' + record.sets + '세트</span></div>' +
      '<div class="summary-row"><span class="k">목표 횟수</span><span class="v">' + record.reps + '회</span></div>' +
      '<div class="summary-row"><span class="k">휴식 시간</span><span class="v">' + formatSeconds(record.rest) + '</span></div>' +
      '<div class="summary-row"><span class="k">소요 시간</span><span class="v">약 ' + Math.max(durationMin, 1) + '분</span></div>' +
      '</div>' +
      '<div class="complete-actions">' +
      '<button class="btn-primary" id="restart-same-btn" type="button">같은 종목 다시하기</button>' +
      '<button class="btn-secondary" id="pick-another-btn" type="button">다른 종목 선택</button>' +
      '<button class="btn-secondary" id="go-home-btn" type="button">홈으로</button>' +
      '</div>';

    document.getElementById("restart-same-btn").addEventListener("click", function () {
      renderSetup();
      showScreen("setup");
    });
    document.getElementById("pick-another-btn").addEventListener("click", function () {
      state.homeStep = "exercise";
      renderHome();
      showScreen("home");
    });
    document.getElementById("go-home-btn").addEventListener("click", function () {
      state.homeStep = "part";
      renderHome();
      showScreen("home");
    });
  }

  /* ---------------------------------------------------------------
   * HISTORY
   * ------------------------------------------------------------- */
  var historyContent = document.getElementById("history-content");

  function renderHistory() {
    var history = getHistory();
    if (history.length === 0) {
      historyContent.innerHTML = '<div class="empty-state">아직 완료한 운동 기록이 없어요.<br>운동을 시작해보세요!</div>';
      return;
    }
    var groups = {};
    var order = [];
    history.forEach(function (r) {
      var key = formatDateKey(r.finishedAt);
      if (!groups[key]) { groups[key] = []; order.push(key); }
      groups[key].push(r);
    });
    var html = "";
    order.forEach(function (key) {
      html += '<div class="history-day"><div class="history-day-title">' + formatDateLabel(key) + '</div>';
      groups[key].forEach(function (r) {
        html += '<div class="history-card">' +
          '<div class="h-top"><span class="h-name">' + r.exercise + '</span><span class="h-time">' + formatTime(r.finishedAt) + '</span></div>' +
          '<div>' +
          '<span class="h-tag">' + r.part + ' · ' + r.group + '</span>' +
          '<span class="h-tag">' + r.completedSets + '/' + r.sets + '세트</span>' +
          '<span class="h-tag">' + r.reps + '회</span>' +
          '<span class="h-tag">휴식 ' + formatSeconds(r.rest) + '</span>' +
          '</div></div>';
      });
      html += '</div>';
    });
    historyContent.innerHTML = html;
  }

  /* ---------------------------------------------------------------
   * PWA service worker
   * ------------------------------------------------------------- */
  if ("serviceWorker" in navigator && (location.protocol === "http:" || location.protocol === "https:")) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("sw.js").catch(function () {});
    });
  }

  /* ---------------------------------------------------------------
   * Init
   * ------------------------------------------------------------- */
  renderHome();
  showScreen("home");
})();
