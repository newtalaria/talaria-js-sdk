# Changelog

## Unreleased

## 0.2.2

- Pull `@newtalaria/node` 0.2.1 and `@newtalaria/react` 0.2.1 so App Router apps get product analytics and identity stamping.

## 0.2.1

- Also listen for Navigation API `currentchange` so App Router route changes still start a new transaction if History is wrapped by Next.js.

## 0.2.0

- Initial Next.js adapter with `/client`, `/server`, `/edge`, and `/config` entrypoints.
- `initClient`, `initServer`, `captureRequestError`, `withServerAction`, `withRouteHandler`, `withTalariaConfig`.
