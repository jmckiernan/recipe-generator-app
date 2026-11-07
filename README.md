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
server/              Tiny Node server that calls the Claude API
```

## Checks

```bash
npm test            # unit tests for the domain logic
npm run typecheck
npm run lint
```

## Shipping to the App Store

When you're ready: `npx eas-cli@latest build -p ios`, then `npx eas-cli@latest submit -p ios`.
This needs an Apple Developer account ($99/yr), and the bundle ID in `app.json` must be one
you own. Deploy `server/` somewhere public (Fly.io, Render, or similar) first, and point
`EXPO_PUBLIC_AI_URL` at it.

## Roadmap

- **Phase 2:** shopping list (fed by "worth picking up"), meal-prep / batch mode,
  healthier vs. full-flavor (cut/bulk) versions, restaurant copycats, leftovers tracking.
- **Phase 3:** receipt and barcode scanning, import recipes by URL from your favorite
  sites, shared household inventory, nutrition and macros.
