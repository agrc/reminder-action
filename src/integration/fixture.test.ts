import { spawnSync } from 'node:child_process';
import { describe, expect, test } from 'vitest';
import { assertCreated, assertDelivered, gateway, memoryApi, withoutReminder, type Item } from './fixture.ts';

const reminder = { id: 1, who: 'tester', what: 'verify unique-marker', when: '2000-01-01T00:00:00.000Z' };
const other = { id: 2, who: 'another-user', what: 'keep', when: '2999-01-01T00:00:00.000Z' };
const body = (reminders = [reminder]) => `PR body\n\n<!-- bot: ${JSON.stringify({ reminders })} -->`;
const initial: Item = { number: 1, body: 'PR body', labels: ['unrelated'] };
const created: Item = { ...initial, body: body(), labels: ['unrelated', 'reminder'] };
const delivery = { id: 3, body: ':wave: @tester, verify unique-marker', html_url: 'fixture/3', user: { login: 'bot' } };

describe('integration evidence', () => {
  test('a successful no-op creator fails the harness instead of reporting a pass', () => {
    const result = spawnSync(process.execPath, ['src/integration/run.ts'], {
      env: {
        ...process.env,
        INTEGRATION_MODE: 'mock',
        CREATOR_ACTION_PATH: 'src/integration/fixture.ts',
      },
      encoding: 'utf8',
      timeout: 15_000,
    });
    expect(result.error).toBeUndefined();
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain('Creator did not add the reminder label');
    expect(result.stdout).not.toContain('integration passed');
  });

  test('requires an exact correlated, past-due creation and preserves prior body and metadata', () => {
    expect(assertCreated(initial, created, reminder.who, reminder.what)).toEqual(reminder);
    expect(() => assertCreated(initial, initial, reminder.who, reminder.what)).toThrow('label');
    expect(() => assertCreated(initial, created, reminder.who, 'old-marker')).toThrow('correlated');
    expect(() => assertCreated(created, created, reminder.who, reminder.what)).toThrow('existing reminder ID');
    expect(() => assertCreated(initial, { ...created, body: body([other]) }, other.who, other.what)).toThrow(
      'not past due',
    );
    expect(() =>
      assertCreated(
        initial,
        { ...created, body: body().replace('PR body', 'Overwritten') },
        reminder.who,
        reminder.what,
      ),
    ).toThrow('unrelated body');
  });

  test('does not accept a no-op, a command comment, missing cleanup, or a duplicate delivery', () => {
    expect(() => assertDelivered(created, initial, reminder, [])).toThrow('delivery');
    expect(() =>
      assertDelivered(created, initial, reminder, [
        { ...delivery, body: '/remind me to verify unique-marker yesterday' },
      ]),
    ).toThrow('delivery');
    expect(() => assertDelivered(created, created, reminder, [delivery])).toThrow('test reminder');
    expect(() => assertDelivered(created, initial, reminder, [delivery, delivery])).toThrow('delivery');
    expect(() => assertDelivered(created, initial, reminder, [delivery])).not.toThrow();
  });

  test('retains the label and unrelated metadata when another reminder remains', () => {
    const before = { ...created, body: body([reminder, other]) };
    const after = { ...created, body: body([other]) };
    expect(withoutReminder(before.body, reminder)).toBe(after.body);
    expect(() => assertDelivered(before, after, reminder, [delivery])).not.toThrow();
    expect(() => assertDelivered(before, { ...after, labels: ['unrelated'] }, reminder, [delivery])).toThrow(
      'label cleanup',
    );
    expect(() => assertDelivered(created, { ...initial, labels: [] }, reminder, [delivery])).toThrow(
      'unrelated labels',
    );
  });
});

describe('scoped integration API', () => {
  test('exposes only the target item and rejects writes to another item', async () => {
    const api = memoryApi(body(), ['reminder']);
    const server = await gateway(api, 'owner/repo', body());
    try {
      const response = await fetch(`${server.url}/repos/owner/repo/issues?state=open&labels=reminder`);
      expect(await response.json()).toEqual([await api.getItem()]);
      const rejected = await fetch(`${server.url}/repos/owner/repo/issues/2/comments`, {
        method: 'POST',
        body: JSON.stringify({ body: 'not allowed' }),
      });
      expect(rejected.status).toBe(409);
      expect(await api.comments()).toEqual([]);
      expect(() => server.assertHealthy()).toThrow('unsafe or unexpected request');
    } finally {
      await server.close();
    }
  });

  test('rejects a stale body write without losing concurrent edits', async () => {
    const api = memoryApi('Original');
    const server = await gateway(api, 'owner/repo', 'Original');
    try {
      await api.update('Concurrent user edit');
      const response = await fetch(`${server.url}/repos/owner/repo/issues/1`, {
        method: 'PATCH',
        body: JSON.stringify({ body: 'Stale action body' }),
      });
      expect(response.status).toBe(409);
      expect((await api.getItem()).body).toBe('Concurrent user edit');
    } finally {
      await server.close();
    }
  });

  test('never removes a label while unrelated reminders remain', async () => {
    const api = memoryApi(body([other]), ['reminder']);
    const server = await gateway(api, 'owner/repo', body([other]));
    try {
      const response = await fetch(`${server.url}/repos/owner/repo/issues/1/labels/reminder`, { method: 'DELETE' });
      expect(response.status).toBe(409);
      expect((await api.getItem()).labels).toEqual(['reminder']);
    } finally {
      await server.close();
    }
  });
});
