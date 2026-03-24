/**
 * Fill the passcode field on a Zoom recording passcode gate page.
 *
 * Expected global: window.__ZOOM_PASSCODE__ = "the-passcode-string"
 *
 * Fills the passcode input and clicks "Access Recording".
 * The caller should verify the page redirects to /rec/play/ after execution.
 *
 * Return shape: { ok: boolean, reason?: string }
 */
(() => {
  const passcode = window.__ZOOM_PASSCODE__;

  if (!passcode) {
    return { ok: false, reason: "missing_passcode" };
  }

  // Find the passcode input field
  let input = document.querySelector("input#passcode");
  if (!input) {
    input = document.querySelector("input[type='password']");
  }
  if (!input) {
    // Try by placeholder or aria-label
    const inputs = Array.from(document.querySelectorAll("input"));
    input = inputs.find(
      (i) =>
        (i.placeholder && i.placeholder.toLowerCase().includes("passcode")) ||
        (i.getAttribute("aria-label") &&
          i.getAttribute("aria-label").toLowerCase().includes("passcode"))
    );
  }

  if (!input) {
    return { ok: false, reason: "passcode_input_not_found" };
  }

  // Fill using native input value setter for React/Vue compatibility
  const nativeSetter = Object.getOwnPropertyDescriptor(
    HTMLInputElement.prototype,
    "value"
  ).set;
  nativeSetter.call(input, passcode);
  input.dispatchEvent(new Event("input", { bubbles: true }));
  input.dispatchEvent(new Event("change", { bubbles: true }));

  // Find and click "Access Recording" button
  const buttons = Array.from(document.querySelectorAll("button"));
  const accessBtn = buttons.find(
    (b) => b.textContent && b.textContent.trim().includes("Access Recording")
  );

  if (!accessBtn) {
    return { ok: false, reason: "access_button_not_found" };
  }

  accessBtn.click();

  return { ok: true };
})();
