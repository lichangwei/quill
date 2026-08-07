// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from 'vitest';
import { readLabeledField } from './dom-reader';

describe('readLabeledField', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('读取 Element UI 多选框的已选标签', () => {
    document.body.innerHTML = `
      <div class="el-form-item">
        <label class="el-form-item__label">赠送对象</label>
        <div class="el-form-item__content">
          <span class="el-select__tags-text">Abby Chu 储琴琴 HP0-产品研发中心</span>
          <input value="" />
        </div>
      </div>`;
    expect(readLabeledField('赠送对象')).toBe('Abby Chu 储琴琴 HP0-产品研发中心');
  });

  it('通过 label for 读取原生输入框的实时值', () => {
    document.body.innerHTML = '<label for="article">文章内容：</label><textarea id="article">项目正文</textarea>';
    expect(readLabeledField('文章内容')).toBe('项目正文');
  });

  it('找不到标签时返回 null', () => {
    document.body.innerHTML = '<label>其他字段</label><input value="内容" />';
    expect(readLabeledField('赠送对象')).toBeNull();
  });
});
