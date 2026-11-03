import { expect, it } from 'vitest';
import { parseUserDeletionDependencies } from '../src/utils/userDeletion';

it('keeps valid dependency counts when the database includes malformed entries', () => {
  const valid = { table: 'tickets', column: 'requester_id', count: 2 };
  const rows = [valid, null, 'invalid', { table: 1, column: 'id', count: 1 },
    { table: 'tickets', column: null, count: 1 }, { table: 'tickets', column: 'requester_id', count: '2' },
    { table: 'tickets', column: 'requester_id', count: 0 }, { table: 'tickets', column: 'requester_id', count: -1 },
    { table: 'tickets', column: 'requester_id', count: 1.5 }];
  expect(parseUserDeletionDependencies(`USER_HAS_DEPENDENCIES:${JSON.stringify(rows)}`)).toEqual([valid]);
});

it.each(['permission denied', 'USER_HAS_DEPENDENCIES:invalid-json', 'USER_HAS_DEPENDENCIES:{}', 'USER_HAS_DEPENDENCIES:null'])
  ('does not turn an unrelated or malformed error into a dependency summary: %s', (message) => {
    expect(parseUserDeletionDependencies(message)).toEqual([]);
  });
