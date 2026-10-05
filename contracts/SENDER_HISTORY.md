# Sender payment history

Both payment contracts expose `get_batches_by_sender(sender, page, limit)`.
In `bulk_payment` the result contains batch IDs; in `cross_asset_payment` it
contains payment IDs. The latter also exposes `get_payments_by_sender` with
identical behavior. Read each ID using the existing `get_batch` or `get_payment`.
No authorization is required, matching the existing public record getters.

Pages are **zero-based** and return newest creations first. For a sender whose
IDs were created as `[1, 3, 4]`, page 0 / limit 2 returns `[4, 3]` and page 1
returns `[1]`. Limits above 100 are clamped to 100 before calculating the page
offset. A zero limit, unknown sender, or out-of-range page returns an empty list.
Use the same limit between pages. This is offset pagination, not a snapshot:
concurrent new payments shift page boundaries, so clients should refresh from
page 0 or deduplicate IDs when paging through an actively changing history.

Both bulk execution modes append exactly once when they create a batch record.
A partial batch with no successful transfers is still a record and is included.
Reverted calls add no history. Cross-asset status changes and cancellations do
not add entries, remove entries, or reorder existing IDs.

The shared index stores a count per sender and one persistent entry per ID.
An append writes two bounded entries; a page reads one count and at most 100 IDs.
It does not scan all senders/payments or load an unbounded history vector.
New entries receive a 518,400-ledger TTL. Archived persistent entries must be
restored through normal Soroban transaction simulation/restoration; the history
reader does not refresh rent or silently treat missing indexed IDs as success.
The existing bulk-record storage layout and payment/fee behavior are unchanged.

The index covers records created by this version. Deployments upgrading from a
version without the index need a separately coordinated historical backfill;
this change does not silently scan or migrate old records during payments.

Run the two affected contract suites (three additional history tests):

```sh
cargo test --locked -p bulk_payment -p cross_asset_payment
```
