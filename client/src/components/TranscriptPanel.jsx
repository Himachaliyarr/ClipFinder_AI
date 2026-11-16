import { useState } from 'react';
import { formatTranscriptTimestamp } from '../utils/transcript.js';

export const transcriptExportOptions = ['pdf', 'docx', 'txt', 'json', 'srt', 'vtt'];
export const isSupportedExportFormat = value => transcriptExportOptions.includes(value);

// This panel keeps transcript viewing/export controls together without owning transcript data.
export default function TranscriptPanel({
  selected,
  transcriptLines,
  transcriptVisible,
  hasTranscript,
  selectedExportFormat,
  setExportFormat,
  exportTranscript,
  setOpenTranscriptFor,
  saveTranscript,
  savingTranscript,
}) {
  const [editing, setEditing] = useState(false);
  const [draftLines, setDraftLines] = useState([]);
  const [draftText, setDraftText] = useState('');
  const beginEditing = () => {
    setDraftLines(transcriptLines.map(line => ({ ...line })));
    setDraftText(selected?.transcript || '');
    setEditing(true);
  };
  const handleSave = async () => {
    const saved = await saveTranscript(draftLines.length
      ? { segments: draftLines }
      : { transcript: draftText });
    if (saved) setEditing(false);
  };

  return (
    <section className="transcript">
      <div className="transcript-heading">
        <h3>Transcript</h3>
        <div className="transcript-actions">
          <select
            className="transcript-export-format"
            aria-label="Transcript export format"
            value={selectedExportFormat}
            onChange={event => {
              const nextFormat = event.target.value;
              setExportFormat(isSupportedExportFormat(nextFormat) ? nextFormat : 'pdf');
            }}
          >
            {transcriptExportOptions.map(option => (
              <option key={option} value={option}>
                {option === 'pdf' ? 'PDF' : option === 'docx' ? 'Word (.docx)' : option === 'json' ? 'JSON (.json)' : option === 'srt' ? 'SubRip (.srt)' : option === 'vtt' ? 'WebVTT (.vtt)' : 'Text (.txt)'}
              </option>
            ))}
          </select>
          <button className="secondary" onClick={exportTranscript} disabled={!hasTranscript || (['srt', 'vtt'].includes(selectedExportFormat) && !transcriptLines.length)}>
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
          <button
            className="secondary"
            type="button"
            onClick={beginEditing}
            disabled={!hasTranscript || editing || ['downloading', 'queued', 'processing'].includes(selected?.status)}
          >
            Edit transcript
          </button>
        </div>
      </div>
      {editing && (
        <div className="transcript-editor">
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
          <div className="transcript-edit-actions">
            <button type="button" onClick={handleSave} disabled={savingTranscript}>
              {savingTranscript ? 'Saving…' : 'Save transcript'}
            </button>
            <button type="button" className="secondary" onClick={() => setEditing(false)} disabled={savingTranscript}>Cancel</button>
          </div>
        </div>
      )}
      {transcriptVisible ? (
        <div id="generated-transcript-content" className="transcript-content">
          {transcriptLines.length ? (
            <div className="transcript-lines">
              {transcriptLines.map((line, index) => (
                <div className="transcript-line" key={`${line.start}-${index}`}>
                  <span className="transcript-timestamp">
                    {formatTranscriptTimestamp(line.start)} – {formatTranscriptTimestamp(line.end)}
                  </span>
                  <span className="transcript-text">{line.text}</span>
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
