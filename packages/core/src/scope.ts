import type { UserContext } from './types.js';
import { mergeTags, type TagMap } from './utils/tags.js';

/** Mutable process/page scope: user, tags. Isolated per client instance. */
export class Scope {
  private userId?: string;
  private tags: TagMap = {};

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

  clear(): void {
    this.userId = undefined;
    this.tags = {};
  }
}
