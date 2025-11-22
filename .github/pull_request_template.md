## Pull Request Checklist

Please fill out this checklist before requesting a review.

- [ ] **PR summary**: Provide a short description of what this PR changes and why.
- [ ] **Related issues**: Link any related issues, tickets, or MIGRATION_PLAN entries.

### Migration & Parity (MANDATORY)
- [ ] **Legacy Reference**: I have analyzed `app.py` to ensure the new logic matches the original intent (business logic, filtering, prompts).
- [ ] **Do not remove `app.py`**: Confirmed that `app.py` is still present as a static reference.
- [ ] **Parity Verification**: Document how you ensured the new feature matches the legacy behavior (e.g., "Checked that Gemini prompt structure matches line 150 in app.py").

### Functional Validation
- [ ] **Run New Stack**: Ran `npm run dev` from the project root (starts both Backend & Frontend).
- [ ] **Manual Testing**: Verified the feature in the browser (http://localhost:5173).
- [ ] **Test Steps**: Listed step-by-step manual test instructions for the reviewer below.

### Code Quality & Type Safety
- [ ] **TypeScript Check**: Ran `npm run build` in both `/backend` and `/frontend` to ensure no type errors.
- [ ] **Linting**: Ran linters (if configured) and fixed style issues.
- [ ] **Env Variables**: If new env vars are required, added them to `.env.example` (never commit secrets!).

### CI / Security
- [ ] **No Secrets**: Confirmed no sensitive values (API keys, passwords) are present in the code diff.
- [ ] **Language Rule**: Verified that all **Code** and **UI Text** are in English.

### Reviewer sign-off
- [ ] **Migration Logic**: Reviewer confirms that the TypeScript implementation correctly reflects the intent of the legacy Python code.

If this checklist is not fully completed, add a clear justification for any unchecked items in the PR description.