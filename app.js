(function () {
  "use strict";

  var STORAGE_KEY = "drinkLog_v1";
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

    var lastSolo = lastDateOf(function (r) { return r.situation === "solo"; });
    var lastAny = lastDateOf(function () { return true; });

    var soloEl = document.getElementById("soloStreak");
    if (lastSolo) {
      var n1 = daysBetween(parseDate(lastSolo), parseDate(todayS));
      soloEl.textContent = n1 + "일째";
    } else {
      soloEl.textContent = "기록 없음";
    }

    var anyEl = document.getElementById("anyStreak");
    if (lastAny) {
      var n2 = daysBetween(parseDate(lastAny), parseDate(todayS));
      anyEl.textContent = n2 + "일째";
    } else {
      anyEl.textContent = "기록 없음";
    }
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

  // ---------- 렌더: 달력 ----------
  var calCursor = new Date(); // 현재 보고 있는 달 (일자는 무시, 년/월만 사용)

  function renderCalendarHeader() {
    var dowEl = document.getElementById("calDow");
    if (dowEl.children.length === 0) {
      ["월", "화", "수", "목", "금", "토", "일"].forEach(function (d) {
        var el = document.createElement("div");
        el.className = "cal-dow";
        el.textContent = d;
        dowEl.appendChild(el);
      });
    }
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
    var startOffset = (first.getDay() === 0) ? 6 : first.getDay() - 1; // 월요일 시작
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
    document.getElementById("fDate").value = dateStr;
    renderCalendar();
    document.getElementById("addForm").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(dateStr + " 선택됨");
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

  renderCalendarHeader();
  renderAll();

  // ---------- 서비스워커 등록 (오프라인/설치용) ----------
  if ("serviceWorker" in navigator) {
    window.addEventListener("load", function () {
      navigator.serviceWorker.register("service-worker.js").catch(function (e) {
        console.warn("서비스워커 등록 실패", e);
      });
    });
  }
})();
