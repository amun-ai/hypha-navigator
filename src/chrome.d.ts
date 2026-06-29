// Minimal ambient declaration so the extension sources typecheck without
// pulling in @types/chrome. The MV3 surface we use is small and dynamic.
declare const chrome: any;
declare const __HYPHA_DEFAULT_SERVER__: string;
