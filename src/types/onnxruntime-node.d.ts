/* eslint-disable no-unused-vars */
declare module 'onnxruntime-node' {
  export interface Tensor {
    readonly type: string;
    readonly data: Float32Array | Int32Array | BigInt64Array | Uint8Array;
    readonly dims: readonly number[];
    dispose(): void;
  }

  interface TensorConstructor {
    new (type: string, data: ArrayLike<number> | BigInt64Array, dims: readonly number[]): Tensor;
  }

  export const Tensor: TensorConstructor;

  export interface InferenceSession {
    run(feeds: Record<string, Tensor>): Promise<Record<string, Tensor>>;
    dispose(): Promise<void>;
  }

  interface InferenceSessionFactory {
    create(path: string): Promise<InferenceSession>;
  }

  export const InferenceSession: InferenceSessionFactory;
}
