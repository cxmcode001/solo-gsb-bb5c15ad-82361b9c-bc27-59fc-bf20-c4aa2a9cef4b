import type { MergeNode, Resolutions } from './threeWayMerge';
import { isAbsent, type JsonValue, type SideValue } from './types';

/**
 * 输出阶段的“决策溯源”：按最终结果相对基线的变更路径生成清单，
 * 每项标注来源类别（仅当前分支 / 仅目标分支 / 双方同改 / 冲突解决），
 * 并保留基线、两侧与最终值供逐条查看与导出报告。
 */

/** 变更来源类别 */
export type ProvenanceCategory =
  | 'ours' // 仅当前分支修改
  | 'theirs' // 仅目标分支修改
  | 'both' // 双方改成相同值（含都删除）
  | 'conflict-ours' // 冲突解决：采用当前分支
  | 'conflict-theirs' // 冲突解决：采用目标分支
  | 'conflict-custom'; // 冲突解决：自定义值

/** 单条决策溯源记录：最终结果相对基线的一处变更（删除也保留为条目） */
export interface ProvenanceEntry {
  /** RFC 6901 JSON Pointer（根为 ""） */
  pointer: string;
  /** 未转义的路径段 */
  segments: string[];
  category: ProvenanceCategory;
  base: SideValue;
  ours: SideValue;
  theirs: SideValue;
  /** 最终合并值；ABSENT 表示该项在结果中被删除 */
  final: SideValue;
}

export const PROVENANCE_CATEGORY_LABELS: Record<ProvenanceCategory, string> = {
  ours: '仅当前分支',
  theirs: '仅目标分支',
  both: '双方同改',
  'conflict-ours': '冲突·采用当前',
  'conflict-theirs': '冲突·采用目标',
  'conflict-custom': '冲突·自定义',
};

/** 所有类别（固定顺序，供筛选与汇总展示） */
export const PROVENANCE_CATEGORY_ORDER: ProvenanceCategory[] = [
  'ours',
  'theirs',
  'both',
  'conflict-ours',
  'conflict-theirs',
  'conflict-custom',
];

/**
 * 由合并树与当前冲突决策推导变更清单（深度优先、按合并树键序，确定性输出）。
 *
 * 合并树只对“双方同改且都是对象”的节点按键递归（status = 'object'）；
 * 其余变更节点（ours / theirs / both / conflict）都是叶子，整体新增 / 替换 / 删除。
 * 因此父节点被整体替换或删除时，其子路径天然不会出现在清单中。
 */
export function buildProvenance(root: MergeNode, resolutions: Resolutions): ProvenanceEntry[] {
  const entries: ProvenanceEntry[] = [];
  collect(root, resolutions, entries);
  return entries;
}

function collect(node: MergeNode, resolutions: Resolutions, entries: ProvenanceEntry[]): void {
  switch (node.status) {
    case 'unchanged':
      return;
    case 'object':
      // 对象容器按键递归合并：容器本身不是一次整体变更，只列出子节点的变更
      for (const child of node.children) collect(child, resolutions, entries);
      return;
    case 'ours':
    case 'theirs':
    case 'both':
      entries.push({
        pointer: node.pointer,
        segments: node.segments,
        category: node.status,
        base: node.base,
        ours: node.ours,
        theirs: node.theirs,
        final: node.merged,
      });
      return;
    case 'conflict': {
      const res = node.conflictId ? resolutions[node.conflictId] : undefined;
      // 输出阶段必然已全部解决（未解决时无法生成结果）；防御性跳过未解决项
      if (!res) return;
      const final: SideValue =
        res.kind === 'ours' ? node.ours : res.kind === 'theirs' ? node.theirs : res.value;
      entries.push({
        pointer: node.pointer,
        segments: node.segments,
        category: `conflict-${res.kind}`,
        base: node.base,
        ours: node.ours,
        theirs: node.theirs,
        final,
      });
      return;
    }
  }
}

/** 报告格式标识与版本 */
export const PROVENANCE_FORMAT = 'json-three-way-merge/provenance';
export const PROVENANCE_VERSION = 1;

/** 报告中某一侧的值：present=false 表示该侧不存在此节点（与会话快照编码一致） */
export type ProvenanceSideValue = { present: true; value: JsonValue } | { present: false };

export interface ProvenanceReportEntry {
  /** RFC 6901 JSON Pointer（根为 ""） */
  pointer: string;
  category: ProvenanceCategory;
  /** 最终值不存在（该项在结果中被删除） */
  deleted: boolean;
  base: ProvenanceSideValue;
  ours: ProvenanceSideValue;
  theirs: ProvenanceSideValue;
  final: ProvenanceSideValue;
}

export interface ProvenanceReport {
  format: typeof PROVENANCE_FORMAT;
  version: typeof PROVENANCE_VERSION;
  summary: { total: number } & Record<ProvenanceCategory, number>;
  entries: ProvenanceReportEntry[];
}

function encodeSide(v: SideValue): ProvenanceSideValue {
  return isAbsent(v) ? { present: false } : { present: true, value: v };
}

/** 由变更清单生成可下载的 JSON 报告（含分类汇总与每项的四方取值） */
export function buildProvenanceReport(entries: ProvenanceEntry[]): ProvenanceReport {
  const summary = { total: entries.length } as { total: number } & Record<
    ProvenanceCategory,
    number
  >;
  for (const c of PROVENANCE_CATEGORY_ORDER) summary[c] = 0;
  for (const e of entries) summary[e.category]++;
  return {
    format: PROVENANCE_FORMAT,
    version: PROVENANCE_VERSION,
    summary,
    entries: entries.map((e) => ({
      pointer: e.pointer,
      category: e.category,
      deleted: isAbsent(e.final),
      base: encodeSide(e.base),
      ours: encodeSide(e.ours),
      theirs: encodeSide(e.theirs),
      final: encodeSide(e.final),
    })),
  };
}

/** 供 UI 展示某一侧的值：缺失（不存在 / 已删除）时明确标注 */
export function formatSideValue(v: SideValue): string {
  return isAbsent(v) ? '（不存在）' : JSON.stringify(v, null, 2);
}

/** 供 UI 展示指针：根指针显示为「（根）」 */
export function formatProvenancePointer(pointer: string): string {
  return pointer === '' ? '（根）' : pointer;
}
