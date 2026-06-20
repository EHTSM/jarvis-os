## Summary

<!-- 2-3 bullet points — what does this PR do and why? -->

-
-

## Type of change

- [ ] Bug fix (non-breaking change that fixes an issue)
- [ ] New feature (non-breaking change that adds functionality)
- [ ] Breaking change (fix or feature that would cause existing functionality to break)
- [ ] Documentation update
- [ ] Chore (dependencies, config, refactor)

## Related issues

Closes #<!-- issue number -->

---

## Testing

- [ ] `npm run test:runtime` passes — **144/144** (paste output below)
- [ ] `npm run build:frontend` succeeds with no errors
- [ ] I tested the affected feature manually in the app
- [ ] I tested the golden path AND edge cases

<details>
<summary>Test output</summary>

```
paste npm run test:runtime output here
```

</details>

---

## Screenshots / recordings

<!-- For UI changes: before and after screenshots or a short screen recording -->
<!-- Delete this section if not applicable -->

| Before | After |
|---|---|
| | |

---

## Checklist

- [ ] My commit messages follow the [Conventional Commits](../CONTRIBUTING.md#commit-format) format
- [ ] I have not committed `.env`, credentials, or secrets
- [ ] I have not introduced `window.confirm()`, `window.alert()`, or `window.prompt()`
- [ ] I have not added a new runtime engine, scheduler, or database
- [ ] New backend services use `.cjs` extension and `"use strict"`
- [ ] All new API routes use `requireAuth` middleware
- [ ] I have updated documentation if my change affects public behavior
- [ ] I have added or updated tests for my change

---

## Breaking changes

<!-- If this PR includes breaking changes, describe what breaks and how users should migrate. -->
<!-- Delete this section if no breaking changes. -->

**Breaking:**

**Migration:**

---

## Deployment notes

<!-- Does this PR require any environment changes, data migrations, or deployment steps? -->
<!-- Delete this section if none. -->
