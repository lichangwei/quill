import * as Types from '../types';
import { generateText } from '../ai/service';
import { getModelState, getSystemPrompt } from '../settings/storage';
import { selectorToTarget } from '../actions/storage';
import { buildPrompt } from './prompt';

if (chrome.sidePanel) {
  void chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true }).catch((error) => {
    console.error('[Quill] 配置工具栏打开侧边栏失败:', error);
  });
}

const LEGACY_POLISH_PROMPT = '请润色以下文字，使其更专业流畅，保持原意，只返回结果，不要任何解释：\n\n{content}';

async function getDefaultModel(): Promise<Types.ModelProfile> {
  const state = await getModelState();
  const enabledModels = state.models.filter((model) => model.enabled);
  const model = enabledModels.find((item) => item.id === state.defaultModelId)
    ?? enabledModels[0];
  if (!model) throw new Error('尚未完成模型配置，请前往设置页添加并启用模型');
  return model;
}

async function generateTextWithTiming(model: Types.ModelProfile, prompt: string, requestType: string): Promise<string> {
  const startedAt = performance.now();
  try {
    const result = await generateText(model, prompt, { temperature: 0.7, maxOutputTokens: 8192 });
    const elapsedMs = performance.now() - startedAt;
    console.info(
      `[Quill] 大模型处理完成：${requestType}，model=${model.modelId}，耗时=${elapsedMs.toFixed(0)}ms (${(elapsedMs / 1000).toFixed(2)}s)`
    );
    return result;
  } catch (error) {
    const elapsedMs = performance.now() - startedAt;
    console.error(
      `[Quill] 大模型处理失败：${requestType}，model=${model.modelId}，耗时=${elapsedMs.toFixed(0)}ms (${(elapsedMs / 1000).toFixed(2)}s)`,
      error
    );
    throw error;
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.type === 'OPEN_OPTIONS') {
    chrome.runtime.openOptionsPage();
    return;
  }
  if (msg.type === 'OPEN_EDITOR_SIDE_PANEL') {
    const state = msg.payload as Types.EditorState;
    const tabId = _sender.tab?.id;
    if (!chrome.sidePanel || tabId === undefined) {
      sendResponse({ error: '无法获取当前页面标签' });
      return;
    }
    // 必须在收到消息后同步调用 open()，不能在其前面 await 任何异步操作，
    // 否则会丢失用户手势（user gesture），导致 Chrome 报错拒绝打开侧边栏。
    const openPromise = chrome.sidePanel.open({ tabId });
    (async () => {
      try {
        await openPromise;
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'src/sidepanel/sidepanel.html',
          enabled: true,
        });
        await chrome.storage.session.set({ editorState: { ...state, tabId } });
        sendResponse({});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Quill] 打开 Chrome 侧边栏失败: ${message}`);
        sendResponse({ error: message, requiresToolbarClick: true });
      }
    })();
    return true;
  }
  if (msg.type === 'OPEN_EDITOR_FOR_ACTION') {
    const payload = msg.payload as { group: Types.StoredActionGroup; actionId: string };
    const windowId = _sender.tab?.windowId;
    if (!chrome.sidePanel || windowId === undefined) {
      sendResponse({ error: '无法获取当前窗口' });
      return;
    }
    // 同上，必须先同步调用 open() 保留用户手势，再进行后续异步操作。
    const openPromise = chrome.sidePanel.open({ windowId });
    (async () => {
      try {
        await openPromise;
        const isNavigableUrl = /^https?:\/\//.test(payload.group.url) && !payload.group.url.includes('*');
        const tab = isNavigableUrl
          ? await chrome.tabs.create({ url: payload.group.url, windowId, active: true })
          : (await chrome.tabs.query({ active: true, windowId }))[0];
        const tabId = tab?.id;
        if (tabId === undefined) throw new Error('无法获取目标页面标签');
        const editorState: Types.EditorState = {
          url: payload.group.url,
          selector: payload.group.selector,
          target: selectorToTarget(payload.group.selector),
          group: payload.group,
          tabId,
          pageName: payload.group.pageName,
          fieldName: payload.group.fieldName,
          actionId: payload.actionId,
        };
        await chrome.sidePanel.setOptions({
          tabId,
          path: 'src/sidepanel/sidepanel.html',
          enabled: true,
        });
        await chrome.storage.session.set({ editorState });
        sendResponse({});
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        console.error(`[Quill] 打开动作编辑失败: ${message}`);
        sendResponse({ error: message });
      }
    })();
    return true;
  }
  if (msg.type === 'ENHANCE_TEXT') {
    const req = msg.payload as Types.EnhanceRequest;
    (async () => {
      try {
        const model = await getDefaultModel();
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
        const systemPrompt = await getSystemPrompt();
        const prompt = buildPrompt(actionPrompt, req.context, systemPrompt);
        console.info(`[Quill] 最终生成提示词\n${prompt}`);
        const result = await generateTextWithTiming(model, prompt, '执行动作');
        sendResponse({ result } as Types.EnhanceResponse);
      } catch (e: unknown) {
        const message = e instanceof Error ? e.message : String(e);
        sendResponse({ error: message } as Types.EnhanceResponse);
      }
    })();
    return true; // 保持异步通道
  }
});
