async ({ inputs }) => {
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
  const displayDatePattern = new RegExp("\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b");
  const submittedPattern = new RegExp(
    "successfully submitted|timesheet was submitted|submitted for approval",
    "i",
  );
  const approvedPattern = new RegExp("approved", "i");
  const numericPattern = new RegExp("^-?\\d+(?:\\.\\d+)?$");
  const standardDayPattern = new RegExp("\\bStandard Day\\b", "i");
  const ignoredRowPattern = new RegExp(
    "No records to display|No timesheet entries|^Add new timesheet entry$",
    "i",
  );
  const normalize = (value) =>
    String(value || "")
      .replace(whitespacePattern, " ")
      .trim();
  const observedAt = () => new Date().toISOString();
  const addButtonSelector =
    "#ctl00_MainContent_TimesheetWorkGrid_ctl00_ctl02_ctl00_AddNewRecordButton";
  const standardDayValue = "45548822362";
  const fail = (failureCode, extra = {}) => {
    const payload = {
      failure_code: failureCode,
      timesheet_id: String(inputs.timesheet_id || ""),
      failure_observed_at: observedAt(),
      ...extra,
    };
    const message = JSON.stringify(payload);
    throw new Error(
      message.length <= 2000
        ? message
        : JSON.stringify({
            failure_code: failureCode,
            timesheet_id: payload.timesheet_id,
            truncated: true,
          }),
    );
  };
  const pageUrl = () => String(document.querySelector("html")?.baseURI || "");
  const currentTimesheetId = () => {
    try {
      return new URL(pageUrl()).searchParams.get("id") || "";
    } catch (_error) {
      return "";
    }
  };
  const parseYmd = (value) => {
    const match = String(value || "").match(isoDatePattern);
    if (!match) return null;
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    return date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
      ? date
      : null;
  };
  const parseDisplayDate = (value) => {
    const match = normalize(value).match(displayDatePattern);
    return match
      ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
      : "";
  };
  const isWithin = (ymd, start, end) => {
    const date = parseYmd(ymd);
    const startDate = parseYmd(start);
    const endDate = parseYmd(end);
    return Boolean(
      date && startDate && endDate && date >= startDate && date <= endDate,
    );
  };
  const bodyText = normalize(
    document.querySelector("body")?.innerText ||
      document.querySelector("body")?.textContent ||
      "",
  );
  const editableState = () => {
    if (submittedPattern.test(bodyText)) return "submitted";
    if (
      document.querySelector(addButtonSelector) ||
      document.querySelector("#MainContent_btnSubmit")
    )
      return "editable";
    if (approvedPattern.test(bodyText)) return "approved";
    return "submitted";
  };
  const parseNumber = (value) => {
    const match = normalize(value).match(numericPattern);
    return match ? Number(match[0]) : null;
  };
  const gridRoot = () =>
    document.querySelector("#ctl00_MainContent_TimesheetWorkGrid_ctl00") ||
    document.querySelector("[id$='TimesheetWorkGrid_ctl00']");
  const dataRows = () => {
    const root = gridRoot();
    if (!root) fail("timesheet_grid_not_found");
    const telerikRows = Array.from(
      root.querySelectorAll("tr.rgRow, tr.rgAltRow"),
    );
    return telerikRows.length > 0
      ? telerikRows
      : Array.from(root.querySelectorAll("tbody tr"));
  };
  const entries = () =>
    dataRows()
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((cell) => normalize(cell.innerText || cell.textContent))
          .filter(Boolean);
        const joined = cells.join(" ");
        const date = parseDisplayDate(joined);
        const units =
          cells
            .map(parseNumber)
            .find((value) => value !== null && value > 0 && value <= 1) ??
          null;
        const rateText =
          cells.find((cell) => standardDayPattern.test(cell)) || "";
        return {
          index,
          date,
          rate_text: rateText,
          units,
          cells: cells.slice(0, 12),
        };
      })
      .filter((entry) => {
        const joined = entry.cells.join(" ");
        return entry.cells.length > 0 && !ignoredRowPattern.test(joined);
      });
  const rowEvidence = (row) =>
    row
      ? {
          index: row.index,
          date: row.date,
          units: row.units,
          rate_match: Boolean(row.rate_text),
        }
      : null;
  const rowsEvidence = (rows) => rows.slice(0, 14).map(rowEvidence);

  const timesheetId = String(inputs.timesheet_id || "").trim();
  if (!timesheetId || currentTimesheetId() !== timesheetId) {
    fail("wrong_timesheet_id_open", {
      expected_timesheet_id: timesheetId,
      current_timesheet_id: currentTimesheetId(),
      url: pageUrl(),
    });
  }
  const state = editableState();
  if (state !== "editable")
    fail("editable_state_unexpected", { editable_state: state });
  const periodStart = String(inputs.period_start || "");
  const periodEnd = String(inputs.period_end || "");
  if (
    !parseYmd(periodStart) ||
    !parseYmd(periodEnd) ||
    periodStart > periodEnd
  ) {
    fail("period_boundary_rejected", {
      period_start: periodStart,
      period_end: periodEnd,
    });
  }
  if (!Array.isArray(inputs.rows) || inputs.rows.length === 0) {
    fail("rows_required");
  }
  const expectedRows = inputs.rows.map((row) => ({
    date: String(row.date || ""),
    units: Number(row.units),
  }));
  const expectedDates = expectedRows.map((row) => row.date);
  if (
    expectedRows.some(
      (row) =>
        !isWithin(row.date, periodStart, periodEnd) ||
        !Number.isFinite(row.units) ||
        row.units <= 0 ||
        row.units > 1,
    ) ||
    new Set(expectedDates).size !== expectedDates.length
  ) {
    fail("row_dates_rejected", {
      expected_dates: expectedDates.slice(0, 14),
    });
  }
  const rateValue = String(inputs.rate_value || "").trim();
  if (rateValue !== standardDayValue) {
    fail("telerik_clientstate_rejected", {
      field: "rate",
      rate_value: rateValue,
    });
  }
  const expectedTotalUnits = Number(inputs.expected_total_units);
  if (
    !Number.isFinite(expectedTotalUnits) ||
    expectedTotalUnits < 0 ||
    expectedTotalUnits > 7
  ) {
    fail("aggregate_expectation_rejected", {
      expected_total_units: Number.isFinite(expectedTotalUnits)
        ? expectedTotalUnits
        : null,
    });
  }

  const observedRows = entries();
  if (observedRows.length !== expectedRows.length) {
    fail("row_count_mismatch_after_fill", {
      expected_day_count: expectedRows.length,
      row_count: observedRows.length,
      rows: rowsEvidence(observedRows),
    });
  }
  const proofEntries = [];
  for (const expected of expectedRows) {
    const observed = observedRows.find((row) => row.date === expected.date);
    if (!observed || observed.units !== expected.units || !observed.rate_text) {
      fail("readback_mismatch", {
        expected,
        observed: rowEvidence(observed),
        rows: rowsEvidence(observedRows),
      });
    }
    proofEntries.push({
      date: expected.date,
      rate_value: rateValue,
      units: observed.units,
    });
  }
  if (
    observedRows.some(
      (row) => !row.date || !isWithin(row.date, periodStart, periodEnd),
    )
  ) {
    fail("wrong_period_open", {
      period_start: periodStart,
      period_end: periodEnd,
      rows: rowsEvidence(observedRows),
    });
  }
  proofEntries.sort((left, right) => left.date.localeCompare(right.date));
  const totalUnits = proofEntries.reduce(
    (sum, entry) => sum + Number(entry.units || 0),
    0,
  );
  const totalTolerance =
    Number.EPSILON *
    Math.max(1, Math.abs(expectedTotalUnits), Math.abs(totalUnits)) *
    16;
  if (Math.abs(totalUnits - expectedTotalUnits) > totalTolerance) {
    fail("aggregate_mismatch", {
      expected_total_units: expectedTotalUnits,
      observed_total_units: totalUnits,
    });
  }
  return {
    proof_schema: "OncoreFillTimesheetProofV1",
    timesheet_id: timesheetId,
    period_start: periodStart,
    period_end: periodEnd,
    row_count: observedRows.length,
    total_units: totalUnits,
    entries: proofEntries,
    submitted: false,
    editable_state: state,
    proof_observed_at: observedAt(),
  };
}
