import type { Token } from './api';

/**
 * 主题解析引擎：把每个主题的令牌引用图解析成「发布事实」。
 * 令牌上的 themes[theme] / value 只保存声明原值（可能是 {token.id} 引用），
 * 任何一枚基础令牌变化，都会经 Pinia 的响应式 getter 让下游语义令牌、
 * 组件别名在受影响主题下重新解析，UI 与发布差异直接消费解析结果。
 */

export const THEMES = ['light', 'dark', 'ops', 'contrast'] as const;
export type ThemeId = (typeof THEMES)[number];

export const THEME_LABELS: Record<string, string> = {
  light: '明亮',
  dark: '暗色',
  ops: '运营',
  contrast: '高对比度'
};

export function themeLabel(theme: string): string {
  return THEME_LABELS[theme] ?? theme;
}

const REF_PATTERN = /\{([^{}]+)\}/g;
const FULL_REF_PATTERN = /^\{([^{}]+)\}$/;

/** 某主题下的声明原值：主题缺省（旧稿）时回退到令牌的规范值 value。 */
export function rawForToken(token: Pick<Token, 'value' | 'themes'>, theme: string): string {
  return token.themes[theme] ?? token.value;
}

export function extractRefs(raw: string): string[] {
  if (!raw.includes('{')) return [];
  return [...raw.matchAll(REF_PATTERN)].map((match) => match[1].trim());
}

/** 整条声明是否就是一枚引用，如 "{color.base.blue.600}"。 */
export function asSingleRef(raw: string): string | undefined {
  const match = FULL_REF_PATTERN.exec(raw.trim());
  return match ? match[1].trim() : undefined;
}

export type ResolutionErrorType = 'cycle' | 'missing';

export type ResolutionError = {
  type: ResolutionErrorType;
  theme: string;
  /** 卡住解析的那一枚令牌：循环时为环上首枚，缺失时为持有悬空引用的令牌。 */
  tokenId: string;
  /** 缺失引用目标（仅 missing）。 */
  ref?: string;
  /** 解析链路（entry-first）。循环时首尾相同。 */
  path: string[];
  message: string;
};

export type ThemeResolution = {
  theme: string;
  values: Map<string, string>;
  errors: ResolutionError[];
};

export type ResolutionMap = Map<string, ThemeResolution>;

export function resolveAll(tokens: Token[], themes: readonly string[] = THEMES): ResolutionMap {
  const result: ResolutionMap = new Map();
  for (const theme of themes) result.set(theme, resolveTheme(tokens, theme));
  return result;
}

function resolveTheme(tokens: Token[], theme: string): ThemeResolution {
  const byId = new Map(tokens.map((token) => [token.id, token]));
  const values = new Map<string, string>();
  const errors: ResolutionError[] = [];
  const reported = new Set<string>();
  const label = themeLabel(theme);

  function report(error: ResolutionError, dedupeKey: string) {
    if (reported.has(dedupeKey)) return;
    reported.add(dedupeKey);
    errors.push(error);
  }

  // stack 为当前引用链（holder-first）：[当前持有引用的令牌, ...更上层令牌]
  function resolveRef(id: string, stack: string[]): string | null {
    const token = byId.get(id);
    if (!token) {
      const holder = stack[0];
      const chain = [...stack].reverse();
      report(
        {
          type: 'missing',
          theme,
          tokenId: holder,
          ref: id,
          path: chain,
          message: `缺失引用：令牌「${holder}」在${label}主题引用了不存在的「{${id}}」，解析链路 ${chain.join(' → ')}。`
        },
        `missing:${theme}:${holder}:${id}`
      );
      return null;
    }

    if (stack.includes(id)) {
      const reversed = [...stack].reverse();
      const start = reversed.indexOf(id);
      const cyclePath = [...reversed.slice(start), id];
      report(
        {
          type: 'cycle',
          theme,
          tokenId: id,
          path: cyclePath,
          message: `循环引用：令牌「${id}」在${label}主题的解析链路 ${cyclePath.join(' → ')} 回到自身，无法确定发布值。`
        },
        `cycle:${theme}:${cyclePath.join('→')}`
      );
      return null;
    }

    if (values.has(id)) return values.get(id)!;

    const raw = rawForToken(token, theme);
    const resolved = resolveRaw(raw, [id, ...stack]);
    values.set(id, resolved);
    return resolved;
  }

  function resolveRaw(raw: string, stack: string[]): string {
    if (!raw.includes('{')) return raw;
    return raw.replace(REF_PATTERN, (whole, refId: string) => {
      const resolved = resolveRef(refId.trim(), stack);
      // 解析失败的引用保留原占位，发布门禁会拦截，绝不静默产出错误颜色。
      return resolved === null ? whole : resolved;
    });
  }

  for (const token of tokens) {
    if (values.has(token.id)) continue;
    values.set(token.id, resolveRaw(rawForToken(token, theme), [token.id]));
  }

  return { theme, values, errors };
}

/** 汇总所有主题下的解析错误。 */
export function collectErrors(resolution: ResolutionMap): ResolutionError[] {
  return [...resolution.values()].flatMap((item) => item.errors);
}
