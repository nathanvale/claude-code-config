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
    row.querySelector("[ng-model='rxg.startDateTime']") ||
    row.querySelector("[ng-model='rxg.endDateTime']") ||
    row.querySelector("[ng-model='rxg.attendanceTypeId']")
  );
  const rowDate = (row) => {
    // The row's own rxg.startDateTime input is authoritative: a generic
    // date-shaped cell can be a shared period/processed-date column repeated
    // on every row, which would collapse all rows onto one date. Read the
    // input's date half first; fall back to a date-shaped cell only when the
    // input carries no date.
    const startInput = row.querySelector("[ng-model='rxg.startDateTime']");
    const raw = startInput && String(startInput.value || startInput.getAttribute("value") || "");
    const inputMatch = raw && raw.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
    const inputParsed = inputMatch && parseDate(inputMatch[0]);
    if (inputParsed) return dmy(inputParsed);
    const dateCell = Array.from(row.querySelectorAll("td, [ng-bind*='date' i], .date, [class*='date' i]"))
      .map((el) => normalize(el.innerText || el.textContent || el.getAttribute?.("title") || ""))
      .find((text) => /\d{2}\/\d{2}\/\d{4}/.test(text) || /\d{4}-\d{2}-\d{2}/.test(text));
    if (dateCell) {
      const m = dateCell.match(/\d{2}\/\d{2}\/\d{4}|\d{4}-\d{2}-\d{2}/);
      const parsed = m && parseDate(m[0]);
      if (parsed) return dmy(parsed);
    }
    return "";
  };
  const rows = editRows();
  if (rows.length < 5) {
    fail("readback_unavailable", { title: document.title, url: location.href });
  }
  // Fail closed: prove the open edit grid belongs to the target week before
  // saving anything. Every row date must be readable, unique, and inside the
  // target week, with the week-start date present. save-draft persists
  // whatever grid is open, so this guard is the never-wrong-week invariant on
  // the save side.
  const targetWeekDates = new Set();
  for (let i = 0; i < 7; i += 1) targetWeekDates.add(dmy(addDays(weekStart, i)));
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
  // Fail closed: only a plain draft-save control may fire. The submit-shaped
  // vocabulary is broad (synonym and sign-off verbs included) and the click
  // allowlist is exact — any extra word beyond "Save" / "Save Draft" could
  // carry submit semantics, so refuse rather than click. Visible text only:
  // title/aria-label are app-controlled hints, not proof of behavior. The
  // Angular scope path is a guarded last resort, never the primary route,
  // because scope.saveTimesheet() bypasses every visible-label check.
  const isSubmitShaped = (text) =>
    /submit|finali[sz]e|approve|confirm|complete|send|lodge|post|authori[sz]e|sign\s*off/i.test(text);
  const visibleText = (element) =>
    normalize(element.innerText || element.value || element.textContent || "");
  const buttons = Array.from(
    document.querySelectorAll("button,input[type='button'],input[type='submit'],a"),
  ).map((element) => ({ element, text: visibleText(element) }));
  const saveShaped = buttons.filter((candidate) => /^save\b/i.test(candidate.text));
  const exactSave = saveShaped.find((candidate) => /^save(\s+draft)?$/i.test(candidate.text));
  if (exactSave) {
    const beforeUrl = window.location.href;
    exactSave.element.scrollIntoView({ block: "center", inline: "center" });
    exactSave.element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    exactSave.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
    exactSave.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
    exactSave.element.click();
    await sleep(2500);
    return {
      ok: true,
      mode: "button.click",
      buttonText: exactSave.text,
      beforeUrl,
      afterUrl: window.location.href,
      title: document.title,
    };
  }
  if (saveShaped.length > 0) {
    // Save-shaped controls exist but none carries the exact draft label
    // (e.g. "Save & Submit", "Save and Send"). Refuse: clicking any of them,
    // or firing scope.saveTimesheet() on a page shaped like this, could
    // submit. A human decides.
    fail("ambiguous_save_control", {
      reason: "no exact Save / Save Draft control; save-shaped candidates may carry submit semantics",
      candidates: saveShaped.map((candidate) => candidate.text).slice(0, 30),
    });
  }
  // No save-shaped button at all: guarded Angular-scope fallback.
  const angularRef = window.angular;
  const tried = [];
  const callSave = async (scope, source) => {
    const beforeUrl = window.location.href;
    let result;
    if (typeof scope.$apply === "function") {
      const root = scope.$root || scope;
      result = root.$$phase ? scope.saveTimesheet() : scope.$apply(() => scope.saveTimesheet());
    } else {
      result = scope.saveTimesheet();
    }
    await sleep(2500);
    return {
      ok: true,
      mode: "scope.saveTimesheet",
      source,
      resultType: typeof result,
      promiseLike: Boolean(result && typeof result.then === "function"),
      beforeUrl,
      afterUrl: window.location.href,
      title: document.title,
    };
  };
  if (angularRef && angularRef.element) {
    const elements = [document.body, ...Array.from(document.querySelectorAll("form,[ng-controller],[ng-repeat],div,button,a")).slice(0, 600)];
    const seenScopes = new Set();
    for (const element of elements) {
      let scopes = [];
      try {
        const wrapped = angularRef.element(element);
        scopes = [wrapped.scope && wrapped.scope(), wrapped.isolateScope && wrapped.isolateScope()].filter(Boolean);
      } catch (error) {
        tried.push({ source: element.tagName?.toLowerCase() || "element", error: String(error).slice(0, 120) });
      }
      for (const scope of scopes) {
        let current = scope;
        for (let depth = 0; current && depth < 10; depth += 1, current = current.$parent) {
          if (seenScopes.has(current.$id)) continue;
          seenScopes.add(current.$id);
          const keys = Object.keys(current).filter((key) => /save/i.test(key)).slice(0, 10);
          tried.push({ source: element.tagName?.toLowerCase() || "element", scopeId: current.$id, keys });
          if (typeof current.saveTimesheet === "function") {
            // Fail closed: a scope that also exposes submit-shaped methods
            // gives no proof saveTimesheet is draft-only. Refuse rather than
            // call a method that may save-and-submit.
            const submitShapedKeys = Object.keys(current).filter(
              (key) => typeof current[key] === "function" && isSubmitShaped(key),
            );
            if (submitShapedKeys.length > 0) {
              fail("ambiguous_save_scope", {
                reason: "scope exposing saveTimesheet also exposes submit-shaped methods; cannot prove draft-only",
                scopeId: current.$id,
                submit_shaped_keys: submitShapedKeys.slice(0, 10),
                tried: tried.slice(0, 60),
              });
            }
            return callSave(current, `${element.tagName?.toLowerCase() || "element"}:scope:${current.$id}`);
          }
        }
      }
    }
  }
  fail("missing_saved_state", {
    buttons: buttons.map((button) => button.text).filter(Boolean).slice(0, 30),
    tried: tried.slice(0, 80),
  });
}
