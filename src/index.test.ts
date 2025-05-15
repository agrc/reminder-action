import { describe, expect, test } from 'vitest';
import type { ReminderItem } from './utilities';
import { createCommentsMetadata, getPastDueReminders, getRemindersFromBody, markAsNotified } from './utilities';

describe('getRemindersFromBody', () => {
  test('can find reminder issues', () => {
    const body = `testing

<!-- bot: {"reminders":[{"id":1,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"}]} -->`;

    const expected = {
      id: 1,
      who: 'stdavis',
      what: 'celebrate',
      when: '2020-06-24T09:28:33.000Z',
    };

    expect(getRemindersFromBody(body)).toEqual([expected]);
  });
  test('Can handle body being null', () => {
    const body = null;
    expect(getRemindersFromBody(body)).toEqual([]);
  });
});

describe('getPastDueReminders', () => {
  test('returns past due reminders', () => {
    const today = new Date(2000, 1, 1).getTime();
    const items: ReminderItem[] = [
      {
        issueNumber: 1,
        reminder: {
          id: 1,
          who: 'test-user',
          what: 'test-action',
          when: '2001-06-24T09:00:00.000Z',
        },
        body: 'test-body',
      },
      {
        issueNumber: 2,
        reminder: {
          id: 2,
          who: 'test-user',
          what: 'test-action',
          when: '1999-06-24T09:00:00.000Z',
        },
        body: 'test-body',
      },
    ];

    const results = getPastDueReminders(today, items);

    expect(results.length).toBe(1);
    expect(results[0]?.issueNumber).toBe(2);
  });
  test('can handle malformed date', () => {
    const today = new Date(2000, 1, 1).getTime();
    const items: ReminderItem[] = [
      {
        issueNumber: 1,
        reminder: {
          id: 1,
          who: 'test-user',
          what: 'test-action',
          when: 'blah',
        },
        body: 'test-body',
      },
      {
        issueNumber: 2,
        reminder: {
          id: 2,
          who: 'test-user',
          what: 'test-action',
          when: '1999-06-24T09:00:00.000Z',
        },
        body: 'test-body',
      },
    ];

    const results = getPastDueReminders(today, items);

    expect(results.length).toBe(1);
    expect(results[0]?.issueNumber).toBe(2);
  });
});

describe('createComments', () => {
  test('creates comments parameters array', () => {
    const items: ReminderItem[] = [
      {
        issueNumber: 1,
        reminder: {
          id: 1,
          who: 'steve',
          what: 'to something',
          when: '2020-01-01T00:00:00.000Z',
        },
        body: 'test-body',
      },
      {
        issueNumber: 2,
        reminder: {
          id: 2,
          who: 'scott',
          what: 'to something else',
          when: '2020-01-01T00:00:00.000Z',
        },
        body: 'test-body',
      },
    ];

    const result = createCommentsMetadata(items);

    expect(result[0]).toEqual({
      issue_number: 1,
      body: ':wave: @steve, to something',
    });
    expect(result.length).toBe(2);
  });
});

describe('markAsNotified', () => {
  test('removes reminder from body but leaves active ones', () => {
    const body = `testing

<!-- bot: {"reminders":[{"id":1,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"},{"id":2,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"}]} -->`;

    const expected = {
      body: `testing

<!-- bot: {"reminders":[{"id":2,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"}]} -->`,
      hasActive: true,
    };

    expect(markAsNotified(body, 1)).toEqual(expected);
  });
  test('removes reminder from body', () => {
    const body = `testing

<!-- bot: {"reminders":[{"id":1,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"}]} -->`;

    const expected = { body: 'testing', hasActive: false };

    expect(markAsNotified(body, 1)).toEqual(expected);
  });
});
