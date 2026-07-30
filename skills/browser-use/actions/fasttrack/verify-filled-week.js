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
  const findTargetRow = () =>
    Array.from(document.querySelectorAll("table tbody tr")).map(rowInfo).find((info) =>
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
  const results = [];
  for (const requested of requestedRows) {
    const dayIndex = toDayIndex(requested.day);
    if (dayIndex < 0 || dayIndex > 6) fail("invalid_day", { day: requested.day, results });
    const row = rows[dayIndex];
    if (!row) fail("row_not_found", { dayIndex, row_count: rows.length, results });
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
