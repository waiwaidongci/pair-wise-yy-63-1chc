import type { Token } from './api';
import { THEMES, rawForToken, themeLabel } from './resolution';

/**
 * 离线草稿三方合并。
 * base 为上次同步成功时的远端快照，local 为离线期间编辑后的令牌，remote 为最新远端。
 * 两边改了同一令牌的同一字段时判定冲突：两边原值都保留在冲突记录中，
 * 由维护员在发布准备页选择，绝不静默覆盖任何一侧。
 */

export type ConflictScope = 'themes' | 'meta';

export type MergeConflict = {
  tokenId: string;
  tokenName: string;
  /** 冲突字段（主题原值或名称/说明/状态等元数据）。 */
  field: string;
  /** 主题标识；元数据冲突时为空。 */
  theme?: string;
  scope: ConflictScope;
  base: string;
  /** 离线草稿保留的原值。 */
  local: string;
  /** 远端保留的原值。 */
  remote: string;
  /** 解决后采用哪一侧。 */
  resolution?: 'local' | 'remote';
};

export type MergeResult = {
  tokens: Token[];
  conflicts: MergeConflict[];
  applied: number;
};

const META_FIELDS = ['name', 'description', 'status'] as const;
type MetaField = (typeof META_FIELDS)[number];

function getField(token: Token, field: string): string {
  if (field === 'name') return token.name;
  if (field === 'description') return token.description;
  if (field === 'status') return token.status;
  return '';
}

export function setField(token: Token, field: string, value: string): void {
  if (field === 'name') token.name = value;
  else if (field === 'description') token.description = value;
  else if (field === 'status') token.status = value as Token['status'];
}

export const META_FIELD_LABELS: Record<string, string> = {
  name: '名称',
  description: '说明',
  status: '状态'
};

export function conflictFieldLabel(conflict: MergeConflict): string {
  if (conflict.scope === 'meta') return META_FIELD_LABELS[conflict.field] ?? conflict.field;
  return `${themeLabel(conflict.theme ?? 'light')}主题原值`;
}

/** 旧稿归一化：缺少 themes 字段（或缺少明亮主题）时升级成明亮主题。 */
export function normalizeToken(token: Token): Token {
  const themes: Record<string, string> = token.themes && typeof token.themes === 'object'
    ? { ...token.themes }
    : {};
  if (themes.light === undefined) themes.light = token.value;
  const ref = token.ref ?? (rawForToken({ value: token.value, themes }, 'light').match(/^\{([^{}]+)\}$/)?.[1]);
  return { ...token, themes, ...(ref ? { ref } : {}) };
}

function threeWay(base: string | undefined, local: string | undefined, remote: string | undefined): 'local' | 'remote' | undefined {
  if (local === remote) return local === undefined ? undefined : 'local';
  if (local === base) return remote === undefined ? undefined : 'remote';
  if (remote === base) return local === undefined ? undefined : 'local';
  return undefined; // 两侧都改且不同 → 冲突
}

export function mergeTokens(base: Token[], local: Token[], remote: Token[]): MergeResult {
  const normalizedBase = base.map((token) => normalizeToken(token));
  const normalizedLocal = local.map((token) => normalizeToken(token));
  const normalizedRemote = remote.map((token) => normalizeToken(token));
  const baseMap = new Map(normalizedBase.map((token) => [token.id, token]));
  const localMap = new Map(normalizedLocal.map((token) => [token.id, token]));
  const remoteMap = new Map(normalizedRemote.map((token) => [token.id, token]));
  const ids = new Set<string>([...localMap.keys(), ...remoteMap.keys()]);
  const merged: Token[] = [];
  const conflicts: MergeConflict[] = [];
  let applied = 0;

  for (const id of ids) {
    const b = baseMap.get(id);
    const l = localMap.get(id);
    const r = remoteMap.get(id);

    if (!b) {
      // 双方都新增了同一 ID：无共同基线可做三方比对，先到一方整体为准；
      // 字段级差异仍列出为冲突，保证两边原值都不丢。
      const winner = (l ?? r)!;
      const token: Token = JSON.parse(JSON.stringify(winner));
      if (l && r) {
        if (r.usage !== l.usage) token.usage = Math.max(l.usage, r.usage);
        const allThemes = new Set([...Object.keys(l.themes), ...Object.keys(r.themes)]);
        allThemes.forEach((theme) => {
          const lv = rawForToken(l, theme);
          const rv = rawForToken(r, theme);
          if (lv !== rv && !conflicts.some((c) => c.tokenId === id && c.field === `themes.${theme}`)) {
            conflicts.push({
              tokenId: id,
              tokenName: token.name,
              field: `themes.${theme}`,
              theme,
              scope: 'themes',
              base: '',
              local: lv,
              remote: rv
            });
            token.themes[theme] = lv;
          } else if (token.themes[theme] === undefined) {
            token.themes[theme] = rv;
          }
        });
        META_FIELDS.forEach((field) => {
          const lv = getField(l, field);
          const rv = getField(r, field);
          if (lv !== rv) {
            conflicts.push({ tokenId: id, tokenName: token.name, field, scope: 'meta', base: '', local: lv, remote: rv });
            setField(token, field, lv);
          }
        });
      } else if (r) {
        applied += 1;
      }
      merged.push(token);
      continue;
    }

    const token: Token = JSON.parse(JSON.stringify(b));
    // 只合并三方任一侧显式声明过的主题；未声明主题走解析时的 value 回退，不算改动。
    const allThemes = new Set<string>([
      ...Object.keys(b.themes ?? {}),
      ...Object.keys(l?.themes ?? {}),
      ...Object.keys(r?.themes ?? {})
    ]);

    allThemes.forEach((theme) => {
      const lv = l?.themes[theme];
      const rv = r?.themes[theme];
      const bv = b.themes[theme];
      const winner = threeWay(bv, lv, rv);
      if (winner === 'local') {
        token.themes[theme] = lv!;
        if (lv !== bv) applied += 1;
      } else if (winner === 'remote') {
        token.themes[theme] = rv!;
      } else if (winner === undefined && lv !== undefined && rv !== undefined && lv !== rv) {
        conflicts.push({
          tokenId: id,
          tokenName: token.name,
          field: `themes.${theme}`,
          theme,
          scope: 'themes',
          base: bv ?? rawForToken(b, theme),
          local: lv,
          remote: rv
        });
        token.themes[theme] = lv; // 默认保留本地原值，等待维护员裁决
      } else if (winner === undefined && rv !== undefined && lv === undefined) {
        token.themes[theme] = rv;
      }
    });

    META_FIELDS.forEach((field) => {
      const lv = l ? getField(l, field) : undefined;
      const rv = r ? getField(r, field) : undefined;
      const bv = getField(b, field);
      const winner = threeWay(bv, lv, rv);
      if (winner === 'local') {
        setField(token, field, lv!);
        if (lv !== bv) applied += 1;
      } else if (winner === 'remote') {
        setField(token, field, rv!);
      } else if (lv !== undefined && rv !== undefined && lv !== rv) {
        conflicts.push({
          tokenId: id,
          tokenName: token.name,
          field,
          scope: 'meta',
          base: bv,
          local: lv,
          remote: rv
        });
        setField(token, field, lv);
      }
    });

    token.usage = r?.usage ?? l?.usage ?? b.usage;
    token.category = r?.category ?? l?.category ?? b.category;
    // value 以明亮主题解析事实为准，保持与旧结构兼容。
    token.value = token.themes.light ?? b.value;
    const lightRef = token.value.match(/^\{([^{}]+)\}$/)?.[1];
    if (lightRef) token.ref = lightRef;
    else delete token.ref;
    merged.push(token);
  }

  return { tokens: merged, conflicts, applied };
}
