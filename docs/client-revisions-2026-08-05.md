# Client revisions — 2026-08-05

**Status: DONE and LIVE on staging + prod (`37671e2`). NO migration** — 64/64 unchanged on both. The
`invoice-pdf` edge function was redeployed to **both** environments (G-3 changed it, and it does not ship
with the Vercel build).

Elizabeth's reply to the F-1 deploy confirmation. **Two items**, sent from her phone at 3:33 p.m.

Source: Gmail thread *"LenderMatch — July 30 revisions are live"*, Elizabeth Iginla → Ivan + Bonnie,
2026-08-05 15:33, one inline screenshot of the lender header.

Previous batches: [07-20](./client-revisions-2026-07-20.md) · [07-27](./client-revisions-2026-07-27.md) ·
[07-23-and-25](./client-revisions-2026-07-23-and-25.md) · [07-28](./client-revisions-2026-07-28.md) ·
[07-30 + F-1](./client-revisions-2026-07-30.md).

---

## Status at a glance

| ID | Item | Verdict |
|---|---|---|
| **G-1** | The lender portal's top navigation is gone | ✅ Done — pre-existing, NOT caused by F-1 |
| **G-2** | No way to view the generated invoices from the admin section | ✅ Done — no migration needed |
| **G-3** | *(found while doing G-2)* The invoice PDF's issue date changes on every view | ✅ Done — edge fn redeploy |

**No migration.** G-1 and G-2 are client-side; G-3 is one line in the `invoice-pdf` edge function.

---

## G-1 · The lender navigation disappeared

> I was just looking at the lender portal, and it seems that the header is gone. It no longer says
> submitted offers, deals, invoices etc. at the top. Not sure what happened here, maybe when you removed
> the red notification from "submitted offers"???

### It was not F-1, and that matters for the reply

Her guess is reasonable — she had just been told that Submitted Offers changed — but the F-1 diff on
`components/lender-header.tsx` touched exactly two things: a comment, and one key in the unread-dot map
(`submittedOffers:` → `newDeals:`). The `<nav>` element was not modified. `git diff 1ffe36d..515dd68 --
components/lender-header.tsx` is four lines and shows this outright.

### The real cause, and it predates everything

`components/lender-header.tsx:55` carried `hidden xl:flex`. Below **1280px** the entire nav is
`display: none` — and there was **nothing behind it**. Measured in the browser on staging:

```
navClasses  "hidden xl:flex items-center justify-center gap-0.5 flex-1 overflow-x-auto"
navItems    New Deals · Submitted Offers · Maturing Deals · Messages · Invoices · FAQ's · Contact Us
```

All seven links were present in the DOM the whole time — a lender on a 1280-or-narrower screen simply
could not see or reach any of them. The logo and the settings gear were the only navigation left.

### Every portal had the same hole, in a different shape

This is why the fix is not a one-line breakpoint change. An exhaustive grep found **no fallback
navigation anywhere in the app** — no hamburger, no drawer, no select, in any of the three headers:

| Portal | Before | Consequence |
|---|---|---|
| Lender | `hidden xl:flex` — hidden below **1280px** | what she reported |
| Broker | `hidden md:flex` — hidden below **768px** | same bug, milder; nobody had hit it yet |
| Admin | no `hidden` at all, and no `overflow-x-auto` | the opposite failure: 6 wide entries squash and overflow instead of hiding |

### The fix

New shared **`components/nav-menu.tsx`** — a left-side `Sheet` holding the same links, mounted in all
three headers, following the in-repo precedent in `deal-filters-sidepanel.tsx`. Admin's bar also gains
`hidden xl:flex` so it stops squashing.

**The rule this encodes: a responsive breakpoint may only ever MOVE navigation, never remove it.** The
caller passes the exact complement of its own `<nav>` breakpoint as `triggerClassName` (`xl:hidden`
against `hidden xl:flex`), so the two are inverses and no viewport width can fall through the gap between
them.

Three deliberate decisions:

- **The bell is not duplicated inside the sheet.** It owns a Realtime subscription on a fixed topic, so a
  second mounted instance would collide with the header's — which is precisely bug (d) of F-1, three days
  old. The sheet shows only links.
- **`NavUnreadDot` gained an `inline` variant** rather than a second dot being written. One component, so
  the colour lives in one place. The inline variant drops `ring-card`: the sheet is `bg-background`, and
  the card-coloured ring would draw a visible halo there.
- **Admin's dropdown groups flatten into titled sections** (REPORTS / MANAGE / CONTENT). 15 destinations
  overflow a dropdown on a short viewport; the sheet scrolls.

One new i18n key, `common.menu`, in both catalogs — no "Menu"-style string existed anywhere in
`messages/`.

---

## G-2 · Viewing the generated invoices from the admin portal

> There also doesn't seem to be a way to view the invoices in the admin section. Is there a way to make it
> so we can see the actual invoices that have been generated?

Correct, and it was a smaller gap than it looks.

### No migration, no edge-function change — the permission was already there

The `invoice-pdf` edge function performs **no role check of its own**. It fetches the invoice with the
**caller's** JWT and lets RLS decide (`supabase/functions/invoice-pdf/index.ts:158-167`), and
`invoices_admin` is `for all to authenticated using (is_admin())` (migration 03). So an admin's `select`
resolves and the function renders, uploads and signs exactly as it does for the owning lender. The
lender's own `downloadInvoicePdf` helper works unchanged.

### What was actually missing, and the trap inside it

`/admin/invoices` never offered the action. And adding it was not a one-line append, because **the entire
`RowActions` was wrapped in `i.status === 'pending'`** — paid and cancelled rows rendered an empty actions
cell. Dropping a View entry into the array would have left it invisible on exactly the invoices an admin
most wants to open.

The menu now renders unconditionally and *Mark paid* is the conditional entry (`RowActions` already
filters falsy entries and returns `null` when none survive). **View is offered on every row on purpose** —
this is the oversight screen, and a cancelled or paid invoice is exactly the kind of record an admin needs
to reach.

Two new keys, `admin.invView` / `admin.invPdfError`, rather than reaching across into the lender's
`invoices` namespace.

---

## G-3 · The invoice PDF's issue date was the render date

Found while wiring G-2, not reported.

`supabase/functions/invoice-pdf/index.ts:102` printed:

```ts
row("Issue date", new Date().toISOString().slice(0, 10))
```

The function **re-renders and upserts the stored PDF on every single view** — it never reads `pdf_path` as
a cache. So the same invoice showed a different issue date each time anyone opened it, on a financial
document whose due date is a fixed `closing_date + 21 days`.

G-2 made this materially worse: an admin opening an invoice would silently rewrite the stored file with
today's date, changing what the lender had already downloaded. Now it uses `invoices.created_at`, which
also had to be added to the function's `select`.

⚠️ **Verifying this needs a backdated row.** The first check looked green and proved nothing: the seeded
invoice was created the same day, so the bug and the fix both print today. Set `created_at` to an earlier
date and the two answers separate — the fixed function printed `2026-07-11` against a render date of
`2026-08-05`.

---

## Verification

Browser-driven locally against seeded fixtures (one invoice per status — pending, paid, cancelled — since
the whole point of G-2's trap is the non-pending rows):

| Check | Result |
|---|---|
| Compact menu structure (admin) | ✅ 3 flat links + REPORTS / MANAGE / CONTENT, all 15 destinations |
| Active page highlighted in the menu | ✅ "Invoices" while on `/admin/invoices` |
| Closes on navigate | ✅ the manual `setOpen(false)` — client-side nav fires no unmount |
| Compact menu (lender) | ✅ 7 items; New Deals active **and** carrying the inline unread dot |
| F-1 still holds inside the menu | ✅ Submitted Offers has no dot there either |
| Actions on all three invoice rows | ✅ cancelled / paid / pending — previously pending only |
| Mark paid still conditional | ✅ absent on cancelled and paid |
| Admin opens the PDF | ✅ generated + signed under the admin session, no migration |
| Issue date | ✅ `2026-07-11` from a backdated `created_at`, not the render date |

`pnpm check` clean (0 errors, EN/FR parity at 1653 keys each, 19 unit tests) and `pnpm build` compiles.

⚠️ **Not verified by resizing the browser.** The driven Chrome tab renders at a fixed width and ignores
`resize_window` — `window.innerWidth` stayed 1920 through every attempt. The menu was exercised by
stripping its `xl:hidden` class at runtime, which tests the component itself (contents, active state,
dots, close-on-navigate) but not the Tailwind breakpoint arithmetic. That arithmetic is a static class
pair and was confirmed by reading the computed `display` against `matchMedia('(min-width:1280px)')`.

---

## Note for the reply

Worth telling her plainly that G-1 was **not** caused by the notification change she suspected — it was a
pre-existing responsive bug that had been there since the header was written, and she is simply the first
person to use the portal on a narrower screen. Being specific here is better than a bare "fixed": she
proposed a cause, and leaving it uncorrected would leave her with a wrong model of what the F-1 change
touched.
