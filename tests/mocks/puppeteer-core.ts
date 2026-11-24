// puppeteer-core is ESM-only and Jest cannot load it on Node 22; tests mock browser behavior instead.
export class TimeoutError extends Error {}

const unavailable = (): never => {
  throw new Error('puppeteer-core is replaced by a stub in Jest; mock the call in the test');
};

export default { connect: unavailable, launch: unavailable };
