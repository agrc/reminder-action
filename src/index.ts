import { endGroup, getInput, info, setFailed, startGroup } from '@actions/core';
import { getOctokit, context as ghContext } from '@actions/github';
import type { ReminderItem } from './utilities.js';
import { createCommentsMetadata, getPastDueReminders, getRemindersFromBody, markAsNotified } from './utilities.js';

const LABEL = 'reminder';

// I could not find this type in the @octokit/webhooks-types package
// ref: https://github.com/octokit/webhooks/issues/141
interface RepositoryContext {
  repository: {
    owner: {
      login: string;
    };
    name: string;
  };
}

function getRepoProps(context: RepositoryContext) {
  const inputOwner = getInput('repositoryOwner');
  const inputRepository = getInput('repository');
  let repo: string;
  if (inputRepository) {
    const parts = inputRepository.split('/');
    if (parts.length !== 2) {
      throw new Error(`Invalid repository input: ${inputRepository}`);
    }
    repo = parts[1]!;
  } else {
    repo = context.repository.name;
  }

  return {
    owner: inputOwner ?? context.repository.owner.login,
    repo: repo,
  };
}

type Issue = {
  number: number;
  body: string | null;
};

async function run() {
  try {
    const context = ghContext.payload as RepositoryContext;
    const repoToken = getInput('repoToken', { required: true });
    const octokit = getOctokit(repoToken);

    let issues: Issue[] = [];
    startGroup('get open reminder issues');

    const iterator = octokit.paginate.iterator(
      // todo: make this include PRs as well
      'GET /repos/{owner}/{repo}/issues',
      {
        ...getRepoProps(context),
        state: 'open',
        labels: LABEL,
      },
    );

    for await (const response of iterator) {
      issues = issues.concat(response.data as Issue[]);
    }

    endGroup();

    if (issues.length < 1) {
      info('no open issues found with the reminder label');

      return;
    }

    const reminders: ReminderItem[] = [];
    startGroup('get all reminders from issues');
    issues.forEach((issue: Issue) => {
      const remindersFromIssue = getRemindersFromBody(issue.body);

      info(`${remindersFromIssue.length} found for issue #${issue.number}`);

      remindersFromIssue.forEach((reminder) => {
        reminders.push({
          issueNumber: issue.number,
          reminder,
          body: issue.body || '',
        });
      });
    });

    if (reminders.length < 1) {
      info('no reminders found');

      return;
    }
    endGroup();

    startGroup('filter reminders for past due');
    const pastDueReminders = getPastDueReminders(Date.now(), reminders);

    if (pastDueReminders.length < 1) {
      info('no past due reminders found');

      return;
    }
    endGroup();

    startGroup('notify past due reminders');
    info(`sending ${pastDueReminders.length} past due notifications`);

    const metadata = createCommentsMetadata(pastDueReminders);

    for (let i = 0; i < metadata.length; i++) {
      const data = metadata[i]!;
      await octokit.rest.issues.createComment({
        ...data,
        ...getRepoProps(context),
      });
    }
    endGroup();

    startGroup('removing notification metadata');
    for (let i = 0; i < pastDueReminders.length; i++) {
      const reminder = pastDueReminders[i];
      if (!reminder) continue;

      const { body, reminder: reminderData, issueNumber } = reminder;

      const { body: newBody, hasActive } = markAsNotified(body, reminderData.id);

      const updateData = {
        body: newBody,
        issue_number: issueNumber,
        ...getRepoProps(context),
      };

      info(JSON.stringify(updateData, null, 1));

      await octokit.rest.issues.update(updateData);

      if (!hasActive) {
        const data = {
          issue_number: issueNumber,
          name: LABEL,
          ...getRepoProps(context),
        };

        info(JSON.stringify(data, null, 1));

        await octokit.rest.issues.removeLabel(data);
      }
    }

    endGroup();
  } catch (error) {
    if (error instanceof Error) {
      setFailed(error);
    } else {
      setFailed('An unknown error occurred');
    }

    throw error;
  }
}

run();
