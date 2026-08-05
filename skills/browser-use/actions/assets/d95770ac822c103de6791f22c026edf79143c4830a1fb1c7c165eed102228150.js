async ({ inputs }) => {
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
  const iso = (date) =>
    `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
  const dmy = (date) =>
    `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const textOf = (element) => normalize(
    element?.value || element?.innerText || element?.textContent || element?.getAttribute?.("value") || "",
  );
  const fieldValue = (fieldName) => {
    const expected = fieldName.toLowerCase();
    const labels = Array.from(document.querySelectorAll("label, dt, th, td, .control-label, [class*='field-label']"));
    const label = labels.find((candidate) =>
      textOf(candidate).replace(/:\s*$/, "").toLowerCase() === expected
    );
    if (!label) return "";
    const sibling = textOf(label.nextElementSibling);
    if (sibling) return sibling;
    const row = label.closest?.("tr");
    if (row) {
      const cells = Array.from(row.querySelectorAll("th, td"));
      const labelIndex = cells.findIndex((cell) => cell === label || cell.contains?.(label));
      const cellValue = textOf(cells[labelIndex + 1]);
      if (cellValue) return cellValue;
    }
    const parentSibling = textOf(label.parentElement?.nextElementSibling);
    if (parentSibling) return parentSibling;
    const siblings = Array.from(label.parentElement?.querySelectorAll?.(":scope > *") || []);
    const siblingIndex = siblings.findIndex((candidate) => candidate === label || candidate.contains?.(label));
    return textOf(siblings[siblingIndex + 1]);
  };
  const success = ({ source, tabText, rowSummary }) => ({
    proof_schema: "FastTrack360SubmittedProofV1",
    period_start: iso(weekStart),
    period_end: iso(weekEnd),
    submitted: true,
    submitted_state: "submitted",
    submitted_state_source: source,
    tab_text: tabText,
    row_summary: rowSummary.slice(0, 512),
    proof_observed_at: new Date().toISOString(),
  });
  const weekStart = parseDate(inputs.week_start || inputs.period_start);
  const weekEnd = parseDate(inputs.week_end || inputs.period_end);
  if (!weekStart || !weekEnd) fail("invalid_week_range", { week_start: inputs.week_start, week_end: inputs.week_end });
  const targetStart = dmy(weekStart);
  const targetEnd = dmy(weekEnd);
  const title = normalize(document.title);
  const url = String(location || "");
  const status = fieldValue("Status");
  const submittedTitle = /submitted timesheet/i.test(title);
  const submittedRoute = /c3VibWl0dGVkVGltZXNoZWV0/i.test(url);
  const submittedStatus = /^submitted$/i.test(status);
  if ((submittedTitle || submittedRoute) && submittedStatus) {
    const pageText = normalize(document.body?.innerText || document.body?.textContent || "");
    const targetWeekObserved =
      (pageText.includes(targetStart) && pageText.includes(targetEnd)) ||
      (pageText.includes(iso(weekStart)) && pageText.includes(iso(weekEnd)));
    if (!targetWeekObserved) {
      fail("submitted_detail_week_not_observed", { targetStart, targetEnd, title, url });
    }
    return success({
      source: "submitted_detail",
      tabText: "Submitted",
      rowSummary: `Status: Submitted | ${targetStart} - ${targetEnd}`,
    });
  }
  if (submittedTitle || submittedRoute) {
    fail("submitted_detail_state_not_observed", { status, title, url });
  }
  const tabs = Array.from(document.querySelectorAll("ul.nav.nav-tabs.top-3 li a, .nav-tabs a, [role='tab']"));
  const submittedTab = tabs.find((tab) => /^submitted$/i.test(textOf(tab)));
  if (!submittedTab) fail("submitted_state_unavailable", { status, title, url });
  const selector = submittedTab.getAttribute?.("href") || submittedTab.getAttribute?.("data-target") || "";
  const controls = submittedTab.getAttribute?.("aria-controls") || "";
  let pane = selector.startsWith("#") ? document.querySelector(selector) : null;
  if (!pane && controls) pane = document.querySelector(`[id='${controls}']`);
  if (!pane) {
    const tabIndex = tabs.indexOf(submittedTab);
    const panes = Array.from(document.querySelectorAll(".tab-pane, [role='tabpanel']"));
    pane = panes[tabIndex] || panes.find((candidate) => /submitted/i.test(normalize(candidate.getAttribute?.("id") || candidate.getAttribute?.("aria-label") || ""))) || null;
  }
  if (!pane) fail("submitted_state_unavailable", { tab: textOf(submittedTab), title, url });
  const rowText = (row) => Array.from(row.querySelectorAll("td")).map(textOf);
  const target = Array.from(pane.querySelectorAll("table tbody tr"))
    .map((row) => ({ row, cells: rowText(row) }))
    .find((candidate) => candidate.cells.includes(targetStart) && candidate.cells.includes(targetEnd));
  if (!target) {
    fail("submitted_state_not_observed", {
      targetStart,
      targetEnd,
      submitted_rows: Array.from(pane.querySelectorAll("table tbody tr")).length,
      title,
      url,
    });
  }
  return success({
    source: "target_week_present_in_submitted_pane",
    tabText: textOf(submittedTab),
    rowSummary: target.cells.join(" | "),
  });
}
