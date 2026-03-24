# Chrome Verify Gotchas

Append-only log of interaction patterns discovered during verification runs.
Read by chrome-verify on every invocation to avoid repeating mistakes.

Format for new entries:

```
## <ISO date>: <short description>
- **Component:** <component name>
- **Symptom:** <what went wrong>
- **Fix:** <what worked or what to try next time>
- **Ticket:** <KEY>, <AC ID>
```

## 2026-01-30: DX NumberBox value not settable via native input setter
- **Component:** dx-numberbox (spinbutton)
- **Symptom:** Using `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` + dispatching `input`/`change` events does not trigger React state update. DevExpress.ui.dxNumberBox.getInstance() returns null (not on window.DevExpress in CRA dev mode).
- **Fix:** Use `document.execCommand('insertText', false, '<value>')` after `input.focus()` and `input.select()`. This triggers DX's internal keydown/input handlers and propagates to React state. Must target `input.dx-texteditor-input` inside the `.dx-numberbox` container.
- **Ticket:** POS-3044, AC9

## 2026-01-30: DX SelectBox dropdown items not in a11y tree
- **Component:** dx-selectbox / dx-lookup (combobox with listbox)
- **Symptom:** After opening a DX dropdown, `take_snapshot` shows `listbox "Items"` with no children — DX uses virtual rendering so items don't appear in the a11y tree.
- **Fix:** Use `evaluate_script` to query `.dx-dropdownlist-popup-wrapper` overlays and read `.dx-item` / `[role="option"]` elements directly from the DOM. Always target `overlays[overlays.length - 1]` for the current dropdown.
- **Ticket:** POS-3044, AC1
