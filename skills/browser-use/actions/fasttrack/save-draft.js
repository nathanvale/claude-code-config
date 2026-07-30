async () => {
  const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const normalize = (value) => String(value || "").replace(/\s+/g, " ").trim();
  const fail = (reason, extra = {}) => {
    throw new Error(JSON.stringify({ reason, ...extra }).slice(0, 2000));
  };
  const editRows = () => Array.from(document.querySelectorAll("tr[ng-repeat]")).filter((row) =>
    row.querySelector("[ng-model='rxg.startDateTime']") ||
    row.querySelector("[ng-model='rxg.endDateTime']") ||
    row.querySelector("[ng-model='rxg.attendanceTypeId']")
  ).length;
  if (editRows() < 5) {
    fail("readback_unavailable", { title: document.title, url: location.href });
  }
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
            return callSave(current, `${element.tagName?.toLowerCase() || "element"}:scope:${current.$id}`);
          }
        }
      }
    }
  }
  const buttons = Array.from(document.querySelectorAll("button,input[type='button'],input[type='submit'],a")).map((element) => ({
    element,
    text: normalize(element.innerText || element.value || element.textContent || element.getAttribute("title") || element.getAttribute("aria-label") || ""),
  }));
  const save = buttons.find((candidate) => /^save$/i.test(candidate.text) || /^save\b/i.test(candidate.text));
  if (!save || !save.element) {
    fail("missing_saved_state", { buttons: buttons.map((button) => button.text).filter(Boolean).slice(0, 30), tried: tried.slice(0, 80) });
  }
  const beforeUrl = window.location.href;
  save.element.scrollIntoView({ block: "center", inline: "center" });
  save.element.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
  save.element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true, view: window }));
  save.element.dispatchEvent(new MouseEvent("mouseup", { bubbles: true, cancelable: true, view: window }));
  save.element.click();
  await sleep(2500);
  return { ok: true, mode: "button.click", buttonText: save.text, beforeUrl, afterUrl: window.location.href, title: document.title };
}
