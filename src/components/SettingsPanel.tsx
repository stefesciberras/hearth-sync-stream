import { useEffect, useState } from "react";
import { Settings } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
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

export interface JanusConfig {
  signalingUrl: string;
  videoroomRoom: number;
}

export const DEFAULT_CONFIG: JanusConfig = {
  signalingUrl: "wss://your-janus-server.example.com",
  videoroomRoom: 1234,
};

const STORAGE_KEY = "secureview.janus.config";

export function loadConfig(): JanusConfig {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return DEFAULT_CONFIG;
    const parsed = JSON.parse(raw) as Partial<JanusConfig>;
    return {
      signalingUrl: parsed.signalingUrl || DEFAULT_CONFIG.signalingUrl,
      videoroomRoom:
        typeof parsed.videoroomRoom === "number"
          ? parsed.videoroomRoom
          : DEFAULT_CONFIG.videoroomRoom,
    };
  } catch {
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

  useEffect(() => {
    if (open) {
      setUrl(config.signalingUrl);
      setRoom(String(config.videoroomRoom));
    }
  }, [open, config]);

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
    const next: JanusConfig = {
      signalingUrl: url.trim(),
      videoroomRoom: roomNum,
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
      <SheetContent className="glass-surface">
        <SheetHeader>
          <SheetTitle className="font-mono uppercase tracking-wider text-sm">
            Connection Settings
          </SheetTitle>
          <SheetDescription>
            Configure the Janus signaling server and videoroom.
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
