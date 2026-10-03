import type { UserContext } from './types.js';
import { mergeTags, type TagMap } from './utils/tags.js';

/** Named structured context stored on the scope and copied onto event extra. */
export type ScopeContext = Record<string, unknown>;

/** Mutable process/page scope: user, tags, extra, and named context. Isolated per client instance. */
export class Scope {
  private userId?: string;
  private tags: TagMap = {};
  private extra: Record<string, unknown> = {};
  private contexts: Record<string, ScopeContext> = {};

  setUser(user: UserContext | null): void {
    if (!user || user.id == null || user.id === '') {
      this.userId = undefined;
      return;
    }
    this.userId = String(user.id);
  }

  getUserId(): string | undefined {
    return this.userId;
  }

  setTag(key: string, value: string): void {
    this.tags = mergeTags(this.tags, { [key]: value });
  }

  setTags(tags: Record<string, string>): void {
    this.tags = mergeTags(this.tags, tags);
  }

  getTags(): TagMap {
    return { ...this.tags };
  }

  /** Flat extra field. `null` removes the key. */
  setExtra(key: string, value: unknown): void {
    const name = key.trim();
    if (!name) return;
    if (value == null) {
      delete this.extra[name];
      return;
    }
    this.extra[name] = value;
  }

  /**
   * Named context object copied onto event extra under [name].
   * `null` removes that context. Call-site `extra` with the same key wins.
   */
  setContext(name: string, context: ScopeContext | null): void {
    const key = name.trim();
    if (!key) return;
    if (context == null) {
      delete this.contexts[key];
      return;
    }
    this.contexts[key] = { ...context };
  }

  /** Scope extra and named contexts, then per-capture extra. */
  mergeCaptureExtra(
    callExtra?: Record<string, unknown>,
  ): Record<string, unknown> | undefined {
    const merged: Record<string, unknown> = {
      ...this.extra,
      ...this.contexts,
    };
    if (callExtra) {
      for (const [key, value] of Object.entries(callExtra)) {
        merged[key] = value;
      }
    }
    return Object.keys(merged).length ? merged : undefined;
  }

  clear(): void {
    this.userId = undefined;
    this.tags = {};
    this.extra = {};
    this.contexts = {};
  }
}
