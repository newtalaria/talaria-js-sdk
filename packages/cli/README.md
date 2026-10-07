# @newtalaria/cli

Uploads built JavaScript source maps so Talaria can show original frames when an event is opened.

The browser key stays an ingest key. This command uses a second key with only `releases:write`. The release string must match `Talaria.init({ release })`.

```sh
npx talaria sourcemaps upload ./dist
```

## Local

With the Talaria API on port 8080:

```sh
export TALARIA_RELEASE_KEY=tal_live_…   # releases:write only
export TALARIA_RELEASE=local            # same string as Talaria.init

talaria sourcemaps upload ./dist
```

Defaults are `http://localhost:8080` and release `local`. The command prints that URL, the release, and each artifact path. When a `.js` file sits beside a `.js.map`, the command writes one debug id into both and uploads the JavaScript path relative to the directory you passed (`dist/assets/app.js.map` is `assets/app.js`). Deploy those rewritten `.js` files. A map with no sibling keeps its basename.

## CI

On GitHub Actions, [`newtalaria/source-maps@v1`](https://github.com/newtalaria/source-maps) uploads a directory of built maps and sets a `release` output. The workflow is in [Releases](https://www.newtalaria.com/docs/guides/releases).

The CLI command is the same upload:

```sh
export TALARIA_RELEASE="${GITHUB_REF_NAME}@${GITHUB_SHA::7}"
npx talaria sourcemaps upload \
  --url "$TALARIA_BASE_URL" \
  --api-key "$TALARIA_RELEASE_KEY" \
  --release "$TALARIA_RELEASE" \
  ./dist
```

The app keeps its ingest key:

```js
Talaria.init({
  dsn: process.env.NEXT_PUBLIC_TALARIA_DSN,
  apiKey: process.env.NEXT_PUBLIC_TALARIA_API_KEY,
  release: process.env.NEXT_PUBLIC_TALARIA_RELEASE,
})
```

Hidden source maps work. Talaria reads the uploaded file when the event is opened. For Next.js, run this command after `next build`. `withTalariaConfig` configures the app.

## Flags

| Setting | Flag | Environment | Default |
| ------- | ---- | ----------- | ------- |
| Directory | positional | | `.` |
| API URL | `--url` | `TALARIA_BASE_URL` | `http://localhost:8080` |
| Release | `--release` | `TALARIA_RELEASE` | `local` |
| Key | `--api-key` | `TALARIA_RELEASE_KEY`, then `TALARIA_API_KEY` | required |
| Silverstripe combine | `--silverstripe-combine-files` | | off |

`--silverstripe-combine-files` is the Silverstripe compatibility mode. `Requirements::combine_files` writes one header line before the first file. The flag shifts that map's generated lines by one and still writes the debug id into the sibling `.js`. The uploaded script is that first file. Deploy the rewritten `.js` so the combiner reads it. A script the browser loads directly is uploaded without the flag.

The command walks `*.js.map`, skips `node_modules` and `.git`, and skips other maps such as `styles.css.map`. Each path segment must match `^[A-Za-z0-9._~+-]+$`, with no `..`, and the full name must be at most 200 characters. The same release and file name replaces the previous map. The process exits non-zero if any file fails.

Talaria matches a debug id first, then the release plus that artifact path. A stored name with no slash still matches the basename. The full walkthrough is Talaria docs, **Upload JavaScript source maps** (`guides/upload-javascript-source-maps`).
