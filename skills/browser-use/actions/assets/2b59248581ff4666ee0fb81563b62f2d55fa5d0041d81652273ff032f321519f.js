async ({ inputs }) => {
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
  const labelDatePattern = new RegExp(
    "\\b(\\d{1,2})/(\\d{1,2})/(\\d{4})\\b",
    "g",
  );
  const normalize = (value) =>
    String(value || "")
      .replace(whitespacePattern, " ")
      .trim();
  const observedAt = () => new Date().toISOString();
  const gridSelector = "#ctl00_MainContent_TimesheetWorkGrid_ctl00";
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
  const isoDate = (value) => {
    const match = String(value || "").match(isoDatePattern);
    if (!match) return "";
    const date = new Date(
      Number(match[1]),
      Number(match[2]) - 1,
      Number(match[3]),
    );
    return date.getFullYear() === Number(match[1]) &&
      date.getMonth() === Number(match[2]) - 1 &&
      date.getDate() === Number(match[3])
      ? `${match[1]}-${match[2]}-${match[3]}`
      : "";
  };
  const labelPeriod = (value) => {
    const matches = Array.from(normalize(value).matchAll(labelDatePattern));
    if (matches.length !== 2) return null;
    const dates = matches.map((match) => {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const date = new Date(year, month - 1, day);
      return date.getFullYear() === year &&
        date.getMonth() === month - 1 &&
        date.getDate() === day
        ? `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`
        : "";
    });
    return dates.every(Boolean) ? { start: dates[0], end: dates[1] } : null;
  };
  const linkTimesheetId = (link) => {
    try {
      return (
        new URL(
          String(link.href || link.getAttribute("href") || ""),
          pageUrl(),
        ).searchParams.get("id") || ""
      );
    } catch (_error) {
      return "";
    }
  };

  const timesheetId = String(inputs.timesheet_id || "").trim();
  const periodStart = isoDate(inputs.period_start);
  const periodEnd = isoDate(inputs.period_end);
  if (!timesheetId) {
    fail("wrong_timesheet_id_open", {
      current_timesheet_id: currentTimesheetId(),
      url: pageUrl(),
    });
  }
  if (!periodStart || !periodEnd || periodStart > periodEnd) {
    fail("period_boundary_rejected", {
      period_start: inputs.period_start,
      period_end: inputs.period_end,
    });
  }

  const openTimesheetId = currentTimesheetId();
  if (openTimesheetId) {
    if (openTimesheetId !== timesheetId) {
      fail("wrong_timesheet_id_open", {
        expected_timesheet_id: timesheetId,
        current_timesheet_id: openTimesheetId,
        url: pageUrl(),
      });
    }
    const grid =
      select(gridSelector) || select("[id$='TimesheetWorkGrid_ctl00']");
    if (!grid) fail("timesheet_grid_not_found", { url: pageUrl() });
    return {
      ok: true,
      timesheet_id: timesheetId,
      period_start: String(inputs.period_start),
      period_end: String(inputs.period_end),
      mode: "already_open",
    };
  }

  const matches = Array.from(document.querySelectorAll("a[href]")).filter(
    (link) => {
      if (linkTimesheetId(link) !== timesheetId) return false;
      const period = labelPeriod(link.innerText || link.textContent || "");
      return period?.start === periodStart && period.end === periodEnd;
    },
  );
  if (matches.length !== 1) {
    fail("wrong_week_open", {
      expected_timesheet_id: timesheetId,
      period_start: String(inputs.period_start),
      period_end: String(inputs.period_end),
      matching_link_count: matches.length,
      url: pageUrl(),
    });
  }
  const target = matches[0];
  target.scrollIntoView({ block: "center", inline: "center" });
  target.click();
  return {
    ok: true,
    timesheet_id: timesheetId,
    period_start: String(inputs.period_start),
    period_end: String(inputs.period_end),
    mode: "timesheet_link_clicked",
  };
}
