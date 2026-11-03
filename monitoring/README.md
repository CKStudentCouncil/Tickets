# Watching a sale opening

`createOrder` writes one structured log line per call (`functions/lib/checkoutLog.js`): how it ended, the error code the buyer got, what the Redis stock gate answered, and where the time went. Cloud Logging stores it as `jsonPayload`; this folder turns those lines into log-based metrics, a Cloud Monitoring dashboard (`購票即時監控`) and alert policies. Nothing is added to the checkout itself beyond one stdout write: no Firestore, Redis or HTTP call.

## The log line

```json
{ "message": "checkout", "metric": "checkout", "outcome": "created", "code": "ok", "gate": "admitted",
  "totalMs": 247, "checksMs": 30, "gateMs": 4, "lookMs": 184, "txMs": 47, "backoffMs": 0,
  "txAttempts": 1, "coldStart": false, "inflight": 12 }
```

| Field | Values |
|---|---|
| `outcome` | `created` (new order), `replayed` (a retry got its earlier order), `sold_out` (by the gate or the shards), `busy` (lost the race for stock until the tries ran out, `aborted`), `rejected` (any other refusal: not open yet, rate limit, Turnstile, invalid order…), `error` (`internal`) |
| `code` | the `HttpsError` code sent to the buyer, or `ok` |
| `gate` | `off`, `admitted`, `turned_away` (told 售完 by Redis), `no_answer` (`STOCK_GATE` on, but Upstash timed out, failed or is not set up) |
| `totalMs` | the whole call |
| `checksMs` / `gateMs` / `lookMs` / `txMs` / `backoffMs` | Turnstile + shop open + rate limit; the gate's Redis call; unlocked looks at the stock shards; order transactions; random waits between lost races. The last three are added up over every try. A phase the call never reached is left out |
| `txAttempts` | order transactions tried (each lost race for a shard is one more) |
| `coldStart` | the first checkout this instance served |
| `inflight` | other checkouts this instance was serving when this one started (`concurrency` is 250) |

No email, uid or order details are logged.

## Live, with nothing set up

Logs Explorer → *Stream logs*, with this query, shows every checkout within seconds:

```text
resource.type="cloud_run_revision"
resource.labels.service_name="createorder"
jsonPayload.metric="checkout"
```

Add `jsonPayload.outcome="error"` (or `"busy"`, `"sold_out"`…) to narrow it. Cloud Run → `createorder` → *Metrics* already charts request latency, request count by response code, instances and concurrency.

## Setting up the metrics, dashboard and alerts

Once per project, and again after changing `config.mjs`. Needs `gcloud` signed in as an owner or editor of the project (`gcloud auth login`) and Node 22:

```bash
node monitoring/deploy.mjs --project cksc-ticket --email you@example.com
```

`--email` makes an email notification channel and sends the alerts there; leave it out and the alerts only show in the console. `--dry-run` prints everything it would send. Running it again updates the metrics, dashboard and alert policies in place (found by name) and keeps notification channels added since.

Log-based metrics count only lines written after they exist, so run this before the sale opens, then check the dashboard against a few test checkouts (or the load test, `functions/test/load`).

| What | Name |
|---|---|
| Counter by `outcome`, `code`, `gate` | `logging.googleapis.com/user/checkout_count` |
| Distributions (ms) | `checkout_latency_ms` (by `outcome`), `checkout_checks_ms`, `checkout_gate_ms`, `checkout_look_ms`, `checkout_tx_ms` |
| Distribution (count) | `checkout_tx_attempts` |
| Dashboard | `購票即時監控`: outcomes per second, latency p50/p95/p99, each phase's p95, gate results and hit rate, error codes, transaction tries, Cloud Run latency / instances / concurrency / CPU, and a panel of error logs |
| Alerts | `購票：錯誤比例超過 2%`, `購票：成功訂單 p95 超過 5 秒`, `購票：Redis 閘門無回應超過 10%` (each held for 2 minutes) |

The dashboard's charts align to one minute, and log-based metrics reach them a minute or two after the calls. For second-by-second watching use the log stream above.

The gate's hit rate on the dashboard is

$$\text{hit rate} = \frac{n_\text{turned\_away}}{n_\text{admitted} + n_\text{turned\_away} + n_\text{no\_answer}}$$

which should climb towards 1 once a type is sold out.

## Cost

Each line is well under 1 KB, so even $10^5$ calls in a day are under 100 MB of logs, inside Cloud Logging's free 50 GiB a month. The metrics have few label values (6 outcomes × about 10 codes × 4 gate results at most) and one point a minute, which stays inside Cloud Monitoring's free allotment.
