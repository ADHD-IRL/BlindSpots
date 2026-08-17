export * from './model/types.ts';
export * from './model/key.ts';
export * from './cassette/types.ts';
export * from './cassette/library.ts';
export * from './transport/recorded.ts';
export * from './transport/recording.ts';
// `./transport/anthropic.ts` is deliberately NOT re-exported here. It is the one module that
// opens a network connection to a model, and importing the package should not pull it in:
// `import { RecordedTransport } from '@mae/runtime'` is the offline path, and it stays
// offline. Import the live transport explicitly, from '@mae/runtime/transport/anthropic.ts'.
export * from './persona/brief.ts';
export * from './persona/parse.ts';
export * from './persona/run.ts';
