# Court Context auth email templates

Source copies for the Supabase Auth dashboard. Supabase Auth still creates and validates the links. These files are not sent by the application.

Paste each file into the matching Supabase template after Resend SMTP is configured:

| File | Supabase template | Status |
| --- | --- | --- |
| `confirm-signup.html` | Confirm signup | Required now |
| `reset-password.html` | Reset password | Required now |

Do not enable Magic Link, Invite, or Change Email templates from this folder. The app does not use those flows.

## Variable

Both templates use only `{{ .ConfirmationURL }}`.

That variable is the Supabase verify link. The app already sets `redirect_to` to `{origin}/auth/callback` (signup `next`, or password recovery `next=/update-password`). Do not append query parameters to `{{ .ConfirmationURL }}`, and do not replace it with a `{{ .TokenHash }}` link. A custom hash link would add a second callback the certified flow does not use.

`{{ .Token }}` and `{{ .TokenHash }}` are documented by Supabase and are intentionally unused here.

Dashboard labels can differ from this table. Match by purpose: signup confirmation and password recovery.
