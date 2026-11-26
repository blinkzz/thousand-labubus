import assert from 'node:assert/strict';
import test from 'node:test';
import { createRound, DIFFICULTIES, isMatch, type ToyVariant } from './game.js';

const difficulties = ['easy', 'normal', 'hard'] as const;
const counts = { easy: 100, normal: 500, hard: 1000 };
const traits = ['fur', 'ears', 'eyes', 'pattern', 'ink'] as const;
const traitSizes = { fur: 6, ears: 3, eyes: 3, pattern: 8, ink: 5 };

function seededRandom(seed: number): () => number {
  return () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return seed / 2 ** 32;
  };
}

function distance(a: ToyVariant, b: ToyVariant): number {
  return traits.filter((trait) => a[trait] !== b[trait]).length;
}

function assertValidVariant(variant: ToyVariant): void {
  for (const trait of traits) {
    const value = variant[trait];
    assert.ok(Number.isInteger(value) && value >= 0 && value < traitSizes[trait], `invalid ${trait}: ${value}`);
  }
}

test('isMatch compares every trait, not object identity', () => {
  const target = { fur: 0, ears: 0, eyes: 0, pattern: 0, ink: 0 };
  assert.equal(isMatch(target, { ...target }), true);
  for (const trait of traits) {
    assert.equal(isMatch(target, { ...target, [trait]: 1 }), false, trait);
  }
});

test('every difficulty has the right number of unique toys and exactly one match', () => {
  assert.deepEqual(DIFFICULTIES, counts);
  for (const difficulty of difficulties) {
    const count = counts[difficulty];
    const sources = [
      seededRandom(25),
      seededRandom(506),
      ...[0, Number.MIN_VALUE, 0.5, 1 - Number.EPSILON, 1, -1, NaN, Infinity, -Infinity]
        .map((draw) => () => draw),
    ];
    for (const random of sources) {
      let draws = 0;
      const { target, tiles } = createRound(difficulty, () => {
        assert.ok(++draws <= 2 * count, `${difficulty}: drawing the board must be bounded`);
        return random();
      });
      assertValidVariant(target);
      for (const tile of tiles) assertValidVariant(tile);

      const keys = tiles.map((tile) => traits.map((trait) => tile[trait]).join(':'));
      assert.equal(keys.length, count, difficulty);
      assert.equal(tiles.filter((tile) => isMatch(target, tile)).length, 1, difficulty);
      assert.equal(new Set(keys).size, count, difficulty);
    }
  }
});

test('the matching toy moves throughout each board according to the supplied RNG', () => {
  function position(difficulty: keyof typeof counts, random: () => number): number {
    const { target, tiles } = createRound(difficulty, random);
    return tiles.findIndex((tile) => distance(target, tile) === 0);
  }

  for (const difficulty of difficulties) {
    const count = counts[difficulty];
    assert.equal(position(difficulty, () => 0), count - 1, difficulty);
    assert.equal(position(difficulty, () => 1 - Number.EPSILON), 0, difficulty);
    const random = seededRandom(879);
    const repeat = seededRandom(879);
    const positions = new Set<number>();
    for (let i = 0; i < 64; i++) {
      const index = position(difficulty, random);
      assert.ok(index >= 0 && index < count, difficulty);
      assert.equal(index, position(difficulty, repeat), `${difficulty}: same RNG must give the same position`);
      positions.add(index);
    }
    const quartiles = new Set([...positions].map((index) => Math.floor(index / (count / 4))));
    assert.ok(positions.size >= 16, difficulty);
    assert.equal(quartiles.size, 4, difficulty);
  }
});

test('harder rounds have more close lookalikes in both absolute count and board share', () => {
  const random = seededRandom(506);
  for (let i = 0; i < 12; i++) {
    let previousOne = 0;
    let previousNear = 0;
    const previousShares = [0, 0, 0, 0];
    for (const difficulty of difficulties) {
      const { target, tiles } = createRound(difficulty, random);
      const histogram = [0, 0, 0, 0, 0, 0];
      for (const tile of tiles) {
        const changes = distance(target, tile);
        histogram[changes] = histogram[changes]! + 1;
      }
      const one = histogram[1]!;
      const two = histogram[2]!;
      assert.ok(one > previousOne, `${difficulty}: one-trait alternatives must increase`);
      assert.ok(one + two > previousNear, `${difficulty}: close alternatives must increase`);
      previousOne = one;
      previousNear = one + two;

      let cumulative = 0;
      for (let changes = 1; changes <= 4; changes++) {
        cumulative += histogram[changes]!;
        const share = cumulative / (tiles.length - 1);
        assert.ok(share > previousShares[changes - 1]!, `${difficulty}: share within ${changes} changes must increase`);
        previousShares[changes - 1] = share;
      }

      if (difficulty === 'easy') {
        assert.ok(histogram[4]! + histogram[5]! > tiles.length / 2);
      }
      if (difficulty === 'hard') {
        assert.equal(one, 20);
        assert.equal(two, 151);
        assert.equal(histogram[5], 0);
      }
    }
  }
});

test('a round counts each wrong tile once and ignores every guess after a match', () => {
  const round = createRound('easy', () => 0);
  const match = round.tiles.findIndex((tile) => distance(round.target, tile) === 0);
  const wrong = [0, 1, 2, 3].filter((index) => index !== match);
  assert.equal(round.misses, 0);

  for (const index of [-1, round.tiles.length, 0.5, NaN, Infinity]) {
    assert.equal(round.guess(index), 'ignored');
  }
  assert.equal(round.misses, 0);
  assert.equal(round.guess(wrong[0]!), 'wrong');
  assert.equal(round.guess(wrong[0]!), 'ignored');
  assert.equal(round.misses, 1);
  assert.equal(round.guess(wrong[1]!), 'wrong');
  assert.equal(round.misses, 2);

  assert.equal(round.guess(match), 'match');
  assert.equal(round.guess(match), 'ignored');
  assert.equal(round.guess(wrong[2]!), 'ignored');
  assert.equal(round.misses, 2);

  const newRound = createRound('easy', () => 0);
  assert.equal(newRound.misses, 0);
  assert.equal(newRound.guess(wrong[0]!), 'wrong');
  assert.equal(round.misses, 2);
});
