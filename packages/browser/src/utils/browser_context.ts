export type TrafficKind =
  | 'human'
  | 'crawler'
  | 'ai_crawler'
  | 'ai_agent'
  | 'automation';

export interface BrowserContext {
  /** e.g. Chrome, Firefox, Safari, Edge, Opera, Samsung Internet, unknown */
  name: string;
  /** Semver-ish string when known */
  version: string;
  /** WebKit, Blink, Gecko, or unknown */
  engine: string;
  os: string;
  osVersion: string;
  /** mobile | tablet | desktop | unknown */
  device: string;
  language: string;
  userAgent: string;
  /** True when UA looks like a crawler, agent, or headless fetcher. */
  bot: boolean;
  /** Friendly crawler / agent name when recognized (e.g. Baiduspider). */
  botName?: string;
  /** Traffic class used by product analytics. */
  botKind: TrafficKind;
  /** True when `navigator.webdriver` is set. */
  webdriver: boolean;
  /** True when the page is inside an in-app / embedded WebView. */
  webview: boolean;
  /** Host application when [webview] is true (Instagram, Facebook, …). */
  webviewHost?: string;
  /** Host app version when parsed from the UA. */
  webviewVersion?: string;
}

/** Known browser triage tags; typed as TagMap for mergeTags compatibility. */
export type BrowserContextTags = {
  'browser.name': string;
  'browser.version': string;
  'browser.engine': string;
  'os.name': string;
  'os.version': string;
  device: string;
  webview: string;
  'webview.host'?: string;
  'webview.version'?: string;
  bot?: string;
  'bot.name'?: string;
  'bot.kind'?: string;
} & Record<string, string>;

export interface TrafficMatch {
  bot: boolean;
  botName?: string;
  botKind: TrafficKind;
}

type TrafficRule = {
  name: string;
  kind: Exclude<TrafficKind, 'human'>;
  re: RegExp;
};

/** Order: automation, AI operators, AI crawlers, search crawlers, generic. */
const TRAFFIC_RULES: TrafficRule[] = [
  { name: 'HeadlessChrome', kind: 'automation', re: /HeadlessChrome/i },
  { name: 'Playwright', kind: 'automation', re: /Playwright/i },
  { name: 'Puppeteer', kind: 'automation', re: /Puppeteer/i },
  { name: 'Selenium', kind: 'automation', re: /Selenium|WebDriver/i },
  { name: 'PhantomJS', kind: 'automation', re: /PhantomJS/i },
  { name: 'Cypress', kind: 'automation', re: /Cypress/i },
  { name: 'ChatGPT-User', kind: 'ai_agent', re: /ChatGPT-User/i },
  { name: 'OAI-SearchBot', kind: 'ai_agent', re: /OAI-SearchBot/i },
  { name: 'Claude-User', kind: 'ai_agent', re: /Claude-User/i },
  { name: 'Claude-SearchBot', kind: 'ai_agent', re: /Claude-SearchBot/i },
  { name: 'ChatGPT Atlas', kind: 'ai_agent', re: /ChatGPT-Atlas|ChatGPT Atlas/i },
  { name: 'Comet', kind: 'ai_agent', re: /Perplexity Comet|CometBrowser/i },
  { name: 'GPTBot', kind: 'ai_crawler', re: /GPTBot/i },
  { name: 'ClaudeBot', kind: 'ai_crawler', re: /ClaudeBot|anthropic-ai/i },
  { name: 'PerplexityBot', kind: 'ai_crawler', re: /PerplexityBot/i },
  { name: 'Google-Extended', kind: 'ai_crawler', re: /Google-Extended/i },
  { name: 'Amazonbot', kind: 'ai_crawler', re: /Amazonbot/i },
  { name: 'Bytespider', kind: 'ai_crawler', re: /Bytespider/i },
  { name: 'meta-externalagent', kind: 'ai_crawler', re: /meta-externalagent/i },
  { name: 'Baiduspider', kind: 'crawler', re: /Baiduspider/i },
  { name: 'Googlebot', kind: 'crawler', re: /Googlebot/i },
  { name: 'Bingbot', kind: 'crawler', re: /bingbot/i },
  { name: 'DuckDuckBot', kind: 'crawler', re: /DuckDuckBot/i },
  { name: 'YandexBot', kind: 'crawler', re: /Yandex(Bot|Images)/i },
  { name: 'Applebot', kind: 'crawler', re: /Applebot/i },
  { name: 'facebookexternalhit', kind: 'crawler', re: /facebookexternalhit|Facebot/i },
  { name: 'Twitterbot', kind: 'crawler', re: /Twitterbot/i },
  { name: 'LinkedInBot', kind: 'crawler', re: /LinkedInBot/i },
  { name: 'Slackbot', kind: 'crawler', re: /Slackbot/i },
  { name: 'Discordbot', kind: 'crawler', re: /Discordbot/i },
  { name: 'PetalBot', kind: 'crawler', re: /PetalBot/i },
  { name: 'SemrushBot', kind: 'crawler', re: /SemrushBot/i },
  { name: 'AhrefsBot', kind: 'crawler', re: /AhrefsBot/i },
  { name: 'DotBot', kind: 'crawler', re: /DotBot/i },
  { name: 'Sogou', kind: 'crawler', re: /Sogou/i },
  { name: 'bot', kind: 'crawler', re: /\b(?:bot|crawler|spider|slurp)\b/i },
];

const WEBVIEW_RULES: Array<{
  host: string;
  re: RegExp;
  versionRe?: RegExp;
}> = [
  { host: 'Instagram', re: /Instagram/i, versionRe: /Instagram[/\s]([\d.]+)/i },
  {
    host: 'Facebook',
    re: /FBAN|FBIOS|FB_IAB|FBAV|FB_FW/i,
    versionRe: /FBAV\/([\d.]+)/i,
  },
  {
    host: 'TikTok',
    re: /TikTok|musical_ly|BytedanceWebview|TTWebView/i,
    versionRe: /(?:TikTok|musical_ly)[/\s]([\d.]+)/i,
  },
  { host: 'Line', re: /\bLine\//i, versionRe: /Line\/([\d.]+)/i },
  {
    host: 'Twitter',
    re: /Twitter(?:Android|iPhone| for iPhone)?/i,
    versionRe: /Twitter(?:Android|iPhone)?\/([\d.]+)/i,
  },
  { host: 'LinkedIn', re: /LinkedInApp/i, versionRe: /LinkedInApp\/([\d.]+)/i },
  { host: 'Snapchat', re: /Snapchat/i, versionRe: /Snapchat\/([\d.]+)/i },
];

export function detectTraffic(
  ua: string,
  webdriver = false,
): TrafficMatch {
  if (ua) {
    for (const rule of TRAFFIC_RULES) {
      if (rule.re.test(ua)) {
        return {
          bot: true,
          botKind: rule.kind,
          ...(rule.name === 'bot' ? {} : { botName: rule.name }),
        };
      }
    }
  }
  if (webdriver) {
    return { bot: true, botKind: 'automation', botName: 'WebDriver' };
  }
  return { bot: false, botKind: 'human' };
}

/** Known crawlers — prefer specific names before the generic bot/spider fallback. */
export function detectBot(ua: string): { bot: boolean; botName?: string } {
  const match = detectTraffic(ua);
  return match.bot
    ? { bot: true, ...(match.botName ? { botName: match.botName } : {}) }
    : { bot: false };
}

export function detectWebView(ua: string): {
  webview: boolean;
  host?: string;
  version?: string;
} {
  if (!ua) return { webview: false };
  for (const rule of WEBVIEW_RULES) {
    if (rule.re.test(ua)) {
      const version = rule.versionRe?.exec(ua)?.[1];
      return {
        webview: true,
        host: rule.host,
        ...(version ? { version } : {}),
      };
    }
  }
  if (/;\s*wv\)/i.test(ua) || /WebView/i.test(ua)) {
    return { webview: true, host: 'Android WebView' };
  }
  return { webview: false };
}

export function detectEngine(ua: string): string {
  if (!ua) return 'unknown';
  if (/Gecko\/\d/i.test(ua) && /Firefox\//i.test(ua)) return 'Gecko';
  if (/(?:Chrome|CriOS|Edg|OPR|SamsungBrowser)\//i.test(ua)) return 'Blink';
  if (/AppleWebKit/i.test(ua)) return 'WebKit';
  return 'unknown';
}

/** First numeric segment — Chrome 126.0.0.0 → 126. */
export function majorVersion(version: string): string {
  const m = version.trim().match(/^(\d+)/);
  return m?.[1] ?? '';
}

export function readWebdriver(): boolean {
  try {
    return typeof navigator !== 'undefined' && navigator.webdriver === true;
  } catch {
    return false;
  }
}

export function readTimeZone(): string {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    return '';
  }
}

/**
 * Lightweight UA parse — no dependency. Good enough for triage tags;
 * full UA is still attached in extra for debugging.
 */
export function parseBrowserContext(
  ua = typeof navigator !== 'undefined' ? navigator.userAgent : '',
  language = typeof navigator !== 'undefined' ? navigator.language : '',
  options?: { webdriver?: boolean },
): BrowserContext {
  const userAgent = ua || '';
  const lang = language || '';
  const webdriver = options?.webdriver === true;
  const botInfo = detectTraffic(userAgent, webdriver);
  const webviewInfo = botInfo.bot
    ? { webview: false as const }
    : detectWebView(userAgent);

  let name = 'unknown';
  let version = '';

  // Order matters: Edge/Opera/Samsung before Chrome; Chrome before Safari.
  const rules: Array<{ name: string; re: RegExp }> = [
    { name: 'Edge', re: /Edg(?:e|A|iOS)?\/([\d.]+)/ },
    { name: 'Opera', re: /OPR\/([\d.]+)/ },
    { name: 'Samsung Internet', re: /SamsungBrowser\/([\d.]+)/ },
    { name: 'Firefox', re: /Firefox\/([\d.]+)/ },
    { name: 'Chrome', re: /(?:Chrome|CriOS)\/([\d.]+)/ },
    { name: 'Safari', re: /Version\/([\d.]+).*Safari/ },
  ];

  // Don't invent a browser for crawlers — leave name unknown.
  if (!botInfo.bot) {
    for (const rule of rules) {
      const m = userAgent.match(rule.re);
      if (m) {
        name = rule.name;
        version = m[1] ?? '';
        break;
      }
    }

    // iOS WebKit without Version/ — Safari-compatible engine, not "the Safari app".
    if (name === 'unknown' && /iPhone|iPad|iPod/.test(userAgent) && /AppleWebKit/.test(userAgent)) {
      name = 'Safari';
      const safariVer = userAgent.match(/Version\/([\d.]+)/);
      if (safariVer?.[1]) {
        version = safariVer[1];
      } else {
        const m = userAgent.match(/OS ([\d_]+)/);
        if (m?.[1]) version = m[1].replace(/_/g, '.');
      }
    }
  }

  let os = 'unknown';
  let osVersion = '';
  const win = userAgent.match(/Windows NT ([\d.]+)/);
  if (win) {
    os = 'Windows';
    osVersion = win[1] ?? '';
  } else {
    const android = userAgent.match(/Android ([\d.]+)/);
    if (android) {
      os = 'Android';
      osVersion = android[1] ?? '';
    } else {
      const ios = userAgent.match(/(?:iPhone|iPad|iPod).*OS ([\d_]+)/);
      if (ios) {
        os = 'iOS';
        osVersion = (ios[1] ?? '').replace(/_/g, '.');
      } else {
        const mac = userAgent.match(/Mac OS X ([\d_]+)/);
        if (mac) {
          os = 'macOS';
          osVersion = (mac[1] ?? '').replace(/_/g, '.');
        } else if (/CrOS/.test(userAgent)) {
          os = 'Chrome OS';
        } else if (/Linux/.test(userAgent)) {
          os = 'Linux';
        }
      }
    }
  }

  let device: BrowserContext['device'] = 'desktop';
  if (/iPad|Tablet|Android(?!.*Mobile)/i.test(userAgent)) {
    device = 'tablet';
  } else if (/Mobi|iPhone|iPod|Android.*Mobile/i.test(userAgent)) {
    device = 'mobile';
  } else if (!userAgent) {
    device = 'unknown';
  }

  return {
    name,
    version,
    engine: detectEngine(userAgent),
    os,
    osVersion,
    device,
    language: lang,
    userAgent,
    bot: botInfo.bot,
    botKind: botInfo.botKind,
    webdriver,
    ...(botInfo.botName ? { botName: botInfo.botName } : {}),
    webview: webviewInfo.webview,
    ...('host' in webviewInfo && webviewInfo.host
      ? { webviewHost: webviewInfo.host }
      : {}),
    ...('version' in webviewInfo && webviewInfo.version
      ? { webviewVersion: webviewInfo.version }
      : {}),
  };
}

export function browserContextTags(ctx: BrowserContext): BrowserContextTags {
  return {
    'browser.name': ctx.name,
    'browser.version': ctx.version || 'unknown',
    'browser.engine': ctx.engine || 'unknown',
    'os.name': ctx.os,
    'os.version': ctx.osVersion || 'unknown',
    device: ctx.device,
    webview: ctx.webview ? 'true' : 'false',
    ...(ctx.webview && ctx.webviewHost ? { 'webview.host': ctx.webviewHost } : {}),
    ...(ctx.webview && ctx.webviewVersion
      ? { 'webview.version': ctx.webviewVersion }
      : {}),
    ...(ctx.bot
      ? {
          bot: 'true',
          ...(ctx.botName ? { 'bot.name': ctx.botName } : {}),
          'bot.kind': ctx.botKind,
        }
      : {}),
  };
}

/** Prefer Client Hints when available (Chromium). */
export async function collectBrowserContext(): Promise<BrowserContext> {
  const webdriver = readWebdriver();
  const base = parseBrowserContext(
    undefined,
    undefined,
    { webdriver },
  );

  // Keep crawler classification from UA — Client Hints are for real browsers.
  if (base.bot) return base;

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  const uad = (
    nav as Navigator & {
      userAgentData?: {
        brands?: Array<{ brand: string; version: string }>;
        mobile?: boolean;
        platform?: string;
        getHighEntropyValues?: (hints: string[]) => Promise<{
          platformVersion?: string;
          fullVersionList?: Array<{ brand: string; version: string }>;
        }>;
      };
    }
  )?.userAgentData;

  if (!uad) return base;

  if (uad.mobile === true) base.device = 'mobile';
  if (uad.platform) {
    const p = uad.platform;
    if (/Windows/i.test(p)) base.os = 'Windows';
    else if (/macOS|Mac OS/i.test(p)) base.os = 'macOS';
    else if (/Android/i.test(p)) base.os = 'Android';
    else if (/iOS|iPhone/i.test(p)) base.os = 'iOS';
    else if (/Linux/i.test(p)) base.os = 'Linux';
    else if (/Chrome OS|Chromium OS/i.test(p)) base.os = 'Chrome OS';
    else base.os = p;
  }

  const brands = uad.brands ?? [];
  const interesting = brands.find(
    (b) =>
      !/Not.?A.?Brand/i.test(b.brand) &&
      !/Chromium/i.test(b.brand),
  );
  if (interesting) {
    base.name = interesting.brand.replace(/^Google /, '');
    base.version = interesting.version;
  }

  try {
    if (typeof uad.getHighEntropyValues === 'function') {
      const hi = await uad.getHighEntropyValues([
        'platformVersion',
        'fullVersionList',
      ]);
      if (hi.platformVersion) base.osVersion = hi.platformVersion;
      const full = hi.fullVersionList?.find(
        (b) =>
          !/Not.?A.?Brand/i.test(b.brand) &&
          !/Chromium/i.test(b.brand),
      );
      if (full) {
        base.name = full.brand.replace(/^Google /, '');
        base.version = full.version;
      }
    }
  } catch {
    // Permissions / unsupported — keep UA parse.
  }

  return base;
}
