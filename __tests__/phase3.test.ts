import { parseIngredientLine, parseIngredientLines } from '../src/domain/ingredientLine';
import { cleanText, isoMinutes, recipeFromHtml } from '../src/domain/recipeImport';
import { defaultStyle, estimateMacros, parseNutritionValue } from '../src/domain/nutrition';
import { lookupBarcode, parseOpenFoodFacts, simplifyProductName } from '../src/domain/barcode';
import { normalizeSite, siteSearchUrl } from '../src/domain/sites';
import { makeVariant } from '../src/domain/variants';
import { ingredientMatches } from '../src/domain/normalize';
import { BUILTIN_RECIPES } from '../src/data/recipes';

describe('ingredient line parser', () => {
  const cases: [string, string, string, boolean][] = [
    ['2 large yellow onions, thinly sliced', 'onion', 'all', false],
    ['1/2 cup heavy cream', 'heavy cream', 'some', false],
    ['1 ½ pounds boneless skinless chicken thighs', 'chicken thigh', 'all', false],
    ['3 cloves garlic, minced', 'garlic', 'all', false],
    ['1 (15-ounce) can black beans, rinsed and drained', 'black bean', 'all', false],
    ['Kosher salt and freshly ground black pepper, to taste', 'salt', 'all', true],
    ['1/2 lemon, juiced', 'lemon', 'half', false],
    ['1 lb ground beef', 'ground beef', 'all', false],
    ['4 oz cream cheese', 'cream cheese', 'some', false],
    ['2 tablespoons extra-virgin olive oil', 'olive oil', 'some', false],
    ['4 eggs', 'egg', 'all', false],
    ['Chopped fresh cilantro, for garnish', 'cilantro', 'all', true],
  ];
  it.each(cases)('%s', (line, name, use, optional) => {
    const r = parseIngredientLine(line)!;
    expect(r.name).toBe(name);
    expect(r.use).toBe(use);
    expect(!!r.optional).toBe(!!optional);
  });
  it('dedupes and skips blanks', () => {
    expect(parseIngredientLines(['1 onion', '', '1/2 onion, diced']).map((i) => i.name)).toEqual(['onion']);
  });
  it('parsed names match the fridge', () => {
    expect(ingredientMatches('chicken thigh', parseIngredientLine('2 lbs bone-in chicken thighs')!.name)).toBe(true);
  });
});

const PAGE_GRAPH = `<html><head>
<script type="application/ld+json">{"@context":"https://schema.org","@graph":[
  {"@type":"WebSite","name":"Example Eats"},
  {"@type":["Recipe"],"name":"Skillet Chicken &amp; Rice","totalTime":"PT45M","recipeYield":["4","4 servings"],
   "recipeCuisine":"Mexican","recipeCategory":"Dinner","keywords":"one-pan, weeknight",
   "recipeIngredient":["1 1/2 lb chicken thighs","1 cup long-grain rice","1 onion, diced","2 cups chicken broth","1 tsp cumin","Salt, to taste"],
   "recipeInstructions":[{"@type":"HowToSection","name":"Cook","itemListElement":[
      {"@type":"HowToStep","text":"Brown the chicken."},{"@type":"HowToStep","text":"Add rice &amp; broth, cover, and simmer 20 min."}]}],
   "nutrition":{"@type":"NutritionInformation","calories":"520 kcal","proteinContent":"38 g"}}
]}</script></head><body>...</body></html>`;

const PAGE_PLAIN = `<script type='application/ld+json'>[{"@type":"Recipe","name":"Easy Pancakes","prepTime":"PT10M","cookTime":"PT15M",
"recipeIngredient":["2 cups flour","2 eggs","1 1/2 cups milk"],"recipeInstructions":"Mix everything. Cook on a hot griddle."}]</script>`;

describe('recipe import from web pages', () => {
  it('reads schema.org Recipe from an @graph', () => {
    const r = recipeFromHtml(PAGE_GRAPH, 'https://www.example.com/skillet-chicken')!;
    expect(r.title).toBe('Skillet Chicken & Rice');
    expect(r.minutes).toBe(45);
    expect(r.servings).toBe(4);
    expect(r.cuisine).toBe('mexican');
    expect(r.ingredients.map((i) => i.name)).toEqual(['chicken thigh', 'rice', 'onion', 'chicken broth', 'cumin', 'salt']);
    expect(ingredientMatches('rice', 'long-grain rice')).toBe(true);
    expect(ingredientMatches('chicken', 'chicken broth')).toBe(false);
    expect(r.steps).toEqual(['Brown the chicken.', 'Add rice & broth, cover, and simmer 20 min.']);
    expect(r.sourceUrl).toBe('https://www.example.com/skillet-chicken');
    expect(r.tags).toEqual(expect.arrayContaining(['dinner', 'one-pan', 'weeknight', 'imported']));
    expect(r.id).toBe('web-example-com-skillet-chicken-rice');
  });
  it('reads a plain array, prep+cook time, and string instructions', () => {
    const r = recipeFromHtml(PAGE_PLAIN, 'https://pancakes.example.org/x')!;
    expect(r.minutes).toBe(25);
    expect(r.steps).toEqual(['Mix everything.', 'Cook on a hot griddle.']);
    expect(r.ingredients.map((i) => i.name)).toEqual(['flour', 'egg', 'milk']);
  });
  it('returns null when there is no recipe data', () => {
    expect(recipeFromHtml('<html><script type="application/ld+json">{"@type":"Article"}</script></html>', 'https://x.com')).toBeNull();
    expect(recipeFromHtml('<script type="application/ld+json">{not json</script>', 'https://x.com')).toBeNull();
  });
  it('helpers', () => {
    expect(isoMinutes('PT1H30M')).toBe(90);
    expect(isoMinutes('P0DT0H20M')).toBe(20);
    expect(cleanText('<b>Mac &amp; cheese</b> &#8217;')).toBe('Mac & cheese ’');
  });
});

describe('nutrition', () => {
  it('estimates macros, and lighter has less fat and fewer calories than hearty', () => {
    const tacos = BUILTIN_RECIPES.find((r) => r.id === 'beef-tacos')!;
    const m = estimateMacros(tacos);
    expect(m.kcal).toBeGreaterThan(200);
    expect(m.protein).toBeGreaterThan(10);
    const light = makeVariant(tacos, 'lighter');
    const hearty = makeVariant(tacos, 'hearty');
    expect(light.macros.kcal).toBeLessThan(m.kcal);
    expect(hearty.macros.protein).toBeGreaterThan(m.protein);
    expect(light.macros.fat).toBeLessThan(hearty.macros.fat);
  });
  it('goal sets the default style', () => {
    expect(defaultStyle('cut')).toBe('lighter');
    expect(defaultStyle('bulk')).toBe('hearty');
    expect(defaultStyle('maintain')).toBe('classic');
  });
  it('parses published nutrition values', () => {
    expect(parseNutritionValue('520 kcal')).toBe(520);
    expect(parseNutritionValue('1,200 calories')).toBe(1200);
    expect(parseNutritionValue(undefined)).toBeUndefined();
  });
});

describe('barcode lookup', () => {
  const OFF = {
    status: 1,
    product: {
      product_name: 'Fage Total 2% Greek Yogurt 17.6 oz',
      brands: 'Fage',
      categories_tags: ['en:dairies', 'en:fermented-milk-products', 'en:yogurts'],
      nutriments: { 'energy-kcal_100g': 73, proteins_100g: 9.9, carbohydrates_100g: 3.9, fat_100g: 2 },
    },
  };
  it('turns a product into a matchable grocery item', () => {
    const p = parseOpenFoodFacts('5200435000027', OFF)!;
    expect(p.name).toBe('total greek yogurt');
    expect(ingredientMatches(p.name, 'greek yogurt')).toBe(true);
    expect(p.category).toBe('dairy');
    expect(p.brand).toBe('Fage');
    expect(p.per100g).toEqual({ kcal: 73, protein: 10, carbs: 4, fat: 2 });
  });
  it('simplifies label names', () => {
    expect(simplifyProductName('Organic Baby Spinach 5 oz', 'Earthbound Farm')).toBe('baby spinach');
    expect(simplifyProductName("Kraft Shredded Mild Cheddar Cheese", 'Kraft')).toBe('mild cheddar cheese');
  });
  it('handles unknown products', async () => {
    expect(parseOpenFoodFacts('0', { status: 0 })).toBeNull();
    const notFound = (async () => ({ status: 404, ok: false, json: async () => ({}) })) as unknown as typeof fetch;
    expect(await lookupBarcode('000', notFound)).toBeNull();
    const ok = (async () => ({ status: 200, ok: true, json: async () => OFF })) as unknown as typeof fetch;
    expect((await lookupBarcode('5200435000027', ok))?.name).toBe('total greek yogurt');
  });
});

describe('favorite sites', () => {
  it('normalizes what people type', () => {
    expect(normalizeSite('https://www.SeriousEats.com/recipes/x')).toBe('seriouseats.com');
    expect(normalizeSite('budgetbytes.com')).toBe('budgetbytes.com');
    expect(normalizeSite('not a site')).toBeNull();
  });
  it('builds search links', () => {
    expect(siteSearchUrl('allrecipes.com', ['chicken', 'spinach'])).toBe('https://www.allrecipes.com/search?q=chicken%20spinach');
    expect(siteSearchUrl('smittenkitchen.com', ['leek'])).toBe('https://duckduckgo.com/?q=site%3Asmittenkitchen.com%20leek%20recipe');
  });
});

describe('lighter always lowers the estimate when there is fat to cut', () => {
  it('imported chicken orzo: lighter < classic', () => {
    const r = recipeFromHtml(PAGE_GRAPH, 'https://www.example.com/skillet-chicken')!;
    const withOil = { ...r, ingredients: [...r.ingredients, { name: 'olive oil', use: 'some' as const }] };
    expect(makeVariant(withOil, 'lighter').macros.kcal).toBeLessThan(estimateMacros(withOil).kcal);
  });
});

describe('generic covers specific, but not lighter swaps', () => {
  it('rice is not cauliflower rice; pasta is not whole-wheat pasta', () => {
    expect(ingredientMatches('rice', 'long-grain rice')).toBe(true);
    expect(ingredientMatches('rice', 'cauliflower rice')).toBe(false);
    expect(ingredientMatches('pasta', 'whole-wheat pasta')).toBe(false);
    expect(ingredientMatches('turkey', 'ground turkey')).toBe(false);
    expect(ingredientMatches('tomato', 'tomato paste')).toBe(false);
  });
  it('lighter bowl keeps your rice instead of assuming you have cauliflower rice', () => {
    const bowl = BUILTIN_RECIPES.find((r) => r.id === 'copycat-burrito-bowl')!;
    const have = (n: string) => ['rice', 'chicken', 'lime'].some((h) => ingredientMatches(h, n));
    const light = makeVariant(bowl, 'lighter', [], have);
    expect(light.recipe.ingredients.some((i) => i.name === 'cauliflower rice')).toBe(false);
  });
});
