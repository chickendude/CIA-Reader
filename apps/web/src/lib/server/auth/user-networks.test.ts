// @vitest-environment node
import { expect, it } from 'vitest';
import { networkKey } from './user-networks.js';

it('groups equivalent IPv4 and IPv6 spellings with a keyed identifier', () => {
  const key = networkKey(() => '192.0.2.1');
  expect(key).toMatch(/^[a-f0-9]{64}$/);
  expect(key).toBe(networkKey(() => '::ffff:c000:201'));
  expect(key).not.toBe(networkKey(() => '192.0.2.2'));
  expect(networkKey(() => '2001:0db8::1')).toBe(networkKey(() => '2001:db8::1'));
});

it('leaves unavailable and invalid addresses ungrouped', () => {
  expect(networkKey(() => { throw new Error('Unavailable'); })).toBeNull();
  expect(networkKey(() => 'unknown')).toBeNull();
});
