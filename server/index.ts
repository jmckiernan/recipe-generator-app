// FridgeChef AI server: one endpoint that turns "what's in my fridge + what I like"
// into recipe ideas with Claude. Runs anywhere Node runs (Fly, Render, a VPS,
// or wrap the handler for a serverless platform).
//
//   ANTHROPIC_API_KEY=... npm start        # listens on PORT (default 8787)
//
// The mobile app calls POST /recipes. The key stays here, never in the app bundle.

import http from 'node:http';
import Anthropic from '@anthropic-ai/sdk';
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod';
import { z } from 'zod';

const client = new Anthropic();
const PORT = Number(process.env.PORT ?? 8787);
/** Optional shared secret so random people can't spend your API credits. */
const APP_TOKEN = process.env.APP_TOKEN;

// ---------- Request / response shapes ----------

const RequestSchema = z.object({
  inventory: z.array(
    z.object({
      name: z.string(),
      amount: z.string(), // "2", "½", "a little"
      daysLeft: z.number(),
    }),
  ),
  staples: z.array(z.string()),
  likes: z.array(z.string()),
  dislikes: z.array(z.string()),
  allergies: z.array(z.string()),
  favoriteRestaurants: z.array(z.string()),
  topRated: z.array(z.string()), // recipe titles rated 4-5 stars
  lowRated: z.array(z.string()), // recipe titles rated 1-2 stars
  recentCooks: z.array(z.string()),
  filters: z.object({
    maxMinutes: z.number().optional(),
    maxIngredients: z.number().optional(),
    canBuy: z.number(),
  }),
  /** Free-text extra ask, e.g. "something creative" or "a cheap copycat of Chipotle". */
  request: z.string().max(500).optional(),
  /** lighter = lower calorie (cut), hearty = more protein and richer (bulk). */
  style: z.enum(['lighter', 'classic', 'hearty']).default('classic'),
  count: z.number().min(1).max(6).default(4),
});
type RecipeRequest = z.infer<typeof RequestSchema>;

const RecipeSchema = z.object({
  title: z.string(),
  minutes: z.number(),
  kind: z.enum(['assembly', 'recipe']),
  cuisine: z.string(),
  tags: z.array(z.string()),
  ingredients: z.array(
    z.object({
      name: z.string().describe('singular, lowercase, no quantities, e.g. "onion"'),
      use: z.enum(['all', 'half', 'some']).describe('how much of one unit this recipe uses'),
      optional: z.boolean(),
    }),
  ),
  steps: z.array(z.string()),
  why: z.string().describe('one sentence on why this fits this person tonight'),
  servings: z.number().describe('servings this makes'),
});

const ResponseSchema = z.object({
  recipes: z.array(RecipeSchema),
  tryNext: z
    .array(z.object({ ingredient: z.string(), why: z.string() }))
    .describe('0-2 new ingredients this person would likely enjoy, based on what they like'),
});

// ---------- Prompt ----------

const SYSTEM = `You are the recipe engine inside FridgeChef, an app that decides what to cook so the user doesn't have to.

Goals, in order:
1. Safety: never include an ingredient that conflicts with the user's allergies, including derived ingredients (e.g. dairy → butter, cheese; gluten → bread, pasta, soy sauce). If a recipe would need one, pick a different recipe.
2. Use what they have, prioritizing items with the fewest days left. Items with daysLeft <= 2 should appear in most suggestions.
3. Respect the filters exactly: minutes <= maxMinutes; the number of non-staple, non-optional ingredients <= maxIngredients; at most canBuy non-staple ingredients that are not in the inventory.
4. Match their taste: lean into likes and highly rated dishes, avoid dislikes and low-rated dishes, don't repeat recent cooks.
5. Variety: mix at least one effortless "assembly" (no real recipe needed, like a sandwich) with real recipes when the filters allow, and include one creative combination they probably wouldn't think of.

Staples (salt, oil, etc.) are assumed on hand; list them as ingredients if used, but they never count toward limits.
If they list favorite restaurants, one suggestion can be a cheaper home version of a dish from one of them; say which in "why".
Keep steps short and practical for a weeknight. Ingredient names must be singular and lowercase so the app can match them to the fridge.`;

function userPrompt(r: RecipeRequest): string {
  const inv = r.inventory
    .slice()
    .sort((a, b) => a.daysLeft - b.daysLeft)
    .map((i) => `- ${i.name} (${i.amount}, ${i.daysLeft < 0 ? 'EXPIRED, do not use' : `${i.daysLeft} days left`})`)
    .join('\n');
  const f = r.filters;
  return [
    `Suggest ${r.count} recipes.`,
    `\nInventory:\n${inv || '(empty)'}`,
    `\nStaples on hand: ${r.staples.join(', ') || 'none'}`,
    `Allergies (hard rule): ${r.allergies.join(', ') || 'none'}`,
    `Likes: ${r.likes.join(', ') || 'unknown'}`,
    `Dislikes: ${r.dislikes.join(', ') || 'none'}`,
    `Loved dishes: ${r.topRated.join(', ') || 'none yet'}`,
    `Disliked dishes: ${r.lowRated.join(', ') || 'none yet'}`,
    `Cooked recently (avoid repeats): ${r.recentCooks.join(', ') || 'none'}`,
    `Favorite restaurants: ${r.favoriteRestaurants.join(', ') || 'none'}`,
    `\nFilters: maxMinutes=${f.maxMinutes ?? 'any'}, maxIngredients=${f.maxIngredients ?? 'any'}, canBuy=${f.canBuy}`,
    r.style === 'lighter'
      ? '\nStyle: lighter. Lower-calorie versions: lean proteins, more vegetables, less oil, cheese, and refined carbs, while still satisfying.'
      : r.style === 'hearty'
        ? '\nStyle: hearty. Filling, full-flavored versions with generous protein, suitable for bulking.'
        : '',
    r.request ? `\nExtra request from the user: ${r.request}` : '',
  ].join('\n');
}

// ---------- Claude call ----------

async function generate(r: RecipeRequest) {
  const response = await client.beta.messages.parse({
    model: 'claude-opus-5-5',
    max_tokens: 16000,
    // If a safety classifier declines, the API retries on a fallback model automatically.
    betas: ['server-side-fallback-2026-07-01'],
    fallbacks: 'default',
    system: SYSTEM,
    output_config: { effort: 'medium', format: betaZodOutputFormat(ResponseSchema) },
    messages: [{ role: 'user', content: userPrompt(r) }],
  });
  if (response.stop_reason === 'refusal') {
    throw new HttpError(422, 'The model declined this request. Try rephrasing your extra request.');
  }
  if (!response.parsed_output) {
    throw new HttpError(502, `Could not parse model output (stop_reason: ${response.stop_reason})`);
  }
  return response.parsed_output;
}

// ---------- HTTP ----------

class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

function send(res: http.ServerResponse, status: number, body: unknown) {
  res.writeHead(status, {
    'content-type': 'application/json',
    'access-control-allow-origin': '*',
    'access-control-allow-headers': 'content-type, authorization',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req: http.IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const c of req) {
    size += (c as Buffer).length;
    if (size > 200_000) throw new HttpError(413, 'Request too large');
    chunks.push(c as Buffer);
  }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

const server = http.createServer(async (req, res) => {
  if (req.method === 'OPTIONS') return send(res, 204, {});
  if (req.method === 'GET' && req.url === '/health') return send(res, 200, { ok: true });
  if (req.method !== 'POST' || req.url !== '/recipes') return send(res, 404, { error: 'Not found' });
  if (APP_TOKEN && req.headers.authorization !== `Bearer ${APP_TOKEN}`) {
    return send(res, 401, { error: 'Unauthorized' });
  }
  try {
    const parsed = RequestSchema.safeParse(await readJson(req));
    if (!parsed.success) return send(res, 400, { error: parsed.error.message });
    send(res, 200, await generate(parsed.data));
  } catch (err) {
    if (err instanceof HttpError) return send(res, err.status, { error: err.message });
    if (err instanceof Anthropic.RateLimitError) return send(res, 429, { error: 'Busy, try again shortly' });
    if (err instanceof Anthropic.AuthenticationError) return send(res, 500, { error: 'Server API key is invalid' });
    if (err instanceof Anthropic.APIError) return send(res, 502, { error: `AI error ${err.status}` });
    if (err instanceof SyntaxError) return send(res, 400, { error: 'Invalid JSON' });
    console.error(err);
    send(res, 500, { error: 'Internal error' });
  }
});

server.listen(PORT, () => console.log(`FridgeChef AI server on :${PORT}`));
