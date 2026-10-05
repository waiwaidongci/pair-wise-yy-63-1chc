import { assert } from 'console';
import { resolveAll, rawForToken } from '../src/resolution';
import { mergeTokens, normalizeToken } from '../src/merge';
import type { Token } from '../src/api';

let passed = 0;
function check(name: string, cond: boolean, detail = '') {
  if (!cond) {
    console.error(`✗ ${name}${detail ? ` — ${detail}` : ''}`);
    process.exit(1);
  }
  passed += 1;
  console.log(`✓ ${name}`);
}

const t = (id: string, value: string, themes: Record<string, string> = {}, extra: Partial<Token> = {}): Token => ({
  id, name: id, category: 'color', value, themes, usage: 0, status: 'stable', description: '', ...extra
});

// 1) 基础色改动后语义令牌与组件别名在受影响主题下重算
{
  const tokens = [
    t('base.blue', '#0000ff', { light: '#0000ff', dark: '#111111' }),
    t('semantic.primary', '{base.blue}', { light: '{base.blue}', dark: '{base.blue}' }),
    t('component.button.bg', '{semantic.primary}', { light: '{semantic.primary}', dark: '{semantic.primary}' })
  ];
  let resolution = resolveAll(tokens, ['light', 'dark']);
  check('初始 light 链路解析到基础色', resolution.get('light')!.values.get('component.button.bg') === '#0000ff');
  check('初始 dark 链路解析到暗色基础色', resolution.get('dark')!.values.get('component.button.bg') === '#111111');
  tokens[0].themes.light = '#2864dc'; // 改基础色（明亮主题）
  resolution = resolveAll(tokens, ['light', 'dark']);
  check('改基础色后 light 组件别名重算', resolution.get('light')!.values.get('component.button.bg') === '#2864dc');
  check('未改动的 dark 主题保持原值', resolution.get('dark')!.values.get('component.button.bg') === '#111111');
  check('无错误', resolution.get('light')!.errors.length === 0 && resolution.get('dark')!.errors.length === 0);
}

// 2) 循环引用：精确定位到卡住的令牌与链路
{
  const tokens = [
    t('a', '{b}', { light: '{b}' }),
    t('b', '{c}', { light: '{c}' }),
    t('c', '{a}', { light: '{a}' })
  ];
  const resolution = resolveAll(tokens, ['light']);
  const errors = resolution.get('light')!.errors;
  check('检测到 1 个循环', errors.length === 1, `errors=${errors.length}`);
  check('循环类型为 cycle', errors[0]!.type === 'cycle');
  check('卡在环上令牌', errors[0]!.tokenId === 'a');
  check('链路首尾相同', errors[0]!.path[0] === errors[0]!.path.at(-1));
  check('链路覆盖全部三枚令牌', errors[0]!.path.length === 4);
}

// 3) 缺失引用：报告持有悬空引用的令牌
{
  const tokens = [
    t('a', '{ghost}', { light: '{ghost}' }),
    t('b', '{a}', { light: '{a}' })
  ];
  const resolution = resolveAll(tokens, ['light']);
  const errors = resolution.get('light')!.errors;
  check('检测到 1 个缺失引用', errors.length === 1, `errors=${errors.length}`);
  check('类型为 missing', errors[0]!.type === 'missing');
  check('卡在持有引用的令牌 a', errors[0]!.tokenId === 'a');
  check('指出缺失目标', errors[0]!.ref === 'ghost');
  check('占位引用保留不静默变色', resolution.get('light')!.values.get('a') === '{ghost}');
}

// 4) 旧稿缺少 themes 字段时升级成明亮主题
{
  const legacy = t('old.token', '#abcdef') as Token;
  delete (legacy as Partial<Token>).themes;
  const upgraded = normalizeToken(legacy);
  check('迁移补齐 light 主题', upgraded.themes.light === '#abcdef');
  check('明亮主题原值等于规范值', upgraded.value === upgraded.themes.light);
  check('无引用时不带 ref', upgraded.ref === undefined);
  const resolution = resolveAll([upgraded], ['light', 'dark']);
  check('迁移后各主题可解析', resolution.get('light')!.values.get('old.token') === '#abcdef');
  // 缺少 dark 时回退规范值，不报错
  check('dark 缺省回退且无错误', resolution.get('dark')!.values.get('old.token') === '#abcdef' && resolution.get('dark')!.errors.length === 0);
}

// 5) 三方合并：两边同改同一令牌保留两边原值；仅一边改动直接合入
{
  const base = [t('color.x', '#111111', { light: '#111111', dark: '#222222' }), t('color.y', '#333333', { light: '#333333', dark: '#444444' })];
  const local = [
    t('color.x', '#LOCAL', { light: '#LOCAL', dark: '#222222' }),
    t('color.y', '#LOCAL-Y', { light: '#LOCAL-Y', dark: '#444444' }),
    t('color.new', '#new', { light: '#new', dark: '#new' })
  ];
  const remote = [
    t('color.x', '#REMOTE', { light: '#REMOTE', dark: '#222222' }),
    t('color.y', '#333333', { light: '#333333', dark: '#444444' }),
    t('color.z', '#remote-new', { light: '#remote-new', dark: '#remote-new' })
  ];
  const result = mergeTokens(base, local, remote);
  const conflict = result.conflicts.find((c) => c.tokenId === 'color.x' && c.theme === 'light');
  check('冲突被检测', Boolean(conflict));
  check('保留草稿原值', conflict?.local === '#LOCAL');
  check('保留远端原值', conflict?.remote === '#REMOTE');
  check('冲突时令牌默认采用本地值', result.tokens.find((tk) => tk.id === 'color.x')!.themes.light === '#LOCAL');
  check('本地单边改动被保留', result.tokens.find((tk) => tk.id === 'color.y')!.themes.light === '#LOCAL-Y');
  check('远端新增令牌被合入', result.tokens.some((tk) => tk.id === 'color.z'));
  check('本地新增令牌被保留', result.tokens.some((tk) => tk.id === 'color.new'));
  check('无冲突字段统计 applied', result.applied >= 1);
}

// 6) 冲突解决后二次合并不丢值
{
  const base = [t('color.x', '#111111', { light: '#111111' })];
  const local = [t('color.x', '#LOCAL', { light: '#LOCAL' })];
  const remote = [t('color.x', '#REMOTE', { light: '#REMOTE' })];
  const first = mergeTokens(base, local, remote);
  check('首轮冲突 1 处', first.conflicts.length === 1);
  // 以合并结果为新的本地、远端不再变化 → 幂等，无冲突
  const second = mergeTokens(remote, first.tokens, remote);
  check('裁决后同步幂等无冲突', second.conflicts.length === 0);
  check('裁决后本地值被保留', second.tokens[0]!.themes.light === '#LOCAL');
}

console.log(`\n${passed} 项全部通过`);
