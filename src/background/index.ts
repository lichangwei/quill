import * as Types from '../types';
import { generateText } from '../ai/service';
import { getModelState, getStyleState } from '../settings/storage';
import { PAGE_FIELD_NOT_FOUND, buildPageFieldPrompt, buildPrompt } from './prompt';

if (chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Quill] 配置工具栏打开侧边栏失败:', error);
  });
}

const LEGACY_POLISH_PROMPT = '请润色以下文字，使其更专业流畅，保持原意，只返回结果，不要任何解释：\n\n{content}';

async function getActiveModel(): Promise<Types.ModelProfile> {
  const state = await getModelState();
  const enabledModels = state.models.filter((model) => model.enabled);
  const model = enabledModels.find((item) => item.id === state.activeModelId)
    ?? enabledModels.find((item) => item.id === state.defaultModelId)
    ?? enabledModels[0];
  if (!model) throw new Error('尚未完成模型配置，请前往设置页添加并启用模型');
  return model;
}

async function getActiveStyle(): Promise<Types.WritingStyle> {
  const state = await getStyleState();
  return state.styles.find((style) => style.id === state.activeStyleId)
    ?? state.styles.find((style) => style.id === state.defaultStyleId)
    ?? state.styles[0];
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === 'OPEN_EDITOR_SIDE_PANEL') {
    const state = msg.payload as Types.EditorState;
    const tabId = _sender.tab?.id;
    (async () => {
      try {
        if (!chrome.sidePanel || tabId === undefined) throw new Error('无法获取当前页面标签');
        await chrome.storage.session.set({ editorState: state });
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'src/sidepanel/sidepanel.html',
          enabled: true,
        });
        sendResponse({ requiresToolbarClick: true });
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Quill] 打开 Chrome 侧边栏失败: ${message}`);
        sendResponse({ error: message });
      }
    })();
    return true;
  }
  if (msg.type === 'ENHANCE_TEXT') {
    const req = msg.payload as Types.EnhanceRequest;
    (async () => {
      try {
        const [model, style] = await Promise.all([getActiveModel(), getActiveStyle()]);
        const legacyTemplate = (req as Types.EnhanceRequest & { template?: string }).template;
        const actionPrompt = typeof req.prompt === 'string'
          ? req.prompt
          : legacyTemplate === 'polish'
            ? LEGACY_POLISH_PROMPT
            : null;
        if (!actionPrompt || !req.context) {
          sendResponse({ error: '扩展已更新，请刷新当前页面后重试' } as Types.EnhanceResponse);
          return;
        }
        const prompt = buildPrompt(actionPrompt, req.context, style.description);
        console.info(`[Quill] 最终生成提示词\n${prompt}`);
        const result = await generateText(model, prompt, { temperature: 0.7 });
        sendResponse({ result } as Types.EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as Types.EnhanceResponse);
      }
    })();
    return true; // 保持异步通道
  }
  if (msg.type === 'EXTRACT_PAGE_FIELD') {
    const req = msg.payload as Types.PageFieldRequest;
    (async () => {
      try {
        const model = await getActiveModel();
        if (!req?.description || !req.pageContent) {
          sendResponse({ error: '页面字段读取参数不完整' } as Types.EnhanceResponse);
          return;
        }
        const extractionPrompt = buildPageFieldPrompt(req);
        console.info(`[Quill] 页面字段提取提示词\n${extractionPrompt}`);
        const result = await generateText(model, extractionPrompt, { temperature: 0 });
        if (!result || result.includes(PAGE_FIELD_NOT_FOUND)) {
          sendResponse({ error: `未找到页面字段“${req.description}”` } as Types.EnhanceResponse);
          return;
        }
        sendResponse({ result } as Types.EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as Types.EnhanceResponse);
      }
    })();
    return true;
  }
});
