export {};

declare global {
  interface Window {
    stylingDesktop?: {
      chooseWardrobeFolder(): Promise<string | null>;
      getCodexCliPreference(): Promise<{
        mode: "auto" | "manual";
        path: string;
      }>;
      chooseCodexCli(): Promise<{
        mode: "manual";
        path: string;
      } | null>;
      useAutoCodexCli(): Promise<{
        mode: "auto";
        path: string;
      }>;
      saveGeneratedImage(
        sourcePath: string,
        suggestedName: string,
      ): Promise<string | null>;
    };
  }
}
