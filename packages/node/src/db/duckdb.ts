import type { Span } from "@newtalaria/core";
import type { TalariaNodeClient } from "../client.js";
import { operationName, queryText, spanName } from "./sql.js";

const DUCKDB_SYSTEM = "duckdb";

const DUCKDB_RUN_METHODS = [
  "run",
  "runAndRead",
  "runAndReadAll",
  "runAndReadUntil",
  "stream",
  "streamAndRead",
  "streamAndReadAll",
  "streamAndReadUntil",
] as const;

const DUCKDB_HOLD_METHODS = ["start", "startStream"] as const;

const DUCKDB_PENDING_METHODS = [
  "getResult",
  "read",
  "readAll",
  "readUntil",
] as const;

type DuckDBMethod = (...args: unknown[]) => unknown;

interface DuckDBTarget {
  prepare?: DuckDBMethod;
  [method: string]: DuckDBMethod | undefined;
}

const preparedSql = new WeakMap<object, string>();

/**
 * Wrap a `@duckdb/node-api` connection so `run`, `stream`, `prepare`, and
 * `runAndRead*` become CLIENT spans. The driver stays a peer dependency.
 * Bound values and result rows are not copied onto the span or the error.
 */
export function wrapDuckDB<T extends object>(
  client: TalariaNodeClient,
  connection: T,
): T {
  const target = connection as T & DuckDBTarget;
  wrapRunners(client, target, (args) =>
    typeof args[0] === "string" ? args[0] : "",
  );
  wrapPrepare(client, target);
  return connection;
}

function wrapRunners(
  client: TalariaNodeClient,
  target: DuckDBTarget,
  sqlFrom: (args: unknown[]) => string,
): void {
  for (const name of DUCKDB_RUN_METHODS) {
    const original = target[name];
    if (typeof original !== "function") continue;
    const bound = original.bind(target);
    target[name] = (...args: unknown[]) =>
      trace(client, sqlFrom(args), () => bound(...args));
  }
  for (const name of DUCKDB_HOLD_METHODS) {
    const original = target[name];
    if (typeof original !== "function") continue;
    const bound = original.bind(target);
    target[name] = (...args: unknown[]) =>
      trace(client, sqlFrom(args), () => bound(...args), { hold: true });
  }
}

function wrapPrepare(client: TalariaNodeClient, target: DuckDBTarget): void {
  const original = target.prepare;
  if (typeof original !== "function") return;
  const bound = original.bind(target);
  target.prepare = (...args: unknown[]) => {
    const sql = typeof args[0] === "string" ? args[0] : "";
    return trace(client, sql, () => bound(...args), {
      after: (value) => {
        if (!value || typeof value !== "object") return value;
        preparedSql.set(value, sql);
        wrapRunners(
          client,
          value as DuckDBTarget,
          () => preparedSql.get(value) ?? sql,
        );
        return value;
      },
    });
  };
}

function trace(
  client: TalariaNodeClient,
  sql: string,
  run: () => unknown,
  opts?: { hold?: boolean; after?: (value: unknown) => unknown },
): unknown {
  const text = queryText(sql);
  client.addBreadcrumb({
    type: "query",
    category: "db",
    message: operationName(sql),
    level: "info",
    data: { "db.system.name": DUCKDB_SYSTEM },
  });
  const span: Span | null = client.recordsQuerySpans
    ? client.startSpan(spanName(sql, DUCKDB_SYSTEM), {
        kind: "client",
        attributes: {
          "db.system.name": DUCKDB_SYSTEM,
          "db.operation.name": operationName(sql),
          ...(text ? { "db.query.text": text } : {}),
        },
      })
    : null;

  const fail = (error: unknown): never => {
    span?.setStatus(
      "error",
      error instanceof Error ? error.message : String(error),
    );
    span?.end();
    void client.captureException(error, {
      extra: {
        "db.system.name": DUCKDB_SYSTEM,
        ...(text ? { "db.query.text": text } : {}),
      },
    });
    throw error;
  };

  const succeed = (value: unknown): unknown => {
    const next = opts?.after ? opts.after(value) : value;
    if (opts?.hold && next && typeof next === "object") {
      armPending(
        next as DuckDBTarget,
        () => {
          span?.setStatus("ok");
          span?.end();
        },
        fail,
      );
      return next;
    }
    span?.setStatus("ok");
    span?.end();
    return next;
  };

  try {
    const result = run();
    if (isPromise(result)) {
      return result.then(succeed, (error: unknown) => fail(error));
    }
    return succeed(result);
  } catch (error) {
    fail(error);
  }
}

function armPending(
  pending: DuckDBTarget,
  ok: () => void,
  fail: (error: unknown) => never,
): void {
  let settled = false;
  const finishOk = () => {
    if (settled) return;
    settled = true;
    ok();
  };
  const finishErr = (error: unknown): never => {
    if (settled) throw error;
    settled = true;
    fail(error);
  };
  let armed = false;
  for (const name of DUCKDB_PENDING_METHODS) {
    const original = pending[name];
    if (typeof original !== "function") continue;
    armed = true;
    const bound = original.bind(pending);
    pending[name] = (...args: unknown[]) => {
      try {
        const result = bound(...args);
        if (isPromise(result)) {
          return result.then(
            (value) => {
              finishOk();
              return value;
            },
            (error: unknown) => finishErr(error),
          );
        }
        finishOk();
        return result;
      } catch (error) {
        finishErr(error);
      }
    };
  }
  if (!armed) finishOk();
}

function isPromise(value: unknown): value is Promise<unknown> {
  return (
    Boolean(value) && typeof (value as Promise<unknown>).then === "function"
  );
}
