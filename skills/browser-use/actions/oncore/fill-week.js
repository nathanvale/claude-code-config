async ({ inputs }) => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
  const displayDatePattern = new RegExp("\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b");
  const clientDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})");
  const submittedPattern = new RegExp(
    "successfully submitted|timesheet was submitted|submitted for approval",
    "i",
  );
  const approvedPattern = new RegExp("approved", "i");
  const numericPattern = new RegExp("^-?\\d+(?:\\.\\d+)?$");
  const standardDayPattern = new RegExp("\\bStandard Day\\b", "i");
  const emptyRowsPattern = new RegExp(
    "No records to display|No timesheet entries",
    "i",
  );
  const addRowPattern = new RegExp("^Add new timesheet entry$", "i");
  const normalize = (value) =>
    String(value || "")
      .replace(whitespacePattern, " ")
      .trim();
  const observedAt = () => new Date().toISOString();
  const addButtonSelector =
    "#ctl00_MainContent_TimesheetWorkGrid_ctl00_ctl02_ctl00_AddNewRecordButton";
  const editPrefix =
    "#ctl00_MainContent_TimesheetWorkGrid_ctl00_ctl02_ctl02_EditFormControl_";
  const standardDayValue = "45548822362";
  const insertedDays = [];
  const rowCountAfterEachInsert = [];
  let lastAttemptedDay = null;
  const select = (selector) => document.querySelector(selector);
  const fail = (failureCode, extra = {}) => {
    const payload = {
      failure_code: failureCode,
      timesheet_id: String(inputs.timesheet_id || ""),
      period_start: String(inputs.period_start || ""),
      period_end: String(inputs.period_end || ""),
      inserted_days: insertedDays,
      last_attempted_day: lastAttemptedDay,
      row_count_after_each_insert: rowCountAfterEachInsert,
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
    if (
      date.getFullYear() !== Number(match[1]) ||
      date.getMonth() !== Number(match[2]) - 1 ||
      date.getDate() !== Number(match[3])
    )
      return null;
    return date;
  };
  const displayDate = (value) => {
    const match = String(value || "").match(isoDatePattern);
    return match ? `${Number(match[3])}/${match[2]}/${match[1]}` : "";
  };
  const parseDisplayDate = (value) => {
    const match = normalize(value).match(displayDatePattern);
    return match
      ? `${match[3]}-${match[2].padStart(2, "0")}-${match[1].padStart(2, "0")}`
      : "";
  };
  const ymdFromClientState = (value) => {
    const match = String(value || "").match(clientDatePattern);
    return match ? `${match[1]}-${match[2]}-${match[3]}` : "";
  };
  const isWithin = (ymd, start, end) => {
    const date = parseYmd(ymd);
    const startDate = parseYmd(start);
    const endDate = parseYmd(end);
    return Boolean(
      date && startDate && endDate && date >= startDate && date <= endDate,
    );
  };
  const bodyText = () => {
    const body = select("body");
    return normalize(body?.innerText || body?.textContent || "");
  };
  const editableState = () => {
    const text = bodyText();
    if (submittedPattern.test(text)) return "submitted";
    if (approvedPattern.test(text)) return "approved";
    if (select(addButtonSelector) || select("#MainContent_btnSubmit"))
      return "editable";
    return "submitted";
  };
  const parseNumber = (value) => {
    const match = normalize(value).match(numericPattern);
    return match ? Number(match[0]) : null;
  };
  const gridRoot = () =>
    select("#ctl00_MainContent_TimesheetWorkGrid_ctl00") ||
    select("[id$='TimesheetWorkGrid_ctl00']") ||
    select("body");
  const dataRows = () => {
    const root = gridRoot();
    if (!root) return [];
    const telerikRows = Array.from(
      root.querySelectorAll("tr.rgRow, tr.rgAltRow"),
    );
    return telerikRows.length > 0
      ? telerikRows
      : Array.from(root.querySelectorAll("tbody tr"));
  };
  const rowSummaries = () =>
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
      .filter((row) => {
        const joined = row.cells.join(" ");
        if (emptyRowsPattern.test(joined)) return false;
        if (addRowPattern.test(joined.trim())) return false;
        return row.cells.length > 0;
      });
  const insertButton = () => select(`${editPrefix}btnInsert`);
  const waitForInsertForm = async () => {
    for (let attempt = 0; attempt < 40; attempt += 1) {
      if (insertButton()) return true;
      await sleep(250);
    }
    return false;
  };
  const waitForRowCount = async (expected) => {
    for (let attempt = 0; attempt < 60; attempt += 1) {
      const count = rowSummaries().length;
      if (count >= expected && !insertButton()) return count;
      await sleep(250);
    }
    return rowSummaries().length;
  };
  const setVisibleValue = (input, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      Object.getPrototypeOf(input),
      "value",
    );
    if (descriptor?.set) descriptor.set.call(input, value);
    else input.value = value;
  };
  const updateClientState = (element, patch) => {
    if (!element) return;
    let state = {};
    try {
      state = element.value ? JSON.parse(element.value) : {};
    } catch (_error) {
      fail("telerik_clientstate_rejected", {
        client_state_id: element.id || "unknown",
      });
    }
    element.value = JSON.stringify({ ...state, ...patch });
  };
  const datePickerBoundary = () => {
    const stateInput = select(`${editPrefix}dpTimeSheetWorkDate_ClientState`);
    if (!stateInput) return { min: "", max: "" };
    try {
      const state = JSON.parse(stateInput.value || "{}");
      return {
        min: ymdFromClientState(state.minDateStr),
        max: ymdFromClientState(state.maxDateStr),
      };
    } catch (_error) {
      fail("telerik_clientstate_rejected", {
        client_state_id: stateInput.id || "unknown",
      });
    }
  };

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
    fail("period_boundary_rejected", { reason: "rows_required" });
  }
  const requestedRows = inputs.rows.map((row) => ({
    date: String(row.date || ""),
    units: Number(row.units),
  }));
  const requestedDates = requestedRows.map((row) => row.date);
  if (
    requestedRows.some(
      (row) =>
        !parseYmd(row.date) ||
        !isWithin(row.date, periodStart, periodEnd) ||
        !Number.isFinite(row.units) ||
        row.units <= 0 ||
        row.units > 1,
    ) ||
    new Set(requestedDates).size !== requestedDates.length
  ) {
    fail("period_boundary_rejected", {
      requested_dates: requestedDates.slice(0, 14),
    });
  }
  const rateValue = String(inputs.rate_value || "").trim();
  if (rateValue !== standardDayValue)
    fail("telerik_clientstate_rejected", {
      field: "rate",
      rate_value: rateValue,
    });
  const rowsBefore = rowSummaries();
  if (inputs.require_empty_grid !== true || rowsBefore.length > 0) {
    fail("existing_rows_before_fill", {
      require_empty_grid: inputs.require_empty_grid,
      existing_row_count: rowsBefore.length,
      existing_rows: rowsBefore,
    });
  }
  const state = editableState();
  if (state !== "editable") {
    fail("editable_state_unexpected", {
      editable_state: state,
      row_count: rowsBefore.length,
    });
  }

  for (const row of requestedRows) {
    lastAttemptedDay = row.date;
    if (!insertButton()) {
      const addButton = select(addButtonSelector);
      if (!addButton)
        fail("add_button_not_found", {
          url: pageUrl(),
          row_count: rowSummaries().length,
        });
      addButton.click();
      if (!(await waitForInsertForm()))
        fail("insert_button_not_found", { date: row.date });
    }

    const rateSelect = select(`${editPrefix}ddlRate`);
    if (!rateSelect) fail("rate_select_not_found", { date: row.date });
    const rateOption = Array.from(rateSelect.options || []).find(
      (option) => option.value === rateValue,
    );
    if (
      !rateOption ||
      !standardDayPattern.test(
        normalize(rateOption.text || rateOption.textContent || ""),
      )
    ) {
      fail("telerik_clientstate_rejected", {
        field: "rate",
        rate_value: rateValue,
      });
    }
    setVisibleValue(rateSelect, rateValue);

    const unitsText = String(row.units);
    const unitsInput = select(`${editPrefix}radTxtUnits`);
    if (!unitsInput) fail("units_input_not_found", { date: row.date });
    setVisibleValue(unitsInput, unitsText);
    updateClientState(select(`${editPrefix}radTxtUnits_ClientState`), {
      validationText: unitsText,
      valueAsString: unitsText,
      lastSetTextBoxValue: unitsText,
    });

    const dateStr = displayDate(row.date);
    const clientState = `${row.date}-00-00-00`;
    if (!dateStr || !isWithin(row.date, periodStart, periodEnd)) {
      fail("period_boundary_rejected", { date: row.date });
    }
    const boundary = datePickerBoundary();
    if (
      (boundary.min && row.date < boundary.min) ||
      (boundary.max && row.date > boundary.max)
    ) {
      fail("period_boundary_rejected", { date: row.date, boundary });
    }
    const dateInput = select(`${editPrefix}dpTimeSheetWorkDate_dateInput`);
    if (!dateInput) fail("date_input_not_found", { date: row.date });
    setVisibleValue(dateInput, dateStr);
    updateClientState(
      select(`${editPrefix}dpTimeSheetWorkDate_dateInput_ClientState`),
      {
        validationText: clientState,
        valueAsString: clientState,
      },
    );
    updateClientState(select(`${editPrefix}dpTimeSheetWorkDate_ClientState`), {
      selectedDate: clientState,
    });

    const button = insertButton();
    if (!button) fail("insert_button_not_found", { date: row.date });
    button.click();
    const expectedCount = insertedDays.length + 1;
    const rowCount = await waitForRowCount(expectedCount);
    rowCountAfterEachInsert.push({ date: row.date, row_count: rowCount });
    if (rowCount < expectedCount) {
      fail("row_count_mismatch_after_fill", {
        expected_row_count: expectedCount,
        observed_row_count: rowCount,
      });
    }
    const inserted = rowSummaries().find(
      (candidate) => candidate.date === row.date,
    );
    if (!inserted || inserted.units !== row.units || !inserted.rate_text) {
      fail("readback_mismatch", { expected: row, observed: inserted || null });
    }
    insertedDays.push({ date: row.date, date_str: dateStr });
  }

  const finalRows = rowSummaries();
  if (finalRows.length !== requestedRows.length) {
    fail("row_count_mismatch_after_fill", {
      expected_row_count: requestedRows.length,
      observed_row_count: finalRows.length,
    });
  }
  return {
    ok: true,
    timesheet_id: timesheetId,
    period_start: periodStart,
    period_end: periodEnd,
    inserted_days: insertedDays,
    row_count_after_each_insert: rowCountAfterEachInsert,
    row_count: finalRows.length,
  };
}
