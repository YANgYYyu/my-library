'use strict';
// 最小 DOM 桩，供 tests/test_render.py 驱动，用来验证 app.js 的渲染与交互链路。
//
// 它刻意还原了两条容易被忽略、但恰好是「瀑布流放进最短列」成立前提的浏览器契约：
//   1. 脱离文档的元素没有布局盒，offsetHeight 恒为 0；
//   2. hidden 元素（含祖先 hidden）同样读不到高度。
// 桩若不还原这两条，就测不出「整组卡片堆进第一列」这类缺陷——列还在，只是没摊开。
//
// 用法：node dom_stub.js <data.json> <app.js>
// 输出：JSON，{checks: [{name, ok, detail}], info: {...}}

const fs = require('fs');

const registry = new Map();
const timers = [];
let uid = 0;

class ClassList {
  constructor() { this.set = new Set(); }
  add(...t) { t.forEach((x) => this.set.add(x)); }
  remove(...t) { t.forEach((x) => this.set.delete(x)); }
  contains(t) { return this.set.has(t); }
  toggle(t, force) {
    const on = force === undefined ? !this.set.has(t) : !!force;
    if (on) this.set.add(t); else this.set.delete(t);
    return on;
  }
}

class El {
  constructor(tag) {
    this.tagName = String(tag).toUpperCase();
    this.children = [];
    this.parent = null;
    this.classList = new ClassList();
    this.dataset = {};
    this.attrs = {};
    this.listeners = {};
    this.style = { setProperty: (k, v) => { this.style[k] = v; } };
    this._text = '';
    this._innerHTML = '';
    this.hidden = false;
    this.id = '';
    this._top = 0;
    this._uid = ++uid;
    this.scrollLeft = 0;
    this.scrollWidth = 0;
    this.clientWidth = 0;
  }
  get childElementCount() { return this.children.length; }
  inDocument() {
    let root = this;
    while (root.parent) root = root.parent;
    return root === document.body || root === document.documentElement;
  }
  get offsetHeight() {
    // 契约 2：自身或任一祖先 hidden，就没有布局盒
    for (let node = this; node; node = node.parent) {
      if (node.hidden) return 0;
    }
    // 契约 1：没挂进文档，同样没有布局盒
    if (!this.inDocument()) return 0;
    return 100 + this.children.length * 7;
  }
  appendChild(node) {
    node.parent = this;
    this.children.push(node);
    if (node.id) registry.set(node.id, node);
    return node;
  }
  append(...nodes) { nodes.forEach((n) => this.appendChild(n)); }
  remove() {
    if (!this.parent) return;
    this.parent.children = this.parent.children.filter((c) => c !== this);
  }
  set className(v) { this.classList.set = new Set(String(v).split(/\s+/).filter(Boolean)); }
  get className() { return [...this.classList.set].join(' '); }
  set innerHTML(v) {
    if (v === '') {
      this.children.forEach((c) => { if (c.id) registry.delete(c.id); });
      this.children = [];
      this._innerHTML = '';
    } else {
      this._innerHTML = String(v);
    }
  }
  get innerHTML() { return this._innerHTML; }
  set textContent(v) { this._text = String(v); this.children = []; }
  get textContent() { return this._text; }
  setAttribute(k, v) { this.attrs[k] = String(v); }
  getAttribute(k) { return k in this.attrs ? this.attrs[k] : null; }
  removeAttribute(k) { delete this.attrs[k]; }
  addEventListener(type, fn) { (this.listeners[type] ||= []).push(fn); }
  dispatch(type, event = {}) {
    const e = Object.assign({ target: this, currentTarget: this, preventDefault() {} }, event);
    (this.listeners[type] || []).forEach((fn) => fn(e));
  }
  click() { this.dispatch('click'); }
  focus() { document.activeElement = this; }
  select() {}
  getBoundingClientRect() {
    return { top: this._top, left: 0, width: 0, height: this.offsetHeight };
  }
  scrollTo(opts) {
    if (opts && typeof opts.left === 'number') this.scrollLeft = opts.left;
  }
  descendants() { return this.children.flatMap((c) => [c, ...c.descendants()]); }
  matches(sel) {
    if (sel.startsWith('#')) return this.id === sel.slice(1);
    if (sel.startsWith('.')) return this.classList.contains(sel.slice(1));
    return this.tagName === sel.toUpperCase();
  }
  querySelector(sel) { return this.querySelectorAll(sel)[0] || null; }
  querySelectorAll(sel) {
    const parts = sel.split(',').map((s) => s.trim());
    return this.descendants().filter((n) => parts.some((p) => n.matches(p)));
  }
}

const IDS = [
  'menu-toggle', 'sidebar', 'sidebar-close', 'nav-groups', 'scrim', 'view-title',
  'view-count', 'group-nav', 'status', 'groups', 'modal', 'modal-box', 'modal-close',
  'modal-title', 'modal-category', 'modal-body', 'modal-actions',
];
IDS.forEach((id) => { const el = new El('div'); el.id = id; registry.set(id, el); });

const navItems = ['prompts', 'skills'].map((view) => {
  const el = new El('button');
  el.className = 'nav-item';
  el.dataset.view = view;
  return el;
});

const docListeners = {};
const document = {
  activeElement: null,
  body: new El('body'),
  documentElement: new El('html'),
  createElement: (tag) => new El(tag),
  querySelector: (sel) => {
    if (sel.startsWith('#')) return registry.get(sel.slice(1)) || null;
    return document.body.querySelector(sel);
  },
  querySelectorAll: (sel) => (sel === '.nav-item' ? navItems : document.body.querySelectorAll(sel)),
  addEventListener: (type, fn) => { (docListeners[type] ||= []).push(fn); },
  execCommand: () => true,
};
document.body.appendChild(registry.get('sidebar'));
document.body.appendChild(registry.get('groups'));

// fitScrollTail 靠这个判断文档末尾还剩多少可滚距离
document.documentElement.scrollHeight = 1330;

const winListeners = {};
const window = {
  innerWidth: 1280,
  innerHeight: 900,
  scrollY: 0,
  location: { protocol: 'http:' },
  isSecureContext: false,
  matchMedia: (q) => {
    if (q.indexOf('max-width: 767px') !== -1) return { matches: window.innerWidth <= 767 };
    if (q.indexOf('reduce') !== -1) return { matches: true };
    return { matches: false };
  },
  scrollTo: () => {},
  requestAnimationFrame: (fn) => fn(),
  setTimeout: (fn) => { timers.push(fn); return timers.length; },
  clearTimeout: () => {},
  addEventListener: (type, fn) => { (winListeners[type] ||= []).push(fn); },
  getComputedStyle: () => ({ top: '52px' }),
};

global.document = document;
global.window = window;
Object.defineProperty(global, 'navigator', { value: {}, configurable: true, writable: true });
global.marked = { parse: (s) => '<p>' + s + '</p>' };
global.fetch = async () => ({
  ok: true,
  json: async () => JSON.parse(fs.readFileSync(process.argv[2], 'utf8')),
});

// 用 new Function 包一层执行，函数声明不会漏到外层；末尾把内部函数挂出来供断言调用
new Function(
  fs.readFileSync(process.argv[3], 'utf8') +
    '\n;global.__inner = { fitScrollTail: () => fitScrollTail() };'
)();

function flush() { while (timers.length) timers.shift()(); }
function fire(type) { (winListeners[type] || []).forEach((fn) => fn()); }

const checks = [];
function check(name, fn) {
  try {
    fn();
    checks.push({ name: name, ok: true, detail: '' });
  } catch (err) {
    checks.push({ name: name, ok: false, detail: err.message });
  }
}
function eq(actual, expected, label) {
  const a = JSON.stringify(actual);
  const b = JSON.stringify(expected);
  if (a !== b) throw new Error((label ? label + '：' : '') + '期望 ' + b + '，实际 ' + a);
}
function ok(cond, label) { if (!cond) throw new Error(label || '断言失败'); }

// n 张卡片分到 k 列：非空列数应为 min(n, k)，各列数量差不超过 1
function expectSpread(counts, label) {
  const total = counts.reduce((a, b) => a + b, 0);
  const nonEmpty = counts.filter((n) => n > 0).length;
  eq(nonEmpty, Math.min(total, counts.length),
    label + ' 的非空列数（分布 ' + JSON.stringify(counts) + '）');
  ok(Math.max(...counts) - Math.min(...counts) <= 1, label + ' 分列失衡：' + JSON.stringify(counts));
}

const groupsEl = registry.get('groups');
const navEl = registry.get('group-nav');
const sidebarEl = registry.get('nav-groups');
const info = {};

setTimeout(() => {
  const sectionCards = (section) =>
    section.querySelector('.masonry').children.map((c) => c.querySelectorAll('.card').length);
  const names = () => groupsEl.children.map((s) => s.querySelector('.group-name').textContent);

  check('渲染出 5 个分组，顺序按拼音', () => {
    eq(groupsEl.children.map((c) => c.classList.contains('group')),
      [true, true, true, true, true]);
    eq(names(), ['解决问题', '决策', '认识你自己', '问清问题', '学习']);
  });

  check('分组标题是 h3，卡片标题是 h4', () => {
    const heading = groupsEl.children[0].querySelector('.group-heading');
    eq(heading.tagName, 'H3', '分组标题标签');
    eq(heading.querySelector('.group-toggle').tagName, 'BUTTON', '折叠控件标签');
    eq(groupsEl.querySelector('.card').querySelector('.card-title').tagName, 'H4', '卡片标题标签');
  });

  check('分组条数与两处导航', () => {
    eq(groupsEl.children.map((s) => s.querySelector('.group-count').textContent),
      ['3 条', '2 条', '2 条', '1 条', '4 条']);
    eq(navEl.children.length, 5);
    eq(sidebarEl.children.length, 6, '侧边栏 1 个标题 + 5 项');
    eq(registry.get('view-count').textContent, '12 条 · 5 个分类');
  });

  check('每个分组的卡片摊到各列（不是全堆第一列）', () => {
    info.spread = {};
    groupsEl.children.forEach((section) => {
      const name = section.querySelector('.group-name').textContent;
      const counts = sectionCards(section);
      info.spread[name] = counts;
      expectSpread(counts, name);
    });
  });

  check('折叠时清空瀑布流，展开时补建且分列正确', () => {
    const section = groupsEl.children[4];
    const toggle = section.querySelector('.group-toggle');
    toggle.click();
    eq(section.classList.contains('is-collapsed'), true);
    eq(toggle.getAttribute('aria-expanded'), 'false');
    eq(section.querySelector('.masonry').hidden, true);
    toggle.click();
    eq(section.querySelector('.masonry').hidden, false);
    expectSpread(sectionCards(section), '学习 展开后');
  });

  check('折叠状态在布局变化后保留，且折叠时不建瀑布流', () => {
    const section = groupsEl.children[1];
    section.querySelector('.group-toggle').click();

    // 必须真的改变布局指纹，否则会被 resize 防抖守卫跳过
    window.innerWidth = 700;
    fire('resize');
    flush();
    window.innerWidth = 1280;
    fire('resize');
    flush();

    const rebuilt = registry.get('groups').children[1];
    eq(rebuilt.classList.contains('is-collapsed'), true, '折叠状态');
    eq(rebuilt.querySelector('.masonry').childElementCount, 0, '折叠分组的瀑布流');
    rebuilt.querySelector('.group-toggle').click();
    expectSpread(sectionCards(rebuilt), '决策 展开后');
  });

  check('点击 chip 会展开目标分组', () => {
    const section = groupsEl.children[3];
    section.querySelector('.group-toggle').click();
    navEl.children[3].click();
    eq(section.classList.contains('is-collapsed'), false);
  });

  check('滚动高亮当前分组，两处导航联动', () => {
    groupsEl.children.forEach((s, i) => { s._top = 400 - i * 100; });
    fire('scroll');
    flush();
    eq(navEl.children.map((c) => c.classList.contains('is-current')),
      [false, false, false, false, true]);
    eq(sidebarEl.children[5].classList.contains('is-current'), true, '侧边栏联动');
  });

  check('布局未变化时 resize 不重建列表', () => {
    const before = groupsEl.children.map((s) => s._uid);
    fire('resize');
    flush();
    eq(groupsEl.children.map((s) => s._uid), before, '列数没变却重建了');
  });

  check('布局变化时 resize 才重建', () => {
    const before = groupsEl.children.map((s) => s._uid);
    window.innerWidth = 700;
    fire('resize');
    flush();
    window.innerWidth = 1280;
    fire('resize');
    flush();
    ok(groupsEl.children.map((s) => s._uid).join() !== before.join(), '列数变了却没重建');
  });

  check('文档不够长时给末尾补滚动余量', () => {
    // 末尾分组滚不到吸顶位，scrollTo 会被静默钳制——点击看起来就是"没反应"
    document.documentElement.scrollHeight = 500;
    global.__inner.fitScrollTail();
    const pad = parseInt(groupsEl.style.paddingBottom, 10);
    ok(pad > 0, '末尾缺口没补上，实际 paddingBottom=' + groupsEl.style.paddingBottom);
  });

  check('文档够长时不补多余空白', () => {
    document.documentElement.scrollHeight = 5000;
    global.__inner.fitScrollTail();
    eq(groupsEl.style.paddingBottom, '0px');
  });

  check('切到 Skills 走平铺，分列仍正确', () => {
    navItems[1].click();
    const flat = registry.get('groups').children[0];
    eq(flat.classList.contains('masonry'), true);
    eq(navEl.hidden, true);
    eq(sidebarEl.hidden, true);
    expectSpread(flat.children.map((c) => c.querySelectorAll('.card').length), 'Skills');
  });

  check('切回 Prompts 恢复分组', () => {
    navItems[0].click();
    eq(registry.get('groups').children.length, 5);
    eq(navEl.hidden, false);
  });

  process.stdout.write(JSON.stringify({ checks: checks, info: info }));
}, 60);
flush();
