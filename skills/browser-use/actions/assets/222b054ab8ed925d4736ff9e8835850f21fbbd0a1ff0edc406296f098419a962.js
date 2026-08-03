async ({ inputs }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const dayNameToIndex = {
    mon: 0, monday: 0,
    tue: 1, tuesday: 1,
    wed: 2, wednesday: 2,
    thu: 3, thursday: 3,
    fri: 4, friday: 4,
    sat: 5, saturday: 5,
    sun: 6, sunday: 6,
  };
  const fail = (reason, extra = {}) => {
    throw new Error(JSON.stringify({ reason, ...extra }).slice(0, 2000));
  };
  const parseDate = (value) => {
    const text = String(value || "");
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    return null;
  };
  const addDays = (date, days) => {
    const copy = new Date(date.getTime());
    copy.setDate(copy.getDate() + days);
    return copy;
  };
  const dmy = (date) =>
    `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const weekStart = parseDate(inputs.week_start || inputs.period_start);
  if (!weekStart) fail("invalid_week_start", { week_start: inputs.week_start });
  const weekEnd = parseDate(inputs.week_end || inputs.period_end) || addDays(weekStart, 6);
  const targetStart = dmy(weekStart);
  const targetEnd = dmy(weekEnd);
  const defaultStart = String(inputs.start_time || inputs.startTime || "09:00");
  const defaultEnd = String(inputs.end_time || inputs.endTime || "17:00");
  const defaultAttendance = String(inputs.attendance_type || inputs.attendanceType || "Standard");
  const requestedRows = Array.isArray(inputs.rows) && inputs.rows.length > 0
    ? inputs.rows.map((row) => ({
        day: row.day,
        startTime: String(row.start_time || row.startTime || defaultStart),
        endTime: String(row.end_time || row.endTime || defaultEnd),
        attendanceType: String(row.attendance_type || row.attendanceType || defaultAttendance),
      }))
    : (Array.isArray(inputs.workDays) ? inputs.workDays : ["Mon", "Tue", "Wed", "Thu", "Fri"]).map((day) => ({
        day,
        startTime: defaultStart,
        endTime: defaultEnd,
        attendanceType: defaultAttendance,
      }));
  const toDayIndex = (entry) =>
    typeof entry === "number" ? entry : dayNameToIndex[String(entry).toLowerCase()] ?? -1;
  const editRows = () => Array.from(document.querySelectorAll("tr[ng-repeat]")).filter((row) =>
    row.querySelector("[ng-model='rxg.startDateTime']") ||
    row.querySelector("[ng-model='rxg.endDateTime']") ||
    row.querySelector("[ng-model='rxg.attendanceTypeId']")
  );
  const rowDate = (row) => {
    // The row's own per-day work-date model (rxg.workDate1) is authoritative and
    // is present whether the grid is empty or filled. Read it first: once the
    // grid is filled, rxg.startDateTime holds a time-of-day ("09:00") with no
    // date, so relying on it made every filled row's date unreadable.
    const workDateEl = row.querySelector("[ng-model='rxg.workDate1']") || row.querySelector("[ng-model*='workDate']") || row.querySelector("[ng-model*='itemDate']");
    if (workDateEl) {
      const wdRaw = normalize(workDateEl.value || workDateEl.getAttribute?.("value") || workDateEl.innerText || workDateEl.textContent || "");
      const wdMatch = wdRaw && wdRaw.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
      const wdParsed = wdMatch && parseDate(wdMatch[0]);
      if (wdParsed) return dmy(wdParsed);
    }
    const startInput = row.querySelector("[ng-model='rxg.startDateTime']");
    const raw = startInput && String(startInput.value || startInput.getAttribute("value") || "");
    const inputMatch = raw && raw.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    const inputParsed = inputMatch && parseDate(inputMatch[0]);
    if (inputParsed) return dmy(inputParsed);
    const dateCell = Array.from(row.querySelectorAll("td, [ng-bind*='date' i], .date, [class*='date' i]"))
      .map((el) => normalize(el.innerText || el.textContent || el.getAttribute?.("title") || ""))
      .find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text));
    if (dateCell) {
      const m = dateCell.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
      const parsed = m && parseDate(m[0]);
      if (parsed) return dmy(parsed);
    }
    return "";
  };
  const waitForTimeAttendance = async () => {
    for (let i = 0; i < 60; i += 1) {
      const hasTabs = tabs().some((tab) => /Available|Incomplete|Submitted/.test(normalize(tab.innerText || tab.textContent)));
      if (document.title.includes("Time - Search Timesheet") || hasTabs || editRows().length >= 5) return true;
      await sleep(250);
    }
    return false;
  };
  const navigateToTimeAttendance = async () => {
    const targetPath = "/VGltZUFuZEF0dGVuZGFuY2U00";
    const targetUrl = "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/VGltZUFuZEF0dGVuZGFuY2U00";
    if (document.title.includes("Time - Search Timesheet") || editRows().length >= 5) return true;
    if (location.href.includes("CandidateLogin") || document.querySelector("input[type='password']")) {
      fail("login_required", { title: document.title, url: location.href });
    }
    try {
      const angularRef = window.angular;
      const appElement = document.querySelector("[ng-app]") || document.body;
      const injector = angularRef?.element?.(appElement)?.injector?.();
      const locationService = injector?.get?.("$location");
      const rootScope = injector?.get?.("$rootScope");
      if (locationService && rootScope) {
        rootScope.$apply(() => locationService.path(targetPath));
        if (await waitForTimeAttendance()) return true;
      }
    } catch (_error) {
      // Fall through to same-origin hash navigation.
    }
    window.location.href = targetUrl;
    return waitForTimeAttendance();
  };
  const tabs = () => Array.from(document.querySelectorAll("ul.nav.nav-tabs.top-3 li a, .nav-tabs a"));
  const clickTab = async (keyword) => {
    const tab = tabs().find((candidate) => normalize(candidate.innerText || candidate.textContent).toLowerCase().includes(keyword.toLowerCase()));
    if (!tab) return false;
    tab.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    tab.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    tab.click();
    await sleep(1200);
    return true;
  };
  const rowInfo = (row) => {
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => normalize(cell.innerText || cell.textContent));
    const link = Array.from(row.querySelectorAll("a[href]")).find((candidate) => normalize(candidate.innerText || candidate.textContent) || candidate.href);
    return { row, cells, link };
  };
  // Only consider rows in the active/visible tab pane. AngularJS nav-tab sets
  // commonly keep every pane's rows mounted in the DOM and toggle visibility;
  // scraping the whole document could match a Submitted-pane copy of the
  // target week while another tab is active.
  const isVisible = (el) => {
    if (!el) return false;
    if (el.offsetParent !== null) return true; // laid out and not display:none
    const pane = el.closest(".tab-pane, [role='tabpanel']");
    if (pane) return pane.classList.contains("active") && !pane.hidden;
    return false;
  };
  const findTargetRow = () =>
    Array.from(document.querySelectorAll("table tbody tr"))
      .filter((row) => isVisible(row))
      .map(rowInfo)
      .find((info) =>
        info.cells.includes(targetStart) && info.cells.includes(targetEnd) && info.link
      );
  const waitForTargetRow = async () => {
    for (let i = 0; i < 32; i += 1) {
      const target = findTargetRow();
      if (target) return target;
      await sleep(250);
    }
    return null;
  };
  const waitForEditRows = async () => {
    for (let i = 0; i < 40; i += 1) {
      if (editRows().length >= 5) return true;
      await sleep(250);
    }
    return false;
  };
  if (editRows().length < 5) {
    if (!(await navigateToTimeAttendance())) {
      fail("wrong_week_open", { targetStart, targetEnd, title: document.title, url: location.href });
    }
    for (const tabName of ["Available", "Incomplete"]) {
      await clickTab(tabName);
      const target = await waitForTargetRow();
      if (!target) continue;
      target.link.click();
      if (!(await waitForEditRows())) fail("readback_unavailable", { targetStart, targetEnd });
      break;
    }
  }
  const rows = editRows();
  if (rows.length < 5) fail("wrong_week_open", { targetStart, targetEnd, title: document.title, url: location.href });
  // Fail closed: prove the open grid is the target week and anchor every
  // check to a row's own calendar date — never a positional weekday index.
  // This mirrors fill-week's placement contract; verifying rows[dayIndex]
  // could certify the wrong physical row on any non-Mon..Sun grid order.
  const targetWeekDates = new Set();
  for (let i = 0; i < 7; i += 1) targetWeekDates.add(dmy(addDays(weekStart, i)));
  const rowsByDate = new Map();
  for (const row of rows) {
    const d = rowDate(row);
    if (!d) {
      fail("row_dates_unreadable", { targetStart, targetEnd, row_count: rows.length });
    }
    if (rowsByDate.has(d)) {
      fail("duplicate_row_date", { date: d, row_count: rows.length });
    }
    rowsByDate.set(d, row);
  }
  const foreignDates = Array.from(rowsByDate.keys()).filter((date) => !targetWeekDates.has(date));
  if (foreignDates.length > 0 || !rowsByDate.has(targetStart)) {
    fail("wrong_week_open", {
      targetStart,
      targetEnd,
      foreign_dates: foreignDates.slice(0, 14),
      dates: Array.from(rowsByDate.keys()).slice(0, 14),
      title: document.title,
      url: location.href,
    });
  }
  const results = [];
  for (const requested of requestedRows) {
    const dayIndex = toDayIndex(requested.day);
    if (dayIndex < 0 || dayIndex > 6) fail("invalid_day", { day: requested.day, results });
    const expectedDate = dmy(addDays(weekStart, dayIndex));
    const row = rowsByDate.get(expectedDate);
    if (!row) {
      fail("row_date_mismatch", {
        day: requested.day,
        expectedDate,
        available_dates: Array.from(rowsByDate.keys()).slice(0, 14),
        results,
      });
    }
    const startInput = row.querySelector("[ng-model='rxg.startDateTime']") || row.querySelector("input:nth-child(2)");
    const endInput = row.querySelector("[ng-model='rxg.endDateTime']") || row.querySelector("input:nth-child(3)");
    const attendanceSelect = row.querySelector("[ng-model='rxg.attendanceTypeId']") || row.querySelector("select");
    const selectedText = attendanceSelect?.options?.[attendanceSelect.selectedIndex]?.text?.trim() || "";
    results.push({
      dayIndex,
      startMatches: startInput?.value === requested.startTime,
      endMatches: endInput?.value === requested.endTime,
      attendanceMatches: selectedText === requested.attendanceType,
      selectedText,
    });
  }
  if (!results.every((result) => result.startMatches && result.endMatches && result.attendanceMatches)) {
    fail("total_hours_mismatch", { targetStart, targetEnd, results });
  }
  return { ok: true, period_start: inputs.week_start, period_end: inputs.week_end, results };
}