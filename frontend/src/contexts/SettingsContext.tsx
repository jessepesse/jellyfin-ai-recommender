import { createContext, use, useState } from "react";
import type { ReactNode } from "react";
import type { Settings } from "../types";

interface SettingsContextType extends Settings {
  setJellyfinUrl: (url: string) => void;
  setApiKey: (key: string) => void;
}

const SettingsContext = createContext<SettingsContextType | undefined>(undefined);

export const SettingsProvider = ({ children }: { children: ReactNode }) => {
  const [jellyfinUrl, setJellyfinUrl] = useState<string>("");
  const [apiKey, setApiKey] = useState<string>("");

  return (
    <SettingsContext value={{ jellyfinUrl, setJellyfinUrl, apiKey, setApiKey }}>
      {children}
    </SettingsContext>
  );
};

// eslint-disable-next-line react-refresh/only-export-components
export const useSettings = () => {
  const context = use(SettingsContext);
  if (context === undefined) {
    throw new Error("useSettings must be used within a SettingsProvider");
  }
  return context;
};
