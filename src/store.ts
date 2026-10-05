import { defineStore } from 'pinia';
import { fetchTokens, simulateRemoteChange, type Token } from './api';
import {
  THEMES,
  collectErrors,
  rawForToken,
  resolveAll,
  themeLabel,
  type ResolutionError,
  type ResolutionMap
} from './resolution';
import { conflictFieldLabel, mergeTokens, normalizeToken, setField, type MergeConflict } from './merge';

export type { Token };
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

type PublishedSnapshot = Record<string, Record<string, string>>;

type PersistedState = {
  schemaVersion: number;
  tokens: Token[];
  changes: ChangeRequest[];
  activeTheme: string;
  selectedTokenId: string;
  search: string;
  category: string;
  releaseVersion: string;
  locked: boolean;
  lastPublished: string;
  syncBase: Token[];
  draftEdits: Record<string, string>;
  conflicts: MergeConflict[];
  localAddedIds: string[];
  publishedSnapshot: PublishedSnapshot;
  syncState: { status: string; detail: string; at: string };
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

const initialChanges: ChangeRequest[] = [
  { id: 'CR-412', title: '运营产品切换语义主色', requester: '运营设计组', scope: '4 个产品 · 238 处引用', impact: 86, status: '待评审', diff: { token: 'color.semantic.primary', before: '{color.base.blue.600}', after: '{color.base.green.600}' } },
  { id: 'CR-418', title: '高对比度正文尺寸调整', requester: '无障碍专项组', scope: '2 个产品 · 74 处引用', impact: 42, status: '待评审', diff: { token: 'font.size.body', before: '14px', after: '16px' } },
  { id: 'CR-423', title: '统一浮层圆角', requester: '组件维护组', scope: '12 个组件 · 36 处引用', impact: 28, status: '待评审', diff: { token: 'radius.control', before: '8px', after: '6px' } }
];

const storageKey = 'yy63-token-governance';
const CURRENT_SCHEMA = 2;

function snapshotOf(tokens: Token[]): PublishedSnapshot {
  const resolution = resolveAll(tokens);
  const snapshot: PublishedSnapshot = {};
  tokens.forEach((token) => {
    snapshot[token.id] = {};
    THEMES.forEach((theme) => {
      snapshot[token.id][theme] = resolution.get(theme)!.values.get(token.id) ?? '';
    });
  });
  return snapshot;
}

const initialSnapshot = snapshotOf(initialTokens);

function loadState(): PersistedState {
  let saved: Record<string, unknown> | null = null;
  try {
    const raw = typeof localStorage !== 'undefined' ? localStorage.getItem(storageKey) : null;
    saved = raw ? JSON.parse(raw) as Record<string, unknown> : null;
  } catch {
    saved = null;
  }
  if (!saved) {
    return {
      schemaVersion: CURRENT_SCHEMA,
      tokens: initialTokens,
      changes: initialChanges,
      activeTheme: 'light',
      selectedTokenId: 'color.semantic.primary',
      search: '',
      category: '全部',
      releaseVersion: '4.6.0-rc.2',
      locked: false,
      lastPublished: 'DS 4.5.2',
      // 首次加载前以内置清单作为同步基线，远端到达后做幂等三方合并。
      syncBase: initialTokens,
      draftEdits: {},
      conflicts: [],
      localAddedIds: [],
      publishedSnapshot: initialSnapshot,
      syncState: { status: 'idle', detail: '尚未与远端令牌清单同步', at: '' }
    };
  }

  // 旧稿迁移（schemaVersion 缺失即 v1）：补齐主题字段，缺少明亮主题时升级成明亮主题。
  const tokens = ((saved.tokens as Token[] | undefined) ?? initialTokens).map((token) => normalizeToken(token));
  const changes = (saved.changes as ChangeRequest[] | undefined) ?? initialChanges;
  return {
    schemaVersion: CURRENT_SCHEMA,
    tokens,
    changes,
    activeTheme: typeof saved.activeTheme === 'string' ? saved.activeTheme : 'light',
    selectedTokenId: typeof saved.selectedTokenId === 'string' ? saved.selectedTokenId : 'color.semantic.primary',
    search: typeof saved.search === 'string' ? saved.search : '',
    category: typeof saved.category === 'string' ? saved.category : '全部',
    releaseVersion: typeof saved.releaseVersion === 'string' ? saved.releaseVersion : '4.6.0-rc.2',
    locked: Boolean(saved.locked),
    lastPublished: typeof saved.lastPublished === 'string' ? saved.lastPublished : 'DS 4.5.2',
    syncBase: (saved.syncBase as Token[] | undefined)?.map((token) => normalizeToken(token)) ?? tokens,
    draftEdits: (saved.draftEdits as Record<string, string> | undefined) ?? {},
    conflicts: (saved.conflicts as MergeConflict[] | undefined) ?? [],
    localAddedIds: (saved.localAddedIds as string[] | undefined) ?? [],
    // v1 旧稿没有发布快照：按当前（已迁移）令牌生成一次，作为差异基线。
    publishedSnapshot: (saved.publishedSnapshot as PublishedSnapshot | undefined) ?? snapshotOf(tokens),
    syncState: (saved.syncState as PersistedState['syncState'] | undefined) ?? { status: 'idle', detail: '草稿为本地恢复，尚未与远端同步', at: '' }
  };
}

const hydrated = loadState();

export type PublishBlocker =
  | { kind: 'cycle'; key: string; theme: string; tokenId: string; message: string; path: string[] }
  | { kind: 'missing'; key: string; theme: string; tokenId: string; message: string; ref: string; path: string[] }
  | { kind: 'conflict'; key: string; conflict: MergeConflict }
  | { kind: 'contrast'; key: string; theme: string; message: string }
  | { kind: 'pending-change'; key: string; change: ChangeRequest };

export const useTokenStore = defineStore('tokens', {
  state: () => ({
    tokens: hydrated.tokens as Token[],
    changes: hydrated.changes as ChangeRequest[],
    activeTheme: hydrated.activeTheme,
    selectedTokenId: hydrated.selectedTokenId,
    search: hydrated.search,
    category: hydrated.category,
    releaseVersion: hydrated.releaseVersion,
    locked: hydrated.locked,
    lastPublished: hydrated.lastPublished,
    syncBase: hydrated.syncBase as Token[],
    draftEdits: hydrated.draftEdits as Record<string, string>,
    conflicts: hydrated.conflicts as MergeConflict[],
    localAddedIds: hydrated.localAddedIds as string[],
    publishedSnapshot: hydrated.publishedSnapshot as PublishedSnapshot,
    syncState: hydrated.syncState,
    online: true
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
    /** 每主题的解析结果——发布事实。基础令牌一变，全部受影响主题在此重算。 */
    resolution(state): ResolutionMap {
      return resolveAll(state.tokens);
    },
    resolvedThemes(): ThemeResolutionView[] {
      return THEMES.map((theme) => ({ theme, label: themeLabel(theme) }));
    },
    activeErrors(state): ResolutionError[] {
      return this.resolution.get(state.activeTheme)?.errors ?? [];
    },
    allErrors(): ResolutionError[] {
      return collectErrors(this.resolution);
    },
    dependencyEdges(state): { from: string; to: string; theme: string }[] {
      const edges: { from: string; to: string; theme: string }[] = [];
      state.tokens.forEach((token) => {
        THEMES.forEach((theme) => {
          const single = rawForToken(token, theme).match(/^\{([^{}]+)\}$/)?.[1];
          if (single) edges.push({ from: single, to: token.id, theme });
        });
      });
      return edges;
    },
    cycleNodes(state): string[] {
      const ids = new Set<string>();
      (this.resolution.get(state.activeTheme)?.errors ?? [])
        .filter((error) => error.type === 'cycle')
        .forEach((error) => error.path.forEach((id) => ids.add(id)));
      return [...ids];
    },
    cycleChains(state): string[][] {
      return (this.resolution.get(state.activeTheme)?.errors ?? [])
        .filter((error) => error.type === 'cycle')
        .map((error) => error.path);
    },
    invalidReferences(state): { id: string; ref: string; theme: string }[] {
      const result: { id: string; ref: string; theme: string }[] = [];
      const seen = new Set<string>();
      (this.resolution.get(state.activeTheme)?.errors ?? [])
        .filter((error): error is ResolutionError & { ref: string } => error.type === 'missing')
        .forEach((error) => {
          const key = `${error.theme}:${error.tokenId}:${error.ref}`;
          if (seen.has(key)) return;
          seen.add(key);
          result.push({ id: error.tokenId, ref: error.ref, theme: error.theme });
        });
      return result;
    },
    contrastByTheme(state): { theme: string; label: string; ratio: number }[] {
      const text = state.tokens.find((token) => token.id === 'color.text.primary');
      const surface = state.tokens.find((token) => token.id === 'color.surface.canvas');
      if (!text || !surface) return [];
      return THEMES.map((theme) => {
        const a = this.resolution.get(theme)?.values.get(text.id) ?? '';
        const b = this.resolution.get(theme)?.values.get(surface.id) ?? '';
        return { theme, label: themeLabel(theme), ratio: contrastRatio(a, b) };
      }).filter((item) => Number.isFinite(item.ratio));
    },
    contrastIssues(): { theme: string; label: string; ratio: number }[] {
      return this.contrastByTheme.filter((item) => item.ratio < 4.5);
    },
    pendingChanges(): ChangeRequest[] {
      return this.changes.filter((item) => item.status === '待评审');
    },
    unresolvedConflicts(state): MergeConflict[] {
      return state.conflicts.filter((conflict) => !conflict.resolution);
    },
    /**
     * 发布门禁：循环引用、缺失引用、未裁决合并冲突、对比度、未处理变更。
     * 任一存在都会把发布停在准备页并说明卡在哪一枚令牌。
     */
    publishBlockers(state): PublishBlocker[] {
      const blockers: PublishBlocker[] = [];
      this.allErrors.forEach((error) => {
        if (error.type === 'cycle') {
          blockers.push({ kind: 'cycle', key: `cycle:${error.theme}:${error.tokenId}`, theme: error.theme, tokenId: error.tokenId, message: error.message, path: error.path });
        } else {
          blockers.push({ kind: 'missing', key: `missing:${error.theme}:${error.tokenId}:${error.ref}`, theme: error.theme, tokenId: error.tokenId, message: error.message, ref: error.ref ?? '', path: error.path });
        }
      });
      this.unresolvedConflicts.forEach((conflict) => {
        blockers.push({ kind: 'conflict', key: `conflict:${conflict.tokenId}:${conflict.field}`, conflict });
      });
      this.contrastIssues.forEach((issue) => {
        blockers.push({ kind: 'contrast', key: `contrast:${issue.theme}`, theme: issue.theme, message: `${issue.label}主题正文与页面背景对比度 ${issue.ratio.toFixed(2)}:1，低于 WCAG AA 4.5:1。` });
      });
      this.pendingChanges.forEach((change) => {
        blockers.push({ kind: 'pending-change', key: `change:${change.id}`, change });
      });
      return blockers;
    },
    releaseReadiness(): number {
      const errors = this.allErrors.length;
      const conflicts = this.unresolvedConflicts.length;
      const contrast = this.contrastIssues.length;
      const pending = this.pendingChanges.length;
      return Math.max(0, 100 - errors * 20 - conflicts * 12 - contrast * 10 - pending * 5);
    },
    /** 发布差异：按各主题解析值与上次发布快照逐主题生成。 */
    diffRows(state): { id: string; name: string; theme: string; label: string; before: string; after: string }[] {
      const rows: { id: string; name: string; theme: string; label: string; before: string; after: string }[] = [];
      state.tokens.forEach((token) => {
        THEMES.forEach((theme) => {
          const before = state.publishedSnapshot[token.id]?.[theme];
          const after = this.resolution.get(theme)?.values.get(token.id) ?? '';
          if (before === undefined || before !== after) {
            rows.push({ id: token.id, name: token.name, theme, label: themeLabel(theme), before: before ?? '新增', after });
          }
        });
      });
      return rows;
    },
    releaseFacts(state) {
      const resolved: Record<string, Record<string, string>> = {};
      state.tokens.forEach((token) => {
        resolved[token.id] = {};
        THEMES.forEach((theme) => {
          resolved[token.id][theme] = this.resolution.get(theme)?.values.get(token.id) ?? '';
        });
      });
      return { version: state.releaseVersion, themes: [...THEMES], resolved };
    },
    pendingEditCount(state): number {
      return Object.keys(state.draftEdits).length;
    }
  },
  actions: {
    selectToken(id: string) {
      this.selectedTokenId = id;
      this.persist();
    },
    /** 编辑当前主题的声明原值；语义/组件令牌解析值随后自动级联重算。 */
    updateTokenValue(id: string, value: string) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      token.themes[this.activeTheme] = value;
      if (this.activeTheme === 'light') {
        token.value = value;
        const single = value.trim().match(/^\{([^{}]+)\}$/)?.[1];
        if (single) token.ref = single;
        else delete token.ref;
      }
      const baseToken = this.syncBase.find((item) => item.id === id);
      const baseValue = baseToken ? rawForToken(baseToken, this.activeTheme) : '';
      if (value !== baseValue) this.draftEdits[`${id}@${this.activeTheme}`] = value;
      else delete this.draftEdits[`${id}@${this.activeTheme}`];
      this.persist();
    },
    updateTokenMeta(id: string, patch: Partial<Pick<Token, 'name' | 'description'>>) {
      const token = this.tokens.find((item) => item.id === id);
      if (!token) return;
      Object.assign(token, patch);
      this.persist();
    },
    addToken(token: Token) {
      if (this.tokens.some((item) => item.id === token.id)) return;
      const normalized = normalizeToken(token);
      this.tokens.push(normalized);
      if (!this.localAddedIds.includes(normalized.id)) this.localAddedIds.push(normalized.id);
      this.selectToken(normalized.id);
      this.persist();
    },
    setTheme(theme: string) {
      this.activeTheme = theme;
      this.persist();
    },
    setSearch(value: string) { this.search = value; this.persist(); },
    setCategory(value: string) { this.category = value; this.persist(); },
    setReleaseVersion(value: string) { this.releaseVersion = value; this.persist(); },
    /** 跨主题批量替换声明原值（逐令牌记账，供离线合并）。 */
    batchReplace(from: string, to: string) {
      let count = 0;
      this.tokens.forEach((token) => {
        THEMES.forEach((theme) => {
          if (rawForToken(token, theme) === from) {
            token.themes[theme] = to;
            count += 1;
            const baseToken = this.syncBase.find((item) => item.id === token.id);
            const baseValue = baseToken ? rawForToken(baseToken, theme) : '';
            if (to !== baseValue) this.draftEdits[`${token.id}@${theme}`] = to;
            else delete this.draftEdits[`${token.id}@${theme}`];
          }
        });
        if (token.value === from) token.value = to;
      });
      this.persist();
      return count;
    },
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
    /**
     * 离线草稿回来后与远端令牌清单做三方合并。
     * 网络失败时草稿原样保留，syncState 标记为可重试；
     * 冲突时两边原值都进入 conflicts，令牌默认保留本地值等待裁决。
     */
    async pullAndMerge() {
      if (!this.online) {
        this.markSyncFailure('离线模式下无法连接远端，草稿已保留，恢复在线后可重试。');
        throw new Error('OFFLINE');
      }
      let payload;
      try {
        payload = await fetchTokens();
      } catch {
        this.markSyncFailure('合并失败（网络不可达），这批编辑未丢失，可立即重试。');
        throw new Error('MERGE_FETCH_FAILED');
      }
      return this.mergeWithRemote(payload.tokens);
    },
    /** 与一份刚拉到的远端清单执行三方合并（vue-query 拉取成功后与重试共用此入口）。 */
    mergeWithRemote(remoteRaw: Token[]) {
      let result;
      try {
        const remote = remoteRaw.map((token) => normalizeToken(token));
        const base = this.syncBase.map((token) => normalizeToken(token));
        result = mergeTokens(base, this.tokens, remote);
      } catch {
        this.markSyncFailure('合并计算失败，草稿已完整保留，可重试。');
        throw new Error('MERGE_COMPUTE_FAILED');
      }

      this.tokens = result.tokens;
      this.syncBase = remoteRaw.map((token) => normalizeToken(token));
      this.localAddedIds = result.tokens
        .map((token) => token.id)
        .filter((id) => !this.syncBase.some((item) => item.id === id));
      // 合并成功后草稿已并入清单：清掉增量记账；未裁决冲突继续保留直到解决。
      this.draftEdits = {};
      this.conflicts = result.conflicts;
      this.syncState = result.conflicts.length
        ? {
            status: 'conflict',
            detail: `远端清单已合并，${result.conflicts.length} 枚令牌两边都改过，需在发布准备页保留/选择原值。`,
            at: new Date().toISOString()
          }
        : {
            status: 'synced',
            detail: result.applied ? `已合并远端 ${result.applied} 处变更，无冲突。` : '远端清单已是最新，无待合并变更。',
            at: new Date().toISOString()
          };
      this.persist();
      return result;
    },
    markSyncFailure(detail: string) {
      this.syncState = { status: 'failed', detail, at: new Date().toISOString() };
      this.persist();
    },
    setOnline(online: boolean) {
      this.online = online;
      this.syncState = online
        ? { status: 'idle', detail: '已恢复在线，可重试同步远端清单。', at: new Date().toISOString() }
        : { status: 'offline', detail: '离线模式：编辑只存为草稿，恢复在线后三方合并。', at: new Date().toISOString() };
      this.persist();
    },
    async simulateRemoteEdit(tokenId: string) {
      const result = await simulateRemoteChange(tokenId);
      return result;
    },
    /** 裁决合并冲突：保留本地原值或采用远端原值。 */
    resolveConflict(tokenId: string, field: string, side: 'local' | 'remote') {
      const conflict = this.conflicts.find((item) => item.tokenId === tokenId && item.field === field);
      if (!conflict) return;
      const token = this.tokens.find((item) => item.id === tokenId);
      if (token) {
        const chosen = side === 'local' ? conflict.local : conflict.remote;
        if (conflict.scope === 'themes' && conflict.theme) token.themes[conflict.theme] = chosen;
        else setField(token, conflict.field, chosen);
        if (conflict.field === 'themes.light' || conflict.theme === 'light') {
          token.value = token.themes.light ?? token.value;
          const single = token.value.trim().match(/^\{([^{}]+)\}$/)?.[1];
          if (single) token.ref = single;
          else delete token.ref;
        }
      }
      conflict.resolution = side;
      if (this.unresolvedConflicts.length === 0) {
        this.syncState = { status: 'synced', detail: '全部合并冲突已裁决，本地与远端清单一致。', at: new Date().toISOString() };
      }
      this.persist();
    },
    /** 放弃离线期间的未发布编辑，回到上次同步基线（本地新建令牌保留）。 */
    rollback() {
      const remoteIds = new Set(this.syncBase.map((token) => token.id));
      const locals = this.tokens.filter((token) => this.localAddedIds.includes(token.id));
      this.tokens = [
        ...this.syncBase.map((token) => normalizeToken(JSON.parse(JSON.stringify(token)))),
        ...locals
      ];
      this.draftEdits = {};
      this.localAddedIds = locals.map((token) => token.id).filter((id) => !remoteIds.has(id));
      this.syncState = { status: 'synced', detail: '已回滚到上次同步基线，离线编辑已放弃（本地新建令牌保留）。', at: new Date().toISOString() };
      this.persist();
    },
    /** 锁定发布：门禁不通过时停在准备页；通过则固化各主题解析快照。 */
    lockRelease(version: string): boolean {
      if (this.publishBlockers.length > 0) return false;
      this.releaseVersion = version;
      this.locked = true;
      this.lastPublished = `DS ${version}`;
      this.publishedSnapshot = this.releaseFacts.resolved;
      this.persist();
      return true;
    },
    persist() {
      if (typeof localStorage === 'undefined') return;
      const payload: PersistedState = {
        schemaVersion: CURRENT_SCHEMA,
        tokens: this.tokens,
        changes: this.changes,
        activeTheme: this.activeTheme,
        selectedTokenId: this.selectedTokenId,
        search: this.search,
        category: this.category,
        releaseVersion: this.releaseVersion,
        locked: this.locked,
        lastPublished: this.lastPublished,
        syncBase: this.syncBase,
        draftEdits: this.draftEdits,
        conflicts: this.conflicts,
        localAddedIds: this.localAddedIds,
        publishedSnapshot: this.publishedSnapshot,
        syncState: this.syncState
      };
      localStorage.setItem(storageKey, JSON.stringify(payload));
    }
  }
});

type ThemeResolutionView = { theme: string; label: string };

function contrastRatio(a: string, b: string): number {
  const luminance = (hex: string): number => {
    const clean = (hex ?? '').trim().replace('#', '');
    if (clean.length !== 6) return Number.NaN;
    const channels = [0, 2, 4].map((index) => parseInt(clean.slice(index, index + 2), 16) / 255).map((value) => value <= .03928 ? value / 12.92 : ((value + .055) / 1.055) ** 2.4);
    return .2126 * channels[0] + .7152 * channels[1] + .0722 * channels[2];
  };
  const l1 = luminance(a);
  const l2 = luminance(b);
  if (Number.isNaN(l1) || Number.isNaN(l2)) return Number.NaN;
  return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05);
}
