import { useState } from 'react';
import {
  buildClipSentenceEditPatch,
  formatEditableTimestamp,
  parseEditableTimestamp,
  getTranscriptLinesOverlappingRange,
} from '../utils/transcript.js';

function getOriginalSentences(clip, transcriptSegments) {
  return getTranscriptLinesOverlappingRange(transcriptSegments, clip.start, clip.end)
    .map(line => ({
      sentenceId: `${line.start}:${line.end}`,
      start: line.start,
      end: line.end,
      startValue: formatEditableTimestamp(line.start),
      endValue: formatEditableTimestamp(line.end),
      text: line.text,
    }));
}

function getSavedSentences(clip, originalSentences) {
  if (!clip.sentenceEdits?.length) return originalSentences;
  const sentencesById = new Map(originalSentences.map(line => [line.sentenceId, line]));
  return clip.sentenceEdits.map(edit => {
    const matched = edit.sentenceId
      ? sentencesById.get(edit.sentenceId)
      : originalSentences.find(sentence => edit.start < sentence.end && edit.end > sentence.start);
    const start = !edit.sentenceId && matched ? matched.start : Number(edit.start);
    const end = !edit.sentenceId && matched ? matched.end : Number(edit.end);
    return {
      ...(matched || { text: 'Transcript sentence' }),
      sentenceId: edit.sentenceId || matched?.sentenceId || `${start}:${end}`,
      start,
      end,
      startValue: formatEditableTimestamp(start),
      endValue: formatEditableTimestamp(end),
    };
  });
}

export default function ClipSentenceEditor({ clip, transcriptSegments, sourceDuration, onSave }) {
  const [open, setOpen] = useState(false);
  const [sentences, setSentences] = useState([]);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');
  const [timestampError, setTimestampError] = useState(false);
  const originalSentences = getOriginalSentences(clip, transcriptSegments);

  function openEditor() {
    setSentences(getSavedSentences(clip, originalSentences));
    setMessage('');
    setTimestampError(false);
    setOpen(true);
  }

  function updateTimestamp(index, field, value) {
    setSentences(current => current.map((sentence, sentenceIndex) => (
      sentenceIndex === index ? { ...sentence, [`${field}Value`]: value } : sentence
    )));
    setMessage('');
    setTimestampError(false);
  }

  function moveSentence(index, direction) {
    setSentences(current => {
      const next = [...current];
      const target = index + direction;
      [next[index], next[target]] = [next[target], next[index]];
      return next;
    });
  }

  function removeSentence(index) {
    setSentences(current => current.filter((_, sentenceIndex) => sentenceIndex !== index));
  }

  async function saveSentences() {
    if (!sentences.length) {
      setMessage('Keep at least one sentence in the clip.');
      return;
    }
    const parsedSentences = sentences.map(sentence => ({
      ...sentence,
      start: sentence.startValue === formatEditableTimestamp(sentence.start)
        ? sentence.start
        : parseEditableTimestamp(sentence.startValue),
      end: sentence.endValue === formatEditableTimestamp(sentence.end)
        ? sentence.end
        : parseEditableTimestamp(sentence.endValue),
    }));
    if (parsedSentences.some(sentence => (
      !Number.isFinite(sentence.start) || !Number.isFinite(sentence.end)
      || sentence.start < 0 || sentence.end <= sentence.start
      || (sourceDuration !== null && sourceDuration !== undefined
        && Number.isFinite(Number(sourceDuration)) && sentence.end > Number(sourceDuration) + 0.25)
    ))) {
      setTimestampError(true);
      setMessage('Enter valid Start/End times as HH:MM:SS.mmm; End must be after Start and within the source.');
      return;
    }
    const chronological = [...parsedSentences].sort((a, b) => a.start - b.start);
    if (chronological.some((sentence, index) => index > 0 && sentence.start < chronological[index - 1].end)) {
      setTimestampError(true);
      setMessage('Sentence timestamps cannot overlap.');
      return;
    }
    setSaving(true);
    setMessage('');
    const patch = buildClipSentenceEditPatch(clip, parsedSentences, originalSentences);
    try {
      const saved = await onSave(clip._id, patch);
      setMessage(saved ? 'Sentence edits saved. Render the clip to apply them.' : 'Could not save sentence edits.');
    } finally {
      setSaving(false);
    }
  }

  if (!originalSentences.length) return null;

  return (
    <section className="clip-sentence-editor">
      {!open ? (
        <button className="secondary" type="button" onClick={openEditor}>
          Edit clip sentences
        </button>
      ) : (
        <>
          <div className="clip-sentence-editor-heading">
            <div>
              <strong>Clip sentences</strong>
              <p className="muted">Move with the arrows or remove a sentence. Only these sentences are kept; pauses and non-transcript footage are cut.</p>
              {sentences.some(sentence => sentence.start < Number(clip.start) || sentence.end > Number(clip.end)) && (
                <p className="muted">Saving will extend the clip trim to keep these sentences whole.</p>
              )}
            </div>
            <button className="secondary" type="button" onClick={() => setOpen(false)}>Close</button>
          </div>
          <ol className="clip-sentence-list" aria-label={`Sentences in ${clip.title}`}>
            {sentences.map((sentence, index) => (
              <li key={sentence.sentenceId}>
                <div className="clip-sentence-copy">
                  <div className="clip-sentence-times">
                    <label>
                      Start
                      <input
                        type="text"
                        value={sentence.startValue}
                        aria-label={`Start time for sentence ${index + 1}`}
                        aria-invalid={timestampError}
                        placeholder="HH:MM:SS.mmm"
                        onChange={event => updateTimestamp(index, 'start', event.target.value)}
                        disabled={saving}
                      />
                    </label>
                    <label>
                      End
                      <input
                        type="text"
                        value={sentence.endValue}
                        aria-label={`End time for sentence ${index + 1}`}
                        aria-invalid={timestampError}
                        placeholder="HH:MM:SS.mmm"
                        onChange={event => updateTimestamp(index, 'end', event.target.value)}
                        disabled={saving}
                      />
                    </label>
                  </div>
                  <span>{sentence.text}</span>
                </div>
                <div className="clip-sentence-actions">
                  <button
                    className="secondary"
                    type="button"
                    aria-label={`Move sentence ${index + 1} up`}
                    onClick={() => moveSentence(index, -1)}
                    disabled={index === 0 || saving}
                  >
                    ↑
                  </button>
                  <button
                    className="secondary"
                    type="button"
                    aria-label={`Move sentence ${index + 1} down`}
                    onClick={() => moveSentence(index, 1)}
                    disabled={index === sentences.length - 1 || saving}
                  >
                    ↓
                  </button>
                  <button
                    className="reject"
                    type="button"
                    aria-label={`Remove sentence ${index + 1}`}
                    onClick={() => removeSentence(index)}
                    disabled={sentences.length <= 1 || saving}
                  >
                    Remove
                  </button>
                </div>
              </li>
            ))}
          </ol>
          <div className="clip-sentence-footer">
            <button className="secondary" type="button" onClick={() => setSentences(originalSentences)} disabled={saving}>
              Restore original order
            </button>
            <button type="button" onClick={saveSentences} disabled={saving}>
              {saving ? 'Saving…' : 'Save sentence edits'}
            </button>
            <small className="muted" role="status" aria-live="polite">{message}</small>
          </div>
        </>
      )}
    </section>
  );
}
