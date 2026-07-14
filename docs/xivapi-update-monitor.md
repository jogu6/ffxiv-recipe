# XIVAPI Update Monitor

The update monitor checks the XIVAPI data-mining CSV sources used by the local pipeline and posts to a Discord channel only when their contents change. It runs without a visible terminal through Windows Task Scheduler.

## Monitored sources

The monitor reads the remote CSV definitions from `pipeline/sources.json`. It currently checks:

- `Item.csv`
- `Recipe.csv`
- `ItemUICategory.csv`
- `ItemSearchCategory.csv`

On the first successful run, the downloaded files become the comparison baseline and no Discord notification is sent. Later runs report added, changed, and removed rows. New `Item.csv` rows include up to 20 item IDs and names in the notification.

## Discord configuration

Create a webhook in the Discord channel that should receive notifications. Copy `pipeline/config/xivapi-monitor.example.json` to `pipeline/config/xivapi-monitor.local.json` and replace the example value:

```json
{
  "discordWebhookUrl": "https://discord.com/api/webhooks/ID/TOKEN"
}
```

The local file is ignored by Git. Treat the webhook URL as a secret because anyone who has it can post through the webhook.

## Task Scheduler

The Task Scheduler definition and its VBScript wrapper are machine-local files ignored by Git. Import the local task definition into Windows Task Scheduler. The task runs daily.

The VBScript wrapper starts Node.js with window style `0`, waits for it to finish, and returns its exit code to Task Scheduler.

Run the task manually once after importing it. A successful first run writes `初回基準状態を保存しました` to the log without sending a Discord message.

## Test notification

Send a notification without modifying the comparison baseline:

```powershell
node pipeline/tool/xivapi-update-monitor.mjs --test-notification
```

## Local files

The monitor creates only ignored local data:

- State: `pipeline/state/xivapi-monitor.json`
- Download cache: `pipeline/cache/xivapi-monitor/`
- Log: `pipeline/logs/xivapi-monitor.txt`

Log timestamps use JST in `YYYY-MM-DDTHH:mm:ss.sss+09:00` format. A normal run logs either that no update was found or that changed sources were reported to Discord.

## Troubleshooting

- `ENOENT ... xivapi-monitor.local.json`: create the local webhook configuration described above.
- No log entry: verify that the task action uses `wscript.exe` and the included VBScript wrapper, rather than launching `conhost.exe` directly.
- Discord receives no message on the first run: this is expected; use the test-notification command to verify the webhook.
- Task result is nonzero: inspect the last line of `pipeline/logs/xivapi-monitor.txt`.
