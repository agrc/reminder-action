const core = require('@actions/core');
const github = require('@actions/github');
const { getRemindersFromBody, getPastDueReminders, createCommentsMetadata } = require('./utilities');

const LABEL = 'reminder';

function getIssueProps(context) {
  return {
    owner: context.repository.owner,
    repo: context.repository.name
  };
}

async function run() {
  try {
    const context = github.context.payload;
    const owner = core.getInput('repositoryOwner');
    const repository = core.getInput('repository');
    const octokit = github.getOctokit(core.getInput('repoToken', {required:true}));

    context.repository = {
      owner,
      name: repository.split('/')[1]
    };

    let issues = [];
    core.startGroup('get open reminder issues');
    for await (const response of octokit.paginate.iterator(octokit.rest.issues.listForRepo, {
      ...getIssueProps(context),
      state: 'open',
      labels: [LABEL],
    })) {
      issues = issues.concat(response.data);
    }

    if (issues.length < 1) {
      core.info('no open issues found with the reminder label');

      return;
    }
    core.endGroup();

    const reminders = [];
    core.startGroup('get all reminders from issues');
    issues.forEach(issue => {
      const remindersFromIssue = getRemindersFromBody(issue.body);

      core.info(`${remindersFromIssue.length} found for issue #${issue.number}`);

      remindersFromIssue.forEach(reminder => {
        reminders.push({issueNumber: issue.number, reminder});
      });
    });

    if (reminders.length < 1) {
      core.info('no reminders found');

      return;
    }
    core.endGroup();

    core.startGroup('filter reminders for past due');
    const pastDueReminders = getPastDueReminders(Date.now(), reminders);

    if (reminders.length < 1) {
      core.info('no past due reminders found');

      return;
    }
    core.endGroup();

    core.startGroup('notify past due reminders');
    core.info(`sending ${reminders.length} past due notifications`);

    const metadata = createCommentsMetadata(pastDueReminders);

    for (let i = 0; i < metadata.length; i++) {
      const data = metadata[i];
      await octokit.rest.issues.createComment({
        ...data,
        ...getIssueProps(context)
      });
    }
    core.endGroup();
  } catch (error) {
    core.setFailed(error.message);
  }
}

run();
