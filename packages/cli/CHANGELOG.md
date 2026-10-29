# Changelog

## 0.6.0

- **Breaking:** `dsn` is removed. `talaria source-maps upload` posts plain base64 gzip to `POST /v1/source-maps` with `Authorization: Bearer`. `TALARIA_RELEASE_KEY` (or `--api-key`) must be a `tal_sk_<env>_<cell>_<43><6>` key (CRC32 base62 checksum). The host is `TALARIA_URL` / `--url`, otherwise `https://ingest-<cell>.newtalaria.com` from the key cell. A `self` cell requires `--url` or `TALARIA_URL`. Errors are `application/problem+json`.
- Depends on `@newtalaria/core` ^0.6.0.
- `--url-prefix` (e.g. `_next/static`) and `--delete-after-upload` (removes uploaded maps and their `sourceMappingURL` comments).
- Maps are paired with the chunk whose `sourceMappingURL` names them, so Turbopack builds (different chunk and map names) upload served paths.

## 0.5.4

- `talaria source-maps upload` sends gzip bytes as standard base64.

## 0.5.3

- `talaria source-maps upload` sends built JavaScript source maps for a release.
