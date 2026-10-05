<script setup lang="ts">
import { computed, h, ref, watch } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { useQuery, useMutation } from '@tanstack/vue-query';
import { MessagePlugin } from 'tdesign-vue-next';
import {
  AddIcon,
  CopyIcon,
  HistoryIcon,
  LockOnIcon,
  RefreshIcon,
  SearchIcon,
  SwapIcon
} from 'tdesign-icons-vue-next';
import TokenEditor from './components/TokenEditor.vue';
import { fetchTokens, submitRelease, type Token } from './api';
import { useTokenStore, type PublishBlocker } from './store';
import { rawForToken, themeLabel } from './resolution';
import { conflictFieldLabel, type MergeConflict } from './merge';

const AddButtonIcon = () => h(AddIcon);
const CopyButtonIcon = () => h(CopyIcon);
const HistoryButtonIcon = () => h(HistoryIcon);
const LockButtonIcon = () => h(LockOnIcon);
const RefreshButtonIcon = () => h(RefreshIcon);
const SearchInputIcon = () => h(SearchIcon);
const SwapButtonIcon = () => h(SwapIcon);

const route = useRoute();
const router = useRouter();
const store = useTokenStore();
const { data: remote, refetch, isFetching } = useQuery({
  queryKey: ['tokens'],
  queryFn: fetchTokens,
  enabled: computed(() => store.online),
  staleTime: 0,
  retry: false
});
const selectedVersion = ref(store.releaseVersion);
const batchFrom = ref('');
const batchTo = ref('');
const releaseDialog = ref(false);
const newTokenDialog = ref(false);
const newToken = ref({ id: '', name: '', category: 'color', value: '#2864dc', description: '' });
const releaseResult = ref('');
const merging = ref(false);

const nav = [
  { path: '/', label: '令牌工作区', icon: 'token' },
  { path: '/graph', label: '依赖与校验', icon: 'control-platform' },
  { path: '/review', label: '变更评审', icon: 'git-commit' },
  { path: '/publish', label: '主题发布', icon: 'send' }
];

watch(remote, (value) => {
  // 远端清单每次到达都与离线草稿三方合并（首次加载同样幂等）。
  if (value) {
    const result = store.mergeWithRemote(value.tokens);
    if (result.conflicts.length) MessagePlugin.warning(`检测到 ${result.conflicts.length} 枚令牌存在合并冲突，已保留两边原值`);
  }
});

const pageTitle = computed(() => nav.find((item) => item.path === route.path)?.label ?? '令牌工作区');
const selected = computed<Token | undefined>(() => store.selectedToken);
const selectedRaw = computed(() => selected.value ? rawForToken(selected.value, store.activeTheme) : '');
const selectedResolved = computed(() => store.resolution.get(store.activeTheme)?.values.get(store.selectedTokenId) ?? '');
const selectedJson = computed(() => selected.value ? JSON.stringify({
  id: selected.value.id,
  name: selected.value.name,
  category: selected.value.category,
  theme: store.activeTheme,
  declaration: selectedRaw.value,
  resolved: selectedResolved.value,
  description: selected.value.description,
  status: selected.value.status
}, null, 2) : '{}');
const categories = computed(() => ['全部', ...new Set(store.tokens.map((token) => token.category))]);

function resolvedOf(id: string, theme = store.activeTheme): string {
  return store.resolution.get(theme)?.values.get(id) ?? '';
}

const graphNodes = computed(() => {
  const edgeSet = new Set(store.dependencyEdges.filter((edge) => edge.theme === store.activeTheme).flatMap((edge) => [edge.from, edge.to]));
  const nodes = store.tokens.filter((token) => edgeSet.has(token.id));
  const missing = store.dependencyEdges
    .filter((edge) => edge.theme === store.activeTheme)
    .map((edge) => edge.from)
    .filter((id) => !store.tokens.some((token) => token.id === id));
  [...new Set(missing)].forEach((id) => {
    if (!nodes.some((node) => node.id === id)) {
      nodes.push({ id, name: id.split('.').pop() ?? id, category: 'component', value: '', themes: {}, usage: 0, status: 'deprecated', description: '缺失引用目标' } as Token);
    }
  });
  const grouped = ['color', 'font', 'spacing', 'radius', 'shadow', 'component'];
  return nodes.map((token, index) => ({
    ...token,
    x: 80 + grouped.indexOf(token.category) * 150,
    y: 70 + (index % 4) * 105
  }));
});
const graphEdges = computed(() => store.dependencyEdges
  .filter((edge) => edge.theme === store.activeTheme)
  .map((edge) => {
    const from = graphNodes.value.find((node) => node.id === edge.from);
    const to = graphNodes.value.find((node) => node.id === edge.to);
    return from && to ? { ...edge, from, to } : null;
  })
  .filter((edge, index, list) => edge && list.findIndex((item) => item?.from.id === edge.from.id && item?.to.id === edge.to.id) === index)
  .filter(Boolean) as { from: Token & { x: number; y: number }; to: Token & { x: number; y: number } }[]);

const releaseMutation = useMutation({
  mutationFn: (payload: typeof store.releaseFacts & { accepted: string[]; actor: string }) => submitRelease(payload),
  onSuccess: (data) => {
    releaseResult.value = `发布标识 ${data.releaseId} · 覆盖 ${data.tokenCount} 枚令牌 × 4 个主题 · ${new Date().toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`;
    MessagePlugin.success('各主题解析值已锁定为发布事实并生成发布记录');
  },
  onError: () => {
    store.markSyncFailure('发布提交失败（网络不可达），解析快照与草稿均未丢失，可重试。');
    MessagePlugin.error('发布提交失败，编辑已保留，可重试');
  }
});
const releasing = computed(() => releaseMutation.isPending.value);

function go(path: string) {
  router.push(path);
}

function updateEditor(value: string) {
  try {
    const parsed = JSON.parse(value) as Partial<Token> & { declaration?: string };
    const next = parsed.declaration ?? parsed.value;
    if (next !== undefined) store.updateTokenValue(store.selectedTokenId, next);
    if (parsed.name !== undefined || parsed.description !== undefined) {
      store.updateTokenMeta(store.selectedTokenId, { name: parsed.name, description: parsed.description });
    }
  } catch {
    // Keep invalid JSON editable; validation is shown in the dependency panel.
  }
}

function addToken() {
  if (!newToken.value.id || !store.tokens.every((token) => token.id !== newToken.value.id)) {
    MessagePlugin.error('令牌 ID 不能为空且不能重复');
    return;
  }
  store.addToken({
    id: newToken.value.id,
    name: newToken.value.name || newToken.value.id,
    category: newToken.value.category as Token['category'],
    value: newToken.value.value,
    themes: { light: newToken.value.value, dark: newToken.value.value, ops: newToken.value.value, contrast: newToken.value.value },
    usage: 0,
    status: 'proposed',
    description: newToken.value.description
  });
  newTokenDialog.value = false;
  newToken.value = { id: '', name: '', category: 'color', value: '#2864dc', description: '' };
  MessagePlugin.success('已创建候选令牌（本地草稿，待同步）');
}

function batchReplace() {
  if (!batchFrom.value || !batchTo.value) return;
  const count = store.batchReplace(batchFrom.value, batchTo.value);
  MessagePlugin.success(`已替换 ${count} 处主题原值，受影响引用已自动重算`);
}

function isHex(value: string): boolean {
  return /^#[0-9a-fA-F]{6}$/.test(value.trim());
}

const blockerCycles = computed(() => store.publishBlockers.filter((blocker): blocker is Extract<PublishBlocker, { kind: 'cycle' }> => blocker.kind === 'cycle'));
const blockerMissing = computed(() => store.publishBlockers.filter((blocker): blocker is Extract<PublishBlocker, { kind: 'missing' }> => blocker.kind === 'missing'));
const blockerConflicts = computed(() => store.publishBlockers.filter((blocker): blocker is Extract<PublishBlocker, { kind: 'conflict' }> => blocker.kind === 'conflict'));
const blockerContrast = computed(() => store.publishBlockers.filter((blocker): blocker is Extract<PublishBlocker, { kind: 'contrast' }> => blocker.kind === 'contrast'));

async function syncNow() {
  merging.value = true;
  try {
    const result = await refetch();
    if (result.data) {
      const merged = store.mergeWithRemote(result.data.tokens);
      if (merged.conflicts.length) MessagePlugin.warning(`${merged.conflicts.length} 处两边同改，两边原值均已保留`);
      else MessagePlugin.success(merged.applied ? `远端 ${merged.applied} 处变更已合入草稿` : '远端清单已是最新');
    }
  } catch {
    MessagePlugin.error('同步失败，草稿未丢失，可重试');
  } finally {
    merging.value = false;
  }
}

function toggleOnline(value: boolean | string | number) {
  const online = Boolean(value);
  store.setOnline(online);
  if (online) MessagePlugin.info('已恢复在线');
  else MessagePlugin.warning('已进入离线模式，编辑将作为草稿保留');
}

async function simulateRemote() {
  if (!selected.value) return;
  try {
    const result = await store.simulateRemoteEdit(selected.value.id);
    MessagePlugin.info(`远端已把 ${result.tokenId} 改为 ${result.value}，同步时将与草稿合并`);
  } catch {
    MessagePlugin.error('离线状态下无法模拟远端变更');
  }
}

function locateToken(id: string) {
  store.selectToken(id);
  go('/');
}

function publish() {
  const blockers = store.publishBlockers;
  if (!store.locked && blockers.length > 0) {
    go('/publish');
    const first = blockers[0];
    const where = first.kind === 'cycle' || first.kind === 'missing'
      ? `卡在令牌 ${first.tokenId}（${themeLabel(first.theme)}主题）`
      : first.kind === 'conflict'
        ? `卡在合并冲突 ${first.conflict.tokenId}`
        : first.kind === 'contrast'
          ? `卡在 ${themeLabel(first.theme)}主题对比度`
          : `卡在待评审变更 ${first.change.id}`;
    MessagePlugin.error(`发布已停在准备页：${where}，共 ${blockers.length} 项门禁未通过`);
    return;
  }
  const accepted = store.changes.filter((item) => item.status === '已接受').map((item) => item.id);
  const facts = store.releaseFacts;
  releaseMutation.mutate({ ...facts, accepted, actor: '设计系统维护员' }, {
    onSuccess: () => {
      if (store.lockRelease(selectedVersion.value)) releaseDialog.value = true;
    }
  });
}
</script>

<template>
  <t-layout class="app-shell">
    <t-header class="app-header">
      <div class="brand"><span class="brand-mark">DS</span><div><strong>设计令牌治理台</strong><small>Cross-product Token Governance</small></div></div>
      <div class="release-chip"><span>当前候选</span><strong>DS {{ store.releaseVersion }}</strong></div>
      <div class="header-spacer" />
      <t-tag :theme="store.releaseReadiness === 100 ? 'success' : 'danger'" variant="light-outline">发布就绪 {{ store.releaseReadiness }}% · {{ store.publishBlockers.length }} 项门禁</t-tag>
      <div class="operator"><span>设计系统维护员</span><strong>顾清 · Core DS</strong></div>
    </t-header>
    <t-layout class="body-layout">
      <t-aside class="side-nav">
        <div class="workspace-card"><t-icon name="layers" /><div><span>当前工作区</span><strong>通用组件库 · 品牌主题</strong><small>{{ store.tokens.length }} 个令牌 · 4 个主题变体</small></div></div>
        <nav><button v-for="item in nav" :key="item.path" :class="{ active: route.path === item.path }" @click="go(item.path)"><t-icon :name="item.icon" /><span>{{ item.label }}</span><t-badge v-if="item.path === '/review'" :count="store.pendingChanges.length" /><t-badge v-else-if="item.path === '/publish' && store.publishBlockers.length" :count="store.publishBlockers.length" /></button></nav>
        <div class="sync-card" :class="store.syncState.status">
          <div class="sync-head">
            <t-switch :value="store.online" size="small" @change="toggleOnline" />
            <strong>{{ store.online ? '在线' : '离线草稿' }}</strong>
            <t-button size="small" variant="text" :loading="isFetching || merging" @click="syncNow">同步合并</t-button>
          </div>
          <p>{{ store.syncState.detail }}</p>
          <div class="sync-meta">
            <t-tag v-if="store.unresolvedConflicts.length" theme="danger" size="small" variant="light">{{ store.unresolvedConflicts.length }} 处冲突待裁决</t-tag>
            <t-tag v-else-if="store.pendingEditCount" theme="warning" size="small" variant="light">{{ store.pendingEditCount }} 处离线编辑待合并</t-tag>
            <t-tag v-else-if="store.syncState.status === 'failed'" theme="danger" size="small" variant="light">失败 · 可重试</t-tag>
            <t-tag v-else theme="success" size="small" variant="light">已同步</t-tag>
            <t-button v-if="selected" size="small" variant="text" @click="simulateRemote">模拟远端改此令牌</t-button>
          </div>
        </div>
        <div class="save-state" :class="{ warn: store.syncState.status === 'failed' || store.syncState.status === 'conflict' }">
          <t-icon :name="store.online ? 'cloud-done' : 'cloud-off'" />
          <div><span>{{ store.unresolvedConflicts.length ? '存在合并冲突' : store.syncState.status === 'failed' ? '同步失败，可重试' : store.online ? '草稿已保存' : '离线编辑已保留' }}</span><small>{{ store.syncState.at ? new Date(store.syncState.at).toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' }) : '—' }}</small></div>
        </div>
      </t-aside>
      <t-content class="main-content">
        <header class="page-heading">
          <div><small>{{ store.locked ? 'RELEASE LOCKED' : 'GOVERNANCE WORKBENCH' }} / {{ pageTitle }}</small><h1>{{ pageTitle }}</h1><p>每个主题的解析结果即发布事实：任一环改动，受影响主题的语义令牌与组件别名自动重算。</p></div>
          <div class="heading-actions"><t-select :value="store.activeTheme" style="width: 150px" @change="(value: unknown) => store.setTheme(String(value))" :options="[{label:'明亮模式',value:'light'},{label:'暗色模式',value:'dark'},{label:'运营模式',value:'ops'},{label:'高对比度',value:'contrast'}]" /><t-button variant="outline" :icon="AddButtonIcon" @click="newTokenDialog = true">新建令牌</t-button><t-button theme="primary" :icon="LockButtonIcon" :disabled="store.locked" @click="publish">发布主题</t-button></div>
        </header>

        <section v-if="route.path === '/'" class="token-workspace">
          <aside class="token-tree panel">
            <div class="panel-head"><div><strong>令牌树</strong><span>{{ store.filteredTokens.length }} 个匹配项</span></div><t-button size="small" variant="text" :icon="RefreshButtonIcon" @click="store.rollback">回滚</t-button></div>
            <t-input :value="store.search" @change="(value: unknown) => store.setSearch(String(value))" clearable placeholder="搜索令牌 ID 或名称" :prefix-icon="SearchInputIcon" />
            <div class="category-tabs"><button v-for="category in categories" :key="category" :class="{ active: store.category === category }" @click="store.setCategory(category)">{{ category }}</button></div>
            <div class="tree-list">
              <button v-for="token in store.filteredTokens" :key="token.id" :class="{ active: store.selectedTokenId === token.id }" @click="store.selectToken(token.id)">
                <i :class="token.category">
                  <em v-if="token.category === 'color' && isHex(resolvedOf(token.id))" :style="{ background: resolvedOf(token.id) }" />
                </i>
                <div><strong>{{ token.name }}</strong><span>{{ token.id }} · {{ themeLabel(store.activeTheme) }}: {{ resolvedOf(token.id) }}</span></div>
                <t-tag size="small" :theme="token.status === 'stable' ? 'success' : token.status === 'proposed' ? 'warning' : 'default'" variant="light">{{ token.status === 'stable' ? '稳定' : token.status === 'proposed' ? '候选' : '弃用' }}</t-tag>
              </button>
            </div>
          </aside>
          <section class="editor-column">
            <div class="panel editor-panel">
              <div class="panel-head"><div><strong>Monaco 令牌编辑</strong><span>{{ selected?.id }} · {{ themeLabel(store.activeTheme) }}主题声明</span></div><div class="editor-actions"><t-tag v-if="selectedRaw.trim().startsWith('{')" variant="light">引用 {{ selectedRaw }}</t-tag><t-button size="small" variant="outline" :icon="CopyButtonIcon">复制 JSON</t-button></div></div>
              <div class="editor-host"><TokenEditor :model-value="selectedJson" language="json" @update:model-value="updateEditor" /></div>
              <div class="editor-status"><span><i class="status-dot" />解析值：{{ selectedResolved || '解析失败' }}</span><span>引用关系 {{ store.dependencyEdges.filter(e => e.theme === store.activeTheme).length }} 条</span><span>{{ selected?.usage }} 处产品引用</span></div>
            </div>
            <div class="panel batch-panel"><div class="panel-head"><div><strong>批量替换</strong><span>跨主题替换声明原值，引用解析自动级联</span></div><SwapIcon /></div><div class="batch-form"><t-input v-model="batchFrom" placeholder="原始值，如 #2864dc" /><ArrowRightIcon /><t-input v-model="batchTo" placeholder="新值" /><t-button theme="primary" :icon="SwapButtonIcon" :disabled="!batchFrom || !batchTo" @click="batchReplace">执行替换</t-button></div></div>
          </section>
          <aside class="preview-column">
            <div class="panel preview-panel">
              <div class="panel-head"><div><strong>组件预览</strong><span>实时解析 {{ themeLabel(store.activeTheme) }} 主题</span></div><t-tag :theme="store.activeErrors.length ? 'danger' : 'success'" variant="light">{{ store.activeErrors.length ? '解析异常' : '可渲染' }}</t-tag></div>
              <div class="component-preview" :style="{ background: selected?.category === 'color' && isHex(selectedResolved) ? selectedResolved : undefined }">
                <div class="mock-app"><div class="mock-sidebar"><i /><i /><i /></div><div class="mock-content"><div class="mock-title" /><div class="mock-card"><span /><span /><span /></div><div class="mock-buttons"><button>取消</button><button :style="{ background: isHex(resolvedOf('component.button.primary.bg')) ? resolvedOf('component.button.primary.bg') : undefined }">确认提交</button></div></div></div>
              </div>
              <div class="token-detail">
                <div><span>声明原值</span><strong>{{ selectedRaw }}</strong></div>
                <div><span>解析值</span><strong>{{ selectedResolved }}</strong></div>
                <div><span>使用量</span><strong>{{ selected?.usage }} 处</strong></div>
                <div><span>状态</span><strong>{{ selected?.status }}</strong></div>
                <div><span>说明</span><strong>{{ selected?.description }}</strong></div>
              </div>
            </div>
            <div class="panel validation-summary"><div class="panel-head"><div><strong>快速校验</strong><span>全主题发布门禁摘要</span></div><strong class="score" :class="{ bad: store.releaseReadiness < 100 }">{{ store.releaseReadiness }}%</strong></div><div class="summary-row" :class="{ bad: blockerCycles.length }"><span>循环依赖（全主题）</span><strong>{{ blockerCycles.length ? `${blockerCycles.length} 枚令牌` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: blockerMissing.length }"><span>缺失引用（全主题）</span><strong>{{ blockerMissing.length ? `${blockerMissing.length} 枚令牌` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: blockerConflicts.length }"><span>合并冲突</span><strong>{{ blockerConflicts.length ? `${blockerConflicts.length} 处待裁决` : '未发现' }}</strong></div><div class="summary-row" :class="{ bad: store.contrastIssues.length }"><span>对比度</span><strong>{{ store.contrastIssues.length ? store.contrastIssues.map(i => i.label).join('、') : '四主题均符合 AA' }}</strong></div></div>
          </aside>
        </section>

        <section v-else-if="route.path === '/graph'" class="graph-page panel">
          <div class="panel-head"><div><strong>令牌依赖图</strong><span>基础令牌 → 语义令牌 → 组件别名 · 当前 {{ themeLabel(store.activeTheme) }} 主题解析链</span></div><div class="graph-legend"><span><i class="color" />颜色</span><span><i class="component" />组件</span><span><i class="error" />错误</span></div></div>
          <div class="graph-canvas">
            <svg viewBox="0 0 820 520" preserveAspectRatio="xMidYMid meet">
              <defs><marker id="arrow" markerWidth="8" markerHeight="8" refX="8" refY="4" orient="auto"><path d="M0,0 L8,4 L0,8" fill="#7c8c98" /></marker></defs>
              <path v-for="edge in graphEdges" :key="`${edge.from.id}-${edge.to.id}`" :d="`M ${edge.from.x} ${edge.from.y} C ${edge.from.x + 70} ${edge.from.y}, ${edge.to.x - 70} ${edge.to.y}, ${edge.to.x} ${edge.to.y}`" fill="none" stroke="#8b9aa5" stroke-width="1.5" marker-end="url(#arrow)" />
              <g v-for="node in graphNodes" :key="node.id" :transform="`translate(${node.x},${node.y})`" class="graph-node" :class="{ cycle: store.cycleNodes.includes(node.id), missing: !store.tokens.some(t => t.id === node.id), selected: node.id === store.selectedTokenId }" @click="store.selectToken(node.id)">
                <rect x="-60" y="-24" width="120" height="48" rx="5" />
                <text x="0" y="-3" text-anchor="middle">{{ node.name }}</text>
                <text x="0" y="13" text-anchor="middle">{{ node.category }}</text>
              </g>
            </svg>
          </div>
          <div class="validation-strip"><div class="validation-card"><t-icon :name="blockerCycles.length ? 'error-circle' : 'check-circle'" :theme="blockerCycles.length ? 'danger' : 'success'" /><div><strong>循环依赖（{{ blockerCycles.length }}）</strong><span v-if="!blockerCycles.length">四主题均未发现循环引用路径</span><span v-else class="blocker-link" v-for="blocker in blockerCycles.slice(0, 3)" :key="blocker.key" @click="locateToken(blocker.tokenId)">{{ themeLabel(blocker.theme) }}：{{ blocker.path.join(' → ') }}（点击定位）</span></div></div><div class="validation-card"><t-icon :name="blockerMissing.length ? 'error-circle' : 'check-circle'" :theme="blockerMissing.length ? 'danger' : 'success'" /><div><strong>引用完整性（{{ blockerMissing.length }}）</strong><span v-if="!blockerMissing.length">所有引用均能解析到已存在令牌</span><span v-else class="blocker-link" v-for="blocker in blockerMissing.slice(0, 3)" :key="blocker.key" @click="locateToken(blocker.tokenId)">{{ themeLabel(blocker.theme) }}：{{ blocker.tokenId }} → 缺失 {{ '{' + blocker.ref + '}' }}（点击定位）</span></div></div><div class="validation-card"><t-icon :name="store.contrastIssues.length ? 'error-circle' : 'check-circle'" :theme="store.contrastIssues.length ? 'danger' : 'success'" /><div><strong>对比度检查</strong><span v-if="!store.contrastIssues.length">四主题正文与背景对比度均符合 WCAG AA</span><span v-else v-for="issue in store.contrastIssues" :key="issue.theme">{{ issue.label }}主题当前 {{ issue.ratio.toFixed(2) }}:1，要求 ≥ 4.5:1</span></div></div></div>
        </section>

        <section v-else-if="route.path === '/review'" class="review-page">
          <div class="review-summary panel"><div><span>待评审变更</span><strong>{{ store.pendingChanges.length }}</strong></div><div><span>已接受</span><strong>{{ store.changes.filter(c => c.status === '已接受').length }}</strong></div><div><span>已退回</span><strong>{{ store.changes.filter(c => c.status === '已退回').length }}</strong></div><div><span>受影响组件</span><strong>48</strong></div></div>
          <div class="review-grid">
            <div v-for="change in store.changes" :key="change.id" class="panel change-card">
              <div class="change-head"><div><t-tag size="small">{{ change.id }}</t-tag><strong>{{ change.title }}</strong><span>{{ change.requester }} · {{ change.scope }}</span></div><t-tag :theme="change.status === '已接受' ? 'success' : change.status === '已退回' ? 'danger' : 'warning'" variant="light">{{ change.status }}</t-tag></div>
              <div class="diff-box"><div><span>修改前（{{ themeLabel(store.activeTheme) }}声明）</span><code>{{ change.diff.before }}</code></div><t-icon name="arrow-right" /><div><span>修改后（解析自动级联）</span><code>{{ change.diff.after }}</code></div></div>
              <div class="impact"><span>影响评分</span><t-progress :percentage="change.impact" :theme="change.impact > 70 ? 'danger' : 'warning'" /></div>
              <div class="change-actions"><t-button variant="outline" :disabled="change.status !== '待评审'" @click="store.rejectChange(change.id)">退回并说明</t-button><t-button theme="primary" :disabled="change.status !== '待评审'" @click="store.acceptChange(change.id)">接受变更</t-button></div>
            </div>
          </div>
        </section>

        <section v-else class="publish-page">
          <div class="publish-main-col">
            <div v-if="store.publishBlockers.length" class="panel gate-panel">
              <div class="panel-head"><div><strong>发布已停在准备页</strong><span>{{ store.publishBlockers.length }} 项门禁未通过，已标出卡住的令牌与主题</span></div><t-tag theme="danger">不可发布</t-tag></div>
              <div class="gate-list">
                <div v-for="blocker in blockerCycles" :key="blocker.key" class="gate-item danger">
                  <t-icon name="refresh" /><div><strong>循环引用 · {{ themeLabel(blocker.theme) }}主题</strong><span class="blocker-link" @click="locateToken(blocker.tokenId)">卡在令牌 {{ blocker.tokenId }}</span><code>{{ blocker.path.join(' → ') }}</code></div>
                </div>
                <div v-for="blocker in blockerMissing" :key="blocker.key" class="gate-item danger">
                  <t-icon name="link-unlink" /><div><strong>缺失引用 · {{ themeLabel(blocker.theme) }}主题</strong><span class="blocker-link" @click="locateToken(blocker.tokenId)">卡在令牌 {{ blocker.tokenId }}</span><code>引用目标 {{ '{' + blocker.ref + '}' }} 不存在 · 链路 {{ blocker.path.join(' → ') }}</code></div>
                </div>
                <div v-for="blocker in blockerConflicts" :key="blocker.key" class="gate-item warn">
                  <t-icon name="code-push" /><div class="conflict-body">
                    <strong>合并冲突 · <span class="blocker-link" @click="locateToken(blocker.conflict.tokenId)">{{ blocker.conflict.tokenId }}</span> 的{{ conflictFieldLabel(blocker.conflict) }}</strong>
                    <div class="conflict-values"><div><span>离线草稿原值</span><code>{{ blocker.conflict.local }}</code></div><div><span>远端原值</span><code>{{ blocker.conflict.remote }}</code></div></div>
                    <div class="conflict-actions"><t-button size="small" variant="outline" @click="store.resolveConflict(blocker.conflict.tokenId, blocker.conflict.field, 'local')">保留草稿 {{ blocker.conflict.local }}</t-button><t-button size="small" theme="primary" @click="store.resolveConflict(blocker.conflict.tokenId, blocker.conflict.field, 'remote')">采用远端 {{ blocker.conflict.remote }}</t-button></div>
                  </div>
                </div>
                <div v-for="blocker in blockerContrast" :key="blocker.key" class="gate-item warn">
                  <t-icon name="browse" /><div><strong>对比度不达标 · {{ themeLabel(blocker.theme) }}主题</strong><code>{{ blocker.message }}</code></div>
                </div>
                <div v-for="blocker in store.publishBlockers.filter(b => b.kind === 'pending-change')" :key="blocker.key" class="gate-item">
                  <t-icon name="chat-bubble" /><div><strong>待评审变更 · {{ (blocker as Extract<PublishBlocker, { kind: 'pending-change' }>).change.id }}</strong><code>{{ (blocker as Extract<PublishBlocker, { kind: 'pending-change' }>).change.title }}</code></div>
                </div>
              </div>
            </div>
            <div class="panel publish-main">
              <div class="panel-head"><div><strong>发布准备</strong><span>锁定各主题解析结果为只读版本，支持回滚到历史基线</span></div><t-tag :theme="store.locked ? 'success' : 'warning'">{{ store.locked ? '已锁定' : '候选版本' }}</t-tag></div>
              <div class="publish-form">
                <label><span>版本号</span><t-input :value="selectedVersion" @change="(value: unknown) => { selectedVersion = String(value); store.setReleaseVersion(String(value)); }" /></label>
                <label><span>目标产品</span><t-select multiple :value="['组件库','运营后台','移动端组件']" :options="[{label:'组件库',value:'组件库'},{label:'运营后台',value:'运营后台'},{label:'移动端组件',value:'移动端组件'},{label:'数据平台',value:'数据平台'}]" /></label>
                <label><span>发布说明</span><t-textarea value="更新语义主色、统一控件圆角，并修复暗色主题正文对比度。" :autosize="{ minRows: 3 }" /></label>
              </div>
              <div class="release-checks">
                <label><t-checkbox :checked="blockerCycles.length === 0" :disabled="blockerCycles.length > 0" /> {{ blockerCycles.length === 0 ? '四主题循环依赖检查通过' : `${blockerCycles.length} 处循环引用未解决` }}</label>
                <label><t-checkbox :checked="blockerMissing.length === 0" :disabled="blockerMissing.length > 0" /> {{ blockerMissing.length === 0 ? '四主题引用完整性检查通过' : `${blockerMissing.length} 处缺失引用未解决` }}</label>
                <label><t-checkbox :checked="blockerConflicts.length === 0" :disabled="blockerConflicts.length > 0" /> {{ blockerConflicts.length === 0 ? '离线草稿与远端合并无冲突' : `${blockerConflicts.length} 处合并冲突待裁决` }}</label>
                <label><t-checkbox :checked="store.contrastIssues.length === 0" :disabled="store.contrastIssues.length > 0" /> {{ store.contrastIssues.length === 0 ? '颜色对比度符合 WCAG AA' : `${store.contrastIssues.length} 个主题对比度不足` }}</label>
                <label><t-checkbox :checked="store.pendingChanges.length === 0" :disabled="store.pendingChanges.length > 0" /> {{ store.pendingChanges.length === 0 ? '所有变更请求已处理' : `${store.pendingChanges.length} 条变更待评审` }}</label>
              </div>
              <div class="publish-actions"><t-button variant="outline" @click="store.rollback">回滚全部未发布编辑</t-button><t-button theme="primary" icon="lock-on" :loading="releasing" :disabled="store.locked" @click="publish">{{ store.publishBlockers.length ? `先解决 ${store.publishBlockers.length} 项门禁` : '校验并锁定发布' }}</t-button></div>
            </div>
          </div>
          <aside class="publish-side">
            <div class="panel diff-panel"><div class="panel-head"><div><strong>版本差异（按主题解析值）</strong><span>相对 {{ store.lastPublished }}</span></div><t-tag>{{ store.diffRows.length }} 项</t-tag></div><div v-for="row in store.diffRows" :key="`${row.id}-${row.theme}`" class="diff-row"><strong>{{ row.name }}</strong><span>{{ row.id }} · {{ row.label }}主题</span><div><del>{{ row.before }}</del><ins>{{ row.after }}</ins></div></div><p v-if="!store.diffRows.length" class="empty">四主题解析值与上次发布一致，暂无差异。</p></div>
            <div class="panel history-panel"><div class="panel-head"><div><strong>发布历史</strong><span>解析快照可追溯</span></div><HistoryIcon /></div><div class="history-row"><t-tag theme="success" variant="light">当前</t-tag><div><strong>{{ store.lastPublished }}</strong><span>顾清 · 09-24 17:20</span></div><t-button size="small" variant="text">查看</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.1</strong><span>周序 · 09-12 11:04</span></div><t-button size="small" variant="text">回滚</t-button></div><div class="history-row"><t-tag>历史</t-tag><div><strong>DS 4.5.0</strong><span>顾清 · 08-28 15:42</span></div><t-button size="small" variant="text">回滚</t-button></div></div>
          </aside>
        </section>
      </t-content>
    </t-layout>
  </t-layout>

  <t-dialog v-model:visible="newTokenDialog" header="创建候选令牌" :confirm-btn="{ content: '创建', onClick: addToken }">
    <div class="dialog-form"><t-input v-model="newToken.id" label="令牌 ID" placeholder="product.component.property" /><t-input v-model="newToken.name" label="显示名称" /><t-select v-model="newToken.category" label="分类" :options="[{label:'颜色',value:'color'},{label:'字体',value:'font'},{label:'间距',value:'spacing'},{label:'圆角',value:'radius'},{label:'阴影',value:'shadow'},{label:'组件',value:'component'}]" /><t-input v-model="newToken.value" label="默认值" /><t-textarea v-model="newToken.description" label="用途说明" /></div>
  </t-dialog>
  <t-dialog v-model:visible="releaseDialog" header="主题发布完成" :footer="false"><div class="release-success"><t-icon name="check-circle" size="46px" theme="success" /><h3>DS {{ store.releaseVersion }} 已锁定</h3><p>{{ releaseResult }}</p><p>四主题解析值已作为发布事实固化为快照，产品使用方可以按固定版本拉取令牌。</p></div></t-dialog>
</template>
