export type ToyVariant = {
  readonly fur: number;
  readonly ears: number;
  readonly eyes: number;
  readonly pattern: number;
  readonly ink: number;
};

export const DIFFICULTIES = { easy: 100, normal: 500, hard: 1000 } as const;
type Difficulty = keyof typeof DIFFICULTIES;

// Quotas start at one changed trait; fill the remainder from the next distance.
// Hard exhausts the 20 one-trait, 151 two-trait, and 536 three-trait alternatives.
const NEAR_COUNTS: Record<Difficulty, readonly number[]> = {
  easy: [1, 6, 17, 43],
  normal: [7, 55, 210, 205],
  hard: [20, 151, 536],
};

const FUR_COUNT = 6;
const EAR_COUNT = 3;
const EYE_COUNT = 3;
const PATTERN_COUNT = 8;
const INK_COUNT = 5;
const variants: ToyVariant[] = [];
const offsetsByDistance: ToyVariant[][] = [[], [], [], [], []];

for (let fur = 0; fur < FUR_COUNT; fur++) {
  for (let ears = 0; ears < EAR_COUNT; ears++) {
    for (let eyes = 0; eyes < EYE_COUNT; eyes++) {
      for (let pattern = 0; pattern < PATTERN_COUNT; pattern++) {
        for (let ink = 0; ink < INK_COUNT; ink++) {
          const variant = Object.freeze({ fur, ears, eyes, pattern, ink });
          variants.push(variant);
          const distance = Number(fur !== 0) + Number(ears !== 0) + Number(eyes !== 0)
            + Number(pattern !== 0) + Number(ink !== 0);
          if (distance > 0) offsetsByDistance[distance - 1]!.push(variant);
        }
      }
    }
  }
}

export function isMatch(a: ToyVariant, b: ToyVariant): boolean {
  return a.fur === b.fur && a.ears === b.ears && a.eyes === b.eyes
    && a.pattern === b.pattern && a.ink === b.ink;
}

class Round {
  readonly target: ToyVariant;
  readonly tiles: readonly ToyVariant[];
  #wrongTiles = new Set<number>();
  #solved = false;

  constructor(target: ToyVariant, tiles: readonly ToyVariant[]) {
    this.target = target;
    this.tiles = tiles;
  }

  get misses(): number {
    return this.#wrongTiles.size;
  }

  guess(index: number): 'wrong' | 'match' | 'ignored' {
    if (this.#solved || !Number.isInteger(index) || index < 0
      || index >= this.tiles.length || this.#wrongTiles.has(index)) {
      return 'ignored';
    }

    if (isMatch(this.target, this.tiles[index]!)) {
      this.#solved = true;
      return 'match';
    }

    this.#wrongTiles.add(index);
    return 'wrong';
  }
}

export type { Round };

export function createRound(difficulty: Difficulty, random: () => number = Math.random): Round {
  if (!Object.hasOwn(DIFFICULTIES, difficulty)) {
    throw new RangeError(`Unknown difficulty: ${String(difficulty)}`);
  }

  const size = DIFFICULTIES[difficulty];
  const target = variants[randomIndex(variants.length, random)]!;
  const tiles = new Array<ToyVariant>(size);
  tiles[0] = target;
  let tileIndex = 1;
  const nearCounts = NEAR_COUNTS[difficulty];
  const selected = new Set<number>();
  for (let i = 0; i <= nearCounts.length; i++) {
    const offsets = offsetsByDistance[i]!;
    const count = nearCounts[i] ?? size - tileIndex;
    selected.clear();
    // Floyd's sampling: if a draw repeats, take the newly eligible rank instead.
    for (let last = offsets.length - count; last < offsets.length; last++) {
      let rank = last;
      if (count < offsets.length) {
        const draw = randomIndex(last + 1, random);
        rank = selected.has(draw) ? last : draw;
        selected.add(rank);
      }
      tiles[tileIndex++] = translate(target, offsets[rank]!);
    }
  }

  for (let i = tiles.length - 1; i > 0; i--) {
    const j = randomIndex(i + 1, random);
    const tile = tiles[i]!;
    tiles[i] = tiles[j]!;
    tiles[j] = tile;
  }

  return new Round(target, tiles);
}

function translate(target: ToyVariant, offset: ToyVariant): ToyVariant {
  // Wrap each trait independently so translation preserves both distance and uniqueness.
  const fur = (target.fur + offset.fur) % FUR_COUNT;
  const ears = (target.ears + offset.ears) % EAR_COUNT;
  const eyes = (target.eyes + offset.eyes) % EYE_COUNT;
  const pattern = (target.pattern + offset.pattern) % PATTERN_COUNT;
  const ink = (target.ink + offset.ink) % INK_COUNT;
  const index = (((fur * EAR_COUNT + ears) * EYE_COUNT + eyes) * PATTERN_COUNT + pattern) * INK_COUNT + ink;
  return variants[index]!;
}

function randomIndex(length: number, random: () => number): number {
  const draw = random();
  if (!(draw > 0)) return 0;
  if (draw >= 1) return length - 1;
  return Math.floor(draw * length);
}
