// @ts-check
/** Tiny DOM helpers. Text is always set with textContent, never innerHTML. */

const SVG_NS = "http://www.w3.org/2000/svg";

/**
 * Creates an element. `attrs` keys starting with "on" become listeners,
 * `class` sets className, `hidden`/boolean values toggle attributes.
 * @param {string} tag
 * @param {Record<string, unknown> | null} [attrs]
 * @param {...(Node | string | number | null | undefined | false)} children
 * @returns {HTMLElement}
 */
export function h(tag, attrs, ...children) {
    const el = document.createElement(tag);
    for (const [key, value] of Object.entries(attrs ?? {})) {
        if (value === null || value === undefined || value === false) continue;
        if (key.startsWith("on") && typeof value === "function") {
            el.addEventListener(key.slice(2).toLowerCase(), /** @type {EventListener} */ (value));
        } else if (key === "class") {
            el.className = String(value);
        } else if (value === true) {
            el.setAttribute(key, "");
        } else {
            el.setAttribute(key, String(value));
        }
    }
    append(el, children);
    return el;
}

/**
 * @param {Element} parent
 * @param {Array<Node | string | number | null | undefined | false>} children
 */
export function append(parent, children) {
    for (const child of children) {
        if (child === null || child === undefined || child === false) continue;
        parent.append(typeof child === "number" ? String(child) : child);
    }
}

/** @param {Element} el */
export function clear(el) {
    while (el.firstChild) el.removeChild(el.firstChild);
}

/** @type {Record<string, string[]>} */
const ICON_PATHS = {
    check: ["M5 12.5l4.5 4.5L19 7.5"],
    cross: ["M6.5 6.5l11 11M17.5 6.5l-11 11"],
    flag: ["M6 21V4", "M6 4.5h11l-2.5 4 2.5 4H6"],
    person: ["M15.5 8a3.5 3.5 0 1 1-7 0a3.5 3.5 0 1 1 7 0", "M5 20c1.2-3.6 4-5.5 7-5.5s5.8 1.9 7 5.5"],
    clock: ["M20.5 12a8.5 8.5 0 1 1-17 0a8.5 8.5 0 1 1 17 0", "M12 7.5V12l3 2"],
    alert: ["M12 4l9 16H3z", "M12 10v4.5", "M12 17.2v.3"],
    doc: ["M7 3.5h7l4 4V20.5H7z", "M14 3.5v4h4", "M9.5 12h6M9.5 15.5h6"],
};

/**
 * Inline stroke icon. Decorative by default (aria-hidden).
 * @param {string} name
 * @param {string} [className]
 */
export function icon(name, className = "icon") {
    const svg = document.createElementNS(SVG_NS, "svg");
    svg.setAttribute("viewBox", "0 0 24 24");
    svg.setAttribute("class", className);
    svg.setAttribute("aria-hidden", "true");
    svg.setAttribute("focusable", "false");
    for (const d of ICON_PATHS[name] ?? ICON_PATHS.clock) {
        const path = document.createElementNS(SVG_NS, "path");
        path.setAttribute("d", d);
        svg.append(path);
    }
    return svg;
}

/**
 * Status badge: icon + text, so meaning never relies on colour alone.
 * @param {{ tone: string, icon: string, short: string }} meta
 */
export function badge(meta) {
    return h("span", { class: `badge tone-${meta.tone}` }, icon(meta.icon, "icon icon-small"), meta.short);
}
