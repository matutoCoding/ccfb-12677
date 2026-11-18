// 评审评论引擎：场景钉评论、指派、状态流转、关联 cue/灯号、客户意见合并
import type { Project, ReviewComment, ReviewStatus, ID } from '../types';

export function addComment(
  project: Project,
  input: Omit<ReviewComment, 'id' | 'status' | 'createdAt'>,
): Project {
  const comment: ReviewComment = {
    ...input,
    id: `comment-${Math.random().toString(36).slice(2, 8)}`,
    status: 'open',
    createdAt: Date.now(),
  };
  return { ...project, comments: [...project.comments, comment] };
}

export function transitionStatus(project: Project, commentId: ID, status: ReviewStatus): Project {
  return {
    ...project,
    comments: project.comments.map((c) =>
      c.id === commentId
        ? { ...c, status, resolvedAt: status === 'resolved' ? Date.now() : c.resolvedAt }
        : c,
    ),
  };
}

/** 客户意见包（JSON）导回并入主工程：按 uuid 去重，已存在则保留主工程状态 */
export function mergeFeedback(project: Project, incoming: ReviewComment[]): Project {
  const existing = new Set(project.comments.map((c) => c.id));
  const fresh = incoming.filter((c) => !existing.has(c.id));
  return { ...project, comments: [...project.comments, ...fresh] };
}

export function commentStats(project: Project): Record<ReviewStatus, number> {
  const stats: Record<ReviewStatus, number> = { open: 0, assigned: 0, resolved: 0, rejected: 0 };
  for (const c of project.comments) stats[c.status]++;
  return stats;
}
