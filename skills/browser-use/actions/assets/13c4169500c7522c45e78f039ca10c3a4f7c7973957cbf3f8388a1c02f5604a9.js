async ({ inputs }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const fail = (reason, extra = {}) => {
    const { reason: detail, ...context } = extra;
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
  const editRows = () => Array.from(document.querySelectorAll("tr[ng-repeat]")).filter((row) =>
    row.querySelector("[ng-model='rxg.startDateTime']") ||
    row.querySelector("[ng-model='rxg.endDateTime']") ||
    row.querySelector("[ng-model='rxg.attendanceTypeId']")
  );
  const tabs = () => Array.from(document.querySelectorAll("ul.nav.nav-tabs.top-3 li a, .nav-tabs a"));
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
    if (document.title.includes("Time - Search Timesheet") || editRows().length >= 5) {
      return { ok: true, mode: "already_on_time_attendance" };
    }
    if (location.href.includes("CandidateLogin") || document.querySelector("input[type='password']")) {
      fail("login_required", { title: document.title, url: location.href });
    }
    const timeLink = Array.from(document.querySelectorAll("a[href], [ng-click], [role='link'], [role='menuitem']")).find((el) => {
      const text = normalize(el.innerText || el.textContent).toLowerCase();
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
  const rowDate = (row) => {
    const workDateEl = row.querySelector("[ng-model='rxg.workDate1']") || row.querySelector("[ng-model*='workDate']") || row.querySelector("[ng-model*='itemDate']");
    if (workDateEl) {
      const workDateRaw = normalize(workDateEl.value || workDateEl.getAttribute?.("value") || workDateEl.innerText || workDateEl.textContent || "");
      const workDateMatch = workDateRaw?.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
      const workDateParsed = workDateMatch && parseDate(workDateMatch[0]);
      if (workDateParsed) return dmy(workDateParsed);
    }
    const startInput = row.querySelector("[ng-model='rxg.startDateTime']");
    const raw = startInput && String(startInput.value || startInput.getAttribute("value") || "");
    const inputMatch = raw?.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    const inputParsed = inputMatch && parseDate(inputMatch[0]);
    if (inputParsed) return dmy(inputParsed);
    const dateCell = Array.from(row.querySelectorAll("td, [ng-bind*='date' i], .date, [class*='date' i]"))
      .map((el) => normalize(el.innerText || el.textContent || el.getAttribute?.("title") || ""))
      .find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text));
    if (dateCell) {
      const match = dateCell.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
      const parsed = match && parseDate(match[0]);
      if (parsed) return dmy(parsed);
    }
    return "";
  };
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
      if (!failureReason) return { mode: "already_editing" };
      fail(failureReason, {
        reason: "an editable grid is open but does not match the target week; refusing to continue",
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
      const failureReason = openGridFailureReason();
      if (failureReason) {
        fail(failureReason, { targetStart, targetEnd, title: document.title, url: location.href });
      }
      return { mode: `opened_from_${tabName.toLowerCase()}`, route };
    }
    await clickTab("Submitted");
    if (findTargetRow()) fail("submitted_state_observed", { targetStart, targetEnd });
    fail("wrong_week_open", { targetStart, targetEnd, title: document.title, url: location.href });
  };

  const opened = await openTargetIfNeeded();
  return {
    ok: true,
    period_start: inputs.week_start,
    period_end: inputs.week_end,
    mode: opened.mode,
    target_start: targetStart,
    target_end: targetEnd,
    row_count: editRows().length,
  };
}
