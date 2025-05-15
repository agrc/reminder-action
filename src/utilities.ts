const regex = /\r?\n\r?\n<!-- bot: (?<reminder>{"reminders":.*) -->/;

export interface Reminder {
  id: number;
  who: string;
  what: string;
  when: string;
}

export interface ReminderItem {
  issueNumber: number;
  reminder: Reminder;
  body: string;
}

export interface CommentMetadata {
  issue_number: number;
  body: string;
}

export interface MarkAsNotifiedResult {
  body: string;
  hasActive: boolean;
}

export function getRemindersFromBody(body: string | null): Reminder[] {
  if (body === null) return [];

  const match = body.match(regex);

  return match ? JSON.parse(match.groups!.reminder!).reminders : [];
}

export function getPastDueReminders(now: number, items: ReminderItem[]): ReminderItem[] {
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

export function createCommentsMetadata(items: ReminderItem[]): CommentMetadata[] {
  return items.map((item) => {
    return {
      issue_number: item.issueNumber,
      body: `:wave: @${item.reminder.who}, ${item.reminder.what}`,
    };
  });
}

export function markAsNotified(body: string, reminderId: number): MarkAsNotifiedResult {
  const reminders = getRemindersFromBody(body);
  const activeReminders = reminders.filter((reminder) => reminder.id !== reminderId);

  if (activeReminders.length === 0) {
    return { body: body.replace(regex, ''), hasActive: false };
  }

  return {
    body: body.replace(regex, `\n\n<!-- bot: ${JSON.stringify({ reminders: activeReminders })} -->`),
    hasActive: true,
  };
}
