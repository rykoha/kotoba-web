// Manga Reader pages: the learner's own manga pages, kept in this browser only (IndexedDB). They are never part of
// progress, sync or an export code, and nothing here is sent anywhere: the site is public, so pages the learner
// imports must stay on their device.
//
// books: { id, title, at (ms created), pages: [page id], last (index of the page last read) }
// pages: { id, book, blob (the image), w, h, bubbles: [{ id, x, y, w, h (0-1, share of the page), text, at }] }

const DB_NAME = 'kotobaBeat.manga';
/** Longest side a page is kept at: plenty for reading small furigana, without filling the phone. */
export const MAX_SIDE = 2400;

let dbp = null;
function db() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => {
        const d = req.result;
        if (!d.objectStoreNames.contains('books')) d.createObjectStore('books', { keyPath: 'id' });
        if (!d.objectStoreNames.contains('pages')) d.createObjectStore('pages', { keyPath: 'id' }).createIndex('book', 'book');
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}

const done = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
async function tx(stores, mode, fn) {
  const d = await db();
  const t = d.transaction(stores, mode);
  const out = await fn(...[].concat(stores).map((s) => t.objectStore(s)));
  await new Promise((resolve, reject) => { t.oncomplete = resolve; t.onerror = () => reject(t.error); t.onabort = () => reject(t.error); });
  return out;
}

const newId = (p) => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

/** Every book, newest first. */
export async function listBooks() {
  const books = await tx('books', 'readonly', (b) => done(b.getAll()));
  return books.sort((a, b) => b.at - a.at);
}
export const getBook = (id) => tx('books', 'readonly', (b) => done(b.get(id)));

export async function addBook(title) {
  const book = { id: newId('b'), title: String(title || 'My manga').trim().slice(0, 60) || 'My manga', at: Date.now(), pages: [], last: 0 };
  await tx('books', 'readwrite', (b) => done(b.put(book)));
  return book;
}

/** Saves changes to a book (title, page order, last page read). */
export const saveBook = (book) => tx('books', 'readwrite', (b) => done(b.put(book)));

export async function deleteBook(id) {
  await tx(['books', 'pages'], 'readwrite', async (b, p) => {
    const keys = await done(p.index('book').getAllKeys(id));
    for (const k of keys) p.delete(k);
    b.delete(id);
  });
}

export const getPage = (id) => tx('pages', 'readonly', (p) => done(p.get(id)));
export const savePage = (page) => tx('pages', 'readwrite', (p) => done(p.put(page)));

/** Removes one page from its book. */
export async function deletePage(book, pageId) {
  book.pages = book.pages.filter((x) => x !== pageId);
  book.last = Math.max(0, Math.min(book.last, book.pages.length - 1));
  await tx(['books', 'pages'], 'readwrite', (b, p) => { p.delete(pageId); return done(b.put(book)); });
}

/** A picture file made ready to keep: shrunk if it's bigger than MAX_SIDE. Resolves { blob, w, h }. */
export async function preparePicture(file) {
  const bmp = await createImageBitmap(file);
  const { width: w0, height: h0 } = bmp;
  const scale = Math.min(1, MAX_SIDE / Math.max(w0, h0));
  if (scale === 1) { bmp.close && bmp.close(); return { blob: file, w: w0, h: h0 }; }
  const w = Math.round(w0 * scale), h = Math.round(h0 * scale);
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const g = c.getContext('2d');
  g.imageSmoothingQuality = 'high';
  g.drawImage(bmp, 0, 0, w, h);
  bmp.close && bmp.close();
  const blob = await new Promise((resolve) => c.toBlob(resolve, 'image/jpeg', 0.9));
  return { blob, w, h };
}

/**
 * Adds picture files to the end of a book, in the order given (file names sorted, so page_01, page_02… stay in
 * order). Files that aren't pictures are skipped. Returns how many pages were added.
 */
export async function addPages(book, files) {
  const pics = [...files].filter((f) => f && /^image\//.test(f.type))
    .sort((a, b) => (a.name || '').localeCompare(b.name || '', undefined, { numeric: true }));
  let n = 0;
  for (const f of pics) {
    let pic;
    try { pic = await preparePicture(f); } catch (e) { continue; }
    const page = { id: newId('p'), book: book.id, blob: pic.blob, w: pic.w, h: pic.h, bubbles: [] };
    book.pages.push(page.id);
    await tx(['books', 'pages'], 'readwrite', (b, p) => { p.put(page); return done(b.put(book)); });
    n += 1;
  }
  return n;
}

/** Roughly how much this browser lets the site keep, and how much is used: { used, quota } in bytes, or null. */
export async function storageUse() {
  try { const e = await navigator.storage.estimate(); return { used: e.usage || 0, quota: e.quota || 0 }; } catch (e) { return null; }
}

/** Asks the browser to keep the pages even when the device runs low on space (where it supports that). */
export async function keepPages() {
  try { return navigator.storage && navigator.storage.persist ? await navigator.storage.persist() : false; } catch (e) { return false; }
}

export { newId };
