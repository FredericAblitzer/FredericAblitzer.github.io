# Changelog

## 0.54 — 2026-11-12

- After removing a component, select the previous component, or the next one if the first component was removed. Clear the selection when the list becomes empty.
- Avoid the "No mode defined" alert when removing the last component.
- Use the channel selected in PARAMETERS when loading a WAV file, falling back to the only available channel for mono files.
- Move the SAVE button below SELECTED.
- Highlight the corresponding component in Spectrum when hovering over a point in Graph view, and restore the list selection highlight when the pointer leaves the point.

## 0.53 — 2026-10-08

- Add an IMPORT COMPONENTS button to replace the current components with frequencies and damping ratios from a DAT file. Recalculate amplitudes from the loaded signal over the current identification window, ignoring amplitudes stored in the file.

## 0.52 — 2026-09-12
- Adapt font sizes, buttons, and spacing to smaller browser windows.
- Keep the Components list and graph visible with a minimum height.
- Enable scrolling in the left panel when controls exceed the available height.
- Widen the About dialog for improved readability.

## 0.51 — 2026-09-10
- Initial release.
