async ({ inputs }) => {
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
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
  const displayDate = (value) => {
    const match = String(value || "").match(isoDatePattern);
    if (!match) return "";
    return `${Number(match[3])}/${match[2]}/${match[1]}`;
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
  const periodStart = displayDate(inputs.period_start);
  const periodEnd = displayDate(inputs.period_end);
  if (!timesheetId) {
    fail("wrong_timesheet_id_open", {
      current_timesheet_id: currentTimesheetId(),
      url: pageUrl(),
    });
  }
  if (!periodStart || !periodEnd) {
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
      const label = normalize(link.innerText || link.textContent || "");
      return label.includes(periodStart) && label.includes(periodEnd);
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
