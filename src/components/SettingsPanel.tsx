import { useEffect, useState } from "react";
import { Settings, Plus, Trash2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Separator } from "@/components/ui/separator";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetFooter,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { toast } from "@/hooks/use-toast";

export interface IceServerConfig {
  urls: string;
  username?: string;
  credential?: string;
}

export interface JanusConfig {
  signalingUrl: string;
  videoroomRoom: number;
  iceServers: IceServerConfig[];
}

export const DEFAULT_CONFIG: JanusConfig = {
  signalingUrl: "wss://your-janus-server.example.com",
  videoroomRoom: 1234,
  iceServers: [{ urls: "stun:stun.l.google.com:19302" }],
};

const STORAGE_KEY = "secureview.janus.config";

export function loadConfig(): JanusConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      console.log("[Settings] No saved config — using DEFAULT (example URL)");
      return DEFAULT_CONFIG;
    }
    const parsed = JSON.parse(raw) as Partial<JanusConfig>;
    const result = {
      signalingUrl: parsed.signalingUrl || DEFAULT_CONFIG.signalingUrl,
      videoroomRoom:
        typeof parsed.videoroomRoom === "number"
          ? parsed.videoroomRoom
          : DEFAULT_CONFIG.videoroomRoom,
      iceServers:
        Array.isArray(parsed.iceServers) && parsed.iceServers.length > 0
          ? parsed.iceServers
          : DEFAULT_CONFIG.iceServers,
    };
    console.log("[Settings] Loaded config from localStorage:", result);
    return result;
  } catch (err) {
    console.warn("[Settings] Failed to parse saved config, using default:", err);
    return DEFAULT_CONFIG;
  }
}

interface SettingsPanelProps {
  config: JanusConfig;
  onSave: (config: JanusConfig) => void;
}

export function SettingsPanel({ config, onSave }: SettingsPanelProps) {
  const [open, setOpen] = useState(false);
  const [url, setUrl] = useState(config.signalingUrl);
  const [room, setRoom] = useState(String(config.videoroomRoom));
  const [iceServers, setIceServers] = useState<IceServerConfig[]>(config.iceServers);

  useEffect(() => {
    if (open) {
      setUrl(config.signalingUrl);
      setRoom(String(config.videoroomRoom));
      setIceServers(config.iceServers);
    }
  }, [open, config]);

  const updateIce = (idx: number, patch: Partial<IceServerConfig>) => {
    setIceServers((prev) => prev.map((s, i) => (i === idx ? { ...s, ...patch } : s)));
  };

  const addIce = () => setIceServers((prev) => [...prev, { urls: "" }]);
  const removeIce = (idx: number) =>
    setIceServers((prev) => prev.filter((_, i) => i !== idx));

  const handleSave = () => {
    const roomNum = Number(room);
    if (!url.trim() || !/^wss?:\/\//i.test(url.trim())) {
      toast({
        title: "Invalid signaling URL",
        description: "URL must start with ws:// or wss://",
        variant: "destructive",
      });
      return;
    }
    if (!Number.isInteger(roomNum) || roomNum <= 0) {
      toast({
        title: "Invalid room ID",
        description: "Room ID must be a positive integer.",
        variant: "destructive",
      });
      return;
    }

    const cleaned: IceServerConfig[] = [];
    for (const s of iceServers) {
      const u = s.urls.trim();
      if (!u) continue;
      if (!/^(stun|stuns|turn|turns):/i.test(u)) {
        toast({
          title: "Invalid ICE server URL",
          description: `"${u}" must start with stun:, stuns:, turn:, or turns:`,
          variant: "destructive",
        });
        return;
      }
      const entry: IceServerConfig = { urls: u };
      if (s.username?.trim()) entry.username = s.username.trim();
      if (s.credential?.trim()) entry.credential = s.credential.trim();
      cleaned.push(entry);
    }
    if (cleaned.length === 0) {
      toast({
        title: "No ICE servers",
        description: "Add at least one STUN or TURN server.",
        variant: "destructive",
      });
      return;
    }

    const next: JanusConfig = {
      signalingUrl: url.trim(),
      videoroomRoom: roomNum,
      iceServers: cleaned,
    };
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    onSave(next);
    setOpen(false);
    toast({
      title: "Settings saved",
      description: "Reconnecting with new configuration…",
    });
  };

  return (
    <Sheet open={open} onOpenChange={setOpen}>
      <SheetTrigger asChild>
        <Button
          variant="ghost"
          size="icon"
          aria-label="Open settings"
          className="text-muted-foreground hover:text-foreground"
        >
          <Settings className="h-4 w-4" />
        </Button>
      </SheetTrigger>
      <SheetContent className="glass-surface overflow-y-auto">
        <SheetHeader>
          <SheetTitle className="font-mono uppercase tracking-wider text-sm">
            Connection Settings
          </SheetTitle>
          <SheetDescription>
            Configure the Janus signaling server, videoroom, and ICE servers.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 py-6">
          <div className="flex flex-col gap-2">
            <Label htmlFor="signaling-url" className="font-mono text-xs uppercase tracking-wider">
              Signaling URL
            </Label>
            <Input
              id="signaling-url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="wss://janus.example.com"
              className="font-mono text-sm"
            />
          </div>

          <div className="flex flex-col gap-2">
            <Label htmlFor="room-id" className="font-mono text-xs uppercase tracking-wider">
              Videoroom ID
            </Label>
            <Input
              id="room-id"
              type="number"
              value={room}
              onChange={(e) => setRoom(e.target.value)}
              placeholder="1234"
              className="font-mono text-sm"
            />
          </div>

          <Separator />

          <div className="flex items-center justify-between">
            <Label className="font-mono text-xs uppercase tracking-wider">
              ICE Servers (STUN / TURN)
            </Label>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={addIce}
              className="h-7 gap-1"
            >
              <Plus className="h-3 w-3" />
              Add
            </Button>
          </div>

          <div className="flex flex-col gap-3">
            {iceServers.map((server, idx) => {
              const isTurn = /^turns?:/i.test(server.urls);
              return (
                <div
                  key={idx}
                  className="flex flex-col gap-2 rounded-md border border-border p-3"
                >
                  <div className="flex items-start gap-2">
                    <Input
                      value={server.urls}
                      onChange={(e) => updateIce(idx, { urls: e.target.value })}
                      placeholder="stun:stun.l.google.com:19302"
                      className="font-mono text-xs"
                    />
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      onClick={() => removeIce(idx)}
                      aria-label="Remove ICE server"
                      className="h-9 w-9 shrink-0 text-muted-foreground hover:text-destructive"
                    >
                      <Trash2 className="h-4 w-4" />
                    </Button>
                  </div>
                  {isTurn && (
                    <div className="grid grid-cols-2 gap-2">
                      <Input
                        value={server.username ?? ""}
                        onChange={(e) => updateIce(idx, { username: e.target.value })}
                        placeholder="username"
                        className="font-mono text-xs"
                      />
                      <Input
                        value={server.credential ?? ""}
                        onChange={(e) => updateIce(idx, { credential: e.target.value })}
                        placeholder="credential"
                        type="password"
                        className="font-mono text-xs"
                      />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </div>

        <SheetFooter>
          <Button onClick={handleSave} className="w-full">
            Save & Reconnect
          </Button>
        </SheetFooter>
      </SheetContent>
    </Sheet>
  );
}
