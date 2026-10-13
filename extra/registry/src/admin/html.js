class Raw {
    constructor(value) {
        this.value = value;
    }
}

export function raw(value) {
    return new Raw(value);
}

export function escapeHtml(value) {
    return String(value).replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;").replaceAll("'", "&#39;");
}

function render(value) {
    if (value === null || value === undefined || value === false) return "";
    if (value instanceof Raw) return value.value;
    if (Array.isArray(value)) return value.map(render).join("");
    return escapeHtml(value);
}

export function html(strings, ...values) {
    let out = strings[0];
    for (let i = 0; i < values.length; i++) out += render(values[i]) + strings[i + 1];
    return raw(out);
}

export function time(iso) {
    if (!iso) return html`<span class="muted">never</span>`;
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return html`<time datetime="${date.toISOString()}">${date.toISOString().slice(0, 16).replace("T", " ")} UTC</time>`;
}

const styles = `
:root {
    color-scheme: light;
    --color-page: #f7f7f8;
    --color-surface: #ffffff;
    --color-surface-hover: #f1f1f3;
    --color-border: #e1e1e6;
    --color-text: #1b1b1f;
    --color-text-secondary: #5d5d66;
    --color-accent: #6a4cd6;
    --color-accent-solid-text: #ffffff;
    --color-danger: #b4232f;
    --color-warning: #8a5a00;
    --color-success: #1d7a3f;
    --color-danger-surface: #fdecee;
    --color-warning-surface: #fdf3dc;
    --color-success-surface: #e6f5ec;
    --color-neutral-surface: #eeeef1;
    --radius-outer: 12px;
    --radius-inner: 8px;
}
@media (prefers-color-scheme: dark) {
    :root {
        color-scheme: dark;
        --color-page: #111114;
        --color-surface: #19191d;
        --color-surface-hover: #222228;
        --color-border: #2c2c33;
        --color-text: #ececf1;
        --color-text-secondary: #a1a1ab;
        --color-accent: #a58cff;
        --color-accent-solid-text: #16121f;
        --color-danger: #ff8a93;
        --color-warning: #f0bf5c;
        --color-success: #6fd796;
        --color-danger-surface: #3a1a1e;
        --color-warning-surface: #33270f;
        --color-success-surface: #14301f;
        --color-neutral-surface: #26262c;
    }
}
* { box-sizing: border-box; }
html { -webkit-font-smoothing: antialiased; -moz-osx-font-smoothing: grayscale; }
body {
    margin: 0;
    background: var(--color-page);
    color: var(--color-text);
    font: 15px/1.5 system-ui, -apple-system, "Segoe UI", sans-serif;
}
a { color: var(--color-accent); text-underline-position: from-font; text-decoration-skip-ink: auto; }
.skip { position: absolute; left: -9999px; }
.skip:focus { left: 16px; top: 8px; background: var(--color-surface); padding: 8px 12px; border-radius: var(--radius-inner); }
header { border-bottom: 1px solid var(--color-border); background: var(--color-surface); }
.bar { max-width: 1100px; margin: 0 auto; padding: 12px 16px; display: flex; flex-wrap: wrap; gap: 8px 24px; align-items: center; }
.brand { font-weight: 600; white-space: nowrap; }
nav { display: flex; flex-wrap: wrap; gap: 4px; flex: 1; }
nav a { color: var(--color-text-secondary); text-decoration: none; padding: 6px 10px; border-radius: var(--radius-inner); }
nav a[aria-current="page"] { color: var(--color-text); background: var(--color-neutral-surface); }
.who { display: flex; gap: 12px; align-items: center; color: var(--color-text-secondary); }
@media (max-width: 640px) {
    nav { order: 3; flex-basis: 100%; margin: 0 -10px; }
    .who { margin-left: auto; }
}
main { max-width: 1100px; margin: 0 auto; padding: 24px 16px 64px; }
h1 { font-size: 22px; margin: 0 0 16px; text-wrap: balance; }
h2 { font-size: 17px; margin: 32px 0 12px; text-wrap: balance; }
p { text-wrap: pretty; }
.muted { color: var(--color-text-secondary); }
.notice { padding: 10px 14px; border-radius: var(--radius-inner); margin-bottom: 16px; background: var(--color-success-surface); color: var(--color-success); }
.notice.error { background: var(--color-danger-surface); color: var(--color-danger); }
.card { background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-outer); padding: 16px; }
.stats { display: grid; grid-template-columns: repeat(auto-fit, minmax(180px, 1fr)); gap: 12px; }
.stat strong { display: block; font-size: 22px; font-variant-numeric: tabular-nums; }
.list { display: grid; gap: 8px; }
.item { display: grid; gap: 8px; }
.item-head { display: flex; flex-wrap: wrap; gap: 8px 12px; align-items: baseline; }
.item-head h3 { margin: 0; font-size: 16px; overflow-wrap: anywhere; }
.meta { display: flex; flex-wrap: wrap; gap: 4px 16px; color: var(--color-text-secondary); font-size: 13px; font-variant-numeric: tabular-nums; }
.meta span, .meta a { overflow-wrap: anywhere; }
.badge { white-space: nowrap; font-size: 12px; font-weight: 600; padding: 2px 8px; border-radius: 6px; background: var(--color-neutral-surface); color: var(--color-text-secondary); }
.badge.good { background: var(--color-success-surface); color: var(--color-success); }
.badge.warn { background: var(--color-warning-surface); color: var(--color-warning); }
.badge.bad { background: var(--color-danger-surface); color: var(--color-danger); }
.error-text { color: var(--color-danger); font-size: 13px; overflow-wrap: anywhere; }
.description { margin: 0; color: var(--color-text-secondary); overflow-wrap: anywhere; }
form.actions { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; }
form.actions .reason { flex: 1 1 260px; display: flex; align-items: center; gap: 8px; font-size: 14px; }
form.actions .reason input { flex: 1; }
.filters { display: flex; flex-wrap: wrap; gap: 4px; margin-bottom: 16px; }
.filters a { padding: 6px 10px; border-radius: var(--radius-inner); color: var(--color-text-secondary); text-decoration: none; border: 1px solid var(--color-border); background: var(--color-surface); }
.filters a[aria-current="true"] { color: var(--color-text); border-color: var(--color-text-secondary); }
input, select {
    font: inherit;
    color: var(--color-text);
    background: var(--color-page);
    border: 1px solid var(--color-border);
    border-radius: var(--radius-inner);
    padding: 7px 10px;
    min-height: 36px;
    min-width: 0;
}
label { display: grid; gap: 4px; font-size: 13px; color: var(--color-text-secondary); }
.form-grid { display: grid; grid-template-columns: 140px 1fr 1fr auto; gap: 12px; align-items: end; }
@media (max-width: 720px) { .form-grid { grid-template-columns: 1fr; } }
button {
    font: inherit;
    font-size: 14px;
    min-height: 36px;
    padding: 6px 14px;
    border-radius: var(--radius-inner);
    border: 1px solid var(--color-border);
    background: var(--color-surface);
    color: var(--color-text);
    cursor: pointer;
    transition: scale 200ms ease-out;
}
button:active { scale: 0.97; }
button.primary { background: var(--color-accent); border-color: var(--color-accent); color: var(--color-accent-solid-text); }
button.danger { color: var(--color-danger); }
.link-button { border: 0; background: none; padding: 0; min-height: 0; color: var(--color-accent); text-decoration: underline; text-underline-position: from-font; }
@media (hover: hover) {
    button:hover { background: var(--color-surface-hover); }
    button.primary:hover { background: var(--color-accent); filter: brightness(1.08); }
    .link-button:hover { background: none; }
    nav a:hover, .filters a:hover { color: var(--color-text); }
}
:focus-visible { outline: 2px solid var(--color-accent); outline-offset: 2px; }
.table-wrap { overflow-x: auto; background: var(--color-surface); border: 1px solid var(--color-border); border-radius: var(--radius-outer); }
table { width: 100%; border-collapse: collapse; font-size: 14px; font-variant-numeric: tabular-nums; }
th, td { text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--color-border); vertical-align: top; }
th { font-weight: 600; color: var(--color-text-secondary); white-space: nowrap; }
tr:last-child td { border-bottom: 0; }
td.wrap { overflow-wrap: anywhere; min-width: 240px; }
.empty { padding: 24px; text-align: center; color: var(--color-text-secondary); }
.center { max-width: 420px; margin: 15vh auto; text-align: center; }
`;

const navItems = [
    ["/admin", "Overview"],
    ["/admin/instances", "Instances"],
    ["/admin/discovery", "Discovery"],
    ["/admin/blocks", "Blocks"],
    ["/admin/activity", "Activity"],
];

export function page({ title, body, session = null, path = "", notice = null, noticeError = false, status = 200 }) {
    const document = html`<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex">
<title>${title} · Meowcord registry</title>
<style>${raw(styles)}</style>
</head>
<body>
<a class="skip" href="#main">Skip to content</a>
${
    session
        ? html`<header><div class="bar">
<span class="brand">Meowcord registry</span>
<nav aria-label="Admin">${navItems.map(([href, label]) => html`<a href="${href}" ${raw(path === href ? 'aria-current="page"' : "")}>${label}</a>`)}</nav>
<div class="who"><span>${session.username}</span><form method="post" action="/admin/logout"><button class="link-button" type="submit">Sign out</button></form></div>
</div></header>`
        : ""
}
<main id="main">
${notice ? html`<div class="notice ${noticeError ? "error" : ""}" role="${noticeError ? "alert" : "status"}">${notice}</div>` : ""}
${body}
</main>
</body>
</html>`;
    return new Response(document.value, {
        status,
        headers: {
            "content-type": "text/html; charset=utf-8",
            "cache-control": "no-store",
            "content-security-policy": "default-src 'none'; style-src 'unsafe-inline'; img-src https: data:; form-action 'self'; frame-ancestors 'none'; base-uri 'none'",
            "referrer-policy": "same-origin",
            "x-content-type-options": "nosniff",
        },
    });
}
