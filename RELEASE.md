# WelcomeBnB — Release & Rollback Playbook

This document explains how to ship a version, how to mark versions you might
want to return to, and how to roll back fast if something breaks in
production. Keep it in the repo root alongside `CHANGELOG.md`.

The golden rule: **you should always be able to get back to a known-good
version in under a minute.** You have three independent ways to do that,
listed below from fastest to most surgical.

---

## TL;DR — "Production is broken, get me back NOW"

1. Go to **vercel.com → your project → Deployments**
2. Find the last deployment that worked (they're timestamped, with the commit message)
3. Click the **⋯** menu on that row → **Promote to Production**
4. Live site reverts in ~10 seconds. Byte-perfect. No Git needed.

That's the emergency button. Everything below is about doing this cleanly
and deliberately rather than in a panic.

---

## The three fallback mechanisms

### 1. Vercel deployment rollback (fastest, no skill needed)

Every push to GitHub creates a Vercel deployment, and **every past
deployment stays live and can be promoted back to production**.

- **Where**: vercel.com → project → Deployments tab
- **How**: ⋯ menu on any deployment → "Promote to Production"
- **Speed**: ~10 seconds
- **Precision**: byte-perfect — it redeploys exactly what was there
- **Use when**: something is broken right now and you need it fixed immediately

The only catch: the deployment list shows commit messages, so they're only
as readable as your commit messages are. Which is why step 2 matters.

### 2. Git tags (best for marking versions you care about)

A tag is a permanent, named bookmark on a specific commit. Unlike scrolling
through 200 commits trying to remember which one was "the good one before
the rebrand", a tag is a label you choose: `v19.5-warm`, `v20-blue`, etc.

- **Create one**: see "How to tag" below
- **Return to one**: `git checkout v19.5-warm`
- **Use when**: you want to deliberately go back to a known release, or branch a fix off an old version

Tag the versions that are *meaningful* — a finished feature set, a release
you demoed to someone, the state right before a risky change. You don't need
to tag every commit; tag the ones you'd be sad to lose.

### 3. Git history (always there, most surgical)

Every commit is a restore point even without a tag.

- **Find one**: `git log --oneline` (shows commit hashes + messages)
- **Restore one file**: `git checkout <hash> -- index.html`
- **Restore everything**: `git checkout <hash>` (detached HEAD — make a branch if you want to keep working from there)
- **Use when**: you need just one file from an old version, or a tag doesn't exist for the point you want

---

## Standard release workflow

Do this at the end of every working session where something changed:

```bash
# 1. See what changed
git status

# 2. Stage the changed files
git add index.html host-console.html admin.html CHANGELOG.md
#    (or `git add .` to stage everything)

# 3. Commit with a clear message — this message is what you'll see in
#    Vercel's deployment list, so make it count
git commit -m "Round 20: blue palette rebrand across all three apps"

# 4. Push to GitHub → Vercel auto-deploys
git push
```

**Commit message convention**: start with the round number from the
CHANGELOG, then a short description. Examples:
- `Round 19.4: host-side booking dismissals`
- `Round 20: blue palette rebrand`
- `Hotfix: Mauritius country code in Alloggiati export`

This makes the Vercel deployment list line up with the CHANGELOG, so
finding "the version before X" is trivial.

---

## How to tag a release

A tag marks the current state so you can return to it by name later.

### Tag the version you're on right now

```bash
# Create an annotated tag (the -a and -m give it a message)
git tag -a v19.5-warm -m "Last warm-palette version before the blue rebrand"

# Push the tag to GitHub (normal `git push` does NOT push tags)
git push origin v19.5-warm
```

That's it. The tag now exists on GitHub and points permanently at whatever
commit you were on when you ran it.

### Tag naming convention (suggested)

`v<round>-<label>` — for example:
- `v19.5-warm` — last warm-palette version
- `v20-blue` — the blue rebrand
- `v21-prearrival` — when pre-arrival messaging ships

Keep it short and meaningful. The label reminds future-you what's special
about that version.

### See all your tags

```bash
git tag                    # list all tags
git show v19.5-warm        # see what commit + message a tag points to
```

### Return to a tagged version

```bash
# Look at it (read-only, "detached HEAD")
git checkout v19.5-warm

# If you want to actually work from it / make it the new current state,
# branch off it:
git checkout -b rollback-to-warm v19.5-warm
# ...then push that branch and deploy it, or merge it into main
```

### Tagging on GitHub's website (no command line)

If you'd rather not use the terminal:

1. Go to your repo on github.com
2. Click **Releases** (right sidebar, or `/releases` on the repo URL)
3. Click **Draft a new release**
4. Under **Choose a tag**, type a new tag name (e.g. `v20-blue`) → **Create new tag**
5. Pick the target (defaults to your latest commit on the main branch)
6. Give it a title and notes (you can paste the relevant CHANGELOG section)
7. Click **Publish release**

This creates the tag *and* a GitHub Release page documenting it — slightly
nicer than a bare tag because you get a description and it shows up under
"Releases" for easy browsing.

---

## Recommended habit

1. **Commit + push after every session** with a clear, round-numbered message.
2. **Tag the meaningful releases** — finished features, demoed versions, pre-risky-change snapshots.
3. **Before any large or risky change** (rebrand, big refactor, schema migration that's hard to reverse), tag the current good state first. Then if the change goes wrong, rollback is one `git checkout` or one Vercel promote away.

You do **not** need to keep manual backup copies of files — Git history +
Vercel deployments already preserve every version far more reliably than
copies-with-timestamps ever could.

---

## Note on database migrations

The rollback mechanisms above cover **code** (the three HTML files, the API
endpoints). They do **not** roll back database schema changes.

If a release included a SQL migration (a new column, table, or policy),
rolling the *code* back to before that migration is usually fine — extra
columns/tables sitting unused don't break older code. But if you ever need
to reverse a migration itself, that's a separate manual step in the Supabase
SQL editor (drop the column/table/policy). Migrations are additive by design
in this project precisely so that code rollback stays safe without needing
to touch the database.

When in doubt: rolling back code is safe; rolling back the database needs a
deliberate reverse-migration. Most of the time you only need the former.
