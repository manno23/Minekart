export class Random {
  private state: number;

  constructor(seed: number) {
    this.state = seed >>> 0;
    if (this.state === 0) {
      this.state = 0x12345678;
    }
  }

  next(): number {
    // Xorshift32
    let x = this.state;
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    this.state = x >>> 0;
    return (this.state & 0xffffffff) / 0xffffffff;
  }

  nextRange(min: number, max: number): number {
    return min + (max - min) * this.next();
  }

  nextInt(max: number): number {
    return Math.floor(this.next() * max);
  }

  pick<T>(items: T[]): T {
    return items[this.nextInt(items.length)];
  }
}
