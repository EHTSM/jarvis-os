# LOW-TECH OPERATOR SURVIVABILITY.md

- Touch targets ≥ 44 px; meet WCAG 2.1 AA (≥ 2 cm²).  
- Font size ≥ 12 pt for warnings and instructions; high contrast colors (≥ 4.5:1).  
- Audio cues (e.g., beep on success) optional; fallback to visual toast.  
- No complex gestures required; all actions via single tap or click.  
- Onboarding text written at 8th‑grade reading level; plain language examples.  
- Error toast uses large, high‑contrast text; includes simple “What to do next” steps.  
- Progress bars and spinners use simple indeterminate animation; no undocumented wait states.  
- Confirmation dialogs use plain language and single button (e.g., “OK”) to proceed.  
- Mobile form fields labeled clearly; placeholder text replaced with explicit instructions.  
- All icons paired with text labels or ARIA labels for screen readers.  
- No hidden menus or swipes required for core actions.

## Findings
- Touch targets meet size guidelines, but the color contrast on the warning banner is 3.8:1, below the 4.5:1 threshold.
- Audio cues are present but lack a mute toggle, which can be disruptive for operators in quiet environments.
- The onboarding text meets grade level, yet the “price” example still uses the `₹` prefix without clarification, causing occasional input errors.

## Recommendations (Minimal Impact)
- Increase warning banner contrast to ≥ 4.5:1.
- Add a mute toggle for optional audio cues.
- Add a small “?” tooltip next to the price field explaining the required format.
- Ensure all confirmation dialogs include a clear “Cancel” option alongside the primary action.
