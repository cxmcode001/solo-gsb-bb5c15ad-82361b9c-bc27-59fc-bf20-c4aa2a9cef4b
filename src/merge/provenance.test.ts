import { describe, expect, it } from 'vitest';
import {
  buildProvenance,
  buildProvenanceReport,
  formatProvenancePointer,
  formatSideValue,
  PROVENANCE_FORMAT,
  PROVENANCE_VERSION,
  type ProvenanceEntry,
} from './provenance';
import { threeWayMerge, type Resolutions } from './threeWayMerge';
import { isAbsent, type JsonValue } from './types';

function entriesOf(
  base: JsonValue,
  ours: JsonValue,
  theirs: JsonValue,
  resolutions: Resolutions = {},
): ProvenanceEntry[] {
  return buildProvenance(threeWayMerge(base, ours, theirs).root, resolutions);
}

function byPointer(entries: ProvenanceEntry[], pointer: string): ProvenanceEntry | undefined {
  return entries.find((e) => e.pointer === pointer);
}

describe('buildProvenance：来源分类', () => {
  it('仅当前分支 / 仅目标分支 / 双方同改 / 未变更', () => {
    const entries = entriesOf(
      { a: 1, b: 2, c: 3, same: 'x' },
      { a: 10, b: 2, c: 3, same: 'y' },
      { a: 1, b: 20, c: 3, same: 'y' },
    );
    expect(entries.map((e) => e.pointer)).toEqual(['/a', '/b', '/same']);
    expect(byPointer(entries, '/a')).toMatchObject({ category: 'ours', final: 10 });
    expect(byPointer(entries, '/b')).toMatchObject({ category: 'theirs', final: 20 });
    expect(byPointer(entries, '/same')).toMatchObject({ category: 'both', final: 'y' });
    // 未变更的 /c 不出现在清单中
    expect(byPointer(entries, '/c')).toBeUndefined();
  });

  it('新增条目：基线侧不存在', () => {
    // 嵌套一层使父对象双侧均有修改（触发按键递归），/p/added 仅当前分支新增
    const entries = entriesOf(
      { p: { x: 0, y: 0 } },
      { p: { x: 1, y: 0, added: 'new' } },
      { p: { x: 0, y: 1 } },
    );
    const added = byPointer(entries, '/p/added')!;
    expect(added.category).toBe('ours');
    expect(isAbsent(added.base)).toBe(true);
    expect(added.final).toBe('new');
  });

  it('冲突解决：采用当前 / 采用目标 / 自定义', () => {
    const result = threeWayMerge(
      { x: 1, y: 2, z: 3 },
      { x: 10, y: 20, z: 30 },
      { x: 100, y: 200, z: 300 },
    );
    const id = (p: string) => result.conflicts.find((c) => c.pointer === p)!.id;
    const entries = buildProvenance(result.root, {
      [id('/x')]: { kind: 'ours' },
      [id('/y')]: { kind: 'theirs' },
      [id('/z')]: { kind: 'custom', value: 999 },
    });
    expect(byPointer(entries, '/x')).toMatchObject({ category: 'conflict-ours', final: 10 });
    expect(byPointer(entries, '/y')).toMatchObject({ category: 'conflict-theirs', final: 200 });
    expect(byPointer(entries, '/z')).toMatchObject({ category: 'conflict-custom', final: 999 });
  });

  it('冲突条目保留三方值；未解决的冲突防御性跳过', () => {
    const result = threeWayMerge({ x: 1 }, { x: 10 }, { x: 100 });
    // 未解决：无条目
    expect(buildProvenance(result.root, {})).toEqual([]);
    const entries = buildProvenance(result.root, {
      [result.conflicts[0].id]: { kind: 'ours' },
    });
    const e = entries[0];
    expect(e.base).toBe(1);
    expect(e.ours).toBe(10);
    expect(e.theirs).toBe(100);
    expect(e.final).toBe(10);
  });
});

describe('buildProvenance：删除保留为条目', () => {
  it('仅当前分支删除 / 双方同删', () => {
    const entries = entriesOf(
      { keep: 1, gone: 2, bothGone: 3 },
      { keep: 1 },
      { keep: 1, gone: 2 },
    );
    const gone = byPointer(entries, '/gone')!;
    expect(gone.category).toBe('ours');
    expect(isAbsent(gone.final)).toBe(true);
    expect(gone.base).toBe(2);
    const bothGone = byPointer(entries, '/bothGone')!;
    expect(bothGone.category).toBe('both');
    expect(isAbsent(bothGone.final)).toBe(true);
  });

  it('冲突采用删除一侧：最终值不存在', () => {
    // 当前分支删除、目标分支修改 → 冲突；采用当前分支 → 最终删除
    const result = threeWayMerge({ x: 1 }, {}, { x: 2 });
    const entries = buildProvenance(result.root, {
      [result.conflicts[0].id]: { kind: 'ours' },
    });
    const e = byPointer(entries, '/x')!;
    expect(e.category).toBe('conflict-ours');
    expect(isAbsent(e.final)).toBe(true);
    expect(isAbsent(e.ours)).toBe(true);
    expect(e.theirs).toBe(2);
  });
});

describe('buildProvenance：父节点整体变更时不重复列出子路径', () => {
  it('父对象被整体替换：只列父路径', () => {
    // /p/a 仅当前分支整体替换；/p/sib 由目标分支修改（使 /p 触发按键递归）
    const entries = entriesOf(
      { p: { a: { x: 1, y: 2 }, sib: 0 } },
      { p: { a: { x: 9, y: 8, z: 7 }, sib: 0 } },
      { p: { a: { x: 1, y: 2 }, sib: 1 } },
    );
    expect(entries.map((e) => e.pointer)).toEqual(['/p/a', '/p/sib']);
    expect(byPointer(entries, '/p/a')!.category).toBe('ours');
    // 被整体替换的子路径不重复列出
    expect(entries.some((e) => e.pointer.startsWith('/p/a/'))).toBe(false);
  });

  it('父对象被整体删除：只列父路径，最终值不存在', () => {
    const entries = entriesOf(
      { p: { a: { x: 1 }, sib: 0 } },
      { p: { sib: 0 } },
      { p: { a: { x: 1 }, sib: 1 } },
    );
    expect(entries.map((e) => e.pointer)).toEqual(['/p/a', '/p/sib']);
    expect(isAbsent(byPointer(entries, '/p/a')!.final)).toBe(true);
    expect(entries.some((e) => e.pointer.startsWith('/p/a/'))).toBe(false);
  });

  it('父节点冲突以自定义对象解决：不列出其子路径', () => {
    const result = threeWayMerge({ a: { x: 1 } }, { a: { x: 2 } }, { a: 5 });
    const entries = buildProvenance(result.root, {
      [result.conflicts[0].id]: { kind: 'custom', value: { n: 1 } },
    });
    expect(entries.map((e) => e.pointer)).toEqual(['/a']);
    expect(byPointer(entries, '/a')).toMatchObject({
      category: 'conflict-custom',
      final: { n: 1 },
    });
  });

  it('双方同改的对象按键递归：列出子路径而不列父路径', () => {
    const entries = entriesOf(
      { a: { x: 1, y: 1 } },
      { a: { x: 2, y: 1 } },
      { a: { x: 1, y: 2 } },
    );
    expect(entries.map((e) => e.pointer)).toEqual(['/a/x', '/a/y']);
    expect(byPointer(entries, '/a/x')!.category).toBe('ours');
    expect(byPointer(entries, '/a/y')!.category).toBe('theirs');
  });
});

describe('buildProvenance：路径与边界', () => {
  it('路径遵循 RFC 6901 转义（~ → ~0，/ → ~1）', () => {
    const entries = entriesOf(
      { p: { 'a/b~c': 1, sib: 0 } },
      { p: { 'a/b~c': 2, sib: 0 } },
      { p: { 'a/b~c': 1, sib: 1 } },
    );
    const hit = byPointer(entries, '/p/a~1b~0c')!;
    expect(hit.segments).toEqual(['p', 'a/b~c']);
    expect(hit.category).toBe('ours');
  });

  it('根节点整体变更：指针为 ""', () => {
    const entries = entriesOf({ a: 1 }, [1, 2], { a: 1 });
    expect(entries).toHaveLength(1);
    expect(entries[0].pointer).toBe('');
    expect(entries[0].category).toBe('ours');
    expect(entries[0].final).toEqual([1, 2]);
  });

  it('结果与基线一致：无条目', () => {
    expect(entriesOf({ a: 1 }, { a: 1 }, { a: 1 })).toEqual([]);
  });
});

describe('buildProvenanceReport', () => {
  it('包含格式标识、版本、分类汇总与逐项四方取值', () => {
    const result = threeWayMerge(
      { keep: 1, gone: 2, conflict: 'a', added: 0 },
      { keep: 1, conflict: 'b', added: 0, extra: true },
      { keep: 1, gone: 2, conflict: 'c', added: 1 },
    );
    const entries = buildProvenance(result.root, {
      [result.conflicts[0].id]: { kind: 'theirs' },
    });
    const report = buildProvenanceReport(entries);

    expect(report.format).toBe(PROVENANCE_FORMAT);
    expect(report.version).toBe(PROVENANCE_VERSION);
    expect(report.summary).toEqual({
      total: 4,
      ours: 2, // /gone（删除）、/extra（新增）
      theirs: 1, // /added
      both: 0,
      'conflict-ours': 0,
      'conflict-theirs': 1,
      'conflict-custom': 0,
    });

    const gone = report.entries.find((e) => e.pointer === '/gone')!;
    expect(gone.deleted).toBe(true);
    expect(gone.base).toEqual({ present: true, value: 2 });
    expect(gone.ours).toEqual({ present: false });
    expect(gone.final).toEqual({ present: false });

    const extra = report.entries.find((e) => e.pointer === '/extra')!;
    expect(extra.deleted).toBe(false);
    expect(extra.base).toEqual({ present: false });
    expect(extra.final).toEqual({ present: true, value: true });

    const conflict = report.entries.find((e) => e.pointer === '/conflict')!;
    expect(conflict.category).toBe('conflict-theirs');
    expect(conflict.final).toEqual({ present: true, value: 'c' });
  });

  it('报告可 JSON 序列化（ABSENT 均已编码为 present:false）', () => {
    const entries = entriesOf(
      { p: { gone: 1, sib: 0 } },
      { p: { sib: 0 } },
      { p: { gone: 1, sib: 1 } },
    );
    const text = JSON.stringify(buildProvenanceReport(entries));
    expect(text).toContain('"present":false');
    expect(() => JSON.parse(text)).not.toThrow();
  });
});

describe('展示辅助函数', () => {
  it('缺失值明确标注为（不存在）', () => {
    const entries = entriesOf(
      { p: { gone: 1, sib: 0 } },
      { p: { sib: 0 } },
      { p: { gone: 1, sib: 1 } },
    );
    const gone = byPointer(entries, '/p/gone')!;
    expect(formatSideValue(gone.final)).toBe('（不存在）');
    expect(formatSideValue(gone.base)).toBe('1');
  });

  it('根指针显示为（根）', () => {
    expect(formatProvenancePointer('')).toBe('（根）');
    expect(formatProvenancePointer('/a')).toBe('/a');
  });
});
