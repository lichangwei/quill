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

export interface WritingStyle {
  id: string;
  name: string;
  description: string;
  builtIn: boolean;
}

export interface WritingStyleState {
  styles: WritingStyle[];
  defaultStyleId: string;
  activeStyleId: string;
}

export interface ElementTarget {
  kind: 'id' | 'selector';
  value: string;
}

export interface StoredAction {
  id: string;
  name: string;
  prompt: string;
}

export interface StoredActionGroup {
  url: string;
  selector: string;
  actions: StoredAction[];
}

export interface FieldContext {
  pageTitle: string;
  fieldLabel: string;
  content: string;
}

export interface EnhanceRequest {
  prompt: string;
  context: FieldContext;
}

export interface EnhanceResponse {
  result?: string;
  error?: string;
}

export interface PageFieldRequest {
  description: string;
  pageTitle: string;
  pageUrl: string;
  pageContent: string;
}

export type PageFieldResponse = EnhanceResponse;

export interface EditorState {
  url: string;
  selector: string;
  target: ElementTarget;
  group: StoredActionGroup | null;
}
