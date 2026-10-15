# Changelog

## Unreleased (proposed 0.5.7)

- `--url-prefix` (e.g. `_next/static`) and `--delete-after-upload` (removes uploaded maps and their `sourceMappingURL` comments).
- Maps are paired with the chunk whose `sourceMappingURL` names them, so Turbopack builds (different chunk and map names) upload served paths.

## 0.5.4

- `talaria sourcemaps upload` sends gzip bytes in the Serverpod `ByteData` wrapper (`decode('<base64>', 'base64')`).

## 0.5.3

- `talaria sourcemaps upload` sends built JavaScript source maps for a release.
