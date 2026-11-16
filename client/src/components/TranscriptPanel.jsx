import { formatTranscriptTimestamp } from '../utils/transcript.js';

export const transcriptExportOptions = ['pdf', 'docx', 'txt', 'json'];
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
}) {
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
              <option key={option} value={option}>{option === 'pdf' ? 'PDF' : option === 'docx' ? 'Word (.docx)' : option === 'json' ? 'JSON (.json)' : 'Text (.txt)'}</option>
            ))}
          </select>
          <button className="secondary" onClick={exportTranscript} disabled={!hasTranscript}>
            Export transcript
          </button>
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
        </div>
      </div>
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
