# Changelog

## Unreleased (proposed 0.5.7)

- `talaria source-maps upload` posts plain base64 gzip to `POST /v1/source-maps` with `Authorization: Bearer` and a `tal_sk_` `TALARIA_RELEASE_KEY`. The host is `TALARIA_URL` or `https://ingest-<cell>.newtalaria.com`.
- `--url-prefix` (e.g. `_next/static`) and `--delete-after-upload` (removes uploaded maps and their `sourceMappingURL` comments).
- Maps are paired with the chunk whose `sourceMappingURL` names them, so Turbopack builds (different chunk and map names) upload served paths.

## 0.5.4

- `talaria source-maps upload` sends gzip bytes as standard base64.

## 0.5.3

- `talaria source-maps upload` sends built JavaScript source maps for a release.
