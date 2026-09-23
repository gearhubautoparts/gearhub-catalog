# GearHub public catalog

Public product data for gearhubparts.com, not the private storefront source.
No orders, customer data, API credentials, or encrypted credential files belong here.

GitHub Actions checks the seller's complete active listing set hourly at minute 23.
Prices and availability are reconciled each successful run. At most 130 detailed
listing reads run per update; new and changed summaries have priority. Other
photos, SKU and specifics are refreshed in a rolling cycle after 24 hours.
A large backlog may require several runs. API errors preserve the published file.

Only fixed GetUser, GetMyeBaySelling and GetItem API calls are implemented.
Credentials are held in repository Actions Secrets, available only to the trusted
main-branch schedule/manual workflow. Never enable untrusted pull request workflows.

The website reads data/catalog.json over GitHub's public raw HTTPS endpoint.
No hourly Render builds, paid runners, artifact storage, database or paid cron service.
Public standard GitHub-hosted Actions runners are free under the current GitHub plan.
Schedules can be delayed, and a service outage can leave stale data; this is an
inquiry catalog, not a real-time checkout inventory guarantee.

Check Actions for the most recent successful run or use Run workflow for recovery.
GitHub notification preferences control failure emails. Disable the workflow to pause.
Public schedules can be disabled after 60 days of repository inactivity; successful
updates normally commit a fresh catalog timestamp. Re-enable after an extended outage.

Local commands: npm ci, npm test, npm run sync (requires the three EBAY_* variables).
