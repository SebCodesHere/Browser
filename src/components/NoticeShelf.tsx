import { useEffect } from "react";
import type { NoticeAction } from "../../shared/types";
import { useBrowser } from "../BrowserContext";
import { AlertTriangle, CheckCircle, Info, X, XCircle } from "./Icons";

interface NoticeShelfProps {
  onAction: (action: NoticeAction) => void;
}

export function NoticeShelf({ onAction }: NoticeShelfProps) {
  const { notice, dismissNotice } = useBrowser();

  useEffect(() => {
    if (!notice) return;
    const timeout = setTimeout(
      dismissNotice,
      notice.tone === "error" || notice.tone === "warning" ? 11_000 : 6_500
    );
    return () => clearTimeout(timeout);
  }, [notice, dismissNotice]);

  if (!notice) return null;

  return (
    <div className={`notice-shelf tone-${notice.tone}`} role={notice.tone === "error" ? "alert" : "status"}>
      <span className="notice-icon">
        {notice.tone === "success" ? (
          <CheckCircle size={17} />
        ) : notice.tone === "warning" ? (
          <AlertTriangle size={17} />
        ) : notice.tone === "error" ? (
          <XCircle size={17} />
        ) : (
          <Info size={17} />
        )}
      </span>
      <p>{notice.message}</p>
      {notice.action && notice.actionLabel ? (
        <button
          type="button"
          className="notice-action"
          onClick={() => {
            onAction(notice.action!);
            dismissNotice();
          }}
        >
          {notice.actionLabel}
        </button>
      ) : null}
      <button type="button" className="icon-button compact notice-close" onClick={dismissNotice} aria-label="Dismiss">
        <X size={15} />
      </button>
    </div>
  );
}
