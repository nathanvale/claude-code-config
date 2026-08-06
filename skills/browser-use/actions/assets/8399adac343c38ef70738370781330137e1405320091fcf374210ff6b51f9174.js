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
  const dmy = (date) =>
    `${String(date.getDate()).padStart(2, "0")}/${String(date.getMonth() + 1).padStart(2, "0")}/${date.getFullYear()}`;
  const weekStart = parseDate(inputs.week_start || inputs.period_start);
  if (!weekStart) fail("invalid_week_start", { week_start: inputs.week_start });
  const weekEnd = parseDate(inputs.week_end || inputs.period_end) || addDays(weekStart, 6);
  const targetStart = dmy(weekStart);
  const targetEnd = dmy(weekEnd);
  const editRows = () => Array.from(document.querySelectorAll("tr[ng-repeat]")).filter((row) =>
    row.querySelector("[ng-model='rxg.workDate1']") ||
    row.querySelector("[ng-model='rxg.startDateTime']") ||
    row.querySelector("[ng-model='rxg.endDateTime']") ||
    row.querySelector("[ng-model='rxg.attendanceTypeId']")
  );
  const dateFromInput = (input) => {
    const raw = input && String(input.value || input.getAttribute?.("value") || "");
    const match = raw && raw.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    const parsed = match && parseDate(match[0]);
    return parsed ? dmy(parsed) : "";
  };
  const rowDate = (row) => {
    const workDate = dateFromInput(row.querySelector("[ng-model='rxg.workDate1']"));
    if (workDate) return workDate;
    const startDate = dateFromInput(row.querySelector("[ng-model='rxg.startDateTime']"));
    if (startDate) return startDate;
    const dateCell = Array.from(row.querySelectorAll("td, [ng-bind*='date' i], .date, [class*='date' i]"))
      .map((element) => normalize(element.innerText || element.textContent || element.getAttribute?.("title") || ""))
      .find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text));
    if (!dateCell) return "";
    const match = dateCell.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    const parsed = match && parseDate(match[0]);
    return parsed ? dmy(parsed) : "";
  };
  const rows = editRows();
  if (rows.length < 5) {
    fail("readback_unavailable", { title: document.title, url: location.href });
  }
  const targetWeekDates = new Set();
  for (let index = 0; index < 7; index += 1) targetWeekDates.add(dmy(addDays(weekStart, index)));
  const dates = rows.map(rowDate);
  if (dates.some((date) => !date)) {
    fail("row_dates_unreadable", { targetStart, targetEnd, row_count: rows.length });
  }
  if (new Set(dates).size !== dates.length) {
    fail("duplicate_row_date", { targetStart, targetEnd, dates: dates.slice(0, 14) });
  }
  const foreignDates = dates.filter((date) => !targetWeekDates.has(date));
  if (foreignDates.length > 0 || !dates.includes(targetStart)) {
    fail("wrong_week_open", {
      targetStart,
      targetEnd,
      foreign_dates: foreignDates.slice(0, 14),
      dates: dates.slice(0, 14),
      title: document.title,
      url: location.href,
    });
  }
  const isVisible = (element) => {
    if (element.hidden || element.getAttribute?.("aria-hidden") === "true") return false;
    if (element.classList?.contains("ng-hide")) return false;
    if (typeof element.getClientRects === "function" && element.getClientRects().length === 0) return false;
    return true;
  };
  const visibleText = (element) => normalize(element.innerText || element.value || element.textContent || "");
  const clickExpression = (element) => normalize(
    element.getAttribute?.("ng-click") ||
    element.getAttribute?.("data-ng-click") ||
    element.getAttribute?.("x-ng-click") ||
    "",
  );
  const isApproveShaped = (text) => /approve|authori[sz]e|sign\s*off/i.test(text);
  const controls = Array.from(
    document.querySelectorAll("button,input[type='button'],input[type='submit'],a"),
  )
    .filter(isVisible)
    .map((element) => ({ element, text: visibleText(element), ngClick: clickExpression(element) }));
  const submitShaped = controls.filter((candidate) => /submit/i.test(candidate.text));
  const unsafeAdjacent = controls.filter((candidate) =>
    isApproveShaped(candidate.text) || /^save\s*(?:&|and)?\s*submit$/i.test(candidate.text),
  );
  const exactText = controls.filter((candidate) => /^submit$/i.test(candidate.text));
  const exactHandler = exactText.filter((candidate) => /^saveAndSubmit\s*\(\s*\)\s*;?$/i.test(candidate.ngClick));
  if (exactHandler.length !== 1 || exactText.length !== 1) {
    fail("ambiguous_submit_control", {
      detail: "requires one visible exact Submit control bound only to saveAndSubmit()",
      submit_candidates: submitShaped.map((candidate) => ({ text: candidate.text, ng_click: candidate.ngClick })).slice(0, 30),
      refused_adjacent: unsafeAdjacent.map((candidate) => candidate.text).slice(0, 30),
    });
  }
  const selected = exactHandler[0];
  if (!selected || isApproveShaped(selected.text) || isApproveShaped(selected.ngClick)) {
    fail("ambiguous_submit_control", { detail: "selected control is approve-shaped" });
  }
  const beforeUrl = String(window.location.href);
  const beforeTitle = String(document.title);
  selected.element.scrollIntoView({ block: "center", inline: "center" });
  selected.element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  selected.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  selected.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  selected.element.click();
  await sleep(2500);
  return {
    ok: true,
    mode: "button.click",
    controlText: selected.text,
    controlNgClick: selected.ngClick,
    beforeUrl,
    beforeTitle,
    afterUrl: window.location.href,
    afterTitle: document.title,
  };
}
