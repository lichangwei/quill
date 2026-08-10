export interface ModelConfig {
  baseUrl: string;
  apiKey: string;
  modelId: string;
}

export interface ModelProfile extends ModelConfig {
  id: string;
  name: string;
  enabled: boolean;
}

export interface ModelConfigState {
  models: ModelProfile[];
  defaultModelId: string | null;
  activeModelId: string | null;
}

export interface ElementTarget {
  kind: 'id' | 'selector';
  value: string;
}

export interface StoredAction {
  id: string;
  name: string;
  prompt: string;
  pageReferences?: PageElementReference[];
}

/**
 * 元素指纹，用于主 selector 失效时的降级匹配。
 * 所有字段可选，旧数据无此字段时降级逻辑自动跳过。
 */
export interface ElementFingerprint {
  tagName?: string;
  /** 稳定语义属性快照：data-testid / aria-label / name / role / type 等 */
  attributes?: Record<string, string>;
  /** 文本片段，截断以控制存储体积 */
  text?: string;
}

export interface PageElementReference {
  name: string;
  selector: string;
  fallback?: ElementFingerprint;
}

export interface ElementPickerResult extends PageElementReference {
  tagName: string;
}

export interface StoredActionGroup {
  url: string;
  selector: string;
  actions: StoredAction[];
  pageName?: string;
  fieldName?: string;
}

export interface FieldContext {
  pageTitle: string;
  fieldLabel: string;
  content: string;
  contentFormat?: 'text' | 'html';
}

export interface EnhanceRequest {
  prompt: string;
  context: FieldContext;
}

export interface EnhanceResponse {
  result?: string;
  error?: string;
}

export interface EditorState {
  url: string;
  selector: string;
  target: ElementTarget;
  group: StoredActionGroup | null;
  tabId?: number;
  pageName?: string;
  fieldName?: string;
  actionId?: string;
}
