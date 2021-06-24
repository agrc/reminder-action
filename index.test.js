const { getRemindersFromBody, getPastDueReminders, createCommentsMetadata } = require("./utilities");

describe("getRemindersFromBody", () => {
  test("can find reminder issues", () => {
    const body = `testing

<!-- bot: {"reminders":[{"id":1,"who":"stdavis","what":"celebrate","when":"2020-06-24T09:28:33.000Z"}]} -->`;

    const expected = { id: 1, who: "stdavis", what: "celebrate", when: "2020-06-24T09:28:33.000Z" };

    expect(getRemindersFromBody(body)).toEqual([expected]);
  });
});

describe("getPastDueReminders", () => {
  test("returns past due reminders", () => {
    const today = new Date(2000, 1, 1);
    const items = [
      {
        issueNumber: 1,
        reminder: {
          when: "2001-06-24T09:00:00.000Z",
        },
      },
      {
        issueNumber: 2,
        reminder: {
          when: "1999-06-24T09:00:00.000Z",
        },
      },
    ];

    const results = getPastDueReminders(today, items);

    expect(results.length).toBe(1);
    expect(results[0].issueNumber).toBe(2);
  });
  test("can handle malformed date", () => {
    const today = new Date(2000, 1, 1);
    const items = [
      {
        issueNumber: 1,
        reminder: {
          when: "blah",
        },
      },
      {
        issueNumber: 2,
        reminder: {
          when: "1999-06-24T09:00:00.000Z",
        },
      },
    ];

    const results = getPastDueReminders(today, items);

    expect(results.length).toBe(1);
    expect(results[0].issueNumber).toBe(2);
  });
});

describe('createComments', () => {
  test('creates comments parameters array', () => {
    const items = [
      {
        issueNumber: 1,
        reminder: {
          who: 'steve',
          what: 'to something'
        },
      },
      {
        issueNumber: 2,
        reminder: {
          who: 'scott',
          what: 'to something else'
        },
      },
    ];

    const result = createCommentsMetadata(items);

    expect(result[0]).toEqual({
      issue_number: 1,
      body: ':wave: @steve, to something'
    });
    expect(result.length).toBe(2);
  });
});
