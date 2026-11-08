# FridgeChef

A mobile app that takes away the daily "what do I make?" decision. It knows what's in your
fridge, what's about to expire, and what you like, and tells you what you can cook tonight.

Built with **React Native + Expo** (iOS and Android from one codebase), on-device SQLite,
and Claude for fresh recipe ideas.

## What works today (Phase 1)

- **Quick add:** type `2 onions, milk, half a bag of spinach, a dozen eggs` and it's parsed.
- **Estimated expiry dates:** based on the type of food and where it's stored (fridge,
  freezer, or pantry). Shown as `~3 days`. Tap an item to enter the printed date instead.
- **Partial amounts:** "used half" an onion leaves ½ onion, and suggestions favor finishing it.
- **Tonight screen:**
  - Ranks what you can make, putting food that's about to expire first.
  - Filters: 15/30/45 minutes, 2- or 3-ingredient recipes, and "can buy 1–3 more" ingredients.
  - "No recipe needed" ideas (sandwiches, quesadillas, and so on).
  - "Freeze it" for meat that's about to turn.
  - "Worth picking up": the one ingredient that unlocks the most recipes.
  - "You might like": like onions → try shallots, with the reason.
- **I made this:** removes the ingredients from your food list after you confirm.
- **Star ratings, likes, dislikes:** these shape the ranking. **Allergies** are a hard filter,
  and groups like dairy, gluten, and nuts are expanded to the foods that contain them.
- **Staples** (salt, oil, ...) are assumed on hand and don't count toward ingredient limits.
- **Nightly reminder** at a time you choose, listing food within your X-day window.
- **AI ideas (optional):** "Get fresh ideas" sends your food list and taste profile to Claude
  through the server in `server/`. It suggests creative combinations and cheaper versions of
  your favorite restaurants' dishes, then checks the results against your allergies again.

## Phase 2

- **Shopping list tab:**
  - Add items by typing, from a recipe ("Add 2 missing to shopping list"), from Tonight's
    "Worth picking up", or from meal prep.
  - Suggestions explain themselves: foods you regularly use up and are out of, ingredients
    that unlock the most recipes, and new foods you'd likely enjoy. Allergens are never suggested.
  - Check items off at the store, then tap **Home from the store** to move them into My Food.
- **Lighter / Classic / Hearty** on every recipe, with rough calories per serving:
  - Lighter swaps ingredients (beef → turkey, cream → Greek yogurt, and so on), cuts cheese
    back, and bulks the dish up with vegetables.
  - Hearty doubles the protein and adds toppings.
  - It never adds an allergen. It never sends you shopping for a swap: if you have the
    original ingredient, it keeps it and suggests a smaller portion.
- **Restaurant copycats:** cheaper homemade takes on dishes from Chipotle, Panera,
  Chick-fil-A, Taco Bell, Panda Express, and Starbucks. When a restaurant is in your
  favorites, they rank higher and show the savings per serving.
- **Leftovers:** after "I made this," say how many servings are left. Tonight shows
  "Eat your leftovers first" with a 4-day expiry and an "Ate one" button. Leftovers never
  count as raw ingredients.
- **Meal prep planner** ("Cooking for the week?" on Tonight):
  - Choose 2–5 dishes, how much you're willing to buy, and whether to make double batches.
  - It picks dishes with different proteins that use up expiring food, without counting the
    same food twice.
  - It shows total servings, a cooking order (longest dish first), and a combined shopping
    list.
- **AI ideas** take a Lighter/Classic/Hearty style too.

## Phase 3

- **Scan groceries** (My Food → "Scan barcode or receipt"):
  - **Barcode:** point the camera at the package (or type the number). The product is
    looked up in [Open Food Facts](https://world.openfoodfacts.org), a free food database
    that needs no API key. You get the product name, a better expiry estimate based on its
    category, and nutrition per 100 g.
  - **Receipt:** take a photo and Claude reads it on your server. It expands
    abbreviations ("BNLS CHKN BRST" → chicken breast) and skips non-food lines. You
    untick anything you don't want, then add the rest in one tap.
- **Recipes from your favorite sites** ("Find recipes on your sites" on Tonight):
  - Import any recipe by pasting its link. Most recipe sites publish structured recipe
    data. The app saves a summary (ingredients matched against your fridge, steps,
    time, servings) and always links back to the original.
  - Add favorite sites on the Taste tab. **Search my sites for me** uses Claude web
    search, limited to only those sites, to find recipes that use what's expiring.
    Results are checked so every link really points to one of your sites. There are also
    plain search links for each site, which work without AI.
- **Nutrition:** rough calories, protein, carbs, and fat per serving for every recipe and
  version.
  - A **goal** (cut / maintain / bulk) on the Taste tab sets the default recipe version.
  - An optional daily **protein target**, plus a "Today: ≈1,450 kcal · 98 g protein of
    130 g" line on Tonight based on the meals you log with "I made this".
- **Share** your shopping list, or what's in your kitchen, through the phone's share menu
  (text, email, and so on).

## Shared household (new)

Everyone in a household shares **My Food, the shopping list, and saved recipes**. Changes
show up on the other phones within seconds. Likes, ratings, and nutrition stay personal.

- **Sign in** with a 6-digit code emailed to you (Taste → Household). No password needed.
- **Create** a household, or **join** one with a 6-character invite code like `K7Q-2MX`.
  Food already on your phone is added to the household.
- **Works offline:** changes are saved on the phone and sync when you're back online. If two
  people edit the same item, the change that reaches the server last wins.
- **Cooking for** (on Tonight): **Everyone** avoids every member's allergies, **Just me**
  avoids only yours, or pick specific people. The "Avoiding: …" line shows what's in effect.
- Each household's data is private, enforced by Supabase row-level security
  (`supabase/migrations/0001_household.sql`).

### Set up Supabase (one time)

1. In your Supabase dashboard, open **SQL Editor**, paste the whole of
   `supabase/migrations/0001_household.sql`, and click **Run**. It's safe to run again.
2. Go to **Authentication → Emails → Templates**. In both **Magic Link** and
   **Confirm signup**, add the code to the message, for example
   `Your FridgeChef code is {{ .Token }}`. Without this, Supabase emails a link instead
   of a code.
3. Go to **Project Settings → API**. Copy the project URL and the `anon` (publishable)
   key into `.env.local`:
   ```
   EXPO_PUBLIC_SUPABASE_URL=https://YOUR-PROJECT.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=eyJ...
   ```
   The anon key is designed to be in apps. Never put the `service_role` key in the app.
4. Restart `npm start`.

Supabase's built-in email sender only allows a few emails per hour. That's fine for
testing; set up your own email provider (Authentication → SMTP) before launch.

## Run it on your phone

```bash
npm install
npm start
```

Scan the QR code with the **Expo Go** app (iOS or Android). No Apple developer account is
needed yet. `npm run web` also works for quick testing in a browser.

## Turn on AI ideas

```bash
cd server && npm install
ANTHROPIC_API_KEY=sk-ant-... npm start      # listens on :8787
```

This powers recipe ideas, receipt scanning, and searching your favorite sites. Site search
uses Claude's web search tool, which may need to be enabled for your organization in the
Claude Console.

Then copy `.env.example` to `.env.local` and set `EXPO_PUBLIC_AI_URL` to the server's
address (your computer's LAN IP while developing). Restart `npm start`. The API key stays on
the server and is never bundled into the app. Set `APP_TOKEN` on the server and
`EXPO_PUBLIC_AI_TOKEN` in the app to stop strangers from using your server.

## Project layout

```
src/app/             Screens (Expo Router): Tonight, My Food, Taste, recipe detail
src/domain/          Pure logic, unit-tested: matching, expiry estimates, parsing, taste, partial amounts
src/data/recipes.ts  Built-in recipe library (works offline)
src/db/              SQLite schema, migrations, and data access
src/ai/client.ts     Calls the AI server
src/notifications.ts Nightly "use it up" reminders
src/sync/            Household sync: Supabase client, sign-in, sync engine, realtime
supabase/            Database tables + security rules (migrations/) and their tests (tests/)
server/              Tiny Node server that calls the Claude API (/recipes, /receipt, /find-recipes)
```

## Checks

```bash
npm test            # unit tests for the domain logic
npm run typecheck
npm run lint
```

The security rules have their own test. It runs against a local Postgres, with a stand-in
for Supabase's auth:

```bash
cd supabase/tests && createdb fc_test && psql -v ON_ERROR_STOP=1 -d fc_test -f auth_stub.sql -f ../migrations/0001_household.sql -f rls_test.sql
```

## Shipping to the App Store

When you're ready: `npx eas-cli@latest build -p ios`, then `npx eas-cli@latest submit -p ios`.
This needs an Apple Developer account ($99/yr), and the bundle ID in `app.json` must be one
you own. Deploy `server/` somewhere public (Fly.io, Render, or similar) first, and point
`EXPO_PUBLIC_AI_URL` at it.

## Roadmap

- **Sign in with Apple and Google**, next to the email code. This needs an Apple and
  Google developer setup, plus a development build instead of Expo Go.
- Daily nutrition that also counts leftovers and snacks, and uses packaged-food nutrition
  from barcodes.
- An App Store build: icon, splash screen, onboarding, and a privacy policy.
