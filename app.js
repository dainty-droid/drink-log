(function () {
  "use strict";

  var STORAGE_KEY = "drinkLog_v1";
  var MODERATION_START = "2026-11-08"; // 절주 시작일 - 혼술/금주 기록이 하나도 없을 때 이 날부터 D+로 센다
  var SITUATIONS = {
    lunch: { label: "점심 막걸리", color: "#f4b942" },
    appointment: { label: "술 약속", color: "#4a90d9" },
    solo: { label: "혼술", color: "#e5484d" }
  };
  var SIT_PRIORITY = ["solo", "appointment", "lunch"]; // 달력 셀 대표색 우선순위

  // ---------- 저장소 ----------
  function loadLog() {
    try {
      var raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn("기록 불러오기 실패", e);
      return [];
    }
  }

  function saveLog(log) {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(log));
    } catch (e) {
      alert("저장에 실패했습니다 (브라우저 저장공간 문제일 수 있음): " + e);
    }
  }

  function uid() {
    return Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  }

  var log = loadLog();

  // ---------- 날짜 유틸 (전부 로컬 타임존 기준, YYYY-MM-DD 문자열로 다룸) ----------
  function todayStr() {
    return fmtDate(new Date());
  }
  function fmtDate(d) {
    var y = d.getFullYear();
    var m = String(d.getMonth() + 1).padStart(2, "0");
    var day = String(d.getDate()).padStart(2, "0");
    return y + "-" + m + "-" + day;
  }
  function parseDate(s) {
    var p = s.split("-").map(Number);
    return new Date(p[0], p[1] - 1, p[2]);
  }
  function addDays(d, n) {
    var nd = new Date(d);
    nd.setDate(nd.getDate() + n);
    return nd;
  }
  function daysBetween(a, b) {
    // a, b: Date (시각 00:00 기준) - b - a (일수)
    var MS = 24 * 60 * 60 * 1000;
    return Math.round((b.getTime() - a.getTime()) / MS);
  }
  // 이번 주(월~일)의 시작일을 Date로 반환
  function weekStart(d) {
    var nd = new Date(d);
    var dow = nd.getDay(); // 0=일 ... 6=토
    var diffToMon = (dow === 0) ? -6 : (1 - dow);
    return addDays(nd, diffToMon);
  }

  // ---------- 양(amount) 병합 ----------
  // "약 1병"/"약1병" 같은 수식어는 떼고 "1병"으로 취급. 숫자+단위로 분해되는 것끼리는
  // 같은 단위면 숫자를 더해서("1병"+"1병" -> "2병") 하나로 합치고, 단위가 다르면
  // 나란히 나열한다("1병"+"2잔" -> "1병 2잔"). "약간"처럼 숫자가 안 들어있는 건
  // 그대로 뒤에 붙인다.
  function parseAmount(raw) {
    var s = (raw || "").trim().replace(/^약\s*/, "");
    var m = s.match(/^(\d+(?:\.\d+)?)\s*(.+)$/);
    if (!m) return null;
    return { num: parseFloat(m[1]), unit: m[2].trim() };
  }

  function mergeAmounts(amounts) {
    var unitSums = {};
    var unitOrder = [];
    var freeform = [];
    amounts.forEach(function (raw) {
      var p = parseAmount(raw);
      if (p) {
        if (!(p.unit in unitSums)) { unitSums[p.unit] = 0; unitOrder.push(p.unit); }
        unitSums[p.unit] += p.num;
      } else if (raw && raw.trim()) {
        freeform.push(raw.trim());
      }
    });
    var parts = unitOrder.map(function (u) {
      var n = unitSums[u];
      var nStr = Number.isInteger(n) ? String(n) : String(Math.round(n * 100) / 100);
      return nStr + u;
    });
    return parts.concat(freeform).join(" ");
  }

  // ---------- 렌더: 주간 카운트 ----------
  function renderWeek() {
    var today = new Date();
    var ws = weekStart(today);
    var we = addDays(ws, 6);
    var wsStr = fmtDate(ws), weStr = fmtDate(we);

    var weekEntries = log.filter(function (r) { return r.date >= wsStr && r.date <= weStr; });
    var count = weekEntries.length;
    var hasSolo = weekEntries.some(function (r) { return r.situation === "solo"; });

    var countEl = document.getElementById("weekCount");
    countEl.textContent = count + "회";
    countEl.className = "count " + (count > 2 ? "over" : (count === 2 ? "caution" : "ok"));

    document.getElementById("weekRange").textContent =
      (ws.getMonth() + 1) + "/" + ws.getDate() + " ~ " + (we.getMonth() + 1) + "/" + we.getDate();

    // 혼술이 있으면 빨간 배너(약속 위반, 더 급한 경고)만 띄우고, 2회 경고는 혼술이
    // 없을 때만 노란 배너로 따로 띄운다(관리자님 요청, 2026-11-05 - "혼술이 있으면
    // 빨간 배너로 경고, 2회 이상이면 노란색으로").
    document.getElementById("soloBanner").classList.toggle("show", hasSolo);
    document.getElementById("countBanner").classList.toggle("show", count >= 2 && !hasSolo);
  }

  // ---------- 렌더: 연속 기록 ----------
  function renderStreaks() {
    var today = new Date();
    var todayS = fmtDate(today);

    function lastDateOf(filterFn) {
      // 미래 날짜로 미리 적어둔 "예정" 기록은 아직 안 일어난 일이라 연속 기록
      // 계산에서는 빼야 한다 - 안 그러면 "-2일째" 같은 말이 안 되는 값이 나온다.
      var matches = log.filter(function (r) { return r.date <= todayS && filterFn(r); });
      if (!matches.length) return null;
      matches.sort(function (a, b) { return a.date < b.date ? 1 : -1; });
      return matches[0].date;
    }

    // 혼술/음주 기록이 아직 하나도 없으면(예: 절주 시작 직후) "기록 없음" 대신
    // 절주 시작일(MODERATION_START)부터 센다 - 2026-11-10 관리자님 요청, "지금
    // 이틀밖에 안되긴 했지만"이라고 직접 D+2를 기대하는 발언에서 확인.
    var lastSolo = lastDateOf(function (r) { return r.situation === "solo"; }) || MODERATION_START;
    var lastAny = lastDateOf(function () { return true; }) || MODERATION_START;

    var n1 = daysBetween(parseDate(lastSolo), parseDate(todayS));
    document.getElementById("soloStreak").textContent = "D+" + n1;

    var n2 = daysBetween(parseDate(lastAny), parseDate(todayS));
    document.getElementById("anyStreak").textContent = "D+" + n2;
  }

  // ---------- 주종별 요약 (이번 주 / 달력에 보이는 달) ----------
  function getWeekEntries(refDate) {
    var ws = weekStart(refDate);
    var we = addDays(ws, 6);
    var wsStr = fmtDate(ws), weStr = fmtDate(we);
    return log.filter(function (r) { return r.date >= wsStr && r.date <= weStr; });
  }

  function getMonthEntries(year, month) {
    var prefix = year + "-" + String(month + 1).padStart(2, "0");
    return log.filter(function (r) { return r.date.indexOf(prefix) === 0; });
  }

  function summarizeTypes(entries) {
    // 주종(drinkType)이 비어있으면 "주종 미입력"으로 묶는다. 양(amount)은 자유
    // 텍스트("약간"/"1병" 등 단위가 제각각)라 숫자로 합산하지 않고, 기록된 값들을
    // 그대로 나열해서 보여준다 - 억지로 합산하면 오히려 왜곡된 숫자가 나온다.
    var byType = {};
    entries.forEach(function (r) {
      var key = (r.drinkType || "").trim() || "주종 미입력";
      if (!byType[key]) byType[key] = { count: 0, amounts: [] };
      byType[key].count += 1;
      if (r.amount && r.amount.trim()) byType[key].amounts.push(r.amount.trim());
    });
    return byType;
  }

  function renderTypeSummary(containerId, entries) {
    var container = document.getElementById(containerId);
    container.innerHTML = "";
    if (!entries.length) {
      var empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "기록 없음";
      container.appendChild(empty);
      return;
    }
    var byType = summarizeTypes(entries);
    var types = Object.keys(byType).sort(function (a, b) { return byType[b].count - byType[a].count; });
    types.forEach(function (type) {
      var info = byType[type];
      var row = document.createElement("div");
      row.className = "type-row";

      var name = document.createElement("div");
      name.className = "type-name";
      name.textContent = type;
      row.appendChild(name);

      var amounts = document.createElement("div");
      amounts.className = "type-amounts";
      amounts.textContent = mergeAmounts(info.amounts);
      row.appendChild(amounts);

      var count = document.createElement("div");
      count.className = "type-count";
      count.textContent = info.count + "회";
      row.appendChild(count);

      container.appendChild(row);
    });

    var total = document.createElement("div");
    total.className = "total-row";
    var hasSolo = entries.some(function (r) { return r.situation === "solo"; });
    total.innerHTML = "<span>총 " + entries.length + "회</span><span>" + (hasSolo ? "🚨 혼술 포함" : "") + "</span>";
    container.appendChild(total);
  }

  function renderWeekTypeSummary() {
    renderTypeSummary("weekTypeSummary", getWeekEntries(new Date()));
  }

  function renderMonthTypeSummary() {
    var y = calCursor.getFullYear(), m = calCursor.getMonth();
    var todayY = new Date().getFullYear(), todayM = new Date().getMonth();
    document.getElementById("monthTypeTitle").textContent =
      (y === todayY && m === todayM) ? "이번 달" : (y + "년 " + (m + 1) + "월");
    renderTypeSummary("monthTypeSummary", getMonthEntries(y, m));
  }

  // ---------- 렌더: 추이 (최근 8주, 오래된 주 -> 이번 주 순) ----------
  var TREND_WEEKS = 8;

  function renderTrend() {
    var container = document.getElementById("trendList");
    container.innerHTML = "";

    var today = new Date();
    var thisWeekStart = weekStart(today);
    var weeks = [];
    for (var i = TREND_WEEKS - 1; i >= 0; i--) {
      var ws = addDays(thisWeekStart, -7 * i);
      var we = addDays(ws, 6);
      var entries = getWeekEntries(ws);
      weeks.push({ ws: ws, we: we, entries: entries, isCurrent: i === 0 });
    }

    var maxCount = Math.max.apply(null, weeks.map(function (w) { return w.entries.length; }).concat([1]));

    weeks.forEach(function (w, idx) {
      var count = w.entries.length;
      var hasSolo = w.entries.some(function (r) { return r.situation === "solo"; });
      var amounts = [];
      w.entries.forEach(function (r) { if (r.amount && r.amount.trim()) amounts.push(r.amount); });
      var mergedAmount = mergeAmounts(amounts);

      var tone = hasSolo ? "over" : (count >= 2 ? "caution" : "ok");

      var row = document.createElement("div");
      row.className = "trend-row";

      var label = document.createElement("div");
      label.className = "trend-label";
      label.textContent = (idx + 1) + "주차" + (w.isCurrent ? "(이번주)" : "");
      row.appendChild(label);

      var barWrap = document.createElement("div");
      barWrap.className = "trend-bar-wrap";
      var bar = document.createElement("div");
      bar.className = "trend-bar " + tone;
      bar.style.width = Math.max(4, Math.round((count / maxCount) * 100)) + "%";
      if (count === 0) bar.style.width = "0%";
      barWrap.appendChild(bar);
      row.appendChild(barWrap);

      var info = document.createElement("div");
      info.className = "trend-info";
      info.innerHTML = "<b>" + count + "회</b> " + (hasSolo ? "<span class='solo-mark'>혼술</span> " : "") +
        (mergedAmount ? mergedAmount : "");
      row.appendChild(info);

      container.appendChild(row);
    });
  }

  // ---------- 달력 공용 (일요일 시작) ----------
  var DOW_KO = ["일", "월", "화", "수", "목", "금", "토"];
  function fillDowRow(dowEl) {
    if (dowEl.children.length) return;
    DOW_KO.forEach(function (d, i) {
      var el = document.createElement("div");
      el.className = "cal-dow" + (i === 0 ? " sun" : i === 6 ? " sat" : "");
      el.textContent = d;
      dowEl.appendChild(el);
    });
  }
  function dateLabel(dateStr) {
    var dt = parseDate(dateStr);
    return (dt.getMonth() + 1) + "/" + dt.getDate() + "(" + DOW_KO[dt.getDay()] + ")";
  }
  // 달력 위쪽 안내칸에 간단히 표시. lines: [[굵은글씨, 보조글씨], ...]
  function showCalInfo(id, dateStr, lines) {
    var box = document.getElementById(id);
    box.innerHTML = "";
    lines.forEach(function (ln, i) {
      var row = document.createElement("div");
      if (i === 0) {
        var ds = document.createElement("span");
        ds.className = "ci-date";
        ds.textContent = dateLabel(dateStr);
        row.appendChild(ds);
      }
      var main = document.createElement("span");
      main.textContent = ln[0];
      row.appendChild(main);
      if (ln[1]) {
        var sub = document.createElement("span");
        sub.className = "ci-sub";
        sub.textContent = " " + ln[1];
        row.appendChild(sub);
      }
      box.appendChild(row);
    });
    box.classList.add("show");
  }

  // ---------- 렌더: 달력 ----------
  var calCursor = new Date(); // 현재 보고 있는 달 (일자는 무시, 년/월만 사용)

  function renderCalendarHeader() {
    fillDowRow(document.getElementById("calDow"));
  }

  function renderCalendar() {
    var y = calCursor.getFullYear(), m = calCursor.getMonth();
    document.getElementById("calTitle").textContent = y + "년 " + (m + 1) + "월";

    // 날짜별 기록 맵
    var byDate = {};
    log.forEach(function (r) {
      (byDate[r.date] = byDate[r.date] || []).push(r);
    });

    var first = new Date(y, m, 1);
    var startOffset = first.getDay(); // 일요일 시작
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var todayS = todayStr();

    var grid = document.getElementById("calGrid");
    grid.innerHTML = "";

    for (var i = 0; i < startOffset; i++) {
      var pad = document.createElement("div");
      pad.className = "cal-day empty";
      grid.appendChild(pad);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var cell = document.createElement("div");
      cell.className = "cal-day";
      cell.dataset.date = dateStr;
      if (dateStr === todayS) cell.classList.add("today");
      if (dateStr === document.getElementById("fDate").value) cell.classList.add("picked");
      cell.addEventListener("click", function () {
        selectDateForAdd(this.dataset.date);
      });

      var entries = byDate[dateStr] || [];
      if (entries.length) {
        var hasSolo = entries.some(function (r) { return r.situation === "solo"; });
        if (hasSolo) cell.classList.add("has-solo");
        var rep = SIT_PRIORITY.find(function (s) { return entries.some(function (r) { return r.situation === s; }); });
        cell.style.background = SITUATIONS[rep].color + "33";
      }

      var num = document.createElement("div");
      num.textContent = d;
      cell.appendChild(num);

      if (entries.length) {
        var dots = document.createElement("div");
        dots.className = "dots";
        entries.slice(0, 4).forEach(function (r) {
          var dot = document.createElement("span");
          dot.className = "dot";
          dot.style.background = SITUATIONS[r.situation] ? SITUATIONS[r.situation].color : "#888";
          dots.appendChild(dot);
        });
        cell.appendChild(dots);
      }

      grid.appendChild(cell);
    }
  }

  function selectDateForAdd(dateStr) {
    // 달력에서 날짜를 누르면 기록추가 폼의 날짜칸에 바로 적용된다(관리자님 요청,
    // 2026-11-06 - "달력에서 선택해도 바로 적용되게 해줘").
    // 2026-11-12 변경: 아래 폼으로 스크롤하지 않고 달력 위에 그날 기록을 간단히 보여준다.
    document.getElementById("fDate").value = dateStr;
    renderCalendar();
    var entries = log.filter(function (r) { return r.date === dateStr; });
    var lines = entries.length
      ? entries.map(function (r) {
          return [(SITUATIONS[r.situation] ? SITUATIONS[r.situation].label : r.situation),
                  [r.drinkType, r.amount, r.memo].filter(Boolean).join(" · ")];
        })
      : [["기록 없음", "(아래 기록 추가 날짜로 지정됨)"]];
    showCalInfo("calInfo", dateStr, lines);
  }

  document.getElementById("prevMonth").addEventListener("click", function () {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() - 1, 1);
    renderCalendar();
    renderMonthTypeSummary();
  });
  document.getElementById("nextMonth").addEventListener("click", function () {
    calCursor = new Date(calCursor.getFullYear(), calCursor.getMonth() + 1, 1);
    renderCalendar();
    renderMonthTypeSummary();
  });

  // ---------- 렌더: 최근 기록 목록 ----------
  function renderLogList() {
    var container = document.getElementById("logList");
    container.innerHTML = "";
    if (!log.length) {
      var empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "아직 기록이 없습니다.";
      container.appendChild(empty);
      return;
    }
    var sorted = log.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    sorted.slice(0, 30).forEach(function (r) {
      var item = document.createElement("div");
      item.className = "log-item";

      var tag = document.createElement("div");
      tag.className = "tag";
      tag.style.background = SITUATIONS[r.situation] ? SITUATIONS[r.situation].color : "#888";
      item.appendChild(tag);

      var info = document.createElement("div");
      info.className = "info";
      var dateEl = document.createElement("div");
      dateEl.className = "date";
      dateEl.textContent = r.date + " · " + (SITUATIONS[r.situation] ? SITUATIONS[r.situation].label : r.situation);
      var detailParts = [r.drinkType, r.amount, r.memo].filter(Boolean);
      var detailEl = document.createElement("div");
      detailEl.className = "detail";
      detailEl.textContent = detailParts.join(" · ") || "-";
      info.appendChild(dateEl);
      info.appendChild(detailEl);
      item.appendChild(info);

      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        if (!confirm("이 기록을 삭제할까요?\n" + r.date + " · " + (SITUATIONS[r.situation] || {}).label)) return;
        log = log.filter(function (x) { return x.id !== r.id; });
        saveLog(log);
        renderAll();
        showToast("삭제했습니다");
      });
      item.appendChild(del);

      container.appendChild(item);
    });
  }

  // ---------- 기록 추가 폼 ----------
  document.getElementById("fDate").value = todayStr();

  var situationPick = document.getElementById("situationPick");
  situationPick.querySelectorAll("label").forEach(function (lbl) {
    lbl.addEventListener("click", function () {
      situationPick.querySelectorAll("label").forEach(function (l) { l.classList.remove("active"); });
      lbl.classList.add("active");
    });
  });

  // 주종 선택 - 막걸리/소주/맥주는 버튼 선택만으로 끝나고, "기타"를 고르면 지금처럼
  // 수기 입력칸(fType)이 나타난다(관리자님 요청, 2026-11-06 - "소주+맥주 폭탄주
  // 8잔" 같은 조합 메뉴는 기타로 직접 쓰면 됨).
  var typePick = document.getElementById("typePick");
  var fTypeInput = document.getElementById("fType");
  typePick.querySelectorAll("label").forEach(function (lbl) {
    lbl.addEventListener("click", function () {
      typePick.querySelectorAll("label").forEach(function (l) { l.classList.remove("active"); });
      lbl.classList.add("active");
      var isEtc = lbl.dataset.type === "기타";
      fTypeInput.style.display = isEtc ? "" : "none";
      if (isEtc) {
        fTypeInput.focus();
      } else {
        fTypeInput.value = "";
      }
    });
  });

  document.getElementById("addForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var date = document.getElementById("fDate").value || todayStr();
    var situation = situationPick.querySelector("input:checked").value;
    var pickedType = typePick.querySelector("input:checked").value;
    var drinkType = pickedType === "기타" ? fTypeInput.value.trim() : pickedType;
    var amount = document.getElementById("fAmount").value.trim();
    var memo = document.getElementById("fMemo").value.trim();

    log.push({
      id: uid(),
      date: date,
      situation: situation,
      drinkType: drinkType,
      amount: amount,
      memo: memo,
      createdAt: new Date().toISOString()
    });
    saveLog(log);

    fTypeInput.value = "";
    fTypeInput.style.display = "none";
    typePick.querySelectorAll("label").forEach(function (l) { l.classList.remove("active"); });
    typePick.querySelector('label[data-type="막걸리"]').classList.add("active");
    typePick.querySelector('input[value="막걸리"]').checked = true;
    document.getElementById("fAmount").value = "";
    document.getElementById("fMemo").value = "";

    renderAll();
    showToast("기록을 추가했습니다");
  });

  // ---------- 내보내기 / 가져오기 ----------
  document.getElementById("exportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(log, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "drinklog_" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("내보냈습니다");
  });

  document.getElementById("importBtn").addEventListener("click", function () {
    document.getElementById("importFile").click();
  });

  document.getElementById("importFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("JSON 배열이 아닙니다");
        var byId = {};
        log.forEach(function (r) { byId[r.id] = r; });
        imported.forEach(function (r) {
          if (!r.id) r.id = uid();
          byId[r.id] = r; // 같은 id면 가져온 쪽으로 덮어씀
        });
        log = Object.values(byId);
        saveLog(log);
        renderAll();
        showToast(imported.length + "건 가져왔습니다");
      } catch (err) {
        alert("가져오기 실패: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- 토스트 ----------
  var toastTimer = null;
  function showToast(msg) {
    var el = document.getElementById("toast");
    el.textContent = msg;
    el.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { el.classList.remove("show"); }, 1800);
  }

  // ---------- 전체 렌더 ----------
  function renderAll() {
    renderWeek();
    renderStreaks();
    renderCalendar();
    renderWeekTypeSummary();
    renderMonthTypeSummary();
    renderTrend();
    renderLogList();
  }

  // ========== 운동(푸쉬업 등) ==========
  var EX_LOG_KEY = "exerciseLog_v1";
  var EX_GOAL_KEY = "exerciseGoal_v1";
  var EX_DEFAULT_GOAL = 200;

  function loadExLog() {
    try {
      var raw = localStorage.getItem(EX_LOG_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn("운동 기록 불러오기 실패", e);
      return [];
    }
  }
  function saveExLog(l) {
    try {
      localStorage.setItem(EX_LOG_KEY, JSON.stringify(l));
    } catch (e) {
      alert("저장에 실패했습니다: " + e);
    }
  }
  function loadExGoal() {
    try {
      var raw = localStorage.getItem(EX_GOAL_KEY);
      var n = raw ? parseInt(raw, 10) : NaN;
      return (n && n > 0) ? n : EX_DEFAULT_GOAL;
    } catch (e) {
      return EX_DEFAULT_GOAL;
    }
  }
  function saveExGoal(n) {
    try { localStorage.setItem(EX_GOAL_KEY, String(n)); } catch (e) {}
  }

  // 목표 변경 이력: [{from:"YYYY-MM-DD", goal:N}] — 목표를 바꿔도 지난 날짜 판정은 그대로 유지
  var EX_GOAL_HIST_KEY = "exerciseGoalHist_v1";
  // 이 날짜부터 못 채운 개수가 다음 날로 이월된다 (그 이전 날짜는 이월 없음)
  var EX_CARRY_START = "2026-11-12";
  function loadGoalHist() {
    try {
      var arr = JSON.parse(localStorage.getItem(EX_GOAL_HIST_KEY) || "null");
      if (Array.isArray(arr) && arr.length) return arr;
    } catch (e) {}
    var init = [{ from: "0000-00-00", goal: loadExGoal() }];
    try { localStorage.setItem(EX_GOAL_HIST_KEY, JSON.stringify(init)); } catch (e) {}
    return init;
  }
  function setGoalFrom(dateStr, n) {
    var h = loadGoalHist().filter(function (x) { return x.from !== dateStr; });
    h.push({ from: dateStr, goal: n });
    h.sort(function (a, b) { return a.from < b.from ? -1 : 1; });
    try { localStorage.setItem(EX_GOAL_HIST_KEY, JSON.stringify(h)); } catch (e) {}
    saveExGoal(n);
  }
  function baseGoalOn(dateStr) {
    var h = loadGoalHist(), g = h[0].goal;
    h.forEach(function (x) { if (x.from <= dateStr) g = x.goal; });
    return g;
  }
  // 해당 날짜의 {base, carry, need}. need = 기본 목표 + 전날까지 못 채운 이월분
  var exNeedCache = {};
  function exNeed(dateStr) {
    if (exNeedCache[dateStr]) return exNeedCache[dateStr];
    return (exNeedCache[dateStr] = exNeedCalc(dateStr));
  }
  function exNeedCalc(dateStr) {
    var base = baseGoalOn(dateStr);
    if (dateStr <= EX_CARRY_START) return { base: base, carry: 0, need: base };
    // 전날 값으로 한 칸만 계산 (캐시 덕분에 날짜마다 한 번씩만 계산됨)
    var prev = fmtDate(addDays(parseDate(dateStr), -1));
    var carry = Math.max(exNeed(prev).need - exDayTotal(prev), 0);
    return { base: base, carry: carry, need: base + carry };
  }

  var exLog = loadExLog();

  function exDayTotal(dateStr) {
    return exLog.filter(function (r) { return r.date === dateStr; })
      .reduce(function (sum, r) { return sum + r.amount; }, 0);
  }
  function exAchieved(dateStr) {
    return exDayTotal(dateStr) >= exNeed(dateStr).need;
  }

  function renderExToday() {
    var today = todayStr();
    var nd = exNeed(today);
    var goal = nd.need;
    var total = exDayTotal(today);
    var remain = Math.max(goal - total, 0);
    var done = total >= goal;

    var countEl = document.getElementById("exRemainCount");
    countEl.textContent = done ? "0" : remain + "개";
    countEl.className = "count " + (done ? "ok" : "caution");

    document.getElementById("exGoalLine").textContent =
      (nd.carry > 0
        ? "목표 " + nd.base + " + 이월 " + nd.carry + " = " + goal + "개 중 " + total + "개 완료"
        : "목표 " + goal + "개 중 " + total + "개 완료");

    document.getElementById("exDoneBanner").classList.toggle("show", done);
    document.getElementById("exOverLine").textContent = total > goal ? "🔥 목표 초과 +" + (total - goal) + "개" : "";
    document.getElementById("exCurrentGoal").textContent = nd.base;
  }

  // 오늘 아직 달성 전이면 어제부터, 오늘 이미 달성했으면 오늘부터 거슬러 올라가며
  // 연속 달성일을 센다.
  function renderExStreak() {
    var d = new Date();
    if (!exAchieved(fmtDate(d))) d = addDays(d, -1);
    var count = 0;
    while (exAchieved(fmtDate(d))) {
      count++;
      d = addDays(d, -1);
    }
    document.getElementById("exStreak").textContent = count > 0 ? count + "일째" : "기록 없음";
  }

  var exCalCursor = new Date();

  function renderExCalendarHeader() {
    fillDowRow(document.getElementById("exCalDow"));
  }

  function renderExCalendar() {
    var y = exCalCursor.getFullYear(), m = exCalCursor.getMonth();
    document.getElementById("exCalTitle").textContent = y + "년 " + (m + 1) + "월";

    var first = new Date(y, m, 1);
    var startOffset = first.getDay(); // 일요일 시작
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var todayS = todayStr();

    var grid = document.getElementById("exCalGrid");
    grid.innerHTML = "";

    for (var i = 0; i < startOffset; i++) {
      var pad = document.createElement("div");
      pad.className = "cal-day empty";
      grid.appendChild(pad);
    }

    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var cell = document.createElement("div");
      cell.className = "cal-day";
      if (dateStr === todayS) cell.classList.add("today");

      cell.dataset.date = dateStr;
      if (dateStr === exPicked) cell.classList.add("picked");
      cell.addEventListener("click", function () { pickExDate(this.dataset.date); });

      var total = exDayTotal(dateStr);
      var goal = dateStr <= todayS ? exNeed(dateStr).need : baseGoalOn(dateStr);
      var done = total >= goal;
      if (done) cell.classList.add("ex-done");

      var num = document.createElement("div");
      num.textContent = d;
      cell.appendChild(num);

      if (done) {
        var lbl = document.createElement("div");
        lbl.className = "ex-done-label";
        lbl.textContent = "달성!!";
        cell.appendChild(lbl);
        if (total > goal) {
          var ov = document.createElement("div");
          ov.className = "ex-over";
          ov.textContent = "+" + (total - goal);
          cell.appendChild(ov);
        }
      } else if (total > 0) {
        var prog = document.createElement("div");
        prog.className = "ex-progress";
        prog.textContent = total + "/" + goal;
        cell.appendChild(prog);
      }

      grid.appendChild(cell);
    }
  }

  var exPicked = "";
  function pickExDate(dateStr) {
    exPicked = dateStr;
    renderExCalendar();
    var line;
    if (dateStr > todayStr()) {
      line = ["아직 안 온 날", "(목표 " + baseGoalOn(dateStr) + "개)"];
    } else {
      var nd = exNeed(dateStr), t = exDayTotal(dateStr);
      var cnt = exLog.filter(function (r) { return r.date === dateStr; }).length;
      var goalTxt = "목표 " + nd.need + (nd.carry > 0 ? " (이월 " + nd.carry + " 포함)" : "");
      var res = t >= nd.need ? (t > nd.need ? "✅ 달성 · 초과 +" + (t - nd.need) : "✅ 달성")
                             : "미달 " + (nd.need - t) + "개";
      line = [t + "개 / " + goalTxt, res + (cnt ? " · " + cnt + "번 입력" : "")];
    }
    showCalInfo("exCalInfo", dateStr, [line]);
  }

  document.getElementById("exPrevMonth").addEventListener("click", function () {
    exCalCursor = new Date(exCalCursor.getFullYear(), exCalCursor.getMonth() - 1, 1);
    renderExCalendar();
  });
  document.getElementById("exNextMonth").addEventListener("click", function () {
    exCalCursor = new Date(exCalCursor.getFullYear(), exCalCursor.getMonth() + 1, 1);
    renderExCalendar();
  });

  function renderExLogList() {
    var container = document.getElementById("exLogList");
    container.innerHTML = "";
    if (!exLog.length) {
      var empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "아직 기록이 없습니다.";
      container.appendChild(empty);
      return;
    }
    var sorted = exLog.slice().sort(function (a, b) {
      if (a.date !== b.date) return a.date < b.date ? 1 : -1;
      return a.createdAt < b.createdAt ? 1 : -1;
    });
    sorted.slice(0, 30).forEach(function (r) {
      var item = document.createElement("div");
      item.className = "log-item";

      var tag = document.createElement("div");
      tag.className = "tag";
      tag.style.background = "var(--ok)";
      item.appendChild(tag);

      var info = document.createElement("div");
      info.className = "info";
      var dateEl = document.createElement("div");
      dateEl.className = "date";
      dateEl.textContent = r.date + " · " + r.amount + "개";
      info.appendChild(dateEl);
      item.appendChild(info);

      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        if (!confirm("이 기록을 삭제할까요?\n" + r.date + " · " + r.amount + "개")) return;
        exLog = exLog.filter(function (x) { return x.id !== r.id; });
        saveExLog(exLog);
        renderExAll();
        showToast("삭제했습니다");
      });
      item.appendChild(del);

      container.appendChild(item);
    });
  }

  document.getElementById("exAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var amountInput = document.getElementById("exAmount");
    var amount = parseInt(amountInput.value, 10);
    if (!amount || amount <= 0) return;

    var wasAchieved = exAchieved(todayStr());

    exLog.push({
      id: uid(),
      date: todayStr(),
      amount: amount,
      createdAt: new Date().toISOString()
    });
    saveExLog(exLog);

    amountInput.value = "";
    renderExAll();

    showToast((!wasAchieved && exAchieved(todayStr())) ? "🎉 오늘 목표 달성!!" : (amount + "개 추가했습니다"));
  });

  document.getElementById("exGoalSaveBtn").addEventListener("click", function () {
    var input = document.getElementById("exGoalInput");
    var n = parseInt(input.value, 10);
    if (!n || n <= 0) {
      alert("1 이상의 숫자를 입력해주세요.");
      return;
    }
    setGoalFrom(todayStr(), n);
    input.value = "";
    renderExAll();
    showToast("목표를 " + n + "개로 설정했습니다");
  });

  document.getElementById("exExportBtn").addEventListener("click", function () {
    var data = { goal: loadExGoal(), goalHist: loadGoalHist(), log: exLog };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "exerciselog_" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("내보냈습니다");
  });

  document.getElementById("exImportBtn").addEventListener("click", function () {
    document.getElementById("exImportFile").click();
  });

  document.getElementById("exImportFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        var importedLog = Array.isArray(imported) ? imported : (imported.log || []);
        var byId = {};
        exLog.forEach(function (r) { byId[r.id] = r; });
        importedLog.forEach(function (r) {
          if (!r.id) r.id = uid();
          byId[r.id] = r;
        });
        exLog = Object.values(byId);
        saveExLog(exLog);
        if (imported && imported.goalHist) { try { localStorage.setItem(EX_GOAL_HIST_KEY, JSON.stringify(imported.goalHist)); } catch (e2) {} }
        if (imported && imported.goal) saveExGoal(imported.goal);
        renderExAll();
        showToast(importedLog.length + "건 가져왔습니다");
      } catch (err) {
        alert("가져오기 실패: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- 통계 (일별/주별/월별 막대그래프) ----------
  var exStatMode = "day";
  var exStatAnchor = new Date();

  function startOfWeek(d) { // 일요일 시작 (달력과 동일)
    var x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
    return addDays(x, -x.getDay());
  }
  // 기간 집계: 합계, 목표합(기본 목표 기준), 초과합, 달성일, 경과일, 최고 기록
  function exAgg(from, to) {
    var todayS = todayStr(), r = { total: 0, goal: 0, over: 0, doneDays: 0, days: 0, best: 0 };
    var first = exLog.reduce(function (m, x) { return (!m || x.date < m) ? x.date : m; }, "");
    for (var d = new Date(from); d <= to; d = addDays(d, 1)) {
      var ds = fmtDate(d);
      if (ds > todayS) break;
      if (!first || ds < first) continue; // 운동 시작 전 날짜는 통계에서 제외
      var t = exDayTotal(ds), nd = exNeed(ds);
      r.total += t; r.goal += nd.base; r.days++;
      if (t > r.best) r.best = t;
      if (t >= nd.need) { r.doneDays++; r.over += t - nd.need; }
    }
    return r;
  }
  function exStatBuckets() {
    var a = exStatAnchor, b = [], todayS = todayStr();
    if (exStatMode === "day") {
      var y = a.getFullYear(), m = a.getMonth(), n = new Date(y, m + 1, 0).getDate();
      for (var i = 1; i <= n; i++) {
        var d = new Date(y, m, i), ds = fmtDate(d);
        b.push({ from: d, to: d, label: (i === 1 || i % 5 === 0) ? String(i) : "", name: (m + 1) + "/" + i,
                 goalOverride: ds <= todayS ? exNeed(ds).need : null });
      }
      return { title: y + "년 " + (m + 1) + "월", buckets: b, from: new Date(y, m, 1), to: new Date(y, m, n) };
    }
    if (exStatMode === "week") {
      var last = startOfWeek(a), start = addDays(last, -7 * 11), end = addDays(last, 6);
      for (var k = 0; k < 12; k++) {
        var f = addDays(start, 7 * k), t = addDays(f, 6);
        b.push({ from: f, to: t, label: (k % 2 === 0) ? (f.getMonth() + 1) + "/" + f.getDate() : "",
                 name: (f.getMonth() + 1) + "/" + f.getDate() + "~" + (t.getMonth() + 1) + "/" + t.getDate() });
      }
      return { title: (start.getMonth() + 1) + "/" + start.getDate() + " ~ " + (end.getMonth() + 1) + "/" + end.getDate() + " (12주)",
               buckets: b, from: start, to: end };
    }
    var yy = a.getFullYear();
    for (var mm = 0; mm < 12; mm++) {
      b.push({ from: new Date(yy, mm, 1), to: new Date(yy, mm + 1, 0), label: String(mm + 1), name: yy + "년 " + (mm + 1) + "월" });
    }
    return { title: yy + "년", buckets: b, from: new Date(yy, 0, 1), to: new Date(yy, 11, 31) };
  }

  function renderExStats() {
    var info = exStatBuckets();
    document.getElementById("exStatTitle").textContent = info.title;
    var rows = info.buckets.map(function (bk) {
      var g = exAgg(bk.from, bk.to);
      return { bk: bk, agg: g, goal: bk.goalOverride != null ? bk.goalOverride : g.goal };
    });
    var max = 1;
    rows.forEach(function (r) { max = Math.max(max, r.agg.total, r.goal); });

    var NS = "http://www.w3.org/2000/svg", W = 320, H = 170, top = 14, bottom = 18, ch = H - top - bottom;
    var n = rows.length, slot = W / n, bw = Math.max(slot * 0.66, 2);
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + W + " " + H);
    svg.style.width = "100%"; svg.style.height = "190px"; svg.style.display = "block";
    function el(tag, attrs) {
      var e = document.createElementNS(NS, tag);
      for (var k in attrs) e.setAttribute(k, attrs[k]);
      svg.appendChild(e); return e;
    }
    function y(v) { return top + ch - (v / max) * ch; }
    el("line", { x1: 0, x2: W, y1: top + ch, y2: top + ch, stroke: "#3a414d", "stroke-width": 1 });
    el("text", { x: 2, y: 10, fill: "#8b93a1", "font-size": 9 }).textContent = max.toLocaleString();
    var detail = document.getElementById("exChartDetail");
    detail.textContent = "막대를 누르면 상세가 보여요";

    rows.forEach(function (r, i) {
      var x = i * slot + (slot - bw) / 2, t = r.agg.total;
      var reach = r.goal > 0 && t >= r.goal;
      var base = reach ? r.goal : t;
      if (t > 0) {
        el("rect", { x: x, y: y(base), width: bw, height: Math.max(top + ch - y(base), 0.5),
                     fill: reach ? "#3fb950" : "#d9822b" });
        if (reach && t > r.goal) {
          el("rect", { x: x, y: y(t), width: bw, height: y(r.goal) - y(t), fill: "#f0b429" });
        }
      }
      if (r.goal > 0) {
        el("line", { x1: x - 1, x2: x + bw + 1, y1: y(r.goal), y2: y(r.goal), stroke: "#e6edf3", "stroke-width": 1.2, opacity: 0.75 });
      }
      if (r.bk.label) {
        el("text", { x: i * slot + slot / 2, y: H - 5, fill: "#8b93a1", "font-size": 9, "text-anchor": "middle" }).textContent = r.bk.label;
      }
      var hit = el("rect", { x: i * slot, y: 0, width: slot, height: H, fill: "transparent" });
      hit.style.cursor = "pointer";
      hit.addEventListener("click", function () {
        if (!r.agg.days) { detail.textContent = r.bk.name + " · 아직 안 온 날"; return; }
        var s = r.bk.name + " · " + t.toLocaleString() + "개 / 목표 " + r.goal.toLocaleString();
        if (exStatMode !== "day") s += " · 달성 " + r.agg.doneDays + "/" + r.agg.days + "일";
        if (r.agg.over > 0) s += " · 초과 +" + r.agg.over;
        else if (exStatMode === "day" && t < r.goal) s += " · 미달 " + (r.goal - t);
        detail.textContent = s;
      });
    });
    var box = document.getElementById("exChart");
    box.innerHTML = ""; box.appendChild(svg);

    var all = exAgg(info.from, info.to);
    var tiles = [
      ["합계", all.total.toLocaleString() + "개", ""],
      ["하루 평균", all.days ? Math.round(all.total / all.days) + "개" : "-", ""],
      ["달성률", all.days ? Math.round(all.doneDays / all.days * 100) + "%" : "-", ""],
      ["달성일", all.doneDays + "/" + all.days + "일", ""],
      ["초과 합계", "+" + all.over.toLocaleString(), "over"],
      ["최고 기록(하루)", all.best + "개", ""]
    ];
    var grid = document.getElementById("exStatGrid");
    grid.innerHTML = "";
    tiles.forEach(function (tl) {
      var d = document.createElement("div"); d.className = "stat-tile";
      var v = document.createElement("div"); v.className = "v " + tl[2]; v.textContent = tl[1];
      var k = document.createElement("div"); k.className = "k"; k.textContent = tl[0];
      d.appendChild(v); d.appendChild(k); grid.appendChild(d);
    });
  }

  Array.prototype.forEach.call(document.querySelectorAll("#exStatSeg button"), function (btn) {
    btn.addEventListener("click", function () {
      exStatMode = btn.getAttribute("data-mode");
      exStatAnchor = new Date();
      Array.prototype.forEach.call(document.querySelectorAll("#exStatSeg button"), function (b) {
        b.classList.toggle("active", b === btn);
      });
      renderExStats();
    });
  });
  function shiftExStat(dir) {
    var a = exStatAnchor;
    if (exStatMode === "day") exStatAnchor = new Date(a.getFullYear(), a.getMonth() + dir, 1);
    else if (exStatMode === "week") exStatAnchor = addDays(a, 7 * 12 * dir);
    else exStatAnchor = new Date(a.getFullYear() + dir, 0, 1);
    renderExStats();
  }
  document.getElementById("exStatPrev").addEventListener("click", function () { shiftExStat(-1); });
  document.getElementById("exStatNext").addEventListener("click", function () { shiftExStat(1); });

  function renderExAll() {
    exNeedCache = {};
    renderExToday();
    renderExStreak();
    renderExCalendar();
    renderExStats();
    renderExLogList();
  }


  // ========== 체중 / 체지방률 ==========
  var WT_LOG_KEY = "weightLog_v1";

  function loadWtLog() {
    try {
      var raw = localStorage.getItem(WT_LOG_KEY);
      if (!raw) return [];
      var arr = JSON.parse(raw);
      return Array.isArray(arr) ? arr : [];
    } catch (e) {
      console.warn("체중 기록 불러오기 실패", e);
      return [];
    }
  }
  function saveWtLog(l) {
    try {
      localStorage.setItem(WT_LOG_KEY, JSON.stringify(l));
    } catch (e) {
      alert("저장에 실패했습니다: " + e);
    }
  }

  var wtLog = loadWtLog();

  // 같은 날짜에 체중만 혹은 체지방률만 따로 입력해도, 입력한 값만 그 날짜
  // 기록에 덮어써서 합쳐준다(둘 다 한 번에 입력 안 해도 되게).
  function wtUpsert(date, weight, fat) {
    var existing = wtLog.find(function (r) { return r.date === date; });
    if (existing) {
      if (weight !== null) existing.weight = weight;
      if (fat !== null) existing.fat = fat;
      existing.createdAt = new Date().toISOString();
    } else {
      wtLog.push({
        id: uid(),
        date: date,
        weight: weight,
        fat: fat,
        createdAt: new Date().toISOString()
      });
    }
    saveWtLog(wtLog);
  }

  function wtSortedByField(field) {
    return wtLog.filter(function (r) { return r[field] !== null && r[field] !== undefined; })
      .slice()
      .sort(function (a, b) { return a.date < b.date ? 1 : -1; });
  }

  function renderWtLatest() {
    var wSorted = wtSortedByField("weight");
    var weightEl = document.getElementById("wtLatestWeight");
    var weightDateEl = document.getElementById("wtLatestWeightDate");
    if (wSorted.length) {
      var cur = wSorted[0].weight;
      var delta = "";
      if (wSorted.length > 1) {
        var diff = cur - wSorted[1].weight;
        delta = " (" + (diff > 0 ? "+" : "") + diff.toFixed(1) + ")";
      }
      weightEl.textContent = cur.toFixed(1) + "kg" + delta;
      weightDateEl.textContent = "· " + wSorted[0].date;
    } else {
      weightEl.textContent = "-";
      weightDateEl.textContent = "";
    }

    var fSorted = wtSortedByField("fat");
    var fatEl = document.getElementById("wtLatestFat");
    var fatDateEl = document.getElementById("wtLatestFatDate");
    if (fSorted.length) {
      var curF = fSorted[0].fat;
      var deltaF = "";
      if (fSorted.length > 1) {
        var diffF = curF - fSorted[1].fat;
        deltaF = " (" + (diffF > 0 ? "+" : "") + diffF.toFixed(1) + ")";
      }
      fatEl.textContent = curF.toFixed(1) + "%" + deltaF;
      fatDateEl.textContent = "· " + fSorted[0].date;
    } else {
      fatEl.textContent = "-";
      fatDateEl.textContent = "";
    }
  }

  // 외부 차트 라이브러리 없이 가벼운 인라인 SVG 선그래프로 그린다(오프라인 PWA라
  // 서비스워커 캐시 대상에 CDN 의존성을 추가하지 않으려는 의도).
  function renderTrendChart(chartContainerId, minMaxContainerId, field, colorVar) {
    var points = wtLog.filter(function (r) { return r[field] !== null && r[field] !== undefined; })
      .slice()
      .sort(function (a, b) { return a.date < b.date ? -1 : 1; })
      .map(function (r) { return { date: r.date, value: r[field] }; });

    var chartEl = document.getElementById(chartContainerId);
    var minMaxEl = document.getElementById(minMaxContainerId);
    chartEl.innerHTML = "";

    if (points.length < 2) {
      minMaxEl.textContent = points.length === 1
        ? "기록 1개 (" + points[0].date + " · " + points[0].value.toFixed(1) + ")"
        : "기록이 2개 이상 쌓이면 그래프가 보여요.";
      return;
    }

    var w = 300, h = 110, padX = 10, padY = 16;
    var values = points.map(function (p) { return p.value; });
    var min = Math.min.apply(null, values);
    var max = Math.max.apply(null, values);
    if (min === max) { min -= 1; max += 1; }
    var stepX = (w - padX * 2) / (points.length - 1);
    var xy = points.map(function (p, i) {
      return {
        x: padX + i * stepX,
        y: padY + (1 - (p.value - min) / (max - min)) * (h - padY * 2),
        p: p
      };
    });

    var NS = "http://www.w3.org/2000/svg";
    var svg = document.createElementNS(NS, "svg");
    svg.setAttribute("viewBox", "0 0 " + w + " " + h);
    svg.setAttribute("preserveAspectRatio", "none");
    svg.style.width = "100%";
    svg.style.height = "100px";

    var polyline = document.createElementNS(NS, "polyline");
    polyline.setAttribute("points", xy.map(function (c) { return c.x.toFixed(1) + "," + c.y.toFixed(1); }).join(" "));
    polyline.setAttribute("fill", "none");
    polyline.setAttribute("stroke", colorVar);
    polyline.setAttribute("stroke-width", "2");
    polyline.setAttribute("stroke-linecap", "round");
    polyline.setAttribute("stroke-linejoin", "round");
    polyline.setAttribute("vector-effect", "non-scaling-stroke");
    svg.appendChild(polyline);

    xy.forEach(function (c, i) {
      var isEndpoint = (i === 0 || i === xy.length - 1);
      var circle = document.createElementNS(NS, "circle");
      circle.setAttribute("cx", c.x.toFixed(1));
      circle.setAttribute("cy", c.y.toFixed(1));
      circle.setAttribute("r", isEndpoint ? "4" : "2.5");
      circle.setAttribute("fill", colorVar);
      var title = document.createElementNS(NS, "title");
      title.textContent = c.p.date + " · " + c.p.value.toFixed(1);
      circle.appendChild(title);
      svg.appendChild(circle);

      if (isEndpoint) {
        var text = document.createElementNS(NS, "text");
        text.setAttribute("x", c.x.toFixed(1));
        text.setAttribute("y", (c.y - 8).toFixed(1));
        text.setAttribute("text-anchor", i === 0 ? "start" : "end");
        text.setAttribute("font-size", "9");
        text.setAttribute("fill", "var(--muted)");
        text.textContent = c.p.value.toFixed(1);
        svg.appendChild(text);
      }
    });

    chartEl.appendChild(svg);
    minMaxEl.textContent = "최저 " + min.toFixed(1) + " · 최고 " + max.toFixed(1) + " · 최근 " + values[values.length - 1].toFixed(1);
  }

  function renderWtLogList() {
    var container = document.getElementById("wtLogList");
    container.innerHTML = "";
    if (!wtLog.length) {
      var empty = document.createElement("div");
      empty.className = "empty-note";
      empty.textContent = "아직 기록이 없습니다.";
      container.appendChild(empty);
      return;
    }
    var sorted = wtLog.slice().sort(function (a, b) { return a.date < b.date ? 1 : -1; });
    sorted.slice(0, 30).forEach(function (r) {
      var item = document.createElement("div");
      item.className = "log-item";

      var tag = document.createElement("div");
      tag.className = "tag";
      tag.style.background = "var(--appointment)";
      item.appendChild(tag);

      var info = document.createElement("div");
      info.className = "info";
      var dateEl = document.createElement("div");
      dateEl.className = "date";
      var parts = [];
      if (r.weight !== null && r.weight !== undefined) parts.push(r.weight.toFixed(1) + "kg");
      if (r.fat !== null && r.fat !== undefined) parts.push(r.fat.toFixed(1) + "%");
      dateEl.textContent = r.date + " · " + (parts.join(" / ") || "-");
      info.appendChild(dateEl);
      item.appendChild(info);

      var del = document.createElement("button");
      del.className = "del";
      del.textContent = "✕";
      del.addEventListener("click", function () {
        if (!confirm("이 기록을 삭제할까요?\n" + r.date)) return;
        wtLog = wtLog.filter(function (x) { return x.id !== r.id; });
        saveWtLog(wtLog);
        renderWtAll();
        showToast("삭제했습니다");
      });
      item.appendChild(del);

      container.appendChild(item);
    });
  }

  document.getElementById("wtDate").value = todayStr();

  document.getElementById("wtAddForm").addEventListener("submit", function (e) {
    e.preventDefault();
    var date = document.getElementById("wtDate").value || todayStr();
    var weightInput = document.getElementById("wtWeight");
    var fatInput = document.getElementById("wtFat");
    var weight = weightInput.value.trim() === "" ? null : parseFloat(weightInput.value);
    var fat = fatInput.value.trim() === "" ? null : parseFloat(fatInput.value);

    if (weight === null && fat === null) {
      alert("체중 또는 체지방률 중 하나는 입력해주세요.");
      return;
    }

    wtUpsert(date, weight, fat);

    weightInput.value = "";
    fatInput.value = "";
    renderWtAll();
    showToast("기록을 추가했습니다");
  });

  document.getElementById("wtExportBtn").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify(wtLog, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "weightlog_" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    showToast("내보냈습니다");
  });

  document.getElementById("wtImportBtn").addEventListener("click", function () {
    document.getElementById("wtImportFile").click();
  });

  document.getElementById("wtImportFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(reader.result);
        if (!Array.isArray(imported)) throw new Error("JSON 배열이 아닙니다");
        var byId = {};
        wtLog.forEach(function (r) { byId[r.id] = r; });
        imported.forEach(function (r) {
          if (!r.id) r.id = uid();
          byId[r.id] = r;
        });
        wtLog = Object.values(byId);
        saveWtLog(wtLog);
        renderWtAll();
        showToast(imported.length + "건 가져왔습니다");
      } catch (err) {
        alert("가져오기 실패: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  // ---------- 체중 달력 ----------
  var wtCalCursor = new Date();
  var wtPicked = "";
  function renderWtCalendar() {
    fillDowRow(document.getElementById("wtCalDow"));
    var y = wtCalCursor.getFullYear(), m = wtCalCursor.getMonth();
    document.getElementById("wtCalTitle").textContent = y + "년 " + (m + 1) + "월";
    var byDate = {};
    wtLog.forEach(function (r) { byDate[r.date] = r; });
    var startOffset = new Date(y, m, 1).getDay();
    var daysInMonth = new Date(y, m + 1, 0).getDate();
    var todayS = todayStr();
    var grid = document.getElementById("wtCalGrid");
    grid.innerHTML = "";
    for (var i = 0; i < startOffset; i++) {
      var pad = document.createElement("div");
      pad.className = "cal-day empty";
      grid.appendChild(pad);
    }
    for (var d = 1; d <= daysInMonth; d++) {
      var dateStr = y + "-" + String(m + 1).padStart(2, "0") + "-" + String(d).padStart(2, "0");
      var cell = document.createElement("div");
      cell.className = "cal-day";
      cell.dataset.date = dateStr;
      if (dateStr === todayS) cell.classList.add("today");
      if (dateStr === wtPicked) cell.classList.add("picked");
      var num = document.createElement("div");
      num.textContent = d;
      cell.appendChild(num);
      var r = byDate[dateStr];
      if (r && r.weight != null) {
        cell.classList.add("has-wt");
        var v = document.createElement("div");
        v.className = "wt-val";
        v.textContent = r.weight.toFixed(1);
        cell.appendChild(v);
      }
      cell.addEventListener("click", function () { pickWtDate(this.dataset.date); });
      grid.appendChild(cell);
    }
  }
  function pickWtDate(dateStr) {
    wtPicked = dateStr;
    document.getElementById("wtDate").value = dateStr;
    renderWtCalendar();
    var r = wtLog.find(function (x) { return x.date === dateStr; });
    var line;
    if (r) {
      var parts = [];
      if (r.weight != null) parts.push(r.weight.toFixed(1) + "kg");
      if (r.fat != null) parts.push("체지방 " + r.fat.toFixed(1) + "%");
      // 직전 기록 대비 체중 변화
      var prev = wtSortedByField("weight").filter(function (x) { return x.date < dateStr; })[0];
      var diff = (prev && r.weight != null) ? (r.weight - prev.weight) : null;
      line = [parts.join(" · ") || "-",
              diff != null ? "(직전 " + prev.date.slice(5).replace("-", "/") + " 대비 " + (diff > 0 ? "+" : "") + diff.toFixed(1) + "kg)" : ""];
    } else {
      line = ["기록 없음", "(위 입력 날짜로 지정됨)"];
    }
    showCalInfo("wtCalInfo", dateStr, [line]);
  }
  document.getElementById("wtPrevMonth").addEventListener("click", function () {
    wtCalCursor = new Date(wtCalCursor.getFullYear(), wtCalCursor.getMonth() - 1, 1);
    renderWtCalendar();
  });
  document.getElementById("wtNextMonth").addEventListener("click", function () {
    wtCalCursor = new Date(wtCalCursor.getFullYear(), wtCalCursor.getMonth() + 1, 1);
    renderWtCalendar();
  });

  function renderWtAll() {
    renderWtLatest();
    renderWtCalendar();
    renderTrendChart("wtWeightChart", "wtWeightMinMax", "weight", "var(--appointment)");
    renderTrendChart("wtFatChart", "wtFatMinMax", "fat", "var(--lunch)");
    renderWtLogList();
  }

  // ========== 전체 백업 (세 탭을 한 파일로) ==========
  var LAST_BACKUP_KEY = "lastFullBackupAt_v1";
  var BACKUP_REMIND_DAYS = 7;

  function mergeById(current, imported) {
    var byId = {};
    current.forEach(function (r) { byId[r.id] = r; });
    imported.forEach(function (r) {
      if (!r.id) r.id = uid();
      byId[r.id] = r; // 같은 id면 가져온 쪽으로 덮어씀
    });
    return Object.values(byId);
  }

  function loadLastBackup() {
    try { return localStorage.getItem(LAST_BACKUP_KEY) || null; } catch (e) { return null; }
  }

  // 마지막 전체 백업 후 7일이 지났으면 상단 배너를 띄운다
  function renderBackupStatus() {
    var last = loadLastBackup();
    var banner = document.getElementById("backupBanner");
    var bannerText = document.getElementById("backupBannerText");
    var lastEl = document.getElementById("backupLast");
    if (!last) {
      bannerText.textContent = "아직 전체 백업을 한 적이 없어요";
      lastEl.textContent = "마지막 전체 백업: 없음";
      banner.classList.add("show");
      return;
    }
    var days = Math.floor((Date.now() - new Date(last).getTime()) / 86400000);
    lastEl.textContent = "마지막 전체 백업: " + last.slice(0, 10) + (days > 0 ? " (" + days + "일 전)" : " (오늘)");
    bannerText.textContent = "마지막 백업 " + days + "일 전";
    banner.classList.toggle("show", days >= BACKUP_REMIND_DAYS);
  }

  function exportAll() {
    var data = {
      app: "selfcare",
      version: 1,
      exportedAt: new Date().toISOString(),
      drink: log,
      exercise: { goal: loadExGoal(), goalHist: loadGoalHist(), log: exLog },
      weight: wtLog
    };
    var blob = new Blob([JSON.stringify(data, null, 2)], { type: "application/json" });
    var url = URL.createObjectURL(blob);
    var a = document.createElement("a");
    a.href = url;
    a.download = "selfcare_backup_" + todayStr() + ".json";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
    try { localStorage.setItem(LAST_BACKUP_KEY, data.exportedAt); } catch (e) {}
    renderBackupStatus();
    showToast("전체 백업 파일을 저장했습니다");
  }

  document.getElementById("allExportBtn").addEventListener("click", exportAll);
  document.getElementById("backupBannerBtn").addEventListener("click", exportAll);

  document.getElementById("allImportBtn").addEventListener("click", function () {
    document.getElementById("allImportFile").click();
  });

  document.getElementById("allImportFile").addEventListener("change", function (e) {
    var file = e.target.files[0];
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var d = JSON.parse(reader.result);
        if (!d || d.app !== "selfcare") {
          throw new Error("전체 백업 파일이 아닙니다 (탭별 백업 파일은 각 탭의 가져오기를 쓰세요)");
        }
        log = mergeById(log, d.drink || []);
        saveLog(log);
        if (d.exercise) {
          exLog = mergeById(exLog, d.exercise.log || []);
          saveExLog(exLog);
          if (d.exercise.goalHist) { try { localStorage.setItem(EX_GOAL_HIST_KEY, JSON.stringify(d.exercise.goalHist)); } catch (e2) {} }
          if (d.exercise.goal) saveExGoal(d.exercise.goal);
        }
        wtLog = mergeById(wtLog, d.weight || []);
        saveWtLog(wtLog);
        renderAll();
        renderExAll();
        renderWtAll();
        showToast("전체 백업을 가져왔습니다");
      } catch (err) {
        alert("가져오기 실패: " + err.message);
      }
      e.target.value = "";
    };
    reader.readAsText(file);
  });

  renderBackupStatus();

  // ---------- 탭 전환 ----------
  var tabButtons = document.querySelectorAll(".tab-btn");
  var tabPanels = document.querySelectorAll(".tab-panel");
  var VALID_TABS = ["drink", "exercise", "weight"];
  function switchTab(tab) {
    tabButtons.forEach(function (b) { b.classList.toggle("active", b.dataset.tab === tab); });
    tabPanels.forEach(function (p) { p.classList.toggle("active", p.id === "tab-" + tab); });
    try { localStorage.setItem("activeTab_v1", tab); } catch (e) {}
  }
  tabButtons.forEach(function (b) {
    b.addEventListener("click", function () { switchTab(b.dataset.tab); });
  });

  renderCalendarHeader();
  renderAll();
  renderExCalendarHeader();
  renderExAll();
  renderWtAll();

  var savedTab = "drink";
  try {
    var st = localStorage.getItem("activeTab_v1");
    if (VALID_TABS.indexOf(st) !== -1) savedTab = st;
  } catch (e) {}
  switchTab(savedTab);

  // ---------- 서비스워커 등록 (오프라인/설치용) ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (e) {
        console.warn("서비스워커 등록 실패", e);
      });
    });
  }
})();
