/**
 * Façade over the server schemas so the client can `import { ... } from '@shared'`.
 * The client only ever imports types and pure values from here — never server runtime code.
 */
export * from '../../server/src/schemas/index';
