import { ArrowLeftIcon, DownloadIcon } from "lucide-react";
import { useState } from "react";
import { SharedStep } from "@ql/ui/step-page/SharedStep";
import type { StepComment } from "@ql/ui/steps/StepDocument";
import { loadMermaidFrom } from "@ql/ui/reader/MermaidBlock";
import { Button } from "@/components/ui/button";
import { useTheme } from "@/hooks/useTheme";
import { downloadMarkdown } from "@/lib/sharing/exports";
import { linkKeyOf, stepDocs, type LoadedShare, type Tab } from "@/lib/sharing/sharing";
import type { SharedReaderLocation } from "./use-shared-navigation";
import "@/lib/sharing/fragments";

loadMermaidFrom(() => import("mermaid"));

type Props = {
  share: Extract<LoadedShare, { kind: "v2" }>;
  step: Tab;
  reader: SharedReaderLocation | null;
  onRead: (file: string, at?: string) => void;
  onBack: () => void;
  commentsOn: (file: string) => StepComment[];
  onQuote: (file: string, text: string) => void;
};

export function SharedStepHost({ share, step, reader, onRead, onBack, commentsOn, onQuote }: Props) {
  const [download, setDownload] = useState("");
  const { theme } = useTheme();
  const file = reader?.file ?? stepDocs(share.docs)[step][0];
  const key = linkKeyOf(window.location.hash);
  // No document names, headings or picture references leave the encrypted fragment in a copy URL.
  const shareUrl = share.id && key ? `${window.location.origin}/s/${share.id}#${key}` : "";
  return <>
    {file && (reader || !share.presentation) ? <div className="sh-reader-tools">
      {reader ? <Button variant="ghost" size="sm" onClick={onBack}><ArrowLeftIcon />Back to the step</Button> : null}
      <code>{file}</code>
      <Button variant="outline" size="sm" onClick={() => setDownload(downloadMarkdown(share.docs, file) ? "Markdown download started." : "The Markdown download could not start. Try again.")} aria-label="Download Markdown"><DownloadIcon />Download</Button>
      {download ? <span role="status">{download}</span> : null}
    </div> : null}
    <SharedStep id={share.id ?? "shared"} title={share.title} stage={share.stage}
      docs={share.docs} presentation={share.presentation} stills={share.stills} step={step}
      theme={theme} shareUrl={shareUrl} reading={reader !== null} at={reader?.at}
      comments={file ? commentsOn(file) : []} onReadDocument={onRead}
      onQuote={file ? (text) => onQuote(file, text) : undefined} />
  </>;
}
