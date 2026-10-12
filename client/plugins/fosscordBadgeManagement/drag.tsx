/* SPDX-License-Identifier: AGPL-3.0-only */
import type { ReactElement, KeyboardEvent, PointerEvent } from "react";
import { React, ReactDOM } from "@webpack/common";
import { keyboardIndex, pointerTarget, sameDragOrder, type DragRect, type DropTarget } from "./dragModel";
import type { CatalogBadge } from "./model";

type Props = {
    index: number;
    itemPreviewProps: { badge: CatalogBadge };
    className: string;
    children: ReactElement[];
    onReorder: (from: number, to: number) => void;
    "aria-label": string;
};
type Session = {
    popup: HTMLElement;
    root: HTMLDivElement;
    from: number;
    ids: string[];
    pointerId?: number;
    startX: number;
    startY: number;
    x: number;
    y: number;
    active: boolean;
    target: DropTarget | null;
    removeEscape: () => void;
};
type View = { x: number; y: number; pointer: boolean; target: DropTarget | null };
const selector = "[data-fosscord-reorder-index]";
const items = (popup: HTMLElement): DragRect[] =>
    [...popup.querySelectorAll<HTMLElement>(selector)]
        .map((el) => ({ ...el.getBoundingClientRect().toJSON(), id: el.dataset.fosscordReorderId!, index: Number(el.dataset.fosscordReorderIndex) }))
        .sort((a, b) => a.index - b.index);

function animateOrder(popup: HTMLElement, before: DragRect[]) {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
    requestAnimationFrame(() => {
        for (const el of popup.querySelectorAll<HTMLElement>(selector)) {
            const old = before.find((r) => r.id === el.dataset.fosscordReorderId);
            if (!old) continue;
            const rect = el.getBoundingClientRect();
            if (old.left !== rect.left || old.top !== rect.top)
                el.animate([{ transform: `translate(${old.left - rect.left}px, ${old.top - rect.top}px)` }, { transform: "translate(0, 0)" }], {
                    duration: 160,
                    easing: "ease-out",
                });
        }
    });
}

export function DraggableBadge(props: Props) {
    const badge = props.itemPreviewProps.badge;
    const root = React.useRef<HTMLDivElement>(null);
    const session = React.useRef<Session | null>(null);
    const frame = React.useRef(0);
    const current = React.useRef(props);
    current.current = props;
    const [view, setView] = React.useState<View | null>(null);
    const grip = React.useRef<HTMLDivElement>(null);

    function clear() {
        cancelAnimationFrame(frame.current);
        const s = session.current;
        session.current = null;
        if (!s) return;
        s.removeEscape();
        if (s.popup.dataset.fosscordDragging === String(badge.badge_id)) delete s.popup.dataset.fosscordDragging;
        if (s.popup.dataset.fosscordDragReserved === String(badge.badge_id)) delete s.popup.dataset.fosscordDragReserved;
        if (s.pointerId !== undefined && s.root.hasPointerCapture(s.pointerId)) s.root.releasePointerCapture(s.pointerId);
    }

    function finish(commit: boolean) {
        const s = session.current;
        const rects = s && items(s.popup);
        clear();
        setView(null);
        if (s && s.pointerId === undefined) requestAnimationFrame(() => grip.current?.focus());
        if (commit && s?.active && s.target && rects && sameDragOrder(rects, s.ids) && s.from === current.current.index && s.target.index !== s.from) {
            current.current.onReorder(s.from, s.target.index);
            animateOrder(s.popup, rects);
        }
    }

    React.useEffect(() => clear, []);
    React.useEffect(() => {
        if (session.current) finish(false);
    }, [props.index]);

    function start(x: number, y: number, pointerId?: number) {
        const popup = root.current?.closest<HTMLElement>("[data-fosscord-badge-customization]");
        if (!root.current || !popup || popup.dataset.fosscordDragReserved || items(popup).length < 2 || !badge.reorderable || badge.hidden) return false;
        const cancelOnEscape = (event: globalThis.KeyboardEvent) => {
            if (event.key !== "Escape") return;
            event.preventDefault();
            event.stopImmediatePropagation();
            finish(false);
        };
        window.addEventListener("keydown", cancelOnEscape, true);
        session.current = {
            root: root.current,
            popup,
            from: props.index,
            ids: items(popup).map((r) => r.id),
            pointerId,
            startX: x,
            startY: y,
            x,
            y,
            active: pointerId === undefined,
            target: null,
            removeEscape: () => window.removeEventListener("keydown", cancelOnEscape, true),
        };
        popup.dataset.fosscordDragReserved = String(badge.badge_id);
        return true;
    }

    function tick() {
        const s = session.current;
        if (!s?.active) return;
        const bounds = s.popup.getBoundingClientRect();
        const inside = s.x >= bounds.left && s.x <= bounds.right && s.y >= bounds.top && s.y <= bounds.bottom;
        if (inside && s.popup.scrollHeight > s.popup.clientHeight) {
            const amount = s.y < bounds.top + 36 ? -8 : s.y > bounds.bottom - 36 ? 8 : 0;
            s.popup.scrollTop += amount;
        }
        s.target = inside ? pointerTarget(items(s.popup), s.from, s.x, s.y) : null;
        setView({ x: s.x, y: s.y, pointer: true, target: s.target });
        frame.current = requestAnimationFrame(tick);
    }

    function pointerDown(event: PointerEvent<HTMLDivElement>) {
        if (event.button !== 0 || !event.isPrimary || (event.target as HTMLElement).closest("button,[aria-haspopup=menu]")) return;
        if (!start(event.clientX, event.clientY, event.pointerId)) return;
        event.currentTarget.setPointerCapture(event.pointerId);
        event.stopPropagation();
    }

    function pointerMove(event: PointerEvent<HTMLDivElement>) {
        const s = session.current;
        if (!s || s.pointerId !== event.pointerId) return;
        s.x = event.clientX;
        s.y = event.clientY;
        if (!s.active && (s.x - s.startX) ** 2 + (s.y - s.startY) ** 2 >= 36) {
            s.active = true;
            s.popup.dataset.fosscordDragging = String(badge.badge_id);
            tick();
        }
        if (s.active) event.preventDefault();
    }

    function keyboard(event: KeyboardEvent<HTMLDivElement>) {
        const activate = event.key === " " || event.key === "Enter" || ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "d");
        const arrow = ["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown", "Home", "End"].includes(event.key);
        if (!activate && !arrow) return;
        const s = session.current;
        if (s && s.pointerId !== undefined) return;
        event.preventDefault();
        event.stopPropagation();
        if (activate && s) return finish(true);
        if (!s) {
            if (!activate || !start(0, 0)) return;
            session.current!.popup.dataset.fosscordDragging = String(badge.badge_id);
        }
        const drag = session.current!;
        const rects = items(drag.popup);
        const index = arrow ? keyboardIndex(rects, drag.target?.index ?? drag.from, event.key) : drag.from;
        const rect = rects[index];
        if (!rect) return finish(false);
        drag.target = { index, x: index > drag.from ? rect.right + 4 : rect.left - 4, y: rect.top, height: rect.bottom - rect.top };
        setView({ x: 0, y: 0, pointer: false, target: drag.target });
        drag.popup.querySelectorAll<HTMLElement>(selector)[index]?.scrollIntoView({ block: "nearest" });
    }

    const handle = props.children[1]?.props as { className?: string; "aria-label"?: string };
    return (
        <div
            ref={root}
            className={`${props.className} fosscord-badge-drag-target`}
            data-fosscord-reorder-index={props.index}
            data-fosscord-reorder-id={String(badge.badge_id)}
            data-fosscord-drag-source={view ? "" : undefined}
            role="group"
            aria-label={props["aria-label"]}
            draggable={false}
            onDragStart={(event) => event.preventDefault()}
            onPointerDown={pointerDown}
            onPointerMove={pointerMove}
            onPointerUp={(event) => {
                const s = session.current;
                if (!s || s.pointerId !== event.pointerId) return;
                event.stopPropagation();
                s.x = event.clientX;
                s.y = event.clientY;
                const bounds = s.popup.getBoundingClientRect();
                s.target = s.x >= bounds.left && s.x <= bounds.right && s.y >= bounds.top && s.y <= bounds.bottom ? pointerTarget(items(s.popup), s.from, s.x, s.y) : null;
                finish(true);
            }}
            onPointerCancel={(event) => {
                if (session.current?.pointerId === event.pointerId) finish(false);
            }}
            onLostPointerCapture={() => {
                if (session.current) finish(false);
            }}
        >
            {props.children[0]}
            <div
                ref={grip}
                className={`${handle?.className ?? ""} fosscord-badge-drag-handle`}
                role="button"
                tabIndex={0}
                aria-label={handle?.["aria-label"] ?? `Reorder ${badge.name}`}
                aria-keyshortcuts="Space Enter Control+D Meta+D"
                aria-pressed={view !== null}
                onKeyDownCapture={keyboard}
                title="Drag to reorder. Space or Enter picks up; arrow keys move; Enter drops; Escape cancels."
            >
                <svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                    {[4, 12, 20].flatMap((cy) => [8, 16].map((cx) => <circle key={`${cx}-${cy}`} cx={cx} cy={cy} r="2" />))}
                </svg>
            </div>
            <span className="fosscord-badge-drag-status" role="status" aria-live="polite">
                {view?.target ? `${badge.name}, position ${view.target.index + 1}. Enter drops; Escape cancels.` : ""}
            </span>
            {view &&
                ReactDOM.createPortal(
                    <div className="fosscord-badge-drag-overlay" aria-hidden="true">
                        {view.pointer && (
                            <div className="fosscord-badge-drag-preview" style={{ left: view.x - 24, top: view.y - 24 }}>
                                <img src={badge.simple_icon_url} alt="" draggable={false} />
                            </div>
                        )}
                        {view.target && <div className="fosscord-badge-drop-indicator" style={{ left: view.target.x, top: view.target.y, height: view.target.height }} />}
                    </div>,
                    session.current?.popup ?? document.body,
                )}
        </div>
    );
}
