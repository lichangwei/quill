export interface Settings {
  provider: 'openai' | 'claude';
  apiKey: string;
  model: string;
  endpoint: string;
  targetLang: string;
}

export interface FieldContext {
  pageTitle: string;
  fieldLabel: string;
  content: string;
}

export interface EnhanceRequest {
  template: 'polish' | 'translate' | 'shorten' | 'expand';
  context: FieldContext;
}

export interface EnhanceResponse {
  result?: string;
  error?: string;
}
