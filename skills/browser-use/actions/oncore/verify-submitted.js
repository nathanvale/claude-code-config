async ({ inputs }) => {
  const whitespacePattern = new RegExp("\\s+", "g");
  const isoDatePattern = new RegExp("^(\\d{4})-(\\d{2})-(\\d{2})$");
  const submittedPattern = new RegExp(
    "successfully submitted|timesheet was submitted|submitted for approval|status\\s*:?\\s*submitted",
    "i",
  );
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
  const displayDates = (value) => {
    const match = String(value || "").match(isoDatePattern);
    if (!match) return [];
    const day = String(Number(match[3]));
    const month = String(Number(match[2]));
    return [
      `${day}/${month}/${match[1]}`,
      `${match[3]}/${match[2]}/${match[1]}`,
    ];
  };
  const hrefTimesheetId = (href) => {
    try {
      return new URL(href, pageUrl()).searchParams.get("id") || "";
    } catch (_error) {
      return "";
    }
  };
  const success = (source) => ({
    proof_schema: "OncoreSubmittedTimesheetProofV1",
    timesheet_id: timesheetId,
    period_start: periodStart,
    period_end: periodEnd,
    submitted: true,
    submitted_state: "submitted",
    submitted_state_source: source,
    proof_observed_at: observedAt(),
  });

  const timesheetId = String(inputs.timesheet_id || "").trim();
  const periodStart = String(inputs.period_start || "");
  const periodEnd = String(inputs.period_end || "");
  if (
    !timesheetId ||
    !/^\d{1,32}$/.test(timesheetId) ||
    !parseYmd(periodStart) ||
    !parseYmd(periodEnd) ||
    periodStart > periodEnd
  ) {
    fail("submission_identity_rejected", {
      period_start: periodStart,
      period_end: periodEnd,
    });
  }

  const url = pageUrl();
  let parsedUrl;
  try {
    parsedUrl = new URL(url);
  } catch (_error) {
    fail("submitted_state_unavailable", { url });
  }
  const body = select("body");
  const bodyText = normalize(body?.innerText || body?.textContent || "");
  if (/\/pages\/TimesheetSubmit\.aspx$/i.test(parsedUrl.pathname)) {
    const currentTimesheetId = parsedUrl.searchParams.get("id") || "";
    if (currentTimesheetId !== timesheetId) {
      fail("wrong_timesheet_id_open", {
        expected_timesheet_id: timesheetId,
        current_timesheet_id: currentTimesheetId,
      });
    }
    const submitControls = Array.from(
      document.querySelectorAll("#MainContent_btnSubmit"),
    );
    if (!submittedPattern.test(bodyText) || submitControls.length !== 0) {
      fail("submitted_detail_state_not_observed", {
        success_marker_observed: submittedPattern.test(bodyText),
        submit_control_count: submitControls.length,
      });
    }
    return success("submitted_detail_message_and_locked_controls");
  }

  if (!/\/pages\/ContractorSummary\.aspx$/i.test(parsedUrl.pathname)) {
    fail("submitted_state_unavailable", { url });
  }
  const startDates = displayDates(periodStart);
  const endDates = displayDates(periodEnd);
  const links = Array.from(document.querySelectorAll("a[href]"));
  const targetLink = links.find((link) => {
    const href = link.getAttribute?.("href") || link.href || "";
    return hrefTimesheetId(href) === timesheetId;
  });
  if (!targetLink) {
    fail("submitted_summary_target_not_found");
  }
  const row = targetLink.closest?.("tr");
  const rowText = normalize(row?.innerText || row?.textContent || "");
  const startObserved = startDates.some((date) => rowText.includes(date));
  const endObserved = endDates.some((date) => rowText.includes(date));
  if (!row || !startObserved || !endObserved || !submittedPattern.test(rowText)) {
    fail("submitted_summary_state_not_observed", {
      period_start_observed: startObserved,
      period_end_observed: endObserved,
      submitted_marker_observed: submittedPattern.test(rowText),
    });
  }
  return success("contractor_summary_row");
}
