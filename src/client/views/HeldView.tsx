import { useState } from 'react';
import { dropSubject, resumeHeldSubject } from '../api.js';
import LongPressButton from '../LongPressButton.js';
import type { DashboardSubject } from '../../server/types.js';
import { displayEpisodeTitle, displaySubjectName } from '../../shared/format.js';
import { commitWithMotion, MotionValue, motionStyle } from '../motion.js';

export default function HeldView({ subjects, disabled, onChanged, onError }: {
  subjects: DashboardSubject[];
  disabled: boolean;
  onChanged(): Promise<void>;
  onError(message: string): void;
}) {
  const [hiddenSubjectIds, setHiddenSubjectIds] = useState<Set<number>>(new Set());
  const seasonalCount = subjects.filter((subject) => subject.plannerMode === 'seasonal').length;
  const visibleSubjects = subjects.filter((subject) => !hiddenSubjectIds.has(subject.id));

  async function runAction(subjectId: number, action: () => Promise<void>) {
    commitWithMotion(() => setHiddenSubjectIds((current) => new Set(current).add(subjectId)));
    try {
      await action();
      await onChanged();
    } catch (error) {
      onError(error instanceof Error ? error.message : String(error));
    } finally {
      commitWithMotion(() => setHiddenSubjectIds((current) => {
        const next = new Set(current);
        next.delete(subjectId);
        return next;
      }));
    }
  }

  return (
    <div className="backlog-workspace held-workspace">
      <header className="backlog-overview" aria-label="搁置概览">
        <div className="backlog-overview-copy">
          <span className="panel-eyebrow">暂时放下</span>
          <h1>搁置</h1>
          <p>恢复后会回到原来的追番或补番计划。</p>
        </div>
        <dl className="backlog-overview-stats held-overview-stats">
          <div><dt>全部</dt><dd><MotionValue value={subjects.length}>{subjects.length} 部</MotionValue></dd></div>
          <div><dt>本季追番</dt><dd><MotionValue value={seasonalCount}>{seasonalCount} 部</MotionValue></dd></div>
          <div><dt>补番</dt><dd><MotionValue value={subjects.length - seasonalCount}>{subjects.length - seasonalCount} 部</MotionValue></dd></div>
        </dl>
      </header>

      <section className="backlog-section held-library" aria-label="已搁置动画">
        <header className="backlog-section-header">
          <div><span className="panel-eyebrow">统一片库</span><h2>已搁置动画</h2></div>
          <strong className="backlog-section-count"><MotionValue value={subjects.length}>{subjects.length} 部</MotionValue></strong>
        </header>
        {visibleSubjects.length > 0 ? (
          <div className="backlog-subject-list">
            {visibleSubjects.map((subject, index) => (
              <HeldSubjectItem
                key={subject.id}
                index={index}
                subject={subject}
                disabled={disabled}
                onResume={() => void runAction(subject.id, () => resumeHeldSubject(subject.id))}
                onDrop={() => void runAction(subject.id, () => dropSubject(subject.id))}
              />
            ))}
          </div>
        ) : <div className="empty">没有搁置的动画。</div>}
      </section>
    </div>
  );
}

function HeldSubjectItem({ index, subject, disabled, onResume, onDrop }: {
  index: number;
  subject: DashboardSubject;
  disabled: boolean;
  onResume(): void;
  onDrop(): void;
}) {
  const title = displaySubjectName(subject.name, subject.nameCn);
  const progressPercent = subject.eps > 0 ? Math.min(100, Math.round((subject.epStatus / subject.eps) * 100)) : 0;

  return (
    <article className="subject-row backlog-subject-row held-subject-row motion-item" style={motionStyle(index, `held-subject-${subject.id}`)}>
      <a className="subject-cover" href={subject.url} target="_blank" rel="noreferrer" aria-label={title}>
        {subject.image ? <img src={subject.image} alt="" /> : <span>{title}</span>}
      </a>
      <div className="subject-detail">
        <div className="subject-heading">
          <a href={subject.url} target="_blank" rel="noreferrer">{title}</a>
          <span>{subject.plannerMode === 'seasonal' ? '本季追番' : '补番'}</span>
        </div>
        <div className="progress-row">
          <MotionValue value={`${subject.epStatus}/${subject.eps || '?'}`}>{subject.epStatus} / {subject.eps || '?'}</MotionValue>
          <div className="progress-track" aria-hidden="true"><i style={{ width: `${progressPercent}%` }} /></div>
        </div>
        {subject.nextEpisode ? (
          <p>下一集：{displayEpisodeTitle(subject.nextEpisode.name, subject.nextEpisode.nameCn, subject.nextEpisode.sort)}</p>
        ) : <p>暂无未看的本篇集数</p>}
        <div className="backlog-subject-actions">
          <button type="button" className="secondary" disabled={disabled} onClick={onResume}>恢复在看</button>
          <LongPressButton subjectTitle={title} disabled={disabled} onCommit={onDrop} />
        </div>
      </div>
    </article>
  );
}
