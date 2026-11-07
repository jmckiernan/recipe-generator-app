// Core domain types shared by the app, the matcher, and the AI layer.

export type Location = 'fridge' | 'freezer' | 'pantry';

/** Rough amount left. We deliberately avoid grams. Nobody weighs half an onion. */
export type QtyLevel = 'full' | 'half' | 'little';

export type Category =
  | 'meat'
  | 'poultry'
  | 'seafood'
  | 'deli'
  | 'dairy'
  | 'cheese'
  | 'eggs'
  | 'leafy'
  | 'produce'
  | 'hardy_produce'
  | 'fruit'
  | 'herbs'
  | 'bread'
  | 'grain'
  | 'condiment'
  | 'leftovers'
  | 'other';

export interface InventoryItem {
  id: number;
  name: string; // normalized singular, lowercase ("onion")
  category: Category;
  location: Location;
  count: number; // how many units (e.g. 3 onions); qtyLevel applies to the last open one
  qtyLevel: QtyLevel;
  purchasedAt: string; // ISO date
  expiresAt: string; // ISO date
  expiryEstimated: boolean;
}

/** How much of an ingredient a recipe uses. */
export type UseAmount = 'all' | 'half' | 'some';

export interface RecipeIngredient {
  name: string;
  use: UseAmount;
  optional?: boolean;
}

export interface Recipe {
  id: string;
  title: string;
  minutes: number;
  /** "assembly" = no real recipe needed (sandwich, salad). */
  kind: 'assembly' | 'recipe';
  cuisine?: string;
  tags: string[];
  ingredients: RecipeIngredient[];
  steps: string[];
  source?: 'builtin' | 'ai' | 'user';
  sourceUrl?: string;
  /** AI-provided explanation of why this suits the user. */
  why?: string;
  /** Servings it makes. Defaults to 2. Used for leftovers and meal prep. */
  servings?: number;
  /** Cheaper homemade take on a restaurant dish. */
  copycat?: { restaurant: string; dish: string; savingsPerServing: number };
}

/** Recipe "style": lighter (cut), classic, or hearty (bulk / full-flavor). */
export type Style = 'lighter' | 'classic' | 'hearty';

export interface ShoppingItem {
  id: number;
  name: string;
  /** Why it's on the list, e.g. "for Chicken stir-fry" or "unlocks 3 recipes". */
  reason: string;
  checked: boolean;
  addedAt: string;
}

export interface Profile {
  likes: string[]; // ingredients or cuisines
  dislikes: string[];
  allergies: string[]; // hard filter
  staples: string[]; // always-on-hand items, not counted
  favoriteRestaurants: string[];
  expiryWarnDays: number; // the user's "X"
  notifyHour: number;
  notifyMinute: number;
}

export interface Rating {
  recipeId: string;
  stars: number; // 1-5
  tags: string[];
  ingredients: string[];
}

export interface Filters {
  maxMinutes?: number;
  /** Max number of non-staple ingredients (2, 3, ...). Undefined = any. */
  maxIngredients?: number;
  /** How many missing ingredients the user is willing to buy (0-3). */
  canBuy: number;
}

export interface Suggestion {
  recipe: Recipe;
  have: string[];
  missing: string[];
  /** Inventory items this recipe uses that expire within the warning window. */
  usesExpiring: string[];
  score: number;
  reasons: string[];
}
