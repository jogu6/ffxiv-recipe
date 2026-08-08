# Lodestone Update Monitor

The update monitor checks the Lodestone item and recipe list metadata and posts to Discord only when it changes. Requests are strictly sequential, with a default interval of 100 milliseconds.

## Monitored values

- Lodestone Version
- Total item count
- Total recipe count
- Item-order signature

The full descending item list is read only when the Version or total item count differs from the saved state. When both are unchanged, the saved item-order signature is reused. The first successful run saves a baseline without sending a notification.

## Discord configuration

Copy `pipeline/config/lodestone-monitor.example.json` to `pipeline/config/lodestone-monitor.local.json` and set the webhook URL:

```json
{
  "discordWebhookUrl": "https://discord.com/api/webhooks/ID/TOKEN",
  "delayMs": 100
}
```

The local file is ignored by Git. Keep the webhook URL secret because anyone with the URL can post through it.

## Task Scheduler

Run this command from the existing hidden Windows Task Scheduler wrapper:

```powershell
node pipeline/tool/lodestone-update-monitor.mjs
```

## Test notification

```powershell
node pipeline/tool/lodestone-update-monitor.mjs --test-notification
```

This does not modify the comparison baseline.

## Local files

- State: `pipeline/state/lodestone-monitor.json`
- Log: `pipeline/logs/lodestone-monitor.txt`

Log timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format.
