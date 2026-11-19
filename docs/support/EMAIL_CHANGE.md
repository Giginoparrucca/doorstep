# Changing a host's login e-mail

Since 19 November 2026. Everything a host owns (properties, check-ins, trial and subscription, terms acceptance) belongs to the **account**, not to its e-mail, so changing the login e-mail keeps all of it.

## Which path

| Situation | What to do |
|---|---|
| The host can still open the current mailbox | **Self-service.** Host console → Impostazioni → «Email di accesso». Supabase sends a link to the new address and one to the current one; the change happens when both are opened. Nothing for support to do. |
| The host can no longer open the current mailbox (closed, hacked, ex-employee, ex-partner…) | **Assisted change** by an admin, after the identity check below. The host reaches us from the login page or Settings («Non hai più accesso alla tua email?»), by WhatsApp or e-mail, with the current and the new address. |
| The account must go to **another person** (property sold, new manager) | **Not an e-mail change.** The new person gets their own invitation and account and accepts the terms; the admin moves the properties to it. The old account keeps its history. |

## Identity check (assisted change)

The assisted change skips the e-mail confirmation, so it is the path someone would try to abuse. Do all of this before changing anything:

1. **Call back on a number already on file.** Utenti → «Gestisci» → «Email di accesso» lists the phone numbers of the host's properties. Call or message *that* number. Never use a number, e-mail or link given in the request.
2. **Ask for details only the host knows**, for example: the name and address of a property, a recent booking (dates, guest surname initial), the city of their Alloggiati account, when they joined.
3. **No number on file?** Use a second channel you already know from before (an existing WhatsApp chat with them, a known phone). If you cannot be confident, do not change it: ask the host to recover the old mailbox with their e-mail provider.
4. **Anything does not match**, or there is pressure to hurry: stop. Do not change it.

## Doing the change

Utenti → the host's row → «Gestisci» → «Email di accesso»:

1. type the new address and the reason (who asked, through which channel, how you checked);
2. tick the two checks («richiamato a un numero in archivio», «dettagli confermati»), which the server also requires;
3. confirm.

What happens:

- **Login.** The host signs in with the new address and their existing password. If they do not know it, they press «Password dimenticata?»; the link now goes to the new address.
- **Notices.** Both addresses get a notice. The one to the old address is the alarm if the request was not genuine.
- **Copies of the old address move automatically:** notification e-mail, property reminder and contact e-mails, invitation record. Addresses the host chose on purpose stay.
- **Records:**
  - the admin log stores the action, the account and fingerprints of both addresses;
  - the account history («Abbonamento» box) stores who, why, the checks and old → new;
  - every change, self-service included, is also listed there as «Email di accesso cambiata».

## If it was not genuine

The real owner writes after the notice to the old address. Then:

1. Check their identity with the same steps.
2. Change the e-mail back.
3. Ask them to set a new password.
4. Record it as a possible security incident (`docs/compliance/BREACH_SOP.md`).
