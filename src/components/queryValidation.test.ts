import { durationError, queryErrors } from './queryValidation';

describe('query validation', () => {
  it.each([
    '',
    '  ',
    '0',
    '.5ms',
    '100us',
    '2 µs',
    '1ns',
    '2s',
    '1m',
    '1h',
    '$duration',
    '${duration:raw}ms',
    '[[duration]]',
    '9223372036854775us',
    '9223372036854775999ns',
  ])('accepts %s', (value) => {
    expect(durationError(value)).toBeUndefined();
  });
  it.each(['-1ms', '1e3', '1d', '1.', 'NaN', 'Infinity', '9223372036854776us', '9223372036854776000ns'])(
    'rejects %s',
    (value) => {
      expect(durationError(value)).toBeDefined();
    }
  );
  it.each([undefined, -1, 0, 50, 500])('accepts limit %s', (limit) => {
    expect(queryErrors({ refId: 'A', limit }).limit).toBeUndefined();
  });
  it.each([1.5, 501, NaN, Infinity])('rejects limit %s', (limit) => {
    expect(queryErrors({ refId: 'A', limit }).limit).toBeDefined();
  });
});
