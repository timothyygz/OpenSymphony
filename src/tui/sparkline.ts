const BLOCKS = ["▁", "▂", "▃", "▄", "▅", "▆", "▇", "█"];
const WINDOW_MS = 10 * 60 * 1000;
const BUCKETS = 24;

export class Sparkline {
  private samples: Array<{ ts: number; tokens: number }> = [];

  sample(now: number, totalTokens: number): void {
    this.samples.push({ ts: now, tokens: totalTokens });
    this.prune(now);
  }

  tps(now: number, currentTokens: number): number {
    const all = [...this.samples, { ts: now, tokens: currentTokens }];
    if (all.length < 2) return 0;
    const oldest = all[0]!;
    const elapsedMs = now - oldest.ts;
    if (elapsedMs <= 0) return 0;
    const delta = Math.max(0, currentTokens - oldest.tokens);
    return delta / (elapsedMs / 1000);
  }

  render(now: number, currentTokens: number): string {
    const all = [...this.samples, { ts: now, tokens: currentTokens }];
    this.prune(now);
    if (all.length < 2) return BLOCKS[0]!.repeat(BUCKETS);

    const bucketMs = WINDOW_MS / BUCKETS;
    const activeStart = Math.floor(now / bucketMs) * bucketMs;
    const windowStart = activeStart - (BUCKETS - 1) * bucketMs;

    // Compute per-bucket TPS
    const bucketTps: number[] = [];
    for (let i = 0; i < BUCKETS; i++) {
      const bStart = windowStart + i * bucketMs;
      const bEnd = bStart + bucketMs;
      const inBucket = all.filter(
        (s) => i === BUCKETS - 1
          ? s.ts >= bStart && s.ts <= bEnd
          : s.ts >= bStart && s.ts < bEnd,
      );
      if (inBucket.length < 2) {
        bucketTps.push(0);
        continue;
      }
      const first = inBucket[0]!;
      const last = inBucket[inBucket.length - 1]!;
      const elapsed = last.ts - first.ts;
      const delta = Math.max(0, last.tokens - first.tokens);
      bucketTps.push(elapsed <= 0 ? 0 : delta / (elapsed / 1000));
    }

    const maxTps = Math.max(...bucketTps, 0);
    return bucketTps
      .map((v) => {
        const idx = maxTps <= 0 ? 0 : Math.round((v / maxTps) * (BLOCKS.length - 1));
        return BLOCKS[idx]!;
      })
      .join("");
  }

  private prune(now: number): void {
    const cutoff = now - WINDOW_MS;
    while (this.samples.length > 0 && this.samples[0]!.ts < cutoff) {
      this.samples.shift();
    }
  }
}
