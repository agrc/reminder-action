function getRemindersFromBody(body) {
  const regex = /\n\n<!-- bot: (?<reminder>{"reminders":.*) -->/;
  const match = body.match(regex);

  return match ? JSON.parse(match.groups.reminder).reminders : [];
}

function getPastDueReminders(now, items) {
  return items.filter((item) => {
    try {
      const dueDate = Date.parse(item.reminder.when);

      return dueDate < now;
    } catch (error) {
      console.error('error parsing date', error);
    }

    return false;
  });
}

function createCommentsMetadata(items) {
  return items.map(item => {
    return {
      issue_number: item.issueNumber,
      body: `:wave: @${item.reminder.who}, ${item.reminder.what}`
    }
  });
}

module.exports = { getRemindersFromBody, getPastDueReminders, createCommentsMetadata };
