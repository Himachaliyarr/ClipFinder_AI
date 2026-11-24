import { useEffect, useRef, useState } from 'react';
import { formatTranscriptTimestamp } from '../utils/transcript.js';

export const transcriptExportOptions = ['pdf', 'docx', 'txt', 'json', 'srt', 'vtt'];
export const isSupportedExportFormat = value => transcriptExportOptions.includes(value);
const makeTranscriptPayload = (lines, text) => lines.length
  ? { segments: lines.map(line => ({ ...line })) }
  : { transcript: text };

// This panel keeps transcript viewing/export controls together without owning transcript data.
export default function TranscriptPanel({
  selected,
  transcriptLines,
  transcriptVisible,
  hasTranscript,
  selectedExportFormat,
  exportTranscript,
  setOpenTranscriptFor,
  saveTranscript,
  savingTranscript,
  focusedTime,
  onPreviewRange,
  hasClipForRange,
  onFindReel,
}) {
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [draftText, setDraftText] = useState('');
  const [undoPayload, setUndoPayload] = useState(null);
  const saveTranscriptRef = useRef(saveTranscript);
  const lastSavedPayloadRef = useRef(null);
  const failedDraftKeyRef = useRef(null);
  const autosaveTimerRef = useRef(null);
  const autosaveInFlightRef = useRef(false);
  const transcriptContentRef = useRef(null);

  useEffect(() => {
    saveTranscriptRef.current = saveTranscript;
  }, [saveTranscript]);

  useEffect(() => {
    if (!transcriptVisible || !Number.isFinite(focusedTime) || !transcriptContentRef.current) return;
    const lineIndex = transcriptLines.findIndex(line => focusedTime >= line.start && focusedTime <= line.end);
    if (lineIndex < 0) return;
    transcriptContentRef.current
      .querySelector(`[data-transcript-index="${lineIndex}"]`)
      ?.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }, [focusedTime, transcriptLines, transcriptVisible]);

  useEffect(() => {
    if (!editing || savingTranscript || !lastSavedPayloadRef.current) return undefined;
    const payload = makeTranscriptPayload(draftLines, draftText);
    const key = JSON.stringify(payload);
    if (key === JSON.stringify(lastSavedPayloadRef.current) || key === failedDraftKeyRef.current) return undefined;
    failedDraftKeyRef.current = null;
    autosaveTimerRef.current = setTimeout(async () => {
      if (autosaveInFlightRef.current) return;
      autosaveInFlightRef.current = true;
      const previousPayload = lastSavedPayloadRef.current;
      try {
        if (await saveTranscriptRef.current(payload, { silent: true })) {
          lastSavedPayloadRef.current = payload;
          setUndoPayload(previousPayload);
        } else {
          failedDraftKeyRef.current = key;
        }
      } finally {
        autosaveInFlightRef.current = false;
      }
    }, 900);
    return () => clearTimeout(autosaveTimerRef.current);
  }, [editing, draftLines, draftText, savingTranscript]);

  const beginEditing = () => {
    const lines = transcriptLines.map(line => ({ ...line }));
    const text = selected?.transcript || '';
    lastSavedPayloadRef.current = makeTranscriptPayload(lines, text);
    failedDraftKeyRef.current = null;
    setDraftLines(lines);
    setDraftText(text);
    setOpenTranscriptFor(selected?._id);
    setEditing(true);
  };
  const handleSave = async () => {
    clearTimeout(autosaveTimerRef.current);
    const payload = makeTranscriptPayload(draftLines, draftText);
    const previousPayload = lastSavedPayloadRef.current;
    const saved = await saveTranscript(payload);
    if (saved) {
      lastSavedPayloadRef.current = payload;
      failedDraftKeyRef.current = null;
      if (JSON.stringify(previousPayload) !== JSON.stringify(payload)) setUndoPayload(previousPayload);
      setEditing(false);
    }
  };
  const handleUndo = async () => {
    if (!undoPayload) return;
    clearTimeout(autosaveTimerRef.current);
    const wasEditing = editing;
    if (await saveTranscript(undoPayload)) {
      lastSavedPayloadRef.current = undoPayload;
      failedDraftKeyRef.current = null;
      setDraftLines(undoPayload.segments?.map(line => ({ ...line })) || []);
      setDraftText(undoPayload.transcript || '');
      setUndoPayload(null);
      if (!wasEditing) setEditing(false);
    }
  };
  const handleCancel = () => {
    clearTimeout(autosaveTimerRef.current);
    setEditing(false);
  };

  return (
    <section className="transcript">
      <div className="transcript-heading">
        <h3>Transcript</h3>
        <div className="transcript-actions">
          <button className="secondary" onClick={exportTranscript} disabled={!hasTranscript || !isSupportedExportFormat(selectedExportFormat) || (['srt', 'vtt'].includes(selectedExportFormat) && !transcriptLines.length)}>
            Export transcript
          </button>
          {['srt', 'vtt'].includes(selectedExportFormat) && !transcriptLines.length && <small className="muted">Subtitle export needs timestamped transcript lines.</small>}
          {selectedExportFormat === 'pdf' && <small className="muted">Choose “Save as PDF” in the print dialog.</small>}
          <button
            className="secondary"
            disabled={!hasTranscript}
            aria-expanded={transcriptVisible}
            aria-controls="generated-transcript-content"
            onClick={() => setOpenTranscriptFor(transcriptVisible ? null : selected?._id)}
          >
            {transcriptVisible ? 'Hide transcript' : 'Show transcript'}
          </button>
          {editing ? (
            <>
              {undoPayload && <button type="button" className="secondary" onClick={handleUndo} disabled={savingTranscript}>Undo last save</button>}
              <button type="button" onClick={handleSave} disabled={savingTranscript}>
                {savingTranscript ? 'Saving…' : 'Save transcript'}
              </button>
              <button type="button" className="secondary" onClick={handleCancel} disabled={savingTranscript}>
                Cancel
              </button>
            </>
          ) : (
            <>
              <button
                className="secondary"
                type="button"
                onClick={beginEditing}
                disabled={!hasTranscript || ['downloading', 'queued', 'processing'].includes(selected?.status)}
              >
                Edit transcript
              </button>
              {undoPayload && <button type="button" className="secondary" onClick={handleUndo} disabled={savingTranscript}>Undo last save</button>}
            </>
          )}
        </div>
      </div>
      {editing ? (
        <div id="generated-transcript-content" className="transcript-content transcript-editor">
          {savingTranscript && <p className="muted" role="status">Saving transcript…</p>}
          {!savingTranscript && <p className="muted" role="status">Changes save automatically.</p>}
          {draftLines.length ? draftLines.map((line, index) => (
            <label className="transcript-edit-line" key={`${line.start}-${index}`}>
              <span>{formatTranscriptTimestamp(line.start)} – {formatTranscriptTimestamp(line.end)}</span>
              <textarea
                value={line.text}
                aria-label={`Edit transcript line ${index + 1}`}
                onChange={event => setDraftLines(current => current.map((item, lineIndex) => (
                  lineIndex === index ? { ...item, text: event.target.value } : item
                )))}
              />
            </label>
          )) : (
            <label className="transcript-edit-line">
              <span>Transcript text</span>
              <textarea aria-label="Edit transcript text" value={draftText} onChange={event => setDraftText(event.target.value)} />
            </label>
          )}
        </div>
      ) : transcriptVisible ? (
        <div id="generated-transcript-content" className="transcript-content" ref={transcriptContentRef}>
          {transcriptLines.length ? (
            <div className="transcript-lines">
              {transcriptLines.map((line, index) => (
                <div
                  className={`transcript-line${Number.isFinite(focusedTime) && focusedTime >= line.start && focusedTime <= line.end ? ' transcript-line-focused' : ''}`}
                  data-transcript-index={index}
                  key={`${line.start}-${index}`}
                >
                  {onPreviewRange ? (
                    <button
                      type="button"
                      className="transcript-timestamp transcript-timestamp-button"
                      onClick={() => onPreviewRange(line)}
                      aria-label={`Preview source from ${formatTranscriptTimestamp(line.start)} to ${formatTranscriptTimestamp(line.end)}`}
                    >
                      {formatTranscriptTimestamp(line.start)} – {formatTranscriptTimestamp(line.end)}
                    </button>
                  ) : (
                    <span className="transcript-timestamp">
                      {formatTranscriptTimestamp(line.start)} – {formatTranscriptTimestamp(line.end)}
                    </span>
                  )}
                  <span className="transcript-text">
                    {line.text}
                    {hasClipForRange?.(line) && onFindReel && (
                      <button
                        type="button"
                        className="transcript-reel-link"
                        onClick={() => onFindReel(line)}
                      >
                        View reel suggestion
                      </button>
                    )}
                  </span>
                </div>
              ))}
            </div>
          ) : (
            <p>{selected?.transcript}</p>
          )}
          {selected?.timingNote && <small className="muted">Transcript timing information is available.</small>}
          {selected?.sarvamTranscript && selected.sarvamTranscript !== selected.transcript && (
            <details className="sarvam-transcript">
              <summary>Sarvam AI transcript</summary>
              <p>{selected.sarvamTranscript}</p>
            </details>
          )}
        </div>
      ) : !hasTranscript ? (
        <p className="muted">Transcript will appear here after transcription.</p>
      ) : null}
    </section>
  );
}
