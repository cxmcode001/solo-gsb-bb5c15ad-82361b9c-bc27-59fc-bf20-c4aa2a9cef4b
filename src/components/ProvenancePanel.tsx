import { useMemo, useState } from 'react';
import type { MergeResult, Resolutions } from '../merge/threeWayMerge';
import { isAbsent, type SideValue } from '../merge/types';
import {
  buildProvenance,
  buildProvenanceReport,
  formatProvenancePointer,
  formatSideValue,
  PROVENANCE_CATEGORY_LABELS,
  PROVENANCE_CATEGORY_ORDER,
  type ProvenanceCategory,
} from '../merge/provenance';
import { downloadText } from '../download';

interface Props {
  mergeResult: MergeResult;
  resolutions: Resolutions;
  onCopy: (text: string, label: string) => void;
}

type Filter = ProvenanceCategory | 'all';

/** 类别 → 徽章样式：冲突解决沿用所采用一侧的配色，自定义用黄色 */
const CATEGORY_BADGE_CLASS: Record<ProvenanceCategory, string> = {
  ours: 'ours',
  theirs: 'theirs',
  both: 'both',
  'conflict-ours': 'conflict-ours',
  'conflict-theirs': 'conflict-theirs',
  'conflict-custom': 'conflict-custom',
};

function SideValueView({ label, value }: { label: string; value: SideValue }) {
  return (
    <div className="side-value">
      <h4>{label}</h4>
      <pre className={isAbsent(value) ? 'absent' : ''}>{formatSideValue(value)}</pre>
    </div>
  );
}

/** 输出阶段的「决策溯源」面板：变更清单 + 类别筛选 + 四方取值详情 + JSON 报告导出 */
export default function ProvenancePanel({ mergeResult, resolutions, onCopy }: Props) {
  // 由合并树与当前决策实时推导：返回调整并重新生成后，清单与详情自动反映最新决策
  const entries = useMemo(
    () => buildProvenance(mergeResult.root, resolutions),
    [mergeResult, resolutions],
  );
  const [filter, setFilter] = useState<Filter>('all');
  const [selectedPointer, setSelectedPointer] = useState<string | null>(null);

  const counts = useMemo(() => {
    const c = Object.fromEntries(PROVENANCE_CATEGORY_ORDER.map((k) => [k, 0])) as Record<
      ProvenanceCategory,
      number
    >;
    for (const e of entries) c[e.category]++;
    return c;
  }, [entries]);

  const filtered = filter === 'all' ? entries : entries.filter((e) => e.category === filter);
  // 按指针从当前条目实时解析选中项：重新生成后详情始终展示最新四方取值
  const selected =
    selectedPointer === null ? null : (entries.find((e) => e.pointer === selectedPointer) ?? null);

  const reportText = () => JSON.stringify(buildProvenanceReport(entries), null, 2);

  return (
    <div className="provenance-panel">
      <div className="provenance-header">
        <h3>决策溯源</h3>
        <span className="hint">
          最终结果相对基线的变更清单（路径遵循 RFC 6901）；删除也保留为条目，点击路径查看四方取值
        </span>
      </div>
      {entries.length === 0 ? (
        <div className="empty-tip">合并结果与基线一致，没有变更条目。</div>
      ) : (
        <>
          <div className="provenance-filters">
            <button
              className={`prov-filter${filter === 'all' ? ' active' : ''}`}
              onClick={() => setFilter('all')}
            >
              全部 {entries.length}
            </button>
            {PROVENANCE_CATEGORY_ORDER.filter((c) => counts[c] > 0).map((c) => (
              <button
                key={c}
                className={`prov-filter${filter === c ? ' active' : ''}`}
                onClick={() => setFilter(c)}
              >
                {PROVENANCE_CATEGORY_LABELS[c]} {counts[c]}
              </button>
            ))}
          </div>
          <div className="provenance-body">
            <div className="provenance-list">
              {filtered.map((e) => (
                <button
                  key={e.pointer}
                  className={`prov-row${selected?.pointer === e.pointer ? ' selected' : ''}`}
                  onClick={() => setSelectedPointer(e.pointer)}
                  title={formatProvenancePointer(e.pointer)}
                >
                  <code className="prov-pointer">{formatProvenancePointer(e.pointer)}</code>
                  <span className={`badge ${CATEGORY_BADGE_CLASS[e.category]}`}>
                    {PROVENANCE_CATEGORY_LABELS[e.category]}
                  </span>
                  {isAbsent(e.final) && <span className="prov-deleted">已删除</span>}
                </button>
              ))}
              {filtered.length === 0 && <div className="empty-tip">该类别下没有条目。</div>}
            </div>
            <div className="provenance-detail">
              {selected ? (
                <>
                  <div className="prov-detail-head">
                    <span className="pointer">{formatProvenancePointer(selected.pointer)}</span>
                    <span className={`badge ${CATEGORY_BADGE_CLASS[selected.category]}`}>
                      {PROVENANCE_CATEGORY_LABELS[selected.category]}
                    </span>
                  </div>
                  <div className="prov-side-values">
                    <SideValueView label="基线" value={selected.base} />
                    <SideValueView label="当前分支" value={selected.ours} />
                    <SideValueView label="目标分支" value={selected.theirs} />
                    <SideValueView label="最终值" value={selected.final} />
                  </div>
                </>
              ) : (
                <div className="empty-tip">点击左侧路径，查看基线 / 当前分支 / 目标分支 / 最终值</div>
              )}
            </div>
          </div>
        </>
      )}
      <div className="panel-actions">
        <button
          className="small"
          onClick={() => onCopy(reportText(), '决策溯源报告 ')}
          disabled={entries.length === 0}
        >
          复制报告
        </button>
        <button
          className="small"
          onClick={() => downloadText('provenance.json', reportText())}
          disabled={entries.length === 0}
        >
          下载 provenance.json
        </button>
      </div>
    </div>
  );
}
