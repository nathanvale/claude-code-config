async ({ inputs }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
  const displayDatePattern = new RegExp("\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b");
  const numericPattern = new RegExp("^-?\\d+(?:\\.\\d+)?$");
  const standardDayPattern = new RegExp("\\bStandard Day\\b", "i");
  const submittedPattern = new RegExp(
    "successfully submitted|timesheet was submitted|submitted for approval",
    "i",
  );
  const ignoredRowPattern = new RegExp(
    "No records to display|No timesheet entries|^Add new timesheet entry$",
    "i",
  );
  const submitSelector = "#MainContent_btnSubmit";
  const standardDayValue = "45548822362";
  const normalize = (value) =>
    String(value || "")
      .replace(whitespacePattern, " ")
      .trim();
  const observedAt = () => new Date().toISOString();
  const select = (selector) => document.querySelector(selector);
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
  const pageUrl = () => String(select("html")?.baseURI || "");
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
  const parseNumber = (value) => {
    const match = normalize(value).match(numericPattern);
    return match ? Number(match[0]) : null;
  };
  const gridRoot = () =>
    select("#ctl00_MainContent_TimesheetWorkGrid_ctl00") ||
    select("[id$='TimesheetWorkGrid_ctl00']");
  const entries = () => {
    const root = gridRoot();
    if (!root) fail("timesheet_grid_not_found");
    const telerikRows = Array.from(
      root.querySelectorAll("tr.rgRow, tr.rgAltRow"),
    );
    const rows =
      telerikRows.length > 0
        ? telerikRows
        : Array.from(root.querySelectorAll("tbody tr"));
    return rows
      .map((row, index) => {
        const cells = Array.from(row.querySelectorAll("td"))
          .map((cell) => normalize(cell.innerText || cell.textContent))
          .filter(Boolean);
        const joined = cells.join(" ");
        return {
          index,
          date: parseDisplayDate(joined),
          units:
            cells
              .map(parseNumber)
              .find((value) => value !== null && value > 0 && value <= 1) ??
            null,
          rate_match: cells.some((cell) => standardDayPattern.test(cell)),
          ignored: ignoredRowPattern.test(joined),
        };
      })
      .filter((entry) => !entry.ignored);
  };
  const rowEvidence = (row) =>
    row
      ? {
          index: row.index,
          date: row.date,
          units: row.units,
          rate_match: row.rate_match,
        }
      : null;

  const timesheetId = String(inputs.timesheet_id || "").trim();
  if (!timesheetId || currentTimesheetId() !== timesheetId) {
    fail("wrong_timesheet_id_open", {
      expected_timesheet_id: timesheetId,
      current_timesheet_id: currentTimesheetId(),
      url: pageUrl(),
    });
  }
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
  if (String(inputs.rate_value || "").trim() !== standardDayValue) {
    fail("rate_value_rejected");
  }
  const expectedTotalUnits = Number(inputs.expected_total_units);
  if (
    !Number.isFinite(expectedTotalUnits) ||
    expectedTotalUnits <= 0 ||
    expectedTotalUnits > 7
  ) {
    fail("aggregate_expectation_rejected");
  }
  const body = select("body");
  const bodyText = normalize(body?.innerText || body?.textContent || "");
  if (submittedPattern.test(bodyText)) {
    fail("submitted_state_observed");
  }
  const observedRows = entries();
  if (observedRows.length !== expectedRows.length) {
    fail("row_count_mismatch_before_submit", {
      expected_row_count: expectedRows.length,
      observed_row_count: observedRows.length,
    });
  }
  for (const expected of expectedRows) {
    const observed = observedRows.find((row) => row.date === expected.date);
    if (!observed || observed.units !== expected.units || !observed.rate_match) {
      fail("readback_mismatch_before_submit", {
        expected,
        observed: rowEvidence(observed),
      });
    }
  }
  const observedTotalUnits = observedRows.reduce(
    (sum, row) => sum + Number(row.units || 0),
    0,
  );
  const totalTolerance =
    Number.EPSILON *
    Math.max(1, Math.abs(expectedTotalUnits), Math.abs(observedTotalUnits)) *
    16;
  if (Math.abs(observedTotalUnits - expectedTotalUnits) > totalTolerance) {
    fail("aggregate_mismatch_before_submit", {
      expected_total_units: expectedTotalUnits,
      observed_total_units: observedTotalUnits,
    });
  }

  const controls = Array.from(document.querySelectorAll(submitSelector));
  if (controls.length !== 1) {
    fail("ambiguous_submit_control", {
      submit_control_count: controls.length,
    });
  }
  const control = controls[0];
  const controlText = normalize(
    control.innerText || control.value || control.textContent || "",
  );
  const controlType = normalize(control.getAttribute?.("type") || control.type);
  const hidden =
    control.hidden === true ||
    control.getAttribute?.("aria-hidden") === "true" ||
    (typeof control.getClientRects === "function" &&
      control.getClientRects().length === 0);
  const disabled =
    control.disabled === true ||
    control.getAttribute?.("aria-disabled") === "true";
  if (
    !/^Submit timesheet$/i.test(controlText) ||
    !/^submit$/i.test(controlType) ||
    hidden ||
    disabled
  ) {
    fail("submit_control_rejected", {
      control_text: controlText.slice(0, 64),
      control_type: controlType.slice(0, 32),
      hidden,
      disabled,
    });
  }

  const beforeUrl = pageUrl();
  control.scrollIntoView?.({ block: "center", inline: "center" });
  control.click();
  await sleep(2500);
  return {
    ok: true,
    timesheet_id: timesheetId,
    period_start: periodStart,
    period_end: periodEnd,
    row_count: observedRows.length,
    total_units: observedTotalUnits,
    control_id: "MainContent_btnSubmit",
    control_text: controlText,
    before_url: beforeUrl,
    after_url: pageUrl(),
  };
}
