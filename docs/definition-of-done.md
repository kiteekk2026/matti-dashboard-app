# Definition of Done

The Definition of Done (DoD) is the checklist every issue must pass before you move it to **Done**. It is the same for every issue, so you don't have to guess when you're finished.

The acceptance criteria in an issue tell you **what** to build. The DoD tells you **how finished** it has to be.

## The checklist

An issue is done when:

1. **Acceptance criteria met.** You have checked every criterion in the issue by hand in the running app.
2. **It builds.** `pnpm build` passes with no type errors.
3. **Database changes are migrations.** Any schema change (a table, a column, a constraint, an RLS policy) is a file in `supabase/migrations/`. Running SQL by hand in the SQL editor is not enough.
4. **Failure paths are handled.** Forms show field errors and keep what the user typed. Lists have an empty state. Slow pages have a loading state. Errors land in an error boundary, not a blank page.
5. **Accessible basics.** Every input has a label. Error messages are linked to their fields with `aria-describedby`. You can use the page with the keyboard only.
6. **Reviewed and merged.** The PR links the issue (`Closes #N`), someone other than you has reviewed it, and it is merged to `main`.
7. **Deployed and checked.** You have opened the deployed site and seen the change working there, not only on `localhost`.
8. **Board updated.** The issue is closed and in the **Done** column.

## Why these items?

- **Items 3 and 7** catch "it works on my laptop" problems. If a change only exists in your local database or your local branch, your teammates and your users don't have it.
- **Item 4** is where most of the work in a real app goes. The happy path is the easy part.
- **Item 6** means two people understand every piece of code, not just one.

## Not done yet?

If you can't meet an item, say so in the PR description and explain why. For example: "No migration needed, this change is UI only." Leaving the item out without a note does not count.
