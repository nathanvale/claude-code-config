async ({ inputs }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
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
  const iso = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dmy = (date) =>
    `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const weekStart = parseDate(inputs.week_start || inputs.period_start);
  if (!weekStart) fail("invalid_week_start", { week_start: inputs.week_start });
  const weekEnd = parseDate(inputs.week_end || inputs.period_end) || addDays(weekStart, 6);
  const targetStart = dmy(weekStart);
  const targetEnd = dmy(weekEnd);
  const expectedTotal = Number(inputs.expected_total_hours || inputs.total_attendance_hours || 40);
  const expectedRowCount = Array.isArray(inputs.rows)
    ? inputs.rows.length
    : Array.isArray(inputs.workDays)
      ? inputs.workDays.length
      : 5;
  const tabs = () => Array.from(document.querySelectorAll("ul.nav.nav-tabs.top-3 li a, .nav-tabs a"));
  const clickTab = async (keyword) => {
    const tab = tabs().find((candidate) => normalize(candidate.innerText || candidate.textContent).toLowerCase().includes(keyword.toLowerCase()));
    if (!tab) return false;
    tab.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    tab.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    tab.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    tab.click();
    await sleep(1000);
    return true;
  };
  const decodeTimesheetId = (href) => {
    if (!href) return "";
    const raw = String(href).split("/").pop() || "";
    try {
      let padded = raw.replace(/0000$/, "");
      while (padded.length % 4 !== 0) padded += "=";
      return atob(padded).replace(/\0/g, "").trim();
    } catch (_error) {
      return raw;
    }
  };
  const parseNumber = (value) => {
    const match = normalize(value).match(/^-?\d+(?:\.\d+)?$/);
    return match ? Number(match[0]) : null;
  };
  const rowInfo = (row, index) => {
    const table = row.closest("table");
    const headers = Array.from(table?.querySelectorAll("thead th, tr th") || []).map((header) => normalize(header.innerText || header.textContent).toLowerCase());
    const cells = Array.from(row.querySelectorAll("td")).map((cell) => normalize(cell.innerText || cell.textContent));
    const link = Array.from(row.querySelectorAll("a[href]")).find((candidate) => candidate.href || candidate.getAttribute("href"));
    const valueByHeader = (needles) => {
      const headerIndex = headers.findIndex((header) => needles.every((needle) => header.includes(needle)));
      return headerIndex >= 0 ? cells[headerIndex] || "" : "";
    };
    const idFromHeader = valueByHeader(["time", "id"]);
    const idFromCells = cells.find((cell) => /^\d{6,}$/.test(cell)) || "";
    const dates = cells.filter((cell) => /^\d{2}\/\d{2}\/\d{4}$/.test(cell));
    const start = valueByHeader(["ts", "start"]) || dates[0] || "";
    const end = valueByHeader(["ts", "end"]) || dates[1] || "";
    const totalText = valueByHeader(["total", "att"]) || cells.find((cell) => parseNumber(cell) === expectedTotal) || "";
    return {
      index,
      cells,
      timesheet_id: idFromHeader || idFromCells || decodeTimesheetId(link?.getAttribute("href") || link?.href || ""),
      period_start_display: start,
      period_end_display: end,
      total_attendance_hours: parseNumber(totalText),
      row_href: link?.getAttribute("href") || link?.href || "",
    };
  };
  // Only consider rows in the active/visible tab pane. AngularJS nav-tab sets
  // commonly keep every pane's rows mounted in the DOM and toggle visibility;
  // scraping the whole document would match a Submitted-pane row while the
  // Incomplete tab is active and bypass the submitted-state guard below.
  const isVisible = (el) => {
    if (!el) return false;
    if (el.offsetParent !== null) return true; // laid out and not display:none
    const pane = el.closest(".tab-pane, [role='tabpanel']");
    if (pane) return pane.classList.contains("active") && !pane.hidden;
    return false;
  };
  const scrapeRows = () => Array.from(document.querySelectorAll("table tbody tr"))
    .filter((row) => isVisible(row))
    .map(rowInfo)
    .filter((row) => row.cells.some(Boolean));
  const findTarget = () => scrapeRows().find((row) =>
    row.cells.includes(targetStart) && row.cells.includes(targetEnd)
  );
  const waitForTarget = async () => {
    for (let i = 0; i < 32; i += 1) {
      const target = findTarget();
      if (target) return target;
      await sleep(250);
    }
    return null;
  };

  // Positively prove the week is NOT submitted before certifying a draft.
  // Check the Submitted pane first: if the target week appears there, it has
  // been submitted and the draft proof must fail closed rather than emit a
  // hardcoded submitted:false.
  await clickTab("Submitted");
  if (await waitForTarget()) {
    fail("submitted_state_observed", {
      reason: "target week appears under the Submitted tab; not an un-submitted draft",
      targetStart,
      targetEnd,
    });
  }
  await clickTab("Incomplete");
  const target = await waitForTarget();
  if (!target) {
    await clickTab("Available");
    if (await waitForTarget()) fail("missing_saved_state", { targetStart, targetEnd });
    fail("wrong_week_open", { targetStart, targetEnd, title: document.title, url: location.href });
  }
  if (!target.timesheet_id) fail("missing_timesheet_id", { targetStart, targetEnd, row: target });
  if (target.total_attendance_hours !== expectedTotal) {
    fail("total_hours_mismatch", { expectedTotal, observedTotal: target.total_attendance_hours, row: target });
  }
  // submitted is now an observed conclusion: the week was absent from the
  // Submitted pane and present under Incomplete, so it is a saved draft.
  return {
    proof_schema: "FastTrack360SavedDraftProofV1",
    timesheet_id: target.timesheet_id,
    period_start: iso(weekStart),
    period_end: iso(weekEnd),
    total_attendance_hours: target.total_attendance_hours,
    editable_state: "saved_incomplete",
    submitted: false,
    submitted_state_source: "absent_from_submitted_pane,present_under_incomplete",
    row_count: expectedRowCount,
    proof_observed_at: new Date().toISOString(),
  };
}
