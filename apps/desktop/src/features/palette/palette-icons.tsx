import { FileInput, FolderOpen, KeyRound, PanelLeft, Plus, Settings, SquareCode, SquareTerminal, Waypoints } from "lucide-react";

export const paletteIcons = {
  newHost: <Plus size={14} />,
  newLocal: <SquareTerminal size={14} />,
  importConfig: <FileInput size={14} />,
  keychain: <KeyRound size={14} />,
  forwards: <Waypoints size={14} />,
  snippets: <SquareCode size={14} />,
  sidebar: <PanelLeft size={14} />,
  settings: <Settings size={14} />,
  logs: <FolderOpen size={14} />,
};
