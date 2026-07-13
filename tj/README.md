# tj — TOON-ify any JSON-speaking CLI

The [ght](../ght/) trick, generalized: `tj <command...>` runs any
CLI and re-emits JSON stdout as comma-delimited TOON, after applying a
per-CLI **prune profile** auto-detected from the command name.

```
$ tj gh api repos/cli/cli          # github profile: URLs pruned, owner → login
id: 212613049
name: cli
full_name: cli/cli
owner: cli
...
tj: ~290 tokens (raw: ~1,442, 80% saved, profile: github)

$ tj kubectl get pods -o json      # kubernetes profile: managedFields gone
$ tj aws ec2 describe-instances    # aws profile: ResponseMetadata gone
$ tj vercel ls --json              # unknown CLI: generic profile, TOON only
```

Profiles: `github` (gh — same rules as ght: hypermedia URL pruning, users →
login, repos → full_name, labels → names, PGP blobs trimmed), `kubernetes`
(kubectl/oc — drops `managedFields`, `selfLink`, the
last-applied-configuration annotation), `aws` (drops `ResponseMetadata`),
`generic` (encoding only). Add profiles in `src/profiles.js`.

Everything else passes through byte-for-byte: non-JSON output, error output
(non-zero exits are never transformed), binary, stderr, exit codes.
Paginated/concatenated JSON and NDJSON are handled and merged.

Flags (consumed anywhere, never forwarded): `--tj-raw`, `--tj-no-prune`,
`--tj-json`, `--tj-profile=<name>`, `--tj-delimiter=comma|tab|pipe`,
`--tj-no-stats`. Env: `TJ_RAW=1`, `TJ_PRUNE=0`, `TJ_STATS=0`, `TJ_PROFILE`,
`TJ_DELIMITER`.

For `gh` specifically, [`ght`](../ght/) remains the daily driver (same
github rules, plus its benchmark); `tj` is for every other JSON-speaking CLI
your agents touch.
