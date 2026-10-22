# Trying out Kaki Home

A working first version of the Kaki Home idea, to try on a phone and to show. It runs in the phone's browser and can
be put on the home screen like an app. Plain words, for someone testing the idea rather than the code.

## Three ways to try it

1. **The demo** (nothing to set up, nothing saved): `https://kakihome.flamingbeing.com/?demo`. A made-up household of
   three (Mum, Dad and a helper) with a few months of history, so every screen has something to show.
2. **On one phone:** `https://kakihome.flamingbeing.com`. Everything you add stays on that phone.
3. **As a household:** Settings → Sign in with Google → Start our household → add each person's Gmail (family, helper,
   caregiver). Everyone then sees the same items and shopping list, live.

Put it on the home screen: iPhone, Safari → Share → Add to Home Screen; Android, Chrome → menu → Add to home screen.

## A 10-minute test

1. Tap the **microphone** on Home and say what you bought, for example "2 Meiji milk in the fridge expires 25 Oct and
   3 tins of sardines". Check the list it makes, untick anything wrong, tap Add.
2. Tap **+**, then **Scan barcode**, and scan something from the cupboard.
3. Open an item and tap **Used 1** when one is finished, or **Bin 1** when one is thrown away.
4. Look at **Home**: the four tiles, "Used before expiry this month", and what to use soon.
5. Open **Shopping**: things that are out, low or about to run out are already there. Share it to WhatsApp.

## The proposal's MVP, and what this version does

| MVP feature | In this version |
|---|---|
| Shared household, owner and members | Yes: Google sign-in; whoever starts it adds members and can remove them |
| Who added or changed an item | Yes: on each item and in its history |
| Central dashboard | Yes: items at home, expiring soon, low in stock, added this week; search and filter by place |
| Entry by barcode | Yes (Open Food Facts; unknown barcodes are remembered once named) |
| Entry by voice | Yes, with the phone's own speech-to-text and simple rules (no AI) |
| Entry by photo or receipt, AI classification | Not yet (needs a paid AI service). A photo can be attached to an item |
| Suggested storage location | Yes, from a list of about 190 common Singapore products |
| Expiry flags, configurable | Yes: "expiring soon" can be 3 days, 1 week or 2 weeks |
| Low-stock threshold per item | Yes |
| Push notifications | Not yet (needs a small server); Home and the shopping list show the same things when opened |
| Consumed / discarded / expired | Yes: Used 1, Bin 1; binning after the date counts as expired |
| Consumption summary | Yes: this month's used, used before expiry, bought, expired, thrown away; each item's monthly chart and pace |
| Shopping list from stock levels | Yes, including "will run out within a week at your usual pace" |
| AI recommendations | Simple rules instead: use-first order, run-out dates, the shopping list |

## The measures (section 4)

| Measure | Where to see it |
|---|---|
| North Star: household waste prevented | Home: **Used before expiry this month** (units used up while still in date) |
| Waste reduction | Home, This month: **Expired** and **Thrown away**, month by month |
| Items tracked | Home: **Items at home** |
| Expiry alerts actioned | Items in Use soon that then get Used 1 count towards "used before expiry" |
| Duplicate purchases prevented | Adding something already at home says so ("At home", or "adds to the one at home") |
| Active households, retention | Not measured: the app keeps no analytics. Ask testers instead |

Settings → Export as CSV gives a spreadsheet of what's in stock, and Back up gives everything as a file.
