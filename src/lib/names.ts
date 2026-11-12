/**
 * Approved identity pieces. Players never type a display name: they pick an
 * avatar and a nickname assembled from these reviewed lists. The server
 * re-validates every choice (see validateNickname / validateGroupLabel), so a
 * modified client cannot submit arbitrary text.
 *
 * Words were chosen to be kind, age-appropriate and safe in *any* combination.
 * Combinations are additionally screened by isCombinationAllowed (exact pair
 * blocklist plus a substring screen on the joined text); tests enumerate every
 * pair.
 */

export interface Avatar {
  id: string;
  emoji: string;
  label: string;
  bg: string;
}

export const AVATARS: readonly Avatar[] = [
  { id: "otter", emoji: "🦦", label: "Otter", bg: "#FFE3C2" },
  { id: "panda", emoji: "🐼", label: "Panda", bg: "#E4E9F2" },
  { id: "penguin", emoji: "🐧", label: "Penguin", bg: "#D6ECFF" },
  { id: "koala", emoji: "🐨", label: "Koala", bg: "#E8E2F8" },
  { id: "fox", emoji: "🦊", label: "Fox", bg: "#FFD9C9" },
  { id: "owl", emoji: "🦉", label: "Owl", bg: "#F2E6D3" },
  { id: "turtle", emoji: "🐢", label: "Turtle", bg: "#D7F2DF" },
  { id: "llama", emoji: "🦙", label: "Llama", bg: "#F9EBD8" },
  { id: "hedgehog", emoji: "🦔", label: "Hedgehog", bg: "#EFE1D1" },
  { id: "rabbit", emoji: "🐰", label: "Rabbit", bg: "#FCE4EC" },
  { id: "octopus", emoji: "🐙", label: "Octopus", bg: "#FFDDE6" },
  { id: "seal", emoji: "🦭", label: "Seal", bg: "#DDE8F0" },
  { id: "whale", emoji: "🐳", label: "Whale", bg: "#D3EEFB" },
  { id: "parrot", emoji: "🦜", label: "Parrot", bg: "#DDF5D0" },
  { id: "giraffe", emoji: "🦒", label: "Giraffe", bg: "#FFF0C2" },
  { id: "bee", emoji: "🐝", label: "Bee", bg: "#FFF3B8" },
  { id: "ladybug", emoji: "🐞", label: "Ladybug", bg: "#FFDAD4" },
  { id: "butterfly", emoji: "🦋", label: "Butterfly", bg: "#DCE7FF" },
  { id: "cactus", emoji: "🌵", label: "Cactus", bg: "#DFF3D9" },
  { id: "sunflower", emoji: "🌻", label: "Sunflower", bg: "#FFF1BF" },
  { id: "mushroom", emoji: "🍄", label: "Mushroom", bg: "#FBE0D8" },
  { id: "rocket", emoji: "🚀", label: "Rocket", bg: "#E1E4FB" },
  { id: "rainbow", emoji: "🌈", label: "Rainbow", bg: "#F3E5FA" },
  { id: "planet", emoji: "🪐", label: "Planet", bg: "#EDE3F7" },
];

export const NAME_ADJECTIVES = [
  "Sunny", "Clever", "Brave", "Cozy", "Jolly", "Lucky", "Mighty", "Nimble", "Plucky", "Quick",
  "Rosy", "Snappy", "Swift", "Witty", "Zesty", "Bouncy", "Breezy", "Bright", "Calm", "Cheery",
  "Daring", "Dapper", "Eager", "Gentle", "Golden", "Happy", "Hearty", "Keen", "Kind", "Lively",
  "Merry", "Mellow", "Noble", "Peppy", "Quirky", "Radiant", "Sparkly", "Spry", "Steady", "Trusty",
  "Upbeat", "Vivid", "Wise", "Zippy", "Cosmic", "Curious", "Friendly", "Groovy", "Jazzy", "Polite",
  "Speedy", "Stellar", "Twinkly", "Chipper", "Dandy", "Fearless", "Glowing", "Mindful", "Sunlit", "Tidy",
] as const;

export const NAME_NOUNS = [
  "Otter", "Panda", "Penguin", "Koala", "Falcon", "Fox", "Badger", "Owl", "Puffin", "Dolphin",
  "Turtle", "Llama", "Alpaca", "Hedgehog", "Rabbit", "Squirrel", "Walrus", "Narwhal", "Octopus", "Pelican",
  "Toucan", "Gecko", "Moose", "Beaver", "Raccoon", "Lemur", "Meerkat", "Sparrow", "Robin", "Comet",
  "Rocket", "Pancake", "Muffin", "Waffle", "Pretzel", "Noodle", "Biscuit", "Mango", "Acorn", "Maple",
  "Pebble", "Cactus", "Tulip", "Sprout", "Compass", "Lantern", "Meteor", "Nebula", "Glacier", "Canyon",
  "Kite", "Banjo", "Teapot", "Pinecone", "Starfish", "Firefly", "Bumblebee", "Snowflake", "Volcano", "Zebra",
] as const;

/** Exact adjective+noun pairs we decided not to allow even though each word is fine. */
// Add "Adjective Noun" strings here if a review finds an unfortunate reading.
const BLOCKED_PAIRS = new Set<string>([]);

/**
 * Substrings that must not appear when the words are run together without a
 * space (e.g. in a share or a URL). Lowercase.
 */
const BLOCKED_SUBSTRINGS = [
  "ass", "butt", "cum", "dick", "fag", "fuk", "fuck", "hell", "homo", "jew", "kkk", "nazi",
  "nig", "piss", "poo", "porn", "rape", "sex", "shit", "slut", "tit", "twat", "wank", "whore",
];

export const NICKNAME_SUFFIX_MIN = 2;
export const NICKNAME_SUFFIX_MAX = 99;
/** Numbers with unwanted connotations are never assigned. */
const BLOCKED_SUFFIXES = new Set([13, 14, 18, 23, 42, 66, 69, 88]);

export function isAllowedSuffix(n: number): boolean {
  return (
    Number.isInteger(n) &&
    n >= NICKNAME_SUFFIX_MIN &&
    n <= NICKNAME_SUFFIX_MAX &&
    !BLOCKED_SUFFIXES.has(n)
  );
}

export function allowedSuffixes(): number[] {
  const out: number[] = [];
  for (let n = NICKNAME_SUFFIX_MIN; n <= NICKNAME_SUFFIX_MAX; n++) if (isAllowedSuffix(n)) out.push(n);
  return out;
}

export function isCombinationAllowed(first: string, second: string): boolean {
  if (BLOCKED_PAIRS.has(`${first} ${second}`)) return false;
  const joined = `${first}${second}`.toLowerCase().replace(/\s+/g, "");
  return !BLOCKED_SUBSTRINGS.some((b) => joined.includes(b));
}

export function isAvatarId(id: unknown): id is string {
  return typeof id === "string" && AVATARS.some((a) => a.id === id);
}

export function avatarById(id: string | null | undefined): Avatar {
  return AVATARS.find((a) => a.id === id) ?? AVATARS[0];
}

export function validateNickname(adjective: unknown, noun: unknown): string | null {
  if (typeof adjective !== "string" || !(NAME_ADJECTIVES as readonly string[]).includes(adjective)) {
    return "Pick a word from the list.";
  }
  if (typeof noun !== "string" || !(NAME_NOUNS as readonly string[]).includes(noun)) {
    return "Pick a word from the list.";
  }
  if (!isCombinationAllowed(adjective, noun)) return "That combination isn't available. Try another.";
  return null;
}

export function formatNickname(adjective: string, noun: string, suffix: number | null): string {
  return suffix ? `${adjective} ${noun} ${suffix}` : `${adjective} ${noun}`;
}

function pick<T>(list: readonly T[], rand: () => number): T {
  return list[Math.floor(rand() * list.length) % list.length];
}

export function suggestIdentity(rand: () => number = Math.random): {
  avatarId: string;
  adjective: string;
  noun: string;
} {
  for (let i = 0; i < 50; i++) {
    const adjective = pick(NAME_ADJECTIVES, rand);
    const noun = pick(NAME_NOUNS, rand);
    if (isCombinationAllowed(adjective, noun)) {
      return { avatarId: pick(AVATARS, rand).id, adjective, noun };
    }
  }
  return { avatarId: AVATARS[0].id, adjective: "Sunny", noun: "Otter" };
}

// ---------------------------------------------------------------------------
// Group labels: "The <Adjective> <Plural noun>", from reviewed lists only.

export const GROUP_ADJECTIVES = [
  "Clever", "Cosmic", "Curious", "Daring", "Golden", "Jolly", "Lucky", "Mighty", "Merry", "Nimble",
  "Plucky", "Speedy", "Stellar", "Sunny", "Witty", "Zesty", "Brave", "Cheery", "Groovy", "Trusty",
] as const;

export const GROUP_NOUNS = [
  "Otters", "Pandas", "Penguins", "Owls", "Foxes", "Llamas", "Puffins", "Dolphins", "Narwhals", "Comets",
  "Rockets", "Pancakes", "Waffles", "Pretzels", "Noodles", "Acorns", "Pebbles", "Lanterns", "Meteors", "Fireflies",
  "Estimators", "Guessers", "Number Crunchers", "Ballparkers", "Sharpshooters",
] as const;

export function validateGroupLabel(adjective: unknown, noun: unknown): string | null {
  if (typeof adjective !== "string" || !(GROUP_ADJECTIVES as readonly string[]).includes(adjective)) {
    return "Pick a word from the list.";
  }
  if (typeof noun !== "string" || !(GROUP_NOUNS as readonly string[]).includes(noun)) {
    return "Pick a word from the list.";
  }
  if (!isCombinationAllowed(adjective, noun)) return "That combination isn't available.";
  return null;
}

export function formatGroupLabel(adjective: string, noun: string): string {
  return `The ${adjective} ${noun}`;
}

export function suggestGroupLabel(rand: () => number = Math.random): { adjective: string; noun: string } {
  for (let i = 0; i < 50; i++) {
    const adjective = pick(GROUP_ADJECTIVES, rand);
    const noun = pick(GROUP_NOUNS, rand);
    if (isCombinationAllowed(adjective, noun)) return { adjective, noun };
  }
  return { adjective: "Lucky", noun: "Guessers" };
}
