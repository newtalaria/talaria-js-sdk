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

Defaults are `http://localhost:8080` and release `local`. The command prints that URL, the release, and each minified basename (`main.a1b2c3.js.map` is uploaded as `main.a1b2c3.js`).

## CI

```sh
export TALARIA_RELEASE="$(git rev-parse HEAD)"
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

The command walks `*.js.map`, skips `node_modules` and `.git`, and skips other maps such as `styles.css.map`. `fileName` is the basename with `.map` removed. A name outside `^[A-Za-z0-9._~+-]+$` fails before the request. The same release and file name replaces the previous map. The process exits non-zero if any file fails.

Open the event after upload. A frame that is still a hashed `*.js` name still needs that basename for this release. The full walkthrough is Talaria docs, **Upload JavaScript source maps** (`guides/upload-javascript-source-maps`).
