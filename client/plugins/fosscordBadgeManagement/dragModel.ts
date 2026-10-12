/* SPDX-License-Identifier: AGPL-3.0-only */
export type DragRect = { id: string; index: number; left: number; right: number; top: number; bottom: number };
export type DropTarget = { index: number; x: number; y: number; height: number };

export function pointerTarget(rects: DragRect[], from: number, x: number, y: number): DropTarget | null {
    if (!rects.length) return null;
    const distance = (r: DragRect) => Math.max(r.left - x, 0, x - r.right) ** 2 + Math.max(r.top - y, 0, y - r.bottom) ** 2;
    const rect = rects.reduce((best, candidate) => (distance(candidate) < distance(best) ? candidate : best));
    const after = x >= (rect.left + rect.right) / 2;
    const insertion = rect.index + Number(after);
    return {
        index: Math.max(0, Math.min(rects.length - 1, insertion - Number(from < insertion))),
        x: (after ? rect.right : rect.left) + (after ? 4 : -4),
        y: rect.top,
        height: rect.bottom - rect.top,
    };
}

export function keyboardIndex(rects: DragRect[], current: number, key: string): number {
    if (key === "Home") return 0;
    if (key === "End") return rects.length - 1;
    if (key === "ArrowLeft" || key === "ArrowRight") return Math.max(0, Math.min(rects.length - 1, current + (key === "ArrowLeft" ? -1 : 1)));
    const origin = rects[current];
    if (!origin) return current;
    const row = rects.filter((r) => (key === "ArrowUp" ? r.bottom <= origin.top : r.top >= origin.bottom));
    const score = (r: DragRect) => Math.abs(r.top - origin.top) * 1000 + Math.abs(r.left - origin.left);
    return row.length ? row.reduce((best, candidate) => (score(candidate) < score(best) ? candidate : best)).index : current;
}

export const sameDragOrder = (rects: DragRect[], ids: string[]) => rects.length === ids.length && rects.every((r, index) => r.id === ids[index]);
