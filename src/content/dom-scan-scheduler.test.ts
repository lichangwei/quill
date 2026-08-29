// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';
import { createDomScanScheduler } from './dom-scan-scheduler';

describe('动态输入框扫描调度', () => {
  it('同一帧内合并嵌套节点，只扫描最外层节点一次', () => {
    const callbacks: FrameRequestCallback[] = [];
    const scan = vi.fn();
    const schedule = createDomScanScheduler(scan, (callback) => {
      callbacks.push(callback);
      return callbacks.length;
    });
    const parent = document.createElement('section');
    const child = document.createElement('div');
    parent.append(child);

    schedule(child);
    schedule(parent);
    expect(scan).not.toHaveBeenCalled();

    callbacks[0](0);
    expect(scan).toHaveBeenCalledOnce();
    expect(scan).toHaveBeenCalledWith(parent);
  });
});
