import { defineStore } from 'pinia';
import type { Token } from './api';
import {
  THEMES,
  cloneTokens,
  describeError,
  migrateToken,
  migrateTokens,
  parseRef,
  resolveThemes,
  tokenEqual,
  type ResolutionError
} from './resolver';

export type TokenCategory = Token['category'];

export type ChangeRequest = {
  id: string;
  title: string;
  requester: string;
  scope: string;
  impact: number;
  status: '待评审' | '已接受' | '已退回';
  diff: { token: string; before: string; after: string };
};

export type TokenConflict = {
  id: string;
  name: string;
  local: Token;
  remote: Token;
  base?: Token;
};

export type DiffRow = {
  id: string;
  tokenId: string;
  name: string;
  theme: string;
  before: string;
  after: string;
};

const initialTokens: Token[] = [
  { id: 'color.base.blue.600', name: '品牌主色 600', category: 'color', value: '#2864dc', themes: { light: '#2864dc', dark: '#6f96ff', ops: '#24786a', contrast: '#0b4dba' }, usage: 184, status: 'stable', description: '主操作、链接和重点状态' },
  { id: 'color.semantic.primary', name: '语义主色', category: 'color', value: '{color.base.blue.600}', ref: 'color.base.blue.600', themes: { light: '{color.base.blue.600}', dark: '{color.base.blue.400}', ops: '{color.base.green.600}', contrast: '{color.base.blue.800}' }, usage: 126, status: 'stable', description: '组件库统一主色别名' },
  { id: 'color.base.blue.400', name: '品牌蓝 400', category: 'color', value: '#6f96ff', themes: { light: '#6f96ff', dark: '#6f96ff', ops: '#58a99a', contrast: '#2878e8' }, usage: 42, status: 'stable', description: '暗色主题主色' },
  { id: 'color.base.blue.800', name: '品牌蓝 800', category: 'color', value: '#0b4dba', themes: { light: '#0b4dba', dark: '#9ab9ff', ops: '#145c51', contrast: '#06358a' }, usage: 31, status: 'stable', description: '高对比主题主色' },
  { id: 'color.base.green.600', name: '运营绿 600', category: 'color', value: '#24786a', themes: { light: '#24786a', dark: '#54b2a0', ops: '#24786a', contrast: '#0d5a4d' }, usage: 67, status: 'proposed', description: '运营产品品牌替换色' },
  { id: 'color.text.primary', name: '正文主色', category: 'color', value: '#17202b', themes: { light: '#17202b', dark: '#f5f7fa', ops: '#152a25', contrast: '#000000' }, usage: 293, status: 'stable', description: '主要正文和标题' },
  { id: 'color.text.secondary', name: '正文次色', category: 'color', value: '#667582', themes: { light: '#667582', dark: '#a8b2bd', ops: '#62766f', contrast: '#303b46' }, usage: 211, status: 'stable', description: '辅助信息和说明' },
  { id: 'color.surface.canvas', name: '页面背景', category: 'color', value: '#f2f5f7', themes: { light: '#f2f5f7', dark: '#121821', ops: '#f1f6f4', contrast: '#ffffff' }, usage: 54, status: 'stable', description: '应用一级背景' },
  { id: 'font.family.sans', name: '无衬线字体', category: 'font', value: '"Noto Sans SC", sans-serif', themes: { light: '"Noto Sans SC", sans-serif', dark: '"Noto Sans SC", sans-serif', ops: '"Noto Sans SC", sans-serif', contrast: 'system-ui, sans-serif' }, usage: 388, status: 'stable', description: '产品界面默认真体' },
  { id: 'font.size.body', name: '正文字号', category: 'font', value: '14px', themes: { light: '14px', dark: '14px', ops: '14px', contrast: '16px' }, usage: 255, status: 'stable', description: '正文与表单文本' },
  { id: 'spacing.base.2', name: '基础间距 2', category: 'spacing', value: '8px', themes: { light: '8px', dark: '8px', ops: '8px', contrast: '8px' }, usage: 312, status: 'stable', description: '紧凑布局基础间距' },
  { id: 'radius.control', name: '控件圆角', category: 'radius', value: '6px', themes: { light: '6px', dark: '6px', ops: '4px', contrast: '4px' }, usage: 167, status: 'stable', description: '按钮、输入框和卡片' },
  { id: 'shadow.raised', name: '浮层阴影', category: 'shadow', value: '0 8px 28px rgba(22,35,48,.14)', themes: { light: '0 8px 28px rgba(22,35,48,.14)', dark: '0 8px 28px rgba(0,0,0,.42)', ops: '0 8px 28px rgba(21,54,45,.14)', contrast: '0 0 0 2px #303b46' }, usage: 36, status: 'stable', description: '菜单、弹窗和浮层' },
  { id: 'component.button.primary.bg', name: '主按钮背景', category: 'component', value: '{color.semantic.primary}', ref: 'color.semantic.primary', themes: { light: '{color.semantic.primary}', dark: '{color.semantic.primary}', ops: '{color.semantic.primary}', contrast: '{color.semantic.primary}' }, usage: 98, status: 'stable', description: '主要操作按钮' },
  { id: 'component.button.primary.text', name: '主按钮文字', category: 'component', value: '#ffffff', themes: { light: '#ffffff', dark: '#ffffff', ops: '#ffffff', contrast: '#ffffff' }, usage: 98, status: 'stable', description: '主要操作按钮文字' }
];

const changes: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const storageKey = 'yy63-token-governance';
const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
const saved = raw ? JSON.parse(raw) : null;

const loadedTokens: Token[] = saved?.tokens ? migrateTokens(saved.tokens) : migrateTokens(initialTokens);
const baselineTokens: Token[] = saved?.baselineTokens ? migrateTokens(saved.baselineTokens) : cloneTokens(initialTokens);
const syncedSnapshot: Token[] = saved?.syncedSnapshot ? migrateTokens(saved.syncedSnapshot) : cloneTokens(initialTokens);

function cloneResolved(resolved: Record<string, Record<string, string>>): Record<string, Record<string, string>> {
  const result: Record<string, Record<string, string>> = {};
  for (const [tokenId, themes] of Object.entries(resolved)) {
    result[tokenId] = { ...themes };
  }
  return result;
}

const baselineResolved: Record<string, Record<string, string>> = saved?.baselineResolved
  ? cloneResolved(saved.baselineResolved)
  : cloneResolved(resolveThemes(baselineTokens).values);

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    tokens: loadedTokens,
    changes: (saved?.changes as ChangeRequest[]) ?? changes,
    activeTheme: (saved?.activeTheme as string) ?? 'light',
    selectedTokenId: (saved?.selectedTokenId as string) ?? 'color.semantic.primary',
    search: (saved?.search as string) ?? '',
    category: (saved?.category as string) ?? '全部',
    releaseVersion: '4.6.0-rc.2',
    locked: (saved?.locked as boolean) ?? false,
    lastPublished: (saved?.lastPublished as string) ?? 'DS 4.5.2',
    baselineTokens,
    baselineResolved,
    remoteTokens: (saved?.remoteTokens as Token[] | undefined) ?? null,
    syncedSnapshot,
    mergeStatus: (saved?.mergeStatus as string) ?? 'idle',
    mergeConflicts: (saved?.mergeConflicts as TokenConflict[]) ?? [],
    mergeError: (saved?.mergeError as string | null) ?? null,
    mergeApplied: 0,
    publishError: (saved?.publishError as string | null) ?? null
  }),
  getters: {
    selectedToken(state): Token | undefined {
      return state.tokens.find((token) => token.id === state.selectedTokenId);
    },
    filteredTokens(state): Token[] {
      const query = state.search.toLowerCase();
      return state.tokens.filter((token) => {
        const matchesSearch = !query || token.id.toLowerCase().includes(query) || token.name.includes(state.search);
        const matchesCategory = state.category === '全部' || token.category === state.category;
        return matchesSearch && matchesCategory;
      });
    },
    resolutionErrors(state): ResolutionError[] {
      return resolveThemes(state.tokens).errors;
    },
    resolvedValues(state): Record<string, Record<string, string>> {
      return resolveThemes(state.tokens).values;
    },
    dependencyEdges(state) {
      return state.tokens.filter((token) => token.ref).map((token) => ({ from: token.ref!, to: token.id }));
    },
    cycleNodes(): string[] {
      const ids = new Set<string>();
      for (const error of this.resolutionErrors) {
        if (error.kind === 'cycle') ids.add(error.token);
      }
      return [...ids];
    },
    invalidReferences(state): Token[] {
      const ids = new Set<string>();
      for (const error of this.resolutionErrors) {
        if (error.kind === 'missing' && error.ref) ids.add(error.token);
      }
      return state.tokens.filter((token) => ids.has(token.id));
    },
    contrastIssues(state): { title: string; detail: string }[] {
      const text = state.tokens.find((token) => token.id === 'color.text.primary');
      const surface = state.tokens.find((token) => token.id === 'color.surface.canvas');
      const values = [
        text ? this.resolvedValues[text.id]?.[state.activeTheme] : undefined,
        surface ? this.resolvedValues[surface.id]?.[state.activeTheme] : undefined
      ].filter(Boolean) as string[];
      if (values.length < 2) return [];
      const ratio = contrastRatio(values[0], values[1]);
      return ratio < 4.5 ? [{ title: '正文与页面背景对比度不足', detail: `当前 ${ratio.toFixed(2)}:1，要求至少 4.5:1。` }] : [];
    },
    diffRows(state): DiffRow[] {
      const rows: DiffRow[] = [];
      for (const token of state.tokens) {
        for (const theme of THEMES) {
          const current = this.resolvedValues[token.id]?.[theme];
          const base = state.baselineResolved[token.id]?.[theme];
          if (current !== base) {
            rows.push({ id: `${token.id}@@${theme}`, tokenId: token.id, name: token.name, theme, before: base ?? '新增', after: current ?? '—' });
          }
        }
      }
      return rows;
    },
    releaseReadiness(): number {
      const base = 100 - this.cycleNodes.length * 25 - this.invalidReferences.length * 20 - this.contrastIssues.length * 15;
      return Math.max(0, base);
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    syncDerived(token: Token) {
      token.ref = parseRef(token.themes.light) ?? undefined;
    },
    updateTokenValue(id: string, value: string) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      token.themes[this.activeTheme] = value;
      if (this.activeTheme === 'light') token.value = value;
      this.syncDerived(token);
      this.persist();
    },
    updateToken(id: string, patch: Partial<Token>) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      if (patch.themes) token.themes = { ...token.themes, ...patch.themes };
      if (patch.value !== undefined) {
        token.value = patch.value;
        token.themes.light = patch.value;
      } else {
        token.value = token.themes.light ?? token.value;
      }
      if (patch.name !== undefined) token.name = patch.name;
      if (patch.category !== undefined) token.category = patch.category;
      if (patch.usage !== undefined) token.usage = patch.usage;
      if (patch.status !== undefined) token.status = patch.status;
      if (patch.description !== undefined) token.description = patch.description;
      this.syncDerived(token);
      this.persist();
    },
    addToken(token: Token) {
      if (!this.tokens.some((item) => item.id === token.id)) {
        const migrated = migrateToken(token);
        this.syncDerived(migrated);
        this.tokens.push(migrated);
      }
      this.persist();
    },
    setTheme(theme: string) {
      this.activeTheme = theme;
      this.persist();
    },
    setSearch(value: string) { this.search = value; this.persist(); },
    setCategory(value: string) { this.category = value; this.persist(); },
    acceptChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (!change) return;
      const token = this.tokens.find((item) => item.id === change.diff.token);
      if (token) this.updateTokenValue(token.id, change.diff.after);
      change.status = '已接受';
      this.persist();
    },
    rejectChange(id: string) {
      const change = this.changes.find((item) => item.id === id);
      if (change) change.status = '已退回';
      this.persist();
    },
    rollback() {
      this.tokens = cloneTokens(this.baselineTokens);
      this.persist();
    },
    lockRelease(): { ok: boolean; error?: string } {
      if (this.resolutionErrors.length > 0) {
        const error = this.resolutionErrors[0];
        this.publishError = `发布被阻止：${describeError(error)}。请修复引用后再发布。`;
        return { ok: false, error: this.publishError };
      }
      if (this.contrastIssues.length > 0) {
        this.publishError = `发布被阻止：${this.contrastIssues[0].detail}`;
        return { ok: false, error: this.publishError };
      }
      if (this.changes.some((item) => item.status === '待评审')) {
        this.publishError = '发布被阻止：仍有变更请求未处理。';
        return { ok: false, error: this.publishError };
      }
      this.locked = true;
      this.lastPublished = `DS ${this.releaseVersion}`;
      this.baselineTokens = cloneTokens(this.tokens);
      this.baselineResolved = cloneResolved(this.resolvedValues);
      this.publishError = null;
      this.persist();
      return { ok: true };
    },
    mergeWithRemote(remoteTokens: Token[]): { ok: boolean; error?: string } {
      this.mergeStatus = 'merging';
      this.mergeError = null;
      this.mergeApplied = 0;
      try {
        const remote = migrateTokens(remoteTokens);
        this.remoteTokens = remote;
        const base = this.syncedSnapshot;
        const conflicts: TokenConflict[] = [];
        const merged: Token[] = [];
        const remoteIds = new Set(remote.map((token) => token.id));
        let applied = 0;

        for (const remoteToken of remote) {
          const local = this.tokens.find((token) => token.id === remoteToken.id);
          const baseToken = base.find((token) => token.id === remoteToken.id);
          if (!local) {
            merged.push(remoteToken);
            applied += 1;
            continue;
          }
          const localChanged = !baseToken || !tokenEqual(local, baseToken);
          const remoteChanged = !baseToken || !tokenEqual(remoteToken, baseToken);
          if (localChanged && remoteChanged) {
            conflicts.push({
              id: remoteToken.id,
              name: remoteToken.name,
              local: cloneTokens([local])[0],
              remote: cloneTokens([remoteToken])[0],
              base: baseToken ? cloneTokens([baseToken])[0] : undefined
            });
            merged.push(local);
          } else if (remoteChanged) {
            merged.push(remoteToken);
            applied += 1;
          } else {
            merged.push(local);
          }
        }
        for (const local of this.tokens) {
          if (!remoteIds.has(local.id)) merged.push(local);
        }

        this.mergeConflicts = conflicts;
        this.tokens = merged;
        this.mergeApplied = applied;
        if (conflicts.length > 0) {
          this.mergeStatus = 'conflict';
          return { ok: false, error: `检测到 ${conflicts.length} 个令牌在离线期间被两边修改，已保留两边原值。` };
        }
        this.mergeStatus = 'merged';
        this.syncedSnapshot = cloneTokens(merged);
        this.persist();
        return { ok: true };
      } catch (err) {
        this.mergeStatus = 'failed';
        this.mergeError = err instanceof Error ? err.message : String(err);
        this.persist();
        return { ok: false, error: this.mergeError };
      }
    },
    retryMerge(): { ok: boolean; error?: string } {
      if (!this.remoteTokens) {
        this.mergeStatus = 'failed';
        this.mergeError = '远端令牌清单不可用，无法重试合并。';
        this.persist();
        return { ok: false, error: this.mergeError };
      }
      return this.mergeWithRemote(this.remoteTokens);
    },
    resolveConflict(id: string, choice: 'local' | 'remote') {
      const conflict = this.mergeConflicts.find((item) => item.id === id);
      if (!conflict) return;
      if (choice === 'remote') {
        const index = this.tokens.findIndex((item) => item.id === id);
        if (index >= 0) this.tokens[index] = cloneTokens([conflict.remote])[0];
      }
      this.mergeConflicts = this.mergeConflicts.filter((item) => item.id !== id);
      if (this.mergeConflicts.length === 0) {
        this.mergeStatus = 'merged';
        this.syncedSnapshot = cloneTokens(this.tokens);
      }
      this.persist();
    },
    dismissMerge() {
      this.mergeStatus = 'idle';
      this.mergeConflicts = [];
      this.mergeError = null;
      this.persist();
    },
    persist() {
      if (typeof localStorage !== 'undefined') {
        localStorage.setItem(storageKey, JSON.stringify({
          tokens: this.tokens,
          changes: this.changes,
          activeTheme: this.activeTheme,
          selectedTokenId: this.selectedTokenId,
          search: this.search,
          category: this.category,
          locked: this.locked,
          lastPublished: this.lastPublished,
          baselineTokens: this.baselineTokens,
          baselineResolved: this.baselineResolved,
          remoteTokens: this.remoteTokens,
          syncedSnapshot: this.syncedSnapshot,
          mergeStatus: this.mergeStatus,
          mergeConflicts: this.mergeConflicts,
          mergeError: this.mergeError,
          publishError: this.publishError
        }));
      }
    }
  }
});

function contrastRatio(a: string, b: string) {
  const luminance = (hex: string) => {
    const clean = hex.replace('#', '');
    if (clean.length !== 6) return .5;
    const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
