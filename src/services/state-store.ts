import { Context, Effect, Layer } from "effect";
import type { PipelineState } from "../types.ts";
import { loadState, saveState, statePath } from "./state.ts";

export interface StateStoreShape {
  /** Absolute path of the persisted state file. */
  readonly path: string;
  load(): Effect.Effect<PipelineState, Error>;
  save(state: PipelineState): Effect.Effect<void>;
}

/** Persisted run state as a service, so the runner owns no file I/O. */
export class StateStore extends Context.Tag("bunsai/StateStore")<StateStore, StateStoreShape>() {}

export class FileStateStore implements StateStoreShape {
  readonly path: string;

  constructor(private readonly root: string) {
    this.path = statePath(root);
  }

  load(): Effect.Effect<PipelineState, Error> {
    const root = this.root;
    return Effect.try({
      try: () => loadState(root),
      catch: (err) => (err instanceof Error ? err : new Error(String(err))),
    });
  }

  save(state: PipelineState): Effect.Effect<void> {
    const root = this.root;
    return Effect.sync(() => saveState(root, state));
  }
}

export const stateStoreLayer = (root: string): Layer.Layer<StateStore> =>
  Layer.effect(StateStore, Effect.sync(() => new FileStateStore(root)));