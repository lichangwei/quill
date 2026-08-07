export interface Settings {
  provider: 'openai' | 'claude';
  apiKey: string;
  model: string;
  endpoint: string;
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
