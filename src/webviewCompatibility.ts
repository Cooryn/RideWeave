// Android 10 originally ships a WebView that predates these APIs.
// MapLibre uses both in its worker as well as in the main page.
if (!Array.prototype.at) {
  Object.defineProperty(Array.prototype, "at", {
    configurable: true,
    writable: true,
    value<T>(this: T[], index: number): T | undefined {
      const offset = Math.trunc(index) || 0;
      const position = offset < 0 ? this.length + offset : offset;
      return position >= 0 && position < this.length ? this[position] : undefined;
    },
  });
}

if (!Object.hasOwn) {
  Object.defineProperty(Object, "hasOwn", {
    configurable: true,
    writable: true,
    value: (object: object, key: PropertyKey) =>
      Object.prototype.hasOwnProperty.call(object, key),
  });
}
