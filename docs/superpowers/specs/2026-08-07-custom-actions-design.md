# Quill 自定义动作设计文档

**日期**：2026-08-07
**状态**：待评审

## 背景

Quill 是一个 AI 输入增强 Chrome 插件。当前在页面输入框上注入 ✦ 按钮，点击弹出面板，提供四个硬编码的优化动作：润色、翻译、缩写、扩写。每个动作对应 background 脚本里一段写死的 prompt 模板，翻译动作额外依赖设置页的「目标语言」参数。

## 目标

将硬编码的四个动作改为「一个内置动作 + 用户自定义动作」模型：

- 只保留「润色」作为内置的全局默认动作。
- 允许用户自行添加任意优化方向（翻译、缩写、扩写等），每个动作是「名称 + prompt」。
- 每个自定义动作绑定到「特定 URL 规则 + 特定页面元素」，只在命中的页面的命中的输入框上出现。
- 所有自定义动作持久化到 Chrome 插件存储。

## 非目标

- 不做「一组同类元素」绑定（选择器可能命中多个元素时只给提示，不主动支持批量语义）。第一版聚焦单个元素。
- 不做跨设备同步（使用 `storage.local`）。
- 不保留 translate/shorten/expand 内置模板，彻底移除。
- 不做动作导入/导出、排序等高级管理功能。

## 关键决策

| 决策点 | 选择 |
|--------|------|
| 动作绑定粒度 | URL 规则 + 元素 双重绑定 |
| URL 匹配 | 默认预填当前页完整 URL，可手写，支持 `*` 通配符 |
| 动作字段 | 名称 + prompt 两字段（移除 targetLang） |
| 管理入口 | ✦ 按钮左键=功能面板，右键=编辑对话框（纯右键创建） |
| 内置润色 | 全局默认、永远显示、不可删除；可被用户覆盖 prompt |
| 元素识别 | id 优先（校验唯一）→ CSS 选择器兜底 |
| 元素匹配方式 | `element.matches(selector)` |
| 唯一性校验 | 仅保存时校验；命中 ≠ 1 时提示但允许强制保存 |
| 存储 | `chrome.storage.local`（5MB） |
| 旧动作 | translate/shorten/expand 彻底移除 |

## 数据模型

存储在 `chrome.storage.local`，键为动作数组。

```typescript
// 内置润色的固定 id
const POLISH_ID = 'polish';

interface ElementTarget {
  kind: 'id' | 'selector';
  value: string;   // kind=id 时是元素 id（不含 #）；kind=selector 时是 CSS 选择器
}

interface StoredAction {
  id: string;                    // 普通动作用 crypto.randomUUID()；润色覆盖记录固定用 'polish'
  name: string;                  // 按钮显示名，如「翻译成英文」
  prompt: string;                // prompt 模板，含 {content} 占位符（可选）
  urlPattern: string;            // URL 匹配规则，支持 * 通配符；空字符串 = 全局匹配
  target: ElementTarget | null;  // 绑定元素；null = 不限元素
}
```

### 内置润色：默认 + 覆盖模式

- 「润色」id 固定为 `'polish'`，其 name 和默认 prompt 写死在代码里。
- 用户未修改时：storage 里没有它的记录，读取时用代码默认值补上。
- 用户修改 prompt 后：往 storage 存一条 `id === 'polish'` 的记录，覆盖默认。
- 编辑对话框对润色提供「恢复默认」：删除该覆盖记录即回到内置文案。
- 润色的 `urlPattern` 为空、`target` 为 `null`，因此无条件全局显示，且不可删除。

### 读取逻辑

1. 从 storage 读动作数组。
2. 合并内置润色：若数组中存在 `id === 'polish'` 的记录则用它，否则注入内置默认润色。
3. 返回合并后的动作列表。

## 匹配逻辑

用户左键点击某输入框的 ✦ 按钮时，计算「该元素 + 当前 URL」下应显示的动作：

- **润色**：`urlPattern` 空 + `target` 为 null → 无条件显示，永远置顶。
- **普通动作**：`urlPattern` 命中 `location.href` **且** `target` 命中被点击元素 → 显示。

### URL 匹配

将 `urlPattern` 中的 `*` 转为 `.*`（其余正则元字符转义）后 test 当前 URL。空 pattern 视为命中。

```typescript
function urlMatches(pattern: string, url: string): boolean {
  if (!pattern) return true;
  const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
  return new RegExp('^' + escaped + '$').test(url);
}
```

### 元素匹配

统一用 `element.matches()`：

```typescript
function elementMatches(el: Element, target: ElementTarget | null): boolean {
  if (!target) return true;
  const selector = target.kind === 'id' ? '#' + CSS.escape(target.value) : target.value;
  try {
    return el.matches(selector);
  } catch {
    return false;  // 非法选择器不匹配
  }
}
```

## 交互设计

### ✦ 按钮

- **左键点击**：弹出功能面板，显示润色 + 当前元素/URL 命中的自定义动作。
- **右键点击**：弹出编辑对话框（管理动作与 prompt）。阻止浏览器默认右键菜单。

### 左键功能面板

- 从「四按钮固定网格」改为「动态列表」：根据命中的动作数组动态生成按钮，润色置顶。
- 只命中润色时，面板只有一个按钮。
- 面板不含任何创建入口（纯右键创建）。
- 选中动作后的流程（loading → 结果 → 接受/重试/取消）沿用现有逻辑。

### 右键编辑对话框

由右键 ✦ 按钮触发，承担全部管理职责：

- **当前元素信息**（只读展示）：显示将绑定的元素标识（id 或生成的选择器）。
- **已绑定到此元素的动作列表**：列出当前元素+URL 命中的自定义动作，可编辑/删除。润色也列出，可编辑 prompt、可「恢复默认」，不可删除。
- **新建/编辑动作表单**：
  - 名称（文本框）
  - prompt（多行文本框，提示可用 `{content}` 占位）
  - URL 规则（文本框，默认预填当前页完整 URL，可改、支持 `*`）
  - 元素绑定：默认为右键时的元素，自动生成 id 或选择器；展示且允许手改，可在 id/selector 间切换。
- **保存时唯一性校验**：若标识在当前页命中 ≠ 1 个元素，显示警告，但保留「仍然保存」按钮允许强制保存。

## 元素标识生成算法

创建动作时，为右键选中的元素生成 `ElementTarget`：

1. 元素有 `id` 且页面唯一 → `{ kind: 'id', value: el.id }`。
2. 否则生成 CSS 选择器（`kind: 'selector'`）：
   - 尝试 `tagName` + 稳定属性（`name`、`type`、`aria-label`）组合，如 `textarea[name="comment"]`，校验唯一。
   - 仍不唯一 → 向上逐级加父级路径 + `:nth-of-type(n)`，直到 `document.querySelectorAll(sel).length === 1` 或到达根。
3. 生成后展示最终选择器给用户，可手改。

> `class` 默认不参与生成（很多站点使用哈希化/动态 class，容易失效）；用户手改时可自行使用。

## 错误与边界处理

- **保存时选择器命中 ≠ 1 个**：提示警告，允许强制保存（为将来「一组元素」预留）。
- **prompt 缺 `{content}`**：不强制。缺失时按现有逻辑将输入框内容拼接在 prompt 末尾。
- **左键时动作绑定元素已不匹配**（页面结构变化）：该动作不显示，不报错；润色始终兜底可用。
- **非法选择器**：`matches()` 抛错时视为不匹配，不影响其他动作。
- **API 未配置**：沿用现有「打开设置页」提示逻辑。

## 受影响文件

| 文件 | 变化 |
|------|------|
| `src/types.ts` | 重构 `EnhanceRequest`（携带实际 prompt 而非 template 字面量）；`Settings` 移除 `targetLang`；新增 `StoredAction`、`ElementTarget` |
| `src/actions/storage.ts`（新增） | 动作读写、内置润色合并、URL/元素匹配、选择器生成、唯一性校验 |
| `src/panel/Panel.ts` | 动态渲染动作列表；新增右键编辑对话框 |
| `src/content/index.ts` | ✦ 按钮增加右键事件；左键传入被点击元素 |
| `src/background/index.ts` | 移除 `TEMPLATES` 字典；`buildPrompt` 改用传入的 prompt（填充/追加 `{content}`） |
| `src/options/options.html` / `options.ts` | 移除「翻译目标语言」设置区 |

## 数据流

1. content script 扫描输入框，注入 ✦ 按钮（现有逻辑）。
2. 左键 ✦ → 读取动作、按当前元素+URL 过滤 → 面板动态渲染按钮。
3. 用户选动作 → content script 取输入框内容 + 上下文 + 该动作 prompt → 发消息给 background。
4. background 用传入 prompt 填充 `{content}`（或追加）+ 页面/字段上下文 → 调用 API → 返回结果。
5. 结果显示在面板，接受则回填输入框（现有 `fillField` 逻辑）。
6. 右键 ✦ → 编辑对话框 → 增删改动作 → 写入 storage.local。

## 测试策略

- **单元测试**：`urlMatches`（通配符/空/转义）、`elementMatches`（id/selector/非法）、选择器生成（唯一性、逐级向上）、内置润色合并逻辑。
- **手动验证**：在真实页面（含 id 输入框、无 id 输入框、SPA 动态渲染）验证绑定、匹配、右键编辑、润色覆盖与恢复默认、强制保存非唯一选择器。
- 若项目当前无测试框架，需在实现阶段引入标准选择（Vitest，契合现有 Vite 工具链）。
