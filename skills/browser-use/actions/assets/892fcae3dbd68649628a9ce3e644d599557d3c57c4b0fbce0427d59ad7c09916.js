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
  const weekStart = parseDate(inputs.week_start || inputs.period_start);
  const weekEnd = parseDate(inputs.week_end || inputs.period_end);
  if (!weekStart || !weekEnd) fail("invalid_week_range", { week_start: inputs.week_start, week_end: inputs.week_end });
  const targetStart = dmy(weekStart);
  const targetEnd = dmy(weekEnd);
  const tabs = Array.from(document.querySelectorAll("ul.nav.nav-tabs.top-3 li a, .nav-tabs a, [role='tab']"));
  const submittedTab = tabs.find((tab) => /^submitted$/i.test(normalize(tab.innerText || tab.textContent)));
  if (!submittedTab) fail("submitted_state_unavailable", { title: document.title });
  const selector = submittedTab.getAttribute?.("href") || submittedTab.getAttribute?.("data-target") || "";
  const controls = submittedTab.getAttribute?.("aria-controls") || "";
  let pane = selector.startsWith("#") ? document.querySelector(selector) : null;
  if (!pane && controls) pane = document.querySelector(`[id='${controls}']`);
  if (!pane) {
    const tabIndex = tabs.indexOf(submittedTab);
    const panes = Array.from(document.querySelectorAll(".tab-pane, [role='tabpanel']"));
    pane = panes[tabIndex] || panes.find((candidate) => /submitted/i.test(normalize(candidate.getAttribute?.("id") || candidate.getAttribute?.("aria-label") || ""))) || null;
  }
  if (!pane) fail("submitted_state_unavailable", { tab: normalize(submittedTab.innerText || submittedTab.textContent) });
  const rowText = (row) => Array.from(row.querySelectorAll("td")).map((cell) => normalize(cell.innerText || cell.textContent));
  const target = Array.from(pane.querySelectorAll("table tbody tr"))
    .map((row) => ({ row, cells: rowText(row) }))
    .find((candidate) => candidate.cells.includes(targetStart) && candidate.cells.includes(targetEnd));
  if (!target) {
    fail("submitted_state_not_observed", {
      targetStart,
      targetEnd,
      submitted_rows: Array.from(pane.querySelectorAll("table tbody tr")).length,
      title: document.title,
    });
  }
  return {
    proof_schema: "FastTrack360SubmittedProofV1",
    period_start: iso(weekStart),
    period_end: iso(weekEnd),
    submitted: true,
    submitted_state: "submitted",
    submitted_state_source: "target_week_present_in_submitted_pane",
    tab_text: normalize(submittedTab.innerText || submittedTab.textContent),
    row_summary: target.cells.join(" | ").slice(0, 512),
    proof_observed_at: new Date().toISOString(),
  };
}
