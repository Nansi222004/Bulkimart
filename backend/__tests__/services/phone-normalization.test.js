import { normalizePhone, phoneLookupCandidates } from '../../utils/phone.js';

test.each([
  ['9876543210', '9876543210'],
  ['+91 98765-43210', '9876543210'],
  ['0091 9876543210', '9876543210'],
  ['09876543210', '9876543210'],
])('normalizes %s to one customer identity', (input, expected) => {
  expect(normalizePhone(input)).toBe(expected);
});

test('lookup candidates include canonical and legacy stored formats', () => {
  expect(phoneLookupCandidates('+91 98765-43210')).toEqual(expect.arrayContaining([
    '9876543210', '+919876543210', '919876543210', '09876543210',
  ]));
});

test('invalid phone formats are rejected', () => {
  expect(normalizePhone('12345')).toBe('');
  expect(normalizePhone({ phone: '9876543210' })).toBe('');
});
