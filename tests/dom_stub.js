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
  // hideModal 会用它判断焦点该不该归还，缺了就只能靠肉眼验收弹窗关闭
  contains(node) { return node === this || this.descendants().includes(node); }
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
  const a = describe(actual);
  const b = describe(expected);
  if (a !== b) throw new Error((label ? label + '：' : '') + '期望 ' + b + '，实际 ' + a);
}
// 元素有 parent 反向引用，直接 stringify 会撞上循环结构，
// 把真实断言信息吞成一句「Converting circular structure to JSON」
function describe(value) {
  if (value && typeof value === 'object' && 'tagName' in value) {
    return value.tagName + (value.className ? '.' + value.className : '');
  }
  return JSON.stringify(value);
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

// 断言里的总量与分组数从数据推导，避免每次新增一条内容都要改测试：
// 真正要守住的是「分组条数之和等于总条数」「两处导航与分组数一致」这类结构关系。
const data = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'));

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
    const counts = groupsEl.children.map((s) =>
      Number(s.querySelector('.group-count').textContent.replace(' 条', '')));
    eq(counts.reduce((a, b) => a + b, 0), data.prompts.length, '分组条数之和等于条目总数');
    eq(navEl.children.length, counts.length, '横条导航项数等于分组数');
    eq(sidebarEl.children.length, counts.length + 1, '侧边栏为 1 个标题 + 各分组');
    eq(registry.get('view-count').textContent,
      data.prompts.length + ' 条 · ' + counts.length + ' 个分类');
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

  // Skills 有分类时走分组、全未分类时走平铺，两种形态都要保证分列正确
  check('切到 Skills 后分列仍正确', () => {
    navItems[1].click();
    const container = registry.get('groups');
    const first = container.children[0];
    if (first.classList.contains('group')) {
      eq(navEl.hidden, false, '有分类时展示分类导航');
      eq(sidebarEl.hidden, false);
      container.children.forEach((section) => {
        expectSpread(sectionCards(section),
          'Skills ' + section.querySelector('.group-name').textContent);
      });
    } else {
      eq(first.classList.contains('masonry'), true, '无分类时平铺');
      eq(navEl.hidden, true);
      eq(sidebarEl.hidden, true);
      expectSpread(first.children.map((c) => c.querySelectorAll('.card').length), 'Skills');
    }
  });

  check('切回 Prompts 恢复分组', () => {
    navItems[0].click();
    eq(registry.get('groups').children.length,
      new Set(data.prompts.map((p) => p.category)).size, '分组数等于分类数');
    eq(navEl.hidden, false);
  });

  // 弹窗此前完全没有被测试覆盖：渲染、复制、跳转按钮全靠肉眼验收，
  // skill 加上正文后分支更多（有/无正文、有/无链接），这里把四种组合固化下来。
  const modalEl = registry.get('modal');
  const bodyEl = registry.get('modal-body');
  const actionsEl = registry.get('modal-actions');
  const openCard = (view, title) => {
    navItems[view === 'prompts' ? 0 : 1].click();
    const link = groupsEl.querySelectorAll('.card-link').find((b) => b.textContent === title);
    ok(link, '找到卡片 ' + title);
    link.click();
  };
  const closeModal = () => registry.get('modal-close').click();
  const actionTexts = () => actionsEl.children.map((c) => c.textContent);
  // 桩里的 marked 写 innerHTML，降级分支写 textContent，两条通道都要认
  const hasContent = (el) => ((el && (el.innerHTML || el.textContent)) || '').length > 0;

  check('弹窗：Prompt 渲染正文并给出复制按钮', () => {
    openCard('prompts', '第一性原理');
    eq(modalEl.hidden, false, '弹窗已打开');
    ok(hasContent(bodyEl), '正文已渲染');
    eq(actionTexts(), ['复制原始 Markdown']);
    closeModal();
    eq(modalEl.hidden, true, '弹窗已关闭');
  });

  check('弹窗：Skill 渲染简介与正文，并给出复制与跳转', () => {
    openCard('skills', 'grill-me');
    ok(hasContent(bodyEl.querySelector('.skill-intro')), '显示简介');
    ok(hasContent(bodyEl.querySelector('.skill-detail')), '显示正文');
    eq(actionTexts(), ['复制原始 Markdown', '打开 GitHub']);
    closeModal();
  });

  // 下面两种形态取决于数据里有没有对应条目，没有就跳过；
  // 将来加入无链接或无正文的 skill，这些断言会自动开始生效。
  check('弹窗：无上游链接的 skill 不给跳转按钮（无对应数据时跳过）', () => {
    const item = data.skills.find((s) => !s.url && s.body && s.body.trim());
    if (!item) return;
    openCard('skills', item.title);
    eq(actionTexts(), ['复制原始 Markdown'], '无链接时不给跳转按钮');
    closeModal();
  });

  check('弹窗：无正文的 skill 不渲染正文区（无对应数据时跳过）', () => {
    const item = data.skills.find((s) => !s.body || !s.body.trim());
    if (!item) return;
    openCard('skills', item.title);
    eq(bodyEl.querySelector('.skill-detail'), null);
    eq(actionTexts(), item.url ? ['打开 GitHub'] : []);
    closeModal();
  });

  process.stdout.write(JSON.stringify({ checks: checks, info: info }));
}, 60);
flush();
