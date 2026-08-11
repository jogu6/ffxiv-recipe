(function initShareContentModel(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.ShareContentModel = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createShareContentModelApi() {
  'use strict';

  const FOOTER_TEXT = '© SQUARE ENIX / X: @ff14_recipe';
  const TEXT_BLOCK_BREAK = '\uE000';
  const INVALID_FILE_CHARS = /[\\/:*?"<>|]/g;
  const TEXT_BLOCK_TAGS = new Set([
    'ADDRESS', 'ARTICLE', 'ASIDE', 'BLOCKQUOTE', 'DD', 'DETAILS', 'DIV', 'DL', 'DT',
    'FIELDSET', 'FIGCAPTION', 'FIGURE', 'FOOTER', 'FORM', 'H1', 'H2', 'H3', 'H4',
    'H5', 'H6', 'HEADER', 'HR', 'LI', 'MAIN', 'NAV', 'OL', 'P', 'PRE', 'SECTION',
    'SUMMARY', 'TABLE', 'TBODY', 'TD', 'TFOOT', 'TH', 'THEAD', 'TR', 'UL'
  ]);

  function shareTitle({ panel, listMode, favoriteListName, selectedItem, resultViewMode, multipleFavoriteLists }) {
    if (panel === 'left') {
      if (listMode === 'equipment') return '装備検索結果';
      if (listMode === 'fav' && favoriteListName) return favoriteListName;
      return '検索結果';
    }
    if (panel === 'middle') return `${selectedItem || 'アイテム'}の作成先`;
    if (multipleFavoriteLists) return '複数お気に入りの素材リスト';
    return `${selectedItem || 'アイテム'}の${resultViewMode === 'materials' ? '素材リスト' : 'レシピツリー'}`;
  }

  function createSnapshot({ panel, title, sourceNode, headingLines = [], description = '' }) {
    if (!sourceNode?.cloneNode) throw new TypeError('共有元のDOMが必要です。');
    return Object.freeze({
      panel,
      title: String(title || ''),
      headingLines: headingLines.map(String),
      description: String(description || ''),
      content: sourceNode.cloneNode(true)
    });
  }

  function replaceControlWithMarker(control) {
    if (control.matches?.('input[type="checkbox"]')) {
      control.replaceWith(control.checked ? '☑' : '☐');
      return;
    }
    const text = control.textContent || '';
    const markers = ['💰🛒', '⏰', '🛒'].filter(marker => text.includes(marker));
    control.replaceWith(markers.join(''));
  }

  function treeNodeSiblings(node) {
    return [...(node.parentElement?.children || [])].filter(child => child.classList?.contains('tree-node'));
  }

  function treeNodeHasFollowingSibling(node) {
    const siblings = treeNodeSiblings(node);
    return siblings.indexOf(node) < siblings.length - 1;
  }

  function applyTreeTextBranches(clone) {
    const branchRows = [...clone.querySelectorAll('.share-panel-source-right .tree-node > .node-row[data-share-text-block]')];
    if (branchRows.length > 0) {
      clone.querySelector('.share-panel-source-right .result-root-summary .node-row[data-share-text-block]')
        ?.setAttribute('data-share-text-continuous', 'true');
    }
    branchRows.forEach(row => {
      const node = row.parentElement;
      const ancestors = [];
      for (let parent = node.parentElement?.closest('.tree-node'); parent; parent = parent.parentElement?.closest('.tree-node')) {
        ancestors.unshift(parent);
      }
      const prefix = `  ${ancestors.map(parent => treeNodeHasFollowingSibling(parent) ? '│  ' : '   ').join('')}`;
      const hasFollowing = treeNodeHasFollowingSibling(node);
      const lines = String(row.dataset.shareTextBlock || '').split(/\r?\n/u);
      const item = (lines.shift() || '').replace(/^・/u, '');
      const detailPrefix = `${prefix}${hasFollowing ? '│  ' : '   '}`;
      row.dataset.shareTextBlock = [
        `${prefix}${hasFollowing ? '├─' : '└─'} ${item}`,
        ...lines.map(line => `${detailPrefix}${line.trim()}`)
      ].join('\n');
      row.dataset.shareTextContinuous = 'true';
    });
  }

  function textLines(snapshot) {
    const clone = snapshot.content.cloneNode(true);
    clone.querySelectorAll('[hidden], [aria-hidden="true"], .hidden').forEach(node => node.remove());
    applyTreeTextBranches(clone);
    clone.querySelectorAll('[data-share-text-block]').forEach(node => {
      if (node.parentElement?.closest('[data-share-text-block]')) return;
      const block = clone.ownerDocument.createElement('div');
      const separator = node.dataset.shareTextContinuous === 'true' ? '' : `\n${TEXT_BLOCK_BREAK}`;
      block.textContent = `${node.dataset.shareTextBlock || ''}${separator}`;
      node.replaceWith(block);
    });
    clone.querySelectorAll('input, select, textarea, button, [role="button"]').forEach(replaceControlWithMarker);
    clone.querySelectorAll('[data-share-detail="omit"], .mini-tree, .mini-tree-btn, .shop-details, .gathering-details').forEach(node => node.remove());
    let raw = '';
    const appendBreak = () => {
      if (raw && !raw.endsWith('\n')) raw += '\n';
    };
    const visit = node => {
      if (node.nodeType === 3) {
        raw += node.nodeValue || '';
        return;
      }
      if (node.nodeType !== 1) return;
      if (node.tagName === 'BR') {
        appendBreak();
        return;
      }
      const block = TEXT_BLOCK_TAGS.has(node.tagName);
      if (block) appendBreak();
      node.childNodes.forEach(visit);
      if (block) appendBreak();
    };
    visit(clone);
    const lines = raw
      .split(/\r?\n/)
      .map(line => {
        if (line.trim() === TEXT_BLOCK_BREAK) return TEXT_BLOCK_BREAK;
        if (/^[ \t]*[│├└]/u.test(line)) return line.replace(/\t/gu, '  ').trimEnd();
        const indented = /^[ \t]+\S/u.test(line);
        const content = line.replace(/\s+/g, ' ').trim();
        return content && indented ? `  ${content}` : content;
      })
      .filter(Boolean);
    const result = [];
    lines.forEach(line => {
      if (line === TEXT_BLOCK_BREAK) {
        if (result.length > 0 && result.at(-1) !== '') result.push('');
      } else {
        result.push(line);
      }
    });
    while (result.at(-1) === '') result.pop();
    return result;
  }

  function toText(snapshot) {
    const heading = [snapshot.title, ...snapshot.headingLines, snapshot.description].filter(Boolean);
    const body = textLines(snapshot);
    return [...heading, ...(heading.length && body.length ? [''] : []), ...body, ...(body.length ? [''] : []), FOOTER_TEXT]
      .join('\n')
      .replace(/\n{3,}/g, '\n\n');
  }

  function timestampParts(date) {
    const parts = new Intl.DateTimeFormat('ja-JP', {
      timeZone: 'Asia/Tokyo',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23'
    }).formatToParts(date);
    const value = type => parts.find(part => part.type === type)?.value || '00';
    return `${value('year')}${value('month')}${value('day')}_${value('hour')}${value('minute')}${value('second')}`;
  }

  function pngFileName(title, date = new Date()) {
    const safeTitle = String(title || '共有画像').replace(INVALID_FILE_CHARS, '＿');
    return `${safeTitle}_${timestampParts(date)}.png`;
  }

  return Object.freeze({ FOOTER_TEXT, createSnapshot, pngFileName, shareTitle, textLines, toText });
});
