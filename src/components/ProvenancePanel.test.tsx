// @vitest-environment jsdom
import { act, type ReactElement } from 'react';
import { createRoot } from 'react-dom/client';
import { describe, expect, it, vi } from 'vitest';
import ProvenancePanel from './ProvenancePanel';
import { threeWayMerge, type Resolutions } from '../merge/threeWayMerge';
import type { JsonValue } from '../merge/types';

(globalThis as Record<string, unknown>).IS_REACT_ACT_ENVIRONMENT = true;

function makeRenderer(container: HTMLElement) {
  const root = createRoot(container);
  return (node: ReactElement) => act(() => root.render(node));
}

const all = (container: ParentNode, sel: string) => [...container.querySelectorAll(sel)];
const btnByText = (container: HTMLElement, text: string) =>
  all(container, 'button').find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;
const filterBtn = (container: HTMLElement, text: string) =>
  all(container, '.prov-filter').find((b) => b.textContent?.includes(text)) as
    | HTMLButtonElement
    | undefined;
const rowByPointer = (container: HTMLElement, pointer: string) =>
  all(container, '.prov-row').find(
    (r) => r.querySelector('.prov-pointer')?.textContent === pointer,
  ) as HTMLButtonElement | undefined;
const rowPointers = (container: HTMLElement) =>
  all(container, '.prov-row').map((r) => r.querySelector('.prov-pointer')?.textContent);
/** 详情区四方取值（基线 / 当前分支 / 目标分支 / 最终值）的文本 */
const detailValues = (container: HTMLElement) =>
  all(container, '.prov-side-values .side-value pre').map((p) => p.textContent);

const BASE: JsonValue = { keep: 1, chOurs: 1, chTheirs: 1, gone: 5, conflict: 'a' };
const OURS: JsonValue = { keep: 1, chOurs: 2, chTheirs: 1, conflict: 'b' }; // gone 被删除
const THEIRS: JsonValue = { keep: 1, chOurs: 1, chTheirs: 3, gone: 5, conflict: 'c' };
/** 夹具中唯一冲突（/conflict）的 id */
const CONFLICT_ID = threeWayMerge(BASE, OURS, THEIRS).conflicts[0].id;

function setup(resolutions: Resolutions) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const mergeResult = threeWayMerge(BASE, OURS, THEIRS);
  const onCopy = vi.fn();
  const render = makeRenderer(container);
  const rerender = (res: Resolutions) =>
    render(<ProvenancePanel mergeResult={mergeResult} resolutions={res} onCopy={onCopy} />);
  rerender(resolutions);
  return { container, onCopy, rerender };
}

describe('ProvenancePanel', () => {
  it('按来源类别生成变更清单；删除值保留为条目并标注', () => {
    const { container } = setup({ [CONFLICT_ID]: { kind: 'theirs' } });

    // 未变更的 /keep 不列出；其余四处变更各一条
    expect(rowPointers(container)).toEqual(['/chOurs', '/chTheirs', '/gone', '/conflict']);
    const badges = all(container, '.prov-row .badge').map((b) => b.textContent);
    expect(badges).toEqual(['仅当前分支', '仅目标分支', '仅当前分支', '冲突·采用目标']);
    // 删除条目保留并标注「已删除」
    expect(rowByPointer(container, '/gone')!.querySelector('.prov-deleted')?.textContent).toBe(
      '已删除',
    );
    // 筛选条：全部 + 非零类别（双方同改等零计数类别不显示）
    const filters = all(container, '.prov-filter').map((f) => f.textContent);
    expect(filters).toEqual(['全部 4', '仅当前分支 2', '仅目标分支 1', '冲突·采用目标 1']);
  });

  it('点击路径显示基线 / 两侧 / 最终值，缺失值明确标注为（不存在）', () => {
    const { container } = setup({ [CONFLICT_ID]: { kind: 'theirs' } });

    // 删除条目：当前分支与最终值缺失
    act(() => rowByPointer(container, '/gone')!.click());
    expect(detailValues(container)).toEqual(['5', '（不存在）', '5', '（不存在）']);
    const labels = all(container, '.prov-side-values .side-value h4').map((x) => x.textContent);
    expect(labels).toEqual(['基线', '当前分支', '目标分支', '最终值']);

    // 冲突采用目标：最终值等于目标分支
    act(() => rowByPointer(container, '/conflict')!.click());
    expect(detailValues(container)).toEqual(['"a"', '"b"', '"c"', '"c"']);
  });

  it('支持按来源类别筛选清单', () => {
    const { container } = setup({ [CONFLICT_ID]: { kind: 'theirs' } });

    act(() => filterBtn(container, '仅当前分支')!.click());
    expect(rowPointers(container)).toEqual(['/chOurs', '/gone']);

    act(() => filterBtn(container, '冲突·采用目标')!.click());
    expect(rowPointers(container)).toEqual(['/conflict']);

    act(() => filterBtn(container, '全部')!.click());
    expect(rowPointers(container)).toHaveLength(4);
  });

  it('复制报告输出 JSON（含格式标识与分类），下载按钮可用', () => {
    const { container, onCopy } = setup({ [CONFLICT_ID]: { kind: 'theirs' } });

    act(() => btnByText(container, '复制报告')!.click());
    const [text, label] = onCopy.mock.calls[0] as [string, string];
    expect(label).toBe('决策溯源报告 ');
    const report = JSON.parse(text);
    expect(report.format).toBe('json-three-way-merge/provenance');
    expect(report.summary).toMatchObject({ total: 4, ours: 2, theirs: 1, 'conflict-theirs': 1 });
    expect(report.entries.find((e: { pointer: string }) => e.pointer === '/gone').deleted).toBe(
      true,
    );

    const download = btnByText(container, '下载 provenance.json')!;
    expect(download).toBeDefined();
    expect(download.disabled).toBe(false);
  });

  it('返回调整并重新生成后反映最新决策', () => {
    const { container, rerender } = setup({ [CONFLICT_ID]: { kind: 'theirs' } });
    expect(rowByPointer(container, '/conflict')!.querySelector('.badge')?.textContent).toBe(
      '冲突·采用目标',
    );

    // 改选自定义值后重新生成：类别徽章与详情最终值同步更新
    rerender({ [CONFLICT_ID]: { kind: 'custom', value: 42 } });
    expect(rowByPointer(container, '/conflict')!.querySelector('.badge')?.textContent).toBe(
      '冲突·自定义',
    );
    expect(filterBtn(container, '冲突·自定义')?.textContent).toContain('1');
    act(() => rowByPointer(container, '/conflict')!.click());
    expect(detailValues(container)).toEqual(['"a"', '"b"', '"c"', '42']);

    // 改选采用当前分支
    rerender({ [CONFLICT_ID]: { kind: 'ours' } });
    expect(rowByPointer(container, '/conflict')!.querySelector('.badge')?.textContent).toBe(
      '冲突·采用当前',
    );
  });

  it('结果与基线一致时显示空状态，报告按钮禁用', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const mergeResult = threeWayMerge({ a: 1 }, { a: 1 }, { a: 1 });
    const render = makeRenderer(container);
    render(<ProvenancePanel mergeResult={mergeResult} resolutions={{}} onCopy={() => {}} />);

    expect(container.textContent).toContain('合并结果与基线一致');
    expect(btnByText(container, '复制报告')!.disabled).toBe(true);
    expect(btnByText(container, '下载 provenance.json')!.disabled).toBe(true);
  });
});
