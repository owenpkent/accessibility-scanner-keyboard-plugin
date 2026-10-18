// In-page scripts, as source strings. Each is an arrow function; `evalScript`
// in probe.ts wraps one in a call expression with its argument inlined, so the
// same text runs under Node Playwright that keyboard_scan.py runs under
// Python Playwright. The element list lives on window.__kbProbe so every later
// query resolves the same nodes the enumeration saw.
//
// All of it walks the composed (flat) tree, so controls inside open shadow
// roots are enumerated, focused, and named. Closed roots are invisible by
// construction, and iframes are counted but not entered.

const QUERY_ALL = `
  const queryAllComposed = (root, selector) => {
    const out = [];
    const visit = (node) => {
      if (node.nodeType !== 1) return;
      if (node.matches(selector)) out.push(node);
      if (node.shadowRoot) {
        for (const child of node.shadowRoot.children) visit(child);
      }
      for (const child of node.children) visit(child);
    };
    for (const child of root.children) visit(child);
    if (root.shadowRoot) {
      for (const child of root.shadowRoot.children) visit(child);
    }
    return out;
  };
`

// document.activeElement stops at the shadow host; follow each root's own
// activeElement down until the chain stops moving.
const DEEP_ACTIVE_ELEMENT = `
  const deepActiveElement = (doc) => {
    let el = doc.activeElement;
    while (el && el.shadowRoot && el.shadowRoot.activeElement) {
      el = el.shadowRoot.activeElement;
    }
    return el;
  };
`

// Ancestry across shadow boundaries. closest() and contains() stop at a
// ShadowRoot; this climbs the flat tree the way an event does.
const COMPOSED_ANCESTRY = `
  const composedParent = (node) => {
    if (!node) return null;
    if (node.assignedSlot) return node.assignedSlot;
    const p = node.parentNode;
    if (!p) return null;
    if (p.nodeType === 11) return p.host || null;
    return p;
  };
  const composedContains = (ancestor, node) => {
    for (let n = node; n; n = composedParent(n)) {
      if (n === ancestor) return true;
    }
    return false;
  };
  const composedClosest = (node, selector) => {
    for (let n = node; n; n = composedParent(n)) {
      if (n.nodeType === 1 && n.matches(selector)) return n;
    }
    return null;
  };
`

// A selector a person can paste into devtools, one segment per shadow
// boundary joined with axe's `>>>` notation. String.raw keeps the regex
// backslash intact.
const COMPOSED_SELECTOR = String.raw`
  const composedSelectorPath = (el) => {
    const segmentFor = (node, stopAt) => {
      const bits = [];
      let n = node;
      while (n && n.nodeType === 1 && n !== stopAt) {
        let bit = n.localName;
        if (n.id) { bits.unshift(bit + '#' + CSS.escape(n.id)); break; }
        const cls = (typeof n.className === 'string')
          ? n.className.trim().split(/\s+/).filter(Boolean).slice(0, 2) : [];
        if (cls.length) bit += '.' + cls.map((c) => CSS.escape(c)).join('.');
        const parent = n.parentNode;
        if (parent && parent.children) {
          const same = Array.from(parent.children).filter((ch) => ch.localName === n.localName);
          if (same.length > 1) bit += ':nth-of-type(' + (same.indexOf(n) + 1) + ')';
        }
        bits.unshift(bit);
        n = n.parentElement;
      }
      return bits.join(' > ');
    };
    const segments = [];
    let node = el;
    while (node) {
      const treeRoot = node.getRootNode();
      const inShadow = treeRoot instanceof ShadowRoot;
      const stopAt = inShadow ? null : (node.ownerDocument ? node.ownerDocument.body : null);
      segments.unshift(segmentFor(node, stopAt));
      if (!inShadow) break;
      node = treeRoot.host;
    }
    return segments.join(' >>> ');
  };
`

const SHADOW_ROOT_COUNT = `
  const countShadowRoots = (root) =>
    queryAllComposed(root, '*').filter((el) => !!el.shadowRoot).length
    + (root.shadowRoot ? 1 : 0);
`

const IFRAME_COUNT = `
  const countFrames = (root) => queryAllComposed(root, 'iframe,frame').length;
`

export const ENUMERATE = `() => {
${QUERY_ALL}${COMPOSED_ANCESTRY}${COMPOSED_SELECTOR}${SHADOW_ROOT_COUNT}
  // dialog:modal is the well-behaved case; role alone is not proof of
  // modality, but it is what a hand-rolled widget tends to expose instead of
  // a real <dialog>. The first visible match wins.
  const MODAL_SEL = 'dialog:modal, [role="dialog"], [role="alertdialog"], [aria-modal="true"]';
  let modal = null;
  for (const el of queryAllComposed(document.body, MODAL_SEL)) {
    const mcs = getComputedStyle(el);
    if (mcs.display === 'none' || mcs.visibility !== 'visible') continue;
    const mr = el.getBoundingClientRect();
    if (mr.width < 2 || mr.height < 2) continue;
    modal = el;
    break;
  }
  const root = modal || document.body;
  const SEL = [
    'a[href]', 'area[href]', 'button', 'input', 'select', 'textarea', 'summary',
    'iframe', 'audio[controls]', 'video[controls]',
    '[contenteditable="true"]', '[contenteditable=""]', '[tabindex]', '[onclick]',
    '[role="button"]', '[role="link"]', '[role="checkbox"]', '[role="radio"]',
    '[role="tab"]', '[role="menuitem"]', '[role="menuitemcheckbox"]',
    '[role="menuitemradio"]', '[role="option"]', '[role="switch"]',
    '[role="textbox"]', '[role="combobox"]', '[role="slider"]',
    '[role="spinbutton"]', '[role="searchbox"]'
  ].join(',');
  const COMPOSITE = ['[role="radiogroup"]', '[role="toolbar"]', '[role="menu"]',
    '[role="menubar"]', '[role="listbox"]', '[role="tablist"]', '[role="tree"]',
    '[role="grid"]'].join(',');
  const els = [];
  for (const el of queryAllComposed(root, SEL)) {
    if (el === document.body || el === document.documentElement) continue;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility !== 'visible') continue;
    const r = el.getBoundingClientRect();
    if (r.width < 2 || r.height < 2) continue;
    if (el.disabled) continue;
    if (composedClosest(el, '[aria-hidden="true"]')) continue;
    if (composedClosest(el, '[inert]')) continue;
    els.push(el);
  }
  window.__kbProbe = { els: els, path: composedSelectorPath };
  const TEXTLIKE = ['button', 'submit', 'reset', 'checkbox', 'radio', 'range',
                    'color', 'file', 'image'];
  return els.map((el, i) => {
    const comp = composedClosest(el, COMPOSITE);
    return {
      i: i,
      tag: el.localName,
      selector: composedSelectorPath(el),
      tabindex: el.getAttribute('tabindex'),
      focusable: el.tabIndex >= 0,
      type: (el.getAttribute('type') || '').toLowerCase(),
      name: el.getAttribute('name') || '',
      role: el.getAttribute('role') || '',
      editable: el.localName === 'textarea' || el.isContentEditable ||
        (el.localName === 'input' &&
         !TEXTLIKE.includes((el.getAttribute('type') || 'text').toLowerCase())),
      composite: comp ? composedSelectorPath(comp) : '',
      html: (el.outerHTML || '').slice(0, 400),
    };
  });
}`

export const SHADOW_COUNT = `() => {
${QUERY_ALL}${SHADOW_ROOT_COUNT}
  return countShadowRoots(document.body);
}`

export const FRAME_COUNT = `() => {
${QUERY_ALL}${IFRAME_COUNT}
  return countFrames(document.body);
}`

export const ACTIVE = `() => {
${DEEP_ACTIVE_ELEMENT}
  const p = window.__kbProbe || { els: [] };
  const ae = deepActiveElement(document);
  const wrapped = !ae || ae === document.body || ae === document.documentElement;
  return { idx: wrapped ? -1 : p.els.indexOf(ae), wrapped: wrapped };
}`

export const RECT = `(i) => {
  const el = window.__kbProbe.els[i];
  const r = el.getBoundingClientRect();
  return { x: r.x, y: r.y, w: r.width, h: r.height,
           sx: window.scrollX, sy: window.scrollY,
           vw: window.innerWidth, vh: window.innerHeight };
}`

export const ALL_VISIBLE = `(idxs) => {
  const p = window.__kbProbe || { els: [] };
  return idxs.every(i => {
    const el = p.els[i];
    if (!el || !el.isConnected) return false;
    const cs = getComputedStyle(el);
    if (cs.display === 'none' || cs.visibility !== 'visible') return false;
    const r = el.getBoundingClientRect();
    return r.width >= 2 && r.height >= 2;
  });
}`

export const CONTAINED = `([unvisited, visited]) => {
${COMPOSED_ANCESTRY}
  const els = (window.__kbProbe || { els: [] }).els;
  const vis = visited.map(i => els[i]).filter(Boolean);
  return unvisited.filter(u => {
    const el = els[u];
    return el && vis.some(v => composedContains(el, v) || composedContains(v, el));
  });
}`

export const FOCUS = `(i) => { const el = window.__kbProbe.els[i]; if (el) el.focus(); }`

export const BLUR = `() => {
${DEEP_ACTIVE_ELEMENT}
  const a = deepActiveElement(document); if (a && a.blur) a.blur();
}`

export const SCROLL_TO = `([x, y]) => window.scrollTo(x, y)`

export const COMMON_ANCESTOR = `(idxs) => {
${COMPOSED_ANCESTRY}
  const p = window.__kbProbe;
  let anc = p.els[idxs[0]];
  for (const i of idxs.slice(1)) {
    while (anc && !composedContains(anc, p.els[i])) anc = composedParent(anc);
  }
  if (!anc) anc = document.body;
  return { selector: p.path(anc), html: (anc.outerHTML || '').slice(0, 400) };
}`
