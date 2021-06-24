# Reminder Action

[![units-test](https://github.com/agrc/reminder-action/actions/workflows/test.yml/badge.svg)](https://github.com/agrc/reminder-action/actions/workflows/test.yml)

## About

Based on the [probot reminder bot](https://github.com/probot/reminders/) that no longer works. Now in a 2 part github action form! One action to create the reminder metadata and label. And another to run on a schedule to let you know when your reminder is due.

_This action requires the use of [agrc/create-reminder-action](https://github.com/agrc/create-reminder-action) as well._

Use the `/remind` slash command to set a reminder on any comment box on GitHub and you'll get a ping about it again when the reminder is due.

Use any form of `/remind me [what] [when]`, such as:

- `/remind me to deploy on Oct 10`
- `/remind me next Monday to review the requirements`
- `/remind me that the specs on the rotary girder need checked in 6 months`

## Sample Usage

```yml
name: 'check reminders'

on:
  schedule:
    - cron: "0 * * * *"

jobs:
  reminder:
    runs-on: ubuntu-latest

    steps:
    - name: check reminders and notify
      uses: agrc/reminder-action@v1.0.0
```

## Package for distribution

GitHub Actions will run the entry point from the action.yml. Packaging assembles the code into one file that can be checked in to Git, enabling fast and reliable execution and preventing the need to check in node_modules.

Actions are run from GitHub repos.  Packaging the action will create a packaged action in the dist folder.

Run prepare

```bash
npm run prepare
```

Since the packaged index.js is run from the dist folder.

```bash
git add dist
```

Use the draft a release workflow on GitHub.
