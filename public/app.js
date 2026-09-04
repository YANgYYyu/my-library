'use strict';

const collator = new Intl.Collator('zh');

// 分组配色：从固定色板里按分类名取色，避免随机色相撞出刺眼的颜色
const GROUP_HUES = [212, 258, 174, 340, 22, 140, 196, 288];

const state = {
  view: 'prompts',
  data: null,
  groups: [],
  sections: new Map(),
  chipEls: new Map(),
  navEls: new Map(),
  activeGroup: null,
  collapsed: { prompts: new Set(), skills: new Set() },
};

// 弹窗关闭后要把焦点还回去的元素
let lastFocused = null;
let scrollTicking = false;
// 分组标题吸顶后离视口顶部的距离，render 时测量一次，滚动时直接用
let stickyTop = 0;

const FOCUSABLE = 'a[href], button:not([disabled]), [tabindex]:not([tabindex="-1"])';

function $(selector) {
  return document.querySelector(selector);
}

function isDrawer() {
  return window.matchMedia('(max-width: 767px)').matches;
}

function prefersReducedMotion() {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function columnCount() {
  const width = window.innerWidth;
  if (width < 640) return 1;
  if (width < 1024) return 2;
  return 3;
}

function buildColumns(container) {
  container.innerHTML = '';

  const columns = Array.from({ length: columnCount() }, () => {
    const col = document.createElement('div');
    col.className = 'masonry-col';
    container.appendChild(col);
    return col;
  });
  return columns;
}

function renderMasonry(container, items) {
  const columns = buildColumns(container);

  items.forEach((item) => {
    let shortest = 0;
    let shortestHeight = Infinity;
    columns.forEach((col, index) => {
      if (col.offsetHeight < shortestHeight) {
        shortestHeight = col.offsetHeight;
        shortest = index;
      }
    });
    columns[shortest].appendChild(createCard(item));
  });
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const title = document.createElement('h3');
  title.className = 'card-title';
  const link = document.createElement('button');
  link.type = 'button';
  link.className = 'card-link';
  link.textContent = item.title;
  link.addEventListener('click', () => openModal(item));
  title.appendChild(link);
  card.appendChild(title);

  if (item.intro) {
    const intro = document.createElement('p');
    intro.className = 'card-intro';
    intro.textContent = item.intro;
    card.appendChild(intro);
  }

  return card;
}

function createSkeleton() {
  const card = document.createElement('div');
  card.className = 'skeleton-card';

  const title = document.createElement('span');
  title.className = 'skeleton-line skeleton-title';

  const line = document.createElement('span');
  line.className = 'skeleton-line';

  const short = document.createElement('span');
  short.className = 'skeleton-line skeleton-short';

  card.append(title, line, short);
  return card;
}

function renderSkeleton() {
  const container = $('#groups');
  buildColumns(container).forEach((col) => {
    col.append(createSkeleton(), createSkeleton());
  });
}

function createStatePanel(titleText, descText) {
  const panel = document.createElement('div');
  panel.className = 'state-panel';

  const title = document.createElement('p');
  title.className = 'state-title';
  title.textContent = titleText;

  const desc = document.createElement('p');
  desc.className = 'state-desc';
  desc.textContent = descText;

  panel.append(title, desc);
  return panel;
}

function renderState(panel) {
  clearGroupNavs();
  const container = $('#groups');
  container.innerHTML = '';
  container.appendChild(panel);
}

function renderEmpty() {
  renderState(
    createStatePanel(
      '暂无内容',
      '这个列表还没有条目。在 content 目录下添加 Markdown 文件后，运行 python3 build.py 重新构建即可。'
    )
  );
}

function errorHint(error) {
  if (window.location.protocol === 'file:') {
    return 'file:// 模式无法读取 data.json，请通过 HTTP 访问：在项目目录运行 bash scripts/restart.sh，再打开 http://localhost:8001';
  }
  if (error.message.indexOf('404') !== -1) {
    return 'data.json 不存在，请先在项目目录运行 python3 build.py 生成数据';
  }
  return error.message;
}

function renderError(error) {
  const hint = errorHint(error);
  const panel = createStatePanel('数据加载失败', hint);

  const retry = document.createElement('button');
  retry.type = 'button';
  retry.className = 'btn btn-primary';
  retry.textContent = '重试';
  retry.addEventListener('click', async () => {
    retry.disabled = true;
    retry.textContent = '重试中…';
    // 重试成功后焦点留在内容区，避免键盘用户被丢回页面顶部
    if (await load()) $('#groups').focus();
  });
  panel.appendChild(retry);

  renderState(panel);
  announce('数据加载失败：' + hint);
}

/* ---- 分组 ---- */

function hueFor(name, used) {
  let hash = 0;
  for (let i = 0; i < name.length; i += 1) {
    hash = (hash * 31 + name.charCodeAt(i)) % 100000;
  }

  // 色板只有 8 个色相，撞色时顺延到下一个没被占用的，避免相邻分组同色
  const start = hash % GROUP_HUES.length;
  for (let step = 0; step < GROUP_HUES.length; step += 1) {
    const hue = GROUP_HUES[(start + step) % GROUP_HUES.length];
    if (!used.has(hue)) {
      used.add(hue);
      return hue;
    }
  }
  return GROUP_HUES[start];
}

function groupItems(items) {
  const groups = [];
  const index = new Map();
  const usedHues = new Set();

  [...items].sort(compareItems).forEach((item) => {
    const key = item.category || '';
    if (!index.has(key)) {
      const group = {
        key: key,
        name: key ? key.split('/').join(' / ') : '未分类',
        items: [],
        hue: hueFor(key, usedHues),
      };
      index.set(key, group);
      groups.push(group);
    }
    index.get(key).items.push(item);
  });

  // 未分类排在最前（空字符串比较最小），只要还有别的分组就挪到末尾
  const emptyAt = groups.findIndex((group) => group.key === '');
  if (emptyAt !== -1 && groups.length > 1) groups.push(groups.splice(emptyAt, 1)[0]);

  return groups;
}

// 只有一种分类且它还是「未分类」时，不值得加分组标题
function isGrouped(groups) {
  return groups.length > 1 || (groups.length === 1 && groups[0].key !== '');
}

function clearGroupNavs() {
  state.groups = [];
  state.sections.clear();
  state.chipEls.clear();
  state.navEls.clear();
  state.activeGroup = null;

  const nav = $('#group-nav');
  nav.innerHTML = '';
  nav.hidden = true;

  const sidebar = $('#nav-groups');
  sidebar.innerHTML = '';
  sidebar.hidden = true;
}

function renderGroupNavs(groups) {
  clearGroupNavs();
  if (!isGrouped(groups)) return;

  state.groups = groups;

  const nav = $('#group-nav');
  const sidebar = $('#nav-groups');

  const title = document.createElement('p');
  title.className = 'nav-groups-title';
  title.textContent = '分类';
  sidebar.appendChild(title);

  groups.forEach((group) => {
    const chip = document.createElement('button');
    chip.type = 'button';
    chip.className = 'group-chip';
    chip.style.setProperty('--group-hue', group.hue);
    chip.title = group.name;

    const chipName = document.createElement('span');
    chipName.className = 'group-chip-name';
    chipName.textContent = group.name;

    const chipCount = document.createElement('span');
    chipCount.className = 'group-chip-count';
    chipCount.textContent = group.items.length;

    chip.append(chipName, chipCount);
    chip.addEventListener('click', () => scrollToGroup(group.key));
    nav.appendChild(chip);

    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'nav-subitem';
    item.style.setProperty('--group-hue', group.hue);
    item.title = group.name;

    const itemName = document.createElement('span');
    itemName.className = 'nav-subitem-name';
    itemName.textContent = group.name;

    const itemCount = document.createElement('span');
    itemCount.className = 'nav-subitem-count';
    itemCount.textContent = group.items.length;

    item.append(itemName, itemCount);
    item.addEventListener('click', () => {
      setDrawer(false);
      scrollToGroup(group.key);
    });
    sidebar.appendChild(item);

    state.chipEls.set(group.key, chip);
    state.navEls.set(group.key, item);
  });

  nav.hidden = false;
  sidebar.hidden = false;
}

function renderGroups(groups) {
  const container = $('#groups');
  container.innerHTML = '';

  if (!isGrouped(groups)) {
    const flat = document.createElement('div');
    flat.className = 'masonry';
    container.appendChild(flat);
    renderMasonry(flat, [...state.data[state.view]].sort(compareItems));
    stickyTop = 0;
    syncActiveGroup();
    return;
  }

  groups.forEach((group, order) => {
    const section = document.createElement('section');
    section.className = 'group';
    section.style.setProperty('--group-hue', group.hue);

    const header = document.createElement('header');
    header.className = 'group-header';

    const bodyId = 'group-body-' + order;
    const collapsed = state.collapsed[state.view].has(group.key);

    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'group-toggle';
    toggle.setAttribute('aria-expanded', String(!collapsed));
    toggle.setAttribute('aria-controls', bodyId);

    const chevron = document.createElement('span');
    chevron.className = 'group-chevron';
    chevron.setAttribute('aria-hidden', 'true');

    const name = document.createElement('span');
    name.className = 'group-name';
    name.textContent = group.name;

    const count = document.createElement('span');
    count.className = 'group-count';
    count.textContent = group.items.length + ' 条';

    toggle.append(chevron, name, count);
    toggle.addEventListener('click', () =>
      setCollapsed(group.key, !state.collapsed[state.view].has(group.key))
    );
    header.appendChild(toggle);

    // 折叠状态下不建瀑布流：元素不可见时读不到高度，会全塞进第一列
    const body = document.createElement('div');
    body.className = 'masonry';
    body.id = bodyId;
    body.hidden = collapsed;

    if (!collapsed) renderMasonry(body, group.items);

    section.classList.toggle('is-collapsed', collapsed);
    section.append(header, body);
    container.appendChild(section);
    state.sections.set(group.key, section);
  });

  stickyTop = measureStickyTop();
  syncActiveGroup();
}

function setCollapsed(key, collapsed) {
  const group = state.groups.find((item) => item.key === key);
  const section = state.sections.get(key);
  if (!group || !section) return;

  const marks = state.collapsed[state.view];
  if (collapsed) {
    marks.add(key);
  } else {
    marks.delete(key);
  }

  // 该分组唯一的 .masonry，就是折叠按钮 aria-controls 指向的容器
  const body = section.querySelector('.masonry');
  section.classList.toggle('is-collapsed', collapsed);
  section.querySelector('.group-toggle').setAttribute('aria-expanded', String(!collapsed));
  body.hidden = collapsed;

  if (!collapsed && !body.childElementCount) renderMasonry(body, group.items);
  syncActiveGroup();
}

// 分组标题吸顶的位置从渲染出的标题上读：桌面端落在分类横条下方、移动端落在汉堡
// 按钮下方，两种布局不必在 JS 里各写一遍断点
function measureStickyTop() {
  const section = state.sections.values().next().value;
  const header = section && section.querySelector('.group-header');
  if (!header) return 0;

  const top = parseFloat(window.getComputedStyle(header).top);
  return Number.isNaN(top) ? 0 : top;
}

function scrollToGroup(key) {
  const group = state.groups.find((item) => item.key === key);
  const section = state.sections.get(key);
  if (!group || !section) return;

  if (state.collapsed[state.view].has(key)) setCollapsed(key, false);

  const top = window.scrollY + section.getBoundingClientRect().top - stickyTop - 8;
  window.scrollTo({
    top: Math.max(top, 0),
    behavior: prefersReducedMotion() ? 'auto' : 'smooth',
  });
}

function syncActiveGroup() {
  if (!state.sections.size) return;

  let activeKey = state.groups[0].key;
  const doc = document.documentElement;
  const atBottom = window.innerHeight + window.scrollY >= doc.scrollHeight - 4;

  if (atBottom) {
    activeKey = state.groups[state.groups.length - 1].key;
  } else {
    const line = stickyTop + 8;
    state.sections.forEach((section, key) => {
      if (section.getBoundingClientRect().top <= line) activeKey = key;
    });
  }

  if (activeKey === state.activeGroup) return;
  state.activeGroup = activeKey;

  state.chipEls.forEach((el, key) => {
    const current = key === activeKey;
    el.classList.toggle('is-current', current);
    if (current) {
      el.setAttribute('aria-current', 'true');
    } else {
      el.removeAttribute('aria-current');
    }
  });
  state.navEls.forEach((el, key) => {
    el.classList.toggle('is-current', key === activeKey);
  });
}

function render() {
  const items = state.data[state.view];
  const isPrompts = state.view === 'prompts';
  const title = isPrompts ? 'Prompts' : 'Skills';
  const groups = groupItems(items);
  const groupCount = isGrouped(groups) ? groups.length : 0;

  $('#view-title').textContent = title;
  $('#view-count').textContent =
    items.length + ' 条' + (groupCount ? ' · ' + groupCount + ' 个分类' : '');
  announce(
    title + '，共 ' + items.length + ' 条' + (groupCount ? '，' + groupCount + ' 个分类' : '')
  );

  renderGroupNavs(groups);

  if (!items.length) {
    renderEmpty();
    return;
  }

  renderGroups(groups);
}

function compareItems(a, b) {
  const byCategory = collator.compare(a.category || '', b.category || '');
  return byCategory !== 0 ? byCategory : collator.compare(a.title, b.title);
}

function announce(message) {
  const status = $('#status');
  if (status.textContent === message) return;
  status.textContent = message;
}

function openModal(item) {
  lastFocused = document.activeElement;
  $('#modal-title').textContent = item.title;

  const categoryEl = $('#modal-category');
  categoryEl.textContent = item.category ? item.category.split('/').join(' / ') : '';
  categoryEl.hidden = !item.category;

  const bodyEl = $('#modal-body');
  const actionsEl = $('#modal-actions');
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';

  if (state.view === 'prompts') {
    try {
      bodyEl.innerHTML = marked.parse(item.body);
    } catch (error) {
      bodyEl.textContent = item.body;
    }

    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn btn-primary';
    copyBtn.textContent = '复制原始 Markdown';
    copyBtn.addEventListener('click', async () => {
      const ok = await copyText(item.body);
      copyBtn.textContent = ok ? '已复制' : '复制失败';
      announce(ok ? '已复制原始 Markdown' : '复制失败，请手动选择文本复制');
      window.setTimeout(() => {
        copyBtn.textContent = '复制原始 Markdown';
      }, 1500);
    });
    actionsEl.appendChild(copyBtn);
  } else {
    const intro = document.createElement('p');
    intro.className = 'skill-intro';
    intro.textContent = item.intro || '';
    bodyEl.appendChild(intro);

    const githubBtn = document.createElement('a');
    githubBtn.className = 'btn btn-primary';
    githubBtn.href = item.url;
    githubBtn.target = '_blank';
    githubBtn.rel = 'noopener noreferrer';
    githubBtn.textContent = '打开 GitHub';
    actionsEl.appendChild(githubBtn);
  }

  $('#modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
}

function hideModal() {
  if ($('#modal').hidden) return;

  $('#modal').hidden = true;
  document.body.classList.remove('modal-open');

  if (lastFocused && document.body.contains(lastFocused)) {
    lastFocused.focus();
  }
  lastFocused = null;
}

function trapFocus(event) {
  if (event.key !== 'Tab') return;

  const nodes = Array.from($('#modal-box').querySelectorAll(FOCUSABLE));
  if (!nodes.length) return;

  const first = nodes[0];
  const last = nodes[nodes.length - 1];

  if (event.shiftKey && document.activeElement === first) {
    event.preventDefault();
    last.focus();
  } else if (!event.shiftKey && document.activeElement === last) {
    event.preventDefault();
    first.focus();
  }
}

async function copyText(text) {
  if (navigator.clipboard && window.isSecureContext) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch (error) {
      // 降级到选中文本复制
    }
  }

  const textarea = document.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();

  let ok = false;
  try {
    ok = document.execCommand('copy');
  } catch (error) {
    ok = false;
  }
  textarea.remove();
  return ok;
}

function setDrawer(open) {
  const sidebar = $('#sidebar');
  const wasOpen = sidebar.classList.contains('is-open');

  sidebar.classList.toggle('is-open', open);
  $('#scrim').hidden = !open;
  document.body.classList.toggle('drawer-open', open);
  $('#menu-toggle').setAttribute('aria-expanded', String(open));

  if (!isDrawer() || wasOpen === open) return;
  if (open) {
    $('#sidebar-close').focus();
  } else {
    $('#menu-toggle').focus();
  }
}

function selectView(view) {
  state.view = view;
  document.querySelectorAll('.nav-item').forEach((item) => {
    const active = item.dataset.view === view;
    item.classList.toggle('is-active', active);
    if (active) {
      item.setAttribute('aria-current', 'page');
    } else {
      item.removeAttribute('aria-current');
    }
  });
  render();
  window.scrollTo({ top: 0, behavior: 'auto' });
  syncActiveGroup();
}

function bindUI() {
  $('#menu-toggle').addEventListener('click', () => setDrawer(true));
  $('#sidebar-close').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#modal-close').addEventListener('click', hideModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) hideModal();
  });

  document.querySelectorAll('.nav-item').forEach((button) => {
    button.addEventListener('click', () => {
      selectView(button.dataset.view);
      setDrawer(false);
    });
  });

  document.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') {
      hideModal();
      setDrawer(false);
      return;
    }
    if (!$('#modal').hidden) {
      trapFocus(event);
    }
  });

  window.addEventListener(
    'scroll',
    () => {
      if (scrollTicking) return;
      scrollTicking = true;
      window.requestAnimationFrame(() => {
        scrollTicking = false;
        syncActiveGroup();
      });
    },
    { passive: true }
  );

  let resizeTimer;
  window.addEventListener('resize', () => {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      if (!isDrawer() && $('#sidebar').classList.contains('is-open')) {
        setDrawer(false);
      }
      if (state.data) render();
    }, 150);
  });
}

async function fetchData() {
  const response = await fetch('data.json');
  if (!response.ok) throw new Error('HTTP ' + response.status);
  return await response.json();
}

async function load() {
  const container = $('#groups');
  renderSkeleton();
  container.setAttribute('aria-busy', 'true');

  try {
    state.data = await fetchData();
    container.removeAttribute('aria-busy');
    render();
    return true;
  } catch (error) {
    container.removeAttribute('aria-busy');
    renderError(error);
    return false;
  }
}

async function init() {
  bindUI();
  await load();
}

init();
