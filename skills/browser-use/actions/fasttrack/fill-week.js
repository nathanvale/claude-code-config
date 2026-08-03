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
    const { reason: detail, ...context } = extra;
    // Consumers JSON.parse the error message, so the payload must always be
    // valid JSON. Cap each embedded string value before serializing instead of
    // slicing the serialized string (which could cut mid-token). The final
    // length check is a never-hit backstop that drops context rather than emit
    // broken JSON.
    const cap = (value) =>
      typeof value === "string" && value.length > 256 ? `${value.slice(0, 256)}[truncated]` : value;
    const payload = { reason, ...(detail ? { detail: cap(detail) } : {}) };
    for (const [key, value] of Object.entries(context)) payload[key] = cap(value);
    let message = JSON.stringify(payload);
    if (message.length > 2000) {
      message = JSON.stringify({ reason, ...(detail ? { detail: cap(detail) } : {}), truncated: true });
    }
    throw new Error(message);
  };
  const parseDate = (value) => {
    const text = String(value || "");
    let match = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (match) {
      return new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
    }
    match = text.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
    if (match) {
      return new Date(Number(match[3]), Number(match[2]) - 1, Number(match[1]));
    }
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
    // Base64 of "TimeAndAttendance" (unpadded, matching the portal's own route
    // encoding, e.g. CandidatePortal -> Q2FuZGlkYXRlUG9ydGFs). A prior corrupted
    // literal appended "00", yielding an invalid route that the SPA silently
    // bounced back to the portal home.
    const targetPath = "/VGltZUFuZEF0dGVuZGFuY2U";
    const targetUrl = "https://manpowergroup.fasttrack360.com.au/RecruitmentManager/CandidatePortal#/VGltZUFuZEF0dGVuZGFuY2U";
    if (document.title.includes("Time - Search Timesheet") || editRows().length >= 5) return { ok: true, mode: "already_on_time_attendance" };
    if (location.href.includes("CandidateLogin") || document.querySelector("input[type='password']")) {
      fail("login_required", { title: document.title, url: location.href });
    }
    // Prefer the portal's own navigation control: find a link/menu item whose
    // visible text is "Time And Attendance" and click it. This uses the real
    // href the portal ships, so it never depends on a hand-encoded route.
    const timeLink = Array.from(document.querySelectorAll("a[href], [ng-click], [role='link'], [role='menuitem']")).find((el) => {
      const text = (el.innerText || el.textContent || "").replace(/\s+/g, " ").trim().toLowerCase();
      return text === "time and attendance" || text.startsWith("time and attendance");
    });
    if (timeLink) {
      timeLink.click();
      if (await waitForTimeAttendance()) return { ok: true, mode: "portal_link_click" };
    }
    try {
      const angularRef = window.angular;
      const appElement = document.querySelector("[ng-app]") || document.body;
      const injector = angularRef?.element?.(appElement)?.injector?.();
      const locationService = injector?.get?.("$location");
      const rootScope = injector?.get?.("$rootScope");
      if (locationService && rootScope) {
        rootScope.$apply(() => locationService.path(targetPath));
        if (await waitForTimeAttendance()) return { ok: true, mode: "angular_location_path" };
      }
    } catch (_error) {
      // Fall through to same-origin hash navigation.
    }
    window.location.href = targetUrl;
    if (await waitForTimeAttendance()) return { ok: true, mode: "same_origin_hash" };
    fail("wrong_week_open", { title: document.title, url: location.href });
  };
  const setValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(input), "value");
    if (descriptor && descriptor.set) descriptor.set.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
    input.dispatchEvent(new Event("blur", { bubbles: true }));
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
  // Read a row's own calendar date from the edit grid, defensively across the
  // shapes FastTrack renders it in (a date cell, or the date half of the
  // rxg.startDateTime input). Returns a dmy string or "" when undeterminable.
  const rowDate = (row) => {
    // The row's own rxg.startDateTime input is authoritative: a generic
    // date-shaped cell can be a shared period/processed-date column repeated
    // on every row, which would collapse all rows onto one date. Read the
    // input's date half first; fall back to a date-shaped cell only when the
    // input carries no date.
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
  // Fail closed: confirm an already-open grid actually belongs to the target
  // week before trusting it. Every readable row date must fall inside the
  // target week (no foreign or duplicate dates) and the week-start date must
  // be present, so a superset grid (fortnight, adjacent-week rows) or a
  // repeated-date grid is refused. A Mon-Fri-only grid still passes. Never
  // write into a blindly-open grid.
  const targetWeekDates = new Set();
  for (let i = 0; i < 7; i += 1) targetWeekDates.add(dmy(addDays(weekStart, i)));
  const openGridFailureReason = () => {
    const rows = editRows();
    if (rows.length < 5) return "wrong_week_open";
    const dates = rows.map(rowDate);
    if (dates.some((date) => !date)) return "row_dates_unreadable";
    if (new Set(dates).size !== dates.length) return "duplicate_row_date";
    if (!dates.every((date) => targetWeekDates.has(date))) return "wrong_week_open";
    return dates.includes(targetStart) ? "" : "wrong_week_open";
  };
  const openTargetIfNeeded = async () => {
    if (editRows().length >= 5) {
      const failureReason = openGridFailureReason();
      if (!failureReason) return { mode: "already_editing", targetStart, targetEnd };
      // An editable grid is open but is NOT provably the target week: refuse to
      // fill it. Fall through to navigate + open the target row by date.
      fail(failureReason, {
        reason: "an editable grid is open but does not match the target week; refusing to fill",
        targetStart,
        targetEnd,
        title: document.title,
        url: location.href,
      });
    }
    const route = await navigateToTimeAttendance();
    for (const tabName of ["Available", "Incomplete"]) {
      await clickTab(tabName);
      const target = await waitForTargetRow();
      if (!target) continue;
      target.link.scrollIntoView({ block: "center", inline: "center" });
      target.link.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
      target.link.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
      target.link.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
      target.link.click();
      if (!(await waitForEditRows())) {
        fail("readback_unavailable", { targetStart, targetEnd, title: document.title, url: location.href });
      }
      return { mode: "opened_from_" + tabName.toLowerCase(), targetStart, targetEnd, route };
    }
    await clickTab("Submitted");
    if (findTargetRow()) fail("submitted_state_observed", { targetStart, targetEnd });
    fail("wrong_week_open", { targetStart, targetEnd, title: document.title, url: location.href });
  };

  const opened = await openTargetIfNeeded();
  const rows = editRows();
  // Anchor each edit row to its own calendar date once, so fills are placed by
  // date rather than a blind weekday index. dmy(week_start + dayIndex) is the
  // expected date for each requested weekday; the physical row is selected by
  // that date. Fail closed when a row's date cannot be read or does not match.
  const rowsByDate = new Map();
  let rowDatesReadable = true;
  for (const row of rows) {
    const d = rowDate(row);
    if (!d) { rowDatesReadable = false; break; }
    if (rowsByDate.has(d)) {
      // Two rows resolving to one date means the per-row date read is not
      // trustworthy (e.g. a shared period cell matched first). Refuse rather
      // than fill whichever row won the map.
      fail("duplicate_row_date", { date: d, row_count: rows.length });
    }
    rowsByDate.set(d, row);
  }
  const fieldsUpdated = [];
  for (const requested of requestedRows) {
    const dayIndex = toDayIndex(requested.day);
    if (dayIndex < 0 || dayIndex > 6) fail("invalid_day", { day: requested.day, fieldsUpdated });
    // Expected calendar date for this weekday within the target week.
    const expectedDate = dmy(addDays(weekStart, dayIndex));
    let row;
    if (rowDatesReadable) {
      row = rowsByDate.get(expectedDate);
      if (!row) {
        fail("row_date_mismatch", {
          reason: "no edit-grid row carries the requested date; refusing index fallback",
          day: requested.day,
          expectedDate,
          available_dates: Array.from(rowsByDate.keys()),
          fieldsUpdated,
        });
      }
    } else {
      // Row dates are not readable in this DOM shape: refuse rather than fall
      // back to a positional guess that could fill the wrong day.
      fail("row_dates_unreadable", {
        reason: "edit-grid row dates could not be read; refusing weekday-index placement",
        day: requested.day,
        expectedDate,
        row_count: rows.length,
        fieldsUpdated,
      });
    }
    if (!row) fail("row_not_found", { dayIndex, expectedDate, row_count: rows.length, fieldsUpdated });
    const startInput = row.querySelector("[ng-model='rxg.startDateTime']") || row.querySelector("input:nth-child(2)");
    const endInput = row.querySelector("[ng-model='rxg.endDateTime']") || row.querySelector("input:nth-child(3)");
    const attendanceSelect = row.querySelector("[ng-model='rxg.attendanceTypeId']") || row.querySelector("select");
    if (!startInput || !endInput || !attendanceSelect) fail("field_not_found", { dayIndex, fieldsUpdated });
    setValue(startInput, requested.startTime);
    setValue(endInput, requested.endTime);
    const optionIndex = Array.from(attendanceSelect.options).findIndex((option) => option.text.trim() === requested.attendanceType);
    if (optionIndex < 0) fail("attendance_option_not_found", { dayIndex, attendanceType: requested.attendanceType, fieldsUpdated });
    attendanceSelect.selectedIndex = optionIndex;
    attendanceSelect.dispatchEvent(new Event("change", { bubbles: true }));
    fieldsUpdated.push({
      dayIndex,
      date: expectedDate,
      startTime: startInput.value,
      endTime: endInput.value,
      attendanceType: attendanceSelect.options[attendanceSelect.selectedIndex]?.text?.trim() || "",
    });
  }
  return { ok: true, period_start: inputs.week_start, period_end: inputs.week_end, opened, fieldsUpdated };
}
