'use strict';

const collator = new Intl.Collator('zh');

// 分组配色：从固定色板里按分类名取色，避免随机色相撞出刺眼的颜色
const GROUP_HUES = [212, 258, 174, 340, 22, 140, 196, 288];

// 卡片之间的垂直间距，与 style.css 中 .masonry-col 的 gap 保持一致
const CARD_GAP = 16;

const state = {
  view: 'prompts',
  query: '',
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
// 当前弹窗对应的深链；关闭时只在 hash 仍是它时清空，避免覆盖用户手动改过的地址
let openedHash = '';
let scrollTicking = false;
// 分组标题吸顶后离视口顶部的距离，render 时测量一次，滚动时直接用
let stickyTop = 0;
// 上次渲染时的布局指纹，用于判断 resize 是否真的需要重建列表
let layoutKey = '';

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

// 列数与抽屉断点共同决定布局；只有这两者变了才值得重建整个列表
function layoutKeyOf() {
  return columnCount() + '|' + (isDrawer() ? 'drawer' : 'wide');
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
  if (!items.length) return;

  const cards = items.map(createCard);

  // 先把卡片全部放进第一列，让浏览器只做一次布局，再统一读取每张卡的高度。
  // 原来的写法每插一张卡就读一次 offsetHeight，会触发 N 次强制重排；卡片多了会明显卡顿。
  cards.forEach((card) => columns[0].appendChild(card));
  const heights = cards.map((card) => card.offsetHeight);

  // 清空后按累计高度重新分配到最短列；分列过程中不再读取布局。
  columns.forEach((col) => { col.innerHTML = ''; });
  const totals = columns.map(() => 0);

  cards.forEach((card, index) => {
    let shortest = 0;
    for (let i = 1; i < totals.length; i += 1) {
      if (totals[i] < totals[shortest]) shortest = i;
    }
    columns[shortest].appendChild(card);
    totals[shortest] += heights[index] + CARD_GAP;
  });
}

function createCard(item) {
  const card = document.createElement('article');
  card.className = 'card';

  const title = document.createElement('h4');
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

function renderNoResults() {
  renderState(
    createStatePanel(
      '没有匹配的内容',
      '换个关键词试试。搜索范围包括标题、分类、简介和正文。'
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

// 搜索范围：标题、分类、简介和正文；空查询表示不过滤。
function matchesQuery(item, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const haystack = [item.title, item.category, item.intro, item.body || '']
    .join('\n')
    .toLowerCase();
  return haystack.indexOf(needle) !== -1;
}

function filterItems(items, query) {
  if (!query.trim()) return items;
  return items.filter((item) => matchesQuery(item, query));
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
    // groups 里的条目已经按「分类、标题」排好序，平铺时直接复用，避免再排一次
    renderMasonry(flat, groups.length ? groups[0].items : []);
    stickyTop = 0;
    fitScrollTail();
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

    // 标题包在 h3 里：button 的内容模型只允许短语内容，塞不进 h3，
    // 所以反过来让 h3 包 button——既是可聚焦的折叠控件，又保留标题语义
    const heading = document.createElement('h3');
    heading.className = 'group-heading';
    heading.appendChild(toggle);
    header.appendChild(heading);

    const body = document.createElement('div');
    body.className = 'masonry';
    body.id = bodyId;
    body.hidden = collapsed;

    section.classList.toggle('is-collapsed', collapsed);
    section.append(header, body);
    container.appendChild(section);
    state.sections.set(group.key, section);

    // 必须等 section 挂进文档再建瀑布流：脱离文档的元素 offsetHeight 恒为 0，
    // 「放进最短列」会每轮都选中第 0 列，整组卡片堆成一列。
    // 折叠时同理不建（hidden 元素同样读不到高度），留到展开时补建。
    if (!collapsed) renderMasonry(body, group.items);
  });

  stickyTop = measureStickyTop();
  fitScrollTail();
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
  // 折叠/展开改变了文档高度，尾部余量要跟着重算，否则又滚不到位
  fitScrollTail();
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

// 跳转要求目标分组的标题能顶到吸顶线，但文档末尾没有余量时，最后几个分组在物理上
// 就滚不到那里——scrollTo 会被静默钳制到 maxScroll，点了跟没点一样。
// 这里按缺口补一段尾部空白：只在真的不够时补，内容本来就长的视口补 0。
function fitScrollTail() {
  const container = $('#groups');
  if (!container) return;

  container.style.paddingBottom = '0px';
  const sections = [...state.sections.values()];
  const last = sections[sections.length - 1];
  if (!last) return;

  const docTop = window.scrollY + last.getBoundingClientRect().top;
  const need =
    docTop - stickyTop - 8 + window.innerHeight - document.documentElement.scrollHeight;
  if (need > 0) container.style.paddingBottom = Math.ceil(need) + 'px';
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

  // 先把高亮落到被点的分类上，再交给滚动事件按位置校正
  syncActiveGroup(key);
}

function syncActiveGroup(forcedKey) {
  if (!state.sections.size) return;

  let activeKey = state.groups[0].key;

  if (forcedKey && state.sections.has(forcedKey)) {
    // 点击分类时直接用被点的那个，不等滚动结束再反推：末尾分组可能因为
    // 滚动被钳制而永远到不了吸顶线，反推会把高亮算到别的组上
    activeKey = forcedKey;
  } else {
    // +1 容差：scrollToGroup 正好停在 stickyTop + 8，亚像素误差会让刚滚到的
    // 分组差 0.x 像素而落选，高亮停在上一组
    const line = stickyTop + 8 + 1;
    state.sections.forEach((section, key) => {
      if (section.getBoundingClientRect().top <= line) activeKey = key;
    });
  }

  if (activeKey !== state.activeGroup) {
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

  const chip = state.chipEls.get(activeKey);
  if (chip) scrollChipIntoView(chip);
}

// 窄屏下分类横条会横向溢出，而滚动条是刻意隐藏的：当前 chip 可能整个落在可视区
// 之外，用户看不见自然也就点不到。高亮变化时把它横向带回可视区中央
function scrollChipIntoView(chip) {
  const nav = $('#group-nav');
  if (!nav || nav.scrollWidth <= nav.clientWidth + 1) return;

  const navRect = nav.getBoundingClientRect();
  const chipRect = chip.getBoundingClientRect();
  const delta =
    chipRect.left + chipRect.width / 2 - (navRect.left + navRect.width / 2);
  const max = nav.scrollWidth - nav.clientWidth;
  const target = Math.max(0, Math.min(nav.scrollLeft + delta, max));
  if (Math.abs(target - nav.scrollLeft) < 4) return;

  nav.scrollTo({ left: target, behavior: prefersReducedMotion() ? 'auto' : 'smooth' });
}

function render() {
  const allItems = state.data[state.view];
  const items = filterItems(allItems, state.query);
  const isPrompts = state.view === 'prompts';
  const title = isPrompts ? 'Prompts' : 'Skills';
  const groups = groupItems(items);
  const groupCount = isGrouped(groups) ? groups.length : 0;
  const searching = state.query.trim() !== '';

  $('#view-title').textContent = title;
  $('#view-count').textContent = searching
    ? items.length + ' 条匹配'
    : items.length + ' 条' + (groupCount ? ' · ' + groupCount + ' 个分类' : '');
  announce(
    title +
      (searching ? '，搜索“' + state.query.trim() + '”' : '') +
      '，共 ' +
      items.length +
      ' 条' +
      (groupCount ? '，' + groupCount + ' 个分类' : '')
  );

  renderGroupNavs(groups);

  layoutKey = layoutKeyOf();

  if (!items.length) {
    if (searching) renderNoResults();
    else renderEmpty();
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

const MARKDOWN_TAGS = [
  'p', 'br', 'strong', 'b', 'em', 'i', 'del', 's', 'code', 'pre', 'blockquote',
  'ul', 'ol', 'li', 'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'hr', 'a',
  'table', 'thead', 'tbody', 'tr', 'th', 'td', 'img',
];
const MARKDOWN_ATTRS = ['href', 'src', 'alt', 'title'];

// Markdown 正文最终会写进 innerHTML，必须经过白名单消毒。
// 本地 DOMPurify 缺失时返回 null，由调用方降级为纯文本，避免退回未消毒的渲染。
function sanitizeHtml(html) {
  if (typeof DOMPurify === 'undefined') return null;
  try {
    return DOMPurify.sanitize(html, {
      ALLOWED_TAGS: MARKDOWN_TAGS,
      ALLOWED_ATTR: MARKDOWN_ATTRS,
      FORBID_ATTR: ['style'],
      ALLOW_DATA_ATTR: false,
    });
  } catch (error) {
    return null;
  }
}

function appendMarkdown(el, text) {
  // 旧版 data.json 没有 body 字段时，marked 不会抛错而是渲染出 "undefined"，
  // 这里先兜底，避免把内部字段状态显示给用户。
  const source = text || '';
  try {
    const safe = sanitizeHtml(marked.parse(source));
    if (safe === null) {
      el.textContent = source;
      return;
    }
    el.innerHTML = safe;
  } catch (error) {
    el.textContent = source;
  }
}

function appendCopyButton(parent, text) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn btn-primary';
  btn.textContent = '复制原始 Markdown';
  let resetTimer = 0;
  btn.addEventListener('click', async () => {
    const ok = await copyText(text);
    btn.textContent = ok ? '已复制' : '复制失败';
    announce(ok ? '已复制原始 Markdown' : '复制失败，请手动选择文本复制');
    // 连续点击时清掉上一次的复位定时器，避免标签提前跳回默认文案
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      btn.textContent = '复制原始 Markdown';
    }, 1500);
  });
  parent.appendChild(btn);
}

// 单条内容的深链格式：#/prompts/<encodeURIComponent(id)> 或 #/skills/...
function itemHash(view, id) {
  return '#/' + view + '/' + encodeURIComponent(id);
}

function parseItemHash(hash) {
  const match = /^#\/(prompts|skills)\/(.+)$/.exec(hash || '');
  if (!match) return null;
  try {
    return { view: match[1], id: decodeURIComponent(match[2]) };
  } catch (error) {
    return null;
  }
}

function absoluteItemLink(hash) {
  const origin = window.location.origin || '';
  const path = window.location.pathname || '/';
  return origin + path + (window.location.search || '') + hash;
}

function setLocationHash(hash) {
  if (window.history && typeof window.history.replaceState === 'function') {
    const fallback = (window.location.pathname || '') + (window.location.search || '');
    window.history.replaceState(null, '', hash || fallback);
    return;
  }
  window.location.hash = hash || '';
}

function appendCopyLinkButton(parent, view, id) {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.className = 'btn';
  btn.textContent = '复制链接';
  let resetTimer = 0;
  btn.addEventListener('click', async () => {
    const ok = await copyText(absoluteItemLink(itemHash(view, id)));
    btn.textContent = ok ? '链接已复制' : '复制失败';
    announce(ok ? '已复制内容链接' : '复制失败，请手动复制地址栏链接');
    window.clearTimeout(resetTimer);
    resetTimer = window.setTimeout(() => {
      btn.textContent = '复制链接';
    }, 1500);
  });
  parent.appendChild(btn);
}

function openModal(item) {
  lastFocused = document.activeElement;
  openedHash = itemHash(state.view, item.id);
  setLocationHash(openedHash);
  $('#modal-title').textContent = item.title;

  const categoryEl = $('#modal-category');
  categoryEl.textContent = item.category ? item.category.split('/').join(' / ') : '';
  categoryEl.hidden = !item.category;

  const bodyEl = $('#modal-body');
  const actionsEl = $('#modal-actions');
  bodyEl.innerHTML = '';
  actionsEl.innerHTML = '';

  if (state.view === 'prompts') {
    appendMarkdown(bodyEl, item.body);
    appendCopyButton(actionsEl, item.body);
    appendCopyLinkButton(actionsEl, state.view, item.id);
  } else {
    const intro = document.createElement('p');
    intro.className = 'skill-intro';
    intro.textContent = item.intro || '';
    bodyEl.appendChild(intro);

    if (item.body && item.body.trim()) {
      const detail = document.createElement('div');
      detail.className = 'skill-detail';
      appendMarkdown(detail, item.body);
      bodyEl.appendChild(detail);
      appendCopyButton(actionsEl, item.body);
    }

    appendCopyLinkButton(actionsEl, state.view, item.id);

    if (item.url) {
      const githubBtn = document.createElement('a');
      githubBtn.className = 'btn btn-primary';
      githubBtn.href = item.url;
      githubBtn.target = '_blank';
      githubBtn.rel = 'noopener noreferrer';
      githubBtn.textContent = '打开 GitHub';
      actionsEl.appendChild(githubBtn);
    }
  }

  $('#modal').hidden = false;
  document.body.classList.add('modal-open');
  $('#modal-close').focus();
}

function hideModal() {
  if ($('#modal').hidden) return;

  $('#modal').hidden = true;
  document.body.classList.remove('modal-open');

  if (openedHash && window.location.hash === openedHash) {
    setLocationHash('');
  }
  openedHash = '';

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

function openHashTarget() {
  const target = parseItemHash(window.location.hash);
  if (!target || !state.data || !state.data[target.view]) return false;
  const item = state.data[target.view].find((entry) => entry.id === target.id);
  if (!item) return false;

  // 深链优先：清掉可能残留的搜索词，保证目标条目能被找到并展示
  state.query = '';
  const search = $('#search');
  if (search) search.value = '';

  if (state.view !== target.view) {
    selectView(target.view);
  } else {
    render();
  }
  openModal(item);
  return true;
}

function bindUI() {
  $('#menu-toggle').addEventListener('click', () => setDrawer(true));
  $('#sidebar-close').addEventListener('click', () => setDrawer(false));
  $('#scrim').addEventListener('click', () => setDrawer(false));
  $('#modal-close').addEventListener('click', hideModal);
  $('#modal').addEventListener('click', (event) => {
    if (event.target === event.currentTarget) hideModal();
  });

  let searchTimer = 0;
  $('#search').addEventListener('input', (event) => {
    const value = event.target.value;
    window.clearTimeout(searchTimer);
    searchTimer = window.setTimeout(() => {
      state.query = value;
      render();
    }, 120);
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

      // 移动端地址栏收放、软键盘弹起都会触发 resize，但列数与抽屉断点都没变。
      // 这时重建整个列表只会造成跳动并丢掉焦点，因此只在布局真的变了时才重建
      if (state.data && layoutKeyOf() !== layoutKey) {
        render();
      } else {
        // 列数没变但视口高度变了，尾部余量得按新高度重算
        fitScrollTail();
      }
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
    if (!openHashTarget()) render();
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
