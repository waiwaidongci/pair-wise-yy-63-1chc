import type { Token } from './api';

export const THEMES = ['light', 'dark', 'ops', 'contrast'] as const;
export type ThemeKey = (typeof THEMES)[number];

export const THEME_LABELS: Record<string, string> = {
  light: '明亮',
  dark: '暗色',
  ops: '运营',
  contrast: '高对比'
};

export type ResolutionErrorKind = 'cycle' | 'missing';

export type ResolutionError = {
  token: string;
  theme: string;
  kind: ResolutionErrorKind;
  ref?: string;
  path?: string[];
};

export type ResolutionResult = {
  /** resolved[tokenId][theme] = final literal value */
  values: Record<string, Record<string, string>>;
  errors: ResolutionError[];
};

const REF_PATTERN = /^\{([^{}]+)\}$/;

export function parseRef(raw: unknown): string | undefined {
  if (typeof raw !== 'string') return undefined;
  const match = raw.match(REF_PATTERN);
  return match ? match[1].trim() : undefined;
}

/**
 * Resolve every token for every theme. A theme value may be a literal
 * (e.g. `#2864dc`) or a reference `{other.id}` that is followed within the
 * same theme. Cycles and dangling references are reported instead of throwing.
 */
export function resolveThemes(tokens: Token[], themes: readonly string[] = THEMES): ResolutionResult {
  const byId = new Map<string, Token>();
  for (const token of tokens) byId.set(token.id, token);

  const values: Record<string, Record<string, string>> = {};
  const errors: ResolutionError[] = [];
  const seenErrors = new Set<string>();

  const pushError = (error: ResolutionError) => {
    const key = `${error.token}|${error.theme}|${error.kind}|${error.ref ?? ''}`;
    if (seenErrors.has(key)) return;
    seenErrors.add(key);
    errors.push(error);
  };

  for (const token of tokens) {
    values[token.id] = {};
    for (const theme of themes) {
      const stack: string[] = [];
      let currentId: string | undefined = token.id;
      let resolved: string | undefined;
      let guard = 0;
      while (currentId && guard < 512) {
        guard += 1;
        if (stack.includes(currentId)) {
          pushError({ token: currentId, theme, kind: 'cycle', path: [...stack, currentId] });
          resolved = undefined;
          break;
        }
        stack.push(currentId);
        const current = byId.get(currentId);
        if (!current) {
          pushError({ token: currentId, theme, kind: 'missing' });
          resolved = undefined;
          break;
        }
        const raw = current.themes && current.themes[theme] !== undefined ? current.themes[theme] : current.value;
        const refId = parseRef(raw);
        if (!refId) {
          resolved = raw;
          break;
        }
        if (!byId.has(refId)) {
          pushError({ token: current.id, theme, kind: 'missing', ref: refId });
          resolved = undefined;
          break;
        }
        currentId = refId;
      }
      values[token.id][theme] = resolved ?? '';
    }
  }

  return { values, errors };
}

export function describeError(error: ResolutionError): string {
  const themeLabel = THEME_LABELS[error.theme] ?? error.theme;
  if (error.kind === 'cycle') {
    return `令牌 ${error.token} 在「${themeLabel}」主题形成循环引用（${error.path?.join(' → ')}）`;
  }
  if (error.ref) {
    return `令牌 ${error.token} 在「${themeLabel}」主题引用了不存在的令牌 ${error.ref}`;
  }
  return `令牌 ${error.token} 在「${themeLabel}」主题引用缺失`;
}

/**
 * Upgrade a legacy token draft that lacks a `themes` field: assign its single
 * value to the light theme and fill any missing themes with the light value.
 */
export function migrateToken(token: Token): Token {
  const migrated: Token = { ...token, themes: { ...(token.themes ?? {}) } };
  if (!migrated.themes || typeof migrated.themes !== 'object' || Object.keys(migrated.themes).length === 0) {
    migrated.themes = { light: migrated.value };
  }
  const fallback = migrated.themes.light ?? migrated.value;
  for (const theme of THEMES) {
    if (migrated.themes[theme] === undefined || migrated.themes[theme] === null) {
      migrated.themes[theme] = fallback;
    }
  }
  return migrated;
}

export function migrateTokens(tokens: Token[]): Token[] {
  return tokens.map(migrateToken);
}

export function cloneTokens(tokens: Token[]): Token[] {
  return tokens.map((token) => ({ ...token, themes: { ...token.themes } }));
}

export function tokenEqual(a: Token | undefined, b: Token | undefined): boolean {
  if (!a || !b) return a === b;
  if (a.id !== b.id) return false;
  const themeKeys = new Set([...Object.keys(a.themes ?? {}), ...Object.keys(b.themes ?? {})]);
  for (const key of themeKeys) {
    if ((a.themes ?? {})[key] !== (b.themes ?? {})[key]) return false;
  }
  return (
    a.name === b.name &&
    a.category === b.category &&
    a.value === b.value &&
    a.ref === b.ref &&
    a.usage === b.usage &&
    a.status === b.status &&
    a.description === b.description
  );
}
