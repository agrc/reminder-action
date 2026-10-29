import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { getRemindersFromBody, type Reminder } from '../utilities.ts';

export interface Item {
  number: number;
  body: string | null;
  labels: string[];
}

export interface Comment {
  id: number;
  body: string;
  html_url: string;
  user: { login: string };
}

export interface Api {
  getItem(): Promise<Item>;
  comments(): Promise<Comment[]>;
  comment(body: string): Promise<Comment>;
  update(body: string): Promise<void>;
  label(): Promise<void>;
  unlabel(): Promise<void>;
}

const metadataPattern = /\r?\n\r?\n<!-- bot: (?<reminder>{"reminders":.*) -->/;

function replaceReminders(body: string, reminders: Reminder[]) {
  const metadata = reminders.length ? `\n\n<!-- bot: ${JSON.stringify({ reminders })} -->` : '';
  return metadataPattern.test(body) ? body.replace(metadataPattern, metadata) : body + metadata;
}

export function withoutReminder(body: string, reminder: Reminder) {
  return replaceReminders(
    body,
    getRemindersFromBody(body).filter((entry) => entry.id !== reminder.id),
  );
}

export async function cleanupFailedFixture(
  api: Api,
  expected: Item,
  reminder: Reminder,
  removeLabel: boolean,
) {
  const current = await api.getItem();
  const sameLabels = (left: string[], right: string[]) =>
    left.length === right.length && left.every((label) => right.includes(label));
  if (current.body !== expected.body || !sameLabels(current.labels, expected.labels)) return false;

  const matches = getRemindersFromBody(current.body).filter((entry) => entry.id === reminder.id);
  assert(matches.length <= 1, 'Ambiguous fixture cleanup; inspect the marker manually');
  const cleanedBody = matches.length ? withoutReminder(current.body ?? '', matches[0]!) : current.body;
  if (cleanedBody !== current.body) await api.update(cleanedBody ?? '');

  const remaining = await api.getItem();
  if (remaining.body !== cleanedBody || !sameLabels(remaining.labels, current.labels)) return false;
  if (
    removeLabel &&
    remaining.labels.includes('reminder') &&
    getRemindersFromBody(remaining.body).length === 0
  ) {
    await api.unlabel();
  }
  return true;
}

export function assertCreated(before: Item, after: Item, who: string, what: string) {
  assert(after.labels.includes('reminder'), 'Creator did not add the reminder label');
  const original = getRemindersFromBody(before.body);
  const reminders = getRemindersFromBody(after.body);
  const matches = reminders.filter((reminder) => reminder.who === who && reminder.what === what);
  assert.equal(matches.length, 1, 'Expected exactly one correlated reminder');
  const reminder = matches[0]!;
  assert(!original.some((entry) => entry.id === reminder.id), 'Creator reused an existing reminder ID');
  assert(Date.parse(reminder.when) < Date.now(), 'Created reminder is not past due');
  assert.deepEqual(reminders, [...original, reminder], 'Creator changed unrelated reminders');
  assert.equal(
    after.body,
    replaceReminders(before.body ?? '', [...original, reminder]),
    'Creator changed unrelated body content',
  );
  return reminder;
}

export function assertDelivered(before: Item, after: Item, reminder: Reminder, comments: Comment[]) {
  assert.equal(
    after.body,
    withoutReminder(before.body ?? '', reminder),
    'Notifier did not remove only the test reminder',
  );
  const hasActive = getRemindersFromBody(after.body).length > 0;
  assert.equal(after.labels.includes('reminder'), hasActive, 'Incorrect reminder label cleanup');
  assert.deepEqual(
    after.labels.filter((label) => label !== 'reminder').sort(),
    before.labels.filter((label) => label !== 'reminder').sort(),
    'Notifier changed unrelated labels',
  );
  assert.equal(
    comments.filter((comment) => comment.body === `:wave: @${reminder.who}, ${reminder.what}`).length,
    1,
    'Expected exactly one new correlated delivery comment',
  );
}

// Keep the real action bundles on one fixture; never expose other repository items.
export async function gateway(api: Api, repository: string, initialBody: string | null) {
  const item = await api.getItem();
  const root = `/repos/${repository}/issues`;
  const target = `${root}/${item.number}`;
  let expectedBody = initialBody;
  const errors: Error[] = [];
  const server = createServer(async (request, response) => {
    try {
      const url = new URL(request.url ?? '/', 'http://localhost');
      const chunks: Buffer[] = [];
      for await (const chunk of request) chunks.push(Buffer.from(chunk));
      const text = Buffer.concat(chunks).toString();
      const data: unknown = text ? JSON.parse(text) : {};
      let result: unknown = {};
      if (request.method === 'GET' && url.pathname === root) {
        assert.equal(url.searchParams.get('state'), 'open');
        assert.equal(url.searchParams.get('labels'), 'reminder');
        const current = await api.getItem();
        expectedBody = current.body;
        result = current.labels.includes('reminder') ? [current] : [];
      } else if (request.method === 'POST' && url.pathname === `${target}/comments`) {
        assert(data && typeof data === 'object' && 'body' in data && typeof data.body === 'string');
        result = await api.comment(data.body);
      } else if (request.method === 'POST' && url.pathname === `${target}/labels`) {
        assert.deepEqual(data, { labels: ['reminder'] });
        await api.label();
      } else if (request.method === 'PATCH' && url.pathname === target) {
        assert(data && typeof data === 'object' && 'body' in data && typeof data.body === 'string');
        assert.equal((await api.getItem()).body, expectedBody, 'Body changed concurrently; refusing to overwrite it');
        await api.update(data.body);
        expectedBody = data.body;
      } else if (request.method === 'DELETE' && url.pathname === `${target}/labels/reminder`) {
        assert.equal(getRemindersFromBody((await api.getItem()).body).length, 0, 'Unrelated reminders still exist');
        await api.unlabel();
      } else {
        throw new Error(`Unexpected integration API request: ${request.method} ${url.pathname}`);
      }
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(result));
    } catch (error) {
      const failure = error instanceof Error ? error : new Error(String(error));
      errors.push(failure);
      response.writeHead(409, { 'content-type': 'application/json' }).end(JSON.stringify({ message: failure.message }));
    }
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert(address && typeof address !== 'string');
  return {
    url: `http://127.0.0.1:${address.port}`,
    assertHealthy() {
      assert.deepEqual(errors, [], 'Integration API gateway rejected an unsafe or unexpected request');
    },
    async close() {
      await new Promise<void>((resolve, reject) => server.close((error) => (error ? reject(error) : resolve())));
    },
  };
}

export function memoryApi(body = '', labels: string[] = []): Api {
  const item: Item = { number: 1, body, labels: [...labels] };
  const comments: Comment[] = [];
  return {
    async getItem() {
      return structuredClone(item);
    },
    async comments() {
      return structuredClone(comments);
    },
    async comment(body) {
      const comment = {
        id: comments.length + 1,
        body,
        html_url: `http://fixture/comments/${comments.length + 1}`,
        user: { login: 'integration-user' },
      };
      comments.push(comment);
      return structuredClone(comment);
    },
    async update(body) {
      item.body = body;
    },
    async label() {
      if (!item.labels.includes('reminder')) item.labels.push('reminder');
    },
    async unlabel() {
      item.labels = item.labels.filter((label) => label !== 'reminder');
    },
  };
}
