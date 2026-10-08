import type { O2Query } from '../types';

const nanosPerUnit: Record<string, number> = {
  ns: 1,
  us: 1000,
  µs: 1000,
  ms: 1000000,
  s: 1000000000,
  m: 60000000000,
  h: 3600000000000,
};

export function durationError(value?: string): string | undefined {
  if (!value?.trim() || /\$\w+|\$\{[^}]+\}|\[\[[^\]]+\]\]/.test(value)) {
    return undefined;
  }
  const match = /^\s*([0-9]*\.?[0-9]+)\s*(ns|us|µs|ms|s|m|h)?\s*$/.exec(value);
  if (!match) {
    return 'Use a non-negative duration, such as 100us, 1.5ms or 2s.';
  }
  const [whole, fraction = ''] = match[1].split('.');
  const micros =
    (BigInt(`${whole}${fraction}`) * BigInt(nanosPerUnit[match[2] ?? 'us'])) /
    (BigInt(`1${'0'.repeat(fraction.length)}`) * BigInt(1000));
  if (micros > BigInt('9223372036854775')) {
    return 'Duration exceeds the supported nanoseconds range.';
  }
  return undefined;
}

export function queryErrors(query: O2Query) {
  return {
    minDuration: durationError(query.minDuration),
    maxDuration: durationError(query.maxDuration),
    limit:
      query.limit !== undefined && (!Number.isInteger(query.limit) || query.limit > 500)
        ? 'Use a whole number up to 500. Zero or a negative value uses the default of 50.'
        : undefined,
  };
}
