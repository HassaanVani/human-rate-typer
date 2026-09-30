export class SeededRandom {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0 || 0x6d2b79f5;
  }

  next(): number {
    let value = (this.state += 0x6d2b79f5);
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  }

  between(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  pick<T>(values: readonly T[]): T {
    return values[Math.floor(this.next() * values.length)]!;
  }
}

export function createSeed(): number {
  const values = new Uint32Array(1);
  crypto.getRandomValues(values);
  return values[0] || Date.now();
}
