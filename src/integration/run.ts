import { getOctokit } from '@actions/github';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { randomUUID } from 'node:crypto';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { getRemindersFromBody } from '../utilities.ts';
import {
  assertCreated,
  assertDelivered,
  cleanupFailedFixture,
  gateway,
  memoryApi,
  type Api,
  type Comment,
  type Item,
} from './fixture.ts';

async function runBundle(path: string, env: NodeJS.ProcessEnv) {
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [path], { env, stdio: 'inherit' });
    child.on('error', reject);
    child.on('exit', (code, signal) =>
      code === 0 ? resolve() : reject(new Error(`${path} failed (exit ${code}, signal ${signal})`)),
    );
  });
}

async function exercise(api: Api, repository: string, allowReadOnlySkip = false) {
  const before = await api.getItem();
  assert(
    getRemindersFromBody(before.body).every((reminder) => Date.parse(reminder.when) >= Date.now()),
    'Target already has a past-due reminder; refusing to deliver an unrelated reminder',
  );
  const marker = `integration-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}-${randomUUID()}`;
  const what = `verify ${marker}`;
  let command: Comment;
  try {
    command = await api.comment(`/remind me to ${what} yesterday`);
  } catch (error) {
    if (allowReadOnlySkip && error && typeof error === 'object' && 'status' in error && error.status === 403) {
      console.log(
        '::warning::LIVE integration SKIPPED: command write denied (403/read-only token). Deterministic results only.',
      );
      return false;
    }
    throw error;
  }
  const who = command.user.login;
  console.log(`Command: ${command.html_url}\nMarker: ${marker}`);
  const folder = await mkdtemp(join(tmpdir(), 'reminder-integration-'));
  const server = await gateway(api, repository, before.body);
  let completed = false;
  let created: Item | undefined;
  let createdReminder: ReturnType<typeof assertCreated> | undefined;
  try {
    const [owner, name] = repository.split('/');
    assert(owner && name);
    const eventPath = join(folder, 'issue-comment.json');
    await writeFile(
      eventPath,
      JSON.stringify({
        action: 'created',
        repository: { name, owner: { login: owner } },
        issue: { ...before, state: 'open', pull_request: {} },
        comment: command,
        sender: command.user,
      }),
    );
    const env = {
      ...process.env,
      INPUT_REPOTOKEN: 'integration-fixture',
      INPUT_REPOSITORY: repository,
      INPUT_REPOSITORYOWNER: owner,
      INPUT_TESTCONTEXTPATH: '',
      GITHUB_EVENT_NAME: 'issue_comment',
      GITHUB_EVENT_PATH: eventPath,
      GITHUB_API_URL: server.url,
      GITHUB_TOKEN: '',
    };
    assert(process.env.CREATOR_ACTION_PATH, 'CREATOR_ACTION_PATH must name the pinned creator bundle');
    await runBundle(resolve(process.env.CREATOR_ACTION_PATH), env);
    server.assertHealthy();
    const createdItem = await api.getItem();
    const reminder = assertCreated(before, createdItem, who, what);
    created = createdItem;
    createdReminder = reminder;
    const acknowledgments = (await api.comments()).filter(
      (comment) =>
        comment.id > command.id && comment.body === `@${who} set a reminder for **${reminder.when.split('T')[0]}**`,
    );
    assert.equal(acknowledgments.length, 1, 'Creator did not post exactly one new acknowledgment');
    console.log(`Creation verified: reminder ${reminder.id}, ${JSON.stringify(reminder)}`);
    console.log(`Acknowledgment: ${acknowledgments[0]!.html_url}`);
    const previousIds = new Set((await api.comments()).map((comment) => comment.id));
    await runBundle(resolve('dist/index.js'), env);
    server.assertHealthy();
    const comments = (await api.comments()).filter((comment) => !previousIds.has(comment.id));
    assertDelivered(created, await api.getItem(), reminder, comments);
    const delivery = comments.find((comment) => comment.body === `:wave: @${who}, ${what}`)!;
    console.log(`Delivery verified: ${delivery.html_url}\n${delivery.body}`);
    console.log('Cleanup verified: test metadata removed; label matches remaining reminders');
    completed = true;
  } finally {
    await server.close();
    await rm(folder, { recursive: true });
    if (!completed) {
      const cleaned =
        created && createdReminder
          ? await cleanupFailedFixture(api, created, createdReminder, !before.labels.includes('reminder'))
          : false;
      console.error(
        `Integration failed; fixture cleanup ${cleaned ? 'completed' : 'skipped because state changed or creation was incomplete'}. ` +
          `Inspect marker ${marker}; command retained: ${command.html_url}`,
      );
    }
  }
  return true;
}

async function liveApi(): Promise<{ api: Api; repository: string }> {
  const token = process.env.GITHUB_TOKEN;
  const repository = process.env.GITHUB_REPOSITORY;
  assert(token && repository && process.env.GITHUB_EVENT_PATH, 'Live integration requires a GitHub Actions PR context');
  const event: unknown = JSON.parse(await readFile(process.env.GITHUB_EVENT_PATH, 'utf8'));
  assert(event && typeof event === 'object' && 'pull_request' in event && 'sender' in event);
  const pr = event.pull_request;
  const sender = event.sender;
  assert(pr && typeof pr === 'object' && 'number' in pr && typeof pr.number === 'number' && 'head' in pr);
  assert(sender && typeof sender === 'object' && 'login' in sender && sender.login !== 'dependabot[bot]');
  assert(pr.head && typeof pr.head === 'object' && 'repo' in pr.head);
  const headRepo = pr.head.repo;
  assert(headRepo && typeof headRepo === 'object' && 'full_name' in headRepo && headRepo.full_name === repository);
  const [owner, repo] = repository.split('/');
  assert(owner && repo);
  const client = getOctokit(token);
  const props = { owner, repo, issue_number: pr.number };
  return {
    repository,
    api: {
      async getItem() {
        const { data } = await client.rest.issues.get(props);
        assert.equal(data.state, 'open', 'Integration target must remain open');
        return {
          number: data.number,
          body: data.body ?? null,
          labels: data.labels.map((label) => (typeof label === 'string' ? label : (label.name ?? ''))),
        };
      },
      async comments() {
        const comments = await client.paginate(client.rest.issues.listComments, { ...props, per_page: 100 });
        return comments.map((comment) => {
          assert(comment.user, 'Comment author is missing');
          return { id: comment.id, body: comment.body ?? '', html_url: comment.html_url, user: comment.user };
        });
      },
      async comment(body) {
        const { data } = await client.rest.issues.createComment({ ...props, body });
        assert(data.user, 'Command author is missing');
        return { id: data.id, body: data.body ?? '', html_url: data.html_url, user: data.user };
      },
      async update(body) {
        await client.rest.issues.update({ ...props, body });
      },
      async label() {
        await client.rest.issues.addLabels({ ...props, labels: ['reminder'] });
      },
      async unlabel() {
        await client.rest.issues.removeLabel({ ...props, name: 'reminder' });
      },
    },
  };
}

if (process.env.INTEGRATION_MODE === 'live') {
  const { api, repository } = await liveApi();
  if (await exercise(api, repository, true)) console.log('LIVE integration passed');
} else {
  assert.equal(process.env.INTEGRATION_MODE, 'mock', 'Set INTEGRATION_MODE to mock or live');
  await exercise(memoryApi('Original PR body'), 'fixture/reminder-action');
  const future = { id: 7, who: 'another-user', what: 'keep this reminder', when: '2999-01-01T00:00:00.000Z' };
  await exercise(
    memoryApi(`Original PR body\n\n<!-- bot: ${JSON.stringify({ reminders: [future] })} -->`, [
      'reminder',
      'unrelated',
    ]),
    'fixture/reminder-action',
  );
  console.log('DETERMINISTIC integration passed (no live GitHub writes)');
}
