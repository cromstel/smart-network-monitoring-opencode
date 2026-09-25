import { formatBytes, formatUptime } from '../format'

describe('formatBytes', () => {
  it.each([
    [0, '0 B'],
    [1023, '1023 B'],
    [1024, '1.0 KB'],
    [1536, '1.5 KB'],
    [1048576, '1.0 MB'],
    [1073741824, '1.0 GB'],
    ['9007199254740993', '8.0 PB'],
  ])('formats %s as %s', (input: string | number, expected: string) => {
    expect(formatBytes(input)).toBe(expected)
  })

  it('accepts a string above Number.MAX_SAFE_INTEGER without precision loss', () => {
    const big = '9007199254740993'
    expect(formatBytes(big)).toBe('8.0 PB')
  })

  it('throws on a negative count', () => {
    expect(() => formatBytes(-1)).toThrow(/negative/)
  })
})

describe('formatUptime', () => {
  it.each([
    [0, '0m'],
    [59, '0m'],
    [60, '1m'],
    [3661, '1h 1m'],
    [90061, '1d 1h'],
  ])('formats %s seconds as %s', (seconds: number, expected: string) => {
    expect(formatUptime(seconds)).toBe(expected)
  })
})