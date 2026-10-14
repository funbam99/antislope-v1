import { array, object, text, integer } from "./validation.js";

// A recovery archive cannot stand in for a lost exercise or release guessed references.
export class ReaderArchive {
  readonly preview = true;
  constructor(private readonly saved: Record<string, any>) {}
  static restore(input: unknown): ReaderArchive {
    const data = object(input, ["kind", "schemaVersion", "reader", "chat", "browser"]);
    if (data.kind !== "reader-archive" || data.schemaVersion !== 1)
      throw new Error("Invalid reader archive");
    const reader = object(data.reader, [
      "phase",
      "title",
      "requirements",
      "intent",
      "version",
      "files",
      "annotations",
    ]);
    if (!["reading", "submitted"].includes(reader.phase as string))
      throw new Error("Archive must remain blind");
    const files = array(reader.files, 50).map((entry) => {
      const f = object(entry, ["path", "candidate"]);
      return {
        path: text(f.path, "Path", 4000),
        candidate: array(f.candidate, 100000).map((line) =>
          text(line, "Displayed line", 100000, true),
        ),
        baseline: [],
        hunks: [],
      };
    });
    const version = object(reader.version, [
      "readerId",
      "baseline",
      "headAtPreparation",
      "excluded",
    ]);
    const messages = array(data.chat, 43).map((entry) => {
      const m = object(entry, ["role", "text"]);
      if (!["user", "assistant"].includes(m.role as string)) throw new Error("Invalid message");
      return { role: m.role, text: text(m.text, "Message", 16000) };
    });
    const saved = {
      kind: "reader-archive",
      schemaVersion: 1,
      reader: {
        phase: reader.phase,
        title: text(reader.title),
        requirements: text(reader.requirements, "Requirements", 12000, true),
        intent: text(reader.intent, "Intent", 12000, true),
        version: {
          readerId: text(version.readerId, "Reader ID", 100),
          baseline: text(version.baseline, "Baseline", 100, true),
          headAtPreparation: text(version.headAtPreparation, "Head", 100, true),
          excluded: array(version.excluded, 1000).map((v) => text(v, "Excluded path", 4000)),
        },
        files,
        annotations: [] as any[],
      },
      chat: messages,
      browser: {},
    };
    const archive = new ReaderArchive(saved);
    archive.updateBrowser({ comments: { notes: reader.annotations } });
    if (data.browser) archive.updateBrowser(data.browser);
    return archive;
  }
  updateBrowser(input: unknown): void {
    const data = object(input, ["readerId", "comments", "history", "evidence"]);
    if (typeof data.readerId === "string" && /^[a-f0-9]{32}$/u.test(data.readerId))
      this.saved.reader.version.readerId = data.readerId;
    if (data.comments) {
      const notes = array((data.comments as any).notes, 50).map((entry) => {
        const n = object(entry, ["id", "anchor", "constraint", "trigger", "uncertainty"]),
          a = object(n.anchor, ["kind", "path", "line"]);
        if (!["candidate", "file", "change"].includes(a.kind as string))
          throw new Error("Unsupported archive anchor");
        const file = this.saved.reader.files.find((f: any) => f.path === a.path);
        if (a.kind !== "change" && !file) throw new Error("Unknown archive file");
        const anchor =
          a.kind === "change"
            ? { kind: "change" }
            : a.kind === "file"
              ? { kind: "file", path: file.path }
              : {
                  kind: "candidate",
                  path: file.path,
                  line: integer(a.line, 1, file.candidate.length),
                };
        return {
          id: text(n.id, "ID", 100),
          anchor,
          constraint: text(n.constraint),
          trigger: text(n.trigger, "Trigger", 4000, true),
          uncertainty: text(n.uncertainty, "Uncertainty", 4000, true),
        };
      });
      const merged = new Map(this.saved.reader.annotations.map((note: any) => [note.id, note]));
      for (const note of notes) {
        const existing = merged.get(note.id) as any;
        if (!existing || existing.constraint === note.constraint) merged.set(note.id, note);
      }
      this.saved.reader.annotations = [...merged.values()];
    }
    // Preserve the author's existing local records; none of these are AI context.
    this.saved.browser = structuredClone(data);
  }
  view(): Record<string, any> {
    return structuredClone({
      ...this.saved.reader,
      preview: true,
      recovery: "reader-only",
      freshness: "unknown",
      initialPrompt: "Original exercise unavailable; review actions are paused.",
      firstPass: null,
      hintLevel: 0,
      hintProgressUnavailable: true,
      assessments: null,
      region: null,
      referenceDispute: "",
      archivedChat: this.saved.chat,
    });
  }
  agentView(): Record<string, unknown> {
    return {
      phase: this.saved.reader.phase,
      freshness: "unknown",
      readerId: this.saved.reader.version.readerId,
      recovery: "reader-only",
    };
  }
  discussionView(): Record<string, unknown> {
    const view = this.view();
    return {
      phase: view.phase,
      freshness: "unknown",
      title: view.title,
      requirements: view.requirements,
      intent: view.intent,
      files: view.files,
      annotations: view.annotations,
      recovery: "reader-only",
    };
  }
  transition(): never {
    throw new Error("Original exercise unavailable; archive is read-only");
  }
  export(): never {
    throw new Error("Archive cannot certify a handoff");
  }
  checkpoint(): Record<string, unknown> {
    const saved = structuredClone(this.saved);
    saved.reader.files = saved.reader.files.map(({ path, candidate }: any) => ({
      path,
      candidate,
    }));
    return saved;
  }
}
export function archiveClient(client: string): string {
  const adjusted = client
    .replace("mode = 'diff'", "mode = 'candidate'")
    .replace(
      "state=await response.json();notes=state.annotations;",
      "state=await response.json();chatState={messages:state.archivedChat,busy:false,available:false};notes=state.annotations;",
    )
    .replace("reveal.disabled=state.phase!=='submitted'", "reveal.disabled=true")
    .replace("state.preview?'Curator preview':state.phase", "'Reader archive · '+state.phase")
    .replace("progress.hidden=!!state.preview;if(state.preview)return;", "progress.hidden=false;")
    .replace("const complete=[!!state.firstPass", "const complete=[state.phase==='submitted'")
    .replace(
      "control.disabled=number>current&&!(state.phase==='revealed'&&number===4);",
      "control.disabled=true;",
    )
    .replace(
      "Discussion is unavailable in curator preview.",
      "Original exercise unavailable. This recovery archive is read-only.",
    )
    .replace(
      "Captured review version. Select code or click a line number to comment.",
      "Recovered displayed version. Read-only archive.",
    )
    .replace(
      "if(state.phase!=='completed')item.append(button('Edit'",
      "if(false)item.append(button('Edit'",
    )
    .replace(
      "renderNotes();renderWorkflow();renderProgress();",
      "$('file-view').disabled=true;renderNotes();renderWorkflow();renderProgress();",
    );
  return `(async()=>{try{const base=location.pathname,cap=base.split('/')[1],read=key=>JSON.parse(localStorage.getItem(key)||'null');const history=read('minesweeper-review-history:'+cap),comments=read('minesweeper-comments:'+cap),evidence=read('minesweeper-author-evidence:'+cap);await fetch(base+'archive-browser',{method:'POST',headers:{'Content-Type':'application/json','X-Minesweeper-Session':cap},body:JSON.stringify({readerId:history?.readerId,comments,history,evidence})});}catch{}\n${adjusted}\n})();`;
}
