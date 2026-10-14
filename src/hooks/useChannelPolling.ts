import { useEffect, useState } from "react";
import { ChannelPoller } from "../sessions/ChannelPoller";
import { channelRequest } from "../sessions/ChannelClient";
import type { ChannelCommandResult } from "../../shared/channel";

export function useChannelPolling(
  api: string | undefined,
  capability: string,
  receive: (result: ChannelCommandResult) => void,
  enabled = true,
) {
  const [error, setError] = useState("");
  const [gone, setGone] = useState(false);
  useEffect(() => {
    if (!api || !enabled) return;
    const poller = new ChannelPoller(
      () => channelRequest(api, capability),
      (result) => {
        setError("");
        receive(result);
      },
      (error, terminal) => {
        setError(error.message);
        setGone(terminal);
      },
    );
    const refresh = () => {
      void poller.refresh();
    };
    refresh();
    window.addEventListener("focus", refresh);
    return () => {
      poller.stop();
      window.removeEventListener("focus", refresh);
    };
  }, [api, capability, receive, enabled]);
  return { error, gone };
}
