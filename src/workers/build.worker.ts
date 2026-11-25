/** Makes the models of what bugs build (see `render/gpu/buildModels.ts`); their arrays are transferred. */
import { buildModel, type Model } from '../render/gpu/buildModels';

export interface BuildReply {
  id: string;
  model: Model;
}

interface WorkerScope {
  onmessage: ((e: MessageEvent<string>) => void) | null;
  postMessage(message: BuildReply, transfer: Transferable[]): void;
}

const scope = self as unknown as WorkerScope;
scope.onmessage = (e) => {
  const model = buildModel(e.data);
  scope.postMessage({ id: e.data, model }, [model.position.buffer, model.normal.buffer, model.color.buffer, model.look.buffer, model.index.buffer]);
};
