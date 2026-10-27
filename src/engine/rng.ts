// A small deterministic generator (splitmix64), so a seed replays a game
// exactly. The arithmetic is 64-bit, which in JavaScript means BigInt; it is
// slow, but a game asks for a few hundred numbers in total.

const MASK = (1n << 64n) - 1n;

export class SeededGenerator {
  state: bigint;

  constructor(seed: bigint) {
    this.state = BigInt.asUintN(64, seed);
  }

  static random(): SeededGenerator {
    return new SeededGenerator(randomSeed());
  }

  next(): bigint {
    this.state = (this.state + 0x9e3779b97f4a7c15n) & MASK;
    let z = this.state;
    z = ((z ^ (z >> 30n)) * 0xbf58476d1ce4e5b9n) & MASK;
    z = ((z ^ (z >> 27n)) * 0x94d049bb133111ebn) & MASK;
    return z ^ (z >> 31n);
  }

  /** A double in [0, 1). */
  nextDouble(): number {
    return Number(this.next() >> 11n) / 2 ** 53;
  }

  /** An integer in [0, bound). */
  nextInt(bound: number): number {
    return Math.floor(this.nextDouble() * bound);
  }

  /** Fisher–Yates, in place. */
  shuffle<T>(items: T[]): void {
    for (let index = items.length - 1; index > 0; index -= 1) {
      const other = this.nextInt(index + 1);
      const held = items[index];
      items[index] = items[other];
      items[other] = held;
    }
  }

  shuffled<T>(items: readonly T[]): T[] {
    const copy = [...items];
    this.shuffle(copy);
    return copy;
  }
}

export function randomSeed(): bigint {
  const words = new Uint32Array(2);
  crypto.getRandomValues(words);
  return (BigInt(words[0]) << 32n) | BigInt(words[1]);
}

/** Reads a seed someone typed: a decimal number up to 64 bits, or nothing. */
export function parseSeed(text: string): bigint | null {
  const trimmed = text.trim();
  if (!/^\d+$/.test(trimmed)) return null;
  const value = BigInt(trimmed);
  return value <= MASK ? value : null;
}
