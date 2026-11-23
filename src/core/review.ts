// 评审评论: 场景钉点、指派、解决状态、关联 cue/灯号、外部意见打包合并
import type { ReviewComment, Vec3 } from './types.ts';

export interface CommentBundle {
  format: 'tld-review-bundle/1';
  projectName: string;
  exportedAt: number;
  comments: ReviewComment[];
}

export function exportCommentBundle(projectName: string, comments: ReviewComment[]): string {
  const bundle: CommentBundle = {
    format: 'tld-review-bundle/1',
    projectName,
    exportedAt: Date.now(),
    comments,
  };
  return JSON.stringify(bundle, null, 2);
}

/** 客户意见导回: 按 id 去重合并, 新意见打上导入批次; 已解决的主工程意见不被外部副本覆盖 */
export function mergeCommentBundle(existing: ReviewComment[], json: string): {
  comments: ReviewComment[];
  added: number;
  skipped: number;
} {
  const bundle = JSON.parse(json) as CommentBundle;
  if (bundle.format !== 'tld-review-bundle/1') throw new Error('评论包格式不识别');
  const byId = new Map(existing.map(c => [c.id, c]));
  let added = 0, skipped = 0;
  const batch = `imp-${bundle.exportedAt}`;
  for (const incoming of bundle.comments) {
    const local = byId.get(incoming.id);
    if (local) {
      if (local.status === 'resolved' || local.status === 'rejected') { skipped++; continue; }
      byId.set(incoming.id, { ...incoming, status: local.status, assignee: local.assignee ?? incoming.assignee });
    } else {
      byId.set(incoming.id, { ...incoming, importBatch: batch });
      added++;
    }
  }
  return { comments: [...byId.values()].sort((a, b) => a.createdAt - b.createdAt), added, skipped };
}

export function makeComment(
  position: Vec3,
  text: string,
  author: string,
  ref?: { cueNo?: number; fixtureLabel?: string; assignee?: string },
): ReviewComment {
  return {
    id: `cmt-${Date.now()}-${Math.floor(Math.random() * 1e6)}`,
    position,
    text,
    author,
    assignee: ref?.assignee,
    status: ref?.assignee ? 'assigned' : 'open',
    cueNo: ref?.cueNo,
    fixtureLabel: ref?.fixtureLabel,
    createdAt: Date.now(),
  };
}
