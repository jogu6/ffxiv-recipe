(function initFavoriteListFile(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FavoriteListFile = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createFavoriteListFileModule() {
  'use strict';

  function createFavoriteListFileCodec({
    title,
    separator,
    maxLists,
    itemNameForId,
    encodeFavoriteList,
    decodeFavoriteShareCode,
    normalizeName
  }) {
    const itemLines = itemIds => {
      const names = itemIds.map(itemNameForId).filter(Boolean);
      return names.length > 0 ? names.map(name => `・${name}`).join('\n') : '・（アイテムなし）';
    };
    const encodeBlock = list =>
      `【${list.name}】\n登録アイテム:\n${itemLines(list.itemIds)}\n\n復元コード:\n${encodeFavoriteList(list)}`;
    const encodeFile = lists =>
      `${title}\n\n${lists.map(encodeBlock).join(separator)}\n`;
    const decodeFile = source => {
      const normalized = String(source || '').replace(/\r\n?/g, '\n').trim();
      const prefix = `${title}\n\n`;
      if (!normalized.startsWith(prefix)) return null;
      const blocks = normalized.slice(prefix.length).split(separator);
      if (blocks.length === 0 || blocks.length > maxLists) return null;
      const names = new Set();
      const lists = [];
      for (const block of blocks) {
        const match = block.match(/^【(.+)】\n登録アイテム:\n([\s\S]+?)\n\n復元コード:\n(\S+)$/);
        if (!match) return null;
        const [, displayedName, displayedItems, shareCode] = match;
        const decoded = decodeFavoriteShareCode(shareCode);
        if (
          !decoded ||
          decoded.needsName ||
          normalizeName(displayedName) !== decoded.name ||
          displayedItems !== itemLines(decoded.itemIds) ||
          names.has(decoded.name)
        ) return null;
        names.add(decoded.name);
        lists.push(decoded);
      }
      return lists;
    };
    return Object.freeze({ decodeFile, encodeFile });
  }

  return Object.freeze({ createFavoriteListFileCodec });
});
