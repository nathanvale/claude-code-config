# Chrome DevTools Patterns — DevExtreme/React

Reference doc for interacting with DevExtreme and React components via Chrome DevTools MCP.
These patterns were discovered during POS-3044 QA verification and encode all known gotchas.

## Pattern Index

| # | Pattern | Problem | Solution |
|---|---------|---------|----------|
| 1 | Virtual lists | DevExtreme SelectBox items not in a11y tree | `evaluate_script` to read `.dx-list-item` |
| 2 | Opening dropdowns | Click button child doesn't work | Click the combobox UID (not the button inside it) |
| 3 | Selecting items | `.click()` doesn't trigger React state | `mousedown` + `mouseup` + `click` events with `{ bubbles: true }` |
| 4 | Setting inputs | Direct value assignment bypasses React | Native input value setter + dispatch input/change events |
| 5 | Multiple overlays | Previous dropdown items bleed through | Query by overlay index: `.dx-overlay-wrapper[N]` |
| 6 | Ephemeral UIDs | UIDs change after any DOM update | Always take fresh snapshot before interaction |
| 7 | Snapshot > screenshot | Screenshots don't give interaction handles | Always `take_snapshot` first for UIDs |
| 8 | Wait after nav | React needs time to hydrate | Wait 2-3s before taking snapshots |
| 9 | Close popups | Body click may not fully close DX overlays | Navigate to page fresh between AC groups if needed |
| 10 | Disabled state | Need to verify enabled/disabled | Check `disableable disabled` in a11y tree or `dx-state-disabled` class |

---

## 1. Virtual Lists (DevExtreme SelectBox)

**Problem:** DevExtreme virtualizes dropdown items — only visible items exist in the DOM. The a11y tree from `take_snapshot` won't list all options.

**Solution:** Use `evaluate_script` to query the DOM directly:

```javascript
// Get all items in a DevExtreme SelectBox dropdown
const items = Array.from(document.querySelectorAll('.dx-list-item'));
items.map(el => ({
  text: el.textContent.trim(),
  disabled: el.classList.contains('dx-state-disabled')
}));
```

```javascript
// Get selected value of a DevExtreme SelectBox
const widget = document.querySelector('.dx-selectbox').dxSelectBox('instance');
widget.option('value');
```

---

## 2. Opening Dropdowns

**Problem:** DevExtreme wraps the clickable area in nested elements. Clicking the inner button element doesn't always open the dropdown.

**Solution:** Click the combobox container UID from the snapshot, not child elements:

```
// In snapshot, find the combobox role element:
// combobox "Distributor" [uid=abc123]
//   button [uid=def456]     ← DON'T click this
//
// Click abc123, not def456
```

Use `click` tool with the combobox UID directly.

---

## 3. Selecting Items from Dropdowns

**Problem:** Calling `.click()` on a DevExtreme list item doesn't trigger React state updates because synthetic click events don't bubble the same way.

**Solution:** Dispatch the full event sequence:

```javascript
// Select a DevExtreme dropdown item by text
function selectDxItem(text) {
  const items = document.querySelectorAll('.dx-list-item');
  const target = Array.from(items).find(el => el.textContent.trim() === text);
  if (!target) return false;

  target.dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new MouseEvent('mouseup', { bubbles: true, cancelable: true }));
  target.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
  return true;
}
selectDxItem('Distributor Name');
```

---

## 4. Setting Input Values

**Problem:** `input.value = 'x'` bypasses React's synthetic event system. The component doesn't re-render.

**Solution:** Use the native input value setter and dispatch events:

```javascript
// Set a React-controlled input value
function setReactInput(selector, value) {
  const input = document.querySelector(selector);
  if (!input) return false;

  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    window.HTMLInputElement.prototype, 'value'
  ).set;
  nativeInputValueSetter.call(input, value);

  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
  return true;
}
setReactInput('input[name="quantity"]', '50');
```

---

## 5. Multiple Overlays

**Problem:** DevExtreme creates a new `.dx-overlay-wrapper` for each dropdown/popup. Previous overlays may still be in the DOM, causing stale items to appear in queries.

**Solution:** Always target the most recent overlay:

```javascript
// Get the last (topmost) overlay wrapper
const overlays = document.querySelectorAll('.dx-overlay-wrapper');
const topOverlay = overlays[overlays.length - 1];
const items = topOverlay.querySelectorAll('.dx-list-item');
```

---

## 6. Ephemeral UIDs

**Problem:** Chrome DevTools snapshot UIDs change after any DOM mutation (navigation, dropdown open/close, form change). A UID captured 10 seconds ago may be invalid.

**Solution:** Always take a fresh `take_snapshot` immediately before any interaction:

```
// WRONG — stale UID
take_snapshot()     // uid=abc123 for button
// ... do other things ...
click(uid=abc123)   // MAY FAIL — uid changed

// RIGHT — fresh UID
take_snapshot()     // uid=xyz789 for button
click(uid=xyz789)   // Works — uid is current
```

---

## 7. Snapshot vs Screenshot

**Problem:** Screenshots give visual confirmation but no interaction handles. You can't click on elements identified in a screenshot.

**Solution:** Use `take_snapshot` for interaction planning (gives UIDs), `take_screenshot` for evidence capture:

```
// Workflow for each AC:
take_snapshot()     // Plan interactions — get UIDs
click(uid=...)      // Execute interaction
take_screenshot()   // Capture evidence
```

---

## 8. Wait After Navigation

**Problem:** React needs time to mount components, run effects, and fetch data after navigation. Taking a snapshot immediately after `navigate_page` gives incomplete or empty DOM.

**Solution:** Wait 2-3 seconds after navigation before taking snapshots:

```
navigate_page(url="https://localhost:44389/bulkprint/create")
// Wait for React to hydrate
evaluate_script("new Promise(r => setTimeout(r, 3000))")
take_snapshot()
```

---

## 9. Closing Popups / Stale Overlays

**Problem:** Clicking the body or pressing Escape doesn't always fully close DevExtreme overlays. Stale overlay DOM remains and interferes with subsequent interactions.

**Solution:** If interactions become unreliable after opening/closing multiple dropdowns, navigate to the page fresh:

```
// Nuclear reset — navigate to same page to clear all overlays
navigate_page(url="https://localhost:44389/bulkprint/create")
evaluate_script("new Promise(r => setTimeout(r, 3000))")
take_snapshot()
```

---

## 10. Checking Disabled State

**Problem:** Need to verify whether elements are enabled or disabled for AC verification.

**Solution:** Two approaches depending on context:

```javascript
// Via a11y tree (preferred — check snapshot output)
// Look for: combobox "Field" [uid=abc] disableable disabled
// or: button "Submit" [uid=def] disabled

// Via DOM query (for programmatic checks)
function isDisabled(selector) {
  const el = document.querySelector(selector);
  if (!el) return null;
  return el.disabled ||
    el.classList.contains('dx-state-disabled') ||
    el.getAttribute('aria-disabled') === 'true';
}
isDisabled('.dx-selectbox');
```

---

## General Tips

1. **Snapshot first, always.** Before any interaction, take a fresh snapshot.
2. **One interaction at a time.** Don't chain multiple clicks without re-snapshotting between them.
3. **Wait after state changes.** After clicking a dropdown item, wait 1-2s for React to re-render before snapshotting again.
4. **Use evaluate_script for complex checks.** The a11y tree is limited — for counting items, reading values, or checking complex state, use JS.
5. **DevExtreme class prefixes:** `.dx-` for DevExtreme, `.MuiXxx` for MUI components.
