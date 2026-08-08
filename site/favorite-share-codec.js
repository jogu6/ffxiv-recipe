(function initFavoriteShareCodec(root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.FavoriteShareCodec = api;
})(typeof globalThis === 'undefined' ? this : globalThis, function createFavoriteShareCodecApi() {
  'use strict';

  function decodeBytesBase36(str) {
    if (str.length % 2 !== 0 || !/^[0-9A-Z]+$/.test(str)) return null;
    const bytes = [];
    for (let index = 0; index < str.length; index += 2) {
      const byte = parseInt(str.slice(index, index + 2), 36);
      if (!Number.isInteger(byte) || byte < 0 || byte > 255) return null;
      bytes.push(byte);
    }
    return new Uint8Array(bytes);
  }

  function encodeVarUint(value) {
    let remaining = Number(value);
    if (!Number.isSafeInteger(remaining) || remaining < 0) throw new RangeError('可変長整数の値が不正です');
    const bytes = [];
    do {
      let byte = remaining % 128;
      remaining = Math.floor(remaining / 128);
      if (remaining > 0) byte += 128;
      bytes.push(byte);
    } while (remaining > 0);
    return bytes;
  }

  function decodeVarUint(bytes, state) {
    let value = 0;
    let multiplier = 1;
    for (let count = 0; count < 8; count += 1) {
      if (state.offset >= bytes.length) throw new Error('可変長整数が途中で終了しました');
      const byte = bytes[state.offset];
      state.offset += 1;
      value += (byte & 0x7f) * multiplier;
      if ((byte & 0x80) === 0) {
        if (!Number.isSafeInteger(value)) throw new Error('可変長整数が大きすぎます');
        return value;
      }
      multiplier *= 128;
    }
    throw new Error('可変長整数が長すぎます');
  }

  function crc16Ccitt(bytes) {
    let crc = 0xffff;
    for (const byte of bytes) {
      crc ^= byte << 8;
      for (let bit = 0; bit < 8; bit += 1) {
        crc = (crc & 0x8000) !== 0 ? ((crc << 1) ^ 0x1021) & 0xffff : (crc << 1) & 0xffff;
      }
    }
    return crc;
  }

  function bytesToBase64Url(bytes) {
    let binary = '';
    for (let index = 0; index < bytes.length; index += 0x8000) {
      binary += String.fromCharCode(...bytes.subarray(index, index + 0x8000));
    }
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
  }

  function base64UrlToBytes(value) {
    if (!/^[A-Za-z0-9_-]+$/.test(value)) return null;
    const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (value.length % 4)) % 4);
    try {
      const binary = atob(padded);
      return Uint8Array.from(binary, character => character.charCodeAt(0));
    } catch {
      return null;
    }
  }

  function createCodec({
    normalizeName,
    normalizeItemIds,
    compactRecipeSelections,
    itemNameForId,
    itemIdForName,
    recipeNameForLegacyId,
    recipeVariantsForName
  }) {
    function encodeNameFavoriteList(list) {
      if (!list) return '';
      const nameBytes = new TextEncoder().encode(normalizeName(list.name));
      const itemNames = normalizeItemIds(list.itemIds).map(itemNameForId).filter(Boolean);
      const selections = compactRecipeSelections(list);
      const dictionary = [...new Set([...itemNames, ...selections.map(selection => selection.itemName)])].sort();
      const dictionaryIndex = new Map(dictionary.map((name, index) => [name, index]));
      const payload = [
        2,
        ...encodeVarUint(nameBytes.length),
        ...nameBytes,
        ...encodeVarUint(dictionary.length)
      ];
      let previousBytes = new Uint8Array();
      dictionary.forEach(name => {
        const bytes = new TextEncoder().encode(name);
        let prefixLength = 0;
        while (prefixLength < previousBytes.length && prefixLength < bytes.length && previousBytes[prefixLength] === bytes[prefixLength]) prefixLength += 1;
        while (prefixLength > 0 && (bytes[prefixLength] & 0xc0) === 0x80) prefixLength -= 1;
        const suffix = bytes.subarray(prefixLength);
        payload.push(...encodeVarUint(prefixLength), ...encodeVarUint(suffix.length), ...suffix);
        previousBytes = bytes;
      });
      payload.push(...encodeVarUint(itemNames.length));
      itemNames.forEach(name => payload.push(...encodeVarUint(dictionaryIndex.get(name))));
      payload.push(...encodeVarUint(selections.length));
      selections.forEach(selection => {
        payload.push(...encodeVarUint(dictionaryIndex.get(selection.itemName) * 8 + selection.craftType));
      });
      const checksum = crc16Ccitt(payload);
      return `N${bytesToBase64Url(Uint8Array.from([...payload, checksum >> 8, checksum & 0xff]))}`;
    }

    function encodeJsonFavoriteList(list) {
      const payload = {
        n: normalizeName(list?.name),
        i: normalizeItemIds(list?.itemIds).map(itemNameForId).filter(Boolean)
      };
      const bytes = new TextEncoder().encode(JSON.stringify(payload));
      return `Z${bytes.length.toString(36).toUpperCase().padStart(4, '0')}${[...bytes].map(byte => byte.toString(36).toUpperCase().padStart(2, '0')).join('')}`;
    }

    function encodeFavoriteList(list) {
      try {
        return encodeNameFavoriteList(list);
      } catch {
        return encodeJsonFavoriteList(list);
      }
    }

    function decodeOldFavorites(str) {
      if (!str || !/^[A-Z0-9]+$/.test(str) || str.length % 4 !== 0) return null;
      const names = [];
      for (let index = 0; index < str.length; index += 4) {
        const name = recipeNameForLegacyId(parseInt(str.slice(index, index + 4), 36));
        if (name) names.push(name);
      }
      return {
        name: '',
        itemIds: names.map(itemIdForName).filter(Boolean),
        recipeSelections: {},
        needsName: true
      };
    }

    function decodeNewFavoriteList(str) {
      if (!/^Z[0-9A-Z]+$/.test(str) || str.length < 5) return null;
      const length = parseInt(str.slice(1, 5), 36);
      if (!Number.isInteger(length) || length < 0) return null;
      const bytes = decodeBytesBase36(str.slice(5));
      if (!bytes || bytes.length !== length) return null;
      try {
        const payload = JSON.parse(new TextDecoder().decode(bytes));
        return {
          name: normalizeName(payload.n),
          itemIds: normalizeItemIds(payload.i).filter(id => itemNameForId(id)),
          recipeSelections: {},
          needsName: false
        };
      } catch {
        return null;
      }
    }

    function decodeCompactFavoriteList(str) {
      if (!str.startsWith('Y')) return null;
      const bytes = base64UrlToBytes(str.slice(1));
      if (!bytes || bytes.length < 5) return null;
      const payload = bytes.subarray(0, -2);
      const expectedChecksum = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
      if (crc16Ccitt(payload) !== expectedChecksum) return null;
      try {
        const state = { offset: 0 };
        const version = payload[state.offset];
        state.offset += 1;
        if (version !== 1) return null;
        const nameLength = decodeVarUint(payload, state);
        if (state.offset + nameLength > payload.length) return null;
        const name = normalizeName(new TextDecoder().decode(payload.subarray(state.offset, state.offset + nameLength)));
        state.offset += nameLength;
        const itemCount = decodeVarUint(payload, state);
        if (itemCount > 10000) return null;
        const itemIds = [];
        for (let index = 0; index < itemCount; index += 1) itemIds.push(decodeVarUint(payload, state));
        const selectionCount = decodeVarUint(payload, state);
        if (selectionCount > 10000) return null;
        const recipeSelections = {};
        let previousItemId = 0;
        for (let index = 0; index < selectionCount; index += 1) {
          const packed = decodeVarUint(payload, state);
          const craftType = packed % 8;
          const itemId = previousItemId + Math.floor(packed / 8);
          previousItemId = itemId;
          const matches = recipeVariantsForName(itemNameForId(itemId)).filter(
            variant => Number(variant.craftType) === craftType
          );
          if (matches.length === 1) recipeSelections[String(itemId)] = matches[0].recipeId;
        }
        if (state.offset !== payload.length) return null;
        return {
          name,
          itemIds: normalizeItemIds(itemIds).filter(id => itemNameForId(id)),
          recipeSelections,
          needsName: false
        };
      } catch {
        return null;
      }
    }

    function decodeNameFavoriteList(str) {
      if (!str.startsWith('N')) return null;
      const bytes = base64UrlToBytes(str.slice(1));
      if (!bytes || bytes.length < 5) return null;
      const payload = bytes.subarray(0, -2);
      const expectedChecksum = (bytes[bytes.length - 2] << 8) | bytes[bytes.length - 1];
      if (crc16Ccitt(payload) !== expectedChecksum) return null;
      try {
        const state = { offset: 0 };
        if (payload[state.offset++] !== 2) return null;
        const nameLength = decodeVarUint(payload, state);
        if (state.offset + nameLength > payload.length) return null;
        const name = normalizeName(new TextDecoder().decode(payload.subarray(state.offset, state.offset + nameLength)));
        state.offset += nameLength;
        const dictionaryCount = decodeVarUint(payload, state);
        if (dictionaryCount > 10000) return null;
        const dictionary = [];
        let previousBytes = new Uint8Array();
        for (let index = 0; index < dictionaryCount; index += 1) {
          const prefixLength = decodeVarUint(payload, state);
          const suffixLength = decodeVarUint(payload, state);
          if (prefixLength > previousBytes.length || state.offset + suffixLength > payload.length) return null;
          const entryBytes = new Uint8Array(prefixLength + suffixLength);
          entryBytes.set(previousBytes.subarray(0, prefixLength));
          entryBytes.set(payload.subarray(state.offset, state.offset + suffixLength), prefixLength);
          state.offset += suffixLength;
          const entry = new TextDecoder('utf-8', { fatal: true }).decode(entryBytes);
          if (!entry) return null;
          dictionary.push(entry);
          previousBytes = entryBytes;
        }
        const itemCount = decodeVarUint(payload, state);
        if (itemCount > 10000) return null;
        const itemIds = [];
        for (let index = 0; index < itemCount; index += 1) {
          const dictionaryId = decodeVarUint(payload, state);
          if (!dictionary[dictionaryId]) return null;
          itemIds.push(itemIdForName(dictionary[dictionaryId]));
        }
        const selectionCount = decodeVarUint(payload, state);
        if (selectionCount > 10000) return null;
        const recipeSelections = {};
        for (let index = 0; index < selectionCount; index += 1) {
          const packed = decodeVarUint(payload, state);
          const craftType = packed % 8;
          const itemName = dictionary[Math.floor(packed / 8)];
          if (!itemName) return null;
          const matches = recipeVariantsForName(itemName).filter(variant => Number(variant.craftType) === craftType);
          if (matches.length === 1) recipeSelections[String(itemIdForName(itemName))] = matches[0].recipeId;
        }
        if (state.offset !== payload.length) return null;
        return {
          name,
          itemIds: normalizeItemIds(itemIds).filter(id => itemNameForId(id)),
          recipeSelections,
          needsName: false
        };
      } catch {
        return null;
      }
    }

    function decodeFavoriteShareCode(value) {
      const source = String(value || '').trim();
      if (!source) return null;
      if (source.startsWith('N')) return decodeNameFavoriteList(source);
      if (source.startsWith('Y')) return decodeCompactFavoriteList(source);
      const legacy = source.toUpperCase();
      if (!/^[A-Z0-9]+$/.test(legacy)) return null;
      if (legacy.startsWith('Z')) return decodeNewFavoriteList(legacy);
      return decodeOldFavorites(legacy);
    }

    return Object.freeze({
      decodeFavoriteShareCode,
      encodeFavoriteList
    });
  }

  return Object.freeze({
    base64UrlToBytes,
    createCodec,
    crc16Ccitt,
    decodeBytesBase36,
    decodeVarUint,
    encodeVarUint
  });
});
